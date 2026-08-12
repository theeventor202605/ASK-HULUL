/**
 * HULUL - Meetings admin view (REQ-TPL-02). Left rail has four cross-filtering panels in the
 * app-wide filter order -- Project, Venue, Event, Sub-Event -- each with an "All ___ (n)" row plus
 * one row per option and its own meeting count, same look as the Events/Sub-Events pages. Project
 * and Venue only ever show options that still have at least one matching meeting (pure narrowing
 * filters, cross-filtered against each other only -- picking an Event/Sub-Event never collapses
 * them, same rule the Sub-Events page uses). Event and Sub-Event show every option in scope
 * regardless of count, since those are the actual targets you pick to view or schedule a meeting
 * against. A meeting can be scheduled directly against an Event, or -- if a specific Sub-Event is
 * selected -- against that Sub-Event instead.
 */
// Mirrored verbatim from Templates.gs's own MEETING_TYPES -- Apps Script has no shared-module
// import between backend/frontend files, so the frontend keeps its own copy for the "Meeting type"
// dropdown. Keep in sync if the backend list ever changes.
var MEETING_TYPES = [
  'Inspection Kick-off Meeting',
  'Inspection Planning Meeting',
  'Participant Coordination Meeting',
  'Pre-Inspection Briefing',
  'Daily Inspection Coordination Meeting',
  'Technical Review Meeting',
  'Non-Conformance Review Meeting',
  'Corrective Action Review Meeting',
  'Re-Inspection Planning Meeting',
  'Readiness Review Meeting',
  'Go / No-Go Recommendation Meeting',
  'Final Inspection Close-Out Meeting'
];

