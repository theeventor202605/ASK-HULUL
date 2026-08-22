/**
 * HULUL - app bootstrap: login flow, sidebar, topbar wiring, router init.
 */
// entityLabel (when present) overrides the i18n `label` key with a live custom-terminology lookup
// (Term()), so a rename like Events -> Projects shows up in the nav without touching i18n.js.
var NAV_ITEMS = [
  { path: '/dashboard', icon: LUCIDE_ICONS['layout-dashboard'], label: 'nav_dashboard', section: 'section_main' },
  // REQ: "Add to do inbox where it will show all pending items on a user." Open to every signed-in
  // user (no `roles` restriction) -- same as Dashboard/Notifications/Support just above/below: it's
  // entirely self-scoped server-side (listMyTodoItems, Todo.gs), not a permission-gated admin page.
  { path: '/todo', icon: LUCIDE_ICONS['clipboard-check'], label: 'nav_todo', section: 'section_main' },
  { path: '/projects', icon: LUCIDE_ICONS['folder'], label: 'nav_projects', entityLabel: 'project_plural', section: 'section_main' },
  { path: '/events', icon: LUCIDE_ICONS['calendar-days'], label: 'nav_events', entityLabel: 'event_plural', section: 'section_main' },
  { path: '/sub-events', icon: LUCIDE_ICONS['puzzle'], label: 'nav_subevents', entityLabel: 'subEvent_plural', section: 'section_main',
    roles: ['SystemAdmin', 'GAAdmin', 'GAUser', 'EventManager'] },
  { path: '/meetings', icon: LUCIDE_ICONS['calendar-clock'], label: 'nav_meetings', entityLabel: 'meeting_plural', section: 'section_main',
    roles: ['SystemAdmin', 'InspectionAdmin', 'ProjectManager', 'EMCManager'] },
  // REQ: "Move Venues to Main section above Notifications." -- was under Administration; roles
  // unchanged (still just SystemAdmin/EMCAdmin/EMCManager), only its section/position moved.
  { path: '/venues', icon: LUCIDE_ICONS['map-pin'], label: 'nav_venues', entityLabel: 'venue_plural', section: 'section_main',
    roles: ['SystemAdmin', 'EMCAdmin', 'EMCManager'] },
  // REQ: "Add Roadmap sidebar where they will be able to add types of plan." A standalone sidebar
  // entry (not a Settings tab, unlike Roles/Icons/Permissions); roles mirror roadmapPlan.manage's
  // own default roles (Permissions.gs) so this doesn't show for someone who'd just hit a 403 opening
  // it -- the RBAC-pilot permission check inside RoadmapPlans.gs itself is still what actually
  // enforces it either way. REQ follow-up: "Move Roadmap one level up in sidebar" -- was under
  // Administration; same "promote into Main, right after the other Events-adjacent entries"
  // treatment Venues got above (see its own comment); roles/enforcement unchanged, only its
  // section/position moved.
  { path: '/roadmap-plans', icon: LUCIDE_ICONS['flag'], label: 'nav_roadmap_plans', section: 'section_main',
    roles: ['SystemAdmin', 'GAAdmin'] },
  // REQ: "Add Log sidebar, which allows inspector to add logs to any event under his inspection
  // company." A cross-event entry point -- unlike the Risk Logging tab (scoped to whichever one
  // Event workspace you're already inside), this lets an Inspector jump straight to logging a Risk
  // Log against ANY event their own Inspection Company runs, gated by proximity (renderAddLogPicker_,
  // findings.js) rather than by which event tab they happened to have open.
  { path: '/add-log', icon: LUCIDE_ICONS['plus'], label: 'nav_add_log', section: 'section_main',
    roles: ['Inspector', 'SystemAdmin'] },
  { path: '/notifications', icon: LUCIDE_ICONS['bell'], label: 'nav_notifications', section: 'section_main' },
  // REQ: "Add Sidebar Re-assignment... assignments related to the user will appear and can be
  // assigned to temporary another user." Same manager-ish roles as the reassignment.manage
  // permission's default roles (Reassignment.gs, backend/Permissions.gs) -- kept in sync manually
  // since nav gating is frontend-only (the backend enforces its own, admin-configurable copy
  // regardless of what this list shows).
  { path: '/reassignment', icon: LUCIDE_ICONS['repeat'], label: 'nav_reassignment', section: 'section_main',
    roles: ['SystemAdmin', 'GAAdmin', 'EMCAdmin', 'InspectionAdmin', 'EMCManager', 'ProjectManager'] },
  // Support/SystemAdmin see the whole shared queue here (support.js's renderSupport branches on
  // role); everyone else sees only "My Tickets" -- the ones they've personally raised via the
  // #supportBtn capture flow (wireChrome below) -- so this stays visible to every role, no
  // `roles` restriction, unlike the admin-only items further down.
  { path: '/support', icon: LUCIDE_ICONS['life-buoy'], label: 'nav_support', section: 'section_main' },
  { path: '/users', icon: LUCIDE_ICONS['users'], label: 'nav_users', section: 'section_admin',
    roles: ['SystemAdmin', 'GAAdmin', 'EMCAdmin', 'InspectionAdmin'] },
  { path: '/organizations', icon: LUCIDE_ICONS['building-2'], label: 'nav_orgs', section: 'section_admin', roles: ['SystemAdmin'] },
  { path: '/disciplines', icon: LUCIDE_ICONS['shield-check'], label: 'nav_disciplines', entityLabel: 'discipline_plural', section: 'section_admin',
    roles: ['SystemAdmin', 'InspectionAdmin'] },
  { path: '/checklist-items', icon: LUCIDE_ICONS['list-checks'], label: 'nav_checklist', entityLabel: 'checklistItem_plural', section: 'section_admin',
    roles: ['SystemAdmin', 'InspectionAdmin', 'ProjectManager'] },
  // REQ: "Some inspectors are junior level and could use help. We have created a guide which should
  // give them a list of descriptions once they select the category and sub-category." Same admin
  // audience as Checklist Items -- whoever maintains that catalogue also maintains this one.
  { path: '/finding-guide', icon: LUCIDE_ICONS['lightbulb'], label: 'nav_finding_guide', section: 'section_admin',
    roles: ['SystemAdmin', 'InspectionAdmin', 'ProjectManager'] },
  // REQ follow-up: "I would rather have this part of the inspection setup so the responsible person
  // can make changes or add new categories and mark default required uploads." Same admin audience as
  // the other catalogue-maintenance pages in this group.
  { path: '/annex-categories', icon: LUCIDE_ICONS['file-check'], label: 'nav_annex_categories', section: 'section_admin',
    roles: ['SystemAdmin', 'InspectionAdmin', 'ProjectManager'] },
  { path: '/inspector-qualifications', icon: LUCIDE_ICONS['graduation-cap'], label: 'nav_qualifications', section: 'section_admin',
    entityLabelFn: function () { return t('qualifications_page_title', { term: Term('inspector_plural') }); },
    roles: ['SystemAdmin', 'InspectionAdmin', 'ProjectManager'] },
  { path: '/template-library', icon: LUCIDE_ICONS['library'], label: 'nav_template_library', section: 'section_admin',
    entityLabelFn: function () { return t('template_library_title', { term: Term('template_plural') }); },
    roles: ['SystemAdmin', 'InspectionAdmin', 'ProjectManager'] },
  // REQ-ACC-10: "immutable audit log of all account-management actions." listAuditLog (Accounts.gs)
  // and its 'auditLog.view' permission already existed; this nav entry (and audit-log route/view)
  // were the missing piece -- same default-roles set as 'auditLog.view' (backend/Permissions.gs).
  { path: '/audit-log', icon: LUCIDE_ICONS['clipboard-list'], label: 'nav_audit_log', section: 'section_admin',
    roles: ['SystemAdmin', 'GAAdmin', 'EMCAdmin', 'InspectionAdmin'] },
  // REQ: "We have a team of translators ... having an interface for this specific task would be
  // helpful." roles here matches translation.manage's own defaultRoles (Permissions.gs) -- a
  // SystemAdmin-created 'Translator' custom role (Settings > Roles) sees this nav item too, via the
  // pageAccess OR-branch in navItemVisible_ below, with no code change needed.
  { path: '/translations', icon: LUCIDE_ICONS['globe'], label: 'nav_translations', section: 'section_admin',
    roles: ['SystemAdmin', 'InspectionAdmin', 'ProjectManager'] },
  { path: '/settings', icon: LUCIDE_ICONS['settings'], label: 'nav_settings', section: 'section_admin' }
];

