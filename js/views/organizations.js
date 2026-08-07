/**
 * HULUL - Organizations admin view (SystemAdmin only: GA / EMC / Inspection Company records).
 */
async function renderOrganizations() {
  var root = document.getElementById('viewRoot');
  var orgs = await Api.call('listOrganizations', {});
  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + t('nav_orgs') + '</div>' +
    '<div class="page-subtitle">Government Authorities, EMCs, and Inspection Companies</div></div>' +
    '<button class="btn btn-primary" id="newOrgBtn">+ New organization</button></div>' +
    '<div class="card"><div class="card-body">' + UI.table([
      { key: 'name', label: 'Name' }, { key: 'type', label: 'Type' },
      { key: 'status', label: t('status'), render: r => UI.statusBadge('Resolved') },
      { key: 'createdAt', label: 'Created', render: r => UI.fmtDate(r.createdAt) }
    ], orgs, {}) + '</div></div>';

  document.getElementById('newOrgBtn').onclick = function () {
    var body = UI.field('Name', '<input id="fOrgName" class="field-input" />') +
      UI.field('Type', '<select id="fOrgType" class="field-input"><option value="GA">Government Authority</option><option value="EMC">EMC</option><option value="INSPECTION">Inspection Company</option></select>');
    UI.openModal('New organization', body, [
      { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
      { label: t('create'), className: 'btn-primary', onClick: async function () {
          try {
            await Api.call('createOrganization', { name: document.getElementById('fOrgName').value, type: document.getElementById('fOrgType').value });
            UI.closeModal(); UI.toast('Organization created', 'success'); Router.resolve();
          } catch (err) { UI.error(err); }
        } }
    ]);
  };
}
