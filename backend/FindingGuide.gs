/**
 * HULUL - FindingGuide.gs
 * REQ: "Some inspectors are junior level and could use help. We have created a guide which should
 * give them a list of descriptions once they select the category and sub-category." Admin-maintained
 * reference catalogue (Setup.gs's seedFindingGuide_ seeds it once from the user's "Log Assistance
 * Guide" spreadsheet) of [category, subCategory, description, suggestion] rows. findings.js's New/
 * Edit Finding forms read this (via listFindingGuide) to suggest a pre-written Description +
 * Suggested Action once the inspector has picked a Discipline (category) and Checklist Type
 * (subCategory) -- see its own header comment. findingGuide.js (this module's admin page) lets a
 * SystemAdmin/InspectionAdmin maintain the catalogue going forward (add/edit/delete rows, CSV
 * import/export) without needing a code change every time.
 */

// Any authenticated user (junior Inspectors included) needs read access -- this is what powers the
// suggestion picker on the Log Finding form itself, not just the admin page.
function listFindingGuide() {
  return getAll('FindingGuide');
}

// Same dedup spirit as checklistItemDupKey_ (Inspections.gs) -- Category+Sub-Category+Description
// identifies a guide row; Suggestion isn't part of the key (editing just the suggestion text on an
// existing row is an update, not a new entry).
function findingGuideDupKey_(g) {
  return String(g.category || '').trim().toLowerCase() + '|' + String(g.subCategory || '').trim().toLowerCase() + '|' + String(g.description || '').trim().toLowerCase();
}

// REQ follow-up (verification): "Verify that ... Log Assistance Guide Category all are linked to
// Categories." Category is meant to be the Discipline's name, not a free-form string (findings.js's
// suggestion picker matches on this exact value, and updateDiscipline already cascades a Discipline
// rename into every FindingGuide row carrying the old name -- see that function's own header comment
// on why "the Category here should all be coming from the Categories page"). The frontend form
// (openFindingGuideForm_, findingGuide.js) already only offers a closed dropdown of live Disciplines
// names, but that's a UI convenience, not a security boundary -- this is the actual enforcement, so a
// direct API call or a CSV import can't sneak in a category that doesn't exist on /disciplines either.
function findingGuideValidCategory_(category) {
  return findWhere('Disciplines', function (d) { return d.name === category; }).length > 0;
}

function createFindingGuideEntry(user, p) {
  requirePermission(user, 'findingGuide.manage'); // RBAC pilot -- dedicated permission key, own page in the Permissions matrix
  ['category', 'subCategory', 'description'].forEach(function (f) {
    if (!p[f]) throw new HululError('BAD_REQUEST', f + ' is required');
  });
  if (!findingGuideValidCategory_(p.category)) throw new HululError('BAD_REQUEST', 'Category must match an existing Discipline (see the Categories page).');
  var row = { id: newId('FindingGuide'), category: p.category, subCategory: p.subCategory, description: p.description, suggestion: p.suggestion || '' };
  var key = findingGuideDupKey_(row);
  var dup = findWhere('FindingGuide', function (g) { return findingGuideDupKey_(g) === key; })[0];
  if (dup) throw new HululError('BAD_REQUEST', 'A guide entry with this Category, Sub-Category, and Description already exists.');
  insertRow('FindingGuide', row);
  audit(user.id, 'CREATE_FINDING_GUIDE_ENTRY', 'FindingGuide', row.id, {});
  return row;
}

