/**
 * HULUL - Checklist Items admin view (reference catalogue used by Inspections). Setup.gs seeds
 * the defaults; this page lets SystemAdmin/InspectionAdmin/ProjectManager add more.
 * Two stacked lists on the left narrow the set down: Phase (Readiness/Operational), then
 * Category within that phase. Checklist Type is a tab bar on the right, since a given
 * Phase+Category combo can still span several checklist types (Restaurants, Food Truck, …).
 */
// Matches createChecklistItem's backend requireRole — only these roles get New/Import controls.
var CHECKLIST_MANAGE_ROLES = ['SystemAdmin', 'InspectionAdmin', 'ProjectManager'];
// dedupeChecklistItems is a narrower, more destructive action — matches its own backend requireRole.
var CHECKLIST_DEDUPE_ROLES = ['SystemAdmin', 'InspectionAdmin'];

async function renderChecklistItems() {
  var root = document.getElementById('viewRoot');
  var canManage = CHECKLIST_MANAGE_ROLES.indexOf(HululState.user.role) !== -1;
  var canDedupe = CHECKLIST_DEDUPE_ROLES.indexOf(HululState.user.role) !== -1;
  var items = await Api.call('listChecklistItems', {});
  var phases = Array.from(new Set(items.map(function (i) { return i.phase; }))).sort();
  var view = { phase: phases[0] || '', category: '', checklistType: '' };

  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + t('nav_checklist') + '</div>' +
    '<div class="page-subtitle">Checklist item catalogue used when recording inspection results</div></div>' +
    '<div style="display:flex;gap:8px;">' +
      '<button class="btn btn-secondary" id="ciExportCsvBtn">Export CSV</button>' +
      (canManage ?
        '<button class="btn btn-secondary" id="ciImportCsvBtn">Import CSV</button>' +
        '<input type="file" id="ciImportCsvInput" accept=".csv" style="display:none;" />' +
        '<button class="btn btn-primary" id="newItemBtn">+ New item</button>'
        : '') +
      (canDedupe ? '<button class="btn btn-danger" id="dedupeBtn">Remove duplicates</button>' : '') +
    '</div></div>' +
    '<div id="ciBody"></div>';

  document.getElementById('ciExportCsvBtn').onclick = function () { exportChecklistItemsCsv(items); };
  if (canManage) {
    var ciImportInput = document.getElementById('ciImportCsvInput');
    document.getElementById('ciImportCsvBtn').onclick = function () { ciImportInput.click(); };
    ciImportInput.onchange = function (e) {
      var file = e.target.files[0];
      if (file) importChecklistItemsCsv(file);
      e.target.value = '';
    };
  }
  if (canDedupe) document.getElementById('dedupeBtn').onclick = function () {
    // Duplicate = same Description + Default risk + Window + Phase, regardless of Checklist
    // Type/Category — matches createChecklistItem's new dedup check, which now blocks new
    // duplicates from being created in the first place. This just cleans up existing ones.
    UI.confirmModal(
      'Scan the whole catalogue for items with the same Description, Default risk, Window, and Phase, and delete every duplicate beyond the first? This cannot be undone.',
      async function () {
        try {
          var res = await Api.call('dedupeChecklistItems', {});
          UI.toast(res.removed ? (res.removed + ' duplicate(s) removed') : 'No duplicates found', 'success');
          Router.resolve();
        } catch (err) { UI.error(err); }
      },
      { title: 'Remove duplicates', confirmLabel: 'Remove duplicates' }
    );
  };

  if (canManage) document.getElementById('newItemBtn').onclick = function () {
    var body =
      UI.field('Checklist type', '<input id="fCiType" class="field-input" placeholder="Restaurants" />') +
      UI.field('Category', '<input id="fCiCategory" class="field-input" placeholder="Food & Beverage" />') +
      UI.field('Description', '<textarea id="fCiDesc" class="field-input" rows="2"></textarea>') +
      '<div class="form-row">' +
      UI.field('Default risk', '<select id="fCiRisk" class="field-input"><option>Low</option><option selected>Medium</option><option>High</option><option>Critical</option></select>') +
      UI.field('Default window (hours)', '<input id="fCiWindow" type="number" class="field-input" value="24" />') + '</div>' +
      UI.field('Phase', '<select id="fCiPhase" class="field-input"><option>Readiness</option><option>Operational</option></select>');
    UI.openModal('New checklist item', body, [
      { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
      { label: t('create'), className: 'btn-primary', onClick: async function () {
          try {
            await Api.call('createChecklistItem', {
              checklistType: document.getElementById('fCiType').value, category: document.getElementById('fCiCategory').value,
              description: document.getElementById('fCiDesc').value, defaultRisk: document.getElementById('fCiRisk').value,
              defaultWindowHours: Number(document.getElementById('fCiWindow').value), phase: document.getElementById('fCiPhase').value
            });
            UI.closeModal(); UI.toast('Checklist item created', 'success'); Router.resolve();
          } catch (err) { UI.error(err); }
        } }
    ]);
  };

  if (!phases.length) {
    document.getElementById('ciBody').innerHTML = '<div class="card"><div class="card-body"><div class="empty-state">' + t('no_data') + '</div></div></div>';
    return;
  }

  document.getElementById('ciBody').innerHTML =
    '<div style="display:flex;gap:16px;align-items:flex-start;">' +
      '<div class="card" style="width:230px;flex-shrink:0;">' +
        '<div class="card-header"><div class="card-title">Phase</div></div>' +
        '<div id="ciPhasePanel" style="padding:8px;max-height:260px;overflow-y:auto;"></div>' +
        '<div class="card-header" style="border-top:1px solid var(--border);"><div class="card-title">Category</div></div>' +
        '<div id="ciCategoryPanel" style="padding:8px;max-height:260px;overflow-y:auto;"></div>' +
      '</div>' +
      '<div style="flex:1;min-width:0;">' +
        '<div class="tabbar" id="typeTabbar"></div>' +
        '<div id="ciTableWrap"></div>' +
      '</div>' +
    '</div>';

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
      : '<div class="muted" style="font-size:12px;padding:6px 10px;">No categories under this phase.</div>';
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
    document.getElementById('ciTableWrap').innerHTML = '<div class="card"><div class="card-body">' + UI.table([
      { key: 'description', label: 'Description' }, { key: 'defaultRisk', label: 'Default risk', render: r => UI.riskBadge(r.defaultRisk) },
      { key: 'defaultWindowHours', label: 'Window (h)' }
    ], filtered, {}) + '</div></div>';
  }

  renderPhasePanel();
  renderCategoryPanel();
}

