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
 *
 * Schedule/Edit is a full page (REQ follow-up: "Convert to full page instead of pop up"), not a
 * modal -- see renderMeetingFormPage_/renderNewMeeting/renderEditMeeting below, routed at
 * #/meetings/new and #/meetings/:meetingId/edit (router.js).
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

// REQ: "Do not include participants in To:/Cc:" -- Vendor/Operator/Exhibitor accounts are event
// Participants with app-login access (see Accounts.gs's own "org users -> participants" account
// hierarchy comment), not internal staff. Meetings' To/Cc is an internal-staff coordination tool,
// so these three roles are filtered out of the picker entirely -- mirrors ROLES.VENDOR/OPERATOR/
// EXHIBITOR (Utils.gs) as literal strings, same mirroring convention as MEETING_TYPES above.
var PARTICIPANT_ROLES = ['Vendor', 'Operator', 'Exhibitor'];

async function renderMeetings(params) {
  var root = document.getElementById('viewRoot');
  // RBAC pilot (backend/Permissions.gs): admin-configurable from Settings > Permissions > Meetings >
  // "Schedule, edit, or delete a meeting".
  var canManage = hasPermission('meeting.manage');
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
      '<div class="page-subtitle">' + esc(t('meetings_subtitle', { term: Term('meeting_plural'), eventTerm: Term('event') })) + '</div></div></div>' +
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
    '<div class="page-subtitle">' + esc(t('meetings_subtitle', { term: Term('meeting_plural'), eventTerm: Term('event') })) + '</div></div>' +
    // Always-visible entry point, independent of the left-rail filter selection below -- the
    // per-card "+ Schedule" button (meetingsCardHtml_) only renders once a specific Event/Sub-Event
    // is picked on the left, which left "All Events" (the page's own default landing state, and
    // the state after e.g. picking a Project with no Event yet chosen) with no way to schedule a
    // meeting at all. This one links to the same full-page form but with its own Event picker, so
    // it works from any filter state.
    (canManage ? '<a class="btn btn-primary" id="newMtgHeaderBtn" href="#">' + esc(t('schedule_x_btn', { term: Term('meeting').toLowerCase() })) + '</a>' : '') +
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
    if (noProject) rows.push({ id: '__none__', name: t('label_no_project', { term: Term('project').toLowerCase() }), count: noProject });
    if (view.projectId && !rows.some(function (r) { return r.id === view.projectId; })) view.projectId = '';
    var panel = document.getElementById('mtgProjectPanel');
    panel.innerHTML = panelRowsHtml_(t('all_x', { term: Term('project_plural') }), rows, view.projectId);
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
    panel.innerHTML = panelRowsHtml_(t('all_x', { term: Term('venue_plural') }), rows, view.venueId);
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
    panel.innerHTML = panelRowsHtml_(t('all_x', { term: Term('event_plural') }), rows, view.eventId);
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
    panel.innerHTML = panelRowsHtml_(t('all_x', { term: Term('subEvent_plural') }), rows, view.subEventId);
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
      { key: 'type', label: t('field_meeting_type') },
      { key: 'scheduledAt', label: t('col_when'), render: r => UI.fmtDate(r.scheduledAt) }
    ];
    if (withEventCol) cols.push({ key: 'eventId', label: Term('event'), render: r => esc(eventById[r.eventId] ? eventById[r.eventId].name : r.eventId) });
    cols.push({ key: 'subEventId', label: Term('subEvent'), render: r => r.subEventId && subEventById[r.subEventId] ? esc(subEventById[r.subEventId].name) : '<span class="muted">—</span>' });
    cols.push({ key: 'meetingLink', label: t('col_link'), exportable: false, render: r => {
      var href = meetingLinkHref_(r.meetingLink);
      return href ? '<a class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('open_link_title')) + '" href="' + esc(href) + '" target="_blank" rel="noopener">' + ICON('share') + '</a>' : '<span class="muted">—</span>';
    } });
    // notes is now rich-text HTML (see richTextFieldHtml_ below) -- a table cell is no place to
    // render that in full, so this shows a short plain-text preview instead. esc() still runs on
    // whatever richTextPreview_ returns, same as every other custom render() in this app; the HTML
    // itself is only ever rendered in the full-page form (readRichTextField_/sanitizeRichText_
    // guarantee it's already limited to a safe tag allowlist by the time it gets here).
    cols.push({ key: 'notes', label: t('field_meeting_message'), render: r => {
      var preview = richTextPreview_(r.notes, 80);
      return preview ? esc(preview) : '<span class="muted">—</span>';
    } });
    if (canManage) cols.push({ key: 'actions', label: t('actions'), exportable: false, render: r =>
      UI.actionsCell(
        '<a class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('action_edit')) + '" href="#/meetings/' + esc(r.id) + '/edit">' + ICON('edit') + '</a>' +
        '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('action_delete')) + '" data-delete-mtg="' + esc(r.id) + '">' + ICON('delete') + '</button>'
      ) });
    return cols;
  }

  // Wires Delete on whichever meeting table was just rendered -- called after every
  // meetingsCardHtml_/combined-table innerHTML assignment in renderBody() below, since UI.table()
  // output is plain HTML with no handlers of its own attached yet. Edit is now a plain <a href>
  // (meetingColumns_ above), no JS wiring needed.
  function wireMeetingRowActions_() {
    document.querySelectorAll('[data-delete-mtg]').forEach(function (btn) {
      btn.onclick = function () {
        var meetingId = btn.getAttribute('data-delete-mtg');
        UI.confirmModal(t('delete_x_confirm', { term: Term('meeting').toLowerCase() }), async function () {
          try {
            await Api.call('deleteMeeting', { meetingId: meetingId });
            UI.toast(t('x_deleted', { term: Term('meeting') }), 'success');
            Router.resolve();
          } catch (err) { UI.error(err); }
        }, { confirmLabel: t('delete') });
      };
    });
  }

  function meetingsCardHtml_(titleHtml, rows, createHref) {
    return '<div class="card"><div class="card-header"><div class="card-title">' + titleHtml + '</div>' +
      (createHref && canManage ? '<a class="btn btn-primary btn-sm" href="' + esc(createHref) + '">' + esc(t('schedule_btn')) + '</a>' : '') + '</div>' +
      '<div class="card-body">' + UI.table(meetingColumns_(false), rows, {}) + '</div></div>';
  }

  function newMeetingHref_(eventId, subEventId) {
    return '#/meetings/new?eventId=' + encodeURIComponent(eventId || '') + (subEventId ? '&subEventId=' + encodeURIComponent(subEventId) : '');
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
        esc(t('meetings_of_prefix', { term: Term('meeting_plural') })) + esc(sub.name) +
          (subEvent2 ? ' <span class="muted" style="font-weight:400;font-size:12.5px;">(' + esc(subEvent2.name) + (subVenue ? ' · ' + esc(subVenue.name) : '') + ')</span>' : ''),
        rows, newMeetingHref_(sub.eventId, sub.id)
      );
      wireMeetingRowActions_();
    } else if (view.eventId) {
      var event = eventById[view.eventId];
      if (!event) { view.eventId = ''; renderBody(); return; }
      var venue = venueById[event.venueId];
      var rows2 = meetings.filter(function (m) { return m.eventId === view.eventId; });
      body.innerHTML = meetingsCardHtml_(
        esc(t('meetings_of_prefix', { term: Term('meeting_plural') })) + esc(event.name) +
          (venue ? ' <span class="muted" style="font-weight:400;font-size:12.5px;">(' + esc(venue.name) + ')</span>' : ''),
        rows2, newMeetingHref_(view.eventId, '')
      );
      wireMeetingRowActions_();
    } else {
      // "All Events" -- combine meetings across every Event currently in scope (Project + Venue
      // filters), tagging each row with its parent Event (and Sub-Event, if any).
      var scoped = eventsInScope_(null);
      var scopedIds = {}; scoped.forEach(function (e) { scopedIds[e.id] = true; });
      var combined = meetings.filter(function (m) { return scopedIds[m.eventId]; });
      body.innerHTML =
        '<div class="card"><div class="card-header"><div class="card-title">' + esc(t('meetings_of_all_events', { term: Term('meeting_plural'), eventTerm: Term('event_plural') })) + '</div></div>' +
        '<div class="card-body">' + UI.table(meetingColumns_(true), combined, { emptyText: esc(t('empty_no_meetings_filtered', { term: Term('meeting_plural').toLowerCase() })) }) +
        '<div class="muted" style="font-size:11.5px;margin-top:10px;">' + esc(t('pick_event_or_schedule_hint', { eventTerm: Term('event').toLowerCase(), term: Term('meeting').toLowerCase() })) + '</div>' +
        '</div></div>';
      wireMeetingRowActions_();
    }
  }

  if (canManage) document.getElementById('newMtgHeaderBtn').href = newMeetingHref_(view.eventId, view.subEventId);

  renderProjectPanel();
  renderVenuePanel();
  renderEventPanel();
  renderSubEventPanel();
  renderBody();
}

