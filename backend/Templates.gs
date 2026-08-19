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
 *    templateReviewerRoles_ below, configurable from Settings > Permissions). A library update
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

// ---- Configurable process roles (Settings > Permissions -- 'template.upload'/'template.review') --
// REQ: "role assignments... Inspection Analyst and Event Manager, where I can change them and allow
// one or multiple role assignment." Who fills the Event-Manager step (upload/submit, and triggering
// the auto Sent->In Progress transition by opening the file) and who fills the Inspection-Analyst
// step (review/evaluate, and triggering the auto Submitted->Under Review transition) is admin-
// configurable via the ordinary Permissions CRUD matrix -- these used to be a separate, dedicated
// Settings > Process editor backed by their own Config-sheet keys, but that was folded into
// Permissions (REQ follow-up: "move items in the Process tab to Permissions tab") once the matrix
// existed to do the same job without a second parallel "who can do this" control.
function templateUploaderRoles_() {
  return effectivePermissionRoles_('template.upload', getPermissionOverrides_());
}
function templateReviewerRoles_() {
  return effectivePermissionRoles_('template.review', getPermissionOverrides_());
}

// Read-only, open to any authenticated user (same visibility as e.g. listVenues) -- the Templates
// tab needs this to know which action buttons to show a given user (see templateActionsHtml_,
// eventDetail.js). Not an admin edit surface itself -- editing happens in Settings > Permissions.
function getTemplateProcessRoles(user) {
  return { uploaderRoles: templateUploaderRoles_(), reviewerRoles: templateReviewerRoles_() };
}

/* ---------------- Template library (Inspection Admin) ---------------- */

// Any authenticated user can read their own org's library (needed to render the UI); SystemAdmin
// may pass p.orgId to look at a specific Inspection Company's library.
function listTemplateLibrary(user, p) {
  var orgId = (user.role === ROLES.SYSTEM_ADMIN && p && p.orgId) ? p.orgId : user.orgId;
  if (!orgId) return [];
  return findWhere('TemplateLibrary', function (l) { return l.orgId === orgId; });
}

// REQ follow-up: "convert the templates to forms and include evaluation process." docType (optional)
// tags which structured scoring catalog applies to documents sent from this library entry --
// blank/omitted keeps the old plain upload+review behavior exactly as it was before this feature
// existed. TEMPLATE_DOC_TYPES_ used to be a hard-coded enum a docType had to belong to -- that meant
// every genuinely new document type (REQ: "if a new template is added then a new form must also be
// created... how do I create new forms") needed a code change just to become selectable. It's now
// only a set of quick-pick SUGGESTIONS for the frontend's Form type dropdown (merged there with
// whatever docTypes already have an imported scoring catalog -- see listScoringCatalogSummary
// below); validation itself is just a format check via isValidDocTypeCode_, open to any code an org
// wants to use. importTemplateScoringCatalog (below) is how a brand-new docType actually gets its
// scoring form built, no code change required.
var TEMPLATE_DOC_TYPES_ = ['ZSMP', 'ZERP', 'TTP', 'CSM', 'SEC', 'Other'];
// Short administrative code, not free text -- letters/digits/underscore/hyphen only, 1-20 chars, so
// it stays safe to use as a lookup key (TemplateScoringItems.docType) and a URL-safe query param.
function isValidDocTypeCode_(code) {
  return typeof code === 'string' && /^[A-Za-z0-9_-]{1,20}$/.test(code);
}
function createLibraryTemplate(user, p) {
  requirePermission(user, 'templateLibrary.manage'); // RBAC pilot -- same default roles as before, no behavior change
  if (!p.name) throw new HululError('BAD_REQUEST', 'name is required');
  if (p.docType && !isValidDocTypeCode_(p.docType)) throw new HululError('BAD_REQUEST', 'docType must be 1-20 letters/digits/underscore/hyphen');
  var orgId = user.role === ROLES.SYSTEM_ADMIN ? (p.orgId || user.orgId) : user.orgId;
  if (!orgId) throw new HululError('BAD_REQUEST', 'orgId is required');
  var row = {
    id: newId('TemplateLibrary'), orgId: orgId, name: p.name, fileUrl: '', fileName: '', mimeType: '',
    uploadedBy: '', createdAt: nowIso_(), updatedAt: nowIso_(), docType: p.docType || ''
  };
  if (p.fileBase64) {
    var uploaded = uploadTemplateFile_(orgId, p.fileBase64, p.fileName, p.mimeType);
    row.fileUrl = uploaded.fileUrl; row.fileName = uploaded.fileName; row.mimeType = p.mimeType || ''; row.uploadedBy = user.id;
  }
  insertRow('TemplateLibrary', row);
  audit(user.id, 'CREATE_LIBRARY_TEMPLATE', 'TemplateLibrary', row.id, {});
  return row;
}

// Edits a library entry's own metadata (name/docType) -- separate from uploadLibraryTemplateVersion
// below, which only ever replaces the file. Lets an org retag an existing entry (e.g. their "Zone
// Safety Plan" upload as docType 'ZSMP') without needing to re-create it from scratch.
function updateLibraryTemplate(user, p) {
  requirePermission(user, 'templateLibrary.manage'); // RBAC pilot -- same default roles as before, no behavior change
  var lib = getById('TemplateLibrary', p.templateLibraryId);
  if (!lib) throw new HululError('NOT_FOUND', 'Template not found');
  if (user.role !== ROLES.SYSTEM_ADMIN && lib.orgId !== user.orgId) throw new HululError('FORBIDDEN', 'Not your organization\'s template');
  if (p.docType && !isValidDocTypeCode_(p.docType)) throw new HululError('BAD_REQUEST', 'docType must be 1-20 letters/digits/underscore/hyphen');
  var patch = { updatedAt: nowIso_() };
  if (p.name !== undefined) { if (!p.name) throw new HululError('BAD_REQUEST', 'name is required'); patch.name = p.name; }
  if (p.docType !== undefined) patch.docType = p.docType;
  var updated = updateRow('TemplateLibrary', lib.id, patch);
  audit(user.id, 'UPDATE_LIBRARY_TEMPLATE', 'TemplateLibrary', lib.id, {});
  return updated;
}

