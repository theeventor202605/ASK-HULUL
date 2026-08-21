/**
 * HULUL - Log Assistance Guide admin view (reference catalogue used by the New/Edit Finding form to
 * suggest a Description + Suggested Action once an inspector picks a Category/Sub-Category -- see
 * findings.js's own header comment on the suggestion picker). Setup.gs's seedFindingGuide_ seeds the
 * initial ~176 rows from the user's "Log Assistance Guide" spreadsheet; this page lets
 * SystemAdmin/InspectionAdmin/ProjectManager maintain it going forward (add/edit/delete rows, CSV
 * import/export) without needing a code change every time.
 *
 * Layout mirrors checklistItems.js: a Category list down the left narrows the table on the right,
 * since a real guide can span many categories x many sub-categories x many descriptions.
 *
 * Category is a closed dropdown sourced only from the live Disciplines catalog (/disciplines) --
 * same enforced link as Checklists' own Category field (openChecklistItemForm_, checklistItems.js),
 * both in the add/edit form (openFindingGuideForm_) and CSV import (importFindingGuideCsv). Backend
 * (FindingGuide.gs) also rejects a category that doesn't match a Disciplines name on
 * create/update/bulk-import, so this can't be bypassed by calling the API directly either.
 *
 * Sub-Category (FindingGuide.subCategory, labelled Term('checklistType') = "Sub-Category" everywhere
 * else) is deliberately NOT a closed catalog -- Checklists' own Sub-Category field isn't one either
 * (openChecklistItemForm_'s type select is itself suggest-or-add-new, not locked to a fixed list), and
 * findings.js's Checklist Type dropdown unions ChecklistItems.checklistType with FindingGuide.subCategory
 * per Category specifically so guide coverage can exist ahead of a matching checklist item. What WAS a
 * gap: openFindingGuideForm_'s Sub-Category suggestions only echoed other FindingGuide rows, never the
 * Sub-Category names already in use over in Checklists -- so an admin here had no visibility into an
 * existing "Restaurants" checklist type and could easily type "Restaurant" instead, splitting one real
 * Sub-Category into two near-duplicates. Fixed by unioning in ChecklistItems.checklistType (scoped to
 * the selected Category) the same way findings.js's own findingGuideTypesFor_ already unions the
 * opposite direction -- see subCategoriesFor_ below.
 */