/* ---------------- Shared form-field builders (Schedule/Edit full page + table helpers) ---------------- */

function safeJsonArray_(raw) {
  if (!raw) return [];
  try { var v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}

// Only rendered as a clickable link when it's actually http(s) -- a plain text fallback for
// anything else (blank, or a non-URL typo) instead of ever emitting a javascript:/data: href.
function meetingLinkHref_(link) {
  return /^https?:\/\//i.test(String(link || '').trim()) ? link.trim() : '';
}

// Event options, optionally narrowed to one Project -- '' (no project picked) shows every Event,
// '__none__' shows only Events with no Project. eventsList is passed in (not closed over) so this
// is usable from both renderMeetings and the standalone full-page form below.
function eventOptionsHtml_(eventsList, projectId, selectedEventId) {
  var opts = eventsList.filter(function (e) { return !projectId || (projectId === '__none__' ? !e.projectId : e.projectId === projectId); });
  return '<option value="">' + esc(t('choose_event_option', { term: Term('event').toLowerCase() })) + '</option>' +
    opts.slice().sort(function (a, b) { return a.name.localeCompare(b.name); })
      .map(function (e) { return '<option value="' + esc(e.id) + '"' + (e.id === selectedEventId ? ' selected' : '') + '>' + esc(e.name) + '</option>'; }).join('');
}

// Search-then-pick multi-select for Users -- shared by the To and Cc fields, in both the create and
// edit forms. REQ (follow-up): "To:/Cc: should be searchable by username or email or user role.
// Remove To:/Cc: lists." -- replaces the old always-visible checkbox list with a type-to-search
// dropdown (same chat-suggest-box/-item pattern as the Event Chat @mention picker and Log Finding's
// Participant search, findings.js) plus removable chips for whoever's already picked (same chip
// look as the Event Chat composer's staged @mentions -- eventDetail.js chipHtml_). checkedIds
// pre-selects whichever ids are already on the meeting (edit only). usersList is expected to already
// exclude PARTICIPANT_ROLES (see renderMeetingFormPage_ below) -- REQ: "Do not include participants
// in To:/Cc:".
var USER_PICKER_STATE_ = {}; // prefix -> { selected: [user,...], usersList: [user,...] } -- one entry per field instance (fMtgTo/fMtgCc)

function userPickerFieldHtml_(prefix, label, checkedIds, usersList) {
  var checkedSet = {}; (checkedIds || []).forEach(function (id) { checkedSet[id] = true; });
  USER_PICKER_STATE_[prefix] = {
    selected: usersList.filter(function (u) { return checkedSet[u.id]; }),
    usersList: usersList
  };
  // position:relative built inline (not via UI.field()) so the chat-suggest-box dropdown -- itself
  // position:absolute -- anchors directly under the search input, same as findings.js's own
  // Participant search field.
  return '<div class="field-group" style="position:relative;">' +
    '<label class="field-label">' + esc(label) + '</label>' +
    '<input class="field-input" id="' + prefix + 'Search" autocomplete="off" placeholder="' + esc(t('search_people_placeholder')) + '" />' +
    '<div class="chat-suggest-box" id="' + prefix + 'Suggest" style="display:none;"></div>' +
    '<div id="' + prefix + 'Chips" style="margin-top:6px;"></div>' +
  '</div>';
}

// Matches on name, email, OR role (REQ: "searchable by username or email or user role") -- already-
// picked users are excluded from the results so the same person never appears twice in the dropdown.
function userPickerMatches_(prefix, query) {
  var state = USER_PICKER_STATE_[prefix];
  var q = (query || '').trim().toLowerCase();
  var selectedIds = {}; state.selected.forEach(function (u) { selectedIds[u.id] = true; });
  return state.usersList.filter(function (u) {
    if (selectedIds[u.id]) return false;
    if (!q) return true;
    return (u.name && u.name.toLowerCase().indexOf(q) !== -1) ||
      (u.email && u.email.toLowerCase().indexOf(q) !== -1) ||
      (u.role && u.role.toLowerCase().indexOf(q) !== -1);
  }).sort(function (a, b) { return a.name.localeCompare(b.name); });
}

function renderUserPickerChips_(prefix) {
  var box = document.getElementById(prefix + 'Chips');
  var state = USER_PICKER_STATE_[prefix];
  box.innerHTML = state.selected.map(function (u, i) {
    return '<span class="badge-neutral" style="display:inline-flex;align-items:center;gap:6px;padding:3px 8px;border-radius:999px;font-size:11.5px;margin:3px 6px 0 0;">' +
      esc(u.name) + ' <span class="muted" style="font-size:10.5px;">(' + esc(u.role) + ')</span>' +
      ' <button type="button" data-unpick="' + i + '" title="' + esc(t('action_delete')) + '" aria-label="' + esc(t('action_delete')) + '" style="border:none;background:none;cursor:pointer;color:var(--text-400);font-size:12px;line-height:1;padding:0;">' + ICON('close_modal') + '</button></span>';
  }).join('');
  box.querySelectorAll('[data-unpick]').forEach(function (btn) {
    btn.onclick = function () {
      state.selected.splice(Number(btn.getAttribute('data-unpick')), 1);
      renderUserPickerChips_(prefix);
    };
  });
}

function renderUserPickerSuggest_(prefix, query) {
  var suggest = document.getElementById(prefix + 'Suggest');
  var matches = userPickerMatches_(prefix, query);
  suggest.innerHTML = '<div class="chat-suggest-header">' + esc(t('search_people_placeholder')) + '</div>' +
    (matches.length
      ? matches.slice(0, 20).map(function (u, i) {
          return '<div class="chat-suggest-item" data-idx="' + i + '">' + esc(u.name) +
            ' <span class="muted" style="font-size:11px;">' + esc(u.email) + ' · ' + esc(u.role) + '</span></div>';
        }).join('')
      : '<div class="chat-suggest-empty">' + esc(t('no_suggestion_matches')) + '</div>');
  suggest.style.display = '';
  suggest.querySelectorAll('.chat-suggest-item').forEach(function (el) {
    // mousedown (not click) + preventDefault -- same reasoning as the Event Chat @mention picker:
    // keeps the search input focused instead of losing it to a click-triggered blur first.
    el.addEventListener('mousedown', function (e) {
      e.preventDefault();
      var picked = matches[Number(el.getAttribute('data-idx'))];
      USER_PICKER_STATE_[prefix].selected.push(picked);
      renderUserPickerChips_(prefix);
      var input = document.getElementById(prefix + 'Search');
      input.value = '';
      renderUserPickerSuggest_(prefix, '');
      input.focus();
    });
  });
}

function wireUserPickerSearch_(prefix) {
  var input = document.getElementById(prefix + 'Search');
  if (!input) return;
  renderUserPickerChips_(prefix);
  input.addEventListener('focus', function () { renderUserPickerSuggest_(prefix, input.value); });
  input.addEventListener('input', function () { renderUserPickerSuggest_(prefix, input.value); });
  input.addEventListener('keydown', function (e) { if (e.key === 'Escape') document.getElementById(prefix + 'Suggest').style.display = 'none'; });
  input.addEventListener('blur', function () { setTimeout(function () { document.getElementById(prefix + 'Suggest').style.display = 'none'; }, 150); });
}

function readCheckedUserIds_(prefix) {
  return (USER_PICKER_STATE_[prefix] ? USER_PICKER_STATE_[prefix].selected : []).map(function (u) { return u.id; });
}

// Subject = MEETING_TYPES picklist + an "Other" option that reveals a free-text input (REQ:
// "Meeting type as Subject & allow free text as well") -- same dropdown-plus-reveal pattern
// Checklist Items' own Checklist Type field uses (checklistItems.js openChecklistItemForm_).
function subjectFieldHtml_(currentType) {
  var matched = currentType && MEETING_TYPES.indexOf(currentType) !== -1;
  var typeOptions = MEETING_TYPES.map(function (mt) { return '<option value="' + esc(mt) + '"' + (mt === currentType ? ' selected' : '') + '>' + esc(mt) + '</option>'; }).join('');
  return UI.field(t('field_meeting_type'),
    '<select id="fMtgTypeSelect" class="field-input">' + typeOptions +
      '<option value="__other__"' + (currentType && !matched ? ' selected' : '') + '>' + esc(t('other_free_text_option')) + '</option>' +
    '</select>' +
    '<input id="fMtgTypeOther" class="field-input" placeholder="' + esc(t('field_meeting_type')) + '" style="margin-top:6px;' + (matched || !currentType ? 'display:none;' : '') + '" value="' + esc(!matched && currentType ? currentType : '') + '" />'
  );
}
function wireSubjectField_() {
  var sel = document.getElementById('fMtgTypeSelect');
  var other = document.getElementById('fMtgTypeOther');
  sel.onchange = function () { other.style.display = sel.value === '__other__' ? '' : 'none'; if (sel.value === '__other__') other.focus(); };
}
function readSubjectValue_() {
  var sel = document.getElementById('fMtgTypeSelect');
  return sel.value === '__other__' ? document.getElementById('fMtgTypeOther').value.trim() : sel.value;
}

/* ---------------- Notes: lightweight rich-text editor (REQ: "add editing and formatting tools") ----
 * A contenteditable <div> + toolbar wired straight to document.execCommand -- this app has no build
 * step or CDN dependency anywhere else, so pulling in an external editor library just for this field
 * would be inconsistent with the rest of the codebase. Content is kept safe two ways: the toolbar
 * itself only ever issues a small set of formatting commands, and every read (readRichTextField_)
 * re-sanitizes to a tag allowlist regardless, since a user can still paste arbitrary HTML into a
 * contenteditable region.
 */
var RTE_ALLOWED_TAGS_ = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, UL: 1, OL: 1, LI: 1, BR: 1, DIV: 1, P: 1, A: 1, SPAN: 1 };

