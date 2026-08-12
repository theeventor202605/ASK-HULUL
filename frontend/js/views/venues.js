/**
 * HULUL - Venues admin view (SystemAdmin / EMCAdmin / EMCManager: create, edit, and soft-delete
 * venues ahead of Events).
 *
 * New/Edit Venue is a full in-app page (routes: #/venues/new, #/venues/:id/edit), not a modal --
 * the Leaflet map needs real room to be usable, and a modal's ~520px/90vh box was too cramped for
 * search + map + all the location fields together. Both routes share one form (renderVenueForm_).
 *
 * REQ (decoupling pass): a Venue is no longer connected to an EMC Org here -- it's a shared catalog
 * entry any SystemAdmin/EMCAdmin/EMCManager can create, edit, or delete, and every authenticated
 * user sees the full list (see listVenues/createVenue/updateVenue/deleteVenue in Events.gs). Which
 * EMC ends up renting a Venue is chosen independently, per Event, on the New Event form
 * (events.js) -- not tied to the Venue record itself.
 *
 * Location (address/city/lat/lng) can be found via the Leaflet + OpenStreetMap place search below,
 * or dragging the map pin, or just typed in manually -- the map is a convenience, never required.
 *
 * Delete is soft (status: 'Deleted', filtered out of listVenues by default) and only allowed when
 * nothing has been built on top of the venue yet -- no Zones, Places, Events, or Venue Evaluations
 * (see listVenueImpact / deleteVenue in Events.gs). Otherwise the button explains what's attached.
 */
var VENUE_DEFAULT_CENTER = [24.7136, 46.6753]; // Riyadh -- a sensible default until a place is picked
// REQ: "provide the ability to choose zone colour after zone boundaries are drawn. the same should
// apply to venue." Fallback color used everywhere a venue has no color of its own on record yet
// (existing venues predating this feature) -- same indigo already used as the old hardcoded shade
// on eventDetail.js's Places map and venues.js's own Add-a-Place map, so nothing already saved
// visually changes until an owner actually picks a new color.
var VENUE_BOUNDARY_DEFAULT_COLOR_ = '#4f46e5';
var EMC_MANAGE_ROLES = ['SystemAdmin', 'EMCAdmin', 'EMCManager']; // who can create/edit/delete Venues and Places
var venueMapInstance_ = null;
var venueMapMarker_ = null;
var venueMapFullscreenCleanup_ = null;
var venueMapInspectorPollStop_ = null; // UI.startInspectorLocationPolling cleanup, see initVenueMap_
var venueSearchTimer_ = null;
var venueBoundaryLayer_ = null; // FeatureGroup holding the single drawn boundary polygon, if any
// Bumped by every destroyVenueMap_()/initVenueMap_() call. initVenueMap_ defers actual map
// creation by a setTimeout(0) tick (see its own comment); if renderVenueForm_ ever runs twice in
// quick succession (e.g. a double-navigation to Edit Venue before the first render's map-init
// tick has fired yet), BOTH deferred callbacks would otherwise find the same live #venueMap div
// and both call HululLeaflet.map('venueMap') on it -- Leaflet allows this once but throws "Map
// container is being reused by another instance" on the second call. Each deferred callback
// captures the generation counter's value at schedule time and bails if a newer
// destroy/init has since bumped it, so only the LAST-scheduled callback ever actually runs.
var venueMapGen_ = 0;

async function renderVenues() {
  var root = document.getElementById('viewRoot');
  var canManage = EMC_MANAGE_ROLES.indexOf(HululState.user.role) !== -1;
  var venues = await Api.call('listVenues', {});

  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + esc(Term('venue_plural')) + '</div>' +
    '<div class="page-subtitle">' + esc(Term('venue_plural') + ' available to assign to ' + Term('event_plural')) + '</div></div>' +
    '<button class="btn btn-primary" id="newVenueBtn">+ New ' + esc(Term('venue').toLowerCase()) + '</button></div>' +
    '<div class="card"><div class="card-body">' + UI.table([
      { key: 'name', label: 'Name' }, { key: 'address', label: 'Address' }, { key: 'city', label: 'City' },
      { key: 'lat', label: 'Coordinates', render: r => (r.lat && r.lng) ? (Number(r.lat).toFixed(4) + ', ' + Number(r.lng).toFixed(4)) : '—' },
      { key: 'createdAt', label: 'Created', render: r => UI.fmtDate(r.createdAt) },
      { key: 'actions', label: 'Actions', render: r =>
          '<div style="display:inline-flex;gap:6px;white-space:nowrap;">' +
            '<button class="btn btn-secondary btn-sm btn-icon" title="Places" data-manage-places="' + esc(r.id) + '">' + ICON('location_pin') + '</button>' +
            (canManage
              ? '<button class="btn btn-secondary btn-sm btn-icon" title="Edit" data-edit-venue="' + esc(r.id) + '">' + ICON('edit') + '</button>' +
                '<button class="btn btn-secondary btn-sm btn-icon" title="Delete" data-delete-venue="' + esc(r.id) + '">' + ICON('delete') + '</button>'
              : '') +
          '</div>'
      }
    ], venues, {}) + '</div></div>';

  document.getElementById('newVenueBtn').onclick = function () { window.location.hash = '#/venues/new'; };
  document.querySelectorAll('[data-manage-places]').forEach(function (btn) {
    btn.onclick = function () { window.location.hash = '#/venues/' + btn.getAttribute('data-manage-places') + '/places'; };
  });
  document.querySelectorAll('[data-edit-venue]').forEach(function (btn) {
    btn.onclick = function () { window.location.hash = '#/venues/' + btn.getAttribute('data-edit-venue') + '/edit'; };
  });
  document.querySelectorAll('[data-delete-venue]').forEach(function (btn) {
    btn.onclick = function () { confirmDeleteVenue_(btn.getAttribute('data-delete-venue')); };
  });
}

async function confirmDeleteVenue_(venueId) {
  try {
    var impact = await Api.call('listVenueImpact', { venueId: venueId });
    if (impact.hasImpact) {
      var parts = [];
      if (impact.zonesCount) parts.push(impact.zonesCount + ' ' + (impact.zonesCount === 1 ? Term('zone') : Term('zone_plural')).toLowerCase());
      if (impact.placesCount) parts.push(impact.placesCount + ' place' + (impact.placesCount === 1 ? '' : 's'));
      if (impact.eventsCount) parts.push(impact.eventsCount + ' ' + (impact.eventsCount === 1 ? Term('event') : Term('event_plural')).toLowerCase());
      if (impact.evaluationsCount) parts.push(impact.evaluationsCount + ' venue evaluation' + (impact.evaluationsCount === 1 ? '' : 's'));
      UI.toast('Can\'t delete — this ' + Term('venue').toLowerCase() + ' already has ' + parts.join(', ') + ' tied to it.', 'error');
      return;
    }
    UI.confirmModal('Delete this ' + Term('venue').toLowerCase() + '? This can\'t be undone.', async function () {
      try { await Api.call('deleteVenue', { venueId: venueId }); UI.toast(Term('venue') + ' deleted', 'success'); Router.resolve(); }
      catch (err) { UI.error(err); }
    }, { title: 'Delete ' + Term('venue').toLowerCase(), confirmLabel: 'Delete' });
  } catch (err) { UI.error(err); }
}

async function renderNewVenue() { await renderVenueForm_(null); }

async function renderEditVenue(params) {
  var venues = await Api.call('listVenues', { includeDeleted: true });
  var venue = venues.filter(function (v) { return v.id === params.id; })[0];
  if (!venue) { document.getElementById('viewRoot').innerHTML = '<div class="empty-state">' + esc(Term('venue')) + ' not found.</div>'; return; }
  await renderVenueForm_(venue);
}

