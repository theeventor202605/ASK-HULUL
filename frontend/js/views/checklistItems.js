/**
 * HULUL - Checklist Items admin view (reference catalogue used by Inspections). Setup.gs seeds
 * the defaults; this page lets SystemAdmin/InspectionAdmin/ProjectManager add more, edit, or
 * soft-delete existing ones (deleteChecklistItem marks status:'Deleted' -- the row stays so any
 * inspection/finding that already referenced it keeps resolving, it's just hidden from the
 * catalogue and from inspectionScopeItems_ going forward; same pattern as Venues/Zones deletion).
 * Two stacked lists on the left narrow the set down: Phase (Opening/Operational), then
 * Category (Term('discipline')) within that phase. Sub-Category (Term('checklistType')) is a tab
 * bar on the right, since a given Phase+Category combo can still span several sub-categories
 * (Restaurants, Food Truck, …).
 * Category here is stored on the backend as the item's `category` field, and Sub-Category as
 * `checklistType` (both unchanged, to avoid a data migration -- see labels.js for the display-label
 * rename itself) but the New/Edit Item form picks Category from the real Disciplines list via
 * dropdown instead of free text -- free text let a typo'd/differently-cased category silently
 * diverge from the actual discipline name, which inspectionScopeItems_ (Inspections.gs) matches on
 * exactly, so a mismatch meant those items would never show up for any inspection at all.
 */
// Zero-pads Sub Ref./Item Ref. to at least `digits` characters for display (e.g. padRef_(3, 2) ->
// '03', padRef_(5, 3) -> '005') -- REQ, see file header. A value with more digits than the minimum
// (e.g. 123 at digits=2) is shown in full rather than truncated.
function padRef_(value, digits) {
  if (value === '' || value === null || value === undefined) return '—';
  var n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 0) return '—';
  return String(n).padStart(digits, '0');
}

