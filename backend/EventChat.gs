/**
 * HULUL - EventChat.gs
 * Event Chat: a per-event message thread where system Users can tag any other User and any
 * Participant "within the event" (see listChatTaggableParticipants), and reference specific Event
 * Log entries inline. Participant-account roles (Vendor/Operator/Exhibitor -- see
 * mapParticipantRole_ in Participants.gs) are explicitly blocked from the whole feature, even though
 * getEventDetail otherwise lets them view an event at their own venue -- REQ: "Related participant
 * accounts have no access to the chat."
 *
 * Event Log: not a new table -- it's a filtered, newest-first read of the existing AuditLog, scoped
 * to one event. Most AuditLog rows are logged against a sub-entity's own id (a FindingId, a
 * TemplateId, ...), not the eventId directly, so EVENT_LOG_RESOLVERS_ below knows how to trace each
 * targetType back to the event it belongs to (directly, or via one join, e.g. Escalations ->
 * Findings -> eventId). targetTypes with no resolver (catalog/platform-level things like
 * ChecklistItems, Organizations, Config) are simply not event-scoped and never show up here.
 */

// Plain string literals, not ROLES.X -- backend .gs files concatenate alphabetically at load, and
// EventChat.gs loads BEFORE Utils.gs (E < U), so a top-level reference to ROLES here would
// dereference it before it exists, throwing at script load and breaking every single API call
// platform-wide (this exact failure mode already happened once before, see SUPPORT_MANAGE_ROLES in
// Support.gs). ROLES.VENDOR/OPERATOR/EXHIBITOR are 'Vendor'/'Operator'/'Exhibitor'.
var CHAT_BLOCKED_ROLES_ = ['Vendor', 'Operator', 'Exhibitor'];
function assertChatAccess_(user) {
  if (CHAT_BLOCKED_ROLES_.indexOf(user.role) !== -1) {
    throw new HululError('FORBIDDEN', 'Participant accounts do not have access to the event chat');
  }
}

