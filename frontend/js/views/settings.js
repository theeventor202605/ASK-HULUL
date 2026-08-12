/**
 * HULUL - Settings: compact tabbed layout (same .tabbar/.tab-btn pattern as the Event workspace)
 * instead of every section stacked as its own card -- Profile / Appearance / Security are always
 * present; Terminology and Icons are role-gated tabs that only appear (and only fetch their data)
 * for a user who can actually manage them, and only once that tab is opened.
 */
var TERMINOLOGY_MANAGE_ROLES = ['SystemAdmin', 'GAAdmin', 'EMCAdmin', 'InspectionAdmin'];
var ICON_MANAGE_ROLES = ['SystemAdmin'];

async function renderSettings(params) {
  var root = document.getElementById('viewRoot');
  var u = HululState.user;
  var canManageLabels = TERMINOLOGY_MANAGE_ROLES.indexOf(u.role) !== -1;
  var canManageIcons = ICON_MANAGE_ROLES.indexOf(u.role) !== -1;

  var tabs = [
    { key: 'profile', label: 'Profile' },
    { key: 'appearance', label: 'Appearance' },
    { key: 'security', label: 'Security' }
  ];
  if (canManageLabels) tabs.push({ key: 'terminology', label: 'Terminology' });
  if (canManageIcons) tabs.push({ key: 'icons', label: 'Icons' });

  var activeTab = tabs.some(function (tb) { return params && tb.key === params.tab; }) ? params.tab : 'profile';

  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + t('nav_settings') + '</div></div></div>' +
    '<div class="tabbar" id="settingsTabbar"></div>' +
    '<div class="card"><div class="card-body" id="settingsTabContent"></div></div>';

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
      infoRow('Email', u.email) + infoRow('Organization', u.orgId) +
    '</div>';
}