async function renderFindingGuide() {
  var root = document.getElementById('viewRoot');
  var canManage = hasPermission('findingGuide.manage');
  var [entries, disciplines, checklistItems] = await Promise.all([
    Api.call('listFindingGuide', {}), Api.call('listDisciplines', {}), Api.call('listChecklistItems', {})
  ]);
  var view = { category: '' };
  // REQ: "When turning platform to Arabic, some information is still in English" -- Category (a
  // Discipline name) has its own nameAr; Sub-Category has no Ar field of its own on FindingGuide (it's
  // the same concept as ChecklistItems.checklistType, which does), so its Arabic text is looked up
  // there instead -- same best-effort-first-match approach checklistItems.js/enrichFinding_ use.
  var disciplineArByName_ = {};
  disciplines.forEach(function (d) { if (d.nameAr) disciplineArByName_[d.name] = d.nameAr; });
  var typeArByType_ = {};
  checklistItems.forEach(function (c) { if (c.checklistType && c.checklistTypeAr && !typeArByType_[c.checklistType]) typeArByType_[c.checklistType] = c.checklistTypeAr; });

  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + esc(t('finding_guide_title')) + '</div>' +
    '<div class="page-subtitle">' + esc(t('finding_guide_subtitle')) + '</div></div>' +
    (canManage ? '<button class="btn btn-primary" id="newGuideEntryBtn">' + esc(t('new_x', { term: t('finding_guide_entry').toLowerCase() })) + '</button>' : '') +
    '</div>' +
    '<div id="fgBody"></div>';

  function wireCsvButtons_() {
    document.getElementById('fgExportCsvBtn').onclick = function () { exportFindingGuideCsv(entries); };
    if (canManage) {
      var fgImportInput = document.getElementById('fgImportCsvInput');
      document.getElementById('fgImportCsvBtn').onclick = function () { fgImportInput.click(); };
      fgImportInput.onchange = function (e) {
        var file = e.target.files[0];
        if (file) importFindingGuideCsv(file, disciplines);
        e.target.value = '';
      };
    }
  }
  function csvButtonsHtml_() {
    return '<button type="button" class="btn btn-secondary btn-sm btn-icon" id="fgExportCsvBtn" title="' + esc(t('export_csv')) + '">' + ICON('export_csv') + '</button>' +
      (canManage ?
        '<button type="button" class="btn btn-secondary btn-sm btn-icon" id="fgImportCsvBtn" title="' + esc(t('import_csv')) + '">' + ICON('import_csv') + '</button>' +
        '<input type="file" id="fgImportCsvInput" accept=".csv" style="display:none;" />'
        : '');
  }

  if (canManage) document.getElementById('newGuideEntryBtn').onclick = function () {
    openFindingGuideForm_(entries, disciplines, checklistItems, {
      title: t('new_x_title', { term: t('finding_guide_entry') }),
      submitLabel: t('create'),
      initial: {},
      onSubmit: async function (payload) {
        await Api.call('createFindingGuideEntry', payload);
        UI.closeModal(); UI.toast(t('x_created', { term: t('finding_guide_entry') }), 'success'); Router.resolve();
      }
    });
  };

  if (!entries.length) {
    document.getElementById('fgBody').innerHTML =
      '<div class="card">' +
        '<div class="card-header" style="display:flex;justify-content:flex-end;gap:6px;">' + csvButtonsHtml_() + '</div>' +
        '<div class="card-body"><div class="empty-state">' + t('no_data') + '</div></div>' +
      '</div>';
    wireCsvButtons_();
    return;
  }

  document.getElementById('fgBody').innerHTML =
    '<div class="list-page-layout">' +
      '<div class="card list-page-sidebar" style="width:230px;">' +
        '<div class="card-header"><div class="card-title">' + esc(t('col_category')) + '</div></div>' +
        '<div id="fgCategoryPanel" style="padding:8px;max-height:420px;overflow-y:auto;"></div>' +
      '</div>' +
      '<div style="flex:1;min-width:0;">' +
        // UI.table already gives every table its own filter box (+ /c column search, sort, CSV
        // export) for free -- no separate search input needed here, same convention as
        // disciplines.js/checklistItems.js. Just the CSV import/export icons for this list live here.
        '<div style="display:flex;justify-content:flex-end;gap:6px;margin-bottom:8px;">' + csvButtonsHtml_() + '</div>' +
        '<div id="fgTableWrap"></div>' +
      '</div>' +
    '</div>';
  wireCsvButtons_();

  var rowStyle = 'padding:8px 10px;border-radius:8px;cursor:pointer;font-size:13px;margin-top:2px;';

  function renderCategoryPanel() {
    var categories = Array.from(new Set(entries.map(function (g) { return g.category; }))).sort();
    if (!view.category || categories.indexOf(view.category) === -1) view.category = categories[0] || '';
    var panel = document.getElementById('fgCategoryPanel');
    panel.innerHTML =
      '<div class="ci-phase-row" data-cat="" style="' + rowStyle + (!view.category ? 'background:var(--accent);color:#fff;font-weight:600;' : '') + '">' + esc(t('all_categories')) + '</div>' +
      categories.map(function (c) {
        var active = c === view.category;
        var count = entries.filter(function (g) { return g.category === c; }).length;
        return '<div class="ci-phase-row" data-cat="' + esc(c) + '" style="' + rowStyle + (active ? 'background:var(--accent);color:#fff;font-weight:600;' : '') + '">' + esc(bi_(c, disciplineArByName_[c])) + ' <span class="muted" style="font-size:11px;">(' + count + ')</span></div>';
      }).join('');
    panel.querySelectorAll('[data-cat]').forEach(function (row) {
      row.onclick = function () { view.category = row.getAttribute('data-cat'); renderCategoryPanel(); renderTable(); };
    });
  }
  // Category filter defaults to "All categories" (blank) on first load -- REQ follow-up context: a
  // freshly-seeded guide spans 9 categories, so landing on just the first one alphabetically would
  // hide most of the catalogue by default.
  view.category = '';

  function renderTable() {
    var filtered = entries.filter(function (g) { return !view.category || g.category === view.category; });
    var wrap = document.getElementById('fgTableWrap');
    wrap.innerHTML = '<div class="card"><div class="card-body">' + UI.table([
      { key: 'category', label: t('col_category'), render: r => esc(bi_(r.category, disciplineArByName_[r.category])) },
      { key: 'subCategory', label: t('col_sub_category'), render: r => esc(bi_(r.subCategory, typeArByType_[r.subCategory])) },
      { key: 'description', label: t('field_description'), render: r => esc(bi_(r.description, r.descriptionAr)) },
      { key: 'suggestion', label: t('col_suggestion'), render: r => esc(bi_(r.suggestion, r.suggestionAr)) }
    ].concat(canManage ? [{ key: 'actions', label: t('actions'), render: r =>
        UI.actionsCell(
          '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('action_edit')) + '" data-edit-fg="' + r.id + '">' + ICON('edit') + '</button> ' +
          '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('action_delete')) + '" data-delete-fg="' + r.id + '">' + ICON('delete') + '</button>'
        ) }] : []),
      filtered, { hideExportButton: true }) + '</div></div>';

    if (!canManage) return;
    wrap.querySelectorAll('[data-edit-fg]').forEach(function (btn) {
      btn.onclick = function () {
        var entry = entries.filter(function (g) { return g.id === btn.getAttribute('data-edit-fg'); })[0];
        if (!entry) return;
        openFindingGuideForm_(entries, disciplines, checklistItems, {
          title: t('edit_x', { term: t('finding_guide_entry') }),
          submitLabel: t('save'),
          initial: entry,
          onSubmit: async function (payload) {
            await Api.call('updateFindingGuideEntry', Object.assign({ entryId: entry.id }, payload));
            UI.closeModal(); UI.toast(t('x_updated', { term: t('finding_guide_entry') }), 'success'); Router.resolve();
          }
        });
      };
    });
    wrap.querySelectorAll('[data-delete-fg]').forEach(function (btn) {
      btn.onclick = function () {
        var entryId = btn.getAttribute('data-delete-fg');
        UI.confirmModal(t('delete_finding_guide_entry_confirm'), async function () {
          try {
            await Api.call('deleteFindingGuideEntry', { entryId: entryId });
            UI.toast(t('x_deleted', { term: t('finding_guide_entry') }), 'success'); Router.resolve();
          } catch (err) { UI.error(err); }
        }, { confirmLabel: t('delete') });
      };
    });
  }

  renderCategoryPanel();
  renderTable();
}

