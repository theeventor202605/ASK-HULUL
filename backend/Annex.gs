/**
 * HULUL - Annex.gs
 * Readiness > Annex: a fixed, seeded catalog of document categories (Risk Assessments / Sign-Offs
 * & Approvals / Certifications-TUVs-Supporting Records -- AnnexCategories, seeded once via
 * seedAnnexCategories_ in Setup.gs) against which the EMC Event Manager uploads documents
 * (AnnexDocuments, many-per-category), and the Inspection Company PM/Analyst marks each category
 * required, reviews (accepts/rejects) each uploaded document, marks a category "Provided" once
 * satisfied, and can ask the EMC for more information on a category.
 *
 * Merge pattern mirrors getEventTemplates (Templates.gs): AnnexCategories is the global catalog,
 * AnnexEventCategories holds only the per-event overrides that have actually been touched (required
 * flag set, status changed, or an info request raised) -- a category nobody has touched yet for this
 * event is synthesized as a virtual "not required, not provided" row rather than needing a real row
 * upfront for every event x category combination.
 */

// Internal: the real AnnexEventCategories override row for this event+category, or null if nobody's
// touched it yet (the caller is expected to synthesize the virtual defaults in that case).
function annexEventCategoryRow_(eventId, categoryId) {
  return findWhere('AnnexEventCategories', function (r) { return r.eventId === eventId && r.categoryId === categoryId; })[0] || null;
}

// Internal: upsert the override row for this event+category, creating it with virtual defaults on
// first touch. patch is shallow-merged over the existing/default fields.
function upsertAnnexEventCategory_(eventId, categoryId, patch) {
  var row = annexEventCategoryRow_(eventId, categoryId);
  if (row) return updateRow('AnnexEventCategories', row.id, patch);
  var base = {
    id: newId('AnnexEventCategories'), eventId: eventId, categoryId: categoryId,
    required: false, status: 'Not Provided', infoRequestNote: '', infoRequestedBy: '', infoRequestedAt: ''
  };
  return updateRow('AnnexEventCategories', insertRow('AnnexEventCategories', Object.assign(base, patch)).id, {});
}

