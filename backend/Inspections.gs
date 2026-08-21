/**
 * HULUL - Inspections.gs  (REQ-INS-01..07)
 * Inspection scheduling + Opening / Operational checklist execution.
 */

// Deleted items (status: 'Deleted') are soft-deleted -- see deleteChecklistItem below -- and hidden
// from every normal listing so they no longer show up in the New Item pickers or
// inspectionScopeItems_, but the row itself stays so any Inspection/Finding that already referenced
// it keeps resolving. includeDeleted lets callers that need to see them anyway (none yet) opt in.
function listChecklistItems(p) {
  var all = p && p.includeDeleted ? getAll('ChecklistItems') : getAll('ChecklistItems').filter(function (c) { return c.status !== 'Deleted'; });
  if (p && p.checklistType) all = all.filter(function (c) { return c.checklistType === p.checklistType; });
  if (p && p.phase) all = all.filter(function (c) { return c.phase === p.phase; });
  return all;
}

// A Description + Phase + Checklist Type + Discipline combo identifies a checklist item for dedup
// purposes — defaultRisk/defaultWindowHours aren't part of the key, per REQ. Used both when creating
// a single item and when scanning for existing duplicates to remove.
function checklistItemDupKey_(c) {
  return String(c.description || '').trim().toLowerCase() + '|' + String(c.phase || '') + '|' +
    String(c.checklistType || '').trim().toLowerCase() + '|' + String(c.category || '').trim().toLowerCase();
}

// Whole-number validation shared by createChecklistItem/updateChecklistItem/bulkCreateChecklistItems
// -- REQ: "Sub-Category must also have 'Sub Ref.' which is a whole number ... each item in the
// checklist must have 'Item Ref.'" Both required, >= 0 (unlike Cat Ref/Disciplines, 0 is allowed here
// since these are just ordinal position numbers, not Roman-numeral-formatted).
function validChecklistRefNumber_(v) {
  var n = Number(v);
  return v !== undefined && v !== null && v !== '' && Number.isInteger(n) && n >= 0;
}

// Admin-maintained reference data: checklist item catalogue (Setup.gs seeds the defaults). The dup
// check only looks at active items -- recreating an item with the same key as a previously
// soft-deleted one is allowed.
function createChecklistItem(user, p) {
  requirePermission(user, 'checklistItem.manage'); // RBAC pilot -- same default roles as before, no behavior change
  ['checklistType', 'category', 'description'].forEach(function (f) {
    if (!p[f]) throw new HululError('BAD_REQUEST', f + ' is required');
  });
  if (!validChecklistRefNumber_(p.subRef)) throw new HululError('BAD_REQUEST', 'Sub Ref. is required and must be a whole number.');
  if (!validChecklistRefNumber_(p.itemRef)) throw new HululError('BAD_REQUEST', 'Item Ref. is required and must be a whole number.');
  var row = {
    id: newId('ChecklistItems'), checklistType: p.checklistType, category: p.category, description: p.description,
    defaultRisk: p.defaultRisk || 'Medium', defaultWindowHours: p.defaultWindowHours || 24, phase: p.phase || 'Opening',
    status: 'Active', subRef: Number(p.subRef), itemRef: Number(p.itemRef), checklistTypeAr: p.checklistTypeAr || ''
  };
  var key = checklistItemDupKey_(row);
  var dup = findWhere('ChecklistItems', function (c) { return c.status !== 'Deleted' && checklistItemDupKey_(c) === key; })[0];
  if (dup) throw new HululError('BAD_REQUEST', 'A checklist item with this Description, Phase, Sub-Category, and Category already exists.');
  insertRow('ChecklistItems', row);
  audit(user.id, 'CREATE_CHECKLIST_ITEM', 'ChecklistItems', row.id, {});
  return row;
}

// Bulk version of createChecklistItem, used by the CSV import (importChecklistItemsCsv in
// frontend/js/views/checklistItems.js). Looping createChecklistItem() once per CSV row meant one
// full sheet scan (dup check) + one lock acquisition (newId) + one appendRow() *per row*, plus one
// network round trip per row from the frontend -- a 300-row import took ~5 minutes. This instead:
// reads the existing sheet once, dedupes the whole batch (against existing rows AND against other
// rows in the same batch, so two duplicate rows in one CSV don't both get in) in memory, mints all
// ids in one locked batch, and writes every new row with a single insertRows() call. Each item may
// carry a `row` (the CSV line number) purely so failures can be reported back per-row, same as the
// old per-row loop did.
function bulkCreateChecklistItems(user, p) {
  requirePermission(user, 'checklistItem.manage'); // RBAC pilot -- same default roles as before, no behavior change
  var items = (p && p.items) || [];
  if (!items.length) return { created: [], createdCount: 0, failed: [] };

  var existingKeys = {};
  getAll('ChecklistItems').forEach(function (c) {
    if (c.status !== 'Deleted') existingKeys[checklistItemDupKey_(c)] = true;
  });

  var failed = [];
  var toInsert = [];
  var batchKeys = {};
  items.forEach(function (raw) {
    var label = raw.description || raw.checklistType || '(unnamed)';
    var missing = ['checklistType', 'category', 'description'].filter(function (f) { return !raw[f]; });
    if (missing.length) {
      failed.push({ row: raw.row, name: label, reason: missing.join(', ') + ' required' });
      return;
    }
    if (!validChecklistRefNumber_(raw.subRef) || !validChecklistRefNumber_(raw.itemRef)) {
      failed.push({ row: raw.row, name: label, reason: 'Sub Ref. and Item Ref. are required and must be whole numbers' });
      return;
    }
    var row = {
      checklistType: raw.checklistType, category: raw.category, description: raw.description,
      defaultRisk: raw.defaultRisk || 'Medium', defaultWindowHours: raw.defaultWindowHours || 24,
      phase: raw.phase || 'Opening', status: 'Active', subRef: Number(raw.subRef), itemRef: Number(raw.itemRef),
      checklistTypeAr: raw.checklistTypeAr || ''
    };
    var key = checklistItemDupKey_(row);
    if (existingKeys[key] || batchKeys[key]) {
      failed.push({ row: raw.row, name: label, reason: 'A checklist item with this Description, Phase, Checklist Type, and Discipline already exists.' });
      return;
    }
    batchKeys[key] = true;
    toInsert.push({ row: raw.row, name: label, data: row });
  });

  if (toInsert.length) {
    var ids = newIds('ChecklistItems', toInsert.length);
    toInsert.forEach(function (entry, i) { entry.data.id = ids[i]; });
    insertRows('ChecklistItems', toInsert.map(function (entry) { return entry.data; }));
    audit(user.id, 'BULK_CREATE_CHECKLIST_ITEMS', 'ChecklistItems', '', { count: toInsert.length });
  }

  return {
    created: toInsert.map(function (entry) { return entry.name; }),
    createdCount: toInsert.length,
    failed: failed
  };
}

