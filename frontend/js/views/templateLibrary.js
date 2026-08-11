/**
 * HULUL - Template Library admin view. The Inspection Company's master readiness documents
 * (ZSMP, ZERP, TTP, CSM, SEC, and anything else they add) — uploaded once here; a newer version
 * simply replaces the current file, so nobody re-uploads the same document over and over. Nothing
 * here is per-event — see the Templates tab on an event for how a Project Manager sends these out
 * and tracks each event's own copy.
 */
var TEMPLATE_LIBRARY_MANAGE_ROLES = ['SystemAdmin', 'InspectionAdmin'];

async function renderTemplateLibrary() {
  var canManage = TEMPLATE_LIBRARY_MANAGE_ROLES.indexOf(HululState.user.role) !== -1;
  var isSystemAdmin = HululState.user.role === 'SystemAdmin';
  var orgs = [];
  var orgId = HululState.user.orgId;
  if (isSystemAdmin) {
    orgs = (await Api.call('listOrganizations', {})).filter(function (o) { return o.type === 'INSPECTION'; });
    orgId = (orgs[0] && orgs[0].id) || '';
  }
  await renderLibraryFor_(orgId, orgs, isSystemAdmin, canManage);
}

async function renderLibraryFor_(orgId, orgs, isSystemAdmin, canManage) {
  var root = document.getElementById('viewRoot');

  if (isSystemAdmin && !orgId) {
    root.innerHTML = '<div class="page-header"><div><div class="page-title">' + esc(Term('template_plural')) + ' Library</div></div></div>' +
      '<div class="empty-state">No Inspection Company organizations found yet.</div>';
    return;
  }

  var library = orgId ? await Api.call('listTemplateLibrary', { orgId: orgId }) : [];

  var orgPicker = isSystemAdmin
    ? '<div class="card" style="margin-bottom:16px;"><div class="card-body">' + UI.field('Inspection Company',
        '<select id="fLibOrg" class="field-input">' +
          orgs.map(function (o) { return '<option value="' + o.id + '"' + (o.id === orgId ? ' selected' : '') + '>' + esc(o.name) + '</option>'; }).join('') +
        '</select>') + '</div></div>'
    : '';

  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + esc(Term('template_plural')) + ' Library</div>' +
    '<div class="page-subtitle">Master documents your Project Managers can send to events</div></div>' +
    (canManage ? '<button class="btn btn-primary" id="newLibTplBtn">+ New template</button>' : '') + '</div>' +
    orgPicker +
    '<div class="card"><div class="card-body">' + UI.table([
      { key: 'name', label: 'Name' },
      { key: 'fileName', label: 'Current file', render: r => r.fileUrl ? '<a href="' + r.fileUrl + '" target="_blank" style="color:var(--accent);">' + esc(r.fileName || 'view') + '</a>' : '—' },
      { key: 'updatedAt', label: 'Updated', render: r => r.uploadedBy ? UI.fmtDate(r.updatedAt) : '—' }
    ].concat(canManage ? [{ key: 'actions', label: t('actions'), render: r => '<button class="btn btn-secondary btn-sm btn-icon" title="Upload new version" data-upload-version="' + r.id + '">' + ICON('reupload_version') + '</button>' }] : []),
      library, { emptyText: 'No templates yet.' }) + '</div></div>';

  if (isSystemAdmin) {
    document.getElementById('fLibOrg').onchange = function () { renderLibraryFor_(this.value, orgs, true, canManage); };
  }
  if (canManage) {
    document.getElementById('newLibTplBtn').onclick = function () { openNewLibraryTemplateModal_(orgId, orgs, isSystemAdmin, canManage); };
    document.querySelectorAll('[data-upload-version]').forEach(function (btn) {
      btn.onclick = function () { openUploadLibraryVersionModal_(btn.getAttribute('data-upload-version'), orgId, orgs, isSystemAdmin, canManage); };
    });
  }
}

function openNewLibraryTemplateModal_(orgId, orgs, isSystemAdmin, canManage) {
  var body = UI.field('Name', '<input id="fLibName" class="field-input" placeholder="e.g. ZSMP" />') +
    UI.field('Initial file (optional)', '<input type="file" id="fLibFile" class="field-input" />');
  UI.openModal('New template', body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('create'), className: 'btn-primary', onClick: async function () {
        var name = document.getElementById('fLibName').value.trim();
        if (!name) { UI.toast('Name is required', 'error'); return; }
        try {
          var payload = { orgId: orgId, name: name };
          var fileInput = document.getElementById('fLibFile');
          if (fileInput.files[0]) {
            payload.fileBase64 = await fileToBase64(fileInput.files[0]);
            payload.fileName = fileInput.files[0].name;
            payload.mimeType = fileInput.files[0].type;
          }
          await Api.call('createLibraryTemplate', payload);
          UI.closeModal(); UI.toast('Template created', 'success'); renderLibraryFor_(orgId, orgs, isSystemAdmin, canManage);
        } catch (err) { UI.error(err); }
      } }
  ]);
}

function openUploadLibraryVersionModal_(templateLibraryId, orgId, orgs, isSystemAdmin, canManage) {
  var body = UI.field('New file', '<input type="file" id="fLibVerFile" class="field-input" />');
  UI.openModal('Upload new version', body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('save'), className: 'btn-primary', onClick: async function () {
        var fileInput = document.getElementById('fLibVerFile');
        if (!fileInput.files[0]) { UI.toast('Choose a file first', 'error'); return; }
        try {
          await Api.call('uploadLibraryTemplateVersion', {
            templateLibraryId: templateLibraryId, fileBase64: await fileToBase64(fileInput.files[0]),
            fileName: fileInput.files[0].name, mimeType: fileInput.files[0].type
          });
          UI.closeModal(); UI.toast('New version uploaded', 'success'); renderLibraryFor_(orgId, orgs, isSystemAdmin, canManage);
        } catch (err) { UI.error(err); }
      } }
  ]);
}