async function renderChecklistItems() {
  var root = document.getElementById('viewRoot');
  // RBAC pilot (backend/Permissions.gs): admin-configurable from Settings > Permissions > Inspections.
  var canManage = hasPermission('checklistItem.manage');
  var canDedupe = hasPermission('checklistItem.dedupe');
  var [items, disciplines] = await Promise.all([Api.call('listChecklistItems', {}), Api.call('listDisciplines', {})]);
  var phases = Array.from(new Set(items.map(function (i) { return i.phase; }))).sort();
  var view = { phase: phases[0] || '', category: '', checklistType: '' };

  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + esc(Term('checklistItem_plural')) + '</div>' +
    '<div class="page-subtitle">' + esc(t('checklist_catalogue_subtitle', { term: Term('checklistItem'), inspectionTerm: Term('inspection').toLowerCase() })) + '</div></div>' +
    '<div style="display:flex;gap:8px;">' +
      (canManage ? '<button class="btn btn-primary" id="newItemBtn">' + esc(t('new_item_btn')) + '</button>' : '') +
      (canDedupe ? '<button class="btn btn-danger" id="dedupeBtn">' + esc(t('remove_duplicates_btn')) + '</button>' : '') +
    '</div></div>' +
    '<div id="ciBody"></div>';

  // Import/Export CSV live inside the list section below (ciBody), not the page header, and as
  // icon buttons -- REQ: these controls stay with the list they act on, everywhere in the app.
  // wireCsvButtons_ is called after ciBody's innerHTML is actually set (both the empty-state and
  // populated branches below build their own copy of these two buttons).
  function wireCsvButtons_() {
    document.getElementById('ciExportCsvBtn').onclick = function () { exportChecklistItemsCsv(items); };
    if (canManage) {
      var ciImportInput = document.getElementById('ciImportCsvInput');
      document.getElementById('ciImportCsvBtn').onclick = function () { ciImportInput.click(); };
      ciImportInput.onchange = function (e) {
        var file = e.target.files[0];
        if (file) importChecklistItemsCsv(file, disciplines);
        e.target.value = '';
      };
    }
  }
  function csvButtonsHtml_() {
    return '<button type="button" class="btn btn-secondary btn-sm btn-icon" id="ciExportCsvBtn" title="' + esc(t('export_csv')) + '">' + ICON('export_csv') + '</button>' +
      (canManage ?
        '<button type="button" class="btn btn-secondary btn-sm btn-icon" id="ciImportCsvBtn" title="' + esc(t('import_csv')) + '">' + ICON('import_csv') + '</button>' +
        '<input type="file" id="ciImportCsvInput" accept=".csv" style="display:none;" />'
        : '');
  }

  if (canDedupe) document.getElementById('dedupeBtn').onclick = function () {
    // Duplicate = same Description + Phase + Checklist Type + Discipline, regardless of Default
    // risk/Window — matches createChecklistItem's dedup check, which blocks new duplicates from
    // being created in the first place. This just cleans up existing ones.
    UI.confirmModal(
      t('checklist_dedupe_confirm', { typeTerm: Term('checklistType'), categoryTerm: Term('discipline') }),
      async function () {
        try {
          var res = await Api.call('dedupeChecklistItems', {});
          UI.toast(res.removed ? t('toast_duplicates_removed', { count: res.removed }) : t('toast_no_duplicates'), 'success');
          Router.resolve();
        } catch (err) { UI.error(err); }
      },
      { title: t('remove_duplicates_btn'), confirmLabel: t('remove_duplicates_btn') }
    );
  };

  if (canManage) document.getElementById('newItemBtn').onclick = function () {
    openChecklistItemForm_(items, disciplines, {
      title: t('new_x_title', { term: Term('checklistItem') }),
      submitLabel: t('create'),
      initial: {},
      onSubmit: async function (payload) {
        await Api.call('createChecklistItem', payload);
        UI.closeModal(); UI.toast(t('x_created', { term: Term('checklistItem') }), 'success'); Router.resolve();
      }
    });
  };

  if (!phases.length) {
    document.getElementById('ciBody').innerHTML =
      '<div class="card">' +
        '<div class="card-header" style="display:flex;justify-content:flex-end;gap:6px;">' + csvButtonsHtml_() + '</div>' +
        '<div class="card-body"><div class="empty-state">' + t('no_data') + '</div></div>' +
      '</div>';
    wireCsvButtons_();
    return;
  }

  document.getElementById('ciBody').innerHTML =
    '<div class="list-page-layout">' +
      '<div class="card list-page-sidebar" style="width:230px;">' +
        '<div class="card-header"><div class="card-title">' + esc(t('col_phase')) + '</div></div>' +
        '<div id="ciPhasePanel" style="padding:8px;max-height:260px;overflow-y:auto;"></div>' +
        '<div class="card-header" style="border-top:1px solid var(--border);"><div class="card-title">' + esc(Term('discipline')) + '</div></div>' +
        '<div id="ciCategoryPanel" style="padding:8px;max-height:260px;overflow-y:auto;"></div>' +
      '</div>' +
      '<div style="flex:1;min-width:0;">' +
        // Import/Export CSV live inside this list-section column (not the page header, and not
        // text buttons) -- REQ: these controls stay with the list they act on, everywhere in the app.
        '<div style="display:flex;justify-content:flex-end;gap:6px;margin-bottom:8px;">' + csvButtonsHtml_() + '</div>' +
        '<div class="tabbar" id="typeTabbar"></div>' +
        '<div id="ciTableWrap"></div>' +
      '</div>' +
    '</div>';
  wireCsvButtons_();

  var rowStyle = 'padding:8px 10px;border-radius:8px;cursor:pointer;font-size:13px;margin-top:2px;';

  function renderPhasePanel() {
    var panel = document.getElementById('ciPhasePanel');
    panel.innerHTML = phases.map(function (p) {
      var active = p === view.phase;
      return '<div class="ci-phase-row" data-phase="' + esc(p) + '" style="' + rowStyle + (active ? 'background:var(--accent);color:#fff;font-weight:600;' : '') + '">' + esc(p) + '</div>';
    }).join('');
    panel.querySelectorAll('.ci-phase-row').forEach(function (row) {
      row.onclick = function () {
        view.phase = row.getAttribute('data-phase');
        view.category = ''; view.checklistType = '';
        renderPhasePanel(); renderCategoryPanel();
      };
    });
  }

  function renderCategoryPanel() {
    var categoriesInPhase = Array.from(new Set(
      items.filter(function (i) { return i.phase === view.phase; }).map(function (i) { return i.category; })
    )).sort();
    if (!view.category || categoriesInPhase.indexOf(view.category) === -1) view.category = categoriesInPhase[0] || '';
    var panel = document.getElementById('ciCategoryPanel');
    panel.innerHTML = categoriesInPhase.length
      ? categoriesInPhase.map(function (c) {
          var active = c === view.category;
          return '<div class="ci-cat-row" data-cat="' + esc(c) + '" style="' + rowStyle + (active ? 'background:var(--accent);color:#fff;font-weight:600;' : '') + '">' + esc(c) + '</div>';
        }).join('')
      : '<div class="muted" style="font-size:12px;padding:6px 10px;">' + esc(t('no_x_under_phase', { term: Term('discipline_plural').toLowerCase() })) + '</div>';
    panel.querySelectorAll('.ci-cat-row').forEach(function (row) {
      row.onclick = function () { view.category = row.getAttribute('data-cat'); view.checklistType = ''; renderCategoryPanel(); renderTypeTabs(); };
    });
    renderTypeTabs();
  }

  function renderTypeTabs() {
    var typesInCat = Array.from(new Set(
      items.filter(function (i) { return i.phase === view.phase && i.category === view.category; }).map(function (i) { return i.checklistType; })
    )).sort();
    if (!view.checklistType || typesInCat.indexOf(view.checklistType) === -1) view.checklistType = typesInCat[0] || '';
    var typeTabbar = document.getElementById('typeTabbar');
    typeTabbar.innerHTML = typesInCat.map(function (ty) {
      return '<div class="tab-btn ' + (ty === view.checklistType ? 'active' : '') + '" data-type="' + esc(ty) + '">' + esc(ty) + '</div>';
    }).join('');
    typeTabbar.querySelectorAll('.tab-btn').forEach(function (btn) {
      btn.onclick = function () { view.checklistType = btn.getAttribute('data-type'); renderTypeTabs(); };
    });
    renderTable();
  }

  function renderTable() {
    var filtered = items.filter(function (i) { return i.phase === view.phase && i.category === view.category && i.checklistType === view.checklistType; });
    var wrap = document.getElementById('ciTableWrap');
    wrap.innerHTML = '<div class="card"><div class="card-body">' + UI.table([
      { key: 'description', label: t('field_description') }, { key: 'defaultRisk', label: t('col_default_risk'), render: r => UI.riskBadge(r.defaultRisk) },
      { key: 'defaultWindowHours', label: t('col_window_hours') },
      // REQ: "Sub-Category must also have 'Sub Ref.' ... always displayed as two digits" / "each item
      // ... must have 'Item Ref.' ... always displayed as three digits." Stored as plain numbers
      // (createChecklistItem, Inspections.gs); zero-padding is purely a display formatter here.
      { key: 'subRef', label: t('col_sub_ref'), render: r => esc(padRef_(r.subRef, 2)) },
      { key: 'itemRef', label: t('col_item_ref'), render: r => esc(padRef_(r.itemRef, 3)) }
    ].concat(canManage ? [{ key: 'actions', label: t('actions'), render: r =>
        UI.actionsCell(
          '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('action_edit')) + '" data-edit-ci="' + r.id + '">' + ICON('edit') + '</button> ' +
          '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('action_delete')) + '" data-delete-ci="' + r.id + '">' + ICON('delete') + '</button>'
        ) }] : []),
      // hideExportButton: this table's own auto Export CSV button would duplicate the one already
      // in the list-section header above (csvButtonsHtml_).
      filtered, { hideExportButton: true }) + '</div></div>';

    if (!canManage) return;
    wrap.querySelectorAll('[data-edit-ci]').forEach(function (btn) {
      btn.onclick = function () {
        var item = items.filter(function (i) { return i.id === btn.getAttribute('data-edit-ci'); })[0];
        if (!item) return;
        openChecklistItemForm_(items, disciplines, {
          title: t('edit_x', { term: Term('checklistItem') }),
          submitLabel: t('save'),
          initial: item,
          onSubmit: async function (payload) {
            await Api.call('updateChecklistItem', Object.assign({ itemId: item.id }, payload));
            UI.closeModal(); UI.toast(t('x_updated', { term: Term('checklistItem') }), 'success'); Router.resolve();
          }
        });
      };
    });
    wrap.querySelectorAll('[data-delete-ci]').forEach(function (btn) {
      btn.onclick = function () {
        var itemId = btn.getAttribute('data-delete-ci');
        UI.confirmModal(
          t('delete_checklist_item_confirm', { term: Term('checklistItem'), inspectionPluralTerm: Term('inspection_plural').toLowerCase(), inspectionTerm: Term('inspection').toLowerCase() }),
          async function () {
            try {
              await Api.call('deleteChecklistItem', { itemId: itemId });
              UI.toast(t('x_deleted', { term: Term('checklistItem') }), 'success'); Router.resolve();
            } catch (err) { UI.error(err); }
          },
          { confirmLabel: t('delete') }
        );
      };
    });
  }

  renderPhasePanel();
  renderCategoryPanel();
}

