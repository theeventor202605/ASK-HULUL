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
  // REQ: "Add Sidebar Re-assignment... assignments related to the user will appear and can be
  // assigned to temporary another user." Same manager-ish roles as listUsers/Reassignment.gs's own
  // REASSIGNMENT_MANAGER_ROLES_ -- kept in sync manually since nav gating is frontend-only (the
  // backend enforces its own copy regardless of what this list shows).
  { path: '/reassignment', icon: '🔁', label: 'nav_reassignment', section: 'section_main',
    roles: ['SystemAdmin', 'GAAdmin', 'EMCAdmin', 'InspectionAdmin', 'EMCManager', 'ProjectManager'] },
  // Support/SystemAdmin see the whole shared queue here (support.js's renderSupport branches on
  // role); everyone else sees only "My Tickets" -- the ones they've personally raised via the
  // #supportBtn capture flow (wireChrome below) -- so this stays visible to every role, no
  // `roles` restriction, unlike the admin-only items further down.
  { path: '/support', icon: '🛟', label: 'nav_support', section: 'section_main' },
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
    entityLabelFn: function () { return t('qualifications_page_title', { term: Term('inspector_plural') }); },
    roles: ['SystemAdmin', 'InspectionAdmin', 'ProjectManager'] },
  { path: '/template-library', icon: '📚', label: 'nav_template_library', section: 'section_admin',
    entityLabelFn: function () { return t('template_library_title', { term: Term('template_plural') }); },
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
  await loadPermissions();
  renderSidebar();
  renderUserChip();
  refreshNotifBadge();
  refreshEscalationAlert();
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

// Loads the signed-in user's effective RBAC permission map (see permissions.js's hasPermission,
// backend/Permissions.gs's getMyPermissions) once per session -- same caching pattern as
// loadAppIcons above. Foundation + Findings pilot module only for now.
async function loadPermissions() {
  if (HululState.permissionsLoaded) return;
  HululState.permissionsLoaded = true;
  try { HululState.permissions = await Api.call('getMyPermissions', {}); }
  catch (e) { HululState.permissions = {}; }
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
  if (search) search.placeholder = t('search_placeholder', { events: Term('event_plural').toLowerCase(), findings: Term('finding_plural').toLowerCase() });
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

// REQ: "Blinking Alert icon will be visible on the top bar with count badge." Mirrors
// refreshNotifBadge's own throttle/force pattern above. listMyPendingEscalations now returns
// { lockScreenEnabled, items } (items = every un-resolved escalation where I'm a To recipient and
// haven't clicked Noted yet, newest first -- Cc recipients never appear here, see "To only").
//
// REQ: "Latest only + badge" -- of any un-Noted escalations, only the single newest one ever
// triggers the full-screen lock; older ones stay reflected in the badge count only.
// escalationLockShownId tracks which one (if any) is currently locking the screen so a repeat poll
// doesn't re-show/reset a lock the user is already looking at, and so a fresh, newer escalation
// correctly replaces an older one still on screen.
async function refreshEscalationAlert(force) {
  if (!force && Date.now() - HululState.escalationAlertLoadedAt < NOTIF_BADGE_MIN_INTERVAL_MS_) return;
  HululState.escalationAlertLoadedAt = Date.now();
  try {
    var res = await Api.call('listMyPendingEscalations', {});
    var items = res.items || [];
    var btn = document.getElementById('escAlertBtn');
    var badge = document.getElementById('escAlertBadge');
    if (btn && badge) {
      if (items.length > 0) { badge.textContent = items.length; btn.classList.remove('hidden'); }
      else btn.classList.add('hidden');
    }

    var latest = items[0];
    if (res.lockScreenEnabled && latest) {
      if (HululState.escalationLockShownId !== latest.id) {
        HululState.escalationLockShownId = latest.id;
        showEscalationLock_(latest);
      }
    } else {
      HululState.escalationLockShownId = null;
      hideEscalationLock_();
    }
  } catch (e) { /* not fatal */ }
}

// REQ: "the recipient user screen locks with red alert and outline around the screen. To remove
// alert user must clicks Noted. This takes user to the Escalation screen with the risk selected and
// details displayed." item is one entry from listMyPendingEscalations (finding/event context
// already joined server-side).
function showEscalationLock_(item) {
  var overlay = document.getElementById('escalationLockOverlay');
  if (!overlay) return;
  overlay.innerHTML =
    '<div class="escalation-lock-box">' +
      '<div class="escalation-lock-icon">⚠️</div>' +
      '<div class="escalation-lock-tier">' + esc(t('tier_x_escalation', { tier: item.tier })) + '</div>' +
      '<div class="escalation-lock-title">' + esc(item.eventName || '') + '</div>' +
      '<div class="escalation-lock-meta">' + UI.riskBadge(item.riskLevel) + ' ' +
        esc(item.findingCategory || '') +
        (item.subZone ? ' · ' + esc(item.subZone) : '') + (item.location ? ' · ' + esc(item.location) : '') +
      '</div>' +
      '<div class="escalation-lock-desc">' + esc(item.findingDescription || '') + '</div>' +
      '<button class="btn btn-primary" id="escalationLockNotedBtn">' + esc(t('noted_btn')) + '</button>' +
    '</div>';
  overlay.classList.remove('hidden');
  document.getElementById('escalationLockNotedBtn').onclick = async function () {
    var btn = this;
    btn.disabled = true;
    try {
      await Api.call('acknowledgeEscalation', { escalationId: item.id });
      HululState.escalationLockShownId = null;
      hideEscalationLock_();
      // REQ: "takes user to the Escalation screen with the risk selected and details displayed" --
      // same ?tab=<x>&focus=<id> pattern already used by the chat log's own "jump to this item" link.
      window.location.hash = '#/events/' + item.eventId + '?tab=escalations&focus=' + item.id;
      refreshEscalationAlert(true);
    } catch (err) { btn.disabled = false; UI.error(err); }
  };
}

function hideEscalationLock_() {
  var overlay = document.getElementById('escalationLockOverlay');
  if (overlay) { overlay.classList.add('hidden'); overlay.innerHTML = ''; }
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
      errBox.textContent = err.message || t('toast_login_failed');
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
  // openSupportCapture lives in js/views/support.js (loaded before this file, see index.html) --
  // takes a DOM screenshot of whatever page is currently open behind it (REQ: report an issue from
  // anywhere in the app) and walks the user through annotate -> voice note -> remarks -> submit.
  document.getElementById('supportBtn').onclick = function () { openSupportCapture(); };
  // Clicking the blinking alert icon jumps straight to the newest pending escalation, same
  // destination the lock overlay's own Noted button navigates to -- it does NOT clear/Noted it
  // (that's a deliberate act only the overlay's button performs); this is just a shortcut in case
  // the lock is disabled in Settings (lockScreenEnabled:false) or the user dismissed it earlier.
  var escBtn = document.getElementById('escAlertBtn');
  if (escBtn) escBtn.onclick = async function () {
    try {
      var res = await Api.call('listMyPendingEscalations', {});
      var latest = (res.items || [])[0];
      if (latest) window.location.hash = '#/events/' + latest.eventId + '?tab=escalations&focus=' + latest.id;
    } catch (err) { UI.error(err); }
  };
  document.getElementById('notifBtn').onclick = async function (e) {
    e.stopPropagation(); // don't let this same click immediately re-trigger the outside-click closer below
    var panel = document.getElementById('notifPanel');
    if (!panel.classList.contains('hidden')) { panel.classList.add('hidden'); return; }
    try {
      var list = await Api.call('listNotifications', { limit: 30 });
      renderNotifPanel_(list);
      panel.classList.remove('hidden');
    } catch (err) { UI.error(err); }
  };

  // REQ bug report: the notif panel only closed by clicking the bell again -- clicking anywhere
  // else (including a sidebar nav link, which then navigates the page out from under it) left it
  // stuck open. notifBtn's own click is excluded above (stopPropagation) since that click has its
  // own open/close toggle logic; every other click anywhere in the document closes the panel if
  // it's open, whether or not that same click also does something else (e.g. navigate).
  document.addEventListener('click', function (e) {
    var panel = document.getElementById('notifPanel');
    if (panel.classList.contains('hidden')) return;
    if (panel.contains(e.target)) return; // clicking inside the panel (mark read / clear / etc.) shouldn't close it
    panel.classList.add('hidden');
  });
  // Covers navigation that isn't itself a click inside this document -- browser Back/Forward, or a
  // notification's own "jump to this item" (goToNotification_ already hides it directly, but this
  // is a harmless no-op in that case, and a real fix for every other hash change).
  window.addEventListener('hashchange', function () {
    var panel = document.getElementById('notifPanel');
    if (panel) panel.classList.add('hidden');
  });
}

// Topbar bell dropdown -- a lightweight preview of the full Notifications page. Re-rendered after
// every clear/clear-all so the list and the unread badge (refreshNotifBadge) stay in sync without
// closing the panel.
function renderNotifPanel_(list) {
  var panel = document.getElementById('notifPanel');
  var byId = {}; list.forEach(function (n) { byId[n.id] = n; });
  panel.innerHTML =
    '<div class="notif-panel-header"><span>' + esc(t('nav_notifications')) + '</span>' +
    (list.length ? '<button class="btn btn-secondary btn-sm" id="clearAllNotifBtn">' + esc(t('clear_all_btn')) + '</button>' : '') + '</div>' +
    (list.length
      ? list.map(function (n) {
          // notifTargetHash_/NOTIF_TAB_BY_RELATED_ live in notifications.js (loaded before this file).
          var clickable = !!notifTargetHash_(n);
          return '<div class="notif-item"><div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">' +
            '<div data-goto-notif="' + n.id + '" style="flex:1;min-width:0;' + (clickable ? 'cursor:pointer;' : '') + '"><div>' + esc(n.message) + '</div><div class="meta">' + UI.fmtDate(n.createdAt) + '</div></div>' +
            '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('clear_title')) + '" data-clear-notif="' + n.id + '" style="flex:none;">' + ICON('clear') + '</button>' +
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
  // REQ: full-screen lock must appear even if the affected user is sitting idle on one page --
  // reuses the same 60s cadence as the notif badge poll above rather than adding a third timer.
  setInterval(function () { if (HululState.token) refreshEscalationAlert(true); }, NOTIF_BADGE_MIN_INTERVAL_MS_ * 2);
}

document.addEventListener('DOMContentLoaded', boot);
