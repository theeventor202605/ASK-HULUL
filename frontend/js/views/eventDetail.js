/**
 * HULUL - Event workspace: tabbed view covering EVT/TPL/VAP/DIS/INS/NCF/RES/PAR/RPT modules
 * for a single event. Mirrors the reference UI's tab layout, modernized.
 */
// Each tab's display text: a fixed i18n key, or an entityLabelFn composing one from custom
// terminology (see labels.js) for tabs whose name is built from an object name.
var EVENT_TABS = [
  ['overview', 'tab_overview'],
  ['venue', 'tab_venue', function () { return Term('venue') + ' & ' + Term('zone_plural'); }],
  ['templates', 'tab_templates', function () { return 'Readiness ' + Term('template_plural'); }],
  ['approval', 'tab_approval', function () { return Term('venue') + ' Approval'; }],
  ['disciplines', 'tab_disciplines', function () { return Term('discipline_plural') + ' & ' + Term('inspector_plural'); }],
  ['inspections', 'tab_inspections', function () { return Term('inspection_plural') + ' & ' + Term('checklistItem_plural'); }],
  ['findings', 'tab_findings'],
  ['escalations', 'tab_escalations', function () { return Term('escalation_plural'); }],
  ['participants', 'tab_participants', function () { return Term('participant_plural'); }],
  ['reports', 'tab_reports', function () { return Term('report_plural'); }]
];

async function renderEventDetail(params) {
  var root = document.getElementById('viewRoot');
  var eventId = params.id;
  var detail = await Api.call('getEvent', { eventId: eventId });
  HululState.currentEventId = eventId;
  var activeTab = params.tab || 'overview';

  root.innerHTML =
    '<div class="breadcrumb"><a href="#/events">' + esc(Term('event_plural')) + '</a> / ' + esc(detail.event.name) + '</div>' +
    '<div class="page-header"><div><div class="page-title">' + esc(detail.event.name) + '</div>' +
    '<div class="page-subtitle">' + esc(detail.venue ? detail.venue.name : '') + ' · ' + esc(detail.event.city) + ' · ' +
    UI.fmtDate(detail.event.startDateTime) + ' – ' + UI.fmtDate(detail.event.endDateTime) + '</div></div>' +
    UI.statusBadge(detail.event.status) + '</div>' +
    '<div class="tabbar" id="eventTabbar"></div>' +
    '<div id="eventTabContent"></div>';

  var tabbar = document.getElementById('eventTabbar');
  tabbar.innerHTML = EVENT_TABS.map(function (tb) {
    var label = tb[2] ? tb[2]() : t(tb[1]);
    return '<div class="tab-btn ' + (tb[0] === activeTab ? 'active' : '') + '" data-tab="' + tb[0] + '">' + esc(label) + '</div>';
  }).join('');
  tabbar.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.onclick = function () { window.location.hash = '#/events/' + eventId + '?tab=' + btn.getAttribute('data-tab'); };
  });

  var content = document.getElementById('eventTabContent');
  var renderers = {
    overview: tabOverview, venue: tabVenue, templates: tabTemplates, approval: tabApproval,
    disciplines: tabDisciplines, inspections: tabInspections, findings: tabFindings,
    escalations: tabEscalations, participants: tabParticipants, reports: tabReports
  };
  content.innerHTML = '<div class="empty-state">' + t('loading') + '</div>';
  try { await (renderers[activeTab] || tabOverview)(content, eventId, detail); }
  catch (err) { UI.error(err); content.innerHTML = '<div class="empty-state">Failed to load this tab.</div>'; }
}

/* ---------------- Overview ---------------- */
async function tabOverview(content, eventId, detail) {
  content.innerHTML =
    '<div class="kpi-grid">' +
      kpiCard('kpi_total', detail.kpi.totalLogs, ICON('kpi_total'), 'var(--info)') +
      kpiCard('kpi_open', detail.kpi.open, ICON('kpi_open'), 'var(--info)') +
      kpiCard('kpi_inreview', detail.kpi.inReview, ICON('kpi_inreview'), '#7c3aed') +
      kpiCard('kpi_resolved', detail.kpi.resolved, ICON('kpi_resolved'), 'var(--success)') +
      kpiCard('kpi_reopen', detail.kpi.reopened, ICON('kpi_reopen'), 'var(--warning)') +
      kpiCard('kpi_rejected', detail.kpi.rejected, ICON('kpi_rejected'), 'var(--danger)') +
    '</div>' +
    '<div class="card"><div class="card-header"><div class="card-title">' + esc(Term('event') + ' details') + '</div></div><div class="card-body">' +
      infoRow('Code', detail.event.code) + infoRow('Project', detail.event.project) +
      infoRow('EMC', detail.event.emcId) + infoRow('Inspection Company', detail.event.inspectionCoId) +
      infoRow('Event Manager', detail.event.eventManagerId) +
      infoRow(Term('subEvent_plural'), detail.subEvents.length) + infoRow(Term('zone_plural'), detail.zones.length) +
    '</div></div>';
}
function kpiCard(labelKey, value, icon, color) {
  return '<div class="kpi-card"><div class="kpi-top"><span class="kpi-label">' + t(labelKey) + '</span>' +
    '<span class="kpi-icon" style="background:' + color + '22;">' + icon + '</span></div><div class="kpi-value">' + value + '</div></div>';
}
function infoRow(label, val) {
  return '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0f1f6;font-size:13.5px;">' +
    '<span class="muted">' + esc(label) + '</span><span style="font-weight:600;">' + esc(val || '—') + '</span></div>';
}

/* ---------------- Venue & Zones ---------------- */
// Matches createZone/deleteZone's backend requireRole — only these roles get zone controls.
var ZONE_MANAGE_ROLES = ['SystemAdmin', 'EMCAdmin', 'EMCManager', 'EventManager'];
var EVENT_MAP_DEFAULT_CENTER_ = [24.7136, 46.6753]; // Riyadh -- only used if neither the venue nor any of its places has coordinates
var eventPlacesMapInstance_ = null;
var eventPlacesMarkers_ = {}; // placeId -> Leaflet marker, so a places-list click can re-focus the right dot
var eventPlacesBoundaryLayer_ = null; // the venue's own drawn boundary, shown for reference (read-only)
var eventPlacesZoneLayers_ = []; // each zone's own drawn boundary (read-only) -- see initEventPlacesMap_
// Cycled per zone (by list order) so multiple zone boundaries stay visually distinguishable from
// each other and from the venue's own boundary (indigo, see initEventPlacesMap_) and the place-type
// dot colors (EVENT_PLACE_TYPE_COLORS_ above).
var ZONE_BOUNDARY_COLORS_ = ['#0d9488', '#d97706', '#7c3aed', '#dc2626', '#0891b2', '#65a30d'];

