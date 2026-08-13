/**
 * HULUL - Projects: a GA-level grouping of several Events (e.g. a multi-venue program), distinct
 * from the legacy free-text Events.project column (kept only for CSV backward-compat -- see
 * Projects.gs). Listing is open to any authenticated user (matches listEvents/listVenues); only
 * GA Admin/User (and SystemAdmin) can create/edit/delete/link events, matching createEvent's own
 * role gate.
 */
var PROJECT_MANAGE_ROLES_ = ['SystemAdmin', 'GAAdmin', 'GAUser'];

// Whether to plot the (often numerous, per-event) red end-date dots on the timeline -- off by
// default to keep the line uncluttered; persisted so the choice survives a page reload. The big
// green/red anchor dots for the project's own overall start/end always show regardless.
var PROJECTS_END_DOTS_KEY_ = 'hulul_projects_show_end_dots';
function projectsShowEndDots_() { return localStorage.getItem(PROJECTS_END_DOTS_KEY_) === '1'; }
function projectsEndDotsToggleHtml_(showEndDots) {
  return '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-600);cursor:pointer;white-space:nowrap;">' +
    '<input type="checkbox" id="toggleEndDotsChk" ' + (showEndDots ? 'checked' : '') + ' style="cursor:pointer;" /> ' + esc(t('show_end_dots_label')) +
  '</label>';
}
function wireEndDotsToggle_() {
  var chk = document.getElementById('toggleEndDotsChk');
  if (chk) chk.onchange = function () { localStorage.setItem(PROJECTS_END_DOTS_KEY_, this.checked ? '1' : '0'); Router.resolve(); };
}

// Duration between two timestamps expressed as calendar months + remaining days, e.g. "3m 11d".
// Uses real calendar-month arithmetic (not a flat 30-day approximation) so it stays accurate
// across months of different lengths.
function tlDuration_(startMs, endMs) {
  var start = new Date(startMs), end = new Date(endMs);
  var months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  var days = end.getDate() - start.getDate();
  if (days < 0) { months -= 1; days += new Date(end.getFullYear(), end.getMonth(), 0).getDate(); }
  if (months < 0) months = 0;
  if (days < 0) days = 0;
  var parts = [];
  if (months) parts.push(months + 'm');
  if (days || !parts.length) parts.push(days + 'd');
  return parts.join(' ');
}

