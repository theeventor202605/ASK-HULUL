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

  // Every Api.call reads this signal (see api.js) -- aborted and replaced on every resolve(), so
  // navigating away always cancels whatever the page you just left was still waiting on.
  _abortController: null,

  async resolve() {
    var root = document.getElementById('viewRoot');
    if (!HululState.loadSession()) {
      window.showLogin();
      return;
    }
    await window.showApp();
    var parsed = this.parse(window.location.hash);
    var match = this.match(parsed.path);
    window.HululState.currentRoute = parsed;
    highlightActiveNav(parsed.path);

    // REQ bug report: "click a page, and before it loads click another -> Cannot set properties of
    // null (setting 'onclick')". Cause: every render/tab function does `await Api.call(...)` then
    // wires buttons with document.getElementById('x').onclick = fn. Navigating away while that await
    // is still pending doesn't stop the function -- it's just suspended. A newer resolve() replaces
    // root's contents and renders the new page; when the OLD page's fetch finally comes back (the
    // network has no idea the user navigated away), it resumes and tries to build/wire its own page
    // against DOM nodes that no longer exist anywhere in the live document, and getElementById
    // returns null. Aborting the previous request here makes that stale await reject immediately
    // (caught below) instead of resolving late and crashing.
    if (this._abortController) this._abortController.abort();
    this._abortController = new AbortController();

    if (!match) { root.innerHTML = '<div class="empty-state">Page not found.</div>'; return; }
    root.innerHTML = '<div class="empty-state">' + t('loading') + '</div>';
    try {
      await match.handler(Object.assign({}, match.params, parsed.query));
    } catch (err) {
      if (err && err.name === 'AbortError') return; // superseded by a newer navigation -- not a real error
      UI.error(err);
      root.innerHTML = '<div class="empty-state">Failed to load this page.</div>';
    }
  },

  init() {
    this.add('/dashboard', renderDashboard);
    this.add('/events', renderEventsList);
    this.add('/events/:id', renderEventDetail);
    this.add('/events/:id/findings/new', renderNewFinding);
    this.add('/events/:id/findings/:findingId', renderFindingDetail);
    this.add('/projects', renderProjects);
    this.add('/projects/:id', renderProjectDetail);
    this.add('/venues', renderVenues);
    this.add('/venues/new', renderNewVenue);
    this.add('/venues/:id/edit', renderEditVenue);
    this.add('/venues/:id/places', renderVenuePlaces);
    this.add('/sub-events', renderSubEvents);
    this.add('/meetings', renderMeetings);
    this.add('/disciplines', renderDisciplinesAdmin);
    this.add('/checklist-items', renderChecklistItems);
    this.add('/inspector-qualifications', renderInspectorQualifications);
    this.add('/template-library', renderTemplateLibrary);
    this.add('/users', renderUsers);
    this.add('/organizations', renderOrganizations);
    this.add('/notifications', renderNotificationsView);
    this.add('/reassignment', renderReassignment);
    this.add('/support', renderSupport);
    this.add('/support/:id', renderSupportDetail);
    this.add('/config', renderConfig);
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