// Read-only, open to any authenticated user (same visibility convention as getEventTemplates) --
// both the EMC's upload view and the PM/Analyst's review view call this one endpoint; the frontend
// decides what actions to show based on the caller's own permissions (annex.upload / annex.manage).
// Returns { categories: [...], summary: {...} }. Each category row carries its own documents array
// plus rollup counts so the frontend's "how many uploaded / how many missing from mandatory" table
// needs no extra round-trip.
function listEventAnnex(user, p) {
  if (!p || !p.eventId) throw new HululError('BAD_REQUEST', 'eventId is required');
  var event = getById('Events', p.eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');

  var catalog = findWhere('AnnexCategories', function (c) { return c.status !== 'Deleted'; })
    .sort(function (a, b) {
      if (a.section !== b.section) return a.section < b.section ? -1 : 1;
      return Number(a.orderIndex) - Number(b.orderIndex);
    });
  var overrides = findWhere('AnnexEventCategories', function (r) { return r.eventId === p.eventId; });
  var overrideByCatId = {};
  overrides.forEach(function (r) { overrideByCatId[r.categoryId] = r; });
  var docs = findWhere('AnnexDocuments', function (d) { return d.eventId === p.eventId; });
  var docsByCatId = {};
  docs.forEach(function (d) { (docsByCatId[d.categoryId] = docsByCatId[d.categoryId] || []).push(d); });

  var requiredCount = 0, providedCount = 0;
  var categories = catalog.map(function (cat) {
    var ov = overrideByCatId[cat.id];
    var catDocs = (docsByCatId[cat.id] || []).sort(function (a, b) { return a.uploadedAt < b.uploadedAt ? -1 : 1; });
    // REQ follow-up: "mark default required uploads" -- once a PM/Analyst has actually touched this
    // category for this event (setAnnexCategoryRequired -> a real AnnexEventCategories row exists),
    // their own explicit choice always wins, same as before. Only the still-virtual "nobody's touched
    // it yet" case now reads the catalog's own defaultRequired instead of hardcoding false, so an
    // admin can pre-mark a category mandatory once (Inspection Setup > Annex Categories) instead of
    // every PM re-checking the same box on every new event.
    var required = ov ? (ov.required === true || ov.required === 'true') : (cat.defaultRequired === true || cat.defaultRequired === 'true');
    var status = (ov && ov.status) || 'Not Provided';
    var acceptedCount = catDocs.filter(function (d) { return d.status === 'Accepted'; }).length;
    var pendingCount = catDocs.filter(function (d) { return d.status === 'Pending'; }).length;
    var rejectedCount = catDocs.filter(function (d) { return d.status === 'Rejected'; }).length;
    if (required) {
      requiredCount++;
      if (status === 'Provided') providedCount++;
    }
    return {
      categoryId: cat.id, section: cat.section, name: cat.name, orderIndex: Number(cat.orderIndex),
      required: required, status: status,
      infoRequestNote: (ov && ov.infoRequestNote) || '', infoRequestedBy: (ov && ov.infoRequestedBy) || '',
      infoRequestedAt: (ov && ov.infoRequestedAt) || '',
      documents: catDocs, uploadedCount: catDocs.length, acceptedCount: acceptedCount,
      pendingCount: pendingCount, rejectedCount: rejectedCount
    };
  });
  return {
    categories: categories,
    summary: { requiredCount: requiredCount, providedCount: providedCount, missingCount: requiredCount - providedCount }
  };
}

var ANNEX_SECTIONS_VALID_ = ['RiskAssessments', 'SignOffs', 'Certifications'];

// Admin listing for the Inspection Setup > Annex Categories page (annexCategories.js) -- REQ follow-
// up: "I would rather have this part of the inspection setup so the responsible person can make
// changes or add new categories and mark default required uploads." Unlike listEventAnnex (which
// only ever needs the active catalog merged against one event), this is the raw catalog itself, so
// the admin page can show and manage every row including soft-deleted ones (includeDeleted) -- same
// convention as listChecklistItems.
function listAnnexCategories(user, p) {
  var all = getAll('AnnexCategories').sort(function (a, b) {
    if (a.section !== b.section) return a.section < b.section ? -1 : 1;
    return Number(a.orderIndex) - Number(b.orderIndex);
  });
  return (p && p.includeDeleted) ? all : all.filter(function (c) { return c.status !== 'Deleted'; });
}

function annexCategoryDupKey_(section, name) {
  return String(section || '') + '|' + String(name || '').trim().toLowerCase();
}

function createAnnexCategory(user, p) {
  requirePermission(user, 'annex.manageCatalog');
  if (!p || !p.section || !p.name) throw new HululError('BAD_REQUEST', 'section and name are required');
  if (ANNEX_SECTIONS_VALID_.indexOf(p.section) === -1) throw new HululError('BAD_REQUEST', 'Invalid section');
  var key = annexCategoryDupKey_(p.section, p.name);
  var dup = findWhere('AnnexCategories', function (c) { return c.status !== 'Deleted' && annexCategoryDupKey_(c.section, c.name) === key; })[0];
  if (dup) throw new HululError('BAD_REQUEST', 'A category with this name already exists in this section.');
  var sectionRows = findWhere('AnnexCategories', function (c) { return c.section === p.section; });
  var maxOrder = sectionRows.reduce(function (max, c) { return Math.max(max, Number(c.orderIndex) || 0); }, 0);
  var row = {
    id: newId('AnnexCategories'), section: p.section, name: String(p.name).trim(),
    orderIndex: maxOrder + 1, status: 'Active', defaultRequired: !!p.defaultRequired
  };
  insertRow('AnnexCategories', row);
  audit(user.id, 'CREATE_ANNEX_CATEGORY', 'AnnexCategories', row.id, {});
  return row;
}

function updateAnnexCategory(user, p) {
  requirePermission(user, 'annex.manageCatalog');
  if (!p || !p.categoryId) throw new HululError('BAD_REQUEST', 'categoryId is required');
  var existing = getById('AnnexCategories', p.categoryId);
  if (!existing) throw new HululError('NOT_FOUND', 'Category not found');
  var section = p.section !== undefined ? p.section : existing.section;
  var name = p.name !== undefined ? String(p.name).trim() : existing.name;
  if (!section || !name) throw new HululError('BAD_REQUEST', 'section and name are required');
  if (ANNEX_SECTIONS_VALID_.indexOf(section) === -1) throw new HululError('BAD_REQUEST', 'Invalid section');
  var key = annexCategoryDupKey_(section, name);
  var dup = findWhere('AnnexCategories', function (c) { return c.id !== p.categoryId && c.status !== 'Deleted' && annexCategoryDupKey_(c.section, c.name) === key; })[0];
  if (dup) throw new HululError('BAD_REQUEST', 'A category with this name already exists in this section.');
  var patch = { section: section, name: name };
  if (p.defaultRequired !== undefined) patch.defaultRequired = !!p.defaultRequired;
  // Reactivating a soft-deleted row through the same "Active" toggle the admin page uses, rather than
  // needing a separate restore action -- same status-field-doubles-as-a-toggle convention Roles.gs
  // uses for custom roles.
  if (p.status !== undefined) patch.status = p.status === 'Deleted' ? 'Deleted' : 'Active';
  var updated = updateRow('AnnexCategories', p.categoryId, patch);
  audit(user.id, 'UPDATE_ANNEX_CATEGORY', 'AnnexCategories', p.categoryId, patch);
  return updated;
}

// Soft delete -- AnnexDocuments and AnnexEventCategories rows already uploaded/touched against this
// category stay exactly as they are (same "detach, don't destroy" precedent as deleteAnnexDocument
// further down and deleteFindingEvidence, Findings.gs); listEventAnnex's own catalog filter
// (status !== 'Deleted') is what actually hides it from every event going forward.
function deleteAnnexCategory(user, p) {
  requirePermission(user, 'annex.manageCatalog');
  if (!p || !p.categoryId) throw new HululError('BAD_REQUEST', 'categoryId is required');
  var existing = getById('AnnexCategories', p.categoryId);
  if (!existing) throw new HululError('NOT_FOUND', 'Category not found');
  if (existing.status === 'Deleted') throw new HululError('BAD_REQUEST', 'Category is already deleted');
  updateRow('AnnexCategories', p.categoryId, { status: 'Deleted' });
  audit(user.id, 'DELETE_ANNEX_CATEGORY', 'AnnexCategories', p.categoryId, {});
  return { ok: true };
}

// SystemAdmin-only, in-app trigger for seedAnnexCategories_ (Setup.gs). That seed only ever ran
// automatically as part of the full setupHulul() provisioning script, so any org whose spreadsheet
// was already live before the Annex feature shipped (task history: "Under readiness add 'Annex'")
// never got it -- REQ bug report: "In Annex tab, I can not see an upload option" turned out to be an
// empty AnnexCategories catalog, not a permissions problem, and the admin reported they couldn't
// locate seedAnnexCategories_ in the Apps Script editor's function dropdown to run it by hand. Now
// surfaced as an empty-state bootstrap action on the Inspection Setup > Annex Categories admin page
// (annexCategories.js) instead of the per-event Annex tab -- REQ follow-up: "I would rather have this
// part of the inspection setup" -- since seeding/managing the catalog is a setup concern, not
// something tied to any one event. Gives SystemAdmin a one-click way to run the exact same
// (idempotent -- see its own no-op-if-existing-rows guard) seed from inside the app instead. Safe to
// leave in permanently: the admin page only ever shows the button that calls this when
// listAnnexCategories' own list is already empty, and the seed itself is a no-op once categories
// exist either way.
function runSeedAnnexCategories(user, p) {
  requirePermission(user, 'annex.manageCatalog'); // same audience as create/update/deleteAnnexCategory
  var before = getAll('AnnexCategories').length;
  seedAnnexCategories_();
  var after = getAll('AnnexCategories').length;
  audit(user.id, 'SEED_ANNEX_CATEGORIES', 'AnnexCategories', '', { seeded: after - before });
  return { seeded: after - before, total: after };
}

// PM/Analyst flags whether a category is mandatory for this event -- guides the EMC on what's
// actually required vs. optional-if-applicable (several categories are explicitly "where
// applicable" in the source catalog, so not every event needs every category).
function setAnnexCategoryRequired(user, p) {
  if (!p || !p.eventId || !p.categoryId) throw new HululError('BAD_REQUEST', 'eventId and categoryId are required');
  var event = getById('Events', p.eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');
  requirePermission(user, 'annex.manage');
  var category = getById('AnnexCategories', p.categoryId);
  if (!category) throw new HululError('NOT_FOUND', 'Annex category not found');
  var updated = upsertAnnexEventCategory_(p.eventId, p.categoryId, { required: !!p.required });
  audit(user.id, 'SET_ANNEX_CATEGORY_REQUIRED', 'AnnexEventCategories', updated.id, { eventId: p.eventId, categoryId: p.categoryId, required: !!p.required });
  return updated;
}

// EMC Event Manager uploads one document under a category -- many documents per category are
// expected (REQ: "an EMC manager can upload 10 documents under 'Event General Risk Assessment'"),
// so this always inserts a new AnnexDocuments row rather than replacing a prior upload. Mirrors
// uploadRoadmapItemAttachment (RoadmapPlans.gs)'s per-event Drive-folder upload mechanics exactly.
// A fresh upload also clears any open "more information" request on the category -- the EMC's new
// document is the response to that request.
function uploadAnnexDocument(user, p) {
  if (!p || !p.eventId || !p.categoryId) throw new HululError('BAD_REQUEST', 'eventId and categoryId are required');
  var event = getById('Events', p.eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');
  requirePermission(user, 'annex.upload');
  var category = getById('AnnexCategories', p.categoryId);
  if (!category) throw new HululError('NOT_FOUND', 'Annex category not found');
  if (!p.fileBase64) throw new HululError('BAD_REQUEST', 'fileBase64 is required');

  var folder = getOrCreateFolder_('HULUL Annex Documents - ' + event.id);
  var blob = Utilities.newBlob(Utilities.base64Decode(p.fileBase64), p.mimeType || 'application/octet-stream', p.fileName || 'document');
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  var row = insertRow('AnnexDocuments', {
    id: newId('AnnexDocuments'), eventId: p.eventId, categoryId: p.categoryId,
    fileUrl: file.getUrl(), fileName: p.fileName || file.getName(), mimeType: p.mimeType || '',
    uploadedBy: user.id, uploadedAt: nowIso_(), status: 'Pending',
    reviewedBy: '', reviewedAt: '', reviewComments: ''
  });

  var ov = annexEventCategoryRow_(p.eventId, p.categoryId);
  if (ov && ov.infoRequestNote) {
    upsertAnnexEventCategory_(p.eventId, p.categoryId, { infoRequestNote: '', infoRequestedBy: '', infoRequestedAt: '' });
  }
  audit(user.id, 'UPLOAD_ANNEX_DOCUMENT', 'AnnexDocuments', row.id, { eventId: p.eventId, categoryId: p.categoryId, fileName: row.fileName });
  notifyEventStakeholders_(event.id, 'ANNEX_DOCUMENT_UPLOADED', category.name + ': ' + row.fileName + ' uploaded', 'AnnexDocuments', row.id);
  return row;
}

// PM/Analyst's per-document call -- Accepted or Rejected, with an optional comment (e.g. why it was
// rejected). Does not by itself mark the category as Provided; see markAnnexCategoryProvided below
// for that explicit, separate step.
function reviewAnnexDocument(user, p) {
  if (!p || !p.documentId) throw new HululError('BAD_REQUEST', 'documentId is required');
  var doc = getById('AnnexDocuments', p.documentId);
  if (!doc) throw new HululError('NOT_FOUND', 'Document not found');
  var event = getById('Events', doc.eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');
  requirePermission(user, 'annex.manage');
  if (['Accepted', 'Rejected'].indexOf(p.decision) === -1) throw new HululError('BAD_REQUEST', 'decision must be Accepted or Rejected');
  var category = getById('AnnexCategories', doc.categoryId);
  var updated = updateRow('AnnexDocuments', doc.id, {
    status: p.decision, reviewedBy: user.id, reviewedAt: nowIso_(), reviewComments: p.reviewComments || ''
  });
  audit(user.id, 'REVIEW_ANNEX_DOCUMENT', 'AnnexDocuments', doc.id, { decision: p.decision });
  notifyEventStakeholders_(event.id, 'ANNEX_DOCUMENT_' + p.decision.toUpperCase(),
    (category ? category.name + ': ' : '') + doc.fileName + ' ' + p.decision.toLowerCase() + (p.reviewComments ? ' -- ' + p.reviewComments : ''),
    'AnnexDocuments', doc.id);
  return updated;
}

// PM/Analyst's explicit "this category is satisfied" (or un-satisfied, to reopen it) call --
// separate from accepting individual documents so a category can require several accepted documents
// together before the PM/Analyst is ready to sign it off as a whole. Marking Provided requires at
// least one Accepted document to exist for the category, to prevent an empty/no-document category
// being marked Provided by mistake.
function markAnnexCategoryProvided(user, p) {
  if (!p || !p.eventId || !p.categoryId) throw new HululError('BAD_REQUEST', 'eventId and categoryId are required');
  var event = getById('Events', p.eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');
  requirePermission(user, 'annex.manage');
  var category = getById('AnnexCategories', p.categoryId);
  if (!category) throw new HululError('NOT_FOUND', 'Annex category not found');
  var provided = !!p.provided;
  if (provided) {
    var accepted = findWhere('AnnexDocuments', function (d) { return d.eventId === p.eventId && d.categoryId === p.categoryId && d.status === 'Accepted'; });
    if (!accepted.length) throw new HululError('BAD_REQUEST', 'Accept at least one document before marking this category as provided');
  }
  var patch = { status: provided ? 'Provided' : 'Not Provided' };
  if (provided) { patch.infoRequestNote = ''; patch.infoRequestedBy = ''; patch.infoRequestedAt = ''; }
  var updated = upsertAnnexEventCategory_(p.eventId, p.categoryId, patch);
  audit(user.id, provided ? 'MARK_ANNEX_CATEGORY_PROVIDED' : 'REOPEN_ANNEX_CATEGORY', 'AnnexEventCategories', updated.id, { eventId: p.eventId, categoryId: p.categoryId });
  notifyEventStakeholders_(event.id, provided ? 'ANNEX_CATEGORY_PROVIDED' : 'ANNEX_CATEGORY_REOPENED', category.name + (provided ? ' marked as provided' : ' reopened'), 'AnnexEventCategories', updated.id);
  return updated;
}

// PM/Analyst asks the EMC for more information on a category -- a free-text note the EMC sees on
// that category (frontend renders it as a banner, same convention as reviewReason banners
// elsewhere). Cleared automatically the next time a document is uploaded to that category
// (uploadAnnexDocument above) or when the category is marked Provided.
function requestAnnexInfo(user, p) {
  if (!p || !p.eventId || !p.categoryId) throw new HululError('BAD_REQUEST', 'eventId and categoryId are required');
  var event = getById('Events', p.eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');
  requirePermission(user, 'annex.manage');
  if (!p.note) throw new HululError('BAD_REQUEST', 'note is required');
  var category = getById('AnnexCategories', p.categoryId);
  if (!category) throw new HululError('NOT_FOUND', 'Annex category not found');
  var updated = upsertAnnexEventCategory_(p.eventId, p.categoryId, { infoRequestNote: p.note, infoRequestedBy: user.id, infoRequestedAt: nowIso_() });
  audit(user.id, 'REQUEST_ANNEX_INFO', 'AnnexEventCategories', updated.id, { eventId: p.eventId, categoryId: p.categoryId });
  notifyEventStakeholders_(event.id, 'ANNEX_INFO_REQUESTED', category.name + ': more information requested -- ' + p.note, 'AnnexEventCategories', updated.id);
  return updated;
}

// Lets either the original uploader (annex.upload, only while the document hasn't been Accepted yet
// -- e.g. they uploaded the wrong file) or a PM/Analyst (annex.manage, any status) remove a document.
// Once a document is Accepted it can only be removed by a PM/Analyst, to prevent an EMC user from
// silently pulling evidence a decision was already based on.
function deleteAnnexDocument(user, p) {
  if (!p || !p.documentId) throw new HululError('BAD_REQUEST', 'documentId is required');
  var doc = getById('AnnexDocuments', p.documentId);
  if (!doc) throw new HululError('NOT_FOUND', 'Document not found');
  var canManage = hasPermissionRole_(user, 'annex.manage');
  var canDeleteOwn = hasPermissionRole_(user, 'annex.upload') && doc.uploadedBy === user.id && doc.status !== 'Accepted';
  if (!canManage && !canDeleteOwn) throw new HululError('FORBIDDEN', 'Not allowed to delete this document');
  deleteRow('AnnexDocuments', doc.id);
  audit(user.id, 'DELETE_ANNEX_DOCUMENT', 'AnnexDocuments', doc.id, { eventId: doc.eventId, categoryId: doc.categoryId, fileName: doc.fileName });
  return listEventAnnex(user, { eventId: doc.eventId });
}
