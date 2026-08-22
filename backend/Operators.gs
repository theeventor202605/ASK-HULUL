/**
 * HULUL - Operators.gs
 * REQ: "Add Operator as an organization. So security operators or housekeeping operators or crowd
 * management operators and other types of operators can track logs directed to them from different
 * events. Sometimes the EMC is the one doing all these operations and currently the system accounts
 * only for this."
 *
 * Design (explicit user decisions, three clarifying questions):
 *  - An event can have several different Operator Organizations at once, one PER SPECIALTY (a
 *    Security company and a separate Housekeeping company, say) -- not one operator org for the
 *    whole event the way EMC/Inspection Company are. That's why this is its own table keyed by
 *    (eventId, operatorRoleCode), EventOperatorAssignments (SCHEMA, Utils.gs), rather than a single
 *    operatorOrgId column on Events.
 *  - Operator Organizations get real, individually-named staff logins (OperatorAdmin/
 *    OperatorAnalyst, Utils.gs/Auth.gs) -- separate from the existing shared-device QR "Operator"
 *    Participant accounts still posted on-site at each venue. This file is what makes those two
 *    connect: once an event has an assignment here, provisionPlaceAccount_ (Places.gs) tags any new
 *    shared "Operator"-family Place account it creates for that event with the assigned Operator
 *    Organization's own orgId instead of always defaulting to the renting EMC -- which is what lets
 *    listAllFindings' orgType==='OPERATOR' branch (Findings.gs) find "logs directed to them" later.
 *  - An Operator Organization is independent, like an Inspection Company -- it can be assigned to
 *    events run by any EMC, not tied to one.
 *
 * No assignment row for a given (event, role) pair means "the EMC handles it themselves" -- the
 * pre-existing behavior, unchanged and still the default.
 */

// Any authenticated user with event.assignOperator -- same "not sensitive, just a picklist" posture
// as listCustomRoles/listParticipantTypes (Roles.gs). Only Active Organizations of type OPERATOR;
// listOrganizations itself is more tightly gated (organization.list, usually SystemAdmin/GAAdmin-only)
// and isn't reachable by the EMCAdmin/EventManager who actually needs this list day to day.
function listOperatorOrganizations(user) {
  requirePermission(user, 'event.assignOperator');
  return findWhere('Organizations', function (o) { return o.type === 'OPERATOR' && o.status === 'Active'; });
}

// Resolved assignments for one event -- {operatorRoleCode, operatorRoleLabel, operatorOrgId, operatorOrgName}
// per row, for the Event workspace's Operator Companies card (eventDetail.js).
function listEventOperatorAssignments(user, p) {
  requirePermission(user, 'event.assignOperator');
  var eventId = p && p.eventId;
  if (!eventId) throw new HululError('BAD_REQUEST', 'eventId is required');
  var rows = findWhere('EventOperatorAssignments', function (a) { return a.eventId === eventId; });
  return rows.map(function (a) {
    var org = getById('Organizations', a.operatorOrgId);
    return {
      operatorRoleCode: a.operatorRoleCode,
      operatorRoleLabel: roleLabel_(a.operatorRoleCode),
      operatorOrgId: a.operatorOrgId,
      operatorOrgName: org ? org.name : ''
    };
  });
}

// p: { eventId, operatorRoleCode, operatorOrgId }. A blank operatorOrgId REMOVES the assignment
// (falls back to the EMC again, same as if it had never been set) rather than saving an empty row --
// keeps "row exists" the one, unambiguous signal provisionPlaceAccount_ (Places.gs) checks for.
function assignEventOperator(user, p) {
  requirePermission(user, 'event.assignOperator');
  if (!p || !p.eventId) throw new HululError('BAD_REQUEST', 'eventId is required');
  var event = getById('Events', p.eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');
  var operatorRoleCode = String(p.operatorRoleCode || '').trim();
  if (!operatorRoleCode) throw new HululError('BAD_REQUEST', 'operatorRoleCode is required');
  if (!isOperatorRoleCode_(operatorRoleCode)) {
    throw new HululError('BAD_REQUEST', 'operatorRoleCode must be the built-in Operator type or a custom role flagged as an Operator sub-type');
  }

  var existing = findWhere('EventOperatorAssignments', function (a) { return a.eventId === p.eventId && a.operatorRoleCode === operatorRoleCode; })[0];
  var operatorOrgId = String(p.operatorOrgId || '').trim();

  if (!operatorOrgId) {
    if (existing) {
      deleteRow('EventOperatorAssignments', existing.id);
      audit(user.id, 'REMOVE_EVENT_OPERATOR', 'EventOperatorAssignments', existing.id, { eventId: p.eventId, operatorRoleCode: operatorRoleCode });
    }
    return { eventId: p.eventId, operatorRoleCode: operatorRoleCode, operatorOrgId: '' };
  }

  var org = getById('Organizations', operatorOrgId);
  if (!org || org.type !== 'OPERATOR' || org.status !== 'Active') {
    throw new HululError('BAD_REQUEST', 'operatorOrgId must reference an Active Operator Organization');
  }

  if (existing) {
    updateRow('EventOperatorAssignments', existing.id, { operatorOrgId: operatorOrgId, assignedBy: user.id, assignedAt: nowIso_() });
    audit(user.id, 'UPDATE_EVENT_OPERATOR', 'EventOperatorAssignments', existing.id, { eventId: p.eventId, operatorRoleCode: operatorRoleCode, operatorOrgId: operatorOrgId });
  } else {
    var row = insertRow('EventOperatorAssignments', {
      id: newId('EventOperatorAssignments'), eventId: p.eventId, operatorRoleCode: operatorRoleCode,
      operatorOrgId: operatorOrgId, assignedBy: user.id, assignedAt: nowIso_()
    });
    audit(user.id, 'ASSIGN_EVENT_OPERATOR', 'EventOperatorAssignments', row.id, { eventId: p.eventId, operatorRoleCode: operatorRoleCode, operatorOrgId: operatorOrgId });
  }
  return { eventId: p.eventId, operatorRoleCode: operatorRoleCode, operatorOrgId: operatorOrgId, operatorOrgName: org.name };
}