async function renderMeetings(params) {
  var root = document.getElementById('viewRoot');
  var [events, venues, projects, subEvents, meetings] = await Promise.all([
    Api.call('listEvents', {}), Api.call('listVenues', {}), Api.call('listProjects', {}),
    Api.call('listSubEvents', {}), Api.call('listMeetings', {})
  ]);
  var venueById = {}; venues.forEach(function (v) { venueById[v.id] = v; });
  var projectById = {}; projects.forEach(function (pr) { projectById[pr.id] = pr; });
  var eventById = {}; events.forEach(function (e) { eventById[e.id] = e; });
  var subEventById = {}; subEvents.forEach(function (s) { subEventById[s.id] = s; });

  if (!events.length) {
    root.innerHTML =
      '<div class="page-header"><div><div class="page-title">' + esc(Term('meeting_plural')) + '</div>' +
      '<div class="page-subtitle">' + esc(Term('meeting_plural') + ' scheduled per ' + Term('event')) + '</div></div></div>' +
      '<div class="empty-state">' + t('no_data') + '</div>';
    return;
  }

  var preselected = params && params.eventId ? eventById[params.eventId] : null;
  var view = {
    projectId: preselected ? (preselected.projectId || '') : '',
    venueId: preselected ? preselected.venueId : '',
    eventId: preselected ? preselected.id : '',
    subEventId: params && params.subEventId && subEventById[params.subEventId] ? params.subEventId : ''
  };
  if (view.subEventId) view.eventId = subEventById[view.subEventId].eventId;

  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + esc(Term('meeting_plural')) + '</div>' +
    '<div class="page-subtitle">' + esc(Term('meeting_plural') + ' scheduled per ' + Term('event')) + '</div></div>' +
    // Always-visible entry point, independent of the left-rail filter selection below -- the
    // per-card "+ Schedule" button (meetingsCardHtml_) only renders once a specific Event/Sub-Event
    // is picked on the left, which left "All Events" (the page's own default landing state, and
    // the state after e.g. picking a Project with no Event yet chosen) with no way to schedule a
    // meeting at all. This one opens the same modal but with its own Event picker, so it works from
    // any filter state.
    '<button class="btn btn-primary" id="newMtgHeaderBtn">+ Schedule ' + esc(Term('meeting').toLowerCase()) + '</button>' +
    '</div>' +
    '<div style="display:flex;gap:16px;align-items:flex-start;">' +
      '<div class="card" style="width:250px;flex-shrink:0;">' +
        '<div class="card-header"><div class="card-title">' + esc(Term('project_plural')) + '</div></div>' +
        '<div id="mtgProjectPanel" style="padding:8px;max-height:150px;overflow-y:auto;"></div>' +
        '<div class="card-header" style="border-top:1px solid var(--border);"><div class="card-title">' + esc(Term('venue_plural')) + '</div></div>' +
        '<div id="mtgVenuePanel" style="padding:8px;max-height:180px;overflow-y:auto;"></div>' +
        '<div class="card-header" style="border-top:1px solid var(--border);"><div class="card-title">' + esc(Term('event_plural')) + '</div></div>' +
        '<div id="mtgEventPanel" style="padding:8px;max-height:220px;overflow-y:auto;"></div>' +
        '<div class="card-header" style="border-top:1px solid var(--border);"><div class="card-title">' + esc(Term('subEvent_plural')) + '</div></div>' +
        '<div id="mtgSubEventPanel" style="padding:8px;max-height:180px;overflow-y:auto;"></div>' +
      '</div>' +
      '<div style="flex:1;min-width:0;" id="meetingsBody"></div>' +
    '</div>';

  var rowStyle = 'padding:8px 10px;border-radius:8px;cursor:pointer;font-size:13px;margin-top:2px;';

  // Same look as the Events/Sub-Events pages: an "All ___ (n)" row plus one row per option, each
  // with its own count in brackets.
  function panelRowsHtml_(allLabel, rows, activeId) {
    var total = rows.reduce(function (sum, r) { return sum + r.count; }, 0);
    var html = '<div class="mtg-filter-row" data-id="" style="' + rowStyle + 'font-weight:700;' +
      (!activeId ? 'background:var(--accent);color:#fff;' : '') + '">' + esc(allLabel) +
      ' <span style="opacity:.75;font-size:11.5px;">(' + total + ')</span></div>';
    html += rows.map(function (r) {
      var active = activeId === r.id;
      return '<div class="mtg-filter-row" data-id="' + esc(r.id) + '" style="' + rowStyle + (active ? 'background:var(--accent);color:#fff;font-weight:600;' : '') + '">' +
        esc(r.name) + ' <span style="opacity:.75;font-size:11.5px;">(' + r.count + ')</span></div>';
    }).join('');
    return html;
  }

  function eventMatchesProject_(e, projectId) {
    if (!projectId) return true;
    if (projectId === '__none__') return !e.projectId;
    return e.projectId === projectId;
  }

  // Events in scope, respecting only the Project/Venue filters -- never Event/Sub-Event, since
  // those are terminal selections that narrow WHICH meetings show, not which Projects/Venues are
  // choosable (same rule the Sub-Events page uses for its own Project/Venue panels).
  function eventsInScope_(exclude) {
    return events.filter(function (e) {
      if (exclude !== 'project' && !eventMatchesProject_(e, view.projectId)) return false;
      if (exclude !== 'venue' && view.venueId && e.venueId !== view.venueId) return false;
      return true;
    });
  }

  function renderProjectPanel() {
    var base = eventsInScope_('project'); // respects Venue filter, ignores its own
    var baseIds = {}; base.forEach(function (e) { baseIds[e.id] = true; });
    var counts = {}, noProject = 0;
    meetings.forEach(function (m) {
      if (!baseIds[m.eventId]) return;
      var e = eventById[m.eventId], pid = e ? (e.projectId || '') : '';
      if (pid) counts[pid] = (counts[pid] || 0) + 1; else noProject++;
    });
    var rows = projects.filter(function (pr) { return counts[pr.id]; })
      .map(function (pr) { return { id: pr.id, name: pr.name, count: counts[pr.id] }; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
    if (noProject) rows.push({ id: '__none__', name: 'No ' + Term('project').toLowerCase(), count: noProject });
    if (view.projectId && !rows.some(function (r) { return r.id === view.projectId; })) view.projectId = '';
    var panel = document.getElementById('mtgProjectPanel');
    panel.innerHTML = panelRowsHtml_('All ' + Term('project_plural'), rows, view.projectId);
    panel.querySelectorAll('.mtg-filter-row').forEach(function (row) {
      row.onclick = function () {
        view.projectId = row.getAttribute('data-id');
        renderProjectPanel(); renderVenuePanel(); renderEventPanel(); renderSubEventPanel(); renderBody();
      };
    });
  }

  function renderVenuePanel() {
    var base = eventsInScope_('venue'); // respects Project filter, ignores its own
    var baseIds = {}; base.forEach(function (e) { baseIds[e.id] = true; });
    var counts = {};
    meetings.forEach(function (m) {
      if (!baseIds[m.eventId]) return;
      var e = eventById[m.eventId], vid = e ? e.venueId : '';
      if (vid) counts[vid] = (counts[vid] || 0) + 1;
    });
    var rows = Object.keys(counts).map(function (vid) { return { id: vid, name: venueById[vid] ? venueById[vid].name : vid, count: counts[vid] }; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
    if (view.venueId && !rows.some(function (r) { return r.id === view.venueId; })) view.venueId = '';
    var panel = document.getElementById('mtgVenuePanel');
    panel.innerHTML = panelRowsHtml_('All ' + Term('venue_plural'), rows, view.venueId);
    panel.querySelectorAll('.mtg-filter-row').forEach(function (row) {
      row.onclick = function () {
        view.venueId = row.getAttribute('data-id');
        renderVenuePanel(); renderProjectPanel(); renderEventPanel(); renderSubEventPanel(); renderBody();
      };
    });
  }

  // Bottom-but-one of the hierarchy -- respects BOTH Project and Venue filters, lists every Event
  // in scope regardless of meeting count (an Event with zero meetings is still a valid target to
  // pick and schedule the first one against).
  function renderEventPanel() {
    var base = eventsInScope_(null);
    var rows = base.map(function (e) {
      var count = meetings.filter(function (m) { return m.eventId === e.id; }).length;
      return { id: e.id, name: e.name, count: count };
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    if (view.eventId && !rows.some(function (r) { return r.id === view.eventId; })) view.eventId = '';
    var panel = document.getElementById('mtgEventPanel');
    panel.innerHTML = panelRowsHtml_('All ' + Term('event_plural'), rows, view.eventId);
    panel.querySelectorAll('.mtg-filter-row').forEach(function (row) {
      row.onclick = function () {
        view.eventId = row.getAttribute('data-id');
        if (view.subEventId && (!subEventById[view.subEventId] || subEventById[view.subEventId].eventId !== view.eventId)) view.subEventId = '';
        renderEventPanel(); renderSubEventPanel(); renderBody();
      };
    });
  }

  // Bottom of the hierarchy -- respects Project + Venue + Event. Picking a Sub-Event also snaps
  // the Event panel to its parent, since a Sub-Event only ever belongs to one Event.
  function renderSubEventPanel() {
    var evIds = {};
    eventsInScope_(null).forEach(function (e) { if (!view.eventId || e.id === view.eventId) evIds[e.id] = true; });
    var base = subEvents.filter(function (s) { return evIds[s.eventId]; });
    var rows = base.map(function (s) {
      var count = meetings.filter(function (m) { return m.subEventId === s.id; }).length;
      return { id: s.id, name: s.name, count: count };
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    if (view.subEventId && !rows.some(function (r) { return r.id === view.subEventId; })) view.subEventId = '';
    var panel = document.getElementById('mtgSubEventPanel');
    panel.innerHTML = panelRowsHtml_('All ' + Term('subEvent_plural'), rows, view.subEventId);
    panel.querySelectorAll('.mtg-filter-row').forEach(function (row) {
      row.onclick = function () {
        view.subEventId = row.getAttribute('data-id');
        if (view.subEventId) { var s = subEventById[view.subEventId]; if (s) view.eventId = s.eventId; }
        renderEventPanel(); renderSubEventPanel(); renderBody();
      };
    });
  }

  function meetingColumns_(withEventCol) {
    var cols = [
      { key: 'type', label: 'Type' },
      { key: 'scheduledAt', label: 'When', render: r => UI.fmtDate(r.scheduledAt) }
    ];
    if (withEventCol) cols.push({ key: 'eventId', label: Term('event'), render: r => esc(eventById[r.eventId] ? eventById[r.eventId].name : r.eventId) });
    cols.push({ key: 'subEventId', label: Term('subEvent'), render: r => r.subEventId && subEventById[r.subEventId] ? esc(subEventById[r.subEventId].name) : '<span class="muted">—</span>' });
    cols.push({ key: 'notes', label: 'Notes' });
    return cols;
  }

  function meetingsCardHtml_(titleHtml, rows, withCreateBtn) {
    return '<div class="card"><div class="card-header"><div class="card-title">' + titleHtml + '</div>' +
      (withCreateBtn ? '<button class="btn btn-primary btn-sm" id="newMtgBtn">+ Schedule</button>' : '') + '</div>' +
      '<div class="card-body">' + UI.table(meetingColumns_(false), rows, {}) + '</div></div>';
  }

  // Shared by the header's always-visible "+ Schedule" button and each card's own "+ Schedule"
  // button (meetingsCardHtml_) -- the only difference is whether the Event/Sub-Event fields come
  // pre-picked (card buttons, already scoped to one Event/Sub-Event) or need picking from scratch
  // (header button, no Event selected yet). Both go through the same modal so there's one place
  // that knows how to actually call scheduleKickoff.
  function openScheduleMeetingModal_(defaultEventId, defaultSubEventId) {
    var eventOptions = '<option value="">— Choose ' + esc(Term('event').toLowerCase()) + ' —</option>' +
      events.slice().sort(function (a, b) { return a.name.localeCompare(b.name); })
        .map(function (e) { return '<option value="' + esc(e.id) + '"' + (e.id === defaultEventId ? ' selected' : '') + '>' + esc(e.name) + '</option>'; }).join('');
    var typeOptions = MEETING_TYPES.map(function (mt) { return '<option value="' + esc(mt) + '">' + esc(mt) + '</option>'; }).join('');
    var body =
      UI.field(Term('event'), '<select id="fMtgEvent" class="field-input">' + eventOptions + '</select>') +
      UI.field(Term('subEvent') + ' (optional)', '<select id="fMtgSubEvent" class="field-input"><option value="">— None —</option></select>') +
      UI.field('Meeting type', '<select id="fMtgType" class="field-input">' + typeOptions + '</select>') +
      UI.field('Scheduled at', '<input id="fMtgWhen" type="datetime-local" class="field-input" />') +
      UI.field('Notes', '<textarea id="fMtgNotes" class="field-input" rows="2"></textarea>');
    UI.openModal('Schedule ' + Term('meeting').toLowerCase(), body, [
      { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
      { label: t('create'), className: 'btn-primary', onClick: async function () {
          var eventId = document.getElementById('fMtgEvent').value;
          if (!eventId) { UI.toast('Choose ' + Term('event').toLowerCase() + ' first', 'error'); return; }
          var subEventId = document.getElementById('fMtgSubEvent').value;
          try {
            await Api.call('scheduleKickoff', {
              eventId: eventId, subEventId: subEventId || '',
              type: document.getElementById('fMtgType').value,
              scheduledAt: document.getElementById('fMtgWhen').value,
              notes: document.getElementById('fMtgNotes').value
            });
            UI.closeModal(); UI.toast(Term('meeting') + ' scheduled', 'success');
            window.location.hash = '#/meetings?eventId=' + eventId + (subEventId ? '&subEventId=' + subEventId : '');
            Router.resolve();
          } catch (err) { UI.error(err); }
        } }
    ]);

    // Sub-Event options depend on whichever Event is currently picked -- repopulated on every
    // change so you can never submit a Sub-Event that doesn't actually belong to the chosen Event.
    function syncSubEventOptions(eventId) {
      var subSel = document.getElementById('fMtgSubEvent');
      var opts = subEvents.filter(function (s) { return s.eventId === eventId; });
      subSel.innerHTML = '<option value="">— None —</option>' + opts.map(function (s) {
        return '<option value="' + esc(s.id) + '"' + (s.id === defaultSubEventId ? ' selected' : '') + '>' + esc(s.name) + '</option>';
      }).join('');
    }
    var eventSel = document.getElementById('fMtgEvent');
    syncSubEventOptions(eventSel.value);
    eventSel.onchange = function () { syncSubEventOptions(eventSel.value); };
  }

  function wireNewMeetingBtn_(eventId, subEventId) {
    var btn = document.getElementById('newMtgBtn');
    if (!btn) return;
    btn.onclick = function () { openScheduleMeetingModal_(eventId, subEventId); };
  }

  function renderBody() {
    var body = document.getElementById('meetingsBody');
    if (view.subEventId) {
      var sub = subEventById[view.subEventId];
      if (!sub) { view.subEventId = ''; renderBody(); return; }
      var subEvent2 = eventById[sub.eventId];
      var subVenue = subEvent2 ? venueById[subEvent2.venueId] : null;
      var rows = meetings.filter(function (m) { return m.subEventId === view.subEventId; });
      body.innerHTML = meetingsCardHtml_(
        esc(Term('meeting_plural') + ' of ') + esc(sub.name) +
          (subEvent2 ? ' <span class="muted" style="font-weight:400;font-size:12.5px;">(' + esc(subEvent2.name) + (subVenue ? ' · ' + esc(subVenue.name) : '') + ')</span>' : ''),
        rows, true
      );
      wireNewMeetingBtn_(sub.eventId, sub.id);
    } else if (view.eventId) {
      var event = eventById[view.eventId];
      if (!event) { view.eventId = ''; renderBody(); return; }
      var venue = venueById[event.venueId];
      var rows2 = meetings.filter(function (m) { return m.eventId === view.eventId; });
      body.innerHTML = meetingsCardHtml_(
        esc(Term('meeting_plural') + ' of ') + esc(event.name) +
          (venue ? ' <span class="muted" style="font-weight:400;font-size:12.5px;">(' + esc(venue.name) + ')</span>' : ''),
        rows2, true
      );
      wireNewMeetingBtn_(view.eventId, '');
    } else {
      // "All Events" -- combine meetings across every Event currently in scope (Project + Venue
      // filters), tagging each row with its parent Event (and Sub-Event, if any).
      var scoped = eventsInScope_(null);
      var scopedIds = {}; scoped.forEach(function (e) { scopedIds[e.id] = true; });
      var combined = meetings.filter(function (m) { return scopedIds[m.eventId]; });
      body.innerHTML =
        '<div class="card"><div class="card-header"><div class="card-title">' + esc(Term('meeting_plural') + ' of All ' + Term('event_plural')) + '</div></div>' +
        '<div class="card-body">' + UI.table(meetingColumns_(true), combined, { emptyText: 'No ' + esc(Term('meeting_plural').toLowerCase()) + ' under the current filters.' }) +
        '<div class="muted" style="font-size:11.5px;margin-top:10px;">Pick a specific ' + esc(Term('event').toLowerCase()) + ' on the left, or use "+ Schedule ' + esc(Term('meeting').toLowerCase()) + '" above, to schedule one.</div>' +
        '</div></div>';
    }
  }

  document.getElementById('newMtgHeaderBtn').onclick = function () { openScheduleMeetingModal_(view.eventId, view.subEventId); };

  renderProjectPanel();
  renderVenuePanel();
  renderEventPanel();
  renderSubEventPanel();
  renderBody();
}