// Horizontal date-line for a Project: a big green dot at the overall start, a big red dot at the
// overall end, plus a small green dot for every calendar day an Event starts on and (when
// showEndDots is on) a small red dot for every calendar day an Event ends on, each positioned
// proportionally between the two ends BY DATE ONLY -- time-of-day is stripped before placing a dot,
// so two events starting on the same calendar day (e.g. 09:00 and 21:00) land on the exact same
// spot rather than a few pixels apart. Events sharing the same start (or end) day collapse into a
// single dot; hovering it lists every one of them stacked on its own line -- end-dot lines also
// include that event's own duration (e.g. "3m 11d") since several events ending the same day can
// have started very differently. A rotated date label sits under every plotted dot.
function projectTimelineHtml_(evs, showEndDots, subEventCount) {
  var statsHtml = projectStatsHtml_(evs, subEventCount);
  if (!evs.length) return '<div class="muted" style="font-size:12px;margin-top:10px;">' + esc(t('no_events_yet_nothing_to_plot', { term: Term('event_plural').toLowerCase() })) + '</div>' + statsHtml;

  function dateOnlyMs(ms) { var d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
  function dayKey(ms) { var d = new Date(ms); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }
  function dateLabel(ms) { return new Date(ms).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }); }

  var rawStarts = evs.map(function (e) { return new Date(e.startDateTime).getTime(); }).filter(function (n) { return !isNaN(n); });
  var rawEnds = evs.map(function (e) { return new Date(e.endDateTime).getTime(); }).filter(function (n) { return !isNaN(n); });
  if (!rawStarts.length || !rawEnds.length) return '<div class="muted" style="font-size:12px;margin-top:10px;">' + esc(t('no_events_have_dates', { term: Term('event_plural') })) + '</div>' + statsHtml;

  var lo = Math.min.apply(null, rawStarts.map(dateOnlyMs)), hi = Math.max.apply(null, rawEnds.map(dateOnlyMs));
  // The plotted line itself starts three weeks before the earliest Event, giving a lead-in stretch
  // of blank track before the first (green) dot -- e.g. so the "now" marker still has somewhere to
  // land while a project hasn't started yet. The big start/end anchor dots stay pinned to the real
  // lo/hi dates, they just aren't at the very left edge anymore.
  var axisLo = lo - 21 * 24 * 60 * 60 * 1000;
  var span = Math.max(hi - axisLo, 1);
  function pct(ms) { return Math.min(100, Math.max(0, ((dateOnlyMs(ms) - axisLo) / span) * 100)); }

  var startGroups = {}, endGroups = {};
  evs.forEach(function (e) {
    var s = new Date(e.startDateTime).getTime(), en = new Date(e.endDateTime).getTime();
    if (!isNaN(s)) {
      var sk = dayKey(s);
      if (!startGroups[sk]) startGroups[sk] = { pct: pct(s), ms: dateOnlyMs(s), lines: [], names: [] };
      startGroups[sk].lines.push(e.name);
      startGroups[sk].names.push(e.name);
    }
    if (!isNaN(en)) {
      var ek = dayKey(en);
      if (!endGroups[ek]) endGroups[ek] = { pct: pct(en), ms: dateOnlyMs(en), lines: [], names: [] };
      endGroups[ek].lines.push(e.name + ' (' + tlDuration_(isNaN(s) ? en : s, en) + ')');
      endGroups[ek].names.push(e.name);
    }
  });
  var loKey = dayKey(lo), hiKey = dayKey(hi);
  var now = Date.now();
  var nowInRange = dateOnlyMs(now) >= axisLo && dateOnlyMs(now) <= hi;

  var dots = [];
  Object.keys(startGroups).forEach(function (k) { dots.push({ pct: startGroups[k].pct, cls: 'tl-dot-green', title: startGroups[k].lines.join('\n') }); });
  if (showEndDots) Object.keys(endGroups).forEach(function (k) { dots.push({ pct: endGroups[k].pct, cls: 'tl-dot-red', title: endGroups[k].lines.join('\n') }); });
  var dotsHtml = dots.map(function (d) {
    return '<div class="tl-dot ' + d.cls + '" style="left:' + d.pct.toFixed(2) + '%;" title="' + esc(d.title) + '"></div>';
  }).join('') +
    // Big anchor dots sit exactly on top of the small dot for the same day, so their tooltip must
    // fold in that day's event names itself (a plain "Project start/end" title would otherwise
    // mask the event list underneath since the big dot renders above it).
    '<div class="tl-dot tl-dot-big tl-dot-green" style="left:' + pct(lo).toFixed(2) + '%;" title="' + esc(t('project_start_label', { term: Term('project') }) + UI.fmtDate(lo) + (startGroups[loKey] ? '\n' + startGroups[loKey].lines.join('\n') : '')) + '"></div>' +
    '<div class="tl-dot tl-dot-big tl-dot-red" style="left:' + pct(hi).toFixed(2) + '%;" title="' + esc(t('project_end_label', { term: Term('project') }) + UI.fmtDate(hi) + (endGroups[hiKey] ? '\n' + endGroups[hiKey].lines.join('\n') : '')) + '"></div>' +
    // Blinking "now" marker -- only plotted when the current moment actually falls within this
    // project's own start/end window, since clamping it to an edge when today is outside that
    // window would misleadingly suggest today IS the start or end.
    (nowInRange ? '<div class="tl-dot tl-dot-now" style="left:' + pct(now).toFixed(2) + '%;" title="' + esc(t('now_prefix') + UI.fmtDate(now)) + '"></div>' : '');

  // Whichever plotted start-day or end-day is chronologically closest to right now gets its
  // event name(s) written out permanently above its dot (not just on hover) -- a quick "what's
  // closest" cue without having to hover every dot. Only end-day groups that actually have a
  // rendered dot are eligible (every start day always does; an end day only when showEndDots is on,
  // or it's the overall end day, whose big anchor dot always shows).
  var nearest = null, nearestDiff = Infinity;
  Object.keys(startGroups).forEach(function (k) {
    var diff = Math.abs(startGroups[k].ms - now);
    if (diff < nearestDiff) { nearestDiff = diff; nearest = { pct: startGroups[k].pct, names: startGroups[k].names, kind: 'start' }; }
  });
  Object.keys(endGroups).forEach(function (k) {
    if (!showEndDots && k !== hiKey) return;
    var diff = Math.abs(endGroups[k].ms - now);
    if (diff < nearestDiff) { nearestDiff = diff; nearest = { pct: endGroups[k].pct, names: endGroups[k].names, kind: 'end' }; }
  });
  var nearestHtml = nearest
    ? '<div class="tl-nearest-label" style="left:' + nearest.pct.toFixed(2) + '%;color:' + (nearest.kind === 'start' ? '#16a34a' : '#dc2626') + ';">' +
        nearest.names.map(function (n) { return '<div>' + esc(n) + '</div>'; }).join('') +
      '</div>'
    : '';

  // Date labels: every start day always gets one; end days only get one when showEndDots is on --
  // except the overall end day (hiKey), which always gets a label since its big anchor dot is
  // always shown too. Skip a duplicate label if a start day already sits at the exact same spot.
  var labelSeen = {};
  var labels = [];
  Object.keys(startGroups).forEach(function (k) {
    labelSeen[startGroups[k].pct.toFixed(1)] = true;
    labels.push({ pct: startGroups[k].pct, text: dateLabel(startGroups[k].ms) });
  });
  Object.keys(endGroups).forEach(function (k) {
    if (!showEndDots && k !== hiKey) return;
    var posKey = endGroups[k].pct.toFixed(1);
    if (labelSeen[posKey]) return;
    labelSeen[posKey] = true;
    labels.push({ pct: endGroups[k].pct, text: dateLabel(endGroups[k].ms) });
  });
  // Positioned by its right edge (mirrored percentage), not left -- see .tl-date-label's
  // transform-origin comment in styles.css for why: it keeps the label anchored snugly against
  // its dot instead of drifting away from it once rotated. The "+ 6px" nudges it a bit further
  // left of the dot, per feedback that it sat too far right.
  var labelsHtml = labels.map(function (l) {
    return '<div class="tl-date-label" style="right:calc(' + (100 - l.pct).toFixed(2) + '% + 6px);">' + esc(l.text) + '</div>';
  }).join('');

  return '<div class="project-timeline">' + '<div class="project-timeline-track"></div>' + dotsHtml + labelsHtml + nearestHtml + '</div>' +
    '<div style="display:flex;gap:14px;font-size:10.5px;color:var(--text-600);margin-top:30px;flex-wrap:wrap;align-items:center;">' +
      '<span><span class="tl-legend-dot tl-dot-green"></span>' + esc(t('legend_event_start')) + '</span>' +
      (showEndDots ? '<span><span class="tl-legend-dot tl-dot-red"></span>' + esc(t('legend_event_end')) + '</span>' : '') +
      (nowInRange ? '<span><span class="tl-legend-dot tl-dot-now"></span>' + esc(t('legend_now')) + '</span>' : '') +
      '<span class="tl-legend-sep"></span>' +
      projectStatsChipsHtml_(evs, subEventCount) +
    '</div>';
}

