/**
 * HULUL - Settings: compact tabbed layout (same .tabbar/.tab-btn pattern as the Event workspace)
 * instead of every section stacked as its own card -- Profile / Appearance / Security are always
 * present; Terminology and Icons are role-gated tabs that only appear (and only fetch their data)
 * for a user who can actually manage them, and only once that tab is opened.
 */
var ICON_MANAGE_ROLES = ['SystemAdmin'];
var PERMISSIONS_MANAGE_ROLES = ['SystemAdmin'];
// REQ follow-up: "check the tabs within Config, move what's still needed into Settings." The old
// standalone Config page (frontend/js/views/config.js, now deleted) had 3 tabs: General (a raw
// Config-sheet key/value editor), Process (readiness-template uploader/reviewer roles), and
// Escalations (timers + To/Cc roles + lock-screen toggle). General is what's genuinely "no more
// needed": grepping the whole backend, the ONLY two keys ever written to the Config sheet outside
// these two friendlier tabs are escalationTier2DelayHours/escalationTier3DelayHours (Setup.gs) --
// legacy seed defaults that getEscalationConfig_ (Resolutions.gs) only ever reads as a fallback
// BEFORE the Escalations tab has been saved even once; after that, the real per-risk-level values
// live in their own JSON blob and those two keys are never consulted again. So General had nothing
// left to usefully edit -- it's dropped rather than moved. Escalations, which IS still live and
// SystemAdmin-only exactly like Roles/Permissions above, moved in here as its own tab.
//
// REQ follow-up #2: "move items in the Process tab to Permissions tab." Process only ever held two
// role pickers (who can upload/submit a document, who can review/evaluate one) -- both now ordinary
// 'template.upload'/'template.review' entries in PERMISSION_REGISTRY_ (Permissions.gs), editable as
// chips on the Templates row of the Permissions matrix below instead of their own tab. So Process
// itself is gone; CONFIG_MANAGE_ROLES now only gates Escalations.
var CONFIG_MANAGE_ROLES = ['SystemAdmin'];
// Tabs that build their own stack of .card blocks (same as Escalations did on the old /config page)
// render into a plain, un-carded content div instead of the shared one -- otherwise every one of
// their cards would sit nested inside the shared outer card, doubling the border/padding for no
// reason. Every other tab (Profile, Terminology, Icons, Roles, Permissions, ...) still gets the
// shared card, unchanged.
var SETTINGS_PLAIN_CONTENT_TABS_ = { escalations: true };

async function renderSettings(params) {
  var root = document.getElementById('viewRoot');
  var u = HululState.user;
  var canManageLabels = hasPermission('orgLabels.manage');
  var canManageIcons = ICON_MANAGE_ROLES.indexOf(u.role) !== -1;
  var canManagePermissions = PERMISSIONS_MANAGE_ROLES.indexOf(u.role) !== -1;
  var canManageConfig = CONFIG_MANAGE_ROLES.indexOf(u.role) !== -1;

  var tabs = [
    { key: 'profile', label: t('settings_tab_profile') },
    { key: 'appearance', label: t('settings_tab_appearance') },
    { key: 'security', label: t('settings_tab_security') }
  ];
  if (canManageLabels) tabs.push({ key: 'terminology', label: t('settings_tab_terminology') });
  if (canManageIcons) tabs.push({ key: 'icons', label: t('settings_tab_icons') });
  if (canManageConfig) tabs.push({ key: 'escalations', label: t('tab_escalations') });
  if (canManagePermissions) tabs.push({ key: 'roles', label: t('settings_tab_roles') });
  if (canManagePermissions) tabs.push({ key: 'permissions', label: t('settings_tab_permissions') });

  var activeTab = tabs.some(function (tb) { return params && tb.key === params.tab; }) ? params.tab : 'profile';

  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + t('nav_settings') + '</div></div></div>' +
    '<div class="tabbar" id="settingsTabbar"></div>' +
    (SETTINGS_PLAIN_CONTENT_TABS_[activeTab]
      ? '<div id="settingsTabContent"></div>'
      : '<div class="card"><div class="card-body" id="settingsTabContent"></div></div>');

  var tabbar = document.getElementById('settingsTabbar');
  tabbar.innerHTML = tabs.map(function (tb) {
    return '<div class="tab-btn ' + (tb.key === activeTab ? 'active' : '') + '" data-tab="' + tb.key + '">' + esc(tb.label) + '</div>';
  }).join('');
  tabbar.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.onclick = function () { window.location.hash = '#/settings?tab=' + btn.getAttribute('data-tab'); };
  });

  var content = document.getElementById('settingsTabContent');
  content.innerHTML = '<div class="empty-state">' + t('loading') + '</div>';
  if (activeTab === 'profile') renderProfileTab_(content, u);
  else if (activeTab === 'appearance') renderAppearanceTab_(content);
  else if (activeTab === 'security') renderSecurityTab_(content);
  else if (activeTab === 'terminology' && canManageLabels) await renderTerminologyTab_(content);
  else if (activeTab === 'icons' && canManageIcons) await renderIconsTab_(content);
  else if (activeTab === 'escalations' && canManageConfig) await renderEscalationsTab_(content);
  else if (activeTab === 'roles' && canManagePermissions) await renderRolesTab_(content);
  else if (activeTab === 'permissions' && canManagePermissions) await renderPermissionsTab_(content);
  else renderProfileTab_(content, u);
}

/* ---------------- Profile ---------------- */
function renderProfileTab_(content, u) {
  content.innerHTML =
    '<div style="display:flex;align-items:center;gap:14px;margin-bottom:20px;">' +
      '<div class="avatar" style="width:52px;height:52px;font-size:18px;flex:none;">' + esc((u.name || '?').slice(0, 1).toUpperCase()) + '</div>' +
      '<div><div style="font-size:16px;font-weight:800;">' + esc(u.name) + '</div>' +
      '<div class="muted" style="font-size:12.5px;">' + esc(u.role) + '</div></div>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 28px;max-width:560px;">' +
      infoRow(t('email'), u.email) + infoRow(t('field_organization'), u.orgId) +
    '</div>';
}

/* ---------------- Appearance (Language + Theme) ---------------- */
function renderAppearanceTab_(content) {
  content.innerHTML =
    '<div style="margin-bottom:22px;">' +
      '<div style="font-size:11.5px;font-weight:700;color:var(--text-600);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px;">' + esc(t('appearance_language')) + '</div>' +
      // The target language's own name is always shown in its own script (not translated) --
      // only the "Switch to" wrapper text follows the current UI language.
      '<button class="btn btn-secondary btn-sm" id="settingsLangBtn">' + esc(t('switch_to_lang', { lang: HululState.lang === 'en' ? 'العربية' : 'English' })) + '</button>' +
    '</div>' +
    '<div>' +
      '<div style="font-size:11.5px;font-weight:700;color:var(--text-600);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px;">' + esc(t('appearance_theme')) + '</div>' +
      themeSwatchesHtml_() +
    '</div>';
  document.getElementById('settingsLangBtn').onclick = toggleLanguage;
  wireThemeSwatches_();
}

// 5 clickable colour swatches. Purely local -- see theme.js -- mirrors the existing per-browser
// `lang` preference pattern rather than being stored on the user's account.
function themeSwatchesHtml_() {
  return '<div style="display:flex;gap:14px;flex-wrap:wrap;">' +
    window.HULUL_THEMES.map(function (th) {
      var active = HululState.theme === th.id;
      return '<div class="theme-swatch-option' + (active ? ' active' : '') + '" data-theme-id="' + th.id + '" ' +
        'style="cursor:pointer;text-align:center;padding:10px;border-radius:12px;border:2px solid ' +
        (active ? 'var(--accent)' : 'transparent') + ';">' +
        '<div style="width:40px;height:40px;border-radius:50%;background:' + th.swatch + ';margin:0 auto 6px;' +
        (active ? 'box-shadow:0 0 0 2px var(--surface), 0 0 0 4px ' + th.swatch + ';' : '') + '"></div>' +
        '<div style="font-size:12.5px;font-weight:' + (active ? '700' : '500') + ';">' + esc(th.name) +
        (active ? ' ' + ICON('active_selected') : '') + '</div></div>';
    }).join('') +
    '</div>';
}

