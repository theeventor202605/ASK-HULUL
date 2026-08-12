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

// Admin-maintained reference data: checklist item catalogue (Setup.gs seeds the defaults). The dup
// check only looks at active items -- recreating an item with the same key as a previously
// soft-deleted one is allowed.
function createChecklistItem(user, p) {
  requireRole(user, [ROLES.SYSTEM_ADMIN, ROLES.INSPECTION_ADMIN, ROLES.PROJECT_MANAGER]);
  ['checklistType', 'category', 'description'].forEach(function (f) {
    if (!p[f]) throw new HululError('BAD_REQUEST', f + ' is required');
  });
  var row = {
    id: newId('ChecklistItems'), checklistType: p.checklistType, category: p.category, description: p.description,
    defaultRisk: p.defaultRisk || 'Medium', defaultWindowHours: p.defaultWindowHours || 24, phase: p.phase || 'Opening',
    status: 'Active'
  };
  var key = checklistItemDupKey_(row);
  var dup = findWhere('ChecklistItems', function (c) { return c.status !== 'Deleted' && checklistItemDupKey_(c) === key; })[0];
  if (dup) throw new HululError('BAD_REQUEST', 'A checklist item with this Description, Phase, Checklist Type, and Discipline already exists.');
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
  requireRole(user, [ROLES.SYSTEM_ADMIN, ROLES.INSPECTION_ADMIN, ROLES.PROJECT_MANAGER]);
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
    var row = {
      checklistType: raw.checklistType, category: raw.category, description: raw.description,
      defaultRisk: raw.defaultRisk || 'Medium', defaultWindowHours: raw.defaultWindowHours || 24,
      phase: raw.phase || 'Opening', status: 'Active'
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
  requireRole(user, [ROLES.SYSTEM_ADMIN, ROLES.INSPECTION_ADMIN, ROLES.PROJECT_MANAGER]);
  var item = getById('ChecklistItems', p.itemId);
  if (!item) throw new HululError('NOT_FOUND', 'Checklist item not found');
  var patch = {};
  ['checklistType', 'category', 'description', 'defaultRisk', 'defaultWindowHours', 'phase'].forEach(function (f) {
    if (p[f] !== undefined) patch[f] = p[f];
  });
  ['checklistType', 'category', 'description'].forEach(function (f) {
    if (patch[f] !== undefined && !String(patch[f]).trim()) throw new HululError('BAD_REQUEST', f + ' is required');
  });
  var merged = Object.assign({}, item, patch);
  var key = checklistItemDupKey_(merged);
  var dup = findWhere('ChecklistItems', function (c) { return c.id !== p.itemId && c.status !== 'Deleted' && checklistItemDupKey_(c) === key; })[0];
  if (dup) throw new HululError('BAD_REQUEST', 'A checklist item with this Description, Phase, Checklist Type, and Discipline already exists.');
  var updated = updateRow('ChecklistItems', p.itemId, patch);
  audit(user.id, 'UPDATE_CHECKLIST_ITEM', 'ChecklistItems', p.itemId, patch);
  return updated;
}

// Soft-delete: the row stays (any Inspection/Finding that already referenced it keeps resolving a
// real description) but it's marked Deleted and filtered out of listChecklistItems and
// inspectionScopeItems_ going forward -- same pattern as deleteVenue/deleteZone.
function deleteChecklistItem(user, p) {
  requireRole(user, [ROLES.SYSTEM_ADMIN, ROLES.INSPECTION_ADMIN, ROLES.PROJECT_MANAGER]);
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
  requireRole(user, [ROLES.SYSTEM_ADMIN, ROLES.INSPECTION_ADMIN]);
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
  requireRole(user, [ROLES.PROJECT_MANAGER, ROLES.SYSTEM_ADMIN], event.inspectionCoId);
  ['eventId', 'disciplineId', 'inspectorId', 'scheduledAt', 'phase'].forEach(function (f) {
    if (!p[f]) throw new HululError('BAD_REQUEST', f + ' is required');
  });
  if (['Opening', 'Operational'].indexOf(p.phase) === -1) {
    throw new HululError('BAD_REQUEST', 'phase must be "Opening" or "Operational"');
  }
  var isAssigned = findWhere('InspectorAssignments', function (a) {
    return a.eventId === p.eventId && a.disciplineId === p.disciplineId && a.inspectorId === p.inspectorId;
  }).length > 0;
  if (!isAssigned) throw new HululError('FORBIDDEN', 'This inspector is not assigned to this discipline for this event yet — assign them first in Disciplines & Inspectors.');
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
  requireRole(user, [ROLES.PROJECT_MANAGER, ROLES.SYSTEM_ADMIN], event.inspectionCoId);
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
  if (!isAssigned) throw new HululError('FORBIDDEN', 'This inspector is not assigned to this discipline for this event yet — assign them first in Disciplines & Inspectors.');
  var patch = { disciplineId: disciplineId, inspectorId: inspectorId, phase: phase, scheduledAt: scheduledAt };
  var updated = updateRow('Inspections', p.inspectionId, patch);
  audit(user.id, 'UPDATE_INSPECTION', 'Inspections', p.inspectionId, patch);
  return updated;
}

// Deleting is only safe (and only allowed) while nothing has been recorded yet — status
// 'Scheduled' and zero InspectionResults — so nothing else ends up referencing a removed inspection.
function deleteInspection(user, p) {
  var event = getById('Events', p.eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');
  requireRole(user, [ROLES.PROJECT_MANAGER, ROLES.SYSTEM_ADMIN], event.inspectionCoId);
  var inspection = getById('Inspections', p.inspectionId);
  if (!inspection || inspection.eventId !== p.eventId) throw new HululError('NOT_FOUND', 'Inspection not found');
  if (inspection.status !== 'Scheduled') {
    throw new HululError('FORBIDDEN', 'This inspection already has results recorded against it and can no longer be deleted.');
  }
  var hasResults = findWhere('InspectionResults', function (r) { return r.inspectionId === p.inspectionId; }).length > 0;
  if (hasResults) throw new HululError('FORBIDDEN', 'This inspection already has results recorded against it and can no longer be deleted.');
  deleteRow('Inspections', p.inspectionId);
  audit(user.id, 'DELETE_INSPECTION', 'Inspections', p.inspectionId, {});
  return { ok: true };
}

// The set of catalogue Checklist items that fall under an inspection's discipline + phase — this
// is the full scope of what an inspector *may* record against that inspection, regardless of what
// was recorded so far.
function inspectionScopeItems_(inspection) {
  var discipline = getById('Disciplines', inspection.disciplineId);
  var disciplineName = discipline ? discipline.name : '';
  return getAll('ChecklistItems').filter(function (c) { return c.status !== 'Deleted' && c.category === disciplineName && c.phase === inspection.phase; });
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

// Overall inspection completion = every *relevant* participant (matching discipline + zone, see
// participantRelevantToInspection_) has a fully-recorded checklist -- not just one checklist run.
// An inspection only becomes "Completed" once every relevant participant is done — until then it
// stays open, per REQ: "Any Checklist type that has not been done will remain open ... anytime on
// or after scheduled date," now applied per participant rather than just per checklist item.
function inspectionCoverage_(inspection) {
  var inspectorZoneIds = inspectorZoneIdsForInspection_(inspection);
  var venueId = inspectionVenueId_(inspection);
  var venueParticipants = venueParticipantsForEvent_(venueId, inspection.eventId);
  // Merged so a vendor with two shift accounts counts once toward "how many participants need a
  // checklist," not twice (see mergeParticipantsByLocation_ in Participants.gs).
  var relevant = mergeParticipantsByLocation_(venueParticipants)
    .filter(function (pt) { return participantRelevantToInspection_(pt, inspection, inspectorZoneIds); });
  var perParticipant = relevant.map(function (pt) {
    var c = inspectionParticipantCoverage_(inspection, pt.id);
    return { participantId: pt.id, participantName: pt.name, total: c.total, done: c.done, completed: c.total > 0 && c.openItems.length === 0 };
  });
  var done = perParticipant.filter(function (x) { return x.completed; }).length;
  return { total: perParticipant.length, done: done, perParticipant: perParticipant };
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
        inspectorName: inspector ? inspector.name : i.inspectorId,
        // total/done now count *relevant participants* completed, not checklist items -- see
        // inspectionCoverage_.
        coverage: { total: coverage.total, done: coverage.done }
      });
    });
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
  requireRole(user, [ROLES.INSPECTOR, ROLES.SYSTEM_ADMIN]);
  var inspection = getById('Inspections', p.inspectionId);
  if (!inspection) throw new HululError('NOT_FOUND', 'Inspection not found');
  if (user.role === ROLES.INSPECTOR && inspection.inspectorId !== user.id) {
    throw new HululError('FORBIDDEN', 'Not your assigned inspection');
  }
  if (new Date(inspection.scheduledAt) > new Date()) {
    throw new HululError('BAD_REQUEST', 'This inspection is scheduled for a future date/time and cannot be recorded yet.');
  }
  // REQ: a checklist is completed *for a participant* -- the inspector must choose one before
  // recording anything (see the choose-participant screen in tabInspections). Any participant on
  // the event is accepted here (not just "relevant" ones) so an inspector can still log something
  // unexpected found on site; the frontend's guided flow is what steers them to the relevant list.
  if (!p.participantId) throw new HululError('BAD_REQUEST', 'participantId is required — choose which participant this checklist is for.');
  var participant = getById('Participants', p.participantId);
  var venueId = inspectionVenueId_(inspection);
  if (!participant || !venueId || participant.venueId !== venueId) throw new HululError('BAD_REQUEST', 'participantId must belong to this event\'s venue');

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

    insertRow('InspectionResults', {
      id: newId('InspectionResults'), inspectionId: p.inspectionId, checklistItemId: r.checklistItemId,
      state: r.state, riskLevel: riskLevel, resolutionWindowHours: windowHours, notes: r.notes || '',
      evidenceUrls: (r.evidenceUrls || []).join(','), recordedAt: nowIso_(), participantId: p.participantId
    });

    if (r.state === 'Crossed') {
      var resolutionWindowAt = new Date(Date.now() + Number(windowHours) * 3600 * 1000).toISOString();
      var finding = {
        id: newId('Findings'), eventId: inspection.eventId, inspectionId: p.inspectionId, disciplineId: inspection.disciplineId,
        category: item ? item.checklistType : '', subCategory: item ? item.category : '', description: r.notes || (item ? item.description : ''),
        suggestedAction: r.suggestedAction || '', riskLevel: riskLevel, resolutionWindowAt: resolutionWindowAt,
        nextInspectionAt: r.nextInspectionAt || '', participantId: r.participantId || p.participantId, subZone: r.subZone || '',
        location: r.location || '', status: 'Open', evidenceUrls: (r.evidenceUrls || []).join(','),
        lat: r.lat || '', lng: r.lng || '', createdBy: user.id, createdAt: nowIso_(), reopenCount: 0
      };
      insertRow('Findings', finding);
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

// Photo/video evidence for Risk Logging — uploaded to Drive, mirrors Templates.gs's uploadTemplate
// pattern (reuses its getOrCreateFolder_ helper). Returns a URL usable in Findings/InspectionResults
// evidenceUrls. p.fileBase64 + p.fileName + p.mimeType come from the frontend's file input;
// p.eventId is used only to group evidence into a per-event Drive folder.
function uploadEvidence(user, p) {
  // Originally Inspector-only (Risk Logging evidence at finding-creation time). Findings.gs's
  // resolveFinding now also requires a camera photo/video from the Participant (Vendor/Operator/
  // Exhibitor) when submitting a resolution -- same generic evidence-upload endpoint, so it needs
  // to accept those roles too.
  requireRole(user, [ROLES.INSPECTOR, ROLES.SYSTEM_ADMIN, ROLES.VENDOR, ROLES.OPERATOR, ROLES.EXHIBITOR]);
  if (!p.fileBase64) throw new HululError('BAD_REQUEST', 'fileBase64 is required');
  var folder = getOrCreateFolder_('HULUL Evidence - ' + (p.eventId || 'General'));
  var blob = Utilities.newBlob(Utilities.base64Decode(p.fileBase64), p.mimeType || 'application/octet-stream', p.fileName || 'evidence');
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  audit(user.id, 'UPLOAD_EVIDENCE', 'Findings', '', { fileName: p.fileName || file.getName() });
  return { url: file.getUrl(), fileId: file.getId(), fileName: p.fileName || file.getName(), mimeType: p.mimeType || '' };
}
