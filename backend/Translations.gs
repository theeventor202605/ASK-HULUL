/**
 * HULUL - Translations.gs
 * REQ: "We have a team of translators. We would like to have them take care of the translations. I
 * think having an interface for this specific task would be helpful. We also need to know the
 * percentage of translation. they also get to know what has not been translated yet."
 *
 * REQ follow-up: "Translators need to also translate free text input by inspectors. So if a user had
 * Arabic interface on and writes for example the log in Arabic language they need to translate to
 * English and vice versa." Free-text fields (Findings.description/suggestedAction,
 * FindingGuide.description/suggestion, Places.name) are typed directly by whoever is using the app --
 * their content is NOT reliably English just because it lives in the field nominally called
 * "description" rather than "descriptionAr". An Arabic-interface user typing into the main field
 * produces Arabic text sitting in the "English" column with the Arabic column left blank -- the
 * opposite of what listTranslationItems originally assumed. looksArabic_/translationPairItem_ below
 * detect that case per row and flip the translation direction (source = the Arabic text already
 * captured, target = the missing English translation); updateTranslation's bidirectional save path
 * re-derives the same thing from live data at save time and relocates the original text into its
 * proper-language field rather than losing it.
 *
 * Categories (Disciplines.name) and Checklist Types (ChecklistItems.checklistType) are deliberately
 * NOT given this bidirectional treatment -- both are used elsewhere as plain-string foreign keys
 * (FindingGuide.category/Findings.category match Disciplines.name exactly; InspectorAssignments/
 * Findings.subCategory match checklistType exactly), and renaming either safely requires the
 * cascade-the-rename logic updateDiscipline (Disciplines.gs) already has, which is out of scope for a
 * translation-only permission. Those two keep the original one-directional (fill in the Arabic column
 * only) behavior.
 *
 * Gated by its own 'translation.manage' permission (Permissions.gs) rather than piggy-backing on each
 * record's own manage permission (discipline.manage/finding.edit/place.manage/...) -- the whole point
 * is a SystemAdmin can create a 'Translator' custom role (Settings > Roles) that can see and edit
 * translations ONLY, with none of the broader create/delete/workflow access those other permissions
 * would also carry.
 */

// Arabic script detection (Arabic + Arabic Supplement + Arabic Presentation Forms blocks) -- used to
// tell whether a field's CURRENT content is actually written in Arabic, regardless of which field it's
// sitting in. Deliberately simple (a single regex test, not a full language-detection library): this
// only ever needs to distinguish Arabic script from everything else, and every language this app
// supports today is either Arabic or Latin-script English.
var ARABIC_SCRIPT_RE_ = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
function looksArabic_(str) { return !!(str && ARABIC_SCRIPT_RE_.test(str)); }

// Every bidirectional (translate-either-way) field pair, keyed by the same recordType string used in
// both listTranslationItems and updateTranslation -- centralized here so the relocate-on-save logic
// (saveBidirectionalTranslation_, below) is written once and shared by every category that uses it,
// instead of forked per case the way the pre-this-REQ version of this file had it.
var TRANSLATION_BIDIRECTIONAL_DEFS_ = {
  findingGuideDescription: { sheet: 'FindingGuide', enField: 'description', arField: 'descriptionAr' },
  findingGuideSuggestion: { sheet: 'FindingGuide', enField: 'suggestion', arField: 'suggestionAr' },
  findingDescription: { sheet: 'Findings', enField: 'description', arField: 'descriptionAr' },
  findingSuggestedAction: { sheet: 'Findings', enField: 'suggestedAction', arField: 'suggestedActionAr' },
  place: { sheet: 'Places', enField: 'name', arField: 'nameAr' }
};

// Builds one worklist item for a bidirectional EN/AR field pair, or null if there's nothing to
// translate against yet (both sides blank). `base` carries the caller's key/recordType/recordId/
// category/context; this only fills in source/target/direction.
//   - EN field holds real text that reads as Arabic, AR field blank: an Arabic-interface user typed
//     into the main field -- direction flips to 'toEnglish', source is that Arabic text, target (the
//     missing English translation) starts blank.
//   - EN field blank, AR field holds text: same 'toEnglish' direction, but the Arabic text is already
//     sitting in its own proper field (no relocation will be needed on save).
//   - Otherwise (the ordinary case): direction is 'toArabic', source is the EN field, target is
//     whatever the AR field currently holds (blank = still missing, filled = already translated but
//     still editable).
function translationPairItem_(base, enText, arText) {
  enText = String(enText || ''); arText = String(arText || '');
  if (!enText.trim() && !arText.trim()) return null;

  var item = Object.assign({}, base);
  if (looksArabic_(enText) && !arText.trim()) {
    item.source = enText; item.target = ''; item.direction = 'toEnglish';
  } else if (!enText.trim() && arText.trim()) {
    item.source = arText; item.target = ''; item.direction = 'toEnglish';
  } else {
    item.source = enText; item.target = arText; item.direction = 'toArabic';
  }
  return item;
}

