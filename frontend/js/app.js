/**
 * HULUL - app bootstrap: login flow, sidebar, topbar wiring, router init.
 */
// entityLabel (when present) overrides the i18n `label` key with a live custom-terminology lookup
// (Term()), so a rename like Events -> Projects shows up in the nav without touching i18n.js.
var NAV_ITEMS = [
  { path: '/dashboard', icon: '🏠', label: 'nav_dashboard', section: 'section_main' },
  { path: '/projects', icon: '📁', label: 'nav_projects', entityLabel: 'project_plural', section: 'section_main' },
  { path: '/events', icon: '📅', label: 'nav_events', entityLabel: 'event_plural', section: 'section_main' },
  { path: '/sub-events', icon: '🧩', label: 'nav_subevents', entityLabel: 'subEvent_plural', section: 'section_main',
    roles: ['SystemAdmin', 'GAAdmin', 'GAUser', 'EventManager'] },
  { path: '/meetings', icon: '🗓️', label: 'nav_meetings', entityLabel: 'meeting_plural', section: 'section_main',
    roles: ['SystemAdmin', 'InspectionAdmin', 'ProjectManager', 'EMCManager'] },
  { path: '/notifications', icon: '🔔', label: 'nav_notifications', section: 'section_main' },
  { path: '/users', icon: '👥', label: 'nav_users', section: 'section_admin',
    roles: ['SystemAdmin', 'GAAdmin', 'EMCAdmin', 'InspectionAdmin'] },
  { path: '/organizations', icon: '🏢', label: 'nav_orgs', section: 'section_admin', roles: ['SystemAdmin'] },
  { path: '/venues', icon: '📍', label: 'nav_venues', entityLabel: 'venue_plural', section: 'section_admin',
    roles: ['SystemAdmin', 'EMCAdmin', 'EMCManager'] },
  { path: '/disciplines', icon: '🛡️', label: 'nav_disciplines', entityLabel: 'discipline_plural', section: 'section_admin',
    roles: ['SystemAdmin', 'InspectionAdmin'] },
  { path: '/checklist-items', icon: '✅', label: 'nav_checklist', entityLabel: 'checklistItem_plural', section: 'section_admin',
    roles: ['SystemAdmin', 'InspectionAdmin', 'ProjectManager'] },
  { path: '/inspector-qualifications', icon: '🎓', label: 'nav_qualifications', section: 'section_admin',
    entityLabelFn: function () { return Term('inspector_plural') + ' Qualifications'; },
    roles: ['SystemAdmin', 'InspectionAdmin', 'ProjectManager'] },
  { path: '/template-library', icon: '📚', label: 'nav_template_library', section: 'section_admin',
    entityLabelFn: function () { return Term('template_plural') + ' Library'; },
    roles: ['SystemAdmin', 'InspectionAdmin', 'ProjectManager'] },
  { path: '/config', icon: '🛠️', label: 'nav_config', section: 'section_admin', roles: ['SystemAdmin'] },
  { path: '/settings', icon: '⚙️', label: 'nav_settings', section: 'section_admin' }
];

function showLogin() {
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('appShell').classList.add('hidden');
}
async function showApp() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('appShell').classList.remove('hidden');
  await loadOrgLabels();
  await loadAppIcons();
  renderSidebar();
  renderUserChip();
  refreshNotifBadge();
  loadOrgLogo();
}

// Loads the SystemAdmin's sidebar icon overrides (Settings > Icons) once per session -- same
// caching pattern as loadOrgLabels above. App-wide (not per-org), so every user sees the same
// overrides regardless of which organization they belong to.
async function loadAppIcons() {
  if (HululState.appIconsLoaded) return;
  HululState.appIconsLoaded = true;
  try { HululState.appIcons = await Api.call('getAppIcons', {}); }
  catch (e) { HululState.appIcons = {}; }
}

// Loads the signed-in user's org's custom terminology (e.g. "Events" -> "Projects") once per
// session — same caching pattern as loadOrgLogo below. Awaited before the sidebar/nav render so
// nav labels are correct on first paint instead of flashing the defaults then relabeling.
async function loadOrgLabels() {
  if (HululState.orgLabelsLoaded) return;
  HululState.orgLabelsLoaded = true;
  try { HululState.orgLabels = await Api.call('getOrgLabels', {}); }
  catch (e) { HululState.orgLabels = {}; }
}