/* ---------------- Appearance (Language + Theme) ---------------- */
function renderAppearanceTab_(content) {
  content.innerHTML =
    '<div style="margin-bottom:22px;">' +
      '<div style="font-size:11.5px;font-weight:700;color:var(--text-600);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px;">Language</div>' +
      '<button class="btn btn-secondary btn-sm" id="settingsLangBtn">Switch to ' + (HululState.lang === 'en' ? 'العربية' : 'English') + '</button>' +
    '</div>' +
    '<div>' +
      '<div style="font-size:11.5px;font-weight:700;color:var(--text-600);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px;">Theme</div>' +
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
      UI.field('Current password', '<input id="fOldPw" type="password" class="field-input" />') +
      UI.field('New password', '<input id="fNewPw" type="password" class="field-input" />') +
    '</div>' +
    '<button class="btn btn-primary btn-sm" id="changePwBtn" style="margin-top:12px;">Update password</button>';

  document.getElementById('changePwBtn').onclick = async function () {
    try {
      await Api.call('changePassword', { oldPassword: document.getElementById('fOldPw').value, newPassword: document.getElementById('fNewPw').value });
      UI.toast('Password updated', 'success');
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
    content.innerHTML = '<div class="empty-state">Create an Organization first to customize its terminology.</div>';
    return;
  }

  var overrides = orgId ? await Api.call('getOrgLabels', { orgId: orgId }) : {};

  var orgPicker = isSystemAdmin
    ? '<div style="margin-bottom:14px;max-width:280px;">' + UI.field('Organization', '<select id="fTermOrg" class="field-input">' +
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
    '<div class="muted" style="font-size:12.5px;margin-bottom:12px;">Rename what these objects are called across the app for your organization\'s users — e.g. call "Events" "Projects". Leave a field blank to use the default. This only changes labels; nothing about the underlying data changes.</div>' +
    orgPicker +
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;padding:4px 0;font-size:11px;font-weight:600;color:var(--text-600);">' +
    '<div>Object</div><div>Singular</div><div>Plural</div></div>' +
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
      UI.toast('Terminology saved', 'success');
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
  renderIconsTabBody_(content, Object.assign({}, overrides));
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
  var groups = [{ group: 'Navigation', rows: navRows }];
  window.ICON_KEY_GROUPS.forEach(function (g) {
    groups.push({
      group: g.group,
      rows: g.keys.map(function (k) { return { key: k.key, label: k.label, defaultIcon: window.ICON_DEFAULTS[k.key] || '' }; })
    });
  });
  return groups;
}

function renderIconsTabBody_(content, pending) {
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
    '<div class="muted" style="font-size:12.5px;margin-bottom:10px;">Click any icon to change it, app-wide for every organization. Hover an icon to see what it\'s for.</div>' +
    '<input class="field-input" id="iconSearchInput" placeholder="Search icons…" style="max-width:240px;margin-bottom:16px;" />' +
    groupsHtml +
    '<button class="btn btn-primary btn-sm" id="saveIconsBtn">' + t('save') + '</button>';

  content.querySelectorAll('.icon-swatch').forEach(function (el) {
    el.onclick = function () {
      var key = el.getAttribute('data-key');
      openIconPickerModal_(function (chosenIcon) {
        if (chosenIcon) pending[key] = chosenIcon; else delete pending[key];
        renderIconsTabBody_(content, pending);
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
      UI.toast('Icons saved', 'success');
    } catch (err) { UI.error(err); }
  };
}

// A grid of every icon in ICON_LIBRARY (icons.js), grouped by section, PLUS a free-text field so a
// SystemAdmin isn't limited to the curated palette -- any emoji/character can be typed or pasted in
// and used directly. onPick receives the chosen icon string, or '' to reset that key back to its
// built-in default.
function openIconPickerModal_(onPick) {
  var body = '<div class="muted" style="font-size:12px;margin-bottom:10px;">Choose an icon below, or paste/type your own.</div>' +
    '<div style="display:flex;gap:8px;margin-bottom:16px;">' +
      '<input class="field-input" id="customIconInput" placeholder="Paste or type any icon…" style="flex:1;" maxlength="8" />' +
      '<button type="button" class="btn btn-secondary btn-sm" id="customIconUseBtn">Use</button>' +
    '</div>' +
    window.ICON_LIBRARY.map(function (group) {
      return '<div style="margin-bottom:10px;">' +
        '<div style="font-size:11px;font-weight:700;color:var(--text-600);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px;">' + esc(group.section) + '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(8,1fr);gap:6px;">' +
        group.icons.map(function (ic) {
          return '<div class="icon-pick-opt" data-icon="' + esc(ic) + '" style="cursor:pointer;text-align:center;padding:8px 0;border-radius:8px;border:1px solid var(--border);font-size:18px;">' + ic + '</div>';
        }).join('') +
        '</div></div>';
    }).join('');

  UI.openModal('Choose icon', body, [
    { label: 'Reset to default', className: 'btn-secondary', onClick: function () { UI.closeModal(); onPick(''); } },
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal }
  ]);

  function useCustomIcon() {
    var val = document.getElementById('customIconInput').value.trim();
    if (!val) { UI.toast('Type or paste an icon first', 'error'); return; }
    UI.closeModal();
    onPick(val);
  }
  document.getElementById('customIconUseBtn').onclick = useCustomIcon;
  document.getElementById('customIconInput').onkeydown = function (e) {
    if (e.key === 'Enter') { e.preventDefault(); useCustomIcon(); }
  };

  document.querySelectorAll('.icon-pick-opt').forEach(function (el) {
    el.onclick = function () {
      var icon = el.getAttribute('data-icon');
      UI.closeModal();
      onPick(icon);
    };
    // No background tint on hover (REQ: no background colours on any icon) -- border color is the
    // only hover cue, matching .icon-swatch's own hover treatment.
    el.onmouseenter = function () { el.style.borderColor = 'var(--accent)'; };
    el.onmouseleave = function () { el.style.borderColor = 'var(--border)'; };
  });
}