// checklistType is stored per-ChecklistItems-row (not its own catalogue), so many rows can share the
// exact same English value -- same "first non-blank wins" convention checklistItems.js's own form uses
// to pre-fill a suggested Arabic value. updateTranslation (below) writes a change out to every row
// sharing that value, so this list always reflects one Arabic translation per unique English string,
// never a per-row fork.
function translationChecklistTypeInfo_(checklistItems) {
  var info = {};
  checklistItems.forEach(function (c) {
    if (!c.checklistType) return;
    if (!info[c.checklistType]) info[c.checklistType] = { target: '', count: 0 };
    info[c.checklistType].count++;
    if (c.checklistTypeAr && !info[c.checklistType].target) info[c.checklistType].target = c.checklistTypeAr;
  });
  return info;
}

function listTranslationItems(user) {
  requirePermission(user, 'translation.manage'); // RBAC pilot -- dedicated permission key, own page in the Permissions matrix
  var items = [];

  // Categories (Disciplines) -- one row per category, name -> nameAr. One-directional only (see file
  // header comment on why Categories/Checklist Types don't get the bidirectional treatment).
  getAll('Disciplines').forEach(function (d) {
    if (!d.name) return;
    items.push({
      key: 'discipline:' + d.id, recordType: 'discipline', recordId: d.id,
      category: 'categories', context: d.code || '',
      source: d.name, target: d.nameAr || '', direction: 'toArabic'
    });
  });

  // Checklist Types -- deduped across every non-deleted ChecklistItems row (see helper above).
  var checklistItems = getAll('ChecklistItems').filter(function (c) { return c.status !== 'Deleted'; });
  var typeInfo = translationChecklistTypeInfo_(checklistItems);
  Object.keys(typeInfo).forEach(function (type) {
    items.push({
      key: 'checklistType:' + type, recordType: 'checklistType', checklistType: type,
      category: 'checklistTypes', context: String(typeInfo[type].count),
      source: type, target: typeInfo[type].target, direction: 'toArabic'
    });
  });

  // Log Assistance Guide (FindingGuide) -- Description and Suggested Action are two independently
  // translatable strings per row, so each becomes its own worklist item.
  getAll('FindingGuide').forEach(function (g) {
    var ctx = (g.category || '') + (g.subCategory ? ' / ' + g.subCategory : '');
    // Suffixed so the two rows a single guide entry can produce (Description, Suggested Action) are
    // distinguishable at a glance -- both used to share the exact same context string, which was
    // ambiguous even before this REQ and only gets more confusing now that a row's direction can flip.
    var descItem = translationPairItem_(
      { key: 'findingGuideDescription:' + g.id, recordType: 'findingGuideDescription', recordId: g.id, category: 'findingGuide', context: ctx + ' (Description)' },
      g.description, g.descriptionAr);
    if (descItem) items.push(descItem);
    var suggItem = translationPairItem_(
      { key: 'findingGuideSuggestion:' + g.id, recordType: 'findingGuideSuggestion', recordId: g.id, category: 'findingGuide', context: ctx + ' (Suggested Action)' },
      g.suggestion, g.suggestionAr);
    if (suggItem) items.push(suggItem);
  });

  // Risk Logs (Findings) -- every Finding regardless of workflow status, so translators can also catch
  // up on older/already-resolved logs, not just ones still open. This is the primary case REQ follow-up
  // "translators need to also translate free text input by inspectors" is about: an inspector working in
  // Arabic typically fills only the main Description/Suggested Action fields (translationPairItem_
  // detects that and flips direction to 'toEnglish' automatically).
  getAll('Findings').forEach(function (f) {
    var ctx = f.id + ((f.category || f.subCategory) ? ' — ' + (f.category || '') + (f.subCategory ? ' / ' + f.subCategory : '') : '');
    var descItem = translationPairItem_(
      { key: 'findingDescription:' + f.id, recordType: 'findingDescription', recordId: f.id, category: 'findings', context: ctx + ' (Description)' },
      f.description, f.descriptionAr);
    if (descItem) items.push(descItem);
    var actionItem = translationPairItem_(
      { key: 'findingSuggestedAction:' + f.id, recordType: 'findingSuggestedAction', recordId: f.id, category: 'findings', context: ctx + ' (Suggested Action)' },
      f.suggestedAction, f.suggestedActionAr);
    if (actionItem) items.push(actionItem);
  });

  // Places -- name -> nameAr; context shows the owning Venue so a translator can tell two
  // identically-named Places (e.g. "Gate 1" at two different venues) apart.
  var venueNameById_ = {};
  getAll('Venues').forEach(function (v) { venueNameById_[v.id] = v.name; });
  getAll('Places').forEach(function (pl) {
    var item = translationPairItem_(
      { key: 'place:' + pl.id, recordType: 'place', recordId: pl.id, category: 'places', context: venueNameById_[pl.venueId] || '' },
      pl.name, pl.nameAr);
    if (item) items.push(item);
  });

  return items;
}

