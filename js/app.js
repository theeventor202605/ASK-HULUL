/**
 * HULUL - app bootstrap: login flow, sidebar, topbar wiring, router init.
 */
var NAV_ITEMS = [
  { path: '/dashboard', icon: '🏠', label: 'nav_dashboard', section: 'section_main' },
  { path: '/events', icon: '📅', label: 'nav_events', section: 'section_main' },
  { path: '/notifications', icon: '🔔', label: 'nav_notifications', section: 'section_main' },
  { path: '/users', icon: '👥', label: 'nav_users', section: 'section_admin',
    roles: ['SystemAdmin', 'GAAdmin', 'EMCAdmin', 'InspectionAdmin'] },
  { path: '/organizations', icon: '🏢', label: 'nav_orgs', section: 'section_admin', roles: ['SystemAdmin'] },
  { path: '/settings', icon: '⚙️', label: 'nav_settings', section: 'section_admin' }
];

function showLogin() {
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('appShell').classList.add('hidden');
}
function showApp() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('appShell').classList.remove('hidden');
  renderSidebar();
  renderUserChip();
  refreshNotifBadge();
}

function renderSidebar() {
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
      html += '<a class="nav-item" data-path="' + item.path + '" href="#' + item.path + '">' +
        '<span class="nav-icon">' + item.icon + '</span><span class="nav-label">' + t(item.label) + '</span></a>';
    });
  });
  html += '<div class="nav-item" id="logoutNavItem" style="margin-top:auto;cursor:pointer;">' +
    '<span class="nav-icon">↩</span><span class="nav-label">' + t('nav_logout') + '</span></div>';
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

async function refreshNotifBadge() {
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
      panel.innerHTML = list.length
        ? list.map(function (n) {
            return '<div class="notif-item"><div>' + esc(n.message) + '</div><div class="meta">' + UI.fmtDate(n.createdAt) + '</div></div>';
          }).join('')
        : '<div class="empty-state">' + t('no_data') + '</div>';
      panel.classList.remove('hidden');
    } catch (err) { UI.error(err); }
  };
}

function boot() {
  document.documentElement.lang = HululState.lang;
  document.documentElement.dir = HululState.lang === 'ar' ? 'rtl' : 'ltr';
  applyI18n();
  wireChrome();
  Router.init();
  Router.resolve();
}

document.addEventListener('DOMContentLoaded', boot);
