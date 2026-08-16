/**
 * HULUL - Template Library admin view. The Inspection Company's master readiness documents
 * (ZSMP, ZERP, TTP, CSM, SEC, and anything else they add) — uploaded once here; a newer version
 * simply replaces the current file, so nobody re-uploads the same document over and over. Nothing
 * here is per-event — see the Templates tab on an event for how a Project Manager sends these out
 * and tracks each event's own copy.
 *
 * REQ follow-up: "Can I convert the templates to forms and include evaluation process as per
 * attached file?" -- docType (below) tags a library entry against a structured scoring catalog
 * (TemplateScoringItems, seeded server-side from the GA26/JDCB Document Review Tool workbook's own
 * ZSMP/ZERP sheets); a document sent from an entry with a recognized docType gets a real scoring
 * form on its Templates tab (see tabTemplates/renderTemplateScoring in eventDetail.js) instead of
 * just the plain Evaluated/Missed decision. Mirrors backend/Templates.gs's own TEMPLATE_DOC_TYPES_
 * list -- kept in sync by hand since frontend/backend don't share constants in this app.
 */
var TEMPLATE_DOC_TYPES_ = ['ZSMP', 'ZERP', 'TTP', 'CSM', 'SEC', 'Other'];
function templateDocTypeOptionsHtml_(selected) {
  return '<option value="">' + esc(t('doctype_none_option')) + '</option>' +
    TEMPLATE_DOC_TYPES_.map(function (dt) { return '<option value="' + dt + '"' + (dt === selected ? ' selected' : '') + '>' + esc(dt) + '</option>'; }).join('');
}
async function renderTemplateLibrary() {
  // RBAC pilot (backend/Permissions.gs): admin-configurable from Settings > Permissions > Templates >
  // "Add or replace a library template".
  var canManage = hasPermission('templateLibrary.manage');
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
    root.innerHTML = '<div class="page-header"><div><div class="page-title">' + esc(t('template_library_title', { term: Term('template_plural') })) + '</div></div></div>' +
      '<div class="empty-state">' + esc(t('empty_no_inspection_orgs')) + '</div>';
    return;
  }

  var library = orgId ? await Api.call('listTemplateLibrary', { orgId: orgId }) : [];

  var orgPicker = isSystemAdmin
    ? '<div class="card" style="margin-bottom:16px;"><div class="card-body">' + UI.field(t('field_inspection_company'),
        '<select id="fLibOrg" class="field-input">' +
          orgs.map(function (o) { return '<option value="' + o.id + '"' + (o.id === orgId ? ' selected' : '') + '>' + esc(o.name) + '</option>'; }).join('') +
        '</select>') + '</div></div>'
    : '';

  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + esc(t('template_library_title', { term: Term('template_plural') })) + '</div>' +
    '<div class="page-subtitle">' + esc(t('library_subtitle')) + '</div></div>' +
    (canManage ? '<button class="btn btn-primary" id="newLibTplBtn">' + esc(t('new_template_btn')) + '</button>' : '') + '</div>' +
    orgPicker +
    '<div class="card"><div class="card-body">' + UI.table([
      { key: 'name', label: t('col_name') },
      // REQ follow-up: "convert the templates to forms and include evaluation process" -- shows at a
      // glance which library entries have a structured scoring form behind them (v1: ZSMP/ZERP) vs.
      // plain upload+review (blank).
      { key: 'docType', label: t('col_doctype'), render: r => r.docType ? esc(r.docType) : '<span class="muted">' + esc(t('doctype_none_option')) + '</span>' },
      { key: 'fileName', label: t('col_current_file'), render: r => r.fileUrl ? '<a href="' + r.fileUrl + '" target="_blank" style="color:var(--accent);">' + esc(r.fileName || t('word_view')) + '</a>' : '—' },
      { key: 'updatedAt', label: t('col_updated'), render: r => r.uploadedBy ? UI.fmtDate(r.updatedAt) : '—' }
    ].concat(canManage ? [{ key: 'actions', label: t('actions'), render: r => UI.actionsCell(
        '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('action_edit')) + '" data-edit-lib-tpl="' + r.id + '">' + ICON('edit') + '</button> ' +
        '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('upload_new_version_title')) + '" data-upload-version="' + r.id + '">' + ICON('reupload_version') + '</button>'
      ) }] : []),
      library, { emptyText: esc(t('empty_no_templates')) }) + '</div></div>';

  if (isSystemAdmin) {
    document.getElementById('fLibOrg').onchange = function () { renderLibraryFor_(this.value, orgs, true, canManage); };
  }
  if (canManage) {
    document.getElementById('newLibTplBtn').onclick = function () { openNewLibraryTemplateModal_(orgId, orgs, isSystemAdmin, canManage); };
    document.querySelectorAll('[data-edit-lib-tpl]').forEach(function (btn) {
      btn.onclick = function () {
        var lib = library.filter(function (l) { return l.id === btn.getAttribute('data-edit-lib-tpl'); })[0];
        if (lib) openEditLibraryTemplateModal_(lib, orgId, orgs, isSystemAdmin, canManage);
      };
    });
    document.querySelectorAll('[data-upload-version]').forEach(function (btn) {
      btn.onclick = function () { openUploadLibraryVersionModal_(btn.getAttribute('data-upload-version'), orgId, orgs, isSystemAdmin, canManage); };
    });
  }
}

