/**
 * HULUL - Sub-Events admin view. A Sub-Event inherits its parent Event's Venue/EMC/Inspection Co
 * and must fall within the parent's date window (REQ-EVT-03).
 * Left rail has three cross-filtering panels -- Project, Venue, Event -- styled like the Events
 * page's own filter panels: each has an "All ___ (n)" row plus one row per option with its own
 * count, and picking one narrows the options below/above it (a Project narrows which Venues can be
 * picked and vice versa; both narrow which Events show). Leaving Event on "All" shows the combined
 * Sub-Events of every Event currently in scope; picking one specific Event shows just its own
 * Sub-Events, with that Event's own date range under the title.
 */
async function renderSubEvents(params) {
  var root = document.getElementById('viewRoot');
  var [events, venues, projects, subEvents] = await Promise.all([
    Api.call('listEvents', {}), Api.call('listVenues', {}), Api.call('listProjects', {}), Api.call('listSubEvents', {})
  ]);
  var venueById = {};
  venues.forEach(function (v) { venueById[v.id] = v; });
  var projectById = {};
  projects.forEach(function (p) { projectById[p.id] = p; });
  var subEventsByEvent = {};
  subEvents.forEach(function (s) { (subEventsByEvent[s.eventId] = subEventsByEvent[s.eventId] || []).push(s); });

  if (!events.length) {
    root.innerHTML =
      '<div class="page-header"><div><div class="page-title">' + esc(Term('subEvent_plural')) + '</div>' +
      '<div class="page-subtitle">' + esc(Term('subEvent_plural') + ' nested inside a parent ' + Term('event')) + '</div></div></div>' +
      '<div class="empty-state">' + t('no_data') + '</div>';
    return;
  }

  var preselected = params && params.eventId ? events.filter(function (e) { return e.id === params.eventId; })[0] : null;
  var view = {
    projectId: preselected ? (preselected.projectId || '') : '',
    venueId: preselected ? preselected.venueId : '',
    eventId: preselected ? preselected.id : ''
  };

  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + esc(Term('subEvent_plural')) + '</div>' +
    '<div class="page-subtitle">' + esc(Term('subEvent_plural') + ' nested inside a parent ' + Term('event')) + '</div></div></div>' +
    '<div style="display:flex;gap:16px;align-items:flex-start;">' +
      '<div class="card" style="width:250px;flex-shrink:0;">' +
        '<div class="card-header"><div class="card-title">' + esc(Term('project_plural')) + '</div></div>' +
        '<div id="sevProjectPanel" style="padding:8px;max-height:160px;overflow-y:auto;"></div>' +
        '<div class="card-header" style="border-top:1px solid var(--border);"><div class="card-title">' + esc(Term('venue_plural')) + '</div></div>' +
        '<div id="sevVenuePanel" style="padding:8px;max-height:220px;overflow-y:auto;"></div>' +
        '<div class="card-header" style="border-top:1px solid var(--border);"><div class="card-title">' + esc(Term('event_plural')) + '</div></div>' +
        '<div id="sevEventPanel" style="padding:8px;max-height:340px;overflow-y:auto;"></div>' +
      '</div>' +
      '<div style="flex:1;min-width:0;" id="subEventsBody"></div>' +
    '</div>';

  var rowStyle = 'padding:8px 10px;border-radius:8px;cursor:pointer;font-size:13px;margin-top:2px;';

  // Shared with events.js's own filterPanelHtml_ look: an "All ___ (n)" row plus one row per
  // option, each with its own count in brackets.
  function panelRowsHtml_(allLabel, rows, activeId) {
    var total = rows.reduce(function (sum, r) { return sum + r.count; }, 0);
    var html = '<div class="sev-filter-row" data-id="" style="' + rowStyle + 'font-weight:700;' +
      (!activeId ? 'background:var(--accent);color:#fff;' : '') + '">' + esc(allLabel) +
      ' <span style="opacity:.75;font-size:11.5px;">(' + total + ')</span></div>';
    html += rows.map(function (r) {
      var active = activeId === r.id;
      return '<div class="sev-filter-row" data-id="' + esc(r.id) + '" style="' + rowStyle + (active ? 'background:var(--accent);color:#fff;font-weight:600;' : '') + '">' +
        esc(r.name) + ' <span style="opacity:.75;font-size:11.5px;">(' + r.count + ')</span></div>';
    }).join('');
    return html;
  }

  // Events in scope, optionally ignoring one of this panel's own two "upstream" filters so that
  // panel's own option list (and counts) reflect the OTHER filter only -- same cross-filtering
  // rule used on the Events page: picking a Project narrows Venues and vice versa.
  function eventsInScope_(exclude) {
    return events.filter(function (e) {
      if (exclude !== 'project' && view.projectId && e.projectId !== view.projectId) return false;
      if (exclude !== 'venue' && view.venueId && e.venueId !== view.venueId) return false;
      return true;
    });
  }

  function renderProjectPanel() {
    var base = eventsInScope_('project'); // respects Venue filter, ignores its own
    var counts = {};
    base.forEach(function (e) { if (e.projectId) counts[e.projectId] = (counts[e.projectId] || 0) + 1; });
    var rows = Object.keys(counts).map(function (pid) { return { id: pid, name: projectById[pid] ? projectById[pid].name : pid, count: counts[pid] }; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
    if (view.projectId && !rows.some(function (r) { return r.id === view.projectId; })) view.projectId = '';
    var panel = document.getElementById('sevProjectPanel');
    panel.innerHTML = panelRowsHtml_('All ' + Term('project_plural'), rows, view.projectId);
    panel.querySelectorAll('.sev-filter-row').forEach(function (row) {
      row.onclick = function () {
        view.projectId = row.getAttribute('data-id');
        renderProjectPanel(); renderVenuePanel(); renderEventPanel();
      };
    });
  }

  function renderVenuePanel() {
    var base = eventsInScope_('venue'); // respects Project filter, ignores its own
    var counts = {};
    base.forEach(function (e) { counts[e.venueId] = (counts[e.venueId] || 0) + 1; });
    var rows = Object.keys(counts).map(function (vid) { return { id: vid, name: venueById[vid] ? venueById[vid].name : vid, count: counts[vid] }; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
    if (view.venueId && !rows.some(function (r) { return r.id === view.venueId; })) view.venueId = '';
    var panel = document.getElementById('sevVenuePanel');
    panel.innerHTML = panelRowsHtml_('All ' + Term('venue_plural'), rows, view.venueId);
    panel.querySelectorAll('.sev-filter-row').forEach(function (row) {
      row.onclick = function () {
        view.venueId = row.getAttribute('data-id');
        renderVenuePanel(); renderProjectPanel(); renderEventPanel();
      };
    });
  }

  // Bottom of the hierarchy -- respects BOTH the Project and Venue filters (nothing further below
  // it to cross-filter against). Each Event's own count is how many Sub-Events it has, so you can
  // see at a glance which ones are worth opening.
  function renderEventPanel() {
    var base = eventsInScope_(null);
    var rows = base.map(function (e) { return { id: e.id, name: e.name, count: (subEventsByEvent[e.id] || []).length }; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
    if (view.eventId && !rows.some(function (r) { return r.id === view.eventId; })) view.eventId = '';
    var panel = document.getElementById('sevEventPanel');
    panel.innerHTML = panelRowsHtml_('All ' + Term('event_plural'), rows, view.eventId);
    panel.querySelectorAll('.sev-filter-row').forEach(function (row) {
      row.onclick = function () {
        view.eventId = row.getAttribute('data-id');
        renderEventPanel();
      };
    });
    renderBody();
  }

  function renderBody() {
    var body = document.getElementById('subEventsBody');
    if (view.eventId) {
      var event = events.filter(function (e) { return e.id === view.eventId; })[0];
      if (!event) { view.eventId = ''; renderBody(); return; }
      var venue = venueById[event.venueId];
      var rows = subEventsByEvent[event.id] || [];
      body.innerHTML =
        '<div class="card"><div class="card-header"><div>' +
          '<div class="card-title">' + esc(Term('subEvent_plural') + ' of ') + esc(event.name) +
          (venue ? ' <span class="muted" style="font-weight:400;font-size:12.5px;">(' + esc(venue.name) + ')</span>' : '') + '</div>' +
          '<div class="muted" style="font-size:12px;margin-top:4px;">' + esc(fmtDMY_(event.startDateTime)) + ' - ' + esc(fmtDMY_(event.endDateTime)) + '</div>' +
        '</div>' +
        '<button class="btn btn-primary btn-sm" id="newSevBtn">+ New ' + esc(Term('subEvent').toLowerCase()) + '</button></div>' +
        '<div class="card-body">' + UI.table([
          { key: 'name', label: 'Name', render: r =>
              '<div style="font-weight:600;">' + esc(r.name) + '</div>' +
              '<div style="font-size:11px;color:var(--text-600);margin-top:2px;">' + UI.fmtDate(r.startDateTime) + ' – ' + UI.fmtDate(r.endDateTime) + '</div>' }
        ], rows, {}) + '</div></div>';
      document.getElementById('newSevBtn').onclick = function () { openNewSubEventModal_(event, event.id); };
    } else {
      // "All Events" -- combine Sub-Events across every Event currently in scope (Project + Venue
      // filters), tagging each row with its parent Event's name since several may be mixed together.
      var scoped = eventsInScope_(null);
      var eventNameById = {}; scoped.forEach(function (e) { eventNameById[e.id] = e.name; });
      var combined = [];
      scoped.forEach(function (e) { (subEventsByEvent[e.id] || []).forEach(function (s) { combined.push(s); }); });
      body.innerHTML =
        '<div class="card"><div class="card-header"><div class="card-title">' + esc(Term('subEvent_plural') + ' of All ' + Term('event_plural')) + '</div></div>' +
        '<div class="card-body">' + UI.table([
          { key: 'name', label: 'Name', render: r =>
              '<div style="font-weight:600;">' + esc(r.name) + '</div>' +
              '<div style="font-size:11px;color:var(--text-600);margin-top:2px;">' + UI.fmtDate(r.startDateTime) + ' – ' + UI.fmtDate(r.endDateTime) + '</div>' },
          { key: 'eventId', label: Term('event'), render: r => esc(eventNameById[r.eventId] || r.eventId) }
        ], combined, { emptyText: 'No ' + esc(Term('subEvent_plural').toLowerCase()) + ' under the current filters.' }) +
        '<div class="muted" style="font-size:11.5px;margin-top:10px;">Pick a specific ' + esc(Term('event').toLowerCase()) + ' on the left to add a new ' + esc(Term('subEvent').toLowerCase()) + '.</div>' +
        '</div></div>';
    }
  }

  renderProjectPanel();
  renderVenuePanel();
  renderEventPanel();
}

// "DD/MM/YYYY  hh:mm am/pm" -- used for the date range shown under a selected Event's own
// Sub-Events title. Deliberately its own numeric format rather than UI.fmtDate's "17 Aug 2026"
// style, per how it was asked for.
function fmtDMY_(iso) {
  var d = new Date(iso);
  if (isNaN(d)) return iso || '—';
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  var hours = d.getHours();
  var ampm = hours >= 12 ? 'pm' : 'am';
  var h12 = hours % 12; if (h12 === 0) h12 = 12;
  return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + '  ' + pad(h12) + ':' + pad(d.getMinutes()) + ' ' + ampm;
}

// Start/End are bounded (min/max) to the parent Event's own window -- REQ-EVT-03 already enforces
// this server-side in createSubEvent, but greying out the unusable dates/times in the picker
// itself (rather than only rejecting after submit) is much clearer. Each field also gets a "📅"
// button that opens the native date/time picker programmatically (showPicker()) as an explicit,
// unmissable way to set it, since the picker icon inside a datetime-local input is easy to miss.
function openNewSubEventModal_(event, eventId) {
  var min = normalizeDateTimeLocal(event.startDateTime);
  var max = normalizeDateTimeLocal(event.endDateTime);
  function dtFieldHtml_(id) {
    return '<div style="display:flex;gap:6px;">' +
      '<input id="' + id + '" type="datetime-local" class="field-input" min="' + esc(min) + '" max="' + esc(max) + '" />' +
      '<button type="button" class="btn btn-secondary btn-icon" id="' + id + 'Cal" title="Open calendar">' + ICON('open_calendar') + '</button>' +
    '</div>';
  }
  var m = UI.field('Name', '<input id="fSevName" class="field-input" />') +
    '<div class="form-row">' +
      UI.field('Start', dtFieldHtml_('fSevStart')) +
      UI.field('End', dtFieldHtml_('fSevEnd')) +
    '</div>' +
    '<div class="muted" style="font-size:11px;margin-top:-6px;">Must fall within the ' + esc(Term('event').toLowerCase()) + '\'s own window: ' +
      UI.fmtDate(event.startDateTime) + ' – ' + UI.fmtDate(event.endDateTime) + '.</div>';
  UI.openModal('New ' + Term('subEvent'), m, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('create'), className: 'btn-primary', onClick: async function () {
        try {
          await Api.call('createSubEvent', {
            eventId: eventId, name: document.getElementById('fSevName').value,
            startDateTime: document.getElementById('fSevStart').value, endDateTime: document.getElementById('fSevEnd').value
          });
          UI.closeModal(); UI.toast(Term('subEvent') + ' created', 'success');
          window.location.hash = '#/sub-events?eventId=' + eventId; Router.resolve();
        } catch (err) { UI.error(err); }
      } }
  ]);
  ['fSevStart', 'fSevEnd'].forEach(function (id) {
    var input = document.getElementById(id);
    document.getElementById(id + 'Cal').onclick = function () {
      if (input.showPicker) { try { input.showPicker(); return; } catch (e) { /* fall through */ } }
      input.focus();
    };
  });
}
