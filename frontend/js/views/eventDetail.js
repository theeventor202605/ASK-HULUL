/**
 * HULUL - Event workspace: tabbed view covering EVT/TPL/VAP/DIS/INS/NCF/RES/PAR/RPT modules
 * for a single event. Mirrors the reference UI's tab layout, modernized.
 */
// Each tab's display text: a fixed i18n key, or an entityLabelFn composing one from custom
// terminology (see labels.js) for tabs whose name is built from an object name. Optional 4th
// element: a visibleFn -- when present and it returns false, the tab is hidden from the tab bar
// entirely (not just its content restricted). Only Event Chat uses this so far -- REQ: "Related
// participant accounts have no access to the chat" -- postEventChatMessage/listEventChatMessages
// both reject those roles server-side too (see assertChatAccess_, EventChat.gs), so hiding the tab
// is a UX nicety on top of a real enforcement, not a substitute for it.
var EVENT_TABS = [
  ['overview', 'tab_overview'],
  // REQ: "Roadmap tab ... reveals every single schedule in an event." A single line, oldest to
  // newest, rolling up every scheduling milestone this Event has -- see tabRoadmap below (end of
  // this file) and eventRoadmapMilestones_ for exactly which ones. Placed right after Overview since
  // it's a big-picture summary like Overview is, just date-oriented instead of KPI-oriented.
  ['roadmap', 'tab_roadmap'],
  // REQ: "Add an event chat page after overview tab." isParticipantRole_ (venues.js) checks
  // HululState.participantTypes -- Vendor/Operator/Exhibitor plus any admin-added custom type.
  ['chat', 'tab_chat', function () { return t('tab_chat'); }, function () { return !isParticipantRole_(HululState.user.role); }],
  ['templates', 'tab_templates', function () { return t('readiness_x_label', { term: Term('template_plural') }); }],
  ['approval', 'tab_approval', function () { return t('tab_approval'); }],
  // REQ: "Under readiness add 'Annex'" -- fixed catalog of document categories (Risk Assessments /
  // Sign-Offs / Certifications) the EMC uploads against and the PM/Analyst reviews. Grouped with
  // templates/approval/scoreOverview under Readiness below (EVENT_TAB_GROUPS_), same reasoning as
  // scoreOverview's own move there.
  ['annex', 'tab_annex'],
  // REQ follow-up: "Disciplines & Inspectors" -> "Assignments", "Inspections & Checklist Items" ->
  // "Checklists" -- both used to compose their label from two Term()s via and_join; now just a plain
  // fixed word for each, so no entityLabelFn is needed at all (tabLabel_ falls back to t(tb[1]) --
  // see tab_disciplines/tab_inspections in i18n.js).
  ['disciplines', 'tab_disciplines'],
  ['inspections', 'tab_inspections'],
  // REQ: "Develop a completed checklists page under Inspections tab." Once every relevant participant
  // on an Inspection is done, that Inspection's own Record-results action disappears from the
  // Inspections list above (its status flips to 'Completed') -- this is the way back into one of
  // those, still fully viewable/editable/printable/exportable (see tabCompletedChecklists below).
  ['completedChecklists', 'tab_completed_checklists'],
  // REQ: "Add Tab under Checklist name is score. Add to it template filter to narrow down items." --
  // read-only, cross-document view of every Document Review scoring item in this event (tabScoreOverview
  // below). REQ follow-up: "Move Score tab from Checklists to Readiness" -- grouped with
  // templates/approval (EVENT_TAB_GROUPS_ below), not with Assignments/Inspections/Completed
  // Checklists -- this array's own order is just declaration order, not what drives grouping.
  ['scoreOverview', 'tab_score_overview'],
  ['findings', 'tab_findings'],
  // REQ: "Log Photos" tab -- inspectors take photos in the heat first, group/log them later somewhere
  // cool. Only relevant to the same roles who can create a Finding at all (FINDING_ROLE_REVIEWER_,
  // findings.js -- loads after this file but only called here, never at top level, so the load-order
  // rule above doesn't apply). REQ follow-up: moved next to the other Findings-group tabs (was
  // between Inspections and Findings) once it moved into findingsGroup, EVENT_TAB_GROUPS_ below.
  ['logPhotos', 'tab_log_photos', function () { return t('tab_log_photos'); }, function () { return FINDING_ROLE_REVIEWER_.indexOf(HululState.user.role) !== -1; }],
  // REQ: "Create a Log photos timeline for every photo under an event... modern design." Every
  // Finding's evidence photo(s), newest first, grouped by day -- see tabFindingPhotos below and the
  // shared renderFindingPhotoTimeline_ (findings.js), which also backs the Project detail page's own
  // rolled-up timeline.
  ['findingPhotos', 'tab_finding_photos'],
  ['escalations', 'tab_escalations', function () { return Term('escalation_plural'); }],
  // REQ follow-up: "Participants" subtab -> "New" (its own Participants GROUP header already says
  // "Participants" -- see tab_group_participants below -- so the subtab itself doesn't need to repeat
  // it).
  ['participants', 'tab_participants', function () { return t('tab_participants_new'); }],
  // REQ: "Move Disciplines list to a new tab name it Participant's Discipline." -- split out of the
  // Participants tab (was a second section below the participants table) into its own tab.
  // REQ follow-up: shortened to just "Discipline" -- same "group header already says Participants"
  // reasoning as the New subtab above.
  ['participantDisciplines', 'tab_participant_disciplines', function () { return Term('discipline'); }],
  ['reports', 'tab_reports', function () { return Term('report_plural'); }],
  // REQ: "Add an event log page showing all transaction relevant to an event keep last log first."
  // Open to every viewer (like Coverage gaps etc.) -- it's just history of what already happened,
  // no separate role restriction was asked for here (unlike Chat).
  ['log', 'tab_event_log', function () { return t('tab_event_log'); }]
];

// REQ: "The Events' tab menu is long. Divide it into tab and subtab." -- 14 flat tabs crowded the
// bar (wrapped/scrolled on anything but a wide desktop). Groups related tabs under one collapsed
// top-level button; clicking it reveals a second subtab row for its children. Deliberately a
// PURELY VISUAL grouping layered on top of EVENT_TABS above, not a replacement for it -- every tab
// key, its #/events/:id?tab=x URL, its renderer (eventTabRenderers_), and its own permission checks
// all stay exactly as they were, so nothing that already links to a specific tab (Settings >
// Permissions' "go to page" flash, Event Chat's #-tab screenshot picker, bookmarks) needs to change.
// A group with no `key`/`labelKey` (single-tab "groups") renders as a plain standalone top-level
// button, same as before grouping existed -- lets Overview/Chat/Venue stay first-class without a
// redundant one-item dropdown.
var EVENT_TAB_GROUPS_ = [
  { key: 'generalGroup', labelKey: 'tab_group_general', tabs: ['overview', 'roadmap', 'chat'] },
  // REQ follow-up: "Move Score tab from Checklists to Readiness." -- scoreOverview (Document Review
  // scoring across every document) fits better alongside templates/approval than the Checklist-item
  // workflow tabs it was grouped with.
  { key: 'readiness', labelKey: 'tab_group_readiness', tabs: ['templates', 'approval', 'scoreOverview', 'annex'] },
  { key: 'inspectionsGroup', labelKey: 'tab_group_inspections', tabs: ['disciplines', 'inspections', 'completedChecklists'] },
  // REQ follow-up: "Move Log Photos to Findings tab" + explicit subtab order (Log Photos, Risk
  // Logging, Photo Timeline, Escalations) -- logPhotos moved out of inspectionsGroup above into here,
  // first; findings/findingPhotos/escalations reordered to match ('findings' tab's own display label
  // is "Risk Logging", tab_findings; 'findingPhotos' is "Photo Timeline", tab_finding_photos).
  { key: 'findingsGroup', labelKey: 'tab_group_findings', tabs: ['logPhotos', 'findings', 'findingPhotos', 'escalations'] },
  { key: 'participantsGroup', labelKey: 'tab_group_participants', tabs: ['participants', 'participantDisciplines'] },
  { key: 'reportsGroup', labelKey: 'tab_group_reports', tabs: ['reports', 'log'] }
];

// The group (if any) a given tab key belongs to, filtered to only the tabs actually visible this
// render (a group whose only "extra" member is hidden -- e.g. logPhotos -- should behave like
// whatever's left, including collapsing to a plain standalone button if that leaves just one).
function eventTabGroupFor_(tabKey, visibleTabKeys) {
  for (var i = 0; i < EVENT_TAB_GROUPS_.length; i++) {
    var g = EVENT_TAB_GROUPS_[i];
    if (g.tabs.indexOf(tabKey) === -1) continue;
    var visibleMembers = g.tabs.filter(function (k) { return visibleTabKeys.indexOf(k) !== -1; });
    return { key: g.key, labelKey: g.labelKey, tabs: visibleMembers };
  }
  return null;
}

// Module-level (not local to renderEventDetail) so Event Chat's "#" screenshot flow (tabEventChat)
// can render any other tab off-screen to capture a section from it, without needing to duplicate
// this dispatch table. tabOverview/tabEventChat/etc. declared further down this same file are safe
// to reference here regardless of order (hoisted function declarations) -- but tabParticipants and
// tabParticipantDisciplines live in eventPlaces.js, a DIFFERENT <script> that index.html loads AFTER
// this file. Referencing them in a top-level object literal here would throw a ReferenceError the
// instant this script runs (eventPlaces.js hasn't executed yet), leaving EVENT_TAB_RENDERERS_
// permanently undefined and breaking every tab -- same load-order trap as the backend's alphabetical
// .gs concatenation bug, just triggered by <script> tag order instead. Built lazily on first call
// instead, by which point every view script (including eventPlaces.js) has already loaded.
var EVENT_TAB_RENDERERS_ = null;
function eventTabRenderers_() {
  if (!EVENT_TAB_RENDERERS_) {
    EVENT_TAB_RENDERERS_ = {
      overview: tabOverview, roadmap: tabRoadmap, chat: tabEventChat, templates: tabTemplates, approval: tabApproval,
      annex: tabAnnex,
      disciplines: tabDisciplines, inspections: tabInspections, completedChecklists: tabCompletedChecklists, scoreOverview: tabScoreOverview, logPhotos: tabLogPhotos, findings: tabFindings,
      escalations: tabEscalations, findingPhotos: tabFindingPhotos, participants: tabParticipants,
      participantDisciplines: tabParticipantDisciplines, reports: tabReports, log: tabEventLog
    };
  }
  return EVENT_TAB_RENDERERS_;
}

// REQ (Settings > Permissions follow-up): "Which module is this? ... link to that page when clicked
// will highlight relevant sections for 10 seconds." Permissions modules (Participants, Risk Logging)
// are tabs inside a specific Event's workspace, not standalone pages -- there's no single event to
// deep-link into, so the Permissions tab's "Go to page" link (settings.js) instead stashes which tab
// to highlight here and sends the user to the Events list; the moment ANY event is opened,
// renderEventDetail below picks this up, flashes that tab for 10 seconds, and clears the flag
// (one-shot, so revisiting an event later never re-flashes it).
var PENDING_TAB_HIGHLIGHT_KEY_ = 'hululPendingTabHighlight';

async function renderEventDetail(params) {
  var root = document.getElementById('viewRoot');
  var eventId = params.id;
  // BUG FIX ("can't access property 'event', detail is undefined"): unlike every other route
  // handler in this file (renderTemplateScoring, renderCompletedChecklistDetail, etc.), this first
  // Api.call had no try/catch of its own -- any failure here (a network blip, an aborted request from
  // rapid navigation, a backend timeout) threw straight past this point with `detail` never assigned,
  // so the very next line (detail.event.name) crashed with that confusing raw TypeError instead of a
  // clean message. router.js's own top-level catch still caught it and showed "Failed to load this
  // page," but lost WHY -- UI.error(err) below at least surfaces the real reason (and quietly returns
  // on an AbortError from simply navigating away fast, same as router.js's own AbortError check, since
  // that's not a real failure worth a toast).
  var detail;
  try { detail = await Api.call('getEvent', { eventId: eventId }); }
  catch (err) {
    if (err && err.name === 'AbortError') return;
    UI.error(err);
    root.innerHTML = '<div class="empty-state">' + esc(t('failed_load_tab')) + '</div>';
    return;
  }
  HululState.currentEventId = eventId;
  var visibleTabs = EVENT_TABS.filter(function (tb) { return !tb[3] || tb[3](); });
  var activeTab = params.tab || 'overview';
  // A direct link/bookmark to a tab this role can no longer see (e.g. a participant account and
  // Event Chat) shouldn't silently render nothing -- fall back to Overview like an unset tab would.
  if (!visibleTabs.some(function (tb) { return tb[0] === activeTab; })) activeTab = 'overview';

  root.innerHTML =
    '<div class="breadcrumb"><a href="#/events">' + esc(Term('event_plural')) + '</a> / ' + esc(detail.event.name) + '</div>' +
    '<div class="page-header"><div><div class="page-title">' + esc(detail.event.name) + '</div>' +
    '<div class="page-subtitle">' + [
      detail.project ? detail.project.name : '',
      detail.venue ? detail.venue.name : '',
      detail.event.city
    ].filter(Boolean).map(esc).join(' · ') + '</div>' +
    '<div class="page-subtitle">' + esc(UI.fmtDate(detail.event.startDateTime) + ' – ' + UI.fmtDate(detail.event.endDateTime)) + '</div>' +
    '</div>' +
    UI.statusBadge(detail.event.status) + '</div>' +
    '<div id="eventTabbarWrap">' +
      '<div class="tabbar" id="eventTabbar"></div>' +
      '<div class="tabbar tabbar-sub" id="eventSubtabbar" style="display:none;"></div>' +
    '</div>' +
    '<div id="eventTabContent"></div>';

  var tabLabel_ = function (tb) { return tb[2] ? tb[2]() : t(tb[1]); };
  var tabsByKey_ = {}; visibleTabs.forEach(function (tb) { tabsByKey_[tb[0]] = tb; });
  var visibleTabKeys = visibleTabs.map(function (tb) { return tb[0]; });
  var activeGroup = eventTabGroupFor_(activeTab, visibleTabKeys); // null for a standalone (ungrouped) tab

  var tabbarWrap = document.getElementById('eventTabbarWrap');
  var tabbar = document.getElementById('eventTabbar');
  var subtabbar = document.getElementById('eventSubtabbar');

  // Top-level bar: one button per group. A single-tab group (Overview/Chat/Venue) renders exactly
  // as a plain tab always has (data-tab, navigates straight to it). A multi-tab group renders as a
  // collapsed parent (data-group, no data-tab) labeled by its own labelKey, marked .active whenever
  // the currently-open tab is any of its children -- that's what tells the user which section
  // they're inside without the subtab row needing to repeat it.
  var seenGroupKeys = {};
  tabbar.innerHTML = EVENT_TAB_GROUPS_.map(function (g) {
    var group = eventTabGroupFor_(g.tabs[0], visibleTabKeys); // re-derive so hidden members (logPhotos) are already filtered out
    if (!group || !group.tabs.length || (group.key && seenGroupKeys[group.key])) return '';
    if (group.key) seenGroupKeys[group.key] = true;
    if (group.tabs.length === 1) {
      var tb = tabsByKey_[group.tabs[0]];
      if (!tb) return '';
      return '<div class="tab-btn ' + (tb[0] === activeTab ? 'active' : '') + '" data-tab="' + tb[0] + '">' + esc(tabLabel_(tb)) + '</div>';
    }
    var isActive = group.tabs.indexOf(activeTab) !== -1;
    return '<div class="tab-btn ' + (isActive ? 'active' : '') + '" data-group="' + group.key + '" data-default-tab="' + group.tabs[0] + '">' +
      esc(t(group.labelKey)) + ' ' + ICON('chevron_down') + '</div>';
  }).join('');
  tabbar.querySelectorAll('[data-tab]').forEach(function (btn) {
    btn.onclick = function () { window.location.hash = '#/events/' + eventId + '?tab=' + btn.getAttribute('data-tab'); };
  });
  tabbar.querySelectorAll('[data-group]').forEach(function (btn) {
    btn.onclick = function () {
      // Already inside this group -- the subtab row below already shows exactly where you are;
      // re-navigating to the group's first child would silently discard your actual position
      // (e.g. viewing Approval, misclicking the Readiness parent, landing back on Templates).
      if (btn.classList.contains('active')) return;
      window.location.hash = '#/events/' + eventId + '?tab=' + btn.getAttribute('data-default-tab');
    };
  });

  // Subtab row: only exists while a multi-tab group is the active one.
  if (activeGroup && activeGroup.tabs.length > 1) {
    subtabbar.style.display = '';
    subtabbar.innerHTML = activeGroup.tabs.map(function (key) {
      var tb = tabsByKey_[key];
      if (!tb) return '';
      return '<div class="tab-btn ' + (tb[0] === activeTab ? 'active' : '') + '" data-tab="' + tb[0] + '">' + esc(tabLabel_(tb)) + '</div>';
    }).join('');
    subtabbar.querySelectorAll('[data-tab]').forEach(function (btn) {
      btn.onclick = function () { window.location.hash = '#/events/' + eventId + '?tab=' + btn.getAttribute('data-tab'); };
    });
  } else {
    subtabbar.style.display = 'none';
    subtabbar.innerHTML = '';
  }

  var pendingHighlightTab = sessionStorage.getItem(PENDING_TAB_HIGHLIGHT_KEY_);
  if (pendingHighlightTab) {
    sessionStorage.removeItem(PENDING_TAB_HIGHLIGHT_KEY_); // one-shot
    // The target tab might be collapsed inside a group that isn't the one currently open (e.g. the
    // user lands on Overview but the flash points at Approval) -- in that case there's no [data-tab]
    // button for it anywhere yet, only the collapsed parent, so fall back to highlighting that.
    var highlightBtn = tabbarWrap.querySelector('[data-tab="' + pendingHighlightTab + '"]');
    if (!highlightBtn) {
      var hGroup = eventTabGroupFor_(pendingHighlightTab, visibleTabKeys);
      if (hGroup && hGroup.key) highlightBtn = tabbarWrap.querySelector('[data-group="' + hGroup.key + '"]');
    }
    if (highlightBtn) {
      highlightBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      highlightBtn.classList.add('tab-btn-highlight');
      setTimeout(function () { highlightBtn.classList.remove('tab-btn-highlight'); }, 10000);
    }
  }

  var content = document.getElementById('eventTabContent');
  content.innerHTML = '<div class="empty-state">' + t('loading') + '</div>';
  try { await (eventTabRenderers_()[activeTab] || tabOverview)(content, eventId, detail, params); }
  catch (err) { UI.error(err); content.innerHTML = '<div class="empty-state">' + esc(t('failed_load_tab')) + '</div>'; }
}

/* ---------------- Overview ---------------- */
async function tabOverview(content, eventId, detail) {
  destroyOverviewZoneMap_(); // in case a previous visit to this tab left one behind
  var subEvents = detail.subEvents || [];
  var zones = detail.zones || [];
  var subEventNames = subEvents.map(function (s) { return s.name; }).join(', ');
  var zoneNames = zones.map(function (z) { return z.name; }).join(', ');

  // REQ: "compact the two lists and move map to the left side [of the right column] / move Zones
  // map here [into the empty space beside Event details]." -- Event details + Sub-Events stack in a
  // compact left column; the zone map (previously a separate full-width card way down the tab) moves
  // up into a right column beside them, stretched to match their combined height instead of a small
  // fixed-height thumbnail sitting alone.
  content.innerHTML =
    mandatoryOperatorComplianceBannerHtml_(detail.mandatoryOperatorCompliance) +
    '<div class="kpi-grid">' +
      kpiCard('kpi_total', detail.kpi.totalLogs, ICON('kpi_total'), 'var(--info)') +
      kpiCard('kpi_open', detail.kpi.open, ICON('kpi_open'), 'var(--info)') +
      kpiCard('kpi_inreview', detail.kpi.inReview, ICON('kpi_inreview'), 'var(--purple)') +
      kpiCard('kpi_resolved', detail.kpi.resolved, ICON('kpi_resolved'), 'var(--success)') +
      kpiCard('kpi_reopen', detail.kpi.reopened, ICON('kpi_reopen'), 'var(--warning)') +
    '</div>' +
    '<div style="display:flex;gap:16px;align-items:stretch;flex-wrap:wrap;">' +
      '<div style="flex:1 1 420px;display:flex;flex-direction:column;gap:16px;">' +
        '<div class="card"><div class="card-header"><div class="card-title">' + esc(Term('event') + ' details') + '</div></div><div class="card-body">' +
          infoRow(t('col_code'), detail.event.code) +
          // REQ report: Project/EMC/Inspection Company/Event Manager were all rendering raw ids (or blank)
          // -- detail.project/emc/inspectionCo/eventManager are the resolved rows now attached by
          // getEventDetail (Events.gs); event.project (free-text) is kept as a fallback only for events
          // that predate the structured projectId link (see Utils.gs SCHEMA comment on Events.project).
          infoRow(t('col_project'), detail.project ? detail.project.name : detail.event.project) +
          infoRow(t('org_type_emc'), detail.emc ? detail.emc.name : detail.event.emcId) +
          infoRow(t('field_inspection_company'), detail.inspectionCo ? detail.inspectionCo.name : detail.event.inspectionCoId) +
          infoRow(t('label_event_manager'), detail.eventManager ? detail.eventManager.name : '') +
          // REQ report: "Sub-Events / Zones showing as number" -- a bare count wasn't useful; listing
          // the actual names matches every other infoRow here being a real value, not a tally. The
          // fuller Sub-Events list (with dates) and the zone map alongside give the full detail this
          // summary line doesn't have room for.
          infoRow(Term('subEvent_plural'), subEventNames) + infoRow(Term('zone_plural'), zoneNames) +
        '</div></div>' +
        // REQ report: "Add Sub-Events list" -- so a PM can see this event's sub-events (with dates)
        // without leaving the Overview tab for the separate top-level Sub-Events page. REQ
        // (follow-up): "Hide Sub-Events section if empty" -- an event with none is the common case
        // for e.g. single-day events, and an empty table here was just dead weight above the map.
        (subEvents.length
          ? '<div class="card"><div class="card-header"><div class="card-title">' + esc(Term('subEvent_plural')) + '</div></div><div class="card-body">' +
            UI.table([
              { key: 'name', label: t('col_name') },
              { key: 'startDateTime', label: t('col_start'), render: r => UI.fmtDate(r.startDateTime) },
              { key: 'endDateTime', label: t('col_end'), render: r => UI.fmtDate(r.endDateTime) }
            ], subEvents, {}) +
          '</div></div>'
          : '') +
      '</div>' +
      // REQ report: "Add map zone boundaries as thumbnail image medium size, not including participant
      // locations." initOverviewZoneMap_ below is deliberately non-interactive and only plots
      // boundaries -- see its own comment for why.
      (detail.venue
        ? '<div class="card" style="flex:1 1 320px;min-width:280px;display:flex;flex-direction:column;">' +
          '<div class="card-header"><div class="card-title">' + esc(t('x_map_title', { term: Term('zone_plural') })) + '</div></div>' +
          '<div class="card-body" style="flex:1;display:flex;">' +
            '<div id="overviewZoneMap" style="flex:1;min-height:320px;border-radius:var(--radius-sm);border:1px solid var(--border);"></div>' +
          '</div></div>'
        : '') +
    '</div>';

  initOverviewZoneMap_(detail.venue, zones);
}

// REQ ("a security operator must be available in every event ... EMC just needs to set up their
// accounts accordingly" + follow-up: "Show compliance status") -- a chip per role flagged
// isMandatoryOperator (Settings > Mandatory Operators), green if this event already has a matching
// Operator-type participant, red if not. Renders nothing at all when no role is flagged (the common
// case for orgs not using this feature), same as the Sub-Events card hiding itself when empty.
function mandatoryOperatorComplianceBannerHtml_(compliance) {
  if (!compliance || !compliance.roles || !compliance.roles.length) return '';
  var chips = compliance.roles.map(function (r) {
    return '<span class="badge ' + (r.present ? 'badge-resolved' : 'badge-rejected') + '" style="font-size:11px;">' +
      esc(r.label) + ' — ' + esc(r.present ? t('mandatory_operator_present') : t('mandatory_operator_missing')) + '</span>';
  }).join(' ');
  return '<div class="card" style="margin-bottom:16px;"><div class="card-body" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">' +
    '<div style="font-weight:700;font-size:13px;">' + esc(t('mandatory_operator_compliance_title')) + '</div>' +
    '<div style="display:flex;gap:6px;flex-wrap:wrap;">' + chips + '</div>' +
    '</div></div>';
}

var overviewZoneMapInstance_ = null;
function destroyOverviewZoneMap_() {
  if (overviewZoneMapInstance_) { overviewZoneMapInstance_.remove(); overviewZoneMapInstance_ = null; }
}

// REQ report: "Add map zone boundaries as thumbnail image medium size, not including participant
// locations." A small, read-only preview -- every interaction (drag/scroll-zoom/double-click-zoom/
// keyboard/zoom control) is switched off since this is meant as a glanceable thumbnail, not another
// working map (the fully interactive version, with place dots and all, already lives on the Venue &
// Zones tab). Deliberately does NOT call UI.drawPlaceDots -- REQ explicitly excludes participant/
// place locations here, this is spatial context for the zone names listed above, nothing more.
function initOverviewZoneMap_(venue, zones) {
  var el = document.getElementById('overviewZoneMap');
  if (!el || !venue) return;
  if (typeof HululLeaflet === 'undefined') {
    el.style.display = 'flex'; el.style.alignItems = 'center'; el.style.justifyContent = 'center';
    el.style.color = 'var(--text-600)'; el.style.fontSize = '12px'; el.style.textAlign = 'center'; el.style.padding = '12px';
    el.textContent = t('map_unavailable');
    return;
  }
  var hasVenueCoords = !!(venue.lat && venue.lng);
  var center = hasVenueCoords ? [Number(venue.lat), Number(venue.lng)] : EVENT_MAP_DEFAULT_CENTER_;
  setTimeout(function () {
    var mapEl = document.getElementById('overviewZoneMap');
    if (!mapEl || mapEl._leaflet_id) return; // gone, or (defensive belt-and-suspenders) already claimed
    overviewZoneMapInstance_ = HululLeaflet.map('overviewZoneMap', {
      dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false,
      keyboard: false, tap: false, zoomControl: false,
      // zoomSnap:0 lets the map settle on a fractional zoom level instead of only whole integers.
      // Leaflet's default (zoomSnap:1) rounds fitBounds DOWN to the nearest whole zoom to guarantee
      // the bounds never clip -- but that rounding is exactly what left a big margin around the
      // boundary in this read-only thumbnail even with zero padding (REQ: "zoomed in to maximum so
      // boundaries touch edge of the canvas"). Fractional zoom fits tight to whichever axis is the
      // limiting one instead of stopping a whole zoom level early.
      zoomSnap: 0, zoomDelta: 0.25,
      // BUG (REQ report): "still not capturing correctly ... the event boundary is outside the
      // canvas" -- when Event Chat's # feature re-renders this map off-screen and html2canvas
      // rasterizes it, the venue/zone boundary polygons (drawn in Leaflet's SVG overlay pane, which
      // carries its OWN CSS transform independent of the tile pane underneath) can come out shifted
      // relative to the tiles -- a known html2canvas limitation with nested CSS-transformed SVG, not
      // something more capture delay can fix. preferCanvas makes every vector layer on this map
      // (the venue outline, zone outlines) paint into a plain <canvas> instead -- html2canvas copies
      // canvas pixel data directly, so it comes out pixel-identical to what's really on screen. Looks
      // and behaves identically for our simple stroked/filled polygons, just via a different renderer.
      preferCanvas: true
    }).setView(center, hasVenueCoords ? 15 : 6);
    hululTileLayer_().addTo(overviewZoneMapInstance_);

    var bounds = [];
    var venueBoundary = parseBoundaryClient_(venue.boundary);
    if (venueBoundary) {
      var venueColor = venue.color || VENUE_BOUNDARY_DEFAULT_COLOR_;
      var venueLayer = HululLeaflet.polygon(venueBoundary.map(function (pt) { return [pt.lat, pt.lng]; }), {
        color: venueColor, fillColor: venueColor, fillOpacity: 0.06, weight: 1.5, interactive: false
      }).addTo(overviewZoneMapInstance_);
      bounds = bounds.concat(venueLayer.getLatLngs()[0]);
    }
    UI.drawZoneBoundaries(overviewZoneMapInstance_, zones, 'zone-thumb-tooltip').forEach(function (layer) {
      bounds = bounds.concat(layer.getLatLngs()[0]);
    });
    // Fit AFTER invalidateSize (not before): this thumbnail has every interaction disabled, so
    // unlike the interactive maps elsewhere, the user can't pan/zoom to correct a bad initial fit --
    // fitBounds must run against the map's real, laid-out container size or the crop drifts/clips.
    // REQ: "zoomed in to maximum so boundaries touch edge of the canvas but never outside the
    // canvas" -- zero padding fits bounds flush to the container edge (Leaflet's fitBounds never
    // overshoots past the container, so boundaries can touch the edge but can't spill outside it).
    setTimeout(function () {
      if (!overviewZoneMapInstance_) return;
      overviewZoneMapInstance_.invalidateSize();
      if (bounds.length) overviewZoneMapInstance_.fitBounds(bounds, { padding: [0, 0] });
    }, 150);
  }, 0);
}
function kpiCard(labelKey, value, icon, color) {
  // --kpi-color drives the card's top accent stripe (styles.css .kpi-card::before) -- purely a
  // card-level accent, the icon itself stays a plain foreground-colored glyph (REQ: no background
  // colours behind icons).
  return '<div class="kpi-card" style="--kpi-color:' + color + ';"><div class="kpi-top"><span class="kpi-label">' + t(labelKey) + '</span>' +
    '<span class="kpi-icon" style="color:' + color + ';">' + icon + '</span></div><div class="kpi-value">' + value + '</div></div>';
}
function infoRow(label, val) {
  return '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0f1f6;font-size:13.5px;">' +
    '<span class="muted">' + esc(label) + '</span><span style="font-weight:600;">' + esc(val || '—') + '</span></div>';
}

/* ---------------- Shared map constants ----------------
 * REQ follow-up: "Move Venue & Zones to venue sidebar page." The Venue & Zones tab itself (and its
 * own zone-management map subsystem: openZoneCard_/initZoneMap_/etc.) moved to venues.js
 * (renderVenueDetail's Zones tab) -- a Venue's Zones aren't event-scoped data (the same roster is
 * identical across every Event held at that venue), so the standalone Venues page is the correct
 * home for managing them, not each Event's own workspace. These few constants stay here (not moved)
 * because they're shared globals read cross-file at runtime by ui.js (UI.drawPlaceDots/
 * drawZoneBoundaries), eventPlaces.js (the Participants map), findings.js, and elsewhere in this
 * file (tabOverview's read-only zone map, the live-inspection map) -- same "plain global script,
 * load order doesn't matter for function bodies" pattern used throughout this app.
 */
var EVENT_MAP_DEFAULT_CENTER_ = [24.7136, 46.6753]; // Riyadh -- only used if neither the venue nor any of its places has coordinates
// Cycled per zone (by list order) so multiple zone boundaries stay visually distinguishable from
// each other -- read by ui.js's UI.drawZoneBoundaries and venues.js's zone-management map.
var ZONE_BOUNDARY_COLORS_ = ['#0d9488', '#d97706', '#7c3aed', '#dc2626', '#0891b2', '#65a30d'];
// Place-type -> map pin color. Matches Places' own `type` field (PLACE_TYPES_(), venues.js/Places.gs).
// Read cross-file by ui.js (UI.drawPlaceDots) and eventPlaces.js (the Participants map). The 4
// built-ins keep their original hand-picked colors, permanently; refreshParticipantTypeColors_ below
// (called from loadParticipantTypes, app.js, once HululState.participantTypes has loaded) mutates this
// SAME object in place to also cover any custom type an admin adds (Settings > Roles > "Use as Place/
// Participant type") -- every existing `EVENT_PLACE_TYPE_COLORS_[type] || .Other` call site keeps
// working unchanged, custom types included, with no per-call-site change needed.
var EVENT_PLACE_TYPE_COLORS_ = { Operator: '#4f46e5', Vendor: '#16a34a', Exhibitor: '#d97706', Other: '#2563eb' };
// Fallback color palette for a custom Place/Participant type (cycled by its order among OTHER custom
// types, so it's stable across renders as long as the type list itself doesn't reorder).
var PARTICIPANT_TYPE_COLOR_PALETTE_ = ['#0891b2', '#7c3aed', '#65a30d', '#db2777', '#ca8a04', '#0d9488'];
function refreshParticipantTypeColors_() {
  var types = (window.HululState && HululState.participantTypes) || [];
  var customIdx = 0;
  types.forEach(function (ty) {
    if (EVENT_PLACE_TYPE_COLORS_[ty.code]) return; // built-in, already has its fixed color
    EVENT_PLACE_TYPE_COLORS_[ty.code] = PARTICIPANT_TYPE_COLOR_PALETTE_[customIdx % PARTICIPANT_TYPE_COLOR_PALETTE_.length];
    customIdx++;
  });
}
// listParticipantTypes (Roles.gs) fetch-failure fallback (loadParticipantTypes, app.js) -- just the 4
// built-ins, same shape the endpoint itself returns, so Places/Participants forms never end up with an
// empty type dropdown.
var PARTICIPANT_TYPES_FALLBACK_ = [
  { code: 'Operator', label: 'Operator', builtin: true }, { code: 'Vendor', label: 'Vendor', builtin: true },
  { code: 'Exhibitor', label: 'Exhibitor', builtin: true }, { code: 'Other', label: 'Other', builtin: true }
];

/* ---------------- Templates ---------------- */
var TEMPLATE_BOARD_COLUMNS = ['Not Sent', 'Sent', 'In Progress', 'Submitted', 'Under Review', 'Evaluated', 'Missed'];
var TEMPLATE_BOARD_BORDER = {
  'Not Sent': 'var(--border)', 'Sent': 'var(--info)', 'In Progress': 'var(--accent)', 'Submitted': 'var(--info)',
  'Under Review': 'var(--warning)', 'Evaluated': 'var(--success)', 'Missed': 'var(--danger)'
};
// Who can do what to a per-event template, by current status:
//   Not Sent      -> Project Manager sends it
//   Sent / In Progress / Missed -> the configured uploader role(s) upload a completed file and/or
//                     click Submit (defaults to Event Manager)
//   Submitted / Under Review    -> the configured reviewer role(s) mark it Evaluated or Missed, with
//                     a reason (defaults to Inspection Analyst)
// Opening the file link (whoever clicks it) fires openEventTemplate in the background, which is
// what actually advances Sent -> In Progress and Submitted -> Under Review — see fireOpenTemplate_.
// A document can also land on Missed with no reviewer action at all, if the event's deadline lapses
// while it's still sitting at Sent/In Progress — see checkTemplateDeadlines in Templates.gs.
// uploaderRoles/reviewerRoles come from getTemplateProcessRoles (see tabTemplates below) --
// configurable per REQ: "role assignments... Inspection Analyst and Event Manager, where I can
// change them and allow one or multiple role assignment" (Configuration > Process).
function templateActionsHtml_(tpl, uploaderRoles, reviewerRoles, hasDeadline, scoredDocTypes, isLocked) {
  var role = HululState.user.role;
  // RBAC pilot (backend/Permissions.gs): admin-configurable from Settings > Permissions > Templates >
  // "Send readiness templates to an event".
  var isPM = hasPermission('template.send');
  var isEM = role === 'SystemAdmin' || uploaderRoles.indexOf(role) !== -1;
  var isAnalyst = role === 'SystemAdmin' || reviewerRoles.indexOf(role) !== -1;
  var parts = [];
  // REQ: "Lock all documents no editing allowed no upload allowed" once the current version's
  // deadline has passed -- send/upload/submit/review are all blocked server-side too (Templates.gs),
  // this just hides the now-useless buttons instead of letting the user hit a FORBIDDEN toast. The
  // Score action (below, outside this guard) stays available -- evaluation isn't gated by REQ.
  if (!isLocked) {
    if (tpl.status === 'Not Sent' && isPM) {
      // REQ: "No Template can be sent unless Deadline date time is set." -- disabled (not hidden) so
      // the PM can still see the Send action exists and understands why it's blocked; sendTemplates
      // enforces the same rule server-side (see Templates.gs) so this can't be bypassed.
      parts.push(hasDeadline
        ? '<button class="btn btn-primary btn-sm btn-icon" title="' + esc(t('title_send')) + '" data-send-template="' + tpl.libraryTemplateId + '">' + ICON('send') + '</button>'
        : '<button class="btn btn-primary btn-sm btn-icon" title="' + esc(t('title_set_deadline_first')) + '" disabled>' + ICON('send') + '</button>');
    }
    if (isEM && ['Sent', 'In Progress', 'Missed'].indexOf(tpl.status) !== -1) {
      parts.push('<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('title_upload')) + '" data-upload-template="' + tpl.id + '">' + ICON('upload') + '</button>');
      parts.push('<button class="btn btn-primary btn-sm btn-icon" title="' + esc(t('title_submit')) + '" data-submit-template="' + tpl.id + '">' + ICON('submit') + '</button>');
    }
    if (isAnalyst && ['Submitted', 'Under Review'].indexOf(tpl.status) !== -1) {
      parts.push('<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('title_mark_evaluated')) + '" data-approve-template="' + tpl.id + '">' + ICON('approve') + '</button>');
      parts.push('<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('title_mark_missed')) + '" data-reject-template="' + tpl.id + '">' + ICON('reject') + '</button>');
    }
  }
  // REQ follow-up: "Can I convert the templates to forms and include evaluation process as per
  // attached file?" / "Let's add the remaining score templates" -- a structured item-level scoring
  // form (renderTemplateScoring below), only for docTypes with an imported catalog. scoredDocTypes
  // comes from listScoringCatalogSummary (Templates.gs), fetched once in tabTemplates below -- no
  // hardcoded list here, so a brand-new catalog imported from the Template Library page (REQ:
  // "how do I create new forms") shows its Score button immediately, no code change needed. Only
  // once there's actually something to review (id is truthy -- excludes the virtual "Not Sent"
  // placeholder row). Kept visible past Evaluated/Missed too (unlike the Evaluate/Mark Missed
  // buttons themselves, which are one-shot) so the analyst can still open and review their own past
  // scoring.
  if (isAnalyst && tpl.id && scoredDocTypes.indexOf(tpl.docType) !== -1 &&
      ['Submitted', 'Under Review', 'Evaluated', 'Missed'].indexOf(tpl.status) !== -1) {
    parts.push('<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('title_score_document')) + '" data-score-template="' + tpl.id + '">' + ICON('record_results') + '</button>');
  }
  // No dots-menu toggle when there's genuinely nothing to do on this row (e.g. viewing as a role
  // with no send/upload/review permission for its current status) -- just the plain dash, same as
  // before; a three-dot button that opens to reveal only a dash would be a pointless extra click.
  return parts.length ? UI.actionsCell(parts.join(' ')) : '—';
}

async function tabTemplates(content, eventId, detail) {
  var results = await Promise.all([
    Api.call('getEventTemplates', { eventId: eventId }),
    Api.call('getTemplateProcessRoles', {}),
    Api.call('listScoringCatalogSummary', {}),
    // REQ: "Add a score column to Readiness Templates" -- one call for every document's
    // Completeness%/Quality%/finalized status, instead of the frontend re-deriving it per row.
    Api.call('getEventTemplatesScoringSummary', { eventId: eventId }),
    // REQ: "Readiness templates table should [show] which version we are on now." -- versions,
    // currentVersionNumber, isLocked, gapDays (Templates.gs). Also flips version 1 -> 2
    // automatically if that deadline just passed (processTemplateDeadlineTransition_).
    Api.call('listTemplateDeadlineVersions', { eventId: eventId })
  ]);
  var templates = results[0], processRoles = results[1];
  var scoredDocTypes = results[2].map(function (s) { return s.docType; });
  var scoringSummaryByTemplateId = results[3];
  var versionData = results[4];
  var isLocked = versionData.isLocked;
  // RBAC pilot (backend/Permissions.gs): admin-configurable from Settings > Permissions > Templates >
  // "Set an event's documents deadline".
  var canManageDeadline = hasPermission('template.setDeadline');

  var boardColumns = TEMPLATE_BOARD_COLUMNS.map(function (status) {
    return {
      // REQ follow-up: this board's column headers were raw untranslated status strings ('Not Sent',
      // 'Under Review', etc.) even after UI.statusBadge itself got translated -- UI.statusLabel (same
      // lookup, no pill markup) fixes both this and the equivalent Findings board below in one place.
      label: UI.statusLabel(status),
      cards: templates.filter(function (tpl) { return tpl.status === status; }).map(function (tpl) {
        return { id: tpl.id || ('lib:' + tpl.libraryTemplateId), title: tpl.name, meta: tpl.fileName || t('toast_no_file_yet'), borderColor: TEMPLATE_BOARD_BORDER[status] };
      })
    };
  });

  content.innerHTML =
    templatesDeadlineCardHtml_(detail.event, canManageDeadline, versionData) +
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + esc(t('pipeline_title')) + '</div>' +
    '<div class="muted" style="font-size:11.5px;">' + esc(t('click_card_open_file_hint')) + '</div></div>' +
    '<div class="card-body">' + UI.board(boardColumns) + '</div></div>' +
    '<div class="card"><div class="card-header"><div class="card-title">' + esc(t('readiness_x_label', { term: Term('template_plural').toLowerCase() })) + '</div></div>' +
    '<div class="card-body">' + UI.table([
      { key: 'name', label: t('col_template') },
      { key: 'status', label: t('status'), render: r => UI.statusBadge(r.status) },
      // REQ: "Readiness templates table should [show] which version we are on now." Per-row rather
      // than just once in the deadline card above -- once an Evaluated document stops resetting on
      // later rounds (versionNumber, Templates.gs), a row's own version can legitimately lag behind
      // the event's current one (e.g. approved in version 1 while everything else is now on
      // version 2), so showing it per document is what actually answers the question for that row.
      { key: 'versionNumber', label: t('col_version'), render: r => r.versionNumber ? esc(t('version_n_badge', { n: r.versionNumber })) : '—' },
      { key: 'fileName', label: t('col_file'), render: r => r.fileUrl ? '<a href="' + r.fileUrl + '" target="_blank" data-open-template="' + r.id + '" style="color:var(--accent);">' + esc(r.fileName || t('word_view')) + '</a>' : '—' },
      { key: 'completenessPct', label: t('col_completeness'), render: r => templateScoreCellHtml_(scoringSummaryByTemplateId[r.id], 'completenessPct') },
      { key: 'qualityPct', label: t('col_quality'), render: r => templateScoreCellHtml_(scoringSummaryByTemplateId[r.id], 'qualityPct', true) },
      { key: 'updatedAt', label: t('col_updated'), render: r => r.updatedAt ? UI.fmtDate(r.updatedAt) : '—' },
      { key: 'reviewReason', label: t('col_review_notes'), render: r => r.reviewReason ? esc(r.reviewReason) : '—' },
      { key: 'actions', label: t('actions'), render: r => templateActionsHtml_(r, processRoles.uploaderRoles, processRoles.reviewerRoles, !!detail.event.templatesDeadlineAt, scoredDocTypes, isLocked) }
    ], templates, { emptyText: t('no_templates_in_library_hint', { term: t('field_inspection_company') }) }) + '</div></div>';

  UI.wireBoard(content, function (id) {
    if (id.indexOf('lib:') === 0) { UI.toast(t('toast_not_sent_yet'), 'error'); return; }
    var tpl = templates.filter(function (x) { return x.id === id; })[0];
    if (tpl && tpl.fileUrl) { fireOpenTemplate_(tpl.id); window.open(tpl.fileUrl, '_blank'); }
    else UI.toast(t('toast_no_file_yet'), 'error');
  });
  UI.wireBoardPagination(content);

  content.querySelectorAll('[data-open-template]').forEach(function (a) {
    a.addEventListener('click', function () { fireOpenTemplate_(a.getAttribute('data-open-template')); });
  });
  content.querySelectorAll('[data-send-template]').forEach(function (btn) {
    btn.onclick = async function () {
      try {
        await Api.call('sendTemplates', { eventId: eventId, libraryTemplateIds: [btn.getAttribute('data-send-template')] });
        UI.toast(t('toast_sent_to_em'), 'success'); Router.resolve();
      } catch (err) { UI.error(err); }
    };
  });
  content.querySelectorAll('[data-upload-template]').forEach(function (btn) {
    btn.onclick = function () { openEventTemplateUploadModal_(btn.getAttribute('data-upload-template')); };
  });
  content.querySelectorAll('[data-submit-template]').forEach(function (btn) {
    btn.onclick = async function () {
      try {
        await Api.call('submitEventTemplate', { templateId: btn.getAttribute('data-submit-template') });
        UI.toast(t('toast_submitted_for_review'), 'success'); Router.resolve();
      } catch (err) { UI.error(err); }
    };
  });
  content.querySelectorAll('[data-approve-template]').forEach(function (btn) {
    btn.onclick = function () { openReviewTemplateModal_(btn.getAttribute('data-approve-template'), 'Evaluated'); };
  });
  content.querySelectorAll('[data-reject-template]').forEach(function (btn) {
    btn.onclick = function () { openReviewTemplateModal_(btn.getAttribute('data-reject-template'), 'Missed'); };
  });
  content.querySelectorAll('[data-score-template]').forEach(function (btn) {
    btn.onclick = function () { window.location.hash = '#/events/' + eventId + '/template-scoring/' + btn.getAttribute('data-score-template'); };
  });

  if (canManageDeadline) {
    var saveDeadlineBtn = document.getElementById('saveTplDeadlineBtn');
    if (saveDeadlineBtn) saveDeadlineBtn.onclick = async function () {
      var n = document.getElementById('fTplDeadlineN').value;
      var unit = document.getElementById('fTplDeadlineUnit').value;
      var absVal = document.getElementById('fTplDeadlineAbs').value;
      var deadlineAt;
      if (n && Number(n) > 0) {
        if (!detail.event.startDateTime) { UI.toast(t('toast_no_start_date_yet'), 'error'); return; }
        var offsetMs = Number(n) * (unit === 'weeks' ? 7 : 1) * 24 * 3600 * 1000;
        deadlineAt = new Date(new Date(detail.event.startDateTime).getTime() - offsetMs).toISOString();
      } else if (absVal) {
        deadlineAt = new Date(absVal).toISOString();
      } else {
        UI.toast(t('toast_pick_deadline'), 'error');
        return;
      }
      try {
        await Api.call('setTemplatesDeadline', { eventId: eventId, deadlineAt: deadlineAt });
        UI.toast(t('toast_deadline_saved'), 'success'); Router.resolve();
      } catch (err) { UI.error(err); }
    };
    // REQ follow-up: "Add the ability to extend a deadline." Only rendered (see
    // templatesDeadlineCardHtml_) once a version already exists and is still open -- covers version 1
    // or any later version.
    var extendDeadlineBtn = document.getElementById('extendDeadlineBtn');
    if (extendDeadlineBtn) extendDeadlineBtn.onclick = async function () {
      var n = document.getElementById('fExtendDeadlineN').value;
      var unit = document.getElementById('fExtendDeadlineUnit').value;
      var absVal = document.getElementById('fExtendDeadlineAbs').value;
      var deadlineAt;
      if (n && Number(n) > 0) {
        if (!detail.event.startDateTime) { UI.toast(t('toast_no_start_date_yet'), 'error'); return; }
        var offsetMs = Number(n) * (unit === 'weeks' ? 7 : 1) * 24 * 3600 * 1000;
        deadlineAt = new Date(new Date(detail.event.startDateTime).getTime() - offsetMs).toISOString();
      } else if (absVal) {
        deadlineAt = new Date(absVal).toISOString();
      } else {
        UI.toast(t('toast_pick_deadline'), 'error');
        return;
      }
      try {
        await Api.call('extendTemplateDeadlineVersion', { eventId: eventId, deadlineAt: deadlineAt });
        UI.toast(t('toast_deadline_extended'), 'success'); Router.resolve();
      } catch (err) { UI.error(err); }
    };
    // REQ: "A third or fourth version deadline can be created manually by responsible role." Only
    // rendered (see templatesDeadlineCardHtml_) once the current version is actually locked.
    var createNextVersionBtn = document.getElementById('createNextVersionBtn');
    if (createNextVersionBtn) createNextVersionBtn.onclick = async function () {
      var absVal = document.getElementById('fNextVersionDeadline').value;
      if (!absVal) { UI.toast(t('toast_pick_deadline'), 'error'); return; }
      try {
        await Api.call('createNextTemplateDeadlineVersion', { eventId: eventId, deadlineAt: new Date(absVal).toISOString() });
        UI.toast(t('toast_next_version_created'), 'success'); Router.resolve();
      } catch (err) { UI.error(err); }
    };
  }
  var versionHistoryBtn = document.getElementById('viewVersionHistoryBtn');
  if (versionHistoryBtn) versionHistoryBtn.onclick = function () { openVersionHistoryModal_(eventId); };
}

// REQ: "Under readiness add 'Annex': Allows EMC Event manager to upload documents under each
// category ... Inspection Company PM or analyst can mark document as required ... Provide table to
// know how many documents have been uploaded and how many missing from mandatory ... accept
// uploaded documents, then mark as provided ... ask for more information per category." One card per
// section (originally a fixed 3: Risk Assessments / Sign-Offs / Certifications), each a table of that
// section's categories -- required toggle, upload/accepted counts, status, and a Documents action
// that opens the per-category document list. listEventAnnex (Annex.gs) does all the merge/rollup
// math; this just renders what it returns.
//
// REQ follow-up: "In Annex Category allow to create a new Section." Sections are no longer a closed
// enum -- Annex.gs's create/updateAnnexCategory now accept any non-empty section name, same as a
// category's own name. The original 3 keep their translated labels and fixed lead position (existing
// data/translations shouldn't visibly reshuffle); any custom section an admin adds shows up after
// them, labeled with the literal text they typed (no i18n key -- same "plain admin-entered name" as
// every other catalogue in this app, e.g. Disciplines). ANNEX_BUILTIN_SECTIONS_ + annexSectionsToRender_
// are the shared source of truth both the per-event Annex tab (this function's tabAnnex) and the
// Inspection Setup > Annex Categories admin page (annexCategories.js) render from, so the two can
// never drift on section order/labeling.
var ANNEX_BUILTIN_SECTIONS_ = [
  ['RiskAssessments', 'annex_section_risk_assessments'],
  ['SignOffs', 'annex_section_sign_offs'],
  ['Certifications', 'annex_section_certifications']
];
// Builds the full ordered [key, i18nLabelKeyOrNull] list to render cards for: the 3 built-ins first
// (shown even with zero categories, same as always), then every distinct custom section actually
// present in `categories` (only shown if it has at least one row -- nothing seeds a custom section
// ahead of time), alphabetically among themselves. label === null means "not a translation key --
// render the section string itself" (esc(), not t()).
function annexSectionsToRender_(categories) {
  var builtInKeys = {};
  ANNEX_BUILTIN_SECTIONS_.forEach(function (s) { builtInKeys[s[0]] = true; });
  var seenCustom = {};
  var customSections = [];
  (categories || []).forEach(function (c) {
    if (!c.section || builtInKeys[c.section] || seenCustom[c.section]) return;
    seenCustom[c.section] = true;
    customSections.push([c.section, null]);
  });
  customSections.sort(function (a, b) { return a[0] < b[0] ? -1 : (a[0] > b[0] ? 1 : 0); });
  return ANNEX_BUILTIN_SECTIONS_.concat(customSections);
}
// Display label for one section key -- built-in keys translate via their i18n key, a custom section
// is just its own literal name (admin-entered free text, no translation).
function annexSectionLabel_(sectionKey) {
  var builtIn = ANNEX_BUILTIN_SECTIONS_.filter(function (s) { return s[0] === sectionKey; })[0];
  return builtIn ? t(builtIn[1]) : sectionKey;
}

async function tabAnnex(content, eventId, detail) {
  var data = await Api.call('listEventAnnex', { eventId: eventId });
  var canUpload = hasPermission('annex.upload');
  var canManage = hasPermission('annex.manage');
  var summary = data.summary;
  // BUG REPORT: "In Annex tab, I can not see an upload option" -- turned out to be an org whose
  // spreadsheet predates the Annex feature, so the AnnexCategories catalog every section's table
  // renders from is just empty (no rows -> no per-row Upload button for anyone, regardless of
  // permission). REQ follow-up: "I would rather have this part of the inspection setup so the
  // responsible person can make changes or add new categories and mark default required uploads" --
  // managing (and, for an org that's never had it, first bootstrapping) the catalog now lives on its
  // own admin page (Inspection Setup > Annex Categories, annexCategories.js) instead of an action
  // embedded in this per-event tab. This is just a pointer over there for whoever hits the empty
  // state on an actual event, not a duplicate of that page's own seed button.
  var showEmptyCatalogHint = !data.categories.length && hasPermission('annex.manageCatalog');

  content.innerHTML =
    '<div class="card" style="margin-bottom:16px;"><div class="card-body" style="display:flex;align-items:center;gap:14px;">' +
    '<div style="font-weight:700;font-size:14px;">' + esc(t('annex_summary_x', { provided: summary.providedCount, required: summary.requiredCount, missing: summary.missingCount })) + '</div>' +
    '</div></div>' +
    (showEmptyCatalogHint
      ? '<div class="card" style="margin-bottom:16px;border-left:4px solid var(--warning);"><div class="card-body" style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;">' +
          '<div style="font-size:13px;">' + esc(t('annex_no_categories_hint')) + '</div>' +
          '<a href="#/annex-categories" class="btn btn-primary btn-sm">' + esc(t('annex_go_to_setup_btn')) + '</a>' +
        '</div></div>'
      : '') +
    annexSectionsToRender_(data.categories).map(function (sec) {
      var rows = data.categories.filter(function (c) { return c.section === sec[0]; });
      return '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + esc(annexSectionLabel_(sec[0])) + '</div></div>' +
        '<div class="card-body">' + UI.table([
          { key: 'name', label: t('col_category') },
          { key: 'required', label: t('col_required'), render: r => canManage
            ? '<input type="checkbox" class="annex-required-cb" data-category-id="' + esc(r.categoryId) + '" ' + (r.required ? 'checked' : '') + ' />'
            : (r.required ? t('col_required') : '—') },
          { key: 'uploadedCount', label: t('col_uploaded'), render: r => String(r.uploadedCount) },
          { key: 'acceptedCount', label: t('col_accepted'), render: r => String(r.acceptedCount) },
          { key: 'status', label: t('status'), render: r => UI.statusBadge(r.status) + (r.infoRequestNote ? ' <span class="muted" style="font-size:11px;">' + esc(t('annex_info_requested_banner', { note: r.infoRequestNote })) + '</span>' : '') },
          { key: 'actions', label: t('actions'), render: r => annexCategoryActionsHtml_(r, canUpload, canManage) }
        ], rows, { emptyText: t('no_data') }) + '</div></div>';
    }).join('');

  content.querySelectorAll('.annex-required-cb').forEach(function (cb) {
    cb.onchange = async function () {
      try {
        await Api.call('setAnnexCategoryRequired', { eventId: eventId, categoryId: cb.getAttribute('data-category-id'), required: cb.checked });
        UI.toast(t('toast_annex_required_updated'), 'success'); Router.resolve();
      } catch (err) { UI.error(err); }
    };
  });
  content.querySelectorAll('[data-annex-upload]').forEach(function (btn) {
    btn.onclick = function () { openAnnexUploadModal_(eventId, btn.getAttribute('data-annex-upload'), btn.getAttribute('data-annex-name')); };
  });
  content.querySelectorAll('[data-annex-documents]').forEach(function (btn) {
    btn.onclick = function () {
      var cat = data.categories.filter(function (c) { return c.categoryId === btn.getAttribute('data-annex-documents'); })[0];
      if (cat) openAnnexDocumentsModal_(eventId, cat, canUpload, canManage);
    };
  });
  content.querySelectorAll('[data-annex-request-info]').forEach(function (btn) {
    btn.onclick = function () { openAnnexRequestInfoModal_(eventId, btn.getAttribute('data-annex-request-info'), btn.getAttribute('data-annex-name')); };
  });
  content.querySelectorAll('[data-annex-mark-provided]').forEach(function (btn) {
    btn.onclick = async function () {
      try {
        await Api.call('markAnnexCategoryProvided', { eventId: eventId, categoryId: btn.getAttribute('data-annex-mark-provided'), provided: true });
        UI.toast(t('toast_annex_provided'), 'success'); Router.resolve();
      } catch (err) { UI.error(err); }
    };
  });
  content.querySelectorAll('[data-annex-reopen]').forEach(function (btn) {
    btn.onclick = async function () {
      try {
        await Api.call('markAnnexCategoryProvided', { eventId: eventId, categoryId: btn.getAttribute('data-annex-reopen'), provided: false });
        UI.toast(t('toast_annex_reopened'), 'success'); Router.resolve();
      } catch (err) { UI.error(err); }
    };
  });
}

function annexCategoryActionsHtml_(r, canUpload, canManage) {
  var btns = [];
  if (canUpload) btns.push('<button class="btn btn-secondary btn-sm" data-annex-upload="' + esc(r.categoryId) + '" data-annex-name="' + esc(r.name) + '">' + esc(t('btn_upload')) + '</button>');
  btns.push('<button class="btn btn-secondary btn-sm" data-annex-documents="' + esc(r.categoryId) + '">' + esc(t('btn_documents')) + ' (' + r.uploadedCount + ')</button>');
  if (canManage) {
    btns.push('<button class="btn btn-secondary btn-sm" data-annex-request-info="' + esc(r.categoryId) + '" data-annex-name="' + esc(r.name) + '">' + esc(t('btn_request_info')) + '</button>');
    if (r.status === 'Provided') {
      btns.push('<button class="btn btn-secondary btn-sm" data-annex-reopen="' + esc(r.categoryId) + '">' + esc(t('btn_reopen_category')) + '</button>');
    } else {
      btns.push('<button class="btn btn-primary btn-sm" data-annex-mark-provided="' + esc(r.categoryId) + '">' + esc(t('btn_mark_provided')) + '</button>');
    }
  }
  return '<div style="display:flex;gap:6px;flex-wrap:wrap;">' + btns.join('') + '</div>';
}

function openAnnexUploadModal_(eventId, categoryId, categoryName) {
  var body = UI.field(t('field_document_file'), '<input type="file" id="fAnnexFile" class="field-input" />');
  UI.openModal(t('annex_upload_document_title') + ' — ' + categoryName, body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('save'), className: 'btn-primary', onClick: async function () {
        var fileInput = document.getElementById('fAnnexFile');
        if (!fileInput.files[0]) { UI.toast(t('toast_choose_file_first'), 'error'); return; }
        try {
          await Api.call('uploadAnnexDocument', {
            eventId: eventId, categoryId: categoryId, fileBase64: await fileToBase64(fileInput.files[0]),
            fileName: fileInput.files[0].name, mimeType: fileInput.files[0].type
          });
          UI.closeModal(); UI.toast(t('toast_annex_uploaded'), 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      } }
  ]);
}

function openAnnexRequestInfoModal_(eventId, categoryId, categoryName) {
  var body = UI.field(t('field_info_note'), '<textarea id="fAnnexInfoNote" class="field-input" rows="3"></textarea>');
  UI.openModal(t('annex_request_info_title') + ' — ' + categoryName, body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('save'), className: 'btn-primary', onClick: async function () {
        var note = document.getElementById('fAnnexInfoNote').value.trim();
        if (!note) { UI.toast(t('toast_reason_required'), 'error'); return; }
        try {
          await Api.call('requestAnnexInfo', { eventId: eventId, categoryId: categoryId, note: note });
          UI.closeModal(); UI.toast(t('toast_annex_info_requested'), 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      } }
  ]);
}

function annexDocumentRowHtml_(doc, canManage, canUpload) {
  var canDelete = canManage || (canUpload && doc.uploadedBy === HululState.user.id && doc.status !== 'Accepted');
  var actions = [];
  if (canManage && doc.status === 'Pending') {
    actions.push('<button class="btn btn-primary btn-sm" data-annex-doc-accept="' + esc(doc.id) + '">' + esc(t('btn_accept')) + '</button>');
    actions.push('<button class="btn btn-danger btn-sm" data-annex-doc-reject="' + esc(doc.id) + '">' + esc(t('btn_reject')) + '</button>');
  }
  if (canDelete) actions.push('<button class="btn btn-secondary btn-sm" data-annex-doc-delete="' + esc(doc.id) + '">' + esc(t('delete')) + '</button>');
  return '<tr>' +
    '<td><a href="' + esc(doc.fileUrl) + '" target="_blank" style="color:var(--accent);">' + esc(doc.fileName) + '</a></td>' +
    '<td>' + UI.statusBadge(doc.status) + '</td>' +
    '<td>' + UI.fmtDate(doc.uploadedAt) + '</td>' +
    '<td>' + esc(doc.reviewComments || '—') + '</td>' +
    '<td><div style="display:flex;gap:6px;flex-wrap:wrap;">' + actions.join('') + '</div></td>' +
    '</tr>';
}

function openAnnexDocumentsModal_(eventId, category, canUpload, canManage) {
  var body = (category.infoRequestNote ? '<div class="muted" style="margin-bottom:10px;">' + esc(t('annex_info_requested_banner', { note: category.infoRequestNote })) + '</div>' : '') +
    (category.documents.length
      ? '<table class="data-table"><thead><tr><th>' + esc(t('col_file')) + '</th><th>' + esc(t('status')) + '</th><th>' + esc(t('col_uploaded_at')) + '</th><th>' + esc(t('col_review_comments')) + '</th><th>' + esc(t('actions')) + '</th></tr></thead><tbody>' +
        category.documents.map(function (d) { return annexDocumentRowHtml_(d, canManage, canUpload); }).join('') + '</tbody></table>'
      : '<div class="muted">' + esc(t('no_annex_documents_yet')) + '</div>');
  var footerBtns = [{ label: t('close'), className: 'btn-secondary', onClick: UI.closeModal }];
  if (canUpload) {
    footerBtns.unshift({ label: t('btn_upload'), className: 'btn-primary', onClick: function () { UI.closeModal(); openAnnexUploadModal_(eventId, category.categoryId, category.name); } });
  }
  UI.openModal(t('annex_documents_modal_title', { category: category.name }), body, footerBtns);

  var root = document.getElementById('modalRoot');
  root.querySelectorAll('[data-annex-doc-accept]').forEach(function (btn) {
    btn.onclick = function () { openAnnexReviewModal_(eventId, btn.getAttribute('data-annex-doc-accept'), 'Accepted', category); };
  });
  root.querySelectorAll('[data-annex-doc-reject]').forEach(function (btn) {
    btn.onclick = function () { openAnnexReviewModal_(eventId, btn.getAttribute('data-annex-doc-reject'), 'Rejected', category); };
  });
  root.querySelectorAll('[data-annex-doc-delete]').forEach(function (btn) {
    btn.onclick = function () {
      UI.confirmModal(t('confirm_delete_annex_document'), async function () {
        try {
          await Api.call('deleteAnnexDocument', { documentId: btn.getAttribute('data-annex-doc-delete') });
          UI.toast(t('toast_annex_document_deleted'), 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      });
    };
  });
}

function openAnnexReviewModal_(eventId, documentId, decision, category) {
  var body = UI.field(t('field_review_comments'), '<textarea id="fAnnexReviewComments" class="field-input" rows="3"></textarea>');
  UI.openModal(t('annex_review_document_title'), body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: function () { openAnnexDocumentsModal_(eventId, category, hasPermission('annex.upload'), hasPermission('annex.manage')); } },
    { label: decision === 'Accepted' ? t('btn_accept') : t('btn_reject'), className: decision === 'Accepted' ? 'btn-primary' : 'btn-danger', onClick: async function () {
        var comments = document.getElementById('fAnnexReviewComments').value.trim();
        try {
          await Api.call('reviewAnnexDocument', { documentId: documentId, decision: decision, reviewComments: comments });
          UI.closeModal(); UI.toast(t('toast_annex_reviewed'), 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      } }
  ]);
}

// REQ: "Add a score column to Readiness Templates" -- getEventTemplatesScoringSummary returns null
// (not 0) for a percentage nothing's been answered for yet, so this shows "--" instead of a misleading
// "0%"; a document whose docType has no scoring catalog at all has no entry in the summary map either,
// same "--" fallback. isQualityCol also shows the finalize-lock indicator (REQ follow-up: "Finalize
// closes score editing") -- only on the Quality column so it doesn't repeat across both.
function templateScoreCellHtml_(summary, field, isQualityCol) {
  var pctHtml = (!summary || summary[field] === null || summary[field] === undefined)
    ? '<span class="muted">—</span>' : (summary[field] + '%');
  if (isQualityCol && summary && summary.finalizedAt) {
    pctHtml += ' <span title="' + esc(t('finalized_on_x', { date: UI.fmtDate(summary.finalizedAt) })) + '" style="color:var(--success);">' + ICON('locked_indicator') + '</span>';
  }
  return pctHtml;
}

// REQ: "PM must set one deadline for all documents, by date/time picker or by N weeks/days before
// event start... Readiness templates table should [show] which version we are on now." One
// event-wide deadline per round (TemplateDeadlineVersions, Templates.gs), shown to everyone (with a
// live countdown/overdue indicator, same style as Findings' resolution window) but only editable by
// a Project Manager or SystemAdmin -- matches setTemplatesDeadline/createNextTemplateDeadlineVersion's
// backend requirePermission. versionData is listTemplateDeadlineVersions' result (see tabTemplates).
//
// Three states:
//  - no version yet: original "set first deadline" picker (unchanged from before versioning existed).
//  - current version still open (not locked): version 1 stays editable in place (matches
//    setTemplatesDeadline for the very first one, extendTemplateDeadlineVersion to push out
//    whichever version is currently open -- REQ follow-up: "Add the ability to extend a deadline",
//    works for version 1 or any later version, as long as it hasn't locked yet).
//  - current version locked (its deadline passed): REQ's lock banner, plus (if the viewer can manage
//    it) the "create next version" picker calling createNextTemplateDeadlineVersion.
function templatesDeadlineCardHtml_(event, canManage, versionData) {
  var versions = (versionData && versionData.versions) || [];
  var current = versions.length ? versions[versions.length - 1] : null;
  var isLocked = !!(versionData && versionData.isLocked);
  var versionBadge = current
    ? ' <span class="badge badge-neutral" style="vertical-align:middle;">' + esc(t('version_n_badge', { n: current.versionNumber })) + '</span>'
    : '';
  var historyBtn = versions.length
    ? '<button class="btn btn-secondary btn-sm" id="viewVersionHistoryBtn">' + esc(t('version_history_btn')) + '</button>'
    : '';

  var statusHtml = current
    ? '<div style="font-size:13px;">' + esc(t('deadline_prefix')) + '<strong>' + esc(UI.fmtDate(current.deadlineAt)) + '</strong> — ' +
        '<span style="color:' + (isLocked ? 'var(--danger)' : 'var(--text-600)') + ';font-weight:600;">' + esc(UI.fmtCountdown(current.deadlineAt)) + '</span></div>'
    : '<div class="muted" style="font-size:13px;">' + esc(t('no_deadline_set_yet')) + (canManage ? esc(t('set_one_below_suffix')) : '.') + '</div>';

  var lockBannerHtml = isLocked
    ? '<div style="margin-top:10px;padding:10px 12px;border-radius:8px;background:var(--danger-soft);border-left:4px solid var(--danger);">' +
        '<div style="font-weight:700;font-size:12.5px;color:var(--danger);margin-bottom:2px;">' + esc(t('documents_locked_title')) + '</div>' +
        '<div style="font-size:13px;">' + esc(t('documents_locked_body', { n: current.versionNumber })) + '</div>' +
      '</div>'
    : '';

  var headerHtml = '<div class="card-header"><div class="card-title">' + esc(t('documents_deadline_title')) + versionBadge + '</div>' + historyBtn + '</div>';

  if (!canManage) {
    return '<div class="card" style="margin-bottom:16px;">' + headerHtml + '<div class="card-body">' + statusHtml + lockBannerHtml + '</div></div>';
  }

  var formHtml;
  if (isLocked) {
    // REQ: "A third or fourth version deadline can be created manually by responsible role."
    formHtml = '<div class="form-row" style="margin-top:10px;">' +
        UI.field(t('field_next_version_deadline'), '<input type="datetime-local" id="fNextVersionDeadline" class="field-input" />') +
      '</div>' +
      '<button class="btn btn-primary btn-sm" id="createNextVersionBtn" style="margin-top:8px;">' + esc(t('create_next_version_btn')) + '</button>';
  } else if (!current) {
    // No version yet -- bootstrap version 1 via setTemplatesDeadline.
    formHtml = '<div class="muted" style="font-size:11.5px;">' + esc(t('one_deadline_hint')) + '</div>' +
      '<div class="form-row" style="margin-top:10px;">' +
        UI.field(t('field_deadline_datetime'), '<input type="datetime-local" id="fTplDeadlineAbs" class="field-input" />') +
        UI.field(t('field_or_before_event_start'), '<div style="display:flex;gap:6px;"><input type="number" id="fTplDeadlineN" class="field-input" min="1" placeholder="e.g. 2" style="max-width:90px;" /><select id="fTplDeadlineUnit" class="field-input"><option value="days">' + esc(t('option_days')) + '</option><option value="weeks">' + esc(t('option_weeks')) + '</option></select></div>') +
      '</div>' +
      '<button class="btn btn-primary btn-sm" id="saveTplDeadlineBtn" style="margin-top:8px;">' + esc(t('save_deadline_btn')) + '</button>';
  } else {
    // A version already exists and is still open (version 1 or later) -- REQ follow-up: "Add the
    // ability to extend a deadline." Prefilled with the current deadline; extendTemplateDeadlineVersion
    // requires the new one to be strictly later.
    formHtml = '<div class="muted" style="font-size:11.5px;">' + esc(t('extend_deadline_hint')) + '</div>' +
      '<div class="form-row" style="margin-top:10px;">' +
        UI.field(t('field_deadline_datetime'), '<input type="datetime-local" id="fExtendDeadlineAbs" class="field-input" value="' + toDatetimeLocalValue_(current.deadlineAt) + '" />') +
        UI.field(t('field_or_before_event_start'), '<div style="display:flex;gap:6px;"><input type="number" id="fExtendDeadlineN" class="field-input" min="1" placeholder="e.g. 2" style="max-width:90px;" /><select id="fExtendDeadlineUnit" class="field-input"><option value="days">' + esc(t('option_days')) + '</option><option value="weeks">' + esc(t('option_weeks')) + '</option></select></div>') +
      '</div>' +
      '<button class="btn btn-primary btn-sm" id="extendDeadlineBtn" style="margin-top:8px;">' + esc(t('extend_deadline_btn')) + '</button>';
  }

  return '<div class="card" style="margin-bottom:16px;">' + headerHtml + '<div class="card-body">' + statusHtml + lockBannerHtml + formHtml + '</div></div>';
}

// REQ: "Reserve the status of the documents" -- read-only viewer over TemplateVersionSnapshots
// (Templates.gs), one section per past version, newest first. Opened from the "Version history"
// button in templatesDeadlineCardHtml_ (visible once at least one version exists).
async function openVersionHistoryModal_(eventId) {
  var snapshots = await Api.call('listTemplateVersionSnapshots', { eventId: eventId });
  var byVersion = {};
  snapshots.forEach(function (s) { (byVersion[s.versionNumber] = byVersion[s.versionNumber] || []).push(s); });
  var versionNumbers = Object.keys(byVersion).map(Number).sort(function (a, b) { return b - a; });
  var bodyHtml = versionNumbers.length
    ? versionNumbers.map(function (vn) {
        var rows = byVersion[vn];
        return '<div style="margin-bottom:16px;">' +
          '<div style="font-weight:700;font-size:12.5px;margin-bottom:6px;">' + esc(t('version_n_badge', { n: vn })) + '</div>' +
          '<table class="data-table"><thead><tr><th>' + esc(t('col_template')) + '</th><th>' + esc(t('status')) + '</th><th>' + esc(t('col_file')) + '</th></tr></thead><tbody>' +
          rows.map(function (r) {
            return '<tr><td>' + esc(r.name) + '</td><td>' + UI.statusBadge(r.status) + '</td><td>' +
              (r.fileUrl ? '<a href="' + r.fileUrl + '" target="_blank" style="color:var(--accent);">' + esc(r.fileName || t('word_view')) + '</a>' : '—') +
              '</td></tr>';
          }).join('') +
          '</tbody></table></div>';
      }).join('')
    : '<div class="muted">' + esc(t('no_version_history_yet')) + '</div>';
  UI.openModal(t('version_history_title'), bodyHtml, [
    { label: t('close'), className: 'btn-secondary', onClick: UI.closeModal }
  ]);
}

// Renders a stored UTC instant (toISOString()) as a <input type="datetime-local"> default value, in
// the viewer's own local time -- unlike startDateTime (deliberately kept as literal, un-reinterpreted
// wall-clock text, see Utils.gs), the deadline genuinely is one fixed instant, so it's correct for it
// to display converted to whoever's looking at it, same as any other cross-timezone timestamp.
function toDatetimeLocalValue_(iso) {
  var d = new Date(iso);
  var pad = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

// Fire-and-forget: tells the backend "this user just opened the file link" so it can auto-advance
// status (Sent -> In Progress for the Event Manager, Submitted -> Under Review for the Inspection
// Analyst). Doesn't block the actual link navigation — the <a target="_blank"> / window.open
// already handles opening the file; this just runs alongside it and refreshes the tab after.
function fireOpenTemplate_(templateId) {
  Api.call('openEventTemplate', { templateId: templateId }).then(function () { Router.resolve(); }).catch(function () {});
}

function openEventTemplateUploadModal_(templateId) {
  var body = UI.field(t('field_completed_file'), '<input type="file" id="fEvtTplFile" class="field-input" />');
  UI.openModal(t('upload_completed_document_title'), body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('save'), className: 'btn-primary', onClick: async function () {
        var fileInput = document.getElementById('fEvtTplFile');
        if (!fileInput.files[0]) { UI.toast(t('toast_choose_file_first'), 'error'); return; }
        try {
          var payload = {
            templateId: templateId, fileBase64: await fileToBase64(fileInput.files[0]),
            fileName: fileInput.files[0].name, mimeType: fileInput.files[0].type
          };
          await Api.call('uploadEventTemplateFile', payload);
          UI.closeModal(); UI.toast(t('toast_uploaded'), 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      } }
  ]);
}

function openReviewTemplateModal_(templateId, decision) {
  var body = UI.field(t('field_reason'), '<textarea id="fReviewReason" class="field-input" rows="3" placeholder="' + esc(t('reason_placeholder_why', { decision: decision.toLowerCase() })) + '"></textarea>');
  UI.openModal(decision + ' document', body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: decision, className: decision === 'Evaluated' ? 'btn-primary' : 'btn-danger', onClick: async function () {
        var reason = document.getElementById('fReviewReason').value.trim();
        if (!reason) { UI.toast(t('toast_reason_required'), 'error'); return; }
        try {
          await Api.call('reviewEventTemplate', { templateId: templateId, decision: decision, reason: reason });
          UI.closeModal(); UI.toast(t('document_prefix') + decision.toLowerCase(), 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      } }
  ]);
}

function fileToBase64(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () { resolve(reader.result.split(',')[1]); };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ---------------- Document Review scoring (REQ follow-up: "Can I convert the templates to forms
 * and include evaluation process as per attached file?") -----------------------------------------
 * A full page (route: #/events/:id/template-scoring/:templateId, router.js) an Inspection Analyst
 * works through while a document sits at Submitted/Under Review (still reachable afterward too --
 * see templateActionsHtml_ above): a Yes/No/N/A Completeness checklist plus a 0-4 Quality review
 * score per item, ported item-for-item from the GA26/JDCB "Document Review Tool" workbook (ZSMP,
 * ZERP, TTP, CSM, SEC -- TemplateScoringItems, seeded via seedTemplateScoringItems, Setup.gs). Sits ALONGSIDE
 * the plain Evaluated/Missed decision (openReviewTemplateModal_ above), not in place of it -- Save
 * here just persists progress (saveTemplateScoring, Templates.gs); the analyst still uses the
 * existing Evaluate/Mark Missed buttons on the Templates tab to actually finalize the document.
 */
async function renderTemplateScoring(params) {
  var root = document.getElementById('viewRoot');
  var eventId = params.id, templateId = params.templateId;
  root.innerHTML = '<div class="empty-state">' + t('loading') + '</div>';

  var templates;
  try { templates = await Api.call('getEventTemplates', { eventId: eventId }); }
  catch (err) { UI.error(err); root.innerHTML = '<div class="empty-state">' + esc(t('failed_load_tab')) + '</div>'; return; }
  var tpl = templates.filter(function (t2) { return t2.id === templateId; })[0];
  if (!tpl) { root.innerHTML = '<div class="empty-state">' + esc(t('x_not_found', { term: Term('template') })) + '</div>'; return; }
  // REQ follow-up: "Finalize closes score editing." isFinalized drives every interactive piece of
  // this page below (Save/Autosave block vs a Finalized banner, whether wireTemplateScoringRows_ is
  // even called, whether Import is offered) -- canReopen (Permissions.gs 'template.reopenScoring',
  // default SystemAdmin only) gates the one way back out of that state.
  var isFinalized = !!tpl.scoringFinalizedAt;
  var canReopen = hasPermission('template.reopenScoring');

  var [items, results] = await Promise.all([
    Api.call('listTemplateScoringItems', { docType: tpl.docType }),
    Api.call('getTemplateScoringResults', { templateId: templateId })
  ]);
  // BUG FIX ("Completeness and Quality do not work properly when filtered"): TemplateScoringItems.
  // sectionCode is stored as a plain "4.00" / "4.01" style string, but that's also a value Google
  // Sheets auto-detects as looking like a number -- so getAll() can hand it back as the JS Number 4
  // instead of the string "4.00", silently dropping the trailing zero (visible in the section header
  // showing "4 Third Party Sign Off" instead of "4.00 Third Party Sign Off"). Every sectionCode
  // comparison in this page (data-section attributes, TPL_SCORING_ACTIVE_SECTION_, the CSV export) is
  // a strict === against a string, so a Number sectionCode never matches and the section-scoped
  // Completeness/Quality math silently sees zero items. Normalizing every item's sectionCode to this
  // canonical zero-padded string once, right here, means everything downstream (grouping, the sidebar
  // filter, progress scoping, CSV) works of the exact same string regardless of what Sheets did to it.
  items.forEach(function (it) {
    var n = Number(it.sectionCode);
    it.sectionCode = isNaN(n) ? String(it.sectionCode) : n.toFixed(2);
  });

  if (!items.length) {
    root.innerHTML =
      '<div class="page-header"><div><div class="page-title">' + esc(tpl.name) + '</div></div>' +
      '<button class="btn btn-secondary" id="backTplScoringBtn">' + ICON('back') + ' ' + esc(t('back')) + '</button></div>' +
      '<div class="empty-state">' + esc(t('no_scoring_form_for_doctype')) + '</div>';
    document.getElementById('backTplScoringBtn').onclick = function () { window.location.hash = '#/events/' + eventId + '?tab=templates'; };
    return;
  }

  var resultsByItemId = {};
  results.forEach(function (r) { resultsByItemId[r.itemId] = r; });

  // REQ follow-up: "scoring forms are long and take days to complete -- filtered by section... know
  // the progress of each score form" / "the side filter should only show relevant items not jump" --
  // the sidebar (templateScoringSectionNavHtml_) actually FILTERS the main content down to one
  // section at a time (filterTemplateScoringSection_) instead of just scrolling to it, with each
  // section's own running done/total count so progress is visible per-chunk too.
  var sections = templateScoringSectionsList_(items);
  TPL_SCORING_SECTIONS_ = sections;

  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + esc(tpl.name) + '</div>' +
    '<div class="page-subtitle">' + esc(tpl.docType) + (tpl.fileUrl ? ' · <a href="' + tpl.fileUrl + '" target="_blank" style="color:var(--accent);font-weight:600;text-decoration:none;">' + esc(t('word_view')) + '</a>' : '') + '</div></div>' +
    '<button class="btn btn-secondary" id="backTplScoringBtn">' + ICON('back') + ' ' + esc(t('back')) + '</button></div>' +
    // REQ follow-up: "keep the progress bar always visible" -- sticky (not just "at the top once"),
    // so it stays in view while scrolling a long section instead of disappearing the moment the
    // first card scrolls past. Actual visual bars (not just percentage text) per
    // templateScoringProgressHtml_ below; updateTemplateScoringProgress_ fills them in live.
    // top:64px, not 0 -- .topbar (styles.css) is itself sticky at top:0 with z-index:20 above
    // everything in the page body, so a sticky element in here needs to sit BELOW it, not compete
    // for the same spot (same 64px topbar-height offset .notif-panel already uses).
    '<div class="card" style="margin-bottom:16px;position:sticky;top:64px;z-index:5;"><div class="card-body" style="padding:12px 20px;">' +
      templateScoringProgressHtml_(tpl, isFinalized, canReopen) +
    '</div></div>' +
    '<div style="display:flex;gap:16px;align-items:flex-start;">' +
      // top:160px = topbar (64px) + the sticky progress card above it (~80px) + its margin-bottom
      // (16px) -- keeps this sidebar pinned just below the progress card instead of sliding under it.
      '<div class="card" style="width:230px;flex:0 0 230px;position:sticky;top:160px;max-height:calc(100vh - 176px);overflow-y:auto;">' +
        '<div class="card-header"><div class="card-title" style="font-size:12px;">' + esc(t('scoring_sections_title')) + '</div></div>' +
        '<div class="card-body" id="tplScoringSectionNav" style="padding:6px;">' + templateScoringSectionNavHtml_(sections) + '</div>' +
      '</div>' +
      '<div class="card" style="flex:1 1 auto;min-width:0;">' +
        '<div class="card-header" style="display:flex;justify-content:flex-end;gap:6px;">' +
          '<button type="button" class="btn btn-secondary btn-sm btn-icon" id="tplScoringExportBtn" title="' + esc(t('export_csv')) + '">' + ICON('export_csv') + '</button>' +
          // REQ follow-up: "Finalize closes score editing" -- Import would let a CSV silently
          // overwrite a signed-off document's answers, so it's the one thing dropped entirely (not
          // just disabled) once finalized, rather than rendering a button that would just error.
          (isFinalized ? '' :
            '<button type="button" class="btn btn-secondary btn-sm btn-icon" id="tplScoringImportBtn" title="' + esc(t('import_csv')) + '">' + ICON('import_csv') + '</button>' +
            '<input type="file" id="tplScoringImportInput" accept=".csv" style="display:none;" />') +
        '</div>' +
        // isFinalized: pointer-events:none blocks every click/focus inside in one place -- covers the
        // Completeness/Quality buttons AND the Remarks/Detail textareas without templateScoringRowHtml_
        // needing to know about finalize state at all (it renders identically either way).
        '<div class="card-body"' + (isFinalized ? ' style="pointer-events:none;opacity:.7;"' : '') + '>' + templateScoringItemsHtml_(items, resultsByItemId) + '</div>' +
      '</div>' +
    '</div>';

  document.getElementById('backTplScoringBtn').onclick = function () { window.location.hash = '#/events/' + eventId + '?tab=templates'; };
  document.getElementById('tplScoringExportBtn').onclick = function () { exportTemplateScoringCsv_(tpl, items); };
  wireTemplateScoringSectionNav_(sections, items);
  filterTemplateScoringSection_('');
  updateTemplateScoringProgress_(items);
  updateTemplateScoringSectionNav_(items);

  // REQ follow-up: "Finalize closes score editing." Finalized: only the Reopen button (admin-only,
  // 'template.reopenScoring') and the read-only view itself -- no row wiring, no Save/Import/Autosave
  // at all, matching the pointer-events:none on the item card-body above (belt-and-suspenders: even if
  // someone found a way around that CSS, there's simply no click handler here to fire).
  if (isFinalized) {
    var reopenBtn = document.getElementById('reopenTplScoringBtn');
    if (reopenBtn) reopenBtn.onclick = function () {
      UI.confirmModal(t('confirm_reopen_scoring'), async function () {
        try {
          await Api.call('reopenTemplateScoring', { templateId: templateId });
          UI.toast(t('toast_scoring_reopened'), 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      });
    };
    return;
  }

  // REQ follow-up: "After all items are scored prompt to finalize instead of save. Finalize closes
  // score editing." -- checked against the CURRENT on-screen state at click time (not the last saved
  // copy), so reaching 100% completeness mid-session prompts on the very next Save click rather than
  // needing an extra round trip first. Autosave (below) deliberately never prompts -- only an explicit
  // Save does; a background timer silently popping a modal would be a bad surprise.
  document.getElementById('saveTplScoringBtn').onclick = async function () {
    var currentResults = collectTemplateScoringResults_(items);
    var allScored = currentResults.every(function (r) { return !!r.completeness; });
    if (allScored) { promptFinalizeTemplateScoring_(templateId, currentResults); return; }
    try {
      await Api.call('saveTemplateScoring', { templateId: templateId, results: currentResults });
      UI.toast(t('toast_scoring_saved'), 'success'); Router.resolve();
    } catch (err) { UI.error(err); }
  };
  document.getElementById('tplScoringImportBtn').onclick = function () { document.getElementById('tplScoringImportInput').click(); };
  document.getElementById('tplScoringImportInput').onchange = function (e) {
    var file = e.target.files[0];
    e.target.value = ''; // reset immediately so re-picking the same file still fires 'change' next time
    if (!file) return;
    UI.confirmModal(t('confirm_import_scoring_answers'), function () { importTemplateScoringCsv_(file, items); });
  };
  // REQ follow-up: "add Autosave toggle" -- on by default; unchecking it doesn't stop/restart the
  // interval below (simplest correct option, and it means re-checking resumes on the very next tick
  // with no extra bookkeeping) -- it just makes each tick a no-op, and immediately swaps the status
  // caption to "paused" so unchecking gives instant feedback instead of waiting up to 60s to notice.
  document.getElementById('tplScoringAutosaveToggle').onchange = function (e) {
    var statusEl = document.getElementById('tplScoringAutosaveStatus');
    if (statusEl) statusEl.textContent = e.target.checked ? ' ' : t('autosave_paused');
  };

  wireTemplateScoringRows_(items);

  // Autosave every 60s while this page stays open. No generic page-teardown hook exists in this
  // router (pages are just replaced via root.innerHTML on next navigation), so the interval is
  // self-terminating instead of relying on an external stop signal: every tick first checks that
  // saveTplScoringBtn is still in the DOM (i.e. this exact render is still the one on screen) and
  // clears itself the moment that's no longer true, same self-cleanup shape as
  // attachFindingEvidenceInBackground_ (findings.js) uses for its own background interval.
  var autosaveTimer = setInterval(function () {
    if (!document.getElementById('saveTplScoringBtn')) { clearInterval(autosaveTimer); return; }
    var toggle = document.getElementById('tplScoringAutosaveToggle');
    if (toggle && !toggle.checked) return; // paused -- interval keeps ticking cheaply so it resumes the instant the user re-checks it
    autosaveTemplateScoring_(templateId, items);
  }, 60000);
}

// REQ follow-up: "After all items are scored prompt to finalize instead of save." Two forward
// choices, no separate "just close without saving" option -- the person already clicked Save meaning
// to persist their work, so both buttons here save first either way; they only differ on whether
// finalizeTemplateScoring runs afterward. Uses UI.openModal directly (not confirmModal) since this
// needs two meaningfully different actions, not a single confirm/cancel pair.
function promptFinalizeTemplateScoring_(templateId, results) {
  var body = '<div style="font-size:13.5px;line-height:1.6;">' + esc(t('finalize_prompt_body')) + '</div>';
  UI.openModal(t('finalize_prompt_title'), body, [
    { label: t('finalize_prompt_just_save'), className: 'btn-secondary', onClick: async function () {
        UI.closeModal();
        try {
          await Api.call('saveTemplateScoring', { templateId: templateId, results: results });
          UI.toast(t('toast_scoring_saved'), 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      } },
    { label: t('finalize_prompt_finalize'), className: 'btn-primary', onClick: async function () {
        UI.closeModal();
        try {
          await Api.call('saveTemplateScoring', { templateId: templateId, results: results });
          await Api.call('finalizeTemplateScoring', { templateId: templateId });
          UI.toast(t('toast_scoring_finalized'), 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      } }
  ]);
}

// Silent counterpart to the manual Save button's handler above -- same endpoint, same
// collectTemplateScoringResults_ DOM read, but no toast and no Router.resolve() refresh (a full
// re-render every 60s would blow away the section filter, scroll position, and any in-progress
// typing). Failures are swallowed on purpose: the next tick retries automatically, and the manual
// Save button is always right there if the person wants an explicit confirmation.
function autosaveTemplateScoring_(templateId, items) {
  Api.call('saveTemplateScoring', { templateId: templateId, results: collectTemplateScoringResults_(items) })
    .then(function () {
      var statusEl = document.getElementById('tplScoringAutosaveStatus');
      if (statusEl) statusEl.textContent = t('autosaved_at', { time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
    })
    .catch(function () { /* silent -- next tick retries, manual Save still available */ });
}

// Items already arrive from listTemplateScoringItems sorted by itemCode -- which, since every
// segment in this catalog is zero-padded to two digits (see seedTemplateScoringItems_'s own
// comment), sorts in exactly the same order as sectionCode groups them -- so a single linear pass
// detecting sectionCode changes is enough to emit section headers, no separate group-then-sort step.
// Each section's header + rows are wrapped in one .tpl-score-section container carrying
// data-section -- the sidebar filter (filterTemplateScoringSection_ below) toggles that whole
// container's visibility rather than re-rendering, so switching sections never loses any unsaved
// on-screen answers or re-wires event listeners.
function templateScoringItemsHtml_(items, resultsByItemId) {
  var html = '';
  var lastSectionCode = null;
  items.forEach(function (it) {
    if (it.sectionCode !== lastSectionCode) {
      if (lastSectionCode !== null) html += '</div>';
      html += '<div class="tpl-score-section" data-section="' + esc(it.sectionCode) + '">' +
        '<div style="font-weight:600;font-size:12.5px;color:var(--accent);margin:14px 0 4px;">' + esc(it.sectionCode) + ' ' + esc(it.sectionName) + '</div>';
      lastSectionCode = it.sectionCode;
    }
    html += templateScoringRowHtml_(it, resultsByItemId[it.id]);
  });
  if (lastSectionCode !== null) html += '</div>';
  return html;
}

// Ordered, de-duplicated section list with each section's item count -- drives both the sidebar nav
// (templateScoringSectionNavHtml_) and its live per-section progress readout
// (updateTemplateScoringSectionNav_). Relies on the same already-sorted-by-itemCode order as
// templateScoringItemsHtml_ above.
function templateScoringSectionsList_(items) {
  var sections = [], bySection = {};
  items.forEach(function (it) {
    if (!bySection[it.sectionCode]) {
      bySection[it.sectionCode] = { sectionCode: it.sectionCode, sectionName: it.sectionName, total: 0 };
      sections.push(bySection[it.sectionCode]);
    }
    bySection[it.sectionCode].total++;
  });
  return sections;
}

// REQ follow-up: "The side filter should only show relevant items not jump." -- the "All sections"
// row (data-section="") is the only way back to seeing everything at once; every other row filters
// the main content down to just that one section (filterTemplateScoringSection_ below).
function templateScoringSectionNavHtml_(sections) {
  var allRow = '<div class="tpl-section-nav-item" data-section="" style="cursor:pointer;padding:6px 8px;border-radius:6px;margin-bottom:4px;font-size:11.5px;font-weight:600;">' + esc(t('scoring_all_sections')) + '</div>';
  return allRow + sections.map(function (sec) {
    return '<div class="tpl-section-nav-item" data-section="' + esc(sec.sectionCode) + '" style="cursor:pointer;padding:6px 8px;border-radius:6px;margin-bottom:2px;">' +
      '<div style="font-size:11.5px;font-weight:600;">' + esc(sec.sectionCode) + ' ' + esc(sec.sectionName) + '</div>' +
      '<div class="muted tpl-section-nav-progress" data-section-progress="' + esc(sec.sectionCode) + '" style="font-size:10px;">0 / ' + sec.total + '</div>' +
    '</div>';
  }).join('');
}

// REQ follow-up: "When a section is selected Completeness and Quality should only reflect that
// section." -- TPL_SCORING_ACTIVE_SECTION_/TPL_SCORING_SECTIONS_ are plain module-level state (this
// page only ever has one scoring form open at a time) that updateTemplateScoringProgress_ reads to
// decide which items to include, and filterTemplateScoringSection_ writes whenever the selection
// changes. '' means "All sections" -- no filtering, whole-form numbers.
var TPL_SCORING_ACTIVE_SECTION_ = '';
var TPL_SCORING_SECTIONS_ = [];

function wireTemplateScoringSectionNav_(sections, items) {
  document.querySelectorAll('.tpl-section-nav-item').forEach(function (nav) {
    nav.onclick = function () {
      filterTemplateScoringSection_(nav.getAttribute('data-section'));
      updateTemplateScoringProgress_(items);
    };
  });
}

// sectionCode === '' shows every section (the "All sections" row); anything else hides every
// .tpl-score-section container except the matching one. Containers stay in the DOM either way (just
// display:none) so no on-screen answers, wiring, or scroll position are lost switching between them.
// Also updates the scope label above the progress bars (templateScoringProgressHtml_) so it's always
// obvious whether Completeness/Quality are showing the whole form or just one section.
function filterTemplateScoringSection_(sectionCode) {
  TPL_SCORING_ACTIVE_SECTION_ = sectionCode || '';
  document.querySelectorAll('.tpl-score-section').forEach(function (sec) {
    sec.style.display = (!sectionCode || sec.getAttribute('data-section') === sectionCode) ? '' : 'none';
  });
  document.querySelectorAll('.tpl-section-nav-item').forEach(function (nav) {
    var isActive = nav.getAttribute('data-section') === sectionCode;
    nav.classList.toggle('active', isActive);
    nav.style.background = isActive ? 'var(--accent-soft)' : '';
  });
  var scopeLabel = document.getElementById('tplScoringScopeLabel');
  if (scopeLabel) {
    var sec = sectionCode && TPL_SCORING_SECTIONS_.filter(function (s) { return s.sectionCode === sectionCode; })[0];
    scopeLabel.textContent = sec ? (sec.sectionCode + ' ' + sec.sectionName) : t('scoring_all_sections');
  }
}

// A section counts an item as "done" once it has a Completeness answer, and (unless that answer is
// N/A -- nothing left to quality-score on an item that doesn't apply) a Quality score too. Read from
// the DOM live, same convention as updateTemplateScoringProgress_ right below, so every click
// updates both the overall and per-section numbers together.
function updateTemplateScoringSectionNav_(items) {
  var doneBySection = {}, totalBySection = {};
  items.forEach(function (it) {
    totalBySection[it.sectionCode] = (totalBySection[it.sectionCode] || 0) + 1;
    var cGroup = document.querySelector('.doc-completeness-group[data-item="' + it.id + '"]');
    var cVal = cGroup ? cGroup.getAttribute('data-value') : '';
    var qGroup = document.querySelector('.doc-quality-group[data-item="' + it.id + '"]');
    var qVal = qGroup ? qGroup.getAttribute('data-value') : '';
    if (cVal && (cVal === 'N/A' || qVal !== '')) doneBySection[it.sectionCode] = (doneBySection[it.sectionCode] || 0) + 1;
  });
  document.querySelectorAll('.tpl-section-nav-progress').forEach(function (el) {
    var sec = el.getAttribute('data-section-progress');
    var done = doneBySection[sec] || 0, total = totalBySection[sec] || 0;
    el.textContent = done + ' / ' + total;
    el.style.color = (total && done === total) ? 'var(--success)' : '';
  });
}

// REQ follow-up: "Use icons instead of Yes, No and N/A... must be visually easy to see what is
// selected." Completeness reuses the exact same icon+CSS pattern as the Completed Checklists'
// Ticked/Crossed/N-A state buttons (result-state-btn/state-ticked/state-crossed/state-na,
// styles.css) -- Yes=checkmark, No=X, N/A=ban -- so the selected choice gets a strong colored fill
// instead of the plain outline every btn-secondary shares, exactly the "hard to tell what's picked"
// problem being fixed. doc-completeness-btn/doc-completeness-group class names and data-item/
// data-value attributes are kept as-is so wireTemplateScoringRows_ below needs no changes.
var TPL_COMPLETENESS_STATE_CLASS_ = { Yes: 'state-ticked', No: 'state-crossed', 'N/A': 'state-na' };
var TPL_COMPLETENESS_ICON_ = { Yes: 'result_ticked', No: 'result_crossed', 'N/A': 'result_na' };
function templateScoringRowHtml_(item, result) {
  // REQ follow-up: "Keep default Completeness as No" -- an untouched item shows the No button lightly
  // pre-highlighted as a visual nudge to actively decide, rather than looking blank.
  // BUG FIX ("Completeness and Quality do not work properly when filtered"): the first version of
  // this baked that default into the doc-completeness-group's own data-value too, i.e. every untouched
  // item was silently saved/counted AS an explicit "No" -- inflating the "No" side of the Completeness
  // ratio (and Quality's denominator effect) with items nobody had actually reviewed yet, which is
  // exactly what made the numbers look wrong once you filtered down to a mostly-untouched section
  // (e.g. a fresh section reads 0% instead of "--", because every one of its items was already
  // silently counted as a real "No"). Fixed by keeping `completeness` (and therefore the group's own
  // data-value, and whatever collectTemplateScoringResults_ saves) genuinely blank until the reviewer
  // actually clicks something -- only the button's own CSS `active` state defaults to No, purely
  // cosmetic, so updateTemplateScoringProgress_/updateTemplateScoringSectionNav_ (which both key off
  // the group's data-value) keep excluding not-yet-reviewed items from the ratio like they're meant to.
  var completeness = (result && result.completeness) ? result.completeness : '';
  var quality = (result && result.quality !== '' && result.quality != null) ? String(result.quality) : '';
  var completenessBtns = ['Yes', 'No', 'N/A'].map(function (v) {
    var isActive = completeness ? (completeness === v) : (v === 'No');
    return '<button type="button" class="btn btn-secondary btn-icon result-state-btn ' + TPL_COMPLETENESS_STATE_CLASS_[v] + ' doc-completeness-btn' + (isActive ? ' active' : '') +
      '" data-item="' + item.id + '" data-value="' + v + '" title="' + esc(t('completeness_' + v.toLowerCase().replace('/', ''))) + '">' + ICON(TPL_COMPLETENESS_ICON_[v]) + '</button>';
  }).join('');
  // Quality (0-4) has its own accent-filled active state -- see .doc-quality-btn.active, styles.css
  // -- same "dim until picked" idea as result-state-btn, just accent-colored since 0-4 isn't a
  // pass/fail choice the way Completeness is.
  var qualityBtns = [0, 1, 2, 3, 4].map(function (q) {
    return '<button type="button" class="btn btn-secondary btn-sm doc-quality-btn' + (quality === String(q) ? ' active' : '') + '" data-item="' + item.id + '" data-value="' + q + '" title="' + esc(t('quality_level_' + q)) + '">' + q + '</button>';
  }).join('');
  // REQ follow-up: "Redesign card to get rid of white space." -- the old layout used
  // justify-content:space-between with a flex-grow text column, which stretched that column across
  // almost the entire card width and shoved Completeness/Quality out to the far right edge, leaving
  // a huge dead gap between the (usually short) description text and the controls. Now everything
  // sits in one left-aligned row with a capped text column width and controls immediately next to
  // it -- no more artificial full-width stretch.
  return '<div class="tpl-score-row" data-tsi="' + item.id + '" style="border-bottom:1px solid #f0f1f6;padding:8px 0;">' +
    '<div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap;">' +
      '<div style="flex:0 1 420px;min-width:200px;">' +
        '<div style="font-weight:600;font-size:13px;">' + esc(item.description) + '</div>' +
        '<div class="muted" style="font-size:10.5px;margin-top:2px;">' + esc(item.itemCode) + ' · ' + esc(t('field_multiplier')) + ': ' + esc(item.multiplier) + '</div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:5px;">' +
        '<span class="muted" style="font-size:10px;">' + esc(t('col_completeness')) + '</span>' +
        '<div class="doc-completeness-group" data-item="' + item.id + '" data-value="' + esc(completeness) + '" style="display:flex;gap:3px;">' + completenessBtns + '</div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:5px;">' +
        '<span class="muted" style="font-size:10px;">' + esc(t('col_quality')) + '</span>' +
        '<div class="doc-quality-group" data-item="' + item.id + '" data-value="' + esc(quality) + '" style="display:flex;gap:3px;">' + qualityBtns + '</div>' +
      '</div>' +
    '</div>' +
    '<div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;">' +
      '<div style="flex:1 1 240px;">' + UI.field(t('field_remarks'), '<textarea class="field-input doc-remarks" data-item="' + item.id + '" rows="2">' + esc(result ? result.remarks : '') + '</textarea>') + '</div>' +
      '<div style="flex:1 1 240px;">' + UI.field(t('field_detail'), '<textarea class="field-input doc-detail" data-item="' + item.id + '" rows="2">' + esc(result ? result.detail : '') + '</textarea>') + '</div>' +
    '</div>' +
  '</div>';
}

function wireTemplateScoringRows_(items) {
  document.querySelectorAll('.doc-completeness-btn').forEach(function (btn) {
    btn.onclick = function () {
      var group = document.querySelector('.doc-completeness-group[data-item="' + btn.getAttribute('data-item') + '"]');
      if (!group) return;
      // Clicking the already-active choice clears it back to unset -- same "an explicit pick, but
      // not an irreversible one" affordance as toggling a single-select checkbox off again. Clearing
      // back to unset re-shows the No button's cosmetic default-highlight (same rule as the initial
      // render in templateScoringRowHtml_) without writing 'No' back into the group's real data-value
      // -- that's the whole fix for the "Completeness/Quality wrong when filtered" bug: the visual nudge
      // never becomes a counted answer on its own.
      var value = group.getAttribute('data-value') === btn.getAttribute('data-value') ? '' : btn.getAttribute('data-value');
      group.setAttribute('data-value', value);
      group.querySelectorAll('.doc-completeness-btn').forEach(function (b) {
        var isActive = value ? (b.getAttribute('data-value') === value) : (b.getAttribute('data-value') === 'No');
        b.classList.toggle('active', isActive);
      });
      updateTemplateScoringProgress_(items);
      updateTemplateScoringSectionNav_(items);
    };
  });
  document.querySelectorAll('.doc-quality-btn').forEach(function (btn) {
    btn.onclick = function () {
      var group = document.querySelector('.doc-quality-group[data-item="' + btn.getAttribute('data-item') + '"]');
      if (!group) return;
      var value = group.getAttribute('data-value') === btn.getAttribute('data-value') ? '' : btn.getAttribute('data-value');
      group.setAttribute('data-value', value);
      group.querySelectorAll('.doc-quality-btn').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-value') === value); });
      updateTemplateScoringProgress_(items);
      updateTemplateScoringSectionNav_(items);
    };
  });
}

// Live "Completeness X% · Quality Y% (score/maxScore)" readout, recomputed from the DOM (not from
// the last-saved results alone) so every click counts immediately, same "read the DOM, not a stale
// in-memory copy" convention as updateRecordResultsProgress_ (Completed Checklists) above.
// Completeness excludes N/A and not-yet-set items from both sides of the ratio (an "N/A" or blank
// item says nothing about completeness either way); Quality's denominator is every item's own
// 4 * multiplier (its max possible, workbook's own MaxScore column) regardless of whether it's been
// scored yet, so the running % honestly reflects "how much of the whole document is fully scored,"
// not just "how much of what's been touched so far."
// REQ follow-up: "keep the progress bar always visible" -- two actual visual bars (Completeness /
// Quality) instead of plain percentage text, matched to the sticky card in renderTemplateScoring
// (position:sticky;top:0) so they stay on screen while scrolling a long section. IDs only, no
// innerHTML rebuild on every click -- keeps this cheap enough to call on every single button press
// (see wireTemplateScoringRows_) without any visible flicker.
// REQ follow-up: "When a section is selected Completeness and Quality should only reflect that
// section" -- tplScoringScopeLabel makes it obvious at a glance whether the bars below are showing
// the whole form or just the filtered section (filterTemplateScoringSection_ keeps it in sync).
// REQ follow-up: "Move the save button with the completeness and quality button and autosave every
// minute" -- saveTplScoringBtn sits in this same sticky card instead of the bottom of the item list.
// REQ follow-up (user feedback: "Save button seems out of location") -- kept in this same spot (user
// confirmed via AskUserQuestion) but given its own visually-boxed column -- background fill + left
// divider -- so it reads as a distinct "actions" group instead of a button floating in open space next
// to the bars. Autosave toggle (tplScoringAutosaveToggle, checked by default) sits right under Save;
// tplScoringAutosaveStatus below that shows "Autosaved HH:MM" or "Autosave paused" (autosaveTemplateScoring_
// / the toggle's onchange in renderTemplateScoring fill both in).
// REQ follow-up (user feedback: "Save and Autosave need to be aligned vertically to the middle of the
// parent section") -- the previous version forced this column to align-items:stretch + a negative
// margin to visually compensate, which is exactly what made it look mis-aligned/overflowing instead of
// centered. Simplified: the outer row is align-items:center (so every column is vertically centered
// against whichever one is tallest -- normally this Save/Autosave column, since it stacks 3 rows), and
// this column just sizes to its own content -- no stretch, no manual offset needed.
// REQ follow-up: "Finalize closes score editing." isFinalized swaps the actions column (Save +
// Autosave toggle) for a plain "Finalized" banner, plus a Reopen button when canReopen (admin-only,
// 'template.reopenScoring') -- everyone else just sees the banner with no way to undo it, matching
// pointer-events:none on the item list itself: nothing left to click in either place.
function templateScoringProgressHtml_(tpl, isFinalized, canReopen) {
  var actionsColHtml = isFinalized
    ? '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:8px 16px;border-left:1px solid var(--border);background:var(--surface);border-radius:0 8px 8px 0;">' +
        '<div style="display:flex;align-items:center;gap:6px;color:var(--success);font-weight:700;font-size:12px;white-space:nowrap;">' + ICON('locked_indicator') + ' ' + esc(t('scoring_finalized_label')) + '</div>' +
        '<div class="muted" style="font-size:10px;white-space:nowrap;">' + esc(t('finalized_on_x', { date: UI.fmtDate(tpl.scoringFinalizedAt) })) + '</div>' +
        (canReopen ? '<button class="btn btn-secondary btn-sm" id="reopenTplScoringBtn" style="margin-top:2px;">' + esc(t('reopen_scoring_btn')) + '</button>' : '') +
      '</div>'
    : '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:8px 16px;border-left:1px solid var(--border);background:var(--surface);border-radius:0 8px 8px 0;">' +
        '<button class="btn btn-primary" id="saveTplScoringBtn" style="min-width:120px;">' + esc(t('save')) + '</button>' +
        '<label style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;cursor:pointer;user-select:none;white-space:nowrap;">' +
          '<input type="checkbox" id="tplScoringAutosaveToggle" checked style="cursor:pointer;margin:0;" />' + esc(t('autosave_toggle_label')) +
        '</label>' +
        '<span class="muted" id="tplScoringAutosaveStatus" style="font-size:10px;white-space:nowrap;">&nbsp;</span>' +
      '</div>';
  return '<div style="display:flex;gap:28px;flex-wrap:wrap;align-items:center;">' +
    '<div style="flex:1 1 220px;min-width:180px;">' +
      '<div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;margin-bottom:4px;">' +
        '<span>' + esc(t('col_completeness')) + '</span><span id="tplCompletenessPctText" style="color:var(--accent);">—</span>' +
      '</div>' +
      '<div style="height:8px;border-radius:4px;background:var(--border);overflow:hidden;">' +
        '<div id="tplCompletenessBar" style="height:100%;width:0%;background:var(--accent);transition:width .2s;"></div>' +
      '</div>' +
    '</div>' +
    '<div style="flex:1 1 220px;min-width:180px;">' +
      '<div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;margin-bottom:4px;">' +
        '<span>' + esc(t('col_quality')) + '</span><span id="tplQualityPctText" style="color:var(--success);">—</span>' +
      '</div>' +
      '<div style="height:8px;border-radius:4px;background:var(--border);overflow:hidden;">' +
        '<div id="tplQualityBar" style="height:100%;width:0%;background:var(--success);transition:width .2s;"></div>' +
      '</div>' +
    '</div>' +
    actionsColHtml +
  '</div>' +
  '<div class="muted" style="font-size:11px;margin-top:10px;">' + esc(t('scoring_scope_label')) + ': <span id="tplScoringScopeLabel" style="font-weight:600;"></span></div>';
}

function updateTemplateScoringProgress_(items) {
  var completenessBar = document.getElementById('tplCompletenessBar');
  var qualityBar = document.getElementById('tplQualityBar');
  if (!completenessBar || !qualityBar) return;
  // REQ follow-up: "When a section is selected Completeness and Quality should only reflect that
  // section" -- scope to TPL_SCORING_ACTIVE_SECTION_ (set by filterTemplateScoringSection_) when one
  // is selected; '' (All sections) falls back to the full item list, same as before this change.
  var scopedItems = TPL_SCORING_ACTIVE_SECTION_
    ? items.filter(function (it) { return it.sectionCode === TPL_SCORING_ACTIVE_SECTION_; })
    : items;
  var yes = 0, no = 0, qualityScore = 0, qualityMax = 0;
  scopedItems.forEach(function (it) {
    var cGroup = document.querySelector('.doc-completeness-group[data-item="' + it.id + '"]');
    var cVal = cGroup ? cGroup.getAttribute('data-value') : '';
    if (cVal === 'Yes') yes++; else if (cVal === 'No') no++;
    var qGroup = document.querySelector('.doc-quality-group[data-item="' + it.id + '"]');
    var qVal = qGroup ? qGroup.getAttribute('data-value') : '';
    var mult = Number(it.multiplier) || 0;
    qualityMax += 4 * mult;
    if (qVal !== '') qualityScore += Number(qVal) * mult;
  });
  var completenessPct = (yes + no) ? Math.round((yes / (yes + no)) * 100) : 0;
  var qualityPct = qualityMax ? Math.round((qualityScore / qualityMax) * 100) : 0;
  completenessBar.style.width = completenessPct + '%';
  qualityBar.style.width = qualityPct + '%';
  document.getElementById('tplCompletenessPctText').textContent = (yes + no) ? completenessPct + '%' : '—';
  document.getElementById('tplQualityPctText').textContent = qualityMax ? (qualityPct + '% (' + qualityScore.toFixed(2) + ' / ' + qualityMax.toFixed(2) + ')') : '—';
}

// Reads every item row's current DOM state back into the flat array saveTemplateScoring expects --
// same "read the DOM at Save time" convention as inspectionResultsSnapshot_/saveInspectionResults_
// above, just without their partial-save diffing (this form's own saveTemplateScoring always upserts
// every entry sent, so sending every item's current state -- scored or still blank -- every Save is
// simplest and correct either way).
function collectTemplateScoringResults_(items) {
  return items.map(function (it) {
    var cGroup = document.querySelector('.doc-completeness-group[data-item="' + it.id + '"]');
    var qGroup = document.querySelector('.doc-quality-group[data-item="' + it.id + '"]');
    var remarksEl = document.querySelector('.doc-remarks[data-item="' + it.id + '"]');
    var detailEl = document.querySelector('.doc-detail[data-item="' + it.id + '"]');
    return {
      itemId: it.id,
      completeness: cGroup ? cGroup.getAttribute('data-value') : '',
      quality: qGroup ? qGroup.getAttribute('data-value') : '',
      remarks: remarksEl ? remarksEl.value : '',
      detail: detailEl ? detailEl.value : ''
    };
  });
}

// REQ follow-up: "Scoring forms are long and take days to complete; so need to know the progress...
// Also add import and export as well." -- exports the form's current on-screen state (same DOM read
// as collectTemplateScoringResults_ above) to CSV so an auditor can keep working offline (a laptop
// with no connectivity, or just prefers a spreadsheet) across several sessions, then bring it back in
// via importTemplateScoringCsv_ below. itemId is the hidden join key import matches rows back by;
// itemCode/section/description/multiplier are included read-only for the auditor's own reference
// while filling it in -- not read back on import. csvEscape_ reused from events.js (loaded on the
// same page), same BOM-prefixed Excel-friendly convention as every other export in this app.
function exportTemplateScoringCsv_(tpl, items) {
  var resultsNow = collectTemplateScoringResults_(items);
  var byItemId = {};
  resultsNow.forEach(function (r) { byItemId[r.itemId] = r; });
  var headers = ['itemId', 'itemCode', 'sectionCode', 'sectionName', 'description', 'multiplier', 'completeness', 'quality', 'remarks', 'detail'];
  var lines = [headers.map(csvEscape_).join(',')];
  items.forEach(function (it) {
    var r = byItemId[it.id] || {};
    lines.push([
      it.id, it.itemCode, it.sectionCode, it.sectionName, it.description, it.multiplier,
      r.completeness || '', r.quality || '', r.remarks || '', r.detail || ''
    ].map(csvEscape_).join(','));
  });
  var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = 'hulul-scoring-' + (tpl.docType || 'form') + '-' + tpl.id + '-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Import is deliberately a pure DOM populate, not an auto-save -- matches every other form in this
// app's "review before Save" convention. parseCsv_ reused from events.js (same RFC4180-ish parser
// the checklist-item import already relies on). Matched by itemId (the export's own hidden join
// column); a row whose itemId doesn't match any item on THIS form (wrong file, or the catalog
// changed since export) is silently skipped rather than failing the whole import. Progress (both
// overall and per-section) is recomputed once at the end, same as any other batch of DOM changes.
async function importTemplateScoringCsv_(file, items) {
  var text = await file.text();
  var rows = parseCsv_(text);
  if (!rows.length) { UI.toast(t('empty_csv'), 'error'); return; }
  var headers = rows[0].map(function (h) { return h.trim().toLowerCase(); });
  var col = function (name) { return headers.indexOf(name); };
  var idxId = col('itemid'), idxCompleteness = col('completeness'), idxQuality = col('quality'),
    idxRemarks = col('remarks'), idxDetail = col('detail');
  if (idxId === -1) { UI.toast(t('toast_scoring_csv_missing_itemid'), 'error'); return; }
  var itemById = {};
  items.forEach(function (it) { itemById[it.id] = it; });

  var applied = 0;
  for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    if (!row || row.join('').trim() === '') continue;
    var it = itemById[(row[idxId] || '').trim()];
    if (!it) continue;
    var completeness = idxCompleteness !== -1 ? (row[idxCompleteness] || '').trim() : '';
    if (['Yes', 'No', 'N/A', ''].indexOf(completeness) === -1) completeness = '';
    var quality = idxQuality !== -1 ? (row[idxQuality] || '').trim() : '';
    if (quality !== '' && (isNaN(Number(quality)) || Number(quality) < 0 || Number(quality) > 4)) quality = '';

    var cGroup = document.querySelector('.doc-completeness-group[data-item="' + it.id + '"]');
    if (cGroup) {
      cGroup.setAttribute('data-value', completeness);
      cGroup.querySelectorAll('.doc-completeness-btn').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-value') === completeness); });
    }
    var qGroup = document.querySelector('.doc-quality-group[data-item="' + it.id + '"]');
    if (qGroup) {
      qGroup.setAttribute('data-value', quality);
      qGroup.querySelectorAll('.doc-quality-btn').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-value') === quality); });
    }
    var remarksEl = document.querySelector('.doc-remarks[data-item="' + it.id + '"]');
    if (remarksEl && idxRemarks !== -1) remarksEl.value = row[idxRemarks] || '';
    var detailEl = document.querySelector('.doc-detail[data-item="' + it.id + '"]');
    if (detailEl && idxDetail !== -1) detailEl.value = row[idxDetail] || '';
    applied++;
  }
  updateTemplateScoringProgress_(items);
  updateTemplateScoringSectionNav_(items);
  UI.toast(t('toast_scoring_csv_imported', { count: applied }), 'success');
}

/* ---------------- Opening Approval ---------------- */
async function tabApproval(content, eventId) {
  var evals = await Api.call('listVenueEvaluations', { eventId: eventId });
  // The 'current' row is this venue's live evaluation (see currentVenueEvaluation_ in
  // VenueApproval.gs) -- older rows are superseded history from a prior, rejected venue and aren't
  // shown here anymore.
  var current = evals.filter(function (e) { return e.status === 'current'; })[0] || null;
  var hasRecommendation = !!(current && current.recommendation);
  // RBAC pilot (backend/Permissions.gs): admin-configurable from Settings > Permissions > Venue
  // Approval -- hides controls a viewer can't actually use, same "avoid the dead-end click" reasoning
  // as the Disciplines & Inspectors tab above.
  var canRecommend = hasPermission('venueApproval.recommend');
  var canDecide = hasPermission('venueApproval.decide');
  // REQ-VAP-04/REQ-EVT-12: "Not Approved" leaves the Event stuck on VenueRejected with no way to act
  // on it -- reassignVenue (VenueApproval.gs) already existed and works, this button was the only
  // missing piece. Same permission as the decision itself (reassignVenue's own requirePermission
  // call), since picking the replacement Venue/EMC is really a continuation of that same decision.
  var canReassign = canDecide && !!(current && current.decision === 'Not Approved');

  // Once a recommendation is on record for this evaluation it's locked -- shown read-only instead
  // of the form, matching recordRecommendation's own one-per-evaluation check server-side.
  var recBody = hasRecommendation
    ? '<div style="font-size:13.5px;line-height:1.6;white-space:pre-wrap;">' + esc(current.recommendation) + '</div>' +
      '<div class="muted" style="font-size:11px;margin-top:8px;">' + esc(t('submitted_once_note', { date: UI.fmtDate(current.recommendationAt) })) + '</div>'
    : (canRecommend
      ? '<div style="display:flex;flex-direction:column;gap:6px;">' +
          UI.field(t('field_recommendation'), '<textarea id="fRecommendation" class="field-input" rows="5" style="width:100%;box-sizing:border-box;resize:vertical;"></textarea>') +
        '</div>' +
        '<button class="btn btn-primary btn-sm" id="submitRecBtn" style="margin-top:12px;">' + esc(t('submit_recommendation_btn')) + '</button>'
      : '<div class="muted" style="font-size:12.5px;">' + esc(t('no_recommendation_yet')) + '</div>');

  content.innerHTML =
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + esc(t('record_recommendation_title')) + '</div></div>' +
    '<div class="card-body">' + recBody + '</div></div>' +
    // Decision / Decided-on at a glance, to the left of the GA decision card (replaces the old
    // full evaluation-history table -- this evaluation's own status is what matters day to day).
    '<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:stretch;">' +
      '<div class="kpi-card" style="min-width:150px;"><div class="kpi-label">' + esc(t('label_decision')) + '</div>' +
        '<div style="margin-top:6px;">' + (current && current.decision ? UI.statusBadge(current.decision) : '<span class="kpi-value" style="font-size:16px;">—</span>') + '</div></div>' +
      '<div class="kpi-card" style="min-width:150px;"><div class="kpi-label">' + esc(t('label_decided_on')) + '</div>' +
        '<div class="kpi-value" style="font-size:16px;">' + (current && current.decisionAt ? UI.fmtDate(current.decisionAt) : '—') + '</div></div>' +
      (canDecide
        ? '<div class="card" style="flex:1;min-width:260px;"><div class="card-header"><div class="card-title">' + esc(t('x_decision_ga_label', { term: Term('venue') })) + '</div></div>' +
          '<div class="card-body"><button class="btn btn-secondary btn-sm" id="approveBtn">' + esc(t('approve_btn')) + '</button> ' +
          '<button class="btn btn-danger btn-sm" id="rejectBtn">' + esc(t('not_approved_btn')) + '</button></div></div>'
        : '') +
      (canReassign
        ? '<div class="card" style="flex:1;min-width:260px;border-color:var(--danger);"><div class="card-header"><div class="card-title">' + esc(t('reassign_venue_title')) + '</div></div>' +
          '<div class="card-body"><div class="muted" style="font-size:12px;margin-bottom:8px;">' + esc(t('reassign_venue_hint')) + '</div>' +
          '<button class="btn btn-primary btn-sm" id="reassignVenueBtn">' + esc(t('reassign_venue_btn')) + '</button></div></div>'
        : '') +
    '</div>';

  if (canReassign) {
    document.getElementById('reassignVenueBtn').onclick = function () { openReassignVenueModal_(eventId); };
  }
  if (canRecommend && !hasRecommendation) {
    document.getElementById('submitRecBtn').onclick = async function () {
      var val = document.getElementById('fRecommendation').value.trim();
      if (!val) { UI.toast(t('toast_recommendation_required'), 'error'); return; }
      try {
        await Api.call('recordRecommendation', { eventId: eventId, recommendation: val });
        UI.toast(t('toast_recommendation_recorded'), 'success'); Router.resolve();
      } catch (err) { UI.error(err); }
    };
  }
  if (canDecide) {
    document.getElementById('approveBtn').onclick = () => decide('Approved');
    document.getElementById('rejectBtn').onclick = () => decide('Not Approved');
  }
  async function decide(decision) {
    try { await Api.call('recordVenueDecision', { eventId: eventId, decision: decision }); UI.toast(t('toast_decision_recorded'), 'success'); Router.resolve(); }
    catch (err) { UI.error(err); }
  }
}

// REQ-VAP-04/REQ-EVT-12: pick a replacement Venue (required) after a rejection, optionally a new
// renting EMC and/or Inspection Company too -- same three fields as the New Event form
// (openNewEventModal, events.js), reassignVenue (VenueApproval.gs) just never had a frontend caller.
// Venues/Organizations aren't loaded by tabApproval itself (most visits never need them), so this
// fetches them plus the Event's own current emcId/inspectionCoId lazily, only when the button is
// actually clicked.
async function openReassignVenueModal_(eventId) {
  var body = '<div class="empty-state">' + esc(t('loading')) + '</div>';
  UI.openModal(t('reassign_venue_title'), body, [{ label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal }]);

  var detail, venues, orgs;
  try {
    [detail, venues, orgs] = await Promise.all([
      Api.call('getEvent', { eventId: eventId }), Api.call('listVenues', {}), Api.call('listOrganizations', {})
    ]);
  } catch (err) { UI.closeModal(); UI.error(err); return; }

  var event = detail.event;
  var inspectionCos = orgs.filter(function (o) { return o.type === 'INSPECTION'; });
  var emcOrgs = orgs.filter(function (o) { return o.type === 'EMC'; });
  var venueOptions = venues.filter(function (v) { return v.id !== event.venueId; })
    .map(function (v) { return '<option value="' + v.id + '">' + esc(v.name) + ' (' + esc(v.city) + ')</option>'; }).join('');
  var emcOptions = emcOrgs.map(function (o) { return '<option value="' + o.id + '"' + (o.id === event.emcId ? ' selected' : '') + '>' + esc(o.name) + '</option>'; }).join('');
  var inspCoOptions = inspectionCos.map(function (o) { return '<option value="' + o.id + '"' + (o.id === event.inspectionCoId ? ' selected' : '') + '>' + esc(o.name) + '</option>'; }).join('');

  if (!venueOptions) {
    UI.closeModal();
    UI.toast(t('no_other_venues_found'), 'error');
    return;
  }

  var newBody =
    '<div class="muted" style="font-size:12px;margin-bottom:10px;">' + esc(t('reassign_venue_modal_hint')) + '</div>' +
    UI.field(Term('venue'), '<select id="fRVVenue" class="field-input">' + venueOptions + '</select>') +
    UI.field(t('field_renting_emc'), '<select id="fRVEmc" class="field-input">' + emcOptions + '</select>') +
    UI.field(t('field_inspection_co'), '<select id="fRVInspCo" class="field-input">' + inspCoOptions + '</select>');
  UI.openModal(t('reassign_venue_title'), newBody, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('reassign_venue_btn'), className: 'btn-primary', onClick: async function () {
        try {
          await Api.call('reassignVenue', {
            eventId: eventId, venueId: document.getElementById('fRVVenue').value,
            emcId: document.getElementById('fRVEmc').value, inspectionCoId: document.getElementById('fRVInspCo').value
          });
          UI.closeModal(); UI.toast(t('toast_venue_reassigned'), 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      } }
  ]);
}

/* ---------------- Disciplines & Inspectors ---------------- */
// Only Project Managers (and SystemAdmin) can identify disciplines / assign / unassign
// inspectors — everyone else viewing this tab gets a read-only view of the same data instead
// of controls that would just come back "Not permitted" when clicked.
// RBAC pilot (backend/Permissions.gs): these were one shared role check, but they're two
// separately admin-configurable permissions (Settings > Permissions > Disciplines) that just
// happen to share the same default roles today -- kept split so Settings can diverge them later
// without a frontend code change.

async function tabDisciplines(content, eventId, detail) {
  var canIdentify = hasPermission('discipline.identify');
  var canAssign = hasPermission('inspectorAssignment.manage');
  var zones = (detail && detail.zones) || [];
  var zonesRequired = zones.length > 1;
  var [disciplines, assignments, eventDisciplines, gaps] = await Promise.all([
    Api.call('listDisciplines', {}), Api.call('listInspectorAssignments', { eventId: eventId }), Api.call('listEventDisciplines', { eventId: eventId }),
    Api.call('listCoverageGaps', { eventId: eventId })
  ]);
  var identifiedIds = eventDisciplines.map(function (ed) { return ed.disciplineId; });
  var assignedDisciplineIds = Array.from(new Set(assignments.map(function (a) { return a.disciplineId; })));
  var identifiedDisciplines = disciplines.filter(function (d) { return identifiedIds.indexOf(d.id) !== -1; });
  var disciplineOptions = identifiedDisciplines.map(d => '<option value="' + d.id + '">' + esc(d.name) + '</option>').join('');

  content.innerHTML =
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + esc(t('identify_applicable_x', { term: Term('discipline_plural').toLowerCase() })) + '</div>' +
    // REQ: "In the 'Identify applicable categories' add a Select all option." Only rendered for
    // canIdentify (view-only visitors have nothing to toggle) -- both buttons only ever touch
    // NOT-disabled checkboxes (:not(:disabled)), so a discipline locked because an inspector is
    // already assigned to it (see the `locked` var below) is left untouched either way, same as if
    // the user had tried to click that one checkbox directly.
    (canIdentify
      ? '<div style="display:flex;gap:8px;">' +
          '<button type="button" class="btn btn-secondary btn-sm" id="discSelectAllBtn">' + esc(t('select_all_btn')) + '</button>' +
          '<button type="button" class="btn btn-secondary btn-sm" id="discClearAllBtn">' + esc(t('clear_all_btn')) + '</button>' +
        '</div>'
      : '') +
    '</div>' +
    '<div class="card-body">' + disciplines.map(function (d) {
      // REQ follow-up: "set default to Select all." Only applies before anything has ever been
      // saved for this event (identifiedIds.length === 0) -- once the PM has saved a selection at
      // least once, that saved set is what should keep showing, same as any other persisted form.
      var checked = identifiedIds.length === 0 ? true : identifiedIds.indexOf(d.id) !== -1;
      var locked = !canIdentify || (checked && assignedDisciplineIds.indexOf(d.id) !== -1);
      var lockReason = !canIdentify ? t('only_pm_admin_hint') : t('x_assigned_remove_first_hint', { inspector: Term('inspector').toLowerCase(), discipline: Term('discipline').toLowerCase() });
      return '<label style="display:inline-flex;align-items:center;gap:6px;margin:4px 12px 4px 0;font-size:13px;' + (locked ? 'opacity:0.65;' : '') + '"' +
        (locked ? ' title="' + lockReason + '"' : '') + '>' +
        '<input type="checkbox" class="disc-check" value="' + d.id + '"' + (checked ? ' checked' : '') + (locked ? ' disabled' : '') + ' /> ' +
        esc(d.name) + (checked && assignedDisciplineIds.indexOf(d.id) !== -1 ? ' ' + ICON('locked_indicator') : '') + '</label>';
    }).join('') +
    (canIdentify
      ? '<div><button class="btn btn-primary btn-sm" id="saveDiscBtn" style="margin-top:12px;">' + esc(t('save')) + '</button></div>' +
        (assignedDisciplineIds.length ? '<div class="muted" style="font-size:11.5px;margin-top:8px;">' + ICON('locked_indicator') + ' ' + esc(t('x_assigned_remove_hint', { term: Term('inspector').toLowerCase() })) + '</div>' : '')
      : '<div class="muted" style="font-size:11.5px;margin-top:10px;">' + esc(t('readonly_pm_admin_hint')) + '</div>') +
    '</div></div>' +
    renderConflictsCard_(gaps.conflicts, canAssign) +
    renderCoverageGapsCard_(gaps, canAssign) +
    (canAssign
      ? '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + esc(t('assign_x_title', { term: Term('inspector').toLowerCase() })) + '</div></div>' +
        '<div class="card-body form-row">' +
          UI.field(Term('discipline'), '<select id="fAssignDisc" class="field-input">' + (disciplineOptions || '<option value="">' + esc(t('no_x_identified_yet', { term: Term('discipline_plural').toLowerCase() })) + '</option>') + '</select>') +
          UI.field(t('field_qualified_x', { term: Term('inspector').toLowerCase() }), '<select id="fAssignInsp" class="field-input"></select>') +
        '</div>' +
        // REQ follow-up: "In Assign inspector section, Sub category can be selected or by default
        // all sub-categories are selected. If a sub-category has already been picked up it can not
        // appear in the sub-category section." Populated once a Discipline is chosen (see
        // renderSubCatPicker below) -- empty until then, same lazy-fill pattern fAssignInsp already
        // uses for loadQualifiedInspectors.
        '<div class="card-body" id="assignSubCatWrap" style="padding-top:0;"></div>' +
        (zonesRequired
          ? '<div class="card-body" style="padding-top:0;">' + UI.field(t('zones_required_field_label', { zonePluralCap: Term('zone_plural'), venue: Term('venue').toLowerCase(), zonePlural: Term('zone_plural').toLowerCase() }),
              zones.map(function (z) { return '<label style="display:inline-flex;align-items:center;gap:6px;margin:4px 12px 4px 0;font-size:13px;">' +
                '<input type="checkbox" class="assign-zone-check" value="' + z.id + '" /> ' + esc(z.name) + '</label>'; }).join('')
            ) + '</div>'
          : '') +
        '<div class="card-body" style="padding-top:0;"><button class="btn btn-primary btn-sm" id="assignBtn"' + (identifiedDisciplines.length ? '' : ' disabled') + '>' + esc(t('assign_btn')) + '</button></div></div>'
      : '') +
    '<div class="card"><div class="card-header"><div class="card-title">' + esc(t('assignments_title')) + '</div></div><div class="card-body">' +
    UI.table([
      { key: 'disciplineName', label: Term('discipline') }, { key: 'inspectorName', label: Term('inspector') },
      { key: 'checklistTypeNames', label: Term('checklistType_plural'), render: r => (r.checklistTypeNames && r.checklistTypeNames.length) ? esc(r.checklistTypeNames.join(', ')) : '—' },
      { key: 'zoneNames', label: Term('zone_plural'), render: r => (r.zoneNames && r.zoneNames.length) ? esc(r.zoneNames.join(', ')) : '—' },
      { key: 'assignedAt', label: t('col_assigned'), render: r => UI.fmtDate(r.assignedAt) }
    ].concat(canAssign ? [{ key: 'actions', label: t('actions'), render: r => UI.actionsCell('<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('remove_btn')) + '" data-remove-assign="' + r.id + '">' + ICON('delete') + '</button>') }] : []),
      assignments, {}) +
    '</div></div>';

  if (canIdentify) {
    // REQ: "In the 'Identify applicable categories' add a Select all option." Both buttons only ever
    // touch enabled checkboxes -- a discipline locked because an inspector is already assigned to it
    // (see `locked` above) is left exactly as it was, same as manually clicking that one checkbox.
    document.getElementById('discSelectAllBtn').onclick = function () {
      content.querySelectorAll('.disc-check:not(:disabled)').forEach(function (c) { c.checked = true; });
    };
    document.getElementById('discClearAllBtn').onclick = function () {
      content.querySelectorAll('.disc-check:not(:disabled)').forEach(function (c) { c.checked = false; });
    };
    document.getElementById('saveDiscBtn').onclick = async function () {
      var ids = Array.from(content.querySelectorAll('.disc-check:checked')).map(c => c.value);
      try {
        await Api.call('identifyDisciplines', { eventId: eventId, disciplineIds: ids });
        UI.toast(t('x_saved', { term: Term('discipline_plural') }), 'success'); Router.resolve();
      } catch (err) { UI.error(err); }
    };
  }

  if (!canAssign) return;

  var discSelect = document.getElementById('fAssignDisc');
  var inspSelect = document.getElementById('fAssignInsp');
  var subCatWrap = document.getElementById('assignSubCatWrap');
  async function loadQualifiedInspectors() {
    if (!discSelect.value) { inspSelect.innerHTML = ''; return; }
    inspSelect.innerHTML = '<option value="">' + t('loading') + '</option>';
    try {
      var inspectors = await Api.call('listQualifiedInspectors', { disciplineId: discSelect.value, eventId: eventId });
      inspSelect.innerHTML = inspectors.length
        ? inspectors.map(i => '<option value="' + i.id + '">' + esc(i.name) + ' (' + esc(i.email) + ')</option>').join('')
        : '<option value="">' + esc(t('no_qualified_x_for_y', { x: Term('inspector_plural').toLowerCase(), y: Term('discipline').toLowerCase() })) + '</option>';
    } catch (err) { UI.error(err); }
  }
  // REQ follow-up: "Sub category can be selected or by default all sub-categories are selected. If
  // a sub-category has already been picked up it can not appear in the sub-category section." --
  // `available` (already excludes anything covered by another assignment for this discipline+event,
  // see assignableChecklistTypes_, Disciplines.gs) is what actually gets checkboxes; `all` is only
  // used to decide whether to show this section at all (a discipline with no sub-category catalogue
  // renders nothing here, same as before this feature) and to explain why the list looks short.
  async function renderSubCatPicker() {
    if (!discSelect.value) { subCatWrap.innerHTML = ''; return; }
    subCatWrap.innerHTML = '<div class="muted" style="font-size:12px;">' + esc(t('loading')) + '</div>';
    try {
      var scope = await Api.call('listAssignableChecklistTypes', { eventId: eventId, disciplineId: discSelect.value });
      if (!scope.all.length) { subCatWrap.innerHTML = ''; return; }
      if (!scope.available.length) {
        subCatWrap.innerHTML = '<div class="muted" style="font-size:12px;">' + esc(t('subcat_all_covered_hint', { term: Term('checklistType_plural').toLowerCase() })) + '</div>';
        return;
      }
      var coveredCount = scope.all.length - scope.available.length;
      subCatWrap.innerHTML = UI.field(Term('checklistType_plural'),
        scope.available.map(function (ty) { return '<label style="display:inline-flex;align-items:center;gap:6px;margin:4px 12px 4px 0;font-size:13px;">' +
          '<input type="checkbox" class="assign-subcat-check" value="' + esc(ty) + '" checked /> ' + esc(ty) + '</label>'; }).join('')
      ) + (coveredCount ? '<div class="muted" style="font-size:11px;margin-top:4px;">' + esc(t('subcat_some_covered_hint', { count: coveredCount, term: Term('checklistType_plural').toLowerCase() })) + '</div>' : '');
    } catch (err) { UI.error(err); }
  }
  discSelect.onchange = function () { loadQualifiedInspectors(); renderSubCatPicker(); };
  if (identifiedDisciplines.length) { loadQualifiedInspectors(); renderSubCatPicker(); }

  document.getElementById('assignBtn').onclick = async function () {
    if (!inspSelect.value) { UI.toast(t('toast_no_qualified_x_selected', { term: Term('inspector').toLowerCase() }), 'error'); return; }
    var subCatChecks = content.querySelectorAll('.assign-subcat-check');
    var checklistTypes = Array.from(subCatChecks).filter(c => c.checked).map(c => c.value);
    if (subCatChecks.length && !checklistTypes.length) { UI.toast(t('toast_subcat_select_one', { term: Term('checklistType').toLowerCase() }), 'error'); return; }
    var zoneIds = Array.from(content.querySelectorAll('.assign-zone-check:checked')).map(c => c.value);
    if (zonesRequired && !zoneIds.length) { UI.toast(t('toast_x_multiple_zones_select_one', { venue: Term('venue').toLowerCase(), zonePlural: Term('zone_plural').toLowerCase() }), 'error'); return; }
    try {
      await Api.call('assignInspector', { eventId: eventId, disciplineId: discSelect.value, inspectorId: inspSelect.value, zoneIds: zoneIds, checklistTypes: checklistTypes });
      UI.toast(t('x_assigned_toast', { term: Term('inspector') }), 'success'); Router.resolve();
    } catch (err) { UI.error(err); }
  };

  content.querySelectorAll('[data-remove-assign]').forEach(function (b) {
    b.onclick = function () {
      UI.confirmModal(t('remove_x_assignment_confirm', { term: Term('inspector').toLowerCase() }), async function () {
        try {
          await Api.call('removeInspectorAssignment', { eventId: eventId, assignmentId: b.getAttribute('data-remove-assign') });
          UI.toast(t('toast_assignment_removed'), 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      }, { confirmLabel: t('remove_btn') });
    };
  });

  // Coverage-gap "Quick assign" chips pre-fill the form above (discipline, qualified inspector,
  // and — if this venue has multiple zones — the specific uncovered zones) so the PM only has to
  // review and hit Assign, instead of re-finding the same discipline/inspector combo by hand.
  content.querySelectorAll('[data-qa-insp]').forEach(function (btn) {
    btn.onclick = async function () {
      discSelect.value = btn.getAttribute('data-qa-disc');
      await Promise.all([loadQualifiedInspectors(), renderSubCatPicker()]);
      inspSelect.value = btn.getAttribute('data-qa-insp');
      var uncoveredZoneIds = (btn.getAttribute('data-qa-zones') || '').split(',').filter(Boolean);
      var prevZoneIds = (btn.getAttribute('data-qa-prev-zones') || '').split(',').filter(Boolean);
      // REQ follow-up: "If an inspector has been chosen to do a zone for example Zone A, then making
      // quick assign would also suggest same previous zone." Prefer whichever of this inspector's
      // own previously-assigned zones (this event, any discipline) are actually still uncovered for
      // THIS gap -- falls back to every uncovered zone (the original behavior) when there's no
      // overlap, e.g. a brand-new inspector with no prior assignment on this event yet.
      var overlap = prevZoneIds.filter(function (zid) { return uncoveredZoneIds.indexOf(zid) !== -1; });
      var zoneIds = overlap.length ? overlap : uncoveredZoneIds;
      content.querySelectorAll('.assign-zone-check').forEach(function (cb) { cb.checked = zoneIds.indexOf(cb.value) !== -1; });
      document.getElementById('assignBtn').scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
  });

  // REQ: "...option to reschedule or change with other qualified inspector with no conflict."
  // "Reschedule" hands off to Inspections & Checklist Items -- that's where an individual
  // inspection's actual scheduledAt time lives (assignments themselves are event-wide, not
  // time-specific), so adjusting the conflicting time slot happens there.
  content.querySelectorAll('[data-conflict-reschedule]').forEach(function (btn) {
    btn.onclick = function () {
      UI.toast(t('adjust_time_hint', { inspector: Term('inspector').toLowerCase(), inspectionAndChecklist: t('and_join', { a: Term('inspection_plural'), b: Term('checklistItem_plural') }) }), 'info');
      window.location.hash = '#/events/' + eventId + '?tab=inspections';
    };
  });
  content.querySelectorAll('[data-conflict-change]').forEach(function (btn) {
    btn.onclick = async function () {
      var oldAssignmentId = btn.getAttribute('data-conflict-change');
      var disciplineId = btn.getAttribute('data-conflict-disc');
      var disciplineName = btn.getAttribute('data-conflict-discname');
      var candidates;
      try {
        candidates = await Api.call('listConflictFreeQualifiedInspectors', { eventId: eventId, disciplineId: disciplineId });
      } catch (err) { UI.error(err); return; }
      if (!candidates.length) {
        UI.toast(t('no_other_qualified_x_for_y', { term: Term('inspector').toLowerCase(), name: disciplineName }), 'error');
        return;
      }
      var body = '<div style="font-size:13px;margin-bottom:10px;">' + esc(t('replace_with_qualified_x_hint', { term: Term('inspector').toLowerCase() })) + '</div>' +
        UI.field(Term('inspector'), '<select id="fConflictNewInsp" class="field-input">' +
          candidates.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + ' (' + esc(c.email) + ')</option>'; }).join('') +
        '</select>');
      UI.openModal(t('change_x_title', { term: Term('inspector').toLowerCase() }), body, [
        { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
        { label: t('change_btn'), className: 'btn-primary', onClick: async function () {
            var newInspectorId = document.getElementById('fConflictNewInsp').value;
            try {
              await Api.call('reassignInspector', { eventId: eventId, oldAssignmentId: oldAssignmentId, newInspectorId: newInspectorId });
              UI.closeModal(); UI.toast(t('x_changed_toast', { term: Term('inspector') }), 'success'); Router.resolve();
            } catch (err) { UI.error(err); }
          } }
      ]);
    };
  });
}

// Summarizes listCoverageGaps() into a card: which identified disciplines still have zones (or,
// for a single/no-zone venue, the whole venue) without an assigned inspector, and every qualified
// Inspector who could fill each gap. Shown to every viewer (it's just information), but the "Quick
// assign" shortcut only appears for roles that can act on it.
// REQ: "change: 'No qualified, unassigned inspectors...' to: 'No qualified inspector' (red)" -- now
// that availableInspectors lists every qualified inspector (not just unassigned ones, see below),
// an empty list genuinely means no one at all is qualified, so the message and its red color both
// follow directly from that.
// REQ: "If more than one inspector is qualified... if one has already been assigned (silver)" --
// already-assigned candidates stay in the list instead of being filtered out, just rendered in
// silver with no Quick assign button (there's nothing to assign, they're already on it).
function renderCoverageGapsCard_(gaps, canManage) {
  var body;
  if (!gaps || !gaps.items || !gaps.items.length) {
    body = '<div class="muted" style="font-size:13px;">' + ICON('coverage_complete') + ' ' + esc(t('every_discipline_covered', { term: Term('discipline').toLowerCase() })) + (gaps && gaps.zoneMode ? esc(t('across_all_zones_suffix')) : '.') + '</div>';
  } else {
    body = gaps.items.map(function (item) {
      var whereText = gaps.zoneMode
        ? esc(t('uncovered_x_prefix', { term: Term('zone_plural').toLowerCase() })) + '<strong>' + item.uncoveredZones.map(function (z) { return esc(z.name); }).join(', ') + '</strong>'
        : '<strong>' + esc(t('not_yet_assigned')) + '</strong>';
      var zoneIdsAttr = gaps.zoneMode ? item.uncoveredZones.map(function (z) { return z.id; }).join(',') : '';
      var inspectorsHtml = item.availableInspectors.length
        ? item.availableInspectors.map(function (i) {
            var nameStyle = i.assigned ? 'color:silver;' : '';
            var conflictNote = i.conflict
              ? '<div style="font-size:11px;color:var(--danger);margin-top:2px;">' + esc(t('conflict_also_assigned', { event: i.conflict.eventName, start: UI.fmtDate(i.conflict.startDateTime), end: UI.fmtDate(i.conflict.endDateTime) })) + '</div>'
              : '';
            return '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px;background:#f6f7fb;border-radius:8px;margin-top:6px;font-size:12.5px;">' +
              '<span><strong style="' + nameStyle + '">' + esc(i.name) + '</strong> <span class="muted">' + esc(i.email) + '</span>' +
              (i.assigned ? ' <span class="muted" style="font-size:11px;">' + esc(t('already_assigned_paren')) + '</span>' : '') + conflictNote + '</span>' +
              // REQ follow-up: "...quick assign would also suggest same previous zone." data-qa-prev-
              // zones carries this inspector's zoneIds from their OTHER assignments on this event
              // (listCoverageGaps, Disciplines.gs) -- the click handler below prefers whatever
              // overlaps this gap's own uncovered zones over pre-checking all of them.
              (canManage && !i.assigned ? '<button class="btn btn-secondary btn-sm" data-qa-disc="' + item.disciplineId + '" data-qa-insp="' + i.id + '" data-qa-zones="' + esc(zoneIdsAttr) + '" data-qa-prev-zones="' + esc((i.previousZoneIds || []).join(',')) + '">' + esc(t('quick_assign_btn')) + '</button>' : '') +
              '</div>';
          }).join('')
        : '<div style="font-size:12px;margin-top:6px;color:var(--danger);">' + esc(t('no_qualified_x_plain', { term: Term('inspector') })) + '</div>';
      return '<div style="padding:10px 0;border-bottom:1px solid #f0f1f6;">' +
        '<div style="font-weight:600;font-size:13.5px;">' + esc(item.disciplineName) + '</div>' +
        '<div style="font-size:12.5px;margin-top:2px;">' + whereText + '</div>' + inspectorsHtml + '</div>';
    }).join('');
  }
  return '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + esc(t('coverage_gaps_title')) + '</div></div><div class="card-body">' + body + '</div></div>';
}

// REQ: "If an inspector has conflict in another event then must be added to a conflict list with
// details and provided the option to reschedule or change with other qualified inspector with no
// conflict." Separate from the coverage-gaps card since a conflict can exist on a discipline that's
// otherwise fully covered (see listCoverageGaps' own `conflicts` -- computed across every current
// assignment for this event, not just gap disciplines). Only rendered when there's at least one.
function renderConflictsCard_(conflicts, canManage) {
  if (!conflicts || !conflicts.length) return '';
  var rows = conflicts.map(function (c) {
    return '<div style="padding:10px 0;border-bottom:1px solid #f0f1f6;font-size:12.5px;">' +
      '<div><strong>' + esc(c.inspectorName) + '</strong> <span class="muted">' + esc(c.inspectorEmail) + '</span> — ' + esc(c.disciplineName) + '</div>' +
      '<div style="color:var(--danger);margin-top:2px;">' + esc(t('also_assigned_to_event', { event: c.conflict.eventName, start: UI.fmtDate(c.conflict.startDateTime), end: UI.fmtDate(c.conflict.endDateTime) })) + '</div>' +
      (canManage
        ? '<div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;">' +
            '<button class="btn btn-secondary btn-sm" data-conflict-change="' + esc(c.assignmentId) + '" data-conflict-disc="' + esc(c.disciplineId) + '" data-conflict-discname="' + esc(c.disciplineName) + '">' + esc(t('change_inspector_btn', { term: Term('inspector') })) + '</button>' +
            '<button class="btn btn-secondary btn-sm" data-conflict-reschedule="' + esc(c.assignmentId) + '">' + esc(t('reschedule_btn')) + '</button>' +
          '</div>'
        : '') +
      '</div>';
  }).join('');
  return '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + ICON('warning_banner') + ' ' + esc(t('scheduling_conflicts_title')) + '</div></div><div class="card-body">' + rows + '</div></div>';
}

/* ---------------- Inspections & Checklists ---------------- */
// Scheduling is a Project Manager (or SystemAdmin) action; recording results is the assigned
// Inspector's (or SystemAdmin's) alone. Hiding what a viewer can't actually use avoids the
// "click it, get told Not permitted" dead end — e.g. a GAAdmin/EMCManager browsing this tab
// would otherwise see every inspection's Record results button even though none are theirs.
// RBAC pilot (backend/Permissions.gs): the role-list half of each check is admin-configurable
// (Settings > Permissions > Inspections); the ownership half ("is this MY inspection") isn't a
// permission and stays a plain condition, same reasoning as Places.gs's org-ownership check.
function canScheduleInspection_() { return hasPermission('inspection.manage'); }
function canRecordInspection_(r) {
  return hasPermission('inspection.recordResults') &&
    (HululState.user.role === 'SystemAdmin' || r.inspectorId === HululState.user.id);
}

// A discipline+inspector assignment (Disciplines & Inspectors tab) is only fully "covered" here
// once every phase that discipline ACTUALLY HAS catalogue checklist items for has an inspection
// scheduled -- e.g. if Health & Safety only ever has Opening-phase items (see Checklist Items),
// it should never show an "Operational not yet scheduled" gap, since there'd be nothing to inspect
// against. Which phases are relevant per discipline is read from the same checklistItems catalogue
// Inspections.gs's own inspectionScopeItems_ matches against (category === discipline name), so this
// stays in sync with whatever's actually in the catalogue rather than assuming every discipline
// spans both phases. Falls back to checking both phases only if the discipline has no catalogue
// items at all yet (nothing to narrow by). Computed client-side from data already fetched for this
// tab -- no extra backend call beyond the existing listChecklistItems.
var INSPECTION_PHASES_ = ['Opening', 'Operational'];
// Shared by computeInspectionGaps_ below AND the Schedule inspection form's own phase/category
// filtering (BUG: "Operational phase selected but Crowd Safety (an Opening-only category) still
// shows" -- the Category field there was just mirroring whichever Inspector/assignment happened to
// be selected, with nothing narrowing that assignment list by the chosen Phase first). Reads which
// phases a discipline actually has catalogue checklist items for, straight from the same catalogue
// Inspections.gs's inspectionScopeItems_ matches against (category === discipline name) -- so both
// places narrow by phase using the exact same source of truth instead of one drifting from the other.
function checklistItemPhasesByDiscipline_(checklistItems) {
  var phasesByDiscipline = {};
  checklistItems.forEach(function (c) {
    if (!c.category || !c.phase) return;
    (phasesByDiscipline[c.category] = phasesByDiscipline[c.category] || {})[c.phase] = true;
  });
  return phasesByDiscipline;
}
// A discipline with no catalogue items yet at all (not in the map) has nothing to narrow by, so it
// stays selectable for every phase rather than being hidden outright -- same fallback rule
// computeInspectionGaps_ below already used before this was pulled out into its own function.
function disciplinePhaseRelevant_(disciplineName, phase, phasesByDiscipline) {
  var known = phasesByDiscipline[disciplineName];
  return !known || !!known[phase];
}
function computeInspectionGaps_(assignments, inspections, checklistItems) {
  var scheduledKey = {};
  inspections.forEach(function (i) { scheduledKey[i.disciplineId + '|' + i.inspectorId + '|' + i.phase] = true; });
  var phasesByDiscipline = checklistItemPhasesByDiscipline_(checklistItems);
  var gaps = [];
  assignments.forEach(function (a) {
    INSPECTION_PHASES_.forEach(function (phase) {
      if (!disciplinePhaseRelevant_(a.disciplineName, phase, phasesByDiscipline)) return; // no catalogue items for this phase at all
      if (!scheduledKey[a.disciplineId + '|' + a.inspectorId + '|' + phase]) {
        gaps.push({ assignmentId: a.id, disciplineName: a.disciplineName, inspectorName: a.inspectorName, phase: phase });
      }
    });
  });
  return gaps;
}

// Same look/placement as Disciplines & Inspectors' own Coverage gaps card -- shown to every viewer
// (it's just information), "Quick schedule" only for roles that can act on it.
function renderInspectionGapsCard_(gaps, canSchedule) {
  var body = !gaps.length
    ? '<div class="muted" style="font-size:13px;">' + ICON('coverage_complete') + ' ' + esc(t('every_x_scheduled_hint', { inspector: Term('inspector').toLowerCase(), inspection: Term('inspection').toLowerCase(), discipline: Term('discipline').toLowerCase() })) + '</div>'
    : gaps.map(function (g) {
        return '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid #f0f1f6;font-size:13px;">' +
          '<div><strong>' + esc(g.disciplineName) + '</strong> · ' + esc(g.inspectorName) + ' <span class="muted">— ' + esc(g.phase) + esc(t('not_yet_scheduled_suffix')) + '</span></div>' +
          (canSchedule ? '<button class="btn btn-secondary btn-sm" data-qs-assignment="' + esc(g.assignmentId) + '" data-qs-phase="' + esc(g.phase) + '">' + esc(t('quick_schedule_btn')) + '</button>' : '') +
          '</div>';
      }).join('');
  return '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + esc(t('coverage_gaps_title')) + '</div></div><div class="card-body">' + body + '</div></div>';
}

// REQ: "Any inspector who has not been assigned can start on a checklist that has not been assigned
// to anyone as long as he is qualified in that category. Once he picks up an opening sub-checklist it
// becomes unavailable to other inspectors unless cancelled by the inspector." Shown to every viewer
// (informational, same as renderInspectionGapsCard_ above it) -- the "Pick up" button itself only
// renders for slots the CALLING user is actually qualified for (slot.qualified, computed server-side
// by listOpenInspectionSlots against their own Inspector Qualifications profile) and can act at all
// (hasPermission('inspection.recordResults')).
function renderOpenChecklistsCard_(openSlots, canClaim) {
  var body = !openSlots.length
    ? '<div class="muted" style="font-size:13px;">' + esc(t('no_open_checklists_hint')) + '</div>'
    : openSlots.map(function (s) {
        // REQ correction: "inspectors can now pick up one open checklist sub-category" -- a slot is
        // now (discipline, phase, checklistType), not the whole discipline+phase, so the sub-category
        // is shown alongside discipline/phase and carried on the Pick up button.
        return '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid #f0f1f6;font-size:13px;">' +
          '<div><strong>' + esc(s.disciplineName) + '</strong> <span class="muted">— ' + esc(s.phase) + ' · ' + esc(s.checklistType) + '</span></div>' +
          (canClaim && s.qualified
            ? '<button class="btn btn-primary btn-sm" data-pickup-discipline="' + esc(s.disciplineId) + '" data-pickup-phase="' + esc(s.phase) + '" data-pickup-checklist-type="' + esc(s.checklistType) + '">' + esc(t('pick_up_btn')) + '</button>'
            : (canClaim ? '<span class="muted" style="font-size:11.5px;">' + esc(t('not_qualified_hint')) + '</span>' : '')) +
          '</div>';
      }).join('');
  return '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + esc(t('open_checklists_title')) + '</div></div><div class="card-body">' + body + '</div></div>';
}

async function tabInspections(content, eventId, detail) {
  destroyLiveInspectionMap_(); // in case a previous "choose participant" visit left a GPS watch/map running
  // Flush any evidence photos saved locally during a dead connection (a prior visit, or even a
  // prior session -- see EvidenceCapture in evidence.js) the moment there's a chance to upload
  // them, without waiting for the user to notice and retry manually.
  if (window.EvidenceCapture) {
    EvidenceCapture.retryPending(eventId).then(function (n) {
      if (n) UI.toast(n + ' evidence file(s) saved earlier finished uploading', 'success');
    });
  }
  var canSchedule = canScheduleInspection_();
  var canClaim = hasPermission('inspection.recordResults');
  var [inspections, assignments, checklistItems, openSlots] = await Promise.all([
    Api.call('listInspections', { eventId: eventId }),
    Api.call('listInspectorAssignments', { eventId: eventId }),
    Api.call('listChecklistItems', {}),
    Api.call('listOpenInspectionSlots', { eventId: eventId }).catch(function () { return []; })
  ]);
  var inspectorAssignCount = {};
  assignments.forEach(function (a) { inspectorAssignCount[a.inspectorId] = (inspectorAssignCount[a.inspectorId] || 0) + 1; });
  var assignOptions = assignments.map(function (a) {
    var label = a.inspectorName + (inspectorAssignCount[a.inspectorId] > 1 ? ' (' + a.disciplineName + ')' : '');
    return '<option value="' + a.id + '" data-discipline="' + esc(a.disciplineName) + '">' + esc(label) + '</option>';
  }).join('');
  var eventStart = detail && detail.event ? detail.event.startDateTime : '';
  var gaps = computeInspectionGaps_(assignments, inspections, checklistItems);

  // Field order per REQ: Phase, Inspector, Discipline, Scheduled at. Checklist type is gone — by
  // default every checklist type under the discipline is the inspector's own call to work through
  // (see Record results below); nothing not yet done is ever hidden. The "Scheduled at" field also
  // gets a small assistant: type a number of hours and pick Before/After the event's own start date
  // and the date/time input fills itself in, instead of the PM having to compute and type it by hand.
  content.innerHTML =
    (canSchedule
      ? '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + esc(t('schedule_x_title', { term: Term('inspection').toLowerCase() })) + '</div></div>' +
        '<div class="card-body form-row">' +
          UI.field(t('field_phase'), '<select id="fInsPhase" class="field-input"><option>Opening</option><option>Operational</option></select>') +
          UI.field(Term('inspector'), '<select id="fInsAssignment" class="field-input">' + (assignOptions || '<option value="">' + esc(t('no_x_assigned_yet', { term: Term('inspector_plural').toLowerCase() })) + '</option>') + '</select>') +
        '</div><div class="card-body form-row" style="padding-top:0;">' +
          UI.field(Term('discipline'), '<input id="fInsDisc" class="field-input" readonly />') +
          UI.field(t('field_scheduled_at'),
            '<input id="fInsWhen" type="datetime-local" class="field-input" />' +
            (eventStart
              ? '<div style="display:flex;align-items:center;gap:6px;margin-top:6px;">' +
                  '<input id="fInsOffsetHours" type="number" min="0" step="0.5" placeholder="Hours" class="field-input" style="width:78px;padding:6px 8px;font-size:12.5px;" />' +
                  '<div class="toggle-pair" id="fInsOffsetDir">' +
                    '<button type="button" class="toggle-pair-btn active" data-dir="before">' + esc(t('toggle_before_start')) + '</button>' +
                    '<button type="button" class="toggle-pair-btn" data-dir="after">' + esc(t('toggle_after_start')) + '</button>' +
                  '</div>' +
                '</div>' +
                '<div class="muted" style="font-size:10.5px;margin-top:3px;">' + esc(t('hours_relative_hint', { event: Term('event').toLowerCase(), date: UI.fmtDate(eventStart) })) + '</div>'
              : '')
          ) +
        '</div><div class="card-body" style="padding-top:0;">' +
          '<button class="btn btn-primary btn-sm" id="scheduleBtn"' + (assignments.length ? '' : ' disabled') + '>' + esc(t('schedule_btn')) + '</button></div></div>'
      : '') +
    renderInspectionGapsCard_(gaps, canSchedule) +
    renderOpenChecklistsCard_(openSlots, canClaim) +
    '<div class="card"><div class="card-header"><div class="card-title">' + esc(Term('inspection_plural')) + '</div></div><div class="card-body">' +
    UI.table([
      // REQ correction: "inspectors can now pick up one open checklist sub-category" -- a self-claimed
      // pickup (assignedVia === 'self') now covers just one checklistType instead of the whole
      // discipline, so its sub-category is shown alongside the discipline name to distinguish it from
      // a PM-scheduled row (checklistType blank, covers everything) for the same discipline+phase.
      { key: 'disciplineName', label: Term('discipline'), render: r => esc(r.disciplineName) + (r.checklistType ? ' <span class="muted" style="font-size:11px;">— ' + esc(r.checklistType) + '</span>' : '') },
      { key: 'phase', label: t('col_phase') },
      { key: 'inspectorName', label: Term('inspector') },
      { key: 'scheduledAt', label: t('col_when'), render: r => UI.fmtDate(r.scheduledAt) },
      // REQ: "Opening checklists are done against the venue not participants." coverage.mode
      // (Inspections.gs's inspectionCoverage_) distinguishes an Opening-phase checklist (venue-wide,
      // no participant dimension -- shows real item counts via coverage.items) from an Operational
      // one (unchanged -- X of Y participants done).
      { key: 'progress', label: t('col_progress'), render: r => {
          if (!r.coverage) return '—';
          if (r.coverage.mode === 'venue') {
            var items = r.coverage.items || { done: 0, total: 0 };
            return t('progress_fraction', { done: items.done, total: items.total, term: t('word_items') });
          }
          return t('progress_fraction', { done: r.coverage.done, total: r.coverage.total, term: Term('participant_plural').toLowerCase() });
        } },
      { key: 'status', label: t('status'), render: r => UI.statusBadge(r.status) },
      { key: 'actions', label: t('actions'), render: r => {
          // Edit/Delete are only offered while the inspection is still 'Scheduled' -- once results
          // have been recorded against it, the backend itself refuses both (see updateInspection /
          // deleteInspection in Inspections.gs), so hiding them here avoids a round-trip just to
          // show that error.
          var btns = '';
          if (canSchedule && r.status === 'Scheduled') {
            btns += '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('action_edit')) + '" data-edit-inspection="' + r.id + '">' + ICON('edit') + '</button> ' +
              '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('action_delete')) + '" data-delete-inspection="' + r.id + '">' + ICON('delete') + '</button> ';
          }
          // REQ: "unless cancelled by the inspector" -- only the Inspector who picked THIS specific
          // checklist up themselves (assignedVia === 'self', cancelSelfAssignedInspection's own gate)
          // gets this button; a PM-scheduled visit (even one assigned to this same inspector) never
          // shows it -- that one's Edit/Delete pair above is the only way to remove it, PM/SysAdmin only.
          if (r.assignedVia === 'self' && r.inspectorId === HululState.user.id && r.status === 'Scheduled') {
            btns += '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('cancel_pickup_btn')) + '" data-cancel-pickup="' + r.id + '">' + ICON('delete') + '</button> ';
          }
          if (canRecordInspection_(r) && r.status !== 'Completed') {
            btns += new Date(r.scheduledAt) > new Date()
              ? '<span class="muted" style="font-size:11.5px;">' + esc(t('not_due_yet')) + '</span>'
              : '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('title_record_results')) + '" data-record="' + r.id + '">' + ICON('record_results') + '</button>';
          }
          return btns ? UI.actionsCell(btns) : '—';
        } }
    ], inspections, {}) + '</div></div>';

  if (canSchedule) {
    var assignSelect = document.getElementById('fInsAssignment');
    var discField = document.getElementById('fInsDisc');
    var phaseSelect = document.getElementById('fInsPhase');
    var whenInput = document.getElementById('fInsWhen');

    var syncFromAssignment = function () {
      var opt = assignSelect.options[assignSelect.selectedIndex];
      discField.value = opt ? (opt.getAttribute('data-discipline') || '') : '';
    };
    assignSelect.onchange = syncFromAssignment;

    // BUG FIX: "Operational phase selected but Crowd Safety (an Opening-only category) still shows
    // in Category" -- the readonly Category field above just mirrors whichever Inspector/assignment
    // option happens to be selected, and nothing was narrowing that option list by the chosen Phase
    // first, so a category with zero catalogue items for the selected phase could still get scheduled
    // against it (nothing to actually inspect). Hides every assignment option whose discipline has no
    // catalogue items for the current Phase (checklistItemPhasesByDiscipline_/disciplinePhaseRelevant_,
    // shared with the Coverage gaps card's own phase-narrowing above), and re-picks the first still-
    // visible option if the previously-selected one just got hidden -- same "there'd be nothing to
    // inspect against" reasoning computeInspectionGaps_ already uses.
    var phasesByDiscipline = checklistItemPhasesByDiscipline_(checklistItems);
    var refreshAssignmentOptionsForPhase_ = function () {
      var phase = phaseSelect.value;
      var previousValue = assignSelect.value;
      var firstVisibleValue = '';
      Array.prototype.forEach.call(assignSelect.options, function (opt) {
        if (!opt.value) return; // the "no inspectors assigned yet" placeholder option
        var relevant = disciplinePhaseRelevant_(opt.getAttribute('data-discipline') || '', phase, phasesByDiscipline);
        opt.hidden = !relevant;
        opt.disabled = !relevant;
        if (relevant && !firstVisibleValue) firstVisibleValue = opt.value;
      });
      if (assignSelect.options[assignSelect.selectedIndex] && assignSelect.options[assignSelect.selectedIndex].disabled) {
        assignSelect.value = firstVisibleValue; // '' (nothing valid for this phase) is a legitimate outcome too
      } else if (assignSelect.value !== previousValue) {
        assignSelect.value = previousValue;
      }
    };
    phaseSelect.onchange = function () { refreshAssignmentOptionsForPhase_(); syncFromAssignment(); };
    if (assignments.length) { refreshAssignmentOptionsForPhase_(); syncFromAssignment(); }

    // Hours-before/after-start assistant -- only rendered when the event has a known start date.
    var offsetHoursInput = document.getElementById('fInsOffsetHours');
    if (offsetHoursInput) {
      var offsetDirWrap = document.getElementById('fInsOffsetDir');
      var offsetDir = 'before';
      var applyOffset_ = function () {
        var hours = parseFloat(offsetHoursInput.value);
        if (isNaN(hours) || hours < 0) return;
        var base = new Date(eventStart).getTime();
        if (isNaN(base)) return;
        var deltaMs = hours * 60 * 60 * 1000;
        var target = new Date(offsetDir === 'before' ? base - deltaMs : base + deltaMs);
        var pad = function (n) { return String(n).padStart(2, '0'); };
        whenInput.value = target.getFullYear() + '-' + pad(target.getMonth() + 1) + '-' + pad(target.getDate()) +
          'T' + pad(target.getHours()) + ':' + pad(target.getMinutes());
      };
      offsetHoursInput.oninput = applyOffset_;
      offsetDirWrap.querySelectorAll('.toggle-pair-btn').forEach(function (btn) {
        btn.onclick = function () {
          offsetDirWrap.querySelectorAll('.toggle-pair-btn').forEach(function (b) { b.classList.remove('active'); });
          btn.classList.add('active');
          offsetDir = btn.getAttribute('data-dir');
          applyOffset_();
        };
      });
    }

    document.getElementById('scheduleBtn').onclick = async function () {
      var assignment = assignments.filter(a => a.id === assignSelect.value)[0];
      if (!assignment) { UI.toast(t('toast_select_assigned_x_first', { term: Term('inspector').toLowerCase() }), 'error'); return; }
      try {
        await Api.call('scheduleInspection', {
          eventId: eventId, disciplineId: assignment.disciplineId, inspectorId: assignment.inspectorId,
          phase: phaseSelect.value,
          scheduledAt: whenInput.value
        });
        UI.toast(t('x_scheduled_toast', { term: Term('inspection') }), 'success'); Router.resolve();
      } catch (err) { UI.error(err); }
    };

    // Coverage-gap "Quick schedule" chips pre-fill Inspector/Discipline/Phase above so the PM only
    // has to pick a time (or use the hours assistant) and hit Schedule.
    content.querySelectorAll('[data-qs-assignment]').forEach(function (btn) {
      btn.onclick = function () {
        // Phase first, then re-filter the assignment list for it, THEN select the assignment --
        // otherwise refreshAssignmentOptionsForPhase_ (still on the old Phase at that point) could
        // hide the very option this chip is about to select.
        phaseSelect.value = btn.getAttribute('data-qs-phase');
        refreshAssignmentOptionsForPhase_();
        assignSelect.value = btn.getAttribute('data-qs-assignment');
        syncFromAssignment();
        document.getElementById('scheduleBtn').scrollIntoView({ behavior: 'smooth', block: 'center' });
      };
    });
  }

  content.querySelectorAll('[data-record]').forEach(btn => {
    var inspection = inspections.filter(i => i.id === btn.getAttribute('data-record'))[0];
    // REQ: "Opening checklists are done against the venue not participants." An Opening-phase
    // inspection skips the whole choose-a-participant screen (openChooseParticipantScreen_ below --
    // that map/list is built entirely around picking one relevant Participant, which doesn't apply
    // here) and jumps straight into the results form with participant=null; every other phase
    // (Operational) keeps the original flow unchanged.
    btn.onclick = () => inspection.phase === 'Opening'
      ? openRecordResultsModal(eventId, inspection, null)
      : openChooseParticipantScreen_(content, eventId, inspection, detail && detail.venue);
  });

  content.querySelectorAll('[data-edit-inspection]').forEach(btn => {
    var inspection = inspections.filter(i => i.id === btn.getAttribute('data-edit-inspection'))[0];
    btn.onclick = () => openEditInspectionModal_(eventId, inspection, assignments, assignOptions, checklistItems);
  });

  content.querySelectorAll('[data-delete-inspection]').forEach(btn => {
    var inspection = inspections.filter(i => i.id === btn.getAttribute('data-delete-inspection'))[0];
    btn.onclick = () => UI.confirmModal(
      t('delete_x_with_detail_confirm', { term: Term('inspection').toLowerCase(), detail: (inspection.disciplineName || '') + ' · ' + inspection.phase }),
      async () => {
        try {
          await Api.call('deleteInspection', { eventId: eventId, inspectionId: inspection.id });
          UI.toast(t('x_deleted', { term: Term('inspection') }), 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      },
      { confirmLabel: t('delete') }
    );
  });

  // REQ: self-service open checklist pickup -- "Pick up" claims the (discipline, phase, checklistType)
  // sub-category slot as the current Inspector's own; the button's own app-wide click-guard (ui.js)
  // already stops a double-click from firing this twice.
  content.querySelectorAll('[data-pickup-discipline]').forEach(btn => {
    btn.onclick = async () => {
      try {
        await Api.call('claimOpenInspectionSlot', {
          eventId: eventId, disciplineId: btn.getAttribute('data-pickup-discipline'), phase: btn.getAttribute('data-pickup-phase'),
          checklistType: btn.getAttribute('data-pickup-checklist-type')
        });
        UI.toast(t('toast_checklist_picked_up'), 'success'); Router.resolve();
      } catch (err) { UI.error(err); }
    };
  });
  content.querySelectorAll('[data-cancel-pickup]').forEach(btn => {
    btn.onclick = () => UI.confirmModal(t('cancel_pickup_confirm'), async () => {
      try {
        await Api.call('cancelSelfAssignedInspection', { inspectionId: btn.getAttribute('data-cancel-pickup') });
        UI.toast(t('toast_pickup_cancelled'), 'success'); Router.resolve();
      } catch (err) { UI.error(err); }
    }, { confirmLabel: t('delete') });
  });
}

// REQ: "Develop a completed checklists page under Inspections tab." One row per (Inspection,
// participant) pair across the whole event whose checklist is fully recorded (listCompletedChecklists,
// Inspections.gs) -- an Inspection whose own participants are ALL done drops its Record-results action
// from the list above (status flips to 'Completed'), so this is the only way back into one of those.
// Plain UI.table (search/sort/export CSV all come free from it, same as any other list page) rather
// than a bespoke card -- this is a browse/find page, not a workflow like the choose-participant flow
// above.
//
// REQ follow-up: "Clicking on a row opens the full checklist on new page list layout not popup.
// Remove Do column." -- the old Actions ("Do") column's icon button opened openRecordResultsModal;
// that's now a real page (renderCompletedChecklistDetail, routed at #/events/:id/completed-checklist/
// :inspectionId/:participantId, registered in router.js) reusing that same modal flow's item-listing/
// editing/print/export/save logic (recordResultRowHtml_/wireRecordResultRows_/saveInspectionResults_/
// etc.) just rendered into the page instead of a modal box. The entry point moves onto the participant
// name itself (same hyperlink convention as venues.js's/completedChecklists.js's own name columns) --
// same canRecordInspection_ gate as the old button had: plain text (no link) for a row this viewer
// isn't SystemAdmin or the assigned Inspector for, exactly like the button used to just not render.
// REQ follow-up: "Add Tab under Checklist name is score. Add to it template filter to narrow down
// items." -- one flat, read-only table of every Document Review item across every scored document in
// this event (listEventScoringItems, Templates.gs), same "flatten it all, then filter it back down"
// shape as tabCompletedChecklists right below -- except this one needs an actual dropdown (not just
// visual scanning) since an event can have several documents each with their own dozens of items.
// Template name links straight into that document's own scoring form for anyone who wants to actually
// change an answer -- this tab itself is read-only, purely for reviewing everything in one place.
async function tabScoreOverview(content, eventId, detail) {
  var rows = await Api.call('listEventScoringItems', { eventId: eventId });

  // Distinct documents present in `rows`, first-seen order (already the deterministic
  // Templates-then-itemCode order listEventScoringItems emits) -- powers the filter dropdown.
  var seenTemplateIds = {};
  var docs = [];
  rows.forEach(function (r) {
    if (seenTemplateIds[r.templateId]) return;
    seenTemplateIds[r.templateId] = true;
    docs.push({ templateId: r.templateId, templateName: r.templateName, docType: r.docType });
  });

  content.innerHTML =
    '<div class="card"><div class="card-header"><div class="card-title">' + esc(t('tab_score_overview')) + '</div>' +
    '<div class="muted" style="font-size:11.5px;">' + esc(t('score_overview_hint')) + '</div></div>' +
    '<div class="card-body">' +
      '<div style="max-width:280px;margin-bottom:14px;">' + UI.field(Term('template'),
        '<select class="field-input" id="scoreOverviewTemplateFilter">' +
          '<option value="">' + esc(t('all_x', { term: Term('template_plural') })) + '</option>' +
          docs.map(function (d) { return '<option value="' + esc(d.templateId) + '">' + esc(d.templateName) + ' (' + esc(d.docType) + ')</option>'; }).join('') +
        '</select>') +
      '</div>' +
      '<div id="scoreOverviewTableWrap"></div>' +
    '</div></div>';

  var renderTable_ = function (filterTemplateId) {
    var filtered = filterTemplateId ? rows.filter(function (r) { return r.templateId === filterTemplateId; }) : rows;
    document.getElementById('scoreOverviewTableWrap').innerHTML = UI.table([
      { key: 'templateName', label: t('col_template'), render: r =>
          '<a href="#/events/' + esc(eventId) + '/template-scoring/' + esc(r.templateId) + '" style="color:var(--accent);font-weight:600;text-decoration:none;">' + esc(r.templateName) + '</a>' },
      { key: 'sectionCode', label: t('scoring_sections_title'), render: r => esc(r.sectionCode + ' ' + r.sectionName) },
      { key: 'itemCode', label: t('col_item') },
      { key: 'description', label: t('col_description') },
      { key: 'completeness', label: t('col_completeness'), render: r => scoreOverviewCompletenessHtml_(r.completeness) },
      { key: 'quality', label: t('col_quality'), render: r => (r.quality !== '' && r.quality != null) ? (r.quality + ' / 4') : '<span class="muted">—</span>' },
      { key: 'remarks', label: t('field_remarks'), render: r => r.remarks ? esc(r.remarks) : '—' },
      { key: 'detail', label: t('field_detail'), render: r => r.detail ? esc(r.detail) : '—' }
    ], filtered, { emptyText: t('empty_no_scoring_items') });
  };
  renderTable_('');
  document.getElementById('scoreOverviewTemplateFilter').onchange = function (e) { renderTable_(e.target.value); };
}

// Plain colored text (not the icon buttons the scoring form itself uses -- those are inputs, this is
// a read-only table cell) -- same Yes/No/N-A color language as TPL_COMPLETENESS_STATE_CLASS_'s own
// state-ticked/state-crossed/state-na classes elsewhere on this page, just as static text here.
function scoreOverviewCompletenessHtml_(completeness) {
  if (!completeness) return '<span class="muted">—</span>';
  var color = completeness === 'Yes' ? 'var(--success)' : completeness === 'No' ? 'var(--danger)' : 'var(--text-600)';
  return '<span style="color:' + color + ';font-weight:600;">' + esc(t('completeness_' + completeness.toLowerCase().replace('/', ''))) + '</span>';
}

async function tabCompletedChecklists(content, eventId, detail) {
  var rows = await Api.call('listCompletedChecklists', { eventId: eventId });

  content.innerHTML =
    '<div class="card"><div class="card-header"><div class="card-title">' + esc(t('tab_completed_checklists')) + '</div>' +
    '<div class="muted" style="font-size:11.5px;">' + esc(t('completed_checklists_hint')) + '</div></div><div class="card-body">' +
    UI.table([
      { key: 'participantName', label: Term('participant'), render: r =>
          canRecordInspection_({ inspectorId: r.inspectorId })
            ? '<a href="#/events/' + esc(eventId) + '/completed-checklist/' + esc(r.inspectionId) + '/' + esc(r.participantId) + '" style="color:var(--accent);font-weight:600;text-decoration:none;">' + esc(r.participantName) + '</a>'
            : esc(r.participantName)
      },
      { key: 'disciplineName', label: Term('discipline') },
      // REQ follow-up: "Not all sub-categories are applicable ... when Sub-Category of a checklist is
      // completed then it must appear in the Completed Checklist tab." listCompletedChecklists now
      // emits one row per completed sub-category (not one per whole inspection) -- this column is what
      // distinguishes a participant's separate completed rows from each other.
      { key: 'checklistType', label: Term('checklistType') },
      { key: 'phase', label: t('col_phase') },
      { key: 'inspectorName', label: Term('inspector') },
      { key: 'progress', label: t('col_progress'), render: r => t('progress_fraction', { done: r.done, total: r.total, term: Term('checklistItem_plural').toLowerCase() }) },
      { key: 'lastRecordedAt', label: t('col_last_recorded'), render: r => UI.fmtDate(r.lastRecordedAt) }
    ], rows, { emptyText: t('empty_no_completed_checklists') }) + '</div></div>';
}

// REQ follow-up: "Clicking on a row opens the full checklist on new page list layout not popup,"
// then "When clicking on participant hyperlink open view mode." -- read-only by default
// (completedChecklistViewMode_ below), same view/edit-toggle convention this session already
// established for the Venue tab (venues.js's venueViewMode_/renderVenueForm_'s onCancel): a gated
// Edit button swaps the SAME container over to the full editable form (completedChecklistEditMode_)
// in place; Cancel swaps back to view mode locally without saving; Save re-resolves the whole route
// (Router.resolve(), inside saveInspectionResults_, whose own UI.closeModal() is a harmless no-op
// with no modal open) -- landing back on this exact route, which is this view mode again, showing the
// just-saved values.
//
// eventId/inspectionId/participantId only ever come from a route param here (this can be a fresh page
// load, not just an in-app navigation), so inspection/participant are rebuilt the same lightweight
// way tabCompletedChecklists always has -- {id, disciplineName, phase} / {id, name} -- by finding this
// pair inside listCompletedChecklists' own results rather than assuming anything is already in memory.
async function renderCompletedChecklistDetail(params) {
  var root = document.getElementById('viewRoot');
  var eventId = params.id, inspectionId = params.inspectionId, participantId = params.participantId;
  root.innerHTML = '<div class="empty-state">' + t('loading') + '</div>';

  var rows;
  try { rows = await Api.call('listCompletedChecklists', { eventId: eventId }); }
  catch (err) { UI.error(err); root.innerHTML = '<div class="empty-state">' + esc(t('failed_load_tab')) + '</div>'; return; }
  var row = rows.filter(function (r) { return r.inspectionId === inspectionId && r.participantId === participantId; })[0];
  if (!row) { root.innerHTML = '<div class="empty-state">' + esc(t('x_not_found', { term: t('tab_completed_checklists') })) + '</div>'; return; }
  // Same permission gate as the list's own name-link (tabCompletedChecklists above) -- guards a
  // direct/bookmarked URL hit too, not just the link's own visibility. Threaded through as canManage
  // below to gate the Edit button the same way venueViewMode_'s own canManage gates its Edit button.
  var canManage = canRecordInspection_({ inspectorId: row.inspectorId });
  if (!canManage) { root.innerHTML = '<div class="empty-state">' + esc(t('not_permitted_default')) + '</div>'; return; }

  var inspection = { id: row.inspectionId, disciplineName: row.disciplineName, phase: row.phase };
  var participant = { id: row.participantId, name: row.participantName };

  var [items, existingResults] = await Promise.all([
    Api.call('listChecklistItems', {}),
    Api.call('listInspectionResults', { inspectionId: inspection.id, participantId: participant.id })
  ]);
  var existingByItemId = {};
  existingResults.forEach(function (r) {
    var cur = existingByItemId[r.checklistItemId];
    if (!cur || new Date(r.recordedAt) > new Date(cur.recordedAt)) existingByItemId[r.checklistItemId] = r;
  });
  var scope = items.filter(function (i) { return i.status !== 'Deleted' && i.category === inspection.disciplineName && i.phase === inspection.phase; });

  if (!scope.length) {
    root.innerHTML =
      '<div class="page-header"><div><div class="page-title">' + esc(participant.name) + '</div></div>' +
      '<button class="btn btn-secondary" id="backCompletedChecklistBtn">' + ICON('back') + ' ' + esc(t('back')) + '</button></div>' +
      '<div class="empty-state">' + esc(t('no_x_setup_for_discipline_phase', { term: Term('checklistItem_plural').toLowerCase(), discipline: Term('discipline').toLowerCase() })) + '</div>';
    document.getElementById('backCompletedChecklistBtn').onclick = function () { window.location.hash = '#/events/' + eventId + '?tab=completedChecklists'; };
    return;
  }

  var byType = {};
  scope.forEach(function (it) { (byType[it.checklistType] = byType[it.checklistType] || []).push(it); });

  // REQ follow-up: "the checklist item must be linked to the checklist the user completed not to the
  // main Checklist page." Findings tab's checklist-item link (tabFindings below) now points here with
  // ?itemId=... instead of the admin Checklist Items catalog -- scroll to + highlight that exact row.
  completedChecklistViewMode_(root, eventId, inspection, participant, scope, byType, existingByItemId, canManage, params.itemId);
}

// Read-only rows: description, state, risk/window, and (Crossed only) notes + evidence -- no inputs,
// nothing to wire beyond the Back/Edit buttons below. REQ follow-up: "instead of showing '[Evidence 1]
// (url)' ... show a thumbnail ... when clicked enlarge." Evidence renders as real image thumbnails
// (same .evidence-thumb + lightbox pattern used everywhere else, findings.js's delegated click
// handler) instead of plain text links -- every url here becomes its own sibling .evidence-thumb
// element, so that handler's sibling-DOM-scan gallery strategy already gives Prev/Next between them
// with no extra wiring needed on this page.
function completedChecklistViewRowHtml_(it, existing, eventId) {
  var state = existing ? existing.state : '';
  var stateIcon = state === 'Ticked' ? ICON('result_ticked') : state === 'Crossed' ? ICON('result_crossed') : state === 'N/A' ? ICON('result_na') : '';
  var stateLabel = state === 'Ticked' ? t('title_result_ticked') : state === 'Crossed' ? t('title_result_crossed') : state === 'N/A' ? t('title_result_na') : t('word_pending');
  var evidenceUrls = (existing && existing.evidenceUrls) ? String(existing.evidenceUrls).split(',').filter(Boolean) : [];
  // REQ follow-up: "the checklist item must be linked to the checklist the user completed not to the
  // main Checklist page." data-row-id is the deep-link/highlight hook (completedChecklistViewMode_
  // below), same generic convention UI.table() rows already carry and checklistItems.js's own
  // deep-link already uses.
  return '<div data-row-id="' + esc(it.id) + '" style="border-bottom:1px solid #f0f1f6;padding:10px 0;">' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">' +
      '<div style="flex:1 1 260px;">' +
        '<div style="font-weight:600;font-size:13px;">' + esc(it.description) + '</div>' +
        '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:6px;font-size:11px;" class="muted">' +
          '<span>' + esc(t('col_risk_level')) + ': ' + esc(existing && existing.riskLevel ? t('risk_' + existing.riskLevel.toLowerCase()) : '—') + '</span>' +
          '<span>' + esc(t('field_window_hours')) + ': ' + esc((existing && existing.resolutionWindowHours != null && existing.resolutionWindowHours !== '') ? existing.resolutionWindowHours : '—') + '</span>' +
          (existing ? '<span>' + esc(t('recorded_on_label', { date: UI.fmtDate(existing.recordedAt) })) + '</span>' : '') +
        '</div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:6px;flex:none;font-size:12px;font-weight:600;">' + stateIcon + ' ' + esc(stateLabel) + '</div>' +
    '</div>' +
    (state === 'Crossed'
      ? '<div style="margin-top:8px;padding:10px;background:#fff7f0;border-radius:8px;font-size:12.5px;">' +
          ((existing && existing.notes) ? '<div><span class="muted">' + esc(t('field_notes_found')) + ':</span> ' + esc(existing.notes) + '</div>' : '') +
          (evidenceUrls.length ? '<div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;">' + evidenceUrls.map(function (url, idx) {
            var thumb = driveEvidenceThumbUrl_(url) || '';
            var full = driveEvidenceThumbUrl_(url, 1600) || url;
            return '<a href="' + esc(url) + '" target="_blank" rel="noopener" title="' + esc(t('click_to_expand')) + '" ' +
              'class="evidence-thumb" data-lightbox-url="' + esc(full) + '" style="width:52px;height:52px;">' +
              (thumb ? '<img src="' + esc(thumb) + '" class="evidence-thumb-img" alt="' + esc(t('word_evidence')) + ' ' + (idx + 1) + '" />' : ICON('capture_photo')) + '</a>';
          }).join('') + '</div>' : '') +
          // REQ (checklist<->finding traceability): a Crossed result records a Finding via
          // recordInspectionResults (Inspections.gs), which stamps InspectionResults.findingId right
          // after the insert -- link straight to it instead of making someone hunt for it on the
          // Findings tab.
          ((existing && existing.findingId)
            ? '<div style="margin-top:6px;"><a href="#/events/' + esc(eventId) + '/findings/' + esc(existing.findingId) + '" style="color:var(--accent);font-weight:600;text-decoration:none;font-size:11.5px;">' + esc(t('view_finding_link')) + '</a></div>'
            : '') +
        '</div>'
      : '') +
  '</div>';
}

function completedChecklistViewMode_(root, eventId, inspection, participant, scope, byType, existingByItemId, canManage, highlightItemId) {
  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + esc(participant.name) + '</div>' +
    '<div class="page-subtitle">' + esc(inspection.disciplineName) + ' · ' + esc(inspection.phase) + '</div></div>' +
    '<button class="btn btn-secondary" id="backCompletedChecklistBtn">' + ICON('back') + ' ' + esc(t('back')) + '</button></div>' +
    '<div class="card">' +
      '<div class="card-body">' +
        Object.keys(byType).sort().map(function (typeName) {
          return '<div style="font-weight:600;font-size:12.5px;color:var(--accent);margin:10px 0 4px;">' + esc(typeName || '(untyped)') + '</div>' +
            byType[typeName].map(function (it) { return completedChecklistViewRowHtml_(it, existingByItemId[it.id], eventId); }).join('');
        }).join('') +
      '</div>' +
      (canManage
        ? '<div style="display:flex;justify-content:flex-end;gap:8px;padding:14px 20px;border-top:1px solid var(--border);">' +
            '<button class="btn btn-primary" id="editChecklistBtn">' + ICON('edit') + ' ' + esc(t('action_edit')) + '</button>' +
          '</div>'
        : '') +
    '</div>';

  // REQ follow-up: deep-link + highlight, same one-shot scroll pattern checklistItems.js's own
  // itemId deep-link already uses (.ci-row-highlight is the generic reusable highlight class).
  if (highlightItemId) {
    var targetRow = root.querySelector('[data-row-id="' + esc(highlightItemId) + '"]');
    if (targetRow) {
      targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
      targetRow.classList.add('ci-row-highlight');
      setTimeout(function () { targetRow.classList.remove('ci-row-highlight'); }, 2500);
    }
  }

  document.getElementById('backCompletedChecklistBtn').onclick = function () { window.location.hash = '#/events/' + eventId + '?tab=completedChecklists'; };
  if (canManage) {
    document.getElementById('editChecklistBtn').onclick = function () {
      completedChecklistEditMode_(root, eventId, inspection, participant, scope, byType, existingByItemId, function () {
        completedChecklistViewMode_(root, eventId, inspection, participant, scope, byType, existingByItemId, canManage);
      });
    };
  }
}

// The full editable form -- same recordResultRowHtml_/wireRecordResultRows_/
// updateRecordResultsProgress_/saveInspectionResults_/printInspectionResults_/
// exportInspectionResultsCsv_ the old modal flow (openRecordResultsForm_ above) already used, just
// rendered into the page instead of a modal box, with a Cancel button (onCancel, from
// completedChecklistViewMode_) added since there's no "close the modal" affordance to fall back on
// here. Skips the modal flow's own "choose a checklist type first" step (openChecklistTypeStep_) --
// this is "the full checklist," so every type is shown together rather than asking which slice to
// look at first.
function completedChecklistEditMode_(root, eventId, inspection, participant, scope, byType, existingByItemId, onCancel) {
  var pendingFiles = {};
  scope.forEach(function (it) {
    var existing = existingByItemId[it.id];
    // Pre-seed already-saved evidence as "done" entries, same as openRecordResultsForm_ above -- so
    // editing a Crossed item never looks like it lost its evidence.
    pendingFiles[it.id] = (existing && existing.evidenceUrls) ? String(existing.evidenceUrls).split(',').filter(Boolean).map(function (url, idx) {
      return { name: t('word_evidence') + ' ' + (idx + 1), status: 'done', pct: 100, url: url, localId: 'existing_' + it.id + '_' + idx };
    }) : [];
  });

  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + esc(participant.name) + '</div>' +
    '<div class="page-subtitle">' + esc(inspection.disciplineName) + ' · ' + esc(inspection.phase) + '</div></div>' +
    '<button class="btn btn-secondary" id="backCompletedChecklistBtn">' + ICON('back') + ' ' + esc(t('back')) + '</button></div>' +
    '<div class="card">' +
      '<div class="card-body">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">' +
          '<div id="recordResultsProgress" style="font-weight:600;font-size:12.5px;color:var(--accent);"></div>' +
          '<div class="muted" style="font-size:11px;">' + esc(t('unset_items_stay_open_hint')) + '</div>' +
        '</div>' +
        Object.keys(byType).sort().map(function (typeName) {
          return '<div style="font-weight:600;font-size:12.5px;color:var(--accent);margin:10px 0 4px;">' + esc(typeName || '(untyped)') + '</div>' +
            byType[typeName].map(function (it) { return recordResultRowHtml_(it, existingByItemId[it.id]); }).join('');
        }).join('') +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;padding:14px 20px;border-top:1px solid var(--border);flex-wrap:wrap;">' +
        '<button class="btn btn-secondary" id="printChecklistBtn">' + ICON('print') + ' ' + esc(t('print_btn')) + '</button>' +
        '<button class="btn btn-secondary" id="exportChecklistBtn">' + ICON('export_csv') + ' ' + esc(t('export_csv')) + '</button>' +
        '<button class="btn btn-secondary" id="cancelChecklistBtn">' + esc(t('cancel')) + '</button>' +
        '<button class="btn btn-primary" id="saveChecklistBtn">' + esc(t('save')) + '</button>' +
      '</div>' +
    '</div>';

  document.getElementById('backCompletedChecklistBtn').onclick = function () { window.location.hash = '#/events/' + eventId + '?tab=completedChecklists'; };
  document.getElementById('printChecklistBtn').onclick = function () { printInspectionResults_(participant, inspection, scope); };
  document.getElementById('exportChecklistBtn').onclick = function () { exportInspectionResultsCsv_(participant, inspection, scope); };
  document.getElementById('cancelChecklistBtn').onclick = onCancel;
  document.getElementById('saveChecklistBtn').onclick = function () { saveInspectionResults_(eventId, inspection, participant, scope, pendingFiles, existingByItemId); };

  wireRecordResultRows_(eventId, scope, pendingFiles);
  updateRecordResultsProgress_();
}

// Same field set/order as the Schedule card above (Phase, Inspector, Discipline, Scheduled at) so
// editing feels like the same form -- pre-filled with the inspection's current values. Only ever
// opened for inspections still in 'Scheduled' status (see the actions column render above), which
// the backend also enforces.
function openEditInspectionModal_(eventId, inspection, assignments, assignOptions, checklistItems) {
  var currentAssignment = assignments.filter(function (a) {
    return a.disciplineId === inspection.disciplineId && a.inspectorId === inspection.inspectorId;
  })[0];
  var body =
    '<div class="form-row">' +
      UI.field(t('field_phase'), '<select id="mInsPhase" class="field-input">' +
        '<option' + (inspection.phase === 'Opening' ? ' selected' : '') + '>Opening</option>' +
        '<option' + (inspection.phase === 'Operational' ? ' selected' : '') + '>Operational</option>' +
        '</select>') +
      UI.field(Term('inspector'), '<select id="mInsAssignment" class="field-input">' + assignOptions + '</select>') +
    '</div>' +
    '<div class="form-row">' +
      UI.field(Term('discipline'), '<input id="mInsDisc" class="field-input" readonly />') +
      UI.field(t('field_scheduled_at'), '<input id="mInsWhen" type="datetime-local" class="field-input" value="' + esc(normalizeDateTimeLocal(inspection.scheduledAt)) + '" />') +
    '</div>';
  UI.openModal(t('edit_x', { term: Term('inspection').toLowerCase() }), body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('save'), className: 'btn-primary', onClick: async function () {
        var assignSelect = document.getElementById('mInsAssignment');
        var assignment = assignments.filter(a => a.id === assignSelect.value)[0];
        if (!assignment) { UI.toast(t('toast_select_assigned_x_first', { term: Term('inspector').toLowerCase() }), 'error'); return; }
        var when = document.getElementById('mInsWhen').value;
        if (!when) { UI.toast(t('toast_scheduled_at_required'), 'error'); return; }
        try {
          await Api.call('updateInspection', {
            eventId: eventId, inspectionId: inspection.id,
            disciplineId: assignment.disciplineId, inspectorId: assignment.inspectorId,
            phase: document.getElementById('mInsPhase').value,
            scheduledAt: when
          });
          UI.closeModal(); UI.toast(t('x_updated', { term: Term('inspection') }), 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      } }
  ]);
  var assignSelect = document.getElementById('mInsAssignment');
  var discField = document.getElementById('mInsDisc');
  var phaseSelect = document.getElementById('mInsPhase');
  var sync = function () {
    var opt = assignSelect.options[assignSelect.selectedIndex];
    discField.value = opt ? (opt.getAttribute('data-discipline') || '') : '';
  };
  // Same bug fix as the Schedule card above (checklistItemPhasesByDiscipline_/disciplinePhaseRelevant_):
  // hide assignment options whose discipline has no catalogue items for the currently-selected Phase,
  // so switching Phase in this modal can't leave a phase-irrelevant category sitting in the readonly
  // Category field either.
  var phasesByDiscipline = checklistItemPhasesByDiscipline_(checklistItems || []);
  var refreshForPhase = function () {
    var phase = phaseSelect.value;
    var previousValue = assignSelect.value;
    var firstVisibleValue = '';
    Array.prototype.forEach.call(assignSelect.options, function (opt) {
      if (!opt.value) return;
      var relevant = disciplinePhaseRelevant_(opt.getAttribute('data-discipline') || '', phase, phasesByDiscipline);
      opt.hidden = !relevant;
      opt.disabled = !relevant;
      if (relevant && !firstVisibleValue) firstVisibleValue = opt.value;
    });
    if (assignSelect.options[assignSelect.selectedIndex] && assignSelect.options[assignSelect.selectedIndex].disabled) {
      assignSelect.value = firstVisibleValue;
    } else if (assignSelect.value !== previousValue) {
      assignSelect.value = previousValue;
    }
  };
  if (currentAssignment) assignSelect.value = currentAssignment.id;
  refreshForPhase();
  assignSelect.onchange = sync;
  phaseSelect.onchange = function () { refreshForPhase(); sync(); };
  sync();
}

/* ---------------- Live inspection: choose which participant, then record their checklist ----------------
 * REQ: "when an inspector clicks on action, he must first choose which participant he is
 * inspecting." A full-screen step (not a cramped modal -- the map needs real room, same reasoning
 * as venues.js's New Venue map) replaces the tab content: a locked, GPS-centered map plotting every
 * participant (yellow dot = matches this inspection's discipline + the inspector's zone, green =
 * that participant's checklist is already done, grey = not relevant to this inspection), and a
 * list sorted nearest-first. Without GPS/connectivity, the list falls back to discipline-relevant
 * participants first instead of by distance -- REQ: "He must have both GPS and WiFi turned on
 * while on site" is enforced as far as a browser actually can: location permission + navigator
 * .onLine connectivity (there's no standard way to detect WiFi specifically vs. cellular data).
 */
var liveInspectionMapInstance_ = null;
var liveInspectionMyMarker_ = null;
var liveInspectionMarkers_ = {};
var liveInspectionWatchId_ = null;
var liveInspectionClosestId_ = null;
var liveInspectionLastPingAt_ = 0; // throttle for pingInspectionLocation, see its own call site below
// GOLDEN RULE: "Users locations can never be visible if outside events boundaries." Parsed once per
// visit (openChooseParticipantScreen_) from the event's venue, same parseBoundaryClient_ used
// everywhere else a venue boundary is checked client-side. Read by updateLiveInspectionMyPosition_
// below to hide this device's own live dot the moment it steps outside -- listActiveInspectorLocations
// (Inspections.gs) already enforces this same rule server-side for every OTHER user's view of this
// inspector, but that filter never touched this device's own unconditional-until-now display of its
// own raw GPS fix.
var liveInspectionVenueBoundary_ = null;
// Latest GPS fix from the watch below, { lat, lng } or null -- read by saveInspectionResults_ so a
// Crossed item's finding carries the inspector's actual live position at record time instead of
// only the (blank, for InspectionResults-originated findings) fallback. Cleared on teardown or when
// the fix steps outside the venue boundary, same rule as the live dot itself and findingLocationLastCoords_
// (findings.js's equivalent for the New Finding form).
var liveInspectionLastCoords_ = null;

function stopLiveInspectionWatch_() {
  if (liveInspectionWatchId_ != null && navigator.geolocation) { navigator.geolocation.clearWatch(liveInspectionWatchId_); liveInspectionWatchId_ = null; }
}
function destroyLiveInspectionMap_() {
  stopLiveInspectionWatch_();
  if (liveInspectionMapInstance_) { liveInspectionMapInstance_.remove(); liveInspectionMapInstance_ = null; }
  liveInspectionMyMarker_ = null; liveInspectionMarkers_ = {}; liveInspectionClosestId_ = null; liveInspectionLastPingAt_ = 0;
  liveInspectionVenueBoundary_ = null; liveInspectionLastCoords_ = null;
}

async function openChooseParticipantScreen_(content, eventId, inspection, venue) {
  destroyLiveInspectionMap_();
  liveInspectionVenueBoundary_ = venue ? parseBoundaryClient_(venue.boundary) : null;
  var participants = await Api.call('listInspectionParticipants', { inspectionId: inspection.id });

  content.innerHTML =
    '<div class="page-header" style="margin-bottom:14px;"><div><div class="page-title" style="font-size:17px;">' + esc(t('choose_x_title', { term: Term('participant').toLowerCase() })) + '</div>' +
    '<div class="page-subtitle">' + esc(inspection.disciplineName) + ' · ' + esc(inspection.phase) + ' — ' + esc(t('choose_participant_subtitle_hint', { disc: inspection.disciplineName ? esc(inspection.disciplineName) + ' ' : '' })) + '</div></div>' +
    '<button class="btn btn-secondary btn-sm" id="backToInspectionsBtn">' + ICON('back') + ' ' + esc(t('back')) + '</button></div>' +
    '<div id="liveInspectionBanner"></div>' +
    '<div class="card" style="margin-bottom:16px;"><div class="card-body">' +
      '<div id="liveInspectionMap" style="height:380px;border-radius:var(--radius-sm);border:1px solid var(--border);"></div>' +
    '</div></div>' +
    '<div class="card"><div class="card-header"><div class="card-title">' + esc(Term('participant_plural')) + '</div></div>' +
    '<div class="card-body"><div id="liveInspectionList"></div></div></div>';

  document.getElementById('backToInspectionsBtn').onclick = function () { destroyLiveInspectionMap_(); tabInspections(content, eventId); };

  startLiveInspectionTracking_(content, eventId, inspection, participants);
}

function startLiveInspectionTracking_(content, eventId, inspection, participants) {
  var banner = document.getElementById('liveInspectionBanner');
  var listEl = document.getElementById('liveInspectionList');
  if (!banner || !listEl) return;

  if (!navigator.geolocation || !navigator.onLine) {
    showLiveInspectionFallback_(content, eventId, inspection, participants);
    return;
  }

  banner.innerHTML = '<div class="muted" style="font-size:12px;margin-bottom:10px;">' + ICON('gps_locating') + ' ' + esc(t('getting_location')) + '</div>';
  initLiveInspectionMap_(participants, eventId, inspection);

  stopLiveInspectionWatch_();
  liveInspectionWatchId_ = navigator.geolocation.watchPosition(function (pos) {
    if (!navigator.onLine) { showLiveInspectionFallback_(content, eventId, inspection, participants); return; }
    var freshBanner = document.getElementById('liveInspectionBanner');
    if (freshBanner) freshBanner.innerHTML = '';
    var myLatLng = [pos.coords.latitude, pos.coords.longitude];
    updateLiveInspectionMyPosition_(myLatLng);
    updateClosestParticipantLabel_(participants, myLatLng);
    renderNearestList_(eventId, inspection, participants, myLatLng);
    // REQ: "Inspectors live location as they start inspections. This applies to all maps." --
    // broadcasts this inspector's position to pingInspectionLocation (Inspections.gs) so every other
    // map in the app (UI.startInspectorLocationPolling) can show a live dot for them, not just this
    // device's own use of GPS to find the nearest participant. Throttled to once per 20s -- watchPosition
    // can fire far more often than that, and there's no need to write to the Sheets-backed store on
    // every single tick. Fire-and-forget: a failed ping just means this tick doesn't update other
    // users' maps, never something worth interrupting the inspector's own flow over.
    if (Date.now() - liveInspectionLastPingAt_ >= 20000) {
      liveInspectionLastPingAt_ = Date.now();
      Api.call('pingInspectionLocation', { inspectionId: inspection.id, lat: pos.coords.latitude, lng: pos.coords.longitude }).catch(function () {});
    }
  }, function () {
    showLiveInspectionFallback_(content, eventId, inspection, participants);
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
}

function showLiveInspectionFallback_(content, eventId, inspection, participants) {
  stopLiveInspectionWatch_();
  var banner = document.getElementById('liveInspectionBanner');
  var mapEl = document.getElementById('liveInspectionMap');
  if (!banner) return;
  banner.innerHTML =
    '<div class="card" style="margin-bottom:16px;border-color:var(--warning);"><div class="card-body" style="font-size:12.5px;color:var(--warning);">' +
    ICON('warning_banner') + ' ' + esc(t('location_unavailable_hint', { participant: Term('participant').toLowerCase(), discipline: inspection.disciplineName || Term('discipline').toLowerCase() })) +
    '<div><button class="btn btn-secondary btn-sm" id="retryLocationBtn" style="margin-top:8px;">' + esc(t('try_again_btn')) + '</button></div></div></div>';
  if (mapEl) mapEl.style.display = 'none';
  renderNearestList_(eventId, inspection, participants, null);
  var retryBtn = document.getElementById('retryLocationBtn');
  if (retryBtn) retryBtn.onclick = function () { if (mapEl) mapEl.style.display = ''; startLiveInspectionTracking_(content, eventId, inspection, participants); };
}

// Default Leaflet interactions (drag/scroll/pinch/double-click zoom) are left on, same as every
// other map in the app -- updateLiveInspectionMyPosition_ recenters the view as the inspector
// moves, but the user can still freely pan/zoom in between updates rather than the view being
// completely locked. REQ: clicking a dot opens that participant's Record results modal directly,
// same as clicking their row in the list below.
function initLiveInspectionMap_(participants, eventId, inspection) {
  var el = document.getElementById('liveInspectionMap');
  if (!el) return;
  if (typeof HululLeaflet === 'undefined') {
    el.style.display = 'flex'; el.style.alignItems = 'center'; el.style.justifyContent = 'center';
    el.style.color = 'var(--text-600)'; el.style.fontSize = '12px'; el.style.textAlign = 'center'; el.style.padding = '12px';
    el.textContent = t('map_unavailable_list_ok');
    return;
  }
  setTimeout(function () {
    if (!document.getElementById('liveInspectionMap')) return;
    liveInspectionMapInstance_ = HululLeaflet.map('liveInspectionMap', { preferCanvas: true }).setView(EVENT_MAP_DEFAULT_CENTER_, 16); // see overviewZoneMap's preferCanvas comment
    UI.requireClickToActivateMap(liveInspectionMapInstance_, el);
    hululTileLayer_().addTo(liveInspectionMapInstance_);

    liveInspectionMarkers_ = {};
    participants.forEach(function (p) {
      if (p.lat === '' || p.lat == null || p.lng === '' || p.lng == null) return;
      // yellow = relevant (this discipline + inspector's zone) and still pending; green = relevant
      // and done; grey = not relevant to this particular inspection. REQ: "Across all maps any
      // participant with a logged risk turns red dot..." -- UI.placeMarkerIcon overrides all of the
      // above with red + a badge whenever this participant has an open Finding, since that outranks
      // relevance/completion status.
      var color = p.isRelevant ? (p.checklistCompleted ? '#16a34a' : '#eab308') : '#94a3b8';
      var icon = UI.placeMarkerIcon(color, p.openFindingsCount);
      var marker = HululLeaflet.marker([Number(p.lat), Number(p.lng)], { icon: icon }).addTo(liveInspectionMapInstance_);
      marker.bindTooltip(esc(p.name), { direction: 'top', offset: [0, -10], className: 'place-marker-tooltip' });
      marker.on('click', function () { openRecordResultsModal(eventId, inspection, p); });
      liveInspectionMarkers_[p.id] = marker;
    });
    setTimeout(function () { if (liveInspectionMapInstance_) liveInspectionMapInstance_.invalidateSize(); }, 150);
  }, 0);
}

// REQ: the map itself shows the name of whichever participant is currently closest to the
// inspector's live position -- forces that one marker's tooltip open (closing the previous
// closest's) instead of leaving every label hover-only, so the answer to "who's nearest" is visible
// on the map at a glance without having to read the sorted list below.
function updateClosestParticipantLabel_(participants, myLatLng) {
  if (!myLatLng) return;
  var nearest = null, nearestDist = Infinity;
  participants.forEach(function (p) {
    if (p.lat === '' || p.lat == null || p.lng === '' || p.lng == null) return;
    var d = haversineKm_(myLatLng[0], myLatLng[1], Number(p.lat), Number(p.lng));
    if (d < nearestDist) { nearestDist = d; nearest = p; }
  });
  var nearestId = nearest ? nearest.id : null;
  if (liveInspectionClosestId_ && liveInspectionClosestId_ !== nearestId) {
    var prevMarker = liveInspectionMarkers_[liveInspectionClosestId_];
    if (prevMarker) prevMarker.closeTooltip();
  }
  if (nearestId) {
    var marker = liveInspectionMarkers_[nearestId];
    if (marker) marker.openTooltip();
  }
  liveInspectionClosestId_ = nearestId;
}

// REQ: "His position is always centred to the middle of the map as he moves" -- setView (not
// flyTo) on every GPS tick, so the inspector's own dot stays pinned to the middle rather than the
// map panning to follow it.
//
// GOLDEN RULE: "Users locations can never be visible if outside events boundaries." Checked here,
// client-side, against liveInspectionVenueBoundary_ (parsed in openChooseParticipantScreen_) --
// pingInspectionLocation/listActiveInspectorLocations remain the authoritative server-side gate for
// what every OTHER user sees; this only covers this device's own unconditional display of its own
// raw GPS fix, which never went through that filter at all.
function updateLiveInspectionMyPosition_(latlng) {
  if (!liveInspectionMapInstance_) return;
  var banner = document.getElementById('liveInspectionBanner');
  if (liveInspectionVenueBoundary_ && !pointInPolygonClient_(latlng[0], latlng[1], liveInspectionVenueBoundary_)) {
    if (liveInspectionMyMarker_) { liveInspectionMapInstance_.removeLayer(liveInspectionMyMarker_); liveInspectionMyMarker_ = null; }
    liveInspectionLastCoords_ = null; // outside the venue boundary -- don't attach this fix to a recorded result either
    if (banner) banner.innerHTML = '<div class="muted" style="font-size:12px;">' + ICON('warning_banner') + ' ' + esc(t('outside_boundary_hint')) + '</div>';
    return;
  }
  liveInspectionLastCoords_ = { lat: latlng[0], lng: latlng[1] };
  if (!liveInspectionMyMarker_) {
    var icon = HululLeaflet.divIcon({
      className: 'my-location-icon', iconSize: [18, 18], iconAnchor: [9, 9], html: '<div class="my-location-dot"></div>'
    });
    liveInspectionMyMarker_ = HululLeaflet.marker(latlng, { icon: icon, zIndexOffset: 1000 }).addTo(liveInspectionMapInstance_);
  } else {
    liveInspectionMyMarker_.setLatLng(latlng);
  }
  liveInspectionMapInstance_.setView(latlng, liveInspectionMapInstance_.getZoom(), { animate: false });
}

// Nearest-first when we have a GPS fix (haversineKm_ is venues.js's helper -- loaded before this
// runs, since it's only called after the page has fully booted); relevant-discipline-first
// otherwise. Clicking a row opens the checklist for that one participant.
function renderNearestList_(eventId, inspection, participants, myLatLng) {
  var listEl = document.getElementById('liveInspectionList');
  if (!listEl) return;
  var withDist = participants.map(function (p) {
    var hasCoords = p.lat !== '' && p.lat != null && p.lng !== '' && p.lng != null;
    var dist = (myLatLng && hasCoords) ? haversineKm_(myLatLng[0], myLatLng[1], Number(p.lat), Number(p.lng)) : null;
    return { p: p, dist: dist };
  });
  withDist.sort(function (a, b) {
    if (myLatLng) {
      if (a.dist == null && b.dist == null) return 0;
      if (a.dist == null) return 1;
      if (b.dist == null) return -1;
      return a.dist - b.dist;
    }
    if (a.p.isRelevant !== b.p.isRelevant) return a.p.isRelevant ? -1 : 1;
    return (a.p.name || '').localeCompare(b.p.name || '');
  });
  listEl.innerHTML = withDist.map(function (x) {
    var p = x.p;
    var distText = x.dist != null ? (x.dist < 1 ? Math.round(x.dist * 1000) + ' m' : x.dist.toFixed(1) + ' km') : '—';
    var statusIcon = p.isRelevant ? (p.checklistCompleted ? ICON('checklist_done') + ' ' : ICON('checklist_pending') + ' ') : '';
    return '<div class="participant-nearest-row" data-participant="' + esc(p.id) + '">' +
      '<div><div style="font-size:13.5px;font-weight:600;">' + statusIcon + esc(p.name) + '</div>' +
      '<div class="muted" style="font-size:11.5px;margin-top:2px;">' + esc(p.type) + (p.isRelevant ? ' · ' + p.checklistDone + '/' + p.checklistTotal + ' done' : '') + '</div></div>' +
      '<div class="muted" style="font-size:12px;flex:none;">' + distText + '</div></div>';
  }).join('') || '<div class="empty-state">' + esc(t('no_x_recorded_for_y_yet', { term: Term('participant_plural').toLowerCase(), event: Term('event').toLowerCase() })) + '</div>';

  listEl.querySelectorAll('[data-participant]').forEach(function (row) {
    row.onclick = function () {
      var p = participants.filter(function (pp) { return pp.id === row.getAttribute('data-participant'); })[0];
      if (p) openRecordResultsModal(eventId, inspection, p);
    };
  });
}

// Record results: shows EVERY Checklist item under the inspection's discipline+phase, whether
// already recorded or not -- REQ follow-up: "Currently completed checklists disappear and can not be
// found or edited; this should not be the case." (this used to filter down to open-only items and
// dead-end with an "already fully recorded" message once nothing was left; both are gone now).
// Already-recorded items pre-fill from existingResults (existingByItemId, built below) and stay
// fully editable -- see recordResultRowHtml_/saveInspectionResults_. REQ: the inspector must first
// pick which Checklist type they're reviewing/recording this visit -- a vendor's discipline can span
// several types (e.g. Restaurant vs Food Truck), and one visit might only cover one of them; "All
// checklist types" opens everything in one pass. REQ follow-up: "There are some long checklists ...
// list should be saved and should show progress" -- Save no longer requires every row in view to have
// a pick; any row left blank simply stays open for a later visit (openRecordResultsForm_'s progress
// header, saveInspectionResults_ below).
// Marking an item Crossed requires a Risk Logging: notes, suggested action, and at least one
// photo/video. Evidence uploads start the moment a file is selected (in the background, with its
// own progress bar) rather than waiting for Save.
// REQ: "Opening checklists are done against the venue not participants." `participant` is null for
// an Opening-phase inspection (see the data-record handler above) -- listInspectionResults simply
// omits participantId in that case, which returns every result already recorded for this inspection
// (that endpoint's own filter is opt-in: `if (p.participantId) { ... }`), i.e. exactly the venue-wide
// set this flow needs. recordResultsTitle_ below is the one shared place every downstream title/
// filename falls back to a venue-level label instead of participant.name when participant is null.
function recordResultsTitle_(inspection, participant) {
  return participant ? t('record_results_for_x_title', { name: participant.name }) : t('record_results_for_venue_title');
}
async function openRecordResultsModal(eventId, inspection, participant) {
  var [items, existingResults] = await Promise.all([
    Api.call('listChecklistItems', {}),
    Api.call('listInspectionResults', participant ? { inspectionId: inspection.id, participantId: participant.id } : { inspectionId: inspection.id })
  ]);
  // A checklistItemId can in theory have more than one recorded row (legacy multi-account data from
  // before the shift-account merge, see listInspectionResults' own comment) -- keep the most recent.
  var existingByItemId = {};
  existingResults.forEach(function (r) {
    var cur = existingByItemId[r.checklistItemId];
    if (!cur || new Date(r.recordedAt) > new Date(cur.recordedAt)) existingByItemId[r.checklistItemId] = r;
  });
  var scope = items.filter(function (i) { return i.status !== 'Deleted' && i.category === inspection.disciplineName && i.phase === inspection.phase; });

  if (!scope.length) {
    UI.openModal(t('record_results_title'), '<div class="empty-state">' + esc(t('no_x_setup_for_discipline_phase', { term: Term('checklistItem_plural').toLowerCase(), discipline: Term('discipline').toLowerCase() })) + '</div>',
      [{ label: t('close'), className: 'btn-secondary', onClick: UI.closeModal }]);
    return;
  }

  var byType = {};
  scope.forEach(function (it) { (byType[it.checklistType] = byType[it.checklistType] || []).push(it); });
  var typeNames = Object.keys(byType).sort();

  openChecklistTypeStep_(eventId, inspection, participant, scope, byType, typeNames, existingByItemId);
}

// Step 1: choose which Checklist type this visit covers before seeing any items. Each option shows
// how much of that type is already done, e.g. "Restaurant — 7/12 done", so a long multi-type
// checklist's overall progress is visible before even opening a list.
function openChecklistTypeStep_(eventId, inspection, participant, scope, byType, typeNames, existingByItemId) {
  var ALL_KEY = '__ALL__';
  function doneOf(list) { return list.filter(function (i) { return existingByItemId[i.id]; }).length; }
  var body =
    '<div class="muted" style="font-size:12.5px;margin-bottom:10px;">' + esc(inspection.disciplineName) + ' · ' + esc(inspection.phase) + '</div>' +
    UI.field(Term('checklistType'), '<select id="fRecordType" class="field-input">' +
      typeNames.map(function (name) {
        return '<option value="' + esc(name) + '">' + esc(name || '(untyped)') + esc(t('x_done_of_total_suffix', { done: doneOf(byType[name]), total: byType[name].length })) + '</option>';
      }).join('') +
      (typeNames.length > 1 ? '<option value="' + ALL_KEY + '">' + esc(t('all_checklist_types_option', { term: Term('checklistType_plural').toLowerCase() })) + esc(t('x_done_of_total_suffix', { done: doneOf(scope), total: scope.length })) + '</option>' : '') +
    '</select>') +
    '<div class="muted" style="font-size:11px;margin-top:8px;">' + esc(t('checklist_type_pick_hint')) + '</div>';

  UI.openModal(recordResultsTitle_(inspection, participant), body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('continue_btn'), className: 'btn-primary', onClick: function () {
        var picked = document.getElementById('fRecordType').value;
        var filtered = picked === ALL_KEY ? scope : byType[picked];
        var typeLabel = picked === ALL_KEY ? '' : (picked || '(untyped)');
        openRecordResultsForm_(eventId, inspection, participant, filtered, existingByItemId, typeLabel);
      } }
  ]);
}

// Step 2: the actual results form, scoped to whichever Checklist type (or "all") was chosen above.
// Rows for already-recorded items pre-fill from existingByItemId and are just as editable as open
// ones (recordResultRowHtml_) -- there's no separate "view" mode, viewing and editing are the same
// screen. #recordResultsProgress is a live "X of Y completed" readout (updateRecordResultsProgress_)
// that updates on every icon-toggle click, not just what was already saved before this modal opened.
function openRecordResultsForm_(eventId, inspection, participant, filteredItems, existingByItemId, typeLabel) {
  var pendingFiles = {};
  filteredItems.forEach(function (it) {
    var existing = existingByItemId[it.id];
    // Pre-seed already-saved evidence as "done" entries so editing a Crossed item never looks like
    // it lost its evidence, and so the "Crossed needs at least one" check still passes untouched.
    pendingFiles[it.id] = (existing && existing.evidenceUrls) ? String(existing.evidenceUrls).split(',').filter(Boolean).map(function (url, idx) {
      return { name: t('word_evidence') + ' ' + (idx + 1), status: 'done', pct: 100, url: url, localId: 'existing_' + it.id + '_' + idx };
    }) : [];
  });

  var byType = {};
  filteredItems.forEach(function (it) { (byType[it.checklistType] = byType[it.checklistType] || []).push(it); });

  var body =
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">' +
      '<div id="recordResultsProgress" style="font-weight:600;font-size:12.5px;color:var(--accent);"></div>' +
      '<div class="muted" style="font-size:11px;">' + esc(t('unset_items_stay_open_hint')) + '</div>' +
    '</div>' +
    Object.keys(byType).sort().map(function (typeName) {
      return '<div style="font-weight:600;font-size:12.5px;color:var(--accent);margin:10px 0 4px;">' + esc(typeName) + '</div>' +
        byType[typeName].map(function (it) { return recordResultRowHtml_(it, existingByItemId[it.id]); }).join('');
    }).join('');

  var title = recordResultsTitle_(inspection, participant) + ' · ' + esc(inspection.disciplineName) + ' (' + esc(inspection.phase) + ')' +
    (typeLabel ? ' — ' + esc(typeLabel) : '');

  UI.openModal(title, body, [
    { label: ICON('print') + ' ' + t('print_btn'), className: 'btn-secondary', onClick: function () { printInspectionResults_(participant, inspection, filteredItems); } },
    { label: ICON('export_csv') + ' ' + t('export_csv'), className: 'btn-secondary', onClick: function () { exportInspectionResultsCsv_(participant, inspection, filteredItems); } },
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('save'), className: 'btn-primary', onClick: function () { saveInspectionResults_(eventId, inspection, participant, filteredItems, pendingFiles, existingByItemId); } }
  ]);

  wireRecordResultRows_(eventId, filteredItems, pendingFiles);
  updateRecordResultsProgress_();
}

// Live "X of Y completed" readout, recomputed from the DOM (not from existingByItemId alone) so a
// fresh icon pick counts immediately, before Save is even clicked.
function updateRecordResultsProgress_() {
  var el = document.getElementById('recordResultsProgress');
  if (!el) return;
  var groups = document.querySelectorAll('.result-state-group');
  var total = groups.length, done = 0;
  groups.forEach(function (g) { if (g.getAttribute('data-state')) done++; });
  el.textContent = t('x_of_y_completed', { done: done, total: total });
}

// REQ: "Default Risk and Window are just default recommendation, Inspector can input value." --
// defaultRisk/defaultWindowHours (ChecklistItems.gs) now pre-fill real, editable fields instead of a
// read-only muted line; whatever the Inspector leaves/changes here is sent as this result's own
// riskLevel/resolutionWindowHours (saveInspectionResults_ below), which recordInspectionResults
// (Inspections.gs) already accepted as an override -- `r.riskLevel || item.defaultRisk` -- it just
// never had a frontend field to actually send one. REQ follow-up: "convert [Ticked/Crossed/N/A] to
// icons" -- a 3-button icon toggle (.result-state-group) replaces the old <select>; the currently
// picked one is tracked in the group's own data-state attribute (wireRecordResultRows_ below), not a
// form control's .value, since none of the three buttons is an <input>. REQ follow-up: "None should
// be selected as default" -- an open item's group starts with no data-state and no button marked
// .active at all, forcing an explicit pick. REQ follow-up: "Completed checklists should be accessible
// and can ... be edited" -- `existing` (optional, an InspectionResults row from listInspectionResults)
// pre-fills state/risk/window/notes here instead. data-result-id is recorded on the group purely as
// a DOM-visible marker of which rows are edits vs new (devtools/debugging); saveInspectionResults_
// itself decides insert-vs-update off the existingByItemId map it already has in closure, not this
// attribute.
function recordResultRowHtml_(it, existing) {
  var riskOptions = ['Critical', 'High', 'Medium', 'Low', 'Info'].map(function (r) {
    return '<option value="' + r + '"' + (r === (existing ? existing.riskLevel : it.defaultRisk) ? ' selected' : '') + '>' + esc(t('risk_' + r.toLowerCase())) + '</option>';
  }).join('');
  var windowVal = existing ? existing.resolutionWindowHours : it.defaultWindowHours;
  var state = existing ? existing.state : '';
  return '<div class="result-row" data-row="' + it.id + '" style="border-bottom:1px solid #f0f1f6;padding:10px 0;">' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">' +
      '<div style="flex:1 1 260px;">' +
        '<div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;">' +
          '<div style="font-weight:600;font-size:13px;">' + esc(it.description) + '</div>' +
          (existing ? '<span class="muted" style="font-size:10.5px;white-space:nowrap;">' + esc(t('recorded_on_label', { date: UI.fmtDate(existing.recordedAt) })) + '</span>' : '') +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:6px;">' +
          '<span class="muted" style="font-size:11px;">' + esc(t('col_risk_level')) + '</span>' +
          '<select class="field-input result-risk" data-item="' + it.id + '" style="display:inline-block;width:auto;font-size:12px;padding:3px 6px;">' + riskOptions + '</select>' +
          '<span class="muted" style="font-size:11px;margin-inline-start:6px;">' + esc(t('field_window_hours')) + '</span>' +
          '<input type="number" min="1" class="field-input result-window" data-item="' + it.id + '" value="' + esc(windowVal) + '" style="display:inline-block;width:60px;font-size:12px;padding:3px 6px;" />' +
        '</div>' +
        '<div class="muted" style="font-size:10.5px;margin-top:3px;">' + esc(t('risk_window_editable_hint')) + '</div>' +
      '</div>' +
      '<div class="result-state-group" data-item="' + it.id + '" data-state="' + esc(state) + '" data-result-id="' + esc(existing ? existing.id : '') + '" style="display:flex;gap:4px;flex:none;">' +
        '<button type="button" class="btn btn-secondary btn-icon result-state-btn state-ticked' + (state === 'Ticked' ? ' active' : '') + '" data-item="' + it.id + '" data-state="Ticked" title="' + esc(t('title_result_ticked')) + '">' + ICON('result_ticked') + '</button>' +
        '<button type="button" class="btn btn-secondary btn-icon result-state-btn state-crossed' + (state === 'Crossed' ? ' active' : '') + '" data-item="' + it.id + '" data-state="Crossed" title="' + esc(t('title_result_crossed')) + '">' + ICON('result_crossed') + '</button>' +
        '<button type="button" class="btn btn-secondary btn-icon result-state-btn state-na' + (state === 'N/A' ? ' active' : '') + '" data-item="' + it.id + '" data-state="N/A" title="' + esc(t('title_result_na')) + '">' + ICON('result_na') + '</button>' +
      '</div>' +
    '</div>' +
    '<div class="crossed-extra" data-extra="' + it.id + '" style="display:' + (state === 'Crossed' ? 'block' : 'none') + ';margin-top:8px;padding:10px;background:#fff7f0;border-radius:8px;">' +
      '<div class="field-label" style="font-size:11.5px;">' + esc(t('field_notes_found')) + '</div>' +
      '<textarea class="field-input result-notes" data-item="' + it.id + '" rows="3" style="margin-bottom:6px;">' + esc(existing ? (existing.notes || '') : '') + '</textarea>' +
      (existing ? '' :
        '<div class="field-label" style="font-size:11.5px;">' + esc(t('field_suggested_action')) + '</div>' +
        '<input class="field-input result-action" data-item="' + it.id + '" style="margin-bottom:6px;" />') +
      '<div class="field-label" style="font-size:11.5px;">' + esc(t('field_evidence_required')) + '</div>' +
      // capture="environment" opens the device camera directly (rear camera) on mobile instead of
      // the general file/gallery picker -- REQ: evidence must be captured on the spot, not uploaded
      // from an existing file. The native input is kept but visually hidden (its own "Choose
      // file / No file chosen" chrome looks like a generic upload control); a plain camera-icon
      // button -- same plain-icon styling as every other icon button in the app -- triggers it via
      // .click(), so the only affordance the user sees is "take a photo", not "pick a file".
      '<input type="file" class="result-evidence hidden" data-item="' + it.id + '" accept="image/*,video/*" capture="environment" style="display:none;" />' +
      '<button type="button" class="btn btn-secondary btn-icon result-evidence-trigger" data-item="' + it.id + '" title="' + esc(t('title_take_photo')) + '" aria-label="' + esc(t('aria_take_photo')) + '">' + ICON('capture_photo') + '</button>' +
      // REQ: "Throughout the platform Do not allow Log Photos in any section to upload from device,
      // unless permission is set for that specific role." A second, non-capture file input + button --
      // shown only for a role an admin has explicitly granted evidence.uploadFromDevice -- next to the
      // always-present camera button above. See wireRecordResultRows_ below for the wiring.
      (hasPermission('evidence.uploadFromDevice')
        ? '<input type="file" class="result-evidence-alt hidden" data-item="' + it.id + '" accept="image/*,video/*" style="display:none;" />' +
          '<button type="button" class="btn btn-secondary btn-icon result-evidence-trigger-alt" data-item="' + it.id + '" title="' + esc(t('upload_from_device_btn')) + '" aria-label="' + esc(t('upload_from_device_btn')) + '">' + ICON('upload') + '</button>'
        : '') +
      '<div class="evidence-list" data-evlist="' + it.id + '" style="margin-top:6px;"></div>' +
    '</div>' +
  '</div>';
}

function wireRecordResultRows_(eventId, filteredItems, pendingFiles) {
  document.querySelectorAll('.result-state-btn').forEach(function (btn) {
    btn.onclick = function () {
      var itemId = btn.getAttribute('data-item');
      var state = btn.getAttribute('data-state');
      var group = document.querySelector('.result-state-group[data-item="' + itemId + '"]');
      if (group) {
        group.setAttribute('data-state', state);
        group.querySelectorAll('.result-state-btn').forEach(function (b) { b.classList.toggle('active', b === btn); });
      }
      var extra = document.querySelector('[data-extra="' + itemId + '"]');
      if (extra) extra.style.display = state === 'Crossed' ? 'block' : 'none';
      updateRecordResultsProgress_();
    };
  });
  document.querySelectorAll('.result-evidence').forEach(function (input) {
    input.onchange = function () {
      var itemId = input.getAttribute('data-item');
      Array.from(input.files).forEach(function (file) { uploadEvidenceFile_(eventId, itemId, file, pendingFiles); });
      input.value = '';
    };
  });
  document.querySelectorAll('.result-evidence-trigger').forEach(function (btn) {
    btn.onclick = function () {
      var itemId = btn.getAttribute('data-item');
      var input = document.querySelector('.result-evidence[data-item="' + itemId + '"]');
      if (input) input.click();
    };
  });
  // evidence.uploadFromDevice bypass -- same wiring shape as the camera pair above, just pointed at
  // the alt (non-capture) input/button pair.
  document.querySelectorAll('.result-evidence-alt').forEach(function (input) {
    input.onchange = function () {
      var itemId = input.getAttribute('data-item');
      Array.from(input.files).forEach(function (file) { uploadEvidenceFile_(eventId, itemId, file, pendingFiles); });
      input.value = '';
    };
  });
  document.querySelectorAll('.result-evidence-trigger-alt').forEach(function (btn) {
    btn.onclick = function () {
      var itemId = btn.getAttribute('data-item');
      var input = document.querySelector('.result-evidence-alt[data-item="' + itemId + '"]');
      if (input) input.click();
    };
  });
  // Paint any pre-seeded evidence (already-saved rows, see openRecordResultsForm_) right away --
  // renderEvidenceList_ otherwise only ever runs reactively, off an upload/retry event.
  Object.keys(pendingFiles).forEach(function (itemId) {
    if (pendingFiles[itemId].length) renderEvidenceList_(itemId, pendingFiles);
  });
}

// Kicks off the moment a file is picked. REQ: every camera photo gets date/time + GPS + a live
// Arabic address + a QR linking its exact location + the GA/Inspection Company logos stamped onto
// it (EvidenceCapture.prepare, evidence.js), and is saved to this device *before* any network call
// is attempted (EvidenceCapture.saveAndUpload) -- so a dropped connection only ever costs a retry,
// never the evidence itself.
var EVIDENCE_MAX_UPLOAD_BYTES_ = 15 * 1024 * 1024; // 15MB -- past this, base64 + the JSON POST
  // round-trip to Apps Script is very likely to time out or drop mid-transfer on a mobile
  // connection; fail fast with a clear reason instead of a generic "Network error."

// REQ: "Instead of showing 'OUTSIDE VENUE BOUNDARY' on photos make it a badge also provide distance
// away from participant in meters." Was previously burned into the photo's own pixels
// (evidenceComposite_, evidence.js); now a UI badge instead, built from metadata carried alongside
// the evidence URL (outsideBoundary/distanceMeters, computed at capture time in EvidenceCapture.prepare
// and attached to the returned File -- see uploadEvidenceFile_ below -- then persisted on the Finding
// as evidenceMeta once submitted, Findings.gs). meta missing/incomplete (evidence captured before this
// feature existed, no GPS fix, or no participant selected yet at capture time) simply renders nothing --
// never a false badge.
function evidenceOutsideBadgeHtml_(meta) {
  if (!meta || !meta.outsideBoundary) return '';
  var distText = (meta.distanceMeters != null) ? t('distance_from_participant_suffix', { m: Math.round(meta.distanceMeters) }) : '';
  return '<div class="evidence-outside-boundary-badge">' + ICON('warning_banner') + ' ' + esc(t('outside_boundary_badge_label')) + (distText ? ' · ' + esc(distText) : '') + '</div>';
}
function evidenceMetaFor_(evidenceMetaArr, url) {
  if (!evidenceMetaArr || !url) return null;
  for (var i = 0; i < evidenceMetaArr.length; i++) { if (evidenceMetaArr[i] && evidenceMetaArr[i].url === url) return evidenceMetaArr[i]; }
  return null;
}

// skipPrepare (optional): true when `file` has already been through EvidenceCapture.prepare() once --
// REQ (Log Photos tab): photos staged there are captured/watermarked at capture time, then handed off
// here when "Create Log" is used; running prepare() again would stamp a second set of logos/QR/GPS
// text on top of the first. Regular camera-capture callers omit this and get the normal behavior.
// participantPos (optional): {lat,lng} of the log's currently-selected Participant -- REQ: "distance
// away from participant in meters." Passed through to EvidenceCapture.prepare so it can compute the
// distance between the capture GPS fix and this participant; findings.js is the only caller that has
// a participant to offer (New Log form), everyone else simply omits it and gets no distance figure.
function uploadEvidenceFile_(eventId, itemId, file, pendingFiles, skipPrepare, participantPos) {
  var localId = 'ev_' + Date.now() + '_' + Math.random().toString(36).slice(2);
  var entry = { name: file.name, status: 'preparing', pct: 0, url: '', localId: localId, eventId: eventId };
  pendingFiles[itemId].push(entry);
  renderEvidenceList_(itemId, pendingFiles);

  (skipPrepare ? Promise.resolve(file) : EvidenceCapture.prepare(file, eventId, null, participantPos)).then(function (readyFile) {
    entry.file = readyFile; // kept for the "Retry now" button below
    if (readyFile.size > EVIDENCE_MAX_UPLOAD_BYTES_) {
      var mb = (readyFile.size / (1024 * 1024)).toFixed(1);
      throw new Error(t('file_too_large_error', { mb: mb }));
    }
    entry.status = 'uploading';
    renderEvidenceList_(itemId, pendingFiles);
    return EvidenceCapture.saveAndUpload(localId, eventId, readyFile, function (loaded, total) {
      entry.pct = Math.round((loaded / total) * 100);
      renderEvidenceList_(itemId, pendingFiles);
    });
  }).then(function (res) {
    entry.status = 'done'; entry.url = res.url; entry.pct = 100;
    renderEvidenceList_(itemId, pendingFiles);
  }).catch(function (err) {
    // EvidenceCapture.saveAndUpload already wrote the file to this device before the network call --
    // so a failure here means the *upload* needs a retry, not that the evidence was lost. The file
    // size is appended so a size-related failure (still possible if the watermark/resize step itself
    // failed and fell back to the untouched original) is visible without needing devtools.
    var sizeMb = entry.file ? (entry.file.size / (1024 * 1024)).toFixed(1) + 'MB' : '?';
    entry.status = 'saved-locally'; entry.error = (err.message || t('upload_failed_fallback')) + ' [' + sizeMb + ']';
    renderEvidenceList_(itemId, pendingFiles);
  });
}

function retryEvidenceEntry_(itemId, entry, pendingFiles) {
  if (!entry.file) return; // nothing to resend from this session -- EvidenceCapture.retryPending() covers it on reconnect instead
  entry.status = 'uploading'; entry.pct = 0;
  renderEvidenceList_(itemId, pendingFiles);
  EvidenceCapture.saveAndUpload(entry.localId, entry.eventId, entry.file, function (loaded, total) {
    entry.pct = Math.round((loaded / total) * 100);
    renderEvidenceList_(itemId, pendingFiles);
  }).then(function (res) {
    entry.status = 'done'; entry.url = res.url; entry.pct = 100;
    renderEvidenceList_(itemId, pendingFiles);
  }).catch(function (err) {
    var sizeMb = entry.file ? (entry.file.size / (1024 * 1024)).toFixed(1) + 'MB' : '?';
    entry.status = 'saved-locally'; entry.error = (err.message || t('upload_failed_fallback')) + ' [' + sizeMb + ']';
    renderEvidenceList_(itemId, pendingFiles);
  });
}

// REQ follow-up: "Also user wants to see image before submitting allow image thumbnail and when
// clicked expand." Image files get a real thumbnail as soon as EvidenceCapture.prepare() has resolved
// (entry.file set -- see uploadEvidenceFile_) using a local object URL, swapped for the real Drive
// thumbnail once the upload finishes (entry.status === 'done'); the object URL is created once and
// cached on the entry itself (entry._previewUrl) so repeated re-renders during upload progress don't
// leak a new one every tick. Video files keep the plain icon (no cheap way to grab a frame here)
// but stay fully functional otherwise. Thumbnails render in their own flex strip ABOVE the existing
// per-file status/progress rows (unchanged below) rather than inline with them, so every thumbnail in
// that strip is a sibling .evidence-thumb[data-lightbox-url] element -- the exact shape
// findings.js's delegated lightbox click handler already scans for its sibling-based gallery
// iteration, so Prev/Next between the pending photos "just works" with no extra wiring here.
function evidencePendingThumbHtml_(f) {
  if (!f.file || !f.file.type || f.file.type.indexOf('image/') !== 0) return '';
  var src;
  if (f.status === 'done' && f.url) src = driveEvidenceThumbUrl_(f.url) || '';
  if (!src) {
    f._previewUrl = f._previewUrl || URL.createObjectURL(f.file);
    src = f._previewUrl;
  }
  var full = (f.status === 'done' && f.url) ? (driveEvidenceThumbUrl_(f.url, 1600) || f.url) : (f._previewUrl || src);
  var original = (f.status === 'done' && f.url) ? f.url : (f._previewUrl || src);
  // REQ: "make it a badge also provide distance away from participant in meters" -- the metadata is
  // attached directly onto the prepared File object (EvidenceCapture.prepare, evidence.js), so it's
  // available here immediately, before this evidence has even been submitted as part of a Finding.
  var meta = f.file ? { outsideBoundary: f.file._hululOutsideBoundary, distanceMeters: f.file._hululDistanceMeters } : null;
  return '<div style="display:flex;flex-direction:column;align-items:center;">' +
    '<a href="' + esc(original) + '" target="_blank" rel="noopener" title="' + esc(t('click_to_expand')) + '" ' +
      'class="evidence-thumb" data-lightbox-url="' + esc(full) + '" style="width:56px;height:56px;">' +
      '<img src="' + esc(src) + '" alt="' + esc(f.name) + '" class="evidence-thumb-img" /></a>' +
    evidenceOutsideBadgeHtml_(meta) +
  '</div>';
}

function renderEvidenceList_(itemId, pendingFiles) {
  var el = document.querySelector('[data-evlist="' + itemId + '"]');
  if (!el) return;
  var files = pendingFiles[itemId] || [];
  var thumbsHtml = files.map(evidencePendingThumbHtml_).filter(Boolean).join('');
  el.innerHTML = (thumbsHtml ? '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:6px;">' + thumbsHtml + '</div>' : '') +
    files.map(function (f) {
    if (f.status === 'preparing') {
      return '<div style="font-size:11.5px;margin-top:4px;">' + esc(f.name) + ' ' + esc(t('stamping_hint')) + '</div>';
    }
    if (f.status === 'uploading') {
      return '<div style="font-size:11.5px;margin-top:4px;">' + esc(f.name) + ' ' + esc(t('uploading_pct_suffix', { pct: f.pct })) +
        '<div style="background:#eee;border-radius:6px;height:6px;overflow:hidden;margin-top:2px;">' +
        '<div style="background:var(--accent);height:100%;width:' + f.pct + '%;transition:width .1s;"></div></div></div>';
    }
    if (f.status === 'done') return '<div style="font-size:11.5px;margin-top:4px;color:var(--success);">' + ICON('file_upload_done') + ' ' + esc(f.name) + '</div>';
    if (f.status === 'saved-locally') {
      return '<div style="font-size:11.5px;margin-top:4px;color:var(--warning);">' + ICON('warning_banner') + ' ' + esc(f.name) + ' ' +
        esc(t('saved_locally_suffix', { error: f.error || 'connection issue' })) +
        ' <button type="button" class="btn btn-secondary btn-sm" data-retry-evidence="' + esc(f.localId) + '" style="margin-inline-start:6px;padding:2px 8px;font-size:11px;">' + esc(t('retry_now_btn')) + '</button></div>';
    }
    return '<div style="font-size:11.5px;margin-top:4px;color:var(--danger);">' + ICON('file_upload_failed') + ' ' + esc(f.name) + ' — ' + esc(f.error || 'failed, try again') + '</div>';
  }).join('');
  el.querySelectorAll('[data-retry-evidence]').forEach(function (btn) {
    btn.onclick = function () {
      var localId = btn.getAttribute('data-retry-evidence');
      var entry = (pendingFiles[itemId] || []).filter(function (x) { return x.localId === localId; })[0];
      if (entry) retryEvidenceEntry_(itemId, entry, pendingFiles);
    };
  });
}

// REQ: "There are some long checklists. When not fully completed and user tries to save they get an
// error ... List should be saved." A row left blank (data-state === '') is simply skipped -- it stays
// open for a later visit, same as before anything was recorded -- instead of blocking the whole save.
// REQ follow-up: "Completed checklists should be ... edited." A row that already had a result
// (data-result-id set, see recordResultRowHtml_) goes through updateInspectionResult instead of being
// bundled into the recordInspectionResults batch, and only if something on it actually changed --
// re-saving every untouched already-done row on every visit would be needless API calls and, for
// Crossed ones, needlessly re-validate evidence that was never touched.
async function saveInspectionResults_(eventId, inspection, participant, filteredItems, pendingFiles, existingByItemId) {
  var newResults = [];
  var updates = [];
  for (var i = 0; i < filteredItems.length; i++) {
    var it = filteredItems[i];
    var row = document.querySelector('[data-row="' + it.id + '"]');
    if (!row) continue;
    var state = row.querySelector('.result-state-group').getAttribute('data-state');
    if (!state) continue; // left blank -- stays open, not an error

    var files = pendingFiles[it.id] || [];
    if (state === 'Crossed' && files.some(function (f) { return f.status === 'uploading'; })) {
      UI.toast(t('toast_evidence_uploading', { desc: it.description }), 'error');
      return;
    }
    var urls = files.filter(function (f) { return f.status === 'done'; }).map(function (f) { return f.url; });
    if (state === 'Crossed' && !urls.length) {
      UI.toast(t('toast_evidence_required_desc', { desc: it.description }), 'error');
      return;
    }

    var riskSel = row.querySelector('.result-risk');
    var windowInput = row.querySelector('.result-window');
    var notesInput = row.querySelector('.result-notes');
    // Risk/Window/evidence are sent for every state, not just Crossed, since InspectionResults
    // (Inspections.gs) records all of them regardless -- they only actually shape anything downstream
    // (the auto-created Finding) when this item is Crossed.
    var entry = {
      checklistItemId: it.id, state: state,
      riskLevel: riskSel ? riskSel.value : undefined,
      resolutionWindowHours: (windowInput && windowInput.value !== '') ? Number(windowInput.value) : undefined,
      notes: notesInput ? notesInput.value : '',
      evidenceUrls: urls
    };

    var existing = existingByItemId[it.id];
    if (!existing) {
      if (state === 'Crossed') {
        var actionInput = row.querySelector('.result-action');
        entry.suggestedAction = actionInput ? actionInput.value : '';
        // REQ follow-up: a Crossed item's auto-created finding used to always end up with a blank
        // lat/lng even though the live-inspection GPS watch (startLiveInspectionTracking_) is
        // running the whole time this modal is open -- attach the latest fix here so
        // recordInspectionResults (Inspections.gs) can save it on the Finding it creates.
        if (liveInspectionLastCoords_) { entry.lat = liveInspectionLastCoords_.lat; entry.lng = liveInspectionLastCoords_.lng; }
      }
      newResults.push(entry);
    } else {
      var changed = state !== existing.state ||
        String(entry.riskLevel) !== String(existing.riskLevel) ||
        String(entry.resolutionWindowHours) !== String(existing.resolutionWindowHours) ||
        entry.notes !== (existing.notes || '') ||
        urls.join(',') !== (existing.evidenceUrls || '');
      if (changed) updates.push(Object.assign({ resultId: existing.id }, entry));
    }
  }

  if (!newResults.length && !updates.length) {
    UI.toast(t('toast_nothing_to_save'), 'error');
    return;
  }

  try {
    var recordPromise = newResults.length
      ? Api.call('recordInspectionResults', Object.assign({ inspectionId: inspection.id, results: newResults }, participant ? { participantId: participant.id } : {}))
      : null;
    var updatePromises = updates.map(function (u) { return Api.call('updateInspectionResult', u); });
    var responses = await Promise.all((recordPromise ? [recordPromise] : []).concat(updatePromises));
    UI.closeModal();
    var findingsCreated = recordPromise ? (responses[0].findingsCreated || []).length : 0;
    var msg = t('toast_results_saved', { saved: newResults.length + updates.length });
    if (findingsCreated) msg += ' — ' + t('findings_created_toast', { count: findingsCreated, term: (findingsCreated === 1 ? Term('finding') : Term('finding_plural')).toLowerCase() });
    UI.toast(msg, 'success');
    Router.resolve();
  } catch (err) { UI.error(err); }
}

// REQ: "Completed checklists should be accessible and can be printed and exported with updated
// results." Reads the CURRENT state straight out of the modal's own DOM (not a re-fetch) -- so it
// always reflects whatever's on screen right now, including edits not yet saved, same as the
// live progress readout above.
function inspectionResultsStateLabel_(state) {
  return state === 'Ticked' ? t('title_result_ticked') : state === 'Crossed' ? t('title_result_crossed') :
    state === 'N/A' ? t('title_result_na') : t('word_pending');
}
function inspectionResultsSnapshot_(filteredItems) {
  return filteredItems.map(function (it) {
    var row = document.querySelector('[data-row="' + it.id + '"]');
    var state = row ? row.querySelector('.result-state-group').getAttribute('data-state') : '';
    var riskSel = row ? row.querySelector('.result-risk') : null;
    var windowInput = row ? row.querySelector('.result-window') : null;
    var notesInput = row ? row.querySelector('.result-notes') : null;
    return {
      type: it.checklistType || '', description: it.description, stateLabel: inspectionResultsStateLabel_(state),
      risk: riskSel ? t('risk_' + riskSel.value.toLowerCase()) : '',
      windowHours: windowInput ? windowInput.value : '',
      notes: (state === 'Crossed' && notesInput) ? notesInput.value : ''
    };
  });
}

function exportInspectionResultsCsv_(participant, inspection, filteredItems) {
  var rows = inspectionResultsSnapshot_(filteredItems);
  var header = [t('col_type'), t('field_description'), t('col_result'), t('col_risk_level'), t('field_window_hours'), t('field_notes_found')];
  var body = rows.map(function (r) { return [r.type, r.description, r.stateLabel, r.risk, r.windowHours, r.notes]; });
  var filename = ((participant ? participant.name : t('venue_checklist_label')) + '-' + inspection.disciplineName + '-' + inspection.phase + '.csv').replace(/[^\w.\-]+/g, '_');
  UI.downloadCsv(filename, [header].concat(body));
}

function printInspectionResults_(participant, inspection, filteredItems) {
  var rows = inspectionResultsSnapshot_(filteredItems);
  var w = window.open('', '_blank', 'width=800,height=900');
  if (!w) { UI.toast(t('toast_allow_popups'), 'error'); return; }
  var subjectLabel = participant ? participant.name : t('venue_checklist_label');
  w.document.write(
    '<!DOCTYPE html><html><head><title>' + esc(subjectLabel) + ' — ' + esc(inspection.disciplineName) + '</title>' +
    '<meta charset="UTF-8" /><style>' +
      'body{font-family:Arial,Helvetica,sans-serif;padding:24px;color:#111;}' +
      'h2{margin:0 0 4px;} .sub{color:#666;font-size:12px;margin-bottom:16px;}' +
      'table{width:100%;border-collapse:collapse;font-size:12px;} th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top;}' +
      'th{background:#f3f3f3;}' +
    '</style></head><body>' +
      '<h2>' + esc(subjectLabel) + '</h2>' +
      '<div class="sub">' + esc(inspection.disciplineName) + ' · ' + esc(inspection.phase) + ' · ' + esc(UI.fmtDate(new Date().toISOString())) + '</div>' +
      '<table><thead><tr><th>' + esc(t('col_type')) + '</th><th>' + esc(t('field_description')) + '</th><th>' + esc(t('col_result')) + '</th><th>' + esc(t('col_risk_level')) + '</th><th>' + esc(t('field_window_hours')) + '</th><th>' + esc(t('field_notes_found')) + '</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td>' + esc(r.type) + '</td><td>' + esc(r.description) + '</td><td>' + esc(r.stateLabel) + '</td><td>' + esc(r.risk) + '</td><td>' + esc(r.windowHours) + '</td><td>' + esc(r.notes) + '</td></tr>';
      }).join('') +
      '</tbody></table>' +
    '</body></html>'
  );
  w.document.close();
  w.focus();
  setTimeout(function () { w.print(); }, 300);
}

/* ---------------- Findings (Risk Logging) ----------------
 * Log finding / view a log / resolve / accept / reject are full pages now (findings.js, routes
 * #/events/:id/findings/new and #/events/:id/findings/:findingId) -- this tab is just the Pipeline
 * board + table entry points into those pages. See Findings.gs's header comment for the full
 * 7-status workflow (Open -> Viewed -> Submitted -> InReview -> Resolved/ReOpen -> Resubmitted ->
 * Resolved); there is no terminal Rejected state -- every rejected resolution lands back on ReOpen.
 * The standalone Resolutions tab that used to live here has been folded into the finding detail
 * page's own Resolve/Accept/Reject actions (see findings.js) and removed.
 */
// REQ: "In pipeline move all resolved cards to end of list" -- Resolved moved to the very last
// column so the board reads open/in-progress work first, done work last.
var FINDING_BOARD_COLUMNS = ['Open', 'Viewed', 'Submitted', 'InReview', 'ReOpen', 'Resubmitted', 'Resolved'];
// FINDING_BOARD_LABELS (a second, separate hardcoded English label map) used to live here -- removed
// in favor of UI.statusLabel(status), which is the exact same lookup UI.statusBadge itself now uses
// (ui.js), so this board's headers translate for free instead of needing their own copy kept in sync.
var RISK_BORDER_COLOR = { Critical: 'var(--critical)', High: 'var(--danger)', Medium: 'var(--warning)', Low: 'var(--success)', Info: 'var(--info)' };
// Who can create/edit/delete a finding is now RBAC-driven (see PERMISSION_REGISTRY_,
// backend/Permissions.gs, and hasPermission() calls below) instead of a hardcoded role array --
// the finding.create/finding.edit/finding.delete permission keys' defaultRoles are exactly what
// used to live here (['Inspector', 'ProjectManager', 'SystemAdmin']), so behavior is unchanged
// until a SystemAdmin edits one of them in Settings > Permissions.
// REQ (Risk Logging list, follow-up): "Actions (Allow edit and delete if not submitted)." Mirrors
// Findings.gs's FINDING_EDITABLE_STATUSES_ -- kept in sync by hand since frontend/backend don't share
// constants; the backend re-checks this on every updateFinding/deleteFinding call regardless, so a
// mismatch here would only ever show/hide a button wrongly, never bypass the real enforcement.
var FINDING_EDITABLE_STATUSES_ = ['Open', 'Viewed'];

// REQ: Pipeline cards must show risk level, Discipline, Category/sub-category, and time to expire
// -- deliberately NOT the Inspector's description (that's the point of opening the log itself; the
// card is a scan-at-a-glance summary, not a read of the finding) -- built as one bodyHtml block
// (see UI.board's bodyHtml support) rather than the default title/meta rendering.
function findingBoardCard_(f) {
  var overdue = f.resolutionWindowAt && new Date(f.resolutionWindowAt) < new Date();
  var isTerminal = f.status === 'Resolved';
  var countdownColor = isTerminal ? 'var(--text-600)' : (overdue ? 'var(--danger)' : 'var(--text-600)');
  return {
    id: f.id, borderColor: RISK_BORDER_COLOR[f.riskLevel],
    bodyHtml:
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:6px;">' +
        UI.riskBadge(f.riskLevel) +
        (isTerminal ? '' : '<span style="font-size:10.5px;font-weight:600;white-space:nowrap;color:' + countdownColor + ';">' + esc(UI.fmtCountdown(f.resolutionWindowAt)) + '</span>') +
      '</div>' +
      '<div style="font-size:12.5px;font-weight:600;margin-bottom:4px;line-height:1.35;">' + esc(f.disciplineName || '—') + '</div>' +
      '<div style="font-size:11px;color:var(--text-600);">' + esc([f.category, f.subCategory].filter(Boolean).join(' / ') || '—') + '</div>'
  };
}

async function tabFindings(content, eventId, detail) {
  var findings = await Api.call('listFindings', { eventId: eventId });
  // REQ: "A log can be created on any event from the time it is initiated even if it event did not
  // start yet. Logs can not be created only if event ended or Venue Rejected." Same rule
  // assertEventAcceptsNewLogs_ (Findings.gs) enforces server-side -- checked here too so the "+ Log"
  // button doesn't invite a tap that only bounces off a backend error once this event is closed.
  var event = detail && detail.event;
  var eventClosedReason = !event ? null
    : event.status === 'VenueRejected' ? t('event_closed_venue_rejected')
    : (event.endDateTime && new Date(event.endDateTime) < new Date()) ? t('event_closed_ended')
    : null;
  // Same 5-bucket grouping as the backend's findingKpiBuckets_ (Findings.gs) -- Viewed rolls into
  // "open", Submitted/Resubmitted roll into "in review" -- so these 6 KPI cards (which already have
  // dedicated icons) stay accurate without needing 3 more cards for the extra statuses.
  var counts = { Open: 0, InReview: 0, Resolved: 0, ReOpen: 0 };
  findings.forEach(function (f) {
    if (f.status === 'Open' || f.status === 'Viewed') counts.Open++;
    else if (f.status === 'InReview' || f.status === 'Submitted' || f.status === 'Resubmitted') counts.InReview++;
    else if (counts[f.status] !== undefined) counts[f.status]++;
  });

  var boardColumns = FINDING_BOARD_COLUMNS.map(function (status) {
    return {
      label: UI.statusLabel(status),
      cards: findings.filter(function (f) { return f.status === status; }).map(function (f) { return findingBoardCard_(f); })
    };
  });

  // RBAC pilot (see backend/Permissions.gs, frontend/js/permissions.js): these three used to all be
  // one hardcoded FINDING_CREATE_ROLES check (create/edit/delete lumped together); now each is its
  // own admin-configurable permission key, so a SystemAdmin can e.g. allow editing without allowing
  // deletion, without a code change. FINDING_CREATE_ROLES is kept as the still-correct default array
  // reference in Permissions.gs's PERMISSION_REGISTRY_, not read directly here anymore.
  var canCreate = hasPermission('finding.create') && !eventClosedReason;
  var canEditAny = hasPermission('finding.edit');
  var canDeleteAny = hasPermission('finding.delete');

  content.innerHTML =
    // REQ follow-up: "Move the '+ Log' button to the top of the page and keep it floating." Was
    // buried in the Risk Logging table's own card-header, well below the KPI cards and pipeline
    // board -- now a fixed, always-visible button pinned near the top of the viewport (position:fixed,
    // not sticky, so it stays put regardless of scroll position instead of just tracking the top of
    // this tab's content) rather than a normal in-flow element.
    (canCreate ? '<button class="btn btn-primary floating-log-btn" id="newFindingBtn">' + esc(t('log_x_btn')) + '</button>' : '') +
    // REQ: "Logs can not be created only if event ended or Venue Rejected." hasPermission('finding.create')
    // holders would otherwise just lose the button with no explanation -- this banner is only shown to
    // them (someone who could normally log, but can't right now because of this specific event).
    (hasPermission('finding.create') && eventClosedReason
      ? '<div class="muted" style="font-size:12.5px;margin:-8px 0 12px;">' + esc(eventClosedReason) + '</div>'
      : '') +
    '<div class="kpi-grid">' +
      kpiCard('kpi_total', findings.length, ICON('kpi_total'), 'var(--info)') +
      kpiCard('kpi_open', counts.Open, ICON('kpi_open'), 'var(--info)') +
      kpiCard('kpi_inreview', counts.InReview, ICON('kpi_inreview'), 'var(--purple)') +
      kpiCard('kpi_resolved', counts.Resolved, ICON('kpi_resolved'), 'var(--success)') +
      kpiCard('kpi_reopen', counts.ReOpen, ICON('kpi_reopen'), 'var(--warning)') +
    '</div>' +
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + esc(t('pipeline_title')) + '</div>' +
    '<div class="muted" style="font-size:11.5px;">' + esc(t('click_card_open_log_hint')) + '</div></div>' +
    '<div class="card-body">' + UI.board(boardColumns) + '</div></div>' +
    '<div class="card"><div class="card-header"><div class="card-title">' + t('tab_findings') + '</div></div>' +
    // REQ (follow-up): "Change Sub Category to Checklist Type and fill automatically." Findings.category
    // is where the New Finding form's own "Checklist Type" dropdown value actually gets saved
    // (findings.js renderNewFinding -- category: fChecklistType.value, defaulted to 'Other' server-side
    // when left blank, see createFinding/Findings.gs) -- "Category" was always a mislabel for that same
    // data. subCategory, meanwhile, has no UI that ever sets it -- it's a dead column, always blank.
    // Rather than relabel Sub category to Checklist Type and have it show nothing, the one real column
    // (already auto-filled from the finding's own Checklist Type at creation time) is relabeled instead,
    // and the always-empty one is dropped so there's no confusing duplicate/blank column.
    // REQ (follow-up): "Arrange columns in this order: Participant, Discipline, Checklist Type,
    // Severity, Status, Description, Actions (Allow edit and delete if not submitted)." Edit/Delete
    // only render for someone who could create a finding in the first place (canCreate) AND only
    // while the finding is still Open/Viewed (FINDING_EDITABLE_STATUSES_) -- the backend
    // (updateFinding/deleteFinding, Findings.gs) enforces the same status gate independently, so this
    // is purely about not showing a button that would just come back as a FORBIDDEN error.
    // REQ follow-up: "Arrange table columns in following order: Do, Image, Category Code as Category,
    // Sub-Category, Risk Level as Severity, Status, Description, Suggestion, Log Location, Date time,
    // Created by" -- plus Participant/Checklist Item link/Log ID/Rejection count kept alongside per
    // the clarifying answer ("keep them ... but for the checklist item it must be linked to the
    // checklist the user completed not to the main Checklist page").
    '<div class="card-body">' + UI.table([
      // Do -- the same view/edit/delete actions that used to be the LAST column, now first and
      // relabeled per the REQ (was an unlabeled/"Actions" trailing column). Deliberately NOT
      // key:'actions' -- that literal key is what UI.table (ui.js) uses to auto-pin a column last and
      // exclude it from the column manager (manageableCols/actionCols split), which would silently
      // fight this column's whole "move it first" REQ and make it permanently un-hideable/
      // un-reorderable. sortable/exportable are still explicitly turned off by hand instead, so this
      // keeps the exact same "don't try to sort/filter/export button HTML" behavior a real 'actions'
      // column gets automatically.
      { key: 'do', label: t('col_do'), sortable: false, exportable: false, render: r => {
        var stillEditable = FINDING_EDITABLE_STATUSES_.indexOf(r.status) !== -1;
        var canEdit = canEditAny && stillEditable;
        var canDelete = canDeleteAny && stillEditable;
        return UI.actionsCell(
          '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('title_open_log')) + '" data-finding-view="' + r.id + '" data-row-view="1">' + ICON('view_open') + '</button> ' +
          (canEdit ? '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('action_edit')) + '" data-finding-edit="' + r.id + '">' + ICON('edit') + '</button> ' : '') +
          (canDelete ? '<button class="btn btn-secondary btn-sm btn-icon btn-danger" title="' + esc(t('action_delete')) + '" data-finding-delete="' + r.id + '">' + ICON('delete') + '</button>' : '')
        );
      } },
      // REQ follow-up: "Add column to show Log ID." A finding IS a Risk Log entry (this whole page
      // is the "Risk Logging" tab -- see findings.js's header comment).
      { key: 'id', label: t('col_log_id') },
      // Image -- last evidence photo as a thumbnail; click expands and iterates through every photo
      // on this finding (data-gallery-b64, see findings.js's delegated lightbox click handler).
      { key: 'evidenceUrls', label: t('col_image'), exportValue: r => (r.evidenceUrls && r.evidenceUrls.length) ? r.evidenceUrls[r.evidenceUrls.length - 1] : '', render: r => {
        var urls = r.evidenceUrls || [];
        if (!urls.length) return '—';
        var last = urls[urls.length - 1];
        var thumb = driveEvidenceThumbUrl_(last) || '';
        var full = driveEvidenceThumbUrl_(last, 1600) || last;
        return '<div>' +
          '<a href="' + esc(last) + '" target="_blank" rel="noopener" title="' + esc(t('click_to_expand')) + '" ' +
            'class="evidence-thumb" data-lightbox-url="' + esc(full) + '" data-gallery-b64="' + esc(btoa(JSON.stringify(urls))) + '" style="width:44px;height:44px;">' +
            (thumb ? '<img src="' + esc(thumb) + '" class="evidence-thumb-img" alt="Evidence" />' : ICON('capture_photo')) +
            // REQ: "Image column add a badge on top of photo to show image count."
            (urls.length > 1 ? '<span class="evidence-thumb-count">' + (urls.length > 99 ? '99+' : urls.length) + '</span>' : '') +
          '</a>' +
          evidenceOutsideBadgeHtml_(evidenceMetaFor_(r.evidenceMeta, last)) +
        '</div>';
      } },
      { key: 'participantName', label: Term('participant') },
      // Category -- REQ: "Category Code as Category," i.e. the Discipline's short code (see
      // enrichFinding_, Findings.gs), not its full name, to keep this column compact.
      { key: 'disciplineCode', label: Term('discipline'), render: r => esc(r.disciplineCode || r.disciplineName || '—') },
      // Sub-Category -- category field is where the New Log form's own Checklist Type dropdown value
      // is saved (findings.js); Term('checklistType') already displays as "Sub-Category" app-wide.
      { key: 'category', label: Term('checklistType') },
      // REQ follow-up: "are logs traceable back to that checklist item? ... must be linked to the
      // checklist the user completed not to the main Checklist page." Links into the actual completed
      // checklist this item was recorded on (completedChecklistViewMode_, this file), not the admin
      // Checklist Items catalog -- and deep-link-highlights that exact row there. Blank ('—') for
      // manually-logged findings, which have no single checklist item to point at.
      { key: 'checklistItemDescription', label: t('col_checklist_item'), render: r => r.checklistItemDescription
        ? '<a href="#/events/' + esc(eventId) + '/completed-checklist/' + esc(r.inspectionId) + '/' + esc(r.participantId) + '?itemId=' + esc(r.checklistItemId) + '" style="color:var(--accent);">' + esc(r.checklistItemDescription) + '</a>'
        : '—' },
      { key: 'riskLevel', label: t('col_severity'), render: r => UI.riskBadge(r.riskLevel) },
      { key: 'status', label: t('status'), render: r => UI.statusBadge(r.status) },
      // REQ follow-up: "Add ... another to show rejection count." reopenCount (Findings.gs) now
      // increments on every rejection regardless of outcome (every rejection lands back on ReOpen,
      // see reviewFindingResolution) -- this is the one visible place it's surfaced as a plain count.
      { key: 'reopenCount', label: t('col_rejection_count'), render: r => r.reopenCount || 0 },
      { key: 'description', label: t('field_description') },
      { key: 'suggestedAction', label: t('col_suggestion'), render: r => esc(r.suggestedAction || '—') },
      { key: 'location', label: t('field_log_location'), render: r => esc(r.location || '—') },
      { key: 'createdAt', label: t('col_date_time'), render: r => UI.fmtDate(r.createdAt) },
      { key: 'createdByName', label: t('col_created_by'), render: r => esc(r.createdByName || r.createdBy || '—') }
    ], findings, {}) + '</div></div>';

  UI.wireBoard(content, function (id) { window.location.hash = '#/events/' + eventId + '/findings/' + id; });
  UI.wireBoardPagination(content);

  if (canCreate) document.getElementById('newFindingBtn').onclick = function () { window.location.hash = '#/events/' + eventId + '/findings/new'; };
  content.querySelectorAll('[data-finding-view]').forEach(btn => {
    btn.onclick = () => { window.location.hash = '#/events/' + eventId + '/findings/' + btn.getAttribute('data-finding-view'); };
  });
  content.querySelectorAll('[data-finding-edit]').forEach(btn => {
    btn.onclick = () => { window.location.hash = '#/events/' + eventId + '/findings/' + btn.getAttribute('data-finding-edit') + '/edit'; };
  });
  content.querySelectorAll('[data-finding-delete]').forEach(btn => {
    btn.onclick = () => {
      var findingId = btn.getAttribute('data-finding-delete');
      UI.confirmModal(t('delete_x_cant_undo_confirm', { term: Term('finding').toLowerCase() }), async function () {
        try {
          await Api.call('deleteFinding', { findingId: findingId });
          UI.toast(t('x_deleted', { term: Term('finding') }), 'success');
          Router.resolve();
        } catch (err) { UI.error(err); }
      }, { title: t('delete_modal_title', { term: Term('finding').toLowerCase() }), confirmLabel: t('delete'), confirmClass: 'btn-danger' });
    };
  });
}

/* ---------------- Finding Photo Timeline ---------------- */
// REQ: "Create a Log photos timeline for every photo under an event with details like Baskin
// Robbins High Risk Open, in modern design." Every Finding's evidence photo(s) for this event,
// newest first, grouped by day, with a participant/risk/status filter -- see the shared renderer
// (renderFindingPhotoTimeline_, findings.js), which also backs the Project detail page's rolled-up
// version across every linked event.
async function tabFindingPhotos(content, eventId) {
  var findings = await Api.call('listFindings', { eventId: eventId });
  var usersById = {};
  try {
    // Best-effort -- a role without user.list permission (e.g. a Participant account, per the
    // existing pattern in venues.js/eventPlaces.js) just sees the timeline without "Logged by" credit
    // lines instead of the whole tab failing.
    (await Api.call('listUsers', {})).forEach(function (u) { usersById[u.id] = u; });
  } catch (e) { /* no user.list permission -- timeline still works, just without the credit line */ }
  renderFindingPhotoTimeline_(content, findings, { usersById: usersById });
}

/* ---------------- Escalations ---------------- */
// REQ: "ability to modify the To user role and the Cc: user roles" -- recipients are now always
// resolved server-side from the tier's configured roles (Config -> Escalations), so the manual
// override form below only needs Finding + Tier; there's no more per-escalation recipient picker.
// `params.focus` (from the full-screen lock's Noted button, or the top-bar alert icon -- see
// showEscalationLock_/escAlertBtn in app.js) scrolls to and briefly highlights that one row, same
// "jump to this item" pattern already used by the Log tab.
async function tabEscalations(content, eventId, detail, params) {
  var [escalations, findings] = await Promise.all([
    Api.call('listEscalations', { eventId: eventId }), Api.call('listFindings', { eventId: eventId })
  ]);
  var findingsById = {}; findings.forEach(function (f) { findingsById[f.id] = f; });
  var findingOptions = findings.map(function (f) { return '<option value="' + f.id + '">' + esc(f.description || f.id) + '</option>'; }).join('');

  content.innerHTML =
    '<div class="card" style="margin-bottom:16px;"><div class="card-body" style="display:flex;justify-content:space-between;align-items:center;">' +
    '<div class="muted" style="font-size:13px;">' + esc(t('escalations_auto_hint', { term: Term('escalation_plural') })) + '</div>' +
    '<button class="btn btn-secondary btn-sm" id="runEscBtn">' + esc(t('run_check_now_btn')) + '</button></div></div>' +
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + esc(t('manual_x_override_title', { term: Term('escalation').toLowerCase() })) + '</div></div>' +
    '<div class="card-body form-row">' +
      UI.field(Term('finding'), '<select id="fEscFinding" class="field-input">' + (findingOptions || '<option value="">' + esc(t('no_x_logged_yet', { term: Term('finding_plural').toLowerCase() })) + '</option>') + '</select>') +
      UI.field(t('field_tier'), '<select id="fEscTier" class="field-input"><option value="1">1</option><option value="2">2</option><option value="3">3</option></select>') +
    '</div><div class="card-body" style="padding-top:0;">' +
      '<div class="muted" style="font-size:11.5px;margin-bottom:8px;">' + esc(t('recipients_resolved_hint')) + '</div>' +
      '<button class="btn btn-primary btn-sm" id="newEscBtn">' + esc(t('create_x_btn', { term: Term('escalation').toLowerCase() })) + '</button></div></div>' +
    '<div class="card"><div class="card-header"><div class="card-title">' + esc(Term('escalation_plural')) + '</div></div><div class="card-body">' +
    UI.table([
      { key: 'findingId', label: Term('finding'), render: r => '<span data-esc-id="' + esc(r.id) + '">' + esc(findingsById[r.findingId] ? (findingsById[r.findingId].description || r.findingId) : r.findingId) + '</span>' },
      { key: 'riskLevel', label: t('col_risk'), sortValue: r => findingsById[r.findingId] ? findingsById[r.findingId].riskLevel : '', render: r => UI.riskBadge(findingsById[r.findingId] ? findingsById[r.findingId].riskLevel : '') },
      { key: 'tier', label: t('col_tier'), render: r => esc(t('tier_prefix')) + r.tier },
      { key: 'to', label: t('col_to'), sortable: false, render: r => escalationPeopleHtml_(r.to) },
      { key: 'cc', label: t('col_cc'), sortable: false, render: r => escalationPeopleHtml_(r.cc) },
      { key: 'notedUserIds', label: t('col_noted'), sortValue: r => (r.notedUserIds || []).length, render: r => t('count_of_total', { count: (r.notedUserIds || []).length, total: r.to.length }) },
      { key: 'triggeredAt', label: t('col_triggered'), render: r => UI.fmtDate(r.triggeredAt) },
      { key: 'resolvedAt', label: t('col_resolved'), render: r => r.resolvedAt ? UI.fmtDate(r.resolvedAt) : '—' }
    ], escalations, {}) + '</div></div>';

  document.getElementById('runEscBtn').onclick = async function () {
    try { var res = await Api.call('runEscalationCheck', {}); UI.toast(t('x_triggered_toast', { count: res.triggeredCount, term: esc(res.triggeredCount === 1 ? Term('escalation') : Term('escalation_plural')).toLowerCase() }), 'success'); Router.resolve(); }
    catch (err) { UI.error(err); }
  };
  document.getElementById('newEscBtn').onclick = async function () {
    try {
      await Api.call('createEscalation', { findingId: document.getElementById('fEscFinding').value, tier: document.getElementById('fEscTier').value });
      UI.toast(t('x_created', { term: Term('escalation') }), 'success'); Router.resolve();
    } catch (err) { UI.error(err); }
  };

  var focusId = params && params.focus;
  if (focusId) {
    var marker = content.querySelector('[data-esc-id="' + focusId + '"]');
    var row = marker && marker.closest('tr');
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.style.transition = 'background 0.4s';
      row.style.background = '#fff7d6';
      setTimeout(function () { row.style.background = ''; }, 2500);
    }
  }
}

function escalationPeopleHtml_(people) {
  return (people && people.length) ? esc(people.map(function (p) { return p.name; }).join(', ')) : '—';
}

/* ---------------- Participants ----------------
 * Moved to eventPlaces.js -- REQ: this tab is now a replicant of the Venues > Places page, scoped
 * to this Event instead of the Venue (registered per event, deactivated when the event ends), not
 * the old simple "create a venue-wide participant" form. tabParticipants(content, eventId, detail)
 * is defined there.
 */

/* ---------------- Reports ---------------- */
async function tabReports(content, eventId) {
  var reports = await Api.call('listReports', { eventId: eventId });
  var canGenerate = hasPermission('report.generate');
  content.innerHTML =
    (canGenerate ?
      '<div class="card" style="margin-bottom:16px;"><div class="card-body" style="display:flex;gap:10px;">' +
      '<button class="btn btn-primary btn-sm" id="genReadinessBtn">' + esc(t('generate_x_report_btn', { phase: 'Opening' })) + '</button>' +
      '<button class="btn btn-secondary btn-sm" id="genInspectionBtn">' + esc(t('generate_x_report_btn', { phase: 'Operational' })) + '</button></div></div>'
      : '') +
    '<div class="card"><div class="card-header"><div class="card-title">' + esc(Term('report_plural')) + '</div></div><div class="card-body">' +
    reports.map(r =>
      '<div style="border-bottom:1px solid #f0f1f6;padding:12px 0;">' +
      '<div style="display:flex;justify-content:space-between;"><strong>' + esc(r.type) + '</strong><span class="muted">' + UI.fmtDate(r.generatedAt) + '</span></div>' +
      '<pre style="font-size:11.5px;background:#f6f7fb;padding:8px 10px;border-radius:8px;margin-top:6px;overflow-x:auto;">' + esc(JSON.stringify(r.summary, null, 2)) + '</pre></div>'
    ).join('') + (reports.length ? '' : '<div class="empty-state">' + t('no_data') + '</div>') +
    '</div></div>';

  if (canGenerate) {
    document.getElementById('genReadinessBtn').onclick = () => gen('Opening');
    document.getElementById('genInspectionBtn').onclick = () => gen('Operational');
  }
  async function gen(type) {
    try { await Api.call('generateReport', { eventId: eventId, type: type }); UI.toast(t('x_generated_toast', { term: Term('report') }), 'success'); Router.resolve(); }
    catch (err) { UI.error(err); }
  }
}

/* ---------------- Event Chat ---------------- */
// REQ: "Add an event chat page after overview tab, allow to tag any user, and participants within
// the event. Related participant accounts have no access to the chat." Server-side enforcement lives
// in assertChatAccess_ (EventChat.gs) -- this tab is also hidden entirely for those roles (see
// EVENT_TABS' visibleFn above), so this function only ever runs for someone actually allowed in.
//
// REQ (compose UX): "Typing /u will suggest users list under this event. Typing /e will suggest list
// with all event logs. Typing /p will suggest list with all event participants. # will suggest tab
// and when selected sections will be suggested when selected a screenshot will be captured and added
// as large thumbnail image." Slash-command-style autocomplete replaces the earlier checkbox panels:
// typing a trigger (/u, /e, /p, #) opens a small dropdown anchored under the textarea; picking an
// item stages it (shown as a removable chip) and drops a short readable marker into the message text
// at the trigger's position. # is two-level: pick a tab, then a "section" (one of that tab's own
// .card blocks, discovered by rendering the tab off-screen -- see captureTabSections_), then a
// screenshot of just that card is captured via html2canvas (already loaded globally for the Support
// ticket flow, see index.html) and uploaded via uploadChatScreenshot (EventChat.gs).
async function tabEventChat(content, eventId, detail) {
  var results = await Promise.all([
    Api.call('listEventChatMessages', { eventId: eventId }),
    Api.call('listChatTaggableUsers', { eventId: eventId }),
    Api.call('listChatTaggableParticipants', { eventId: eventId }),
    Api.call('listEventLog', { eventId: eventId })
  ]);
  var messages = results[0], taggableUsers = results[1], taggableParticipants = results[2], logEntries = results[3];
  // Screenshot targets: every tab this role can currently see, except Chat itself (capturing the
  // compose box from within the compose box is circular/pointless).
  var tabPickerItems = EVENT_TABS.filter(function (tb) { return tb[0] !== 'chat' && (!tb[3] || tb[3]()); })
    .map(function (tb) { return { key: tb[0], label: tb[2] ? tb[2]() : t(tb[1]) }; });

  content.innerHTML =
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + esc(t('tab_chat')) + '</div></div>' +
    '<div class="card-body" id="chatMessages" style="max-height:480px;overflow-y:auto;">' +
    (messages.length ? messages.map(chatMessageHtml_).join('') : '<div class="empty-state">' + esc(t('no_messages_yet')) + '</div>') +
    '</div></div>' +
    '<div class="card"><div class="card-header"><div class="card-title">' + esc(t('new_message_title')) + '</div>' +
    '<div class="muted" style="font-size:11px;">' + t('chat_compose_hint', { participant: esc(Term('participant').toLowerCase()) }) + '</div></div>' +
    '<div class="card-body">' +
      '<div class="field-label" style="margin-top:0;">' + esc(t('field_message')) + '</div>' +
      '<div style="position:relative;">' +
        '<textarea id="fChatMessage" class="field-input" rows="3" style="width:100%;box-sizing:border-box;resize:vertical;" placeholder="' + esc(t('composer_placeholder')) + '"></textarea>' +
        '<div id="chatSuggestBox" class="chat-suggest-box" style="display:none;"></div>' +
      '</div>' +
      '<div id="chatStagedChips" style="margin-top:8px;"></div>' +
      '<div style="position:relative;display:inline-block;margin-top:10px;">' +
        '<div style="display:flex;gap:8px;">' +
          '<button type="button" class="btn btn-secondary btn-sm btn-icon" id="chatEmojiBtn" title="' + esc(t('title_insert_emoji')) + '">🙂</button>' +
          '<button class="btn btn-primary btn-sm" id="sendChatBtn">' + ICON('send') + ' ' + esc(t('send_btn')) + '</button>' +
        '</div>' +
        '<div class="chat-emoji-popover" id="chatEmojiPopover" style="display:none;">' +
          '<div class="chat-emoji-popover-header">' +
            // Icons tab removed: ICON_LIBRARY (icons.js) now holds Lucide SVG markup, not single
            // characters -- there's no way to "type" a vector icon into a plain-text chat message,
            // so this popover only ever inserts real emoji now (still character-based, emoji.js).
            '<div class="chat-emoji-popover-title">' + esc(t('tab_emoji_label')) + '</div>' +
            '<button type="button" class="chat-emoji-popover-close" id="chatEmojiPopoverClose" aria-label="' + esc(t('aria_close')) + '">' + ICON('close_modal') + '</button>' +
          '</div>' +
          '<div class="chat-emoji-popover-body" id="chatEmojiPopoverBody"></div>' +
        '</div>' +
      '</div>' +
    '</div></div>';

  // Scroll to the latest message on open, same as any chat UI.
  var msgBox = document.getElementById('chatMessages');
  msgBox.scrollTop = msgBox.scrollHeight;

  content.querySelectorAll('[data-goto-log]').forEach(function (el) {
    el.onclick = function () { window.location.hash = '#/events/' + eventId + '?tab=log&focus=' + el.getAttribute('data-goto-log'); };
  });

  var textarea = document.getElementById('fChatMessage');
  var suggestBox = document.getElementById('chatSuggestBox');
  var staged = { users: [], participants: [], logs: [], screenshots: [] };
  var currentTrigger = null; // {kind, start, query}
  var suggestBusy = false; // true while a tab's sections are being rendered/captured -- freezes re-triggering
  var pendingCaptureContainer_ = null;
  var captureToken = 0; // bumped on every dismiss/new trigger so a stale async capture can't resurrect the dropdown

  function cleanupPendingCapture_() {
    if (pendingCaptureContainer_ && pendingCaptureContainer_.parentNode) pendingCaptureContainer_.remove();
    pendingCaptureContainer_ = null;
  }
  function hideSuggest_() {
    captureToken++;
    suggestBox.style.display = 'none';
    suggestBox.innerHTML = '';
    currentTrigger = null;
    suggestBusy = false;
    cleanupPendingCapture_();
  }

  function detectChatTrigger_(text, cursor) {
    var start = cursor;
    while (start > 0 && !/\s/.test(text[start - 1])) start--;
    var token = text.slice(start, cursor);
    if (/^\/u/i.test(token)) return { kind: 'user', start: start, query: token.slice(2).toLowerCase() };
    if (/^\/e/i.test(token)) return { kind: 'log', start: start, query: token.slice(2).toLowerCase() };
    if (/^\/p/i.test(token)) return { kind: 'participant', start: start, query: token.slice(2).toLowerCase() };
    if (/^#/.test(token)) return { kind: 'tab', start: start, query: token.slice(1).toLowerCase() };
    return null;
  }

  function filterItems_(items, query, textFn) {
    if (!query) return items;
    return items.filter(function (it) { return textFn(it).toLowerCase().indexOf(query) !== -1; });
  }

  function replaceTriggerText_(insertText) {
    if (!currentTrigger) return;
    var text = textarea.value;
    var end = textarea.selectionStart;
    var before = text.slice(0, currentTrigger.start);
    var after = text.slice(end);
    textarea.value = before + insertText + after;
    var newPos = (before + insertText).length;
    textarea.focus();
    textarea.setSelectionRange(newPos, newPos);
  }

  function showSuggestList_(header, items, renderItemFn, onPick) {
    suggestBox.innerHTML = '<div class="chat-suggest-header">' + esc(header) + '</div>' +
      (items.length
        ? items.slice(0, 20).map(function (it, i) { return '<div class="chat-suggest-item" data-idx="' + i + '">' + renderItemFn(it) + '</div>'; }).join('')
        : '<div class="chat-suggest-empty">' + esc(t('no_suggestion_matches')) + '</div>');
    suggestBox.style.display = '';
    suggestBox.querySelectorAll('.chat-suggest-item').forEach(function (el) {
      // mousedown (not click) + preventDefault -- keeps the textarea focused/its selection intact so
      // replaceTriggerText_ still has the right cursor position; a plain click would blur the
      // textarea first and lose it.
      el.addEventListener('mousedown', function (e) {
        e.preventDefault();
        onPick(items[Number(el.getAttribute('data-idx'))]);
      });
    });
  }

  function chipHtml_(kind, idx, label) {
    return '<span class="badge-neutral" style="display:inline-flex;align-items:center;gap:6px;padding:3px 8px;border-radius:999px;font-size:11.5px;margin:3px 6px 0 0;">' +
      esc(label) + ' <button type="button" data-kind="' + kind + '" data-unstage="' + idx + '" style="border:none;background:none;cursor:pointer;color:var(--text-400);font-size:12px;line-height:1;padding:0;">' + ICON('close_modal') + '</button></span>';
  }
  function renderChips_() {
    var chipsBox = document.getElementById('chatStagedChips');
    var chips = [];
    staged.users.forEach(function (u, i) { chips.push(chipHtml_('users', i, '@' + u.name)); });
    staged.participants.forEach(function (p, i) { chips.push(chipHtml_('participants', i, '@' + p.name)); });
    staged.logs.forEach(function (l, i) { chips.push(chipHtml_('logs', i, '# ' + l.label)); });
    staged.screenshots.forEach(function (s, i) { chips.push(chipHtml_('screenshots', i, ICON('capture_photo') + ' ' + s.label)); });
    chipsBox.innerHTML = chips.join('');
    chipsBox.querySelectorAll('[data-unstage]').forEach(function (btn) {
      btn.onclick = function () {
        staged[btn.getAttribute('data-kind')].splice(Number(btn.getAttribute('data-unstage')), 1);
        renderChips_();
      };
    });
  }

  function pickUser_(item) {
    if (!staged.users.some(function (x) { return x.id === item.id; })) staged.users.push({ id: item.id, name: item.name });
    replaceTriggerText_('@' + item.name + ' ');
    renderChips_(); hideSuggest_();
  }
  function pickParticipant_(item) {
    if (!staged.participants.some(function (x) { return x.id === item.id; })) staged.participants.push({ id: item.id, name: item.name });
    replaceTriggerText_('@' + item.name + ' ');
    renderChips_(); hideSuggest_();
  }
  function pickLog_(item) {
    if (!staged.logs.some(function (x) { return x.id === item.id; })) staged.logs.push({ id: item.id, label: item.action });
    replaceTriggerText_('#' + item.action + ' ');
    renderChips_(); hideSuggest_();
  }

  // REQ: "# will suggest tab and when selected sections will be suggested, add Tab as option."
  // Renders the chosen tab off-screen (position:fixed, NOT display:none, which would break canvas/
  // map sizing) and lists "Whole tab" plus its top-level .card blocks as "sections", reusing
  // whatever card-title each one already has. The rendered container is kept alive (not removed)
  // until a section is picked or the picker is cancelled, since picking captures straight from it.
  //
  // BUG (REQ report): "I tried the # to capture overview --> zones map but the capture was not the
  // same." The off-screen container used to render at a hardcoded width:900px regardless of how
  // wide the tab actually is on the user's real screen -- for width-driven content like the
  // Overview zone map (its Leaflet fitBounds zoom depends on the container's real pixel size), that
  // mismatch changed what got captured vs. what the user was looking at. Rendering at `content`'s
  // own live width (the real, currently-visible tab content area every tab shares) instead makes
  // the off-screen copy match what's really on screen.
  function pickTab_(tb) {
    var myToken = ++captureToken;
    suggestBusy = true;
    suggestBox.innerHTML = '<div class="chat-suggest-header">' + esc(tb.label) + '</div><div class="chat-suggest-empty">' + esc(t('loading_sections')) + '</div>';
    cleanupPendingCapture_();
    var liveWidth = Math.round(content.getBoundingClientRect().width) || 900;
    var container = document.createElement('div');
    container.style.cssText = 'position:fixed;top:0;left:-9999px;width:' + liveWidth + 'px;background:#fff;padding:16px;';
    document.body.appendChild(container);
    pendingCaptureContainer_ = container;
    var renderFn = eventTabRenderers_()[tb.key];
    Promise.resolve(renderFn ? renderFn(container, eventId, detail, {}) : null)
      .then(function () { return new Promise(function (r) { setTimeout(r, 700); }); }) // let maps/async paints settle
      .then(function () {
        if (myToken !== captureToken) return; // dismissed or superseded while this was in flight
        suggestBusy = false;
        var cards = Array.from(container.querySelectorAll('.card'));
        var sections = [{ index: -1, label: t('whole_tab_label') }].concat(cards.map(function (card, i) {
          var titleEl = card.querySelector('.card-title');
          return { index: i, label: titleEl ? titleEl.textContent.trim() : t('section_n_label', { n: i + 1 }) };
        }));
        showSuggestList_(t('choose_a_section_header', { tab: tb.label }), sections, function (s) { return esc(s.label); }, function (s) { pickSection_(tb, s); });
      })
      .catch(function () {
        if (myToken !== captureToken) return;
        suggestBusy = false;
        suggestBox.innerHTML = '<div class="chat-suggest-header">' + esc(tb.label) + '</div><div class="chat-suggest-empty">' + esc(t('could_not_load_sections')) + '</div>';
      });
  }

  // REQ: "...a screenshot will be captured and added as large thumbnail image." section.index === -1
  // is the "Whole tab" entry pickTab_ pins first -- captures the whole off-screen container instead
  // of a single .card within it.
  function pickSection_(tb, section) {
    var myToken = ++captureToken;
    suggestBusy = true;
    suggestBox.innerHTML = '<div class="chat-suggest-header">' + esc(t('capturing_label')) + '</div>';
    var container = pendingCaptureContainer_;
    var target = section.index === -1 ? container : (container ? container.querySelectorAll('.card')[section.index] : null);
    var capturePromise = (target && typeof html2canvas === 'function')
      ? html2canvas(target, { useCORS: true, logging: false, backgroundColor: '#ffffff' })
      : Promise.reject(new Error('Screenshot capture is unavailable right now.'));
    capturePromise
      .then(function (canvas) { return new Promise(function (res) { canvas.toBlob(res, 'image/png'); }); })
      .then(function (blob) { return fileToBase64(blob); })
      .then(function (b64) { return Api.call('uploadChatScreenshot', { fileBase64: b64, fileName: 'section.png', mimeType: 'image/png' }); })
      .then(function (up) {
        if (myToken !== captureToken) return;
        staged.screenshots.push({ url: up.url, label: tb.label + ' — ' + section.label });
        replaceTriggerText_('#' + tb.label + '/' + section.label + ' ');
        renderChips_();
        hideSuggest_();
      })
      .catch(function (err) {
        console.error('[Event Chat] section screenshot failed', err);
        if (myToken !== captureToken) return;
        UI.toast(t('toast_screenshot_capture_failed_section'), 'error');
        hideSuggest_();
      })
      .finally(function () { cleanupPendingCapture_(); });
  }

  textarea.addEventListener('input', function () {
    if (suggestBusy) return; // a tab->section capture is in flight -- ignore further typing until it resolves
    var trig = detectChatTrigger_(textarea.value, textarea.selectionStart);
    if (!trig) { hideSuggest_(); return; }
    currentTrigger = trig;
    if (trig.kind === 'user') {
      showSuggestList_(t('tag_a_user_header'), filterItems_(taggableUsers, trig.query, function (u) { return u.name + ' ' + u.role; }),
        function (u) { return '<strong>' + esc(u.name) + '</strong> <span class="muted">' + esc(u.role) + '</span>'; }, pickUser_);
    } else if (trig.kind === 'participant') {
      showSuggestList_(t('tag_a_x_header', { term: Term('participant').toLowerCase() }), filterItems_(taggableParticipants, trig.query, function (p) { return p.name + ' ' + p.type; }),
        function (p) { return '<strong>' + esc(p.name) + '</strong> <span class="muted">' + esc(p.type) + '</span>'; }, pickParticipant_);
    } else if (trig.kind === 'log') {
      showSuggestList_(t('reference_log_entry_header'), filterItems_(logEntries, trig.query, function (l) { return l.action + ' ' + l.actorName; }),
        function (l) { return esc(l.action) + ' <span class="muted">— ' + esc(l.actorName) + ' · ' + esc(UI.fmtDate(l.timestamp)) + '</span>'; }, pickLog_);
    } else if (trig.kind === 'tab') {
      showSuggestList_(t('attach_screenshot_header'), filterItems_(tabPickerItems, trig.query, function (tb) { return tb.label; }),
        function (tb) { return esc(tb.label); }, pickTab_);
    }
  });
  textarea.addEventListener('keydown', function (e) { if (e.key === 'Escape') { hideSuggest_(); closeEmojiPopover_(); } });
  textarea.addEventListener('blur', function () { setTimeout(function () { if (!suggestBusy) hideSuggest_(); }, 150); });

  // REQ: "Add the ability to add icon libraries, and emoji libraries for event chats." Two source
  // libraries behind one button -- EMOJI_LIBRARY (emoji.js, expressive emoji) and ICON_LIBRARY
  // (icons.js, the same curated set Settings > Icons already draws from) as two tabs. Unlike the
  // slash-command suggest box above (which replaces a typed trigger and closes on pick), this
  // inserts at wherever the cursor currently is and deliberately stays open after each pick so
  // several emoji/icons can be added in a row -- closing only via the explicit close button, Escape,
  // or a click outside the popover.
  var emojiBtn = document.getElementById('chatEmojiBtn');
  var emojiPopover = document.getElementById('chatEmojiPopover');
  var emojiPopoverBody = document.getElementById('chatEmojiPopoverBody');

  function insertAtCursor_(text) {
    var start = textarea.selectionStart, end = textarea.selectionEnd;
    var val = textarea.value;
    textarea.value = val.slice(0, start) + text + val.slice(end);
    var newPos = start + text.length;
    textarea.focus();
    textarea.setSelectionRange(newPos, newPos);
  }

  // Emoji only (EMOJI_LIBRARY, emoji.js) -- ICON_LIBRARY (icons.js) used to have a second tab here,
  // but it now holds Lucide SVG markup rather than single characters, and a vector icon can't be
  // "typed" into a plain-text chat message the way an emoji can, so that source was dropped.
  function renderEmojiPopoverBody_() {
    var groups = EMOJI_LIBRARY.map(function (g) { return { title: g.category, glyphs: g.emojis }; });
    emojiPopoverBody.innerHTML = groups.map(function (g) {
      return '<div class="chat-emoji-category-title">' + esc(g.title) + '</div>' +
        '<div class="chat-emoji-grid">' +
          g.glyphs.map(function (gl) { return '<button type="button" class="chat-emoji-opt">' + gl + '</button>'; }).join('') +
        '</div>';
    }).join('');
    emojiPopoverBody.querySelectorAll('.chat-emoji-opt').forEach(function (btn) {
      // mousedown (not click) + preventDefault -- same reasoning as the slash-command suggest list
      // above: keeps the textarea focused with its selection intact so insertAtCursor_ still has the
      // right cursor position, instead of losing it to the button's own click-triggered blur.
      btn.addEventListener('mousedown', function (e) { e.preventDefault(); insertAtCursor_(btn.textContent); });
    });
  }

  function openEmojiPopover_() {
    hideSuggest_(); // never show both popovers at once
    renderEmojiPopoverBody_();
    emojiPopover.style.display = '';
  }
  function closeEmojiPopover_() { emojiPopover.style.display = 'none'; }

  emojiBtn.onclick = function () {
    if (emojiPopover.style.display === 'none') openEmojiPopover_(); else closeEmojiPopover_();
  };
  document.getElementById('chatEmojiPopoverClose').onclick = closeEmojiPopover_;
  // A per-tab-visit document click listener (not one registered once at app bootstrap, unlike e.g.
  // the notification panel's own outside-click handler in app.js) -- this popover only exists while
  // the Chat tab itself is on screen, torn down the moment content.innerHTML is replaced by any other
  // render. Self-removes the first time it fires after that happens (emojiPopover no longer attached)
  // instead of leaking one stray listener per Chat-tab visit for the rest of the session.
  document.addEventListener('click', function outsideEmojiClick_(e) {
    if (!document.body.contains(emojiPopover)) { document.removeEventListener('click', outsideEmojiClick_); return; }
    if (emojiPopover.style.display === 'none') return;
    if (emojiPopover.contains(e.target) || e.target === emojiBtn) return;
    closeEmojiPopover_();
  });

  document.getElementById('sendChatBtn').onclick = async function () {
    var message = textarea.value.trim();
    if (!message) { UI.toast(t('toast_message_empty'), 'error'); return; }
    try {
      await Api.call('postEventChatMessage', {
        eventId: eventId, message: message,
        mentionedUserIds: staged.users.map(function (u) { return u.id; }),
        mentionedParticipantIds: staged.participants.map(function (p) { return p.id; }),
        logRefIds: staged.logs.map(function (l) { return l.id; }),
        screenshotUrls: staged.screenshots.map(function (s) { return s.url; })
      });
      Router.resolve();
    } catch (err) { UI.error(err); }
  };
}

function chatMessageHtml_(m) {
  var mentionsHtml = m.mentionedUsers.concat(m.mentionedParticipants).length
    ? '<div style="margin-top:6px;">' + m.mentionedUsers.map(function (u) {
        return '<span class="badge-neutral" style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;margin:2px 4px 0 0;">@' + esc(u.name) + '</span>';
      }).join('') + m.mentionedParticipants.map(function (p) {
        return '<span class="badge-neutral" style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;margin:2px 4px 0 0;">@' + esc(p.name) + '</span>';
      }).join('') + '</div>'
    : '';
  var logRefsHtml = m.logRefs.length
    ? '<div style="margin-top:6px;">' + m.logRefs.map(function (l) {
        return '<span data-goto-log="' + esc(l.id) + '" style="display:inline-block;cursor:pointer;color:var(--accent);text-decoration:underline;font-size:11.5px;margin:2px 8px 0 0;">' +
          ICON('forward_link') + ' ' + esc(l.action || t('log_entry_fallback')) + '</span>';
      }).join('') + '</div>'
    : '';
  // REQ: "...added as large thumbnail image."
  var screenshotsHtml = (m.screenshotUrls && m.screenshotUrls.length)
    ? '<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:8px;">' + m.screenshotUrls.map(function (url) {
        return '<a href="' + esc(url) + '" target="_blank" rel="noopener"><img src="' + esc(url) + '" style="max-width:320px;max-height:220px;border:1px solid var(--border);border-radius:8px;display:block;" /></a>';
      }).join('') + '</div>'
    : '';
  return '<div style="padding:10px 0;border-bottom:1px solid #f0f1f6;">' +
    '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;">' +
    '<strong style="font-size:13px;">' + esc(m.authorName) + '</strong>' +
    '<span class="muted" style="font-size:11px;white-space:nowrap;">' + esc(UI.fmtDate(m.createdAt)) + '</span></div>' +
    '<div style="font-size:13.5px;margin-top:4px;white-space:pre-wrap;">' + esc(m.message) + '</div>' +
    mentionsHtml + logRefsHtml + screenshotsHtml + '</div>';
}

/* ---------------- Event Log ---------------- */
// REQ: "Add an event log page showing all transaction relevant to an event keep last log first.
// Logs can be referenced in event chats." listEventLog (EventChat.gs) already returns newest-first.
// `focus` (from a chat log-reference click, or a bookmarked link) scrolls to and briefly highlights
// that one entry so it's easy to find in a potentially long list.
async function tabEventLog(content, eventId, detail, params) {
  var logs = await Api.call('listEventLog', { eventId: eventId });
  content.innerHTML =
    '<div class="card"><div class="card-header"><div class="card-title">' + esc(t('tab_event_log')) + '</div>' +
    '<div class="muted" style="font-size:11.5px;">' + esc(t('event_log_hint')) + '</div></div>' +
    '<div class="card-body">' +
    (logs.length ? logs.map(eventLogRowHtml_).join('') : '<div class="empty-state">' + t('no_data') + '</div>') +
    '</div></div>';

  var focusId = params && params.focus;
  if (focusId) {
    var row = content.querySelector('[data-log-id="' + focusId + '"]');
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.style.background = '#fff7d6';
      setTimeout(function () { row.style.background = ''; }, 2500);
    }
  }
}

function eventLogRowHtml_(l) {
  var detailsText = '';
  if (l.details) {
    try { var d = JSON.parse(l.details); detailsText = Object.keys(d).length ? JSON.stringify(d) : ''; } catch (e) { detailsText = l.details; }
  }
  return '<div data-log-id="' + esc(l.id) + '" style="padding:9px 0;border-bottom:1px solid #f0f1f6;font-size:12.5px;transition:background 0.4s;">' +
    '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">' +
    '<span><strong>' + esc(l.action) + '</strong> <span class="muted">' + esc(t('by_prefix')) + esc(l.actorName) + '</span></span>' +
    '<span class="muted" style="white-space:nowrap;">' + esc(UI.fmtDate(l.timestamp)) + '</span></div>' +
    (l.targetType ? '<div class="muted" style="font-size:11px;margin-top:2px;">' + esc(l.targetType) + (detailsText ? ' — ' + esc(detailsText) : '') + '</div>' : '') +
    '</div>';
}

/* ---------------- Roadmap ---------------- */
// REQ: "similar [to the Projects timeline] as road map. It reveals every single schedule in an
// event ... starting from Event initiation, meetings, templates sent, then templates evaluated or
// missed, then every scheduled inspection, Then Event start then sub events start, then sub events
// end and event ended." One horizontal line (same visual language as projectTimelineHtml_,
// projects.js) plotting every one of those, oldest to newest. Differs from that Project-level
// timeline in the two ways specifically asked for here: (1) every milestone's date shows along the
// bottom, not just a start day; (2) every milestone's own detail label shows permanently above its
// dot too, not just the single one nearest "now" -- crowded labels get bumped to a higher "level"
// with a leader line back down to their dot instead of overlapping (wireEventRoadmap_ below, run
// after the browser has actually laid out the real, already-ellipsis-truncated label widths).
var ROADMAP_LEVEL_BASE_PX_ = 14, ROADMAP_LEVEL_STEP_PX_ = 26, ROADMAP_LABEL_HALF_PX_ = 64;

async function tabRoadmap(content, eventId, detail) {
  var results = await Promise.all([
    Api.call('getEventTemplates', { eventId: eventId }),
    Api.call('listMeetings', { eventId: eventId }),
    Api.call('listInspections', { eventId: eventId }),
    // REQ: "the PM must create the event management plan, they call it Roadmap ... configure how it
    // will rollout." The admin-defined plan template's already-materialized, dated items for THIS
    // event (RoadmapPlans.gs) -- plotted onto the same timeline as everything else here, plus a
    // dedicated checklist card below it (roadmapChecklistHtml_) since, unlike every other milestone
    // on this tab, these are actionable (a PM can mark them Done, add one ad hoc, or fix a date).
    Api.call('listEventRoadmapItems', { eventId: eventId })
  ]);
  var templates = results[0], meetings = results[1], inspections = results[2], roadmapItems = results[3];
  var milestones = eventRoadmapMilestones_(detail, templates, meetings, inspections, roadmapItems);
  var canManageItems = hasPermission('roadmapItem.manage');

  content.innerHTML =
    '<div class="card" style="padding:16px 20px;">' +
    '<div class="card-title">' + esc(t('tab_roadmap')) + '</div>' +
    '<div class="muted" style="font-size:11.5px;margin-top:2px;">' + esc(t('roadmap_subtitle')) + '</div>' +
    eventRoadmapHtml_(milestones) +
    '</div>' +
    roadmapChecklistHtml_(roadmapItems, detail.event, canManageItems);

  wireEventRoadmap_(content);
  wireRoadmapChecklist_(content, eventId, roadmapItems, canManageItems);
}

// ---- Roadmap Plan checklist (per-event rolled-out items) ------------------
// REQ: "configure how it will rollout" -- separate from the read-only timeline above (which just
// plots dates), this card is where a PM actually WORKS the plan: tick items off, fix a date that
// drifted, add something specific to this one event, or re-sync every date after the event's own
// start/end changed (Regenerate). See RoadmapPlans.gs's rolloutEventRoadmap_ for how these rows are
// generated/kept in sync in the first place.
// REQ follow-up: "Add 'Planned Date' in a column, and when checked add 'Actual Date' of check in a
// column." -- was a single stacked date per row; now a real table with its own Planned Date/Actual
// Date columns, same UI.table helper every other list page in this app uses (toolbar:false since this
// is a compact per-event checklist, not a primary list page -- no search/sort/export needed, though
// pagination still kicks in for free past 10 rows, same as everywhere else).
function roadmapChecklistHtml_(items, event, canManage) {
  var sorted = (items || []).slice().sort(function (a, b) { return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime(); });
  var rowsHtml = sorted.length
    ? UI.table([
        { key: 'status', label: '', sortable: false, exportable: false, render: r => roadmapItemCheckCellHtml_(r) },
        { key: 'name', label: t('field_item_name'), render: r => roadmapItemNameCellHtml_(r) },
        { key: 'dueAt', label: t('col_due_date'), render: r => roadmapItemPlannedDateCellHtml_(r) },
        { key: 'completedAt', label: t('roadmap_actual_date_label'), render: r => roadmapItemActualDateCellHtml_(r) },
        // REQ: "if attachment is requirement check will not accept unless attachment or link to the
        // attachment or link to report in the system is provided." -- surfaces the current state
        // (has one / still required / not applicable) so a PM can see what's blocking a checkbox
        // before they even click it, see roadmapItemAttachmentCellHtml_ below.
        { key: 'attachmentUrl', label: t('roadmap_attachment_col'), sortable: false, exportable: false, render: r => roadmapItemAttachmentCellHtml_(r) }
      ].concat(canManage ? [{ key: 'actions', label: t('actions'), render: r =>
          UI.actionsCell(
            '<button type="button" class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('action_edit')) + '" data-edit-item="' + esc(r.id) + '">' + ICON('edit') + '</button>' +
            '<button type="button" class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('action_delete')) + '" data-delete-item="' + esc(r.id) + '">' + ICON('delete') + '</button>') }] : []),
        sorted, { toolbar: false })
    : '<div class="muted" style="font-size:12px;padding:8px 4px;">' + esc(event.planTypeId ? t('roadmap_no_items_yet') : t('roadmap_no_plan_assigned')) + '</div>';

  return '<div class="card" style="padding:16px 20px;margin-top:16px;">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">' +
      '<div>' +
        '<div class="card-title">' + esc(t('roadmap_plan_section_title')) + '</div>' +
        '<div class="muted" style="font-size:11.5px;margin-top:2px;">' + esc(t('roadmap_plan_section_subtitle')) + '</div>' +
      '</div>' +
      (canManage ? '<div style="display:flex;gap:8px;flex:none;">' +
        (event.planTypeId ? '<button type="button" class="btn btn-secondary btn-sm" id="regenRoadmapBtn" title="' + esc(t('roadmap_regenerate_hint')) + '">' + ICON('roadmap_regenerate') + ' ' + esc(t('roadmap_regenerate_btn')) + '</button>' : '') +
        '<button type="button" class="btn btn-primary btn-sm" id="addRoadmapItemBtn">' + esc(t('roadmap_add_item_btn')) + '</button>' +
      '</div>' : '') +
    '</div>' +
    '<div style="margin-top:10px;">' + rowsHtml + '</div>' +
  '</div>';
}

function roadmapItemCheckCellHtml_(item) {
  var done = item.status === 'Done';
  return '<button type="button" class="roadmap-item-check' + (done ? ' done' : '') + '" data-toggle-done="' + esc(item.id) + '" title="' + esc(done ? t('roadmap_mark_pending_title') : t('roadmap_mark_done_title')) + '">' +
    (done ? ICON('checklist_done') : ICON('checklist_pending')) +
  '</button>';
}

function roadmapItemNameCellHtml_(item) {
  var done = item.status === 'Done';
  return '<span class="roadmap-item-name' + (done ? ' done' : '') + '">' + esc(item.name) + '</span>';
}

function roadmapItemPlannedDateCellHtml_(item) {
  return '<span class="roadmap-item-date' + (item.overdue ? ' overdue' : '') + '">' + esc(UI.fmtDate(item.dueAt)) +
    (item.overdue ? ' · ' + esc(t('roadmap_overdue_badge')) : '') + '</span>';
}

// REQ: "when checked add 'Actual Date' of check." Blank until the item is actually marked Done --
// completedAt is stamped by updateEventRoadmapItem (RoadmapPlans.gs) the moment the checkbox in the
// status column is toggled on, so this is just displaying data that already exists rather than
// needing anything new from the backend.
function roadmapItemActualDateCellHtml_(item) {
  if (item.status !== 'Done' || !item.completedAt) return '<span class="muted">—</span>';
  return '<span class="roadmap-item-date actual">' + esc(UI.fmtDate(item.completedAt)) + '</span>';
}

// REQ: "allow to choose whether an attachment is required, if attachment is requirement check will
// not accept unless attachment or link to the attachment or link to report in the system is
// provided." -- three states: a link/file already on record (clickable), required but still
// missing (blocks the Done toggle, see wireRoadmapChecklist_), or not applicable to this item.
function roadmapItemAttachmentCellHtml_(item) {
  if (item.attachmentUrl) {
    return '<a href="' + esc(item.attachmentUrl) + '" target="_blank" rel="noopener noreferrer" class="roadmap-item-attachment-link" title="' + esc(item.attachmentName || item.attachmentUrl) + '">' +
      ICON('roadmap_attachment') + ' ' + esc(t('roadmap_view_attachment')) + '</a>';
  }
  if (item.requiresAttachment) {
    return '<span class="badge badge-high">' + esc(t('roadmap_attachment_required_badge')) + '</span>';
  }
  return '<span class="muted">—</span>';
}

function wireRoadmapChecklist_(content, eventId, items, canManage) {
  if (!canManage) return;
  var itemsById = {}; (items || []).forEach(function (it) { itemsById[it.id] = it; });

  var addBtn = content.querySelector('#addRoadmapItemBtn');
  if (addBtn) addBtn.onclick = function () { openAddRoadmapItemModal_(eventId); };

  var regenBtn = content.querySelector('#regenRoadmapBtn');
  if (regenBtn) regenBtn.onclick = async function () {
    try { await Api.call('generateEventRoadmap', { eventId: eventId }); UI.toast(t('toast_roadmap_regenerated'), 'success'); Router.resolve(); }
    catch (err) { UI.error(err); }
  };

  content.querySelectorAll('[data-toggle-done]').forEach(function (btn) {
    btn.onclick = async function () {
      var itemId = btn.getAttribute('data-toggle-done');
      var done = !btn.classList.contains('done');
      var item = itemsById[itemId];
      // REQ: "if attachment is requirement check will not accept unless attachment or link ... is
      // provided." -- server-side updateEventRoadmapItem (RoadmapPlans.gs) enforces this either way,
      // but intercepting here means the PM is prompted for the link/file right away instead of just
      // seeing a rejected-toast with no obvious next step.
      if (done && item && item.requiresAttachment && !item.attachmentUrl) {
        openRoadmapAttachmentGateModal_(eventId, item);
        return;
      }
      try { await Api.call('updateEventRoadmapItem', { itemId: itemId, done: done }); Router.resolve(); }
      catch (err) { UI.error(err); }
    };
  });
  content.querySelectorAll('[data-edit-item]').forEach(function (btn) {
    btn.onclick = function () {
      var itemId = btn.getAttribute('data-edit-item');
      openEditRoadmapItemModal_(itemsById[itemId] || { id: itemId, name: '', dueAt: '' });
    };
  });
  content.querySelectorAll('[data-delete-item]').forEach(function (btn) {
    btn.onclick = function () {
      var itemId = btn.getAttribute('data-delete-item');
      UI.confirmModal(t('roadmap_delete_item_confirm'), async function () {
        try { await Api.call('deleteEventRoadmapItem', { itemId: itemId }); UI.toast(t('toast_deleted'), 'success'); Router.resolve(); }
        catch (err) { UI.error(err); }
      });
    };
  });
}

// REQ: "if attachment is requirement check will not accept unless attachment or link to the
// attachment or link to report in the system is provided." -- popped instead of the direct toggle
// call whenever a requiresAttachment item without one on file is checked off. PM can either paste a
// URL (an external file, or a link to a report/page already in HULUL -- indistinguishable from this
// form's perspective, both are just a URL) or upload a file straight from here (reuses the same
// fileToBase64 + Drive-upload plumbing as Template Library/Evidence, see uploadRoadmapItemAttachment,
// RoadmapPlans.gs). Either way this closes the loop by setting attachmentUrl AND done:true in one
// call, so updateEventRoadmapItem's server-side gate (the real enforcement) sees a request that
// already satisfies its own requirement.
function openRoadmapAttachmentGateModal_(eventId, item) {
  var body =
    '<div class="muted" style="font-size:12px;margin-bottom:10px;">' + esc(t('roadmap_attachment_gate_hint')) + '</div>' +
    UI.field(t('roadmap_attachment_link_label'), '<input id="fRmGateUrl" class="field-input" placeholder="https://..." />') +
    '<div class="muted" style="font-size:11px;margin:10px 0;text-align:center;">' + esc(t('roadmap_attachment_or_divider')) + '</div>' +
    UI.field(t('roadmap_attachment_file_label'), '<input type="file" id="fRmGateFile" class="field-input" />');
  UI.openModal(t('roadmap_attachment_gate_title'), body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('roadmap_mark_done_title'), className: 'btn-primary', onClick: async function () {
        var url = document.getElementById('fRmGateUrl').value.trim();
        var fileInput = document.getElementById('fRmGateFile');
        var file = fileInput.files[0];
        if (!url && !file) { UI.toast(t('roadmap_attachment_required_error'), 'error'); return; }
        try {
          var attachmentUrl = url, attachmentName = url;
          if (file) {
            var up = await Api.call('uploadRoadmapItemAttachment', { eventId: eventId, fileBase64: await fileToBase64(file), fileName: file.name, mimeType: file.type });
            attachmentUrl = up.url; attachmentName = up.fileName;
          }
          await Api.call('updateEventRoadmapItem', { itemId: item.id, attachmentUrl: attachmentUrl, attachmentName: attachmentName, done: true });
          UI.closeModal(); UI.toast(t('toast_saved'), 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      } }
  ]);
}

// Ad hoc item added directly on this one Event -- sourceItemId stays blank server-side, so a
// Regenerate never touches it (see rolloutEventRoadmap_, RoadmapPlans.gs). requiresAttachment is
// settable here too (task #150) since the same enforcement rule should apply to an ad hoc item just
// as much as a plan-template one -- otherwise a PM could dodge the rule by adding items by hand.
function openAddRoadmapItemModal_(eventId) {
  var body =
    UI.field(t('field_item_name'), '<input id="fRmName" class="field-input" maxlength="120" />') +
    UI.field(t('col_due_date'), '<input id="fRmDue" type="datetime-local" class="field-input" />') +
    '<label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;margin:14px 0 4px;">' +
      '<input type="checkbox" id="fRmRequiresAttachment" /> ' + esc(t('roadmap_requires_attachment_label')) +
    '</label>' +
    '<div class="muted" style="font-size:11px;margin:0;">' + esc(t('roadmap_requires_attachment_hint')) + '</div>';
  UI.openModal(t('roadmap_add_item_title'), body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('create'), className: 'btn-primary', onClick: async function () {
        var name = document.getElementById('fRmName').value.trim();
        var dueAt = document.getElementById('fRmDue').value;
        if (!name) { UI.toast(t('field_item_name'), 'error'); return; }
        if (!dueAt) { UI.toast(t('col_due_date'), 'error'); return; }
        try {
          await Api.call('addEventRoadmapItem', { eventId: eventId, name: name, dueAt: dueAt, requiresAttachment: document.getElementById('fRmRequiresAttachment').checked });
          UI.closeModal(); UI.toast(t('toast_added'), 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      } }
  ]);
}

// requiresAttachment + the attachment link/file itself are both editable here too, so a PM can
// attach evidence ahead of time (without going through the Done-toggle gate modal above) or fix a
// wrong link/re-upload a replacement file after the fact.
function openEditRoadmapItemModal_(item) {
  var body =
    UI.field(t('field_item_name'), '<input id="fERmName" class="field-input" maxlength="120" value="' + esc(item.name) + '" />') +
    UI.field(t('col_due_date'), '<input id="fERmDue" type="datetime-local" class="field-input" value="' + esc(normalizeDateTimeLocal(item.dueAt)) + '" />') +
    '<label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;margin:14px 0 4px;">' +
      '<input type="checkbox" id="fERmRequiresAttachment"' + (item.requiresAttachment ? ' checked' : '') + ' /> ' + esc(t('roadmap_requires_attachment_label')) +
    '</label>' +
    '<div class="muted" style="font-size:11px;margin:0 0 12px;">' + esc(t('roadmap_requires_attachment_hint')) + '</div>' +
    UI.field(t('roadmap_attachment_link_label'), '<input id="fERmAttachmentUrl" class="field-input" placeholder="https://..." value="' + esc(item.attachmentUrl || '') + '" />') +
    '<div class="muted" style="font-size:11px;margin:-4px 0 10px;">' + esc(t('roadmap_attachment_or_divider')) + '</div>' +
    UI.field(t('roadmap_attachment_file_label'), '<input type="file" id="fERmAttachmentFile" class="field-input" />');
  UI.openModal(t('roadmap_edit_item_title'), body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('save'), className: 'btn-primary', onClick: async function () {
        var name = document.getElementById('fERmName').value.trim();
        var dueAt = document.getElementById('fERmDue').value;
        if (!name) { UI.toast(t('field_item_name'), 'error'); return; }
        var patch = { itemId: item.id, name: name, requiresAttachment: document.getElementById('fERmRequiresAttachment').checked };
        if (dueAt) patch.dueAt = dueAt;
        try {
          var fileInput = document.getElementById('fERmAttachmentFile');
          var file = fileInput.files[0];
          if (file) {
            var up = await Api.call('uploadRoadmapItemAttachment', { eventId: item.eventId, fileBase64: await fileToBase64(file), fileName: file.name, mimeType: file.type });
            patch.attachmentUrl = up.url; patch.attachmentName = up.fileName;
          } else {
            var urlVal = document.getElementById('fERmAttachmentUrl').value.trim();
            if (urlVal !== (item.attachmentUrl || '')) { patch.attachmentUrl = urlVal; patch.attachmentName = urlVal; }
          }
          await Api.call('updateEventRoadmapItem', patch);
          UI.closeModal(); UI.toast(t('toast_saved'), 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      } }
  ]);
}

// Every scheduling milestone this Event has, unsorted-in/sorted-out oldest to newest. Each entry:
// {ms, colorClass, big, type, label}. `type` is the semantic kind (used for the legend's "only show
// what's actually present" filter, roadmapLegendHtml_ below) -- distinct from `colorClass` since a
// couple of types deliberately share a color (Template Evaluated reuses the same green as Event
// Start, Template Missed reuses the same red as Event End -- "good outcome" / "bad outcome" reads the
// same way at a glance either way). Anything without a usable date on record (a Sub-Event never given
// dates, a Template never sent, etc.) is simply skipped -- same "no date, no dot" rule
// projectTimelineHtml_ (projects.js) already applies at the Project level.
function eventRoadmapMilestones_(detail, templates, meetings, inspections, roadmapItems) {
  var out = [];
  function add(iso, colorClass, big, type, label, icon) {
    var ms = new Date(iso).getTime();
    if (isNaN(ms)) return;
    out.push({ ms: ms, colorClass: colorClass, big: !!big, type: type, label: label, icon: icon || '' });
  }

  add(detail.event.createdAt, 'tl-dot-gray', false, 'init', t('roadmap_ms_event_initiated', { term: Term('event') }));
  add(detail.event.startDateTime, 'tl-dot-green', true, 'eventStart', t('roadmap_ms_event_start', { term: Term('event') }));
  add(detail.event.endDateTime, 'tl-dot-red', true, 'eventEnd', t('roadmap_ms_event_end', { term: Term('event') }));

  (detail.subEvents || []).forEach(function (s) {
    add(s.startDateTime, 'tl-dot-teal', false, 'subEvent', t('roadmap_ms_subevent_start', { name: s.name }));
    add(s.endDateTime, 'tl-dot-teal', false, 'subEvent', t('roadmap_ms_subevent_end', { name: s.name }));
  });

  (meetings || []).forEach(function (m) {
    add(m.scheduledAt, 'tl-dot-purple', false, 'meeting', m.type || Term('meeting'));
  });

  (templates || []).forEach(function (tpl) {
    if (tpl.sentAt) add(tpl.sentAt, 'tl-dot-blue', false, 'templateSent', t('roadmap_ms_template_status', { name: tpl.name, status: t('status_sent') }));
    if (tpl.reviewedAt && tpl.status === 'Evaluated') add(tpl.reviewedAt, 'tl-dot-green', false, 'templateEvaluated', t('roadmap_ms_template_status', { name: tpl.name, status: t('status_evaluated') }));
    if (tpl.reviewedAt && tpl.status === 'Missed') add(tpl.reviewedAt, 'tl-dot-red', false, 'templateMissed', t('roadmap_ms_template_status', { name: tpl.name, status: t('status_missed') }));
  });

  (inspections || []).forEach(function (insp) {
    add(insp.scheduledAt, 'tl-dot-amber', false, 'inspection', t('roadmap_ms_inspection', { discipline: insp.disciplineName, term: Term('inspection') }));
  });

  // Roadmap Plan items -- REQ: "configure how it will rollout." Done/Overdue reuse the same green/
  // red "good/bad outcome" dots the rest of this line already uses (template evaluated/missed above);
  // still-Pending-and-not-yet-due ones get their own color (tl-dot-indigo) so they're visually
  // distinct from those two outcomes while a PM still has to act on them.
  (roadmapItems || []).forEach(function (it) {
    var colorClass = it.status === 'Done' ? 'tl-dot-green' : it.overdue ? 'tl-dot-red' : 'tl-dot-indigo';
    var type = it.status === 'Done' ? 'roadmapDone' : it.overdue ? 'roadmapOverdue' : 'roadmapPending';
    var statusLabel = it.status === 'Done' ? t('status_done') : it.overdue ? t('roadmap_overdue_badge') : t('status_pending');
    // REQ: "Allow to change dot to icon per item only in Roadmap Plans" -- icon is defined on the
    // plan-template item and copied down read-only at rollout (rolloutEventRoadmap_, RoadmapPlans.gs),
    // so it.icon here just reflects whatever the admin picked; ad hoc items never have one.
    add(it.dueAt, colorClass, false, type, t('roadmap_ms_item', { name: it.name, status: statusLabel }), it.icon);
  });

  return out.sort(function (a, b) { return a.ms - b.ms; });
}

// The line itself: track, one dot/leader/label/date group per milestone, positioned by pct only --
// the label/leader's actual height (level) is worked out afterwards in wireEventRoadmap_, once real
// (already CSS-ellipsis-truncated) label widths exist to measure. `title` on both the dot and the
// label carries the FULL untruncated text + date, same "shorten visually, keep it one hover away"
// pattern as the Projects timeline's own dot tooltips.
function eventRoadmapHtml_(milestones) {
  if (!milestones.length) return '<div class="muted" style="font-size:12px;margin-top:10px;">' + esc(t('no_data')) + '</div>';

  var lo = milestones[0].ms, hi = milestones[milestones.length - 1].ms;
  var span = Math.max(hi - lo, 1);
  var pad = Math.max(span * 0.06, 60 * 60 * 1000); // at least an hour of lead-in/out on a very short event
  var axisLo = lo - pad, axisSpan = (hi + pad) - (lo - pad);
  function pct(ms) { return ((ms - axisLo) / axisSpan) * 100; }
  function dateTimeText(ms) {
    var d = new Date(ms);
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) + ', ' +
      d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  var seenDayKeys = {};
  var leadersHtml = '', dotsHtml = '', labelsHtml = '', datesHtml = '';
  milestones.forEach(function (m, i) {
    var p = pct(m.ms).toFixed(3);
    var fullTitle = esc(m.label + ' — ' + dateTimeText(m.ms));
    leadersHtml += '<div class="rm-leader" data-for="' + i + '" style="left:' + p + '%;height:' + ROADMAP_LEVEL_BASE_PX_ + 'px;"></div>';
    // REQ: "Allow to change dot to icon per item only in Roadmap Plans" -- when the rolled-out item's
    // template defined an icon (roadmapPlanItemRowHtml_/openRoadmapPlanItemModal_, roadmapPlans.js),
    // render it centered inside the dot instead of a plain filled circle; tl-dot-icon (styles.css)
    // switches the dot to an outlined ring using the same status color via currentColor/border, since
    // a filled circle would hide the icon glyph.
    dotsHtml += '<div class="tl-dot ' + m.colorClass + (m.big ? ' tl-dot-big' : '') + (m.icon ? ' tl-dot-icon' : '') + '" style="left:' + p + '%;" title="' + fullTitle + '">' + (m.icon || '') + '</div>';
    labelsHtml += '<div class="rm-label" data-idx="' + i + '" data-pct="' + p + '" style="left:' + p + '%;bottom:' + (13 + ROADMAP_LEVEL_BASE_PX_) + 'px;" title="' + fullTitle + '">' + esc(m.label) + '</div>';
    // Dates are day-granularity only (like projectTimelineHtml_'s own date labels) -- several
    // same-day milestones (a morning meeting, an afternoon inspection) collapse into the one date
    // label so the bottom row doesn't just repeat the same day over and over.
    var d = new Date(m.ms);
    var dayKey = d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
    if (!seenDayKeys[dayKey]) {
      seenDayKeys[dayKey] = true;
      datesHtml += '<div class="tl-date-label" style="right:calc(' + (100 - p) + '% + 6px);">' +
        esc(d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })) + '</div>';
    }
  });

  return '<div class="roadmap-timeline">' +
    '<div class="roadmap-track"></div>' + leadersHtml + dotsHtml + labelsHtml + datesHtml +
    '</div>' + roadmapLegendHtml_(milestones);
}

// One legend chip per milestone TYPE actually present on this Event's line (not one per milestone) --
// same "only show what's actually on the line" principle projectStatsChipsHtml_ (projects.js) uses.
var ROADMAP_LEGEND_TYPES_ = [
  ['init', 'tl-dot-gray', 'legend_rm_init'],
  ['eventStart', 'tl-dot-green', 'legend_event_start'], ['eventEnd', 'tl-dot-red', 'legend_event_end'],
  ['subEvent', 'tl-dot-teal', 'legend_rm_subevent'], ['meeting', 'tl-dot-purple', 'legend_rm_meeting'],
  ['templateSent', 'tl-dot-blue', 'legend_rm_template_sent'],
  ['templateEvaluated', 'tl-dot-green', 'legend_rm_template_evaluated'],
  ['templateMissed', 'tl-dot-red', 'legend_rm_template_missed'],
  ['inspection', 'tl-dot-amber', 'legend_rm_inspection'],
  ['roadmapPending', 'tl-dot-indigo', 'legend_rm_roadmap_pending'],
  ['roadmapDone', 'tl-dot-green', 'legend_rm_roadmap_done'],
  ['roadmapOverdue', 'tl-dot-red', 'legend_rm_roadmap_overdue']
];
function roadmapLegendHtml_(milestones) {
  var present = {}; milestones.forEach(function (m) { present[m.type] = true; });
  return '<div class="roadmap-legend">' +
    ROADMAP_LEGEND_TYPES_.filter(function (row) { return present[row[0]]; }).map(function (row) {
      var vars = row[0] === 'init' || row[0] === 'eventStart' || row[0] === 'eventEnd' ? { term: Term('event') } :
        row[0] === 'subEvent' ? { term: Term('subEvent') } : row[0] === 'meeting' ? { term: Term('meeting') } :
        row[0] === 'inspection' ? { term: Term('inspection').toLowerCase() } :
        (row[0] === 'templateSent' || row[0] === 'templateEvaluated' || row[0] === 'templateMissed') ? { term: Term('template') } : {};
      return '<span><span class="tl-legend-dot ' + row[1] + '"></span>' + esc(t(row[2], vars)) + '</span>';
    }).join('') +
  '</div>';
}

// Post-layout pass: now that the browser has actually rendered each (already CSS-ellipsis-truncated)
// .rm-label at its default level-0 height, work out which ones would visually collide and bump the
// later one up to a higher level -- each level taller than the last -- extending that milestone's own
// leader line to match, so it still visibly traces back down to its dot instead of floating free.
// Pure geometry (fixed label half-width + measured container pixel width), not a real per-label text
// measurement, since every label already shares the same fixed max-width (styles.css, .rm-label) --
// good enough to keep them legible without a slower measure/reflow loop per label.
function wireEventRoadmap_(content) {
  var timelineEl = content.querySelector('.roadmap-timeline');
  if (!timelineEl) return;
  var width = timelineEl.getBoundingClientRect().width;
  if (!width) return;
  var labels = Array.prototype.slice.call(content.querySelectorAll('.rm-label'))
    .sort(function (a, b) { return parseFloat(a.getAttribute('data-pct')) - parseFloat(b.getAttribute('data-pct')); });

  var levelRightEdgePx = [];
  var maxLevel = 0;
  labels.forEach(function (el) {
    var pct = parseFloat(el.getAttribute('data-pct'));
    var x = (pct / 100) * width;
    var left = x - ROADMAP_LABEL_HALF_PX_;
    var level = 0;
    while (levelRightEdgePx[level] !== undefined && left < levelRightEdgePx[level]) level++;
    levelRightEdgePx[level] = x + ROADMAP_LABEL_HALF_PX_;
    if (level > maxLevel) maxLevel = level;
    var leaderPx = ROADMAP_LEVEL_BASE_PX_ + level * ROADMAP_LEVEL_STEP_PX_;
    el.style.bottom = (13 + leaderPx) + 'px';
    var leader = content.querySelector('.rm-leader[data-for="' + el.getAttribute('data-idx') + '"]');
    if (leader) leader.style.height = leaderPx + 'px';
  });

  // Crowded milestones pushed labels above the container's default reserved space (styles.css'
  // .roadmap-timeline margin-top) -- grow it so the tallest level's labels don't get visually clipped
  // by whatever sits above this card.
  if (maxLevel > 0) timelineEl.style.marginTop = (70 + maxLevel * ROADMAP_LEVEL_STEP_PX_) + 'px';
}
