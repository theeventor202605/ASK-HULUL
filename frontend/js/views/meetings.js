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

// Mirrored verbatim from Templates.gs's own MEETING_MANAGE_ROLES -- who may schedule/edit/delete a
// meeting (matches scheduleKickoff/updateMeeting/deleteMeeting's own requireRole).
var MEETING_MANAGE_ROLES = ['SystemAdmin', 'InspectionAdmin', 'ProjectManager', 'EMCManager'];

async function renderMeetings(params) {
  var root = document.getElementById('viewRoot');
  var canManage = MEETING_MANAGE_ROLES.indexOf(HululState.user.role) !== -1;
  // listUsers 403s for roles outside its own allow-list (SystemAdmin/GAAdmin/EMCAdmin/
  // InspectionAdmin/EMCManager/ProjectManager) -- every one of those already covers every role that
  // can manage a meeting, so canManage is the right gate here too (same "only fetch what this role
  // can actually use" reasoning as Events' canManage -> listOrganizations).
  var [events, venues, projects, subEvents, meetings, users] = await Promise.all([
    Api.call('listEvents', {}), Api.call('listVenues', {}), Api.call('listProjects', {}),
    Api.call('listSubEvents', {}), Api.call('listMeetings', {}),
    canManage ? Api.call('listUsers', {}) : Promise.resolve([])
  ]);
  var venueById = {}; venues.forEach(function (v) { venueById[v.id] = v; });
  var projectById = {}; projects.forEach(function (pr) { projectById[pr.id] = pr; });
  var eventById = {}; events.forEach(function (e) { eventById[e.id] = e; });
  var subEventById = {}; subEvents.forEach(function (s) { subEventById[s.id] = s; });
  var userById = {}; users.forEach(function (u) { userById[u.id] = u; });

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
    // meeting at all. This one opens the same modal but with its own Event picker, so it works from
    // any filter state.
    (canManage ? '<button class="btn btn-primary" id="newMtgHeaderBtn">' + esc(t('schedule_x_btn', { term: Term('meeting').toLowerCase() })) + '</button>' : '') +
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

  function safeJsonArray_(raw) {
    if (!raw) return [];
    try { var v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }

  // Only rendered as a clickable link when it's actually http(s) -- a plain text fallback for
  // anything else (blank, or a non-URL typo) instead of ever emitting a javascript:/data: href.
  function meetingLinkHref_(link) {
    return /^https?:\/\//i.test(String(link || '').trim()) ? link.trim() : '';
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
    cols.push({ key: 'notes', label: t('col_notes') });
    if (canManage) cols.push({ key: 'actions', label: t('actions'), exportable: false, render: r =>
      '<div style="display:inline-flex;gap:6px;white-space:nowrap;">' +
        '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('action_edit')) + '" data-edit-mtg="' + esc(r.id) + '">' + ICON('edit') + '</button>' +
        '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('action_delete')) + '" data-delete-mtg="' + esc(r.id) + '">' + ICON('delete') + '</button>' +
      '</div>' });
    return cols;
  }

  // Wires Edit/Delete on whichever meeting table was just rendered -- called after every
  // meetingsCardHtml_/combined-table innerHTML assignment in renderBody() below, since UI.table()
  // output is plain HTML with no handlers of its own attached yet.
  function wireMeetingRowActions_() {
    document.querySelectorAll('[data-edit-mtg]').forEach(function (btn) {
      btn.onclick = function () {
        var m = meetings.filter(function (x) { return x.id === btn.getAttribute('data-edit-mtg'); })[0];
        if (m) openMeetingFormModal_('edit', m);
      };
    });
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

  function meetingsCardHtml_(titleHtml, rows, withCreateBtn) {
    return '<div class="card"><div class="card-header"><div class="card-title">' + titleHtml + '</div>' +
      (withCreateBtn && canManage ? '<button class="btn btn-primary btn-sm" id="newMtgBtn">' + esc(t('schedule_btn')) + '</button>' : '') + '</div>' +
      '<div class="card-body">' + UI.table(meetingColumns_(false), rows, {}) + '</div></div>';
  }

  // Compact searchable checkbox list of Users -- shared by the To and Cc fields, in both the create
  // and edit modals. checkedIds pre-checks whichever ids are already on the meeting (edit only).
  function userPickerFieldHtml_(prefix, label, checkedIds) {
    var checkedSet = {}; (checkedIds || []).forEach(function (id) { checkedSet[id] = true; });
    var rows = users.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (u) {
      return '<label class="' + prefix + '-row" data-search="' + esc((u.name + ' ' + u.email).toLowerCase()) + '" style="display:flex;align-items:center;gap:6px;font-size:12.5px;padding:3px 0;">' +
        '<input type="checkbox" class="' + prefix + '-check" value="' + esc(u.id) + '"' + (checkedSet[u.id] ? ' checked' : '') + ' /> ' +
        esc(u.name) + ' <span class="muted">(' + esc(u.role) + ')</span></label>';
    }).join('');
    return UI.field(label,
      '<input class="field-input" id="' + prefix + 'Search" placeholder="' + esc(t('search_people_placeholder')) + '" style="margin-bottom:6px;padding:6px 8px;font-size:12.5px;" />' +
      '<div style="max-height:130px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius-sm);padding:6px 10px;">' +
        (rows || '<div class="muted" style="font-size:12px;">' + esc(t('no_data')) + '</div>') +
      '</div>'
    );
  }
  function wireUserPickerSearch_(prefix) {
    var input = document.getElementById(prefix + 'Search');
    if (!input) return;
    input.oninput = function () {
      var q = this.value.trim().toLowerCase();
      document.querySelectorAll('.' + prefix + '-row').forEach(function (row) {
        row.style.display = (!q || row.getAttribute('data-search').indexOf(q) !== -1) ? '' : 'none';
      });
    };
  }
  function readCheckedUserIds_(prefix) {
    var ids = [];
    document.querySelectorAll('.' + prefix + '-check:checked').forEach(function (c) { ids.push(c.value); });
    return ids;
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

  // Event options, optionally narrowed to one Project -- '' (no project picked) shows every Event,
  // '__none__' shows only Events with no Project.
  function eventOptionsHtml_(projectId, selectedEventId) {
    var opts = events.filter(function (e) { return !projectId || (projectId === '__none__' ? !e.projectId : e.projectId === projectId); });
    return '<option value="">' + esc(t('choose_event_option', { term: Term('event').toLowerCase() })) + '</option>' +
      opts.slice().sort(function (a, b) { return a.name.localeCompare(b.name); })
        .map(function (e) { return '<option value="' + esc(e.id) + '"' + (e.id === selectedEventId ? ' selected' : '') + '>' + esc(e.name) + '</option>'; }).join('');
  }

  // Shared by the header's always-visible "+ Schedule" button, each card's own "+ Schedule" button
  // (meetingsCardHtml_ -- already scoped to one Event/Sub-Event), and every row's Edit action.
  // mode 'create' calls scheduleKickoff, 'edit' calls updateMeeting -- same 9 fields either way, only
  // the submit call and starting values differ.
  function openMeetingFormModal_(mode, meeting, defaultEventId, defaultSubEventId) {
    var isEdit = mode === 'edit';
    var startEventId = isEdit ? meeting.eventId : (defaultEventId || '');
    var startSubEventId = isEdit ? meeting.subEventId : (defaultSubEventId || '');
    var startProjectId = startEventId && eventById[startEventId] ? (eventById[startEventId].projectId || '') : '';
    var projectOptions = '<option value="">' + esc(t('all_x', { term: Term('project_plural') })) + '</option>' +
      projects.slice().sort(function (a, b) { return a.name.localeCompare(b.name); })
        .map(function (pr) { return '<option value="' + esc(pr.id) + '"' + (pr.id === startProjectId ? ' selected' : '') + '>' + esc(pr.name) + '</option>'; }).join('');

    var body =
      UI.field(t('field_project_optional', { term: Term('project') }), '<select id="fMtgProject" class="field-input">' + projectOptions + '</select>') +
      UI.field(Term('event'), '<select id="fMtgEvent" class="field-input">' + eventOptionsHtml_(startProjectId, startEventId) + '</select>') +
      UI.field(t('field_project_optional', { term: Term('subEvent') }), '<select id="fMtgSubEvent" class="field-input"><option value="">' + esc(t('none_option')) + '</option></select>') +
      subjectFieldHtml_(isEdit ? meeting.type : '') +
      UI.field(t('field_scheduled_at'), '<input id="fMtgWhen" type="datetime-local" class="field-input" value="' + esc(isEdit ? normalizeDateTimeLocal(meeting.scheduledAt) : '') + '" />') +
      userPickerFieldHtml_('fMtgTo', t('field_to'), isEdit ? safeJsonArray_(meeting.toJson) : []) +
      userPickerFieldHtml_('fMtgCc', t('field_cc'), isEdit ? safeJsonArray_(meeting.ccJson) : []) +
      UI.field(t('field_meeting_link'), '<input id="fMtgLink" type="url" class="field-input" placeholder="https://…" value="' + esc(isEdit ? (meeting.meetingLink || '') : '') + '" />') +
      UI.field(t('col_notes'), '<textarea id="fMtgNotes" class="field-input" rows="2">' + esc(isEdit ? (meeting.notes || '') : '') + '</textarea>');

    UI.openModal(isEdit ? t('edit_x', { term: Term('meeting') }) : t('schedule_x_title', { term: Term('meeting').toLowerCase() }), body, [
      { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
      { label: isEdit ? t('save') : t('create'), className: 'btn-primary', onClick: async function () {
          var eventId = document.getElementById('fMtgEvent').value;
          if (!eventId) { UI.toast(t('toast_choose_event_first', { term: Term('event').toLowerCase() }), 'error'); return; }
          var subject = readSubjectValue_();
          if (!subject) { UI.toast(t('toast_subject_required'), 'error'); return; }
          var subEventId = document.getElementById('fMtgSubEvent').value;
          var payload = {
            eventId: eventId, subEventId: subEventId || '', type: subject,
            scheduledAt: document.getElementById('fMtgWhen').value,
            to: readCheckedUserIds_('fMtgTo'), cc: readCheckedUserIds_('fMtgCc'),
            meetingLink: document.getElementById('fMtgLink').value,
            notes: document.getElementById('fMtgNotes').value
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
            UI.closeModal();
            window.location.hash = '#/meetings?eventId=' + eventId + (subEventId ? '&subEventId=' + subEventId : '');
            Router.resolve();
          } catch (err) { UI.error(err); }
        } }
    ]);

    wireSubjectField_();
    wireUserPickerSearch_('fMtgTo');
    wireUserPickerSearch_('fMtgCc');

    // Sub-Event options depend on whichever Event is currently picked -- repopulated on every
    // change so you can never submit a Sub-Event that doesn't actually belong to the chosen Event.
    // Picking a Project re-narrows the Event list (and resets Sub-Event, since the old selection may
    // no longer be valid) -- purely a convenience filter, not itself stored on the meeting.
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
      eventSel.innerHTML = eventOptionsHtml_(projectSel.value, '');
      syncSubEventOptions('');
    };
  }

  function wireNewMeetingBtn_(eventId, subEventId) {
    var btn = document.getElementById('newMtgBtn');
    if (!btn) return;
    btn.onclick = function () { openMeetingFormModal_('create', null, eventId, subEventId); };
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
        rows, true
      );
      wireNewMeetingBtn_(sub.eventId, sub.id);
      wireMeetingRowActions_();
    } else if (view.eventId) {
      var event = eventById[view.eventId];
      if (!event) { view.eventId = ''; renderBody(); return; }
      var venue = venueById[event.venueId];
      var rows2 = meetings.filter(function (m) { return m.eventId === view.eventId; });
      body.innerHTML = meetingsCardHtml_(
        esc(t('meetings_of_prefix', { term: Term('meeting_plural') })) + esc(event.name) +
          (venue ? ' <span class="muted" style="font-weight:400;font-size:12.5px;">(' + esc(venue.name) + ')</span>' : ''),
        rows2, true
      );
      wireNewMeetingBtn_(view.eventId, '');
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

  if (canManage) document.getElementById('newMtgHeaderBtn').onclick = function () { openMeetingFormModal_('create', null, view.eventId, view.subEventId); };

  renderProjectPanel();
  renderVenuePanel();
  renderEventPanel();
  renderSubEventPanel();
  renderBody();
}