// REQ: "Can you group the sidebar?" -- collapsible sub-groups within each section (Main/
// Administration), same purely-visual grouping-on-top-of-a-flat-list idea as EVENT_TAB_GROUPS_
// (eventDetail.js) already does for a single Event's own tab bar: every path/role/permission still
// lives on NAV_ITEMS above, this only controls how they're clustered and labeled underneath each
// section header. A group with only one VISIBLE path (either a deliberately standalone entry here,
// or a multi-path group reduced to one by role/permission filtering) renders as a plain link, not a
// redundant one-item dropdown -- same convention as EVENT_TAB_GROUPS_.
var NAV_GROUPS_ = [
  { section: 'section_main', paths: ['/dashboard'] },
  { section: 'section_main', paths: ['/todo'] },
  { section: 'section_main', key: 'eventsGroup', labelKey: 'nav_group_events', paths: ['/projects', '/events', '/sub-events', '/meetings'] },
  // REQ: "Move Venues to Main section above Notifications."
  { section: 'section_main', paths: ['/venues'] },
  // REQ follow-up: "Move Roadmap one level up in sidebar" -- promoted out of Administration.
  { section: 'section_main', paths: ['/roadmap-plans'] },
  { section: 'section_main', paths: ['/add-log'] },
  { section: 'section_main', paths: ['/notifications'] },
  { section: 'section_main', paths: ['/reassignment'] },
  { section: 'section_main', paths: ['/support'] },
  { section: 'section_admin', key: 'accountsGroup', labelKey: 'nav_group_accounts', paths: ['/users', '/organizations'] },
  // "Everything the Inspections workflow draws its catalogue/setup from" -- Disciplines, Checklist
  // Items, Inspector Qualifications, Template Library.
  { section: 'section_admin', key: 'inspectionSetupGroup', labelKey: 'nav_group_inspection_setup', paths: ['/disciplines', '/checklist-items', '/finding-guide', '/annex-categories', '/inspector-qualifications', '/template-library'] },
  { section: 'section_admin', paths: ['/audit-log'] },
  { section: 'section_admin', paths: ['/translations'] },
  { section: 'section_admin', paths: ['/settings'] }
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
  await loadParticipantTypes();
  await loadPermissions();
  renderSidebar();
  renderUserChip();
  refreshNotifBadge();
  refreshEscalationAlert();
  loadOrgLogo();
  startUserLocationPing_();
}

