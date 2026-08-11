/**
 * HULUL - Disciplines.gs  (REQ-DIS-01..05)
 * Compliance disciplines, inspector qualification profiles, discipline-qualified inspector assignment.
 */

function listDisciplines() {
  return getAll('Disciplines');
}

// Admin-maintained reference data: compliance disciplines catalogue (Setup.gs seeds the defaults).
function createDiscipline(user, p) {
  requireRole(user, [ROLES.SYSTEM_ADMIN, ROLES.INSPECTION_ADMIN]);
  if (!p.name || !p.code) throw new HululError('BAD_REQUEST', 'name and code are required');
  var row = { id: newId('Disciplines'), name: p.name, code: p.code };
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
  requireRole(user, [ROLES.PROJECT_MANAGER, ROLES.SYSTEM_ADMIN], event.inspectionCoId);
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
  requireRole(user, [ROLES.INSPECTION_ADMIN, ROLES.SYSTEM_ADMIN, ROLES.PROJECT_MANAGER]);
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
  requireRole(user, [ROLES.PROJECT_MANAGER, ROLES.SYSTEM_ADMIN], event.inspectionCoId);
  var quals = inspectorQualifications_(p.inspectorId);
  if (quals.indexOf(p.disciplineId) === -1) {
    throw new HululError('FORBIDDEN', 'Inspector is not qualified in this discipline');
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
  requireRole(user, [ROLES.PROJECT_MANAGER, ROLES.SYSTEM_ADMIN], event.inspectionCoId);
  var assignment = getById('InspectorAssignments', p.assignmentId);
  if (!assignment || assignment.eventId !== p.eventId) throw new HululError('NOT_FOUND', 'Assignment not found');
  var hasLogs = findWhere('Findings', function (f) { return f.eventId === p.eventId && f.createdBy === assignment.inspectorId; }).length > 0;
  if (hasLogs) throw new HululError('FORBIDDEN', 'This inspector has already logged findings for this event — the assignment can no longer be removed.');
  deleteRow('InspectorAssignments', p.assignmentId);
  audit(user.id, 'REMOVE_INSPECTOR_ASSIGNMENT', 'InspectorAssignments', p.assignmentId, {});
  return { ok: true };
}

// Coverage gaps for an event: which identified disciplines still have zones (or, for a
// single/no-zone venue, the whole venue) with no inspector assigned, and which qualified
// Inspectors haven't been assigned to that discipline yet and could fill the gap.
function listCoverageGaps(user, p) {
  var event = getById('Events', p.eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');
  var venueZones = activeZonesForVenue_(event.venueId);
  var zoneMode = venueZones.length > 1;
  var identifiedIds = findWhere('EventDisciplines', function (ed) { return ed.eventId === p.eventId; }).map(function (ed) { return ed.disciplineId; });
  var assignments = findWhere('InspectorAssignments', function (a) { return a.eventId === p.eventId; });

  var items = [];
  identifiedIds.forEach(function (did) {
    var discipline = getById('Disciplines', did);
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
    var available = findWhere('Users', function (u) {
      return u.role === ROLES.INSPECTOR && u.status === 'Active' && qualifiedUserIds.indexOf(u.id) !== -1 &&
        (!event.inspectionCoId || u.orgId === event.inspectionCoId) && assignedInspectorIds.indexOf(u.id) === -1;
    }).map(stripSecrets_);

    items.push({
      disciplineId: did, disciplineName: discipline ? discipline.name : did,
      uncoveredZones: zoneMode ? uncoveredZones : null,
      availableInspectors: available
    });
  });

  return { zoneMode: zoneMode, items: items };
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
