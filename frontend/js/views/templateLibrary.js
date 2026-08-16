/**
 * HULUL - Template Library admin view. The Inspection Company's master readiness documents
 * (ZSMP, ZERP, TTP, CSM, SEC, and anything else they add) — uploaded once here; a newer version
 * simply replaces the current file, so nobody re-uploads the same document over and over. Nothing
 * here is per-event — see the Templates tab on an event for how a Project Manager sends these out
 * and tracks each event's own copy.
 *
 * REQ follow-up: "Can I convert the templates to forms and include evaluation process as per
 * attached file?" -- docType (below) tags a library entry against a structured scoring catalog
 * (TemplateScoringItems); a document sent from an entry with a recognized docType gets a real
 * scoring form on its Templates tab (see tabTemplates/renderTemplateScoring in eventDetail.js)
 * instead of just the plain Evaluated/Missed decision.
 *
 * REQ follow-up: "if a new template is added then a new form must also be created -- how do I
 * create new forms" -- the "Scoring Forms" card below (renderScoringFormsCard_) is the answer: a
 * doc type is no longer a fixed enum needing a code change to extend (backend/Templates.gs's
 * isValidDocTypeCode_ only checks format now), and a whole new catalog can be built in one shot by
 * importing a CSV (importTemplateScoringCatalog, Templates.gs) instead of asking a developer to
 * hand-port another workbook sheet.
 */
var TEMPLATE_DOC_TYPES_ = ['ZSMP', 'ZERP', 'TTP', 'CSM', 'SEC', 'Other'];
// scoredDocTypes: docTypes returned by listScoringCatalogSummary (i.e. anything with an imported
// catalog already, including a brand-new custom code) -- merged in here so the dropdown always
// offers everything actually usable, not just the original 5 quick-picks. 'Other' always stays last
// as the explicit "no scoring form" choice.
function templateDocTypeOptionsHtml_(selected, scoredDocTypes) {
  var codes = TEMPLATE_DOC_TYPES_.filter(function (dt) { return dt !== 'Other'; });
  (scoredDocTypes || []).forEach(function (dt) { if (codes.indexOf(dt) === -1) codes.push(dt); });
  codes.push('Other');
  return '<option value="">' + esc(t('doctype_none_option')) + '</option>' +
    codes.map(function (dt) { return '<option value="' + esc(dt) + '"' + (dt === selected ? ' selected' : '') + '>' + esc(dt) + '</option>'; }).join('');
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

  var [library, catalogSummary] = await Promise.all([
    orgId ? Api.call('listTemplateLibrary', { orgId: orgId }) : Promise.resolve([]),
    Api.call('listScoringCatalogSummary', {})
  ]);
  var scoredDocTypes = catalogSummary.map(function (s) { return s.docType; });

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
    (canManage ? scoringFormsCardHtml_(catalogSummary) : '') +
    '<div class="card"><div class="card-body">' + UI.table([
      { key: 'name', label: t('col_name') },
      // REQ follow-up: "convert the templates to forms and include evaluation process" -- shows at a
      // glance which library entries have a structured scoring form behind them (see the Scoring
      // Forms card above for the full catalog list) vs. plain upload+review (blank).
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
    document.getElementById('newLibTplBtn').onclick = function () { openNewLibraryTemplateModal_(orgId, orgs, isSystemAdmin, canManage, scoredDocTypes); };
    document.querySelectorAll('[data-edit-lib-tpl]').forEach(function (btn) {
      btn.onclick = function () {
        var lib = library.filter(function (l) { return l.id === btn.getAttribute('data-edit-lib-tpl'); })[0];
        if (lib) openEditLibraryTemplateModal_(lib, orgId, orgs, isSystemAdmin, canManage, scoredDocTypes);
      };
    });
    document.querySelectorAll('[data-upload-version]').forEach(function (btn) {
      btn.onclick = function () { openUploadLibraryVersionModal_(btn.getAttribute('data-upload-version'), orgId, orgs, isSystemAdmin, canManage); };
    });
    wireScoringFormsCard_(orgId, orgs, isSystemAdmin, canManage);
  }
}

// REQ follow-up: "if a new template is added then a new form must also be created -- how do I
// create new forms" -- lists every scoring catalog that exists (across ALL orgs -- catalogs are
// global per docType, not org-scoped, same as TemplateScoringItems has no orgId column) with an
// Import/Replace action, plus a "+ New scoring form" button for a brand-new docType code. Shown to
// anyone with templateLibrary.manage, same gating as the rest of this page's admin actions.
function scoringFormsCardHtml_(catalogSummary) {
  return '<div class="card" style="margin-bottom:16px;"><div class="card-header" style="display:flex;justify-content:space-between;align-items:center;">' +
      '<div class="card-title">' + esc(t('scoring_forms_title')) + '</div>' +
      '<button class="btn btn-secondary btn-sm" id="newScoringFormBtn">' + esc(t('new_scoring_form_btn')) + '</button>' +
    '</div>' +
    '<div class="card-body">' +
      '<div class="muted" style="font-size:11px;margin-bottom:10px;">' + esc(t('scoring_forms_hint')) + '</div>' +
      (catalogSummary.length ? UI.table([
        { key: 'docType', label: t('col_doctype') },
        { key: 'itemCount', label: t('col_item_count') },
        { key: 'actions', label: t('actions'), render: r => UI.actionsCell(
          '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('title_reimport_catalog')) + '" data-import-catalog="' + esc(r.docType) + '" data-existing-count="' + r.itemCount + '">' + ICON('reupload_version') + '</button>'
        ) }
      ], catalogSummary, { emptyText: '' }) : '<div class="empty-state" style="padding:14px 0;">' + esc(t('empty_no_scoring_forms')) + '</div>') +
    '</div></div>';
}

function wireScoringFormsCard_(orgId, orgs, isSystemAdmin, canManage) {
  var newBtn = document.getElementById('newScoringFormBtn');
  if (newBtn) newBtn.onclick = function () { openImportScoringCatalogModal_(null, 0, orgId, orgs, isSystemAdmin, canManage); };
  document.querySelectorAll('[data-import-catalog]').forEach(function (btn) {
    btn.onclick = function () {
      openImportScoringCatalogModal_(btn.getAttribute('data-import-catalog'), Number(btn.getAttribute('data-existing-count')) || 0, orgId, orgs, isSystemAdmin, canManage);
    };
  });
}

// isNew (docType === null): brand-new catalog, docType is a free-text input validated against
// isValidDocTypeCode_'s format server-side (mirrored client-side below for immediate feedback).
// Otherwise: re-importing an existing catalog always replaces it (importTemplateScoringCatalog,
// Templates.gs, soft-deletes the old rows so past TemplateScoringResults keep pointing at something
// sensible) -- there's no partial-merge option, matching how re-uploading a library file's version
// is a full replace too, not a patch.
function openImportScoringCatalogModal_(docType, existingCount, orgId, orgs, isSystemAdmin, canManage) {
  var isNew = !docType;
  var body =
    (isNew
      ? UI.field(t('field_doc_type_code'), '<input id="fCatDocType" class="field-input" placeholder="e.g. EVAC" maxlength="20" />') +
        '<div class="muted" style="font-size:11px;margin:-4px 0 8px;">' + esc(t('doctype_code_hint')) + '</div>'
      : '<div style="font-weight:600;font-size:14px;margin-bottom:4px;">' + esc(docType) + '</div>' +
        '<div class="muted" style="font-size:11.5px;margin-bottom:10px;">' + esc(t('reimport_catalog_warning', { count: existingCount })) + '</div>'
    ) +
    UI.field(t('field_csv_file'), '<input type="file" id="fCatCsvFile" class="field-input" accept=".csv" />') +
    '<div style="margin-top:8px;"><a href="#" id="downloadCatalogTemplateLink" style="font-size:12px;color:var(--accent);">' + esc(t('download_csv_template')) + '</a></div>';

  UI.openModal(isNew ? t('new_scoring_form_title') : t('reimport_scoring_form_title', { docType: docType }), body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: isNew ? t('import') : t('replace'), className: 'btn-primary', onClick: async function () {
        var dt = isNew ? document.getElementById('fCatDocType').value.trim() : docType;
        if (!dt) { UI.toast(t('toast_doctype_required'), 'error'); return; }
        if (!/^[A-Za-z0-9_-]{1,20}$/.test(dt)) { UI.toast(t('toast_doctype_invalid_format'), 'error'); return; }
        var fileInput = document.getElementById('fCatCsvFile');
        if (!fileInput.files[0]) { UI.toast(t('toast_choose_file_first'), 'error'); return; }
        try {
          var csvText = await fileInput.files[0].text();
          var result = await Api.call('importTemplateScoringCatalog', { docType: dt, csvText: csvText, replace: !isNew });
          UI.closeModal();
          UI.toast(t('toast_scoring_catalog_imported', { count: result.imported }), 'success');
          if (result.skipped && result.skipped.length) UI.toast(t('toast_scoring_catalog_rows_skipped', { count: result.skipped.length }), 'error');
          renderLibraryFor_(orgId, orgs, isSystemAdmin, canManage);
        } catch (err) { UI.error(err); }
      } }
  ]);
  document.getElementById('downloadCatalogTemplateLink').onclick = function (e) {
    e.preventDefault();
    downloadScoringCatalogCsvTemplate_();
  };
}

