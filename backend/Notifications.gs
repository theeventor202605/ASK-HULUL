/**
 * HULUL - Notifications.gs
 * In-app notification log (Notifications sheet) + best-effort email via MailApp.
 * REQ list: template sent/submitted, venue decision, inspection scheduled, finding raised,
 * resolution submitted, resolution approved/rejected, each escalation tier triggered.
 */

// target: a single userId string OR an array of userIds. Silently no-ops on falsy target.
// eventId (optional) is what lets the frontend turn a click on this notification into a direct
// link to the right Event -- see the Notifications SCHEMA comment in Utils.gs.
function notify_(target, type, message, relatedType, relatedId, eventId) {
  var ids = [];
  if (Array.isArray(target)) ids = target.filter(Boolean);
  else if (target) ids = [target];

  ids.forEach(function (userId) {
    insertRow('Notifications', {
      id: newId('Notifications'), userId: userId, type: type, message: message,
      relatedType: relatedType || '', relatedId: relatedId || '', isRead: false, createdAt: nowIso_(),
      eventId: eventId || ''
    });
    try {
      var user = getById('Users', userId);
      if (user && user.email) {
        MailApp.sendEmail(user.email, '[HULUL] ' + type, message);
      }
    } catch (e) {
      // Email quota/errors must never break the underlying action.
    }
  });
}

// Resolves the standard recipients for an event: Event Manager, EMC Manager(s) at the same org,
// GA admins/users, and the Inspection Company PM(s) assigned to the event.
function eventStakeholderIds_(eventId) {
  var event = getById('Events', eventId);
  if (!event) return [];
  var ids = [];
  if (event.eventManagerId) ids.push(event.eventManagerId);
  var emcManagers = findWhere('Users', function (u) { return u.orgId === event.emcId && u.role === ROLES.EMC_MANAGER; });
  var gaUsers = findWhere('Users', function (u) { return u.role === ROLES.GA_ADMIN || u.role === ROLES.GA_USER; });
  var pms = findWhere('Users', function (u) { return u.orgId === event.inspectionCoId && u.role === ROLES.PROJECT_MANAGER; });
  emcManagers.concat(gaUsers).concat(pms).forEach(function (u) { ids.push(u.id); });
  return Array.from(new Set(ids));
}

function notifyEventStakeholders_(eventId, type, message, relatedType, relatedId) {
  notify_(eventStakeholderIds_(eventId), type, message, relatedType, relatedId, eventId);
}

// REQ bug report: "no notification was created or sent to the participants or the event manager
// nor the PM" when a finding was logged. eventStakeholderIds_ already covers Event Manager/EMC
// Manager(s)/GA/PM, but never included the vendor/operator/exhibitor the finding was actually
// raised against -- use this instead of notifyEventStakeholders_ at every finding-creation site so
// both groups get it. participantAccountUserIds_ (Participants.gs) covers every shift account at
// that vendor's spot, same reasoning as participantSiblingIds_/listFindings.
function notifyFindingCreated_(finding) {
  var ids = eventStakeholderIds_(finding.eventId).concat(participantAccountUserIds_(finding.participantId));
  notify_(Array.from(new Set(ids)), 'FINDING_RAISED', 'New finding raised: ' + finding.description, 'Findings', finding.id, finding.eventId);
}

// Drives every Risk Logging status-change notification (Findings.gs resolveFinding/
// reviewFindingResolution) -- who gets told depends on the new status: the Participant needs to
// hear about anything requiring their action or telling them the final outcome; stakeholders (Event
// Manager/EMC Manager/GA/PM) need to hear about anything requiring an Inspector's action or telling
// them the outcome. Viewed/InReview are deliberately silent (see viewFinding) -- they're routine
// auto-transitions on open, not worth a notification every time someone reopens a log.
function notifyFindingStatusChange_(finding, status) {
  var toParticipant = false, toStakeholders = false, msg;
  switch (status) {
    case 'Submitted':
    case 'Resubmitted':
      msg = 'Resolution submitted for finding: ' + finding.description; toStakeholders = true; break;
    case 'Resolved':
      msg = 'Finding resolved: ' + finding.description; toParticipant = true; toStakeholders = true; break;
    case 'ReOpen':
      msg = 'Resolution rejected — please resubmit: ' + finding.description; toParticipant = true; break;
    case 'Rejected':
      msg = 'Finding resolution rejected (final): ' + finding.description; toParticipant = true; toStakeholders = true; break;
    default:
      return;
  }
  var ids = [];
  if (toParticipant) ids = ids.concat(participantAccountUserIds_(finding.participantId));
  if (toStakeholders) ids = ids.concat(eventStakeholderIds_(finding.eventId));
  notify_(Array.from(new Set(ids)), 'FINDING_' + status.toUpperCase(), msg, 'Findings', finding.id, finding.eventId);
}

// Manual notification send (admin/ops tool) — most notifications are system-generated via notify_().
function sendNotification(user, p) {
  requirePermission(user, 'notification.send'); // RBAC pilot -- same default roles as before, no behavior change
  if (!p.targetUserId || !p.message) throw new HululError('BAD_REQUEST', 'targetUserId and message are required');
  notify_(p.targetUserId, p.type || 'MANUAL', p.message, p.relatedType || '', p.relatedId || '', p.eventId || '');
  audit(user.id, 'SEND_NOTIFICATION', 'Users', p.targetUserId, { type: p.type || 'MANUAL' });
  return { ok: true };
}

function listNotifications(user, p) {
  var all = findWhere('Notifications', function (n) { return n.userId === user.id; })
    .sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
  if (p && p.unreadOnly) all = all.filter(function (n) { return n.isRead === false || n.isRead === 'FALSE' || n.isRead === ''; });
  return all.slice(0, (p && p.limit) || 100);
}

function markNotificationRead(user, notificationId) {
  var n = getById('Notifications', notificationId);
  if (!n || n.userId !== user.id) throw new HululError('NOT_FOUND', 'Notification not found');
  return updateRow('Notifications', notificationId, { isRead: true });
}

// A user can only ever delete their own notifications -- same ownership check as
// markNotificationRead above.
function deleteNotification(user, notificationId) {
  var n = getById('Notifications', notificationId);
  if (!n || n.userId !== user.id) throw new HululError('NOT_FOUND', 'Notification not found');
  deleteRow('Notifications', notificationId);
  return { deleted: true };
}

function clearAllNotifications(user) {
  var mine = findWhere('Notifications', function (n) { return n.userId === user.id; });
  mine.forEach(function (n) { deleteRow('Notifications', n.id); });
  return { deleted: mine.length };
}
