/**
 * HULUL - Disciplines admin view (reference catalogue: Crowd Safety, Fire Safety, etc.).
 * Setup.gs seeds the defaults; this page lets SystemAdmin/InspectionAdmin add more.
 *
 * REQ: "Code can not be less or more than 3 characters. Add new column name it 'Cat Ref.' This
 * holds reference number for this specific category but should be displayed in Roman values. If
 * value is 2, it should display as II." catRef is stored as a plain whole number (createDiscipline,
 * Disciplines.gs, is the authoritative validator); toRoman_ below is purely a display formatter.
 */

// Standard Roman numeral conversion (1-3999 is the traditional well-formed range; beyond that this
// just keeps prepending 'M', a harmless degenerate case rather than an error for an edge input no
// realistic category count would ever reach).
function toRoman_(num) {
  num = Math.floor(Number(num));
  if (!Number.isFinite(num) || num < 1) return '—';
  var map = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']
  ];
  var result = '';
  map.forEach(function (pair) {
    while (num >= pair[0]) { result += pair[1]; num -= pair[0]; }
  });
  return result;
}

async function renderDisciplinesAdmin() {
  var root = document.getElementById('viewRoot');
  var disciplines = await Api.call('listDisciplines', {});
  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + esc(Term('discipline_plural')) + '</div>' +
    '<div class="page-subtitle">' + esc(t('compliance_catalogue_subtitle', { term: Term('discipline').toLowerCase() })) + '</div></div>' +
    '<button class="btn btn-primary" id="newDiscBtn">' + esc(t('new_x', { term: Term('discipline').toLowerCase() })) + '</button></div>' +
    '<div class="card"><div class="card-body">' + UI.table([
      // REQ: "When turning platform to Arabic, some information is still in English" -- shows the
      // Arabic name (nameAr) instead of the English one whenever the UI itself is in Arabic, same
      // bi_() fallback every other render site for this data uses (see i18n.js).
      { key: 'name', label: t('col_name'), render: r => esc(bi_(r.name, r.nameAr)) }, { key: 'code', label: t('col_code') },
      { key: 'catRef', label: t('col_cat_ref'), render: r => esc(toRoman_(r.catRef)) },
      { key: 'id', label: t('col_id') },
      // REQ follow-up: "In Categories page allow editing." Same permission as the New button above
      // (discipline.manage) -- there was never a separate "view only" tier for this catalogue.
      { key: 'actions', label: t('actions'), render: r =>
          '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('action_edit')) + '" data-edit-disc="' + esc(r.id) + '">' + ICON('edit') + '</button>' }
    ], disciplines, {}) + '</div></div>';

  document.getElementById('newDiscBtn').onclick = function () {
    var body = UI.field(t('col_name'), '<input id="fDiscName" class="field-input" placeholder="Crowd Safety" />') +
      UI.field(t('col_name_ar'), '<input id="fDiscNameAr" class="field-input" dir="rtl" placeholder="السلامة العامة" />') +
      UI.field(t('col_code'), '<input id="fDiscCode" class="field-input" placeholder="CSM" maxlength="3" />') +
      UI.field(t('col_cat_ref'), '<input id="fDiscCatRef" type="number" min="1" step="1" class="field-input" placeholder="1" />' +
        '<div class="muted" style="font-size:11px;margin-top:4px;">' + esc(t('cat_ref_hint')) + '</div>');
    UI.openModal(t('new_x_title', { term: Term('discipline') }), body, [
      { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
      { label: t('create'), className: 'btn-primary', onClick: async function () {
          var code = document.getElementById('fDiscCode').value.trim();
          if (code.length !== 3) { UI.toast(t('toast_code_must_be_3'), 'error'); return; }
          var catRefRaw = document.getElementById('fDiscCatRef').value;
          var catRef = Number(catRefRaw);
          if (catRefRaw === '' || !Number.isInteger(catRef) || catRef < 1) { UI.toast(t('toast_cat_ref_required'), 'error'); return; }
          try {
            await Api.call('createDiscipline', { name: document.getElementById('fDiscName').value, nameAr: document.getElementById('fDiscNameAr').value.trim(), code: code, catRef: catRef });
            UI.closeModal(); UI.toast(t('x_created', { term: Term('discipline') }), 'success'); Router.resolve();
          } catch (err) { UI.error(err); }
        } }
    ]);
  };

  root.querySelectorAll('[data-edit-disc]').forEach(function (btn) {
    btn.onclick = function () {
      var disc = disciplines.filter(function (d) { return d.id === btn.getAttribute('data-edit-disc'); })[0];
      if (!disc) return;
      var body = UI.field(t('col_name'), '<input id="fDiscName" class="field-input" value="' + esc(disc.name) + '" />') +
        UI.field(t('col_name_ar'), '<input id="fDiscNameAr" class="field-input" dir="rtl" value="' + esc(disc.nameAr || '') + '" placeholder="السلامة العامة" />') +
        UI.field(t('col_code'), '<input id="fDiscCode" class="field-input" value="' + esc(disc.code) + '" maxlength="3" />') +
        UI.field(t('col_cat_ref'), '<input id="fDiscCatRef" type="number" min="1" step="1" class="field-input" value="' + esc(disc.catRef) + '" />' +
          '<div class="muted" style="font-size:11px;margin-top:4px;">' + esc(t('cat_ref_hint')) + '</div>');
      UI.openModal(t('edit_x', { term: Term('discipline') }), body, [
        { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
        { label: t('save'), className: 'btn-primary', onClick: async function () {
            var code = document.getElementById('fDiscCode').value.trim();
            if (code.length !== 3) { UI.toast(t('toast_code_must_be_3'), 'error'); return; }
            var catRefRaw = document.getElementById('fDiscCatRef').value;
            var catRef = Number(catRefRaw);
            if (catRefRaw === '' || !Number.isInteger(catRef) || catRef < 1) { UI.toast(t('toast_cat_ref_required'), 'error'); return; }
            try {
              await Api.call('updateDiscipline', { disciplineId: disc.id, name: document.getElementById('fDiscName').value, nameAr: document.getElementById('fDiscNameAr').value.trim(), code: code, catRef: catRef });
              UI.closeModal(); UI.toast(t('x_updated', { term: Term('discipline') }), 'success'); Router.resolve();
            } catch (err) { UI.error(err); }
          } }
      ]);
    };
  });
}
