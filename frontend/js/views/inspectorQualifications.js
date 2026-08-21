/**
 * HULUL - Inspector Qualifications admin view (REQ-DIS-02). Sets the full set of disciplines an
 * Inspector is qualified in; assignInspector blocks unqualified assignments against this list.
 */
async function renderInspectorQualifications(params) {
  var root = document.getElementById('viewRoot');
  var [inspectors, disciplines] = await Promise.all([
    Api.call('listUsers', { role: 'Inspector' }), Api.call('listDisciplines', {})
  ]);
  var selectedId = params && params.inspectorId ? params.inspectorId : (inspectors[0] && inspectors[0].id);
  var currentQuals = selectedId ? await Api.call('listInspectorQualifications', { inspectorId: selectedId }) : [];
  var currentIds = currentQuals.map(function (d) { return d.id; });

  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + esc(t('qualifications_page_title', { term: Term('inspector_plural') })) + '</div>' +
    '<div class="page-subtitle">' + esc(t('qualification_profile_subtitle', { disciplineTerm: Term('discipline'), inspectorTerm: Term('inspector') })) + '</div></div></div>' +
    (inspectors.length
      ? '<div class="card" style="margin-bottom:16px;"><div class="card-body">' +
        UI.field(Term('inspector'), '<select id="fQualInspector" class="field-input">' +
          inspectors.map(i => '<option value="' + i.id + '"' + (i.id === selectedId ? ' selected' : '') + '>' + esc(i.name) + ' (' + esc(i.email) + ')</option>').join('') +
          '</select>') +
        // REQ: "In Inspectors Qualifications add 'Select all'." One toggle checkbox above the
        // discipline matrix -- checks/unchecks every .qual-check at once; its own state stays in
        // sync with the matrix afterward (indeterminate when only some are checked), same
        // select-all/indeterminate pattern already used for a photo group's checkbox in
        // logPhotos.js's renderLogPhotoGroups_ (syncGroupCheckboxStates_).
        (disciplines.length
          ? '<label style="display:flex;align-items:center;gap:6px;margin:0 0 8px;font-size:13px;font-weight:600;">' +
            '<input type="checkbox" id="qualSelectAll" /> ' + esc(t('select_all_btn')) + '</label>'
          : '') +
        '<div style="margin-top:4px;">' + disciplines.map(d =>
          '<label style="display:inline-flex;align-items:center;gap:6px;margin:4px 12px 4px 0;font-size:13px;">' +
          '<input type="checkbox" class="qual-check" value="' + d.id + '"' + (currentIds.indexOf(d.id) !== -1 ? ' checked' : '') + ' /> ' + esc(bi_(d.name, d.nameAr)) + '</label>').join('') + '</div>' +
        '<div><button class="btn btn-primary btn-sm" id="saveQualBtn" style="margin-top:12px;">' + t('save') + '</button></div>' +
        '<div class="muted" style="font-size:12px;margin-top:8px;">' + esc(t('save_replaces_qual_hint', { inspectorTerm: Term('inspector'), disciplineTerm: Term('discipline_plural').toLowerCase() })) + '</div>' +
        '</div></div>' +
        '<div class="card"><div class="card-header"><div class="card-title">' + esc(t('currently_qualified_in')) + '</div></div><div class="card-body">' +
        UI.table([{ key: 'name', label: Term('discipline'), render: r => esc(bi_(r.name, r.nameAr)) }, { key: 'code', label: t('col_code') }], currentQuals, { emptyText: esc(t('empty_qualifications', { disciplineTerm: Term('discipline_plural').toLowerCase(), inspectorTerm: Term('inspector') })) }) +
        '</div></div>'
      : '<div class="empty-state">' + esc(t('empty_no_inspector_accounts', { term: Term('inspector') })) + '</div>');

  if (!inspectors.length) return;

  document.getElementById('fQualInspector').onchange = function () {
    window.location.hash = '#/inspector-qualifications?inspectorId=' + this.value; Router.resolve();
  };
  var qualChecks = Array.from(document.querySelectorAll('.qual-check'));
  var selectAllBox = document.getElementById('qualSelectAll');
  function syncSelectAll_() {
    if (!selectAllBox) return;
    var checkedCount = qualChecks.filter(function (c) { return c.checked; }).length;
    selectAllBox.checked = qualChecks.length > 0 && checkedCount === qualChecks.length;
    selectAllBox.indeterminate = checkedCount > 0 && checkedCount < qualChecks.length;
  }
  if (selectAllBox) {
    syncSelectAll_();
    selectAllBox.onchange = function () {
      qualChecks.forEach(function (c) { c.checked = selectAllBox.checked; });
      selectAllBox.indeterminate = false;
    };
    qualChecks.forEach(function (c) { c.addEventListener('change', syncSelectAll_); });
  }
  document.getElementById('saveQualBtn').onclick = async function () {
    var ids = Array.from(document.querySelectorAll('.qual-check:checked')).map(c => c.value);
    try {
      await Api.call('setInspectorQualifications', { inspectorId: document.getElementById('fQualInspector').value, disciplineIds: ids });
      UI.toast(t('toast_qualifications_saved'), 'success'); Router.resolve();
    } catch (err) { UI.error(err); }
  };
}
