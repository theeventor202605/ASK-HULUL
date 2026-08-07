/**
 * HULUL - Checklist Items admin view (reference catalogue used by Inspections). Setup.gs seeds
 * the defaults; this page lets SystemAdmin/InspectionAdmin/ProjectManager add more.
 */
async function renderChecklistItems() {
  var root = document.getElementById('viewRoot');
  var items = await Api.call('listChecklistItems', {});
  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + t('nav_checklist') + '</div>' +
    '<div class="page-subtitle">Checklist item catalogue used when recording inspection results</div></div>' +
    '<button class="btn btn-primary" id="newItemBtn">+ New item</button></div>' +
    '<div class="card"><div class="card-body">' + UI.table([
      { key: 'checklistType', label: 'Checklist' }, { key: 'category', label: 'Category' },
      { key: 'description', label: 'Description' }, { key: 'defaultRisk', label: 'Default risk', render: r => UI.riskBadge(r.defaultRisk) },
      { key: 'defaultWindowHours', label: 'Window (h)' }, { key: 'phase', label: 'Phase' }
    ], items, {}) + '</div></div>';

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
}