function wireThemeSwatches_() {
  document.querySelectorAll('.theme-swatch-option').forEach(function (el) {
    el.onclick = function () {
      setTheme(el.getAttribute('data-theme-id'));
      renderSettings({ tab: 'appearance' });
    };
  });
}

/* ---------------- Security (change password) ---------------- */
function renderSecurityTab_(content) {
  content.innerHTML =
    '<div class="form-row" style="max-width:560px;">' +
      UI.field(t('security_current_password'), '<input id="fOldPw" type="password" class="field-input" />') +
      UI.field(t('security_new_password'), '<input id="fNewPw" type="password" class="field-input" />') +
    '</div>' +
    '<button class="btn btn-primary btn-sm" id="changePwBtn" style="margin-top:12px;">' + esc(t('update_password')) + '</button>';

  document.getElementById('changePwBtn').onclick = async function () {
    try {
      await Api.call('changePassword', { oldPassword: document.getElementById('fOldPw').value, newPassword: document.getElementById('fNewPw').value });
      UI.toast(t('toast_password_updated'), 'success');
    } catch (err) { UI.error(err); }
  };
}

/* ---------------- Terminology ---------------- */
// Lets a GA/EMC/Inspection Admin (or SystemAdmin, for a chosen org) rename the platform's core
// object names for their own users — e.g. call Events "Projects". Purely cosmetic: see
// backend/Accounts.gs setOrgLabels for why this never touches the data model.
async function renderTerminologyTab_(content) {
  var isSystemAdmin = HululState.user.role === 'SystemAdmin';
  var orgs = [];
  var orgId = HululState.user.orgId;
  if (isSystemAdmin) {
    orgs = await Api.call('listOrganizations', {});
    orgId = (orgs[0] && orgs[0].id) || '';
  }
  await loadAndRenderTerminologyFor_(content, orgId, orgs, isSystemAdmin);
}

async function loadAndRenderTerminologyFor_(content, orgId, orgs, isSystemAdmin) {
  content.innerHTML = '<div class="empty-state">' + t('loading') + '</div>';

  if (isSystemAdmin && !orgId) {
    content.innerHTML = '<div class="empty-state">' + esc(t('terminology_create_org_first')) + '</div>';
    return;
  }

  var overrides = orgId ? await Api.call('getOrgLabels', { orgId: orgId }) : {};

  var orgPicker = isSystemAdmin
    ? '<div style="margin-bottom:14px;max-width:280px;">' + UI.field(t('field_organization'), '<select id="fTermOrg" class="field-input">' +
        orgs.map(function (o) { return '<option value="' + o.id + '"' + (o.id === orgId ? ' selected' : '') + '>' + esc(o.name) + '</option>'; }).join('') +
        '</select>') + '</div>'
    : '';

  var rows = HULUL_LABEL_FIELDS.map(function (f) {
    var singularVal = overrides[f.key] || '';
    var pluralVal = overrides[f.key + '_plural'] || '';
    return '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid #f0f1f6;">' +
      '<div><div style="font-weight:600;font-size:12.5px;">' + esc(window.HULUL_LABEL_DEFAULTS.en[f.key]) + '</div>' +
      '<div class="muted" style="font-size:10.5px;">' + esc(f.desc) + '</div></div>' +
      '<input class="field-input term-singular" data-key="' + f.key + '" placeholder="' + esc(window.HULUL_LABEL_DEFAULTS.en[f.key]) + '" value="' + esc(singularVal) + '" style="padding:6px 8px;font-size:12.5px;" />' +
      '<input class="field-input term-plural" data-key="' + f.key + '_plural" placeholder="' + esc(window.HULUL_LABEL_DEFAULTS.en[f.key + '_plural']) + '" value="' + esc(pluralVal) + '" style="padding:6px 8px;font-size:12.5px;" />' +
      '</div>';
  }).join('');

  content.innerHTML =
    '<div class="muted" style="font-size:12.5px;margin-bottom:12px;">' + esc(t('terminology_intro')) + '</div>' +
    orgPicker +
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;padding:4px 0;font-size:11px;font-weight:600;color:var(--text-600);">' +
    '<div>' + esc(t('col_object')) + '</div><div>' + esc(t('col_singular')) + '</div><div>' + esc(t('col_plural')) + '</div></div>' +
    rows +
    '<button class="btn btn-primary btn-sm" id="saveTermBtn" style="margin-top:14px;">' + t('save') + '</button>';

  if (isSystemAdmin) {
    document.getElementById('fTermOrg').onchange = function () {
      loadAndRenderTerminologyFor_(content, this.value, orgs, true);
    };
  }

  document.getElementById('saveTermBtn').onclick = async function () {
    var labels = {};
    content.querySelectorAll('.term-singular, .term-plural').forEach(function (input) {
      if (input.value.trim()) labels[input.getAttribute('data-key')] = input.value.trim();
    });
    try {
      await Api.call('setOrgLabels', { orgId: orgId, labels: labels });
      await loadOrgLabels_force_();
      UI.toast(t('toast_terminology_saved'), 'success');
      renderSidebar();
      loadAndRenderTerminologyFor_(content, orgId, orgs, isSystemAdmin);
    } catch (err) { UI.error(err); }
  };
}

// setOrgLabels only affects the acting user's own org's labels in HululState (loadOrgLabels is
// cached for the session) — force a refetch so the just-saved changes show immediately instead of
// waiting for the next login.
async function loadOrgLabels_force_() {
  HululState.orgLabelsLoaded = false;
  await loadOrgLabels();
}

/* ---------------- Icons ---------------- */
// SystemAdmin-only: override every icon in the app (not per-org, unlike Terminology above -- every
// organization's users see the same icons). A compact grid of small swatches (one per icon key)
// rather than a row per icon -- the label is a hover tooltip plus a live search filter instead of
// always-visible text, which is what keeps ~45+ icon keys from turning this tab into a huge list.
// Picks come from a curated ICON_LIBRARY (icons.js) via a grid picker modal. Edits are held in
// `pending` locally and only sent to the backend when Save is clicked.
async function renderIconsTab_(content) {
  content.innerHTML = '<div class="empty-state">' + t('loading') + '</div>';
  var overrides = await Api.call('getAppIcons', {});
  var customLibraries = await Api.call('getCustomIconLibraries', {});
  renderIconsTabBody_(content, Object.assign({}, overrides), customLibraries || []);
}

// Every icon in the app lives in one of two registries that both share this same override store
// (see icons.js): NAV_ITEMS (sidebar nav, keyed by path) and ICON_KEY_GROUPS/ICON_DEFAULTS (every
// other icon -- buttons, badges, KPI cards -- keyed by a semantic name like 'delete'). This builds
// one combined list of groups so the whole app's icons are editable from this one tab.
function iconSettingsGroups_() {
  var navRows = NAV_ITEMS.map(function (item) {
    var label = item.entityLabelFn ? item.entityLabelFn() : (item.entityLabel ? Term(item.entityLabel) : t(item.label));
    return { key: item.path, label: label, defaultIcon: item.icon };
  });
  var groups = [{ group: t('nav_group_label'), rows: navRows }];
  window.ICON_KEY_GROUPS.forEach(function (g) {
    groups.push({
      group: g.group,
      rows: g.keys.map(function (k) { return { key: k.key, label: k.label, defaultIcon: window.ICON_DEFAULTS[k.key] || '' }; })
    });
  });
  return groups;
}