// Shared by "+ New" and each row's Edit button.
//
// REQ follow-up (verification): "Verify that Inspector Qualifications, Checklists Category, and Log
// Assistance Guide Category all are linked to Categories" surfaced that this Category field used to
// be a suggestable select -- Disciplines catalog names plus an "Add new category" free-text escape
// hatch -- unlike Checklists' Category (openChecklistItemForm_, checklistItems.js), which only ever
// offers the live Disciplines list with no way to type something else. Tightened to match that same
// closed-dropdown behavior: categoryOptions is the Disciplines catalog ONLY (same "create a Category
// first" disabled-select fallback as checklistItems.js's fCiCategory when the catalog is still empty).
//
// REQ follow-up (verification): "Verify that Log Assistance Guide Sub-Category are linked to
// Checklists Sub-Category." Sub-Category stays free-text -- there's no separate Sub-Category catalog
// to lock it to, and Checklists' own Sub-Category field isn't a closed catalog either (see the file
// header comment). But its <datalist> suggestions used to only echo other FindingGuide rows, missing
// the Sub-Category names already in use over in Checklists for the same Category -- now unioned in via
// checklistItems (scoped to cat), same direction findings.js's findingGuideTypesFor_ already unions
// the opposite way (FindingGuide subCategories into the Finding form's Checklist Type dropdown).
function openFindingGuideForm_(entries, disciplines, checklistItems, opts) {
  var initial = opts.initial || {};
  var subCategoriesByCategory = {};
  entries.forEach(function (g) {
    if (!g.category) return;
    (subCategoriesByCategory[g.category] = subCategoriesByCategory[g.category] || {})[g.subCategory] = true;
  });
  checklistItems.forEach(function (c) {
    if (!c.category || !c.checklistType) return;
    (subCategoriesByCategory[c.category] = subCategoriesByCategory[c.category] || {})[c.checklistType] = true;
  });
  var subCategoriesFor_ = function (cat) {
    return subCategoriesByCategory[cat] ? Object.keys(subCategoriesByCategory[cat]).filter(Boolean).sort() : [];
  };
  var categoryOptionsHtml = disciplines.map(function (d) {
    return '<option value="' + esc(d.name) + '"' + (d.name === initial.category ? ' selected' : '') + '>' + esc(d.name) + '</option>';
  }).join('');
  var initialCategory = initial.category || (disciplines.length ? disciplines[0].name : '');

  var body =
    UI.field(t('col_category'), disciplines.length
      ? '<select id="fFgCategorySelect" class="field-input">' + categoryOptionsHtml + '</select>'
      : '<select id="fFgCategorySelect" class="field-input" disabled><option value="">' + esc(t('create_x_first_page_hint', { term: Term('discipline').toLowerCase(), termPlural: Term('discipline_plural') })) + '</option></select>') +
    UI.field(t('col_sub_category'),
      '<input id="fFgSubCategory" class="field-input" list="fgSubCategoryList" value="' + esc(initial.subCategory || '') + '" />' +
      '<datalist id="fgSubCategoryList">' + subCategoriesFor_(initialCategory).map(function (s) { return '<option value="' + esc(s) + '"></option>'; }).join('') + '</datalist>'
    ) +
    UI.field(t('field_description'), '<textarea id="fFgDesc" class="field-input" rows="2">' + esc(initial.description || '') + '</textarea>') +
    UI.field(t('field_arabic_x', { term: t('field_description') }), '<textarea id="fFgDescAr" class="field-input" dir="rtl" rows="2">' + esc(initial.descriptionAr || '') + '</textarea>') +
    UI.field(t('col_suggestion'), '<textarea id="fFgSuggestion" class="field-input" rows="2">' + esc(initial.suggestion || '') + '</textarea>') +
    UI.field(t('field_arabic_x', { term: t('col_suggestion') }), '<textarea id="fFgSuggestionAr" class="field-input" dir="rtl" rows="2">' + esc(initial.suggestionAr || '') + '</textarea>');

  UI.openModal(opts.title, body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: opts.submitLabel, className: 'btn-primary', onClick: async function () {
        if (!disciplines.length) { UI.toast(t('toast_create_x_first', { term: Term('discipline').toLowerCase() }), 'error'); return; }
        var category = document.getElementById('fFgCategorySelect').value;
        var subCategory = document.getElementById('fFgSubCategory').value.trim();
        var description = document.getElementById('fFgDesc').value.trim();
        if (!category) { UI.toast(t('toast_category_required'), 'error'); return; }
        if (!subCategory) { UI.toast(t('toast_sub_category_required'), 'error'); return; }
        if (!description) { UI.toast(t('toast_description_required'), 'error'); return; }
        var payload = {
          category: category, subCategory: subCategory, description: description,
          suggestion: document.getElementById('fFgSuggestion').value.trim(),
          descriptionAr: document.getElementById('fFgDescAr').value.trim(),
          suggestionAr: document.getElementById('fFgSuggestionAr').value.trim()
        };
        try { await opts.onSubmit(payload); } catch (err) { UI.error(err); }
      } }
  ]);

  var catSelectEl = document.getElementById('fFgCategorySelect');
  var subCategoryListEl = document.getElementById('fgSubCategoryList');
  catSelectEl.onchange = function () {
    var subs = subCategoriesFor_(catSelectEl.value);
    subCategoryListEl.innerHTML = subs.map(function (s) { return '<option value="' + esc(s) + '"></option>'; }).join('');
  };
}

