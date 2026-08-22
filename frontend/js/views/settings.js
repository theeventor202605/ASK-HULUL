/**
 * HULUL - Settings: compact tabbed layout (same .tabbar/.tab-btn pattern as the Event workspace)
 * instead of every section stacked as its own card -- Profile / Appearance / Security are always
 * present; Terminology and Icons are role-gated tabs that only appear (and only fetch their data)
 * for a user who can actually manage them, and only once that tab is opened.
 */
var ICON_MANAGE_ROLES = ['SystemAdmin'];
var PERMISSIONS_MANAGE_ROLES = ['SystemAdmin'];
// REQ: "In Permissions I would like to set for an Organisation the permissions they can set. So when
// an organization's admin wants to reconfigure permissions they can but are limited according to
// system admin Organization set permissions." Opens the Permissions tab itself to an org's own admin
// too -- but NOT the Roles/Mandatory Operators tabs (still PERMISSIONS_MANAGE_ROLES/SystemAdmin-only
// above, unchanged), since those are platform-wide catalogs, not something the backend scopes per org
// the way listPermissions/updatePermission/resetPermission now do (Permissions.gs).
var PERMISSIONS_ORG_ADMIN_ROLES_ = ['GAAdmin', 'EMCAdmin', 'InspectionAdmin'];
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
// REQ: "Add to settings the 'Photos Properties'" -- SystemAdmin-only, same gating as the org logo
// upload endpoint itself (uploadOrgLogo/setOrgPhotoProperties, Accounts.gs both requireRole SystemAdmin).
var PHOTO_PROPS_MANAGE_ROLES = ['SystemAdmin'];
// Tabs that build their own stack of .card blocks (same as Escalations did on the old /config page)
// render into a plain, un-carded content div instead of the shared one -- otherwise every one of
// their cards would sit nested inside the shared outer card, doubling the border/padding for no
// reason. Every other tab (Profile, Terminology, Icons, Roles, Permissions, ...) still gets the
// shared card, unchanged.
// REQ: "Add Login through MS Entra or google login." Own card-stack tab (like Escalations above),
// same SystemAdmin-only gate as the rest of CONFIG_MANAGE_ROLES -- setSsoConfig (Sso.gs) already
// requireRole(SystemAdmin)s server-side regardless of what this tab shows.
var SETTINGS_PLAIN_CONTENT_TABS_ = { escalations: true, singleSignOn: true };

// REQ: "Split Settings tabs into sub-tabs." -- 10 possible tabs (SystemAdmin's full view) crowded the
// bar, same problem EVENT_TAB_GROUPS_ (eventDetail.js) already solved for the Event workspace's own
// tab bar: "The Events' tab menu is long. Divide it into tab and subtab." This mirrors that exact
// mechanism (group -> collapsed top-level button + a second subtab row for its children) rather than
// inventing a new one, right down to a single-tab group auto-collapsing to a plain standalone button
// (settingsTabGroupFor_ below). Purely visual: every tab's key, its #/settings?tab=x URL, and its own
// role gate above all stay exactly as they were.
var SETTINGS_TAB_GROUPS_ = [
  { key: 'accountGroup', labelKey: 'settings_tab_group_account', tabs: ['profile', 'appearance', 'security'] },
  { key: 'organizationGroup', labelKey: 'settings_tab_group_organization', tabs: ['terminology', 'icons', 'photoProperties', 'escalations', 'singleSignOn'] },
  { key: 'accessControlGroup', labelKey: 'settings_tab_group_access_control', tabs: ['roles', 'mandatoryOperators', 'permissions'] }
];

// Same shape/behavior as eventTabGroupFor_ (eventDetail.js): the group a tab key belongs to, filtered
// to only the tabs actually visible this render (role-gated) -- so a group left with just one visible
// member behaves like a plain standalone tab instead of a redundant one-item dropdown.
function settingsTabGroupFor_(tabKey, visibleTabKeys) {
  for (var i = 0; i < SETTINGS_TAB_GROUPS_.length; i++) {
    var g = SETTINGS_TAB_GROUPS_[i];
    if (g.tabs.indexOf(tabKey) === -1) continue;
    var visibleMembers = g.tabs.filter(function (k) { return visibleTabKeys.indexOf(k) !== -1; });
    return { key: g.key, labelKey: g.labelKey, tabs: visibleMembers };
  }
  return null;
}

