/**
 * HULUL - Checklist Items admin view (reference catalogue used by Inspections). Setup.gs seeds
 * the defaults; this page lets SystemAdmin/InspectionAdmin/ProjectManager add more.
 * Grouped as Category tabs (Fire Safety, Crowd Safety, …) with Checklist sub-tabs
 * (Restaurants, Food Truck, …) underneath, since the full list grows quickly.
 */
// Matches createChecklistItem's backend requireRole — only these roles get New/Import controls.
var CHECKLIST_MANAGE_ROLES = ['SystemAdmin', 'InspectionAdmin', 'ProjectManager'];

async function renderChecklistItems() {
  var root = document.getElementById('viewRoot');
  var canManage = CHECKLIST_MANAGE_ROLES.indexOf(HululState.user.role) !== -1;
  var items = await Api.call('listChecklistItems', {});
  var categories = Array.from(new Set(items.map(function (i) { return i.category; }))).sort();
  var view = { category: categories[0] || '', checklistType: '' };

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
    '</div></div>' +
    '<div class="tabbar" id="catTabbar"></div>' +
    '<div class="tabbar" id="typeTabbar" style="margin-top:-10px;"></div>' +
    '<div id="ciTableWrap"></div>';

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

  if (canManage) document.getElementById('newItemBtn').onclick = function () {
    var body =
      UI.field('Checklist type', '<input id="fCiType" class="field-input" placeholder="Restaurants" />') +
      UI.field('Category', '<input id="fCiCategory" class="field-input" placeholder="Food & Beverage" />') +
      UI.field('Description', '<textarea id="fCiDesc" class="field-input" rows="2"></textarea>') +
      '<div class="form-row">' +
      UI.field('Default risk', '<select id="fCiRisk" class="field-input"><option>Low</option><option selected>Medium</option><option>High</option></select>') +
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

  if (!categories.length) {
    document.getElementById('ciTableWrap').innerHTML = '<div class="card"><div class="card-body"><div class="empty-state">' + t('no_data') + '</div></div></div>';
    return;
  }
  renderCategoryTabs();

  function renderCategoryTabs() {
    var catTabbar = document.getElementById('catTabbar');
    catTabbar.innerHTML = categories.map(function (c) {
      return '<div class="tab-btn ' + (c === view.category ? 'active' : '') + '" data-cat="' + esc(c) + '">' + esc(c) + '</div>';
    }).join('');
    catTabbar.querySelectorAll('.tab-btn').forEach(function (btn) {
      btn.onclick = function () { view.category = btn.getAttribute('data-cat'); view.checklistType = ''; renderCategoryTabs(); };
    });
    renderTypeTabs();
  }

  function renderTypeTabs() {
    var typesInCat = Array.from(new Set(
      items.filter(function (i) { return i.category === view.category; }).map(function (i) { return i.checklistType; })
    )).sort();
    if (!view.checklistType || typesInCat.indexOf(view.checklistType) === -1) view.checklistType = typesInCat[0] || '';
    var typeTabbar = document.getElementById('typeTabbar');
    typeTabbar.innerHTML = typesInCat.map(function (ty) {
      return '<div class="tab-btn ' + (ty === view.checklistType ? 'active' : '') + '" style="font-size:12px;padding:8px 12px;" data-type="' + esc(ty) + '">' + esc(ty) + '</div>';
    }).join('');
    typeTabbar.querySelectorAll('.tab-btn').forEach(function (btn) {
      btn.onclick = function () { view.checklistType = btn.getAttribute('data-type'); renderTypeTabs(); };
    });
    renderTable();
  }

  function renderTable() {
    var filtered = items.filter(function (i) { return i.category === view.category && i.checklistType === view.checklistType; });
    document.getElementById('ciTableWrap').innerHTML = '<div class="card"><div class="card-body">' + UI.table([
      { key: 'description', label: 'Description' }, { key: 'defaultRisk', label: 'Default risk', render: r => UI.riskBadge(r.defaultRisk) },
      { key: 'defaultWindowHours', label: 'Window (h)' }, { key: 'phase', label: 'Phase' }
    ], filtered, {}) + '</div></div>';
  }
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

  var results = { created: [], failed: [] };
  for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    if (!row.length || row.every(function (c) { return c.trim() === ''; })) continue;
    var checklistType = (row[idxType] || '').trim();
    var category = (row[idxCategory] || '').trim();
    var description = (row[idxDesc] || '').trim();
    var label = description || checklistType || '(unnamed)';
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
  showImportResults_(results);
  if (results.created.length) Router.resolve();
}
