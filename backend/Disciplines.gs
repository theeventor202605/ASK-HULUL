/**
 * HULUL - Disciplines.gs  (REQ-DIS-01..05)
 * Compliance disciplines, inspector qualification profiles, discipline-qualified inspector assignment.
 */

function listDisciplines() {
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
  var row = { id: newId('Disciplines'), name: p.name, code: code, catRef: catRef };
  insertRow('Disciplines', row);
  audit(user.id, 'CREATE_DISCIPLINE', 'Disciplines', row.id, {});
  return row;
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

// REQ-DIS-03/04/05: PM assigns qualified Inspectors to disciplines for the venue; blocks unqualified assignment.
// If the venue has more than one Zone, the assignment must say which Zone(s) the Inspector
// covers — otherwise it's ambiguous which part of the venue they're responsible for. A
// single-zone (or zone-less) venue has nothing to disambiguate, so zones stay optional there.
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
  // Same Discipline + Inspector + Zone set already assigned for this event is a duplicate, not a
  // new assignment — block it instead of creating an indistinguishable second row.
  var zoneKey_ = function (ids) { return ids.slice().sort().join(','); };
  var newKey = zoneKey_(zoneIds);
  var isDuplicate = findWhere('InspectorAssignments', function (a) {
    return a.eventId === p.eventId && a.disciplineId === p.disciplineId && a.inspectorId === p.inspectorId &&
      zoneKey_(a.zoneIds ? String(a.zoneIds).split(',').filter(Boolean) : []) === newKey;
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
    assignedBy: user.id, assignedAt: nowIso_(), zoneIds: zoneIds.join(',')
  };
  insertRow('InspectorAssignments', row);
  audit(user.id, 'ASSIGN_INSPECTOR', 'InspectorAssignments', row.id, { zoneIds: zoneIds });
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
      return {
        id: u.id, name: u.name, email: u.email,
        assigned: assignedInspectorIds.indexOf(u.id) !== -1,
        conflict: inspectorConflict_(event, u.id, otherAssignments)
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
  var disciplineId = assignment.disciplineId;
  removeInspectorAssignment(user, { eventId: p.eventId, assignmentId: p.oldAssignmentId });
  return assignInspector(user, { eventId: p.eventId, disciplineId: disciplineId, inspectorId: p.newInspectorId, zoneIds: zoneIds });
}

function listInspectorAssignments(user, p) {
  return findWhere('InspectorAssignments', function (a) { return a.eventId === p.eventId; }).map(function (a) {
    var discipline = getById('Disciplines', a.disciplineId);
    var inspector = getById('Users', a.inspectorId);
    var zoneIds = a.zoneIds ? String(a.zoneIds).split(',').filter(Boolean) : [];
    var zoneNames = zoneIds.map(function (zid) { var z = getById('Zones', zid); return z ? z.name : zid; });
    return Object.assign({}, a, {
      disciplineName: discipline ? discipline.name : a.disciplineId,
      inspectorName: inspector ? inspector.name : a.inspectorId,
      inspectorEmail: inspector ? inspector.email : '',
      zoneNames: zoneNames
    });
  });
}