// Totals shown alongside the timeline legend: how many Events/Sub-events/Venues make up this
// Project, plus a time-based breakdown of its Events -- Scheduled (start still in the future),
// Ongoing (started, not yet ended) and Ended (end already passed) -- computed from each Event's
// own start/end against the current moment, not from its Events.status field (which tracks
// workflow stage, not the calendar).
function projectStatsChipsHtml_(evs, subEventCount) {
  var now = Date.now();
  var venueSet = {};
  var notStarted = 0, ongoing = 0, ended = 0;
  evs.forEach(function (e) {
    if (e.venueId) venueSet[e.venueId] = true;
    var s = new Date(e.startDateTime).getTime(), en = new Date(e.endDateTime).getTime();
    if (isNaN(s) || isNaN(en)) return;
    if (now < s) notStarted++;
    else if (now > en) ended++;
    else ongoing++;
  });
  var venueCount = Object.keys(venueSet).length;
  function chip(n, label) { return '<span><strong style="color:var(--text-900);">' + n + '</strong> ' + esc(label) + '</span>'; }
  return chip(evs.length, Term(evs.length === 1 ? 'event' : 'event_plural')) +
    chip(subEventCount || 0, Term((subEventCount || 0) === 1 ? 'subEvent' : 'subEvent_plural')) +
    chip(venueCount, Term(venueCount === 1 ? 'venue' : 'venue_plural')) +
    chip(notStarted, t('chip_scheduled')) +
    chip(ongoing, t('chip_ongoing')) +
    chip(ended, t('chip_ended'));
}

