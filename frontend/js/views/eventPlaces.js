/**
 * HULUL - Event workspace > Participants tab.
 *
 * REQ: "Should be a replicant of the Places page but participant accounts are registered under
 * events not venues, as they may be just attending this season of events. When an event ends all
 * participant accounts registered under events will be deactivated." So this mirrors venues.js's
 * Places page (renderVenuePlaces) almost exactly -- same add-a-place-with-map form, same
 * auto-provisioned login/QR-credentials/multi-account table -- except every Place created here
 * carries this Event's id (createPlace({eventId, ...}), see Places.gs) instead of being permanent
 * venue-wide infrastructure. Server-side, Places.gs's deactivateEndedEventPlaceAccounts (piggybacking
 * on the existing 30-min escalation trigger, see Setup.gs) is what actually deactivates their logins
 * once the Event's endDateTime passes.
 *
 * Reuses venues.js's showPlaceAccountModal_/printPlaceAccountCredentials_/sharePlaceAccountCredentials_
 * (already generic -- take a place/account pair, no venue-specific state) and PLACE_TYPES/
 * PLACE_MAX_DISTANCE_KM/haversineKm_ as-is; the map (below) is its own instance with its own DOM id
 * and state vars so it doesn't collide with the Venues > Places page's map.
 *
 * The PM "assign disciplines to a participant" feature (bulkAssignParticipantDisciplines) isn't a
 * Places-catalog concept (venues.js's Places page has no such thing) -- it lives in its own tab,
 * tabParticipantDisciplines below (EVENT_TABS' "Participant's Discipline" tab, eventDetail.js),
 * driven by listParticipants (which merges permanent venue-wide participants with this Event's own
 * temporary ones -- see the eventId filter added to Participants.gs's listParticipants).
 */
var EVENT_PLACE_MANAGE_ROLES = ['SystemAdmin', 'EMCAdmin', 'EMCManager', 'EventManager'];
// Matches dedupeParticipants' own backend requireRole.
var PARTICIPANT_DEDUPE_ROLES = ['SystemAdmin', 'EventManager'];
var eventPlaceMapInstance_ = null;
var eventPlaceMapMarker_ = null;
var eventPlaceMapBoundaryLayer_ = null;
var eventPlaceMapInspectorPollStop_ = null; // UI.startInspectorLocationPolling cleanup, see initEventPlaceMap_