// Shared by New Venue (existingVenue === null) and Edit Venue (existingVenue is the row being
// edited). No EMC organization field here -- a Venue isn't connected to one (see file header
// comment); which EMC rents it is chosen per-Event instead (events.js's New Event form).
async function renderVenueForm_(existingVenue) {
  destroyVenueMap_(); // in case a previous visit to this page left one behind (e.g. browser back)
  var root = document.getElementById('viewRoot');
  var isEdit = !!existingVenue;

  // REQ: "no vendors showing on the [venue] map" -- when editing an existing venue, show its
  // already-registered places (vendors/operators/exhibitors) as dots on the map for context while
  // drawing/adjusting the boundary, same colored-dot style as the Event > Venue & Zones "Places map".
  var venuePlacesWithCoords = [];
  var venueZonesForMap_ = [];
  if (isEdit) {
    try {
      var vPlaces = await Api.call('listPlaces', { venueId: existingVenue.id });
      venuePlacesWithCoords = vPlaces.filter(function (p) { return p.lat !== '' && p.lat != null && p.lng !== '' && p.lng != null; });
    } catch (e) { /* map still works without them */ }
    // REQ: "Zone boundaries to be visible. This applies to all maps." -- shown for context while
    // editing this venue, same reasoning/fallback as venuePlacesWithCoords just above.
    try { venueZonesForMap_ = await Api.call('listZones', { venueId: existingVenue.id }); } catch (e) { /* map still works without them */ }
  }

  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + (isEdit ? 'Edit ' : 'New ') + esc(Term('venue')) + '</div>' +
    '<div class="page-subtitle">' + (isEdit ? 'Update ' + esc(Term('venue').toLowerCase()) + ' information' : 'Add a ' + esc(Term('venue').toLowerCase()) + ' your ' + esc(Term('event_plural').toLowerCase()) + ' can be held at') + '</div></div>' +
    '<button class="btn btn-secondary" id="backVenuesBtn">' + ICON('back') + ' Back</button></div>' +
    '<div class="card">' +
      '<div class="card-body" style="display:flex;flex-direction:column;gap:4px;max-width:640px;">' +
        UI.field('Name', '<input id="fVName" class="field-input" value="' + (isEdit ? esc(existingVenue.name) : '') + '" />') +
        '<div style="margin-top:10px;position:relative;">' +
          '<div style="display:flex;flex-direction:column;gap:4px;">' +
            UI.field('Search a place (optional)', '<input id="fVSearch" class="field-input" placeholder="Type a place name…" autocomplete="off" />') +
          '</div>' +
          // z-index must clear Leaflet's own panes/controls (it uses up to 1000 internally, e.g.
          // .leaflet-top/.leaflet-bottom) or this dropdown renders invisibly underneath the map.
          '<div id="fVSearchResults" style="position:absolute;left:0;right:0;top:100%;border:1px solid var(--border);border-radius:var(--radius-sm);margin-top:4px;max-height:180px;overflow-y:auto;display:none;background:#fff;box-shadow:var(--shadow-md);z-index:2000;"></div>' +
        '</div>' +
        '<div style="margin-top:10px;">' + UI.field('Boundary color', '<input id="fVColor" type="color" class="field-input" style="width:64px;height:36px;padding:2px;" value="' + esc((isEdit && existingVenue.color) ? existingVenue.color : VENUE_BOUNDARY_DEFAULT_COLOR_) + '" />') + '</div>' +
        '<div id="venueMap" style="height:340px;border-radius:var(--radius-sm);margin-top:6px;border:1px solid var(--border);"></div>' +
        '<div class="muted" style="font-size:11px;margin-top:6px;">Search above, or drag the pin, to fill in the location — or just type the fields below manually. Use the polygon tool on the map (optional) to draw this ' + esc(Term('venue').toLowerCase()) + '\'s boundary — Places will need to land inside it once drawn; leave undrawn to keep placement unrestricted. The color picker above sets how the boundary renders on this and every other map that shows it.' +
          (venuePlacesWithCoords.length ? ' Dots show this ' + esc(Term('venue').toLowerCase()) + '\'s ' + venuePlacesWithCoords.length + ' already-registered place(s).' : '') + '</div>' +
        UI.field('Address', '<input id="fVAddress" class="field-input" value="' + (isEdit ? esc(existingVenue.address) : '') + '" />') +
        UI.field('City', '<input id="fVCity" class="field-input" value="' + (isEdit ? esc(existingVenue.city) : '') + '" />') +
        '<div class="form-row">' +
          UI.field('Latitude', '<input id="fVLat" type="number" step="any" class="field-input" placeholder="24.7136" value="' + (isEdit && existingVenue.lat !== '' ? esc(String(existingVenue.lat)) : '') + '" />') +
          UI.field('Longitude', '<input id="fVLng" type="number" step="any" class="field-input" placeholder="46.6753" value="' + (isEdit && existingVenue.lng !== '' ? esc(String(existingVenue.lng)) : '') + '" />') +
        '</div>' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;padding:14px 20px;border-top:1px solid var(--border);">' +
        '<button class="btn btn-secondary" id="cancelVenueBtn">' + t('cancel') + '</button>' +
        '<button class="btn btn-primary" id="createVenueBtn">' + (isEdit ? 'Save changes' : t('create')) + '</button>' +
      '</div>' +
    '</div>';

  document.getElementById('backVenuesBtn').onclick = goBackToVenues_;
  document.getElementById('cancelVenueBtn').onclick = goBackToVenues_;
  document.getElementById('createVenueBtn').onclick = async function () {
    try {
      var name = document.getElementById('fVName').value.trim();
      if (!name) { UI.toast('Name is required', 'error'); return; }
      var payload = {
        name: name,
        address: document.getElementById('fVAddress').value,
        city: document.getElementById('fVCity').value,
        lat: document.getElementById('fVLat').value,
        lng: document.getElementById('fVLng').value,
        color: document.getElementById('fVColor').value,
        boundary: getVenueBoundaryValue_()
      };
      if (isEdit) {
        payload.venueId = existingVenue.id;
        await Api.call('updateVenue', payload);
      } else {
        await Api.call('createVenue', payload);
      }
      destroyVenueMap_();
      UI.toast(Term('venue') + (isEdit ? ' updated' : ' created'), 'success');
      window.location.hash = '#/venues';
    } catch (err) { UI.error(err); }
  };

  var startCenter = (isEdit && existingVenue.lat && existingVenue.lng) ? [Number(existingVenue.lat), Number(existingVenue.lng)] : null;
  var existingBoundary = isEdit ? parseBoundaryClient_(existingVenue.boundary) : null;
  initVenueMap_(startCenter, existingBoundary, venuePlacesWithCoords, venueZonesForMap_, isEdit ? existingVenue.id : null);
  var venueColorInput = document.getElementById('fVColor');
  if (venueColorInput) venueColorInput.oninput = function () { restyleVenueBoundaryLayer_(); };
  wireVenueSearch_();
}

function goBackToVenues_() {
  destroyVenueMap_();
  window.location.hash = '#/venues';
}

// Leaflet needs the #venueMap div to already have real dimensions when .map() runs -- it does
// here since the page is already in the DOM, but a tick of setTimeout keeps this safe even if
// that ever changes. If Leaflet failed to load (e.g. its CDN is blocked on this network), the
// placeholder box says so instead of just sitting blank -- manual address/city/lat/lng entry
// keeps working either way.
//
// Uses window.HululLeaflet (aliased in index.html right after leaflet.js loads), NOT the bare
// global `L` -- this app's own labels.js declares a global function Term(key) (the terminology
// lookup used everywhere as Term('venue') etc.) which loads afterward and clobbers Leaflet's
// identically-named global. Referencing L here would silently pick up the wrong thing.
function initVenueMap_(startCenter, existingBoundary, placesWithCoords, zones, venueId) {
  var el = document.getElementById('venueMap');
  if (!el) return;
  if (typeof HululLeaflet === 'undefined') {
    el.style.display = 'flex'; el.style.alignItems = 'center'; el.style.justifyContent = 'center';
    el.style.color = 'var(--text-600)'; el.style.fontSize = '12px'; el.style.textAlign = 'center'; el.style.padding = '12px';
    el.textContent = 'Map unavailable (couldn\'t load the map library) — search still works if the network allows it, or fill in the fields below manually.';
    return;
  }
  var center = startCenter || VENUE_DEFAULT_CENTER;
  var myGen = ++venueMapGen_;
  setTimeout(function () {
    if (myGen !== venueMapGen_) return; // superseded by a newer render before this tick fired
    var mapEl = document.getElementById('venueMap');
    if (!mapEl || mapEl._leaflet_id) return; // gone, or (defensive belt-and-suspenders) already claimed
    venueMapInstance_ = HululLeaflet.map('venueMap').setView(center, startCenter ? 15 : 6);
    // Single hostname (no a/b/c subdomains) -- matches OSM's current tile usage policy; the old
    // lettered-subdomain form ({s}.tile...) is deprecated and can silently serve nothing.
    var osmLayer = HululLeaflet.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19
    }).addTo(venueMapInstance_);
    // REQ: "no satellite toggle ... on the [venue] map" -- same OSM/ArcGIS swap as venues.js's own
    // Add-a-Place map (initPlaceMap_ below) and eventPlaces.js's Add-participant map.
    var satelliteLayer = HululLeaflet.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: '&copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics', maxZoom: 19
    });
    var showingSatellite = false;
    // REQ: "Move the Use my location / Satellite buttons inside map canvas." -- built and appended
    // directly into mapEl (UI.mapControls) instead of living in the card header above the map.
    var venueSatBtn = UI.mapToggleButton('toggleVenueSatelliteBtn', 'satellite_toggle', 'Satellite');
    UI.mapControls(mapEl, [venueSatBtn]);
    venueSatBtn.onclick = function () {
      showingSatellite = !showingSatellite;
      if (showingSatellite) { venueMapInstance_.removeLayer(osmLayer); satelliteLayer.addTo(venueMapInstance_); venueSatBtn.innerHTML = ICON('map_toggle') + ' Map'; }
      else { venueMapInstance_.removeLayer(satelliteLayer); osmLayer.addTo(venueMapInstance_); venueSatBtn.innerHTML = ICON('satellite_toggle') + ' Satellite'; }
    };
    // REQ: "Drawing boundaries on small map is hard, need to be able to extend map to full screen" --
    // see UI.wireMapFullscreen (ui.js) for why this isn't the browser Fullscreen API. No extraControls
    // needed anymore -- the satellite toggle already lives inside mapEl (see UI.mapControls above), so
    // it's already part of what goes full screen, unlike before when it had to be specially reparented.
    venueMapFullscreenCleanup_ = UI.wireMapFullscreen(mapEl, venueMapInstance_);

    // REQ: "no vendors showing on the [venue] map" -- plot this venue's already-registered places
    // (vendors/operators/exhibitors) for context (UI.drawPlaceDots, ui.js).
    UI.drawPlaceDots(venueMapInstance_, placesWithCoords);
    // REQ: "Zone boundaries to be visible. This applies to all maps."
    UI.drawZoneBoundaries(venueMapInstance_, zones);
    // REQ: "Inspectors live location as they start inspections. This applies to all maps." -- only
    // once this venue actually has an id (Edit Venue; a brand new venue has nothing to poll for yet).
    if (venueId) venueMapInspectorPollStop_ = UI.startInspectorLocationPolling(venueMapInstance_, { venueId: venueId }, 20000);

    venueMapMarker_ = HululLeaflet.marker(center, { draggable: true }).addTo(venueMapInstance_);
    venueMapMarker_.on('dragend', function () {
      var pos = venueMapMarker_.getLatLng();
      setVenueLatLng_(pos.lat, pos.lng);
    });
    venueMapInstance_.on('click', function (e) {
      venueMapMarker_.setLatLng(e.latlng);
      setVenueLatLng_(e.latlng.lat, e.latlng.lng);
    });

    // Boundary drawing (Leaflet.draw, see index.html) -- REQ: "Allow to draw venue boundaries when
    // creating venue... restriction now will be venue boundary" (replaces the old 1km-radius check,
    // see createPlace in Places.gs). Only one polygon is meaningful per venue, so a freshly-drawn one
    // replaces any previous one (see the CREATED handler below); the plugin's own edit/trash toolbar
    // handles reshaping or clearing whichever polygon is currently on the map. Wrapped in try/catch --
    // Leaflet.draw is a third-party plugin (CDN can fail to load, or throw on a Leaflet version it
    // doesn't fully support) and a failure here must never take down the base map (tiles/pin/search),
    // which are the parts that actually matter for saving a venue at all.
    try {
      venueBoundaryLayer_ = HululLeaflet.featureGroup().addTo(venueMapInstance_);
      if (HululLeaflet.Control && HululLeaflet.Control.Draw) {
        var drawControl = new HululLeaflet.Control.Draw({
          draw: { polygon: { allowIntersection: false, showArea: true, shapeOptions: { color: getVenueColorValue_() } }, polyline: false, rectangle: false, circle: false, circlemarker: false, marker: false },
          edit: { featureGroup: venueBoundaryLayer_ }
        });
        venueMapInstance_.addControl(drawControl);
        venueMapInstance_.on(HululLeaflet.Draw.Event.CREATED, function (e) {
          venueBoundaryLayer_.clearLayers();
          venueBoundaryLayer_.addLayer(e.layer);
          restyleVenueBoundaryLayer_();
          reapplyVenueBoundaryPanLimit_();
        });
      }
      if (existingBoundary && existingBoundary.length >= 3) {
        venueBoundaryLayer_.addLayer(HululLeaflet.polygon(existingBoundary.map(function (pt) { return [pt.lat, pt.lng]; })));
      }
      restyleVenueBoundaryLayer_();
      reapplyVenueBoundaryPanLimit_();
      // Keep the pan limit in sync with whatever's actually drawn -- a freshly-drawn polygon, a
      // reshape via the edit toolbar, or a delete via the trash toolbar (which should lift the
      // restriction again, same as a venue that never had a boundary at all).
      venueMapInstance_.on(HululLeaflet.Draw.Event.EDITED, reapplyVenueBoundaryPanLimit_);
      venueMapInstance_.on(HululLeaflet.Draw.Event.DELETED, reapplyVenueBoundaryPanLimit_);
    } catch (e) {
      console.error('Boundary-drawing tool failed to initialize; the map itself still works.', e);
    }

    // Leaflet measures the container's size at creation time; if it was 0x0 for even a moment
    // (page still painting, etc.) the tiles it fetched will be wrong until told to re-measure.
    setTimeout(function () { if (venueMapInstance_) venueMapInstance_.invalidateSize(); }, 150);
  }, 0);
}