// Replaces the current file on a library template — this IS the versioning: there's only ever one
// current file per library entry, and uploading a newer one overwrites it. Events already sent the
// previous version keep their own locked copy (see Templates row snapshot, above).
function uploadLibraryTemplateVersion(user, p) {
  requirePermission(user, 'templateLibrary.manage'); // RBAC pilot -- same default roles as before, no behavior change
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
  // Lazy check so this reflects a just-passed deadline immediately on next page load, not only
  // after the next periodic sweep -- see processTemplateDeadlineTransition_'s own comment.
  processTemplateDeadlineTransition_(p.eventId);
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
      reviewedBy: '', reviewedAt: '', reviewReason: '', docType: lib.docType || '',
      libraryFileUrl: lib.fileUrl, libraryFileName: lib.fileName
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
  requirePermission(user, 'template.send', event.inspectionCoId); // RBAC pilot -- same default roles as before, no behavior change
  if (!p.libraryTemplateIds || !p.libraryTemplateIds.length) throw new HululError('BAD_REQUEST', 'Select at least one template to send');
  // REQ: "No Template can be sent unless Deadline date time is set." -- mirrors the frontend's own
  // disabled-Send-button guard (see templateActionsHtml_ in eventDetail.js) so this can't be bypassed
  // by calling the API directly.
  if (!event.templatesDeadlineAt) throw new HululError('BAD_REQUEST', 'Set the documents deadline before sending any template');
  // REQ: "Lock all documents no editing allowed no upload allowed" -- sending a new document is a
  // form of editing the event's document set, so it's blocked too while a version is locked.
  if (isTemplatesLocked_(p.eventId)) throw new HululError('FORBIDDEN', 'Documents are locked -- the current deadline has passed. A Project Manager can open a new version.');
  var sent = [];
  p.libraryTemplateIds.forEach(function (libId) {
    var already = findWhere('Templates', function (t) { return t.eventId === p.eventId && t.libraryTemplateId === libId; })[0];
    if (already) { sent.push(already); return; }
    var lib = getById('TemplateLibrary', libId);
    if (!lib) return;
    var row = {
      id: newId('Templates'), eventId: p.eventId, libraryTemplateId: libId, name: lib.name, status: 'Sent',
      fileUrl: lib.fileUrl, fileName: lib.fileName, mimeType: lib.mimeType, sentBy: user.id, sentAt: nowIso_(),
      uploadedBy: '', updatedAt: nowIso_(), reviewedBy: '', reviewedAt: '', reviewReason: '', createdAt: nowIso_(),
      // REQ follow-up: "convert the templates to forms and include evaluation process" -- locked-in
      // snapshot of the library entry's docType, same reasoning as the fileUrl/fileName/mimeType
      // snapshot just above (a later retag of the library entry shouldn't retroactively change which
      // scoring form an already-sent document uses).
      docType: lib.docType || ''
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
  if (hasPermissionRole_(user, 'template.upload') && tpl.status === 'Sent') {
    updateRow('Templates', tpl.id, { status: 'In Progress', updatedAt: nowIso_() });
  } else if (hasPermissionRole_(user, 'template.review') && tpl.status === 'Submitted') {
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
  requirePermission(user, 'template.upload');
  // REQ: "Lock all documents no editing allowed no upload allowed" once a deadline version's
  // deadline has passed.
  if (isTemplatesLocked_(tpl.eventId)) throw new HululError('FORBIDDEN', 'Documents are locked -- the current deadline has passed. A Project Manager can open a new version.');
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
  requirePermission(user, 'template.upload');
  if (isTemplatesLocked_(tpl.eventId)) throw new HululError('FORBIDDEN', 'Documents are locked -- the current deadline has passed. A Project Manager can open a new version.');
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
  requirePermission(user, 'template.review');
  if (isTemplatesLocked_(tpl.eventId)) throw new HululError('FORBIDDEN', 'Documents are locked -- the current deadline has passed. A Project Manager can open a new version.');
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

/* ---------------- Document Review scoring (REQ follow-up: "Can I convert the templates to forms
 * and include evaluation process as per attached file?") -----------------------------------------
 * Two-axis, item-level scoring an Inspection Analyst works through while a document sits at
 * Submitted/Under Review, ported from the GA26/JDCB "Document Review Tool" workbook: a Yes/No/N/A
 * Completeness checklist plus a 0-4 Quality review score per item, each item weighted by its own
 * Multiplier (TemplateScoringItems, seeded once via seedTemplateScoringItems in Setup.gs). This
 * sits ALONGSIDE the existing plain Evaluated/Missed decision above, not in place of it -- scoring
 * is optional working detail the analyst can save progressively; reviewEventTemplate is still the
 * one action that actually finalizes the document's status. Only wired up for docTypes that have a
 * seeded catalog (ZSMP, ZERP, TTP, CSM, SEC) -- any other docType (or a document sent before this
 * feature existed, docType '') has no scoring form, and the frontend falls back to plain
 * review-only, exactly as it always has.
 */

// Read-only, open to any authenticated user (same visibility as listChecklistItems) -- both the
// scoring form and a read-only viewer (e.g. the Event Manager checking progress) need this.
function listTemplateScoringItems(user, p) {
  if (!p || !p.docType) throw new HululError('BAD_REQUEST', 'docType is required');
  var items = findWhere('TemplateScoringItems', function (i) { return i.docType === p.docType && i.status !== 'Deleted'; });
  // itemCode sorts correctly as plain text here (e.g. '4.00.01' < '4.00.02' < '4.01.01') since every
  // segment in this catalog's source data is already zero-padded to two digits -- no numeric-aware
  // comparator needed, unlike an arbitrary user-typed sort key.
  return items.sort(function (a, b) { return a.itemCode < b.itemCode ? -1 : a.itemCode > b.itemCode ? 1 : 0; });
}

// Same read visibility as listTemplateScoringItems above -- the scoring form's two source calls are
// deliberately both open reads; only saving a score is gated (saveTemplateScoring below).
function getTemplateScoringResults(user, p) {
  if (!p || !p.templateId) throw new HululError('BAD_REQUEST', 'templateId is required');
  return findWhere('TemplateScoringResults', function (r) { return r.templateId === p.templateId; });
}

// Bulk upsert -- the whole form's current state is sent in one call (p.results: [{itemId,
// completeness, quality, remarks, detail}]), same "save everything currently on screen" shape as
// saveInspectionResults_'s own frontend caller (eventDetail.js), but one call instead of that
// function's own per-changed-row diffing since a Document Review form is expected to be worked
// through in a handful of sittings, not hundreds of items at once. Each entry independently upserts
// (existing itemId -> update in place, new -> insert) so a partial save (not every item scored yet)
// is completely normal, not an error -- matches the Completed Checklists flow's own "unset items
// stay open" convention.
function saveTemplateScoring(user, p) {
  var tpl = getById('Templates', p.templateId);
  if (!tpl) throw new HululError('NOT_FOUND', 'Template not found');
  requirePermission(user, 'template.review'); // same role as the final Evaluated/Missed decision
  // REQ follow-up: "Finalize closes score editing" -- a finalized form is read-only for everyone
  // (including whoever finalized it) until reopenTemplateScoring explicitly unlocks it again. The
  // frontend already disables every input once finalized, but this is the actual enforcement --
  // without it, a stale page tab left open from before finalizing could still silently overwrite a
  // signed-off document.
  if (tpl.scoringFinalizedAt) throw new HululError('BAD_REQUEST', 'This document\'s scoring has been finalized -- reopen it first to make changes');
  if (!p.results || !p.results.length) throw new HululError('BAD_REQUEST', 'results is required');
  var existing = findWhere('TemplateScoringResults', function (r) { return r.templateId === p.templateId; });
  var existingByItemId = {};
  existing.forEach(function (r) { existingByItemId[r.itemId] = r; });

  var saved = [];
  p.results.forEach(function (entry) {
    if (!entry.itemId) return;
    if (entry.completeness && ['Yes', 'No', 'N/A'].indexOf(entry.completeness) === -1) {
      throw new HululError('BAD_REQUEST', 'completeness must be Yes, No, or N/A');
    }
    if (entry.quality !== undefined && entry.quality !== '' && entry.quality !== null) {
      var q = Number(entry.quality);
      if (isNaN(q) || q < 0 || q > 4) throw new HululError('BAD_REQUEST', 'quality must be 0-4');
    }
    var patch = {
      completeness: entry.completeness || '', quality: (entry.quality === '' || entry.quality == null) ? '' : Number(entry.quality),
      remarks: entry.remarks || '', detail: entry.detail || '', recordedBy: user.id, recordedAt: nowIso_()
    };
    var row = existingByItemId[entry.itemId];
    if (row) { saved.push(updateRow('TemplateScoringResults', row.id, patch)); }
    else {
      var newRow = Object.assign({ id: newId('TemplateScoringResults'), templateId: p.templateId, itemId: entry.itemId }, patch);
      insertRow('TemplateScoringResults', newRow);
      saved.push(newRow);
    }
  });
  audit(user.id, 'SAVE_TEMPLATE_SCORING', 'Templates', p.templateId, { count: saved.length });
  return saved;
}

// Used by finalizeTemplateScoring's own completeness re-validation below -- "this docType's active
// catalog, plus this one template's saved answers, joined by itemId." getEventTemplatesScoringSummary/
// listEventScoringItems below do the same join across MULTIPLE templates at once and memoize the
// catalog fetch per docType (several templates in one event often share a docType), so they don't
// reuse this single-template version -- would just mean re-fetching the same catalog N times.
function templateScoringJoin_(tpl) {
  var items = findWhere('TemplateScoringItems', function (i) { return i.docType === tpl.docType && i.status !== 'Deleted'; });
  var results = findWhere('TemplateScoringResults', function (r) { return r.templateId === tpl.id; });
  var resultsByItemId = {};
  results.forEach(function (r) { resultsByItemId[r.itemId] = r; });
  return { items: items, resultsByItemId: resultsByItemId };
}

// REQ follow-up: "After all items are scored prompt to finalize instead of save. Finalize closes
// score editing." Reuses 'template.review' -- same role that can score a document can finalize it.
// Re-validates completeness server-side (every item must have an explicit Yes/No/N-A answer) rather
// than trusting the frontend's own 100%-complete gate, same "don't trust the client for the thing
// that actually matters" posture as every other state-transition guard in this app.
function finalizeTemplateScoring(user, p) {
  if (!p || !p.templateId) throw new HululError('BAD_REQUEST', 'templateId is required');
  var tpl = getById('Templates', p.templateId);
  if (!tpl) throw new HululError('NOT_FOUND', 'Template not found');
  requirePermission(user, 'template.review');
  if (tpl.scoringFinalizedAt) throw new HululError('BAD_REQUEST', 'Already finalized');
  var join = templateScoringJoin_(tpl);
  if (!join.items.length) throw new HululError('BAD_REQUEST', 'This document has no scoring form');
  var unscored = join.items.filter(function (it) {
    var r = join.resultsByItemId[it.id];
    return !r || !r.completeness;
  });
  if (unscored.length) throw new HululError('BAD_REQUEST', unscored.length + ' item(s) still need a Completeness answer before finalizing');
  var updated = updateRow('Templates', tpl.id, { scoringFinalizedAt: nowIso_(), scoringFinalizedBy: user.id });
  audit(user.id, 'FINALIZE_TEMPLATE_SCORING', 'Templates', tpl.id, {});
  return updated;
}

// Admin-only unlock (see 'template.reopenScoring', Permissions.gs) -- clears the two finalize fields
// so saveTemplateScoring's own guard above stops rejecting writes; doesn't touch any of the actual
// TemplateScoringResults rows, so every answer is exactly as it was left at finalize time.
function reopenTemplateScoring(user, p) {
  if (!p || !p.templateId) throw new HululError('BAD_REQUEST', 'templateId is required');
  var tpl = getById('Templates', p.templateId);
  if (!tpl) throw new HululError('NOT_FOUND', 'Template not found');
  requirePermission(user, 'template.reopenScoring');
  if (!tpl.scoringFinalizedAt) throw new HululError('BAD_REQUEST', 'This document is not finalized');
  var updated = updateRow('Templates', tpl.id, { scoringFinalizedAt: '', scoringFinalizedBy: '' });
  audit(user.id, 'REOPEN_TEMPLATE_SCORING', 'Templates', tpl.id, {});
  return updated;
}

// REQ: "Add a score column to Readiness Templates" (Completeness% + Quality%, plus finalize status).
// Computes both for every scored document in one call instead of the frontend re-fetching
// listTemplateScoringItems + getTemplateScoringResults once per template row (an event can have
// several -- ZSMP, ZERP, TTP...). Read-only, same open visibility as listTemplateScoringItems/
// getTemplateScoringResults themselves -- keyed by templateId for an O(1) frontend lookup per row.
// Percentages mirror the scoring form's own math exactly (updateTemplateScoringProgress_,
// eventDetail.js): Completeness excludes N/A and not-yet-answered items from both sides of the ratio;
// Quality's denominator is every item's own max (4 * multiplier) regardless of whether it's been
// scored yet. null (not 0) when nothing's answered yet, so the frontend can show "--" instead of a
// misleading "0%".
function getEventTemplatesScoringSummary(user, p) {
  if (!p || !p.eventId) throw new HululError('BAD_REQUEST', 'eventId is required');
  var templates = findWhere('Templates', function (t) { return t.eventId === p.eventId && t.docType; });
  var itemsByDocType = {};
  var out = {};
  templates.forEach(function (tpl) {
    if (!itemsByDocType[tpl.docType]) {
      itemsByDocType[tpl.docType] = findWhere('TemplateScoringItems', function (i) { return i.docType === tpl.docType && i.status !== 'Deleted'; });
    }
    var items = itemsByDocType[tpl.docType];
    if (!items.length) return; // no catalog for this docType -- nothing to score
    var results = findWhere('TemplateScoringResults', function (r) { return r.templateId === tpl.id; });
    var resultsByItemId = {};
    results.forEach(function (r) { resultsByItemId[r.itemId] = r; });
    var yes = 0, no = 0, qualityScore = 0, qualityMax = 0;
    items.forEach(function (it) {
      var r = resultsByItemId[it.id];
      var mult = Number(it.multiplier) || 0;
      qualityMax += 4 * mult;
      if (r && r.completeness === 'Yes') yes++;
      else if (r && r.completeness === 'No') no++;
      if (r && r.quality !== '' && r.quality != null) qualityScore += Number(r.quality) * mult;
    });
    out[tpl.id] = {
      templateId: tpl.id, itemCount: items.length,
      completenessPct: (yes + no) ? Math.round((yes / (yes + no)) * 100) : null,
      qualityPct: qualityMax ? Math.round((qualityScore / qualityMax) * 100) : null,
      finalizedAt: tpl.scoringFinalizedAt || '', finalizedBy: tpl.scoringFinalizedBy || ''
    };
  });
  return out;
}

// REQ follow-up: "Add Tab under Checklist name is score. Add to it template filter to narrow down
// items." -- one flat, read-only join across every scored document in the event (same "flatten it all
// so a filter dropdown can narrow it back down" shape as listCompletedChecklists) instead of the
// frontend making 2 calls PER template document just to build this table. itemCode sort matches
// listTemplateScoringItems' own convention (already zero-padded, plain string sort is correct).
function listEventScoringItems(user, p) {
  if (!p || !p.eventId) throw new HululError('BAD_REQUEST', 'eventId is required');
  var templates = findWhere('Templates', function (t) { return t.eventId === p.eventId && t.docType; });
  var itemsByDocType = {};
  var out = [];
  templates.forEach(function (tpl) {
    if (!itemsByDocType[tpl.docType]) {
      itemsByDocType[tpl.docType] = findWhere('TemplateScoringItems', function (i) { return i.docType === tpl.docType && i.status !== 'Deleted'; })
        .sort(function (a, b) { return a.itemCode < b.itemCode ? -1 : a.itemCode > b.itemCode ? 1 : 0; });
    }
    var items = itemsByDocType[tpl.docType];
    if (!items.length) return;
    var results = findWhere('TemplateScoringResults', function (r) { return r.templateId === tpl.id; });
    var resultsByItemId = {};
    results.forEach(function (r) { resultsByItemId[r.itemId] = r; });
    items.forEach(function (it) {
      var r = resultsByItemId[it.id];
      out.push({
        templateId: tpl.id, templateName: tpl.name, docType: tpl.docType,
        itemId: it.id, itemCode: it.itemCode, sectionCode: it.sectionCode, sectionName: it.sectionName,
        description: it.description, multiplier: it.multiplier,
        completeness: r ? r.completeness : '', quality: (r && r.quality !== '' && r.quality != null) ? r.quality : '',
        remarks: r ? r.remarks : '', detail: r ? r.detail : ''
      });
    });
  });
  return out;
}

// REQ follow-up: "if a new template is added then a new form must also be created -- how do I create
// new forms" -- builds a brand-new scoring catalog (or replaces an existing one) from a CSV instead
// of needing a code change every time, same shape as how ZSMP/ZERP/TTP/CSM/SEC were ported from the
// source workbook. Expected columns (header row required, matched case-insensitively, any order):
// sectionCode, sectionName, itemCode, description, multiplier. Rows missing itemCode or description
// are skipped and reported back rather than failing the whole import -- a hand-edited spreadsheet is
// rarely perfectly clean. Replacing an existing catalog soft-deletes (status: 'Deleted') its old rows
// rather than hard-deleting, same convention as Meetings' own soft delete, so past scoring results
// (TemplateScoringResults, keyed by itemId) don't silently point at a vanished row.
function importTemplateScoringCatalog(user, p) {
  requirePermission(user, 'templateLibrary.manage'); // same admin action as managing the library itself
  if (!p || !p.docType || !isValidDocTypeCode_(p.docType)) throw new HululError('BAD_REQUEST', 'docType must be 1-20 letters/digits/underscore/hyphen');
  if (!p.csvText) throw new HululError('BAD_REQUEST', 'csvText is required');
  var existing = findWhere('TemplateScoringItems', function (i) { return i.docType === p.docType && i.status !== 'Deleted'; });
  if (existing.length && !p.replace) {
    throw new HululError('BAD_REQUEST', 'This doc type already has ' + existing.length + ' item(s) -- pass replace:true to overwrite');
  }

  var rows;
  try { rows = Utilities.parseCsv(p.csvText); } catch (e) { throw new HululError('BAD_REQUEST', 'Could not parse CSV: ' + e.message); }
  if (!rows.length) throw new HululError('BAD_REQUEST', 'CSV is empty');
  var headers = rows[0].map(function (h) { return String(h || '').trim().toLowerCase(); });
  var col = function (name) { return headers.indexOf(name); };
  var idxSection = col('sectioncode'), idxSectionName = col('sectionname'), idxItem = col('itemcode'),
    idxDesc = col('description'), idxMult = col('multiplier');
  if (idxItem === -1 || idxDesc === -1) throw new HululError('BAD_REQUEST', 'CSV must have itemCode and description columns');

  if (p.replace) {
    existing.forEach(function (i) { updateRow('TemplateScoringItems', i.id, { status: 'Deleted' }); });
  }

  var imported = 0, skipped = [];
  for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    if (!row || row.join('').trim() === '') continue;
    var itemCode = String(row[idxItem] || '').trim();
    var description = String(row[idxDesc] || '').trim();
    if (!itemCode || !description) { skipped.push({ row: r + 1, reason: 'missing itemCode or description' }); continue; }
    var multiplier = idxMult !== -1 ? Number(row[idxMult]) : 1;
    if (isNaN(multiplier)) multiplier = 1;
    insertRow('TemplateScoringItems', {
      id: newId('TemplateScoringItems'), docType: p.docType,
      sectionCode: idxSection !== -1 ? String(row[idxSection] || '').trim() : '',
      sectionName: idxSectionName !== -1 ? String(row[idxSectionName] || '').trim() : '',
      itemCode: itemCode, description: description, multiplier: multiplier, sortOrder: imported, status: 'Active'
    });
    imported++;
  }
  audit(user.id, 'IMPORT_TEMPLATE_SCORING_CATALOG', 'TemplateScoringItems', p.docType, { imported: imported, skipped: skipped.length, replace: !!p.replace });
  return { docType: p.docType, imported: imported, skipped: skipped };
}

// Powers both the Score-button visibility check (the frontend no longer hardcodes which docTypes
// have a catalog -- see tabTemplates/templateActionsHtml_, eventDetail.js) and the Scoring Forms
// admin table (Template Library page) that lists every catalog and its item count. Read-only, same
// visibility as listTemplateScoringItems.
function listScoringCatalogSummary(user) {
  var counts = {};
  getAll('TemplateScoringItems').forEach(function (i) {
    if (i.status === 'Deleted') return;
    counts[i.docType] = (counts[i.docType] || 0) + 1;
  });
  return Object.keys(counts).sort().map(function (docType) { return { docType: docType, itemCount: counts[docType] }; });
}

/* ---------------- Documents deadline versioning (REQ) ------------------------------------------
 * "When Documents deadline (first version) is reached; Lock all documents no editing allowed no
 * upload allowed, reserve the status of the documents. Then create a second deadline one week
 * (configurable) after first version deadline; this becomes second version deadline. Once second
 * version deadline is reached; Lock all documents ... A third or fourth version deadline can be
 * created manually by responsible role. Readiness templates table should [show] which version we
 * are on now."
 *
 * TemplateDeadlineVersions holds one row per "round" for an event, versionNumber ascending. The
 * CURRENT version is always the highest versionNumber that exists; documents are LOCKED whenever
 * that version's own deadlineAt has already passed (isTemplatesLocked_ below) -- there is no
 * separate "locked" flag to keep in sync, it's purely derived from the clock.
 *
 * Version 1 is created by setTemplatesDeadline (unchanged entry point/permission). The moment
 * version 1's deadline passes, the system automatically creates version 2 (deadline = version 1's
 * deadline + templateDeadlineVersionGapDays_(), default 7) and reopens every document for it --
 * this is the ONE automatic chain (maybeAutoCreateVersion2_). Nothing auto-creates version 3+ ever;
 * once version 2 (or any later version) lapses, documents stay locked until a Project Manager/
 * SystemAdmin manually calls createNextTemplateDeadlineVersion.
 *
 * "Reserve the status of the documents" is implemented as a permanent historical snapshot
 * (TemplateVersionSnapshots) taken the moment each version's deadline passes, before the live
 * Templates row is reset to a fresh 'Sent' state for the next round -- see
 * snapshotOverdueVersionsIfNeeded_/resetTemplatesForNewVersion_. Nothing about a past version's
 * recorded file/status can change after the fact, even once later rounds overwrite the live row.
 */

var TEMPLATE_VERSION_GAP_DAYS_DEFAULT_ = 7;
function templateDeadlineVersionGapDays_() {
  var n = Number(getConfig('templateDeadlineVersionGapDays', TEMPLATE_VERSION_GAP_DAYS_DEFAULT_));
  return (isFinite(n) && n > 0) ? n : TEMPLATE_VERSION_GAP_DAYS_DEFAULT_;
}
// SystemAdmin-only, same posture as the generic Config admin routes (listConfig/setConfigEntry,
// Utils.gs) and escalationCheckIntervalMinutes_'s own config -- a global default, not per-event.
function getTemplateDeadlineVersionGapDays(user) {
  requireRole(user, [ROLES.SYSTEM_ADMIN]);
  return { gapDays: templateDeadlineVersionGapDays_() };
}
function setTemplateDeadlineVersionGapDays(user, p) {
  requireRole(user, [ROLES.SYSTEM_ADMIN]);
  var n = Number(p && p.gapDays);
  if (!Number.isFinite(n) || n < 1) throw new HululError('BAD_REQUEST', 'gapDays must be a whole number of 1 or more');
  n = Math.round(n);
  setConfig('templateDeadlineVersionGapDays', n);
  audit(user.id, 'SET_TEMPLATE_DEADLINE_VERSION_GAP_DAYS', 'Config', 'templateDeadlineVersionGapDays', { gapDays: n });
  return { gapDays: n };
}

function templateDeadlineVersionsForEvent_(eventId) {
  return findWhere('TemplateDeadlineVersions', function (v) { return v.eventId === eventId; })
    .sort(function (a, b) { return a.versionNumber - b.versionNumber; });
}

function isTemplatesLocked_(eventId) {
  var versions = templateDeadlineVersionsForEvent_(eventId);
  var latest = versions[versions.length - 1];
  return !!(latest && new Date(latest.deadlineAt) <= new Date());
}

// Archives every per-event Templates row's CURRENT state under `versionNumber`, once -- idempotent
// via checking for an existing snapshot per (templateId, versionNumber) pair, so calling it
// repeatedly (every lazy read below, plus the periodic sweep) never double-writes or overwrites an
// already-reserved record.
function snapshotOverdueVersionsIfNeeded_(eventId, versionNumber) {
  var already = {};
  findWhere('TemplateVersionSnapshots', function (s) { return s.eventId === eventId && Number(s.versionNumber) === Number(versionNumber); })
    .forEach(function (s) { already[s.templateId] = true; });
  findWhere('Templates', function (t) { return t.eventId === eventId; }).forEach(function (t) {
    if (already[t.id]) return;
    insertRow('TemplateVersionSnapshots', {
      id: newId('TemplateVersionSnapshots'), eventId: eventId, templateId: t.id, libraryTemplateId: t.libraryTemplateId,
      versionNumber: versionNumber, name: t.name, status: t.status, fileUrl: t.fileUrl, fileName: t.fileName,
      mimeType: t.mimeType, reviewedBy: t.reviewedBy, reviewedAt: t.reviewedAt, reviewReason: t.reviewReason,
      snapshotAt: nowIso_()
    });
  });
}

// Opens a fresh round: every per-event Templates row resets to 'Sent' with its file/review fields
// cleared, so the configured uploader role can start again for the new version. Only ever called
// immediately after snapshotOverdueVersionsIfNeeded_ has archived the version that just ended, so
// nothing about the prior round is ever lost -- it's just no longer the live copy.
function resetTemplatesForNewVersion_(eventId) {
  findWhere('Templates', function (t) { return t.eventId === eventId; }).forEach(function (t) {
    updateRow('Templates', t.id, {
      status: 'Sent', fileUrl: '', fileName: '', mimeType: '', uploadedBy: '',
      reviewedBy: '', reviewedAt: '', reviewReason: '', updatedAt: nowIso_()
    });
  });
}

// The ONE automatic chain: if version 1 is the only version that exists for this event and its
// deadline has passed, auto-create version 2 (deadline = version 1's deadline + the configured gap)
// and reopen every document for it. Idempotent -- only ever acts while exactly one version exists,
// so calling it again after version 2 exists (or before version 1's deadline arrives) is a no-op.
function maybeAutoCreateVersion2_(eventId) {
  var versions = templateDeadlineVersionsForEvent_(eventId);
  if (versions.length !== 1) return;
  var v1 = versions[0];
  if (new Date(v1.deadlineAt) > new Date()) return;
  snapshotOverdueVersionsIfNeeded_(eventId, v1.versionNumber);
  var v2DeadlineAt = new Date(new Date(v1.deadlineAt).getTime() + templateDeadlineVersionGapDays_() * 24 * 3600 * 1000).toISOString();
  insertRow('TemplateDeadlineVersions', {
    id: newId('TemplateDeadlineVersions'), eventId: eventId, versionNumber: 2, deadlineAt: v2DeadlineAt,
    autoCreated: true, createdBy: 'system', createdAt: nowIso_()
  });
  resetTemplatesForNewVersion_(eventId);
  updateRow('Events', eventId, { templatesDeadlineAt: v2DeadlineAt });
  var event = getById('Events', eventId);
  if (event) {
    notifyEventStakeholders_(eventId, 'TEMPLATES_VERSION_2_OPENED',
      'Documents deadline (version 1) passed for ' + event.name + ' -- version 2 opened automatically, new deadline: ' +
      Utilities.formatDate(new Date(v2DeadlineAt), Session.getScriptTimeZone(), 'MMM d, yyyy HH:mm'), 'Events', eventId);
  }
}

// Called at the top of every read that needs an up-to-date lock/version state (getEventTemplates,
// listTemplateDeadlineVersions) so a page load reflects a just-passed deadline immediately instead
// of waiting for the next periodic sweep (scheduledEscalationCheck, Setup.gs -- default every 5
// min). Both steps are idempotent, safe to call on every read.
function processTemplateDeadlineTransition_(eventId) {
  var latest = templateDeadlineVersionsForEvent_(eventId).slice(-1)[0];
  if (!latest || new Date(latest.deadlineAt) > new Date()) return;
  snapshotOverdueVersionsIfNeeded_(eventId, latest.versionNumber);
  maybeAutoCreateVersion2_(eventId);
}

// Read-only -- the Templates tab needs the full version list + which one is current + whether
// documents are currently locked. Open to any authenticated user, same visibility as
// getEventTemplates itself.
function listTemplateDeadlineVersions(user, p) {
  if (!p || !p.eventId) throw new HululError('BAD_REQUEST', 'eventId is required');
  processTemplateDeadlineTransition_(p.eventId);
  var versions = templateDeadlineVersionsForEvent_(p.eventId);
  var latest = versions[versions.length - 1] || null;
  return {
    versions: versions,
    currentVersionNumber: latest ? latest.versionNumber : 0,
    isLocked: isTemplatesLocked_(p.eventId),
    gapDays: templateDeadlineVersionGapDays_()
  };
}

// Read-only history viewer -- what every document's state was as of a given (or every) past
// version. Same visibility as listTemplateDeadlineVersions.
function listTemplateVersionSnapshots(user, p) {
  if (!p || !p.eventId) throw new HululError('BAD_REQUEST', 'eventId is required');
  var all = findWhere('TemplateVersionSnapshots', function (s) { return s.eventId === p.eventId; });
  if (p.versionNumber) all = all.filter(function (s) { return Number(s.versionNumber) === Number(p.versionNumber); });
  return all.sort(function (a, b) { return Number(a.versionNumber) - Number(b.versionNumber) || String(a.name).localeCompare(String(b.name)); });
}

// REQ: "PM must set one deadline for all documents, by date/time picker or by N weeks/days before
// event start." This endpoint only ever creates or edits VERSION 1 -- deadlineAt is the already-
// computed absolute instant either way (see Utils.gs schema comment for why): the frontend either
// takes the picker's value directly or computes event.startDateTime minus the chosen offset, and
// sends the result here as a plain ISO string. Once version 1's deadline has passed (or a version 2+
// already exists), use createNextTemplateDeadlineVersion instead -- this keeps "the very first
// deadline" and "every deadline after it" as two distinct, clearly-scoped actions.
function setTemplatesDeadline(user, p) {
  var event = getById('Events', p.eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');
  requirePermission(user, 'template.setDeadline', event.inspectionCoId); // RBAC pilot -- same default roles as before, no behavior change
  var versions = templateDeadlineVersionsForEvent_(p.eventId);
  if (versions.length > 1 || (versions.length === 1 && new Date(versions[0].deadlineAt) <= new Date())) {
    var latestExisting = versions[versions.length - 1];
    throw new HululError('BAD_REQUEST', 'The documents deadline is already on version ' + latestExisting.versionNumber + ' -- use "Create next version" to open a new round instead.');
  }
  if (!p.deadlineAt) throw new HululError('BAD_REQUEST', 'deadlineAt is required');
  var d = new Date(p.deadlineAt);
  if (isNaN(d)) throw new HululError('BAD_REQUEST', 'deadlineAt is not a valid date');
  if (versions.length === 1) {
    updateRow('TemplateDeadlineVersions', versions[0].id, { deadlineAt: d.toISOString() });
  } else {
    insertRow('TemplateDeadlineVersions', {
      id: newId('TemplateDeadlineVersions'), eventId: p.eventId, versionNumber: 1, deadlineAt: d.toISOString(),
      autoCreated: false, createdBy: user.id, createdAt: nowIso_()
    });
  }
  updateRow('Events', p.eventId, { templatesDeadlineAt: d.toISOString() });
  audit(user.id, 'SET_TEMPLATES_DEADLINE', 'Events', p.eventId, { templatesDeadlineAt: d.toISOString(), versionNumber: 1 });
  // checkTemplateDeadlines notifies once the deadline is blown; setting it in the first place was
  // silent, so an Event Manager could miss it with no warning at all.
  notifyEventStakeholders_(p.eventId, 'TEMPLATES_DEADLINE_SET',
    'Documents deadline set for ' + event.name + ': ' + Utilities.formatDate(d, Session.getScriptTimeZone(), 'MMM d, yyyy HH:mm'),
    'Events', p.eventId);
  return { deadlineAt: d.toISOString(), versionNumber: 1 };
}

// REQ: "A third or fourth version deadline can be created manually by responsible role." Same
// permission/role as setting the very first deadline ('template.setDeadline' -- Project Manager /
// SystemAdmin). Only usable once the current latest version's deadline has actually passed (i.e.
// documents are locked) -- this is deliberately an "unlock by opening a new round" action, not a way
// to pre-schedule future versions in advance.
function createNextTemplateDeadlineVersion(user, p) {
  var event = getById('Events', p.eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');
  requirePermission(user, 'template.setDeadline', event.inspectionCoId); // RBAC pilot -- same role as the 1st deadline, see REQ
  var versions = templateDeadlineVersionsForEvent_(p.eventId);
  if (!versions.length) throw new HululError('BAD_REQUEST', 'Set the first documents deadline before creating another version');
  var latest = versions[versions.length - 1];
  if (new Date(latest.deadlineAt) > new Date()) {
    throw new HululError('BAD_REQUEST', 'Version ' + latest.versionNumber + ' is still active -- a new version can only be created once its deadline has passed');
  }
  if (!p.deadlineAt) throw new HululError('BAD_REQUEST', 'deadlineAt is required');
  var d = new Date(p.deadlineAt);
  if (isNaN(d)) throw new HululError('BAD_REQUEST', 'deadlineAt is not a valid date');
  if (d <= new Date(latest.deadlineAt)) throw new HululError('BAD_REQUEST', 'The new deadline must be after version ' + latest.versionNumber + '\'s deadline');
  snapshotOverdueVersionsIfNeeded_(p.eventId, latest.versionNumber);
  var nextVersionNumber = latest.versionNumber + 1;
  var row = {
    id: newId('TemplateDeadlineVersions'), eventId: p.eventId, versionNumber: nextVersionNumber, deadlineAt: d.toISOString(),
    autoCreated: false, createdBy: user.id, createdAt: nowIso_()
  };
  insertRow('TemplateDeadlineVersions', row);
  resetTemplatesForNewVersion_(p.eventId);
  updateRow('Events', p.eventId, { templatesDeadlineAt: d.toISOString() });
  audit(user.id, 'CREATE_TEMPLATE_DEADLINE_VERSION', 'Events', p.eventId, { versionNumber: nextVersionNumber, deadlineAt: d.toISOString() });
  notifyEventStakeholders_(p.eventId, 'TEMPLATES_DEADLINE_SET',
    'Documents deadline (version ' + nextVersionNumber + ') set for ' + event.name + ': ' + Utilities.formatDate(d, Session.getScriptTimeZone(), 'MMM d, yyyy HH:mm'),
    'Events', p.eventId);
  return row;
}

// REQ: version-deadline lock/archive sweep -- run every few minutes off the same trigger as the
// escalation engine (see scheduledEscalationCheck, Setup.gs). For every event with at least one
// deadline version whose latest deadline has passed: archive the current per-event Templates state
// (idempotent, see snapshotOverdueVersionsIfNeeded_) and, if that was version 1, automatically open
// version 2 (maybeAutoCreateVersion2_). Anything at version 2+ simply stays locked -- no auto
// version 3+, per REQ ("can be created manually by responsible role"). Also covered lazily by
// processTemplateDeadlineTransition_ on every relevant read, so this sweep is a backstop for events
// nobody happens to view right after their deadline passes, not the only trigger for it.
function checkTemplateDeadlines() {
  var eventIds = Array.from(new Set(getAll('TemplateDeadlineVersions').map(function (v) { return v.eventId; })));
  var processed = 0;
  eventIds.forEach(function (eventId) {
    var latest = templateDeadlineVersionsForEvent_(eventId).slice(-1)[0];
    if (!latest || new Date(latest.deadlineAt) > new Date()) return;
    snapshotOverdueVersionsIfNeeded_(eventId, latest.versionNumber);
    maybeAutoCreateVersion2_(eventId);
    processed++;
  });
  return { eventsChecked: processed };
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

// Who may schedule/edit/delete a meeting -- RBAC pilot: admin-configurable via 'meeting.manage'
// (Settings > Permissions > Meetings), same default 4 roles this used to hardcode. (Superseded the
// old meetingManageRoles_() helper, which existed only to defer a ROLES.X lookup past Apps Script's
// alphabetical file-load order -- requirePermission's registry entry uses the same plain-string
// convention PERMISSION_REGISTRY_ already requires, so that workaround is no longer needed here.)

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
  requirePermission(user, 'meeting.manage'); // RBAC pilot -- same default roles as before, no behavior change
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
  requirePermission(user, 'meeting.manage'); // RBAC pilot -- same default roles as before, no behavior change
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
  requirePermission(user, 'meeting.manage'); // RBAC pilot -- same default roles as before, no behavior change
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
