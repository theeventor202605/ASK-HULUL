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

function installEscalationTrigger_() {
  var triggers = ScriptApp.getProjectTriggers();
  var already = triggers.some(function (t) { return t.getHandlerFunction() === 'scheduledEscalationCheck'; });
  if (already) return;
  ScriptApp.newTrigger('scheduledEscalationCheck').timeBased().everyMinutes(30).create();
}

// Wrapper so the trigger doesn't need an acting user. Also carries deactivateEndedEventPlaceAccounts
// (Places.gs) and checkTemplateDeadlines (Templates.gs) piggybacking on the same 30-min trigger
// rather than installing a separate one each -- REQ: "when an event ends all participant accounts
// registered under events will be deactivated" / "a document becomes Missed if the Event Manager
// does not submit before the deadline."
function scheduledEscalationCheck() {
  runEscalationCheck(null);
  deactivateEndedEventPlaceAccounts();
  checkTemplateDeadlines();
}