function destroyVenueMap_() {
  venueMapGen_++; // invalidate any still-pending initVenueMap_ setTimeout from an earlier render
  if (venueMapFullscreenCleanup_) { venueMapFullscreenCleanup_(); venueMapFullscreenCleanup_ = null; }
  if (venueMapInspectorPollStop_) { venueMapInspectorPollStop_(); venueMapInspectorPollStop_ = null; }
  if (venueMapInstance_) { venueMapInstance_.remove(); venueMapInstance_ = null; venueMapMarker_ = null; venueBoundaryLayer_ = null; }
}

// Reads the color picker's current value (falls back to the default if the field isn't on the
// page for some reason) -- used both to seed the draw tool's shapeOptions and to live-restyle
// whatever's currently drawn whenever the picker changes.
function getVenueColorValue_() {
  var el = document.getElementById('fVColor');
  return (el && el.value) || VENUE_BOUNDARY_DEFAULT_COLOR_;
}

// Re-applies the currently-picked color to the boundary polygon on the map -- called after a new
// polygon is drawn and whenever the color picker's own input fires, so picking a color always
// reflects live on the shape already on screen instead of only taking effect after a save+reload.
function restyleVenueBoundaryLayer_() {
  if (!venueBoundaryLayer_) return;
  var color = getVenueColorValue_();
  venueBoundaryLayer_.eachLayer(function (layer) {
    if (layer.setStyle) layer.setStyle({ color: color, fillColor: color });
  });
}

// REQ: "When panning the map or scrolling, part of the venue boundary must be visible in the map.
// Users can not scroll away from the venue boundaries. This and colour and boundary visibility
// applies to all maps within the app." -- shared by every map that shows a venue's boundary
// (this file's own venueMap/placeMap, and eventDetail.js's/eventPlaces.js's zoneMap/eventPlacesMap/
// eventPlaceMap, all loaded on the same page -- same cross-file function pattern as
// parseBoundaryClient_). Leaflet's own maxBounds is exactly this primitive: once the given bounds'
// edge reaches the viewport's edge, panning further that direction stops, so some part of the
// bounds always stays on screen no matter how far/long the user tries to pan or scroll away. A
// generous pad keeps normal panning/zooming comfortable instead of boxing the view in tight to the
// polygon's exact edges; viscosity 1 makes the stop solid (no rubber-band drag-past-then-snap-back).
// bounds === null/invalid (no boundary drawn/available) lifts any existing restriction -- matches
// the established "no boundary drawn yet is unrestricted" convention everywhere in this app.
function applyBoundaryPanLimit_(map, bounds) {
  if (!map) return;
  if (!bounds || !bounds.isValid || !bounds.isValid()) { map.setMaxBounds(null); return; }
  map.options.maxBoundsViscosity = 1.0;
  map.setMaxBounds(bounds.pad(0.5));
}

// Re-derives the pan-limit bounds from whatever's actually on venueBoundaryLayer_ right now (or
// lifts the restriction if it's empty) -- called on initial load and after every create/edit/delete
// of the boundary being drawn, so the restriction always tracks the current polygon, not a stale one.
function reapplyVenueBoundaryPanLimit_() {
  if (!venueMapInstance_) return;
  applyBoundaryPanLimit_(venueMapInstance_, (venueBoundaryLayer_ && venueBoundaryLayer_.getLayers().length) ? venueBoundaryLayer_.getBounds() : null);
}

function setVenueLatLng_(lat, lng) {
  var latEl = document.getElementById('fVLat'), lngEl = document.getElementById('fVLng');
  if (latEl) latEl.value = Number(lat).toFixed(6);
  if (lngEl) lngEl.value = Number(lng).toFixed(6);
}

// Reads the currently-drawn boundary polygon (if any) back into a plain {lat,lng}[] array for the
// createVenue/updateVenue payload -- null when nothing's drawn (leaves/clears the boundary server-side).
function getVenueBoundaryValue_() {
  if (!venueBoundaryLayer_) return null;
  var layers = venueBoundaryLayer_.getLayers();
  if (!layers.length) return null;
  var ring = layers[0].getLatLngs()[0]; // polygon rings: [[{lat,lng},...]]
  return ring.map(function (ll) { return { lat: ll.lat, lng: ll.lng }; });
}

// Mirrors the backend's parseBoundary_ (Utils.gs) client-side, for pre-populating the map when
// editing a venue/zone that already has a boundary on record.
function parseBoundaryClient_(boundaryField) {
  if (!boundaryField) return null;
  try {
    var pts = JSON.parse(boundaryField);
    return (Array.isArray(pts) && pts.length >= 3) ? pts : null;
  } catch (e) { return null; }
}