// Generic bidirectional save -- shared by every recordType in TRANSLATION_BIDIRECTIONAL_DEFS_.
// Re-derives whether the field's current EN-slot content needs relocating from LIVE row data at save
// time (never trusted from the client), so a save can never silently discard text a field already had,
// and two translators editing concurrently can't race each other into losing data.
function saveBidirectionalTranslation_(user, def, p) {
  var row = getById(def.sheet, p.recordId);
  if (!row) throw new HululError('NOT_FOUND', 'Record not found');
  var direction = p.direction === 'toEnglish' ? 'toEnglish' : 'toArabic';
  var value = p.value !== undefined ? String(p.value).trim() : '';
  var patch = {};

  if (direction === 'toArabic') {
    patch[def.arField] = value;
  } else {
    var currentEn = row[def.enField] || '';
    // The EN-named field currently holds Arabic text and the AR field is still empty -- this is the
    // "Arabic-interface user typed into the main field" case; preserve that original text in the AR
    // field before overwriting the EN field with the translator's new English text. If the AR field
    // already has something (however that happened), never clobber it.
    if (looksArabic_(currentEn) && !String(row[def.arField] || '').trim()) {
      patch[def.arField] = currentEn;
    }
    patch[def.enField] = value;
  }

  updateRow(def.sheet, p.recordId, patch);

  // Places.name/nameAr are mirrored onto every Participant this Place provisioned (same sharedPatch
  // idea as updatePlace, Places.gs) -- propagate whichever of the two fields this save actually
  // touched, so a translator's edit (either direction) stays in sync everywhere the name is mirrored
  // without needing full place.manage access to call updatePlace itself.
  if (def.sheet === 'Places') {
    var accountIds = row.accountIds ? String(row.accountIds).split(',').filter(Boolean) : [];
    if (accountIds.length) {
      getAll('Participants').forEach(function (pt) {
        if (accountIds.indexOf(pt.userId) !== -1) updateRow('Participants', pt.id, patch);
      });
    }
  }

  audit(user.id, 'UPDATE_TRANSLATION', def.sheet, p.recordId, patch);
  return { ok: true, patch: patch };
}

// Single per-item save -- translations.js calls this once per row's Save click, not a bulk endpoint, so
// one typo in a 500-row import can't wipe out unrelated rows; each field is its own independent,
// retriable write.
function updateTranslation(user, p) {
  requirePermission(user, 'translation.manage'); // RBAC pilot -- dedicated permission key, own page in the Permissions matrix
  if (!p || !p.recordType) throw new HululError('BAD_REQUEST', 'recordType is required');

  var bidirectionalDef = TRANSLATION_BIDIRECTIONAL_DEFS_[p.recordType];
  if (bidirectionalDef) return saveBidirectionalTranslation_(user, bidirectionalDef, p);

  var value = p.value !== undefined ? String(p.value).trim() : '';
  switch (p.recordType) {
    case 'discipline': {
      var d = getById('Disciplines', p.recordId);
      if (!d) throw new HululError('NOT_FOUND', 'Category not found');
      updateRow('Disciplines', p.recordId, { nameAr: value });
      audit(user.id, 'UPDATE_TRANSLATION', 'Disciplines', p.recordId, { nameAr: value });
      return { ok: true, target: value };
    }
    case 'checklistType': {
      if (!p.checklistType) throw new HululError('BAD_REQUEST', 'checklistType is required');
      var rows = findWhere('ChecklistItems', function (c) { return c.checklistType === p.checklistType; });
      if (!rows.length) throw new HululError('NOT_FOUND', 'No checklist items use this Checklist Type');
      rows.forEach(function (c) { updateRow('ChecklistItems', c.id, { checklistTypeAr: value }); });
      audit(user.id, 'UPDATE_TRANSLATION', 'ChecklistItems', p.checklistType, { checklistTypeAr: value, rowCount: rows.length });
      return { ok: true, target: value, rowCount: rows.length };
    }
    default:
      throw new HululError('BAD_REQUEST', 'Unknown translation record type: ' + p.recordType);
  }
}