function renderIconsTabBody_(content, pending, customLibraries) {
  customLibraries = customLibraries || [];
  var groupsHtml = iconSettingsGroups_().map(function (g) {
    var swatches = g.rows.map(function (r) {
      var icon = pending[r.key] || r.defaultIcon;
      return '<div class="icon-swatch" data-key="' + esc(r.key) + '" data-label="' + esc(r.label.toLowerCase()) + '" title="' + esc(r.label) + '">' + icon + '</div>';
    }).join('');
    return '<div class="icon-settings-group">' +
      '<div class="icon-settings-group-title">' + esc(g.group) + '</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;">' + swatches + '</div></div>';
  }).join('');

  content.innerHTML =
    '<div class="muted" style="font-size:12.5px;margin-bottom:10px;">' + esc(t('icons_intro')) + '</div>' +
    customLibrariesSectionHtml_(customLibraries) +
    '<input class="field-input" id="iconSearchInput" placeholder="' + esc(t('icons_search_placeholder')) + '" style="max-width:240px;margin-bottom:16px;" />' +
    groupsHtml +
    '<button class="btn btn-primary btn-sm" id="saveIconsBtn">' + t('save') + '</button>';

  wireCustomLibrariesSection_(content, customLibraries, function (updatedLibraries) {
    renderIconsTabBody_(content, pending, updatedLibraries);
  });

  content.querySelectorAll('.icon-swatch').forEach(function (el) {
    el.onclick = function () {
      var key = el.getAttribute('data-key');
      openIconPickerModal_(customLibraries, function (chosenIcon) {
        if (chosenIcon) pending[key] = chosenIcon; else delete pending[key];
        renderIconsTabBody_(content, pending, customLibraries);
      });
    };
  });

  document.getElementById('iconSearchInput').oninput = function () {
    var q = this.value.trim().toLowerCase();
    content.querySelectorAll('.icon-swatch').forEach(function (el) {
      el.style.display = (!q || el.getAttribute('data-label').indexOf(q) !== -1) ? '' : 'none';
    });
    content.querySelectorAll('.icon-settings-group').forEach(function (grp) {
      var anyVisible = Array.prototype.some.call(grp.querySelectorAll('.icon-swatch'), function (el) { return el.style.display !== 'none'; });
      grp.style.display = anyVisible ? '' : 'none';
    });
  };

  document.getElementById('saveIconsBtn').onclick = async function () {
    try {
      await Api.call('setAppIcons', { icons: pending });
      renderSidebar();
      UI.toast(t('toast_icons_saved'), 'success');
    } catch (err) { UI.error(err); }
  };
}

// Custom emoji/glyph sets a SystemAdmin has imported (see backend/Accounts.gs
// getCustomIconLibraries/addCustomIconLibrary/deleteCustomIconLibrary). Shown as their own card
// above the built-in icon groups -- purely a management list (name, icon count, preview, delete);
// the actual "use one of these icons" flow happens in openIconPickerModal_ below, which renders
// each library as an extra picker group alongside window.ICON_LIBRARY's built-in ones.
function customLibrariesSectionHtml_(libs) {
  var rows = libs.map(function (lib) {
    var preview = (lib.icons || []).slice(0, 14).map(function (ic) { return esc(ic); }).join(' ');
    return '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:10px;margin-bottom:8px;">' +
      '<div style="min-width:0;">' +
        '<div style="font-weight:600;font-size:13px;">' + esc(lib.name) + '</div>' +
        '<div class="muted" style="font-size:11px;margin:2px 0 4px;">' + esc(t('icon_count_suffix', { count: (lib.icons || []).length })) + '</div>' +
        '<div style="font-size:16px;">' + preview + '</div>' +
      '</div>' +
      '<button type="button" class="btn btn-secondary btn-sm" data-delete-lib="' + esc(lib.id) + '" style="flex:none;">' + esc(t('delete')) + '</button>' +
    '</div>';
  }).join('');

  return '<div style="margin-bottom:18px;">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">' +
      '<div class="icon-settings-group-title" style="margin:0;">' + esc(t('custom_icon_libraries_title')) + '</div>' +
      '<button type="button" class="btn btn-secondary btn-sm" id="importIconLibraryBtn">' + esc(t('import_icon_library_btn')) + '</button>' +
    '</div>' +
    (rows || '<div class="muted" style="font-size:12px;">' + esc(t('no_custom_libraries_yet')) + '</div>') +
  '</div>';
}

function wireCustomLibrariesSection_(content, customLibraries, onChange) {
  var importBtn = document.getElementById('importIconLibraryBtn');
  if (importBtn) importBtn.onclick = function () { openImportIconLibraryModal_(onChange); };

  content.querySelectorAll('[data-delete-lib]').forEach(function (el) {
    el.onclick = function () {
      var libraryId = el.getAttribute('data-delete-lib');
      UI.confirmModal(t('delete_library_confirm'), async function () {
        try {
          var updated = await Api.call('deleteCustomIconLibrary', { libraryId: libraryId });
          UI.toast(t('toast_library_deleted'), 'success');
          onChange(updated);
        } catch (err) { UI.error(err); }
      });
    };
  });
}

// Free-text name + a textarea of space/comma/newline-separated glyphs -- deliberately simple (no
// file upload) since pasting a run of emoji/characters is the realistic path here, matching the
// existing free-text "paste your own icon" input already in openIconPickerModal_ below.
function openImportIconLibraryModal_(onDone) {
  var body =
    '<div class="muted" style="font-size:12px;margin-bottom:12px;">' + esc(t('import_icon_library_intro')) + '</div>' +
    UI.field(t('field_library_name'), '<input class="field-input" id="newLibNameInput" maxlength="60" />') +
    '<div style="margin-top:10px;">' +
      UI.field(t('field_library_icons'), '<textarea class="field-input" id="newLibIconsInput" rows="4" placeholder="' + esc(t('library_icons_placeholder')) + '"></textarea>') +
      '<div class="muted" style="font-size:11px;margin-top:4px;">' + esc(t('library_icons_hint')) + '</div>' +
    '</div>';

  UI.openModal(t('import_icon_library_modal_title'), body, [
    { label: t('import_btn'), className: 'btn-primary', onClick: submitImport },
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal }
  ]);

  async function submitImport() {
    var name = document.getElementById('newLibNameInput').value.trim();
    var raw = document.getElementById('newLibIconsInput').value;
    var icons = raw.split(/[\s,]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (!name) { UI.toast(t('toast_library_name_required'), 'error'); return; }
    if (!icons.length) { UI.toast(t('toast_library_icons_required'), 'error'); return; }
    try {
      var updated = await Api.call('addCustomIconLibrary', { name: name, icons: icons });
      UI.closeModal();
      UI.toast(t('toast_library_imported'), 'success');
      onDone(updated);
    } catch (err) { UI.error(err); }
  }
}

