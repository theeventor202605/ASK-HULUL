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
    '<div class="page-header"><div><div class="page-title">' + esc(Term('inspector_plural') + ' Qualifications') + '</div>' +
    '<div class="page-subtitle">' + esc(Term('discipline') + ' qualification profile per ' + Term('inspector')) + '</div></div></div>' +
    (inspectors.length
      ? '<div class="card" style="margin-bottom:16px;"><div class="card-body">' +
        UI.field(Term('inspector'), '<select id="fQualInspector" class="field-input">' +
          inspectors.map(i => '<option value="' + i.id + '"' + (i.id === selectedId ? ' selected' : '') + '>' + esc(i.name) + ' (' + esc(i.email) + ')</option>').join('') +
          '</select>') +
        '<div style="margin-top:12px;">' + disciplines.map(d =>
          '<label style="display:inline-flex;align-items:center;gap:6px;margin:4px 12px 4px 0;font-size:13px;">' +
          '<input type="checkbox" class="qual-check" value="' + d.id + '"' + (currentIds.indexOf(d.id) !== -1 ? ' checked' : '') + ' /> ' + esc(d.name) + '</label>').join('') + '</div>' +
        '<div><button class="btn btn-primary btn-sm" id="saveQualBtn" style="margin-top:12px;">' + t('save') + '</button></div>' +
        '<div class="muted" style="font-size:12px;margin-top:8px;">Saving replaces this ' + esc(Term('inspector')) + '\'s full qualification set with the checked ' + esc(Term('discipline_plural').toLowerCase()) + '.</div>' +
        '</div></div>' +
        '<div class="card"><div class="card-header"><div class="card-title">Currently qualified in</div></div><div class="card-body">' +
        UI.table([{ key: 'name', label: Term('discipline') }, { key: 'code', label: 'Code' }], currentQuals, { emptyText: 'No ' + esc(Term('discipline_plural').toLowerCase()) + ' saved for this ' + esc(Term('inspector')) + ' yet.' }) +
        '</div></div>'
      : '<div class="empty-state">No ' + esc(Term('inspector')) + ' accounts found yet.</div>');

  if (!inspectors.length) return;

  document.getElementById('fQualInspector').onchange = function () {
    window.location.hash = '#/inspector-qualifications?inspectorId=' + this.value; Router.resolve();
  };
  document.getElementById('saveQualBtn').onclick = async function () {
    var ids = Array.from(document.querySelectorAll('.qual-check:checked')).map(c => c.value);
    try {
      await Api.call('setInspectorQualifications', { inspectorId: document.getElementById('fQualInspector').value, disciplineIds: ids });
      UI.toast('Qualifications saved', 'success'); Router.resolve();
    } catch (err) { UI.error(err); }
  };
}
