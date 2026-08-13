/**
 * HULUL - Disciplines admin view (reference catalogue: Crowd Safety, Fire Safety, etc.).
 * Setup.gs seeds the defaults; this page lets SystemAdmin/InspectionAdmin add more.
 */
async function renderDisciplinesAdmin() {
  var root = document.getElementById('viewRoot');
  var disciplines = await Api.call('listDisciplines', {});
  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + esc(Term('discipline_plural')) + '</div>' +
    '<div class="page-subtitle">' + esc(t('compliance_catalogue_subtitle', { term: Term('discipline').toLowerCase() })) + '</div></div>' +
    '<button class="btn btn-primary" id="newDiscBtn">' + esc(t('new_x', { term: Term('discipline').toLowerCase() })) + '</button></div>' +
    '<div class="card"><div class="card-body">' + UI.table([
      { key: 'name', label: t('col_name') }, { key: 'code', label: t('col_code') }, { key: 'id', label: t('col_id') }
    ], disciplines, {}) + '</div></div>';

  document.getElementById('newDiscBtn').onclick = function () {
    var body = UI.field(t('col_name'), '<input id="fDiscName" class="field-input" placeholder="Crowd Safety" />') +
      UI.field(t('col_code'), '<input id="fDiscCode" class="field-input" placeholder="CSM" />');
    UI.openModal(t('new_x_title', { term: Term('discipline') }), body, [
      { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
      { label: t('create'), className: 'btn-primary', onClick: async function () {
          try {
            await Api.call('createDiscipline', { name: document.getElementById('fDiscName').value, code: document.getElementById('fDiscCode').value });
            UI.closeModal(); UI.toast(t('x_created', { term: Term('discipline') }), 'success'); Router.resolve();
          } catch (err) { UI.error(err); }
        } }
    ]);
  };
}