async function tabVenue(content, eventId, detail) {
  var canManage = ZONE_MANAGE_ROLES.indexOf(HululState.user.role) !== -1;
  destroyEventPlacesMap_(); // in case a previous visit to this tab left one behind
  destroyZoneMap_(); // same, for the inline "Add zone" form's own map

  // listPlaces/listParticipants are both open to any authenticated user (same as listZones/
  // listVenues), so these are safe to call unconditionally. Both are keyed off the venue, not the
  // event -- Participants are venue-scoped (see Participants.gs) so the same roster shows here on
  // every Event held at this venue.
  var results = await Promise.all([
    detail.venue ? Api.call('listPlaces', { venueId: detail.venue.id }) : Promise.resolve([]),
    detail.venue ? Api.call('listParticipants', { venueId: detail.venue.id }) : Promise.resolve([])
  ]);
  var places = results[0], participants = results[1];
  var placesWithCoords = places.filter(function (p) { return p.lat !== '' && p.lat != null && p.lng !== '' && p.lng != null; });
  var zonesById = {}; (detail.zones || []).forEach(function (z) { zonesById[z.id] = z; });

  // Per-zone counts for the zones table's calculated columns -- place type counts (Places' reusable
  // catalog: Operator/Vendor/Exhibitor/Other) plus a total Participants count (event-scoped
  // Vendors/Operators/Exhibitors actually assigned to that zone -- a different set from Places).
  var placeCountsByZone = {};
  places.forEach(function (pl) {
    if (!pl.zoneId) return;
    if (!placeCountsByZone[pl.zoneId]) placeCountsByZone[pl.zoneId] = { Operator: 0, Vendor: 0, Exhibitor: 0, Other: 0 };
    if (placeCountsByZone[pl.zoneId][pl.type] !== undefined) placeCountsByZone[pl.zoneId][pl.type]++;
  });
  var participantCountByZone = {};
  participants.forEach(function (pt) {
    if (!pt.zoneId) return;
    participantCountByZone[pt.zoneId] = (participantCountByZone[pt.zoneId] || 0) + 1;
  });

  content.innerHTML =
    // Venue -- small cards instead of one wide info card, same treatment as the Overview KPIs
    '<div style="font-size:12.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text-600);margin-bottom:10px;">' + esc(Term('venue')) + '</div>' +
    '<div class="kpi-grid">' +
      venueInfoCard_('Name', detail.venue && detail.venue.name) +
      venueInfoCard_('Address', detail.venue && detail.venue.address) +
      venueInfoCard_('City', detail.venue && detail.venue.city) +
    '</div>' +

    // Zones -- with calculated Operators/Vendors/Exhibitors/Others (Places by type) and Participants
    // (total, across all types) columns per zone
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + esc(Term('zone_plural')) + '</div>' +
    (canManage ? '<button class="btn btn-primary btn-sm" id="newZoneBtn">+ Add ' + esc(Term('zone').toLowerCase()) + '</button>' : '') + '</div>' +
    '<div class="card-body">' + UI.table([
      { key: 'name', label: Term('zone') },
      { key: 'operators', label: 'Operators', render: r => (placeCountsByZone[r.id] ? placeCountsByZone[r.id].Operator : 0) },
      { key: 'vendors', label: 'Vendors', render: r => (placeCountsByZone[r.id] ? placeCountsByZone[r.id].Vendor : 0) },
      { key: 'exhibitors', label: 'Exhibitors', render: r => (placeCountsByZone[r.id] ? placeCountsByZone[r.id].Exhibitor : 0) },
      { key: 'others', label: 'Others', render: r => (placeCountsByZone[r.id] ? placeCountsByZone[r.id].Other : 0) },
      { key: 'participants', label: 'Participants', render: r => participantCountByZone[r.id] || 0 },
      { key: 'createdAt', label: 'Created', render: r => UI.fmtDate(r.createdAt) }
    ].concat(canManage ? [{ key: 'actions', label: t('actions'), render: r =>
      '<button class="btn btn-secondary btn-sm btn-icon" title="Edit" data-edit-zone="' + r.id + '">' + ICON('edit') + '</button> ' +
      '<button class="btn btn-secondary btn-sm btn-icon" title="Delete" data-del-zone="' + r.id + '">' + ICON('delete') + '</button>' }] : []),
      detail.zones, {}) +
    '</div></div>' +

    // Populated/cleared by newZoneBtn below -- an inline card (map + polygon-draw tool), not a
    // modal, since "the map needs real room to be usable" (same reasoning as the Add-a-place form).
    '<div id="addZoneCardWrap"></div>' +

    // Large map of every place recorded under this venue -- a dot per place, name labelled above it.
    // Locked to buttons only (zoom controls + the satellite toggle) -- no drag-pan or scroll-zoom.
    (detail.venue ?
      '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">Places map</div>' +
      '<button class="map-toggle-btn" type="button" id="toggleSatelliteBtn">' + ICON('satellite_toggle') + ' Satellite</button></div>' +
      '<div class="card-body">' +
        '<div id="eventPlacesMap" style="height:440px;border-radius:var(--radius-sm);border:1px solid var(--border);"></div>' +
        (places.length && !placesWithCoords.length
          ? '<div class="muted" style="font-size:11.5px;margin-top:8px;">None of this ' + esc(Term('venue').toLowerCase()) + '\'s places have coordinates on record yet.</div>'
          : '') +
      '</div></div>'
      : '') +

    // Places list -- below the zones list; a type filter to the left narrows both this list and
    // the map's dots; clicking a (visible) row focuses the map above on that place
    (detail.venue ?
      '<div class="card"><div class="card-header"><div class="card-title">Places</div></div>' +
      '<div class="card-body" style="display:flex;gap:20px;">' +
        placeTypeFilterHtml_() +
        '<div style="flex:1;min-width:0;">' +
          (places.length ? '<div class="muted" style="font-size:11px;margin-bottom:10px;">Click a place to locate it on the map above.</div>' : '') +
          '<div id="eventPlacesListWrap">' + UI.table([
            { key: 'name', label: 'Name' },
            { key: 'type', label: 'Type' },
            { key: 'zoneId', label: Term('zone'), render: r => zoneDisplayNames_(r.zoneId, zonesById) },
            { key: 'location', label: 'Location', render: r => r.location ? esc(r.location) : '—' }
          ], places, { emptyText: 'No places recorded at this ' + esc(Term('venue').toLowerCase()) + ' yet.' }) + '</div>' +
        '</div>' +
      '</div></div>'
      : '');

  if (canManage) document.getElementById('newZoneBtn').onclick = function () {
    var wrap = document.getElementById('addZoneCardWrap');
    if (wrap.innerHTML) { destroyZoneMap_(); wrap.innerHTML = ''; return; } // toggle closed if already open
    openZoneCard_(detail, wrap, null);
  };

  if (detail.venue) {
    initEventPlacesMap_(detail.venue, placesWithCoords, detail.zones || []);
    if (places.length) {
      content.querySelectorAll('#eventPlacesListWrap tbody tr').forEach(function (tr, i) {
        var pl = places[i];
        if (!pl) return;
        tr.style.cursor = 'pointer';
        tr.onclick = function () { focusEventPlace_(pl); };
      });
    }
    content.querySelectorAll('.place-type-filter').forEach(function (cb) {
      cb.onchange = function () { applyPlaceTypeFilter_(places); };
    });
  }

  if (!canManage) return;
  content.querySelectorAll('[data-del-zone]').forEach(function (b) {
    b.onclick = async function () { openDeleteZoneModal_(b.getAttribute('data-del-zone'), detail.zones); };
  });
  content.querySelectorAll('[data-edit-zone]').forEach(function (b) {
    b.onclick = function () {
      var zone = (detail.zones || []).find(function (z) { return z.id === b.getAttribute('data-edit-zone'); });
      if (!zone) return;
      var wrap = document.getElementById('addZoneCardWrap');
      destroyZoneMap_();
      openZoneCard_(detail, wrap, zone);
      wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
  });
}

function venueInfoCard_(label, value) {
  return '<div class="kpi-card"><div class="kpi-label">' + esc(label) + '</div>' +
    '<div class="kpi-value" style="font-size:16px;">' + esc(value || '—') + '</div></div>';
}

// Same HululLeaflet-alias reasoning as venues.js's map initializers (this app's own labels.js
// clobbers the bare global L). Centers on the venue's own coordinates if it has any, else the
// first place that does, else a sensible fallback -- and fits every place dot, the venue's own
// boundary, AND every zone's own boundary (each if drawn) in view once plotted, so the whole set
// is visible at a sensible zoom on first load. Default Leaflet interactions (drag to pan,
// scroll/pinch to zoom, double-click to zoom) are left on, same as every other map in the app
// (venueMap/placeMap/zoneMap/eventPlaceMap) -- REQ bug report: this map used to lock dragging/
// scroll-zoom out entirely, which read as "the map is broken/stuck".
function initEventPlacesMap_(venue, placesWithCoords, zones) {
  var el = document.getElementById('eventPlacesMap');
  if (!el) return;
  if (typeof HululLeaflet === 'undefined') {
    el.style.display = 'flex'; el.style.alignItems = 'center'; el.style.justifyContent = 'center';
    el.style.color = 'var(--text-600)'; el.style.fontSize = '12px'; el.style.textAlign = 'center'; el.style.padding = '12px';
    el.textContent = 'Map unavailable (couldn\'t load the map library).';
    return;
  }
  var hasVenueCoords = !!(venue.lat && venue.lng);
  var center = hasVenueCoords ? [Number(venue.lat), Number(venue.lng)]
    : (placesWithCoords.length ? [Number(placesWithCoords[0].lat), Number(placesWithCoords[0].lng)] : EVENT_MAP_DEFAULT_CENTER_);
  // BUG (REQ report): "Places map is not showing the boundaries of the venue" -- this map only ever
  // plotted place dots, it never drew the venue's own boundary polygon at all, unlike every other
  // map that shows a venue (venues.js's own venueMap/placeMap, and this same tab's "Add zone" map
  // just below via zoneVenueBoundaryLayer_). parseBoundaryClient_ is defined in venues.js, loaded
  // on the same page.
  var venueBoundary = parseBoundaryClient_(venue.boundary);
  // BUG (REQ report): "When adding a zone and boundaries are set and saved, they disappear in the
  // map" -- a zone's boundary was ONLY ever drawn on the temporary "Add zone" card's own map
  // (zoneMap/initZoneMap_ below) while it's being drawn; saving calls destroyZoneMap_() to close
  // that card, and nothing else in this tab ever plotted a SAVED zone's boundary anywhere -- so it
  // was never actually gone server-side (createZone stores it fine), it just had nowhere left to
  // render. Parsed once here, upfront, same pattern as venueBoundary just above.
  var zoneBoundaries = (zones || []).map(function (z) { return { zone: z, boundary: parseBoundaryClient_(z.boundary) }; })
    .filter(function (zb) { return !!zb.boundary; });
  setTimeout(function () {
    if (!document.getElementById('eventPlacesMap')) return;
    eventPlacesMapInstance_ = HululLeaflet.map('eventPlacesMap')
      .setView(center, (hasVenueCoords || placesWithCoords.length) ? 15 : 6);

    var osmLayer = HululLeaflet.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19
    }).addTo(eventPlacesMapInstance_);
    var satelliteLayer = HululLeaflet.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: '&copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics', maxZoom: 19
    });
    var showingSatellite = false;
    var toggleBtn = document.getElementById('toggleSatelliteBtn');
    if (toggleBtn) toggleBtn.onclick = function () {
      showingSatellite = !showingSatellite;
      if (showingSatellite) { eventPlacesMapInstance_.removeLayer(osmLayer); satelliteLayer.addTo(eventPlacesMapInstance_); toggleBtn.innerHTML = ICON('map_toggle') + ' Map'; }
      else { eventPlacesMapInstance_.removeLayer(satelliteLayer); osmLayer.addTo(eventPlacesMapInstance_); toggleBtn.innerHTML = ICON('satellite_toggle') + ' Satellite'; }
    };

    // Same solid accent-shaded style as venues.js's placeMap (the "add/edit a place" map) -- kept
    // visually consistent since both maps are "a venue's boundary plus its places" views. Read-only
    // here (interactive: false) -- editing the boundary itself only happens from the Venues page.
    if (venueBoundary) {
      var venueBoundaryColor = venue.color || VENUE_BOUNDARY_DEFAULT_COLOR_;
      eventPlacesBoundaryLayer_ = HululLeaflet.polygon(venueBoundary.map(function (pt) { return [pt.lat, pt.lng]; }), {
        color: venueBoundaryColor, fillColor: venueBoundaryColor, fillOpacity: 0.06, weight: 1.5, interactive: false
      }).addTo(eventPlacesMapInstance_);
    }

    eventPlacesMarkers_ = {};
    var bounds = venueBoundary ? venueBoundary.map(function (pt) { return [pt.lat, pt.lng]; }) : [];

    // Each zone's own boundary, cycling through ZONE_BOUNDARY_COLORS_ so several zones stay
    // distinguishable from each other -- a permanent centered label names which zone is which,
    // same idea as place dots' tooltips just below, since hover-only wouldn't let you compare
    // zones at a glance.
    eventPlacesZoneLayers_ = [];
    zoneBoundaries.forEach(function (zb, i) {
      // A zone's own picked color (see the "Boundary color" field on the Add/Edit zone card) wins;
      // only zones predating this feature (blank color) fall back to the auto-cycled palette.
      var color = zb.zone.color || ZONE_BOUNDARY_COLORS_[i % ZONE_BOUNDARY_COLORS_.length];
      var latlngs = zb.boundary.map(function (pt) { return [pt.lat, pt.lng]; });
      var layer = HululLeaflet.polygon(latlngs, { color: color, fillColor: color, fillOpacity: 0.10, weight: 2, interactive: false })
        .addTo(eventPlacesMapInstance_);
      layer.bindTooltip(esc(zb.zone.name), { permanent: true, direction: 'center', className: 'place-marker-tooltip' });
      eventPlacesZoneLayers_.push(layer);
      bounds = bounds.concat(latlngs);
    });

    placesWithCoords.forEach(function (pl) {
      var latlng = [Number(pl.lat), Number(pl.lng)];
      bounds.push(latlng);
      var color = EVENT_PLACE_TYPE_COLORS_[pl.type] || EVENT_PLACE_TYPE_COLORS_.Other;
      var icon = HululLeaflet.divIcon({
        className: 'place-marker-icon', iconSize: [14, 14], iconAnchor: [7, 7],
        html: '<div class="place-marker"><div class="place-marker-dot" style="background:' + color + ';"></div></div>'
      });
      var marker = HululLeaflet.marker(latlng, { icon: icon }).addTo(eventPlacesMapInstance_);
      // A permanently-visible label per dot is what was overlapping when places sit close together --
      // a tooltip only ever shows one name at a time (on hover, or forced open on the focused place).
      marker.bindTooltip(esc(pl.name), { direction: 'top', offset: [0, -10], className: 'place-marker-tooltip' });
      marker.on('click', function () { focusEventPlace_(pl); });
      eventPlacesMarkers_[pl.id] = marker;
    });
    if (bounds.length) eventPlacesMapInstance_.fitBounds(bounds, { padding: [30, 30], maxZoom: 17 });
    setTimeout(function () { if (eventPlacesMapInstance_) eventPlacesMapInstance_.invalidateSize(); }, 150);
  }, 0);
}

function destroyEventPlacesMap_() {
  if (eventPlacesMapInstance_) { eventPlacesMapInstance_.remove(); eventPlacesMapInstance_ = null; }
  eventPlacesBoundaryLayer_ = null;
  eventPlacesZoneLayers_ = [];
  eventPlacesMarkers_ = {};
}

/* ---------------- Add zone (inline card + map, replaces the old name-only modal) ----------------
 * REQ: "When creating zones, allow to draw zone boundary." Shows the venue's own boundary shaded
 * (dashed, read-only, for reference -- reuses parseBoundaryClient_/pointInPolygonClient_ etc. from
 * venues.js, loaded on the same page) and lets the user optionally draw the zone's own boundary
 * inside it with the same Leaflet.draw polygon tool used for venues. Toggled open/closed by
 * newZoneBtn in tabVenue above rather than always shown, since most visits to this tab are just to
 * view the zones list.
 */
var zoneMapInstance_ = null;
var zoneVenueBoundaryLayer_ = null; // the venue's boundary, shown for reference only
var zoneDrawnItems_ = null;         // the zone's own boundary being drawn
var zoneMapGen_ = 0; // same map-container-reuse race guard as venues.js's venueMapGen_ -- see its comment
var zoneMapFullscreenCleanup_ = null;

