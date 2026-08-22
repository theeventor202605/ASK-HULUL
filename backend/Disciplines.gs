/**
 * HULUL - Disciplines.gs  (REQ-DIS-01..05)
 * Compliance disciplines, inspector qualification profiles, discipline-qualified inspector assignment.
 */

function listDisciplines() {
  // Lazy self-heal, same "fix on next read" pattern as processTemplateDeadlineTransition_ (Templates.gs):
  // Disciplines rows added by copying a Sheet row instead of using "+ New discipline" keep the copy's
  // id, which corrupts every id-keyed lookup (including the New Log form's Category -> Sub-Category
  // cascade) until fixed. Rather than rely on someone remembering to re-run fixDuplicateDisciplineIds()
  // from the Apps Script editor, check for and correct duplicates on every read.
  dedupeDisciplineIds_();
  return getAll('Disciplines');
}

// Admin-maintained reference data: compliance disciplines catalogue (Setup.gs seeds the defaults).
// REQ: "Code can not be less or more than 3 characters." + "Add new column name it 'Cat Ref.' This
// holds reference number for this specific category but should be displayed in Roman values."
function createDiscipline(user, p) {
  requirePermission(user, 'discipline.manage'); // RBAC pilot -- same default roles as before, no behavior change
  if (!p.name || !p.code) throw new HululError('BAD_REQUEST', 'name and code are required');
  var code = String(p.code).trim();
  if (code.length !== 3) throw new HululError('BAD_REQUEST', 'Code must be exactly 3 characters.');
  var catRef = Number(p.catRef);
  if (p.catRef === undefined || p.catRef === null || p.catRef === '' || !Number.isInteger(catRef) || catRef < 1) {
    throw new HululError('BAD_REQUEST', 'Cat Ref. is required and must be a whole number of 1 or more.');
  }
  var row = { id: newId('Disciplines'), name: p.name, code: code, catRef: catRef, nameAr: p.nameAr || '' };
  insertRow('Disciplines', row);
  audit(user.id, 'CREATE_DISCIPLINE', 'Disciplines', row.id, {});
  return row;
}

// REQ follow-up: "In Categories page allow editing." Same validation as createDiscipline (code
// exactly 3 chars, Cat Ref. a whole number of 1 or more) -- editing doesn't relax anything create
// enforced, just lets an admin fix a typo/renumber without deleting and recreating the row.
//
// BUG FIX (REQ follow-up: "Transport & Traffic is showing as Traffic & Transport in the Checklist
// page! ... The Category in the Checklist page should all be coming from the Categories page!"):
// ChecklistItems.category and FindingGuide.category both store the Discipline's NAME as a plain
// string snapshot, not a live disciplineId foreign key (see checklistItems.js/FindingGuide.gs header
// comments) -- and inspectionScopeItems_ (Inspections.gs) matches on that string too, so it isn't
// just cosmetic: a rename that doesn't cascade silently drops every already-created checklist item
// under the old name out of every future inspection's scope. Renaming here now updates every
// ChecklistItems/FindingGuide row still carrying the old name to the new one in the same call, so
// both catalogues stay in sync with whatever the Categories page says, same as the fresh-creation
// path already keeps them in sync going forward.
function updateDiscipline(user, p) {
  requirePermission(user, 'discipline.manage');
  if (!p || !p.disciplineId) throw new HululError('BAD_REQUEST', 'disciplineId is required');
  var existing = getById('Disciplines', p.disciplineId);
  if (!existing) throw new HululError('NOT_FOUND', 'Category not found');
  if (!p.name || !p.code) throw new HululError('BAD_REQUEST', 'name and code are required');
  var code = String(p.code).trim();
  if (code.length !== 3) throw new HululError('BAD_REQUEST', 'Code must be exactly 3 characters.');
  var catRef = Number(p.catRef);
  if (p.catRef === undefined || p.catRef === null || p.catRef === '' || !Number.isInteger(catRef) || catRef < 1) {
    throw new HululError('BAD_REQUEST', 'Cat Ref. is required and must be a whole number of 1 or more.');
  }
  var oldName = existing.name;
  var updated = updateRow('Disciplines', p.disciplineId, { name: p.name, code: code, catRef: catRef, nameAr: p.nameAr !== undefined ? p.nameAr : existing.nameAr });
  var renamedCount = 0;
  if (oldName && oldName !== p.name) {
    findWhere('ChecklistItems', function (c) { return c.category === oldName; })
      .forEach(function (c) { updateRow('ChecklistItems', c.id, { category: p.name }); renamedCount++; });
    findWhere('FindingGuide', function (g) { return g.category === oldName; })
      .forEach(function (g) { updateRow('FindingGuide', g.id, { category: p.name }); renamedCount++; });
  }
  audit(user.id, 'UPDATE_DISCIPLINE', 'Disciplines', p.disciplineId, { name: p.name, code: code, catRef: catRef, cascadedRenames: renamedCount });
  return updated;
}

