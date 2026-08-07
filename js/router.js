/**
 * HULUL - minimal hash router. Routes:
 *   #/dashboard
 *   #/events                      -> events list
 *   #/events/:id[?tab=findings]   -> event workspace (tabs)
 *   #/users  #/organizations  #/notifications  #/settings
 */
window.Router = {
  routes: [],
  add(pattern, handler) { this.routes.push({ pattern, handler }); },

  parse(hash) {
    hash = (hash || '#/dashboard').replace(/^#/, '');
    var qIndex = hash.indexOf('?');
    var path = qIndex === -1 ? hash : hash.slice(0, qIndex);
    var query = {};
    if (qIndex !== -1) {
      hash.slice(qIndex + 1).split('&').forEach(function (pair) {
        var kv = pair.split('=');
        if (kv[0]) query[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
      });
    }
    return { path: path.replace(/\/+$/, '') || '/dashboard', query: query };
  },

  match(path) {
    for (var i = 0; i < this.routes.length; i++) {
      var parts = this.routes[i].pattern.split('/').filter(Boolean);
      var pathParts = path.split('/').filter(Boolean);
      if (parts.length !== pathParts.length) continue;
      var params = {}, ok = true;
      for (var j = 0; j < parts.length; j++) {
        if (parts[j].startsWith(':')) params[parts[j].slice(1)] = decodeURIComponent(pathParts[j]);
        else if (parts[j] !== pathParts[j]) { ok = false; break; }
      }
      if (ok) return { handler: this.routes[i].handler, params: params };
    }
    return null;
  },

  async resolve() {
    var root = document.getElementById('viewRoot');
    if (!HululState.loadSession()) {
      window.showLogin();
      return;
    }
    window.showApp();
    var parsed = this.parse(window.location.hash);
    var match = this.match(parsed.path);
    window.HululState.currentRoute = parsed;
    highlightActiveNav(parsed.path);
    if (!match) { root.innerHTML = '<div class="empty-state">Page not found.</div>'; return; }
    root.innerHTML = '<div class="empty-state">' + t('loading') + '</div>';
    try {
      await match.handler(Object.assign({}, match.params, parsed.query));
    } catch (err) {
      UI.error(err);
      root.innerHTML = '<div class="empty-state">Failed to load this page.</div>';
    }
  },

  init() {
    this.add('/dashboard', renderDashboard);
    this.add('/events', renderEventsList);
    this.add('/events/:id', renderEventDetail);
    this.add('/users', renderUsers);
    this.add('/organizations', renderOrganizations);
    this.add('/notifications', renderNotificationsView);
    this.add('/settings', renderSettings);
    window.addEventListener('hashchange', () => this.resolve());
  }
};

window.renderCurrentView = function () { Router.resolve(); };

function highlightActiveNav(path) {
  document.querySelectorAll('.nav-item').forEach(function (a) {
    var target = a.getAttribute('data-path');
    a.classList.toggle('active', target && path.indexOf(target) === 0);
  });
}