function addZoneCardHtml_(existingZone) {
  var isEdit = !!existingZone;
  var defaultColor = (existingZone && existingZone.color) ? existingZone.color : ZONE_BOUNDARY_COLORS_[0];
  return '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + (isEdit ? 'Edit ' : 'Add ') + esc(Term('zone').toLowerCase()) + '</div></div>' +
    '<div class="card-body" style="display:flex;flex-direction:column;gap:4px;">' +
      '<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end;max-width:640px;">' +
        '<div style="flex:1;min-width:220px;">' + UI.field(Term('zone') + ' name', '<input id="fZoneName" class="field-input" value="' + (isEdit ? esc(existingZone.name) : '') + '" />') + '</div>' +
        '<div>' + UI.field('Boundary color', '<input id="fZoneColor" type="color" class="field-input" style="width:64px;height:36px;padding:2px;" value="' + esc(defaultColor) + '" />') + '</div>' +
      '</div>' +
      '<div id="zoneMap" style="height:360px;width:100%;border-radius:var(--radius-sm);margin-top:10px;border:1px solid var(--border);"></div>' +
      '<div class="muted" style="font-size:11px;margin-top:6px;">Optional: use the polygon tool on the map to draw this ' + esc(Term('zone').toLowerCase()) + '\'s boundary (the ' + esc(Term('venue').toLowerCase()) + '\'s own boundary is shown dashed, for reference).</div>' +
    '</div>' +
    '<div style="display:flex;justify-content:flex-end;gap:8px;padding:14px 20px;border-top:1px solid var(--border);">' +
      '<button class="btn btn-secondary" id="cancelZoneBtn">' + t('cancel') + '</button>' +
      '<button class="btn btn-primary" id="saveZoneBtn">' + (isEdit ? t('save') : t('create')) + '</button>' +
    '</div>' +
  '</div>';
}

// Shared by both the "+ Add zone" button and each row's Edit-zone button below -- existingZone is
// null for create, the zone row being edited otherwise. Keeps the card HTML/map-init/save-handler
// logic in exactly one place instead of duplicating it per mode.
function openZoneCard_(detail, wrap, existingZone) {
  wrap.innerHTML = addZoneCardHtml_(existingZone);
  initZoneMap_(detail.venue, existingZone);
  document.getElementById('cancelZoneBtn').onclick = function () { destroyZoneMap_(); wrap.innerHTML = ''; };
  document.getElementById('saveZoneBtn').onclick = async function () {
    try {
      var name = document.getElementById('fZoneName').value.trim();
      if (!name) { UI.toast(Term('zone') + ' name is required', 'error'); return; }
      var payload = { name: name, color: getZoneColorValue_(), boundary: getZoneBoundaryValue_() };
      if (existingZone) {
        payload.zoneId = existingZone.id;
        await Api.call('updateZone', payload);
      } else {
        payload.venueId = detail.venue.id;
        await Api.call('createZone', payload);
      }
      destroyZoneMap_();
      UI.toast(Term('zone') + (existingZone ? ' updated' : ' added'), 'success');
      Router.resolve();
    } catch (err) { UI.error(err); }
  };
}

function initZoneMap_(venue, existingZone) {
  var el = document.getElementById('zoneMap');
  if (!el) return;
  if (typeof HululLeaflet === 'undefined') {
    el.style.display = 'flex'; el.style.alignItems = 'center'; el.style.justifyContent = 'center';
    el.style.color = 'var(--text-600)'; el.style.fontSize = '12px'; el.style.textAlign = 'center'; el.style.padding = '12px';
    el.textContent = 'Map unavailable (couldn\'t load the map library) — the zone can still be created without a boundary.';
    return;
  }
  var venueBoundary = venue ? parseBoundaryClient_(venue.boundary) : null;
  var zoneBoundary = existingZone ? parseBoundaryClient_(existingZone.boundary) : null;
  var hasVenueCoords = !!(venue && venue.lat && venue.lng);
  var center = hasVenueCoords ? [Number(venue.lat), Number(venue.lng)] : EVENT_MAP_DEFAULT_CENTER_;
  var myGen = ++zoneMapGen_;
  setTimeout(function () {
    if (myGen !== zoneMapGen_) return; // superseded by a newer render before this tick fired
    var mapEl = document.getElementById('zoneMap');
    if (!mapEl || mapEl._leaflet_id) return; // gone, or (defensive belt-and-suspenders) already claimed
    zoneMapInstance_ = HululLeaflet.map('zoneMap').setView(center, hasVenueCoords ? 16 : 6);
    HululLeaflet.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19
    }).addTo(zoneMapInstance_);
    zoneMapFullscreenCleanup_ = UI.wireMapFullscreen(mapEl, zoneMapInstance_);
    // Wrapped in try/catch -- Leaflet.draw is a third-party plugin (CDN can fail to load, or throw
    // on a Leaflet version it doesn't fully support) and a failure here must never take down the
    // base map (tiles/pan/zoom), which is the part that actually matters for saving a zone at all.
    try {
      if (venueBoundary) {
        zoneVenueBoundaryLayer_ = HululLeaflet.polygon(venueBoundary.map(function (pt) { return [pt.lat, pt.lng]; }), {
          color: '#94a3b8', fillColor: '#94a3b8', fillOpacity: 0.04, weight: 1.5, dashArray: '4,4', interactive: false
        }).addTo(zoneMapInstance_);
        zoneMapInstance_.fitBounds(zoneVenueBoundaryLayer_.getBounds(), { padding: [20, 20] });
      }
      zoneDrawnItems_ = HululLeaflet.featureGroup().addTo(zoneMapInstance_);
      // Edit mode: pre-populate the zone's own already-saved boundary (if any) so it shows up
      // drawn and editable from the start, same as venues.js's initVenueMap_ does for a venue.
      if (zoneBoundary && zoneBoundary.length >= 3) {
        zoneDrawnItems_.addLayer(HululLeaflet.polygon(zoneBoundary.map(function (pt) { return [pt.lat, pt.lng]; })));
        zoneMapInstance_.fitBounds(zoneDrawnItems_.getBounds(), { padding: [20, 20] });
      }
      if (HululLeaflet.Control && HululLeaflet.Control.Draw) {
        var drawControl = new HululLeaflet.Control.Draw({
          draw: { polygon: { allowIntersection: false, showArea: true, shapeOptions: { color: getZoneColorValue_() } }, polyline: false, rectangle: false, circle: false, circlemarker: false, marker: false },
          edit: { featureGroup: zoneDrawnItems_ }
        });
        zoneMapInstance_.addControl(drawControl);
        // Only one zone-boundary polygon is meaningful, so a freshly-drawn one replaces any previous one.
        zoneMapInstance_.on(HululLeaflet.Draw.Event.CREATED, function (e) {
          zoneDrawnItems_.clearLayers();
          zoneDrawnItems_.addLayer(e.layer);
          restyleZoneDrawnItems_();
        });
      }
      restyleZoneDrawnItems_();
      var zoneColorInput = document.getElementById('fZoneColor');
      if (zoneColorInput) zoneColorInput.oninput = function () { restyleZoneDrawnItems_(); };
    } catch (e) {
      console.error('Boundary-drawing tool failed to initialize; the map itself still works.', e);
    }
    setTimeout(function () { if (zoneMapInstance_) zoneMapInstance_.invalidateSize(); }, 150);
  }, 0);
}

// Same pattern as venues.js's getVenueColorValue_/restyleVenueBoundaryLayer_ -- reads the zone
// card's own color picker (falling back to the first palette color if it's somehow not on the
// page) and live-applies it to whatever's currently drawn.
function getZoneColorValue_() {
  var el = document.getElementById('fZoneColor');
  return (el && el.value) || ZONE_BOUNDARY_COLORS_[0];
}

function restyleZoneDrawnItems_() {
  if (!zoneDrawnItems_) return;
  var color = getZoneColorValue_();
  zoneDrawnItems_.eachLayer(function (layer) {
    if (layer.setStyle) layer.setStyle({ color: color, fillColor: color });
  });
}

function destroyZoneMap_() {
  zoneMapGen_++; // invalidate any still-pending initZoneMap_ setTimeout from an earlier render
  if (zoneMapFullscreenCleanup_) { zoneMapFullscreenCleanup_(); zoneMapFullscreenCleanup_ = null; }
  if (zoneMapInstance_) { zoneMapInstance_.remove(); zoneMapInstance_ = null; zoneVenueBoundaryLayer_ = null; zoneDrawnItems_ = null; }
}

// Reads the currently-drawn zone boundary polygon (if any) back into a plain {lat,lng}[] array for
// the createZone payload -- null when nothing's been drawn (zone is created boundary-less).
function getZoneBoundaryValue_() {
  if (!zoneDrawnItems_) return null;
  var layers = zoneDrawnItems_.getLayers();
  if (!layers.length) return null;
  var ring = layers[0].getLatLngs()[0];
  return ring.map(function (ll) { return { lat: ll.lat, lng: ll.lng }; });
}

// Filter panel to the left of the Places list -- Operator/Vendor/Exhibitor/Other, all on by
// default. Matches Places' own `type` field (PLACE_TYPES in venues.js/Places.gs). Each type also
// gets its own map pin color (a swatch next to its checkbox doubles as the legend) -- red is
// reserved for is-focused (see the CSS !important override) so it's never a type's own color.
var EVENT_PLACE_TYPE_OPTIONS_ = ['Operator', 'Vendor', 'Exhibitor', 'Other'];
var EVENT_PLACE_TYPE_COLORS_ = { Operator: '#4f46e5', Vendor: '#16a34a', Exhibitor: '#d97706', Other: '#2563eb' };
function placeTypeFilterHtml_() {
  return '<div style="min-width:120px;flex:none;">' +
    '<div class="field-label" style="margin-top:0;">Filter by type</div>' +
    EVENT_PLACE_TYPE_OPTIONS_.map(function (ty) {
      return '<label style="display:flex;align-items:center;gap:6px;font-size:13px;margin:8px 0;cursor:pointer;">' +
        '<input type="checkbox" class="place-type-filter" value="' + ty + '" checked /> ' +
        '<span class="place-type-swatch" style="background:' + EVENT_PLACE_TYPE_COLORS_[ty] + ';"></span> ' + esc(ty) + '</label>';
    }).join('') +
  '</div>';
}

// Hides/shows both the matching table rows and their map dots together, so the list and the map
// stay in sync -- checking/unchecking a type here is the only thing that changes what's plotted.
function applyPlaceTypeFilter_(places) {
  var enabled = {};
  document.querySelectorAll('.place-type-filter:checked').forEach(function (cb) { enabled[cb.value] = true; });
  var rows = document.querySelectorAll('#eventPlacesListWrap tbody tr');
  rows.forEach(function (tr, i) {
    var pl = places[i];
    if (!pl) return; // the table's own empty-state row when there are no places at all
    var show = !!enabled[pl.type];
    tr.style.display = show ? '' : 'none';
    var marker = eventPlacesMarkers_[pl.id];
    if (marker && eventPlacesMapInstance_) {
      var hasCoords = pl.lat !== '' && pl.lat != null && pl.lng !== '' && pl.lng != null;
      if (show && hasCoords) { if (!eventPlacesMapInstance_.hasLayer(marker)) marker.addTo(eventPlacesMapInstance_); }
      else if (eventPlacesMapInstance_.hasLayer(marker)) { eventPlacesMapInstance_.removeLayer(marker); }
    }
  });
}

// Called from a places-list row click (and from clicking a dot itself) -- pans/zooms the map onto
// that place, highlights its dot, and forces its name tooltip open (closing any other forced-open
// tooltip) so the two lists (map + table) stay visually linked without permanently-shown labels.
function focusEventPlace_(place) {
  if (place.lat === '' || place.lat == null || place.lng === '' || place.lng == null) {
    UI.toast('No coordinates on record for this place', 'error');
    return;
  }
  if (!eventPlacesMapInstance_ || !document.getElementById('eventPlacesMap')) return;
  eventPlacesMapInstance_.flyTo([Number(place.lat), Number(place.lng)], 17, { duration: 0.6 });
  Object.keys(eventPlacesMarkers_).forEach(function (id) {
    var marker = eventPlacesMarkers_[id];
    var isFocused = id === place.id;
    var markerEl = marker.getElement();
    if (markerEl) markerEl.classList.toggle('is-focused', isFocused);
    if (isFocused) marker.openTooltip(); else marker.closeTooltip();
  });
}