function projectStatsHtml_(evs, subEventCount) {
  return '<div style="display:flex;gap:14px;font-size:10.5px;color:var(--text-600);margin-top:10px;flex-wrap:wrap;align-items:center;">' +
    projectStatsChipsHtml_(evs, subEventCount) +
  '</div>';
}

async function renderProjects() {
  var root = document.getElementById('viewRoot');
  var canManage = PROJECT_MANAGE_ROLES_.indexOf(HululState.user.role) !== -1;
  var [projects, events, subEvents] = await Promise.all([Api.call('listProjects', {}), Api.call('listEvents', {}), Api.call('listSubEvents', {})]);
  var showEndDots = projectsShowEndDots_();
  var subEventCountByEvent = {};
  subEvents.forEach(function (s) { subEventCountByEvent[s.eventId] = (subEventCountByEvent[s.eventId] || 0) + 1; });

  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + esc(Term('project_plural')) + '</div>' +
    '<div class="page-subtitle">' + esc(t('projects_subtitle', { term: Term('event_plural').toLowerCase() })) + '</div></div>' +
    '<div style="display:flex;align-items:center;gap:16px;">' +
      projectsEndDotsToggleHtml_(showEndDots) +
      (canManage ? '<button class="btn btn-primary" id="newProjectBtn">' + esc(t('new_x', { term: Term('project').toLowerCase() })) + '</button>' : '') +
    '</div>' +
    '</div>' +
    (projects.length
      ? '<div style="display:flex;flex-direction:column;gap:14px;">' +
        projects.map(function (pr) {
          var evs = events.filter(function (e) { return e.projectId === pr.id; });
          var subCount = evs.reduce(function (sum, e) { return sum + (subEventCountByEvent[e.id] || 0); }, 0);
          return '<div class="card" style="padding:16px 20px;">' +
            '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">' +
              '<div>' +
                '<a href="#/projects/' + pr.id + '" style="font-weight:700;font-size:14.5px;color:var(--text-900);text-decoration:none;">' + esc(pr.name) + '</a>' +
                (pr.description ? '<div class="muted" style="font-size:12px;margin-top:4px;">' + esc(pr.description) + '</div>' : '') +
              '</div>' +
              (canManage ? '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('delete')) + '" data-del-project="' + pr.id + '">' + ICON('delete') + '</button>' : '') +
            '</div>' +
            projectTimelineHtml_(evs, showEndDots, subCount) +
          '</div>';
        }).join('') + '</div>'
      : '<div class="card"><div class="card-body"><div class="empty-state">' + esc(t('empty_no_projects_yet', { term: Term('project_plural').toLowerCase() })) +
          (canManage ? esc(t('create_one_then_add_hint', { term: Term('event_plural').toLowerCase() })) : '') + '</div></div></div>');

  wireEndDotsToggle_();
  if (!canManage) return;

  document.getElementById('newProjectBtn').onclick = function () {
    var body = UI.field(t('field_project_name', { term: Term('project') }), '<input id="fProjName" class="field-input" />') +
      UI.field(t('field_description_optional'), '<textarea id="fProjDesc" class="field-input" rows="2"></textarea>');
    UI.openModal(t('new_x_title', { term: Term('project') }), body, [
      { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
      { label: t('create'), className: 'btn-primary', onClick: async function () {
          try {
            var created = await Api.call('createProject', {
              name: document.getElementById('fProjName').value, description: document.getElementById('fProjDesc').value
            });
            UI.closeModal(); UI.toast(t('x_created', { term: Term('project') }), 'success');
            window.location.hash = '#/projects/' + created.id;
          } catch (err) { UI.error(err); }
        } }
    ]);
  };
  root.querySelectorAll('[data-del-project]').forEach(function (btn) {
    btn.onclick = function () {
      UI.confirmModal(t('delete_confirm_project', { term: Term('project').toLowerCase(), eventTerm: Term('event_plural').toLowerCase() }), async function () {
        try { await Api.call('deleteProject', { projectId: btn.getAttribute('data-del-project') }); UI.toast(t('x_deleted', { term: Term('project') }), 'success'); Router.resolve(); }
        catch (err) { UI.error(err); }
      }, { title: t('delete_modal_title', { term: Term('project').toLowerCase() }), confirmLabel: t('delete') });
    };
  });
}

async function renderProjectDetail(params) {
  var root = document.getElementById('viewRoot');
  var projectId = params.id;
  var canManage = PROJECT_MANAGE_ROLES_.indexOf(HululState.user.role) !== -1;
  var [projects, events, venues, orgs, subEvents] = await Promise.all([
    Api.call('listProjects', {}), Api.call('listEvents', {}), Api.call('listVenues', {}),
    canManage ? Api.call('listOrganizations', {}) : Promise.resolve([]), Api.call('listSubEvents', {})
  ]);
  var project = projects.filter(function (pr) { return pr.id === projectId; })[0];
  if (!project) { root.innerHTML = '<div class="empty-state">' + esc(t('x_not_found', { term: Term('project') })) + '</div>'; return; }
  var inspectionCos = orgs.filter(function (o) { return o.type === 'INSPECTION'; });
  var emcOrgs = orgs.filter(function (o) { return o.type === 'EMC'; });
  var venueById = {}; venues.forEach(function (v) { venueById[v.id] = v; });
  var linked = events.filter(function (e) { return e.projectId === projectId; });
  var unlinked = events.filter(function (e) { return e.projectId !== projectId; });
  var subEventCountByEvent = {};
  subEvents.forEach(function (s) { subEventCountByEvent[s.eventId] = (subEventCountByEvent[s.eventId] || 0) + 1; });
  var linkedSubCount = linked.reduce(function (sum, e) { return sum + (subEventCountByEvent[e.id] || 0); }, 0);
  var showEndDots = projectsShowEndDots_();

  root.innerHTML =
    '<div class="breadcrumb"><a href="#/projects">' + esc(Term('project_plural')) + '</a> / ' + esc(project.name) + '</div>' +
    '<div class="page-header"><div><div class="page-title">' + esc(project.name) + '</div>' +
    (project.description ? '<div class="page-subtitle">' + esc(project.description) + '</div>' : '') + '</div>' +
    '<div style="display:flex;align-items:center;gap:16px;">' +
      projectsEndDotsToggleHtml_(showEndDots) +
      (canManage
        ? '<div style="display:flex;gap:8px;">' +
            '<button class="btn btn-secondary btn-icon" title="' + esc(t('action_edit')) + '" id="editProjectBtn">' + ICON('edit') + '</button>' +
            '<button class="btn btn-secondary" id="addExistingEventsBtn">' + esc(t('add_existing_x_btn', { term: Term('event_plural').toLowerCase() })) + '</button>' +
            '<button class="btn btn-primary" id="newProjectEventBtn">' + esc(t('new_x', { term: Term('event').toLowerCase() })) + '</button>' +
          '</div>'
        : '') +
    '</div>' +
    '</div>' +
    '<div class="card" style="padding:16px 20px;margin-bottom:16px;">' + projectTimelineHtml_(linked, showEndDots, linkedSubCount) + '</div>' +
    '<div class="card"><div class="card-body">' + UI.table([
      { key: 'name', label: Term('event'), render: r => '<a href="#/events/' + r.id + '" style="color:var(--accent);font-weight:600;text-decoration:none;">' + esc(r.name) + '</a>' },
      { key: 'venueId', label: Term('venue'), render: r => esc(venueById[r.venueId] ? venueById[r.venueId].name : r.venueId) },
      { key: 'city', label: t('col_city') },
      { key: 'startDateTime', label: t('col_start'), render: r => UI.fmtDate(r.startDateTime) },
      { key: 'endDateTime', label: t('col_end'), render: r => UI.fmtDate(r.endDateTime) },
      { key: 'status', label: t('status'), render: r => UI.statusBadge(r.status) }
    ].concat(canManage ? [{ key: 'actions', label: t('actions'), render: r =>
        '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('remove_from_x_title', { term: Term('project').toLowerCase() })) + '" data-remove-event="' + r.id + '">' + ICON('remove_from_project') + '</button>' }] : []),
      linked, { emptyText: esc(t('empty_no_events_in_project', { eventTerm: Term('event_plural').toLowerCase(), term: Term('project').toLowerCase() })) }) + '</div></div>';

  wireEndDotsToggle_();
  if (!canManage) return;

  document.getElementById('editProjectBtn').onclick = function () { openEditProjectModal_(project); };
  document.getElementById('newProjectEventBtn').onclick = function () { openNewEventModal(venues, inspectionCos, emcOrgs, projects, projectId); };
  document.getElementById('addExistingEventsBtn').onclick = function () { openAddExistingEventsModal_(project, unlinked, venueById); };
  root.querySelectorAll('[data-remove-event]').forEach(function (btn) {
    btn.onclick = async function () {
      try {
        await Api.call('updateEvent', { eventId: btn.getAttribute('data-remove-event'), projectId: '' });
        UI.toast(t('toast_removed_from_x', { term: Term('project').toLowerCase() }), 'success'); Router.resolve();
      } catch (err) { UI.error(err); }
    };
  });
}

function openEditProjectModal_(project) {
  var body = UI.field(t('field_project_name', { term: Term('project') }), '<input id="fEditProjName" class="field-input" value="' + esc(project.name) + '" />') +
    UI.field(t('field_description_optional'), '<textarea id="fEditProjDesc" class="field-input" rows="2">' + esc(project.description || '') + '</textarea>');
  UI.openModal(t('edit_x', { term: Term('project') }), body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('save'), className: 'btn-primary', onClick: async function () {
        try {
          await Api.call('updateProject', {
            projectId: project.id, name: document.getElementById('fEditProjName').value, description: document.getElementById('fEditProjDesc').value
          });
          UI.closeModal(); UI.toast(t('x_updated', { term: Term('project') }), 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      } }
  ]);
}

// The other half of "group several events together" (the first half being the New-event modal's
// Project dropdown) -- lets a GA user pull already-existing Events into this Project without
// recreating them.
function openAddExistingEventsModal_(project, candidateEvents, venueById) {
  var body = candidateEvents.length
    ? '<div class="muted" style="font-size:12px;margin-bottom:10px;">' + esc(t('select_x_to_add_prefix', { term: Term('event_plural').toLowerCase() })) + '<strong>' + esc(project.name) + '</strong>.</div>' +
      '<div style="max-height:320px;overflow-y:auto;">' +
      candidateEvents.map(function (e) {
        return '<label style="display:flex;align-items:center;gap:8px;font-size:13px;padding:6px 2px;border-bottom:1px solid #f0f1f6;">' +
          '<input type="checkbox" class="add-event-check" value="' + e.id + '" /> ' +
          '<span style="flex:1;">' + esc(e.name) + '</span><span class="muted">' + esc(venueById[e.venueId] ? venueById[e.venueId].name : '') + '</span>' +
        '</label>';
      }).join('') + '</div>'
    : '<div class="empty-state">' + esc(t('empty_no_other_x_available', { term: Term('event_plural').toLowerCase() })) + '</div>';
  UI.openModal(t('add_existing_x_title', { term: Term('event_plural').toLowerCase() }), body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('add_btn'), className: 'btn-primary', onClick: async function () {
        var ids = Array.from(document.querySelectorAll('.add-event-check:checked')).map(function (cb) { return cb.value; });
        if (!ids.length) { UI.toast(t('toast_select_at_least_one_x', { term: Term('event').toLowerCase() }), 'error'); return; }
        try {
          for (var i = 0; i < ids.length; i++) { await Api.call('updateEvent', { eventId: ids[i], projectId: project.id }); }
          UI.closeModal(); UI.toast(t('toast_added_to_x', { term: Term('project').toLowerCase() }), 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      } }
  ]);
}