// Bulk version of createFindingGuideEntry, used by the CSV import (findingGuide.js) -- same
// single-scan/single-batch-insert approach as bulkCreateChecklistItems (Inspections.gs), so a
// several-hundred-row import isn't one network round trip per row.
function bulkCreateFindingGuideEntries(user, p) {
  requirePermission(user, 'findingGuide.manage'); // RBAC pilot -- dedicated permission key, own page in the Permissions matrix
  var items = (p && p.items) || [];
  if (!items.length) return { created: [], createdCount: 0, failed: [] };

  var existingKeys = {};
  getAll('FindingGuide').forEach(function (g) { existingKeys[findingGuideDupKey_(g)] = true; });
  // Same enforcement as create/updateFindingGuideEntry above -- checked once here (not per-row via
  // findingGuideValidCategory_) since a bulk import can be several hundred rows and Disciplines is
  // small/stable, so one getAll() + a lookup map is cheaper than one findWhere() scan per row.
  var validCategoryNames = {};
  getAll('Disciplines').forEach(function (d) { validCategoryNames[d.name] = true; });

  var failed = [];
  var toInsert = [];
  var batchKeys = {};
  items.forEach(function (raw) {
    var label = raw.description || raw.subCategory || '(unnamed)';
    var missing = ['category', 'subCategory', 'description'].filter(function (f) { return !raw[f]; });
    if (missing.length) {
      failed.push({ row: raw.row, name: label, reason: missing.join(', ') + ' required' });
      return;
    }
    if (!validCategoryNames[raw.category]) {
      failed.push({ row: raw.row, name: label, reason: 'Category "' + raw.category + '" doesn\'t match an existing Discipline name exactly (see the Categories page).' });
      return;
    }
    var row = { category: raw.category, subCategory: raw.subCategory, description: raw.description, suggestion: raw.suggestion || '' };
    var key = findingGuideDupKey_(row);
    if (existingKeys[key] || batchKeys[key]) {
      failed.push({ row: raw.row, name: label, reason: 'A guide entry with this Category, Sub-Category, and Description already exists.' });
      return;
    }
    batchKeys[key] = true;
    toInsert.push({ row: raw.row, name: label, data: row });
  });

  if (toInsert.length) {
    var ids = newIds('FindingGuide', toInsert.length);
    toInsert.forEach(function (entry, i) { entry.data.id = ids[i]; });
    insertRows('FindingGuide', toInsert.map(function (entry) { return entry.data; }));
    audit(user.id, 'BULK_CREATE_FINDING_GUIDE_ENTRIES', 'FindingGuide', '', { count: toInsert.length });
  }

  return {
    created: toInsert.map(function (entry) { return entry.name; }),
    createdCount: toInsert.length,
    failed: failed
  };
}

function updateFindingGuideEntry(user, p) {
  requirePermission(user, 'findingGuide.manage'); // RBAC pilot -- dedicated permission key, own page in the Permissions matrix
  var entry = getById('FindingGuide', p.entryId);
  if (!entry) throw new HululError('NOT_FOUND', 'Guide entry not found');
  var patch = {};
  ['category', 'subCategory', 'description', 'suggestion'].forEach(function (f) { if (p[f] !== undefined) patch[f] = p[f]; });
  ['category', 'subCategory', 'description'].forEach(function (f) {
    if (patch[f] !== undefined && !String(patch[f]).trim()) throw new HululError('BAD_REQUEST', f + ' is required');
  });
  if (patch.category !== undefined && !findingGuideValidCategory_(patch.category)) {
    throw new HululError('BAD_REQUEST', 'Category must match an existing Discipline (see the Categories page).');
  }
  var merged = Object.assign({}, entry, patch);
  var key = findingGuideDupKey_(merged);
  var dup = findWhere('FindingGuide', function (g) { return g.id !== p.entryId && findingGuideDupKey_(g) === key; })[0];
  if (dup) throw new HululError('BAD_REQUEST', 'A guide entry with this Category, Sub-Category, and Description already exists.');
  var updated = updateRow('FindingGuide', p.entryId, patch);
  audit(user.id, 'UPDATE_FINDING_GUIDE_ENTRY', 'FindingGuide', p.entryId, patch);
  return updated;
}

// Hard delete -- unlike ChecklistItems, no Finding/Inspection points at a FindingGuide row by id
// (findings.js only copies its text into the Description/Suggested Action fields at pick time), so
// there's nothing left dangling to soft-delete for.
function deleteFindingGuideEntry(user, p) {
  requirePermission(user, 'findingGuide.manage'); // RBAC pilot -- dedicated permission key, own page in the Permissions matrix
  var entry = getById('FindingGuide', p.entryId);
  if (!entry) throw new HululError('NOT_FOUND', 'Guide entry not found');
  deleteRow('FindingGuide', p.entryId);
  audit(user.id, 'DELETE_FINDING_GUIDE_ENTRY', 'FindingGuide', p.entryId, {});
  return { ok: true };
}