// Deleting a zone soft-deletes it (hidden everywhere, but old records still resolve its name).
// If it has assignments/logs tied to it, offer — but don't require — moving that work to another
// active zone in the same venue first.
async function openDeleteZoneModal_(zoneId, allZones) {
  var zone = allZones.filter(function (z) { return z.id === zoneId; })[0];
  var impact;
  try { impact = await Api.call('listZoneImpact', { zoneId: zoneId }); } catch (err) { UI.error(err); return; }

  var otherZones = allZones.filter(function (z) { return z.id !== zoneId; });
  var body = '<div style="font-size:13.5px;line-height:1.6;">';
  if (impact.hasImpact) {
    var parts = [];
    if (impact.assignmentsCount) parts.push(impact.assignmentsCount + ' ' + Term('inspector').toLowerCase() + ' assignment(s)');
    if (impact.logsCount) parts.push(impact.logsCount + ' ' + Term('finding').toLowerCase() + '(s)');
    if (impact.participantsCount) parts.push(impact.participantsCount + ' ' + Term('participant').toLowerCase() + '(s)');
    body += '<div>"' + esc(zone ? zone.name : zoneId) + '" has ' + parts.join(', ') + ' tied to it.</div>' +
      '<div class="muted" style="margin-top:6px;">You can optionally move this to another ' + esc(Term('zone').toLowerCase()) + ', or just delete — nothing breaks either way.</div>';
    if (otherZones.length) {
      body += '<div style="margin-top:12px;">' + UI.field('Move to ' + Term('zone').toLowerCase() + ' (optional)',
        '<select id="fReassignZone" class="field-input"><option value="">Don\'t reassign</option>' +
        otherZones.map(function (z) { return '<option value="' + z.id + '">' + esc(z.name) + '</option>'; }).join('') + '</select>'
      ) + '</div>';
    }
  } else {
    body += '<div>Delete "' + esc(zone ? zone.name : zoneId) + '"? This ' + esc(Term('zone').toLowerCase()) + ' has no assignments or logs tied to it.</div>';
  }
  body += '</div>';

  UI.openModal('Delete ' + Term('zone'), body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: 'Delete', className: 'btn-danger', onClick: async function () {
        try {
          var reassignSelect = document.getElementById('fReassignZone');
          await Api.call('deleteZone', { zoneId: zoneId, reassignToZoneId: reassignSelect ? reassignSelect.value : '' });
          UI.closeModal(); UI.toast('Zone deleted', 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      } }
  ]);
}

/* ---------------- Templates ---------------- */
var TEMPLATE_BOARD_COLUMNS = ['Not Sent', 'Sent', 'In Progress', 'Submitted', 'Under Review', 'Evaluated', 'Missed'];
var TEMPLATE_BOARD_BORDER = {
  'Not Sent': 'var(--border)', 'Sent': 'var(--info)', 'In Progress': 'var(--accent)', 'Submitted': 'var(--info)',
  'Under Review': 'var(--warning)', 'Evaluated': 'var(--success)', 'Missed': 'var(--danger)'
};
// Matches setTemplatesDeadline's backend requireRole — who can set/change the event's one Readiness
// Templates deadline (see tabTemplates below).
var TEMPLATE_DEADLINE_MANAGE_ROLES = ['ProjectManager', 'SystemAdmin'];

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
function templateActionsHtml_(tpl, uploaderRoles, reviewerRoles) {
  var role = HululState.user.role;
  var isPM = role === 'ProjectManager' || role === 'SystemAdmin';
  var isEM = role === 'SystemAdmin' || uploaderRoles.indexOf(role) !== -1;
  var isAnalyst = role === 'SystemAdmin' || reviewerRoles.indexOf(role) !== -1;
  var parts = [];
  if (tpl.status === 'Not Sent' && isPM) {
    parts.push('<button class="btn btn-primary btn-sm btn-icon" title="Send" data-send-template="' + tpl.libraryTemplateId + '">' + ICON('send') + '</button>');
  }
  if (isEM && ['Sent', 'In Progress', 'Missed'].indexOf(tpl.status) !== -1) {
    parts.push('<button class="btn btn-secondary btn-sm btn-icon" title="Upload" data-upload-template="' + tpl.id + '">' + ICON('upload') + '</button>');
    parts.push('<button class="btn btn-primary btn-sm btn-icon" title="Submit" data-submit-template="' + tpl.id + '">' + ICON('submit') + '</button>');
  }
  if (isAnalyst && ['Submitted', 'Under Review'].indexOf(tpl.status) !== -1) {
    parts.push('<button class="btn btn-secondary btn-sm btn-icon" title="Mark evaluated" data-approve-template="' + tpl.id + '">' + ICON('approve') + '</button>');
    parts.push('<button class="btn btn-secondary btn-sm btn-icon" title="Mark missed" data-reject-template="' + tpl.id + '">' + ICON('reject') + '</button>');
  }
  return parts.join(' ') || '—';
}