function richTextFieldHtml_(id, label, initialHtml) {
  return UI.field(label,
    '<div class="rte-wrap" id="' + id + 'Wrap">' +
      '<div class="rte-toolbar" role="toolbar">' +
        '<button type="button" class="rte-btn" data-cmd="bold" title="' + esc(t('rte_bold')) + '" aria-label="' + esc(t('rte_bold')) + '">' + ICON('bold') + '</button>' +
        '<button type="button" class="rte-btn" data-cmd="italic" title="' + esc(t('rte_italic')) + '" aria-label="' + esc(t('rte_italic')) + '">' + ICON('italic') + '</button>' +
        '<button type="button" class="rte-btn" data-cmd="underline" title="' + esc(t('rte_underline')) + '" aria-label="' + esc(t('rte_underline')) + '">' + ICON('underline') + '</button>' +
        '<span class="rte-sep"></span>' +
        '<button type="button" class="rte-btn" data-cmd="insertUnorderedList" title="' + esc(t('rte_bullet_list')) + '" aria-label="' + esc(t('rte_bullet_list')) + '">' + ICON('list') + '</button>' +
        '<button type="button" class="rte-btn" data-cmd="insertOrderedList" title="' + esc(t('rte_numbered_list')) + '" aria-label="' + esc(t('rte_numbered_list')) + '">' + ICON('list-ordered') + '</button>' +
        '<span class="rte-sep"></span>' +
        '<button type="button" class="rte-btn" data-cmd="createLink" title="' + esc(t('rte_link')) + '" aria-label="' + esc(t('rte_link')) + '">' + ICON('link') + '</button>' +
        '<button type="button" class="rte-btn" data-cmd="removeFormat" title="' + esc(t('rte_clear_format')) + '" aria-label="' + esc(t('rte_clear_format')) + '">' + ICON('eraser') + '</button>' +
      '</div>' +
      '<div class="rte-body" id="' + id + '" contenteditable="true">' + (initialHtml || '') + '</div>' +
    '</div>'
  );
}