// processRoleFieldHtml_ renders one role-checkbox-grid field (title + subtitle + scrollable list of
// role checkboxes) -- used by the Escalations tab below for its To/Cc pickers. It used to also back
// a dedicated Process tab (who can upload/submit vs. review/evaluate a readiness document); that pair
// is now just 'template.upload'/'template.review' in PERMISSION_REGISTRY_ (Permissions.gs), edited as
// chips on the Templates row of the Permissions matrix instead of its own tab -- see
// templateUploaderRoles_/templateReviewerRoles_ (Templates.gs).
function processRoleFieldHtml_(title, subtitle, allRoles, checkedRoles, prefix) {
  var checkedSet = {}; (checkedRoles || []).forEach(function (r) { checkedSet[r] = true; });
  return '<div>' +
    '<div style="font-weight:600;font-size:13.5px;margin-bottom:2px;">' + title + '</div>' +
    '<div class="muted" style="font-size:11.5px;margin-bottom:8px;">' + esc(subtitle) + '</div>' +
    '<div style="max-height:220px;overflow:auto;border:1px solid var(--border);border-radius:var(--radius-sm);padding:6px 10px;">' +
      allRoles.map(function (r) {
        return '<label style="display:flex;align-items:center;gap:6px;font-size:13px;padding:3px 0;">' +
          '<input type="checkbox" class="' + prefix + '-check" value="' + esc(r.value) + '"' + (checkedSet[r.value] ? ' checked' : '') + ' /> ' + esc(r.label) + '</label>';
      }).join('') +
    '</div>' +
  '</div>';
}

// readCheckedRoles_ builds a CSS class selector out of whatever prefix it's given ('.' + prefix +
// '-check') -- shared by every role-chip/checkbox-grid editor in Settings (Escalations below, and the
// Permissions/Roles editors above, which slug their own dotted keys first -- see permKeySlug_ -- for
// exactly this reason).
function readCheckedRoles_(prefix) {
  var ids = [];
  document.querySelectorAll('.' + prefix + '-check:checked').forEach(function (c) { ids.push(c.value); });
  return ids;
}

/* ---------------- Escalations (timers, To/Cc roles, lock-screen toggle) ----------------
 * Moved here from the old standalone Config page -- see the CONFIG_MANAGE_ROLES comment above.
 * getEscalationConfig (Resolutions.gs) returns tier1/tier2/tier3 + lockScreenEnabled + allRoles (the
 * picklist) + riskLevels. Tier 1 has no delay editor here on purpose -- each Finding already carries
 * its own deadline from its checklist item, so only Tier 2 and Tier 3's delays (which fire a
 * configurable time AFTER the previous tier) are admin-editable, and per risk level.
 */
async function renderEscalationsTab_(content) {
  var cfg = await Api.call('getEscalationConfig', {});
  content.innerHTML =
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + esc(t('escalation_alerts_title')) + '</div>' +
    '<div class="muted" style="font-size:11.5px;">' + esc(t('escalation_alerts_subtitle')) + '</div></div>' +
    '<div class="card-body">' +
      '<label style="display:flex;align-items:center;gap:8px;font-size:13.5px;cursor:pointer;">' +
        '<input type="checkbox" id="cfgLockScreenEnabled"' + (cfg.lockScreenEnabled ? ' checked' : '') + ' /> ' + esc(t('lock_screen_label')) +
      '</label>' +
      '<div class="muted" style="font-size:11px;margin-top:6px;">' + esc(t('lock_screen_hint')) + '</div>' +
    '</div></div>' +
    // REQ follow-up: "resolution of tier timing, not true real-time" -- the sweep that actually
    // checks whether a delay has elapsed used to run every 30 minutes no matter how short a delay
    // was configured below; now editable here too (escalationCheckIntervalMinutes_/
    // reinstallEscalationTrigger_, Setup.gs). Only the 5 values ScriptApp's ClockTriggerBuilder
    // actually accepts are offered -- anything else would just get silently snapped server-side.
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + esc(t('check_interval_title')) + '</div>' +
    '<div class="muted" style="font-size:11.5px;">' + esc(t('check_interval_subtitle')) + '</div></div>' +
    '<div class="card-body">' +
      UI.field(t('check_interval_field'), '<select id="cfgCheckIntervalMinutes" class="field-input" style="max-width:200px;">' +
        (cfg.checkIntervalAllowedMinutes || [1, 5, 10, 15, 30]).map(function (m) {
          return '<option value="' + m + '"' + (m === cfg.checkIntervalMinutes ? ' selected' : '') + '>' + esc(t('x_minutes', { count: m })) + '</option>';
        }).join('') + '</select>') +
    '</div></div>' +
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + esc(t('tier1_title')) + '</div>' +
    '<div class="muted" style="font-size:11.5px;">' + esc(t('tier1_subtitle')) + '</div></div>' +
    '<div class="card-body" style="display:flex;flex-direction:column;gap:20px;max-width:640px;">' +
      processRoleFieldHtml_(esc(t('field_to')), t('field_to_hint'), cfg.allRoles, cfg.tier1.toRoles, 'cfgTier1To') +
      processRoleFieldHtml_(esc(t('field_cc')), t('field_cc_hint'), cfg.allRoles, cfg.tier1.ccRoles, 'cfgTier1Cc') +
    '</div></div>' +
    escalationTierCardHtml_(t('tier2_title'), t('tier2_subtitle'), 2, cfg) +
    escalationTierCardHtml_(t('tier3_title'), t('tier3_subtitle'), 3, cfg) +
    '<div style="display:flex;justify-content:flex-end;gap:8px;padding:14px 20px;">' +
      '<button class="btn btn-primary" id="saveEscalationCfgBtn">' + t('save') + '</button>' +
    '</div>';

  document.getElementById('saveEscalationCfgBtn').onclick = async function () {
    try {
      var tier1ToRoles = readCheckedRoles_('cfgTier1To');
      var tier2ToRoles = readCheckedRoles_('cfgTier2To');
      var tier3ToRoles = readCheckedRoles_('cfgTier3To');
      if (!tier1ToRoles.length || !tier2ToRoles.length || !tier3ToRoles.length) {
        UI.toast(t('toast_each_tier_needs_to_role'), 'error');
        return;
      }
      await Api.call('setEscalationConfig', {
        tier1: { toRoles: tier1ToRoles, ccRoles: readCheckedRoles_('cfgTier1Cc') },
        tier2: { toRoles: tier2ToRoles, ccRoles: readCheckedRoles_('cfgTier2Cc'), delayMinutesByRisk: escalationReadDelayMinutesByRisk_('cfgTier2', cfg.riskLevels) },
        tier3: { toRoles: tier3ToRoles, ccRoles: readCheckedRoles_('cfgTier3Cc'), delayMinutesByRisk: escalationReadDelayMinutesByRisk_('cfgTier3', cfg.riskLevels) },
        lockScreenEnabled: document.getElementById('cfgLockScreenEnabled').checked,
        checkIntervalMinutes: Number(document.getElementById('cfgCheckIntervalMinutes').value)
      });
      UI.toast(t('toast_escalation_settings_saved'), 'success');
      renderSettings({ tab: 'escalations' });
    } catch (err) { UI.error(err); }
  };
}

function escalationTierCardHtml_(title, subtitle, tierNum, cfg) {
  var tierCfg = cfg['tier' + tierNum];
  var prefix = 'cfgTier' + tierNum;
  return '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + esc(title) + '</div>' +
    '<div class="muted" style="font-size:11.5px;">' + esc(subtitle) + '</div></div>' +
    '<div class="card-body" style="display:flex;flex-direction:column;gap:20px;max-width:640px;">' +
      processRoleFieldHtml_(esc(t('field_to')), t('field_to_hint'), cfg.allRoles, tierCfg.toRoles, prefix + 'To') +
      processRoleFieldHtml_(esc(t('field_cc')), t('field_cc_hint'), cfg.allRoles, tierCfg.ccRoles, prefix + 'Cc') +
      '<div><div class="field-label" style="margin-top:0;">' + esc(t('delay_by_risk_level')) + '</div>' +
        escalationDelayRowsHtml_(prefix, tierCfg.delayMinutesByRisk, cfg.riskLevels) +
      '</div>' +
    '</div></div>';
}