// Edits an existing item -- same dup check as create (Description+Phase+Checklist Type+Discipline),
// excluding the item being edited itself so saving it unchanged never trips the check.
function updateChecklistItem(user, p) {
  requirePermission(user, 'checklistItem.manage'); // RBAC pilot -- same default roles as before, no behavior change
  var item = getById('ChecklistItems', p.itemId);
  if (!item) throw new HululError('NOT_FOUND', 'Checklist item not found');
  var patch = {};
  ['checklistType', 'category', 'description', 'defaultRisk', 'defaultWindowHours', 'phase', 'subRef', 'itemRef', 'checklistTypeAr'].forEach(function (f) {
    if (p[f] !== undefined) patch[f] = p[f];
  });
  ['checklistType', 'category', 'description'].forEach(function (f) {
    if (patch[f] !== undefined && !String(patch[f]).trim()) throw new HululError('BAD_REQUEST', f + ' is required');
  });
  if (patch.subRef !== undefined) {
    if (!validChecklistRefNumber_(patch.subRef)) throw new HululError('BAD_REQUEST', 'Sub Ref. must be a whole number.');
    patch.subRef = Number(patch.subRef);
  }
  if (patch.itemRef !== undefined) {
    if (!validChecklistRefNumber_(patch.itemRef)) throw new HululError('BAD_REQUEST', 'Item Ref. must be a whole number.');
    patch.itemRef = Number(patch.itemRef);
  }
  var merged = Object.assign({}, item, patch);
  var key = checklistItemDupKey_(merged);
  var dup = findWhere('ChecklistItems', function (c) { return c.id !== p.itemId && c.status !== 'Deleted' && checklistItemDupKey_(c) === key; })[0];
  if (dup) throw new HululError('BAD_REQUEST', 'A checklist item with this Description, Phase, Sub-Category, and Category already exists.');
  var updated = updateRow('ChecklistItems', p.itemId, patch);
  audit(user.id, 'UPDATE_CHECKLIST_ITEM', 'ChecklistItems', p.itemId, patch);
  return updated;
}

// Soft-delete: the row stays (any Inspection/Finding that already referenced it keeps resolving a
// real description) but it's marked Deleted and filtered out of listChecklistItems and
// inspectionScopeItems_ going forward -- same pattern as deleteVenue/deleteZone.
function deleteChecklistItem(user, p) {
  requirePermission(user, 'checklistItem.manage'); // RBAC pilot -- same default roles as before, no behavior change
  var item = getById('ChecklistItems', p.itemId);
  if (!item) throw new HululError('NOT_FOUND', 'Checklist item not found');
  if (item.status === 'Deleted') throw new HululError('BAD_REQUEST', 'Checklist item is already deleted');
  updateRow('ChecklistItems', p.itemId, { status: 'Deleted' });
  audit(user.id, 'DELETE_CHECKLIST_ITEM', 'ChecklistItems', p.itemId, {});
  return { ok: true };
}

// One-time (repeatable) cleanup: removes existing duplicate rows -- same Description + Phase +
// Checklist Type + Discipline -- keeping the earliest-created copy of each (sheet row order = insertion
// order, since ChecklistItems has no timestamp column) and deleting the rest. Only considers
// still-active items -- a soft-deleted row should never get hard-deleted here, nor count as a
// "duplicate" that causes an active row to be removed instead.
function dedupeChecklistItems(user) {
  requirePermission(user, 'checklistItem.dedupe'); // RBAC pilot -- same default roles as before, no behavior change
  var seen = {};
  var toDelete = [];
  getAll('ChecklistItems').filter(function (c) { return c.status !== 'Deleted'; }).forEach(function (c) {
    var key = checklistItemDupKey_(c);
    if (seen[key]) toDelete.push(c.id); else seen[key] = c.id;
  });
  toDelete.forEach(function (id) { deleteRow('ChecklistItems', id); });
  if (toDelete.length) audit(user.id, 'DEDUPE_CHECKLIST_ITEMS', 'ChecklistItems', '', { removed: toDelete.length });
  return { removed: toDelete.length };
}

