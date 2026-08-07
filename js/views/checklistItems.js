/**
 * HULUL - Checklist Items admin view (reference catalogue used by Inspections). Setup.gs seeds
 * the defaults; this page lets SystemAdmin/InspectionAdmin/ProjectManager add more.
 * Grouped as Category tabs (Fire Safety, Crowd Safety, …) with Checklist sub-tabs
 * (Restaurants, Food Truck, …) underneath, since the full list grows quickly.
 */
async function renderChecklistItems() {
  var root = document.getElementById('viewRoot');
  var items = await Api.call('listChecklistItems', {});
  var categories = Array.from(new Set(items.map(function (i) { return i.category; }))).sort();
  var view = { category: categories[0] || '', checklistType: '' };

  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + t('nav_checklist') + '</div>' +
    '<div class="page-subtitle">Checklist item catalogue used when recording inspection results</div></div>' +
    '<button class="btn btn-primary" id="newItemBtn">+ New item</button></div>' +
    '<div class="tabbar" id="catTabbar"></div>' +
    '<div class="tabbar" id="typeTabbar" style="margin-top:-10px;"></div>' +
    '<div id="ciTableWrap"></div>';

  document.getElementById('newItemBtn').onclick = function () {
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