function escalationDelayRowsHtml_(prefix, delayMinutesByRisk, riskLevels) {
  return '<table class="data-table" style="margin-top:8px;"><thead><tr><th>' + esc(t('col_risk_level')) + '</th><th>' + esc(t('col_hours')) + '</th><th>' + esc(t('col_minutes')) + '</th></tr></thead><tbody>' +
    riskLevels.map(function (level) {
      var total = Number(delayMinutesByRisk[level]) || 0;
      var hours = Math.floor(total / 60), minutes = total % 60;
      return '<tr><td>' + esc(level) + '</td>' +
        '<td><input type="number" min="0" class="field-input ' + prefix + '-delay-hours" data-level="' + esc(level) + '" value="' + hours + '" style="width:90px;" /></td>' +
        '<td><input type="number" min="0" max="59" class="field-input ' + prefix + '-delay-minutes" data-level="' + esc(level) + '" value="' + minutes + '" style="width:90px;" /></td></tr>';
    }).join('') +
  '</tbody></table>';
}

function escalationReadDelayMinutesByRisk_(prefix, riskLevels) {
  var out = {};
  riskLevels.forEach(function (level) {
    var hEl = document.querySelector('.' + prefix + '-delay-hours[data-level="' + level + '"]');
    var mEl = document.querySelector('.' + prefix + '-delay-minutes[data-level="' + level + '"]');
    var hours = Number(hEl ? hEl.value : 0) || 0;
    var minutes = Number(mEl ? mEl.value : 0) || 0;
    out[level] = Math.max(1, hours * 60 + minutes);
  });
  return out;
}

/* ---------------- Roles (RBAC, "create a new role") ----------------
 * REQ: "I need to have the functionality to create a new role." SystemAdmin-only, same gating as
 * Permissions. A custom role is just a role CODE (Roles.gs, backend) -- once created it's usable
 * anywhere a built-in role is: the Users & Roles account-creation form offers it to whichever actors
 * its `creatableBy` list names (users.js), and it shows up as its own column in the Settings >
 * Permissions CRUD matrix below to actually grant it access to anything. This tab only manages the
 * role's identity (name, org tie, who can create accounts under it) -- fine-grained page/action
 * access is deliberately left to the Permissions tab rather than duplicated here.
 */
async function renderRolesTab_(content) {
  content.innerHTML = '<div class="empty-state">' + t('loading') + '</div>';
  // listPermissions (SystemAdmin-only, same as this tab) already computes the full built-in+custom
  // role picklist (allRolePicklist_, backend/Roles.gs) -- reused here rather than standing up a
  // second endpoint just to hand back the same list.
  var permData = await Api.call('listPermissions', {});
  var customRoles = await Api.call('listCustomRoles', {});
  renderRolesTabBody_(content, permData.allRoles, customRoles);
}

function renderRolesTabBody_(content, allRoles, customRoles) {
  var rows = customRoles.length
    ? customRoles.map(function (r) { return roleRowHtml_(r, allRoles); }).join('')
    : '<div class="empty-state">' + esc(t('no_custom_roles_yet')) + '</div>';

  content.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px;">' +
      '<div class="muted" style="font-size:12.5px;max-width:520px;">' + esc(t('roles_tab_intro')) + '</div>' +
      '<button type="button" class="btn btn-primary btn-sm" id="newRoleBtn" style="flex:none;">' + esc(t('new_role_btn')) + '</button>' +
    '</div>' +
    rows;

  document.getElementById('newRoleBtn').onclick = function () { openNewRoleModal_(allRoles); };
  content.querySelectorAll('[data-edit-role]').forEach(function (btn) {
    btn.onclick = function () {
      var role = customRoles.filter(function (r) { return r.code === btn.getAttribute('data-edit-role'); })[0];
      if (role) openEditRoleModal_(role, allRoles);
    };
  });
  content.querySelectorAll('[data-delete-role]').forEach(function (btn) {
    btn.onclick = function () {
      var code = btn.getAttribute('data-delete-role');
      UI.confirmModal(t('delete_role_confirm'), async function () {
        try {
          await Api.call('deleteRole', { code: code });
          UI.toast(t('toast_role_deleted'), 'success');
          renderSettings({ tab: 'roles' });
        } catch (err) { UI.error(err); }
      });
    };
  });
}

function roleOrgTypeLabel_(orgType) {
  return orgType === 'GA' ? t('org_type_ga') : orgType === 'EMC' ? t('org_type_emc') : orgType === 'INSPECTION' ? t('org_type_inspection') : t('org_type_none');
}

function roleRowHtml_(role, allRoles) {
  var creatableLabels = (role.creatableBy || []).map(function (code) { return roleLabelFromAllRoles_(allRoles, code); });
  return '<div class="perm-row">' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">' +
      '<div>' +
        '<div style="font-weight:700;font-size:13.5px;">' + esc(role.label) + '</div>' +
        '<div class="muted" style="font-size:11px;margin-top:2px;">' + esc(role.code) + ' · ' + esc(roleOrgTypeLabel_(role.orgType)) + '</div>' +
        '<div class="muted" style="font-size:11px;margin-top:6px;">' + esc(t('creatable_by_label')) + ': ' +
          (creatableLabels.length ? esc(creatableLabels.join(', ')) : esc(t('nobody_yet'))) + '</div>' +
      '</div>' +
      '<div style="display:flex;gap:6px;flex:none;">' +
        '<button type="button" class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('edit_title')) + '" data-edit-role="' + esc(role.code) + '">' + ICON('edit') + '</button>' +
        '<button type="button" class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('delete')) + '" data-delete-role="' + esc(role.code) + '">' + ICON('delete') + '</button>' +
      '</div>' +
    '</div>' +
  '</div>';
}

function roleOrgTypeSelectHtml_(id, selected) {
  return '<select id="' + id + '" class="field-input">' +
    ['', 'GA', 'EMC', 'INSPECTION'].map(function (v) {
      return '<option value="' + v + '"' + (v === selected ? ' selected' : '') + '>' + esc(roleOrgTypeLabel_(v)) + '</option>';
    }).join('') +
  '</select>';
}

// Role-chip checkboxes reused from the Permissions role editor (.perm-role-chip, styles.css) --
// same visually-hidden-checkbox-in-a-label pattern, so the same click-to-toggle wiring applies.
function roleCreatableByChipsHtml_(prefix, allRoles, checkedCodes) {
  var checkedSet = {}; (checkedCodes || []).forEach(function (c) { checkedSet[c] = true; });
  return '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">' +
    allRoles.map(function (r) {
      var checked = !!checkedSet[r.value];
      return '<label class="perm-role-chip' + (checked ? ' active' : '') + '">' +
        '<input type="checkbox" class="' + prefix + '-check" value="' + esc(r.value) + '"' + (checked ? ' checked' : '') + ' />' +
        '<span>' + esc(r.label) + '</span></label>';
    }).join('') +
  '</div>';
}
function wireRoleChipToggles_() {
  document.querySelectorAll('#modalRoot .perm-role-chip input').forEach(function (cb) {
    cb.onchange = function () { cb.closest('.perm-role-chip').classList.toggle('active', cb.checked); };
  });
}

