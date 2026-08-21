/**
 * HULUL - Annex Categories admin page (Inspection Setup)
 * REQ follow-up (after the Annex tab shipped with no admin CRUD of its own): "I would rather have
 * this part of the inspection setup so the responsible person can make changes or add new categories
 * and mark default required uploads." Full CRUD over the global AnnexCategories catalog (Annex.gs) --
 * add/edit/soft-delete a category and set its defaultRequired starting point -- same admin
 * audience/layout convention as disciplines.js/checklistItems.js/findingGuide.js.
 *
 * seedAnnexCategories_ (Setup.gs) seeded the original 28 rows once as part of full org provisioning;
 * this page is how the catalog is maintained going forward. It also exposes that same seed as a
 * one-click empty-state bootstrap (runSeedAnnexCategories, Annex.gs) for any org whose spreadsheet
 * predates the Annex feature and never got the initial seed, instead of needing the Apps Script
 * editor -- see this page's own empty-state below.
 *
 * ANNEX_BUILTIN_SECTIONS_/annexSectionsToRender_/annexSectionLabel_ (the original 3 fixed sections +
 * i18n labels, plus the logic for folding in admin-added custom sections) are defined once in
 * eventDetail.js (shared global, same convention as every other cross-file helper in this app) and
 * reused here so the section list can never drift between the per-event Annex tab and this page.
 *
 * REQ follow-up: "In Annex Category allow to create a new Section." Section is no longer a closed
 * 3-value enum -- openAnnexCategoryForm_'s Section field is a select of every section already in use
 * (built-in + custom) plus an "Add new section" option that reveals a free-text input, same
 * suggestable-select pattern openFindingGuideForm_ (findingGuide.js) already uses for its Category
 * field. Annex.gs's create/updateAnnexCategory validate it exactly like a category name now (non-
 * empty, trimmed) instead of against a fixed whitelist.
 */