// REQ-DIS-01: once a venue is approved, PM identifies applicable disciplines. This reconciles
// the full set on every save (adds newly checked, removes unchecked) — but a discipline that
// already has an Inspector assigned for this event can't be removed until that assignment is
// removed first, since dropping it would orphan the assignment and any work under it.
function identifyDisciplines(user, p) {
  var event = getById('Events', p.eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');
  requirePermission(user, 'discipline.identify', event.inspectionCoId); // RBAC pilot -- same default roles as before, no behavior change
  var wantedIds = p.disciplineIds || [];
  var existing = findWhere('EventDisciplines', function (ed) { return ed.eventId === p.eventId; });
  var existingIds = existing.map(function (ed) { return ed.disciplineId; });

  var assignedDisciplineIds = Array.from(new Set(
    findWhere('InspectorAssignments', function (a) { return a.eventId === p.eventId; }).map(function (a) { return a.disciplineId; })
  ));
  var blockedRemovals = existingIds.filter(function (did) {
    return wantedIds.indexOf(did) === -1 && assignedDisciplineIds.indexOf(did) !== -1;
  });
  if (blockedRemovals.length) {
    var names = blockedRemovals.map(function (did) { var d = getById('Disciplines', did); return d ? d.name : did; });
    throw new HululError('FORBIDDEN', 'Cannot unselect ' + names.join(', ') + ' — an inspector is already assigned. Remove that assignment first.');
  }

  wantedIds.forEach(function (did) {
    if (existingIds.indexOf(did) === -1) {
      insertRow('EventDisciplines', { id: newId('EventDisciplines'), eventId: p.eventId, disciplineId: did, venueId: event.venueId, identifiedBy: user.id, createdAt: nowIso_() });
    }
  });
  existing.forEach(function (ed) {
    if (wantedIds.indexOf(ed.disciplineId) === -1) deleteRow('EventDisciplines', ed.id);
  });

  audit(user.id, 'IDENTIFY_DISCIPLINES', 'Events', p.eventId, { disciplineIds: wantedIds });
  return listEventDisciplines(p.eventId);
}

function listEventDisciplines(eventId) {
  return findWhere('EventDisciplines', function (ed) { return ed.eventId === eventId; });
}

// REQ-DIS-02: qualification profile per Inspector.
function setInspectorQualifications(user, p) {
  requirePermission(user, 'inspectorQualification.manage'); // RBAC pilot -- same default roles as before, no behavior change
  var inspector = getById('Users', p.inspectorId);
  if (!inspector || inspector.role !== ROLES.INSPECTOR) throw new HululError('BAD_REQUEST', 'Target user is not an Inspector');
  // Replace the full set.
  findWhere('InspectorQualifications', function (q) { return q.userId === p.inspectorId; })
    .forEach(function (q) { deleteRow('InspectorQualifications', q.id); });
  var created = (p.disciplineIds || []).map(function (did) {
    var row = { id: newId('InspectorQualifications'), userId: p.inspectorId, disciplineId: did };
    insertRow('InspectorQualifications', row);
    return row;
  });
  audit(user.id, 'SET_QUALIFICATIONS', 'Users', p.inspectorId, { disciplineIds: p.disciplineIds });
  return created;
}

function inspectorQualifications_(inspectorId) {
  return findWhere('InspectorQualifications', function (q) { return q.userId === inspectorId; }).map(function (q) { return q.disciplineId; });
}

// Discipline records (not just IDs) an Inspector is currently qualified in — used to pre-check
// the Inspector Qualifications page and to render its "currently qualified" table.
function listInspectorQualifications(user, p) {
  if (!p || !p.inspectorId) throw new HululError('BAD_REQUEST', 'inspectorId is required');
  var disciplineIds = inspectorQualifications_(p.inspectorId);
  return disciplineIds.map(function (did) { return getById('Disciplines', did); }).filter(Boolean);
}

// Active Inspectors qualified in a discipline — used to populate the "Assign inspector" dropdown.
// When eventId is given, narrowed to Inspectors at the event's Inspection Company.
function listQualifiedInspectors(user, p) {
  if (!p || !p.disciplineId) throw new HululError('BAD_REQUEST', 'disciplineId is required');
  var userIds = findWhere('InspectorQualifications', function (q) { return q.disciplineId === p.disciplineId; }).map(function (q) { return q.userId; });
  var inspectors = findWhere('Users', function (u) {
    return u.role === ROLES.INSPECTOR && u.status === 'Active' && userIds.indexOf(u.id) !== -1;
  });
  if (p.eventId) {
    var event = getById('Events', p.eventId);
    if (event && event.inspectionCoId) inspectors = inspectors.filter(function (u) { return u.orgId === event.inspectionCoId; });
  }
  return inspectors.map(stripSecrets_);
}

// Every distinct ChecklistItems.checklistType (sub-category) under a discipline, across every
// phase -- InspectorAssignments aren't phase-specific, so unlike
// disciplineChecklistTypesForPhase_ (Inspections.gs, used for self-service pickup slots) this
// doesn't narrow by phase either.
function disciplineChecklistTypes_(disciplineName) {
  var types = {};
  getAll('ChecklistItems').forEach(function (c) {
    if (c.status !== 'Deleted' && c.category === disciplineName && c.checklistType) types[c.checklistType] = true;
  });
  return Object.keys(types);
}

// REQ follow-up: "If a sub-category has already been picked up it can not appear in the sub-category
// section." A sub-category counts as covered the moment ANY existing assignment for this
// discipline+event names it explicitly, OR the moment any existing assignment has blank
// checklistTypes at all (blanket = covers everything, see the SCHEMA comment on
// InspectorAssignments.checklistTypes, Utils.gs) -- a discipline already fully assigned to one
// Inspector has nothing left to hand to a second one. Returns { all, available } so the frontend can
// render "N of M already covered" context, not just the leftover list.
function assignableChecklistTypes_(eventId, disciplineId) {
  var discipline = getById('Disciplines', disciplineId);
  var all = discipline ? disciplineChecklistTypes_(discipline.name) : [];
  var assignments = findWhere('InspectorAssignments', function (a) { return a.eventId === eventId && a.disciplineId === disciplineId; });
  var covered = {};
  assignments.forEach(function (a) {
    var types = a.checklistTypes ? String(a.checklistTypes).split(',').filter(Boolean) : [];
    if (!types.length) { all.forEach(function (ty) { covered[ty] = true; }); }
    else { types.forEach(function (ty) { covered[ty] = true; }); }
  });
  return { all: all, available: all.filter(function (ty) { return !covered[ty]; }) };
}

// Frontend entry point for the Assign Inspector sub-category picker (eventDetail.js) -- called once
// a Discipline is chosen, same trigger as loadQualifiedInspectors.
function listAssignableChecklistTypes(user, p) {
  if (!p || !p.eventId || !p.disciplineId) throw new HululError('BAD_REQUEST', 'eventId and disciplineId are required');
  return assignableChecklistTypes_(p.eventId, p.disciplineId);
}

// REQ-DIS-03/04/05: PM assigns qualified Inspectors to disciplines for the venue; blocks unqualified assignment.
// If the venue has more than one Zone, the assignment must say which Zone(s) the Inspector
// covers — otherwise it's ambiguous which part of the venue they're responsible for. A
// single-zone (or zone-less) venue has nothing to disambiguate, so zones stay optional there.
// REQ follow-up: "Sub category can be selected or by default all sub-categories are selected."
// checklistTypes works the same way -- optional, and only meaningful when the discipline actually
// has sub-categories to choose from (assignableChecklistTypes_.all.length > 0); everything already
// picked up by another assignment is rejected here too, not just hidden from the picker, so a stale
// form (opened before someone else grabbed a sub-category) can't sneak past it.
function assignInspector(user, p) {
  var event = getById('Events', p.eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');
  requirePermission(user, 'inspectorAssignment.manage', event.inspectionCoId); // RBAC pilot -- same default roles as before, no behavior change
  var quals = inspectorQualifications_(p.inspectorId);
  if (quals.indexOf(p.disciplineId) === -1) {
    throw new HululError('FORBIDDEN', 'Inspector is not qualified in this category');
  }
  var venueZones = activeZonesForVenue_(event.venueId);
  var zoneIds = p.zoneIds || [];
  if (venueZones.length > 1) {
    if (!zoneIds.length) throw new HululError('BAD_REQUEST', 'This venue has multiple zones — select at least one zone for the inspector');
    var validZoneIds = venueZones.map(function (z) { return z.id; });
    var invalid = zoneIds.filter(function (zid) { return validZoneIds.indexOf(zid) === -1; });
    if (invalid.length) throw new HululError('BAD_REQUEST', 'One or more selected zones do not belong to this venue');
  }
  var scope = assignableChecklistTypes_(p.eventId, p.disciplineId);
  var checklistTypes = p.checklistTypes || [];
  if (scope.all.length) {
    if (!checklistTypes.length) throw new HululError('BAD_REQUEST', 'Select at least one sub-category for the inspector');
    var invalidTypes = checklistTypes.filter(function (ty) { return scope.all.indexOf(ty) === -1; });
    if (invalidTypes.length) throw new HululError('BAD_REQUEST', 'One or more selected sub-categories do not belong to this category');
    var alreadyCovered = checklistTypes.filter(function (ty) { return scope.available.indexOf(ty) === -1; });
    if (alreadyCovered.length) throw new HululError('BAD_REQUEST', alreadyCovered.join(', ') + ' — already covered by another assignment for this category.');
  } else {
    checklistTypes = []; // no sub-category catalogue on this discipline -- blanket assignment, unchanged from before this feature
  }
  // Same Discipline + Inspector + Zone set + sub-category set already assigned for this event is a
  // duplicate, not a new assignment — block it instead of creating an indistinguishable second row.
  var zoneKey_ = function (ids) { return ids.slice().sort().join(','); };
  var newZoneKey = zoneKey_(zoneIds);
  var newTypeKey = zoneKey_(checklistTypes);
  var isDuplicate = findWhere('InspectorAssignments', function (a) {
    return a.eventId === p.eventId && a.disciplineId === p.disciplineId && a.inspectorId === p.inspectorId &&
      zoneKey_(a.zoneIds ? String(a.zoneIds).split(',').filter(Boolean) : []) === newZoneKey &&
      zoneKey_(a.checklistTypes ? String(a.checklistTypes).split(',').filter(Boolean) : []) === newTypeKey;
  }).length > 0;
  if (isDuplicate) {
    var discipline = getById('Disciplines', p.disciplineId);
    var inspector = getById('Users', p.inspectorId);
    throw new HululError('BAD_REQUEST',
      (inspector ? inspector.name : 'This inspector') + ' is already assigned to ' + (discipline ? discipline.name : 'this discipline') +
      (zoneIds.length ? ' for the selected zone(s)' : '') + '.');
  }
  var row = {
    id: newId('InspectorAssignments'), eventId: p.eventId, disciplineId: p.disciplineId, inspectorId: p.inspectorId,
    assignedBy: user.id, assignedAt: nowIso_(), zoneIds: zoneIds.join(','), checklistTypes: checklistTypes.join(',')
  };
  insertRow('InspectorAssignments', row);
  audit(user.id, 'ASSIGN_INSPECTOR', 'InspectorAssignments', row.id, { zoneIds: zoneIds, checklistTypes: checklistTypes });
  notify_(p.inspectorId, 'ASSIGNMENT', 'You were assigned to a discipline for ' + event.name, 'InspectorAssignments', row.id, p.eventId);
  return row;
}

// Removing an assignment is only safe once the Inspector hasn't logged anything yet — otherwise
// their Findings would be left pointing at an inspector no longer on the event.
function removeInspectorAssignment(user, p) {
  var event = getById('Events', p.eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');
  requirePermission(user, 'inspectorAssignment.manage', event.inspectionCoId); // RBAC pilot -- same default roles as before, no behavior change
  var assignment = getById('InspectorAssignments', p.assignmentId);
  if (!assignment || assignment.eventId !== p.eventId) throw new HululError('NOT_FOUND', 'Assignment not found');
  var hasLogs = findWhere('Findings', function (f) { return f.eventId === p.eventId && f.createdBy === assignment.inspectorId; }).length > 0;
  if (hasLogs) throw new HululError('FORBIDDEN', 'This inspector has already logged findings for this event — the assignment can no longer be removed.');
  deleteRow('InspectorAssignments', p.assignmentId);
  audit(user.id, 'REMOVE_INSPECTOR_ASSIGNMENT', 'InspectorAssignments', p.assignmentId, {});
  // assignInspector notifies the inspector when added (see below); removal deserves the same --
  // also covers reassignInspector, which calls this then assignInspector for the replacement.
  notify_(assignment.inspectorId, 'UNASSIGNMENT', 'You were removed from a discipline assignment for ' + event.name, 'InspectorAssignments', p.assignmentId, p.eventId);
  return { ok: true };
}

// Two events "conflict" for a given Inspector if they're assigned to both and the events' date
// ranges overlap -- assignments are event-wide (no per-time slot the way Inspections/Meetings have
// scheduledAt), so event-level overlap is the finest granularity there's data for. Shared by
// listCoverageGaps and listConflictFreeQualifiedInspectors so the two can't drift apart.
function eventsOverlap_(a, b) {
  if (!a || !b || !a.startDateTime || !a.endDateTime || !b.startDateTime || !b.endDateTime) return false;
  return new Date(a.startDateTime) < new Date(b.endDateTime) && new Date(b.startDateTime) < new Date(a.endDateTime);
}

// Finds the first other-event assignment for this Inspector that overlaps `event`'s dates, if any.
// otherAssignments is pre-filtered to exclude this event's own rows by the caller (small perf win --
// listCoverageGaps calls this once per qualified inspector per gap discipline).
function inspectorConflict_(event, inspectorId, otherAssignments) {
  var hit = null;
  otherAssignments.some(function (a) {
    if (a.inspectorId !== inspectorId) return false;
    var other = getById('Events', a.eventId);
    if (!eventsOverlap_(event, other)) return false;
    hit = { eventId: other.id, eventName: other.name, startDateTime: other.startDateTime, endDateTime: other.endDateTime };
    return true;
  });
  return hit;
}

// Coverage gaps for an event: which identified disciplines still have zones (or, for a
// single/no-zone venue, the whole venue) with no inspector assigned, and every qualified Inspector
// who could fill the gap -- including ones already assigned elsewhere (flagged via `assigned`) and
// ones double-booked on another overlapping event (flagged via `conflict`), so the PM sees the full
// picture instead of candidates silently disappearing off the list once they're taken. `conflicts`
// is a separate, event-wide list (not scoped to gap disciplines only) -- a discipline can be fully
// covered and still have a conflicted Inspector, and that needs surfacing too.
function listCoverageGaps(user, p) {
  var event = getById('Events', p.eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');
  var venueZones = activeZonesForVenue_(event.venueId);
  var zoneMode = venueZones.length > 1;
  var identifiedIds = findWhere('EventDisciplines', function (ed) { return ed.eventId === p.eventId; }).map(function (ed) { return ed.disciplineId; });
  var assignments = findWhere('InspectorAssignments', function (a) { return a.eventId === p.eventId; });
  var otherAssignments = findWhere('InspectorAssignments', function (a) { return a.eventId !== p.eventId; });
  var disciplinesById_ = {};
  getAll('Disciplines').forEach(function (d) { disciplinesById_[d.id] = d; });

  // REQ: "If an inspector has conflict in another event then must be added to a conflict list with
  // details" -- checked across every current assignment for this event, not just gap disciplines.
  var conflicts = [];
  assignments.forEach(function (a) {
    var hit = inspectorConflict_(event, a.inspectorId, otherAssignments);
    if (!hit) return;
    var discipline = disciplinesById_[a.disciplineId];
    var inspector = getById('Users', a.inspectorId);
    conflicts.push({
      assignmentId: a.id, disciplineId: a.disciplineId, disciplineName: discipline ? discipline.name : a.disciplineId,
      inspectorId: a.inspectorId, inspectorName: inspector ? inspector.name : a.inspectorId,
      inspectorEmail: inspector ? inspector.email : '', conflict: hit
    });
  });

  var items = [];
  identifiedIds.forEach(function (did) {
    var discipline = disciplinesById_[did];
    var forDiscipline = assignments.filter(function (a) { return a.disciplineId === did; });
    var uncoveredZones = [];

    if (zoneMode) {
      var coveredZoneIds = {};
      forDiscipline.forEach(function (a) {
        (a.zoneIds ? String(a.zoneIds).split(',').filter(Boolean) : []).forEach(function (zid) { coveredZoneIds[zid] = true; });
      });
      uncoveredZones = venueZones.filter(function (z) { return !coveredZoneIds[z.id]; }).map(function (z) { return { id: z.id, name: z.name }; });
      if (!uncoveredZones.length) return; // every zone has an assigned inspector for this discipline
    } else {
      if (forDiscipline.length > 0) return; // single/no-zone venue: any assignment covers the whole thing
    }

    var assignedInspectorIds = forDiscipline.map(function (a) { return a.inspectorId; });
    var qualifiedUserIds = findWhere('InspectorQualifications', function (q) { return q.disciplineId === did; }).map(function (q) { return q.userId; });
    var qualified = findWhere('Users', function (u) {
      return u.role === ROLES.INSPECTOR && u.status === 'Active' && qualifiedUserIds.indexOf(u.id) !== -1 &&
        (!event.inspectionCoId || u.orgId === event.inspectionCoId);
    }).map(stripSecrets_).map(function (u) {
      // REQ follow-up: "If an inspector has been chosen to do a zone for example Zone A, then making
      // quick assign would also suggest same previous zone." Union of zoneIds across every OTHER
      // assignment this inspector already has on THIS event (any discipline, not just this gap's) --
      // the quick-assign click handler (eventDetail.js) prefers whichever of these overlap the gap's
      // own uncoveredZones, so an inspector already working Zone A elsewhere on this event gets Zone
      // A pre-checked here too instead of defaulting to every uncovered zone.
      var previousZoneIds = {};
      assignments.forEach(function (a) {
        if (a.inspectorId !== u.id) return;
        (a.zoneIds ? String(a.zoneIds).split(',').filter(Boolean) : []).forEach(function (zid) { previousZoneIds[zid] = true; });
      });
      return {
        id: u.id, name: u.name, email: u.email,
        assigned: assignedInspectorIds.indexOf(u.id) !== -1,
        conflict: inspectorConflict_(event, u.id, otherAssignments),
        previousZoneIds: Object.keys(previousZoneIds)
      };
    });

    items.push({
      disciplineId: did, disciplineName: discipline ? discipline.name : did,
      uncoveredZones: zoneMode ? uncoveredZones : null,
      availableInspectors: qualified
    });
  });

  return { zoneMode: zoneMode, items: items, conflicts: conflicts };
}

// REQ: "...provided the option to... change with other qualified inspector with no conflict."
// Candidates for swapping into a conflicted (or just plain double-booked-looking) assignment: same
// qualification/org rules as listQualifiedInspectors, narrowed to Inspectors not already assigned to
// this discipline for this event and free of an overlapping-event conflict.
function listConflictFreeQualifiedInspectors(user, p) {
  if (!p || !p.disciplineId || !p.eventId) throw new HululError('BAD_REQUEST', 'disciplineId and eventId are required');
  var event = getById('Events', p.eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');
  var assignedInspectorIds = findWhere('InspectorAssignments', function (a) { return a.eventId === p.eventId && a.disciplineId === p.disciplineId; }).map(function (a) { return a.inspectorId; });
  var otherAssignments = findWhere('InspectorAssignments', function (a) { return a.eventId !== p.eventId; });
  var candidates = listQualifiedInspectors(user, { disciplineId: p.disciplineId, eventId: p.eventId });
  return candidates.filter(function (u) {
    return assignedInspectorIds.indexOf(u.id) === -1 && !inspectorConflict_(event, u.id, otherAssignments);
  });
}

// REQ: "...option to reschedule or change with other qualified inspector with no conflict." Swaps an
// already-assigned Inspector for a different qualified, conflict-free one on the same
// discipline+zones -- reuses removeInspectorAssignment/assignInspector's own validation (role check,
// duplicate check, hasLogs-blocks-removal check) and audit trail rather than duplicating it, so a
// reassign is provably equivalent to "remove then add" done by hand.
function reassignInspector(user, p) {
  var assignment = getById('InspectorAssignments', p.oldAssignmentId);
  if (!assignment || assignment.eventId !== p.eventId) throw new HululError('NOT_FOUND', 'Assignment not found');
  var zoneIds = assignment.zoneIds ? String(assignment.zoneIds).split(',').filter(Boolean) : [];
  // Carries the old assignment's sub-category scope forward too -- removeInspectorAssignment below
  // frees those sub-categories again (they're no longer "covered" once the row is gone), so
  // assignInspector's own already-covered check would otherwise let a THIRD assignment race in
  // ahead of this swap; same-request remove-then-add makes that a non-issue in practice.
  var checklistTypes = assignment.checklistTypes ? String(assignment.checklistTypes).split(',').filter(Boolean) : [];
  var disciplineId = assignment.disciplineId;
  removeInspectorAssignment(user, { eventId: p.eventId, assignmentId: p.oldAssignmentId });
  return assignInspector(user, { eventId: p.eventId, disciplineId: disciplineId, inspectorId: p.newInspectorId, zoneIds: zoneIds, checklistTypes: checklistTypes });
}

// REQ follow-up: "PM can assign an inspector to only work on Zone x which will force all checklists
// and logs to only be done in that zone." Reuses the SAME zoneIds already captured on
// InspectorAssignments (previously just informational/coverage-tracking, see listCoverageGaps
// above, and a soft "who counts toward completion" filter, see participantRelevantToInspection_ in
// Inspections.gs) -- once a PM scopes an assignment to specific zone(s), this is what actually
// enforces it as a hard boundary everywhere the inspector touches this discipline for this event,
// instead of only shaping progress numbers. Empty result (no zoneIds ever set on ANY of the
// inspector's assignments for this discipline+event -- the common single/no-zone-venue case, or an
// old assignment made before zones existed) means unrestricted, same meaning blank zoneIds already
// has everywhere else in this file.
function inspectorAllowedZoneIds_(inspectorId, eventId, disciplineId) {
  var ids = {};
  findWhere('InspectorAssignments', function (a) {
    return a.inspectorId === inspectorId && a.eventId === eventId && a.disciplineId === disciplineId;
  }).forEach(function (a) {
    (a.zoneIds ? String(a.zoneIds).split(',').filter(Boolean) : []).forEach(function (zid) { ids[zid] = true; });
  });
  return Object.keys(ids);
}

// Shared by createFinding (Findings.gs, manual Log) and recordInspectionResults (Inspections.gs,
// auto-created-from-Crossed-item Log + the InspectionResult itself) -- one place enforcing "this
// participant must be in a zone this inspector is actually assigned to." Mirrors
// participantRelevantToInspection_'s own zone-matching rule (Inspections.gs) exactly: a participant
// with no zone / 'ALL' on record applies everywhere (REQ: "usually operators operate in all zones"),
// and an unrestricted assignment (see inspectorAllowedZoneIds_ above) allows anything. No-op if
// there's no participant to check (e.g. an Opening-phase checklist result, which has no participant
// dimension at all).
function assertParticipantZoneAllowed_(inspectorId, eventId, disciplineId, participant) {
  if (!participant) return;
  var allowedZoneIds = inspectorAllowedZoneIds_(inspectorId, eventId, disciplineId);
  if (!allowedZoneIds.length) return;
  var participantZoneIds = zoneFieldIds_(participant.zoneId);
  if (!participantZoneIds.length) return;
  var overlaps = participantZoneIds.some(function (zid) { return allowedZoneIds.indexOf(zid) !== -1; });
  if (!overlaps) {
    throw new HululError('FORBIDDEN', 'You are only assigned to specific zone(s) for this category — this participant is outside your assigned zone(s).');
  }
}

function listInspectorAssignments(user, p) {
  return findWhere('InspectorAssignments', function (a) { return a.eventId === p.eventId; }).map(function (a) {
    var discipline = getById('Disciplines', a.disciplineId);
    var inspector = getById('Users', a.inspectorId);
    var zoneIds = a.zoneIds ? String(a.zoneIds).split(',').filter(Boolean) : [];
    var zoneNames = zoneIds.map(function (zid) { var z = getById('Zones', zid); return z ? z.name : zid; });
    // REQ follow-up: "Sub category can be selected..." -- blank stays displayed as "All" rather than
    // an empty cell, matching how a blank zoneIds already implicitly means "whole venue" above.
    var checklistTypes = a.checklistTypes ? String(a.checklistTypes).split(',').filter(Boolean) : [];
    var checklistTypeArByType_ = {};
    if (checklistTypes.length) {
      findWhere('ChecklistItems', function (c) { return c.disciplineId === a.disciplineId && c.checklistTypeAr; })
        .forEach(function (c) { if (!checklistTypeArByType_[c.checklistType]) checklistTypeArByType_[c.checklistType] = c.checklistTypeAr; });
    }
    return Object.assign({}, a, {
      disciplineName: discipline ? discipline.name : a.disciplineId,
      disciplineNameAr: discipline ? discipline.nameAr || '' : '',
      inspectorName: inspector ? inspector.name : a.inspectorId,
      inspectorEmail: inspector ? inspector.email : '',
      zoneNames: zoneNames,
      checklistTypeNames: checklistTypes,
      checklistTypeNamesAr: checklistTypes.map(function (ty) { return checklistTypeArByType_[ty] || ''; })
    });
  });
}
