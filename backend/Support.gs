/**
 * HULUL - Support.gs
 * In-app technical support ticketing: any signed-in user can report a technical issue (a screenshot
 * of the page they're on, optionally with a highlight box drawn on it, plus a written remark and an
 * optional voice note) from anywhere in the app -- see the global Support button (frontend/js/app.js
 * wireChrome) and the capture/annotate/record flow in frontend/js/views/support.js. SupportAgent and
 * SystemAdmin work the shared ticket queue from there too.
 *
 * Status lifecycle (mirrors Findings.gs's Open -> ... -> Resolved/Rejected shape):
 *   Open       -- raiser just submitted it.
 *   InProgress -- a Support Agent/SystemAdmin opened it (auto, on first view -- see getTicketDetail,
 *                 REQ: "when I open a ticket it appears in progress") and/or comments are going back
 *                 and forth with the raiser.
 *   Resolved   -- Support explicitly marked it resolved (resolveTicket, remarks required) and is
 *                 waiting on the raiser to review.
 *   Completed  -- the raiser approved the resolution (terminal, success).
 * A raiser who rejects a Resolved ticket sends it back to InProgress with their further comments/
 * voice note attached (rejectTicketResolution), rather than a separate "Reopened" status -- reopenCount
 * tracks how many times this has happened, same convention as Findings.reopenCount (Findings.gs), but
 * purely for visibility here -- no hard cap on retries.
 *
 * Tickets are platform-level: not scoped to an Event or Organization (a technical error is about the
 * app itself, not event data -- see docs/DATA_MODEL.md's Support Tickets notes), raised from any page
 * by any role, visible to their raiser and to the whole Support queue.
 */

// Plain string literals, not [ROLES.SYSTEM_ADMIN, ...] -- this array is built at module load time,
// and Apps Script concatenates every .gs file's top-level code in file order (roughly alphabetical:
// "Support.gs" loads before "Utils.gs", which is where ROLES is actually defined), so referencing
// ROLES here would read it before Utils.gs has run, throwing a script-wide initialization error that
// breaks every API call, not just this one. requireRole(user, [ROLES.SYSTEM_ADMIN, ...]) calls
// *inside* functions are fine -- those only run after every file's top-level code has finished. Same
// guard, same reasoning, as EVENT_PLACE_MANAGE_ROLES in Places.gs.
var SUPPORT_MANAGE_ROLES = ['SystemAdmin', 'SupportAgent'];

function isSupportManager_(user) {
  return SUPPORT_MANAGE_ROLES.indexOf(user.role) !== -1;
}

function supportTicketVisibleTo_(user, ticket) {
  return isSupportManager_(user) || ticket.createdBy === user.id;
}

// Every active SupportAgent + SystemAdmin -- the shared queue's notification recipients whenever a
// ticket needs attention that isn't specifically about one already-assigned agent yet.
function supportRecipientIds_() {
  return findWhere('Users', function (u) { return u.status === 'Active' && SUPPORT_MANAGE_ROLES.indexOf(u.role) !== -1; })
    .map(function (u) { return u.id; });
}

// Any authenticated user may raise a ticket -- deliberately no requireRole restriction, since a
// technical error can come from literally any role in the app.
function createTicket(user, p) {
  if (!p || !p.remarks || !String(p.remarks).trim()) throw new HululError('BAD_REQUEST', 'remarks are required');
  var subject = (p.subject && String(p.subject).trim()) || String(p.remarks).trim().slice(0, 80);
  var ticket = {
    id: newId('SupportTickets'), createdBy: user.id, subject: subject, remarks: p.remarks,
    pageContext: p.pageContext || '', screenshotUrl: p.screenshotUrl || '', voiceNoteUrl: p.voiceNoteUrl || '',
    status: 'Open', assignedTo: '', reopenCount: 0, createdAt: nowIso_(), updatedAt: nowIso_(),
    resolvedAt: '', completedAt: ''
  };
  insertRow('SupportTickets', ticket);
  audit(user.id, 'CREATE_SUPPORT_TICKET', 'SupportTickets', ticket.id, {});
  notify_(supportRecipientIds_(), 'SUPPORT_TICKET_RAISED', 'New support ticket: ' + subject, 'SupportTickets', ticket.id, '');
  return ticket;
}