async function renderAnnexCategories() {
  var root = document.getElementById('viewRoot');
  var canManage = hasPermission('annex.manageCatalog');
  var categories = await Api.call('listAnnexCategories', {});

  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + esc(t('annex_categories_title')) + '</div>' +
    '<div class="page-subtitle">' + esc(t('annex_categories_subtitle')) + '</div></div>' +
    (canManage ? '<button class="btn btn-primary" id="newAnnexCategoryBtn">' + esc(t('new_x', { term: t('annex_category').toLowerCase() })) + '</button>' : '') +
    '</div>' +
    '<div id="acBody"></div>';

  if (canManage) {
    document.getElementById('newAnnexCategoryBtn').onclick = function () {
      openAnnexCategoryForm_(categories, {
        title: t('new_x_title', { term: t('annex_category') }),
        submitLabel: t('create'),
        initial: {},
        onSubmit: async function (payload) {
          await Api.call('createAnnexCategory', payload);
          UI.closeModal(); UI.toast(t('x_created', { term: t('annex_category') }), 'success'); Router.resolve();
        }
      });
    };
  }

  if (!categories.length) {
    document.getElementById('acBody').innerHTML =
      '<div class="card"><div class="card-body">' +
        '<div class="empty-state">' + esc(t('annex_categories_empty_hint')) + '</div>' +
        (canManage
          ? '<div style="text-align:center;margin-top:12px;"><button class="btn btn-secondary btn-sm" id="seedAnnexCategoriesBtn">' + esc(t('annex_seed_categories_btn')) + '</button></div>'
          : '') +
      '</div></div>';
    if (canManage) {
      document.getElementById('seedAnnexCategoriesBtn').onclick = async function () {
        try {
          var result = await Api.call('runSeedAnnexCategories', {});
          UI.toast(t('toast_annex_categories_seeded', { count: result.seeded }), 'success');
          Router.resolve();
        } catch (err) { UI.error(err); }
      };
    }
    return;
  }

  document.getElementById('acBody').innerHTML = annexSectionsToRender_(categories).map(function (sec) {
    var rows = categories.filter(function (c) { return c.section === sec[0]; });
    return '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + esc(annexSectionLabel_(sec[0])) + '</div></div>' +
      '<div class="card-body">' + UI.table([
        { key: 'name', label: t('col_category') },
        { key: 'defaultRequired', label: t('col_default_required'), render: r => canManage
          ? '<input type="checkbox" class="ac-default-required-cb" data-category-id="' + esc(r.id) + '" ' + (r.defaultRequired ? 'checked' : '') + ' />'
          : (r.defaultRequired ? t('word_yes') : '—') },
        { key: 'status', label: t('status'), render: r => UI.statusBadge(r.status) }
      ].concat(canManage ? [{ key: 'actions', label: t('actions'), render: r =>
          UI.actionsCell(
            '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('action_edit')) + '" data-edit-ac="' + r.id + '">' + ICON('edit') + '</button> ' +
            '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('action_delete')) + '" data-delete-ac="' + r.id + '">' + ICON('delete') + '</button>'
          ) }] : []),
        rows, { emptyText: t('no_data'), hideExportButton: true }) + '</div></div>';
  }).join('');

  if (!canManage) return;

  document.querySelectorAll('.ac-default-required-cb').forEach(function (cb) {
    cb.onchange = async function () {
      try {
        await Api.call('updateAnnexCategory', { categoryId: cb.getAttribute('data-category-id'), defaultRequired: cb.checked });
        UI.toast(t('toast_annex_default_required_updated'), 'success'); Router.resolve();
      } catch (err) { UI.error(err); }
    };
  });
  document.querySelectorAll('[data-edit-ac]').forEach(function (btn) {
    btn.onclick = function () {
      var cat = categories.filter(function (c) { return c.id === btn.getAttribute('data-edit-ac'); })[0];
      if (!cat) return;
      openAnnexCategoryForm_(categories, {
        title: t('edit_x', { term: t('annex_category') }),
        submitLabel: t('save'),
        initial: cat,
        onSubmit: async function (payload) {
          await Api.call('updateAnnexCategory', Object.assign({ categoryId: cat.id }, payload));
          UI.closeModal(); UI.toast(t('x_updated', { term: t('annex_category') }), 'success'); Router.resolve();
        }
      });
    };
  });
  document.querySelectorAll('[data-delete-ac]').forEach(function (btn) {
    btn.onclick = function () {
      var categoryId = btn.getAttribute('data-delete-ac');
      UI.confirmModal(t('delete_annex_category_confirm'), async function () {
        try {
          await Api.call('deleteAnnexCategory', { categoryId: categoryId });
          UI.toast(t('x_deleted', { term: t('annex_category') }), 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      }, { confirmLabel: t('delete') });
    };
  });
}

// Shared by "+ New" and each row's Edit button. Section is a suggestable select -- every section
// already in use (built-in, translated, plus any custom ones already added, shown by their literal
// name) -- plus an "Add new section" option that reveals a free-text input, same pattern
// openFindingGuideForm_'s Category field (findingGuide.js) already uses for the same "closed catalogue
// that should still let an admin introduce a new value inline" need.
function openAnnexCategoryForm_(categories, opts) {
  var initial = opts.initial || {};
  var sectionOptions = annexSectionsToRender_(categories); // [[key, i18nLabelOrNull], ...]
  var matched = initial.section && sectionOptions.some(function (s) { return s[0] === initial.section; });
  var sectionSelectHtml =
    sectionOptions.map(function (sec) {
      return '<option value="' + esc(sec[0]) + '"' + (sec[0] === initial.section ? ' selected' : '') + '>' + esc(annexSectionLabel_(sec[0])) + '</option>';
    }).join('') +
    '<option value="__new__"' + (!matched && initial.section ? ' selected' : '') + '>' + esc(t('add_new_section_option')) + '</option>';

  var body =
    UI.field(t('col_section'),
      '<select id="fAcSection" class="field-input">' + sectionSelectHtml + '</select>' +
      '<input id="fAcSectionNew" class="field-input" placeholder="' + esc(t('col_section')) + '" style="margin-top:6px;' + (matched || !initial.section ? 'display:none;' : '') + '" value="' + esc(!matched ? (initial.section || '') : '') + '" />'
    ) +
    UI.field(t('col_category'), '<input id="fAcName" class="field-input" value="' + esc(initial.name || '') + '" />') +
    UI.field('', '<label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:400;">' +
      '<input type="checkbox" id="fAcDefaultRequired" ' + (initial.defaultRequired ? 'checked' : '') + ' /> ' + esc(t('annex_default_required_label')) + '</label>');

  UI.openModal(opts.title, body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: opts.submitLabel, className: 'btn-primary', onClick: async function () {
        var sectionSelect = document.getElementById('fAcSection');
        var section = sectionSelect.value === '__new__' ? document.getElementById('fAcSectionNew').value.trim() : sectionSelect.value;
        var name = document.getElementById('fAcName').value.trim();
        if (!section) { UI.toast(t('toast_section_required'), 'error'); return; }
        if (!name) { UI.toast(t('toast_category_required'), 'error'); return; }
        var payload = { section: section, name: name, defaultRequired: document.getElementById('fAcDefaultRequired').checked };
        try { await opts.onSubmit(payload); } catch (err) { UI.error(err); }
      } }
  ]);

  var sectionSelectEl = document.getElementById('fAcSection');
  var sectionNewEl = document.getElementById('fAcSectionNew');
  sectionSelectEl.onchange = function () {
    sectionNewEl.style.display = sectionSelectEl.value === '__new__' ? '' : 'none';
    if (sectionSelectEl.value === '__new__') sectionNewEl.focus();
  };
}
