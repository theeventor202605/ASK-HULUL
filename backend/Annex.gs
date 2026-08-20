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
    var required = !!(ov && (ov.required === true || ov.required === 'true'));
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