// Resolves a Users id to a display name, tolerating deleted/unknown ids -- used to denormalize
// createdByName/authorName onto tickets and comments below. listUsers (Accounts.gs) is role-gated
// to admin-tier roles and would throw FORBIDDEN for a SupportAgent or an ordinary raiser (Vendor,
// EventManager, etc.), so the frontend can't look names up itself the way other list views do;
// resolving them server-side here, where every role is allowed to read Users by id, sidesteps that.
function supportUserName_(userId) {
  if (!userId) return '';
  var u = getById('Users', userId);
  return u ? u.name : 'Unknown user';
}

// Support/SystemAdmin see the whole shared queue (optionally narrowed by status); everyone else
// sees only tickets they raised themselves -- "My Tickets".
function listTickets(user, p) {
  var all = isSupportManager_(user) ? getAll('SupportTickets') : findWhere('SupportTickets', function (t) { return t.createdBy === user.id; });
  if (p && p.status) all = all.filter(function (t) { return t.status === p.status; });
  return all.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); })
    .map(function (t) { return Object.assign({}, t, { createdByName: supportUserName_(t.createdBy) }); });
}

function listTicketComments_(ticketId) {
  return findWhere('SupportTicketComments', function (c) { return c.ticketId === ticketId; })
    .sort(function (a, b) { return new Date(a.createdAt) - new Date(b.createdAt); })
    .map(function (c) { return Object.assign({}, c, { authorName: supportUserName_(c.authorId) }); });
}

// Fetches one ticket for its detail/thread page, auto-advancing Open -> InProgress the first time a
// Support Agent/SystemAdmin opens it (REQ: "when I open a ticket it appears in progress") and
// claiming it (assignedTo) if nobody has yet. Any other view -- the raiser opening their own ticket,
// or Support re-opening something already InProgress/Resolved/Completed -- leaves status untouched.
function getTicketDetail(user, p) {
  if (!p || !p.ticketId) throw new HululError('BAD_REQUEST', 'ticketId is required');
  var ticket = getById('SupportTickets', p.ticketId);
  if (!ticket) throw new HululError('NOT_FOUND', 'Ticket not found');
  if (!supportTicketVisibleTo_(user, ticket)) throw new HululError('FORBIDDEN', 'Not your ticket');

  if (isSupportManager_(user) && ticket.status === 'Open') {
    ticket = updateRow('SupportTickets', p.ticketId, { status: 'InProgress', assignedTo: ticket.assignedTo || user.id, updatedAt: nowIso_() });
    audit(user.id, 'VIEW_SUPPORT_TICKET', 'SupportTickets', p.ticketId, { status: 'InProgress' });
  }
  ticket = Object.assign({}, ticket, { createdByName: supportUserName_(ticket.createdBy), assignedToName: supportUserName_(ticket.assignedTo) });
  return { ticket: ticket, comments: listTicketComments_(p.ticketId) };
}