// REQ (Dashboard): "Live map showing all inspector locations ... venue attendance." Generalized to
// ANY logged-in user/role (see LiveLocation.gs's own header comment for the reasoning), unlike the
// existing per-Inspection live tracking (startLiveInspectionTracking_, eventDetail.js) which only
// pings while an Inspector has that one screen open. Guarded by HululState.locationPingStarted since
// showApp() itself re-runs on every navigation, not just login.
//
// BUG FIX v2 (reported: an ASK Inspector still didn't show on the Live Map even after the v1 fix
// below, using Android/Firefox). v1 gated pinging on navigator.permissions.query({name:'geolocation'})
// resolving to 'granted', falling back to a direct getCurrentPosition() call only when that query
// *rejected* (Safari's failure mode). Firefox for Android fails differently: the query call resolves
// successfully but can report a stale/wrong state -- 'blocked' even though the user genuinely granted
// access -- a long-standing, still-open Firefox-for-Android bug (mozilla-mobile/fenix#28287,
// bugzilla 1933126: "Location permissions revert to blocked, including those defined in site
// permissions exceptions"). Since permissions.query() has now been caught lying in two different ways
// on two different major mobile browsers (Safari: rejects; Firefox Android: resolves wrong), it's not
// trustworthy as a gate at all. Fix: stop asking it. Always just call getCurrentPosition() directly --
// it's the actual authoritative source of truth on every browser. If permission is already granted
// this pings with zero UI; if it's genuinely undecided yet, the browser shows its normal native
// one-time prompt (accepted tradeoff, applies to every role -- see prior REQ discussion); if denied,
// it errors immediately with no UI and this function harmlessly retries next tick forever.
function startUserLocationPing_() {
  if (HululState.locationPingStarted) return;
  HululState.locationPingStarted = true;
  if (!navigator.geolocation) return;

  function pingOnce() {
    navigator.geolocation.getCurrentPosition(function (pos) {
      Api.call('pingUserLocation', { lat: pos.coords.latitude, lng: pos.coords.longitude }).catch(function () {});
    }, function () { /* denied or transient GPS failure -- next tick retries; browsers don't re-prompt once denied, so this is a harmless no-op */ }, { maximumAge: 25000, timeout: 10000 });
  }

  pingOnce();
  HululState.locationPingIntervalId = setInterval(pingOnce, 30000);
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

// Loads the app-wide list of Place/Participant types (Venues > Places, Event > Participants) --
// the 3 built-in roles (Vendor/Operator/Exhibitor) + 'Other' + any active custom role flagged
// isParticipantType (listParticipantTypes, backend/Roles.gs) -- once per session, same caching
// pattern as loadAppIcons above. REQ: "Can this be configurable, and allow to add other types."
// Falls back to just the 4 built-ins on a fetch error so Places/Participants forms never end up with
// an empty type dropdown.
async function loadParticipantTypes() {
  if (HululState.participantTypesLoaded) return;
  HululState.participantTypesLoaded = true;
  try { HululState.participantTypes = await Api.call('listParticipantTypes', {}); }
  catch (e) { HululState.participantTypes = PARTICIPANT_TYPES_FALLBACK_; }
  refreshParticipantTypeColors_();
}

// Loads the signed-in user's effective RBAC permission map (see permissions.js's hasPermission,
// backend/Permissions.gs's getMyPermissions) once per session -- same caching pattern as
// loadAppIcons above. Foundation + Findings pilot module only for now.
async function loadPermissions() {
  if (HululState.permissionsLoaded) return;
  HululState.permissionsLoaded = true;
  try { HululState.permissions = await Api.call('getMyPermissions', {}); }
  catch (e) { HululState.permissions = {}; }
  // See HululState.pageAccess (state.js)/navItemVisible_ below -- a separate call rather than folded
  // into getMyPermissions above since that one's flat permissionKey->boolean shape is depended on
  // elsewhere (hasPermission) and a page id has no '.' the way every real permission key does, so
  // keeping them apart avoids any ambiguity.
  try { HululState.pageAccess = await Api.call('getMyPageAccess', {}); }
  catch (e) { HululState.pageAccess = {}; }
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

// A nav item with no `roles` array is open to everyone -- unchanged. One WITH a `roles` array is
// visible if the signed-in user's role is in it (exactly as before, so every built-in role keeps
// working byte-for-byte the same), OR if that item's real page (permissionPages_, settings.js) has
// any permission granted to this role at all (HululState.pageAccess, getMyPageAccess backend/
// Permissions.gs) -- the second check is what makes a brand-new custom role (Roles.gs) see a nav item
// automatically the moment a SystemAdmin grants it something in the Settings > Permissions matrix,
// with no NAV_ITEMS code change. Items whose page isn't in the permission registry at all (e.g.
// /config, SystemAdmin-only bootstrapping) simply can't gain visibility this way -- pageIdForNavPath_
// returns null and the OR contributes nothing, same as before this change existed.
function navItemVisible_(item) {
  if (!item.roles) return true;
  if (HululState.user && item.roles.indexOf(HululState.user.role) !== -1) return true;
  var pageId = typeof pageIdForNavPath_ === 'function' ? pageIdForNavPath_(item.path) : null;
  return !!(pageId && HululState.pageAccess && HululState.pageAccess[pageId]);
}

// Persists per-group collapse state across reloads -- one localStorage key per group `key`, same
// try/catch-private-browsing-safe pattern as applySidebarCollapsed_'s own SIDEBAR_COLLAPSE_KEY_.
var NAV_GROUP_COLLAPSE_KEY_PREFIX_ = 'hulul_nav_group_collapsed_';

function renderSidebar() {
  var nav = document.getElementById('sidebarNav');
  var itemsByPath = {};
  NAV_ITEMS.forEach(function (item) { itemsByPath[item.path] = item; });

  function itemLabel_(item) { return item.entityLabelFn ? item.entityLabelFn() : (item.entityLabel ? Term(item.entityLabel) : t(item.label)); }
  function itemIcon_(item) { return (HululState.appIcons && HululState.appIcons[item.path]) || item.icon; }
  function navLinkHtml_(item, extraClass) {
    return '<a class="nav-item' + (extraClass ? ' ' + extraClass : '') + '" data-path="' + item.path + '" href="#' + item.path + '">' +
      '<span class="nav-icon">' + itemIcon_(item) + '</span><span class="nav-label">' + esc(itemLabel_(item)) + '</span></a>';
  }

  var html = '';
  var sectionsSeen = {};
  NAV_GROUPS_.forEach(function (g) {
    var visiblePaths = g.paths.filter(function (p) { return itemsByPath[p] && navItemVisible_(itemsByPath[p]); });
    if (!visiblePaths.length) return; // every item in this group is hidden for this role -- contributes nothing, not even the section header
    if (!sectionsSeen[g.section]) { html += '<div class="nav-section">' + t(g.section) + '</div>'; sectionsSeen[g.section] = true; }
    if (!g.key || visiblePaths.length === 1) {
      // Standalone entry, or a multi-path group reduced to one visible item by role/permission
      // filtering -- render as a plain link, same "collapse to a standalone button" convention
      // EVENT_TAB_GROUPS_ uses for a single-tab group.
      visiblePaths.forEach(function (p) { html += navLinkHtml_(itemsByPath[p]); });
      return;
    }
    var collapsed = false;
    try { collapsed = localStorage.getItem(NAV_GROUP_COLLAPSE_KEY_PREFIX_ + g.key) === '1'; } catch (e) { /* private browsing etc. */ }
    html += '<div class="nav-group-header' + (collapsed ? '' : ' expanded') + '" data-nav-group="' + g.key + '">' +
      '<span class="nav-label">' + esc(t(g.labelKey)) + '</span>' + ICON('chevron_down') + '</div>' +
      '<div class="nav-group-items' + (collapsed ? ' collapsed' : '') + '" data-nav-group-items="' + g.key + '">' +
      visiblePaths.map(function (p) { return navLinkHtml_(itemsByPath[p], 'nav-subitem'); }).join('') +
      '</div>';
  });
  html += '<div class="nav-item" id="logoutNavItem" style="margin-top:auto;cursor:pointer;">' +
    '<span class="nav-icon">' + ICON('logout') + '</span><span class="nav-label">' + t('nav_logout') + '</span></div>';
  nav.innerHTML = html;
  document.getElementById('logoutNavItem').onclick = doLogout;

  nav.querySelectorAll('[data-nav-group]').forEach(function (header) {
    header.onclick = function () {
      var key = header.getAttribute('data-nav-group');
      var itemsEl = nav.querySelector('[data-nav-group-items="' + key + '"]');
      var nowExpanded = !header.classList.contains('expanded');
      header.classList.toggle('expanded', nowExpanded);
      if (itemsEl) itemsEl.classList.toggle('collapsed', !nowExpanded);
      try { localStorage.setItem(NAV_GROUP_COLLAPSE_KEY_PREFIX_ + key, nowExpanded ? '0' : '1'); } catch (e) { /* private browsing etc. */ }
    };
  });
  // The route that's about to resolve right after this (or already active on a fresh page load)
  // needs its own nav-group auto-expanded even if this device has it stored collapsed -- see
  // highlightActiveNav (router.js), which runs on every navigation, not just this initial render.
  if (typeof highlightActiveNav === 'function' && window.HululState && HululState.currentRoute) {
    highlightActiveNav(HululState.currentRoute.path);
  }
  // On a phone-width screen the sidebar is an overlay drawer, not a pushed column -- picking a
  // page should close it afterward the same way tapping the backdrop does, so the chosen page
  // isn't left sitting behind it. Desktop's collapse is a deliberate, sticky user choice instead
  // (a click on the page shouldn't undo it), so this only fires under the mobile breakpoint.
  nav.querySelectorAll('.nav-item').forEach(function (a) {
    a.addEventListener('click', function () {
      if (window.innerWidth <= 900) applySidebarCollapsed_(true);
    });
  });
}

// ---- Sidebar collapse/expand (mobile-friendly: fully collapses, not just narrows) -------------
// One class (#sidebar.collapsed) and one mechanism drives both the desktop and mobile look --
// see styles.css for how the same class means "width:0" on desktop vs "slide off-screen" under
// the <=900px breakpoint. #mobileNavBtn (topbar hamburger) and #sidebarBackdrop (mobile scrim)
// are kept in sync with it here rather than via CSS alone, since their visibility depends on both
// the collapsed state AND (for the backdrop) the current viewport width.
var SIDEBAR_COLLAPSE_KEY_ = 'hulul_sidebar_collapsed';
function applySidebarCollapsed_(collapsed) {
  document.getElementById('sidebar').classList.toggle('collapsed', collapsed);
  document.getElementById('mobileNavBtn').classList.toggle('hidden', !collapsed);
  document.getElementById('sidebarBackdrop').classList.toggle('hidden', collapsed || window.innerWidth > 900);
  try { localStorage.setItem(SIDEBAR_COLLAPSE_KEY_, collapsed ? '1' : '0'); } catch (e) { /* private browsing etc. -- just skip persisting */ }
}
// Respects an explicit prior choice (either button) across reloads; otherwise defaults to
// collapsed on a phone-width screen (so it doesn't eat the whole viewport on first load) and
// expanded everywhere else, matching the old desktop default.
function initSidebarCollapse_() {
  var stored = null;
  try { stored = localStorage.getItem(SIDEBAR_COLLAPSE_KEY_); } catch (e) { /* ignore */ }
  var collapsed = stored !== null ? stored === '1' : window.innerWidth <= 900;
  applySidebarCollapsed_(collapsed);
}

// REQ: "This should live in settings and top left user info" -- the rich profile (photo, mobile,
// email, certificates: see renderProfileTab_, settings.js) also surfaces here as a photo avatar,
// and the whole chip becomes a click-through into Settings > Profile (the .user-chip{cursor:pointer}
// CSS already implied this was intended, but nothing wired it until now).
function renderUserChip() {
  var u = HululState.user;
  if (!u) return;
  var avatar = document.getElementById('userAvatar');
  var fallbackLetter = (u.name || '?').slice(0, 1).toUpperCase();
  if (u.photoUrl) {
    avatar.innerHTML = '<img src="' + esc(u.photoUrl) + '" alt="" onerror="this.remove();this.parentNode.textContent=' + JSON.stringify(fallbackLetter) + ';" />';
  } else {
    avatar.textContent = fallbackLetter;
  }
  document.getElementById('userChipName').textContent = u.name;
  document.getElementById('userChipRole').textContent = u.role;
  document.getElementById('userMenuBtn').onclick = function () { window.location.hash = '#/settings?tab=profile'; };
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
    // Double-submit guard: handled generically by ui.js's app-wide click-guard (disables this
    // button for exactly as long as this handler call takes, then re-enables it) -- nothing to do
    // here by hand.
    try {
      await Api.call('acknowledgeEscalation', { escalationId: item.id });
      HululState.escalationLockShownId = null;
      hideEscalationLock_();
      // REQ: "takes user to the Escalation screen with the risk selected and details displayed" --
      // same ?tab=<x>&focus=<id> pattern already used by the chat log's own "jump to this item" link.
      window.location.hash = '#/events/' + item.eventId + '?tab=escalations&focus=' + item.id;
      refreshEscalationAlert(true);
    } catch (err) { UI.error(err); }
  };
}

function hideEscalationLock_() {
  var overlay = document.getElementById('escalationLockOverlay');
  if (overlay) { overlay.classList.add('hidden'); overlay.innerHTML = ''; }
}

function wireChrome() {
  document.getElementById('loginForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    // Double-submit guard: this button is a plain <button type="submit"> with no .onclick of its
    // own (see index.html) -- it's wired through this form's own 'submit' listener instead, which
    // ui.js's app-wide click-guard doesn't reach (that one only wraps .onclick handlers). Guarded
    // by hand here the same way every .onclick handler used to be before that guard existed: check
    // the button's own disabled state going in, disable it before the request, re-enable only on
    // failure (success navigates away, so there's nothing left to re-enable).
    var btn = e.target.querySelector('button[type="submit"]');
    if (btn.disabled) return;
    btn.disabled = true;
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
      btn.disabled = false;
    }
  });

  document.getElementById('langToggleLogin').onclick = toggleLanguage;
  document.getElementById('langToggleApp').onclick = toggleLanguage;
  initSidebarCollapse_();
  document.getElementById('sidebarCollapseBtn').onclick = function () { applySidebarCollapsed_(true); };
  document.getElementById('mobileNavBtn').onclick = function () { applySidebarCollapsed_(false); };
  document.getElementById('sidebarBackdrop').onclick = function () { applySidebarCollapsed_(true); };
  // If the window crosses the mobile breakpoint while the sidebar happens to be open, the
  // backdrop's own relevance changes with it (desktop collapse never shows one) -- keep it in
  // sync without forcing the sidebar itself open/closed, which stays the user's own choice.
  window.addEventListener('resize', function () {
    var sidebar = document.getElementById('sidebar');
    document.getElementById('sidebarBackdrop').classList.toggle('hidden', sidebar.classList.contains('collapsed') || window.innerWidth > 900);
  });
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
