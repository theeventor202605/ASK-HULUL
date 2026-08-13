/**
 * HULUL - Templates.gs  (REQ-TPL-01..06, revised)
 * Two layers:
 *  - TemplateLibrary: the Inspection Company's own master documents (ZSMP, ZERP, TTP, CSM, SEC,
 *    and anything else they add), each with ONE current file that gets replaced when a newer
 *    version is uploaded — no re-uploading the same document over and over per event.
 *  - Templates: what an individual Event actually has. Nothing exists here until a Project
 *    Manager picks which library documents apply and sends them; from there each row moves
 *    Sent -> In Progress -> Submitted -> Under Review -> Evaluated/Missed as whichever role(s) are
 *    configured for the Event-Manager step and the Inspection-Analyst step act on it (defaults to
 *    Event Manager / Inspection Analyst respectively -- see templateUploaderRoles_/
 *    templateReviewerRoles_ below, configurable from Configuration > Process). A library update
 *    after a document has already been sent does NOT retroactively change the event's copy — it's
 *    locked to whatever version it got.
 *
 * REQ: statuses formerly named Approved/Rejected are now Evaluated/Missed -- Missed is reached two
 * ways: the Inspection Analyst explicitly marks a submitted document Missed (same as the old
 * "Reject" action, just relabeled), OR the PM's one event-wide deadline (setTemplatesDeadline)
 * lapses while a document is still sitting at Sent/In Progress -- i.e. the Event Manager never even
 * submitted it (see checkTemplateDeadlines, run every 30 min off the same trigger as the escalation
 * engine). Either way it's not terminal -- same as the old Rejected, the Event Manager can still
 * upload/submit a Missed document late; missing the deadline just gets flagged, not locked out.
 */

var TEMPLATE_STATUSES = ['Not Sent', 'Sent', 'In Progress', 'Submitted', 'Under Review', 'Evaluated', 'Missed'];

// ---- Configurable process roles (Configuration page > Process tab) -------------------------------
// REQ: "role assignments... Inspection Analyst and Event Manager, where I can change them and allow
// one or multiple role assignment." Who fills the Event-Manager step (upload/submit, and triggering
// the auto Sent->In Progress transition by opening the file) and who fills the Inspection-Analyst
// step (review/evaluate, and triggering the auto Submitted->Under Review transition) are no longer
// hardcoded to those two roles -- they're read from Config (JSON array of role codes) with the
// original roles as the fallback default, so an un-configured install behaves exactly as before.
// SystemAdmin can always act regardless of what's configured, same "SystemAdmin bypasses everything"
// convention used everywhere else in the app -- it's appended at each call site, not stored in the
// list itself, so it can never accidentally be configured away.
var TEMPLATE_UPLOADER_ROLES_CONFIG_KEY_ = 'templateUploaderRoles';
var TEMPLATE_REVIEWER_ROLES_CONFIG_KEY_ = 'templateReviewerRoles';
var TEMPLATE_DEFAULT_UPLOADER_ROLES_ = ['EventManager'];
var TEMPLATE_DEFAULT_REVIEWER_ROLES_ = ['InspectionAnalyst'];

function templateUploaderRoles_() {
  var roles = getConfigJson_(TEMPLATE_UPLOADER_ROLES_CONFIG_KEY_, TEMPLATE_DEFAULT_UPLOADER_ROLES_);
  return (Array.isArray(roles) && roles.length) ? roles : TEMPLATE_DEFAULT_UPLOADER_ROLES_;
}
function templateReviewerRoles_() {
  var roles = getConfigJson_(TEMPLATE_REVIEWER_ROLES_CONFIG_KEY_, TEMPLATE_DEFAULT_REVIEWER_ROLES_);
  return (Array.isArray(roles) && roles.length) ? roles : TEMPLATE_DEFAULT_REVIEWER_ROLES_;
}

// Read-only, open to any authenticated user (same visibility as e.g. listVenues) -- the Templates
// tab needs this to know which action buttons to show a given user; it is NOT the admin edit surface
// (that's getTemplateProcessConfig/setTemplateProcessConfig below, SystemAdmin-only).
function getTemplateProcessRoles(user) {
  return { uploaderRoles: templateUploaderRoles_(), reviewerRoles: templateReviewerRoles_() };
}