// Anyone who can see the ticket (its raiser, or Support/SystemAdmin) can add a remark to the thread
// -- free text plus an optional voice note. A screen+voice recording (recordingUrl) is Support/
// SystemAdmin only (REQ: "Support will have the feature to record screen with voice recordings").
// Doesn't move status by itself; a Completed (terminal) ticket can't take new comments.
function addTicketComment(user, p) {
  if (!p || !p.ticketId) throw new HululError('BAD_REQUEST', 'ticketId is required');
  var ticket = getById('SupportTickets', p.ticketId);
  if (!ticket) throw new HululError('NOT_FOUND', 'Ticket not found');
  if (!supportTicketVisibleTo_(user, ticket)) throw new HululError('FORBIDDEN', 'Not your ticket');
  if (ticket.status === 'Completed') throw new HululError('BAD_REQUEST', 'This ticket is closed');
  if (p.recordingUrl && !isSupportManager_(user)) throw new HululError('FORBIDDEN', 'Only Support can attach a screen recording');
  if (!p.message && !p.voiceNoteUrl && !p.recordingUrl) throw new HululError('BAD_REQUEST', 'Add a message, voice note, or recording');

  var comment = {
    id: newId('SupportTicketComments'), ticketId: p.ticketId, authorId: user.id, message: p.message || '',
    voiceNoteUrl: p.voiceNoteUrl || '', recordingUrl: p.recordingUrl || '', recordingMimeType: p.recordingMimeType || '',
    createdAt: nowIso_()
  };
  insertRow('SupportTicketComments', comment);
  updateRow('SupportTickets', p.ticketId, { updatedAt: nowIso_() });
  audit(user.id, 'ADD_SUPPORT_TICKET_COMMENT', 'SupportTicketComments', comment.id, { ticketId: p.ticketId });

  var notifyIds = isSupportManager_(user) ? [ticket.createdBy] : supportRecipientIds_();
  notify_(notifyIds, 'SUPPORT_TICKET_COMMENT', 'New reply on ticket: ' + ticket.subject, 'SupportTickets', p.ticketId, '');
  return comment;
}

// Support/SystemAdmin marks a ticket resolved -- only valid from Open or InProgress. Resolution
// remarks are required and land as a comment on the thread (so the "why" is always visible in the
// same place as everything else), then the raiser is notified to review.
function resolveTicket(user, p) {
  requireRole(user, SUPPORT_MANAGE_ROLES);
  if (!p || !p.ticketId) throw new HululError('BAD_REQUEST', 'ticketId is required');
  var ticket = getById('SupportTickets', p.ticketId);
  if (!ticket) throw new HululError('NOT_FOUND', 'Ticket not found');
  if (['Open', 'InProgress'].indexOf(ticket.status) === -1) {
    throw new HululError('BAD_REQUEST', 'This ticket cannot be resolved from its current status (' + ticket.status + ')');
  }
  if (!p.message || !String(p.message).trim()) throw new HululError('BAD_REQUEST', 'Resolution remarks are required');

  insertRow('SupportTicketComments', {
    id: newId('SupportTicketComments'), ticketId: p.ticketId, authorId: user.id, message: p.message,
    voiceNoteUrl: '', recordingUrl: p.recordingUrl || '', recordingMimeType: p.recordingMimeType || '', createdAt: nowIso_()
  });
  var updated = updateRow('SupportTickets', p.ticketId, {
    status: 'Resolved', assignedTo: ticket.assignedTo || user.id, resolvedAt: nowIso_(), updatedAt: nowIso_()
  });
  audit(user.id, 'RESOLVE_SUPPORT_TICKET', 'SupportTickets', p.ticketId, {});
  notify_(ticket.createdBy, 'SUPPORT_TICKET_RESOLVED', 'Your support ticket was resolved — please review: ' + ticket.subject, 'SupportTickets', p.ticketId, '');
  return updated;
}

// Only the ticket's own raiser (or SystemAdmin, same override every other module in this app grants
// it) may approve/reject its resolution, and only while it's actually awaiting review.
function assertCanReviewTicket_(user, ticket) {
  if (user.role !== 'SystemAdmin' && ticket.createdBy !== user.id) {
    throw new HululError('FORBIDDEN', 'Only the person who raised this ticket can review it');
  }
  if (ticket.status !== 'Resolved') throw new HululError('BAD_REQUEST', 'This ticket is not awaiting your review');
}

