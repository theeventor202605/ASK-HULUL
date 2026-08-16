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
  // REQ: "Add an event chat page after overview tab." FINDING_ROLE_PARTICIPANT_ (findings.js) is
  // the existing Vendor/Operator/Exhibitor list -- reused here rather than redeclared.
  ['chat', 'tab_chat', function () { return t('tab_chat'); }, function () { return FINDING_ROLE_PARTICIPANT_.indexOf(HululState.user.role) === -1; }],
  ['templates', 'tab_templates', function () { return t('readiness_x_label', { term: Term('template_plural') }); }],
  ['approval', 'tab_approval', function () { return t('tab_approval'); }],
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
  { key: 'readiness', labelKey: 'tab_group_readiness', tabs: ['templates', 'approval'] },
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
      disciplines: tabDisciplines, inspections: tabInspections, completedChecklists: tabCompletedChecklists, logPhotos: tabLogPhotos, findings: tabFindings,
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
  var detail = await Api.call('getEvent', { eventId: eventId });
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
    '<div class="kpi-grid">' +
      kpiCard('kpi_total', detail.kpi.totalLogs, ICON('kpi_total'), 'var(--info)') +
      kpiCard('kpi_open', detail.kpi.open, ICON('kpi_open'), 'var(--info)') +
      kpiCard('kpi_inreview', detail.kpi.inReview, ICON('kpi_inreview'), 'var(--purple)') +
      kpiCard('kpi_resolved', detail.kpi.resolved, ICON('kpi_resolved'), 'var(--success)') +
      kpiCard('kpi_reopen', detail.kpi.reopened, ICON('kpi_reopen'), 'var(--warning)') +
      kpiCard('kpi_rejected', detail.kpi.rejected, ICON('kpi_rejected'), 'var(--danger)') +
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
    HululLeaflet.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19
    }).addTo(overviewZoneMapInstance_);

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
// Place-type -> map pin color, and the type list itself. Matches Places' own `type` field
// (PLACE_TYPES in venues.js/Places.gs). Read cross-file by ui.js (UI.drawPlaceDots) and
// eventPlaces.js (the Participants map).
var EVENT_PLACE_TYPE_OPTIONS_ = ['Operator', 'Vendor', 'Exhibitor', 'Other'];
var EVENT_PLACE_TYPE_COLORS_ = { Operator: '#4f46e5', Vendor: '#16a34a', Exhibitor: '#d97706', Other: '#2563eb' };

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
function templateActionsHtml_(tpl, uploaderRoles, reviewerRoles, hasDeadline, scoredDocTypes) {
  var role = HululState.user.role;
  // RBAC pilot (backend/Permissions.gs): admin-configurable from Settings > Permissions > Templates >
  // "Send readiness templates to an event".
  var isPM = hasPermission('template.send');
  var isEM = role === 'SystemAdmin' || uploaderRoles.indexOf(role) !== -1;
  var isAnalyst = role === 'SystemAdmin' || reviewerRoles.indexOf(role) !== -1;
  var parts = [];
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
    Api.call('listScoringCatalogSummary', {})
  ]);
  var templates = results[0], processRoles = results[1];
  var scoredDocTypes = results[2].map(function (s) { return s.docType; });
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
    templatesDeadlineCardHtml_(detail.event, canManageDeadline) +
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + esc(t('pipeline_title')) + '</div>' +
    '<div class="muted" style="font-size:11.5px;">' + esc(t('click_card_open_file_hint')) + '</div></div>' +
    '<div class="card-body">' + UI.board(boardColumns) + '</div></div>' +
    '<div class="card"><div class="card-header"><div class="card-title">' + esc(t('readiness_x_label', { term: Term('template_plural').toLowerCase() })) + '</div></div>' +
    '<div class="card-body">' + UI.table([
      { key: 'name', label: t('col_template') },
      { key: 'status', label: t('status'), render: r => UI.statusBadge(r.status) },
      { key: 'fileName', label: t('col_file'), render: r => r.fileUrl ? '<a href="' + r.fileUrl + '" target="_blank" data-open-template="' + r.id + '" style="color:var(--accent);">' + esc(r.fileName || t('word_view')) + '</a>' : '—' },
      { key: 'updatedAt', label: t('col_updated'), render: r => r.updatedAt ? UI.fmtDate(r.updatedAt) : '—' },
      { key: 'reviewReason', label: t('col_review_notes'), render: r => r.reviewReason ? esc(r.reviewReason) : '—' },
      { key: 'actions', label: t('actions'), render: r => templateActionsHtml_(r, processRoles.uploaderRoles, processRoles.reviewerRoles, !!detail.event.templatesDeadlineAt, scoredDocTypes) }
    ], templates, { emptyText: t('no_templates_in_library_hint', { term: t('field_inspection_company') }) }) + '</div></div>';

  UI.wireBoard(content, function (id) {
    if (id.indexOf('lib:') === 0) { UI.toast(t('toast_not_sent_yet'), 'error'); return; }
    var tpl = templates.filter(function (x) { return x.id === id; })[0];
    if (tpl && tpl.fileUrl) { fireOpenTemplate_(tpl.id); window.open(tpl.fileUrl, '_blank'); }
    else UI.toast(t('toast_no_file_yet'), 'error');
  });

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
  }
}