// Configuration page > Process tab: full read (with the role catalog to populate pickers from) and
// write, both SystemAdmin-only -- matches listConfig/setConfigEntry's existing gating in Utils.gs.
function getTemplateProcessConfig(user) {
  requireRole(user, [ROLES.SYSTEM_ADMIN]);
  var roles = getTemplateProcessRoles(user);
  roles.allRoles = Object.keys(ROLES).map(function (k) { return ROLES[k]; }).map(function (r) { return { value: r, label: roleLabel_(r) }; });
  return roles;
}
function setTemplateProcessConfig(user, p) {
  requireRole(user, [ROLES.SYSTEM_ADMIN]);
  var uploaderRoles = Array.isArray(p.uploaderRoles) ? p.uploaderRoles.filter(function (r) { return !!ROLE_LABELS[r]; }) : [];
  var reviewerRoles = Array.isArray(p.reviewerRoles) ? p.reviewerRoles.filter(function (r) { return !!ROLE_LABELS[r]; }) : [];
  if (!uploaderRoles.length) throw new HululError('BAD_REQUEST', 'At least one role must be able to upload/submit documents');
  if (!reviewerRoles.length) throw new HululError('BAD_REQUEST', 'At least one role must be able to review documents');
  setConfigJson_(TEMPLATE_UPLOADER_ROLES_CONFIG_KEY_, uploaderRoles);
  setConfigJson_(TEMPLATE_REVIEWER_ROLES_CONFIG_KEY_, reviewerRoles);
  audit(user.id, 'SET_TEMPLATE_PROCESS_CONFIG', 'Config', '', { uploaderRoles: uploaderRoles, reviewerRoles: reviewerRoles });
  return getTemplateProcessConfig(user);
}

/* ---------------- Template library (Inspection Admin) ---------------- */

// Any authenticated user can read their own org's library (needed to render the UI); SystemAdmin
// may pass p.orgId to look at a specific Inspection Company's library.
function listTemplateLibrary(user, p) {
  var orgId = (user.role === ROLES.SYSTEM_ADMIN && p && p.orgId) ? p.orgId : user.orgId;
  if (!orgId) return [];
  return findWhere('TemplateLibrary', function (l) { return l.orgId === orgId; });
}

function createLibraryTemplate(user, p) {
  requireRole(user, [ROLES.INSPECTION_ADMIN, ROLES.SYSTEM_ADMIN]);
  if (!p.name) throw new HululError('BAD_REQUEST', 'name is required');
  var orgId = user.role === ROLES.SYSTEM_ADMIN ? (p.orgId || user.orgId) : user.orgId;
  if (!orgId) throw new HululError('BAD_REQUEST', 'orgId is required');
  var row = {
    id: newId('TemplateLibrary'), orgId: orgId, name: p.name, fileUrl: '', fileName: '', mimeType: '',
    uploadedBy: '', createdAt: nowIso_(), updatedAt: nowIso_()
  };
  if (p.fileBase64) {
    var uploaded = uploadTemplateFile_(orgId, p.fileBase64, p.fileName, p.mimeType);
    row.fileUrl = uploaded.fileUrl; row.fileName = uploaded.fileName; row.mimeType = p.mimeType || ''; row.uploadedBy = user.id;
  }
  insertRow('TemplateLibrary', row);
  audit(user.id, 'CREATE_LIBRARY_TEMPLATE', 'TemplateLibrary', row.id, {});
  return row;
}

// Replaces the current file on a library template — this IS the versioning: there's only ever one
// current file per library entry, and uploading a newer one overwrites it. Events already sent the
// previous version keep their own locked copy (see Templates row snapshot, above).
function uploadLibraryTemplateVersion(user, p) {
  requireRole(user, [ROLES.INSPECTION_ADMIN, ROLES.SYSTEM_ADMIN]);
  var lib = getById('TemplateLibrary', p.templateLibraryId);
  if (!lib) throw new HululError('NOT_FOUND', 'Template not found');
  if (user.role !== ROLES.SYSTEM_ADMIN && lib.orgId !== user.orgId) throw new HululError('FORBIDDEN', 'Not your organization\'s template');
  if (!p.fileBase64) throw new HululError('BAD_REQUEST', 'fileBase64 is required');
  var uploaded = uploadTemplateFile_(lib.orgId, p.fileBase64, p.fileName, p.mimeType);
  var updated = updateRow('TemplateLibrary', lib.id, {
    fileUrl: uploaded.fileUrl, fileName: uploaded.fileName, mimeType: p.mimeType || '', uploadedBy: user.id, updatedAt: nowIso_()
  });
  audit(user.id, 'UPLOAD_LIBRARY_TEMPLATE_VERSION', 'TemplateLibrary', lib.id, {});
  return updated;
}

