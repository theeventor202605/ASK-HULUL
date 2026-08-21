/**
 * HULUL - Translations.gs
 * REQ: "We have a team of translators. We would like to have them take care of the translations. I
 * think having an interface for this specific task would be helpful. We also need to know the
 * percentage of translation. they also get to know what has not been translated yet."
 *
 * Every optional Arabic field the app has grown over time (Categories/Disciplines.nameAr, Checklist
 * Types/ChecklistItems.checklistTypeAr, Log Assistance Guide/FindingGuide.descriptionAr+suggestionAr,
 * Risk Logs/Findings.descriptionAr+suggestedActionAr, Places.nameAr) was designed to be filled in by
 * whoever happens to be creating that record (see each field's own commit history) -- there was never
 * a dedicated place for a translator, who didn't create the English text, to go find everything still
 * missing its Arabic counterpart. listTranslationItems flattens all of the above into one worklist (one
 * row per translatable English string); updateTranslation writes a single row's Arabic value back to
 * its real home table. Percentage-translated and "show only untranslated" are both derived client-side
 * from this same flat list (translations.js) rather than a separate summary endpoint -- the list is
 * cheap enough (a handful of getAll() scans, same cost as any other admin catalogue page) that a second
 * round trip just to recompute a count would be pure overhead.
 *
 * Gated by its own 'translation.manage' permission (Permissions.gs) rather than piggy-backing on each
 * record's own manage permission (discipline.manage/finding.edit/place.manage/...) -- the whole point
 * is a SystemAdmin can create a 'Translator' custom role (Settings > Roles) that can see and edit
 * translations ONLY, with none of the broader create/delete/workflow access those other permissions
 * would also carry.
 */

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

  // Categories (Disciplines) -- one row per category, name -> nameAr.
  getAll('Disciplines').forEach(function (d) {
    items.push({
      key: 'discipline:' + d.id, recordType: 'discipline', recordId: d.id,
      category: 'categories', context: d.code || '',
      source: d.name || '', target: d.nameAr || ''
    });
  });

  // Checklist Types -- deduped across every non-deleted ChecklistItems row (see helper above).
  var checklistItems = getAll('ChecklistItems').filter(function (c) { return c.status !== 'Deleted'; });
  var typeInfo = translationChecklistTypeInfo_(checklistItems);
  Object.keys(typeInfo).forEach(function (type) {
    items.push({
      key: 'checklistType:' + type, recordType: 'checklistType', checklistType: type,
      category: 'checklistTypes', context: String(typeInfo[type].count),
      source: type, target: typeInfo[type].target
    });
  });

  // Log Assistance Guide (FindingGuide) -- Description and Suggested Action are two independently
  // translatable strings per row, so each becomes its own worklist item.
  getAll('FindingGuide').forEach(function (g) {
    var ctx = (g.category || '') + (g.subCategory ? ' / ' + g.subCategory : '');
    if (g.description) {
      items.push({
        key: 'findingGuideDescription:' + g.id, recordType: 'findingGuideDescription', recordId: g.id,
        category: 'findingGuide', context: ctx, field: 'description',
        source: g.description, target: g.descriptionAr || ''
      });
    }
    if (g.suggestion) {
      items.push({
        key: 'findingGuideSuggestion:' + g.id, recordType: 'findingGuideSuggestion', recordId: g.id,
        category: 'findingGuide', context: ctx, field: 'suggestedAction',
        source: g.suggestion, target: g.suggestionAr || ''
      });
    }
  });

  // Risk Logs (Findings) -- every Finding regardless of workflow status, so translators can also catch
  // up on older/already-resolved logs, not just ones still open.
  getAll('Findings').forEach(function (f) {
    var ctx = (f.category || '') + (f.subCategory ? ' / ' + f.subCategory : '');
    if (f.description) {
      items.push({
        key: 'findingDescription:' + f.id, recordType: 'findingDescription', recordId: f.id,
        category: 'findings', context: f.id + (ctx ? ' — ' + ctx : ''), field: 'description',
        source: f.description, target: f.descriptionAr || ''
      });
    }
    if (f.suggestedAction) {
      items.push({
        key: 'findingSuggestedAction:' + f.id, recordType: 'findingSuggestedAction', recordId: f.id,
        category: 'findings', context: f.id + (ctx ? ' — ' + ctx : ''), field: 'suggestedAction',
        source: f.suggestedAction, target: f.suggestedActionAr || ''
      });
    }
  });

  // Places -- name -> nameAr; context shows the owning Venue so a translator can tell two
  // identically-named Places (e.g. "Gate 1" at two different venues) apart.
  var venueNameById_ = {};
  getAll('Venues').forEach(function (v) { venueNameById_[v.id] = v.name; });
  getAll('Places').forEach(function (pl) {
    if (!pl.name) return;
    items.push({
      key: 'place:' + pl.id, recordType: 'place', recordId: pl.id,
      category: 'places', context: venueNameById_[pl.venueId] || '',
      source: pl.name, target: pl.nameAr || ''
    });
  });

  return items;
}