// Mirrors the backend's pointInPolygon_ (Utils.gs) client-side, for instant feedback when placing a
// pin -- createPlace re-checks authoritatively and is what actually enforces the boundary.
function pointInPolygonClient_(lat, lng, points) {
  if (!points || points.length < 3) return false;
  var inside = false;
  for (var i = 0, j = points.length - 1; i < points.length; j = i++) {
    var yi = Number(points[i].lat), xi = Number(points[i].lng);
    var yj = Number(points[j].lat), xj = Number(points[j].lng);
    var intersect = ((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Debounced OpenStreetMap Nominatim place search. Picking a result fills address/city/lat/lng and
// moves the map pin -- purely a shortcut for the manual fields, never required to create a venue.
function wireVenueSearch_() {
  var input = document.getElementById('fVSearch');
  var results = document.getElementById('fVSearchResults');
  if (!input) return;
  input.oninput = function () {
    clearTimeout(venueSearchTimer_);
    var q = input.value.trim();
    if (q.length < 3) { results.style.display = 'none'; results.innerHTML = ''; return; }
    venueSearchTimer_ = setTimeout(function () { runVenueSearch_(q, input, results); }, 400);
  };
}

async function runVenueSearch_(q, input, results) {
  var places = [];
  try {
    var res = await fetch('https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&q=' + encodeURIComponent(q));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    places = await res.json();
  } catch (e) {
    // Nominatim itself is reachable in general -- if this fails, it's almost always a browser
    // privacy/ad-block extension silently dropping the request (the same class of issue we saw
    // with a blocked map-tile CDN earlier). Say so instead of leaving the box looking unresponsive.
    if (results && document.body.contains(results)) {
      results.innerHTML = '<div style="padding:8px 10px;font-size:12.5px;color:var(--danger);">Search unavailable — a browser extension may be blocking it. Fill in the fields below manually instead.</div>';
      results.style.display = 'block';
    }
    return;
  }
  if (!input || !results || !document.body.contains(results)) return; // page may have navigated away meanwhile
  if (!places.length) {
    results.innerHTML = '<div style="padding:8px 10px;font-size:12.5px;color:var(--text-600);">No matches</div>';
    results.style.display = 'block';
    return;
  }
  results.innerHTML = places.map(function (place, i) {
    return '<div class="venue-search-result" data-idx="' + i + '" style="padding:8px 10px;font-size:12.5px;cursor:pointer;border-bottom:1px solid var(--border);">' + esc(place.display_name) + '</div>';
  }).join('');
  results.style.display = 'block';
  results.querySelectorAll('.venue-search-result').forEach(function (row) {
    row.onclick = function () {
      var place = places[Number(row.getAttribute('data-idx'))];
      applyVenueSearchResult_(place);
      results.style.display = 'none'; results.innerHTML = ''; input.value = place.display_name;
    };
  });
}

function applyVenueSearchResult_(place) {
  var lat = Number(place.lat), lng = Number(place.lon);
  setVenueLatLng_(lat, lng);
  var addr = place.address || {};
  var city = addr.city || addr.town || addr.village || addr.municipality || '';
  document.getElementById('fVCity').value = city;
  document.getElementById('fVAddress').value = place.display_name;
  if (venueMapInstance_ && venueMapMarker_) {
    venueMapInstance_.setView([lat, lng], 14);
    venueMapMarker_.setLatLng([lat, lng]);
  }
}

/* ---------------- Places (a Venue's reusable catalog of physical spots) ----------------
 * Route: #/venues/:id/places. Distinct from Participants (event-scoped Vendors/Operators/
 * Exhibitors) -- a Place lives on the Venue itself so it can be reused across every Event held
 * there. Location must land inside the Venue's drawn boundary polygon (see initVenueMap_ above) --
 * enforced here for immediate feedback, and again (authoritatively) server-side in createPlace. A
 * Venue with no boundary drawn yet is unrestricted.
 */
var PLACE_TYPES = ['Operator', 'Vendor', 'Exhibitor', 'Other'];
var PLACE_MAX_DISTANCE_KM = 1;
var placeMapInstance_ = null;
var placeMapMarker_ = null;
var placeMapBoundaryLayer_ = null;
var placeMapFullscreenCleanup_ = null;
var placeMapInspectorPollStop_ = null; // UI.startInspectorLocationPolling cleanup, see initPlaceMap_
var placeMapGen_ = 0; // same map-container-reuse race guard as venueMapGen_ above -- see its comment

async function renderVenuePlaces(params) {
  destroyPlaceMap_();
  var root = document.getElementById('viewRoot');
  var venueId = params.id;
  var venues = await Api.call('listVenues', {});
  var venue = venues.filter(function (v) { return v.id === venueId; })[0];
  if (!venue) { root.innerHTML = '<div class="empty-state">' + esc(Term('venue')) + ' not found.</div>'; return; }

  var role = HululState.user.role;
  // A Venue isn't org-scoped (see file header comment) -- any EMC_MANAGE_ROLES member can manage
  // any venue's Places catalog.
  var canManage = EMC_MANAGE_ROLES.indexOf(role) !== -1;
  var hasBoundary = !!parseBoundaryClient_(venue.boundary);

  var [zones, places] = await Promise.all([
    Api.call('listZones', { venueId: venueId }), Api.call('listPlaces', { venueId: venueId })
  ]);
  var zonesById = {}; zones.forEach(function (z) { zonesById[z.id] = z; });

  var creatorIds = Array.from(new Set(places.map(function (pl) { return pl.createdBy; }).filter(Boolean)));
  var usersById = {};
  if (creatorIds.length) {
    try {
      // No org to scope this by anymore (a Venue Place isn't tied to one EMC) -- listUsers scopes
      // itself to the caller's own org automatically for org-bound roles (see scopeToOrg,
      // Accounts.gs), so an unscoped call is both simpler and correct here.
      (await Api.call('listUsers', {})).forEach(function (u) { usersById[u.id] = u; });
    } catch (e) { /* read-only viewer without listUsers permission -- creator just shows as an id */ }
  }

  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">Places — ' + esc(venue.name) + '</div>' +
    '<div class="page-subtitle">Reusable spots at this ' + esc(Term('venue').toLowerCase()) + ' for Vendors, Operators, and Exhibitors</div></div>' +
    '<div style="display:flex;gap:8px;">' +
      // REQ: "Add a helper button to identify all places within the venue boundary and add them
      // automatically." Needs a drawn boundary to search within (see openDetectPlacesModal_) --
      // hidden rather than shown-disabled when there isn't one, same convention as the rest of this
      // page (e.g. the Add-a-place map's own boundary-dependent hint text).
      (canManage && hasBoundary
        ? '<button class="btn btn-secondary" id="detectPlacesBtn">' + ICON('detect_places') + ' Detect places in boundary</button>'
        : '') +
      '<button class="btn btn-secondary" id="backToVenuesBtn">' + ICON('back') + ' Back</button>' +
    '</div></div>' +
    (canManage ? renderAddPlaceCard_(zones, hasBoundary) : '') +
    '<div class="card"><div class="card-body">' + UI.table([
      { key: 'name', label: 'Name' },
      { key: 'type', label: 'Type' },
      { key: 'zoneId', label: Term('zone'), render: r => zoneDisplayNames_(r.zoneId, zonesById) },
      { key: 'location', label: 'Location', render: r => r.location ? esc(r.location) : '—' },
      { key: 'lat', label: 'Coordinates', render: r => (r.lat !== '' && r.lng !== '') ? (Number(r.lat).toFixed(5) + ', ' + Number(r.lng).toFixed(5)) : '—' },
      // Auto-provisioned login(s) for this place (see provisionPlaceAccount_ in Places.gs) --
      // usually one, but can be more than one for separate shift staff (addPlaceAccount below).
      { key: 'accounts', label: 'Account(s)', render: r => (r.accounts && r.accounts.length)
          ? r.accounts.map(a => '<div style="display:flex;align-items:center;gap:6px;white-space:nowrap;">' +
              '<span>' + esc(a.email) + (a.status !== 'Active' ? ' <span class="muted">(inactive)</span>' : '') + '</span>' +
              (canManage ? '<button class="btn btn-secondary btn-sm btn-icon" title="View credentials" data-view-creds="' + esc(a.id) + '">' + ICON('view_credentials') + '</button>' : '') +
            '</div>').join('')
          : '—' },
      { key: 'createdAt', label: 'Created', render: r => UI.fmtDate(r.createdAt) },
      { key: 'createdBy', label: 'Created By', render: r => usersById[r.createdBy] ? esc(usersById[r.createdBy].name) : (r.createdBy || '—') }
    ].concat(canManage ? [{ key: 'actions', label: 'Actions', render: r =>
        '<button class="btn btn-secondary btn-sm btn-icon" title="Add another account" data-add-account="' + esc(r.id) + '">' + ICON('add_account') + '</button> ' +
        '<button class="btn btn-secondary btn-sm btn-icon" title="Delete" data-delete-place="' + esc(r.id) + '">' + ICON('delete') + '</button>' }] : []),
      places, { emptyText: 'No places yet.' }) + '</div></div>';

  document.getElementById('backToVenuesBtn').onclick = function () { destroyPlaceMap_(); window.location.hash = '#/venues'; };
  var detectPlacesBtn = document.getElementById('detectPlacesBtn');
  if (detectPlacesBtn) detectPlacesBtn.onclick = function () { openDetectPlacesModal_(venue, zones, places); };

  if (canManage) {
    wirePlaceForm_(venue, zones, places);
    document.querySelectorAll('[data-delete-place]').forEach(function (btn) {
      btn.onclick = function () {
        UI.confirmModal('Remove this place? This can\'t be undone.', async function () {
          try { await Api.call('deletePlace', { placeId: btn.getAttribute('data-delete-place') }); UI.toast('Place deleted', 'success'); Router.resolve(); }
          catch (err) { UI.error(err); }
        }, { title: 'Delete place', confirmLabel: 'Delete' });
      };
    });
    document.querySelectorAll('[data-add-account]').forEach(function (btn) {
      btn.onclick = async function () {
        var placeId = btn.getAttribute('data-add-account');
        var place = places.filter(function (pl) { return pl.id === placeId; })[0];
        try {
          var res = await Api.call('addPlaceAccount', { placeId: placeId });
          showPlaceAccountModal_(place || res.place, res.account);
        } catch (err) { UI.error(err); }
      };
    });
    // Re-shows an existing account's credentials/QR (getPlaceAccountCredentials in Places.gs) --
    // the password is a fixed constant, not a secret that was lost, so there's nothing to "reset."
    document.querySelectorAll('[data-view-creds]').forEach(function (btn) {
      btn.onclick = async function () {
        var userId = btn.getAttribute('data-view-creds');
        var place = places.filter(function (pl) { return (pl.accountIds || '').split(',').indexOf(userId) !== -1; })[0];
        try {
          var account = await Api.call('getPlaceAccountCredentials', { userId: userId });
          showPlaceAccountModal_(place, account);
        } catch (err) { UI.error(err); }
      };
    });
  }
}

// Shown right after createPlace/addPlaceAccount, and re-shown any time later via the "🔑 View
// credentials" button (see getPlaceAccountCredentials in Places.gs) -- the password is always the
// same fixed constant, never randomly generated, so re-showing it later is safe/meaningful rather
// than a security hole. quickLoginToken lets a QR code sign the participant straight in (see
// maybeHandleQuickLogin_ in app.js) with no typing required, and stays valid indefinitely, so the
// same QR can be printed once and reused every shift.
function showPlaceAccountModal_(place, account) {
  var name = place ? place.name : account.name;
  var quickUrl = window.location.origin + window.location.pathname + '#/quick-login?token=' + encodeURIComponent(account.quickLoginToken);
  var qrDataUrl = ''; // filled in once the QR renders below; the Print/Share handlers close over this var
  var body =
    '<div style="font-size:13.5px;line-height:1.7;">' +
      '<div style="margin-bottom:12px;">A ' + esc(account.role) + ' login for <strong>' + esc(name) + '</strong>.</div>' +
      '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);"><span class="muted">Email</span><span style="font-weight:600;">' + esc(account.email) + '</span></div>' +
      '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);"><span class="muted">Password</span><span style="font-weight:600;">' + esc(account.password) + '</span></div>' +
      '<div class="muted" style="font-size:11.5px;margin:12px 0 8px;">Scan on the participant\'s phone to sign them in automatically — no typing required. The same code keeps working every time.</div>' +
      '<div id="placeAccountQr" style="display:flex;justify-content:center;padding:6px 0;"></div>' +
    '</div>';
  UI.openModal('Account credentials', body, [
    { label: ICON('print') + ' Print', className: 'btn-secondary', onClick: function () { printPlaceAccountCredentials_(name, account, qrDataUrl); } },
    { label: ICON('share') + ' Share', className: 'btn-secondary', onClick: function () { sharePlaceAccountCredentials_(name, account, quickUrl); } },
    { label: t('close'), className: 'btn-primary', onClick: UI.closeModal }
  ]);
  var qrEl = document.getElementById('placeAccountQr');
  if (qrEl && typeof QRCode !== 'undefined') {
    new QRCode(qrEl, { text: quickUrl, width: 176, height: 176 });
    // qrcodejs renders synchronously via canvas (falling back to an <img> on old browsers) -- grab
    // a data URL from whichever it produced so Print/Share have a self-contained image to use.
    var canvas = qrEl.querySelector('canvas');
    var img = qrEl.querySelector('img');
    qrDataUrl = canvas ? canvas.toDataURL('image/png') : (img ? img.src : '');
  } else if (qrEl) {
    qrEl.innerHTML = '<div class="muted" style="font-size:11.5px;">QR code unavailable — share the email/password above instead.</div>';
  }
}

// Opens a small, print-only window (so the whole app UI doesn't end up on paper) with just the
// name/email/password and QR image, and triggers the browser's print dialog on it.
function printPlaceAccountCredentials_(name, account, qrDataUrl) {
  var w = window.open('', '_blank', 'width=420,height=640');
  if (!w) { UI.toast('Please allow pop-ups to print', 'error'); return; }
  w.document.write(
    '<!DOCTYPE html><html><head><title>' + esc(name) + ' — login</title>' +
    '<meta charset="UTF-8" /><style>' +
      'body{font-family:Arial,Helvetica,sans-serif;padding:28px;text-align:center;color:#111;}' +
      'h2{margin:0 0 18px;}' +
      '.row{display:flex;justify-content:space-between;padding:8px 2px;border-bottom:1px solid #ddd;text-align:left;font-size:14px;}' +
      'img{margin-top:18px;width:200px;height:200px;}' +
      'p{font-size:12px;color:#666;margin-top:14px;}' +
    '</style></head><body>' +
      '<h2>' + esc(name) + '</h2>' +
      '<div class="row"><span>Email</span><strong>' + esc(account.email) + '</strong></div>' +
      '<div class="row"><span>Password</span><strong>' + esc(account.password) + '</strong></div>' +
      (qrDataUrl ? '<img src="' + qrDataUrl + '" alt="Quick sign-in QR code" />' : '') +
      '<p>Scan the QR code to sign in automatically.</p>' +
    '</body></html>'
  );
  w.document.close();
  w.focus();
  // Give the <img> a moment to paint before the print dialog snapshots the page.
  setTimeout(function () { w.print(); }, 300);
}

// Web Share API when available (mobile browsers, and some desktop Chrome builds) -- falls back to
// copying the same text to the clipboard, which covers everywhere else.
async function sharePlaceAccountCredentials_(name, account, quickUrl) {
  var text = name + ' login\nEmail: ' + account.email + '\nPassword: ' + account.password + '\nQuick sign-in: ' + quickUrl;
  if (navigator.share) {
    try { await navigator.share({ title: 'HULUL login — ' + name, text: text }); return; }
    catch (e) { return; } // user cancelled the native share sheet -- not an error worth a toast
  }
  try { await navigator.clipboard.writeText(text); UI.toast('Copied to clipboard', 'success'); }
  catch (e) { UI.toast('Could not copy — copy the details manually', 'error'); }
}

// Zone field for a Place form: a single-select (No zone / All Zones / one zone) for Vendor/
// Exhibitor/Other places, or a multi-checkbox block (All Zones + any number of specific zones) for
// Operator places -- Operators commonly cover several zones during a shift, everyone else covers at
// most one. wireZoneField_ toggles between the two based on the paired Type dropdown; getZoneFieldValue_
// reads back whichever mode is active into the single string shape the backend expects (blank / 'ALL' /
// single id / comma-joined list -- see zoneFieldCoversZone_/zoneFieldIds_ in Utils.gs). `prefix`
// namespaces element ids/classes so this can be dropped into more than one form on the same page.
//
// REQ: "When a zone is set there will be no need to set zones for venues, it will pick up
// automatically." -- autoDetectZone_ below, called whenever a place/participant's pin is placed or
// moved, does a point-in-polygon test against every zone's own drawn boundary and auto-fills this
// single-select when the pin lands inside exactly one of them, replacing it with a small read-only
// "Auto-detected: X" row (ZoneAutoWrap) instead of asking the user to pick manually. Scoped to
// single-select only -- multi-zone (Operator) coverage isn't something one point can represent, so
// that mode is untouched and stays fully manual. A "Change" link (ZoneAutoChangeBtn) lets the user
// override if the auto-pick is wrong; once they do, autoDetectZone_ stops re-overwriting their
// choice on later pin moves (see the userOverride dataset flag).
function zoneFieldHtml_(zones, prefix) {
  var singleOptions = '<option value="">No zone</option><option value="ALL">All Zones</option>' +
    zones.map(function (z) { return '<option value="' + z.id + '">' + esc(z.name) + '</option>'; }).join('');
  var checkboxRows = '<label style="display:flex;align-items:center;gap:6px;font-size:13px;padding:3px 0;font-weight:600;">' +
      '<input type="checkbox" id="' + prefix + 'ZoneAll" /> All Zones</label>' +
    (zones.length ? zones.map(function (z) {
      return '<label style="display:flex;align-items:center;gap:6px;font-size:13px;padding:3px 0;">' +
        '<input type="checkbox" class="' + prefix + 'ZoneCheck" value="' + z.id + '" /> ' + esc(z.name) + '</label>';
    }).join('') : '<div class="muted" style="font-size:12px;padding:3px 0;">No ' + esc(Term('zone_plural').toLowerCase()) + ' set up yet.</div>');
  return (
    '<div id="' + prefix + 'ZoneSingle">' +
      '<div id="' + prefix + 'ZoneAutoWrap" style="display:none;">' +
        '<label class="field-label">' + esc(Term('zone')) + '</label>' +
        '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);font-size:12.5px;">' +
          '<span id="' + prefix + 'ZoneAutoLabel" style="flex:1;"></span>' +
          '<button type="button" id="' + prefix + 'ZoneAutoChangeBtn" class="map-toggle-btn" style="padding:3px 8px;font-size:11px;">Change</button>' +
        '</div>' +
      '</div>' +
      '<div id="' + prefix + 'ZoneManualWrap">' +
        UI.field(Term('zone') + ' (optional)', '<select id="' + prefix + 'ZoneSelect" class="field-input">' + singleOptions + '</select>') +
      '</div>' +
    '</div>' +
    '<div id="' + prefix + 'ZoneMulti" style="display:none;">' +
      '<label class="field-label">' + esc(Term('zone_plural')) + ' (optional — Operators may cover more than one)</label>' +
      '<div style="max-height:150px;overflow:auto;border:1px solid var(--border);border-radius:var(--radius-sm);padding:6px 10px;">' + checkboxRows + '</div>' +
    '</div>'
  );
}

function wireZoneField_(prefix, typeSelectId) {
  var typeSelect = document.getElementById(typeSelectId);
  var singleEl = document.getElementById(prefix + 'ZoneSingle');
  var multiEl = document.getElementById(prefix + 'ZoneMulti');
  var allCheck = document.getElementById(prefix + 'ZoneAll');
  var zoneChecks = document.querySelectorAll('.' + prefix + 'ZoneCheck');
  function sync() {
    var isMulti = typeSelect && typeSelect.value === 'Operator';
    if (singleEl) singleEl.style.display = isMulti ? 'none' : '';
    if (multiEl) multiEl.style.display = isMulti ? '' : 'none';
  }
  if (typeSelect) typeSelect.onchange = sync;
  sync();
  if (allCheck) allCheck.onchange = function () {
    if (allCheck.checked) zoneChecks.forEach(function (c) { c.checked = false; c.disabled = true; });
    else zoneChecks.forEach(function (c) { c.disabled = false; });
  };
  zoneChecks.forEach(function (c) {
    c.onchange = function () { if (c.checked && allCheck) { allCheck.checked = false; zoneChecks.forEach(function (cc) { cc.disabled = false; }); } };
  });

  var changeBtn = document.getElementById(prefix + 'ZoneAutoChangeBtn');
  if (changeBtn) changeBtn.onclick = function () {
    var select = document.getElementById(prefix + 'ZoneSelect');
    if (select) select.dataset.userOverride = '1';
    var autoWrap = document.getElementById(prefix + 'ZoneAutoWrap');
    var manualWrap = document.getElementById(prefix + 'ZoneManualWrap');
    if (autoWrap) autoWrap.style.display = 'none';
    if (manualWrap) manualWrap.style.display = '';
  };
}

// Point-in-polygon test against every zone's own drawn boundary (parseBoundaryClient_/
// pointInPolygonClient_, both below) -- the first match wins (zones aren't expected to overlap; if
// they ever do, this is a reasonable tie-break, not a hard guarantee). No-ops safely wherever the
// Auto/Manual wrapper elements don't exist (Operator's multi-checkbox mode, or a form that never
// rendered zoneFieldHtml_ at all) and once the user has clicked "Change" to override.
function autoDetectZone_(prefix, zones, lat, lng) {
  var autoWrap = document.getElementById(prefix + 'ZoneAutoWrap');
  var manualWrap = document.getElementById(prefix + 'ZoneManualWrap');
  var select = document.getElementById(prefix + 'ZoneSelect');
  var autoLabel = document.getElementById(prefix + 'ZoneAutoLabel');
  if (!autoWrap || !manualWrap || !select) return;
  if (select.dataset.userOverride === '1') return;
  var match = (zones || []).filter(function (z) {
    var b = parseBoundaryClient_(z.boundary);
    return b && pointInPolygonClient_(lat, lng, b);
  })[0];
  if (match) {
    select.value = match.id;
    if (autoLabel) autoLabel.textContent = 'Auto-detected: ' + match.name;
    autoWrap.style.display = '';
    manualWrap.style.display = 'none';
  } else {
    autoWrap.style.display = 'none';
    manualWrap.style.display = '';
  }
}

function getZoneFieldValue_(prefix) {
  var multiEl = document.getElementById(prefix + 'ZoneMulti');
  var isMulti = multiEl && multiEl.style.display !== 'none';
  if (!isMulti) {
    var sel = document.getElementById(prefix + 'ZoneSelect');
    return sel ? sel.value : '';
  }
  var allCheck = document.getElementById(prefix + 'ZoneAll');
  if (allCheck && allCheck.checked) return 'ALL';
  var ids = [];
  document.querySelectorAll('.' + prefix + 'ZoneCheck').forEach(function (c) { if (c.checked) ids.push(c.value); });
  return ids.join(',');
}

// Renders a stored zoneId field (blank / 'ALL' / single id / comma-list) as human-readable zone
// name(s) for display in tables. Shared by venues.js/eventPlaces.js/eventDetail.js. blankText lets
// callers override what an unset field means in their context -- e.g. a Place with no zone is simply
// "unassigned" (default '—'), while a Participant with no zoneId is treated as covering every zone
// for inspection purposes (pass 'All zones').
function zoneDisplayNames_(zoneIdField, zonesById, blankText) {
  if (!zoneIdField) return blankText !== undefined ? blankText : '—';
  if (zoneIdField === 'ALL') return 'All Zones';
  return String(zoneIdField).split(',').filter(Boolean).map(function (id) {
    return zonesById[id] ? zonesById[id].name : id;
  }).join(', ');
}

function renderAddPlaceCard_(zones, hasBoundary) {
  return '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">Add a place</div></div>' +
    '<div class="card-body" style="display:flex;flex-direction:column;gap:4px;">' +
      '<div style="max-width:640px;display:flex;flex-direction:column;gap:4px;">' +
        UI.field('Name', '<input id="fPlName" class="field-input" />') +
        '<div class="form-row">' +
          UI.field('Type', '<select id="fPlType" class="field-input">' + PLACE_TYPES.map(function (ty) { return '<option value="' + ty + '">' + ty + '</option>'; }).join('') + '</select>') +
          '<div>' + zoneFieldHtml_(zones, 'fPl') + '</div>' +
        '</div>' +
        UI.field('Location (optional)', '<input id="fPlLocation" class="field-input" placeholder="e.g. Near Gate A, north entrance" />') +
        '<div class="form-row">' +
          UI.field('Latitude', '<input id="fPlLat" type="number" step="any" class="field-input" />') +
          UI.field('Longitude', '<input id="fPlLng" type="number" step="any" class="field-input" />') +
        '</div>' +
      '</div>' +
      '<div id="placeMap" style="height:360px;width:100%;border-radius:var(--radius-sm);margin-top:10px;border:1px solid var(--border);"></div>' +
      '<div class="muted" style="font-size:11px;margin-top:6px;">' +
        (hasBoundary
          ? 'Click or drag the pin to set the exact spot — must stay within the ' + esc(Term('venue').toLowerCase()) + ' boundary (shaded area).'
          : 'This ' + esc(Term('venue').toLowerCase()) + ' has no boundary drawn yet, so location isn\'t map-restricted — click the map or type coordinates manually.') +
      '</div>' +
    '</div>' +
    '<div style="display:flex;justify-content:flex-end;gap:8px;padding:14px 20px;border-top:1px solid var(--border);">' +
      '<button class="btn btn-primary" id="addPlaceBtn">Add place</button>' +
    '</div>' +
  '</div>';
}

function wirePlaceForm_(venue, zones, places) {
  initPlaceMap_(venue, zones, places);
  wireZoneField_('fPl', 'fPlType');
  wireSuggestableField_('fPlName');
  wireSuggestableField_('fPlLocation');
  document.getElementById('addPlaceBtn').onclick = async function () {
    try {
      var name = document.getElementById('fPlName').value.trim();
      if (!name) { UI.toast('Name is required', 'error'); return; }
      var payload = {
        venueId: venue.id, name: name, type: document.getElementById('fPlType').value,
        zoneId: getZoneFieldValue_('fPl'), location: document.getElementById('fPlLocation').value,
        lat: document.getElementById('fPlLat').value, lng: document.getElementById('fPlLng').value
      };
      var res = await Api.call('createPlace', payload);
      UI.toast('Place added', 'success');
      await Router.resolve();
      showPlaceAccountModal_(res.place, res.account);
    } catch (err) { UI.error(err); }
  };
}

// Same HululLeaflet-alias reasoning as initVenueMap_ above (this app's own labels.js clobbers the
// bare global L). The map is centered on the Venue and, when the Venue has a boundary drawn on
// record (see initVenueMap_/Leaflet.draw), shows it shaded -- clicks/drags outside it are rejected
// client-side for instant feedback, and rejected again (authoritatively) server-side in createPlace.
// A venue with no boundary drawn yet is unrestricted, same fallback as no venue coords at all.
function initPlaceMap_(venue, zones, places) {
  var el = document.getElementById('placeMap');
  if (!el) return;
  if (typeof HululLeaflet === 'undefined') {
    el.style.display = 'flex'; el.style.alignItems = 'center'; el.style.justifyContent = 'center';
    el.style.color = 'var(--text-600)'; el.style.fontSize = '12px'; el.style.textAlign = 'center'; el.style.padding = '12px';
    el.textContent = 'Map unavailable (couldn\'t load the map library) — type coordinates manually below.';
    return;
  }
  var hasCoords = !!(venue.lat && venue.lng);
  var boundary = parseBoundaryClient_(venue.boundary);
  var center = hasCoords ? [Number(venue.lat), Number(venue.lng)] : VENUE_DEFAULT_CENTER;
  var myGen = ++placeMapGen_;
  setTimeout(function () {
    if (myGen !== placeMapGen_) return; // superseded by a newer render before this tick fired
    var mapEl = document.getElementById('placeMap');
    if (!mapEl || mapEl._leaflet_id) return; // gone, or (defensive belt-and-suspenders) already claimed
    placeMapInstance_ = HululLeaflet.map('placeMap').setView(center, hasCoords ? 16 : 6);
    var osmLayer = HululLeaflet.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19
    }).addTo(placeMapInstance_);
    // REQ: "Move the Use my location / Satellite buttons inside map canvas." -- built and appended
    // directly into mapEl (UI.mapControls) instead of living in the card header above the map. This
    // also means wireMapFullscreen no longer needs to reparent them (see the old BUG comment this
    // replaced): they're already inside the div that goes full screen.
    var locBtn = UI.mapToggleButton('useMyLocationBtn', 'location_pin', 'Use my location');
    var satBtn = UI.mapToggleButton('toggleSatelliteBtn', 'satellite_toggle', 'Satellite');
    UI.mapControls(mapEl, [locBtn, satBtn]);
    placeMapFullscreenCleanup_ = UI.wireMapFullscreen(mapEl, placeMapInstance_);
    var satelliteLayer = HululLeaflet.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: '&copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics', maxZoom: 19
    });
    var showingSatellite = false;
    satBtn.onclick = function () {
      showingSatellite = !showingSatellite;
      if (showingSatellite) { placeMapInstance_.removeLayer(osmLayer); satelliteLayer.addTo(placeMapInstance_); satBtn.innerHTML = ICON('map_toggle') + ' Map'; }
      else { placeMapInstance_.removeLayer(satelliteLayer); osmLayer.addTo(placeMapInstance_); satBtn.innerHTML = ICON('satellite_toggle') + ' Satellite'; }
    };
    if (boundary) {
      var venueBoundaryColor = (venue && venue.color) || VENUE_BOUNDARY_DEFAULT_COLOR_;
      placeMapBoundaryLayer_ = HululLeaflet.polygon(boundary.map(function (pt) { return [pt.lat, pt.lng]; }), {
        color: venueBoundaryColor, fillColor: venueBoundaryColor, fillOpacity: 0.06, weight: 1.5
      }).addTo(placeMapInstance_);
      placeMapInstance_.fitBounds(placeMapBoundaryLayer_.getBounds(), { padding: [20, 20] });
      applyBoundaryPanLimit_(placeMapInstance_, placeMapBoundaryLayer_.getBounds());
    }
    // REQ: "Zone boundaries to be visible" / "Participant dots to be visible. This applies to all
    // maps." -- context for where the new place will land, same as the Event > Venue & Zones "Places
    // map" already showed (UI.drawZoneBoundaries/drawPlaceDots, ui.js).
    UI.drawZoneBoundaries(placeMapInstance_, zones);
    UI.drawPlaceDots(placeMapInstance_, places);
    // REQ: "Inspectors live location as they start inspections. This applies to all maps."
    placeMapInspectorPollStop_ = UI.startInspectorLocationPolling(placeMapInstance_, { venueId: venue.id }, 20000);
    placeMapMarker_ = HululLeaflet.marker(center, { draggable: true }).addTo(placeMapInstance_);
    setPlaceLatLng_(center[0], center[1]);
    autoDetectZone_('fPl', zones, center[0], center[1]);
    suggestNameFromMap_('fPlName', center[0], center[1]);
    suggestFromNearestPlace_('fPlLocation', center[0], center[1], places, function (n) { return 'Near ' + n; });

    // Shared by drag, click, and "Use my location" -- rejects (with the same message) any point
    // outside the venue's drawn boundary when one exists; otherwise moves the pin and re-centres the
    // lat/lng fields. recenter=true also pans/zooms the map itself, used for "Use my location" since
    // that point may be far outside the current view.
    function tryPlacePin_(lat, lng, recenter) {
      if (boundary && !pointInPolygonClient_(lat, lng, boundary)) {
        UI.toast('Must stay within the ' + Term('venue').toLowerCase() + ' boundary', 'error');
        return false;
      }
      placeMapMarker_.setLatLng([lat, lng]);
      placeMapMarker_._hululLastValid = [lat, lng];
      setPlaceLatLng_(lat, lng);
      autoDetectZone_('fPl', zones, lat, lng);
      suggestNameFromMap_('fPlName', lat, lng);
      suggestFromNearestPlace_('fPlLocation', lat, lng, places, function (n) { return 'Near ' + n; });
      if (recenter) placeMapInstance_.setView([lat, lng], 17);
      return true;
    }

    placeMapMarker_.on('dragend', function () {
      var pos = placeMapMarker_.getLatLng();
      if (!tryPlacePin_(pos.lat, pos.lng, false)) placeMapMarker_.setLatLng(placeMapMarker_._hululLastValid || center);
    });
    placeMapMarker_._hululLastValid = center;
    placeMapInstance_.on('click', function (e) { tryPlacePin_(e.latlng.lat, e.latlng.lng, false); });

    locBtn.onclick = function () {
      if (!navigator.geolocation) { UI.toast('Geolocation isn\'t available in this browser', 'error'); return; }
      locBtn.disabled = true; locBtn.innerHTML = ICON('location_pin') + ' Locating…';
      navigator.geolocation.getCurrentPosition(function (pos) {
        locBtn.disabled = false; locBtn.innerHTML = ICON('location_pin') + ' Use my location';
        tryPlacePin_(pos.coords.latitude, pos.coords.longitude, true);
      }, function (err) {
        locBtn.disabled = false; locBtn.innerHTML = ICON('location_pin') + ' Use my location';
        UI.toast(err && err.code === 1 ? 'Location permission denied' : 'Could not get your location', 'error');
      }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 });
    };

    setTimeout(function () { if (placeMapInstance_) placeMapInstance_.invalidateSize(); }, 150);
  }, 0);
}