// Raiser approves the resolution -> Completed (terminal).
function approveTicketResolution(user, p) {
  if (!p || !p.ticketId) throw new HululError('BAD_REQUEST', 'ticketId is required');
  var ticket = getById('SupportTickets', p.ticketId);
  if (!ticket) throw new HululError('NOT_FOUND', 'Ticket not found');
  assertCanReviewTicket_(user, ticket);
  var updated = updateRow('SupportTickets', p.ticketId, { status: 'Completed', completedAt: nowIso_(), updatedAt: nowIso_() });
  audit(user.id, 'APPROVE_SUPPORT_TICKET', 'SupportTickets', p.ticketId, {});
  notify_(ticket.assignedTo || supportRecipientIds_(), 'SUPPORT_TICKET_COMPLETED', 'Ticket approved and closed: ' + ticket.subject, 'SupportTickets', p.ticketId, '');
  return updated;
}

// Raiser rejects the resolution -> back to InProgress with their further comments/voice note
// attached (required) -- see module header comment for why this isn't a separate "Reopened" status.
function rejectTicketResolution(user, p) {
  if (!p || !p.ticketId) throw new HululError('BAD_REQUEST', 'ticketId is required');
  var ticket = getById('SupportTickets', p.ticketId);
  if (!ticket) throw new HululError('NOT_FOUND', 'Ticket not found');
  assertCanReviewTicket_(user, ticket);
  if (!p.message || !String(p.message).trim()) throw new HululError('BAD_REQUEST', 'Let us know what still needs work');

  insertRow('SupportTicketComments', {
    id: newId('SupportTicketComments'), ticketId: p.ticketId, authorId: user.id, message: p.message,
    voiceNoteUrl: p.voiceNoteUrl || '', recordingUrl: '', recordingMimeType: '', createdAt: nowIso_()
  });
  var reopenCount = (Number(ticket.reopenCount) || 0) + 1;
  var updated = updateRow('SupportTickets', p.ticketId, { status: 'InProgress', reopenCount: reopenCount, resolvedAt: '', updatedAt: nowIso_() });
  audit(user.id, 'REJECT_SUPPORT_TICKET', 'SupportTickets', p.ticketId, { reopenCount: reopenCount });
  notify_(ticket.assignedTo || supportRecipientIds_(), 'SUPPORT_TICKET_REOPENED', 'Ticket sent back with more comments: ' + ticket.subject, 'SupportTickets', p.ticketId, '');
  return updated;
}

// Dedicated upload endpoint (mirrors uploadEvidence in Inspections.gs) for ticket screenshots, voice
// notes, and Support's screen+voice recordings -- open to any authenticated user, since a screenshot/
// voice note comes from whoever raised the ticket, which can be any role. Stored in its own Drive
// folder (getOrCreateFolder_, shared helper defined in Templates.gs) rather than reusing the
// per-event Evidence folder, since a ticket isn't tied to an Event (see module header comment).
function uploadTicketMedia(user, p) {
  if (!p.fileBase64) throw new HululError('BAD_REQUEST', 'fileBase64 is required');
  var folder = getOrCreateFolder_('HULUL Support Tickets');
  var mimeType = p.mimeType || 'application/octet-stream';
  var blob = Utilities.newBlob(Utilities.base64Decode(p.fileBase64), mimeType, p.fileName || 'attachment');
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  audit(user.id, 'UPLOAD_SUPPORT_MEDIA', 'SupportTickets', '', { fileName: p.fileName || file.getName() });
  // file.getUrl() returns Drive's HTML viewer page, not raw bytes -- unusable as an <img src>, which
  // is why screenshots rendered as a broken image on the ticket page. Same fix as uploadOrgLogo
  // (Accounts.gs): the thumbnail endpoint reliably serves an embeddable image for image mime types.
  var url = mimeType.indexOf('image/') === 0
    ? 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1000'
    : file.getUrl();
  return { url: url, fileId: file.getId(), fileName: p.fileName || file.getName(), mimeType: mimeType };
}