async function renderSettings(params) {
  var root = document.getElementById('viewRoot');
  var u = HululState.user;
  var canManageLabels = hasPermission('orgLabels.manage');
  var canManageIcons = ICON_MANAGE_ROLES.indexOf(u.role) !== -1;
  var canManagePermissions = PERMISSIONS_MANAGE_ROLES.indexOf(u.role) !== -1;
  var canViewPermissionsTab = canManagePermissions || PERMISSIONS_ORG_ADMIN_ROLES_.indexOf(u.role) !== -1;
  var canManageConfig = CONFIG_MANAGE_ROLES.indexOf(u.role) !== -1;
  var canManagePhotoProps = PHOTO_PROPS_MANAGE_ROLES.indexOf(u.role) !== -1;

  var tabs = [
    { key: 'profile', label: t('settings_tab_profile') },
    { key: 'appearance', label: t('settings_tab_appearance') },
    { key: 'security', label: t('settings_tab_security') }
  ];
  if (canManageLabels) tabs.push({ key: 'terminology', label: t('settings_tab_terminology') });
  if (canManageIcons) tabs.push({ key: 'icons', label: t('settings_tab_icons') });
  if (canManagePhotoProps) tabs.push({ key: 'photoProperties', label: t('settings_tab_photo_properties') });
  if (canManageConfig) tabs.push({ key: 'escalations', label: t('tab_escalations') });
  // REQ: "Add Login through MS Entra or google login." Same SystemAdmin-only gate as Escalations.
  if (canManageConfig) tabs.push({ key: 'singleSignOn', label: t('settings_tab_sso') });
  if (canManagePermissions) tabs.push({ key: 'roles', label: t('settings_tab_roles') });
  // REQ: "In settings add a tab for mandatory operators. For example a security operator must be
  // available in every event, a H&S Operator must be available on every event. EMC just needs to
  // set up their accounts accordingly." Same SystemAdmin gate as Roles/Permissions -- toggling this
  // is exactly as consequential as editing a role itself (setMandatoryOperator, Roles.gs).
  if (canManagePermissions) tabs.push({ key: 'mandatoryOperators', label: t('settings_tab_mandatory_operators') });
  if (canViewPermissionsTab) tabs.push({ key: 'permissions', label: t('settings_tab_permissions') });

  var activeTab = tabs.some(function (tb) { return params && tb.key === params.tab; }) ? params.tab : 'profile';

  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + t('nav_settings') + '</div></div></div>' +
    '<div id="settingsTabbarWrap">' +
      '<div class="tabbar" id="settingsTabbar"></div>' +
      '<div class="tabbar tabbar-sub" id="settingsSubtabbar" style="display:none;"></div>' +
    '</div>' +
    (SETTINGS_PLAIN_CONTENT_TABS_[activeTab]
      ? '<div id="settingsTabContent"></div>'
      : '<div class="card"><div class="card-body" id="settingsTabContent"></div></div>');

  var tabsByKey_ = {}; tabs.forEach(function (tb) { tabsByKey_[tb.key] = tb; });
  var visibleTabKeys = tabs.map(function (tb) { return tb.key; });
  var activeGroup = settingsTabGroupFor_(activeTab, visibleTabKeys); // null for a standalone (ungrouped) tab

  var tabbar = document.getElementById('settingsTabbar');
  var subtabbar = document.getElementById('settingsSubtabbar');

  // Top-level bar: one button per group -- a single-visible-tab group collapses to a plain standalone
  // button (data-tab, navigates straight there); a multi-tab group renders as a collapsed parent
  // (data-group, no data-tab) labeled by its own labelKey, marked .active whenever the open tab is any
  // of its children. Same two-row mechanism as renderEventDetail (eventDetail.js) uses for EVENT_TAB_GROUPS_.
  var seenGroupKeys = {};
  tabbar.innerHTML = SETTINGS_TAB_GROUPS_.map(function (g) {
    var group = settingsTabGroupFor_(g.tabs[0], visibleTabKeys); // re-derive so role-gated-out members are already filtered out
    if (!group || !group.tabs.length || (group.key && seenGroupKeys[group.key])) return '';
    if (group.key) seenGroupKeys[group.key] = true;
    if (group.tabs.length === 1) {
      var tb = tabsByKey_[group.tabs[0]];
      if (!tb) return '';
      return '<div class="tab-btn ' + (tb.key === activeTab ? 'active' : '') + '" data-tab="' + tb.key + '">' + esc(tb.label) + '</div>';
    }
    var isActive = group.tabs.indexOf(activeTab) !== -1;
    return '<div class="tab-btn ' + (isActive ? 'active' : '') + '" data-group="' + group.key + '" data-default-tab="' + group.tabs[0] + '">' +
      esc(t(group.labelKey)) + ' ' + ICON('chevron_down') + '</div>';
  }).join('');
  tabbar.querySelectorAll('[data-tab]').forEach(function (btn) {
    btn.onclick = function () { window.location.hash = '#/settings?tab=' + btn.getAttribute('data-tab'); };
  });
  tabbar.querySelectorAll('[data-group]').forEach(function (btn) {
    btn.onclick = function () {
      // Already inside this group -- the subtab row below already shows exactly where you are;
      // re-navigating to the group's first child would silently discard your actual position.
      if (btn.classList.contains('active')) return;
      window.location.hash = '#/settings?tab=' + btn.getAttribute('data-default-tab');
    };
  });

  // Subtab row: only exists while a multi-tab group is the active one.
  if (activeGroup && activeGroup.tabs.length > 1) {
    subtabbar.style.display = '';
    subtabbar.innerHTML = activeGroup.tabs.map(function (key) {
      var tb = tabsByKey_[key];
      if (!tb) return '';
      return '<div class="tab-btn ' + (tb.key === activeTab ? 'active' : '') + '" data-tab="' + tb.key + '">' + esc(tb.label) + '</div>';
    }).join('');
    subtabbar.querySelectorAll('[data-tab]').forEach(function (btn) {
      btn.onclick = function () { window.location.hash = '#/settings?tab=' + btn.getAttribute('data-tab'); };
    });
  } else {
    subtabbar.style.display = 'none';
    subtabbar.innerHTML = '';
  }

  var content = document.getElementById('settingsTabContent');
  content.innerHTML = '<div class="empty-state">' + t('loading') + '</div>';
  if (activeTab === 'profile') await renderProfileTab_(content, u);
  else if (activeTab === 'appearance') renderAppearanceTab_(content);
  else if (activeTab === 'security') renderSecurityTab_(content);
  else if (activeTab === 'terminology' && canManageLabels) await renderTerminologyTab_(content);
  else if (activeTab === 'icons' && canManageIcons) await renderIconsTab_(content);
  else if (activeTab === 'photoProperties' && canManagePhotoProps) await renderPhotoPropertiesTab_(content);
  else if (activeTab === 'escalations' && canManageConfig) await renderEscalationsTab_(content);
  else if (activeTab === 'singleSignOn' && canManageConfig) await renderSsoTab_(content);
  else if (activeTab === 'roles' && canManagePermissions) await renderRolesTab_(content);
  else if (activeTab === 'mandatoryOperators' && canManagePermissions) await renderMandatoryOperatorsTab_(content);
  else if (activeTab === 'permissions' && canViewPermissionsTab) await renderPermissionsTab_(content);
  else await renderProfileTab_(content, u);
}

/* ---------------- Profile (REQ: "Make user profile rich" -- photo, mobile, email, certificates,
 * and other personal info, editable self-service, reflected live in the topbar user chip) --------
 * Loads the caller's own row fresh from the backend (getMyProfile) rather than trusting the
 * possibly-stale HululState.user/localStorage copy passed in as `u` -- `u` is only used here as an
 * instant-paint placeholder (name/role) while the real fetch is in flight. */
