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
 */
async function renderFindingGuide() {
  var root = document.getElementById('viewRoot');
  var canManage = hasPermission('findingGuide.manage');
  var [entries, disciplines] = await Promise.all([Api.call('listFindingGuide', {}), Api.call('listDisciplines', {})]);
  var view = { category: '' };

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
        if (file) importFindingGuideCsv(file);
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
    openFindingGuideForm_(entries, disciplines, {
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
        return '<div class="ci-phase-row" data-cat="' + esc(c) + '" style="' + rowStyle + (active ? 'background:var(--accent);color:#fff;font-weight:600;' : '') + '">' + esc(c) + ' <span class="muted" style="font-size:11px;">(' + count + ')</span></div>';
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
      { key: 'category', label: t('col_category') },
      { key: 'subCategory', label: t('col_sub_category') },
      { key: 'description', label: t('field_description') },
      { key: 'suggestion', label: t('col_suggestion') }
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
        openFindingGuideForm_(entries, disciplines, {
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

// Shared by "+ New" and each row's Edit button. Category is a dropdown sourced from the union of the
// live Disciplines catalog and any category already used in the guide (plus "Add new", same
// suggestable-select pattern as openChecklistItemForm_'s Checklist Type field) -- REQ context: the
// guide is meant to line up with the Disciplines catalog so findings.js's picker can match rows by
// exact Discipline name. Sub-Category is a free-text input with a <datalist> of sub-categories
// already used under the selected category, to encourage reusing existing names rather than
// introducing near-duplicates by typo.
function openFindingGuideForm_(entries, disciplines, opts) {
  var initial = opts.initial || {};
  var categoryNames = Array.from(new Set(
    disciplines.map(function (d) { return d.name; }).concat(entries.map(function (g) { return g.category; }))
  )).filter(Boolean).sort();
  var subCategoriesByCategory = {};
  entries.forEach(function (g) {
    if (!g.category) return;
    (subCategoriesByCategory[g.category] = subCategoriesByCategory[g.category] || {})[g.subCategory] = true;
  });
  var subCategoriesFor_ = function (cat) {
    return subCategoriesByCategory[cat] ? Object.keys(subCategoriesByCategory[cat]).sort() : [];
  };
  var catSelectHtml_ = function (selected) {
    var matched = selected && categoryNames.indexOf(selected) !== -1;
    return categoryNames.map(function (c) { return '<option value="' + esc(c) + '"' + (c === selected ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') +
      '<option value="__new__"' + (!matched && selected ? ' selected' : (!categoryNames.length ? ' selected' : '')) + '>' + esc(t('add_new_category_option')) + '</option>';
  };
  var initialCategory = initial.category || (categoryNames.length ? categoryNames[0] : '');

  var body =
    UI.field(t('col_category'),
      '<select id="fFgCategorySelect" class="field-input">' + catSelectHtml_(initial.category) + '</select>' +
      '<input id="fFgCategoryNew" class="field-input" placeholder="' + esc(t('col_category')) + '" style="margin-top:6px;' + (initial.category && categoryNames.indexOf(initial.category) !== -1 ? 'display:none;' : '') + '" value="' + esc(!initial.category || categoryNames.indexOf(initial.category) !== -1 ? '' : initial.category) + '" />'
    ) +
    UI.field(t('col_sub_category'),
      '<input id="fFgSubCategory" class="field-input" list="fgSubCategoryList" value="' + esc(initial.subCategory || '') + '" />' +
      '<datalist id="fgSubCategoryList">' + subCategoriesFor_(initialCategory).map(function (s) { return '<option value="' + esc(s) + '"></option>'; }).join('') + '</datalist>'
    ) +
    UI.field(t('field_description'), '<textarea id="fFgDesc" class="field-input" rows="2">' + esc(initial.description || '') + '</textarea>') +
    UI.field(t('col_suggestion'), '<textarea id="fFgSuggestion" class="field-input" rows="2">' + esc(initial.suggestion || '') + '</textarea>');

  UI.openModal(opts.title, body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: opts.submitLabel, className: 'btn-primary', onClick: async function () {
        var catSelect = document.getElementById('fFgCategorySelect');
        var category = catSelect.value === '__new__' ? document.getElementById('fFgCategoryNew').value.trim() : catSelect.value;
        var subCategory = document.getElementById('fFgSubCategory').value.trim();
        var description = document.getElementById('fFgDesc').value.trim();
        if (!category) { UI.toast(t('toast_category_required'), 'error'); return; }
        if (!subCategory) { UI.toast(t('toast_sub_category_required'), 'error'); return; }
        if (!description) { UI.toast(t('toast_description_required'), 'error'); return; }
        var payload = { category: category, subCategory: subCategory, description: description, suggestion: document.getElementById('fFgSuggestion').value.trim() };
        try { await opts.onSubmit(payload); } catch (err) { UI.error(err); }
      } }
  ]);

  var catSelectEl = document.getElementById('fFgCategorySelect');
  var catNewEl = document.getElementById('fFgCategoryNew');
  var subCategoryListEl = document.getElementById('fgSubCategoryList');
  var syncNewCategoryVisibility_ = function () {
    catNewEl.style.display = catSelectEl.value === '__new__' ? '' : 'none';
    if (catSelectEl.value === '__new__') catNewEl.focus();
  };
  catSelectEl.onchange = function () {
    syncNewCategoryVisibility_();
    var subs = catSelectEl.value === '__new__' ? [] : subCategoriesFor_(catSelectEl.value);
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

async function importFindingGuideCsv(file) {
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