function listEventChatMessages(user, p) {
  if (!p || !p.eventId) throw new HululError('BAD_REQUEST', 'eventId is required');
  var event = getById('Events', p.eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');
  assertChatAccess_(user);

  var rows = findWhere('EventChatMessages', function (m) { return m.eventId === p.eventId; });
  rows.sort(function (a, b) { return new Date(a.createdAt) - new Date(b.createdAt); }); // oldest first, standard chat order

  var userIds = [], participantIds = [], logIds = [];
  rows.forEach(function (m) {
    userIds.push(m.authorId);
    (m.mentionedUserIds ? m.mentionedUserIds.split(',').filter(Boolean) : []).forEach(function (id) { userIds.push(id); });
    (m.mentionedParticipantIds ? m.mentionedParticipantIds.split(',').filter(Boolean) : []).forEach(function (id) { participantIds.push(id); });
    (m.logRefIds ? m.logRefIds.split(',').filter(Boolean) : []).forEach(function (id) { logIds.push(id); });
  });
  var usersById = {};
  Array.from(new Set(userIds)).forEach(function (id) { var u = getById('Users', id); if (u) usersById[id] = u.name; });
  var participantsById = {};
  Array.from(new Set(participantIds)).forEach(function (id) { var pt = getById('Participants', id); if (pt) participantsById[id] = pt.name; });
  var logsById = {};
  Array.from(new Set(logIds)).forEach(function (id) { var l = getById('AuditLog', id); if (l) logsById[id] = l; });

  return rows.map(function (m) {
    return {
      id: m.id, eventId: m.eventId, authorId: m.authorId, authorName: usersById[m.authorId] || m.authorId,
      message: m.message, createdAt: m.createdAt,
      mentionedUsers: (m.mentionedUserIds ? m.mentionedUserIds.split(',').filter(Boolean) : [])
        .map(function (id) { return { id: id, name: usersById[id] || id }; }),
      mentionedParticipants: (m.mentionedParticipantIds ? m.mentionedParticipantIds.split(',').filter(Boolean) : [])
        .map(function (id) { return { id: id, name: participantsById[id] || id }; }),
      logRefs: (m.logRefIds ? m.logRefIds.split(',').filter(Boolean) : [])
        .map(function (id) {
          var l = logsById[id];
          return l ? { id: id, action: l.action, targetType: l.targetType, timestamp: l.timestamp } : { id: id, action: 'Unknown', targetType: '', timestamp: '' };
        })
    };
  });
}

function postEventChatMessage(user, p) {
  if (!p || !p.eventId) throw new HululError('BAD_REQUEST', 'eventId is required');
  var event = getById('Events', p.eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');
  assertChatAccess_(user);
  var message = (p.message || '').trim();
  if (!message) throw new HululError('BAD_REQUEST', 'Message cannot be empty');

  var mentionedUserIds = (p.mentionedUserIds || []).filter(Boolean);
  var mentionedParticipantIds = (p.mentionedParticipantIds || []).filter(Boolean);
  var logRefIds = (p.logRefIds || []).filter(Boolean);

  var row = {
    id: newId('EventChatMessages'), eventId: p.eventId, authorId: user.id, message: message,
    mentionedUserIds: mentionedUserIds.join(','), mentionedParticipantIds: mentionedParticipantIds.join(','),
    logRefIds: logRefIds.join(','), createdAt: nowIso_()
  };
  insertRow('EventChatMessages', row);
  audit(user.id, 'POST_EVENT_CHAT_MESSAGE', 'EventChatMessages', row.id, { eventId: p.eventId });

  // REQ: "allow to tag any user" -- tagged Users get notified, same as any other mention-style
  // notification elsewhere in the app. Tagged Participants aren't notified: they're data records,
  // and even on the rare occasion one has a linked login (Participants.gs), that account is a
  // blocked chat role with nothing to view anyway.
  var notifyIds = mentionedUserIds.filter(function (id) { return id !== user.id; });
  if (notifyIds.length) {
    notify_(notifyIds, 'EVENT_CHAT_MENTION', user.name + ' mentioned you in ' + event.name + ' chat', 'EventChatMessages', row.id, p.eventId);
  }
  return row;
}

// Tag-picker source for "any user" -- deliberately unrestricted (unlike listUsers, which is
// role-gated to admin-ish roles, see Accounts.gs) since any non-blocked chat participant needs to be
// able to see who they can tag, not just admins. Mirrors supportUserName_'s reasoning in Support.gs.
function listChatTaggableUsers(user, p) {
  assertChatAccess_(user);
  return getAll('Users').filter(function (u) {
    return u.status === 'Active' && CHAT_BLOCKED_ROLES_.indexOf(u.role) === -1;
  }).map(function (u) { return { id: u.id, name: u.name, email: u.email, role: u.role }; });
}

// Tag-picker source for "participants within the event" -- reuses listParticipants' own
// eventId-scoping (permanent venue participants + this event's own temporary ones).
function listChatTaggableParticipants(user, p) {
  if (!p || !p.eventId) throw new HululError('BAD_REQUEST', 'eventId is required');
  assertChatAccess_(user);
  return listParticipants(user, { eventId: p.eventId }).map(function (pt) { return { id: pt.id, name: pt.name, type: pt.type }; });
}

// See file header for the general approach. Each resolver takes a targetId and returns the eventId
// it belongs to (or null/undefined if it can't be resolved / doesn't belong to any event), so
// listEventLog can filter AuditLog down to "everything relevant to event X" in one pass.
var EVENT_LOG_RESOLVERS_ = {
  Events: function (id) { return id; },
  SubEvents: function (id) { var r = getById('SubEvents', id); return r ? r.eventId : null; },
  VenueEvaluations: function (id) { var r = getById('VenueEvaluations', id); return r ? r.eventId : null; },
  Templates: function (id) { var r = getById('Templates', id); return r ? r.eventId : null; },
  Meetings: function (id) { var r = getById('Meetings', id); return r ? r.eventId : null; },
  EventDisciplines: function (id) { var r = getById('EventDisciplines', id); return r ? r.eventId : null; },
  InspectorAssignments: function (id) { var r = getById('InspectorAssignments', id); return r ? r.eventId : null; },
  Inspections: function (id) { var r = getById('Inspections', id); return r ? r.eventId : null; },
  Findings: function (id) { var r = getById('Findings', id); return r ? r.eventId : null; },
  Escalations: function (id) { var r = getById('Escalations', id); if (!r) return null; var f = getById('Findings', r.findingId); return f ? f.eventId : null; },
  Resolutions: function (id) { var r = getById('Resolutions', id); if (!r) return null; var f = getById('Findings', r.findingId); return f ? f.eventId : null; },
  Participants: function (id) { var r = getById('Participants', id); return r ? (r.eventId || null) : null; },
  Places: function (id) { var r = getById('Places', id); return r ? (r.eventId || null) : null; },
  Reports: function (id) { var r = getById('Reports', id); return r ? r.eventId : null; },
  EventChatMessages: function (id) { var r = getById('EventChatMessages', id); return r ? r.eventId : null; }
};

// REQ: "Add an event log page showing all transaction relevant to an event keep last log first."
function listEventLog(user, p) {
  if (!p || !p.eventId) throw new HululError('BAD_REQUEST', 'eventId is required');
  var event = getById('Events', p.eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');

  var rows = getAll('AuditLog').filter(function (row) {
    var resolver = EVENT_LOG_RESOLVERS_[row.targetType];
    if (!resolver) return false;
    return resolver(row.targetId) === p.eventId;
  });
  rows.sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); }); // newest first

  var actorsById = {};
  Array.from(new Set(rows.map(function (r) { return r.actor; }))).forEach(function (id) {
    var u = getById('Users', id);
    actorsById[id] = u ? u.name : id;
  });
  return rows.map(function (r) {
    return {
      id: r.id, actor: r.actor, actorName: actorsById[r.actor] || r.actor, action: r.action,
      targetType: r.targetType, targetId: r.targetId, timestamp: r.timestamp, details: r.details || ''
    };
  });
}