/* ---------------- CSV export / import ----------------
 * Reuses csvEscape_, parseCsv_, and showImportResults_ from events.js (loaded on the same page). */
function exportFindingGuideCsv(rows) {
  var headers = [t('col_category'), t('col_sub_category'), t('field_description'), t('col_suggestion')];
  var lines = [headers.map(csvEscape_).join(',')];
  rows.forEach(function (r) {
    lines.push([r.category, r.subCategory, r.description, r.suggestion].map(csvEscape_).join(','));
  });
  // Leading UTF-8 BOM so Excel renders non-Latin text correctly instead of mojibake.
  var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = 'hulul-log-assistance-guide-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

var FINDING_GUIDE_IMPORT_BATCH_SIZE_ = 200;

// disciplines (REQ follow-up: same Category-must-match-the-catalog tightening as the create/edit
// form above) -- validated client-side here the same way checklistItems.js's importChecklistItemsCsv
// already validates its own Category column against validNames, so a bad row is caught immediately
// instead of round-tripping to the backend just to get rejected there.
async function importFindingGuideCsv(file, disciplines) {
  var text = await file.text();
  var rows = parseCsv_(text);
  if (!rows.length) { UI.toast(t('empty_csv'), 'error'); return; }
  var headers = rows[0].map(function (h) { return h.trim().toLowerCase(); });
  var col = function (name) { return headers.indexOf(name); };
  var idxCategory = col('category');
  var idxSubCategory = col('sub-category') !== -1 ? col('sub-category') : (col('subcategory') !== -1 ? col('subcategory') : col('sub category'));
  var idxDesc = col('description');
  var idxSuggestion = col('suggestion');
  if (idxCategory === -1 || idxSubCategory === -1 || idxDesc === -1) {
    UI.toast(t('finding_guide_csv_columns_required'), 'error');
    return;
  }
  var validNames = {};
  (disciplines || []).forEach(function (d) { validNames[d.name] = true; });

  var results = { created: [], failed: [] };
  var toSend = [];
  for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    if (!row.length || row.every(function (c) { return c.trim() === ''; })) continue;
    var category = (row[idxCategory] || '').trim();
    var subCategory = (row[idxSubCategory] || '').trim();
    var description = (row[idxDesc] || '').trim();
    var label = description || subCategory || '(unnamed)';
    if (!category || !subCategory || !description) {
      results.failed.push({ row: r + 1, name: label, reason: t('col_category') + ', ' + t('col_sub_category') + ', and ' + t('field_description') + ' are required' });
      continue;
    }
    if (!validNames[category]) {
      results.failed.push({ row: r + 1, name: label, reason: Term('discipline') + ' "' + category + '" doesn\'t match an existing ' + Term('discipline').toLowerCase() + ' name exactly (see the ' + Term('discipline_plural') + ' page)' });
      continue;
    }
    toSend.push({
      row: r + 1, category: category, subCategory: subCategory, description: description,
      suggestion: idxSuggestion !== -1 ? (row[idxSuggestion] || '').trim() : ''
    });
  }

  if (toSend.length) {
    var progress = UI.progressModal(t('importing_finding_guide'), toSend.length);
    var sent = 0;
    for (var i = 0; i < toSend.length; i += FINDING_GUIDE_IMPORT_BATCH_SIZE_) {
      var chunk = toSend.slice(i, i + FINDING_GUIDE_IMPORT_BATCH_SIZE_);
      try {
        var res = await Api.call('bulkCreateFindingGuideEntries', { items: chunk });
        results.created = results.created.concat(res.created);
        results.failed = results.failed.concat(res.failed);
      } catch (err) {
        chunk.forEach(function (item) {
          results.failed.push({ row: item.row, name: item.description, reason: err.message });
        });
      }
      sent += chunk.length;
      progress.update(sent, sent + ' of ' + toSend.length);
    }
    UI.closeModal();
  }
  results.failed.sort(function (a, b) { return a.row - b.row; });
  showImportResults_(results);
  if (results.created.length) Router.resolve();
}