// Shared by "+ New item" and each row's Edit button -- builds the Phase / Discipline / Checklist
// type / Description / Default risk / Default window form and wires it up. Discipline comes from
// the real Disciplines list (see file-header comment for why); Checklist type is a dropdown scoped
// to whichever types already exist under the selected Discipline, re-filtered live whenever
// Discipline changes, plus an "Add new type" option that reveals a text input. `opts.initial` is
// either {} (new item) or an existing item's own fields (edit) to prefill every field with.
function openChecklistItemForm_(items, disciplines, opts) {
  var initial = opts.initial || {};
  var typesByDiscipline = {};
  items.forEach(function (i) {
    if (!i.category || !i.checklistType) return;
    (typesByDiscipline[i.category] = typesByDiscipline[i.category] || {})[i.checklistType] = true;
  });
  var typesForDiscipline_ = function (disciplineName) {
    return typesByDiscipline[disciplineName] ? Object.keys(typesByDiscipline[disciplineName]).sort() : [];
  };
  var typeSelectHtml_ = function (types, selectedType) {
    var matched = selectedType && types.indexOf(selectedType) !== -1;
    return types.map(function (ty) { return '<option value="' + esc(ty) + '"' + (ty === selectedType ? ' selected' : '') + '>' + esc(ty) + '</option>'; }).join('') +
      '<option value="__new__"' + (!types.length && !matched ? ' selected' : '') + '>' + esc(t('add_new_type_option')) + '</option>';
  };
  var disciplineOptions = disciplines.map(function (d) {
    return '<option value="' + esc(d.name) + '"' + (d.name === initial.category ? ' selected' : '') + '>' + esc(d.name) + '</option>';
  }).join('');
  var initialDiscipline = initial.category || (disciplines.length ? disciplines[0].name : '');
  var initialTypes = typesForDiscipline_(initialDiscipline);

  var body =
    UI.field(t('col_phase'), '<select id="fCiPhase" class="field-input"><option' + (initial.phase === 'Operational' ? '' : ' selected') + '>Opening</option><option' + (initial.phase === 'Operational' ? ' selected' : '') + '>Operational</option></select>') +
    UI.field(Term('discipline'), disciplines.length
      ? '<select id="fCiCategory" class="field-input">' + disciplineOptions + '</select>'
      : '<select id="fCiCategory" class="field-input" disabled><option value="">' + esc(t('create_x_first_page_hint', { term: Term('discipline').toLowerCase(), termPlural: Term('discipline_plural') })) + '</option></select>') +
    UI.field(Term('checklistType'),
      '<select id="fCiTypeSelect" class="field-input">' + typeSelectHtml_(initialTypes, initial.checklistType) + '</select>' +
      '<input id="fCiTypeNew" class="field-input" placeholder="e.g. Restaurants" style="margin-top:6px;' + (initialTypes.length ? 'display:none;' : '') + '" />'
    ) +
    // REQ: "Sub-Category must also have 'Sub Ref.' ... each item ... must have 'Item Ref.'" -- plain
    // whole-number inputs; padRef_ formats them for display everywhere else (table, CSV export text
    // stays the raw number for clean re-import).
    '<div class="form-row">' +
    UI.field(t('col_sub_ref'), '<input id="fCiSubRef" type="number" min="0" step="1" class="field-input" value="' + (initial.subRef != null && initial.subRef !== '' ? initial.subRef : '') + '" />') +
    UI.field(t('col_item_ref'), '<input id="fCiItemRef" type="number" min="0" step="1" class="field-input" value="' + (initial.itemRef != null && initial.itemRef !== '' ? initial.itemRef : '') + '" />') +
    '</div>' +
    UI.field(t('field_description'), '<textarea id="fCiDesc" class="field-input" rows="2">' + esc(initial.description || '') + '</textarea>') +
    '<div class="form-row">' +
    UI.field(t('col_default_risk'), '<select id="fCiRisk" class="field-input">' +
      ['Info', 'Low', 'Medium', 'High', 'Critical'].map(function (r) {
        return '<option' + (r === (initial.defaultRisk || 'Medium') ? ' selected' : '') + '>' + r + '</option>';
      }).join('') + '</select>') +
    UI.field(t('field_default_window_hours'), '<input id="fCiWindow" type="number" class="field-input" value="' + (initial.defaultWindowHours != null && initial.defaultWindowHours !== '' ? initial.defaultWindowHours : 24) + '" />') + '</div>';

  UI.openModal(opts.title, body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: opts.submitLabel, className: 'btn-primary', onClick: async function () {
        if (!disciplines.length) { UI.toast(t('toast_create_x_first', { term: Term('discipline').toLowerCase() }), 'error'); return; }
        var typeSelect = document.getElementById('fCiTypeSelect');
        var checklistType = typeSelect.value === '__new__' ? document.getElementById('fCiTypeNew').value.trim() : typeSelect.value;
        if (!checklistType) { UI.toast(t('toast_checklist_type_required', { term: Term('checklistType') }), 'error'); return; }
        var subRefRaw = document.getElementById('fCiSubRef').value;
        var itemRefRaw = document.getElementById('fCiItemRef').value;
        var subRef = Number(subRefRaw), itemRef = Number(itemRefRaw);
        if (subRefRaw === '' || !Number.isInteger(subRef) || subRef < 0) { UI.toast(t('toast_sub_ref_required'), 'error'); return; }
        if (itemRefRaw === '' || !Number.isInteger(itemRef) || itemRef < 0) { UI.toast(t('toast_item_ref_required'), 'error'); return; }
        var payload = {
          checklistType: checklistType, category: document.getElementById('fCiCategory').value,
          description: document.getElementById('fCiDesc').value, defaultRisk: document.getElementById('fCiRisk').value,
          defaultWindowHours: Number(document.getElementById('fCiWindow').value), phase: document.getElementById('fCiPhase').value,
          subRef: subRef, itemRef: itemRef
        };
        try { await opts.onSubmit(payload); } catch (err) { UI.error(err); }
      } }
  ]);

  var disciplineSelectEl = document.getElementById('fCiCategory');
  var typeSelectEl = document.getElementById('fCiTypeSelect');
  var typeNewEl = document.getElementById('fCiTypeNew');
  var syncNewTypeVisibility_ = function () {
    typeNewEl.style.display = typeSelectEl.value === '__new__' ? '' : 'none';
    if (typeSelectEl.value === '__new__') typeNewEl.focus();
  };
  typeSelectEl.onchange = syncNewTypeVisibility_;
  if (disciplineSelectEl && !disciplineSelectEl.disabled) {
    disciplineSelectEl.onchange = function () {
      var types = typesForDiscipline_(disciplineSelectEl.value);
      typeSelectEl.innerHTML = typeSelectHtml_(types, null);
      typeNewEl.value = '';
      syncNewTypeVisibility_();
    };
  }
}