function openNewRoleModal_(allRoles) {
  var body =
    UI.field(t('field_role_name'), '<input id="fRoleLabel" class="field-input" maxlength="60" />') +
    UI.field(t('field_org_type'), roleOrgTypeSelectHtml_('fRoleOrgType', '')) +
    UI.field(t('field_based_on_role'), '<select id="fRoleBasedOn" class="field-input">' +
      '<option value="">' + esc(t('start_blank_option')) + '</option>' +
      allRoles.map(function (r) { return '<option value="' + esc(r.value) + '">' + esc(r.label) + '</option>'; }).join('') +
    '</select>') +
    '<div class="muted" style="font-size:11px;margin:4px 0 12px;">' + esc(t('based_on_role_hint')) + '</div>' +
    '<div class="field-label">' + esc(t('creatable_by_label')) + '</div>' +
    roleCreatableByChipsHtml_('new-role-creatable', allRoles, []);

  UI.openModal(t('new_role_title'), body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('create'), className: 'btn-primary', onClick: async function () {
        var label = document.getElementById('fRoleLabel').value.trim();
        if (!label) { UI.toast(t('field_role_name'), 'error'); return; }
        try {
          await Api.call('createRole', {
            label: label, orgType: document.getElementById('fRoleOrgType').value,
            basedOnRole: document.getElementById('fRoleBasedOn').value,
            creatableBy: readCheckedRoles_('new-role-creatable')
          });
          UI.closeModal();
          UI.toast(t('toast_role_created'), 'success');
          renderSettings({ tab: 'roles' });
        } catch (err) { UI.error(err); }
      } }
  ]);
  wireRoleChipToggles_();
}

function openEditRoleModal_(role, allRoles) {
  var body =
    '<div class="muted" style="font-size:11px;margin-bottom:10px;">' + esc(role.code) + '</div>' +
    UI.field(t('field_role_name'), '<input id="fERoleLabel" class="field-input" maxlength="60" value="' + esc(role.label) + '" />') +
    UI.field(t('field_org_type'), roleOrgTypeSelectHtml_('fERoleOrgType', role.orgType || '')) +
    '<div class="field-label">' + esc(t('creatable_by_label')) + '</div>' +
    roleCreatableByChipsHtml_('edit-role-creatable', allRoles, role.creatableBy);

  UI.openModal(t('edit_role_title') + ' — ' + esc(role.label), body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('save'), className: 'btn-primary', onClick: async function () {
        var label = document.getElementById('fERoleLabel').value.trim();
        if (!label) { UI.toast(t('field_role_name'), 'error'); return; }
        try {
          await Api.call('updateRole', {
            code: role.code, label: label, orgType: document.getElementById('fERoleOrgType').value,
            creatableBy: readCheckedRoles_('edit-role-creatable')
          });
          UI.closeModal();
          UI.toast(t('toast_role_updated'), 'success');
          renderSettings({ tab: 'roles' });
        } catch (err) { UI.error(err); }
      } }
  ]);
  wireRoleChipToggles_();
}

/* ---------------- Permissions (RBAC, "admin-configurable permissions") ----------------
 * REQ: "It is time we build Role-Based Access Control" -> clarified as: a SystemAdmin should be able
 * to change WHICH ROLES can do WHAT without a code deploy. listPermissions/updatePermission/
 * resetPermission (backend/Permissions.gs) are SystemAdmin-only; allRoles rides along in the same
 * response, same "server hands back its own picklist" convention as getEscalationConfig
 * (Resolutions.gs) -- see processRoleFieldHtml_/readCheckedRoles_ above (Escalations tab) for the
 * checkbox-grid pattern the role editor below still reuses.
 *
 * REQ follow-up: "control who has Create, Read, Update and Delete for sections or Pages or tabs" ->
 * clarified as: redesign this tab as a Page x CRUD matrix built on TOP OF the existing ~45 permission
 * keys (each already tagged with a `page` and a `crud` array in PERMISSION_REGISTRY_, backend/
 * Permissions.gs) -- NOT independent Read/visibility control (page/tab NAV access stays hardcoded in
 * NAV_ITEMS/EVENT_TABS, unchanged) and not a backend split of the combined "manage" keys into 4
 * separate ones (several keys legitimately cover Create+Update+Delete together as one action; the
 * matrix shows that honestly by repeating the same chip in every column it applies to, rather than
 * pretending those actions are independently controllable when they aren't).
 */
// Every row the matrix can show, in a fixed reading order (roughly: Events workspace top-to-bottom,
// then standalone admin pages). `eventTab` = a tab key inside EVENT_TABS (eventDetail.js) -- the
// "go to page" link stashes it and sends the admin to Events, same highlight-on-open mechanism the
// old per-module link used. `navPath` = a real top-level route the link can jump to directly. Every
// id here must match a `page` value used in backend/Permissions.gs (PERMISSION_REGISTRY_) or that
// row will just never gain any chips -- there's no other link between the two lists.
function permissionPages_() {
  return [
    { id: 'events', label: Term('event_plural'), navPath: '/events' },
    { id: 'subEvents', label: Term('subEvent_plural'), navPath: '/sub-events' },
    // REQ follow-up: "Move Venue & Zones to venue sidebar page" removed the Event workspace's own
    // 'venue' tab entirely -- its permissionPages_ entry ('venueTab') is gone with it; every
    // permission that used to point there (just event.assignManager, Permissions.gs) now points at
    // 'reassignment' below instead, since that was always its real UI home.
    { id: 'venues', label: Term('venue_plural'), navPath: '/venues' },
    { id: 'templates', label: t('tab_templates'), eventTab: 'templates' },
    { id: 'templateLibrary', label: t('template_library_title', { term: Term('template_plural') }), navPath: '/template-library' },
    { id: 'approval', label: t('tab_approval'), eventTab: 'approval' },
    { id: 'disciplinesTab', label: t('tab_disciplines'), eventTab: 'disciplines' },
    { id: 'disciplinesCatalog', label: Term('discipline_plural'), navPath: '/disciplines' },
    { id: 'inspectorQualifications', label: t('qualifications_page_title', { term: Term('inspector_plural') }), navPath: '/inspector-qualifications' },
    { id: 'inspectionsTab', label: t('tab_inspections'), eventTab: 'inspections' },
    { id: 'completedChecklists', label: t('tab_completed_checklists'), navPath: '/completed-checklists' },
    { id: 'checklistItems', label: Term('checklistItem_plural'), navPath: '/checklist-items' },
    { id: 'findings', label: t('tab_findings'), eventTab: 'findings' },
    { id: 'escalations', label: Term('escalation_plural'), eventTab: 'escalations' },
    { id: 'participants', label: Term('participant_plural'), eventTab: 'participants' },
    { id: 'participantDisciplines', label: Term('participant') + '’s ' + Term('discipline'), eventTab: 'participantDisciplines' },
    { id: 'reports', label: Term('report_plural'), eventTab: 'reports' },
    { id: 'meetings', label: Term('meeting_plural'), navPath: '/meetings' },
    { id: 'projects', label: Term('project_plural'), navPath: '/projects' },
    { id: 'reassignment', label: t('nav_reassignment'), navPath: '/reassignment' },
    { id: 'notifications', label: t('nav_notifications'), navPath: '/notifications' },
    { id: 'accounts', label: t('nav_users'), navPath: '/users' },
    { id: 'organizations', label: t('nav_orgs'), navPath: '/organizations' },
    { id: 'auditLog', label: t('nav_audit_log'), navPath: '/audit-log' },
    { id: 'settings', label: t('nav_settings'), navPath: '/settings' },
    { id: 'support', label: t('nav_support'), navPath: '/support' }
  ];
}

var PERM_CRUD_COLUMNS_ = ['create', 'read', 'update', 'delete'];