function destroyPlaceMap_() {
  placeMapGen_++; // invalidate any still-pending initPlaceMap_ setTimeout from an earlier render
  if (placeMapFullscreenCleanup_) { placeMapFullscreenCleanup_(); placeMapFullscreenCleanup_ = null; }
  if (placeMapInspectorPollStop_) { placeMapInspectorPollStop_(); placeMapInspectorPollStop_ = null; }
  if (placeMapInstance_) { placeMapInstance_.remove(); placeMapInstance_ = null; placeMapMarker_ = null; placeMapBoundaryLayer_ = null; }
}

function setPlaceLatLng_(lat, lng) {
  var latEl = document.getElementById('fPlLat'), lngEl = document.getElementById('fPlLng');
  if (latEl) latEl.value = Number(lat).toFixed(6);
  if (lngEl) lngEl.value = Number(lng).toFixed(6);
}

// Same haversine formula as the backend's (Places.gs) -- used here only for instant client-side
// feedback; createPlace re-checks authoritatively and is what actually enforces the limit.
function haversineKm_(lat1, lng1, lat2, lng2) {
  var R = 6371;
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLng = (lng2 - lng1) * Math.PI / 180;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// REQ: "When adding a participant location on the map, when placing the pin, automatically fill in
// the name of the closest place name on the map as a suggestion." Shared by venues.js's own
// Add-a-place map (tryPlacePin_) and eventPlaces.js's Add-participant map (tryEventPlacePin_) --
// haversineKm_ just above is the same great-circle distance already used by the live-inspection
// nearest-participant screen (eventDetail.js). Returns null when no candidate has coordinates, so
// callers know to leave the Location field untouched rather than write "Near null".
function nearestPlaceName_(lat, lng, places) {
  var nearest = null, nearestDist = Infinity;
  (places || []).forEach(function (pl) {
    if (pl.lat === '' || pl.lat == null || pl.lng === '' || pl.lng == null) return;
    var d = haversineKm_(lat, lng, Number(pl.lat), Number(pl.lng));
    if (d < nearestDist) { nearestDist = d; nearest = pl; }
  });
  return nearest ? nearest.name : null;
}

// Auto-fills a field with a suggestion derived from the closest ALREADY-REGISTERED place in our own
// DB, as an editable starting point -- used for the Location field ("Near Samad Liraqi"). NOT used
// for the Name field (see suggestNameFromMap_ below) -- REQ report: "instead of adding Okai in the
// name textbox, it added the nearest vendor on my DB... What I wanted is to have Okai in the name
// textbox not the nearest existing place in my DB" -- the Name suggestion needs the real-world
// place shown on the map tile at the dropped pin, which is a different data source entirely (OSM,
// not our own Places/Participants). Stops touching the field the moment the user types in it
// themselves (fieldEl.dataset.userEdited, set by a one-time 'input' listener wireSuggestableField_
// below wires up) -- same don't-clobber-manual-input convention autoDetectZone_ uses
// (dataset.userOverride) for the zone field above. No-ops quietly if there's no candidate place with
// coordinates yet, or the field isn't on the page.
function suggestFromNearestPlace_(fieldId, lat, lng, places, format) {
  var el = document.getElementById(fieldId);
  if (!el || el.dataset.userEdited === '1') return;
  var name = nearestPlaceName_(lat, lng, places);
  if (name) el.value = format(name);
}

// Wires the one-time 'input' listener suggestFromNearestPlace_/suggestNameFromMap_ need to know a
// field's current value was typed by the user, not left over from its own last auto-fill -- call
// once per wire*Form_, right after the field exists in the DOM (before any pin placement can fire a
// suggestion).
function wireSuggestableField_(fieldId) {
  var el = document.getElementById(fieldId);
  if (el) el.addEventListener('input', function () { el.dataset.userEdited = '1'; });
}

// REQ report: the Name field's suggestion needs the real-world business/POI name shown on the map
// tile itself at the dropped pin (e.g. "Okai"), not our own DB's nearest registered place (that was
// the original wrong behavior). Reverse-geocodes via the same OpenStreetMap Nominatim service
// wireVenueSearch_ already calls directly from the browser (no backend proxy) for the venue address
// search box above -- zoom=18 asks for POI/building-level detail rather than a whole street or
// suburb. Nominatim's own reverse response puts a matched POI's name at the top level (data.name),
// or under namedetails, or (a Nominatim quirk) keyed by its own category under address (e.g.
// address.amenity/shop/tourism) -- tried in that order. suggestSeq_ guards against an older, slower
// response landing after a newer pin placement already fired a fresh request. Silently does nothing
// on a network hiccup, rate-limit, or no match at that spot -- this is only ever a convenience
// suggestion, never something the form depends on to work.
var suggestNameFromMapSeq_ = 0;
async function suggestNameFromMap_(fieldId, lat, lng) {
  var el = document.getElementById(fieldId);
  if (!el || el.dataset.userEdited === '1') return;
  var mySeq = ++suggestNameFromMapSeq_;
  try {
    var res = await fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=' + lat + '&lon=' + lng + '&zoom=18&addressdetails=1&namedetails=1');
    if (mySeq !== suggestNameFromMapSeq_ || !res.ok) return; // superseded, or Nominatim itself errored
    var data = await res.json();
    if (mySeq !== suggestNameFromMapSeq_ || el.dataset.userEdited === '1') return;
    var addr = data.address || {};
    var name = (data.namedetails && data.namedetails.name) || data.name ||
      addr.amenity || addr.shop || addr.tourism || addr.leisure || addr.office || addr.building || null;
    if (name) el.value = name;
  } catch (e) { /* offline/blocked -- the form still works, just without a name suggestion */ }
}

/* ---------------- Detect places in boundary (venues.js "Places" page helper button) ----------------
 * REQ: "Add a helper button to identify all places within the venue boundary and add them
 * automatically." Queries the Overpass API (OpenStreetMap's bulk-query service -- a different
 * endpoint from the Nominatim search/reverse-geocode calls above, but the same
 * call-OSM-directly-from-the-browser pattern) for every named real-world point inside the venue's
 * drawn boundary, lets the PM review/deselect/correct-type before anything is created (each row here
 * becomes a real Place PLUS an auto-provisioned login account -- see Places.gs -- so nothing gets
 * created without a human looking at it first), then bulk-creates the selected ones via
 * bulkImportPlaces (Places.gs).
 */

// Overpass' `poly` filter wants "lat lon lat lon ..." (space-separated, polygon not explicitly
// closed). Queries both nodes and ways with a name tag -- most POIs are nodes, but some (e.g. a
// whole named building) are mapped as ways, whose centroid `out center` provides directly. Throws on
// a network/HTTP failure so the caller can show a real error instead of silently finding nothing.
async function queryOsmPlacesInBoundary_(boundary) {
  var polyStr = boundary.map(function (pt) { return pt.lat + ' ' + pt.lng; }).join(' ');
  var query = '[out:json][timeout:25];(node["name"](poly:"' + polyStr + '");way["name"](poly:"' + polyStr + '"););out center tags;';
  var res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(query) });
  if (!res.ok) throw new Error('OpenStreetMap lookup failed (HTTP ' + res.status + ')');
  var data = await res.json();
  return (data.elements || []).map(function (el) {
    var lat = el.type === 'node' ? el.lat : (el.center && el.center.lat);
    var lng = el.type === 'node' ? el.lon : (el.center && el.center.lon);
    var tags = el.tags || {};
    if (lat == null || lng == null || !tags.name) return null;
    return { name: tags.name, lat: lat, lng: lng, tags: tags };
  }).filter(Boolean);
}

