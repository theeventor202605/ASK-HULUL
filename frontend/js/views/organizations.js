/**
 * HULUL - Organizations admin view (SystemAdmin only: GA / EMC / Inspection Company records).
 */
async function renderOrganizations() {
  var root = document.getElementById('viewRoot');
  var orgs = await Api.call('listOrganizations', {});
  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + t('nav_orgs') + '</div>' +
    '<div class="page-subtitle">' + esc(t('orgs_subtitle')) + '</div></div>' +
    '<button class="btn btn-primary" id="newOrgBtn">' + esc(t('new_org_btn')) + '</button></div>' +
    '<div class="card"><div class="card-body">' + UI.table([
      { key: 'logoUrl', label: t('col_logo'), render: r => r.logoUrl ? '<img src="' + esc(r.logoUrl) + '" alt="" width="28" height="28" style="height:28px;width:auto;max-width:100px;object-fit:contain;border-radius:6px;" onerror="this.style.display=\'none\'" />' : '<span class="muted">—</span>' },
      { key: 'name', label: t('col_name') },
      // REQ follow-up: this showed the raw org.type code (GA/EMC/INSPECTION) untranslated -- same
      // org_type_ga/org_type_emc/org_type_inspection keys the New Organization form's own Type
      // dropdown already uses (openNewOrgModal below), just not previously reused here for display.
      { key: 'type', label: t('col_type'), render: r => esc(r.type === 'GA' ? t('org_type_ga') : r.type === 'EMC' ? t('org_type_emc') : r.type === 'INSPECTION' ? t('org_type_inspection') : r.type === 'OPERATOR' ? t('org_type_operator') : (r.type || '—')) },
      // Used to build auto-generated Place-account login emails, e.g. 'vendor001@yawad.sa' -- see
      // placeAccountDomain_ in Places.gs. Falls back to a slugified org name when left blank.
      { key: 'domain', label: t('col_domain'), render: r => r.domain ? esc(r.domain) : '<span class="muted">—</span>' },
      { key: 'status', label: t('status'), render: r => UI.statusBadge('Resolved') },
      { key: 'createdAt', label: t('col_created'), render: r => UI.fmtDate(r.createdAt) },
      { key: 'actions', label: t('actions'), render: r =>
          UI.actionsCell(
            '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('edit_domain_title')) + '" data-edit-domain="' + r.id + '">' + ICON('domain') + '</button> ' +
            '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('upload_logo_title')) + '" data-upload-logo="' + r.id + '">' + ICON('upload_logo') + '</button>'
          ) }
    ], orgs, {}) + '</div></div>';

  document.getElementById('newOrgBtn').onclick = function () {
    var body = UI.field(t('field_name'), '<input id="fOrgName" class="field-input" />') +
      UI.field(t('field_type'), '<select id="fOrgType" class="field-input"><option value="GA">' + esc(t('org_type_ga')) + '</option><option value="EMC">' + esc(t('org_type_emc')) + '</option><option value="INSPECTION">' + esc(t('org_type_inspection')) + '</option><option value="OPERATOR">' + esc(t('org_type_operator')) + '</option></select>') +
      UI.field(t('field_domain_optional'), '<input id="fOrgDomain" class="field-input" placeholder="e.g. yawad.sa" />');
    UI.openModal(t('new_org_title'), body, [
      { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
      { label: t('create'), className: 'btn-primary', onClick: async function () {
          try {
            await Api.call('createOrganization', {
              name: document.getElementById('fOrgName').value, type: document.getElementById('fOrgType').value,
              domain: document.getElementById('fOrgDomain').value
            });
            UI.closeModal(); UI.toast(t('toast_org_created'), 'success'); Router.resolve();
          } catch (err) { UI.error(err); }
        } }
    ]);
  };

  root.querySelectorAll('[data-upload-logo]').forEach(function (b) {
    b.onclick = function () { openUploadLogoModal_(b.getAttribute('data-upload-logo'), orgs); };
  });
  root.querySelectorAll('[data-edit-domain]').forEach(function (b) {
    b.onclick = function () { openEditDomainModal_(b.getAttribute('data-edit-domain'), orgs); };
  });
}

// Lets a SystemAdmin set/correct the domain used to build a Place's auto-generated login emails
// (e.g. 'yawad.sa' for Yawad) -- see placeAccountDomain_ in Places.gs, which falls back to a
// slugified org name when this is blank.
function openEditDomainModal_(orgId, orgs) {
  var org = orgs.filter(function (o) { return o.id === orgId; })[0];
  var body = '<div class="muted" style="font-size:12.5px;margin-bottom:10px;">' + esc(t('domain_hint')) + '</div>' +
    UI.field(t('field_domain'), '<input id="fEditOrgDomain" class="field-input" placeholder="e.g. yawad.sa" value="' + esc(org && org.domain ? org.domain : '') + '" />');
  UI.openModal(t('domain_modal_title_prefix', { name: org ? esc(org.name) : '' }), body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('save'), className: 'btn-primary', onClick: async function () {
        try {
          await Api.call('updateOrganizationDomain', { orgId: orgId, domain: document.getElementById('fEditOrgDomain').value });
          UI.closeModal(); UI.toast(t('toast_domain_saved'), 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      } }
  ]);
}

// Logos are stored in Drive (same pattern as Template uploads) and shown across the app's topbar
// for every user in that organization — so this affects everyone signed in under that GA/EMC/
// Inspection Company, not just how it looks on this admin page.
function openUploadLogoModal_(orgId, orgs) {
  var org = orgs.filter(function (o) { return o.id === orgId; })[0];
  var body =
    (org && org.logoUrl ? '<div style="margin-bottom:10px;"><img src="' + esc(org.logoUrl) + '" alt="" width="48" height="48" style="height:48px;width:auto;max-width:200px;object-fit:contain;border-radius:8px;" onerror="this.style.display=\'none\'" /></div>' : '') +
    UI.field(t('field_logo_image'), '<input type="file" id="fOrgLogo" accept="image/*" class="field-input" />');
  UI.openModal(t('upload_logo_modal_title_prefix', { name: org ? esc(org.name) : '' }), body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('save'), className: 'btn-primary', onClick: async function () {
        try {
          var fileInput = document.getElementById('fOrgLogo');
          if (!fileInput.files[0]) { UI.toast(t('toast_choose_image_first'), 'error'); return; }
          var payload = {
            orgId: orgId, fileBase64: await fileToBase64(fileInput.files[0]),
            fileName: fileInput.files[0].name, mimeType: fileInput.files[0].type
          };
          await Api.call('uploadOrgLogo', payload);
          UI.closeModal(); UI.toast(t('toast_logo_uploaded'), 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      } }
  ]);
}