/* ---------------- CSV export / import ----------------
 * Reuses csvEscape_, parseCsv_, and showImportResults_ from events.js (loaded on the same page). */
function exportChecklistItemsCsv(rows) {
  // Sub Ref/Item Ref exported as their raw numbers (not zero-padded) so re-import via
  // importChecklistItemsCsv below round-trips cleanly -- the zero-padded form is a display-only
  // formatter (padRef_), same reasoning as Default Risk/Window Hours already being plain values here.
  // (Cat Ref. isn't a ChecklistItems field -- it lives on the Disciplines/Categories catalog itself,
  // see disciplines.js -- so it has no place in this CSV.)
  // REQ: "arrange columns: Category, Sub Ref., Sub-Category, Item Ref., Description, Default Risk,
  // Window Hours, Phase."
  var headers = [Term('discipline'), 'Sub Ref.', Term('checklistType'), 'Item Ref.', 'Description', 'Default Risk', 'Window Hours', 'Phase'];
  var lines = [headers.map(csvEscape_).join(',')];
  rows.forEach(function (r) {
    lines.push([r.category, r.subRef, r.checklistType, r.itemRef, r.description, r.defaultRisk, r.defaultWindowHours, r.phase].map(csvEscape_).join(','));
  });
  // Leading UTF-8 BOM so Excel renders non-Latin text (Arabic descriptions, etc.) correctly instead of mojibake.
  var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = 'hulul-checklist-items-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Bulk-import batch size: sent to the bulkCreateChecklistItems route (see Inspections.gs) in
// chunks of this size rather than all-at-once, purely to keep each Apps Script call's payload/
// execution time comfortable for very large CSVs. A typical few-hundred-row import is 1-2 calls
// total, instead of the old one-network-round-trip-per-row loop (~1s/row -- 300 rows took ~5 min).
var CHECKLIST_IMPORT_BATCH_SIZE_ = 200;

async function importChecklistItemsCsv(file, disciplines) {
  var text = await file.text();
  var rows = parseCsv_(text);
  if (!rows.length) { UI.toast(t('empty_csv'), 'error'); return; }
  var headers = rows[0].map(function (h) { return h.trim().toLowerCase(); });
  var col = function (name) { return headers.indexOf(name); };
  // REQ: "Throughout the platform change: Checklist Type to Sub-Category." Accepts the new header
  // name going forward ('sub-category'/'subcategory', matching exportChecklistItemsCsv's own new
  // Term('checklistType') header) while still recognizing the older 'checklist type'/'checklisttype'
  // header so CSVs exported before this rename still re-import cleanly.
  var idxType = col('sub-category') !== -1 ? col('sub-category')
    : col('subcategory') !== -1 ? col('subcategory')
    : col('checklist type') !== -1 ? col('checklist type') : col('checklisttype');
  // Accepts either header name -- 'category' going forward (matching the new Term('discipline')
  // default), 'discipline' from the in-between rename, or 'category' from even older exports/sheets
  // made before any of this was renamed.
  var idxCategory = col('category') !== -1 ? col('category') : col('discipline');
  var idxDesc = col('description');
  var idxRisk = col('default risk') !== -1 ? col('default risk') : col('defaultrisk');
  var idxWindow = col('window hours') !== -1 ? col('window hours') : col('defaultwindowhours');
  var idxPhase = col('phase');
  // REQ: "Sub-Category must also have 'Sub Ref.' ... each item ... must have 'Item Ref.'" -- required
  // going forward, same gate as Sub-Category/Category/Description below (older CSVs exported before
  // this REQ won't have these columns and will correctly be rejected up front with a clear message,
  // rather than every row silently failing server-side one at a time).
  var idxSubRef = col('sub ref.') !== -1 ? col('sub ref.') : col('subref');
  var idxItemRef = col('item ref.') !== -1 ? col('item ref.') : col('itemref');
  if (idxType === -1 || idxCategory === -1 || idxDesc === -1 || idxSubRef === -1 || idxItemRef === -1) {
    UI.toast(t('checklist_csv_columns_required', { typeTerm: Term('checklistType'), categoryTerm: Term('discipline') }), 'error');
    return;
  }
  // Same reasoning as the New Item form's dropdown: a Discipline value that doesn't exactly match
  // an existing discipline name would silently never show up for any inspection (Inspections.gs
  // inspectionScopeItems_ matches on it exactly) -- reject those rows up front instead.
  var validNames = {};
  disciplines.forEach(function (d) { validNames[d.name] = true; });

  // Pass 1 (local, instant): parse + validate every row and split into ones we'll send to the
  // backend vs. ones that already fail client-side checks (required fields / unknown discipline).
  var results = { created: [], failed: [] };
  var toSend = [];
  for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    if (!row.length || row.every(function (c) { return c.trim() === ''; })) continue;
    var checklistType = (row[idxType] || '').trim();
    var category = (row[idxCategory] || '').trim();
    var description = (row[idxDesc] || '').trim();
    var label = description || checklistType || '(unnamed)';
    if (!checklistType || !category || !description) {
      results.failed.push({ row: r + 1, name: label, reason: Term('checklistType') + ', ' + Term('discipline') + ', and Description are required' });
      continue;
    }
    if (!validNames[category]) {
      results.failed.push({ row: r + 1, name: label, reason: Term('discipline') + ' "' + category + '" doesn\'t match an existing ' + Term('discipline').toLowerCase() + ' name exactly (see the ' + Term('discipline_plural') + ' page)' });
      continue;
    }
    var subRefRaw = (row[idxSubRef] || '').trim(), itemRefRaw = (row[idxItemRef] || '').trim();
    var subRef = Number(subRefRaw), itemRef = Number(itemRefRaw);
    if (subRefRaw === '' || !Number.isInteger(subRef) || subRef < 0 || itemRefRaw === '' || !Number.isInteger(itemRef) || itemRef < 0) {
      results.failed.push({ row: r + 1, name: label, reason: 'Sub Ref. and Item Ref. are required and must be whole numbers' });
      continue;
    }
    toSend.push({
      row: r + 1, checklistType: checklistType, category: category, description: description,
      defaultRisk: idxRisk !== -1 ? (row[idxRisk] || '').trim() : '',
      defaultWindowHours: idxWindow !== -1 && row[idxWindow] && row[idxWindow].trim() ? Number(row[idxWindow]) : undefined,
      phase: idxPhase !== -1 ? (row[idxPhase] || '').trim() : '',
      subRef: subRef, itemRef: itemRef
    });
  }

  // Pass 2 (network): send whatever passed local validation to the backend in a handful of batch
  // calls -- each call dedupes + writes its whole chunk in one shot server-side (see
  // bulkCreateChecklistItems in Inspections.gs), instead of one createChecklistItem call per row.
  if (toSend.length) {
    var progress = UI.progressModal(t('importing_checklist_items'), toSend.length);
    var sent = 0;
    for (var i = 0; i < toSend.length; i += CHECKLIST_IMPORT_BATCH_SIZE_) {
      var chunk = toSend.slice(i, i + CHECKLIST_IMPORT_BATCH_SIZE_);
      try {
        var res = await Api.call('bulkCreateChecklistItems', { items: chunk });
        results.created = results.created.concat(res.created);
        results.failed = results.failed.concat(res.failed);
      } catch (err) {
        // Whole-batch failure (e.g. network drop mid-import) -- attribute it to every row in this
        // chunk so nothing silently vanishes from the results.
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