async function tabTemplates(content, eventId, detail) {
  var results = await Promise.all([
    Api.call('getEventTemplates', { eventId: eventId }),
    Api.call('getTemplateProcessRoles', {})
  ]);
  var templates = results[0], processRoles = results[1];
  var canManageDeadline = TEMPLATE_DEADLINE_MANAGE_ROLES.indexOf(HululState.user.role) !== -1;

  var boardColumns = TEMPLATE_BOARD_COLUMNS.map(function (status) {
    return {
      label: status,
      cards: templates.filter(function (tpl) { return tpl.status === status; }).map(function (tpl) {
        return { id: tpl.id || ('lib:' + tpl.libraryTemplateId), title: tpl.name, meta: tpl.fileName || 'No file yet', borderColor: TEMPLATE_BOARD_BORDER[status] };
      })
    };
  });

  content.innerHTML =
    templatesDeadlineCardHtml_(detail.event, canManageDeadline) +
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">Pipeline</div>' +
    '<div class="muted" style="font-size:11.5px;">Click a card to open its file</div></div>' +
    '<div class="card-body">' + UI.board(boardColumns) + '</div></div>' +
    '<div class="card"><div class="card-header"><div class="card-title">Readiness ' + esc(Term('template_plural').toLowerCase()) + '</div></div>' +
    '<div class="card-body">' + UI.table([
      { key: 'name', label: 'Template' },
      { key: 'status', label: t('status'), render: r => UI.statusBadge(r.status) },
      { key: 'fileName', label: 'File', render: r => r.fileUrl ? '<a href="' + r.fileUrl + '" target="_blank" data-open-template="' + r.id + '" style="color:var(--accent);">' + esc(r.fileName || 'view') + '</a>' : '—' },
      { key: 'updatedAt', label: 'Updated', render: r => r.updatedAt ? UI.fmtDate(r.updatedAt) : '—' },
      { key: 'reviewReason', label: 'Review notes', render: r => r.reviewReason ? esc(r.reviewReason) : '—' },
      { key: 'actions', label: t('actions'), render: r => templateActionsHtml_(r, processRoles.uploaderRoles, processRoles.reviewerRoles) }
    ], templates, { emptyText: 'No templates in the library for this Inspection Company yet.' }) + '</div></div>';

  UI.wireBoard(content, function (id) {
    if (id.indexOf('lib:') === 0) { UI.toast('Not sent to this event yet', 'error'); return; }
    var tpl = templates.filter(function (x) { return x.id === id; })[0];
    if (tpl && tpl.fileUrl) { fireOpenTemplate_(tpl.id); window.open(tpl.fileUrl, '_blank'); }
    else UI.toast('No file yet', 'error');
  });

  content.querySelectorAll('[data-open-template]').forEach(function (a) {
    a.addEventListener('click', function () { fireOpenTemplate_(a.getAttribute('data-open-template')); });
  });
  content.querySelectorAll('[data-send-template]').forEach(function (btn) {
    btn.onclick = async function () {
      try {
        await Api.call('sendTemplates', { eventId: eventId, libraryTemplateIds: [btn.getAttribute('data-send-template')] });
        UI.toast('Sent to Event Manager', 'success'); Router.resolve();
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
        UI.toast('Submitted for review', 'success'); Router.resolve();
      } catch (err) { UI.error(err); }
    };
  });
  content.querySelectorAll('[data-approve-template]').forEach(function (btn) {
    btn.onclick = function () { openReviewTemplateModal_(btn.getAttribute('data-approve-template'), 'Evaluated'); };
  });
  content.querySelectorAll('[data-reject-template]').forEach(function (btn) {
    btn.onclick = function () { openReviewTemplateModal_(btn.getAttribute('data-reject-template'), 'Missed'); };
  });

  if (canManageDeadline) {
    var saveDeadlineBtn = document.getElementById('saveTplDeadlineBtn');
    if (saveDeadlineBtn) saveDeadlineBtn.onclick = async function () {
      var n = document.getElementById('fTplDeadlineN').value;
      var unit = document.getElementById('fTplDeadlineUnit').value;
      var absVal = document.getElementById('fTplDeadlineAbs').value;
      var deadlineAt;
      if (n && Number(n) > 0) {
        if (!detail.event.startDateTime) { UI.toast('This event has no start date set yet', 'error'); return; }
        var offsetMs = Number(n) * (unit === 'weeks' ? 7 : 1) * 24 * 3600 * 1000;
        deadlineAt = new Date(new Date(detail.event.startDateTime).getTime() - offsetMs).toISOString();
      } else if (absVal) {
        deadlineAt = new Date(absVal).toISOString();
      } else {
        UI.toast('Pick a deadline date/time, or enter a number of days/weeks before the event start', 'error');
        return;
      }
      try {
        await Api.call('setTemplatesDeadline', { eventId: eventId, deadlineAt: deadlineAt });
        UI.toast('Deadline saved', 'success'); Router.resolve();
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
    ? '<div style="font-size:13px;">Deadline: <strong>' + esc(UI.fmtDate(deadline)) + '</strong> — ' +
        '<span style="color:' + (overdue ? 'var(--danger)' : 'var(--text-600)') + ';font-weight:600;">' + esc(UI.fmtCountdown(deadline)) + '</span></div>'
    : '<div class="muted" style="font-size:13px;">No deadline set yet' + (canManage ? ' — set one below.' : '.') + '</div>';

  if (!canManage) {
    return '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">Documents deadline</div></div>' +
      '<div class="card-body">' + statusHtml + '</div></div>';
  }
  return '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">Documents deadline</div>' +
    '<div class="muted" style="font-size:11.5px;">One deadline applies to every Readiness Template sent for this event</div></div>' +
    '<div class="card-body">' + statusHtml +
    '<div class="form-row" style="margin-top:10px;">' +
      UI.field('Deadline date & time', '<input type="datetime-local" id="fTplDeadlineAbs" class="field-input"' + (deadline ? ' value="' + toDatetimeLocalValue_(deadline) + '"' : '') + ' />') +
      UI.field('Or: before event start', '<div style="display:flex;gap:6px;"><input type="number" id="fTplDeadlineN" class="field-input" min="1" placeholder="e.g. 2" style="max-width:90px;" /><select id="fTplDeadlineUnit" class="field-input"><option value="days">Days</option><option value="weeks">Weeks</option></select></div>') +
    '</div>' +
    '<button class="btn btn-primary btn-sm" id="saveTplDeadlineBtn" style="margin-top:8px;">Save deadline</button>' +
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
  var body = UI.field('Completed file', '<input type="file" id="fEvtTplFile" class="field-input" />');
  UI.openModal('Upload completed document', body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('save'), className: 'btn-primary', onClick: async function () {
        var fileInput = document.getElementById('fEvtTplFile');
        if (!fileInput.files[0]) { UI.toast('Choose a file first', 'error'); return; }
        try {
          var payload = {
            templateId: templateId, fileBase64: await fileToBase64(fileInput.files[0]),
            fileName: fileInput.files[0].name, mimeType: fileInput.files[0].type
          };
          await Api.call('uploadEventTemplateFile', payload);
          UI.closeModal(); UI.toast('Uploaded', 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      } }
  ]);
}

function openReviewTemplateModal_(templateId, decision) {
  var body = UI.field('Reason', '<textarea id="fReviewReason" class="field-input" rows="3" placeholder="Why is this being ' + decision.toLowerCase() + '?"></textarea>');
  UI.openModal(decision + ' document', body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: decision, className: decision === 'Evaluated' ? 'btn-primary' : 'btn-danger', onClick: async function () {
        var reason = document.getElementById('fReviewReason').value.trim();
        if (!reason) { UI.toast('A reason is required', 'error'); return; }
        try {
          await Api.call('reviewEventTemplate', { templateId: templateId, decision: decision, reason: reason });
          UI.closeModal(); UI.toast('Document ' + decision.toLowerCase(), 'success'); Router.resolve();
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

/* ---------------- Venue Approval ---------------- */
async function tabApproval(content, eventId) {
  var evals = await Api.call('listVenueEvaluations', { eventId: eventId });
  // The 'current' row is this venue's live evaluation (see currentVenueEvaluation_ in
  // VenueApproval.gs) -- older rows are superseded history from a prior, rejected venue and aren't
  // shown here anymore.
  var current = evals.filter(function (e) { return e.status === 'current'; })[0] || null;
  var hasRecommendation = !!(current && current.recommendation);

  // Once a recommendation is on record for this evaluation it's locked -- shown read-only instead
  // of the form, matching recordRecommendation's own one-per-evaluation check server-side.
  var recBody = hasRecommendation
    ? '<div style="font-size:13.5px;line-height:1.6;white-space:pre-wrap;">' + esc(current.recommendation) + '</div>' +
      '<div class="muted" style="font-size:11px;margin-top:8px;">Submitted ' + UI.fmtDate(current.recommendationAt) + ' — a recommendation can only be submitted once.</div>'
    : '<div style="display:flex;flex-direction:column;gap:6px;max-width:560px;">' +
        UI.field('Recommendation', '<textarea id="fRecommendation" class="field-input" rows="3" style="width:100%;box-sizing:border-box;resize:vertical;"></textarea>') +
      '</div>' +
      '<button class="btn btn-primary btn-sm" id="submitRecBtn" style="margin-top:12px;">Submit recommendation</button>';

  content.innerHTML =
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">Record recommendation</div></div>' +
    '<div class="card-body">' + recBody + '</div></div>' +
    // Decision / Decided-on at a glance, to the left of the GA decision card (replaces the old
    // full evaluation-history table -- this evaluation's own status is what matters day to day).
    '<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:stretch;">' +
      '<div class="kpi-card" style="min-width:150px;"><div class="kpi-label">Decision</div>' +
        '<div style="margin-top:6px;">' + (current && current.decision ? UI.statusBadge(current.decision) : '<span class="kpi-value" style="font-size:16px;">—</span>') + '</div></div>' +
      '<div class="kpi-card" style="min-width:150px;"><div class="kpi-label">Decided on</div>' +
        '<div class="kpi-value" style="font-size:16px;">' + (current && current.decisionAt ? UI.fmtDate(current.decisionAt) : '—') + '</div></div>' +
      '<div class="card" style="flex:1;min-width:260px;"><div class="card-header"><div class="card-title">' + esc(Term('venue') + ' decision (GA)') + '</div></div>' +
      '<div class="card-body"><button class="btn btn-secondary btn-sm" id="approveBtn">Approve</button> ' +
      '<button class="btn btn-danger btn-sm" id="rejectBtn">Not Approved</button></div></div>' +
    '</div>';

  if (!hasRecommendation) {
    document.getElementById('submitRecBtn').onclick = async function () {
      var val = document.getElementById('fRecommendation').value.trim();
      if (!val) { UI.toast('Recommendation is required', 'error'); return; }
      try {
        await Api.call('recordRecommendation', { eventId: eventId, recommendation: val });
        UI.toast('Recommendation recorded', 'success'); Router.resolve();
      } catch (err) { UI.error(err); }
    };
  }
  document.getElementById('approveBtn').onclick = () => decide('Approved');
  document.getElementById('rejectBtn').onclick = () => decide('Not Approved');
  async function decide(decision) {
    try { await Api.call('recordVenueDecision', { eventId: eventId, decision: decision }); UI.toast('Decision recorded', 'success'); Router.resolve(); }
    catch (err) { UI.error(err); }
  }
}

/* ---------------- Disciplines & Inspectors ---------------- */
// Only Project Managers (and SystemAdmin) can identify disciplines / assign / unassign
// inspectors — everyone else viewing this tab gets a read-only view of the same data instead
// of controls that would just come back "Not permitted" when clicked.
var DISCIPLINE_MANAGER_ROLES = ['ProjectManager', 'SystemAdmin'];

async function tabDisciplines(content, eventId, detail) {
  var canManage = DISCIPLINE_MANAGER_ROLES.indexOf(HululState.user.role) !== -1;
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
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + esc('Identify applicable ' + Term('discipline_plural').toLowerCase()) + '</div></div>' +
    '<div class="card-body">' + disciplines.map(function (d) {
      var checked = identifiedIds.indexOf(d.id) !== -1;
      var locked = !canManage || (checked && assignedDisciplineIds.indexOf(d.id) !== -1);
      var lockReason = !canManage ? 'Only a Project Manager or System Admin can change this.' : 'An ' + Term('inspector').toLowerCase() + ' is already assigned to this ' + Term('discipline').toLowerCase() + ' — remove that assignment below before it can be unselected.';
      return '<label style="display:inline-flex;align-items:center;gap:6px;margin:4px 12px 4px 0;font-size:13px;' + (locked ? 'opacity:0.65;' : '') + '"' +
        (locked ? ' title="' + lockReason + '"' : '') + '>' +
        '<input type="checkbox" class="disc-check" value="' + d.id + '"' + (checked ? ' checked' : '') + (locked ? ' disabled' : '') + ' /> ' +
        esc(d.name) + (checked && assignedDisciplineIds.indexOf(d.id) !== -1 ? ' ' + ICON('locked_indicator') : '') + '</label>';
    }).join('') +
    (canManage
      ? '<div><button class="btn btn-primary btn-sm" id="saveDiscBtn" style="margin-top:12px;">Save</button></div>' +
        (assignedDisciplineIds.length ? '<div class="muted" style="font-size:11.5px;margin-top:8px;">' + ICON('locked_indicator') + ' An ' + esc(Term('inspector').toLowerCase()) + ' is already assigned — remove the assignment below to unselect.</div>' : '')
      : '<div class="muted" style="font-size:11.5px;margin-top:10px;">Read-only — only a Project Manager or System Admin can change this.</div>') +
    '</div></div>' +
    renderCoverageGapsCard_(gaps, canManage) +
    (canManage
      ? '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">Assign ' + esc(Term('inspector').toLowerCase()) + '</div></div>' +
        '<div class="card-body form-row">' +
          UI.field(Term('discipline'), '<select id="fAssignDisc" class="field-input">' + (disciplineOptions || '<option value="">No ' + esc(Term('discipline_plural').toLowerCase()) + ' identified yet</option>') + '</select>') +
          UI.field('Qualified ' + Term('inspector').toLowerCase(), '<select id="fAssignInsp" class="field-input"></select>') +
        '</div>' +
        (zonesRequired
          ? '<div class="card-body" style="padding-top:0;">' + UI.field(Term('zone_plural') + ' (required — this ' + Term('venue').toLowerCase() + ' has multiple ' + Term('zone_plural').toLowerCase() + ')',
              zones.map(function (z) { return '<label style="display:inline-flex;align-items:center;gap:6px;margin:4px 12px 4px 0;font-size:13px;">' +
                '<input type="checkbox" class="assign-zone-check" value="' + z.id + '" /> ' + esc(z.name) + '</label>'; }).join('')
            ) + '</div>'
          : '') +
        '<div class="card-body" style="padding-top:0;"><button class="btn btn-primary btn-sm" id="assignBtn"' + (identifiedDisciplines.length ? '' : ' disabled') + '>Assign</button></div></div>'
      : '') +
    '<div class="card"><div class="card-header"><div class="card-title">Assignments</div></div><div class="card-body">' +
    UI.table([
      { key: 'disciplineName', label: Term('discipline') }, { key: 'inspectorName', label: Term('inspector') },
      { key: 'zoneNames', label: Term('zone_plural'), render: r => (r.zoneNames && r.zoneNames.length) ? esc(r.zoneNames.join(', ')) : '—' },
      { key: 'assignedAt', label: 'Assigned', render: r => UI.fmtDate(r.assignedAt) }
    ].concat(canManage ? [{ key: 'actions', label: t('actions'), render: r => '<button class="btn btn-secondary btn-sm btn-icon" title="Remove" data-remove-assign="' + r.id + '">' + ICON('delete') + '</button>' }] : []),
      assignments, {}) +
    '</div></div>';

  if (!canManage) return;

  document.getElementById('saveDiscBtn').onclick = async function () {
    var ids = Array.from(content.querySelectorAll('.disc-check:checked')).map(c => c.value);
    try {
      await Api.call('identifyDisciplines', { eventId: eventId, disciplineIds: ids });
      UI.toast(Term('discipline_plural') + ' saved', 'success'); Router.resolve();
    } catch (err) { UI.error(err); }
  };

  var discSelect = document.getElementById('fAssignDisc');
  var inspSelect = document.getElementById('fAssignInsp');
  async function loadQualifiedInspectors() {
    if (!discSelect.value) { inspSelect.innerHTML = ''; return; }
    inspSelect.innerHTML = '<option value="">' + t('loading') + '</option>';
    try {
      var inspectors = await Api.call('listQualifiedInspectors', { disciplineId: discSelect.value, eventId: eventId });
      inspSelect.innerHTML = inspectors.length
        ? inspectors.map(i => '<option value="' + i.id + '">' + esc(i.name) + ' (' + esc(i.email) + ')</option>').join('')
        : '<option value="">No qualified ' + esc(Term('inspector_plural').toLowerCase()) + ' for this ' + esc(Term('discipline').toLowerCase()) + '</option>';
    } catch (err) { UI.error(err); }
  }
  discSelect.onchange = loadQualifiedInspectors;
  if (identifiedDisciplines.length) loadQualifiedInspectors();

  document.getElementById('assignBtn').onclick = async function () {
    if (!inspSelect.value) { UI.toast('No qualified ' + Term('inspector').toLowerCase() + ' selected', 'error'); return; }
    var zoneIds = Array.from(content.querySelectorAll('.assign-zone-check:checked')).map(c => c.value);
    if (zonesRequired && !zoneIds.length) { UI.toast('This ' + Term('venue').toLowerCase() + ' has multiple ' + Term('zone_plural').toLowerCase() + ' — select at least one', 'error'); return; }
    try {
      await Api.call('assignInspector', { eventId: eventId, disciplineId: discSelect.value, inspectorId: inspSelect.value, zoneIds: zoneIds });
      UI.toast(Term('inspector') + ' assigned', 'success'); Router.resolve();
    } catch (err) { UI.error(err); }
  };

  content.querySelectorAll('[data-remove-assign]').forEach(function (b) {
    b.onclick = function () {
      UI.confirmModal('Remove this ' + Term('inspector').toLowerCase() + ' assignment?', async function () {
        try {
          await Api.call('removeInspectorAssignment', { eventId: eventId, assignmentId: b.getAttribute('data-remove-assign') });
          UI.toast('Assignment removed', 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      }, { confirmLabel: 'Remove' });
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
}

// Summarizes listCoverageGaps() into a card: which identified disciplines still have zones (or,
// for a single/no-zone venue, the whole venue) without an assigned inspector, and which
// qualified-but-unassigned Inspectors could fill each gap. Shown to every viewer (it's just
// information), but the "Quick assign" shortcut only appears for roles that can act on it.
function renderCoverageGapsCard_(gaps, canManage) {
  var body;
  if (!gaps || !gaps.items || !gaps.items.length) {
    body = '<div class="muted" style="font-size:13px;">' + ICON('coverage_complete') + ' Every identified discipline is fully covered' + (gaps && gaps.zoneMode ? ' across all zones.' : '.') + '</div>';
  } else {
    body = gaps.items.map(function (item) {
      var whereText = gaps.zoneMode
        ? 'Uncovered ' + esc(Term('zone_plural').toLowerCase()) + ': <strong>' + item.uncoveredZones.map(function (z) { return esc(z.name); }).join(', ') + '</strong>'
        : '<strong>Not yet assigned</strong>';
      var zoneIdsAttr = gaps.zoneMode ? item.uncoveredZones.map(function (z) { return z.id; }).join(',') : '';
      var inspectorsHtml = item.availableInspectors.length
        ? item.availableInspectors.map(function (i) {
            return '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px;background:#f6f7fb;border-radius:8px;margin-top:6px;font-size:12.5px;">' +
              '<span><strong>' + esc(i.name) + '</strong> <span class="muted">' + esc(i.email) + '</span></span>' +
              (canManage ? '<button class="btn btn-secondary btn-sm" data-qa-disc="' + item.disciplineId + '" data-qa-insp="' + i.id + '" data-qa-zones="' + esc(zoneIdsAttr) + '">Quick assign</button>' : '') +
              '</div>';
          }).join('')
        : '<div class="muted" style="font-size:12px;margin-top:6px;">No qualified, unassigned inspectors available for this discipline.</div>';
      return '<div style="padding:10px 0;border-bottom:1px solid #f0f1f6;">' +
        '<div style="font-weight:600;font-size:13.5px;">' + esc(item.disciplineName) + '</div>' +
        '<div style="font-size:12.5px;margin-top:2px;">' + whereText + '</div>' + inspectorsHtml + '</div>';
    }).join('');
  }
  return '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">Coverage gaps</div></div><div class="card-body">' + body + '</div></div>';
}

/* ---------------- Inspections & Checklists ---------------- */
// Scheduling is a Project Manager (or SystemAdmin) action; recording results is the assigned
// Inspector's (or SystemAdmin's) alone. Hiding what a viewer can't actually use avoids the
// "click it, get told Not permitted" dead end — e.g. a GAAdmin/EMCManager browsing this tab
// would otherwise see every inspection's Record results button even though none are theirs.
var INSPECTION_SCHEDULER_ROLES = ['ProjectManager', 'SystemAdmin'];
function canRecordInspection_(r) {
  return HululState.user.role === 'SystemAdmin' || (HululState.user.role === 'Inspector' && r.inspectorId === HululState.user.id);
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
    ? '<div class="muted" style="font-size:13px;">' + ICON('coverage_complete') + ' Every assigned ' + Term('inspector').toLowerCase() + ' has an ' + Term('inspection').toLowerCase() + ' scheduled for every phase their discipline needs.</div>'
    : gaps.map(function (g) {
        return '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid #f0f1f6;font-size:13px;">' +
          '<div><strong>' + esc(g.disciplineName) + '</strong> · ' + esc(g.inspectorName) + ' <span class="muted">— ' + esc(g.phase) + ' not yet scheduled</span></div>' +
          (canSchedule ? '<button class="btn btn-secondary btn-sm" data-qs-assignment="' + esc(g.assignmentId) + '" data-qs-phase="' + esc(g.phase) + '">Quick schedule</button>' : '') +
          '</div>';
      }).join('');
  return '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">Coverage gaps</div></div><div class="card-body">' + body + '</div></div>';
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
  var canSchedule = INSPECTION_SCHEDULER_ROLES.indexOf(HululState.user.role) !== -1;
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
      ? '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">Schedule ' + esc(Term('inspection').toLowerCase()) + '</div></div>' +
        '<div class="card-body form-row">' +
          UI.field('Phase', '<select id="fInsPhase" class="field-input"><option>Opening</option><option>Operational</option></select>') +
          UI.field(Term('inspector'), '<select id="fInsAssignment" class="field-input">' + (assignOptions || '<option value="">No ' + esc(Term('inspector_plural').toLowerCase()) + ' assigned yet</option>') + '</select>') +
        '</div><div class="card-body form-row" style="padding-top:0;">' +
          UI.field(Term('discipline'), '<input id="fInsDisc" class="field-input" readonly />') +
          UI.field('Scheduled at',
            '<input id="fInsWhen" type="datetime-local" class="field-input" />' +
            (eventStart
              ? '<div style="display:flex;align-items:center;gap:6px;margin-top:6px;">' +
                  '<input id="fInsOffsetHours" type="number" min="0" step="0.5" placeholder="Hours" class="field-input" style="width:78px;padding:6px 8px;font-size:12.5px;" />' +
                  '<div class="toggle-pair" id="fInsOffsetDir">' +
                    '<button type="button" class="toggle-pair-btn active" data-dir="before">Before start</button>' +
                    '<button type="button" class="toggle-pair-btn" data-dir="after">After start</button>' +
                  '</div>' +
                '</div>' +
                '<div class="muted" style="font-size:10.5px;margin-top:3px;">Hours relative to the ' + esc(Term('event').toLowerCase()) + '\'s start (' + esc(UI.fmtDate(eventStart)) + ') -- fills in the date/time above automatically.</div>'
              : '')
          ) +
        '</div><div class="card-body" style="padding-top:0;">' +
          '<button class="btn btn-primary btn-sm" id="scheduleBtn"' + (assignments.length ? '' : ' disabled') + '>Schedule</button></div></div>'
      : '') +
    renderInspectionGapsCard_(gaps, canSchedule) +
    '<div class="card"><div class="card-header"><div class="card-title">' + esc(Term('inspection_plural')) + '</div></div><div class="card-body">' +
    UI.table([
      { key: 'disciplineName', label: Term('discipline') }, { key: 'phase', label: 'Phase' },
      { key: 'inspectorName', label: Term('inspector') },
      { key: 'scheduledAt', label: 'When', render: r => UI.fmtDate(r.scheduledAt) },
      { key: 'progress', label: 'Progress', render: r => r.coverage ? (r.coverage.done + ' / ' + r.coverage.total + ' ' + Term('participant_plural').toLowerCase()) : '—' },
      { key: 'status', label: t('status'), render: r => UI.statusBadge(r.status) },
      { key: 'actions', label: t('actions'), render: r => {
          // Edit/Delete are only offered while the inspection is still 'Scheduled' -- once results
          // have been recorded against it, the backend itself refuses both (see updateInspection /
          // deleteInspection in Inspections.gs), so hiding them here avoids a round-trip just to
          // show that error.
          var btns = '';
          if (canSchedule && r.status === 'Scheduled') {
            btns += '<button class="btn btn-secondary btn-sm btn-icon" title="Edit" data-edit-inspection="' + r.id + '">' + ICON('edit') + '</button> ' +
              '<button class="btn btn-secondary btn-sm btn-icon" title="Delete" data-delete-inspection="' + r.id + '">' + ICON('delete') + '</button> ';
          }
          if (canRecordInspection_(r) && r.status !== 'Completed') {
            btns += new Date(r.scheduledAt) > new Date()
              ? '<span class="muted" style="font-size:11.5px;">Not due yet</span>'
              : '<button class="btn btn-secondary btn-sm btn-icon" title="Record results" data-record="' + r.id + '">' + ICON('record_results') + '</button>';
          }
          return btns || '—';
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
      if (!assignment) { UI.toast('Select an assigned ' + Term('inspector').toLowerCase() + ' first', 'error'); return; }
      try {
        await Api.call('scheduleInspection', {
          eventId: eventId, disciplineId: assignment.disciplineId, inspectorId: assignment.inspectorId,
          phase: phaseSelect.value,
          scheduledAt: whenInput.value
        });
        UI.toast(Term('inspection') + ' scheduled', 'success'); Router.resolve();
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
    btn.onclick = () => openChooseParticipantScreen_(content, eventId, inspection);
  });

  content.querySelectorAll('[data-edit-inspection]').forEach(btn => {
    var inspection = inspections.filter(i => i.id === btn.getAttribute('data-edit-inspection'))[0];
    btn.onclick = () => openEditInspectionModal_(eventId, inspection, assignments, assignOptions);
  });

  content.querySelectorAll('[data-delete-inspection]').forEach(btn => {
    var inspection = inspections.filter(i => i.id === btn.getAttribute('data-delete-inspection'))[0];
    btn.onclick = () => UI.confirmModal(
      'Delete this ' + Term('inspection').toLowerCase() + ' (' + (inspection.disciplineName || '') + ' · ' + inspection.phase + ')? This cannot be undone.',
      async () => {
        try {
          await Api.call('deleteInspection', { eventId: eventId, inspectionId: inspection.id });
          UI.toast(Term('inspection') + ' deleted', 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      },
      { confirmLabel: 'Delete' }
    );
  });
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
      UI.field('Phase', '<select id="mInsPhase" class="field-input">' +
        '<option' + (inspection.phase === 'Opening' ? ' selected' : '') + '>Opening</option>' +
        '<option' + (inspection.phase === 'Operational' ? ' selected' : '') + '>Operational</option>' +
        '</select>') +
      UI.field(Term('inspector'), '<select id="mInsAssignment" class="field-input">' + assignOptions + '</select>') +
    '</div>' +
    '<div class="form-row">' +
      UI.field(Term('discipline'), '<input id="mInsDisc" class="field-input" readonly />') +
      UI.field('Scheduled at', '<input id="mInsWhen" type="datetime-local" class="field-input" value="' + esc(normalizeDateTimeLocal(inspection.scheduledAt)) + '" />') +
    '</div>';
  UI.openModal('Edit ' + Term('inspection').toLowerCase(), body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: 'Save', className: 'btn-primary', onClick: async function () {
        var assignSelect = document.getElementById('mInsAssignment');
        var assignment = assignments.filter(a => a.id === assignSelect.value)[0];
        if (!assignment) { UI.toast('Select an assigned ' + Term('inspector').toLowerCase() + ' first', 'error'); return; }
        var when = document.getElementById('mInsWhen').value;
        if (!when) { UI.toast('Scheduled at is required', 'error'); return; }
        try {
          await Api.call('updateInspection', {
            eventId: eventId, inspectionId: inspection.id,
            disciplineId: assignment.disciplineId, inspectorId: assignment.inspectorId,
            phase: document.getElementById('mInsPhase').value,
            scheduledAt: when
          });
          UI.closeModal(); UI.toast(Term('inspection') + ' updated', 'success'); Router.resolve();
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

function stopLiveInspectionWatch_() {
  if (liveInspectionWatchId_ != null && navigator.geolocation) { navigator.geolocation.clearWatch(liveInspectionWatchId_); liveInspectionWatchId_ = null; }
}
function destroyLiveInspectionMap_() {
  stopLiveInspectionWatch_();
  if (liveInspectionMapInstance_) { liveInspectionMapInstance_.remove(); liveInspectionMapInstance_ = null; }
  liveInspectionMyMarker_ = null; liveInspectionMarkers_ = {}; liveInspectionClosestId_ = null;
}

async function openChooseParticipantScreen_(content, eventId, inspection) {
  destroyLiveInspectionMap_();
  var participants = await Api.call('listInspectionParticipants', { inspectionId: inspection.id });

  content.innerHTML =
    '<div class="page-header" style="margin-bottom:14px;"><div><div class="page-title" style="font-size:17px;">Choose a ' + esc(Term('participant').toLowerCase()) + '</div>' +
    '<div class="page-subtitle">' + esc(inspection.disciplineName) + ' · ' + esc(inspection.phase) + ' — yellow/green dots need ' + (inspection.disciplineName ? 'a ' + esc(inspection.disciplineName) + ' ' : '') + 'checklist under your zone</div></div>' +
    '<button class="btn btn-secondary btn-sm" id="backToInspectionsBtn">' + ICON('back') + ' Back</button></div>' +
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

  banner.innerHTML = '<div class="muted" style="font-size:12px;margin-bottom:10px;">' + ICON('gps_locating') + ' Getting your location…</div>';
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
    ICON('warning_banner') + ' Location and/or an internet connection isn\'t available — make sure both GPS and WiFi (or mobile data) are turned on while inspecting on site. Showing every ' +
    esc(Term('participant').toLowerCase()) + ', ' + esc(inspection.disciplineName || 'discipline') + '-related ones first.' +
    '<div><button class="btn btn-secondary btn-sm" id="retryLocationBtn" style="margin-top:8px;">Try again</button></div></div></div>';
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
    el.textContent = 'Map unavailable (couldn\'t load the map library) — the list below still works.';
    return;
  }
  setTimeout(function () {
    if (!document.getElementById('liveInspectionMap')) return;
    liveInspectionMapInstance_ = HululLeaflet.map('liveInspectionMap').setView(EVENT_MAP_DEFAULT_CENTER_, 16);
    HululLeaflet.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19
    }).addTo(liveInspectionMapInstance_);

    liveInspectionMarkers_ = {};
    participants.forEach(function (p) {
      if (p.lat === '' || p.lat == null || p.lng === '' || p.lng == null) return;
      // yellow = relevant (this discipline + inspector's zone) and still pending; green = relevant
      // and done; grey = not relevant to this particular inspection.
      var color = p.isRelevant ? (p.checklistCompleted ? '#16a34a' : '#eab308') : '#94a3b8';
      var icon = HululLeaflet.divIcon({
        className: 'place-marker-icon', iconSize: [14, 14], iconAnchor: [7, 7],
        html: '<div class="place-marker"><div class="place-marker-dot" style="background:' + color + ';"></div></div>'
      });
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
function updateLiveInspectionMyPosition_(latlng) {
  if (!liveInspectionMapInstance_) return;
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
  }).join('') || '<div class="empty-state">No ' + esc(Term('participant_plural').toLowerCase()) + ' recorded for this ' + esc(Term('event').toLowerCase()) + ' yet.</div>';

  listEl.querySelectorAll('[data-participant]').forEach(function (row) {
    row.onclick = function () {
      var p = participants.filter(function (pp) { return pp.id === row.getAttribute('data-participant'); })[0];
      if (p) openRecordResultsModal(eventId, inspection, p);
    };
  });
}

// Record results: shows every Checklist item under the inspection's discipline+phase that hasn't
// been recorded yet *for this one participant*. REQ: the inspector must first pick which Checklist
// type they're recording this visit -- a vendor's discipline can span several types (e.g. Restaurant
// vs Food Truck), and one visit might only cover one of them. Whatever type isn't picked stays open,
// so the inspector can come back and do it as a separate visit later ("a second inspection with a
// different Checklist type"); "All checklist types" records everything remaining in one pass.
// Marking an item Crossed requires a Risk Logging: notes, suggested action, and at least one
// photo/video. Evidence uploads start the moment a file is selected (in the background, with its
// own progress bar) rather than waiting for Save.
async function openRecordResultsModal(eventId, inspection, participant) {
  var [items, existingResults] = await Promise.all([
    Api.call('listChecklistItems', {}),
    Api.call('listInspectionResults', { inspectionId: inspection.id, participantId: participant.id })
  ]);
  var doneIds = {};
  existingResults.forEach(function (r) { doneIds[r.checklistItemId] = true; });
  var scope = items.filter(function (i) { return i.category === inspection.disciplineName && i.phase === inspection.phase; });
  var openItems = scope.filter(function (i) { return !doneIds[i.id]; });

  if (!scope.length) {
    UI.openModal('Record results', '<div class="empty-state">No ' + esc(Term('checklistItem_plural').toLowerCase()) + ' are set up for this ' + esc(Term('discipline').toLowerCase()) + '/phase yet.</div>',
      [{ label: 'Close', className: 'btn-secondary', onClick: UI.closeModal }]);
    return;
  }
  if (!openItems.length) {
    UI.openModal('Record results', '<div class="empty-state">' + esc(participant.name) + '\'s checklist for this ' + esc(Term('inspection').toLowerCase()) + ' is already fully recorded.</div>',
      [{ label: 'Close', className: 'btn-secondary', onClick: UI.closeModal }]);
    return;
  }

  var byType = {};
  openItems.forEach(function (it) { (byType[it.checklistType] = byType[it.checklistType] || []).push(it); });
  var typeNames = Object.keys(byType).sort();

  openChecklistTypeStep_(eventId, inspection, participant, scope, openItems, byType, typeNames);
}

// Step 1: choose which Checklist type this visit covers before seeing any items.
function openChecklistTypeStep_(eventId, inspection, participant, scope, openItems, byType, typeNames) {
  var ALL_KEY = '__ALL__';
  var body =
    '<div class="muted" style="font-size:12.5px;margin-bottom:10px;">' + esc(inspection.disciplineName) + ' · ' + esc(inspection.phase) + '</div>' +
    UI.field('Checklist type', '<select id="fRecordType" class="field-input">' +
      typeNames.map(function (name) {
        return '<option value="' + esc(name) + '">' + esc(name || '(untyped)') + ' — ' + byType[name].length + ' open</option>';
      }).join('') +
      (typeNames.length > 1 ? '<option value="' + ALL_KEY + '">All checklist types — ' + openItems.length + ' open</option>' : '') +
    '</select>') +
    '<div class="muted" style="font-size:11px;margin-top:8px;">Only the type you pick gets recorded this visit — anything else stays open for a later visit.</div>';

  UI.openModal('Record results — ' + esc(participant.name), body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: 'Continue', className: 'btn-primary', onClick: function () {
        var picked = document.getElementById('fRecordType').value;
        var filtered = picked === ALL_KEY ? openItems : byType[picked];
        var totalForScope = picked === ALL_KEY ? scope.length : scope.filter(function (i) { return i.checklistType === picked; }).length;
        var doneCount = totalForScope - filtered.length;
        var typeLabel = picked === ALL_KEY ? '' : (picked || '(untyped)');
        openRecordResultsForm_(eventId, inspection, participant, filtered, doneCount, typeLabel);
      } }
  ]);
}

// Step 2: the actual results form, scoped to whichever Checklist type (or "all") was chosen above.
function openRecordResultsForm_(eventId, inspection, participant, filteredItems, doneCount, typeLabel) {
  var pendingFiles = {};
  filteredItems.forEach(function (it) { pendingFiles[it.id] = []; });

  var byType = {};
  filteredItems.forEach(function (it) { (byType[it.checklistType] = byType[it.checklistType] || []).push(it); });

  var body =
    (doneCount ? '<div class="muted" style="font-size:12px;margin-bottom:10px;">' + doneCount + ' item(s) already recorded for ' + esc(participant.name) + ' in this scope — not shown below.</div>' : '') +
    Object.keys(byType).sort().map(function (typeName) {
      return '<div style="font-weight:600;font-size:12.5px;color:var(--accent);margin:10px 0 4px;">' + esc(typeName) + '</div>' +
        byType[typeName].map(recordResultRowHtml_).join('');
    }).join('');

  var title = 'Record results — ' + esc(participant.name) + ' · ' + esc(inspection.disciplineName) + ' (' + esc(inspection.phase) + ')' +
    (typeLabel ? ' — ' + esc(typeLabel) : '');

  UI.openModal(title, body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('save'), className: 'btn-primary', onClick: function () { saveInspectionResults_(eventId, inspection, participant, filteredItems, pendingFiles); } }
  ]);

  wireRecordResultRows_(eventId, filteredItems, pendingFiles);
}

function recordResultRowHtml_(it) {
  return '<div class="result-row" data-row="' + it.id + '" style="border-bottom:1px solid #f0f1f6;padding:10px 0;">' +
    '<div style="font-weight:600;font-size:13px;">' + esc(it.description) + '</div>' +
    '<div class="muted" style="font-size:11.5px;margin-bottom:6px;">default risk ' + esc(it.defaultRisk) + ' · window ' + esc(it.defaultWindowHours) + 'h</div>' +
    '<select class="field-input result-state" data-item="' + it.id + '" style="display:inline-block;width:auto;">' +
    '<option value="Ticked">Ticked</option><option value="Crossed">Crossed</option><option value="N/A">N/A</option></select>' +
    '<div class="crossed-extra" data-extra="' + it.id + '" style="display:none;margin-top:8px;padding:10px;background:#fff7f0;border-radius:8px;">' +
      '<div class="field-label" style="font-size:11.5px;">Notes / what was found</div>' +
      '<textarea class="field-input result-notes" data-item="' + it.id + '" rows="3" style="margin-bottom:6px;"></textarea>' +
      '<div class="field-label" style="font-size:11.5px;">Suggested action</div>' +
      '<input class="field-input result-action" data-item="' + it.id + '" style="margin-bottom:6px;" />' +
      '<div class="field-label" style="font-size:11.5px;">Risk Logging evidence — photo or video (required)</div>' +
      // capture="environment" opens the device camera directly (rear camera) on mobile instead of
      // the general file/gallery picker -- REQ: evidence must be captured on the spot, not uploaded
      // from an existing file. The native input is kept but visually hidden (its own "Choose
      // file / No file chosen" chrome looks like a generic upload control); a plain camera-icon
      // button -- same plain-icon styling as every other icon button in the app -- triggers it via
      // .click(), so the only affordance the user sees is "take a photo", not "pick a file".
      '<input type="file" class="result-evidence hidden" data-item="' + it.id + '" accept="image/*,video/*" capture="environment" style="display:none;" />' +
      '<button type="button" class="btn btn-secondary btn-icon result-evidence-trigger" data-item="' + it.id + '" title="Take photo / video" aria-label="Take photo or video">' + ICON('capture_photo') + '</button>' +
      '<div class="evidence-list" data-evlist="' + it.id + '" style="margin-top:6px;"></div>' +
    '</div>' +
  '</div>';
}

function wireRecordResultRows_(eventId, openItems, pendingFiles) {
  document.querySelectorAll('.result-state').forEach(function (sel) {
    sel.onchange = function () {
      var extra = document.querySelector('[data-extra="' + sel.getAttribute('data-item') + '"]');
      if (extra) extra.style.display = sel.value === 'Crossed' ? 'block' : 'none';
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
}

// Kicks off the moment a file is picked. REQ: every camera photo gets date/time + GPS + a live
// Arabic address + a QR linking its exact location + the GA/Inspection Company logos stamped onto
// it (EvidenceCapture.prepare, evidence.js), and is saved to this device *before* any network call
// is attempted (EvidenceCapture.saveAndUpload) -- so a dropped connection only ever costs a retry,
// never the evidence itself.
var EVIDENCE_MAX_UPLOAD_BYTES_ = 15 * 1024 * 1024; // 15MB -- past this, base64 + the JSON POST
  // round-trip to Apps Script is very likely to time out or drop mid-transfer on a mobile
  // connection; fail fast with a clear reason instead of a generic "Network error."

function uploadEvidenceFile_(eventId, itemId, file, pendingFiles) {
  var localId = 'ev_' + Date.now() + '_' + Math.random().toString(36).slice(2);
  var entry = { name: file.name, status: 'preparing', pct: 0, url: '', localId: localId, eventId: eventId };
  pendingFiles[itemId].push(entry);
  renderEvidenceList_(itemId, pendingFiles);

  EvidenceCapture.prepare(file, eventId).then(function (readyFile) {
    entry.file = readyFile; // kept for the "Retry now" button below
    if (readyFile.size > EVIDENCE_MAX_UPLOAD_BYTES_) {
      var mb = (readyFile.size / (1024 * 1024)).toFixed(1);
      throw new Error('File is ' + mb + 'MB, which is too large to upload (max 15MB) -- try a shorter video or a lower-resolution photo.');
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
    entry.status = 'saved-locally'; entry.error = (err.message || 'Upload failed') + ' [' + sizeMb + ']';
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
    entry.status = 'saved-locally'; entry.error = (err.message || 'Upload failed') + ' [' + sizeMb + ']';
    renderEvidenceList_(itemId, pendingFiles);
  });
}

function renderEvidenceList_(itemId, pendingFiles) {
  var el = document.querySelector('[data-evlist="' + itemId + '"]');
  if (!el) return;
  el.innerHTML = (pendingFiles[itemId] || []).map(function (f) {
    if (f.status === 'preparing') {
      return '<div style="font-size:11.5px;margin-top:4px;">' + esc(f.name) + ' — stamping date/time, location &amp; logos…</div>';
    }
    if (f.status === 'uploading') {
      return '<div style="font-size:11.5px;margin-top:4px;">' + esc(f.name) + ' — uploading ' + f.pct + '%' +
        '<div style="background:#eee;border-radius:6px;height:6px;overflow:hidden;margin-top:2px;">' +
        '<div style="background:var(--accent);height:100%;width:' + f.pct + '%;transition:width .1s;"></div></div></div>';
    }
    if (f.status === 'done') return '<div style="font-size:11.5px;margin-top:4px;color:var(--success);">' + ICON('file_upload_done') + ' ' + esc(f.name) + '</div>';
    if (f.status === 'saved-locally') {
      return '<div style="font-size:11.5px;margin-top:4px;color:var(--warning);">' + ICON('warning_banner') + ' ' + esc(f.name) +
        ' — saved on this device, not uploaded yet (' + esc(f.error || 'connection issue') + ')' +
        ' <button type="button" class="btn btn-secondary btn-sm" data-retry-evidence="' + esc(f.localId) + '" style="margin-inline-start:6px;padding:2px 8px;font-size:11px;">Retry now</button></div>';
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

async function saveInspectionResults_(eventId, inspection, participant, openItems, pendingFiles) {
  var results = [];
  for (var i = 0; i < openItems.length; i++) {
    var it = openItems[i];
    var row = document.querySelector('[data-row="' + it.id + '"]');
    if (!row) continue;
    var state = row.querySelector('.result-state').value;
    var entry = { checklistItemId: it.id, state: state };
    if (state === 'Crossed') {
      var files = pendingFiles[it.id] || [];
      if (files.some(function (f) { return f.status === 'uploading'; })) {
        UI.toast('Evidence is still uploading for "' + it.description + '" — please wait for it to finish', 'error');
        return;
      }
      var urls = files.filter(function (f) { return f.status === 'done'; }).map(function (f) { return f.url; });
      if (!urls.length) {
        UI.toast('A photo or video is required for "' + it.description + '" since it is marked Crossed', 'error');
        return;
      }
      entry.notes = row.querySelector('.result-notes').value;
      entry.suggestedAction = row.querySelector('.result-action').value;
      entry.evidenceUrls = urls;
    }
    results.push(entry);
  }
  try {
    var res = await Api.call('recordInspectionResults', { inspectionId: inspection.id, participantId: participant.id, results: results });
    UI.closeModal();
    UI.toast(res.findingsCreated.length + ' ' + esc(res.findingsCreated.length === 1 ? Term('finding') : Term('finding_plural')).toLowerCase() + ' created', 'success');
    Router.resolve();
  } catch (err) { UI.error(err); }
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
var FINDING_BOARD_LABELS = {
  Open: 'Open', Viewed: 'Viewed', Submitted: 'Submitted', InReview: 'In review',
  ReOpen: 'Re-open', Resubmitted: 'Resubmitted', Resolved: 'Resolved', Rejected: 'Rejected'
};
var RISK_BORDER_COLOR = { Critical: 'var(--critical)', High: 'var(--danger)', Medium: 'var(--warning)', Low: 'var(--success)' };
// Findings that can create/log a new one -- matches createFinding's backend requireRole.
var FINDING_CREATE_ROLES = ['Inspector', 'ProjectManager', 'SystemAdmin'];

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
      label: FINDING_BOARD_LABELS[status],
      cards: findings.filter(function (f) { return f.status === status; }).map(function (f) { return findingBoardCard_(f); })
    };
  });

  var canCreate = FINDING_CREATE_ROLES.indexOf(HululState.user.role) !== -1;

  content.innerHTML =
    '<div class="kpi-grid">' +
      kpiCard('kpi_total', findings.length, ICON('kpi_total'), 'var(--info)') +
      kpiCard('kpi_open', counts.Open, ICON('kpi_open'), 'var(--info)') +
      kpiCard('kpi_inreview', counts.InReview, ICON('kpi_inreview'), '#7c3aed') +
      kpiCard('kpi_resolved', counts.Resolved, ICON('kpi_resolved'), 'var(--success)') +
      kpiCard('kpi_reopen', counts.ReOpen, ICON('kpi_reopen'), 'var(--warning)') +
      kpiCard('kpi_rejected', counts.Rejected, ICON('kpi_rejected'), 'var(--danger)') +
    '</div>' +
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">Pipeline</div>' +
    '<div class="muted" style="font-size:11.5px;">Click a card to open the log</div></div>' +
    '<div class="card-body">' + UI.board(boardColumns) + '</div></div>' +
    '<div class="card"><div class="card-header"><div class="card-title">' + t('tab_findings') + '</div>' +
    (canCreate ? '<button class="btn btn-primary btn-sm" id="newFindingBtn">+ Log ' + esc(Term('finding').toLowerCase()) + '</button>' : '') + '</div>' +
    '<div class="card-body">' + UI.table([
      { key: 'disciplineName', label: Term('discipline') }, { key: 'category', label: 'Category' }, { key: 'subCategory', label: 'Sub category' },
      { key: 'riskLevel', label: 'Severity', render: r => UI.riskBadge(r.riskLevel) },
      { key: 'status', label: t('status'), render: r => UI.statusBadge(r.status) },
      { key: 'description', label: 'Description' }, { key: 'participantName', label: Term('participant') },
      { key: 'actions', label: t('actions'), render: r =>
        '<button class="btn btn-secondary btn-sm btn-icon" title="Open log" data-finding-view="' + r.id + '">' + ICON('view_open') + '</button>' }
    ], findings, {}) + '</div></div>';

  UI.wireBoard(content, function (id) { window.location.hash = '#/events/' + eventId + '/findings/' + id; });

  if (canCreate) document.getElementById('newFindingBtn').onclick = function () { window.location.hash = '#/events/' + eventId + '/findings/new'; };
  content.querySelectorAll('[data-finding-view]').forEach(btn => {
    btn.onclick = () => { window.location.hash = '#/events/' + eventId + '/findings/' + btn.getAttribute('data-finding-view'); };
  });
}

/* ---------------- Escalations ---------------- */
async function tabEscalations(content, eventId) {
  var [escalations, findings] = await Promise.all([
    Api.call('listEscalations', { eventId: eventId }), Api.call('listFindings', { eventId: eventId })
  ]);
  var findingsById = {}; findings.forEach(function (f) { findingsById[f.id] = f; });

  // listUsers is only open to admin-ish roles (SystemAdmin/GAAdmin/EMCAdmin/InspectionAdmin/
  // EMCManager/ProjectManager) -- everyone who can actually createEscalation is in that set, but
  // this tab (and its recipient names in the table below) is visible to other roles too, so a
  // viewer without permission just falls back to a plain text field and raw ids in the table
  // instead of the tab breaking outright.
  var users = [];
  var usersById = {};
  try { users = await Api.call('listUsers', {}); users.forEach(function (u) { usersById[u.id] = u; }); } catch (e) { /* fall back below */ }

  var findingOptions = findings.map(function (f) { return '<option value="' + f.id + '">' + esc(f.description || f.id) + '</option>'; }).join('');
  var recipientFieldHtml = users.length
    ? UI.field('Recipient', '<select id="fEscRecipient" class="field-input"><option value="">—</option>' +
        users.map(function (u) { return '<option value="' + u.id + '">' + esc(u.name) + ' (' + esc(u.role) + ')</option>'; }).join('') + '</select>')
    : UI.field('Recipient User ID', '<input id="fEscRecipient" class="field-input" placeholder="USR-0002" />');

  content.innerHTML =
    '<div class="card" style="margin-bottom:16px;"><div class="card-body" style="display:flex;justify-content:space-between;align-items:center;">' +
    '<div class="muted" style="font-size:13px;">' + esc(Term('escalation_plural')) + ' run automatically every 30 minutes. You can also trigger a check manually.</div>' +
    '<button class="btn btn-secondary btn-sm" id="runEscBtn">Run check now</button></div></div>' +
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">Manual ' + esc(Term('escalation').toLowerCase()) + ' (admin override)</div></div>' +
    '<div class="card-body form-row">' +
      UI.field(Term('finding'), '<select id="fEscFinding" class="field-input">' + (findingOptions || '<option value="">No ' + esc(Term('finding_plural').toLowerCase()) + ' logged yet</option>') + '</select>') +
      UI.field('Tier', '<select id="fEscTier" class="field-input"><option value="1">1</option><option value="2">2</option><option value="3">3</option></select>') +
    '</div><div class="card-body" style="padding-top:0;">' +
      recipientFieldHtml +
      '<button class="btn btn-primary btn-sm" id="newEscBtn" style="margin-top:10px;">Create ' + esc(Term('escalation').toLowerCase()) + '</button></div></div>' +
    '<div class="card"><div class="card-header"><div class="card-title">' + esc(Term('escalation_plural')) + '</div></div><div class="card-body">' +
    UI.table([
      { key: 'findingId', label: Term('finding'), render: r => esc(findingsById[r.findingId] ? (findingsById[r.findingId].description || r.findingId) : r.findingId) },
      { key: 'tier', label: 'Tier', render: r => 'Tier ' + r.tier },
      { key: 'recipientUserId', label: 'Recipient', render: r => r.recipientUserId ? esc(usersById[r.recipientUserId] ? usersById[r.recipientUserId].name : r.recipientUserId) : '—' },
      { key: 'triggeredAt', label: 'Triggered', render: r => UI.fmtDate(r.triggeredAt) },
      { key: 'resolvedAt', label: 'Resolved', render: r => r.resolvedAt ? UI.fmtDate(r.resolvedAt) : '—' }
    ], escalations, {}) + '</div></div>';

  document.getElementById('runEscBtn').onclick = async function () {
    try { var res = await Api.call('runEscalationCheck', {}); UI.toast(res.triggeredCount + ' ' + esc(res.triggeredCount === 1 ? Term('escalation') : Term('escalation_plural')).toLowerCase() + ' triggered', 'success'); Router.resolve(); }
    catch (err) { UI.error(err); }
  };
  document.getElementById('newEscBtn').onclick = async function () {
    try {
      await Api.call('createEscalation', {
        findingId: document.getElementById('fEscFinding').value, tier: document.getElementById('fEscTier').value,
        recipientUserId: document.getElementById('fEscRecipient').value
      });
      UI.toast(Term('escalation') + ' created', 'success'); Router.resolve();
    } catch (err) { UI.error(err); }
  };
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
  content.innerHTML =
    '<div class="card" style="margin-bottom:16px;"><div class="card-body" style="display:flex;gap:10px;">' +
    '<button class="btn btn-primary btn-sm" id="genReadinessBtn">Generate Opening report</button>' +
    '<button class="btn btn-secondary btn-sm" id="genInspectionBtn">Generate Operational report</button></div></div>' +
    '<div class="card"><div class="card-header"><div class="card-title">' + esc(Term('report_plural')) + '</div></div><div class="card-body">' +
    reports.map(r =>
      '<div style="border-bottom:1px solid #f0f1f6;padding:12px 0;">' +
      '<div style="display:flex;justify-content:space-between;"><strong>' + esc(r.type) + '</strong><span class="muted">' + UI.fmtDate(r.generatedAt) + '</span></div>' +
      '<pre style="font-size:11.5px;background:#f6f7fb;padding:8px 10px;border-radius:8px;margin-top:6px;overflow-x:auto;">' + esc(JSON.stringify(r.summary, null, 2)) + '</pre></div>'
    ).join('') + (reports.length ? '' : '<div class="empty-state">' + t('no_data') + '</div>') +
    '</div></div>';

  document.getElementById('genReadinessBtn').onclick = () => gen('Opening');
  document.getElementById('genInspectionBtn').onclick = () => gen('Operational');
  async function gen(type) {
    try { await Api.call('generateReport', { eventId: eventId, type: type }); UI.toast(Term('report') + ' generated', 'success'); Router.resolve(); }
    catch (err) { UI.error(err); }
  }
}
