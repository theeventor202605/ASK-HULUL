/**
 * HULUL - Setup.gs
 * Run setupHulul() ONCE from the Apps Script editor (select it in the function
 * dropdown, click Run) after binding this project to the "HULUL Database" Sheet.
 * It creates/repairs every sheet's headers, seeds reference data (disciplines,
 * checklist items), seeds a first System Admin, sets escalation config
 * defaults, and installs the time-driven escalation trigger.
 */

function setupHulul() {
  ensureAllSheets();
  seedDisciplines_();
  seedChecklistItems_();
  backfillFindingGuideDisciplines_();
  seedFindingGuide_();
  seedAnnexCategories_();
  seedConfig_();
  seedFirstAdmin_();
  installEscalationTrigger_();
  Logger.log('HULUL setup complete.');
}

// One-time cleanup: the Inspection/Report phase names changed from "Operational Readiness" /
// "Operational Inspection" to "Opening" / "Operational", and ChecklistItems.phase changed from
// "Readiness" to "Opening" (its "Operational" value is unchanged). Relabels any existing rows
// still holding the old names so historical data matches the new labels. Run once from the Apps
// Script editor's function dropdown after deploying — safe to re-run, matches nothing the second time.
function migratePhaseLabels() {
  var renames = { 'Operational Readiness': 'Opening', 'Operational Inspection': 'Operational' };
  var checklistItemRenames = { 'Readiness': 'Opening' };
  var updated = 0;
  getAll('Inspections').forEach(function (i) {
    if (renames[i.phase]) { updateRow('Inspections', i.id, { phase: renames[i.phase] }); updated++; }
  });
  getAll('Reports').forEach(function (r) {
    if (renames[r.type]) { updateRow('Reports', r.id, { type: renames[r.type] }); updated++; }
  });
  getAll('ChecklistItems').forEach(function (c) {
    if (checklistItemRenames[c.phase]) { updateRow('ChecklistItems', c.id, { phase: checklistItemRenames[c.phase] }); updated++; }
  });
  Logger.log('migratePhaseLabels: relabeled ' + updated + ' row(s).');
  return { updated: updated };
}

// One-time relabel: Templates.status "Approved"/"Rejected" renamed to "Evaluated"/"Missed" (see
// Templates.gs header comment). Existing rows already reviewed under the old names would otherwise
// vanish from the Readiness Templates Pipeline board, since its columns are now keyed by the new
// names and a stored "Approved"/"Rejected" row matches neither. Run once from the Apps Script
// editor's function dropdown after deploying -- safe to re-run, matches nothing the second time.
function migrateTemplateStatusLabels() {
  var renames = { 'Approved': 'Evaluated', 'Rejected': 'Missed' };
  var updated = 0;
  getAll('Templates').forEach(function (t) {
    if (renames[t.status]) { updateRow('Templates', t.id, { status: renames[t.status] }); updated++; }
  });
  Logger.log('migrateTemplateStatusLabels: relabeled ' + updated + ' row(s).');
  return { updated: updated };
}

// One-time fix for REQ bug report "the time saved is different from the one I picked": Google
// Sheets was silently auto-converting the literal wall-clock strings typed into every schedule
// picker (Events start/end, Sub-Events start/end, Meetings scheduled at, Inspections scheduled at)
// into real Date values, reinterpreted using the spreadsheet's own timezone instead of the
// browser's -- causing the stored/redisplayed time to drift whenever those two timezones differ.
// This locks every one of those columns to Plain Text (so it can't happen again going forward) and
// repairs any row that already drifted, recovering the exact original text. Run once from the Apps
// Script editor's function dropdown after redeploying -- safe to re-run, matches nothing once every
// column is already text.
function fixScheduledDateTimeDrift() {
  var fixed = ensureDateColumnsAreText_();
  Logger.log('fixScheduledDateTimeDrift: repaired ' + fixed + ' cell(s) and locked every schedule column to Plain Text.');
  return { fixed: fixed };
}

// One-time fix for REQ bug report "I checked Food & Beverage in Apply disciplines, but Construction
// Handover got saved instead": the Disciplines sheet had rows with duplicate ids (DIS-0002 shared by
// Health & Safety and Emergency & Response, DIS-0003 by Fire Safety and Universal Accessibility,
// DIS-0004 by Food & Beverage and Construction Handover) -- almost certainly from copying a row
// directly in the Google Sheet instead of using the "+ New discipline" button, which left the copy's
// id column unchanged. Every id-based lookup (disciplinesById in the frontend, getById on the
// backend) just returns whichever row was read last for that id, so the duplicate's name silently
// won even though the *stored* id on any participant/finding was, correctly, whichever discipline
// was actually meant. This keeps the FIRST row at each duplicated id untouched (so nothing already
// pointing at DIS-0002/0003/0004 changes what it resolves to) and reassigns every later row sharing
// that id a fresh, unique id via newId() -- those disciplines simply start with zero assignments
// going forward, since there was never a reliable way to tell whether a historical record meant the
// first discipline or the duplicate (they were, at the data level, indistinguishable). Run once from
// the Apps Script editor's function dropdown after redeploying -- safe to re-run, matches nothing
// once every id is unique. Going forward, always add disciplines via "+ New discipline", never by
// copying a row in the Sheet -- that's what guarantees a unique id.
function fixDuplicateDisciplineIds() {
  // Deliberately NOT using getById/updateRow here -- those look a row up BY id, which is exactly
  // what's ambiguous when two rows share one. Working on sheet row numbers directly instead, so each
  // duplicate is addressed individually regardless of what its id column currently says.
  var sh = sheet_('Disciplines');
  var headers = headerMap_('Disciplines');
  var idCol = headers.indexOf('id'), nameCol = headers.indexOf('name'), codeCol = headers.indexOf('code');
  var lastRow = sh.getLastRow();
  var fixed = [];
  if (lastRow >= 2) {
    var values = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
    var seen = {};
    for (var i = 0; i < values.length; i++) {
      var row = values[i];
      if (row.join('') === '') continue; // blank trailing row
      var oldId = row[idCol];
      if (!seen[oldId]) { seen[oldId] = true; continue; }
      var newRowId = newId('Disciplines');
      row[idCol] = newRowId;
      sh.getRange(i + 2, 1, 1, headers.length).setValues([row]);
      fixed.push({ name: row[nameCol], code: row[codeCol], oldId: oldId, newId: newRowId });
    }
  }
  if (fixed.length) invalidateCache_('Disciplines'); // direct sheet write above bypasses updateRow's own invalidation
  fixed.forEach(function (f) {
    Logger.log('fixDuplicateDisciplineIds: "' + f.name + '" (' + f.code + ') ' + f.oldId + ' -> ' + f.newId);
  });
  if (!fixed.length) Logger.log('fixDuplicateDisciplineIds: no duplicate ids found.');
  return { fixed: fixed };
}

// One-time reconciliation (REQ follow-up bug report: "Transport & Traffic is showing as Traffic &
// Transport in the Checklist page! ... The Category in the Checklist page should all be coming from
// the Categories page!"). ChecklistItems.category and FindingGuide.category are plain string
// snapshots of a Discipline's name, not a live disciplineId foreign key (see updateDiscipline's own
// comment, Disciplines.gs, which now cascades a rename made THROUGH the app going forward) -- a
// discipline renamed directly in the spreadsheet, or a row typed in before a rename, is left stuck on
// the old text with no automatic way to notice. This only auto-fixes the narrow, safe case of a
// same-words-different-order mismatch (e.g. "Traffic & Transport" vs "Transport & Traffic") against
// the CURRENT live Disciplines catalog -- anything that isn't just a word-order difference is left
// alone rather than guessed at. Run once from the Apps Script editor's function dropdown; safe to
// re-run, changes nothing once every category string matches a live Discipline name.
function reconcileChecklistCategoryNames() {
  var disciplineNames = getAll('Disciplines').map(function (d) { return d.name; });
  var normalize_ = function (s) { return String(s || '').toLowerCase().split(/\s+/).filter(Boolean).sort().join(' '); };
  var byNormalized = {};
  disciplineNames.forEach(function (n) { byNormalized[normalize_(n)] = n; });
  var fixed = [];
  ['ChecklistItems', 'FindingGuide'].forEach(function (sheetName) {
    getAll(sheetName).forEach(function (row) {
      if (disciplineNames.indexOf(row.category) !== -1) return; // already matches a live Discipline exactly
      var match = byNormalized[normalize_(row.category)];
      if (match && match !== row.category) {
        updateRow(sheetName, row.id, { category: match });
        fixed.push({ sheet: sheetName, id: row.id, from: row.category, to: match });
      }
    });
  });
  fixed.forEach(function (f) { Logger.log('reconcileChecklistCategoryNames: ' + f.sheet + ' ' + f.id + ' "' + f.from + '" -> "' + f.to + '"'); });
  if (!fixed.length) Logger.log('reconcileChecklistCategoryNames: nothing to fix.');
  return { fixed: fixed };
}

// One-time migration: the old Readiness Templates model auto-created a fixed 5-type Templates row
// (ZSMP/ZERP/TTP/CSM/SEC) per event with no separate library. The new model splits that into a
// per-Inspection-Company TemplateLibrary (uploaded once, versioned) and per-event Templates rows
// that only exist once a Project Manager actually sends one. This seeds a TemplateLibrary entry
// per Inspection Company for the 5 legacy names, carrying over the most-recently-updated existing
// file for each (across that org's events) as the starting version, then links every existing
// Templates row to its matching library entry. Safe to re-run — entries that already exist (by
// org+name) are left alone, and rows already linked are skipped.
function migrateTemplateLibrary() {
  var LEGACY_NAMES = ['ZSMP', 'ZERP', 'TTP', 'CSM', 'SEC'];
  var events = getAll('Events');
  var eventById = {};
  events.forEach(function (e) { eventById[e.id] = e; });
  var orgIds = Array.from(new Set(events.map(function (e) { return e.inspectionCoId; }).filter(Boolean)));

  var libByKey = {};
  getAll('TemplateLibrary').forEach(function (l) { libByKey[l.orgId + '|' + l.name] = l; });

  var oldTemplates = getAll('Templates').filter(function (t) { return !t.libraryTemplateId; });
  var seeded = 0, linked = 0;

  orgIds.forEach(function (orgId) {
    LEGACY_NAMES.forEach(function (name) {
      var key = orgId + '|' + name;
      if (libByKey[key]) return;
      var candidates = oldTemplates.filter(function (t) {
        var ev = eventById[t.eventId];
        return ev && ev.inspectionCoId === orgId && t.type === name && t.fileUrl;
      }).sort(function (a, b) { return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0); });
      var latest = candidates[0];
      var row = {
        id: newId('TemplateLibrary'), orgId: orgId, name: name,
        fileUrl: latest ? latest.fileUrl : '', fileName: latest ? latest.fileName : '',
        mimeType: '', uploadedBy: latest ? latest.uploadedBy : '', createdAt: nowIso_(), updatedAt: nowIso_()
      };
      insertRow('TemplateLibrary', row);
      libByKey[key] = row;
      seeded++;
    });
  });

  oldTemplates.forEach(function (t) {
    var ev = eventById[t.eventId];
    if (!ev) return;
    var lib = libByKey[ev.inspectionCoId + '|' + t.type];
    if (!lib) return;
    updateRow('Templates', t.id, { libraryTemplateId: lib.id, name: t.type });
    linked++;
  });

  Logger.log('migrateTemplateLibrary: seeded ' + seeded + ' library entrie(s), linked ' + linked + ' existing template row(s).');
  return { seeded: seeded, linked: linked };
}

// One-time seed: the item-level scoring catalog behind the Document Review feature (REQ follow-up:
// "Can I convert the templates to forms and include evaluation process as per attached file?"),
// REQ bug report: "Screenshot shows document under review, but no score button" -- sendTemplates
// (Templates.gs) snapshots the library entry's docType onto the Templates row ONLY at send time, by
// design (so retagging a library entry later doesn't retroactively change an already-sent document's
// scoring form -- see the comment there). But that means any Templates row that was sent BEFORE its
// library entry got tagged with a Form Type is stuck with a blank docType forever, even after you go
// back and tag the library entry today. This one-time pass fixes exactly that: for every Templates
// row with no docType, look up its current library entry and copy today's docType across. Only
// touches rows that are still blank, so it won't clobber the deliberate snapshot-at-send behavior for
// anything sent after this fix (or after you've retagged and want a stale row updated once more, blank
// it in the sheet first). Run once from the Apps Script editor's function dropdown.
function backfillTemplateDocTypes() {
  var libById = {};
  getAll('TemplateLibrary').forEach(function (l) { libById[l.id] = l; });
  var updated = 0;
  getAll('Templates').forEach(function (t) {
    if (t.docType) return; // already has one -- respect the existing snapshot
    var lib = t.libraryTemplateId && libById[t.libraryTemplateId];
    if (lib && lib.docType) { updateRow('Templates', t.id, { docType: lib.docType }); updated++; }
  });
  Logger.log('backfillTemplateDocTypes: updated ' + updated + ' row(s).');
  return { updated: updated };
}

// One-time cleanup for the concurrent-request race fixed by withTemplateDeadlineLock_ (Templates.gs):
// the Readiness Templates tab fires getEventTemplates and listTemplateDeadlineVersions together, and
// both used to lazily archive/auto-open a just-passed deadline version without any locking -- if a
// deadline lapsed while both requests were in flight, each could pass the "does this already exist?"
// check before the other's insert landed, duplicate-writing an entire set of TemplateVersionSnapshots
// rows (every row in Version History showing up twice, exactly as reported) and, in the worst case, a
// duplicate TemplateDeadlineVersions row for the auto-opened version 2. This removes the duplicates:
// for TemplateVersionSnapshots, keeps the earliest row per (eventId, templateId, versionNumber); for
// TemplateDeadlineVersions, keeps the earliest row per (eventId, versionNumber). Idempotent -- safe to
// re-run, matches nothing once already deduped. Run once from the Apps Script editor's function
// dropdown after pushing the lock fix; check the Execution log for counts.
function dedupeTemplateDeadlineVersioningRows() {
  var removedSnapshots = 0, removedVersions = 0;

  var snapshots = getAll('TemplateVersionSnapshots').slice().sort(function (a, b) {
    return new Date(a.snapshotAt) - new Date(b.snapshotAt);
  });
  var seenSnap = {};
  snapshots.forEach(function (s) {
    var key = s.eventId + '|' + s.templateId + '|' + s.versionNumber;
    if (seenSnap[key]) { deleteRow('TemplateVersionSnapshots', s.id); removedSnapshots++; }
    else seenSnap[key] = true;
  });

  var versions = getAll('TemplateDeadlineVersions').slice().sort(function (a, b) {
    return new Date(a.createdAt) - new Date(b.createdAt);
  });
  var seenVer = {};
  versions.forEach(function (v) {
    var key = v.eventId + '|' + v.versionNumber;
    if (seenVer[key]) { deleteRow('TemplateDeadlineVersions', v.id); removedVersions++; }
    else seenVer[key] = true;
  });

  Logger.log('dedupeTemplateDeadlineVersioningRows: removed ' + removedSnapshots +
    ' duplicate TemplateVersionSnapshots row(s), ' + removedVersions + ' duplicate TemplateDeadlineVersions row(s).');
  return { removedSnapshots: removedSnapshots, removedVersions: removedVersions };
}