// Single per-item save -- translations.js calls this once per row's Save click (or on blur), not a
// bulk endpoint, so one typo in a 500-row import can't wipe out unrelated rows; each field is its own
// independent, retriable write.
function updateTranslation(user, p) {
  requirePermission(user, 'translation.manage'); // RBAC pilot -- dedicated permission key, own page in the Permissions matrix
  if (!p || !p.recordType) throw new HululError('BAD_REQUEST', 'recordType is required');
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
    case 'findingGuideDescription': {
      var g1 = getById('FindingGuide', p.recordId);
      if (!g1) throw new HululError('NOT_FOUND', 'Guide entry not found');
      updateRow('FindingGuide', p.recordId, { descriptionAr: value });
      audit(user.id, 'UPDATE_TRANSLATION', 'FindingGuide', p.recordId, { descriptionAr: value });
      return { ok: true, target: value };
    }
    case 'findingGuideSuggestion': {
      var g2 = getById('FindingGuide', p.recordId);
      if (!g2) throw new HululError('NOT_FOUND', 'Guide entry not found');
      updateRow('FindingGuide', p.recordId, { suggestionAr: value });
      audit(user.id, 'UPDATE_TRANSLATION', 'FindingGuide', p.recordId, { suggestionAr: value });
      return { ok: true, target: value };
    }
    case 'findingDescription': {
      var f1 = getById('Findings', p.recordId);
      if (!f1) throw new HululError('NOT_FOUND', 'Finding not found');
      updateRow('Findings', p.recordId, { descriptionAr: value });
      audit(user.id, 'UPDATE_TRANSLATION', 'Findings', p.recordId, { descriptionAr: value });
      return { ok: true, target: value };
    }
    case 'findingSuggestedAction': {
      var f2 = getById('Findings', p.recordId);
      if (!f2) throw new HululError('NOT_FOUND', 'Finding not found');
      updateRow('Findings', p.recordId, { suggestedActionAr: value });
      audit(user.id, 'UPDATE_TRANSLATION', 'Findings', p.recordId, { suggestedActionAr: value });
      return { ok: true, target: value };
    }
    case 'place': {
      var pl = getById('Places', p.recordId);
      if (!pl) throw new HululError('NOT_FOUND', 'Place not found');
      updateRow('Places', p.recordId, { nameAr: value });
      // Propagate to every Participant this Place provisioned -- same sharedPatch idea as updatePlace
      // (Places.gs), just for nameAr alone, so a translator's edit stays in sync everywhere the name is
      // mirrored without needing full place.manage access to call updatePlace itself.
      var accountIds = pl.accountIds ? String(pl.accountIds).split(',').filter(Boolean) : [];
      if (accountIds.length) {
        getAll('Participants').forEach(function (pt) {
          if (accountIds.indexOf(pt.userId) !== -1) updateRow('Participants', pt.id, { nameAr: value });
        });
      }
      audit(user.id, 'UPDATE_TRANSLATION', 'Places', p.recordId, { nameAr: value });
      return { ok: true, target: value };
    }
    default:
      throw new HululError('BAD_REQUEST', 'Unknown translation record type: ' + p.recordType);
  }
}
