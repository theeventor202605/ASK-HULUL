/**
 * HULUL - Translations admin view (Translation Hub).
 * REQ: "We have a team of translators. We would like to have them take care of the translations. I
 * think having an interface for this specific task would be helpful. We also need to know the
 * percentage of translation. they also get to know what has not been translated yet."
 *
 * listTranslationItems (Translations.gs) returns one flat array covering every optional Arabic field
 * in the app -- Categories/Disciplines.nameAr, Checklist Types/ChecklistItems.checklistTypeAr (deduped
 * to one row per unique English value), Log Assistance Guide/FindingGuide.descriptionAr+suggestionAr,
 * Risk Logs/Findings.descriptionAr+suggestedActionAr, Places.nameAr. This page turns that flat list
 * into: an overall + per-category %-translated progress bar (computed client-side -- cheap enough over
 * a list this size that a separate summary endpoint would just be a second round trip for no benefit),
 * a category filter, a "show untranslated only" toggle, and one editable Arabic textarea per row that
 * saves independently via updateTranslation (Translations.gs) -- no bulk save, so one row's edit can
 * never accidentally clobber another's.
 */

// labelFn (not a plain string) so each label re-derives Term()/t() at render time -- same reasoning as
// NAV_ITEMS' entityLabelFn (app.js): stays correct if the org renames a term or switches language
// mid-session, with no extra wiring needed here.
var TRANSLATION_CATEGORIES_ = [
  { id: 'categories', labelFn: function () { return Term('discipline_plural'); } },
  { id: 'checklistTypes', labelFn: function () { return Term('checklistType_plural'); } },
  { id: 'findingGuide', labelFn: function () { return t('finding_guide_title'); } },
  { id: 'findings', labelFn: function () { return Term('finding_plural'); } },
  { id: 'places', labelFn: function () { return t('translation_category_places'); } }
];

function translationCategoryLabel_(id) {
  var cat = TRANSLATION_CATEGORIES_.filter(function (c) { return c.id === id; })[0];
  return cat ? cat.labelFn() : id;
}

// Module-level (not closed over renderTranslations) so the category filter/untranslated-only toggle
// survive a re-render (every Save click re-renders the whole body to refresh percentages -- see
// wireTranslationsBody_ below) without needing to thread state through function arguments.
var HululTranslationState_ = { items: [], categoryFilter: 'all', untranslatedOnly: false };

async function renderTranslations() {
  var root = document.getElementById('viewRoot');
  root.innerHTML = '<div class="empty-state">' + esc(t('loading')) + '</div>';
  var items;
  try { items = await Api.call('listTranslationItems', {}); }
  catch (err) { UI.error(err); return; }
  HululTranslationState_.items = items;
  HululTranslationState_.categoryFilter = 'all';
  HululTranslationState_.untranslatedOnly = false;
  renderTranslationsBody_();
}

function translationStats_(items) {
  var total = items.length;
  var translated = items.filter(function (i) { return !!(i.target && i.target.trim()); }).length;
  return { total: total, translated: translated, pct: total ? Math.round((translated / total) * 100) : 100 };
}

function translationProgressBarHtml_(pct) {
  return '<div class="translation-progress-track"><div class="translation-progress-fill" style="width:' + pct + '%;"></div></div>';
}

function translationCatCardHtml_(id, label, stats, active) {
  return '<button type="button" class="translation-cat-card' + (active ? ' active' : '') + '" data-tcat="' + esc(id) + '">' +
    '<div class="translation-cat-label">' + esc(label) + '</div>' +
    '<div class="translation-cat-pct">' + stats.pct + '%</div>' +
    translationProgressBarHtml_(stats.pct) +
    '<div class="translation-cat-count">' + esc(t('translation_x_of_y', { done: stats.translated, total: stats.total })) + '</div>' +
  '</button>';
}