async function renderProfileTab_(content, u) {
  content.innerHTML =
    '<div style="display:flex;align-items:center;gap:14px;margin-bottom:20px;">' +
      '<div class="avatar" style="width:52px;height:52px;font-size:18px;flex:none;">' + esc((u.name || '?').slice(0, 1).toUpperCase()) + '</div>' +
      '<div><div style="font-size:16px;font-weight:800;">' + esc(u.name) + '</div>' +
      '<div class="muted" style="font-size:12.5px;">' + esc(u.role) + '</div></div>' +
    '</div>' +
    '<div class="empty-state">' + t('loading') + '</div>';
  var data;
  try { data = await Api.call('getMyProfile', {}); } catch (err) { UI.error(err); return; }
  var profile = data.user, certificates = data.certificates || [];

  content.innerHTML =
    '<div style="display:flex;align-items:center;gap:16px;margin-bottom:24px;">' +
      '<div class="avatar" id="myProfileAvatar" style="width:64px;height:64px;font-size:22px;flex:none;">' +
        (profile.photoUrl
          ? '<img src="' + esc(profile.photoUrl) + '" alt="" onerror="this.remove();document.getElementById(\'myProfileAvatar\').textContent=' + JSON.stringify((profile.name || '?').slice(0, 1).toUpperCase()) + ';" />'
          : esc((profile.name || '?').slice(0, 1).toUpperCase())) +
      '</div>' +
      '<div style="flex:1;">' +
        '<div style="font-size:16px;font-weight:800;">' + esc(profile.name) + '</div>' +
        '<div class="muted" style="font-size:12.5px;margin-bottom:8px;">' + esc(profile.role) + '</div>' +
        '<button class="btn btn-secondary btn-sm" id="changeMyPhotoBtn">' + ICON('upload') + ' ' + esc(t('profile_change_photo')) + '</button>' +
        '<input type="file" id="fMyPhoto" accept="image/*" class="hidden" />' +
      '</div>' +
    '</div>' +
    '<div class="form-row" style="max-width:640px;">' +
      UI.field(t('profile_field_name'), '<input type="text" id="fMyName" class="field-input" value="' + esc(profile.name || '') + '" />') +
      UI.field(t('email'), '<input type="text" class="field-input" value="' + esc(profile.email || '') + '" disabled />') +
      UI.field(t('profile_field_mobile'), '<input type="text" id="fMyMobile" class="field-input" value="' + esc(profile.mobile || '') + '" />') +
      UI.field(t('profile_field_job_title'), '<input type="text" id="fMyJobTitle" class="field-input" value="' + esc(profile.jobTitle || '') + '" />') +
    '</div>' +
    '<div style="max-width:640px;margin-top:12px;">' +
      UI.field(t('profile_field_bio'), '<textarea id="fMyBio" class="field-input" rows="3">' + esc(profile.bio || '') + '</textarea>') +
    '</div>' +
    '<div style="margin-top:6px;"><button class="btn btn-primary btn-sm" id="saveMyProfileBtn">' + esc(t('save')) + '</button></div>' +
    '<hr style="margin:26px 0;border:none;border-top:1px solid #eceef4;" />' +
    '<div style="display:flex;align-items:center;justify-content:space-between;max-width:640px;margin-bottom:12px;">' +
      '<div style="font-size:14px;font-weight:800;">' + esc(t('profile_certificates_title')) + '</div>' +
      '<button class="btn btn-secondary btn-sm" id="addMyCertBtn">' + ICON('add') + ' ' + esc(t('profile_add_certificate')) + '</button>' +
    '</div>' +
    '<div id="myCertList" style="max-width:640px;">' + certificatesListHtml_(certificates) + '</div>';

  wireProfileTab_(content, profile, certificates);
}