/* ---------------- CSV export / import ----------------
 * Reuses csvEscape_, parseCsv_, and showImportResults_ from events.js (loaded on the same page). */
function exportChecklistItemsCsv(rows) {
  var headers = ['Checklist Type', 'Category', 'Description', 'Default Risk', 'Window Hours', 'Phase'];
  var lines = [headers.map(csvEscape_).join(',')];
  rows.forEach(function (r) {
    lines.push([r.checklistType, r.category, r.description, r.defaultRisk, r.defaultWindowHours, r.phase].map(csvEscape_).join(','));
  });
  // Leading UTF-8 BOM so Excel renders non-Latin text (Arabic descriptions, etc.) correctly instead of mojibake.
  var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = 'hulul-checklist-items-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function importChecklistItemsCsv(file) {
  var text = await file.text();
  var rows = parseCsv_(text);
  if (!rows.length) { UI.toast('Empty CSV file', 'error'); return; }
  var headers = rows[0].map(function (h) { return h.trim().toLowerCase(); });
  var col = function (name) { return headers.indexOf(name); };
  var idxType = col('checklist type') !== -1 ? col('checklist type') : col('checklisttype');
  var idxCategory = col('category');
  var idxDesc = col('description');
  var idxRisk = col('default risk') !== -1 ? col('default risk') : col('defaultrisk');
  var idxWindow = col('window hours') !== -1 ? col('window hours') : col('defaultwindowhours');
  var idxPhase = col('phase');
  if (idxType === -1 || idxCategory === -1 || idxDesc === -1) {
    UI.toast('CSV needs at least: Checklist Type, Category, Description columns', 'error');
    return;
  }

  var totalRows = 0;
  for (var i = 1; i < rows.length; i++) {
    if (rows[i].length && !rows[i].every(function (c) { return c.trim() === ''; })) totalRows++;
  }
  var progress = UI.progressModal('Importing checklist items…', totalRows);
  var processed = 0;
  var results = { created: [], failed: [] };
  for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    if (!row.length || row.every(function (c) { return c.trim() === ''; })) continue;
    var checklistType = (row[idxType] || '').trim();
    var category = (row[idxCategory] || '').trim();
    var description = (row[idxDesc] || '').trim();
    var label = description || checklistType || '(unnamed)';
    processed++;
    progress.update(processed, processed + ' of ' + totalRows + (label ? ' — ' + label : ''));
    if (!checklistType || !category || !description) {
      results.failed.push({ row: r + 1, name: label, reason: 'Checklist Type, Category, and Description are required' });
      continue;
    }
    var payload = {
      checklistType: checklistType, category: category, description: description,
      defaultRisk: idxRisk !== -1 ? (row[idxRisk] || '').trim() : '',
      defaultWindowHours: idxWindow !== -1 && row[idxWindow] && row[idxWindow].trim() ? Number(row[idxWindow]) : undefined,
      phase: idxPhase !== -1 ? (row[idxPhase] || '').trim() : ''
    };
    try {
      await Api.call('createChecklistItem', payload);
      results.created.push(label);
    } catch (err) {
      results.failed.push({ row: r + 1, name: label, reason: err.message });
    }
  }
  UI.closeModal();
  showImportResults_(results);
  if (results.created.length) Router.resolve();
}