function openNewLibraryTemplateModal_(orgId, orgs, isSystemAdmin, canManage) {
  var body = UI.field(t('col_name'), '<input id="fLibName" class="field-input" placeholder="e.g. ZSMP" />') +
    UI.field(t('col_doctype'), '<select id="fLibDocType" class="field-input">' + templateDocTypeOptionsHtml_('') + '</select>') +
    '<div class="muted" style="font-size:11px;margin:-4px 0 8px;">' + esc(t('doctype_hint')) + '</div>' +
    UI.field(t('field_initial_file_optional'), '<input type="file" id="fLibFile" class="field-input" />');
  UI.openModal(t('new_template_title'), body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('create'), className: 'btn-primary', onClick: async function () {
        var name = document.getElementById('fLibName').value.trim();
        if (!name) { UI.toast(t('toast_name_required'), 'error'); return; }
        try {
          var payload = { orgId: orgId, name: name, docType: document.getElementById('fLibDocType').value };
          var fileInput = document.getElementById('fLibFile');
          if (fileInput.files[0]) {
            payload.fileBase64 = await fileToBase64(fileInput.files[0]);
            payload.fileName = fileInput.files[0].name;
            payload.mimeType = fileInput.files[0].type;
          }
          await Api.call('createLibraryTemplate', payload);
          UI.closeModal(); UI.toast(t('toast_template_created'), 'success'); renderLibraryFor_(orgId, orgs, isSystemAdmin, canManage);
        } catch (err) { UI.error(err); }
      } }
  ]);
}

// REQ follow-up: "convert the templates to forms and include evaluation process" -- edits an
// existing library entry's own name/docType (updateLibraryTemplate, Templates.gs), separate from
// openUploadLibraryVersionModal_ below which only ever replaces the file.
function openEditLibraryTemplateModal_(lib, orgId, orgs, isSystemAdmin, canManage) {
  var body = UI.field(t('col_name'), '<input id="fLibEditName" class="field-input" value="' + esc(lib.name) + '" />') +
    UI.field(t('col_doctype'), '<select id="fLibEditDocType" class="field-input">' + templateDocTypeOptionsHtml_(lib.docType) + '</select>') +
    '<div class="muted" style="font-size:11px;margin-top:-4px;">' + esc(t('doctype_hint')) + '</div>';
  UI.openModal(t('edit_x', { term: Term('template') }), body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('save'), className: 'btn-primary', onClick: async function () {
        var name = document.getElementById('fLibEditName').value.trim();
        if (!name) { UI.toast(t('toast_name_required'), 'error'); return; }
        try {
          await Api.call('updateLibraryTemplate', { templateLibraryId: lib.id, name: name, docType: document.getElementById('fLibEditDocType').value });
          UI.closeModal(); UI.toast(t('toast_updated'), 'success'); renderLibraryFor_(orgId, orgs, isSystemAdmin, canManage);
        } catch (err) { UI.error(err); }
      } }
  ]);
}

function openUploadLibraryVersionModal_(templateLibraryId, orgId, orgs, isSystemAdmin, canManage) {
  var body = UI.field(t('field_new_file'), '<input type="file" id="fLibVerFile" class="field-input" />');
  UI.openModal(t('upload_new_version_title'), body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('save'), className: 'btn-primary', onClick: async function () {
        var fileInput = document.getElementById('fLibVerFile');
        if (!fileInput.files[0]) { UI.toast(t('toast_choose_file_first'), 'error'); return; }
        try {
          await Api.call('uploadLibraryTemplateVersion', {
            templateLibraryId: templateLibraryId, fileBase64: await fileToBase64(fileInput.files[0]),
            fileName: fileInput.files[0].name, mimeType: fileInput.files[0].type
          });
          UI.closeModal(); UI.toast(t('toast_new_version_uploaded'), 'success'); renderLibraryFor_(orgId, orgs, isSystemAdmin, canManage);
        } catch (err) { UI.error(err); }
      } }
  ]);
}