// Reverse lookups over permissionPages_ -- used by app.js's navItemVisible_ (a NAV_ITEMS path -> its
// permission page id, if any) so nav visibility can be derived from HululState.pageAccess instead of
// only the hardcoded `roles` arrays. Not cached: permissionPages_() itself is cheap (26 short array
// literals, a handful of t()/Term() calls) and re-deriving it keeps this from ever drifting out of
// sync with a language switch or terminology change.
// EVENT_TABS (eventDetail.js) has no equivalent per-tab `roles` gate today (every tab is visible to
// any signed-in event viewer; access is enforced inside each tab's own actions/API calls instead --
// see the `visibleFn` note at the top of eventDetail.js), so there's no pageIdForEventTab_ counterpart
// wired up here yet -- add one the same way if that ever changes.
function pageIdForNavPath_(navPath) {
  var match = permissionPages_().filter(function (p) { return p.navPath === navPath; })[0];
  return match ? match.id : null;
}

async function renderPermissionsTab_(content) {
  content.innerHTML = '<div class="empty-state">' + t('loading') + '</div>';
  var data = await Api.call('listPermissions', {});
  renderPermissionsTabBody_(content, data, '');
}

// activeRole ('' = "All") is threaded through every re-render (including the ones triggered by a
// modal Save/Reset below) so picking a filter and then editing a chip doesn't silently reset it.
function renderPermissionsTabBody_(content, data, activeRole) {
  activeRole = activeRole || '';

  var roleCounts = {};
  data.allRoles.forEach(function (r) { roleCounts[r.value] = 0; });
  data.permissions.forEach(function (perm) {
    perm.roles.forEach(function (r) { if (roleCounts[r] !== undefined) roleCounts[r]++; });
  });
  var roleFilterHtml =
    permFilterItemHtml_('role', '', t('all_roles'), data.permissions.length, activeRole === '') +
    data.allRoles.map(function (r) { return permFilterItemHtml_('role', r.value, r.label, roleCounts[r.value], activeRole === r.value); }).join('');

  // Bucket every permission key under its page, once per CRUD letter it covers -- a "manage" key
  // with crud:['create','update','delete'] ends up in all three of those buckets for its page, which
  // is exactly the "shown honestly in every column it applies to" behavior described above.
  var byPage = {};
  data.permissions.forEach(function (perm) {
    if (!perm.page) return;
    if (!byPage[perm.page]) byPage[perm.page] = { create: [], read: [], update: [], delete: [] };
    (perm.crud || []).forEach(function (c) { if (byPage[perm.page][c]) byPage[perm.page][c].push(perm); });
  });

  var rowsHtml = permissionPages_().map(function (page) {
    var bucket = byPage[page.id] || { create: [], read: [], update: [], delete: [] };
    var gotoLink = page.eventTab
      ? '<a href="#" class="perm-matrix-goto-link" data-goto-tab="' + esc(page.eventTab) + '">' + esc(t('go_to_page_link')) + '</a>'
      : (page.navPath ? '<a href="#' + esc(page.navPath) + '" class="perm-matrix-goto-link">' + esc(t('go_to_page_link')) + '</a>' : '');

    var cellsHtml = PERM_CRUD_COLUMNS_.map(function (crud) {
      var perms = bucket[crud].filter(function (perm) { return !activeRole || perm.roles.indexOf(activeRole) !== -1; });
      if (!perms.length) return '<td class="perm-matrix-crud-cell"><span class="perm-cell-empty">—</span></td>';
      var chips = perms.map(function (perm) {
        var shared = (perm.crud || []).length > 1;
        return '<button type="button" class="perm-cell-chip' + (perm.isOverridden ? ' perm-cell-chip-overridden' : '') +
          (shared ? ' perm-cell-chip-shared' : '') + '" data-perm-cell-key="' + esc(perm.key) +
          '" title="' + esc(shared ? t('permission_shared_hint') : perm.label) + '">' +
          esc(t('x_roles_count', { count: perm.roles.length })) + '</button>';
      }).join('');
      return '<td class="perm-matrix-crud-cell">' + chips + '</td>';
    }).join('');

    return '<tr>' +
      '<td class="perm-matrix-page-cell"><div class="perm-matrix-page-name">' + esc(page.label) + '</div>' +
      (gotoLink ? '<div>' + gotoLink + '</div>' : '') + '</td>' +
      cellsHtml +
      '</tr>';
  }).join('');

  content.innerHTML =
    '<div class="muted" style="font-size:12.5px;margin-bottom:16px;">' + esc(t('permissions_matrix_intro')) + '</div>' +
    '<div class="perm-filter-group" style="margin-bottom:16px;">' +
      '<div class="perm-filter-title">' + esc(t('roles_label')) + '</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:4px;">' + roleFilterHtml + '</div>' +
    '</div>' +
    '<div class="perm-matrix-wrap"><table class="perm-matrix"><thead><tr>' +
      '<th>' + esc(t('col_page')) + '</th>' +
      '<th class="perm-matrix-crud-col">' + esc(t('crud_create')) + '</th>' +
      '<th class="perm-matrix-crud-col">' + esc(t('crud_read')) + '</th>' +
      '<th class="perm-matrix-crud-col">' + esc(t('crud_update')) + '</th>' +
      '<th class="perm-matrix-crud-col">' + esc(t('crud_delete')) + '</th>' +
      '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>';

  content.querySelectorAll('[data-filter-role]').forEach(function (el) {
    el.onclick = function () { renderPermissionsTabBody_(content, data, el.getAttribute('data-filter-role')); };
  });

  // "Go to page" link -- eventTab rows stash which tab to flash, then hand off to the Events list;
  // see PENDING_TAB_HIGHLIGHT_KEY_/renderEventDetail (eventDetail.js) for the highlight itself, which
  // fires the moment any event is actually opened. navPath rows are a plain hash link, no JS needed.
  content.querySelectorAll('[data-goto-tab]').forEach(function (link) {
    link.onclick = function (e) {
      e.preventDefault();
      sessionStorage.setItem(PENDING_TAB_HIGHLIGHT_KEY_, link.getAttribute('data-goto-tab'));
      UI.toast(t('toast_open_any_event_hint', { term: Term('event').toLowerCase() }), 'success');
      window.location.hash = '#/events';
    };
  });

  content.querySelectorAll('[data-perm-cell-key]').forEach(function (chip) {
    chip.onclick = function () {
      var key = chip.getAttribute('data-perm-cell-key');
      var perm = data.permissions.filter(function (p) { return p.key === key; })[0];
      if (perm) openPermissionEditorModal_(perm, data.allRoles, content, data, activeRole);
    };
  });
}

function permFilterItemHtml_(kind, value, label, count, active) {
  return '<div class="perm-filter-item' + (active ? ' active' : '') + '" data-filter-' + kind + '="' + esc(value) + '" style="display:inline-flex;">' +
    '<span>' + esc(label) + '</span><span class="perm-filter-count" style="margin-inline-start:6px;">' + count + '</span></div>';
}

// readCheckedRoles_ (Escalations tab above) builds a CSS class selector out of whatever prefix it's
// given ('.' + prefix + '-check') -- fine for that tab's own prefixes (cfgTier1To, cfgTier2Cc, no
// punctuation), but permission keys are dotted (e.g. 'finding.create') and an unescaped '.' inside a
// CSS class selector starts a NEW class, so the literal class "perm-finding.create-check" would never
// match ".perm-finding.create-check:checked". Slugging the dot out of the key before it ever becomes
// part of a class name (both when the checkboxes are rendered below and when they're read back on
// Save) keeps the class name a single valid selector.
function permKeySlug_(key) { return String(key).replace(/\./g, '-'); }