// REQ-INS-01: PM creates/maintains an inspection schedule for the venue.
// NOTE: an Inspection is a scheduled *visit* (inspector + discipline + phase, at a time) — it is
// no longer tied to one Checklist type. By default every Checklist type under that discipline/phase
// is the inspector's choice to complete during (or any time after) the visit; see
// inspectionCoverage_ below for how "done" vs "still open" is tracked per checklist item.
function scheduleInspection(user, p) {
  var event = getById('Events', p.eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');
  requirePermission(user, 'inspection.manage', event.inspectionCoId); // RBAC pilot -- same default roles as before, no behavior change
  ['eventId', 'disciplineId', 'inspectorId', 'scheduledAt', 'phase'].forEach(function (f) {
    if (!p[f]) throw new HululError('BAD_REQUEST', f + ' is required');
  });
  if (['Opening', 'Operational'].indexOf(p.phase) === -1) {
    throw new HululError('BAD_REQUEST', 'phase must be "Opening" or "Operational"');
  }
  var isAssigned = findWhere('InspectorAssignments', function (a) {
    return a.eventId === p.eventId && a.disciplineId === p.disciplineId && a.inspectorId === p.inspectorId;
  }).length > 0;
  if (!isAssigned) throw new HululError('FORBIDDEN', 'This inspector is not assigned to this category for this event yet — assign them first in Assignments.');
  var discipline = getById('Disciplines', p.disciplineId);
  var inspection = {
    id: newId('Inspections'), eventId: p.eventId, disciplineId: p.disciplineId, inspectorId: p.inspectorId,
    checklistType: '', scheduledAt: p.scheduledAt, phase: p.phase, status: 'Scheduled'
  };
  insertRow('Inspections', inspection);
  audit(user.id, 'SCHEDULE_INSPECTION', 'Inspections', inspection.id, {});
  notify_(p.inspectorId, 'INSPECTION_SCHEDULED', 'New inspection scheduled: ' + (discipline ? discipline.name : '') + ' (' + p.phase + ')', 'Inspections', inspection.id, p.eventId);
  return inspection;
}

// Only inspections still in 'Scheduled' status (nothing recorded against them yet) can be edited —
// changing the discipline/phase after InspectionResults exist would retroactively change what scope
// those results were recorded against.
function updateInspection(user, p) {
  var event = getById('Events', p.eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');
  requirePermission(user, 'inspection.manage', event.inspectionCoId); // RBAC pilot -- same default roles as before, no behavior change
  var inspection = getById('Inspections', p.inspectionId);
  if (!inspection || inspection.eventId !== p.eventId) throw new HululError('NOT_FOUND', 'Inspection not found');
  if (inspection.status !== 'Scheduled') {
    throw new HululError('FORBIDDEN', 'This inspection already has results recorded against it and can no longer be edited.');
  }
  var disciplineId = p.disciplineId || inspection.disciplineId;
  var inspectorId = p.inspectorId || inspection.inspectorId;
  var phase = p.phase || inspection.phase;
  var scheduledAt = p.scheduledAt || inspection.scheduledAt;
  if (['Opening', 'Operational'].indexOf(phase) === -1) {
    throw new HululError('BAD_REQUEST', 'phase must be "Opening" or "Operational"');
  }
  var isAssigned = findWhere('InspectorAssignments', function (a) {
    return a.eventId === p.eventId && a.disciplineId === disciplineId && a.inspectorId === inspectorId;
  }).length > 0;
  if (!isAssigned) throw new HululError('FORBIDDEN', 'This inspector is not assigned to this category for this event yet — assign them first in Assignments.');
  var patch = { disciplineId: disciplineId, inspectorId: inspectorId, phase: phase, scheduledAt: scheduledAt };
  var updated = updateRow('Inspections', p.inspectionId, patch);
  audit(user.id, 'UPDATE_INSPECTION', 'Inspections', p.inspectionId, patch);
  // scheduleInspection notifies the inspector when it's first created; a reschedule or reassignment
  // deserves the same. If the inspector actually changed, tell both the outgoing and incoming one
  // instead of just the (new) assignee, same reasoning as removeInspectorAssignment/assignInspector.
  var disciplineObj = getById('Disciplines', disciplineId);
  if (inspection.inspectorId !== inspectorId) {
    notify_(inspection.inspectorId, 'INSPECTION_REASSIGNED', 'You are no longer assigned to inspect ' + (disciplineObj ? disciplineObj.name : '') + ' (' + phase + ') for ' + event.name, 'Inspections', p.inspectionId, p.eventId);
    notify_(inspectorId, 'INSPECTION_SCHEDULED', 'New inspection scheduled: ' + (disciplineObj ? disciplineObj.name : '') + ' (' + phase + ')', 'Inspections', p.inspectionId, p.eventId);
  } else {
    notify_(inspectorId, 'INSPECTION_UPDATED', 'Inspection updated: ' + (disciplineObj ? disciplineObj.name : '') + ' (' + phase + ')', 'Inspections', p.inspectionId, p.eventId);
  }
  return updated;
}

// Deleting is only safe (and only allowed) while nothing has been recorded yet — status
// 'Scheduled' and zero InspectionResults — so nothing else ends up referencing a removed inspection.
function deleteInspection(user, p) {
  var event = getById('Events', p.eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');
  requirePermission(user, 'inspection.manage', event.inspectionCoId); // RBAC pilot -- same default roles as before, no behavior change
  var inspection = getById('Inspections', p.inspectionId);
  if (!inspection || inspection.eventId !== p.eventId) throw new HululError('NOT_FOUND', 'Inspection not found');
  if (inspection.status !== 'Scheduled') {
    throw new HululError('FORBIDDEN', 'This inspection already has results recorded against it and can no longer be deleted.');
  }
  var hasResults = findWhere('InspectionResults', function (r) { return r.inspectionId === p.inspectionId; }).length > 0;
  if (hasResults) throw new HululError('FORBIDDEN', 'This inspection already has results recorded against it and can no longer be deleted.');
  deleteRow('Inspections', p.inspectionId);
  audit(user.id, 'DELETE_INSPECTION', 'Inspections', p.inspectionId, {});
  var discipline = getById('Disciplines', inspection.disciplineId);
  notify_(inspection.inspectorId, 'INSPECTION_CANCELLED', 'Inspection cancelled: ' + (discipline ? discipline.name : '') + ' (' + inspection.phase + ') for ' + event.name, 'Inspections', p.inspectionId, p.eventId);
  return { ok: true };
}

/* ---------------- Self-service "open" checklist pickup ----------------
 * REQ: "Any inspector who has not been assigned can start on a checklist that has not been assigned
 * to anyone as long as he is qualified in that category. Once he picks up an opening sub-checklist
 * it becomes unavailable to other inspectors unless cancelled by the inspector." REQ correction:
 * "inspectors can now pick up one open checklist sub-category" -- a "slot" is one (discipline, phase,
 * checklistType) combination, not the whole discipline+phase -- e.g. two different inspectors can
 * each pick up a different sub-category under the same "Fire Safety / Opening" checklist instead of
 * one inspector claiming the entire discipline. checklistType is a required field on every
 * ChecklistItems row (createChecklistItem above), so every (discipline, phase) that has any catalogue
 * items at all has at least one sub-category to enumerate.
 *
 * A PM-scheduled Inspection (scheduleInspection, above) is unaffected by this and still covers the
 * WHOLE discipline+phase (Inspections.checklistType stays '' for those, same as always) -- only
 * self-claimed rows are now scoped to one specific sub-category (see inspectionScopeItems_ below,
 * which is what actually enforces the narrower scope once claimed). A whole-discipline row (PM-
 * scheduled OR, historically, self-claimed before this change) closes every sub-category slot under
 * it, since it already covers everything a narrower pickup would.
 *
 * This is deliberately a different, looser gate than scheduleInspection's own InspectorAssignments
 * check -- that one requires a PM to have explicitly assigned this specific inspector to this
 * discipline for this event first; self-claiming only requires the inspector's own global Inspector
 * Qualifications profile (Settings > Inspector Qualifications, same one used to populate the "Assign
 * inspector" dropdown) to include this discipline, regardless of whether they were ever added to this
 * event's own Assignments list.
 */
function disciplinePhasesWithChecklistItems_(disciplineName) {
  var phases = {};
  getAll('ChecklistItems').forEach(function (c) {
    if (c.status !== 'Deleted' && c.category === disciplineName && c.phase) phases[c.phase] = true;
  });
  // A discipline with no catalogue items at all yet has nothing to narrow by -- treat both phases as
  // potentially relevant rather than hiding it entirely (same fallback the frontend's own
  // computeInspectionGaps_ already uses for the PM-assignment gaps card).
  return Object.keys(phases).length ? Object.keys(phases) : ['Opening', 'Operational'];
}

// Every distinct checklistType (sub-category) the catalogue actually has for this discipline+phase,
// in no particular guaranteed order beyond "however Object.keys returns them" -- the frontend/caller
// sorts if it cares. Empty array means this exact (discipline, phase) has no catalogue items yet.
function disciplineChecklistTypesForPhase_(disciplineName, phase) {
  var types = {};
  getAll('ChecklistItems').forEach(function (c) {
    if (c.status !== 'Deleted' && c.category === disciplineName && c.phase === phase && c.checklistType) types[c.checklistType] = true;
  });
  return Object.keys(types);
}

// Every open (discipline, phase, checklistType) slot for the event, regardless of viewer -- each
// entry also carries `qualified` for the CALLING user specifically, so the frontend can show every
// open slot as information to a PM/SystemAdmin while only offering the "Pick up" action on the ones
// this particular Inspector is actually qualified for.
function listOpenInspectionSlots(user, p) {
  if (!p || !p.eventId) throw new HululError('BAD_REQUEST', 'eventId is required');
  var identified = findWhere('EventDisciplines', function (ed) { return ed.eventId === p.eventId; });
  // A whole-discipline Inspection (checklistType === '') closes every sub-category under it; a
  // narrower self-claimed one only closes its own exact sub-category.
  var wholeCovered = {}; // 'disciplineId|phase' -> true
  var narrowCovered = {}; // 'disciplineId|phase|checklistType' -> true
  findWhere('Inspections', function (i) { return i.eventId === p.eventId; }).forEach(function (i) {
    if (i.checklistType) narrowCovered[i.disciplineId + '|' + i.phase + '|' + i.checklistType] = true;
    else wholeCovered[i.disciplineId + '|' + i.phase] = true;
  });
  var myQualifications = isParticipantRoleCode_(user.role) ? [] : inspectorQualifications_(user.id);
  var slots = [];
  identified.forEach(function (ed) {
    var discipline = getById('Disciplines', ed.disciplineId);
    if (!discipline) return;
    disciplinePhasesWithChecklistItems_(discipline.name).forEach(function (phase) {
      if (wholeCovered[ed.disciplineId + '|' + phase]) return;
      disciplineChecklistTypesForPhase_(discipline.name, phase).forEach(function (checklistType) {
        if (narrowCovered[ed.disciplineId + '|' + phase + '|' + checklistType]) return;
        slots.push({
          disciplineId: ed.disciplineId, disciplineName: discipline.name, disciplineNameAr: discipline.nameAr || '',
          phase: phase, checklistType: checklistType,
          qualified: myQualifications.indexOf(ed.disciplineId) !== -1
        });
      });
    });
  });
  return slots;
}

// Turns one open (discipline, phase, checklistType) slot into a real Inspections row, owned by the
// calling Inspector and scoped to just that sub-category (see inspectionScopeItems_ below). Re-
// validates everything server-side (never trusts listOpenInspectionSlots' client-visible `qualified`
// flag) -- discipline actually identified for this event, checklistType actually exists for that
// discipline+phase, slot actually still open, and the caller actually qualified -- so a manipulated
// client request can't claim a slot it shouldn't be able to.
function claimOpenInspectionSlot(user, p) {
  requirePermission(user, 'inspection.recordResults'); // same inspector-facing permission recordInspectionResults itself uses
  if (!p || !p.eventId || !p.disciplineId || !p.phase || !p.checklistType) {
    throw new HululError('BAD_REQUEST', 'eventId, disciplineId, phase, and checklistType are required');
  }
  var event = getById('Events', p.eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');
  var isIdentified = findWhere('EventDisciplines', function (ed) { return ed.eventId === p.eventId && ed.disciplineId === p.disciplineId; }).length > 0;
  if (!isIdentified) throw new HululError('BAD_REQUEST', 'This category has not been identified for this event');
  var discipline = getById('Disciplines', p.disciplineId);
  if (!discipline) throw new HululError('NOT_FOUND', 'Category not found');
  if (disciplineChecklistTypesForPhase_(discipline.name, p.phase).indexOf(p.checklistType) === -1) {
    throw new HululError('BAD_REQUEST', 'This checklist sub-category does not exist for this category and phase');
  }
  var covered = findWhere('Inspections', function (i) { return i.eventId === p.eventId && i.disciplineId === p.disciplineId && i.phase === p.phase; })
    .some(function (i) { return !i.checklistType || i.checklistType === p.checklistType; });
  if (covered) throw new HululError('FORBIDDEN', 'Someone has already picked this one up');
  if (inspectorQualifications_(user.id).indexOf(p.disciplineId) === -1) {
    throw new HululError('FORBIDDEN', 'You are not qualified in this category yet -- ask a Project Manager to add it to your Inspector Qualifications.');
  }
  var inspection = {
    id: newId('Inspections'), eventId: p.eventId, disciplineId: p.disciplineId, inspectorId: user.id,
    checklistType: p.checklistType, scheduledAt: nowIso_(), phase: p.phase, status: 'Scheduled', assignedVia: 'self'
  };
  insertRow('Inspections', inspection);
  audit(user.id, 'CLAIM_INSPECTION_SLOT', 'Inspections', inspection.id, { checklistType: p.checklistType });
  return inspection;
}

// The inverse of claimOpenInspectionSlot -- only the Inspector who picked it up can cancel it, and
// only while it's exactly as they left it (still 'Scheduled', nothing recorded yet), same safety gate
// deleteInspection already enforces. assignedVia === 'self' is the deciding line between this and
// deleteInspection: a PM's own manually-scheduled visit is never cancellable through this endpoint,
// no matter who it's assigned to -- only a PM/SystemAdmin can remove that one (deleteInspection).
function cancelSelfAssignedInspection(user, p) {
  if (!p || !p.inspectionId) throw new HululError('BAD_REQUEST', 'inspectionId is required');
  var inspection = getById('Inspections', p.inspectionId);
  if (!inspection) throw new HululError('NOT_FOUND', 'Inspection not found');
  if (inspection.assignedVia !== 'self' || inspection.inspectorId !== user.id) {
    throw new HululError('FORBIDDEN', 'You can only cancel a checklist you picked up yourself');
  }
  if (inspection.status !== 'Scheduled') {
    throw new HululError('FORBIDDEN', 'This checklist already has results recorded against it and can no longer be cancelled.');
  }
  var hasResults = findWhere('InspectionResults', function (r) { return r.inspectionId === p.inspectionId; }).length > 0;
  if (hasResults) throw new HululError('FORBIDDEN', 'This checklist already has results recorded against it and can no longer be cancelled.');
  deleteRow('Inspections', p.inspectionId);
  audit(user.id, 'CANCEL_SELF_ASSIGNED_INSPECTION', 'Inspections', p.inspectionId, {});
  return { ok: true };
}

// The set of catalogue Checklist items that fall under an inspection's discipline + phase — this
// is the full scope of what an inspector *may* record against that inspection, regardless of what
// was recorded so far. REQ correction ("inspectors can now pick up one open checklist sub-category"):
// a self-claimed pickup (Inspections.checklistType non-blank -- see claimOpenInspectionSlot above)
// narrows this further to just that one sub-category; a PM-scheduled inspection (checklistType '')
// keeps covering every sub-category under the discipline+phase, unchanged from before this feature.
function inspectionScopeItems_(inspection) {
  var discipline = getById('Disciplines', inspection.disciplineId);
  var disciplineName = discipline ? discipline.name : '';
  var items = getAll('ChecklistItems').filter(function (c) { return c.status !== 'Deleted' && c.category === disciplineName && c.phase === inspection.phase; });
  if (inspection.checklistType) items = items.filter(function (c) { return c.checklistType === inspection.checklistType; });
  return items;
}

// Participants are scoped to a Venue, not an Event (see Participants.gs) -- every lookup of "which
// participants matter for this inspection" has to first resolve the inspection's Event to that
// Event's venueId. Returns '' if the event (or its venue) can't be found, in which case the
// relevant-participant filters below correctly resolve to nothing rather than throwing.
function inspectionVenueId_(inspection) {
  var event = getById('Events', inspection.eventId);
  return event ? (event.venueId || '') : '';
}

// Participants relevant to one Event at one Venue: every permanent (venue-wide, eventId blank)
// Participant at that venue, PLUS this Event's own temporary ones (eventId === eventId) -- but NOT
// another Event's temporary Participants at the same venue, even though they share a venueId. See
// the Participants.eventId SCHEMA comment (Utils.gs) and Places.gs's Event Places.
function venueParticipantsForEvent_(venueId, eventId) {
  if (!venueId) return [];
  return findWhere('Participants', function (pt) {
    return pt.venueId === venueId && (!pt.eventId || pt.eventId === eventId);
  });
}

// The zone(s) this inspection's inspector is assigned to cover for this discipline (from the
// InspectorAssignment created in Disciplines & Inspectors) -- empty means "whole venue."
function inspectorZoneIdsForInspection_(inspection) {
  var assignment = findWhere('InspectorAssignments', function (a) {
    return a.eventId === inspection.eventId && a.disciplineId === inspection.disciplineId && a.inspectorId === inspection.inspectorId;
  })[0];
  return assignment && assignment.zoneIds ? String(assignment.zoneIds).split(',').filter(Boolean) : [];
}

// REQ: "Inspector must complete one checklist for every participant under his zone." A participant
// is relevant to an inspection when its disciplineIds (set by the PM, see
// bulkAssignParticipantDisciplines in Participants.gs) include this inspection's discipline, AND
// either it has no zone / an explicit 'ALL' on record ("usually operators operate in all zones" --
// treated as applying to every zone, see zoneFieldIds_ in Utils.gs) or at least one of its zones
// (Operators can have several, comma-joined) is one the inspector is assigned to -- or the
// inspector's assignment itself has no zone restriction, i.e. covers the whole venue.
function participantRelevantToInspection_(participant, inspection, inspectorZoneIds) {
  var disciplineIds = participant.disciplineIds ? String(participant.disciplineIds).split(',').filter(Boolean) : [];
  if (disciplineIds.indexOf(inspection.disciplineId) === -1) return false;
  var participantZoneIds = zoneFieldIds_(participant.zoneId);
  if (!participantZoneIds.length) return true; // blank or 'ALL' -- every zone
  if (!inspectorZoneIds.length) return true;
  return participantZoneIds.some(function (zid) { return inspectorZoneIds.indexOf(zid) !== -1; });
}

// Coverage = which of the in-scope checklist items already have a recorded result for this
// inspection *for one specific vendor*. A vendor only counts as done once every in-scope item has
// been recorded at least once for them -- checked across every one of their accounts (see
// participantAccountIds_ in Participants.gs), not just the exact participantId passed in, so a
// result recorded under one shift account still counts if the other shift (or the merged view) is
// checked later, and results from before the multi-account merge fix still count too.
function inspectionParticipantCoverage_(inspection, participantId) {
  var scope = inspectionScopeItems_(inspection);
  var accountIds = participantAccountIds_(participantId);
  var recorded = findWhere('InspectionResults', function (r) { return r.inspectionId === inspection.id && accountIds.indexOf(r.participantId) !== -1; });
  var doneIds = {};
  recorded.forEach(function (r) { doneIds[r.checklistItemId] = true; });
  var openItems = scope.filter(function (c) { return !doneIds[c.id]; });
  return { total: scope.length, done: scope.length - openItems.length, openItems: openItems };
}

// Coverage for an "Opening" phase inspection -- REQ: "Opening checklists are done against the venue
// not participants." No per-participant loop at all here: every in-scope item just needs ONE
// recorded result (any participantId, including blank), same as any ordinary single-pass checklist.
// Mirrors inspectionParticipantCoverage_'s shape ({ total, done, openItems }) so inspectionCoverage_
// below can treat both phases through one return shape.
function inspectionVenueCoverage_(inspection) {
  var scope = inspectionScopeItems_(inspection);
  var recorded = findWhere('InspectionResults', function (r) { return r.inspectionId === inspection.id; });
  var doneIds = {};
  recorded.forEach(function (r) { doneIds[r.checklistItemId] = true; });
  var openItems = scope.filter(function (c) { return !doneIds[c.id]; });
  return { total: scope.length, done: scope.length - openItems.length, openItems: openItems };
}

// Overall inspection completion. REQ follow-up: "Opening checklists are done against the venue not
// participants, but they can assign operational participants to resolve the raised log." Two
// different completion models depending on phase:
//  - Opening: one pass over the venue as a whole (inspectionVenueCoverage_ above) -- no participant
//    dimension. total/done here are just 0/1 (not-yet-done/done); mode:'venue' tells the frontend to
//    render "X of Y items" instead of "X of Y participants" for the progress column, and `items`
//    carries the real item-level total/done for that.
//  - Operational (and anything else): unchanged -- every *relevant* participant (matching
//    discipline + zone, see participantRelevantToInspection_) needs its own fully-recorded checklist,
//    per REQ: "Any Checklist type that has not been done will remain open ... anytime on or after
//    scheduled date," applied per participant rather than just per checklist item. mode:'participant'.
function inspectionCoverage_(inspection) {
  if (inspection.phase === 'Opening') {
    var vc = inspectionVenueCoverage_(inspection);
    var vDone = vc.total > 0 && vc.openItems.length === 0;
    return { total: vc.total > 0 ? 1 : 0, done: vDone ? 1 : 0, perParticipant: [], mode: 'venue', items: vc };
  }
  var inspectorZoneIds = inspectorZoneIdsForInspection_(inspection);
  var venueId = inspectionVenueId_(inspection);
  var venueParticipants = venueParticipantsForEvent_(venueId, inspection.eventId);
  // Merged so a vendor with two shift accounts counts once toward "how many participants need a
  // checklist," not twice (see mergeParticipantsByLocation_ in Participants.gs).
  var relevant = mergeParticipantsByLocation_(venueParticipants)
    .filter(function (pt) { return participantRelevantToInspection_(pt, inspection, inspectorZoneIds); });
  var perParticipant = relevant.map(function (pt) {
    var c = inspectionParticipantCoverage_(inspection, pt.id);
    return { participantId: pt.id, participantName: pt.name, participantNameAr: pt.nameAr || '', total: c.total, done: c.done, completed: c.total > 0 && c.openItems.length === 0 };
  });
  var done = perParticipant.filter(function (x) { return x.completed; }).length;
  return { total: perParticipant.length, done: done, perParticipant: perParticipant, mode: 'participant' };
}

// Every participant on the event, each flagged whether they're relevant to this inspection (see
// participantRelevantToInspection_) plus their own checklist progress -- the live-inspection map
// plots everyone, but only highlights (and requires a checklist for) the relevant ones.
function listInspectionParticipants(user, p) {
  var inspection = getById('Inspections', p.inspectionId);
  if (!inspection) throw new HululError('NOT_FOUND', 'Inspection not found');
  var inspectorZoneIds = inspectorZoneIdsForInspection_(inspection);
  var venueId = inspectionVenueId_(inspection);
  var venueParticipants = venueParticipantsForEvent_(venueId, inspection.eventId);
  // Merged so a vendor with two shift accounts (see addPlaceAccount in Places.gs) shows up once in
  // the live inspection's choose-participant list/map, not once per account -- see
  // mergeParticipantsByLocation_ in Participants.gs.
  // REQ: "Across all maps any participant with a logged risk turns red dot with a number above the
  // dot." findingsOpenCountByParticipant_ lives in Participants.gs.
  var countById = findingsOpenCountByParticipant_();
  return mergeParticipantsByLocation_(venueParticipants).map(function (pt) {
    var isRelevant = participantRelevantToInspection_(pt, inspection, inspectorZoneIds);
    var c = isRelevant ? inspectionParticipantCoverage_(inspection, pt.id) : { total: 0, done: 0, openItems: [] };
    return Object.assign({}, pt, {
      isRelevant: isRelevant, checklistTotal: c.total, checklistDone: c.done,
      checklistCompleted: isRelevant && c.total > 0 && c.openItems.length === 0,
      openFindingsCount: countById[pt.id] || 0
    });
  });
}

// REQ: "Inspectors live location as they start inspections. This applies to all maps." Called from
// the inspector's own device roughly every 20s while their live-tracking view is open
// (startLiveInspectionTracking_, eventDetail.js) -- deliberately NOT on every single GPS tick
// (watchPosition can fire much more often than that) to keep write volume against the Sheets-backed
// store reasonable. Only the assigned inspector may ping their own inspection. No audit() entry --
// this is a high-frequency telemetry ping, not a user action worth an audit trail row (every other
// mutation in this file does audit()).
function pingInspectionLocation(user, p) {
  var inspection = getById('Inspections', p.inspectionId);
  if (!inspection) throw new HululError('NOT_FOUND', 'Inspection not found');
  if (inspection.inspectorId !== user.id) throw new HululError('FORBIDDEN', 'Not your inspection');
  if (p.lat === undefined || p.lat === '' || p.lat === null || p.lng === undefined || p.lng === '' || p.lng === null) {
    throw new HululError('BAD_REQUEST', 'lat/lng are required');
  }
  updateRow('Inspections', p.inspectionId, { lastLat: p.lat, lastLng: p.lng, lastSeenAt: nowIso_() });
  return { ok: true };
}

// "Currently live" freshness window -- an inspector who closed the tracking page or lost connectivity
// stops pinging, and their dot should disappear from other users' maps again rather than sit stale
// forever. 2 minutes comfortably survives the odd missed ping (watchPosition/network hiccups)
// without leaving a long-gone inspector's dot on screen.
var INSPECTOR_LIVE_LOCATION_FRESHNESS_MS_ = 2 * 60 * 1000;

// Returns every inspector currently pinging a fresh location against an Inspection at the given
// venue (p.venueId) or event (p.eventId) -- exactly one of the two is expected; venue-level callers
// (venueMap/placeMap, which aren't scoped to one Event) pass venueId and get every one of that
// venue's Events' live inspectors, event-level callers (zoneMap/eventPlaceMap/eventPlacesMap) pass
// eventId directly. REQ: "Only within venue's boundary" -- a ping that's fallen outside the venue's
// own drawn boundary (pointInPolygon_, same containment test createPlace uses) is dropped rather than
// shown, e.g. GPS drift right at the edge or an inspector who's stepped off-site; venues with no
// boundary drawn yet are unrestricted, same fallback used everywhere else a venue boundary is checked.
// Open to any authenticated user, same as listPlaces/listVenues -- which maps a user can even reach
// already gates who sees this.
function listActiveInspectorLocations(user, p) {
  var cutoff = Date.now() - INSPECTOR_LIVE_LOCATION_FRESHNESS_MS_;
  var events;
  if (p.eventId) {
    var singleEvent = getById('Events', p.eventId);
    events = singleEvent ? [singleEvent] : [];
  } else if (p.venueId) {
    events = findWhere('Events', function (e) { return e.venueId === p.venueId; });
  } else {
    throw new HululError('BAD_REQUEST', 'venueId or eventId is required');
  }
  if (!events.length) return [];
  var eventsById = {};
  var venueBoundaryByVenueId = {};
  events.forEach(function (e) {
    eventsById[e.id] = e;
    if (e.venueId && venueBoundaryByVenueId[e.venueId] === undefined) {
      var venue = getById('Venues', e.venueId);
      venueBoundaryByVenueId[e.venueId] = venue ? parseBoundary_(venue.boundary) : null;
    }
  });
  var eventIds = events.map(function (e) { return e.id; });
  var usersById = {};
  getAll('Users').forEach(function (u) { usersById[u.id] = u; });

  return getAll('Inspections').filter(function (insp) {
    if (eventIds.indexOf(insp.eventId) === -1) return false;
    if (!insp.lastSeenAt || insp.lastLat === '' || insp.lastLat == null || insp.lastLng === '' || insp.lastLng == null) return false;
    if (new Date(insp.lastSeenAt).getTime() < cutoff) return false;
    var event = eventsById[insp.eventId];
    var boundary = event ? venueBoundaryByVenueId[event.venueId] : null;
    if (boundary && !pointInPolygon_(Number(insp.lastLat), Number(insp.lastLng), boundary)) return false;
    return true;
  }).map(function (insp) {
    var inspector = usersById[insp.inspectorId];
    var event = eventsById[insp.eventId];
    return {
      inspectionId: insp.id, inspectorId: insp.inspectorId, inspectorName: inspector ? inspector.name : 'Inspector',
      lat: insp.lastLat, lng: insp.lastLng, lastSeenAt: insp.lastSeenAt,
      eventId: insp.eventId, eventName: event ? event.name : ''
    };
  });
}

// REQ-INS-07: Inspector views their assigned schedule.
function listInspections(user, p) {
  var all = getAll('Inspections');
  if (p && p.eventId) all = all.filter(function (i) { return i.eventId === p.eventId; });
  if (user.role === ROLES.INSPECTOR) all = all.filter(function (i) { return i.inspectorId === user.id; });
  if (p && p.status) all = all.filter(function (i) { return i.status === p.status; });
  return all.sort(function (a, b) { return new Date(a.scheduledAt) - new Date(b.scheduledAt); })
    .map(function (i) {
      var discipline = getById('Disciplines', i.disciplineId);
      var inspector = getById('Users', i.inspectorId);
      var coverage = inspectionCoverage_(i);
      return Object.assign({}, i, {
        disciplineName: discipline ? discipline.name : i.disciplineId,
        disciplineNameAr: discipline ? discipline.nameAr || '' : '',
        inspectorName: inspector ? inspector.name : i.inspectorId,
        // total/done count *relevant participants* completed for an Operational-phase inspection, or
        // just 0/1 (not-yet-done/done) for an Opening-phase one -- see inspectionCoverage_. `mode`
        // and `items` (Opening only, real item-level total/done) let the frontend render the right
        // label either way ("X of Y participants" vs "X of Y items").
        coverage: { total: coverage.total, done: coverage.done, mode: coverage.mode, items: coverage.items }
      });
    });
}

// REQ: "Develop a completed checklists page under Inspections tab." Once every relevant participant
// on an Inspection is done, that Inspection's own "Record results" action disappears from the
// Inspections list (tabInspections, eventDetail.js -- r.status !== 'Completed' gate), so there was no
// way back into a checklist that had already been finished. One row per (Inspection, participant)
// pair across the WHOLE event whose OWN checklist is fully recorded. lastRecordedAt is the most
// recent InspectionResults.recordedAt among that pair's own rows -- results trickle in one item at a
// time, so there's no single "completedAt" field to read off any one row; the latest one is the
// effective "done on" date. Same Inspector-only-sees-their-own filtering as listInspections, via
// that function.
//
// BUG (REQ report): "Completed checklist tab not working... McDonald's completed checklist but not
// appearing there." This used to reuse inspectionCoverage_'s own perParticipant, which only ever
// considers participants *relevant* to the inspection (matching discipline + the inspector's assigned
// zone(s), see participantRelevantToInspection_) -- but recordInspectionResults deliberately allows
// recording against ANY participant on the event, not just relevant ones ("the inspector can still
// log something unexpected found on site," see its own comment above). A fully-recorded checklist for
// a participant outside that formal relevance scope (e.g. never explicitly assigned this discipline)
// silently never showed up here -- exactly the "completed checklists disappear" bug this page exists
// to fix, and a direct contradiction of its own subtitle ("Every checklist that has been fully
// recorded across this event," eventDetail.js's tabCompletedChecklists). Fixed by looping every venue
// participant (merged to one row per physical spot, same as inspectionCoverage_) with NO relevance
// filter, so anyone who actually has a fully-recorded checklist for this inspection shows up
// regardless of whether the PM ever formally assigned them this discipline/zone.
// REQ follow-up: "Not all sub-categories are applicable; so when Sub-Category of a checklist is
// completed then it must appear in the Completed Checklist tab." Coverage used to be computed across
// an inspection's WHOLE scope (every Checklist Type/sub-category combined) -- a participant that only
// ever needed, say, "Restaurants" would never show up here at all as long as "Food Truck"/"Retail"
// (not applicable to them, never touched) stayed open. Now computed per (participant, checklistType):
// a participant can appear more than once, once per sub-category that's been fully recorded, entirely
// independent of whether any other sub-category under the same inspection is done or even started.
function listCompletedChecklists(user, p) {
  if (!p || !p.eventId) throw new HululError('BAD_REQUEST', 'eventId is required');
  var inspections = listInspections(user, { eventId: p.eventId });
  var out = [];
  inspections.forEach(function (insp) {
    var venueId = inspectionVenueId_(insp);
    var merged = mergeParticipantsByLocation_(venueParticipantsForEvent_(venueId, insp.eventId));
    var byType = {};
    inspectionScopeItems_(insp).forEach(function (c) { (byType[c.checklistType] = byType[c.checklistType] || []).push(c); });
    merged.forEach(function (pt) {
      var accountIds = participantAccountIds_(pt.id);
      var recordedByItemId = {};
      findWhere('InspectionResults', function (r) { return r.inspectionId === insp.id && accountIds.indexOf(r.participantId) !== -1; })
        .forEach(function (r) { recordedByItemId[r.checklistItemId] = r; });
      Object.keys(byType).forEach(function (checklistType) {
        var items = byType[checklistType];
        var openItems = items.filter(function (c) { return !recordedByItemId[c.id]; });
        if (!items.length || openItems.length) return; // this sub-category isn't fully recorded (or doesn't apply) yet
        var lastRecordedAt = items.reduce(function (max, c) {
          var r = recordedByItemId[c.id];
          return (!max || new Date(r.recordedAt) > new Date(max)) ? r.recordedAt : max;
        }, '');
        out.push({
          inspectionId: insp.id, disciplineName: insp.disciplineName, disciplineNameAr: insp.disciplineNameAr || '',
          phase: insp.phase, checklistType: checklistType, checklistTypeAr: items[0] ? (items[0].checklistTypeAr || '') : '',
          inspectorId: insp.inspectorId, inspectorName: insp.inspectorName,
          participantId: pt.id, participantName: pt.name, participantNameAr: pt.nameAr || '',
          done: items.length, total: items.length, lastRecordedAt: lastRecordedAt
        });
      });
    });
  });
  return out.sort(function (a, b) { return new Date(b.lastRecordedAt) - new Date(a.lastRecordedAt); });
}

// REQ follow-up: "Completed Checklists can be viewed as a full page filterable list." The per-event
// listCompletedChecklists above, but rolled up across every event the caller can see (listEvents
// already scopes that per role/org) -- same dashboardSummary/generateReport pattern this app already
// uses for other cross-event rollups (Reports.gs). Each row carries its own eventId/eventName so the
// standalone page (completedChecklists.js) can show/filter/link back to the event it belongs to.
function listAllCompletedChecklists(user, p) {
  requirePermission(user, 'completedChecklist.view');
  var events = listEvents(user, p || {});
  var out = [];
  events.forEach(function (e) {
    listCompletedChecklists(user, { eventId: e.id }).forEach(function (row) {
      out.push(Object.assign({}, row, { eventId: e.id, eventName: e.name }));
    });
  });
  return out.sort(function (a, b) { return new Date(b.lastRecordedAt) - new Date(a.lastRecordedAt); });
}

// Already-recorded items for one inspection — lets the Record Results UI show what's left open.
// participantId narrows to just what's been recorded for one participant so far (the modal opens
// scoped to a single participant now — see recordInspectionResults).
function listInspectionResults(user, p) {
  if (!p || !p.inspectionId) throw new HululError('BAD_REQUEST', 'inspectionId is required');
  var all = findWhere('InspectionResults', function (r) { return r.inspectionId === p.inspectionId; });
  if (p.participantId) {
    // Every account at this vendor's spot, not just the exact id passed in -- see
    // participantAccountIds_ in Participants.gs -- so a result recorded under a different shift
    // account (or from before the multi-account merge fix) still shows as already done.
    var accountIds = participantAccountIds_(p.participantId);
    all = all.filter(function (r) { return accountIds.indexOf(r.participantId) !== -1; });
  }
  return all;
}

// REQ-INS-04/05/06: each item is Ticked/Crossed/N/A; carries default risk+window; Inspector may override.
// Crossed items REQUIRE a Risk Logging (Finding) with at least one photo/video piece of evidence —
// enforced here as well as client-side, since evidenceUrls arrives from the client.
function recordInspectionResults(user, p) {
  requirePermission(user, 'inspection.recordResults'); // RBAC pilot -- same default roles as before, no behavior change
  var inspection = getById('Inspections', p.inspectionId);
  if (!inspection) throw new HululError('NOT_FOUND', 'Inspection not found');
  if (user.role === ROLES.INSPECTOR && inspection.inspectorId !== user.id) {
    throw new HululError('FORBIDDEN', 'Not your assigned inspection');
  }
  if (new Date(inspection.scheduledAt) > new Date()) {
    throw new HululError('BAD_REQUEST', 'This inspection is scheduled for a future date/time and cannot be recorded yet.');
  }
  // REQ ("Opening checklists are done against the venue not participants, but they can assign
  // operational participants to resolve the raised log"): an Opening-phase checklist is filled out
  // once for the whole venue -- no participant chooser screen precedes it anymore (see tabInspections'
  // data-record button), so p.participantId is simply absent here, and that's fine. Every other phase
  // (Operational) keeps the original "a checklist is completed *for a participant*" requirement
  // unchanged -- the inspector must choose one before recording anything (see the choose-participant
  // screen in tabInspections). Any participant on the event is accepted regardless of discipline/zone
  // relevance -- the frontend's guided flow is what steers an inspector to the relevant list -- EXCEPT
  // for zone: REQ follow-up ("PM can assign an inspector to only work on Zone x which will force all
  // checklists and logs to only be done in that zone") turns that into a hard block below, once the
  // inspector's own assignment is actually zone-restricted.
  var isOpeningPhase = inspection.phase === 'Opening';
  var venueId = inspectionVenueId_(inspection);
  if (!isOpeningPhase) {
    if (!p.participantId) throw new HululError('BAD_REQUEST', 'participantId is required — choose which participant this checklist is for.');
    var participant = getById('Participants', p.participantId);
    if (!participant || !venueId || participant.venueId !== venueId) throw new HululError('BAD_REQUEST', 'participantId must belong to this event\'s venue');
    // REQ follow-up: "PM can assign an inspector to only work on Zone x which will force all
    // checklists and logs to only be done in that zone." Was previously only a SOFT filter (this
    // participant just wouldn't count toward "how many are relevant/completed," see
    // inspectionCoverage_/participantRelevantToInspection_ below) -- now a hard block, same rule,
    // reused via assertParticipantZoneAllowed_ (Disciplines.gs). Only applies when the inspector is
    // recording their own checklist (not a PM/Admin recording on their behalf), same scoping as the
    // equivalent check in createFinding (Findings.gs).
    if (user.role === ROLES.INSPECTOR) {
      assertParticipantZoneAllowed_(inspection.inspectorId, inspection.eventId, inspection.disciplineId, participant);
    }
  }
  // REQ: "Logs can not be created ... if event ended or Venue Rejected." A Crossed item auto-creates
  // a Finding below (assertEventAcceptsNewLogs_, Findings.gs, same rule createFinding enforces for a
  // manual Log) -- checked once, up front, before anything is written, rather than per-row mid-loop:
  // failing partway through would leave some InspectionResults rows saved and others not, and a
  // Crossed item with no Finding behind it is broken data (its evidenceUrls requirement exists
  // specifically because a Finding is supposed to carry it forward). Ticked/N/A-only submissions
  // never create a Finding, so they're unaffected even for an event that's since ended.
  if ((p.results || []).some(function (r) { return r.state === 'Crossed'; })) {
    assertEventAcceptsNewLogs_(inspection.eventId);
  }

  var createdFindings = [];
  (p.results || []).forEach(function (r) {
    if (['Ticked', 'Crossed', 'N/A'].indexOf(r.state) === -1) {
      throw new HululError('BAD_REQUEST', 'state must be Ticked, Crossed, or N/A');
    }
    if (r.state === 'Crossed' && (!r.evidenceUrls || !r.evidenceUrls.length)) {
      throw new HululError('BAD_REQUEST', 'A Risk Logging with at least one photo or video is required for items marked Crossed.');
    }
    var item = getById('ChecklistItems', r.checklistItemId);
    var riskLevel = r.riskLevel || (item ? item.defaultRisk : 'Medium');
    var windowHours = r.resolutionWindowHours || (item ? item.defaultWindowHours : 24);

    var inspectionResultId = newId('InspectionResults');
    insertRow('InspectionResults', {
      id: inspectionResultId, inspectionId: p.inspectionId, checklistItemId: r.checklistItemId,
      state: r.state, riskLevel: riskLevel, resolutionWindowHours: windowHours, notes: r.notes || '',
      evidenceUrls: (r.evidenceUrls || []).join(','), recordedAt: nowIso_(), participantId: p.participantId || '',
      findingId: ''
    });

    if (r.state === 'Crossed') {
      var resolutionWindowAt = new Date(Date.now() + Number(windowHours) * 3600 * 1000).toISOString();
      var finding = {
        id: newId('Findings'), eventId: inspection.eventId, inspectionId: p.inspectionId, disciplineId: inspection.disciplineId,
        category: item ? item.checklistType : '', subCategory: item ? item.category : '', description: r.notes || (item ? item.description : ''),
        // REQ ("...they can assign operational participants to resolve the raised log"): on an
        // Opening-phase checklist there's no participant to inherit here -- p.participantId is blank
        // (see isOpeningPhase above) -- so the Finding starts with no participant at all. That's
        // expected, not a bug: assignFindingParticipant (Findings.gs) is how a PM/Inspector picks the
        // Operator responsible for resolving it afterward, from the Log's own detail page. The `|| ''`
        // guard (was just `r.participantId || p.participantId`) avoids ever writing the literal string
        // "undefined" into the sheet now that p.participantId can genuinely be absent.
        suggestedAction: r.suggestedAction || '', riskLevel: riskLevel, resolutionWindowAt: resolutionWindowAt,
        nextInspectionAt: r.nextInspectionAt || '', participantId: r.participantId || p.participantId || '', subZone: r.subZone || '',
        location: r.location || '', status: 'Open', evidenceUrls: (r.evidenceUrls || []).join(','),
        lat: r.lat || '', lng: r.lng || '', createdBy: user.id, createdAt: nowIso_(), reopenCount: 0,
        // REQ: "Any log created through a checklist must be traceable to that specific item in the
        // checklist." r.checklistItemId is always present here (validated above via getById lookup).
        checklistItemId: r.checklistItemId || '', recreatedFromId: ''
      };
      insertRow('Findings', finding);
      // REQ follow-up: "are logs traceable back to that checklist item?" -- the reverse direction:
      // the InspectionResults row that produced this Finding now points back at it too, so the
      // Completed Checklists detail view (eventDetail.js) can link straight through to it.
      updateRow('InspectionResults', inspectionResultId, { findingId: finding.id });
      // Tier 1 escalation target is set at creation time so escalation checks can find it later.
      createdFindings.push(finding);
      notifyFindingCreated_(finding);
    }
  });

  // Completed only once every relevant participant (not just this one) has a full checklist on
  // record -- see inspectionCoverage_. If there happen to be zero relevant participants on record
  // yet, don't jump straight to "Completed" off of nothing.
  var coverage = inspectionCoverage_(inspection);
  var status = coverage.total > 0 && coverage.done === coverage.total ? 'Completed' : 'InProgress';
  updateRow('Inspections', p.inspectionId, { status: status });
  audit(user.id, 'RECORD_INSPECTION', 'Inspections', p.inspectionId, { findingsCreated: createdFindings.length });
  return { inspection: getById('Inspections', p.inspectionId), findingsCreated: createdFindings };
}

// REQ: "Completed checklists should be accessible and can be printed and exported with updated
// results." recordInspectionResults only ever inserted -- there was no way to correct an already-
// recorded item. This edits one InspectionResults row in place. Deliberately does NOT touch any
// Finding that may have been auto-created when the item was first marked Crossed (see
// recordInspectionResults above) -- that Finding is already a separate record governed by its own
// Risk Logging workflow (Findings tab, its own edit/resolve/reject actions); silently
// creating/deleting/mutating it from here risks contradicting something a reviewer already acted on.
// An inspector who needs that reflected too still has to update the Finding itself, same as any other
// correction to a finding today.
function updateInspectionResult(user, p) {
  requirePermission(user, 'inspection.recordResults'); // RBAC pilot -- same permission as recording one in the first place
  if (!p || !p.resultId) throw new HululError('BAD_REQUEST', 'resultId is required');
  var existing = getById('InspectionResults', p.resultId);
  if (!existing) throw new HululError('NOT_FOUND', 'Result not found');
  var inspection = getById('Inspections', existing.inspectionId);
  if (inspection && user.role === ROLES.INSPECTOR && inspection.inspectorId !== user.id) {
    throw new HululError('FORBIDDEN', 'Not your assigned inspection');
  }
  if (['Ticked', 'Crossed', 'N/A'].indexOf(p.state) === -1) {
    throw new HululError('BAD_REQUEST', 'state must be Ticked, Crossed, or N/A');
  }
  if (p.state === 'Crossed' && (!p.evidenceUrls || !p.evidenceUrls.length)) {
    throw new HululError('BAD_REQUEST', 'A Risk Logging with at least one photo or video is required for items marked Crossed.');
  }
  var item = getById('ChecklistItems', existing.checklistItemId);
  var riskLevel = p.riskLevel || existing.riskLevel || (item ? item.defaultRisk : 'Medium');
  var windowHours = p.resolutionWindowHours || existing.resolutionWindowHours || (item ? item.defaultWindowHours : 24);
  var updated = updateRow('InspectionResults', p.resultId, {
    state: p.state, riskLevel: riskLevel, resolutionWindowHours: windowHours,
    notes: p.notes || '', evidenceUrls: (p.evidenceUrls || []).join(',')
  });
  audit(user.id, 'UPDATE_INSPECTION_RESULT', 'InspectionResults', p.resultId, { state: p.state });
  return updated;
}

// Photo/video evidence for Risk Logging — uploaded to Drive, mirrors Templates.gs's uploadTemplate
// pattern (reuses its getOrCreateFolder_ helper). Returns a URL usable in Findings/InspectionResults
// evidenceUrls. p.fileBase64 + p.fileName + p.mimeType come from the frontend's file input;
// p.eventId is used only to group evidence into a per-event Drive folder.
function uploadEvidence(user, p) {
  // Originally Inspector-only (Risk Logging evidence at finding-creation time). Findings.gs's
  // resolveFinding now also requires a camera photo/video from the Participant (Vendor/Operator/
  // Exhibitor) when submitting a resolution -- same generic evidence-upload endpoint, so it needs
  // to accept those roles too.
  requirePermission(user, 'evidence.upload'); // RBAC pilot -- same default roles as before, no behavior change
  if (!p.fileBase64) throw new HululError('BAD_REQUEST', 'fileBase64 is required');
  var folder = getOrCreateFolder_('HULUL Evidence - ' + (p.eventId || 'General'));
  var blob = Utilities.newBlob(Utilities.base64Decode(p.fileBase64), p.mimeType || 'application/octet-stream', p.fileName || 'evidence');
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  audit(user.id, 'UPLOAD_EVIDENCE', 'Findings', '', { fileName: p.fileName || file.getName() });
  return { url: file.getUrl(), fileId: file.getId(), fileName: p.fileName || file.getName(), mimeType: p.mimeType || '' };
}