// Shows the signed-in user's GA/EMC/Inspection Company logo in the topbar on every page.
// showApp() runs on every route change, but the logo only needs fetching once per session — the
// orgLogoLoaded flag skips the repeat calls; a full page reload (or fresh login) picks up any
// change a SystemAdmin made in the meantime.
async function loadOrgLogo() {
  var img = document.getElementById('orgLogoImg');
  if (HululState.orgLogoLoaded) {
    if (HululState.orgLogoUrl) { img.src = HululState.orgLogoUrl; img.title = (HululState.orgName || ''); img.classList.remove('hidden'); } else img.classList.add('hidden');
    return;
  }
  HululState.orgLogoLoaded = true;
  try {
    var org = await Api.call('getMyOrg', {});
    HululState.orgLogoUrl = org && org.logoUrl ? org.logoUrl : '';
    HululState.orgName = org && org.name ? org.name : '';
  } catch (e) { HululState.orgLogoUrl = ''; }
  if (HululState.orgLogoUrl) { img.src = HululState.orgLogoUrl; img.title = (HululState.orgName || ''); img.classList.remove('hidden'); }
  else img.classList.add('hidden');
}

function renderSidebar() {
  var search = document.getElementById('globalSearch');
  if (search) search.placeholder = 'Search ' + Term('event_plural').toLowerCase() + ', ' + Term('finding_plural').toLowerCase() + ', users…';
  var nav = document.getElementById('sidebarNav');
  var sections = {};
  NAV_ITEMS.forEach(function (item) {
    if (item.roles && HululState.user && item.roles.indexOf(HululState.user.role) === -1) return;
    sections[item.section] = sections[item.section] || [];
    sections[item.section].push(item);
  });
  var html = '';
  Object.keys(sections).forEach(function (sectionKey) {
    html += '<div class="nav-section">' + t(sectionKey) + '</div>';
    sections[sectionKey].forEach(function (item) {
      var label = item.entityLabelFn ? item.entityLabelFn() : (item.entityLabel ? Term(item.entityLabel) : t(item.label));
      var icon = (HululState.appIcons && HululState.appIcons[item.path]) || item.icon;
      html += '<a class="nav-item" data-path="' + item.path + '" href="#' + item.path + '">' +
        '<span class="nav-icon">' + icon + '</span><span class="nav-label">' + esc(label) + '</span></a>';
    });
  });
  html += '<div class="nav-item" id="logoutNavItem" style="margin-top:auto;cursor:pointer;">' +
    '<span class="nav-icon">' + ICON('logout') + '</span><span class="nav-label">' + t('nav_logout') + '</span></div>';
  nav.innerHTML = html;
  document.getElementById('logoutNavItem').onclick = doLogout;
}

function renderUserChip() {
  var u = HululState.user;
  if (!u) return;
  document.getElementById('userAvatar').textContent = (u.name || '?').slice(0, 1).toUpperCase();
  document.getElementById('userChipName').textContent = u.name;
  document.getElementById('userChipRole').textContent = u.role;
}

async function doLogout() {
  try { await Api.call('logout', {}); } catch (e) {}
  HululState.clearSession();
  window.location.hash = '#/dashboard';
  showLogin();
}

// showApp() used to call this on *every* route change (i.e. every menu click), which meant an
// extra full Apps Script round trip -- on top of whatever the destination page itself needed to
// load -- just to redraw a badge that, most of the time, hadn't changed since the last click.
// NOTIF_BADGE_MIN_INTERVAL_MS below throttles the navigation-triggered calls to once per window;
// force=true (used by the explicit mark-read/delete/clear-all call sites, and by the periodic
// poll set up in boot()) always hits the network so those stay instant/accurate.
var NOTIF_BADGE_MIN_INTERVAL_MS_ = 30000;

async function refreshNotifBadge(force) {
  if (!force && Date.now() - HululState.notifBadgeLoadedAt < NOTIF_BADGE_MIN_INTERVAL_MS_) return;
  HululState.notifBadgeLoadedAt = Date.now();
  try {
    var list = await Api.call('listNotifications', { unreadOnly: true, limit: 50 });
    HululState.notifications = list;
    var badge = document.getElementById('notifBadge');
    if (list.length > 0) { badge.textContent = list.length; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');
  } catch (e) { /* not fatal */ }
}

function wireChrome() {
  document.getElementById('loginForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var email = document.getElementById('loginEmail').value.trim();
    var password = document.getElementById('loginPassword').value;
    var errBox = document.getElementById('loginError');
    errBox.classList.add('hidden');
    try {
      var res = await Api.call('login', { email: email, password: password });
      HululState.setSession(res.token, res.user);
      window.location.hash = '#/dashboard';
      Router.resolve();
    } catch (err) {
      errBox.textContent = err.message || 'Login failed';
      errBox.classList.remove('hidden');
    }
  });

  document.getElementById('langToggleLogin').onclick = toggleLanguage;
  document.getElementById('langToggleApp').onclick = toggleLanguage;
  document.getElementById('sidebarCollapseBtn').onclick = function () {
    document.getElementById('sidebar').classList.toggle('collapsed');
  };
  document.getElementById('mobileNavBtn').onclick = function () {
    document.getElementById('sidebar').classList.toggle('mobile-open');
  };
  document.getElementById('notifBtn').onclick = async function () {
    var panel = document.getElementById('notifPanel');
    if (!panel.classList.contains('hidden')) { panel.classList.add('hidden'); return; }
    try {
      var list = await Api.call('listNotifications', { limit: 30 });
      renderNotifPanel_(list);
      panel.classList.remove('hidden');
    } catch (err) { UI.error(err); }
  };
}