function wireRichTextField_(id) {
  var wrap = document.getElementById(id + 'Wrap');
  var body = document.getElementById(id);
  wrap.querySelectorAll('.rte-btn').forEach(function (btn) {
    // mousedown+preventDefault (not click) -- keeps focus, and crucially the current text
    // selection, inside the contenteditable body instead of the toolbar button stealing it, which
    // is what execCommand needs to know what to act on.
    btn.addEventListener('mousedown', function (e) {
      e.preventDefault();
      var cmd = btn.getAttribute('data-cmd');
      body.focus();
      if (cmd === 'createLink') {
        var url = window.prompt(t('rte_link_prompt'), 'https://');
        if (!url) return;
        if (!/^https?:\/\//i.test(url.trim())) { UI.toast(t('rte_link_invalid'), 'error'); return; }
        document.execCommand('createLink', false, url.trim());
      } else {
        document.execCommand(cmd, false, null);
      }
    });
  });
}

// DOM-walk sanitizer (not a regex) -- runs on every read (readRichTextField_ below), so pasted HTML
// (which can carry scripts, style/on* attributes, or tags outside RTE_ALLOWED_TAGS_) never reaches
// the backend. Unknown elements are unwrapped -- children kept, promoted up a level -- rather than
// dropped outright, so e.g. pasting from Word/Google Docs loses exotic formatting but keeps the text.
function sanitizeRichText_(html) {
  var tmp = document.createElement('div');
  tmp.innerHTML = String(html || '');
  (function walk(node) {
    Array.prototype.slice.call(node.childNodes).forEach(function (child) {
      if (child.nodeType === 1) {
        if (!RTE_ALLOWED_TAGS_[child.tagName]) {
          while (child.firstChild) node.insertBefore(child.firstChild, child);
          node.removeChild(child);
          return;
        }
        Array.prototype.slice.call(child.attributes).forEach(function (attr) {
          if (child.tagName === 'A' && attr.name === 'href' && /^https?:\/\//i.test(attr.value)) return;
          child.removeAttribute(attr.name);
        });
        if (child.tagName === 'A') { child.setAttribute('target', '_blank'); child.setAttribute('rel', 'noopener'); }
        walk(child);
      } else if (child.nodeType !== 3) {
        node.removeChild(child); // comments etc.
      }
    });
  })(tmp);
  return tmp.innerHTML;
}

function readRichTextField_(id) {
  return sanitizeRichText_(document.getElementById(id).innerHTML);
}

// Plain-text preview for the Notes table column (meetingColumns_ in renderMeetings above). Every
// custom render() in this table is trusted raw HTML unless it esc()s itself (see ui.js UI.table),
// so this only ever needs to strip tags -- the caller esc()s the result.
function richTextPreview_(html, maxLen) {
  var text = String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return maxLen && text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
}

/* ---------------- Schedule/Edit Meeting: full page ----------------
 * REQ (follow-up): "Convert to full page instead of pop up." Single shared implementation for both
 * #/meetings/new and #/meetings/:meetingId/edit (router.js) -- same 9 fields either way (Project,
 * Event, Sub-Event, Subject, Scheduled at, To, Cc, Meeting Link, Notes), only the submit call
 * (scheduleKickoff vs updateMeeting) and starting values differ. No link to this page is ever
 * rendered for a non-manager (see canManage gating in renderMeetings above), but the guard below
 * covers a direct URL hit too -- purely a UX nicety, since scheduleKickoff/updateMeeting's own
 * requireRole would reject the actual submit regardless.
 */
async function renderMeetingFormPage_(mode, params) {
  var root = document.getElementById('viewRoot');
  var isEdit = mode === 'edit';
  // RBAC pilot (backend/Permissions.gs): admin-configurable from Settings > Permissions > Meetings >
  // "Schedule, edit, or delete a meeting".
  var canManage = hasPermission('meeting.manage');
  if (!canManage) { window.location.hash = '#/meetings'; return; }

  var results = await Promise.all([
    Api.call('listEvents', {}), Api.call('listProjects', {}), Api.call('listSubEvents', {}),
    Api.call('listUsers', {}),
    isEdit ? Api.call('listMeetings', { includeDeleted: true }) : Promise.resolve([])
  ]);
  var events = results[0], projects = results[1], subEvents = results[2];
  // REQ: "Do not include participants in To:/Cc:" -- see PARTICIPANT_ROLES comment above.
  var users = results[3].filter(function (u) { return PARTICIPANT_ROLES.indexOf(u.role) === -1; });
  var eventById = {}; events.forEach(function (e) { eventById[e.id] = e; });

  var meeting = null;
  if (isEdit) {
    meeting = results[4].filter(function (m) { return m.id === params.meetingId; })[0];
    if (!meeting || meeting.status === 'Deleted') {
      root.innerHTML = '<div class="empty-state">' + esc(t('no_data')) + '</div>';
      return;
    }
  }

  var backHash = '#/meetings' + (function () {
    var eId = isEdit ? meeting.eventId : params.eventId;
    var sId = isEdit ? meeting.subEventId : params.subEventId;
    return eId ? ('?eventId=' + eId + (sId ? '&subEventId=' + sId : '')) : '';
  })();

  var startEventId = isEdit ? meeting.eventId : (params.eventId || '');
  var startSubEventId = isEdit ? meeting.subEventId : (params.subEventId || '');
  var startProjectId = startEventId && eventById[startEventId] ? (eventById[startEventId].projectId || '') : '';
  var projectOptions = '<option value="">' + esc(t('all_x', { term: Term('project_plural') })) + '</option>' +
    projects.slice().sort(function (a, b) { return a.name.localeCompare(b.name); })
      .map(function (pr) { return '<option value="' + esc(pr.id) + '"' + (pr.id === startProjectId ? ' selected' : '') + '>' + esc(pr.name) + '</option>'; }).join('');

  root.innerHTML =
    '<div class="breadcrumb"><a href="' + esc(backHash) + '">' + esc(Term('meeting_plural')) + '</a></div>' +
    '<div class="page-header"><div><div class="page-title">' + esc(isEdit ? t('edit_x', { term: Term('meeting') }) : t('schedule_x_title', { term: Term('meeting').toLowerCase() })) + '</div></div>' +
    '<button class="btn btn-secondary" id="backMtgFormBtn">' + ICON('back') + ' ' + esc(t('back')) + '</button></div>' +
    '<div class="card" style="max-width:760px;"><div class="card-body">' +
      UI.field(t('field_project_optional', { term: Term('project') }), '<select id="fMtgProject" class="field-input">' + projectOptions + '</select>') +
      UI.field(Term('event'), '<select id="fMtgEvent" class="field-input">' + eventOptionsHtml_(events, startProjectId, startEventId) + '</select>') +
      UI.field(t('field_project_optional', { term: Term('subEvent') }), '<select id="fMtgSubEvent" class="field-input"><option value="">' + esc(t('none_option')) + '</option></select>') +
      subjectFieldHtml_(isEdit ? meeting.type : '') +
      UI.field(t('field_scheduled_at'), '<input id="fMtgWhen" type="datetime-local" class="field-input" value="' + esc(isEdit ? normalizeDateTimeLocal(meeting.scheduledAt) : '') + '" />') +
      userPickerFieldHtml_('fMtgTo', t('field_to'), isEdit ? safeJsonArray_(meeting.toJson) : [], users) +
      userPickerFieldHtml_('fMtgCc', t('field_cc'), isEdit ? safeJsonArray_(meeting.ccJson) : [], users) +
      UI.field(t('field_meeting_link'), '<input id="fMtgLink" type="url" class="field-input" placeholder="https://…" value="' + esc(isEdit ? (meeting.meetingLink || '') : '') + '" />') +
      richTextFieldHtml_('fMtgNotes', t('field_meeting_message'), isEdit ? (meeting.notes || '') : '') +
      '<div style="display:flex;gap:8px;margin-top:16px;">' +
        '<button class="btn btn-primary" id="saveMtgFormBtn">' + esc(isEdit ? t('save') : t('create')) + '</button>' +
        '<a class="btn btn-secondary" href="' + esc(backHash) + '">' + esc(t('cancel')) + '</a>' +
      '</div>' +
    '</div></div>';

  document.getElementById('backMtgFormBtn').onclick = function () { window.location.hash = backHash; };

  wireSubjectField_();
  wireUserPickerSearch_('fMtgTo');
  wireUserPickerSearch_('fMtgCc');
  wireRichTextField_('fMtgNotes');

  // Sub-Event options depend on whichever Event is currently picked -- repopulated on every change
  // so you can never submit a Sub-Event that doesn't actually belong to the chosen Event. Picking a
  // Project re-narrows the Event list (and resets Sub-Event, since the old selection may no longer
  // be valid) -- purely a convenience filter, not itself stored on the meeting.
  function syncSubEventOptions(eventId) {
    var subSel = document.getElementById('fMtgSubEvent');
    var opts = subEvents.filter(function (s) { return s.eventId === eventId; });
    subSel.innerHTML = '<option value="">' + esc(t('none_option')) + '</option>' + opts.map(function (s) {
      return '<option value="' + esc(s.id) + '"' + (s.id === startSubEventId ? ' selected' : '') + '>' + esc(s.name) + '</option>';
    }).join('');
  }
  var projectSel = document.getElementById('fMtgProject');
  var eventSel = document.getElementById('fMtgEvent');
  syncSubEventOptions(eventSel.value);
  eventSel.onchange = function () { syncSubEventOptions(eventSel.value); };
  projectSel.onchange = function () {
    eventSel.innerHTML = eventOptionsHtml_(events, projectSel.value, '');
    syncSubEventOptions('');
  };

  document.getElementById('saveMtgFormBtn').onclick = async function () {
    var eventId = eventSel.value;
    if (!eventId) { UI.toast(t('toast_choose_event_first', { term: Term('event').toLowerCase() }), 'error'); return; }
    var subject = readSubjectValue_();
    if (!subject) { UI.toast(t('toast_subject_required'), 'error'); return; }
    var subEventId = document.getElementById('fMtgSubEvent').value;
    var payload = {
      eventId: eventId, subEventId: subEventId || '', type: subject,
      scheduledAt: document.getElementById('fMtgWhen').value,
      to: readCheckedUserIds_('fMtgTo'), cc: readCheckedUserIds_('fMtgCc'),
      meetingLink: document.getElementById('fMtgLink').value,
      notes: readRichTextField_('fMtgNotes')
    };
    try {
      if (isEdit) {
        payload.meetingId = meeting.id;
        await Api.call('updateMeeting', payload);
        UI.toast(t('x_updated', { term: Term('meeting') }), 'success');
      } else {
        await Api.call('scheduleKickoff', payload);
        UI.toast(t('toast_x_scheduled', { term: Term('meeting') }), 'success');
      }
      window.location.hash = '#/meetings?eventId=' + eventId + (subEventId ? '&subEventId=' + subEventId : '');
    } catch (err) { UI.error(err); }
  };
}

async function renderNewMeeting(params) { return renderMeetingFormPage_('create', params); }
async function renderEditMeeting(params) { return renderMeetingFormPage_('edit', params); }
