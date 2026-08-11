/**
 * HULUL - Disciplines admin view (reference catalogue: Crowd Safety, Fire Safety, etc.).
 * Setup.gs seeds the defaults; this page lets SystemAdmin/InspectionAdmin add more.
 */
async function renderDisciplinesAdmin() {
  var root = document.getElementById('viewRoot');
  var disciplines = await Api.call('listDisciplines', {});
  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + esc(Term('discipline_plural')) + '</div>' +
    '<div class="page-subtitle">Compliance ' + esc(Term('discipline').toLowerCase()) + ' catalogue</div></div>' +
    '<button class="btn btn-primary" id="newDiscBtn">+ New ' + esc(Term('discipline').toLowerCase()) + '</button></div>' +
    '<div class="card"><div class="card-body">' + UI.table([
      { key: 'name', label: 'Name' }, { key: 'code', label: 'Code' }, { key: 'id', label: 'ID' }
    ], disciplines, {}) + '</div></div>';

  document.getElementById('newDiscBtn').onclick = function () {
    var body = UI.field('Name', '<input id="fDiscName" class="field-input" placeholder="Crowd Safety" />') +
      UI.field('Code', '<input id="fDiscCode" class="field-input" placeholder="CSM" />');
    UI.openModal('New ' + Term('discipline'), body, [
      { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
      { label: t('create'), className: 'btn-primary', onClick: async function () {
          try {
            await Api.call('createDiscipline', { name: document.getElementById('fDiscName').value, code: document.getElementById('fDiscCode').value });
            UI.closeModal(); UI.toast(Term('discipline') + ' created', 'success'); Router.resolve();
          } catch (err) { UI.error(err); }
        } }
    ]);
  };
}