// csvEscape_ reused from events.js (loaded on the same page) -- same BOM-prefixed, Excel-friendly
// CSV convention as every other export in this app.
function downloadScoringCatalogCsvTemplate_() {
  var headers = ['sectionCode', 'sectionName', 'itemCode', 'description', 'multiplier'];
  var sample = ['1.01', 'Organisation', '1.01.01', 'A named individual is appointed as manager.', '1'];
  var lines = [headers.map(csvEscape_).join(','), sample.map(csvEscape_).join(',')];
  var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = 'hulul-scoring-catalog-template.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function openNewLibraryTemplateModal_(orgId, orgs, isSystemAdmin, canManage, scoredDocTypes) {
  var body = UI.field(t('col_name'), '<input id="fLibName" class="field-input" placeholder="e.g. ZSMP" />') +
    UI.field(t('col_doctype'), '<select id="fLibDocType" class="field-input">' + templateDocTypeOptionsHtml_('', scoredDocTypes) + '</select>') +
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
function openEditLibraryTemplateModal_(lib, orgId, orgs, isSystemAdmin, canManage, scoredDocTypes) {
  var body = UI.field(t('col_name'), '<input id="fLibEditName" class="field-input" value="' + esc(lib.name) + '" />') +
    UI.field(t('col_doctype'), '<select id="fLibEditDocType" class="field-input">' + templateDocTypeOptionsHtml_(lib.docType, scoredDocTypes) + '</select>') +
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