// Diagnostic for "backfillTemplateDocTypes: updated 0 row(s)" when a row is still visibly missing
// its Score button -- logs exactly why each docType-less Templates row wasn't (or couldn't be)
// backfilled, instead of guessing. Read-only, safe to run any time. Check the Execution log after
// running.
function debugTemplateDocTypeGaps() {
  var libById = {};
  getAll('TemplateLibrary').forEach(function (l) { libById[l.id] = l; });
  var events = {};
  getAll('Events').forEach(function (e) { events[e.id] = e.name; });

  var gaps = getAll('Templates').filter(function (t) { return !t.docType; });
  Logger.log('debugTemplateDocTypeGaps: ' + gaps.length + ' Templates row(s) with no docType.');
  gaps.forEach(function (t) {
    var lib = t.libraryTemplateId && libById[t.libraryTemplateId];
    var reason = !t.libraryTemplateId ? 'NO libraryTemplateId on this row (orphaned/legacy send)'
      : !lib ? 'libraryTemplateId "' + t.libraryTemplateId + '" does not match any TemplateLibrary row'
      : !lib.docType ? 'matched library row "' + lib.name + '" but its own docType is blank'
      : 'should have matched -- lib.docType="' + lib.docType + '" (unexpected, investigate)';
    Logger.log('  ' + t.id + ' | event="' + (events[t.eventId] || t.eventId) + '" | name="' + t.name +
      '" | status=' + t.status + ' | libraryTemplateId=' + (t.libraryTemplateId || '(none)') + ' | ' + reason);
  });
  return { gaps: gaps.length };
}

// debugTemplateDocTypeGaps traced every remaining gap back to the SAME root cause: Template Library
// is scoped per Inspection Company (orgId), and the docType/"Form type" tagging done from the UI
// (Template Library page > Edit) only ever touches whichever org is selected in that page's dropdown
// at the time. Every OTHER Inspection Company has its own separate library rows for the same doc
// types that were never tagged -- even though their name is literally "ZSMP"/"TTP"/etc. -- so their
// docType is genuinely blank, not a bug. This auto-tags any TemplateLibrary row whose name is an
// exact match for a scoring-catalog doc type (no need to click into every org's library one at a
// time), then re-runs backfillTemplateDocTypes so already-sent documents under every org pick it up
// in the same pass. Only touches rows/library entries still blank -- safe to re-run.
function backfillLibraryAndTemplateDocTypes() {
  var SCORED_DOC_TYPES_ = ['ZSMP', 'ZERP', 'TTP', 'CSM', 'SEC'];
  var libUpdated = 0;
  getAll('TemplateLibrary').forEach(function (l) {
    if (l.docType) return;
    if (SCORED_DOC_TYPES_.indexOf(l.name) !== -1) { updateRow('TemplateLibrary', l.id, { docType: l.name }); libUpdated++; }
  });
  var tplResult = backfillTemplateDocTypes();
  Logger.log('backfillLibraryAndTemplateDocTypes: tagged ' + libUpdated + ' library row(s), backfilled ' + tplResult.updated + ' Templates row(s).');
  return { libUpdated: libUpdated, templatesUpdated: tplResult.updated };
}

// REQ bug report: "There is no CSM Form Type in Templates Library!" -- the Crowd Management doc type
// was first coded as 'CMP' (matching the source workbook's own "Crowd Management" sheet name), but
// every real TemplateLibrary entry in this org is actually named "CSM", not "CMP" -- so the Form
// type dropdown offering "CMP" was never going to match anything real. Renamed to 'CSM' everywhere
// (TEMPLATE_DOC_TYPES_ in Templates.gs/templateLibrary.js, the SCORED_DOC_TYPES_ list right below in
// this file). Only needed if seedTemplateScoringItems already ran once under the old 'CMP' name
// before this fix -- renames any TemplateScoringItems/TemplateLibrary/Templates rows still tagged
// 'CMP' over to 'CSM'. Safe to run even if nothing is tagged 'CMP' yet (no-op).
function renameCmpDocTypeToCsm() {
  var renamed = { items: 0, library: 0, templates: 0 };
  getAll('TemplateScoringItems').forEach(function (i) {
    if (i.docType === 'CMP') { updateRow('TemplateScoringItems', i.id, { docType: 'CSM' }); renamed.items++; }
  });
  getAll('TemplateLibrary').forEach(function (l) {
    if (l.docType === 'CMP') { updateRow('TemplateLibrary', l.id, { docType: 'CSM' }); renamed.library++; }
  });
  getAll('Templates').forEach(function (t) {
    if (t.docType === 'CMP') { updateRow('Templates', t.id, { docType: 'CSM' }); renamed.templates++; }
  });
  Logger.log('renameCmpDocTypeToCsm: renamed ' + renamed.items + ' TemplateScoringItems, ' +
    renamed.library + ' TemplateLibrary, ' + renamed.templates + ' Templates row(s) from CMP to CSM.');
  return renamed;
}

// extracted verbatim (itemCode/sectionCode/sectionName/description/multiplier) from the GA26/JDCB
// "Document Review Tool" workbook's own ZSMP, ZERP, TTP, CSM, and SEC sheets. Run once from the Apps
// Script editor's function dropdown after deploying this feature. Idempotent per docType: if
// TemplateScoringItems already has any rows for a given docType, that docType is left alone and only
// re-seeds if you first delete its existing rows -- safe to re-run without duplicating on a second
// accidental click.
function seedTemplateScoringItems() {
  var existing = getAll('TemplateScoringItems');
  var existingDocTypes = {};
  existing.forEach(function (i) { existingDocTypes[i.docType] = true; });

  var seeded = 0;
  [['ZSMP', ZSMP_SEED_ITEMS_], ['ZERP', ZERP_SEED_ITEMS_], ['TTP', TTP_SEED_ITEMS_], ['CSM', CMP_SEED_ITEMS_], ['SEC', SEC_SEED_ITEMS_]].forEach(function (pair) {
    var docType = pair[0], items = pair[1];
    if (existingDocTypes[docType]) { Logger.log('seedTemplateScoringItems: ' + docType + ' already has rows, skipping.'); return; }
    items.forEach(function (it, idx) {
      insertRow('TemplateScoringItems', {
        id: newId('TemplateScoringItems'), docType: docType, sectionCode: it.sectionCode, sectionName: it.sectionName,
        itemCode: it.itemCode, description: it.description, multiplier: it.multiplier, sortOrder: idx, status: 'Active'
      });
      seeded++;
    });
  });
  Logger.log('seedTemplateScoringItems: seeded ' + seeded + ' item(s).');
  return { seeded: seeded };
}