// REQ: "PM must set one deadline for all documents, by date/time picker or by N weeks/days before
// event start." One event-wide deadline (Events.templatesDeadlineAt), shown to everyone (with a
// live countdown/overdue indicator, same style as Findings' resolution window) but only editable by
// a Project Manager or SystemAdmin -- matches setTemplatesDeadline's backend requireRole. Whichever
// of the two inputs the PM actually fills in wins (see the save handler in tabTemplates); the other
// is just left blank and ignored, no separate mode toggle needed.
function templatesDeadlineCardHtml_(event, canManage) {
  var deadline = event.templatesDeadlineAt;
  var overdue = deadline && new Date(deadline) < new Date();
  var statusHtml = deadline
    ? '<div style="font-size:13px;">' + esc(t('deadline_prefix')) + '<strong>' + esc(UI.fmtDate(deadline)) + '</strong> — ' +
        '<span style="color:' + (overdue ? 'var(--danger)' : 'var(--text-600)') + ';font-weight:600;">' + esc(UI.fmtCountdown(deadline)) + '</span></div>'
    : '<div class="muted" style="font-size:13px;">' + esc(t('no_deadline_set_yet')) + (canManage ? esc(t('set_one_below_suffix')) : '.') + '</div>';

  if (!canManage) {
    return '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + esc(t('documents_deadline_title')) + '</div></div>' +
      '<div class="card-body">' + statusHtml + '</div></div>';
  }
  return '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + esc(t('documents_deadline_title')) + '</div>' +
    '<div class="muted" style="font-size:11.5px;">' + esc(t('one_deadline_hint')) + '</div></div>' +
    '<div class="card-body">' + statusHtml +
    '<div class="form-row" style="margin-top:10px;">' +
      UI.field(t('field_deadline_datetime'), '<input type="datetime-local" id="fTplDeadlineAbs" class="field-input"' + (deadline ? ' value="' + toDatetimeLocalValue_(deadline) + '"' : '') + ' />') +
      UI.field(t('field_or_before_event_start'), '<div style="display:flex;gap:6px;"><input type="number" id="fTplDeadlineN" class="field-input" min="1" placeholder="e.g. 2" style="max-width:90px;" /><select id="fTplDeadlineUnit" class="field-input"><option value="days">' + esc(t('option_days')) + '</option><option value="weeks">' + esc(t('option_weeks')) + '</option></select></div>') +
    '</div>' +
    '<button class="btn btn-primary btn-sm" id="saveTplDeadlineBtn" style="margin-top:8px;">' + esc(t('save_deadline_btn')) + '</button>' +
  '</div></div>';
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

  var [items, results] = await Promise.all([
    Api.call('listTemplateScoringItems', { docType: tpl.docType }),
    Api.call('getTemplateScoringResults', { templateId: templateId })
  ]);

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
      templateScoringProgressHtml_() +
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
          '<button type="button" class="btn btn-secondary btn-sm btn-icon" id="tplScoringImportBtn" title="' + esc(t('import_csv')) + '">' + ICON('import_csv') + '</button>' +
          '<input type="file" id="tplScoringImportInput" accept=".csv" style="display:none;" />' +
        '</div>' +
        '<div class="card-body">' + templateScoringItemsHtml_(items, resultsByItemId) + '</div>' +
        '<div style="display:flex;justify-content:flex-end;gap:8px;padding:14px 20px;border-top:1px solid var(--border);">' +
          '<button class="btn btn-primary" id="saveTplScoringBtn">' + esc(t('save')) + '</button>' +
        '</div>' +
      '</div>' +
    '</div>';

  document.getElementById('backTplScoringBtn').onclick = function () { window.location.hash = '#/events/' + eventId + '?tab=templates'; };
  document.getElementById('saveTplScoringBtn').onclick = async function () {
    try {
      await Api.call('saveTemplateScoring', { templateId: templateId, results: collectTemplateScoringResults_(items) });
      UI.toast(t('toast_scoring_saved'), 'success'); Router.resolve();
    } catch (err) { UI.error(err); }
  };
  document.getElementById('tplScoringExportBtn').onclick = function () { exportTemplateScoringCsv_(tpl, items); };
  document.getElementById('tplScoringImportBtn').onclick = function () { document.getElementById('tplScoringImportInput').click(); };
  document.getElementById('tplScoringImportInput').onchange = function (e) {
    var file = e.target.files[0];
    e.target.value = ''; // reset immediately so re-picking the same file still fires 'change' next time
    if (!file) return;
    UI.confirmModal(t('confirm_import_scoring_answers'), function () { importTemplateScoringCsv_(file, items); });
  };

  wireTemplateScoringRows_(items);
  wireTemplateScoringSectionNav_(sections);
  filterTemplateScoringSection_('');
  updateTemplateScoringProgress_(items);
  updateTemplateScoringSectionNav_(items);
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

function wireTemplateScoringSectionNav_(sections) {
  document.querySelectorAll('.tpl-section-nav-item').forEach(function (nav) {
    nav.onclick = function () { filterTemplateScoringSection_(nav.getAttribute('data-section')); };
  });
}

// sectionCode === '' shows every section (the "All sections" row); anything else hides every
// .tpl-score-section container except the matching one. Containers stay in the DOM either way (just
// display:none) so no on-screen answers, wiring, or scroll position are lost switching between them.
function filterTemplateScoringSection_(sectionCode) {
  document.querySelectorAll('.tpl-score-section').forEach(function (sec) {
    sec.style.display = (!sectionCode || sec.getAttribute('data-section') === sectionCode) ? '' : 'none';
  });
  document.querySelectorAll('.tpl-section-nav-item').forEach(function (nav) {
    var isActive = nav.getAttribute('data-section') === sectionCode;
    nav.classList.toggle('active', isActive);
    nav.style.background = isActive ? 'var(--accent-soft)' : '';
  });
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
  var completeness = result ? result.completeness : '';
  var quality = (result && result.quality !== '' && result.quality != null) ? String(result.quality) : '';
  var completenessBtns = ['Yes', 'No', 'N/A'].map(function (v) {
    return '<button type="button" class="btn btn-secondary btn-icon result-state-btn ' + TPL_COMPLETENESS_STATE_CLASS_[v] + ' doc-completeness-btn' + (completeness === v ? ' active' : '') +
      '" data-item="' + item.id + '" data-value="' + v + '" title="' + esc(t('completeness_' + v.toLowerCase().replace('/', ''))) + '">' + ICON(TPL_COMPLETENESS_ICON_[v]) + '</button>';
  }).join('');
  // Quality (0-4) has its own accent-filled active state -- see .doc-quality-btn.active, styles.css
  // -- same "dim until picked" idea as result-state-btn, just accent-colored since 0-4 isn't a
  // pass/fail choice the way Completeness is.
  var qualityBtns = [0, 1, 2, 3, 4].map(function (q) {
    return '<button type="button" class="btn btn-secondary btn-sm doc-quality-btn' + (quality === String(q) ? ' active' : '') + '" data-item="' + item.id + '" data-value="' + q + '" title="' + esc(t('quality_level_' + q)) + '">' + q + '</button>';
  }).join('');
  return '<div class="tpl-score-row" data-tsi="' + item.id + '" style="border-bottom:1px solid #f0f1f6;padding:10px 0;">' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">' +
      '<div style="flex:1 1 260px;">' +
        '<div style="font-weight:600;font-size:13px;">' + esc(item.description) + '</div>' +
        '<div class="muted" style="font-size:10.5px;margin-top:2px;">' + esc(item.itemCode) + ' · ' + esc(t('field_multiplier')) + ': ' + esc(item.multiplier) + '</div>' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;">' +
        '<div class="muted" style="font-size:10px;">' + esc(t('col_completeness')) + '</div>' +
        '<div class="doc-completeness-group" data-item="' + item.id + '" data-value="' + esc(completeness) + '" style="display:flex;gap:4px;">' + completenessBtns + '</div>' +
        '<div class="muted" style="font-size:10px;margin-top:2px;">' + esc(t('col_quality')) + '</div>' +
        '<div class="doc-quality-group" data-item="' + item.id + '" data-value="' + esc(quality) + '" style="display:flex;gap:3px;">' + qualityBtns + '</div>' +
      '</div>' +
    '</div>' +
    '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">' +
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
      // not an irreversible one" affordance as toggling a single-select checkbox off again.
      var value = group.getAttribute('data-value') === btn.getAttribute('data-value') ? '' : btn.getAttribute('data-value');
      group.setAttribute('data-value', value);
      group.querySelectorAll('.doc-completeness-btn').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-value') === value); });
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
function templateScoringProgressHtml_() {
  return '<div style="display:flex;gap:28px;flex-wrap:wrap;">' +
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
  '</div>';
}

function updateTemplateScoringProgress_(items) {
  var completenessBar = document.getElementById('tplCompletenessBar');
  var qualityBar = document.getElementById('tplQualityBar');
  if (!completenessBar || !qualityBar) return;
  var yes = 0, no = 0, qualityScore = 0, qualityMax = 0;
  items.forEach(function (it) {
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
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + esc(t('identify_applicable_x', { term: Term('discipline_plural').toLowerCase() })) + '</div></div>' +
    '<div class="card-body">' + disciplines.map(function (d) {
      var checked = identifiedIds.indexOf(d.id) !== -1;
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
      { key: 'zoneNames', label: Term('zone_plural'), render: r => (r.zoneNames && r.zoneNames.length) ? esc(r.zoneNames.join(', ')) : '—' },
      { key: 'assignedAt', label: t('col_assigned'), render: r => UI.fmtDate(r.assignedAt) }
    ].concat(canAssign ? [{ key: 'actions', label: t('actions'), render: r => UI.actionsCell('<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('remove_btn')) + '" data-remove-assign="' + r.id + '">' + ICON('delete') + '</button>') }] : []),
      assignments, {}) +
    '</div></div>';

  if (canIdentify) {
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
  discSelect.onchange = loadQualifiedInspectors;
  if (identifiedDisciplines.length) loadQualifiedInspectors();

  document.getElementById('assignBtn').onclick = async function () {
    if (!inspSelect.value) { UI.toast(t('toast_no_qualified_x_selected', { term: Term('inspector').toLowerCase() }), 'error'); return; }
    var zoneIds = Array.from(content.querySelectorAll('.assign-zone-check:checked')).map(c => c.value);
    if (zonesRequired && !zoneIds.length) { UI.toast(t('toast_x_multiple_zones_select_one', { venue: Term('venue').toLowerCase(), zonePlural: Term('zone_plural').toLowerCase() }), 'error'); return; }
    try {
      await Api.call('assignInspector', { eventId: eventId, disciplineId: discSelect.value, inspectorId: inspSelect.value, zoneIds: zoneIds });
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
      await loadQualifiedInspectors();
      inspSelect.value = btn.getAttribute('data-qa-insp');
      var zoneIds = (btn.getAttribute('data-qa-zones') || '').split(',').filter(Boolean);
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
    body = '<div class="muted" style="font-size:13px;">' + ICON('coverage_complete') + ' ' + esc(t('every_discipline_covered')) + (gaps && gaps.zoneMode ? esc(t('across_all_zones_suffix')) : '.') + '</div>';
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
              (canManage && !i.assigned ? '<button class="btn btn-secondary btn-sm" data-qa-disc="' + item.disciplineId + '" data-qa-insp="' + i.id + '" data-qa-zones="' + esc(zoneIdsAttr) + '">' + esc(t('quick_assign_btn')) + '</button>' : '') +
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
function computeInspectionGaps_(assignments, inspections, checklistItems) {
  var scheduledKey = {};
  inspections.forEach(function (i) { scheduledKey[i.disciplineId + '|' + i.inspectorId + '|' + i.phase] = true; });
  var phasesByDiscipline = {};
  checklistItems.forEach(function (c) {
    if (!c.category || !c.phase) return;
    (phasesByDiscipline[c.category] = phasesByDiscipline[c.category] || {})[c.phase] = true;
  });
  var gaps = [];
  assignments.forEach(function (a) {
    var known = phasesByDiscipline[a.disciplineName];
    var relevantPhases = known ? Object.keys(known) : INSPECTION_PHASES_;
    INSPECTION_PHASES_.forEach(function (phase) {
      if (relevantPhases.indexOf(phase) === -1) return; // this discipline has no catalogue items for this phase at all
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
    ? '<div class="muted" style="font-size:13px;">' + ICON('coverage_complete') + ' ' + esc(t('every_x_scheduled_hint', { inspector: Term('inspector').toLowerCase(), inspection: Term('inspection').toLowerCase() })) + '</div>'
    : gaps.map(function (g) {
        return '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid #f0f1f6;font-size:13px;">' +
          '<div><strong>' + esc(g.disciplineName) + '</strong> · ' + esc(g.inspectorName) + ' <span class="muted">— ' + esc(g.phase) + esc(t('not_yet_scheduled_suffix')) + '</span></div>' +
          (canSchedule ? '<button class="btn btn-secondary btn-sm" data-qs-assignment="' + esc(g.assignmentId) + '" data-qs-phase="' + esc(g.phase) + '">' + esc(t('quick_schedule_btn')) + '</button>' : '') +
          '</div>';
      }).join('');
  return '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + esc(t('coverage_gaps_title')) + '</div></div><div class="card-body">' + body + '</div></div>';
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
  var [inspections, assignments, checklistItems] = await Promise.all([
    Api.call('listInspections', { eventId: eventId }),
    Api.call('listInspectorAssignments', { eventId: eventId }),
    Api.call('listChecklistItems', {})
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
    '<div class="card"><div class="card-header"><div class="card-title">' + esc(Term('inspection_plural')) + '</div></div><div class="card-body">' +
    UI.table([
      { key: 'disciplineName', label: Term('discipline') }, { key: 'phase', label: t('col_phase') },
      { key: 'inspectorName', label: Term('inspector') },
      { key: 'scheduledAt', label: t('col_when'), render: r => UI.fmtDate(r.scheduledAt) },
      { key: 'progress', label: t('col_progress'), render: r => r.coverage ? t('progress_fraction', { done: r.coverage.done, total: r.coverage.total, term: Term('participant_plural').toLowerCase() }) : '—' },
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
    if (assignments.length) syncFromAssignment();

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
        assignSelect.value = btn.getAttribute('data-qs-assignment');
        syncFromAssignment();
        phaseSelect.value = btn.getAttribute('data-qs-phase');
        document.getElementById('scheduleBtn').scrollIntoView({ behavior: 'smooth', block: 'center' });
      };
    });
  }

  content.querySelectorAll('[data-record]').forEach(btn => {
    var inspection = inspections.filter(i => i.id === btn.getAttribute('data-record'))[0];
    btn.onclick = () => openChooseParticipantScreen_(content, eventId, inspection, detail && detail.venue);
  });

  content.querySelectorAll('[data-edit-inspection]').forEach(btn => {
    var inspection = inspections.filter(i => i.id === btn.getAttribute('data-edit-inspection'))[0];
    btn.onclick = () => openEditInspectionModal_(eventId, inspection, assignments, assignOptions);
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

  completedChecklistViewMode_(root, eventId, inspection, participant, scope, byType, existingByItemId, canManage);
}

// Read-only rows: description, state, risk/window, and (Crossed only) notes + evidence links -- no
// inputs, nothing to wire beyond the Back/Edit buttons below. Evidence is just a row of plain links
// (opens the original upload in a new tab) rather than the editable form's camera-capture control.
function completedChecklistViewRowHtml_(it, existing) {
  var state = existing ? existing.state : '';
  var stateIcon = state === 'Ticked' ? ICON('result_ticked') : state === 'Crossed' ? ICON('result_crossed') : state === 'N/A' ? ICON('result_na') : '';
  var stateLabel = state === 'Ticked' ? t('title_result_ticked') : state === 'Crossed' ? t('title_result_crossed') : state === 'N/A' ? t('title_result_na') : t('word_pending');
  var evidenceUrls = (existing && existing.evidenceUrls) ? String(existing.evidenceUrls).split(',').filter(Boolean) : [];
  return '<div style="border-bottom:1px solid #f0f1f6;padding:10px 0;">' +
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
          (evidenceUrls.length ? '<div style="margin-top:6px;display:flex;gap:10px;flex-wrap:wrap;">' + evidenceUrls.map(function (url, idx) {
            return '<a href="' + esc(url) + '" target="_blank" rel="noopener" style="color:var(--accent);font-weight:600;text-decoration:none;font-size:11.5px;">' + esc(t('word_evidence')) + ' ' + (idx + 1) + '</a>';
          }).join('') + '</div>' : '') +
        '</div>'
      : '') +
  '</div>';
}

function completedChecklistViewMode_(root, eventId, inspection, participant, scope, byType, existingByItemId, canManage) {
  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + esc(participant.name) + '</div>' +
    '<div class="page-subtitle">' + esc(inspection.disciplineName) + ' · ' + esc(inspection.phase) + '</div></div>' +
    '<button class="btn btn-secondary" id="backCompletedChecklistBtn">' + ICON('back') + ' ' + esc(t('back')) + '</button></div>' +
    '<div class="card">' +
      '<div class="card-body">' +
        Object.keys(byType).sort().map(function (typeName) {
          return '<div style="font-weight:600;font-size:12.5px;color:var(--accent);margin:10px 0 4px;">' + esc(typeName || '(untyped)') + '</div>' +
            byType[typeName].map(function (it) { return completedChecklistViewRowHtml_(it, existingByItemId[it.id]); }).join('');
        }).join('') +
      '</div>' +
      (canManage
        ? '<div style="display:flex;justify-content:flex-end;gap:8px;padding:14px 20px;border-top:1px solid var(--border);">' +
            '<button class="btn btn-primary" id="editChecklistBtn">' + ICON('edit') + ' ' + esc(t('action_edit')) + '</button>' +
          '</div>'
        : '') +
    '</div>';

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
function openEditInspectionModal_(eventId, inspection, assignments, assignOptions) {
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
  var sync = function () {
    var opt = assignSelect.options[assignSelect.selectedIndex];
    discField.value = opt ? (opt.getAttribute('data-discipline') || '') : '';
  };
  if (currentAssignment) assignSelect.value = currentAssignment.id;
  assignSelect.onchange = sync;
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
    HululLeaflet.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19
    }).addTo(liveInspectionMapInstance_);

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
async function openRecordResultsModal(eventId, inspection, participant) {
  var [items, existingResults] = await Promise.all([
    Api.call('listChecklistItems', {}),
    Api.call('listInspectionResults', { inspectionId: inspection.id, participantId: participant.id })
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
    UI.field(t('field_checklist_type'), '<select id="fRecordType" class="field-input">' +
      typeNames.map(function (name) {
        return '<option value="' + esc(name) + '">' + esc(name || '(untyped)') + esc(t('x_done_of_total_suffix', { done: doneOf(byType[name]), total: byType[name].length })) + '</option>';
      }).join('') +
      (typeNames.length > 1 ? '<option value="' + ALL_KEY + '">' + esc(t('all_checklist_types_option')) + esc(t('x_done_of_total_suffix', { done: doneOf(scope), total: scope.length })) + '</option>' : '') +
    '</select>') +
    '<div class="muted" style="font-size:11px;margin-top:8px;">' + esc(t('checklist_type_pick_hint')) + '</div>';

  UI.openModal(t('record_results_for_x_title', { name: participant.name }), body, [
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

  var title = t('record_results_for_x_title', { name: participant.name }) + ' · ' + esc(inspection.disciplineName) + ' (' + esc(inspection.phase) + ')' +
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
  var riskOptions = ['Critical', 'High', 'Medium', 'Low'].map(function (r) {
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

// skipPrepare (optional): true when `file` has already been through EvidenceCapture.prepare() once --
// REQ (Log Photos tab): photos staged there are captured/watermarked at capture time, then handed off
// here when "Create Log" is used; running prepare() again would stamp a second set of logos/QR/GPS
// text on top of the first. Regular camera-capture callers omit this and get the normal behavior.
function uploadEvidenceFile_(eventId, itemId, file, pendingFiles, skipPrepare) {
  var localId = 'ev_' + Date.now() + '_' + Math.random().toString(36).slice(2);
  var entry = { name: file.name, status: 'preparing', pct: 0, url: '', localId: localId, eventId: eventId };
  pendingFiles[itemId].push(entry);
  renderEvidenceList_(itemId, pendingFiles);

  (skipPrepare ? Promise.resolve(file) : EvidenceCapture.prepare(file, eventId)).then(function (readyFile) {
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

function renderEvidenceList_(itemId, pendingFiles) {
  var el = document.querySelector('[data-evlist="' + itemId + '"]');
  if (!el) return;
  el.innerHTML = (pendingFiles[itemId] || []).map(function (f) {
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
      ? Api.call('recordInspectionResults', { inspectionId: inspection.id, participantId: participant.id, results: newResults })
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
  var filename = (participant.name + '-' + inspection.disciplineName + '-' + inspection.phase + '.csv').replace(/[^\w.\-]+/g, '_');
  UI.downloadCsv(filename, [header].concat(body));
}

function printInspectionResults_(participant, inspection, filteredItems) {
  var rows = inspectionResultsSnapshot_(filteredItems);
  var w = window.open('', '_blank', 'width=800,height=900');
  if (!w) { UI.toast(t('toast_allow_popups'), 'error'); return; }
  w.document.write(
    '<!DOCTYPE html><html><head><title>' + esc(participant.name) + ' — ' + esc(inspection.disciplineName) + '</title>' +
    '<meta charset="UTF-8" /><style>' +
      'body{font-family:Arial,Helvetica,sans-serif;padding:24px;color:#111;}' +
      'h2{margin:0 0 4px;} .sub{color:#666;font-size:12px;margin-bottom:16px;}' +
      'table{width:100%;border-collapse:collapse;font-size:12px;} th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top;}' +
      'th{background:#f3f3f3;}' +
    '</style></head><body>' +
      '<h2>' + esc(participant.name) + '</h2>' +
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
 * 8-status workflow (Open -> Viewed -> Submitted -> InReview -> Resolved/ReOpen -> Resubmitted ->
 * Resolved/Rejected); the standalone Resolutions tab that used to live here has been folded into
 * the finding detail page's own Resolve/Accept/Reject actions (see findings.js) and removed.
 */
var FINDING_BOARD_COLUMNS = ['Open', 'Viewed', 'Submitted', 'InReview', 'ReOpen', 'Resubmitted', 'Resolved', 'Rejected'];
// FINDING_BOARD_LABELS (a second, separate hardcoded English label map) used to live here -- removed
// in favor of UI.statusLabel(status), which is the exact same lookup UI.statusBadge itself now uses
// (ui.js), so this board's headers translate for free instead of needing their own copy kept in sync.
var RISK_BORDER_COLOR = { Critical: 'var(--critical)', High: 'var(--danger)', Medium: 'var(--warning)', Low: 'var(--success)' };
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
  var isTerminal = f.status === 'Resolved' || f.status === 'Rejected';
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

async function tabFindings(content, eventId) {
  var findings = await Api.call('listFindings', { eventId: eventId });
  // Same 5-bucket grouping as the backend's findingKpiBuckets_ (Findings.gs) -- Viewed rolls into
  // "open", Submitted/Resubmitted roll into "in review" -- so these 6 KPI cards (which already have
  // dedicated icons) stay accurate without needing 3 more cards for the extra statuses.
  var counts = { Open: 0, InReview: 0, Resolved: 0, ReOpen: 0, Rejected: 0 };
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
  var canCreate = hasPermission('finding.create');
  var canEditAny = hasPermission('finding.edit');
  var canDeleteAny = hasPermission('finding.delete');

  content.innerHTML =
    '<div class="kpi-grid">' +
      kpiCard('kpi_total', findings.length, ICON('kpi_total'), 'var(--info)') +
      kpiCard('kpi_open', counts.Open, ICON('kpi_open'), 'var(--info)') +
      kpiCard('kpi_inreview', counts.InReview, ICON('kpi_inreview'), 'var(--purple)') +
      kpiCard('kpi_resolved', counts.Resolved, ICON('kpi_resolved'), 'var(--success)') +
      kpiCard('kpi_reopen', counts.ReOpen, ICON('kpi_reopen'), 'var(--warning)') +
      kpiCard('kpi_rejected', counts.Rejected, ICON('kpi_rejected'), 'var(--danger)') +
    '</div>' +
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + esc(t('pipeline_title')) + '</div>' +
    '<div class="muted" style="font-size:11.5px;">' + esc(t('click_card_open_log_hint')) + '</div></div>' +
    '<div class="card-body">' + UI.board(boardColumns) + '</div></div>' +
    '<div class="card"><div class="card-header"><div class="card-title">' + t('tab_findings') + '</div>' +
    (canCreate ? '<button class="btn btn-primary btn-sm" id="newFindingBtn">' + esc(t('log_x_btn', { term: Term('finding').toLowerCase() })) + '</button>' : '') + '</div>' +
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
    '<div class="card-body">' + UI.table([
      { key: 'participantName', label: Term('participant') },
      { key: 'disciplineName', label: Term('discipline') }, { key: 'category', label: t('col_checklist_type') },
      { key: 'riskLevel', label: t('col_severity'), render: r => UI.riskBadge(r.riskLevel) },
      { key: 'status', label: t('status'), render: r => UI.statusBadge(r.status) },
      { key: 'description', label: t('field_description') },
      { key: 'actions', label: t('actions'), render: r => {
        var stillEditable = FINDING_EDITABLE_STATUSES_.indexOf(r.status) !== -1;
        var canEdit = canEditAny && stillEditable;
        var canDelete = canDeleteAny && stillEditable;
        return UI.actionsCell(
          '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('title_open_log')) + '" data-finding-view="' + r.id + '">' + ICON('view_open') + '</button> ' +
          (canEdit ? '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('action_edit')) + '" data-finding-edit="' + r.id + '">' + ICON('edit') + '</button> ' : '') +
          (canDelete ? '<button class="btn btn-secondary btn-sm btn-icon btn-danger" title="' + esc(t('action_delete')) + '" data-finding-delete="' + r.id + '">' + ICON('delete') + '</button>' : '')
        );
      } }
    ], findings, {}) + '</div></div>';

  UI.wireBoard(content, function (id) { window.location.hash = '#/events/' + eventId + '/findings/' + id; });

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
    Api.call('listInspections', { eventId: eventId })
  ]);
  var templates = results[0], meetings = results[1], inspections = results[2];
  var milestones = eventRoadmapMilestones_(detail, templates, meetings, inspections);

  content.innerHTML =
    '<div class="card" style="padding:16px 20px;">' +
    '<div class="card-title">' + esc(t('tab_roadmap')) + '</div>' +
    '<div class="muted" style="font-size:11.5px;margin-top:2px;">' + esc(t('roadmap_subtitle')) + '</div>' +
    eventRoadmapHtml_(milestones) +
    '</div>';

  wireEventRoadmap_(content);
}

// Every scheduling milestone this Event has, unsorted-in/sorted-out oldest to newest. Each entry:
// {ms, colorClass, big, type, label}. `type` is the semantic kind (used for the legend's "only show
// what's actually present" filter, roadmapLegendHtml_ below) -- distinct from `colorClass` since a
// couple of types deliberately share a color (Template Evaluated reuses the same green as Event
// Start, Template Missed reuses the same red as Event End -- "good outcome" / "bad outcome" reads the
// same way at a glance either way). Anything without a usable date on record (a Sub-Event never given
// dates, a Template never sent, etc.) is simply skipped -- same "no date, no dot" rule
// projectTimelineHtml_ (projects.js) already applies at the Project level.
function eventRoadmapMilestones_(detail, templates, meetings, inspections) {
  var out = [];
  function add(iso, colorClass, big, type, label) {
    var ms = new Date(iso).getTime();
    if (isNaN(ms)) return;
    out.push({ ms: ms, colorClass: colorClass, big: !!big, type: type, label: label });
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
    dotsHtml += '<div class="tl-dot ' + m.colorClass + (m.big ? ' tl-dot-big' : '') + '" style="left:' + p + '%;" title="' + fullTitle + '"></div>';
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
  ['inspection', 'tl-dot-amber', 'legend_rm_inspection']
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