function renderTranslationsBody_() {
  var root = document.getElementById('viewRoot');
  var items = HululTranslationState_.items;
  var overall = translationStats_(items);

  var byCategory = {};
  items.forEach(function (i) { (byCategory[i.category] = byCategory[i.category] || []).push(i); });

  var catCardsHtml = translationCatCardHtml_('all', t('translation_all_categories'), overall, HululTranslationState_.categoryFilter === 'all') +
    TRANSLATION_CATEGORIES_.map(function (cat) {
      var stats = translationStats_(byCategory[cat.id] || []);
      return translationCatCardHtml_(cat.id, cat.labelFn(), stats, HululTranslationState_.categoryFilter === cat.id);
    }).join('');

  var filtered = items.filter(function (i) {
    if (HululTranslationState_.categoryFilter !== 'all' && i.category !== HululTranslationState_.categoryFilter) return false;
    if (HululTranslationState_.untranslatedOnly && i.target && i.target.trim()) return false;
    return true;
  });

  // Map (not filtered.indexOf(r) per row) so looking up a row's position stays O(1) even once a
  // translator's org has accumulated thousands of Risk Logs -- built once per render, not once per cell.
  var indexOfItem_ = new Map();
  filtered.forEach(function (it, idx) { indexOfItem_.set(it, idx); });

  var tableHtml = filtered.length ? UI.table([
    { key: 'category', label: t('col_category'), render: r => esc(translationCategoryLabel_(r.category)) },
    { key: 'context', label: t('col_context'), render: r => esc(r.context || '—') },
    { key: 'source', label: t('col_english'), render: r => '<div style="max-width:340px;white-space:pre-wrap;">' + esc(r.source) + '</div>' },
    { key: 'target', label: t('col_arabic'), render: r =>
        '<textarea class="field-input translation-input" dir="rtl" rows="2" placeholder="' + esc(t('translation_placeholder')) + '">' + esc(r.target) + '</textarea>' },
    { key: 'status', label: t('col_status'), exportValue: r => (r.target && r.target.trim()) ? t('translation_status_translated') : t('translation_status_missing'),
      render: r => (r.target && r.target.trim())
        ? '<span class="badge badge-low">' + esc(t('translation_status_translated')) + '</span>'
        : '<span class="badge badge-medium">' + esc(t('translation_status_missing')) + '</span>' },
    { key: 'actions', label: t('actions'), render: r => '<button class="btn btn-primary btn-sm" data-tidx="' + indexOfItem_.get(r) + '">' + esc(t('save')) + '</button>' }
  ], filtered, {}) : '<div class="empty-state">' + esc(t('no_matches')) + '</div>';

  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + esc(t('nav_translations')) + '</div>' +
    '<div class="page-subtitle">' + esc(t('translations_subtitle')) + '</div></div></div>' +
    '<div class="card"><div class="card-body">' +
      '<div class="translation-overall">' +
        '<div class="translation-overall-pct">' + overall.pct + '%</div>' +
        '<div style="flex:1;">' +
          '<div class="translation-overall-label">' + esc(t('translation_overall_label')) + '</div>' +
          translationProgressBarHtml_(overall.pct) +
          '<div class="muted" style="font-size:12px;margin-top:4px;">' + esc(t('translation_x_of_y', { done: overall.translated, total: overall.total })) + '</div>' +
        '</div>' +
      '</div>' +
    '</div></div>' +
    '<div class="translation-cat-grid">' + catCardsHtml + '</div>' +
    '<div class="card"><div class="card-body">' +
      '<label style="display:inline-flex;align-items:center;gap:6px;margin-bottom:12px;cursor:pointer;">' +
        '<input type="checkbox" id="untransOnlyChk"' + (HululTranslationState_.untranslatedOnly ? ' checked' : '') + ' /> ' + esc(t('translation_show_untranslated_only')) +
      '</label>' +
      tableHtml +
    '</div></div>';

  wireTranslationsBody_(filtered);
}

function wireTranslationsBody_(filtered) {
  var root = document.getElementById('viewRoot');

  root.querySelectorAll('[data-tcat]').forEach(function (btn) {
    btn.onclick = function () { HululTranslationState_.categoryFilter = btn.getAttribute('data-tcat'); renderTranslationsBody_(); };
  });

  var chk = document.getElementById('untransOnlyChk');
  if (chk) chk.onchange = function () { HululTranslationState_.untranslatedOnly = chk.checked; renderTranslationsBody_(); };

  // Each Save button looks up its own item by array index (set at render time, above) and its own
  // Arabic value from the textarea sharing its <tr> -- deliberately NOT by matching a data attribute
  // built from the item's own key/text (English/Arabic strings are arbitrary user content and could
  // contain characters that break a hand-built CSS attribute selector), so this is safe regardless of
  // what a translator has typed.
  root.querySelectorAll('[data-tidx]').forEach(function (btn) {
    btn.onclick = async function () {
      var item = filtered[Number(btn.getAttribute('data-tidx'))];
      if (!item) return;
      var row = btn.closest('tr');
      var textarea = row ? row.querySelector('.translation-input') : null;
      var value = textarea ? textarea.value : '';
      var payload = { recordType: item.recordType, value: value };
      if (item.recordType === 'checklistType') payload.checklistType = item.checklistType;
      else payload.recordId = item.recordId;
      btn.disabled = true;
      try {
        await Api.call('updateTranslation', payload);
        item.target = value; // keep the in-memory list in sync so the re-render below recomputes % correctly
        UI.toast(t('translation_saved'), 'success');
        renderTranslationsBody_(); // refresh progress bars/status badge without a network round trip
      } catch (err) { UI.error(err); btn.disabled = false; }
    };
  });
}