// Renders each UserCertificates row as a compact card; empty-state matches the app's other
// list-with-add-button sections (see e.g. eventDetail.js Annex tab empty state).
function certificatesListHtml_(certificates) {
  if (!certificates.length) return '<div class="empty-state">' + esc(t('profile_no_certificates')) + '</div>';
  return certificates.map(function (c) {
    var meta = [];
    if (c.issuer) meta.push(esc(c.issuer));
    if (c.issuedAt) meta.push(esc(t('profile_cert_issued')) + ' ' + esc(UI.fmtDate(c.issuedAt)));
    if (c.expiresAt) meta.push(esc(t('profile_cert_expires')) + ' ' + esc(UI.fmtDate(c.expiresAt)));
    return '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid #f0f1f6;">' +
      '<div style="min-width:0;">' +
        '<div style="font-weight:700;font-size:13.5px;">' + esc(c.name) + '</div>' +
        (meta.length ? '<div class="muted" style="font-size:12px;">' + meta.join(' · ') + '</div>' : '') +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:6px;flex:none;">' +
        (c.fileUrl ? '<a href="' + esc(c.fileUrl) + '" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">' + esc(t('profile_view_file')) + '</a>' : '') +
        '<button class="btn btn-ghost btn-sm" data-del-cert="' + esc(c.id) + '">' + ICON('delete') + '</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function wireProfileTab_(content, profile, certificates) {
  document.getElementById('changeMyPhotoBtn').onclick = function () { document.getElementById('fMyPhoto').click(); };
  document.getElementById('fMyPhoto').onchange = async function (e) {
    var file = e.target.files[0];
    if (!file) return;
    try {
      var updated = await Api.call('uploadMyProfilePhoto', {
        fileBase64: await fileToBase64(file), fileName: file.name, mimeType: file.type
      });
      HululState.setSession(HululState.token, updated);
      renderUserChip();
      UI.toast(t('profile_photo_updated'), 'success');
      await renderProfileTab_(content, updated);
    } catch (err) { UI.error(err); }
  };

  document.getElementById('saveMyProfileBtn').onclick = async function () {
    var name = document.getElementById('fMyName').value.trim();
    if (!name) { UI.toast(t('toast_name_required'), 'error'); return; }
    try {
      var updated = await Api.call('updateMyProfile', {
        name: name,
        mobile: document.getElementById('fMyMobile').value.trim(),
        jobTitle: document.getElementById('fMyJobTitle').value.trim(),
        bio: document.getElementById('fMyBio').value.trim()
      });
      HululState.setSession(HululState.token, updated);
      renderUserChip();
      UI.toast(t('profile_saved'), 'success');
      await renderProfileTab_(content, updated);
    } catch (err) { UI.error(err); }
  };

  document.getElementById('addMyCertBtn').onclick = function () { openAddCertificateModal_(content); };

  content.querySelectorAll('[data-del-cert]').forEach(function (btn) {
    btn.onclick = async function () {
      if (!confirm(t('profile_confirm_delete_cert'))) return;
      try {
        await Api.call('deleteMyCertificate', { certificateId: btn.getAttribute('data-del-cert') });
        await renderProfileTab_(content, HululState.user);
      } catch (err) { UI.error(err); }
    };
  });
}

// Mirrors openUploadLogoModal_ (organizations.js) -- same UI.openModal/UI.field/fileToBase64
// pattern, just posting to addMyCertificate instead of uploadOrgLogo.
function openAddCertificateModal_(content) {
  var body =
    UI.field(t('profile_field_cert_name'), '<input type="text" id="fCertName" class="field-input" />') +
    UI.field(t('profile_field_cert_issuer'), '<input type="text" id="fCertIssuer" class="field-input" />') +
    '<div class="form-row">' +
      UI.field(t('profile_cert_issued'), '<input type="date" id="fCertIssuedAt" class="field-input" />') +
      UI.field(t('profile_cert_expires'), '<input type="date" id="fCertExpiresAt" class="field-input" />') +
    '</div>' +
    UI.field(t('profile_field_cert_file'), '<input type="file" id="fCertFile" class="field-input" />');
  UI.openModal(t('profile_add_certificate'), body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('save'), className: 'btn-primary', onClick: async function () {
        var name = document.getElementById('fCertName').value.trim();
        if (!name) { UI.toast(t('toast_name_required'), 'error'); return; }
        try {
          var fileInput = document.getElementById('fCertFile');
          var payload = {
            name: name,
            issuer: document.getElementById('fCertIssuer').value.trim(),
            issuedAt: document.getElementById('fCertIssuedAt').value,
            expiresAt: document.getElementById('fCertExpiresAt').value
          };
          if (fileInput.files[0]) {
            payload.fileBase64 = await fileToBase64(fileInput.files[0]);
            payload.fileName = fileInput.files[0].name;
            payload.mimeType = fileInput.files[0].type;
          }
          await Api.call('addMyCertificate', payload);
          UI.closeModal();
          await renderProfileTab_(content, HululState.user);
        } catch (err) { UI.error(err); }
      } }
  ]);
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

/* ---------------- Photos Properties (per-org logo/geolocation/QR overlay config) ----------------
 * REQ: "Add to settings the 'Photos Properties': GA logo (on/off), Inspection Company logo (on/off),
 * geolocation (on/off), and QR (on/off). For each logo its own settings. Also options where each one
 * is placed on the photo." One card per GA/Inspection-Company org (EMC orgs have nothing to configure
 * here -- they don't have a logo stamped on evidence photos). Geolocation + QR are only shown on
 * Inspection Company orgs -- they describe the capture itself (the operational org out in the field),
 * not a GA's own branding; see the comment on getEventBrandingLogos (Accounts.gs) for why. Saves per
 * org via setOrgPhotoProperties, same one-JSON-blob-per-row pattern as photoPropsJson itself.
 */
// Same 6 named positions PHOTO_POSITIONS_ (Accounts.gs) and evidencePlace_ (evidence.js) work with --
// literal duplicate since Apps Script and the browser don't share a module system here.
var PHOTO_POSITIONS_ = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'];

async function renderPhotoPropertiesTab_(content) {
  content.innerHTML = '<div class="empty-state">' + t('loading') + '</div>';
  var orgs = await Api.call('listOrganizations', {});
  var relevant = (orgs || []).filter(function (o) { return o.type === 'GA' || o.type === 'INSPECTION'; });
  renderPhotoPropertiesTabBody_(content, relevant);
}

// Parses one org's photoPropsJson, defaulting every field to the pre-existing hardcoded layout (top-
// left Inspection Co logo, top-right GA logo, bottom-left geolocation, bottom-right QR) -- mirrors
// photoProps_ (Accounts.gs) exactly so the picker always opens already showing what's actually live.
function photoPropertiesDefaults_(org) {
  var raw = {};
  try { raw = org.photoPropsJson ? JSON.parse(org.photoPropsJson) : {}; } catch (e) { raw = {}; }
  return {
    logoEnabled: raw.logoEnabled !== false,
    logoPosition: raw.logoPosition || (org.type === 'GA' ? 'top-right' : 'top-left'),
    geoEnabled: raw.geoEnabled !== false,
    geoPosition: raw.geoPosition || 'bottom-left',
    qrEnabled: raw.qrEnabled !== false,
    qrPosition: raw.qrPosition || 'bottom-right'
  };
}

function photoPositionOptionsHtml_(selected) {
  return PHOTO_POSITIONS_.map(function (p) {
    return '<option value="' + p + '"' + (p === selected ? ' selected' : '') + '>' + esc(t('photo_position_' + p.replace(/-/g, '_'))) + '</option>';
  }).join('');
}

function renderPhotoPropertiesTabBody_(content, orgs) {
  if (!orgs.length) {
    content.innerHTML = '<div class="empty-state">' + esc(t('empty_no_organizations')) + '</div>';
    return;
  }
  var rowsHtml = orgs.map(function (org) {
    var props = photoPropertiesDefaults_(org);
    var isInspection = org.type === 'INSPECTION';
    return '<div class="card" style="margin-bottom:14px;" data-org-row="' + esc(org.id) + '">' +
      '<div class="card-body">' +
        '<div style="font-weight:700;font-size:14px;margin-bottom:2px;">' + esc(org.name) + '</div>' +
        '<div class="muted" style="font-size:11.5px;margin-bottom:12px;">' + esc(org.type === 'GA' ? t('org_type_ga') : t('org_type_inspection')) + '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px 24px;max-width:760px;">' +
          '<div>' +
            '<label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;margin-bottom:6px;">' +
              '<input type="checkbox" class="pp-logo-enabled" ' + (props.logoEnabled ? 'checked' : '') + ' /> ' + esc(t('photo_prop_logo_enabled')) +
            '</label>' +
            '<select class="field-input pp-logo-position">' + photoPositionOptionsHtml_(props.logoPosition) + '</select>' +
          '</div>' +
          (isInspection ?
            '<div>' +
              '<label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;margin-bottom:6px;">' +
                '<input type="checkbox" class="pp-geo-enabled" ' + (props.geoEnabled ? 'checked' : '') + ' /> ' + esc(t('photo_prop_geo_enabled')) +
              '</label>' +
              '<select class="field-input pp-geo-position">' + photoPositionOptionsHtml_(props.geoPosition) + '</select>' +
            '</div>' +
            '<div>' +
              '<label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;margin-bottom:6px;">' +
                '<input type="checkbox" class="pp-qr-enabled" ' + (props.qrEnabled ? 'checked' : '') + ' /> ' + esc(t('photo_prop_qr_enabled')) +
              '</label>' +
              '<select class="field-input pp-qr-position">' + photoPositionOptionsHtml_(props.qrPosition) + '</select>' +
            '</div>'
          : '') +
        '</div>' +
        '<button class="btn btn-primary btn-sm" style="margin-top:16px;" data-save-org="' + esc(org.id) + '">' + t('save') + '</button>' +
      '</div>' +
    '</div>';
  }).join('');

  content.innerHTML = '<div class="muted" style="font-size:12.5px;margin-bottom:14px;">' + esc(t('photo_properties_intro')) + '</div>' + rowsHtml;

  content.querySelectorAll('[data-save-org]').forEach(function (btn) {
    btn.onclick = async function () {
      var orgId = btn.getAttribute('data-save-org');
      var row = content.querySelector('[data-org-row="' + orgId + '"]');
      var geoEnabledEl = row.querySelector('.pp-geo-enabled'), geoPositionEl = row.querySelector('.pp-geo-position');
      var qrEnabledEl = row.querySelector('.pp-qr-enabled'), qrPositionEl = row.querySelector('.pp-qr-position');
      var payload = {
        orgId: orgId,
        logoEnabled: row.querySelector('.pp-logo-enabled').checked,
        logoPosition: row.querySelector('.pp-logo-position').value,
        geoEnabled: geoEnabledEl ? geoEnabledEl.checked : true,
        geoPosition: geoPositionEl ? geoPositionEl.value : 'bottom-left',
        qrEnabled: qrEnabledEl ? qrEnabledEl.checked : true,
        qrPosition: qrPositionEl ? qrPositionEl.value : 'bottom-right'
      };
      try {
        await Api.call('setOrgPhotoProperties', payload);
        UI.toast(t('toast_photo_properties_saved'), 'success');
      } catch (err) { UI.error(err); }
    };
  });
}

/* ---------------- Escalations (timers, To/Cc roles, lock-screen toggle) ----------------
 * Moved here from the old standalone Config page -- see the CONFIG_MANAGE_ROLES comment above.
 * getEscalationConfig (Resolutions.gs) returns tier1/tier2/tier3 + lockScreenEnabled + allRoles (the
 * picklist) + riskLevels. Tier 1 has no delay editor here on purpose -- each Finding already carries
 * its own deadline from its checklist item, so only Tier 2 and Tier 3's delays (which fire a
 * configurable time AFTER the previous tier) are admin-editable, and per risk level.
 */
async function renderEscalationsTab_(content) {
  var results = await Promise.all([
    Api.call('getEscalationConfig', {}),
    // REQ: "one week (configurable)" -- the gap between a documents deadline version's own deadline
    // passing and the next version auto-opening (maybeAutoCreateVersion2_, Templates.gs).
    // SystemAdmin-only, same gating as this whole tab (CONFIG_MANAGE_ROLES).
    Api.call('getTemplateDeadlineVersionGapDays', {}),
    // REQ follow-up: "Instead of enforcing photo, say 'No Photo was taken...' Make this optional in
    // the settings so admin may want to enforce taking a photo." Own Config key/endpoint (Findings.gs),
    // same SystemAdmin-only posture as the other two calls above.
    Api.call('getResolutionEvidenceRequired', {})
  ]);
  var cfg = results[0];
  var versionGapDays = results[1].gapDays;
  var evidenceRequired = results[2].required;
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
    // REQ: "create a second deadline one week (configurable) after first version deadline" -- the
    // gap used by maybeAutoCreateVersion2_ (Templates.gs) when auto-opening version 2 of a
    // Readiness Templates documents deadline. Saved independently of the escalation config below
    // (its own endpoint, getTemplateDeadlineVersionGapDays/setTemplateDeadlineVersionGapDays).
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + esc(t('version_gap_days_title')) + '</div>' +
    '<div class="muted" style="font-size:11.5px;">' + esc(t('version_gap_days_subtitle')) + '</div></div>' +
    '<div class="card-body">' +
      UI.field(t('version_gap_days_field'), '<input type="number" id="cfgVersionGapDays" class="field-input" min="1" style="max-width:120px;" value="' + esc(String(versionGapDays)) + '" />') +
      '<button class="btn btn-secondary btn-sm" id="saveVersionGapDaysBtn" style="margin-top:10px;">' + esc(t('save')) + '</button>' +
    '</div></div>' +
    // REQ follow-up: "Instead of enforcing photo, say 'No Photo was taken...' Make this optional in
    // the settings so admin may want to enforce taking a photo." resolutionEvidenceRequired_
    // (Findings.gs) defaults false -- Participants are never hard-blocked unless a SystemAdmin
    // explicitly checks this box, matching "admin may want to enforce" (enforcement is the opt-in).
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + esc(t('resolution_evidence_title')) + '</div>' +
    '<div class="muted" style="font-size:11.5px;">' + esc(t('resolution_evidence_subtitle')) + '</div></div>' +
    '<div class="card-body">' +
      '<label style="display:flex;align-items:center;gap:8px;font-size:13.5px;cursor:pointer;">' +
        '<input type="checkbox" id="cfgResolutionEvidenceRequired"' + (evidenceRequired ? ' checked' : '') + ' /> ' + esc(t('resolution_evidence_toggle_label')) +
      '</label>' +
      '<div class="muted" style="font-size:11px;margin-top:6px;">' + esc(t('resolution_evidence_toggle_hint')) + '</div>' +
      '<button class="btn btn-secondary btn-sm" id="saveResolutionEvidenceRequiredBtn" style="margin-top:10px;">' + esc(t('save')) + '</button>' +
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

  document.getElementById('saveVersionGapDaysBtn').onclick = async function () {
    var n = Number(document.getElementById('cfgVersionGapDays').value);
    if (!Number.isFinite(n) || n < 1) { UI.toast(t('toast_version_gap_days_invalid'), 'error'); return; }
    try {
      await Api.call('setTemplateDeadlineVersionGapDays', { gapDays: n });
      UI.toast(t('toast_version_gap_days_saved'), 'success');
    } catch (err) { UI.error(err); }
  };

  document.getElementById('saveResolutionEvidenceRequiredBtn').onclick = async function () {
    try {
      await Api.call('setResolutionEvidenceRequired', { required: document.getElementById('cfgResolutionEvidenceRequired').checked });
      UI.toast(t('toast_resolution_evidence_setting_saved'), 'success');
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

/* ---------------- Single Sign-On (REQ: "Add Login through MS Entra or google login.") ------------
 * SystemAdmin-only, same CONFIG_MANAGE_ROLES gate as Escalations. setSsoConfig (backend/Sso.gs)
 * re-validates everything server-side regardless of what this form allows -- in particular it
 * refuses to save passwordLoginDisabled:true unless at least one provider is enabled+configured in
 * that very same save, so a SystemAdmin can never lock every account (including their own) out of
 * the app. The "Require SSO" checkbox here is disabled client-side under the same condition purely
 * as an immediate, friendlier version of that same guardrail -- not the actual enforcement.
 */
async function renderSsoTab_(content) {
  var cfg = await Api.call('getSsoConfig', {});
  content.innerHTML =
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + esc(t('sso_google_title')) + '</div>' +
    '<div class="muted" style="font-size:11.5px;">' + esc(t('sso_google_subtitle')) + '</div></div>' +
    '<div class="card-body">' +
      '<label style="display:flex;align-items:center;gap:8px;font-size:13.5px;cursor:pointer;margin-bottom:12px;">' +
        '<input type="checkbox" id="cfgSsoGoogleEnabled"' + (cfg.googleEnabled ? ' checked' : '') + ' /> ' + esc(t('sso_enable_google')) +
      '</label>' +
      UI.field(t('sso_google_client_id_field'), '<input type="text" id="cfgSsoGoogleClientId" class="field-input" placeholder="xxxxxxxx.apps.googleusercontent.com" value="' + esc(cfg.googleClientId || '') + '" />') +
    '</div></div>' +
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + esc(t('sso_microsoft_title')) + '</div>' +
    '<div class="muted" style="font-size:11.5px;">' + esc(t('sso_microsoft_subtitle')) + '</div></div>' +
    '<div class="card-body">' +
      '<label style="display:flex;align-items:center;gap:8px;font-size:13.5px;cursor:pointer;margin-bottom:12px;">' +
        '<input type="checkbox" id="cfgSsoMicrosoftEnabled"' + (cfg.microsoftEnabled ? ' checked' : '') + ' /> ' + esc(t('sso_enable_microsoft')) +
      '</label>' +
      '<div class="form-row">' +
        UI.field(t('sso_microsoft_client_id_field'), '<input type="text" id="cfgSsoMicrosoftClientId" class="field-input" value="' + esc(cfg.microsoftClientId || '') + '" />') +
        UI.field(t('sso_microsoft_tenant_id_field'), '<input type="text" id="cfgSsoMicrosoftTenantId" class="field-input" value="' + esc(cfg.microsoftTenantId || '') + '" />') +
      '</div>' +
    '</div></div>' +
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + esc(t('sso_require_title')) + '</div>' +
    '<div class="muted" style="font-size:11.5px;">' + esc(t('sso_require_subtitle')) + '</div></div>' +
    '<div class="card-body">' +
      '<label style="display:flex;align-items:center;gap:8px;font-size:13.5px;cursor:pointer;" id="cfgSsoPasswordDisabledLabel">' +
        '<input type="checkbox" id="cfgSsoPasswordLoginDisabled"' + (cfg.passwordLoginDisabled ? ' checked' : '') + ' /> ' + esc(t('sso_disable_password_login')) +
      '</label>' +
      '<div class="muted" style="font-size:11px;margin-top:6px;">' + esc(t('sso_disable_password_login_hint')) + '</div>' +
    '</div></div>' +
    '<div style="display:flex;justify-content:flex-end;gap:8px;padding:14px 20px;">' +
      '<button class="btn btn-primary" id="saveSsoCfgBtn">' + esc(t('save')) + '</button>' +
    '</div>';

  // Purely client-side convenience mirror of the server guardrail in setSsoConfig (Sso.gs): grey
  // out (and force-uncheck) "Require SSO" the instant neither provider checkbox is checked, so the
  // admin sees why the save would fail before they even click Save.
  var googleChk = document.getElementById('cfgSsoGoogleEnabled');
  var msChk = document.getElementById('cfgSsoMicrosoftEnabled');
  var passwordDisabledChk = document.getElementById('cfgSsoPasswordLoginDisabled');
  function syncRequireSsoAvailability_() {
    var anyProvider = googleChk.checked || msChk.checked;
    passwordDisabledChk.disabled = !anyProvider;
    if (!anyProvider) passwordDisabledChk.checked = false;
  }
  googleChk.addEventListener('change', syncRequireSsoAvailability_);
  msChk.addEventListener('change', syncRequireSsoAvailability_);
  syncRequireSsoAvailability_();

  document.getElementById('saveSsoCfgBtn').onclick = async function () {
    try {
      await Api.call('setSsoConfig', {
        googleEnabled: googleChk.checked,
        googleClientId: document.getElementById('cfgSsoGoogleClientId').value.trim(),
        microsoftEnabled: msChk.checked,
        microsoftClientId: document.getElementById('cfgSsoMicrosoftClientId').value.trim(),
        microsoftTenantId: document.getElementById('cfgSsoMicrosoftTenantId').value.trim(),
        passwordLoginDisabled: passwordDisabledChk.checked
      });
      UI.toast(t('toast_sso_settings_saved'), 'success');
      renderSettings({ tab: 'singleSignOn' });
    } catch (err) { UI.error(err); }
  };
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

/* ---------------- Mandatory Operators ----------------
 * REQ: "a security operator must be available in every event, a H&S Operator must be available on
 * every event. EMC just needs to set up their accounts accordingly." Only Participant-type roles
 * (isParticipantType) can be flagged -- a mandatory operator only means anything if it's also
 * selectable as an Operator/Participant on an event (see mandatoryOperatorCompliance_, Events.gs,
 * which only ever looks at roles where both flags are true).
 */
async function renderMandatoryOperatorsTab_(content) {
  content.innerHTML = '<div class="empty-state">' + t('loading') + '</div>';
  var customRoles = await Api.call('listCustomRoles', {});
  renderMandatoryOperatorsTabBody_(content, customRoles);
}

function renderMandatoryOperatorsTabBody_(content, customRoles) {
  var eligible = customRoles.filter(function (r) { return r.isParticipantType; });
  content.innerHTML =
    '<div class="muted" style="font-size:12.5px;max-width:560px;margin-bottom:16px;">' + esc(t('mandatory_operators_intro')) + '</div>' +
    (eligible.length
      ? eligible.map(function (r) {
          return '<div class="perm-row">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">' +
              '<div><div style="font-weight:700;font-size:13.5px;">' + esc(r.label) + '</div>' +
                '<div class="muted" style="font-size:11px;margin-top:2px;">' + esc(r.code) + '</div></div>' +
              '<label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;flex:none;">' +
                '<input type="checkbox" class="mandatory-operator-cb" data-role-code="' + esc(r.code) + '"' + (r.isMandatoryOperator ? ' checked' : '') + ' /> ' + esc(t('field_is_mandatory_operator')) +
              '</label>' +
            '</div>' +
          '</div>';
        }).join('')
      : '<div class="empty-state">' + esc(t('no_participant_type_roles_yet')) + '</div>');

  content.querySelectorAll('.mandatory-operator-cb').forEach(function (cb) {
    cb.onchange = async function () {
      try {
        await Api.call('setMandatoryOperator', { code: cb.getAttribute('data-role-code'), isMandatoryOperator: cb.checked });
        UI.toast(t('toast_mandatory_operator_updated'), 'success');
      } catch (err) { UI.error(err); cb.checked = !cb.checked; }
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
        '<div style="font-weight:700;font-size:13.5px;">' + esc(role.label) +
          (role.isParticipantType ? ' <span class="badge badge-neutral" style="font-size:10px;">' + esc(t('participant_type_badge')) + '</span>' : '') +
        '</div>' +
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
    // REQ: "Can this [Place/Participant type] be configurable, and allow to add other types." A
    // custom role IS a Place/Participant type option the moment this is checked -- see
    // isParticipantRoleCode_/participantTypes_ (Roles.gs), which fold it into the type dropdown
    // (Venues > Places, Event > Participants) plus every place that already special-cases
    // Vendor/Operator/Exhibitor (event chat blocking, escalation/meeting exclusion).
    '<label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;margin:2px 0 14px;">' +
      '<input type="checkbox" id="fRoleIsParticipantType" /> ' + esc(t('field_is_participant_type')) +
    '</label>' +
    '<div class="muted" style="font-size:11px;margin:-10px 0 12px;">' + esc(t('is_participant_type_hint')) + '</div>' +
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
            creatableBy: readCheckedRoles_('new-role-creatable'),
            isParticipantType: document.getElementById('fRoleIsParticipantType').checked
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
    '<label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;margin:2px 0 14px;">' +
      '<input type="checkbox" id="fERoleIsParticipantType"' + (role.isParticipantType ? ' checked' : '') + ' /> ' + esc(t('field_is_participant_type')) +
    '</label>' +
    '<div class="muted" style="font-size:11px;margin:-10px 0 12px;">' + esc(t('is_participant_type_hint')) + '</div>' +
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
            creatableBy: readCheckedRoles_('edit-role-creatable'),
            isParticipantType: document.getElementById('fERoleIsParticipantType').checked
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
    { id: 'annex', label: t('tab_annex'), eventTab: 'annex' },
    { id: 'annexCategories', label: t('annex_categories_title'), navPath: '/annex-categories' },
    { id: 'disciplinesTab', label: t('tab_disciplines'), eventTab: 'disciplines' },
    { id: 'disciplinesCatalog', label: Term('discipline_plural'), navPath: '/disciplines' },
    { id: 'inspectorQualifications', label: t('qualifications_page_title', { term: Term('inspector_plural') }), navPath: '/inspector-qualifications' },
    { id: 'inspectionsTab', label: t('tab_inspections'), eventTab: 'inspections' },
    { id: 'completedChecklists', label: t('tab_completed_checklists'), navPath: '/completed-checklists' },
    { id: 'checklistItems', label: Term('checklistItem_plural'), navPath: '/checklist-items' },
    { id: 'findingGuide', label: t('finding_guide_title'), navPath: '/finding-guide' },
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
    { id: 'support', label: t('nav_support'), navPath: '/support' },
    // Roadmap Plans (RoadmapPlans.gs) -- 'roadmapPlans' is the shared admin template catalog
    // (Roadmap Plans sidebar page itself); 'roadmap' is working an individual Event's already-rolled-
    // out items, whose real UI home is the Event > Roadmap tab, same eventTab-not-navPath convention
    // as 'findings'/'templates'/etc above.
    { id: 'roadmapPlans', label: t('nav_roadmap_plans'), navPath: '/roadmap-plans' },
    { id: 'roadmap', label: t('tab_roadmap'), eventTab: 'roadmap' },
    // Translation Hub (Translations.gs / translations.js) -- lets a SystemAdmin grant a custom
    // 'Translator' role (Settings > Roles) just this one page via the Permissions matrix below.
    { id: 'translations', label: t('nav_translations'), navPath: '/translations' }
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

// REQ: "In Permissions I would like to set for an Organisation the permissions they can set." data.scope
// ('global' for SystemAdmin, 'org' for a GAAdmin/EMCAdmin/InspectionAdmin -- listPermissions,
// Permissions.gs) drives two things below: (1) SystemAdmin ALSO gets the org-ceiling editor section
// prepended above the matrix (renderOrgCeilingSection_), which an org admin never sees since they can't
// grant ceiling access to anyone; (2) the matrix itself only lists pages that actually have at least
// one permission in `data.permissions` for an org-scoped view, since a page with nothing granted would
// otherwise render as an all-dashes row that just looks broken rather than "not unlocked for you yet".
//
// activeRole ('' = "All") is threaded through every re-render (including the ones triggered by a
// modal Save/Reset below) so picking a filter and then editing a chip doesn't silently reset it.
function renderPermissionsTabBody_(content, data, activeRole) {
  activeRole = activeRole || '';

  if (data.scope === 'org' && !data.permissions.length) {
    content.innerHTML =
      '<div class="muted" style="font-size:12.5px;margin-bottom:16px;">' + esc(t('permissions_org_scope_intro')) + '</div>' +
      '<div class="empty-state">' + esc(t('permissions_org_no_ceiling')) + '</div>';
    return;
  }

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

  // Org-scoped view: only pages that actually have at least one of this org's unlocked keys -- see
  // this function's own header comment above for why (an all-dashes row for a page with nothing
  // granted would read as broken, not "not unlocked yet").
  var pagesToShow = data.scope === 'org' ? permissionPages_().filter(function (page) { return !!byPage[page.id]; }) : permissionPages_();

  var rowsHtml = pagesToShow.map(function (page) {
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
    (data.scope === 'global' ? '<div id="orgCeilingSectionWrap"></div>' : '') +
    '<div class="muted" style="font-size:12.5px;margin-bottom:16px;">' + esc(data.scope === 'org' ? t('permissions_org_scope_intro') : t('permissions_matrix_intro')) + '</div>' +
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

  if (data.scope === 'global') renderOrgCeilingSection_(document.getElementById('orgCeilingSectionWrap'));

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

// REQ: "In Permissions I would like to set for an Organisation the permissions they can set... I meant as
// in Organization Type." SystemAdmin-only section (see renderPermissionsTabBody_'s data.scope === 'global'
// branch above) that lets them pick an Organization Type (GA/EMC/INSPECTION -- same three values as
// Organizations.type/Users.orgType, users.js' ROLE_ORG_TYPE) and choose exactly which permission keys
// every org of that type's own admins (GAAdmin/EMCAdmin/InspectionAdmin) are allowed to reconfigure via
// the matrix above -- backed by getOrgTypePermissionCeiling/setOrgTypePermissionCeiling (Permissions.gs,
// stored in Config, not on any individual Organizations row: one ceiling covers every org of that type).
// A type with nothing checked here is exactly the case renderPermissionsTabBody_'s org-scope empty-state
// handles for that type's own admins.
//
// The last-picked type persists at module level (not local to one render) for the same reason
// HululTranslationState_ does in translations.js -- this whole section gets torn down and rebuilt by
// renderPermissionsTabBody_ on every role-filter click and every matrix chip Save/Reset, and losing the
// admin's type selection on every one of those would be annoying.
var HululCeilingOrgType_ = null;
var CEILING_ORG_TYPES_ = ['GA', 'EMC', 'INSPECTION'];

function ceilingOrgTypeLabel_(orgType) {
  return orgType === 'GA' ? t('org_type_ga') : orgType === 'EMC' ? t('org_type_emc') : t('org_type_inspection');
}

async function renderOrgCeilingSection_(wrap) {
  if (!wrap) return;
  var orgType = CEILING_ORG_TYPES_.indexOf(HululCeilingOrgType_) !== -1 ? HululCeilingOrgType_ : CEILING_ORG_TYPES_[0];
  await loadAndRenderOrgCeilingFor_(wrap, orgType);
}

async function loadAndRenderOrgCeilingFor_(wrap, orgType) {
  HululCeilingOrgType_ = orgType;
  wrap.innerHTML = '<div class="card" style="margin-bottom:16px;"><div class="card-body"><div class="empty-state">' + esc(t('loading')) + '</div></div></div>';

  var data;
  try { data = await Api.call('getOrgTypePermissionCeiling', { orgType: orgType }); }
  catch (err) { UI.error(err); return; }

  var checkedSet = {};
  (data.keys || []).forEach(function (k) { checkedSet[k] = true; });

  // catalog (every PERMISSION_REGISTRY_ key, Permissions.gs) grouped by module -- same "module" field
  // the backend already attaches to each entry, mirroring the matrix's own page-based grouping above
  // without needing a second lookup table here.
  var byModule = {};
  var moduleOrder = [];
  (data.catalog || []).forEach(function (entry) {
    if (!byModule[entry.module]) { byModule[entry.module] = []; moduleOrder.push(entry.module); }
    byModule[entry.module].push(entry);
  });

  var groupsHtml = moduleOrder.map(function (mod) {
    var itemsHtml = byModule[mod].map(function (entry) {
      return '<label class="perm-ceiling-item" style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:12.5px;">' +
        '<input type="checkbox" class="ceiling-key-chk" value="' + esc(entry.key) + '"' + (checkedSet[entry.key] ? ' checked' : '') + ' /> ' +
        esc(entry.label) +
        '</label>';
    }).join('');
    return '<div style="margin-bottom:10px;">' +
      '<div style="font-weight:600;font-size:12px;color:var(--text-600);margin-bottom:4px;">' + esc(mod) + '</div>' +
      itemsHtml +
      '</div>';
  }).join('');

  var typePickerHtml = '<div style="margin-bottom:14px;max-width:280px;">' + UI.field(t('field_organization_type'),
    '<select id="fCeilingOrgType" class="field-input">' +
      CEILING_ORG_TYPES_.map(function (ot) { return '<option value="' + ot + '"' + (ot === orgType ? ' selected' : '') + '>' + esc(ceilingOrgTypeLabel_(ot)) + '</option>'; }).join('') +
    '</select>') + '</div>';

  wrap.innerHTML =
    '<div class="card" style="margin-bottom:16px;"><div class="card-body">' +
      '<div class="perm-filter-title" style="margin-bottom:6px;">' + esc(t('permissions_ceiling_title')) + '</div>' +
      '<div class="muted" style="font-size:12.5px;margin-bottom:12px;">' + esc(t('permissions_ceiling_intro')) + '</div>' +
      typePickerHtml +
      '<div style="max-height:320px;overflow:auto;border:1px solid #f0f1f6;border-radius:8px;padding:10px 12px;margin-bottom:12px;">' +
        (groupsHtml || '<div class="empty-state">' + esc(t('no_matches')) + '</div>') +
      '</div>' +
      '<button class="btn btn-primary btn-sm" id="saveCeilingBtn">' + esc(t('save')) + '</button>' +
    '</div></div>';

  document.getElementById('fCeilingOrgType').onchange = function () {
    loadAndRenderOrgCeilingFor_(wrap, this.value);
  };

  document.getElementById('saveCeilingBtn').onclick = async function () {
    var keys = Array.prototype.slice.call(wrap.querySelectorAll('.ceiling-key-chk:checked')).map(function (chk) { return chk.value; });
    var btn = document.getElementById('saveCeilingBtn');
    btn.disabled = true;
    try {
      await Api.call('setOrgTypePermissionCeiling', { orgType: orgType, keys: keys });
      UI.toast(t('permissions_ceiling_saved'), 'success');
    } catch (err) { UI.error(err); }
    btn.disabled = false;
  };
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
