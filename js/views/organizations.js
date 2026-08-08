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
      { key: 'logoUrl', label: 'Logo', render: r => r.logoUrl ? '<img src="' + esc(r.logoUrl) + '" alt="" style="height:28px;width:auto;max-width:100px;object-fit:contain;border-radius:6px;" />' : '<span class="muted">—</span>' },
      { key: 'name', label: 'Name' }, { key: 'type', label: 'Type' },
      { key: 'status', label: t('status'), render: r => UI.statusBadge('Resolved') },
      { key: 'createdAt', label: 'Created', render: r => UI.fmtDate(r.createdAt) },
      { key: 'actions', label: t('actions'), render: r => '<button class="btn btn-secondary btn-sm" data-upload-logo="' + r.id + '">Upload logo</button>' }
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

  root.querySelectorAll('[data-upload-logo]').forEach(function (b) {
    b.onclick = function () { openUploadLogoModal_(b.getAttribute('data-upload-logo'), orgs); };
  });
}

// Logos are stored in Drive (same pattern as Template uploads) and shown across the app's topbar
// for every user in that organization — so this affects everyone signed in under that GA/EMC/
// Inspection Company, not just how it looks on this admin page.
function openUploadLogoModal_(orgId, orgs) {
  var org = orgs.filter(function (o) { return o.id === orgId; })[0];
  var body =
    (org && org.logoUrl ? '<div style="margin-bottom:10px;"><img src="' + esc(org.logoUrl) + '" alt="" style="height:48px;width:auto;max-width:200px;object-fit:contain;border-radius:8px;" /></div>' : '') +
    UI.field('Logo image', '<input type="file" id="fOrgLogo" accept="image/*" class="field-input" />');
  UI.openModal('Upload logo — ' + (org ? esc(org.name) : ''), body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('save'), className: 'btn-primary', onClick: async function () {
        try {
          var fileInput = document.getElementById('fOrgLogo');
          if (!fileInput.files[0]) { UI.toast('Choose an image file first', 'error'); return; }
          var payload = {
            orgId: orgId, fileBase64: await fileToBase64(fileInput.files[0]),
            fileName: fileInput.files[0].name, mimeType: fileInput.files[0].type
          };
          await Api.call('uploadOrgLogo', payload);
          UI.closeModal(); UI.toast('Logo uploaded', 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      } }
  ]);
}