// Source data for seedTemplateScoringItems above -- one entry per real scoring item (the workbook's
// own '<section>.00' rows are section HEADERS, not items, and are folded into sectionName/sectionCode
// on every real item instead of getting their own row here, matching ChecklistItems' flat category/
// phase convention rather than a separate Sections table).
var ZSMP_SEED_ITEMS_ = [
  { itemCode: '4.00.01', sectionCode: '4.00', sectionName: 'Third Party Sign Off', description: '3rd Party Sign Off - Civil Defense', multiplier: 1.0 },
  { itemCode: '4.00.02', sectionCode: '4.00', sectionName: 'Third Party Sign Off', description: '3rd Party Sign Off - Evacuation', multiplier: 1.0 },
  { itemCode: '4.00.03', sectionCode: '4.00', sectionName: 'Third Party Sign Off', description: '3rd Party Sign Off - Fire Safety', multiplier: 1.0 },
  { itemCode: '4.00.04', sectionCode: '4.00', sectionName: 'Third Party Sign Off', description: '3rd Party Sign Off - Electrical Installation', multiplier: 1.0 },
  { itemCode: '4.00.05', sectionCode: '4.00', sectionName: 'Third Party Sign Off', description: '3rd Party Sign Off - Temporary Structures', multiplier: 1.0 },
  { itemCode: '4.00.06', sectionCode: '4.00', sectionName: 'Third Party Sign Off', description: '3rd Party Sign Off - Rigging & AVL', multiplier: 1.0 },
  { itemCode: '4.00.07', sectionCode: '4.00', sectionName: 'Third Party Sign Off', description: '3rd Party Sign Off - F&B Booths/Trucks', multiplier: 1.0 },
  { itemCode: '4.00.08', sectionCode: '4.00', sectionName: 'Third Party Sign Off', description: 'Safety Certificate: Fire Retardancy for Fabrics', multiplier: 1.0 },
  { itemCode: '4.00.09', sectionCode: '4.00', sectionName: 'Third Party Sign Off', description: 'Safety Certificate: Trusses', multiplier: 1.0 },
  { itemCode: '4.00.10', sectionCode: '4.00', sectionName: 'Third Party Sign Off', description: 'Safety Certificate: Rides & Activations', multiplier: 1.0 },
  { itemCode: '4.01.02', sectionCode: '4.01', sectionName: 'Zone Organisational Structure', description: 'The ZSMP clearly describes the event.', multiplier: 0.75 },
  { itemCode: '4.01.03', sectionCode: '4.01', sectionName: 'Zone Organisational Structure', description: 'The ZSMP contains an up-to-date Event Schedule with details on operational timing and the various activities going on at the Event.', multiplier: 0.75 },
  { itemCode: '4.01.04', sectionCode: '4.01', sectionName: 'Zone Organisational Structure', description: 'The ZSMP embeds Zone Maps and Plans and a high quality site plan is uyloaded..', multiplier: 0.75 },
  { itemCode: '4.01.05', sectionCode: '4.01', sectionName: 'Zone Organisational Structure', description: 'The ZSMP embeds the EMC\'s information.', multiplier: 0.75 },
  { itemCode: '4.01.06', sectionCode: '4.01', sectionName: 'Zone Organisational Structure', description: 'The ZSMP embeds EMC Insurance Information.', multiplier: 0.75 },
  { itemCode: '4.01.07', sectionCode: '4.01', sectionName: 'Zone Organisational Structure', description: 'The Zone Organisational Structure Organogram is embedded in the ZSMP.', multiplier: 0.75 },
  { itemCode: '4.01.08', sectionCode: '4.01', sectionName: 'Zone Organisational Structure', description: 'The ZSMP contains a clear list of suppliers and their contact details.', multiplier: 0.5 },
  { itemCode: '4.01.09', sectionCode: '4.01', sectionName: 'Zone Organisational Structure', description: 'The ZSMP embeds a section on the Zone HSE management Structure.', multiplier: 2.0 },
  { itemCode: '4.01.10', sectionCode: '4.01', sectionName: 'Zone Organisational Structure', description: 'The ZSMP shows evidence of an appointed HSE Manager for the operational Phase.', multiplier: 3.0 },
  { itemCode: '4.01.11', sectionCode: '4.01', sectionName: 'Zone Organisational Structure', description: 'The ZSMP shows Overview information on the Event Control Room', multiplier: 1.0 },
  { itemCode: '4.02.01', sectionCode: '4.02', sectionName: 'Roles and Responsibilities', description: 'Roles and Responsibilities are defined on the level of: Event Owner', multiplier: 0.5 },
  { itemCode: '4.02.02', sectionCode: '4.02', sectionName: 'Roles and Responsibilities', description: 'Roles and Responsibilities are defined on the level of: EMC Project Manager', multiplier: 0.5 },
  { itemCode: '4.02.03', sectionCode: '4.02', sectionName: 'Roles and Responsibilities', description: 'Roles and Responsibilities are defined on the level of: Health & Safety Manager', multiplier: 4.0 },
  { itemCode: '4.02.04', sectionCode: '4.02', sectionName: 'Roles and Responsibilities', description: 'Roles and Responsibilities are defined on the level of: Crowd Safety Manager', multiplier: 1.5 },
  { itemCode: '4.02.05', sectionCode: '4.02', sectionName: 'Roles and Responsibilities', description: 'Roles and Responsibilities are defined on the level of: Security Manager', multiplier: 1.5 },
  { itemCode: '4.02.06', sectionCode: '4.02', sectionName: 'Roles and Responsibilities', description: 'Roles and Responsibilities are defined on the level of: Traffic & Transport Manager', multiplier: 1.5 },
  { itemCode: '4.02.07', sectionCode: '4.02', sectionName: 'Roles and Responsibilities', description: 'Roles and Responsibilities are defined on the level of: Control Room Manager', multiplier: 1.0 },
  { itemCode: '4.02.08', sectionCode: '4.02', sectionName: 'Roles and Responsibilities', description: 'Roles and Responsibilities are defined on the level of: Food Safety Manager', multiplier: 0.0 },
  { itemCode: '4.02.09', sectionCode: '4.02', sectionName: 'Roles and Responsibilities', description: 'Roles and Responsibilities are defined on the level of: Facility Manager', multiplier: 0.0 },
  { itemCode: '4.02.10', sectionCode: '4.02', sectionName: 'Roles and Responsibilities', description: 'Roles and Responsibilities are defined on the level of: Technical Production Manager', multiplier: 0.0 },
  { itemCode: '4.02.11', sectionCode: '4.02', sectionName: 'Roles and Responsibilities', description: 'Roles and Responsibilities are defined on the level of: Medical Manager', multiplier: 1.0 },
  { itemCode: '4.03.01', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The ZSMP embeds an overview of the different Risk Assessments for the Zone.', multiplier: 0.5 },
  { itemCode: '4.03.02', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The ZSMP embeds the General Event Risk Assessment for the Operational Phase.', multiplier: 0.5 },
  { itemCode: '4.03.03', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The General Event Risk Assessment clearly mentions the person responsible for the docment.', multiplier: 1.0 },
  { itemCode: '4.03.04', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The General Event Risk Assessment clearly mentions the date of assessment.', multiplier: 0.5 },
  { itemCode: '4.03.05', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The General Event Risk Assessment holds a section on Risk Identification.', multiplier: 0.5 },
  { itemCode: '4.03.06', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The General Event Risk Assessment holds a section on Risk Analysis (weight).', multiplier: 0.5 },
  { itemCode: '4.03.07', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The General Event Risk Assessment holds a section on Risk Priorisation.', multiplier: 0.5 },
  { itemCode: '4.03.09', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The ZSMP embeds the Fire Risk Assessment for the Operational Phase.', multiplier: 1.0 },
  { itemCode: '4.03.10', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The Fire Risk Assessment clearly mentions the person responsible for the document.', multiplier: 0.5 },
  { itemCode: '4.03.11', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The Fire Risk Assessment clearly mentions the date of assessment.', multiplier: 0.5 },
  { itemCode: '4.03.12', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The Fire Risk Assessment holds a section on Risk Identification.', multiplier: 0.5 },
  { itemCode: '4.03.13', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The Fire Risk Assessment holds a section on Risk Analysis (weight).', multiplier: 0.5 },
  { itemCode: '4.03.14', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The Fire Risk Assessment holds a section on Risk Priorisation.', multiplier: 0.5 },
  { itemCode: '4.03.15', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The ZSMP embeds a Medical Risk Assessment  for the Operational Phase.', multiplier: 0.25 },
  { itemCode: '4.03.16', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The Medical Risk Assessment clearly mentions the person responsible for the document.', multiplier: 0.125 },
  { itemCode: '4.03.17', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The Medical Risk Assessment clearly mentions the date of assessment.', multiplier: 0.125 },
  { itemCode: '4.03.18', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The Medical Risk Assessment holds a section on Risk Identification.', multiplier: 0.125 },
  { itemCode: '4.03.19', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The Medical Risk Assessment holds a section on Risk Analysis (weight).', multiplier: 0.125 },
  { itemCode: '4.03.20', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The Medical Risk Assessment holds a section on Risk Priorisation.', multiplier: 0.125 },
  { itemCode: '4.03.21', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The ZSMP embeds a Traffic & Transport Risk Assessment for the Operational Phase.', multiplier: 1.0 },
  { itemCode: '4.03.22', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The Traffic & Transport Risk Assessment clearly mentions the person responsible for the document.', multiplier: 0.5 },
  { itemCode: '4.03.23', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The Traffic & Transport Risk Assessment clearly mentions the date of assessment.', multiplier: 0.5 },
  { itemCode: '4.03.24', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The Traffic & Transport Risk Assessment holds a section on Risk Identification.', multiplier: 0.5 },
  { itemCode: '4.03.25', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The Traffic & Transport Risk Assessment holds a section on Risk Analysis (weight).', multiplier: 0.5 },
  { itemCode: '4.03.26', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The Traffic & Transport Risk Assessment holds a section on Risk Priorisation.', multiplier: 0.5 },
  { itemCode: '4.03.27', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The ZSMP embeds a Crowd Safety Risk Assessment for the Operational Phase.', multiplier: 1.0 },
  { itemCode: '4.03.28', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The Crowd Safety Risk Assessment clearly mentions the person responsible for the document.', multiplier: 0.5 },
  { itemCode: '4.03.29', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The Crowd Safety Risk Assessment clearly mentions the date of assessment.', multiplier: 0.5 },
  { itemCode: '4.03.30', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The Crowd Safety Risk Assessment holds a section on Risk Identification.', multiplier: 0.5 },
  { itemCode: '4.03.31', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The Crowd Safety Risk Assessment holds a section on Risk Analysis (weight).', multiplier: 0.5 },
  { itemCode: '4.03.32', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The Crowd Safety Risk Assessment holds a section on Risk Priorisation.', multiplier: 0.5 },
  { itemCode: '4.03.33', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The ZSMP embeds a Security Risk Assessment for the Operational Phase.', multiplier: 1.0 },
  { itemCode: '4.03.34', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The Security Risk Assessment clearly mentions the person responsible for the document.', multiplier: 0.5 },
  { itemCode: '4.03.35', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The Security Risk Assessment clearly mentions the date of assessment.', multiplier: 0.5 },
  { itemCode: '4.03.36', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The Security Risk Assessment holds a section on Risk Identification.', multiplier: 0.5 },
  { itemCode: '4.03.37', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The Security Risk Assessment holds a section on Risk Analysis (weight).', multiplier: 0.5 },
  { itemCode: '4.03.38', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The Security Risk Assessment holds a section on Risk Priorisation.', multiplier: 0.5 },
  { itemCode: '4.03.39', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The ZSMP embeds a Food Safety Risk Assessment for the Operational Phase.', multiplier: 0.5 },
  { itemCode: '4.03.40', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The Food Safety Risk Assessment clearly mentions the person responsible for the document.', multiplier: 0.5 },
  { itemCode: '4.03.41', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The Food Safety Risk Assessment clearly mentions the date of assessment.', multiplier: 0.5 },
  { itemCode: '4.03.42', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The Food Safety Risk Assessment holds a section on Risk Identification.', multiplier: 0.5 },
  { itemCode: '4.03.43', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The Food Safety Risk Assessment holds a section on Risk Analysis (weight).', multiplier: 0.5 },
  { itemCode: '4.03.44', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The Food Safety Risk Assessment holds a section on Risk Priorisation.', multiplier: 0.5 },
  { itemCode: '4.03.45', sectionCode: '4.03', sectionName: 'Event Risk Assessment', description: 'The ZSMP embeds a Summary of the Event\'s Risk Assessments.', multiplier: 1.0 },
  { itemCode: '4.04.03', sectionCode: '4.04', sectionName: 'Capacity', description: 'The ZSMP embeds an analysis of the Holding Capacity for the Zone as a whole.', multiplier: 1.25 },
  { itemCode: '4.04.04', sectionCode: '4.04', sectionName: 'Capacity', description: 'The ZSMP embeds an analysis of the Holding Capacity, for every significant subzone or building within the Zone and scope.', multiplier: 1.125 },
  { itemCode: '4.04.05', sectionCode: '4.04', sectionName: 'Capacity', description: 'The ZSMP embeds an analysis of the Emergency Exit Capacity, for the Zone as a whole.', multiplier: 1.25 },
  { itemCode: '4.04.06', sectionCode: '4.04', sectionName: 'Capacity', description: 'The ZSMP embeds an analysis of the Emergency Exit Capacity, for every significant subzone or building within the Zone and scope.', multiplier: 1.125 },
  { itemCode: '4.04.02', sectionCode: '4.04', sectionName: 'Capacity', description: 'The ZSMP embeds an analysis of the Calculated Theoretical Emergency Exit Time.', multiplier: 1.25 },
  { itemCode: '4.04.07', sectionCode: '4.04', sectionName: 'Capacity', description: 'The ZSMP embeds an overview of the different parts of the Capacity Study, for the Zone as a whole.', multiplier: 1.125 },
  { itemCode: '4.04.08', sectionCode: '4.04', sectionName: 'Capacity', description: 'The ZSMP embeds an overview of the different parts of the Capacity Study, for every significant subzone or building within the Zone and scope.', multiplier: 1.125 },
  { itemCode: '4.04.09', sectionCode: '4.04', sectionName: 'Capacity', description: 'The ZSMP embeds a conclusion and final number on capacity, for the Zone as a whole.', multiplier: 1.25 },
  { itemCode: '4.04.10', sectionCode: '4.04', sectionName: 'Capacity', description: 'The ZSMP embeds a conclusion and final number on capacity, for every significant subzone or building within the Zone and scope.', multiplier: 1.125 },
  { itemCode: '4.04.11', sectionCode: '4.04', sectionName: 'Capacity', description: 'The ZSMP embeds a clear procedure for overcrowding and potential overcrowding, based on set thresholds, for the zone as a whole.', multiplier: 1.125 },
  { itemCode: '4.04.12', sectionCode: '4.04', sectionName: 'Capacity', description: 'The ZSMP embeds a clear procedure for overcrowding and potential overcrowding, based on set thresholds, for every significant subzone or building within the Zone and scope.', multiplier: 1.125 },
  { itemCode: '4.04.13', sectionCode: '4.04', sectionName: 'Capacity', description: 'The ZSMP embeds a detailed methodology for capacity monitorig, for the zone as a whole.', multiplier: 1.125 },
  { itemCode: '4.04.14', sectionCode: '4.04', sectionName: 'Capacity', description: 'The ZSMP embeds a detailed methodology for capacity monitorig, for every significant subzone or building within the Zone and scope.', multiplier: 1.0 },
  { itemCode: '4.05.01', sectionCode: '4.05', sectionName: 'Site Management - Sanitary Facilities', description: 'The ZSMP embeds details on the location of sanitary facilites.', multiplier: 1.0 },
  { itemCode: '4.05.02', sectionCode: '4.05', sectionName: 'Site Management - Sanitary Facilities', description: 'The ZSMP embeds details on the number of sanitary facilities and the male/female ratio.', multiplier: 1.0 },
  { itemCode: '4.05.03', sectionCode: '4.05', sectionName: 'Site Management - Sanitary Facilities', description: 'The ZSMP embeds details on the cleaning management for sanitary facilities.', multiplier: 1.0 },
  { itemCode: '4.05.05', sectionCode: '4.05', sectionName: 'Site Management - Sanitary Facilities', description: 'The ZSMP makes reference to the cleaning plans and schedules for the venue', multiplier: 1.0 },
  { itemCode: '4.05.06', sectionCode: '4.05', sectionName: 'Site Management - Sanitary Facilities', description: 'The ZSMP makes reference to the preventive and planned maintenance and engineering services for plumbing services, HVAC, power supplies etc.', multiplier: 1.0 },
  { itemCode: '4.05.07', sectionCode: '4.05', sectionName: 'Site Management - Sanitary Facilities', description: 'The ZSMP makes reference to emergency repairs for engineering systems (resources and actions for repairing engineering systems of infrastructure in case of emergency situations)', multiplier: 1.0 },
  { itemCode: '4.06.01', sectionCode: '4.06', sectionName: 'Fire Safety Plan', description: 'The ZSMP embeds a Fire Risk Map.', multiplier: 0.5 },
  { itemCode: '4.06.02', sectionCode: '4.06', sectionName: 'Fire Safety Plan', description: 'The Fire Safety Plan provides details on the management (storage and use) of Liquified Petroleum Gas (LPG) at the venue.', multiplier: 1.0 },
  { itemCode: '4.06.03', sectionCode: '4.06', sectionName: 'Fire Safety Plan', description: 'The ZSMP embeds details on the location of the Deployment of Civil Defense.', multiplier: 0.5 },
  { itemCode: '4.06.04', sectionCode: '4.06', sectionName: 'Fire Safety Plan', description: 'The Fire Plan embeds the location of all the Fire Fighting Equipment on site, DOT plan/List, the plan embeds details on the type of equipment.', multiplier: 4.0 },
  { itemCode: '4.06.05', sectionCode: '4.06', sectionName: 'Fire Safety Plan', description: 'The Fire Plan embeds evidence of a procedure to initiate response to emerging fire or smoke.', multiplier: 0.5 },
  { itemCode: '4.06.06', sectionCode: '4.06', sectionName: 'Fire Safety Plan', description: 'The Fire Plan embeds evidence of competent staff to engage in a first intervention, and use of the fire fighting equipment in case of fire', multiplier: 0.5 },
  { itemCode: '4.06.07', sectionCode: '4.06', sectionName: 'Fire Safety Plan', description: 'The Fire Safety Plan contains the relevant fire certificates for the materials used in the construction of the venue', multiplier: 1.0 },
  { itemCode: '4.06.08', sectionCode: '4.06', sectionName: 'Fire Safety Plan', description: 'The ZSMP embeds the Zone\'s Evacuation Plan.', multiplier: 2.0 },
  { itemCode: '4.06.09', sectionCode: '4.06', sectionName: 'Fire Safety Plan', description: 'The ZSMP embeds details on the mandatory Evacuation Drill.', multiplier: 1.0 },
  { itemCode: '4.07.01', sectionCode: '4.07', sectionName: 'Medical Plan', description: 'The Medical Plan defines the entity responsible for the on-site medical coverage, the Medical Provider.', multiplier: 1.0 },
  { itemCode: '4.07.02', sectionCode: '4.07', sectionName: 'Medical Plan', description: 'The ZSMP embeds the SALEM tool results.', multiplier: 0.5 },
  { itemCode: '4.07.03', sectionCode: '4.07', sectionName: 'Medical Plan', description: 'A clear Organogram for the Medical Provider is embedded', multiplier: 0.5 },
  { itemCode: '4.07.04', sectionCode: '4.07', sectionName: 'Medical Plan', description: 'Roles and Responsibilities within the Medical Department are defined', multiplier: 0.5 },
  { itemCode: '4.07.05', sectionCode: '4.07', sectionName: 'Medical Plan', description: 'Roles and Responsibilities within the Medical Department are assigned', multiplier: 0.5 },
  { itemCode: '4.07.06', sectionCode: '4.07', sectionName: 'Medical Plan', description: 'Clear timing is defined for the major Milestones within the delivery of the Medical plan', multiplier: 0.5 },
  { itemCode: '4.07.07', sectionCode: '4.07', sectionName: 'Medical Plan', description: 'The Medical Plan defines the entity responsible for the off-site transfer of patients, the Ambulance Service.', multiplier: 1.0 },
  { itemCode: '4.07.08', sectionCode: '4.07', sectionName: 'Medical Plan', description: 'The Medical Plan embeds a section that defines how the Site Medical Provider communicates and coordinates with the Ambulance Service, the Red Crescent, for Off-Site patient transfers', multiplier: 1.0 },
  { itemCode: '4.07.09', sectionCode: '4.07', sectionName: 'Medical Plan', description: 'The Medical Plan gives a clear overview of the deployment of the Medical Staff, Field Hospitals, Treatment rooms, Ambulances and equipment.', multiplier: 1.0 },
  { itemCode: '4.07.10', sectionCode: '4.07', sectionName: 'Medical Plan', description: 'The Medical Plan contains a DOT plan clearly displaying the locations of medical units, first aid positions, ambulances and other medical provisions', multiplier: 1.0 },
  { itemCode: '4.07.11', sectionCode: '4.07', sectionName: 'Medical Plan', description: 'The Medical Plan contains the points of the nearest Medical Facilities with distance and travel time details.', multiplier: 1.0 },
  { itemCode: '4.08.01', sectionCode: '4.08', sectionName: 'Food Safety Plan', description: 'The Food Safety Plan embeds full details on all Food & Beverage facilities on site.', multiplier: 1.5 },
  { itemCode: '4.08.02', sectionCode: '4.08', sectionName: 'Food Safety Plan', description: 'The Food Safety Plan embeds rules on Employee Personal Hygiene', multiplier: 1.0 },
  { itemCode: '4.08.03', sectionCode: '4.08', sectionName: 'Food Safety Plan', description: 'The Food Safety Plan embeds rules on Chemical and Pesticides', multiplier: 1.0 },
  { itemCode: '4.08.04', sectionCode: '4.08', sectionName: 'Food Safety Plan', description: 'The Food Safety Plan embeds rules on Food Preparation, handling and storage', multiplier: 1.0 },
  { itemCode: '4.08.05', sectionCode: '4.08', sectionName: 'Food Safety Plan', description: 'The Food Safety Plan embeds rules on Food Trucks', multiplier: 0.5 },
  { itemCode: '4.09.01', sectionCode: '4.09', sectionName: 'Universal Accessibility', description: 'The ZSMP embeds provisions for \'Accessible People\' throughout the Customer Journey, Signage provisions are embedded for Parking Routes', multiplier: 0.3333333333333333 },
  { itemCode: '4.09.02', sectionCode: '4.09', sectionName: 'Universal Accessibility', description: 'The ZSMP embeds provisions for \'Accessible People\' throughout the Customer Journey, the number of available Accessibility Parking Spaces & Vehicle Bays is embedded', multiplier: 1.0 },
  { itemCode: '4.09.03', sectionCode: '4.09', sectionName: 'Universal Accessibility', description: 'The ZSMP embeds provisions for \'Accessible People\' throughout the Customer Journey, design provisions are embedded for Accessibility Parking Spaces & Vehicle Bays', multiplier: 0.3333333333333333 },
  { itemCode: '4.09.04', sectionCode: '4.09', sectionName: 'Universal Accessibility', description: 'The ZSMP embeds provisions for \'Accessible People\' throughout the Customer Journey, and design provisions are embedded for Accessibility Entry Procedure', multiplier: 0.3333333333333333 },
  { itemCode: '4.09.05', sectionCode: '4.09', sectionName: 'Universal Accessibility', description: 'The ZSMP embeds provisions for \'Accessible People\' throughout the Customer Journey, design provisions are embedded for Accessibility Sidewalks, Slopes and Ramps', multiplier: 0.3333333333333333 },
  { itemCode: '4.09.06', sectionCode: '4.09', sectionName: 'Universal Accessibility', description: 'The ZSMP embeds provisions for \'Accessible People\' throughout the Customer Journey, design provisions are embedded for Accessibility Information, Reception & Service Counters.', multiplier: 0.3333333333333333 },
  { itemCode: '4.09.07', sectionCode: '4.09', sectionName: 'Universal Accessibility', description: 'The ZSMP embeds provisions for \'Accessible People\' throughout the Customer Journey, design provisions are embedded for Accessibility Ablution areas and Prayer Rooms.', multiplier: 0.3333333333333333 },
  { itemCode: '4.09.08', sectionCode: '4.09', sectionName: 'Universal Accessibility', description: 'The ZSMP embeds provisions for \'Accessible People\' throughout the Customer Journey, design provisions are embedded for Accessibility Toilet Stalls.', multiplier: 0.3333333333333333 },
  { itemCode: '4.09.09', sectionCode: '4.09', sectionName: 'Universal Accessibility', description: 'The ZSMP embeds provisions for \'Accessible People\' throughout the Customer Journey, design provisions are embedded for Accessibility Viewing spaces.', multiplier: 0.3333333333333333 },
  { itemCode: '4.10.01', sectionCode: '4.10', sectionName: 'SFX, Fireworks & Pyrotechnics', description: 'The ZSMP contains information about the operators of the SFX.', multiplier: 1.0 },
  { itemCode: '4.10.02', sectionCode: '4.10', sectionName: 'SFX, Fireworks & Pyrotechnics', description: 'The ZSMP contains information about special effects such as show lasers, fog and hazers along with the controls in place for them.', multiplier: 0.75 },
  { itemCode: '4.10.04', sectionCode: '4.10', sectionName: 'SFX, Fireworks & Pyrotechnics', description: 'The ZSMP contains information about fireworks and pyrotechnics at the venue and the controls in place for them.', multiplier: 0.75 },
  { itemCode: '4.10.05', sectionCode: '4.10', sectionName: 'SFX, Fireworks & Pyrotechnics', description: 'The ZSMP contains information about the use of unmanned aerial vehicles and drones along with the site rules and controls in place for them.', multiplier: 1.0 },
  { itemCode: '4.11.01', sectionCode: '4.11', sectionName: 'Adverse Weather', description: 'The ZSMP embeds an Adverse Weather Plan.', multiplier: 0.75 },
  { itemCode: '4.12.01', sectionCode: '4.12', sectionName: 'Operational Plans', description: 'The ZSMP embeds an overview for the Traffic and Transport Plan.', multiplier: 0.25 },
  { itemCode: '4.12.02', sectionCode: '4.12', sectionName: 'Operational Plans', description: 'The ZSMP embeds an overview for the Crowd Management Plan.', multiplier: 0.25 },
  { itemCode: '4.12.03', sectionCode: '4.12', sectionName: 'Operational Plans', description: 'The ZSMP embeds an overview for the Security Management Plan.', multiplier: 0.25 },
  { itemCode: '4.13.01', sectionCode: '4.13', sectionName: 'General Site Conditions', description: 'The ZSMP describes arrangements for the welfare of staff at the venue', multiplier: 0.75 },
  { itemCode: '4.13.02', sectionCode: '4.13', sectionName: 'General Site Conditions', description: 'The ZSMP provides details of the location and number of prayers rooms scoped for the venue', multiplier: 0.75 },
  { itemCode: '4.13.03', sectionCode: '4.13', sectionName: 'General Site Conditions', description: 'The ZSMP describes arrangements for the mitigation of noise at the venue, such as monitoring of the noise levels and the required PPE for relevant staff (earplugs for those working near the stage)', multiplier: 0.75 },
  { itemCode: '4.13.04', sectionCode: '4.13', sectionName: 'General Site Conditions', description: 'The ZSMP describes arrangements for controlling noise levels during prayer times', multiplier: 1.0 },
  { itemCode: '4.13.05', sectionCode: '4.13', sectionName: 'General Site Conditions', description: 'The ZSMP contains information regarding structural calculations and sign-off', multiplier: 0.75 },
  { itemCode: '4.13.06', sectionCode: '4.13', sectionName: 'General Site Conditions', description: 'The ZSMP contains information regarding electrical safety requirements', multiplier: 0.75 },
  { itemCode: '4.13.07', sectionCode: '4.13', sectionName: 'General Site Conditions', description: 'The ZSMP clearly defines the process for incident reporting', multiplier: 0.75 },
  { itemCode: '4.13.08', sectionCode: '4.13', sectionName: 'General Site Conditions', description: 'The ZSMP clearly defines the process for lost property', multiplier: 0.5 },
  { itemCode: '4.13.09', sectionCode: '4.13', sectionName: 'General Site Conditions', description: 'The ZSMP contains a Pre-Opening Checklist (“Pre-doors”)', multiplier: 0.75 }
];

var ZERP_SEED_ITEMS_ = [
  { itemCode: '5.01.01', sectionCode: '5.01', sectionName: 'Zone Organisational Structure', description: 'The ZERP clearly describes the event.', multiplier: 1.0 },
  { itemCode: '5.01.02', sectionCode: '5.01', sectionName: 'Zone Organisational Structure', description: 'The ZERP contains an up-to-date Event Schedule with details on operational timing and the various activities going on at the Event.', multiplier: 0.5 },
  { itemCode: '5.01.03', sectionCode: '5.01', sectionName: 'Zone Organisational Structure', description: 'The ZERP embeds basic Zone Maps and Plans.', multiplier: 0.5 },
  { itemCode: '5.01.04', sectionCode: '5.01', sectionName: 'Zone Organisational Structure', description: 'The ZERP embeds the EMC\'s information.', multiplier: 0.5 },
  { itemCode: '5.01.05', sectionCode: '5.01', sectionName: 'Zone Organisational Structure', description: 'The ZERP embeds the Zone Organisational Structure Organogram.', multiplier: 1.0 },
  { itemCode: '5.02.01', sectionCode: '5.02', sectionName: 'Roles and Responsibilities', description: 'The ZERP clearly identifies the necessary Roles and Responsibilities.', multiplier: 1.5 },
  { itemCode: '5.02.02', sectionCode: '5.02', sectionName: 'Roles and Responsibilities', description: 'The ZERP assigns all minimal Responsabilites.', multiplier: 2.0 },
  { itemCode: '5.03.01', sectionCode: '5.03', sectionName: 'Event Control Team', description: 'The ZERP embeds a Control Room Organogram.', multiplier: 1.0 },
  { itemCode: '5.03.02', sectionCode: '5.03', sectionName: 'Event Control Team', description: 'The ZERP defines named individuals for all CORE members of the Event Control Team.', multiplier: 1.0 },
  { itemCode: '5.03.03', sectionCode: '5.03', sectionName: 'Event Control Team', description: 'The ZERP defines named individuals for all EXTENDED members of the Event Control Team.', multiplier: 1.0 },
  { itemCode: '5.03.04', sectionCode: '5.03', sectionName: 'Event Control Team', description: 'The ZERP defines the location and layout of the Event Control Room.', multiplier: 2.0 },
  { itemCode: '5.03.05', sectionCode: '5.03', sectionName: 'Event Control Team', description: 'The ZERP embeds detail on how Event Control Communicates and Coordinates.', multiplier: 2.0 },
  { itemCode: '5.03.06', sectionCode: '5.03', sectionName: 'Event Control Team', description: 'The ZERP embeds information on how radio communication is structured during event operation.', multiplier: 1.0 },
  { itemCode: '5.03.07', sectionCode: '5.03', sectionName: 'Event Control Team', description: 'The ZERP embeds specific information on how radio comms are structured during emergency response.', multiplier: 2.0 },
  { itemCode: '5.03.08', sectionCode: '5.03', sectionName: 'Event Control Team', description: 'The ZERP embeds information on how the radio fleet is managed and structured.', multiplier: 1.0 },
  { itemCode: '5.03.09', sectionCode: '5.03', sectionName: 'Event Control Team', description: 'The ZERP embeds information on the used terminology and radio codes.', multiplier: 0.5 },
  { itemCode: '5.04.01', sectionCode: '5.04', sectionName: 'Incident Notification', description: 'The ZERP embeds details on the incident notification process.', multiplier: 4.0 },
  { itemCode: '5.04.02', sectionCode: '5.04', sectionName: 'Incident Notification', description: 'The ZERP defines named individuals and their respective contacts for Off Hours Incident Notification.', multiplier: 1.0 },
  { itemCode: '5.05.01', sectionCode: '5.05', sectionName: 'Evacuation', description: 'The ZERP embeds detailed maps and information on Assembly points', multiplier: 1.5 },
  { itemCode: '5.05.02', sectionCode: '5.05', sectionName: 'Evacuation', description: 'The ZERP embeds detailed maps and information on Evacuation Routes.', multiplier: 1.5 },
  { itemCode: '5.05.03', sectionCode: '5.05', sectionName: 'Evacuation', description: 'The ZERP embeds detailed information on Emergency/Evacuation Signage.', multiplier: 1.25 },
  { itemCode: '5.05.04', sectionCode: '5.05', sectionName: 'Evacuation', description: 'The ZERP embeds a detailed Evacuation Plans for the Zone as a whole.', multiplier: 1.0 },
  { itemCode: '5.05.05', sectionCode: '5.05', sectionName: 'Evacuation', description: 'The ZERP embeds a detailed Evacuation Plans for every significant subzone or building within the Zone and scope.', multiplier: 1.0 },
  { itemCode: '5.05.06', sectionCode: '5.05', sectionName: 'Evacuation', description: 'The ZERP embeds a detailed action chart with actions to be taken in case of Emergency/Evacuation.', multiplier: 2.0 },
  { itemCode: '5.05.07', sectionCode: '5.05', sectionName: 'Evacuation', description: 'The ZERP embeds information on how staff is alarmed in case of evacuation or emergency.', multiplier: 1.0 },
  { itemCode: '5.05.08', sectionCode: '5.05', sectionName: 'Evacuation', description: 'The ZERP embeds information on how attendees are alarmed in case of evacuation or emergency.', multiplier: 1.0 },
  { itemCode: '5.05.09', sectionCode: '5.05', sectionName: 'Evacuation', description: 'The ZERP embeds information on the procedure to evacuate People with Disabilities.', multiplier: 1.0 },
  { itemCode: '5.06.01', sectionCode: '5.06', sectionName: 'Medical Incident Procedure', description: 'The ZERP embeds a detailed action chart with actions in case of Medical Incident, in line with the Medical Plan.', multiplier: 1.0 },
  { itemCode: '5.07.01', sectionCode: '5.07', sectionName: 'Lost Child/Missing Person Procedure', description: 'The ZERP embeds a detailed action chart with actions in case of Lost Child and Missing Person.', multiplier: 1.0 },
  { itemCode: '5.08.01', sectionCode: '5.08', sectionName: 'Harassment Procedure', description: 'The ZERP embeds a detailed action chart with actions in case of harassment.', multiplier: 1.0 },
  { itemCode: '5.09.01', sectionCode: '5.09', sectionName: 'Fire, Explosion, Smoke Procedure', description: 'The ZERP embeds a detailed action chart with actions in case of Fire, Explosion or Smoke; in line with the Fire Plan.', multiplier: 1.0 },
  { itemCode: '5.10.01', sectionCode: '5.10', sectionName: 'Show Stop Procedure', description: 'The ZERP embeds a detailed action chart with actions to be taken in case of Show Stop, Show Calm, and Show Pause.', multiplier: 1.0 },
  { itemCode: '5.11.01', sectionCode: '5.11', sectionName: 'Evacuation Procedure', description: 'The ZERP embeds a detailed action chart with actions to be taken in case of Evacuation.', multiplier: 1.0 },
  { itemCode: '5.12.01', sectionCode: '5.12', sectionName: 'Shelter In Place - Lock Down Procedure', description: 'The ZERP embeds a detailed action chart with actions in case of a Shelter in place or lockdown response.', multiplier: 1.0 },
  { itemCode: '5.13.01', sectionCode: '5.13', sectionName: 'Structural Collapse Procedure', description: 'The ZERP embeds a detailed action chart with actions to be taken in case of Structural Collapse.', multiplier: 1.0 },
  { itemCode: '5.14.01', sectionCode: '5.14', sectionName: 'Suspicious Object Procedure', description: 'The ZERP embeds a detailed action chart with actions in case of  a suspicious object.', multiplier: 1.0 },
  { itemCode: '5.15.01', sectionCode: '5.15', sectionName: 'Malfunction of Safety Critical Facilities Procedure', description: 'The ZERP embeds a detailed action chart with actions in case Safety Critical Infrastructure is lost.', multiplier: 1.0 },
  { itemCode: '5.16.01', sectionCode: '5.16', sectionName: 'Adverse Weather Procedure', description: 'The ZERP embeds a detailed action chart with actions to be taken in case of Adverse Weather.', multiplier: 1.0 },
  { itemCode: '5.17.01', sectionCode: '5.17', sectionName: 'Terror or Bomb Threat', description: 'The ZERP embeds a detailed action chart with actions in case of Terror or Bomb threat.', multiplier: 1.0 },
  { itemCode: '5.18.01', sectionCode: '5.18', sectionName: 'Public Announcements', description: 'The ZERP embeds a section that documents and defines public announcements, pre-recorded or to be made live, for the different applicable procedures', multiplier: 1.0 }
];

// extracted verbatim, same pattern as ZSMP/ZERP above -- from the 'Traffic & Transport' sheet
// (TTP), 'Crowd Management' sheet (docType 'CSM' -- your library entries use "CSM", not the
// workbook's own "CMP" abbreviation, so the seed pairing below uses 'CSM' even though this array is
// still named CMP_SEED_ITEMS_ after the source sheet), and 'Security Management' sheet (SEC) of the
// same workbook. Phase 2 per the original scoping note ("see the sibling TTP/CMP/SEC sheets in that
// same workbook for a future phase"). One source typo fixed: the "Accreditation Team" row under
// Perimeter Protection shared itemCode 3.03.02 with the row above it -- renumbered to 3.03.03.
var TTP_SEED_ITEMS_ = [
  { itemCode: '1.01.01', sectionCode: '1.01', sectionName: 'Organisation', description: 'A Traffic & Transport Company has been assigned, and the details are embedded in the TTP.', multiplier: 1.0 },
  { itemCode: '1.01.02', sectionCode: '1.01', sectionName: 'Organisation', description: 'A Named individual is appointed Traffic & Transport Manager.', multiplier: 1.0 },
  { itemCode: '1.01.03', sectionCode: '1.01', sectionName: 'Organisation', description: 'A clear Organogram is embedded.', multiplier: 1.0 },
  { itemCode: '1.01.04', sectionCode: '1.01', sectionName: 'Organisation', description: 'Roles and Responsibilitied within the Traffic and Transport Management are defined.', multiplier: 0.75 },
  { itemCode: '1.01.05', sectionCode: '1.01', sectionName: 'Organisation', description: 'Roles and Responsibilitied within the Traffic and Transport Management are assigned.', multiplier: 0.75 },
  { itemCode: '1.01.06', sectionCode: '1.01', sectionName: 'Organisation', description: 'Clear timing is defined for the major Milestones within the delivery of the Traffic & Trransport Plan.', multiplier: 1.0 },
  { itemCode: '1.02.01', sectionCode: '1.02', sectionName: 'Routes Ingress/Egress', description: 'A clear overview of Ingress Routes is given in the plan.', multiplier: 1.5 },
  { itemCode: '1.02.02', sectionCode: '1.02', sectionName: 'Routes Ingress/Egress', description: 'The plan embeds an overview of road closures (location, operating hours…).', multiplier: 1.0 },
  { itemCode: '1.02.03', sectionCode: '1.02', sectionName: 'Routes Ingress/Egress', description: 'The plan embeds an overview of vehicle checkpoints (location, operating hours…).', multiplier: 1.0 },
  { itemCode: '1.02.04', sectionCode: '1.02', sectionName: 'Routes Ingress/Egress', description: 'A clear overview of the site Points of Access is given in the plan.', multiplier: 1.0 },
  { itemCode: '1.02.05', sectionCode: '1.02', sectionName: 'Routes Ingress/Egress', description: 'Ingress Routes are further detaild for all applicable profiles and modes of traffic.', multiplier: 2.0 },
  { itemCode: '1.02.06', sectionCode: '1.02', sectionName: 'Routes Ingress/Egress', description: 'A clear overview of Egress Routes is given in the plan.', multiplier: 1.25 },
  { itemCode: '1.02.07', sectionCode: '1.02', sectionName: 'Routes Ingress/Egress', description: 'Egress Routes are further detailed for all applicable profiles and modes of traffic.', multiplier: 1.0 },
  { itemCode: '1.03.01', sectionCode: '1.03', sectionName: 'Parking', description: 'A clear overview of Parking location and capacity is given in the plan.', multiplier: 1.0 },
  { itemCode: '1.03.02', sectionCode: '1.03', sectionName: 'Parking', description: 'The plan embeds the method used to define parking capacity.', multiplier: 1.0 },
  { itemCode: '1.03.03', sectionCode: '1.03', sectionName: 'Parking', description: 'The plan shows in detail the layout of each parking, including capacity, dimensions, points of entry, flow of traffic, pedestrian routes, protective equipment...', multiplier: 1.0 },
  { itemCode: '1.03.04', sectionCode: '1.03', sectionName: 'Parking', description: 'The plan embeds a TTP staff DOT Plan for each parking area.', multiplier: 1.0 },
  { itemCode: '1.03.05', sectionCode: '1.03', sectionName: 'Parking', description: 'The plan embeds an overview of Staff deployment for the different parking areas.', multiplier: 1.0 },
  { itemCode: '1.03.06', sectionCode: '1.03', sectionName: 'Parking', description: 'The plan embeds an overview of equipment deployment for the different parking areas.', multiplier: 1.0 },
  { itemCode: '1.04.01', sectionCode: '1.04', sectionName: 'Pedestrian Last Mile', description: 'The TTP embeds an overview of the Pedestrian Last Mile.', multiplier: 1.0 },
  { itemCode: '1.04.02', sectionCode: '1.04', sectionName: 'Pedestrian Last Mile', description: 'The TTP embeds a the Pedestrian Last Mile Risk Analysis.', multiplier: 1.5 },
  { itemCode: '1.04.03', sectionCode: '1.04', sectionName: 'Pedestrian Last Mile', description: 'The TTP embeds a the Pedestrian Last Mile Risk Map.', multiplier: 2.0 },
  { itemCode: '1.05.06', sectionCode: '1.05', sectionName: 'Signage', description: 'For each Ingress Route a detailed Signage Plan is worked out.', multiplier: 1.5 },
  { itemCode: '1.05.07', sectionCode: '1.05', sectionName: 'Signage', description: 'The Ingress Route Signage Plan embedss details on signage location (coordinates, .kmz file).', multiplier: 1.5 },
  { itemCode: '1.05.08', sectionCode: '1.05', sectionName: 'Signage', description: 'The Ingress Route Signage Plan embedss details on signage design.', multiplier: 1.5 },
  { itemCode: '1.06.01', sectionCode: '1.06', sectionName: 'VAPPS ', description: 'A clear overview of the applicable VAPPS is given in the plan.', multiplier: 1.0 },
  { itemCode: '1.06.02', sectionCode: '1.06', sectionName: 'VAPPS ', description: 'An overview is given of when the different VAPPS go in operation.', multiplier: 1.0 },
  { itemCode: '1.07.01', sectionCode: '1.07', sectionName: 'Blue Routes Emergency Services', description: 'A clear overview of Blue Routes is given in the plan, embedding way in and way out for Police.', multiplier: 1.0 },
  { itemCode: '1.07.02', sectionCode: '1.07', sectionName: 'Blue Routes Emergency Services', description: 'A clear overview of Blue Routes is given in the plan, embedding way in and way out for Civil Defence.', multiplier: 1.0 },
  { itemCode: '1.07.03', sectionCode: '1.07', sectionName: 'Blue Routes Emergency Services', description: 'A clear overview of Blue Routes is given in the plan, embedding way in and way out for Medical Services.', multiplier: 1.0 },
  { itemCode: '1.07.04', sectionCode: '1.07', sectionName: 'Blue Routes Emergency Services', description: 'A clear overview of Blue Routes is given in the plan, embedding an overview of the areas/routes that interfere with visitor areas/routes or visitor experience.', multiplier: 1.0 },
  { itemCode: '1.07.05', sectionCode: '1.07', sectionName: 'Blue Routes Emergency Services', description: 'Details on the location of static/stand-by vehicles and teams are given in the plan.', multiplier: 1.0 },
  { itemCode: '1.08.01', sectionCode: '1.08', sectionName: 'PUDO & PT', description: 'The TTP embeds information on the designated area for PUDO (Careem/Uber/Taxi)', multiplier: 1.0 },
  { itemCode: '1.08.02', sectionCode: '1.08', sectionName: 'PUDO & PT', description: 'The TTP embeds information on the possibilities for the use of Public Transport to get to the site.', multiplier: 1.0 },
  { itemCode: '1.08.03', sectionCode: '1.08', sectionName: 'PUDO & PT', description: 'The relevant Shuttle Bus details are embedded in the plan, including capacity calculations of the system, operating hours…', multiplier: 0.5 },
  { itemCode: '1.09.01', sectionCode: '1.09', sectionName: 'DOT Plans', description: 'The plan embeds a clear and understandable Traffic Staff DOT plan for all relevant zones.', multiplier: 1.0 },
  { itemCode: '1.09.02', sectionCode: '1.09', sectionName: 'DOT Plans', description: 'The plan embeds an overview of staff totals for every type of staff', multiplier: 1.5 },
];

var CMP_SEED_ITEMS_ = [
  { itemCode: '2.01.01', sectionCode: '2.01', sectionName: 'Organisation', description: 'A Crowd Management Company has been assigned and the details are embedded in the CMP.', multiplier: 1.0 },
  { itemCode: '2.01.02', sectionCode: '2.01', sectionName: 'Organisation', description: 'A Named Individual is appointed Crowd Manager.', multiplier: 1.0 },
  { itemCode: '2.01.03', sectionCode: '2.01', sectionName: 'Organisation', description: 'A clear Organogram is embedded.', multiplier: 1.0 },
  { itemCode: '2.01.04', sectionCode: '2.01', sectionName: 'Organisation', description: 'Roles and Responsibilities within the Crowd Management structure are defined.', multiplier: 0.75 },
  { itemCode: '2.01.05', sectionCode: '2.01', sectionName: 'Organisation', description: 'Roles and Responsibilities within the Crowd Management structure are assigned.', multiplier: 0.75 },
  { itemCode: '2.01.06', sectionCode: '2.01', sectionName: 'Organisation', description: 'Clear timing is defined for the major Milestones within the delivery of the Crowd Management plan.', multiplier: 1.0 },
  { itemCode: '2.02.01', sectionCode: '2.02', sectionName: 'Study of Site Plans', description: 'A basic site plan is provided (pdf and dwg)', multiplier: 0.75 },
  { itemCode: '2.02.02', sectionCode: '2.02', sectionName: 'Study of Site Plans', description: 'A Disney map is developed and provided (pdf)', multiplier: 0.75 },
  { itemCode: '2.03.01', sectionCode: '2.03', sectionName: 'RAMP Analysis', description: 'The Crowd Management Plan embeds a detailed plan for the Pedestrian ROUTES ', multiplier: 2.0 },
  { itemCode: '2.03.02', sectionCode: '2.03', sectionName: 'RAMP Analysis', description: 'The plan also provides details on location of signage and details on the signs themselves (dimensions, colour, reflection…)', multiplier: 1.0 },
  { itemCode: '2.03.03', sectionCode: '2.03', sectionName: 'RAMP Analysis', description: 'The RAMP Analysis embeds a study of the different AREAS and details available space, dimensions, location of services, expected use and density...', multiplier: 2.0 },
  { itemCode: '2.03.04', sectionCode: '2.03', sectionName: 'RAMP Analysis', description: 'The RAMP Analysis embeds a study of the expected MOVEMENT between different areas, including expected flow rates and according fill times', multiplier: 1.0 },
  { itemCode: '2.03.05', sectionCode: '2.03', sectionName: 'RAMP Analysis', description: 'The RAMP Analysis gives details on the expected Arrival profile', multiplier: 1.0 },
  { itemCode: '2.03.06', sectionCode: '2.03', sectionName: 'RAMP Analysis', description: 'The RAMP Analysis embeds a study of the expected crowd PROFILE', multiplier: 1.0 },
  { itemCode: '2.04.01', sectionCode: '2.04', sectionName: 'Risk Analysis', description: 'The DIM-ALICED Model is used for Crowd Safety Risk Analysis under Normal Operation. ', multiplier: 3.0 },
  { itemCode: '2.04.02', sectionCode: '2.04', sectionName: 'Risk Analysis', description: 'The DIM-ALICED Model is used for Crowd Safety Risk Analysis under Emergency Operation. ', multiplier: 2.0 },
  { itemCode: '2.04.03', sectionCode: '2.04', sectionName: 'Risk Analysis', description: 'Crowd Risks are shown and documented on a risk map.', multiplier: 2.0 },
  { itemCode: '2.05.01', sectionCode: '2.05', sectionName: 'Entry Process', description: 'The Entry Process is shown in detail for each Visitor Profile. ', multiplier: 2.0 },
  { itemCode: '2.05.02', sectionCode: '2.05', sectionName: 'Entry Process', description: 'The Entry System Design is embedded and dimensions are shown.', multiplier: 2.0 },
  { itemCode: '2.05.03', sectionCode: '2.05', sectionName: 'Entry Process', description: 'The entry lanes are at least 1.1 meter wide.', multiplier: 0.75 },
  { itemCode: '2.05.04', sectionCode: '2.05', sectionName: 'Entry Process', description: 'The different Entry Systems are embedded with Staff DOTs.', multiplier: 1.0 },
  { itemCode: '2.05.05', sectionCode: '2.05', sectionName: 'Entry Process', description: 'The CMP Embeds an Entry Throughput Calculation for all entry systems and Visitor Profiles. ', multiplier: 3.0 },
  { itemCode: '2.05.06', sectionCode: '2.05', sectionName: 'Entry Process', description: 'The Plan embeds the Prohibited Items list. ', multiplier: 1.0 },
  { itemCode: '2.06.05', sectionCode: '2.06', sectionName: 'Capacity', description: 'The Crowd Management Company has read the Capacity Study as presented by the Event Management Company in the ZSMP?', multiplier: 0.0 },
  { itemCode: '2.06.06', sectionCode: '2.06', sectionName: 'Capacity', description: 'The Crowd Management Company has understood the Capacity Study as presented by the Event Management Company in the ZSMP?', multiplier: 0.0 },
  { itemCode: '2.06.07', sectionCode: '2.06', sectionName: 'Capacity', description: 'The Crowd Management Company agrees with the Capacity Study as presented by the Event Management Company in the ZSMP?', multiplier: 0.0 },
  { itemCode: '2.06.08', sectionCode: '2.06', sectionName: 'Capacity', description: 'In the Case where the Crowd Management Company does not aggree with the Capacity Study, did the Crowd Management Company provide its own study?', multiplier: 0.0 },
  { itemCode: '2.07.06', sectionCode: '2.07', sectionName: 'Evacuation', description: 'The Crowd Management Company has read the Evacuation Plan and Evacuation Time Study as presented by the Event Management Company in the ZSMP?', multiplier: 0.0 },
  { itemCode: '2.07.07', sectionCode: '2.07', sectionName: 'Evacuation', description: 'The Crowd Management Company has understood the Evacuation Plan and Evacuation Time Study as presented by the Event Management Company in the ZSMP?', multiplier: 0.0 },
  { itemCode: '2.07.08', sectionCode: '2.07', sectionName: 'Evacuation', description: 'The Crowd Management Company agrees with the Evacuation Plan and Evacuation Time Study as presented by the Event Management Company in the ZSMP?', multiplier: 0.0 },
  { itemCode: '2.07.09', sectionCode: '2.07', sectionName: 'Evacuation', description: 'In the Case where the Crowd Management Company does not aggree with the Evacuation Plan and Evacuation Time Study, did the Crowd Management Company provide its own study?', multiplier: 0.0 },
  { itemCode: '2.08.01', sectionCode: '2.08', sectionName: 'Barrier Plan', description: 'The plan shows details on the barrier plan. The documentation shows the setup and design of the different barriers with a clear link beteen the type of barrier and its intended purpose. ', multiplier: 1.0 },
  { itemCode: '2.08.02', sectionCode: '2.08', sectionName: 'Barrier Plan', description: 'The plan embeds evidence that the barrier design is suitable for the intended purpose.', multiplier: 1.0 },
  { itemCode: '2.08.03', sectionCode: '2.08', sectionName: 'Barrier Plan', description: 'The plan embeds evidence or the fact that the used barriers are fit for purpose.', multiplier: 1.0 },
  { itemCode: '2.09.01', sectionCode: '2.09', sectionName: 'DOT Plan', description: 'The plan gives a clear overview of the deployment of the crowd management staff and equipment.', multiplier: 1.0 },
  { itemCode: '2.09.02', sectionCode: '2.09', sectionName: 'DOT Plan', description: 'The plan provides detailed briefings and instructions for all the postings on the DOT plan.', multiplier: 1.0 },
];

var SEC_SEED_ITEMS_ = [
  { itemCode: '3.01.01', sectionCode: '3.01', sectionName: 'Organisation', description: 'A Security Management Company has been assigned and the details are embedded in the SMP.', multiplier: 1.0 },
  { itemCode: '3.01.02', sectionCode: '3.01', sectionName: 'Organisation', description: 'A Named individual is appointed Security Manager.', multiplier: 1.0 },
  { itemCode: '3.01.03', sectionCode: '3.01', sectionName: 'Organisation', description: 'A clear Organogram is embedded.', multiplier: 1.0 },
  { itemCode: '3.01.04', sectionCode: '3.01', sectionName: 'Organisation', description: 'Roles and Responsibilities within the Security Management structure are defined.', multiplier: 0.5 },
  { itemCode: '3.01.05', sectionCode: '3.01', sectionName: 'Organisation', description: 'Roles and Responsibilities within the Security Management structure are assigned.', multiplier: 0.5 },
  { itemCode: '3.01.06', sectionCode: '3.01', sectionName: 'Organisation', description: 'Clear timing is defined for the major Milestones within the delivery of the Security Management plan.', multiplier: 0.25 },
  { itemCode: '3.02.01', sectionCode: '3.02', sectionName: 'Risk Analysis', description: 'A site specific Security Risk Analysis is embedded in the Security Management Plan. ', multiplier: 4.0 },
  { itemCode: '3.02.02', sectionCode: '3.02', sectionName: 'Risk Analysis', description: 'The plan shows the identified risks in time and space and prioritises based on Severity and Likelihood.', multiplier: 1.0 },
  { itemCode: '3.03.01', sectionCode: '3.03', sectionName: 'Perimeter Protection', description: 'The plan embeds details on the site/event perimeter and how the integrity of the perimeter is maintained and how the perimeter is secured. This includes details on fencing, walls, cctv, other equipment.', multiplier: 1.5 },
  { itemCode: '3.03.02', sectionCode: '3.03', sectionName: 'Perimeter Protection', description: 'The plan embeds details on the guarding operation in place to protect and secure the perimeter .', multiplier: 1.0 },
  { itemCode: '3.03.03', sectionCode: '3.03', sectionName: 'Perimeter Protection', description: 'The plan embeds details on Accreditation Team.', multiplier: 1.0 },
  { itemCode: '3.04.01', sectionCode: '3.04', sectionName: 'Entry Process', description: 'The Entry Process is shown in detail for each Visitor Profile. ', multiplier: 2.0 },
  { itemCode: '3.04.05', sectionCode: '3.04', sectionName: 'Entry Process', description: 'The plan shows details on the used equipment for security searches.', multiplier: 2.0 },
  { itemCode: '3.04.06', sectionCode: '3.04', sectionName: 'Entry Process', description: 'A list of prohibited items, in relation with the outcome of the Risk Analysis, is included in the plan.', multiplier: 3.0 },
  { itemCode: '3.04.07', sectionCode: '3.04', sectionName: 'Entry Process', description: 'The plan embeds a DOT plan that shows the staff involved in the entry process for the different profiles.', multiplier: 1.0 },
  { itemCode: '3.05.01', sectionCode: '3.05', sectionName: 'Internal', description: 'The plan shows details on the internal security organisation', multiplier: 4.0 },
  { itemCode: '3.06.01', sectionCode: '3.06', sectionName: 'DOT Plans', description: 'The plan gives a clear overview of the deployment of the security staff and equipment', multiplier: 3.0 },
  { itemCode: '3.06.02', sectionCode: '3.06', sectionName: 'DOT Plans', description: 'The plan provides detailed briefings and instrcutions for all the postings on the DOT plan', multiplier: 2.0 },
];

function seedDisciplines_() {
  var existing = getAll('Disciplines');
  if (existing.length > 0) return;
  var defaults = [
    ['Crowd Safety', 'CSM'], ['Health & Safety', 'HSE'], ['Fire Safety', 'FIRE'],
    ['Food & Beverage', 'F&B'], ['Security', 'SEC'], ['Transport & Traffic', 'TTP'],
    ['Emergency Response', 'ZERP'], ['Operations', 'OPS']
  ];
  defaults.forEach(function (d) {
    insertRow('Disciplines', { id: newId('Disciplines'), name: d[0], code: d[1] });
  });
}

function seedChecklistItems_() {
  var existing = getAll('ChecklistItems');
  if (existing.length > 0) return;
  var rows = [
    ['Restaurants', 'Food & Beverage', 'Cold-chain storage temperature maintained', 'Medium', 24, 'Operational'],
    ['Restaurants', 'Food & Beverage', 'Staff food-handling certification on file', 'Low', 72, 'Opening'],
    ['Food Truck', 'Food & Beverage', 'Fire suppression system present and serviced', 'High', 4, 'Opening'],
    ['Storage', 'Health & Safety', 'Flammable materials stored per code', 'High', 4, 'Opening'],
    ['Booths & Shops', 'Crowd Safety', 'Queue and flow management adequate', 'Medium', 24, 'Operational'],
    ['Booths & Shops', 'Crowd Safety', 'Emergency exits unobstructed', 'High', 2, 'Operational'],
    ['General Venue', 'Fire Safety', 'Fire extinguishers in place and in-date', 'High', 4, 'Opening'],
    ['General Venue', 'Security', 'Accreditation/access control functioning', 'Medium', 24, 'Opening'],
    ['General Venue', 'Emergency Response', 'Zone Emergency Response Plan posted and visible', 'Medium', 24, 'Opening'],
    ['Cleaning', 'Operations', 'Sanitation schedule maintained and logged', 'Low', 72, 'Operational']
  ];
  rows.forEach(function (r) {
    insertRow('ChecklistItems', {
      id: newId('ChecklistItems'), checklistType: r[0], category: r[1], description: r[2],
      defaultRisk: r[3], defaultWindowHours: r[4], phase: r[5]
    });
  });
}

// REQ: "Some inspectors are junior level and could use help. We have created a guide which should
// give them a list of descriptions once they select the category and sub-category." Seeded verbatim
// from the user's "ASK - Logs - Summary - 20260802 v0.31.xlsx" ("Log Assistance Guide") -- 176 rows,
// [category, subCategory, description, suggestion]. Same "only seed if empty" convention as
// seedDisciplines_/seedChecklistItems_ above, so re-running setupHulul() on an already-live sheet is
// still safe -- this only fires the first time (when the FindingGuide sheet doesn't exist yet / has
// no rows). NOTE: category here is the guide author's own category names (e.g. "Security
// Operations", "Incident & Accident", "Universal Accessibility", "Adverse Weather") -- several of
// these don't exactly match the live Disciplines catalog's existing names/coverage. See
// findings.js's suggested-description picker (matches by exact Discipline name) and disciplines.js's
// new Edit action -- an admin can rename/add Disciplines so the two catalogues line up.
// One-time backfill: "The ones [Log Assistance Guide categories] that don't exactly match your live
// Disciplines Catalog just fix them to match it." Most of the guide's 9 categories already line up
// with the live catalog (confirmed by name for "Emergency & Response" and "Universal Accessibility"
// via fixDuplicateDisciplineIds' own comment above; "Security"/"Transport & Traffic" match the
// original seedDisciplines_ defaults, and seedFindingGuide_ below already normalizes the guide's
// text to those exact names) -- but "Incident & Accident" and "Adverse Weather" have no existing
// Discipline to rename/match at all, so there's nothing to reconcile them TO. This creates those two
// (only if missing by exact name -- safe to re-run) so every guide category has a real catalog entry
// an inspector can actually select. catRef auto-assigned as (current max + 1) since it's now a
// required field for any newly-created Discipline (see createDiscipline, Disciplines.gs). Run once
// from the Apps Script editor's function dropdown after redeploying.
function backfillFindingGuideDisciplines_() {
  var existing = getAll('Disciplines');
  var byName = {};
  existing.forEach(function (d) { byName[(d.name || '').trim().toLowerCase()] = d; });
  var maxCatRef = existing.reduce(function (max, d) {
    var n = Number(d.catRef);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  var missing = [
    ['Incident & Accident', 'INC'],
    ['Adverse Weather', 'ADV']
  ].filter(function (d) { return !byName[d[0].toLowerCase()]; });
  missing.forEach(function (d) {
    maxCatRef++;
    insertRow('Disciplines', { id: newId('Disciplines'), name: d[0], code: d[1], catRef: maxCatRef });
  });
  Logger.log('backfillFindingGuideDisciplines_: created ' + missing.length + ' discipline(s): ' +
    missing.map(function (d) { return d[0]; }).join(', ') + (missing.length ? '' : ' (none needed -- already present)'));
  return { created: missing.map(function (d) { return d[0]; }) };
}

function seedFindingGuide_() {
  var existing = getAll('FindingGuide');
  if (existing.length > 0) return;
  var rows = [
  // Health & Safety
  ['Health & Safety', 'H&S Housekeeping', 'Overflowing waste bins or Skips', 'Empty regularly and provide adequate disposal to stop litter hazards, pests, and poor hygiene.'],
  ['Health & Safety', 'H&S Housekeeping', 'Debries on the floor', 'Ensure that all floors are free of debris and kept clean to prevent slips, trips, and falls'],
  ['Health & Safety', 'H&S Housekeeping', 'Cleaning equipment left out (mops, buckets, vacuums)', 'Store safely after use to keep walkways clear and prevent trips'],
  ['Health & Safety', 'H&S Housekeeping', 'Chemicals misused, improperly stored, or left unsecured', 'Ensure all chemicals are clearly labelled, stored securely, and handled only by trained staff to prevent poisoning, burns, and misuse'],
  ['Health & Safety', 'H&S Housekeeping', 'Spills (food, beverages, cleaning liquids, or other substances) on floors and walking surface', 'Isolate and clean affected areas immediately using appropriate warning signage to prevent slips, falls, and hygiene concerns.'],
  ['Health & Safety', 'H&S Electrical', 'Non \'IP rated\' electrical equipment exposed to water or rain', 'Use IP-rated equipment or waterproof covers and keep it off the ground to reduce the risk of electric shock and short circuits'],
  ['Health & Safety', 'H&S Electrical', 'Unsecure cables', 'Secure loose cables properly to prevent movement, damage, and trip hazards'],
  ['Health & Safety', 'H&S Electrical', 'Untested or uncertified appliances', 'Use only inspected, tested, and certified electrical appliances to prevent electrical faults, fire, and injury.'],
  ['Health & Safety', 'H&S Electrical', 'Trailing cables', 'Route cables away from walkways or cover them with cable protectors to prevent trip hazards'],
  ['Health & Safety', 'H&S Electrical', 'Overloaded sockets or extension leads', 'Use correct load limits and avoid daisy-chaining to prevent overheating and fire'],
  ['Health & Safety', 'H&S Electrical', 'Damaged or frayed cables', 'Inspect and replace immediately to avoid electric shock and fire risk'],
  ['Health & Safety', 'H&S Electrical', 'Electrical cabling or connections observed as unsafe or exposed.', 'Secure and rectify by qualified electrician to prevent electrocution'],
  ['Health & Safety', 'H&S Electrical', 'Inadequate cable management', 'Ensure cables are securely routed, covered, or elevated to prevent movement, damage, trips, and electrical hazards.'],
  ['Health & Safety', 'H&S Electrical', 'Generators not connected to a verified grounding (earthing) system.', 'Ensure each generator is connected to a compliant earth electrode and tested by a competent person to prevent electric shock, equipment damage, and fire.'],
  ['Health & Safety', 'H&S Electrical', 'Generator grounding arrangement could not be verified, including the connection method and earth electrode location', 'Identify the grounding system and provide inspection or test evidence confirming effective earthing to prevent electric shock, equipment damage, and fire.'],
  ['Health & Safety', 'H&S Trip & Fall Hazard', 'Obstruction and hazards identified within circulation routes.', 'Remove hazards and improve routing to prevent trips and falls.'],
  ['Health & Safety', 'H&S Trip & Fall Hazard', 'Uneven flooring or loose mats or loose carpeting', 'Secure mats and clearly mark uneven areas to reduce the risk of slips, trips, and falls'],
  ['Health & Safety', 'H&S Trip & Fall Hazard', 'Damaged or uneven stairs', 'Repair damaged steps and ensure stair surfaces are even and safe to use'],
  ['Health & Safety', 'H&S Trip & Fall Hazard', 'Loose or damaged handrails', 'Repair or secure handrails to ensure they are stable and safe to use'],
  ['Health & Safety', 'H&S Trip & Fall Hazard', 'Poor lighting in corridors or stairs', 'Provide adequate lighting to prevent hazards and reduce accidents'],
  ['Health & Safety', 'H&S Trip & Fall Hazard', 'Wet floors', 'Display warning signs and dry the area promptly to prevent slips and falls and reduce the risk of injury.'],
  ['Health & Safety', 'H&S Trip & Fall Hazard', 'Uncovered trench or manhole opening', 'Install a secure cover and temporarily isolate the opening with barriers and warning signage until completed to prevent falls.'],
  ['Health & Safety', 'H&S Trip & Fall Hazard', 'Damaged, uneven, or displaced trench or manhole cover', 'Repair, replace, or securely reposition the cover to prevent trips and falls'],
  ['Health & Safety', 'H&S Tools & Equipment', 'Damaged or faulty equipment', 'Inspect before use and remove from service to prevent accidents, shocks, or malfunctions'],
  ['Health & Safety', 'H&S Tools & Equipment', 'Improper use of tools and equipment', 'Provide staff and volunteers with appropriate training and operating instructions to prevent misuse and injury.'],
  ['Health & Safety', 'H&S Tools & Equipment', 'Tools or equipment left unattended or improperly stored', 'Store tools and equipment safely after use to prevent trip hazards, damage, or misuse.'],
  ['Health & Safety', 'H&S Tools & Equipment', 'Unsafe use or condition of ladders/access equipment', 'Ensure ladders and access equipment are in good condition, used correctly, and positioned securely.'],
  ['Health & Safety', 'H&S Tools & Equipment', 'Exposed sharp edges or moving parts on tools/equipment', 'Guard, cover, or isolate exposed parts to prevent cuts, entanglement, or other injuries'],
  ['Health & Safety', 'H&S Tools & Equipment', 'Incorrect storage of tools and equipment', 'Store tools and equipment safely in designated areas after use, or remove them from site, to prevent unauthorised use and trip hazards.'],
  ['Health & Safety', 'H&S Structural', 'Structural elements incomplete or presenting safety concerns.', 'Restrict access and complete works to prevent accidents or injuries.'],
  ['Health & Safety', 'H&S Structural', 'Unstable staging or platforms', 'Inspect, secure, and test stability before use to prevent collapse and serious injury'],
  ['Health & Safety', 'H&S Structural', 'Loose railings or barriers', 'Inspect and secure all fixings to prevent falls from height and protect staff, visitors, contractors, and the public.'],
  ['Health & Safety', 'H&S Structural', 'Overloaded structures (stages, tents, balconies)', 'Follow load limits and monitor usage to prevent structural failure and collapse'],
  ['Health & Safety', 'H&S Structural', 'Improperly erected tents and marquees', 'Ensure tents and marquees are erected, anchored, and secured by competent personnel to prevent collapse or movement'],
  ['Health & Safety', 'H&S Structural', 'Trusses installed without base plates', 'Install suitable base plates to provide stability, distribute load, and reduce the risk of movement or collapse'],
  ['Health & Safety', 'H&S Structural', 'Unsecured trusses or AVL equipment', 'Secure and stabilise all trusses and AVL equipment to prevent movement, collapse, or falling objects'],
  ['Health & Safety', 'H&S Communication', 'Language barriers affecting the communication and understanding of safety information.', 'Provide translators, multilingual staff, and clear visual or multilingual signage to ensure all persons understand safety instructions.'],
  ['Health & Safety', 'H&S Staff Welfare', 'Staff welfare provisions partially available.', 'Improve welfare facilities to ensure they have an area for rest breaks and refreshments.'],
  ['Health & Safety', 'H&S Staff Welfare', 'Fatigue from long shifts', 'Provide suitable comfort breaks and rota management to maintain alertness and reduces mistakes.'],
  ['Health & Safety', 'H&S Staff Welfare', 'Exposure to adverse weather conditions (heat, rain, wind)', 'Provide suitable PPE, drinking water, and shelter to protect staff and keep them fit for work'],
  ['Health & Safety', 'H&S Staff Welfare', 'Stress or mental strain', 'Provide clear roles, regular welfare checks, and appropriate support to protect wellbeing, maintain morale, and prevent stress-related errors.'],
  ['Health & Safety', 'H&S Staff Welfare', 'Lack of access to food, drinking water, and toilets', 'Provide suitable catering, drinking water, and welfare facilities to support staff health and wellbeing.'],
  ['Health & Safety', 'H&S Training & Supervision', 'Limited evidence of staff training or supervision.', 'Deliver toolbox talks and supervise to ensure H&S knowledge is shared.'],
  ['Health & Safety', 'H&S Training & Supervision', 'Lack of supervision for high-risk activities', 'Assign competent supervisors to oversee high-risk activities and prevent unsafe practices'],
  ['Health & Safety', 'H&S Training & Supervision', 'Unclear responsibilities', 'Clearly define roles and responsibilities in advance to avoid confusion, duplication, or gaps in safety coverage.'],
  ['Health & Safety', 'H&S General', 'Fire hazards (i.e. smoking)', 'Restrict smoking to designated areas only and provide appropriate signage and fire extinguishers'],
  ['Health & Safety', 'H&S General', 'Excessive noise levels', 'Monitor noise using a sound level meter (dB meter) and provide suitable hearing protection to prevent hearing damage or loss'],
  ['Health & Safety', 'H&S General', 'General H&S controls inconsistently applied.', 'Review controls to ensure H&S compliance is reinforced.'],
  ['Health & Safety', 'H&S General', 'Inadequate smoking arrangements and cigarette-disposal facilities.', 'Ensure suitable controls, signage, and fire-resistant receptacles are in place in accordance with site requirements to prevent improper disposal and fire.'],
  ['Health & Safety', 'H&S General', 'Unsecured water tank and pump accessible within a public area.', 'Secure or isolate the equipment where required to prevent unauthorised access, contact with moving or electrical components, leakage, and obstruction'],
  ['Health & Safety', 'H&S General', 'Inadequate cigarette-disposal facilities within the designated smoking area.', 'Ensure suitable fire-resistant or self-extinguishing cigarette receptacles are available to prevent improper disposal and fire.'],
  ['Health & Safety', 'H&S General', 'Insufficient toilets for General Admission (GA) visitor', 'Ensure sufficient toilets for the expected GA attendance to prevent excessive queues and maintain hygiene.'],
  // Fire Safety
  ['Fire Safety', 'FSM Combustibles', 'Waste accumulation', 'Remove waste regularly and use suitable bins to reduce fire risk.'],
  ['Fire Safety', 'FSM Combustibles', 'Improper storage of fuel, diesel or gas cylinders', 'Store fuel and gas cylinders in approved containers, in well-ventilated areas, away from ignition sources and public access'],
  ['Fire Safety', 'FSM Combustibles', 'Combustible materials stored unsafely.', 'Remove or segregate combustibles materials to reduce the risk of fire.'],
  ['Fire Safety', 'FSM Fire Fighting Equipment', 'Poorly positioned fire extinguisher', 'Relocate fire extinguishers to visible, accessible locations to ensure they can be reached quickly in an emergency'],
  ['Fire Safety', 'FSM Fire Fighting Equipment', 'Improperly positioned or stored portable fire extinguishers.', 'Relocate extinguishers to clearly visible, accessible, and designated points to ensure immediate availability during an emergency.'],
  ['Fire Safety', 'FSM Fire Fighting Equipment', 'Access blocked to firefighting equipment or fire alarm panels', 'Keep access to firefighting equipment and fire alarm panels clear at all times'],
  ['Fire Safety', 'FSM Fire Fighting Equipment', 'Damaged Fire Extinguisher', 'Remove damaged extinguishers from service and replace or repair them immediately'],
  ['Fire Safety', 'FSM Fire Fighting Equipment', 'Inadequate firefighting equipment within the generator farm.', 'Ensure suitable fire extinguishers are correctly rated, distributed, and accessible, including portable dry powder units near generators, foam units near diesel tanks, and a wheeled dry powder unit where required, to control fires and support emergency response.'],
  ['Fire Safety', 'FSM Fire Fighting Equipment', 'Fire extinguishers missing', 'Provide Fire extinguishers to ensure FFE is easily reachable in case of an emergency'],
  ['Fire Safety', 'FSM Fire Fighting Equipment', 'Fire extinguisher missing inspection tag', 'Ensure all extinguishers have a valid inspection tag showing current service and inspection status.'],
  ['Fire Safety', 'FSM Fire Fighting Equipment', 'Incorrect fire extinguisher provided', 'Provide the correct type of fire extinguisher for the identified fire risk (specify the required extinguisher type in the suggestion)'],
  ['Fire Safety', 'FSM Fire Fighting Equipment', 'Misuse of fire extinguishers (e.g., used as door stops).', 'Keep fire extinguishers secured at their designated points, accessible and unobstructed, to ensure immediate availability during an emergency.'],
  ['Fire Safety', 'FSM Fire Fighting Equipment', 'Depressurised fire extinguisher', 'Remove the extinguisher from service and replace or service it to ensure it is fully operational'],
  ['Fire Safety', 'FSM Used Materials', 'Materials used are not confirmed as fire-retardant.', 'Verify the ratings and replace the materials if required to prevent the risk of fire spreading.'],
  ['Fire Safety', 'FSM Used Materials', 'Overflowing bins containing paper or cardboard', 'Empty bins regularly and use suitable waste containers to reduce the risk of fire.'],
  ['Fire Safety', 'FSM Used Materials', 'Discarded packaging materials (plastic, wood, and fabric)', 'Remove promptly and store or dispose of them safely in designated areas to prevent ignition and fire spread.'],
  ['Fire Safety', 'FSM Used Materials', 'Empty chemical or cleaning-product container', 'Dispose of containers in accordance with the Safety Data Sheet (SDS) and approved waste procedures to prevent hazardous residues, vapour build-up, and fire risk.'],
  ['Fire Safety', 'FSM Used Materials', 'Smoking materials discarded in waste containers', 'Provide designated fire-resistant receptacles and suitable firefighting equipment to prevent smouldering waste and fire.'],
  ['Fire Safety', 'FSM Used Materials', 'Unverified plastic protective sheeting installed beneath generators, with no confirmed purpose or material specification', 'Clarify its intended purpose and provide the manufacturer’s technical specifications confirming suitability and fire performance to prevent the use of incompatible or combustible materials.'],
  // Emergency & Response (matches the live Disciplines catalog name verbatim -- see
  // fixDuplicateDisciplineIds' own comment above, which confirms a live row literally named
  // "Emergency & Response" -- no rename needed here)
  ['Emergency & Response', 'ERR Emergency Procedures', 'Emergency procedures not clearly communicated.', 'Ensure staff are briefed on procedures to allow clear correct communication in the event of and emergency.'],
  ['Emergency & Response', 'ERR Emergency Procedures', 'No emergency drills or rehearsals conducted', 'Conduct emergency drills or rehearsals to test readiness and familiarise staff with emergency procedures.'],
  ['Emergency & Response', 'ERR Emergency Procedures', 'Failure to communicate with attendees during emergencies', 'Use PA announcements and visual guidance to provide clear instructions and direct attendees safely'],
  ['Emergency & Response', 'ERR Emergency Signages', 'Incorrect placement of emergency exit signage (too high, too low, or too widely spaced)', 'Position exit signage at clearly visible locations and suitable intervals along all escape routes to maintain continuous guidance and prevent confusion during evacuation.'],
  ['Emergency & Response', 'ERR Emergency Signages', 'Missing emergency signage', 'Provide emergency signage at all required locations to help occupants identify exits and emergency equipment quickly'],
  ['Emergency & Response', 'ERR Emergency Signages', 'Medical facilities not clearly identified due to missing or inadequate signage.', 'Ensure clear and visible medical signage is installed to enable rapid identification and access during emergencies.'],
  ['Emergency & Response', 'ERR Emergency Signages', 'Unclear emergency signage', 'Replace or improve emergency signage to ensure it is clear, visible, and easy to understand'],
  ['Emergency & Response', 'ERR Incident Command & Control', 'Incident command arrangements unclear.', 'Confirm command structure is clear to ensure staff are aware of the emergency procedures.'],
  ['Emergency & Response', 'ERR Roles & Responsibilities', 'Staff unaware of their emergency roles', 'Brief all staff on their emergency roles and responsibilities before the event'],
  ['Emergency & Response', 'ERR Roles & Responsibilities', 'Emergency roles not clearly defined.', 'Clarify roles and responsibilities for staff to ensure that they are aware of what to do in the event of an emergency.'],
  ['Emergency & Response', 'ERR Site Design', 'Insufficient number of emergency exits', 'Provide an adequate number of exits for the expected occupancy to prevent bottlenecks and ensure safe evacuation'],
  ['Emergency & Response', 'ERR Site Design', 'Obstructed access for emergency vehicles', 'Keep fire lanes and emergency access roads clear at all times to prevent delays in emergency response.'],
  ['Emergency & Response', 'ERR Site Design', 'High-risk areas (e.g., generators, DBs, fuel storage, gas cylinders) not segregated from the public', 'Segregate and secure high-risk areas with suitable barriers and access controls to prevent unauthorised public access'],
  ['Emergency & Response', 'ERR Site Design', 'Poorly marked emergency escape routes', 'Clearly identify and mark all emergency escape routes to support safe and efficient evacuation'],
  ['Emergency & Response', 'ERR Site Design', 'Crowded or narrow walkways', 'Provide sufficiently wide circulation routes and control crowd flow to prevent overcrowding, crushing, and evacuation delays.'],
  ['Emergency & Response', 'ERR Site Design', 'Site layout limits emergency response.', 'Review and adjust layout accordingly to ensure that a safe full evacuation can be carried out.'],
  ['Emergency & Response', 'ERR Staff Allocation', 'Poor staff distribution', 'Deploy staff across exits, escape routes, crowd areas, and other critical locations to ensure adequate coverage.'],
  ['Emergency & Response', 'ERR Staff Allocation', 'No relief cover for temporary staff absences', 'Ensure trained relief staff are available to maintain continuous coverage during breaks and other temporary absences'],
  ['Emergency & Response', 'ERR Staff Allocation', 'Emergency staff allocation unclear.', 'Assign and brief staff to ensure that they are in their correct allocated positions.'],
  ['Emergency & Response', 'ERR Training & Supervision', 'Limited emergency training undertaken.', 'Conduct drills and training for staff to ensure they know what to do in the event of an emergency.'],
  ['Emergency & Response', 'ERR Unusable Emergency Exit', 'Blocked or obstructed emergency exits', 'Keep all emergency exits clear and inspect them regularly to ensure safe and prompt evacuation.'],
  ['Emergency & Response', 'ERR Unusable Emergency Exit', 'Locked emergency exit doors', 'Keep emergency exit doors unlocked and easily openable at all times to avoid delays during an emergency'],
  ['Emergency & Response', 'ERR Unusable Emergency Exit', 'Inadequate or unclear emergency exit signage', 'Provide clear, visible emergency exit signage to help occupants identify exits quickly'],
  ['Emergency & Response', 'ERR Unusable Emergency Exit', 'Inadequate lighting at emergency exits or escape routes', 'Provide suitable lighting at emergency exits and along escape routes to support safe evacuation'],
  ['Emergency & Response', 'ERR Unusable Emergency Exit', 'Trip hazards on exit routes', 'Remove trip hazards and keep exit routes level and safe to ensure smooth evacuation'],
  ['Emergency & Response', 'ERR Unusable Emergency Route', 'Emergency route partially obstructed.', 'Ensure the route is cleared and ready for use at all times.'],
  // Crowd Safety
  ['Crowd Safety', 'CSM Barriers', 'Weak, damaged, or unstable barriers', 'Install suitable event-grade barriers and ensure they are stable, secure, and fit for purpose to prevent failure and injury'],
  ['Crowd Safety', 'CSM Barriers', 'Inadequate or poorly positioned barriers', 'Reposition or upgrade barriers to suit the expected crowd size, flow, and operational requirements'],
  ['Crowd Safety', 'CSM Barriers', 'Overcrowding at barriers', 'Actively monitor crowd density and relieve pressure points to prevent crush hazards and maintain safety'],
  ['Crowd Safety', 'CSM Barriers', 'Trip hazards from barrier base plates', 'Cover or clearly highlight barrier base plates to prevent trips and falls, particularly in crowded areas.'],
  ['Crowd Safety', 'CSM Barriers', 'Insufficient barriers at key points', 'Assess requirements and install suitable barriers at key risk points, referring to the approved Crowd Management Plan where available, to prevent unsafe crowd movement, unauthorised access, and surges.'],
  ['Crowd Safety', 'CSM Operational Readiness', 'Queuing system not inspected before opening', 'Inspect all queuing systems before opening to ensure they are safe, functional, and ready for use'],
  ['Crowd Safety', 'CSM Operational Readiness', 'Crowd management staff not deployed before opening', 'Ensure all crowd management staff are in their designated positions before the venue opens'],
  ['Crowd Safety', 'CSM Operational Readiness', 'Staff briefing or drills not conducted before opening', 'Conduct pre-event briefings and emergency drills, where required, to ensure staff are prepared for normal and emergency operations'],
  ['Crowd Safety', 'CSM Organisational Management', 'Crowd management coordination limited.', 'Improve management coordination to ensure the full team are aware and compliant.'],
  ['Crowd Safety', 'CSM Organisational Management', 'No system to monitor live venue capacity', 'Implement a reliable system to monitor live occupancy and ensure the venue remains within its approved capacity'],
  ['Crowd Safety', 'CSM Organisational Management', 'Responsible decision-makers not clearly identified or available', 'Clearly identify responsible decision-makers, maintain up-to-date contact details, and ensure they remain available or have an authorised delegate throughout the event'],
  ['Crowd Safety', 'CSM Queue & Flow Management', 'Queue and flow management insufficient.', 'Improve queuing systems to ensure that it’s sufficient to handle the number of attendees.'],
  ['Crowd Safety', 'CSM Queue & Flow Management', 'Uncontrolled queues', 'Ensure trained staff, barriers, signage, and PA/loud hailers are used to maintain orderly queues and reduce congestion'],
  ['Crowd Safety', 'CSM Queue & Flow Management', 'Queues blocking exits or routes', 'Ensure the crowd management plan includes a queuing system that keeps exits and emergency routes clear and prevents overcrowding'],
  ['Crowd Safety', 'CSM Queue & Flow Management', 'Vendor or F&B queues obstructing pedestrian routes', 'Implement designated queuing systems to prevent obstruction of pedestrian routes and maintain safe crowd flow'],
  ['Crowd Safety', 'CSM Queue & Flow Management', 'Overcrowding', 'Monitor venue capacity, control entry, and manage crowd flow to prevent overcrowding, crowd crushing, and related injuries'],
  ['Crowd Safety', 'CSM Queue & Flow Management', 'Unpredictable crowd surges', 'Implement staggered entry, suitable barriers, and trained crowd management staff to regulate queues, maintain safe crowd flow, and prevent injuries or fatalities.'],
  ['Crowd Safety', 'CSM Site Design', 'Site layout creates crowd congestion risk.', 'Modify layout to ensure an improved crowd flow is achieved.'],
  ['Crowd Safety', 'CSM Site Design', 'High-risk areas not segregated', 'Use barriers, signage and stewards to direct the public to ensure unauthorised (non-public) areas are kept secure'],
  ['Crowd Safety', 'CSM Site Design', 'Inadequate prayer-area capacity causing overcrowding and obstruction of pedestrian routes', 'Ensure sufficient prayer space or additional designated areas to prevent congestion and maintain clear circulation routes.'],
  ['Crowd Safety', 'CSM Site Design', 'Prayer area inadequately located or sized, causing overcrowding and obstruction of pedestrian routes', 'Relocate or expand the prayer area to prevent congestion and maintain clear circulation routes.'],
  ['Crowd Safety', 'CSM Site Design', 'The designated prayer area is insufficient for the expected number of visitors, causing overcrowding and obstruction of pedestrian routes', 'Expand or relocate the prayer area, or establish additional designated prayer spaces with mats, to prevent congestion and maintain clear circulation routes.'],
  ['Crowd Safety', 'CSM Staff Allocation', 'Staff unclear on their roles and responsibilities', 'Ensure all staff receive a comprehensive briefing on their roles and responsibilities before commencing duties'],
  ['Crowd Safety', 'CSM Staff Allocation', 'Crowd staffing levels insufficient.', 'Increase staff deployment to ensure that there is a sufficient number of staff to deal with the attendees.'],
  ['Crowd Safety', 'CSM Tools & Equipment', 'Insufficient radios for staff', 'Provide sufficient radios, spare units, and charged batteries to ensure reliable communication and emergency coordination'],
  ['Crowd Safety', 'CSM Tools & Equipment', 'Broken lighting along walkways', 'Provide temporary lighting and repair defective units promptly to prevent trips and maintain safe emergency routes.'],
  ['Crowd Safety', 'CSM Tools & Equipment', 'Unsecured temporary structures', 'Inspect and secure all temporary structures to prevent collapse and injury.'],
  ['Crowd Safety', 'CSM Tools & Equipment', 'Insufficient or unavailable people-counting devices', 'Provide suitable people-counting devices (e.g., clickers or electronic counters) at designated entry points'],
  ['Crowd Safety', 'CSM Training & Supervision', 'Limited crowd safety training evident', 'Ensure all staff receive appropriate crowd safety training and event-specific briefings before commencing duties'],
  ['Crowd Safety', 'CSM Training & Supervision', 'Inadequate supervisory presence', 'Ensure competent supervisors are continuously present in operational areas to monitor activities, support staff, and respond promptly to issues'],
  ['Crowd Safety', 'CSM Wayfinding', 'Signage not provided in multiple languages.', 'Provide multilingual and visual signage to prevent misunderstanding, crowd confusion, congestion, and evacuation delays.'],
  ['Crowd Safety', 'CSM Wayfinding', 'Incorrect directional signage', 'Review and correct wayfinding signage to ensure all directions accurately guide staff and attendees to the intended destinations'],
  ['Crowd Safety', 'CSM Wayfinding', 'Insufficient wayfinding signage', 'Install clear and visible wayfinding signage to assist staff and attendees with navigation'],
  ['Crowd Safety', 'CSM Wayfinding', 'Signage positioned too high or too low', 'Position signage at eye level and clear sightlines to prevent confusion and maintain effective crowd guidance.'],
  ['Crowd Safety', 'CSM Wayfinding', 'Missing or insufficient site maps', 'Provide clear site maps at key locations to help attendees navigate the venue and locate facilities, attractions, and emergency exits'],
  // Security (normalized to match the live Disciplines catalog name -- guide said "Security Operations")
  ['Security', 'SOM Entry System Management', 'Missing or inadequate prohibited items signage', 'Display clear and visible prohibited items signage at all entry points to inform attendees before screening'],
  ['Security', 'SOM Entry System Management', 'Entry screening inconsistently applied.', 'Ensure all security staff consistently apply the approved entry screening procedures.'],
  ['Security', 'SOM On-site Security Management', 'On-site security coverage inconsistent.', 'Ensure adequate security patrols and monitoring are maintained across all operational areas.'],
  ['Security', 'SOM Operational Readiness', 'Security readiness not fully confirmed.', 'Complete and document all pre-opening security checks to confirm operational readiness'],
  ['Security', 'SOM Organisational Management', 'Security command arrangements unclear.', 'Clearly define the security command structure and communication channels to ensure effective decision-making.'],
  ['Security', 'SOM Perimeter Management', 'Perimeter controls incomplete.', 'Strengthen perimeter controls to prevent unauthorised access and maintain site security.'],
  ['Security', 'SOM Staff Allocation', 'Security staffing not aligned to requirements.', 'Deploy sufficient security personnel to all designated operational areas.'],
  ['Security', 'SOM Tools & Equipment', 'Security equipment unavailable or faulty.', 'Ensure all required security equipment is available, operational, and fit for purpose.'],
  ['Security', 'SOM Tools & Equipment', 'Lack of search equipment (wands or scanners', 'Provide sufficient functional search equipment to prevent entry delays, ineffective screening, and increased security risks.'],
  ['Security', 'SOM Training & Supervision', 'Limited security training evident.', 'Ensure all security personnel receive appropriate training and event-specific briefings before deployment.'],
  // Transport & Traffic (normalized to match the live Disciplines catalog name -- guide said
  // "Traffic & Transport")
  ['Transport & Traffic', 'TTM Operational Readiness', 'Loose kerbstones, concrete blocks, or similar materials obstructing vehicle routes.', 'Remove or secure all obstructions to prevent vehicle damage and maintain safe traffic movement.'],
  ['Transport & Traffic', 'TTM Operational Readiness', 'Traffic plan not fully tested.', 'Complete pre-opening traffic readiness checks to verify that all traffic management arrangements are operational.'],
  ['Transport & Traffic', 'TTM Organisational Management', 'Traffic coordination limited.', 'Establish clear coordination and communication between all traffic management stakeholders to support safe and efficient operations.'],
  ['Transport & Traffic', 'TTM Site Design', 'Inadequately lit vehicle areas', 'Ensure adequate lighting in car parks and vehicle access routes to prevent collisions and pedestrian incidents.'],
  ['Transport & Traffic', 'TTM Site Design', 'Vehicle and pedestrian routes unclear.', 'Clearly define and segregate vehicle and pedestrian routes to reduce the risk of collisions.'],
  ['Transport & Traffic', 'TTM Staff Allocation', 'Traffic marshal numbers insufficient.', 'Deploy sufficient traffic marshals at key locations and peak periods to maintain safe and efficient traffic flow.'],
  ['Transport & Traffic', 'TTM Tools & Equipment', 'Insufficient temporary lighting in dark traffic areas.', 'Ensure suitable lighting towers or floodlights are installed and operational to improve visibility and prevent vehicle and pedestrian incidents.'],
  ['Transport & Traffic', 'TTM Tools & Equipment', 'Traffic equipment inadequate.', 'Ensure all traffic management equipment is available, operational, and fit for purpose.'],
  ['Transport & Traffic', 'TTM Traffic Management', 'Traffic controls partially implemented.', 'Ensure all traffic management controls are fully implemented and maintained throughout the event.'],
  ['Transport & Traffic', 'TTM Training & Supervision', 'Limited traffic training evident.', 'Ensure all traffic management personnel receive appropriate training and event-specific briefings before deployment.'],
  ['Transport & Traffic', 'TTM Wayfinding & Signage', 'Lack of guidance at drop-off and pick-up points', 'Ensure designated points, visible signage, and trained traffic marshals are in place to maintain safe and orderly traffic flow'],
  ['Transport & Traffic', 'TTM Wayfinding & Signage', 'Confusing pedestrian or vehicle routes', 'Ensure pedestrian and vehicle routes are separated and clearly marked to prevent collisions and congestion.'],
  // Incident & Accident
  ['Incident & Accident', 'I&A Drowning', 'Drowning or water-related incident recorded.', 'Investigate the incident and strengthen water safety and emergency response measures to prevent recurrence.'],
  ['Incident & Accident', 'I&A Electrocution', 'Electrical incident or near miss recorded.', 'Isolate the hazard, investigate the incident, and implement corrective actions to prevent recurrence.'],
  ['Incident & Accident', 'I&A Fire', 'Fire-related incident or near miss recorded.', 'Investigate the incident and strengthen fire safety controls to prevent recurrence.'],
  ['Incident & Accident', 'I&A Harassment', 'Harassment incident reported.', 'Investigate the incident and implement appropriate safeguarding and corrective measures to prevent recurrence.'],
  ['Incident & Accident', 'I&A Medical', 'Medical incident recorded on site.', 'Investigate the incident, identify root causes, and implement corrective actions to prevent recurrence.'],
  ['Incident & Accident', 'I&A Other', 'Incident recorded on site.', 'Investigate the incident, identify root causes, and implement corrective actions to prevent recurrence.'],
  ['Incident & Accident', 'I&A Physical aggression', 'Physical aggression incident recorded.', 'Investigate the incident and review security measures to prevent recurrence.'],
  ['Incident & Accident', 'I&A Trip, Slip and Fall', 'Slip, trip, or fall incident recorded.', 'Investigate the incident, eliminate hazards, and implement corrective actions to prevent recurrence.'],
  ['Incident & Accident', 'I&A Vehicle-Pedestrian', 'Vehicle–pedestrian incident recorded.', 'Investigate the incident and strengthen pedestrian and vehicle segregation to prevent recurrence.'],
  ['Incident & Accident', 'I&A Vehicle-Vehicle', 'Vehicle collision incident recorded.', 'Investigate the incident and review traffic management controls to prevent recurrence.'],
  ['Incident & Accident', 'I&A Verbal aggression', 'Verbal aggression incident recorded.', 'Investigate the incident and implement appropriate measures to prevent recurrence.'],
  // Universal Accessibility
  ['Universal Accessibility', 'UAM General', 'General accessibility issues observed.', 'Review and address accessibility deficiencies to ensure equitable access throughout the venue.'],
  ['Universal Accessibility', 'UAM Points of Access', 'Accessible access points restricted.', 'Ensure accessible entrances, exits, and routes remain unobstructed and easily accessible.'],
  ['Universal Accessibility', 'UAM Ramps', 'Ramps not fully accessible.', 'Ensure ramps comply with accessibility requirements to provide safe and independent access.'],
  ['Universal Accessibility', 'UAM Sanitary Facilities', 'Accessible toilets limited.', 'Provide sufficient accessible toilet facilities to meet the needs of attendees.'],
  ['Universal Accessibility', 'UAM Signages', 'Accessibility signage insufficient.', 'Provide clear, visible, and accessible signage to assist attendees in locating accessible routes and facilities.'],
  ['Universal Accessibility', 'UAM Training & Supervision', 'Accessibility training and supervision insufficient.', 'Ensure staff receive appropriate accessibility awareness training to provide effective assistance to attendees.'],
  // Adverse Weather
  ['Adverse Weather', 'ADV Rain Damage', 'Rain affecting site safety.', 'Implement drainage and controls to prevent flooding.'],
  ['Adverse Weather', 'ADV Rain Damage', 'Rainwater damage to staging or temporary structures', 'Inspect and repair affected structures and ensure suitable weatherproofing to prevent instability, collapse, and injury'],
  ['Adverse Weather', 'ADV Wind Damage', 'Wind impacting structures.', 'Secure and monitor structures to ensure structure stability.'],
  ['Adverse Weather', 'ADV Preventive Actions Taken', 'Weather controls partially implemented.', 'Enhance preventive measures to reduce the risk of potential damage to structures, staff and attendees.'],
  ['Adverse Weather', 'General', 'Weather impacting operations.', 'Monitor conditions and adapt to reduce the risk of potential damage to structures, staff and attendees.']
  ];
  rows.forEach(function (r) {
    insertRow('FindingGuide', { id: newId('FindingGuide'), category: r[0], subCategory: r[1], description: r[2], suggestion: r[3] });
  });
  Logger.log('seedFindingGuide_: seeded ' + rows.length + ' Log Assistance Guide row(s).');
}

// Seeds the global Annex document-category catalog (Readiness > Annex). Idempotent: a per-event
// override row is NOT created here — AnnexEventCategories rows are synthesized virtually per event
// (same merge pattern as TemplateLibrary/Templates) until a PM/Analyst or EMC manager first touches
// that category for that event, at which point a real override row is written.
function seedAnnexCategories_() {
  var existing = getAll('AnnexCategories');
  if (existing.length > 0) return;
  var rows = [
    // section, name
    ['RiskAssessments', 'Event General Risk Assessment'],
    ['RiskAssessments', 'HSE Risk Assessment'],
    ['RiskAssessments', 'Fire Risk Assessment'],
    ['RiskAssessments', 'Crowd Risk Assessment'],
    ['RiskAssessments', 'Security Risk Assessment'],
    ['RiskAssessments', 'Traffic Risk Assessment'],
    ['RiskAssessments', 'Medical Risk Assessment'],
    ['RiskAssessments', 'Generators Risk Assessment'],
    ['RiskAssessments', 'F&B Risk Assessment'],
    ['RiskAssessments', 'Rides Risk Assessment'],
    ['RiskAssessments', 'Pyro Risk Assessment'],
    ['RiskAssessments', 'SFX Risk Assessment'],
    ['RiskAssessments', 'Other Risk Assessment, where applicable'],
    ['SignOffs', 'Civil Defence Sign-Off'],
    ['SignOffs', 'Third-Party Fire & Evacuation Sign-Off'],
    ['SignOffs', 'Third-Party Electricity Sign-Off'],
    ['SignOffs', 'Third-Party Temporary Structure Sign-Off'],
    ['SignOffs', 'Third-Party Rigging / AVL Sign-Off'],
    ['SignOffs', 'Third-Party Grandstands Sign-Off'],
    ['SignOffs', 'Third-Party F&B Booths / Trucks Sign-Off'],
    ['SignOffs', 'Other Sign-Off, where applicable'],
    ['Certifications', 'Trusses Certification / TUV'],
    ['Certifications', 'Rides Certification / TUV'],
    ['Certifications', 'Fire Retardancy Certificate for Fabrics'],
    ['Certifications', 'Fire Retardancy Certificate for Partition Walls'],
    ['Certifications', 'Fire Retardancy Certificate for Branding'],
    ['Certifications', 'Fire Retardancy Certificate for Mesh'],
    ['Certifications', 'Other TUV / Certification, where applicable']
  ];
  var orderIndex = { RiskAssessments: 0, SignOffs: 0, Certifications: 0 };
  rows.forEach(function (r) {
    var section = r[0];
    orderIndex[section] += 1;
    insertRow('AnnexCategories', {
      id: newId('AnnexCategories'), section: section, name: r[1],
      orderIndex: orderIndex[section], status: 'Active'
    });
  });
  Logger.log('seedAnnexCategories_: seeded ' + rows.length + ' Annex categories.');
}

function seedConfig_() {
  if (!getById('Config', 'escalationTier2DelayHours', 'key')) setConfig('escalationTier2DelayHours', 24);
  if (!getById('Config', 'escalationTier3DelayHours', 'key')) setConfig('escalationTier3DelayHours', 48);
}

function seedFirstAdmin_() {
  var existing = findWhere('Users', function (u) { return u.role === ROLES.SYSTEM_ADMIN; });

  // Case 1: no System Admin row at all -> create one from scratch.
  if (existing.length === 0) {
    var email = Session.getActiveUser().getEmail() || 'admin@example.com';
    createUserWithPassword({
      id: newId('Users'), name: 'System Admin', email: email, orgType: 'SYSTEM', orgId: '',
      role: ROLES.SYSTEM_ADMIN, status: 'Active', createdBy: 'setup'
    }, 'ChangeMe123!');
    Logger.log('Seeded first System Admin: ' + email + ' / temp password ChangeMe123! (change immediately)');
    return;
  }

  // Case 2: a System Admin row exists (e.g. imported from the original .ods, which predates
  // the passwordHash/passwordSalt columns) but has no password set yet -> repair it so it can
  // actually log in, instead of silently leaving it unusable.
  existing.forEach(function (u) {
    if (!u.passwordHash) {
      var salt = randomToken_(16);
      updateRow('Users', u.id, { passwordSalt: salt, passwordHash: hashPassword_('ChangeMe123!', salt), status: 'Active' });
      Logger.log('Repaired existing System Admin ' + u.email + ' (' + u.id + ') / temp password ChangeMe123! (change immediately)');
    }
  });
}

// REQ follow-up: the sweep used to be hardcoded to 30 minutes, which put a 30-minute floor on how
// promptly ANY of the three things piggybacking on it (escalation tiers, Place-account
// deactivation, template-deadline checks) could react even if their own configured delay was much
// shorter -- e.g. an admin setting a Tier 2 delay of 5 minutes (setEscalationConfig allows as low
// as 1) still wouldn't see it fire for up to 30. ScriptApp's ClockTriggerBuilder.everyMinutes only
// accepts 1, 5, 10, 15, or 30 -- not an arbitrary number -- so this snaps whatever's configured to
// the nearest of those instead of erroring. Defaults to 5 (6x tighter than the old hardcoded value)
// rather than 1, since a 1-minute sweep scanning every open Finding/Place/Template on a busy
// deployment is needlessly close to Apps Script's daily trigger-runtime quota for marginal benefit
// -- SystemAdmins who need finer than 5 minutes can still dial it down from Config > Escalations.
var ESCALATION_CHECK_INTERVAL_ALLOWED_MINUTES_ = [1, 5, 10, 15, 30];
var ESCALATION_CHECK_INTERVAL_DEFAULT_MINUTES_ = 5;
function escalationCheckIntervalMinutes_() {
  var configured = Number(getConfig('escalationCheckIntervalMinutes', ESCALATION_CHECK_INTERVAL_DEFAULT_MINUTES_));
  if (isNaN(configured) || configured <= 0) configured = ESCALATION_CHECK_INTERVAL_DEFAULT_MINUTES_;
  var nearest = ESCALATION_CHECK_INTERVAL_ALLOWED_MINUTES_[0];
  ESCALATION_CHECK_INTERVAL_ALLOWED_MINUTES_.forEach(function (m) {
    if (Math.abs(m - configured) < Math.abs(nearest - configured)) nearest = m;
  });
  return nearest;
}

function installEscalationTrigger_() {
  var already = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'scheduledEscalationCheck'; });
  if (already) return;
  ScriptApp.newTrigger('scheduledEscalationCheck').timeBased().everyMinutes(escalationCheckIntervalMinutes_()).create();
}

// Called from setEscalationConfig (Resolutions.gs) whenever the interval changes, so a SystemAdmin
// sees it take effect immediately instead of needing to re-run setupHulul from the Apps Script
// editor. Safe to call any time -- deletes every existing scheduledEscalationCheck trigger (there
// should only ever be one; the >1 case would only happen from manual editor tampering) before
// creating the fresh one, so re-saving the same interval twice never leaves duplicates running.
function reinstallEscalationTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'scheduledEscalationCheck') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('scheduledEscalationCheck').timeBased().everyMinutes(escalationCheckIntervalMinutes_()).create();
}

// Wrapper so the trigger doesn't need an acting user. Also carries deactivateEndedEventPlaceAccounts
// (Places.gs) and checkTemplateDeadlines (Templates.gs) piggybacking on the same configurable-interval
// trigger (escalationCheckIntervalMinutes_ above, 5 minutes by default) rather than installing a
// separate one each -- REQ: "when an event ends all participant accounts
// registered under events will be deactivated" / "a document becomes Missed if the Event Manager
// does not submit before the deadline."
function scheduledEscalationCheck() {
  runEscalationCheck(null);
  deactivateEndedEventPlaceAccounts();
  checkTemplateDeadlines();
}