// Topbar bell dropdown -- a lightweight preview of the full Notifications page. Re-rendered after
// every clear/clear-all so the list and the unread badge (refreshNotifBadge) stay in sync without
// closing the panel.
function renderNotifPanel_(list) {
  var panel = document.getElementById('notifPanel');
  var byId = {}; list.forEach(function (n) { byId[n.id] = n; });
  panel.innerHTML =
    '<div class="notif-panel-header"><span>' + esc(t('nav_notifications')) + '</span>' +
    (list.length ? '<button class="btn btn-secondary btn-sm" id="clearAllNotifBtn">Clear all</button>' : '') + '</div>' +
    (list.length
      ? list.map(function (n) {
          // notifTargetHash_/NOTIF_TAB_BY_RELATED_ live in notifications.js (loaded before this file).
          var clickable = !!notifTargetHash_(n);
          return '<div class="notif-item"><div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">' +
            '<div data-goto-notif="' + n.id + '" style="flex:1;min-width:0;' + (clickable ? 'cursor:pointer;' : '') + '"><div>' + esc(n.message) + '</div><div class="meta">' + UI.fmtDate(n.createdAt) + '</div></div>' +
            '<button class="btn btn-secondary btn-sm btn-icon" title="Clear" data-clear-notif="' + n.id + '" style="flex:none;">' + ICON('clear') + '</button>' +
          '</div></div>';
        }).join('')
      : '<div class="empty-state">' + t('no_data') + '</div>');

  panel.querySelectorAll('[data-goto-notif]').forEach(function (el) {
    el.onclick = function () {
      var n = byId[el.getAttribute('data-goto-notif')];
      if (n) { document.getElementById('notifPanel').classList.add('hidden'); goToNotification_(n); }
    };
  });
  panel.querySelectorAll('[data-clear-notif]').forEach(function (btn) {
    btn.onclick = async function (e) {
      e.stopPropagation();
      try {
        await Api.call('deleteNotification', { notificationId: btn.getAttribute('data-clear-notif') });
        renderNotifPanel_(await Api.call('listNotifications', { limit: 30 }));
        refreshNotifBadge(true);
      } catch (err) { UI.error(err); }
    };
  });
  var clearAllBtn = document.getElementById('clearAllNotifBtn');
  if (clearAllBtn) clearAllBtn.onclick = async function (e) {
    e.stopPropagation();
    try { await Api.call('clearAllNotifications', {}); renderNotifPanel_([]); refreshNotifBadge(true); }
    catch (err) { UI.error(err); }
  };
}

// Lets a QR code (see the Places page's account credentials modal in venues.js) open the app
// pre-authenticated, without the scanner ever typing an email/password -- see redeemQuickLogin in
// Places.gs. Must run before Router.resolve() takes over: that function always forces the login
// screen first whenever no session is loaded yet, so by the time a route could otherwise handle
// '#/quick-login' it's already too late.
async function maybeHandleQuickLogin_() {
  var m = (window.location.hash || '').match(/^#\/quick-login\?(.*)$/);
  if (!m) return;
  var params = {};
  m[1].split('&').forEach(function (pair) {
    var kv = pair.split('=');
    if (kv[0]) params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
  });
  window.location.hash = '#/dashboard'; // clear the token out of the address bar either way
  if (!params.token) return;
  try {
    var res = await Api.call('redeemQuickLogin', { token: params.token });
    HululState.setSession(res.token, res.user);
  } catch (err) { /* invalid/deactivated token -- falls through to the normal login screen */ }
}

async function boot() {
  document.documentElement.lang = HululState.lang;
  document.documentElement.dir = HululState.lang === 'ar' ? 'rtl' : 'ltr';
  setTheme(HululState.theme);
  applyI18n();
  await maybeHandleQuickLogin_();
  wireChrome();
  Router.init();
  Router.resolve();
  // Navigation no longer force-refreshes the badge (see refreshNotifBadge), so poll it on a timer
  // instead -- keeps it from going stale during a long stretch on one page, without adding a
  // network call to every single click.
  setInterval(function () { if (HululState.token) refreshNotifBadge(true); }, NOTIF_BADGE_MIN_INTERVAL_MS_ * 2);
}

document.addEventListener('DOMContentLoaded', boot);