async function tabParticipants(content, eventId, detail) {
  destroyEventPlaceMap_(); // in case a previous visit to this tab left one behind
  var venue = detail && detail.venue;
  var event = detail && detail.event;
  var role = HululState.user.role;
  // Event Places key off the Event's own renting EMC (event.emcId), not the Venue -- a Venue isn't
  // connected to any one EMC (see Events.gs file header comment), so that's the authoritative org
  // relationship here, matching assertCanManagePlace_ in Places.gs.
  var canManage = !!venue && EVENT_PLACE_MANAGE_ROLES.indexOf(role) !== -1 &&
    (role === 'SystemAdmin' || (event && event.emcId === HululState.user.orgId) || (event && event.eventManagerId === HululState.user.id));
  var canDedupe = PARTICIPANT_DEDUPE_ROLES.indexOf(role) !== -1;
  var hasBoundary = !!(venue && parseBoundaryClient_(venue.boundary));

  if (!venue) {
    content.innerHTML = '<div class="card"><div class="card-body"><div class="empty-state">Assign a ' + esc(Term('venue').toLowerCase()) + ' to this ' + esc(Term('event').toLowerCase()) + ' first (Venue &amp; Zones tab) -- ' + esc(Term('participant_plural').toLowerCase()) + ' are registered per event once a venue is set.</div></div></div>';
    return;
  }

  // Active-only, for the Add-a-participant zone picker and boundary map's auto-detect.
  var zones = detail.zones || [];

  var results = await Promise.all([
    Api.call('listPlaces', { eventId: eventId }),
    Api.call('listParticipants', { venueId: venue.id, eventId: eventId }),
    // includeDeleted: true -- a participant can still reference a since-deleted zone (soft-delete,
    // see activeZonesForVenue_/listZones in Events.gs); without deleted zones in zonesById below,
    // zoneDisplayNames_ has no name to resolve and falls back to printing the raw zone id in the
    // table instead. detail.zones (active-only, above) stays what's actually offered as a choice.
    Api.call('listZones', { venueId: venue.id, includeDeleted: true })
  ]);
  var places = results[0], participants = results[1], zonesAll = results[2];
  var zonesById = {}; zonesAll.forEach(function (z) { zonesById[z.id] = z; });

  var creatorIds = Array.from(new Set(places.map(function (pl) { return pl.createdBy; }).filter(Boolean)));
  var usersById = {};
  if (creatorIds.length) {
    try { (await Api.call('listUsers', { orgId: event && event.emcId })).forEach(function (u) { usersById[u.id] = u; }); }
    catch (e) { /* read-only viewer without listUsers permission -- creator just shows as an id */ }
  }

  content.innerHTML =
    '<div class="muted" style="font-size:11.5px;margin-bottom:14px;">' + esc(Term('participant_plural')) +
      ' registered for this ' + esc(Term('event').toLowerCase()) + ' only — each one gets its own login, just like the ' +
      esc(Term('venue').toLowerCase()) + '\'s Places catalog, but their accounts are automatically deactivated once this ' +
      esc(Term('event').toLowerCase()) + ' ends.</div>' +
    (canManage ? renderAddEventPlaceCard_(zones, hasBoundary) : '') +

    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + esc(Term('participant_plural')) + '</div>' +
    (canDedupe ? '<button class="btn btn-secondary btn-sm" id="dedupeParticipantsBtn">Remove duplicates</button>' : '') +
    '</div><div class="card-body">' + UI.table([
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
      places, { emptyText: 'No ' + esc(Term('participant_plural').toLowerCase()) + ' registered for this ' + esc(Term('event').toLowerCase()) + ' yet.' }) + '</div></div>';

  if (canManage) {
    wireEventPlaceForm_(eventId, venue, zones, places);
    content.querySelectorAll('[data-add-account]').forEach(function (btn) {
      btn.onclick = async function () {
        var placeId = btn.getAttribute('data-add-account');
        var place = places.filter(function (pl) { return pl.id === placeId; })[0];
        try {
          var res = await Api.call('addPlaceAccount', { placeId: placeId });
          showPlaceAccountModal_(place || res.place, res.account);
        } catch (err) { UI.error(err); }
      };
    });
    content.querySelectorAll('[data-delete-place]').forEach(function (btn) {
      btn.onclick = function () {
        UI.confirmModal('Remove this ' + Term('participant').toLowerCase() + '? This can\'t be undone.', async function () {
          try { await Api.call('deletePlace', { placeId: btn.getAttribute('data-delete-place') }); UI.toast(Term('participant') + ' removed', 'success'); Router.resolve(); }
          catch (err) { UI.error(err); }
        }, { title: 'Remove ' + Term('participant').toLowerCase(), confirmLabel: 'Remove' });
      };
    });
    content.querySelectorAll('[data-view-creds]').forEach(function (btn) {
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

  if (canDedupe) document.getElementById('dedupeParticipantsBtn').onclick = function () {
    // Duplicate = same venue + name + type + zone + coordinates + account (an exact copy, not just
    // the same brand at a different spot, and never a legitimate second shift account) -- matches
    // dedupeParticipants' own check. Anything that already has recorded inspection history is left
    // alone rather than silently deleted.
    UI.confirmModal(
      'Scan this ' + Term('venue').toLowerCase() + '\'s ' + Term('participant_plural').toLowerCase() + ' for exact duplicates (same name, type, zone, and location) and delete every copy beyond the first? Any duplicate that already has recorded inspection history is left alone. This cannot be undone.',
      async function () {
        try {
          var res = await Api.call('dedupeParticipants', { venueId: venue.id });
          var msg = res.removed ? (res.removed + ' duplicate(s) removed') : 'No duplicates found';
          if (res.skippedWithHistory) msg += ' — ' + res.skippedWithHistory + ' skipped (already has recorded history)';
          UI.toast(msg, 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      },
      { title: 'Remove duplicates', confirmLabel: 'Remove duplicates' }
    );
  };
}

// REQ: "Move Disciplines list to a new tab name it Participant's Discipline. Arrange columns in the
// following order: Name, Type, Zone, Discipline. Add map to its left. When selecting a participant(s)
// show location on map. Then user can apply discipline." -- was a second section stacked below the
// Participants table on that same tab; now its own tab, with a read-only locate-on-map view next to
// the table instead of no map at all.
var participantDisciplineMapInstance_ = null;
var participantDisciplineMarkers_ = {}; // participantId -> Leaflet marker

async function tabParticipantDisciplines(content, eventId, detail) {
  destroyParticipantDisciplineMap_(); // in case a previous visit to this tab left one behind
  var venue = detail && detail.venue;
  var role = HululState.user.role;
  var canManageDisciplines = DISCIPLINE_MANAGER_ROLES.indexOf(role) !== -1;

  if (!venue) {
    content.innerHTML = '<div class="card"><div class="card-body"><div class="empty-state">Assign a ' + esc(Term('venue').toLowerCase()) + ' to this ' + esc(Term('event').toLowerCase()) + ' first (Venue &amp; Zones tab) -- ' + esc(Term('participant_plural').toLowerCase()) + ' are registered per event once a venue is set.</div></div></div>';
    return;
  }

  var zones = detail.zones || [];
  var results = await Promise.all([
    Api.call('listParticipants', { venueId: venue.id, eventId: eventId }),
    Api.call('listDisciplines', {}),
    Api.call('listZones', { venueId: venue.id, includeDeleted: true })
  ]);
  var participants = results[0], disciplines = results[1], zonesAll = results[2];
  var zonesById = {}; zonesAll.forEach(function (z) { zonesById[z.id] = z; });

  // NOTE: disciplines applied to a participant here are the full catalogue, not limited to whichever
  // subset the PM has "identified" for this event (Disciplines & Inspectors tab) -- that identify step
  // only gates which disciplines an Inspector can be assigned to, it's a separate concern from tagging
  // a vendor/operator/exhibitor with the disciplines it must be inspected against. Restricting this
  // list to the identified subset previously made the popup silently show 0-2 options with no
  // indication why, which looked like selections weren't being saved.
  var disciplinesById = {}; disciplines.forEach(function (d) { disciplinesById[d.id] = d; });
  function disciplineNamesFor_(participant) {
    var ids = participant.disciplineIds ? String(participant.disciplineIds).split(',').filter(Boolean) : [];
    if (!ids.length) return '—';
    return ids.map(function (id) { return disciplinesById[id] ? esc(disciplinesById[id].name) : id; }).join(', ');
  }

  content.innerHTML =
    '<div class="muted" style="font-size:11.5px;margin-bottom:14px;">Which ' + esc(Term('discipline_plural').toLowerCase()) + ' each ' + esc(Term('participant').toLowerCase()) +
      ' must be inspected against — includes both this event\'s own ' + esc(Term('participant_plural').toLowerCase()) + ' and any permanent ones at this ' + esc(Term('venue').toLowerCase()) + '.</div>' +
    (canManageDisciplines
      ? '<div class="card" style="margin-bottom:16px;"><div class="card-body" style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">' +
          '<span class="muted" style="font-size:12.5px;" id="participantSelCount">Select one or more ' + esc(Term('participant_plural').toLowerCase()) + ' below to see them on the map and apply ' + esc(Term('discipline_plural').toLowerCase()) + '.</span>' +
          '<button class="btn btn-secondary btn-sm" id="applyDisciplinesBtn" disabled>Apply ' + esc(Term('discipline_plural').toLowerCase()) + '…</button>' +
        '</div></div>'
      : '') +
    '<div class="card"><div class="card-body" style="display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start;">' +
      '<div style="flex:1 1 320px;min-width:280px;">' +
        '<div id="participantDisciplineMap" style="height:460px;width:100%;border-radius:var(--radius-sm);border:1px solid var(--border);"></div>' +
      '</div>' +
      '<div style="flex:2 1 480px;min-width:320px;">' + UI.table((canManageDisciplines ? [{ key: 'select', label: '', render: r => '<input type="checkbox" class="participant-select" value="' + r.id + '" />' }] : []).concat([
        { key: 'name', label: 'Name' }, { key: 'type', label: 'Type' },
        { key: 'zoneId', label: Term('zone'), render: r => zoneDisplayNames_(r.zoneId, zonesById, 'All zones') },
        { key: 'disciplineIds', label: Term('discipline_plural'), render: disciplineNamesFor_ }
      ]), participants, {}) + '</div>' +
    '</div></div>';

  initParticipantDisciplineMap_(venue, zones, participants);

  if (!canManageDisciplines) return;
  var selCountEl = document.getElementById('participantSelCount');
  var applyBtn = document.getElementById('applyDisciplinesBtn');
  function selectedIds_() { return Array.from(content.querySelectorAll('.participant-select:checked')).map(function (cb) { return cb.value; }); }
  function refreshSelection() {
    var ids = selectedIds_();
    applyBtn.disabled = ids.length === 0;
    selCountEl.textContent = ids.length ? (ids.length + ' selected') : ('Select one or more ' + Term('participant_plural').toLowerCase() + ' below to see them on the map and apply ' + Term('discipline_plural').toLowerCase() + '.');
    // REQ: "When selecting a participant(s) show location on map."
    highlightParticipantsOnMap_(ids);
  }
  content.querySelectorAll('.participant-select').forEach(function (cb) { cb.onchange = refreshSelection; });
  applyBtn.onclick = function () {
    var participantIds = selectedIds_();
    if (!participantIds.length) return;
    if (!disciplines.length) { UI.toast('No ' + Term('discipline_plural').toLowerCase() + ' exist yet — add some in the ' + Term('discipline_plural') + ' catalogue first.', 'error'); return; }
    // Overwrites each selected participant's full discipline list with whatever's checked here (see
    // bulkAssignParticipantDisciplines in Participants.gs) -- so pre-check whatever's already set on
    // the selected participant(s) (union, if more than one is selected) rather than starting blank,
    // otherwise a discipline nobody meant to touch would silently disappear the moment Apply is
    // clicked instead of being a deliberate uncheck.
    var preCheckedIds = {};
    participants.forEach(function (pt) {
      if (participantIds.indexOf(pt.id) === -1) return;
      (pt.disciplineIds ? String(pt.disciplineIds).split(',').filter(Boolean) : []).forEach(function (id) { preCheckedIds[id] = true; });
    });
    var body = '<div style="font-size:13px;margin-bottom:8px;">Applying to ' + participantIds.length + ' selected ' + (participantIds.length === 1 ? Term('participant').toLowerCase() : Term('participant_plural').toLowerCase()) + '. This replaces ' + (participantIds.length === 1 ? 'its' : 'their') + ' full ' + Term('discipline_plural').toLowerCase() + ' list — already-assigned ones are pre-checked below; uncheck to remove them.</div>' +
      disciplines.map(function (d) {
        return '<label style="display:flex;align-items:center;gap:8px;font-size:13.5px;margin:6px 0;">' +
          '<input type="checkbox" class="apply-disc-check" value="' + d.id + '"' + (preCheckedIds[d.id] ? ' checked' : '') + ' /> ' + esc(d.name) + '</label>';
      }).join('');
    UI.openModal('Apply ' + Term('discipline_plural').toLowerCase(), body, [
      { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
      { label: 'Apply', className: 'btn-primary', onClick: async function () {
          var disciplineIds = Array.from(document.querySelectorAll('.apply-disc-check:checked')).map(function (cb) { return cb.value; });
          if (!disciplineIds.length) { UI.toast('Select at least one discipline', 'error'); return; }
          try {
            await Api.call('bulkAssignParticipantDisciplines', { participantIds: participantIds, disciplineIds: disciplineIds });
            UI.closeModal(); UI.toast('Disciplines applied', 'success'); Router.resolve();
          } catch (err) { UI.error(err); }
        } }
    ]);
  };
}

// Read-only locate view (pan/zoom only, no pin placement) -- same "venue boundary + zone boundaries +
// dots" composition as eventDetail.js's own Places map (initEventPlacesMap_), just plotting
// Participants instead of Places and keyed by participantDisciplineMarkers_ instead of that map's own
// eventPlacesMarkers_ so the two never collide.
function initParticipantDisciplineMap_(venue, zones, participants) {
  var el = document.getElementById('participantDisciplineMap');
  if (!el) return;
  if (typeof HululLeaflet === 'undefined') {
    el.style.display = 'flex'; el.style.alignItems = 'center'; el.style.justifyContent = 'center';
    el.style.color = 'var(--text-600)'; el.style.fontSize = '12px'; el.style.textAlign = 'center'; el.style.padding = '12px';
    el.textContent = 'Map unavailable (couldn\'t load the map library).';
    return;
  }
  var hasCoords = !!(venue.lat && venue.lng);
  var center = hasCoords ? [Number(venue.lat), Number(venue.lng)] : EVENT_MAP_DEFAULT_CENTER_;
  setTimeout(function () {
    var mapEl = document.getElementById('participantDisciplineMap');
    if (!mapEl || mapEl._leaflet_id) return;
    participantDisciplineMapInstance_ = HululLeaflet.map('participantDisciplineMap').setView(center, hasCoords ? 15 : 6);
    HululLeaflet.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19
    }).addTo(participantDisciplineMapInstance_);

    var bounds = [];
    var venueBoundary = parseBoundaryClient_(venue.boundary);
    if (venueBoundary) {
      var venueColor = venue.color || VENUE_BOUNDARY_DEFAULT_COLOR_;
      var venueLayer = HululLeaflet.polygon(venueBoundary.map(function (pt) { return [pt.lat, pt.lng]; }), {
        color: venueColor, fillColor: venueColor, fillOpacity: 0.06, weight: 1.5, interactive: false
      }).addTo(participantDisciplineMapInstance_);
      bounds = bounds.concat(venueLayer.getLatLngs()[0]);
    }
    UI.drawZoneBoundaries(participantDisciplineMapInstance_, zones).forEach(function (layer) {
      bounds = bounds.concat(layer.getLatLngs()[0]);
    });

    participantDisciplineMarkers_ = {};
    participants.forEach(function (pt) {
      if (pt.lat === '' || pt.lat == null || pt.lng === '' || pt.lng == null) return;
      var latlng = [Number(pt.lat), Number(pt.lng)];
      bounds.push(latlng);
      var color = EVENT_PLACE_TYPE_COLORS_[pt.type] || EVENT_PLACE_TYPE_COLORS_.Other;
      var icon = HululLeaflet.divIcon({
        className: 'place-marker-icon', iconSize: [14, 14], iconAnchor: [7, 7],
        html: '<div class="place-marker"><div class="place-marker-dot" style="background:' + color + ';"></div></div>'
      });
      var marker = HululLeaflet.marker(latlng, { icon: icon }).addTo(participantDisciplineMapInstance_);
      marker.bindTooltip(esc(pt.name), { direction: 'top', offset: [0, -10], className: 'place-marker-tooltip' });
      participantDisciplineMarkers_[pt.id] = marker;
    });
    if (bounds.length) participantDisciplineMapInstance_.fitBounds(bounds, { padding: [24, 24], maxZoom: 17 });
    setTimeout(function () { if (participantDisciplineMapInstance_) participantDisciplineMapInstance_.invalidateSize(); }, 150);
  }, 0);
}

// REQ: "When selecting a participant(s) show location on map." -- highlights every checked
// participant's dot (same is-focused red/scaled treatment as eventDetail.js's focusEventPlace_) and
// flies the map to frame all of them together; clearing every checkbox un-highlights everything and
// leaves the map where it was rather than snapping back to the full venue view.
function highlightParticipantsOnMap_(selectedIds) {
  if (!participantDisciplineMapInstance_) return;
  var selBounds = [];
  Object.keys(participantDisciplineMarkers_).forEach(function (id) {
    var marker = participantDisciplineMarkers_[id];
    var isSelected = selectedIds.indexOf(id) !== -1;
    var markerEl = marker.getElement();
    if (markerEl) markerEl.classList.toggle('is-focused', isSelected);
    if (isSelected) selBounds.push(marker.getLatLng());
  });
  if (!selBounds.length) return;
  if (selBounds.length === 1) participantDisciplineMapInstance_.flyTo(selBounds[0], 17, { duration: 0.5 });
  else participantDisciplineMapInstance_.flyToBounds(selBounds, { padding: [50, 50], maxZoom: 17, duration: 0.5 });
}

function destroyParticipantDisciplineMap_() {
  if (participantDisciplineMapInstance_) { participantDisciplineMapInstance_.remove(); participantDisciplineMapInstance_ = null; }
  participantDisciplineMarkers_ = {};
}

function renderAddEventPlaceCard_(zones, hasBoundary) {
  // Same compact side-by-side layout as venues.js's renderAddPlaceCard_ -- kept in sync since this
  // is the same Add-a-place form, just event-scoped.
  return '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">Add ' + esc(Term('participant').toLowerCase()) + '</div></div>' +
    '<div class="card-body" style="display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start;">' +
      '<div style="flex:1 1 440px;max-width:640px;display:flex;flex-direction:column;gap:4px;">' +
        // REQ: consistent field order across the form -- Name, then Type+Zone side by side,
        // then Latitude+Longitude side by side, then Location last.
        UI.field('Name', '<input id="fEPName" class="field-input" />') +
        '<div class="form-row">' +
          UI.field('Type', '<select id="fEPType" class="field-input">' + PLACE_TYPES.map(function (ty) { return '<option value="' + ty + '">' + ty + '</option>'; }).join('') + '</select>') +
          '<div>' + zoneFieldHtml_(zones, 'fEP') + '</div>' +
        '</div>' +
        '<div class="form-row">' +
          UI.field('Latitude', '<input id="fEPLat" type="number" step="any" class="field-input" />') +
          UI.field('Longitude', '<input id="fEPLng" type="number" step="any" class="field-input" />') +
        '</div>' +
        UI.field('Location (optional)', '<input id="fEPLocation" class="field-input" placeholder="e.g. Near Gate A, north entrance" />') +
      '</div>' +
      '<div style="flex:1 1 320px;min-width:280px;display:flex;flex-direction:column;gap:8px;">' +
        '<div id="eventPlaceMap" style="height:380px;width:100%;border-radius:var(--radius-sm);border:1px solid var(--border);"></div>' +
        '<div class="muted" style="font-size:11px;">' +
          (hasBoundary
            ? 'Click or drag the pin to set the exact spot — must stay within the ' + esc(Term('venue').toLowerCase()) + ' boundary (shaded area).'
            : 'This ' + esc(Term('venue').toLowerCase()) + ' has no boundary drawn yet, so location isn\'t map-restricted — click the map or type coordinates manually.') +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div style="display:flex;justify-content:flex-end;gap:8px;padding:14px 20px;border-top:1px solid var(--border);">' +
      '<button class="btn btn-primary" id="addEventPlaceBtn">Add ' + esc(Term('participant').toLowerCase()) + '</button>' +
    '</div>' +
  '</div>';
}

function wireEventPlaceForm_(eventId, venue, zones, places) {
  initEventPlaceMap_(venue, zones, places, eventId);
  wireZoneField_('fEP', 'fEPType');
  wireSuggestableField_('fEPName');
  wireSuggestableField_('fEPLocation');
  document.getElementById('addEventPlaceBtn').onclick = async function () {
    try {
      var name = document.getElementById('fEPName').value.trim();
      if (!name) { UI.toast('Name is required', 'error'); return; }
      var payload = {
        eventId: eventId, name: name, type: document.getElementById('fEPType').value,
        zoneId: getZoneFieldValue_('fEP'), location: document.getElementById('fEPLocation').value,
        lat: document.getElementById('fEPLat').value, lng: document.getElementById('fEPLng').value
      };
      var res = await Api.call('createPlace', payload);
      UI.toast(Term('participant') + ' added', 'success');
      await Router.resolve();
      showPlaceAccountModal_(res.place, res.account);
    } catch (err) { UI.error(err); }
  };
}

// Own map instance/DOM id (eventPlaceMap*, not venues.js's place*) so this tab and the Venues >
// Places page never collide even though the underlying pattern is identical -- see that page's
// initPlaceMap_ for the fuller commentary this mirrors (venue boundary polygon, satellite toggle,
// "use my location", click/drag-to-place, all rejected client-side outside the venue's boundary for
// instant feedback and re-checked authoritatively by createPlace server-side either way). A venue
// with no boundary drawn yet is unrestricted.
function initEventPlaceMap_(venue, zones, places, eventId) {
  var el = document.getElementById('eventPlaceMap');
  if (!el) return;
  if (typeof HululLeaflet === 'undefined') {
    el.style.display = 'flex'; el.style.alignItems = 'center'; el.style.justifyContent = 'center';
    el.style.color = 'var(--text-600)'; el.style.fontSize = '12px'; el.style.textAlign = 'center'; el.style.padding = '12px';
    el.textContent = 'Map unavailable (couldn\'t load the map library) — type coordinates manually below.';
    return;
  }
  var hasCoords = !!(venue.lat && venue.lng);
  var boundary = parseBoundaryClient_(venue.boundary);
  var center = hasCoords ? [Number(venue.lat), Number(venue.lng)] : EVENT_MAP_DEFAULT_CENTER_;
  setTimeout(function () {
    if (!document.getElementById('eventPlaceMap')) return;
    eventPlaceMapInstance_ = HululLeaflet.map('eventPlaceMap').setView(center, hasCoords ? 16 : 6);
    var osmLayer = HululLeaflet.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19
    }).addTo(eventPlaceMapInstance_);
    // REQ: "Move the Use my location / Satellite buttons inside map canvas." -- built and appended
    // directly into mapEl (UI.mapControls) instead of living in the card header above the map.
    var locBtn = UI.mapToggleButton('useMyLocationEPBtn', 'location_pin', 'Use my location');
    var satBtn = UI.mapToggleButton('toggleSatelliteEPBtn', 'satellite_toggle', 'Satellite');
    UI.mapControls(el, [locBtn, satBtn]);
    var satelliteLayer = HululLeaflet.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: '&copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics', maxZoom: 19
    });
    var showingSatellite = false;
    satBtn.onclick = function () {
      showingSatellite = !showingSatellite;
      if (showingSatellite) { eventPlaceMapInstance_.removeLayer(osmLayer); satelliteLayer.addTo(eventPlaceMapInstance_); satBtn.innerHTML = ICON('map_toggle') + ' Map'; }
      else { eventPlaceMapInstance_.removeLayer(satelliteLayer); osmLayer.addTo(eventPlaceMapInstance_); satBtn.innerHTML = ICON('satellite_toggle') + ' Satellite'; }
    };
    if (boundary) {
      var venueBoundaryColor = venue.color || VENUE_BOUNDARY_DEFAULT_COLOR_;
      eventPlaceMapBoundaryLayer_ = HululLeaflet.polygon(boundary.map(function (pt) { return [pt.lat, pt.lng]; }), {
        color: venueBoundaryColor, fillColor: venueBoundaryColor, fillOpacity: 0.06, weight: 1.5
      }).addTo(eventPlaceMapInstance_);
      eventPlaceMapInstance_.fitBounds(eventPlaceMapBoundaryLayer_.getBounds(), { padding: [20, 20] });
      // REQ: "Users can not scroll away from the venue boundaries" -- applyBoundaryPanLimit_ and
      // VENUE_BOUNDARY_DEFAULT_COLOR_ are both defined in venues.js, loaded on the same page (same
      // cross-file pattern as parseBoundaryClient_).
      applyBoundaryPanLimit_(eventPlaceMapInstance_, eventPlaceMapBoundaryLayer_.getBounds());
    }
    // REQ: "Zone boundaries to be visible" / "Participant dots to be visible. This applies to all
    // maps." (UI.drawZoneBoundaries/drawPlaceDots, ui.js).
    UI.drawZoneBoundaries(eventPlaceMapInstance_, zones);
    UI.drawPlaceDots(eventPlaceMapInstance_, places);
    // REQ: "Inspectors live location as they start inspections. This applies to all maps." -- scoped
    // to this one event (not the whole venue) since that's what this tab is about.
    if (eventId) eventPlaceMapInspectorPollStop_ = UI.startInspectorLocationPolling(eventPlaceMapInstance_, { eventId: eventId }, 20000);
    eventPlaceMapMarker_ = HululLeaflet.marker(center, { draggable: true }).addTo(eventPlaceMapInstance_);
    setEventPlaceLatLng_(center[0], center[1]);
    autoDetectZone_('fEP', zones, center[0], center[1]);
    suggestNameFromMap_('fEPName', center[0], center[1]);
    suggestFromNearestPlace_('fEPLocation', center[0], center[1], places, function (n) { return 'Near ' + n; });

    function tryEventPlacePin_(lat, lng, recenter) {
      if (boundary && !pointInPolygonClient_(lat, lng, boundary)) {
        UI.toast('Must stay within the ' + Term('venue').toLowerCase() + ' boundary', 'error');
        return false;
      }
      eventPlaceMapMarker_.setLatLng([lat, lng]);
      eventPlaceMapMarker_._hululLastValid = [lat, lng];
      setEventPlaceLatLng_(lat, lng);
      autoDetectZone_('fEP', zones, lat, lng);
      suggestNameFromMap_('fEPName', lat, lng);
      suggestFromNearestPlace_('fEPLocation', lat, lng, places, function (n) { return 'Near ' + n; });
      if (recenter) eventPlaceMapInstance_.setView([lat, lng], 17);
      return true;
    }

    eventPlaceMapMarker_.on('dragend', function () {
      var pos = eventPlaceMapMarker_.getLatLng();
      if (!tryEventPlacePin_(pos.lat, pos.lng, false)) eventPlaceMapMarker_.setLatLng(eventPlaceMapMarker_._hululLastValid || center);
    });
    eventPlaceMapMarker_._hululLastValid = center;
    eventPlaceMapInstance_.on('click', function (e) { tryEventPlacePin_(e.latlng.lat, e.latlng.lng, false); });

    locBtn.onclick = function () {
      if (!navigator.geolocation) { UI.toast('Geolocation isn\'t available in this browser', 'error'); return; }
      locBtn.disabled = true; locBtn.innerHTML = ICON('location_pin') + ' Locating…';
      navigator.geolocation.getCurrentPosition(function (pos) {
        locBtn.disabled = false; locBtn.innerHTML = ICON('location_pin') + ' Use my location';
        tryEventPlacePin_(pos.coords.latitude, pos.coords.longitude, true);
      }, function (err) {
        locBtn.disabled = false; locBtn.innerHTML = ICON('location_pin') + ' Use my location';
        UI.toast(err && err.code === 1 ? 'Location permission denied' : 'Could not get your location', 'error');
      }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 });
    };

    setTimeout(function () { if (eventPlaceMapInstance_) eventPlaceMapInstance_.invalidateSize(); }, 150);
  }, 0);
}

function destroyEventPlaceMap_() {
  if (eventPlaceMapInspectorPollStop_) { eventPlaceMapInspectorPollStop_(); eventPlaceMapInspectorPollStop_ = null; }
  if (eventPlaceMapInstance_) { eventPlaceMapInstance_.remove(); eventPlaceMapInstance_ = null; eventPlaceMapMarker_ = null; eventPlaceMapBoundaryLayer_ = null; }
}

function setEventPlaceLatLng_(lat, lng) {
  var latEl = document.getElementById('fEPLat'), lngEl = document.getElementById('fEPLng');
  if (latEl) latEl.value = Number(lat).toFixed(6);
  if (lngEl) lngEl.value = Number(lng).toFixed(6);
}
