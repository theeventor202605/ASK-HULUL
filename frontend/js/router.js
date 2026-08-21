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
    // REQ follow-up: "Clicking on a row opens the full checklist on new page list layout not popup"
    // (Completed Checklists tab, eventDetail.js) -- renderCompletedChecklistDetail, same tabbed-page-
    // route pattern as the findings sub-routes just below.
    this.add('/events/:id/completed-checklist/:inspectionId/:participantId', renderCompletedChecklistDetail);
    // REQ follow-up: "Can I convert the templates to forms and include evaluation process as per
    // attached file?" -- Document Review scoring form (renderTemplateScoring, eventDetail.js).
    this.add('/events/:id/template-scoring/:templateId', renderTemplateScoring);
    this.add('/events/:id/findings/new', renderNewFinding);
    this.add('/events/:id/findings/:findingId/edit', renderEditFinding);
    this.add('/events/:id/findings/:findingId', renderFindingDetail);
    this.add('/projects', renderProjects);
    this.add('/projects/:id', renderProjectDetail);
    this.add('/venues', renderVenues);
    this.add('/venues/new', renderNewVenue);
    this.add('/venues/:id', renderVenueDetail);
    // REQ follow-up: "Venue main page to become a tab and Places to become the third tab" -- both
    // old standalone routes now just redirect onto the new tabbed page (renderVenueDetail, venues.js).
    this.add('/venues/:id/edit', renderEditVenueRedirect_);
    this.add('/venues/:id/places', renderVenuePlacesRedirect_);
    this.add('/sub-events', renderSubEvents);
    this.add('/meetings', renderMeetings);
    this.add('/meetings/templates', renderMeetingTemplates);
    this.add('/meetings/new', renderNewMeeting);
    this.add('/meetings/:meetingId/edit', renderEditMeeting);
    this.add('/disciplines', renderDisciplinesAdmin);
    this.add('/checklist-items', renderChecklistItems);
    this.add('/finding-guide', renderFindingGuide);
    this.add('/annex-categories', renderAnnexCategories);
    this.add('/inspector-qualifications', renderInspectorQualifications);
    this.add('/completed-checklists', renderCompletedChecklistsPage);
    this.add('/template-library', renderTemplateLibrary);
    this.add('/users', renderUsers);
    this.add('/organizations', renderOrganizations);
    this.add('/notifications', renderNotificationsView);
    this.add('/reassignment', renderReassignment);
    this.add('/support', renderSupport);
    this.add('/support/:id', renderSupportDetail);
    this.add('/audit-log', renderAuditLog);
    this.add('/translations', renderTranslations);
    this.add('/settings', renderSettings);
    this.add('/roadmap-plans', renderRoadmapPlans);
    this.add('/roadmap-plans/:id', renderRoadmapPlanDetail);
    // REQ: "Add Log sidebar, which allows inspector to add logs to any event under his inspection
    // company." Cross-event proximity-gated event picker (renderAddLogPicker_, findings.js) --
    // routes into the existing #/events/:id/findings/new page once an eligible event is chosen.
    this.add('/add-log', renderAddLogPicker_);
    window.addEventListener('hashchange', () => this.resolve());
  }
};

window.renderCurrentView = function () { Router.resolve(); };

function highlightActiveNav(path) {
  document.querySelectorAll('.nav-item').forEach(function (a) {
    var target = a.getAttribute('data-path');
    var isActive = !!(target && path.indexOf(target) === 0);
    a.classList.toggle('active', isActive);
    // REQ: "Can you group the sidebar?" -- a bookmarked/refreshed page whose nav link lives inside a
    // sidebar group this device has stored collapsed must not disappear from view. Only touches the
    // current on-screen state (not the stored preference), same one-shot reasoning as the Event tab
    // bar's own highlight-and-scroll (PENDING_TAB_HIGHLIGHT_KEY_, eventDetail.js).
    if (isActive) {
      var groupItems = a.closest('.nav-group-items');
      if (groupItems && groupItems.classList.contains('collapsed')) {
        groupItems.classList.remove('collapsed');
        var header = document.querySelector('[data-nav-group="' + groupItems.getAttribute('data-nav-group-items') + '"]');
        if (header) header.classList.add('expanded');
      }
    }
  });
}