// Best-effort OSM-tag -> PLACE_TYPES guess -- purely a starting point shown (and editable) per row in
// the picker modal, never authoritative; the PM corrects it there before anything is created.
function osmCandidateType_(tags) {
  if (tags.shop || ['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'food_court', 'ice_cream', 'bakery'].indexOf(tags.amenity) !== -1) return 'Vendor';
  if (tags.office) return 'Operator';
  if (['toilets', 'information', 'security', 'first_aid', 'atm', 'bank', 'pharmacy', 'parking'].indexOf(tags.amenity) !== -1) return 'Operator';
  if (tags.tourism || tags.leisure || tags.craft) return 'Exhibitor';
  return 'Other';
}

// REQ: "No duplicated allowed, check by name and geolocation." A candidate is flagged as already on
// record if EITHER signal matches an existing place at this venue: same name (case-insensitive,
// trimmed -- OSM vs. manually-typed capitalization/spacing can differ) OR within
// OSM_DUPLICATE_RADIUS_M_ of an existing place's own coordinates (a manually-dropped pin and OSM's
// own node for the same real-world spot are rarely bit-for-bit identical). Either signal alone is
// enough to flag it -- e.g. a shop renamed on OSM but not yet in our own catalog (same spot,
// different name) still gets caught by geolocation even though the name no longer matches. Mutates
// and returns candidates with an `alreadyExists` flag rather than filtering them out, so the picker
// can show (disabled, unchecked) *why* fewer new candidates appear than what's visible on the map.
var OSM_DUPLICATE_RADIUS_M_ = 15;
function markOsmDuplicates_(candidates, existingPlaces) {
  var existingWithCoords = (existingPlaces || []).filter(function (pl) { return pl.lat !== '' && pl.lat != null && pl.lng !== '' && pl.lng != null; });
  var existingNames = {};
  (existingPlaces || []).forEach(function (pl) { existingNames[String(pl.name || '').trim().toLowerCase()] = true; });
  candidates.forEach(function (c) {
    var nameMatch = !!existingNames[String(c.name || '').trim().toLowerCase()];
    var geoMatch = existingWithCoords.some(function (pl) {
      return haversineKm_(c.lat, c.lng, Number(pl.lat), Number(pl.lng)) * 1000 <= OSM_DUPLICATE_RADIUS_M_;
    });
    c.alreadyExists = nameMatch || geoMatch;
  });
  return candidates;
}

// Row markup for one OSM candidate inside the picker modal -- a checkbox (pre-checked unless already
// on record, in which case disabled+unchecked+labelled), the name, an editable Type select
// (osmCandidateType_'s guess pre-selected), and the auto-detected zone (read-only text -- same
// pointInPolygonClient_ test autoDetectZone_ uses for the single-place form, just run once per
// candidate here instead of wired to a live field).
function osmCandidateRowHtml_(c, i, zones) {
  var zoneMatch = (zones || []).filter(function (z) {
    var b = parseBoundaryClient_(z.boundary);
    return b && pointInPolygonClient_(c.lat, c.lng, b);
  })[0];
  c._zoneId = zoneMatch ? zoneMatch.id : '';
  return '<tr style="' + (c.alreadyExists ? 'opacity:.5;' : '') + '">' +
    '<td style="padding:6px 8px;"><input type="checkbox" class="osm-candidate-check" data-idx="' + i + '"' +
      (c.alreadyExists ? ' disabled' : ' checked') + ' /></td>' +
    '<td style="padding:6px 8px;font-size:12.5px;">' + esc(c.name) + (c.alreadyExists ? ' <span class="muted">(already added)</span>' : '') + '</td>' +
    '<td style="padding:6px 8px;">' +
      '<select class="field-input osm-candidate-type" data-idx="' + i + '" style="font-size:12px;padding:4px 6px;" ' + (c.alreadyExists ? 'disabled' : '') + '>' +
        PLACE_TYPES.map(function (ty) { return '<option value="' + ty + '"' + (ty === c._type ? ' selected' : '') + '>' + ty + '</option>'; }).join('') +
      '</select>' +
    '</td>' +
    '<td style="padding:6px 8px;font-size:12px;" class="muted">' + esc(zoneMatch ? zoneMatch.name : '—') + '</td>' +
  '</tr>';
}

async function openDetectPlacesModal_(venue, zones, existingPlaces) {
  var boundary = parseBoundaryClient_(venue.boundary);
  if (!boundary) { UI.toast('Draw this ' + Term('venue').toLowerCase() + '\'s boundary first (Edit ' + Term('venue').toLowerCase() + ') -- there\'s nothing to search within yet.', 'error'); return; }

  UI.openModal('Detect places in boundary', '<div style="font-size:13px;padding:6px 0;">Searching OpenStreetMap for named places inside this ' + esc(Term('venue').toLowerCase()) + '\'s boundary…</div>', []);
  var candidates;
  try {
    candidates = await queryOsmPlacesInBoundary_(boundary);
  } catch (err) {
    UI.closeModal();
    UI.error(err);
    return;
  }
  candidates.forEach(function (c) { c._type = osmCandidateType_(c.tags); });
  markOsmDuplicates_(candidates, existingPlaces);

  var newCount = candidates.filter(function (c) { return !c.alreadyExists; }).length;
  if (!candidates.length) {
    UI.closeModal();
    UI.toast('No named places found on OpenStreetMap inside this boundary.', 'error');
    return;
  }

  function renderBody() {
    return '<div style="font-size:12.5px;margin-bottom:10px;" class="muted">' +
        (newCount ? 'Found ' + candidates.length + ' place(s), ' + newCount + ' new -- review, adjust type if needed, and uncheck any you don\'t want.'
          : 'Found ' + candidates.length + ' place(s), all already on record at this ' + esc(Term('venue').toLowerCase()) + '.') +
      '</div>' +
      '<div style="max-height:360px;overflow-y:auto;">' +
        '<table style="width:100%;border-collapse:collapse;">' +
          '<thead><tr style="text-align:left;font-size:11px;color:var(--text-600);text-transform:uppercase;">' +
            '<th style="padding:6px 8px;"></th><th style="padding:6px 8px;">Name</th><th style="padding:6px 8px;">Type</th><th style="padding:6px 8px;">' + esc(Term('zone')) + '</th>' +
          '</tr></thead>' +
          '<tbody>' + candidates.map(function (c, i) { return osmCandidateRowHtml_(c, i, zones); }).join('') + '</tbody>' +
        '</table>' +
      '</div>';
  }

  UI.openModal('Detect places in boundary', renderBody(), [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: 'Add selected places', className: 'btn-primary', onClick: async function () {
        var selectedIdx = Array.from(document.querySelectorAll('.osm-candidate-check:checked')).map(function (cb) { return Number(cb.getAttribute('data-idx')); });
        if (!selectedIdx.length) { UI.toast('Select at least one place to add', 'error'); return; }
        document.querySelectorAll('.osm-candidate-type').forEach(function (sel) {
          var idx = Number(sel.getAttribute('data-idx'));
          if (candidates[idx]) candidates[idx]._type = sel.value;
        });
        var payload = selectedIdx.map(function (i) {
          var c = candidates[i];
          return { name: c.name, type: c._type, zoneId: c._zoneId || '', lat: c.lat, lng: c.lng, location: '' };
        });
        // A single batched request (bulkImportPlaces creates every selected row server-side in one
        // call), not one request per row -- so a real per-item progress bar (UI.progressModal) would
        // have nothing to actually track and just sit at 0% until the whole thing resolves. A plain
        // loading modal says the same thing honestly.
        UI.openModal('Adding places…', '<div style="font-size:13px;padding:6px 0;">Adding ' + payload.length + ' place(s)…</div>', []);
        var res;
        try {
          res = await Api.call('bulkImportPlaces', { venueId: venue.id, places: payload });
        } catch (err) { UI.closeModal(); UI.error(err); return; }
        UI.closeModal();
        var msg = res.createdCount + ' place(s) added' + (res.failed.length ? ', ' + res.failed.length + ' failed (' + res.failed.map(function (f) { return f.name; }).join(', ') + ')' : '');
        UI.toast(msg, res.failed.length ? 'error' : 'success');
        if (res.createdCount) Router.resolve();
      } }
  ]);
}