// A chip's modal: same role-chip editor the old flat list used inline, now opened on demand from a
// matrix cell via UI.openModal instead of always being on screen. Save/Reset live in the modal's own
// footer (UI.openModal's buttons param) since the delegated listeners on `content` above don't reach
// into #modalRoot.
function openPermissionEditorModal_(perm, allRoles, content, data, activeRole) {
  var checkedSet = {}; perm.roles.forEach(function (r) { checkedSet[r] = true; });
  var prefix = 'perm-' + permKeySlug_(perm.key);
  var body =
    '<div style="font-size:12.5px;line-height:1.5;margin-bottom:6px;">' + esc(perm.label) + '</div>' +
    ((perm.crud || []).length > 1
      ? '<div class="muted" style="font-size:11px;margin-bottom:12px;">' + esc(t('permission_shared_hint')) + '</div>' : '') +
    (perm.isOverridden
      ? '<div class="muted" style="font-size:10.5px;margin-bottom:10px;">' + esc(t('customized_default_is', { roles: perm.defaultRoles.map(roleLabelFromAllRoles_.bind(null, allRoles)).join(', ') })) + '</div>'
      : '') +
    '<div style="display:flex;flex-wrap:wrap;gap:6px;">' +
      allRoles.map(function (r) {
        var checked = !!checkedSet[r.value];
        return '<label class="perm-role-chip' + (checked ? ' active' : '') + '">' +
          '<input type="checkbox" class="' + prefix + '-check" value="' + esc(r.value) + '"' + (checked ? ' checked' : '') + ' />' +
          '<span>' + esc(r.label) + '</span></label>';
      }).join('') +
    '</div>';

  var footerButtons = [];
  if (perm.isOverridden) {
    footerButtons.push({ label: t('reset_to_default'), className: 'btn-secondary', onClick: async function () {
      try {
        await Api.call('resetPermission', { key: perm.key });
        UI.closeModal(); UI.toast(t('toast_reverted_default'), 'success');
        await loadPermissions_force_();
        var refreshed = await Api.call('listPermissions', {});
        renderPermissionsTabBody_(content, refreshed, activeRole);
      } catch (err) { UI.error(err); }
    } });
  }
  footerButtons.push({ label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal });
  footerButtons.push({ label: t('save'), className: 'btn-primary', onClick: async function () {
    var roles = readCheckedRoles_(prefix);
    if (!roles.length) { UI.toast(t('toast_at_least_one_role'), 'error'); return; }
    try {
      await Api.call('updatePermission', { key: perm.key, roles: roles });
      UI.closeModal(); UI.toast(t('toast_permission_saved'), 'success');
      await loadPermissions_force_();
      var refreshed = await Api.call('listPermissions', {});
      renderPermissionsTabBody_(content, refreshed, activeRole);
    } catch (err) { UI.error(err); }
  } });

  UI.openModal(perm.label, body, footerButtons);
  // Role chips are real (visually-hidden) checkboxes wrapped in a <label> -- clicking the chip
  // toggles the checkbox natively, this just keeps the chip's own "active" look in sync with it.
  document.querySelectorAll('#modalRoot .perm-role-chip input').forEach(function (cb) {
    cb.onchange = function () { cb.closest('.perm-role-chip').classList.toggle('active', cb.checked); };
  });
}

function roleLabelFromAllRoles_(allRoles, roleValue) {
  var match = allRoles.filter(function (r) { return r.value === roleValue; })[0];
  return match ? match.label : roleValue;
}

// updatePermission/resetPermission only affect the backend's stored overrides -- the acting
// SystemAdmin's own HululState.permissions (cached once per session, see loadPermissions in app.js)
// needs an explicit refetch so the effect of their own change (e.g. removing SystemAdmin from
// finding.create) is reflected in their own UI immediately rather than on next login.
async function loadPermissions_force_() {
  HululState.permissionsLoaded = false;
  await loadPermissions();
}

// A grid of every icon in ICON_LIBRARY (icons.js), grouped by section, PLUS a free-text field so a
// SystemAdmin isn't limited to the curated palette -- any emoji/character can be typed or pasted in
// and used directly. onPick receives the chosen icon string, or '' to reset that key back to its
// built-in default.
function openIconPickerModal_(customLibraries, onPick) {
  customLibraries = customLibraries || [];
  var body = '<div class="muted" style="font-size:12px;margin-bottom:10px;">' + esc(t('choose_icon_intro')) + '</div>' +
    '<div style="display:flex;gap:8px;margin-bottom:16px;">' +
      '<input class="field-input" id="customIconInput" placeholder="' + esc(t('custom_icon_placeholder')) + '" style="flex:1;" maxlength="8" />' +
      '<button type="button" class="btn btn-secondary btn-sm" id="customIconUseBtn">' + esc(t('use_btn')) + '</button>' +
    '</div>' +
    // Built-in palette (icons.js) is Lucide SVGs now, not raw characters -- each entry carries its
    // own Lucide name (for a title tooltip and for the click handler's LUCIDE_ICONS lookup below)
    // plus the already-resolved svg markup to render directly in the grid.
    window.ICON_LIBRARY.map(function (group) {
      return '<div style="margin-bottom:10px;">' +
        '<div style="font-size:11px;font-weight:700;color:var(--text-600);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px;">' + esc(group.section) + '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(8,1fr);gap:6px;">' +
        group.icons.map(function (ic) {
          return '<div class="icon-pick-opt" data-icon-name="' + esc(ic.name) + '" title="' + esc(ic.label) + '" style="cursor:pointer;text-align:center;padding:8px 0;border-radius:8px;border:1px solid var(--border);font-size:18px;">' + ic.svg + '</div>';
        }).join('') +
        '</div></div>';
    }).join('') +
    // SystemAdmin-imported custom emoji/glyph sets (Settings > Icons > Import Icon Library) --
    // rendered as extra groups after the built-in ICON_LIBRARY ones, same swatch-grid markup so
    // clicking one is indistinguishable from picking a built-in icon.
    customLibraries.map(function (lib) {
      return '<div style="margin-bottom:10px;">' +
        '<div style="font-size:11px;font-weight:700;color:var(--text-600);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px;">' + esc(lib.name) + '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(8,1fr);gap:6px;">' +
        (lib.icons || []).map(function (ic) {
          return '<div class="icon-pick-opt" data-icon="' + esc(ic) + '" style="cursor:pointer;text-align:center;padding:8px 0;border-radius:8px;border:1px solid var(--border);font-size:18px;">' + ic + '</div>';
        }).join('') +
        '</div></div>';
    }).join('');

  UI.openModal(t('choose_icon_modal_title'), body, [
    { label: t('reset_to_default'), className: 'btn-secondary', onClick: function () { UI.closeModal(); onPick(''); } },
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal }
  ]);

  function useCustomIcon() {
    var val = document.getElementById('customIconInput').value.trim();
    if (!val) { UI.toast(t('toast_type_icon_first'), 'error'); return; }
    UI.closeModal();
    onPick(val);
  }
  document.getElementById('customIconUseBtn').onclick = useCustomIcon;
  document.getElementById('customIconInput').onkeydown = function (e) {
    if (e.key === 'Enter') { e.preventDefault(); useCustomIcon(); }
  };

  document.querySelectorAll('.icon-pick-opt').forEach(function (el) {
    el.onclick = function () {
      // Built-in Lucide options store just their name (data-icon-name) and resolve to the actual
      // svg markup here; custom emoji-library options store the character itself (data-icon).
      var lucideName = el.getAttribute('data-icon-name');
      var icon = lucideName ? (window.LUCIDE_ICONS[lucideName] || '') : el.getAttribute('data-icon');
      UI.closeModal();
      onPick(icon);
    };
    // No background tint on hover (REQ: no background colours on any icon) -- border color is the
    // only hover cue, matching .icon-swatch's own hover treatment.
    el.onmouseenter = function () { el.style.borderColor = 'var(--accent)'; };
    el.onmouseleave = function () { el.style.borderColor = 'var(--border)'; };
  });
}