function uploadTemplateFile_(orgId, fileBase64, fileName, mimeType) {
  var folder = getOrCreateFolder_('HULUL Template Library - ' + orgId);
  var blob = Utilities.newBlob(Utilities.base64Decode(fileBase64), mimeType || 'application/octet-stream', fileName || 'template');
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { fileUrl: file.getUrl(), fileName: fileName || file.getName() };
}

/* ---------------- Per-event templates ---------------- */

// What an event "has": every library template belonging to its Inspection Company, merged with
// whatever per-event Templates row already exists. A library template with no Templates row yet
// is shown as a virtual "Not Sent" entry (id: '') — nothing is written to the sheet until
// sendTemplates actually sends it, so a library that grows over time is reflected automatically
// with no migration step needed.
function getEventTemplates(user, p) {
  if (!p || !p.eventId) throw new HululError('BAD_REQUEST', 'eventId is required');
  var event = getById('Events', p.eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');
  var library = event.inspectionCoId ? findWhere('TemplateLibrary', function (l) { return l.orgId === event.inspectionCoId; }) : [];
  var eventRows = findWhere('Templates', function (t) { return t.eventId === p.eventId; });
  var rowByLibId = {};
  eventRows.forEach(function (r) { if (r.libraryTemplateId) rowByLibId[r.libraryTemplateId] = r; });
  var libIds = {};
  library.forEach(function (l) { libIds[l.id] = true; });

  var merged = library.map(function (lib) {
    var row = rowByLibId[lib.id];
    if (row) return Object.assign({}, row, { libraryFileUrl: lib.fileUrl, libraryFileName: lib.fileName });
    return {
      id: '', eventId: p.eventId, libraryTemplateId: lib.id, name: lib.name, status: 'Not Sent',
      fileUrl: '', fileName: '', mimeType: '', sentBy: '', sentAt: '', uploadedBy: '', updatedAt: '',
      reviewedBy: '', reviewedAt: '', reviewReason: '', libraryFileUrl: lib.fileUrl, libraryFileName: lib.fileName
    };
  });
  // Historical safety net: a Templates row whose library entry was later removed still shows.
  eventRows.forEach(function (r) {
    if (r.libraryTemplateId && !libIds[r.libraryTemplateId]) merged.push(Object.assign({}, r, { libraryFileUrl: '', libraryFileName: '' }));
  });
  return merged;
}

// The Project Manager decides which library documents are relevant to this event and sends them —
// this is what actually materializes a Templates row (status 'Sent'), copying the library's
// CURRENT file as a locked-in snapshot. Sending something already sent is a harmless no-op.
function sendTemplates(user, p) {
  var event = getById('Events', p.eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');
  requireRole(user, [ROLES.PROJECT_MANAGER, ROLES.SYSTEM_ADMIN], event.inspectionCoId);
  if (!p.libraryTemplateIds || !p.libraryTemplateIds.length) throw new HululError('BAD_REQUEST', 'Select at least one template to send');
  // REQ: "No Template can be sent unless Deadline date time is set." -- mirrors the frontend's own
  // disabled-Send-button guard (see templateActionsHtml_ in eventDetail.js) so this can't be bypassed
  // by calling the API directly.
  if (!event.templatesDeadlineAt) throw new HululError('BAD_REQUEST', 'Set the documents deadline before sending any template');
  var sent = [];
  p.libraryTemplateIds.forEach(function (libId) {
    var already = findWhere('Templates', function (t) { return t.eventId === p.eventId && t.libraryTemplateId === libId; })[0];
    if (already) { sent.push(already); return; }
    var lib = getById('TemplateLibrary', libId);
    if (!lib) return;
    var row = {
      id: newId('Templates'), eventId: p.eventId, libraryTemplateId: libId, name: lib.name, status: 'Sent',
      fileUrl: lib.fileUrl, fileName: lib.fileName, mimeType: lib.mimeType, sentBy: user.id, sentAt: nowIso_(),
      uploadedBy: '', updatedAt: nowIso_(), reviewedBy: '', reviewedAt: '', reviewReason: '', createdAt: nowIso_()
    };
    insertRow('Templates', row);
    sent.push(row);
  });
  audit(user.id, 'SEND_TEMPLATES', 'Events', p.eventId, { count: sent.length });
  if (sent.length && event.eventManagerId) {
    notify_(event.eventManagerId, 'TEMPLATES_SENT', sent.length + ' readiness template(s) sent for ' + event.name, 'Events', p.eventId, p.eventId);
  }
  return sent;
}

// Fires when the file link is clicked, to catch the "opens/downloads it" trigger without needing
// any in-app viewer — the files already live in Drive, so opening the link IS "viewing it online".
// Silently a no-op if the caller's role or the template's current status doesn't match one of the
// two tracked transitions (e.g. re-opening an already-Approved doc), so it's safe to call on every
// click without the frontend needing to reason about state first.
function openEventTemplate(user, p) {
  var tpl = getById('Templates', p.templateId);
  if (!tpl) throw new HululError('NOT_FOUND', 'Template not found');
  if ((templateUploaderRoles_().indexOf(user.role) !== -1 || user.role === ROLES.SYSTEM_ADMIN) && tpl.status === 'Sent') {
    updateRow('Templates', tpl.id, { status: 'In Progress', updatedAt: nowIso_() });
  } else if ((templateReviewerRoles_().indexOf(user.role) !== -1 || user.role === ROLES.SYSTEM_ADMIN) && tpl.status === 'Submitted') {
    updateRow('Templates', tpl.id, { status: 'Under Review', updatedAt: nowIso_() });
  }
  return getById('Templates', tpl.id);
}

// Event Manager replaces the sent copy with their completed version — either they downloaded,
// filled it out elsewhere, and are uploading the result, or they edited the same Drive file online
// and are re-uploading a fresh export. Doesn't change status by itself; only the explicit Submit
// action below does that.
function uploadEventTemplateFile(user, p) {
  var tpl = getById('Templates', p.templateId);
  if (!tpl) throw new HululError('NOT_FOUND', 'Template not found');
  requireRole(user, templateUploaderRoles_().concat([ROLES.SYSTEM_ADMIN]));
  if (['Sent', 'In Progress', 'Missed'].indexOf(tpl.status) === -1) {
    throw new HululError('BAD_REQUEST', 'This template can\'t be re-uploaded in its current status (' + tpl.status + ')');
  }
  if (!p.fileBase64) throw new HululError('BAD_REQUEST', 'fileBase64 is required');
  var event = getById('Events', tpl.eventId);
  var uploaded = uploadTemplateFile_(event ? event.inspectionCoId : 'General', p.fileBase64, p.fileName, p.mimeType);
  var updated = updateRow('Templates', tpl.id, {
    fileUrl: uploaded.fileUrl, fileName: uploaded.fileName, mimeType: p.mimeType || '', uploadedBy: user.id, updatedAt: nowIso_()
  });
  audit(user.id, 'UPLOAD_EVENT_TEMPLATE', 'Templates', tpl.id, {});
  return updated;
}

// The explicit "I'm done" action from the Event Manager — whether they just uploaded a completed
// file or filled the same Drive document online, clicking Submit is what moves this into the
// Inspection Analyst's queue.
function submitEventTemplate(user, p) {
  var tpl = getById('Templates', p.templateId);
  if (!tpl) throw new HululError('NOT_FOUND', 'Template not found');
  requireRole(user, templateUploaderRoles_().concat([ROLES.SYSTEM_ADMIN]));
  if (['Sent', 'In Progress', 'Missed'].indexOf(tpl.status) === -1) {
    throw new HululError('BAD_REQUEST', 'This template can\'t be submitted in its current status (' + tpl.status + ')');
  }
  if (!tpl.fileUrl) throw new HululError('BAD_REQUEST', 'Upload or complete this document before submitting');
  var updated = updateRow('Templates', tpl.id, { status: 'Submitted', updatedAt: nowIso_() });
  audit(user.id, 'SUBMIT_TEMPLATE', 'Templates', tpl.id, {});
  var event = getById('Events', tpl.eventId);
  if (event) notifyEventStakeholders_(event.id, 'TEMPLATE_SUBMITTED', tpl.name + ' submitted for review', 'Templates', tpl.id);
  return updated;
}

// Inspection Analyst's final call — always requires a reason, whether marking it Evaluated or
// Missed, so the Event Manager knows what was checked (or what to fix). Accepts from 'Submitted'
// too, in case the analyst decides without having triggered the auto Under-Review transition first
// (e.g. they already knew the content from a prior look).
function reviewEventTemplate(user, p) {
  var tpl = getById('Templates', p.templateId);
  if (!tpl) throw new HululError('NOT_FOUND', 'Template not found');
  requireRole(user, templateReviewerRoles_().concat([ROLES.SYSTEM_ADMIN]));
  if (['Submitted', 'Under Review'].indexOf(tpl.status) === -1) {
    throw new HululError('BAD_REQUEST', 'This template isn\'t awaiting review');
  }
  if (['Evaluated', 'Missed'].indexOf(p.decision) === -1) throw new HululError('BAD_REQUEST', 'decision must be Evaluated or Missed');
  if (!p.reason) throw new HululError('BAD_REQUEST', 'A reason is required');
  var updated = updateRow('Templates', tpl.id, {
    status: p.decision, reviewedBy: user.id, reviewedAt: nowIso_(), reviewReason: p.reason, updatedAt: nowIso_()
  });
  audit(user.id, 'REVIEW_TEMPLATE', 'Templates', tpl.id, { decision: p.decision });
  var event = getById('Events', tpl.eventId);
  if (event) notifyEventStakeholders_(event.id, 'TEMPLATE_' + p.decision.toUpperCase(), tpl.name + ' ' + p.decision.toLowerCase() + ': ' + p.reason, 'Templates', tpl.id);
  return updated;
}

// REQ: "PM must set one deadline for all documents, by date/time picker or by N weeks/days before
// event start." One event-wide deadline (Events.templatesDeadlineAt), not per-template -- deadlineAt
// is the already-computed absolute instant either way (see Utils.gs schema comment for why): the
// frontend either takes the picker's value directly or computes event.startDateTime minus the
// chosen offset, and sends the result here as a plain ISO string. This function just validates and
// stores it; it doesn't care which of the two ways the PM arrived at it.
function setTemplatesDeadline(user, p) {
  var event = getById('Events', p.eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');
  requireRole(user, [ROLES.PROJECT_MANAGER, ROLES.SYSTEM_ADMIN], event.inspectionCoId);
  if (!p.deadlineAt) throw new HululError('BAD_REQUEST', 'deadlineAt is required');
  var d = new Date(p.deadlineAt);
  if (isNaN(d)) throw new HululError('BAD_REQUEST', 'deadlineAt is not a valid date');
  var updated = updateRow('Events', p.eventId, { templatesDeadlineAt: d.toISOString() });
  audit(user.id, 'SET_TEMPLATES_DEADLINE', 'Events', p.eventId, { templatesDeadlineAt: d.toISOString() });
  return updated;
}

// REQ: "A document becomes Missed if the Event Manager does not submit before the deadline." Run
// every 30 min off the same trigger as the escalation engine (see scheduledEscalationCheck, Setup.gs)
// -- for every event whose templatesDeadlineAt has passed, any of its Templates rows still sitting at
// Sent/In Progress (i.e. never got as far as Submitted) flips to Missed. Deliberately excludes
// Submitted/Under Review -- the Event Manager DID submit on time, a slow reviewer afterward isn't
// their fault -- and excludes "Not Sent" library documents that were never sent to this event at all
// (nothing for the Event Manager to have submitted). Idempotent: only touches rows not already
// Missed, so re-running it (or the deadline being long past) doesn't re-notify every cycle.
function checkTemplateDeadlines() {
  var now = new Date();
  var overdueEventIds = {};
  findWhere('Events', function (e) { return e.templatesDeadlineAt && new Date(e.templatesDeadlineAt) <= now; })
    .forEach(function (e) { overdueEventIds[e.id] = true; });
  if (!Object.keys(overdueEventIds).length) return { missed: 0 };

  var missed = [];
  findWhere('Templates', function (t) { return overdueEventIds[t.eventId] && ['Sent', 'In Progress'].indexOf(t.status) !== -1; })
    .forEach(function (t) {
      updateRow('Templates', t.id, { status: 'Missed', reviewedBy: 'system', reviewedAt: nowIso_(), reviewReason: 'Deadline passed without submission', updatedAt: nowIso_() });
      missed.push(t);
    });

  missed.forEach(function (t) {
    audit('system', 'TEMPLATE_DEADLINE_MISSED', 'Templates', t.id, {});
    notifyEventStakeholders_(t.eventId, 'TEMPLATE_MISSED', t.name + ' missed its submission deadline', 'Templates', t.id);
  });
  return { missed: missed.length };
}

function getOrCreateFolder_(name) {
  var it = DriveApp.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(name);
}

// REQ-TPL-02: the fixed set of meeting types selectable when scheduling a meeting, in the order
// shown to the user -- spans the full inspection lifecycle from kickoff through close-out.
// Mirrored verbatim in meetings.js's own MEETING_TYPES (Apps Script has no shared-module import
// between backend/frontend files, so this is duplicated rather than referenced).
var MEETING_TYPES = [
  'Inspection Kick-off Meeting',
  'Inspection Planning Meeting',
  'Participant Coordination Meeting',
  'Pre-Inspection Briefing',
  'Daily Inspection Coordination Meeting',
  'Technical Review Meeting',
  'Non-Conformance Review Meeting',
  'Corrective Action Review Meeting',
  'Re-Inspection Planning Meeting',
  'Readiness Review Meeting',
  'Go / No-Go Recommendation Meeting',
  'Final Inspection Close-Out Meeting'
];

// Same 4 roles that may schedule/edit/delete a meeting -- kept as one function instead of repeating
// the array at every requireRole call site below. MUST stay a function (not a top-level var): Apps
// Script executes every file's top-level statements in filename order (T before U), so a top-level
// `var ... = ROLES.X` here would run before Utils.gs has defined ROLES and crash the entire backend
// on load (exact bug class fixed once already -- see "Fix: top-level ROLES reference crashing entire
// backend"). Wrapping in a function defers the ROLES lookup until requireRole() actually calls it,
// by which point every file has finished loading.
function meetingManageRoles_() {
  return [ROLES.SYSTEM_ADMIN, ROLES.INSPECTION_ADMIN, ROLES.PROJECT_MANAGER, ROLES.EMC_MANAGER];
}

// Cleans a raw To/Cc payload (array of Users.id) down to real, de-duplicated user ids -- silently
// drops anything blank, duplicated, or not an actual user instead of hard-failing the whole request,
// since a stale/removed user id in an old invite list shouldn't block scheduling or editing a meeting.
function meetingRecipientIds_(rawIds) {
  if (!Array.isArray(rawIds)) return [];
  var seen = {}, out = [];
  rawIds.forEach(function (id) {
    id = String(id || '').trim();
    if (!id || seen[id] || !getById('Users', id)) return;
    seen[id] = true;
    out.push(id);
  });
  return out;
}

// To and Cc are functionally identical inside HULUL's own in-app/email notification system (no
// header-level distinction once it's just a notify_() call) -- the split on the Meeting record
// itself is purely for the organizer's own record of who's a primary vs. cc'd invitee.
function notifyMeetingRecipients_(meeting, to, cc, verb) {
  var ids = Array.from(new Set(to.concat(cc)));
  if (!ids.length) return;
  var when = meeting.scheduledAt ? ' (' + meeting.scheduledAt + ')' : '';
  notify_(ids, 'MEETING_' + verb.toUpperCase(), 'Meeting ' + verb + ': ' + meeting.type + when, 'Meetings', meeting.id, meeting.eventId);
}

// REQ-TPL-02: schedule a meeting between Inspection Co, EMC Manager, Event Manager -- either against
// the whole Event, or (if subEventId is given) scoped to just that Sub-Event. `type` doubles as the
// meeting's Subject line -- MEETING_TYPES is offered as a picklist on the frontend, but any non-empty
// free text is accepted here too (REQ: "Meeting type as Subject & allow free text as well").
function scheduleKickoff(user, p) {
  requireRole(user, meetingManageRoles_());
  var subject = String(p.type || '').trim();
  if (!subject) throw new HululError('BAD_REQUEST', 'type/subject is required');
  if (p.subEventId) {
    var sub = getById('SubEvents', p.subEventId);
    if (!sub || sub.eventId !== p.eventId) throw new HululError('BAD_REQUEST', 'subEventId must belong to eventId');
  }
  var to = meetingRecipientIds_(p.to);
  var cc = meetingRecipientIds_(p.cc);
  var meeting = {
    id: newId('Meetings'), eventId: p.eventId, subEventId: p.subEventId || '', type: subject, scheduledAt: p.scheduledAt,
    toJson: JSON.stringify(to), ccJson: JSON.stringify(cc), meetingLink: String(p.meetingLink || '').trim(),
    notes: p.notes || '', status: 'Scheduled', createdBy: user.id, createdAt: nowIso_(), updatedBy: '', updatedAt: ''
  };
  insertRow('Meetings', meeting);
  audit(user.id, 'SCHEDULE_MEETING', 'Meetings', meeting.id, { type: subject });
  notifyMeetingRecipients_(meeting, to, cc, 'scheduled');
  return meeting;
}

// Edit an existing meeting -- every field is optional in the payload (only what's actually being
// changed needs to be sent); anything omitted keeps its current value, same "patch, don't replace"
// convention updateRow itself already follows one level down.
function updateMeeting(user, p) {
  requireRole(user, meetingManageRoles_());
  var existing = getById('Meetings', p.meetingId);
  if (!existing || existing.status === 'Deleted') throw new HululError('NOT_FOUND', 'Meeting not found');
  var eventId = p.eventId !== undefined ? p.eventId : existing.eventId;
  var subEventId = p.subEventId !== undefined ? p.subEventId : existing.subEventId;
  if (subEventId) {
    var sub = getById('SubEvents', subEventId);
    if (!sub || sub.eventId !== eventId) throw new HululError('BAD_REQUEST', 'subEventId must belong to eventId');
  }
  var subject = p.type !== undefined ? String(p.type || '').trim() : existing.type;
  if (!subject) throw new HululError('BAD_REQUEST', 'type/subject is required');
  var to = p.to !== undefined ? meetingRecipientIds_(p.to) : (JSON.parse(existing.toJson || '[]') || []);
  var cc = p.cc !== undefined ? meetingRecipientIds_(p.cc) : (JSON.parse(existing.ccJson || '[]') || []);
  var patch = {
    eventId: eventId, subEventId: subEventId || '', type: subject,
    scheduledAt: p.scheduledAt !== undefined ? p.scheduledAt : existing.scheduledAt,
    toJson: JSON.stringify(to), ccJson: JSON.stringify(cc),
    meetingLink: p.meetingLink !== undefined ? String(p.meetingLink || '').trim() : existing.meetingLink,
    notes: p.notes !== undefined ? p.notes : existing.notes,
    updatedBy: user.id, updatedAt: nowIso_()
  };
  var updated = updateRow('Meetings', p.meetingId, patch);
  audit(user.id, 'UPDATE_MEETING', 'Meetings', p.meetingId, { type: subject });
  notifyMeetingRecipients_(updated, to, cc, 'updated');
  return updated;
}

// Soft delete (status:'Deleted') -- same pattern as deleteChecklistItem: the row stays (so nothing
// that ever referenced it breaks), it's just excluded from listMeetings going forward.
function deleteMeeting(user, p) {
  requireRole(user, meetingManageRoles_());
  var existing = getById('Meetings', p.meetingId);
  if (!existing || existing.status === 'Deleted') throw new HululError('NOT_FOUND', 'Meeting not found');
  updateRow('Meetings', p.meetingId, { status: 'Deleted', updatedBy: user.id, updatedAt: nowIso_() });
  audit(user.id, 'DELETE_MEETING', 'Meetings', p.meetingId, {});
  return { deleted: true };
}

// Used by the Meetings page: with no eventId, returns every meeting under an Event visible to the
// caller (same visibility rule as listSubEvents/listEvents) so the page can show meetings across
// every Project/Venue/Event/Sub-Event in scope in one call instead of one round-trip per event.
// Soft-deleted meetings (status:'Deleted') are excluded by default -- pass p.includeDeleted:true to
// see them (not currently used by the frontend, but keeps the door open for a Trash view later,
// same shape as evidence.js's own soft-delete convention).
function listMeetings(user, p) {
  var visibleEventIds = {};
  listEvents(user, {}).forEach(function (e) { visibleEventIds[e.id] = true; });
  var all = getAll('Meetings').filter(function (m) { return visibleEventIds[m.eventId]; });
  if (!(p && p.includeDeleted)) all = all.filter(function (m) { return m.status !== 'Deleted'; });
  if (p && p.eventId) all = all.filter(function (m) { return m.eventId === p.eventId; });
  if (p && p.subEventId) all = all.filter(function (m) { return m.subEventId === p.subEventId; });
  return all;
}
