/**
 * HULUL - Reassignment.gs
 * Sidebar "Re-assignment" page: mark a user temporarily unavailable (absence), see every current
 * assignment that user holds, and move it to someone else without leaving this one page.
 *
 * Two kinds of "assignment" exist in the schema as a direct userId link on a record:
 *   - InspectorAssignments.inspectorId (per event+discipline+zones) -- the main case, with a
 *     matching-discipline replacement suggestion and conflict-aware rescheduling (see
 *     listReplacementSuggestions below, and eventsOverlap_/inspectorConflict_ in Disciplines.gs,
 *     reused rather than reimplemented).
 *   - Events.eventManagerId -- reassigned via the existing assignEventManagerToVenue (Events.gs),
 *     no new function needed for the swap itself.
 * Deliberately kept separate from `status` (Active/Inactive, which gates login) -- see the
 * `unavailable*` columns' comment in Utils.gs SCHEMA.
 */

// REQ: "If a user is absent then he will be added to list in this page as unavailable."
function setUserUnavailable(user, p) {
  requirePermission(user, 'reassignment.manage'); // RBAC pilot -- same default roles as before, no behavior change
  if (!p || !p.userId) throw new HululError('BAD_REQUEST', 'userId is required');
  var target = getById('Users', p.userId);
  if (!target) throw new HululError('NOT_FOUND', 'User not found');
  var updated = updateRow('Users', p.userId, {
    unavailable: true, unavailableReason: (p.reason || '').trim(), unavailableSince: nowIso_()
  });
  audit(user.id, 'SET_USER_UNAVAILABLE', 'Users', p.userId, { reason: p.reason || '' });
  notify_(p.userId, 'MARKED_UNAVAILABLE', 'You were marked unavailable' + (p.reason ? ' (' + p.reason + ')' : '') + ' -- your assignments may be reassigned while you\'re out.', 'Users', p.userId, '');
  return stripSecrets_(updated);
}

function setUserAvailable(user, p) {
  requirePermission(user, 'reassignment.manage'); // RBAC pilot -- same default roles as before, no behavior change
  if (!p || !p.userId) throw new HululError('BAD_REQUEST', 'userId is required');
  var target = getById('Users', p.userId);
  if (!target) throw new HululError('NOT_FOUND', 'User not found');
  var updated = updateRow('Users', p.userId, { unavailable: false, unavailableReason: '', unavailableSince: '' });
  audit(user.id, 'SET_USER_AVAILABLE', 'Users', p.userId, {});
  notify_(p.userId, 'MARKED_AVAILABLE', 'You were marked available again.', 'Users', p.userId, '');
  return stripSecrets_(updated);
}

function listUnavailableUsers(user) {
  requirePermission(user, 'reassignment.manage'); // RBAC pilot -- same default roles as before, no behavior change
  return getAll('Users').filter(function (u) { return u.unavailable === true || u.unavailable === 'true'; }).map(stripSecrets_);
}

// Every InspectorAssignment held by this user, plus every Event they're the Event Manager of --
// whichever's relevant depends on the user's role, but both are always computed since a user's role
// can differ from what they happen to be assigned as historically. Each inspector assignment is
// enriched the same way listInspectorAssignments (Disciplines.gs) does its own event-scoped list,
// plus event name/dates since this list spans multiple events.
function listUserAssignments(user, p) {
  requirePermission(user, 'reassignment.manage'); // RBAC pilot -- same default roles as before, no behavior change
  if (!p || !p.userId) throw new HululError('BAD_REQUEST', 'userId is required');

  var inspectorAssignments = findWhere('InspectorAssignments', function (a) { return a.inspectorId === p.userId; }).map(function (a) {
    var event = getById('Events', a.eventId);
    var discipline = getById('Disciplines', a.disciplineId);
    var zoneIds = a.zoneIds ? String(a.zoneIds).split(',').filter(Boolean) : [];
    var zoneNames = zoneIds.map(function (zid) { var z = getById('Zones', zid); return z ? z.name : zid; });
    return {
      id: a.id, eventId: a.eventId, eventName: event ? event.name : a.eventId,
      eventStart: event ? event.startDateTime : '', eventEnd: event ? event.endDateTime : '',
      disciplineId: a.disciplineId, disciplineName: discipline ? discipline.name : a.disciplineId,
      disciplineNameAr: discipline ? discipline.nameAr || '' : '',
      zoneNames: zoneNames
    };
  });

  var managedEvents = findWhere('Events', function (e) { return e.eventManagerId === p.userId; }).map(function (e) {
    return { id: e.id, name: e.name, startDateTime: e.startDateTime, endDateTime: e.endDateTime, status: e.status };
  });

  return { inspectorAssignments: inspectorAssignments, managedEvents: managedEvents };
}

// REQ: "If an inspector is unavailable then a matching discipline inspector will be suggested. If
// suggested inspector has conflicting schedule with the current unassigned user schedule then it can
// be rescheduled from within this page." -- conflict-free candidates are returned first (the actual
// suggestion), but conflicted ones are still included (not silently dropped) since they may be the
// only qualified option, in which case the page offers Reschedule instead of a clean swap. Excludes
// other unavailable inspectors too -- no point suggesting someone else who's also out.
function listReplacementSuggestions(user, p) {
  requirePermission(user, 'reassignment.manage'); // RBAC pilot -- same default roles as before, no behavior change
  if (!p || !p.eventId || !p.disciplineId) throw new HululError('BAD_REQUEST', 'eventId and disciplineId are required');
  var event = getById('Events', p.eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');

  var qualifiedUserIds = findWhere('InspectorQualifications', function (q) { return q.disciplineId === p.disciplineId; }).map(function (q) { return q.userId; });
  var assignedInspectorIds = findWhere('InspectorAssignments', function (a) { return a.eventId === p.eventId && a.disciplineId === p.disciplineId; }).map(function (a) { return a.inspectorId; });
  var otherAssignments = findWhere('InspectorAssignments', function (a) { return a.eventId !== p.eventId; });

  var candidates = findWhere('Users', function (u) {
    return u.role === ROLES.INSPECTOR && u.status === 'Active' && !(u.unavailable === true || u.unavailable === 'true') &&
      qualifiedUserIds.indexOf(u.id) !== -1 && u.id !== p.excludeUserId && assignedInspectorIds.indexOf(u.id) === -1 &&
      (!event.inspectionCoId || u.orgId === event.inspectionCoId);
  }).map(function (u) {
    return { id: u.id, name: u.name, email: u.email, conflict: inspectorConflict_(event, u.id, otherAssignments) };
  });

  candidates.sort(function (a, b) { return (a.conflict ? 1 : 0) - (b.conflict ? 1 : 0); });
  return candidates;
}
