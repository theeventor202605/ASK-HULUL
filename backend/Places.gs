/**
 * HULUL - Places.gs
 * A reusable catalog of exact physical spots within a Venue (e.g. "Gate A Vendor Stand", "Booth
 * 12"). A Place belongs to one of the Venue's Zones and must land inside the Venue's drawn boundary
 * polygon, enforced here server-side (never trust the client/map alone) via pointInPolygon_ (Utils.gs).
 * If the Venue has no boundary drawn yet, the containment check is skipped rather than blocking
 * every Place on it -- same fallback as when a Venue has no lat/lng at all. (PLACE_MAX_DISTANCE_KM/
 * haversineKm_ below predate the boundary feature and are unused now -- kept only because the
 * frontend still references its own copy of the same constant/formula for the pre-boundary UI.)
 *
 * Two kinds, distinguished by eventId (see Utils.gs SCHEMA comment):
 *  - Venue Places (eventId blank) -- permanent, cover every Event held at the venue. A Venue is a
 *    shared catalog entry, not owned by any one EMC (see Events.gs file header comment), so any
 *    SystemAdmin / EMC Admin / EMC Manager can manage any venue's Places -- no owning-org check.
 *    Venues > Places.
 *  - Event Places (eventId set) -- REQ: a vendor "may just be attending this season of events," so
 *    these are registered under one specific Event instead, managed by whoever's allowed to act on
 *    that Event's renting EMC (event.emcId -- see Events.gs) or is that Event's own Event Manager
 *    (SystemAdmin / EMC Admin / EMC Manager / Event Manager -- same set as createZone/deleteZone in
 *    Events.gs), and every account they provision is auto-deactivated once that Event ends (see
 *    deactivateEndedEventPlaceAccounts). Event > Participants tab.
 * Listing is open to any authenticated user, matching listVenues/listZones.
 *
 * Every Place auto-provisions a login-capable Users account (role = the Place's type: Vendor/
 * Operator/Exhibitor) plus a matching Participant (see Participants.gs). A Place can have more than
 * one account -- see addPlaceAccount -- for e.g. separate morning/afternoon shift staff who each
 * need their own login to respond to risk logging.
 */
var PLACE_TYPES = ['Operator', 'Vendor', 'Exhibitor', 'Other'];
var PLACE_MAX_DISTANCE_KM = 1;
var PLACE_ACCOUNT_DEFAULT_PASSWORD = '123';
// Who can manage an Event Place (create/add account/view credentials/delete) -- same set as
// createZone/deleteZone (Events.gs), since an Event Place is on-the-ground event infrastructure
// just like a Zone, not permanent venue infrastructure. Deliberately plain string literals, not
// [ROLES.SYSTEM_ADMIN, ...] -- this array is built at module load time, and Apps Script concatenates
// every .gs file's top-level code in file order (roughly alphabetical: "Places.gs" loads before
// "Utils.gs"), so referencing ROLES here would read it before Utils.gs has defined it, throwing a
// script-wide initialization error that breaks every API call, not just this one. requireRole(user,
// [ROLES.SYSTEM_ADMIN, ...]) calls *inside* functions are fine -- those only run after every file's
// top-level code has already finished.
var EVENT_PLACE_MANAGE_ROLES = ['SystemAdmin', 'EMCAdmin', 'EMCManager', 'EventManager'];

function listPlaces(user, p) {
  var places;
  if (p && p.eventId) {
    places = findWhere('Places', function (pl) { return pl.eventId === p.eventId; });
  } else {
    if (!p || !p.venueId) throw new HululError('BAD_REQUEST', 'venueId or eventId is required');
    // Venue Places page only ever shows the permanent catalog -- an Event's own temporary Places
    // live in that Event's Participants tab (listPlaces({eventId})) instead, not mixed in here.
    places = findWhere('Places', function (pl) { return pl.venueId === p.venueId && !pl.eventId; });
  }
  // Resolve accountIds -> {id,name,email,role,status} once per call (not once per place) so a
  // venue/event with many places doesn't re-read the whole Users sheet per row.
  var usersById = {};
  getAll('Users').forEach(function (u) { usersById[u.id] = u; });
  // REQ: "Across all maps any participant with a logged risk turns red dot with a number above the
  // dot." A Place doesn't store a participantId directly -- each of its accountIds (Users rows) has
  // a matching Participant linked via Participant.userId (see provisionPlaceAccount_) -- so resolve
  // accountIds -> Participants -> findingsOpenCountByParticipant_ and take the max across every
  // account this Place has (they all share the same count anyway, being the same physical spot, but
  // max is a harmless, cheap way to combine without assuming exactly one Participant per account).
  var participantsByUserId = {};
  getAll('Participants').forEach(function (pt) { if (pt.userId) participantsByUserId[pt.userId] = pt; });
  var countByParticipantId = findingsOpenCountByParticipant_();
  return places.map(function (pl) {
    var accountIds = pl.accountIds ? String(pl.accountIds).split(',').filter(Boolean) : [];
    var accounts = accountIds.map(function (id) { return usersById[id]; }).filter(Boolean)
      .map(function (u) { return { id: u.id, name: u.name, email: u.email, role: u.role, status: u.status }; });
    var openFindingsCount = accountIds.reduce(function (max, uid) {
      var pt = participantsByUserId[uid];
      var count = pt ? (countByParticipantId[pt.id] || 0) : 0;
      return Math.max(max, count);
    }, 0);
    return Object.assign({}, pl, { accounts: accounts, openFindingsCount: openFindingsCount });
  });
}

// Shared by createPlace/addPlaceAccount/getPlaceAccountCredentials/deletePlace: resolves and
// authorizes against either a Venue Place or an Event Place depending on whether `event` is given.
// Venue Places aren't org-scoped at all (see Events.gs file header comment) -- any role in the
// manage list can act on any venue's permanent Places. Event Places key off the Event's own renting
// EMC (event.emcId), not the Venue, since that's the org relationship that's actually authoritative
// for an Event (see createEvent/updateEvent).
function assertCanManagePlace_(user, venue, event) {
  if (event) {
    requireRole(user, EVENT_PLACE_MANAGE_ROLES);
    if (user.role !== ROLES.SYSTEM_ADMIN && event.emcId !== user.orgId && event.eventManagerId !== user.id) {
      throw new HululError('FORBIDDEN', 'Not your event');
    }
  } else {
    requireRole(user, [ROLES.SYSTEM_ADMIN, ROLES.EMC_ADMIN, ROLES.EMC_MANAGER]);
  }
}

// Narrower than assertCanManagePlace_ -- just "who may add a new Event Place" (the Event >
// Participants tab's add-a-temporary-participant form). A Venue Place (no event) is unchanged: still
// manager-only via assertCanManagePlace_, since that's the permanent catalog, not a per-event concern.
// For an Event Place, a Place manager role keeps the exact same org-scoped "is this your event" check
// as before (that's a business-relationship check, not a role list, so it stays regardless of who's
// admin-configured in). Anyone else falls through to the fully admin-configurable place.create
// permission (Settings > Permissions > Participants > "Add a temporary participant") -- see
// PERMISSION_REGISTRY_ (Permissions.gs) -- so a SystemAdmin can add or remove roles for this exact
// action from Settings, without a code deploy, same as every other RBAC-pilot-migrated action
// (createFinding/createParticipant). REQ: "Inspector ... ability to add a temporary participant" --
// deliberately scoped to create only; addPlaceAccount/updatePlace/deletePlace/
// getPlaceAccountCredentials still gate on assertCanManagePlace_/EVENT_PLACE_MANAGE_ROLES alone, so
// a non-manager role can't edit/delete/view-credentials for participants they didn't add.
function assertCanCreatePlace_(user, venue, event) {
  if (!event) return assertCanManagePlace_(user, venue, event);
  if (EVENT_PLACE_MANAGE_ROLES.indexOf(user.role) !== -1) {
    return assertCanManagePlace_(user, venue, event);
  }
  requirePermission(user, 'place.create');
}

function createPlace(user, p) {
  var event = p.eventId ? getById('Events', p.eventId) : null;
  if (p.eventId && !event) throw new HululError('NOT_FOUND', 'Event not found');
  var venueId = event ? event.venueId : p.venueId;
  if (!venueId || !p.name) throw new HululError('BAD_REQUEST', (event ? 'This event has no venue assigned yet' : 'venueId') + ' and name are required');
  if (PLACE_TYPES.indexOf(p.type) === -1) throw new HululError('BAD_REQUEST', 'Invalid place type');
  var venue = getById('Venues', venueId);
  if (!venue) throw new HululError('NOT_FOUND', 'Venue not found');
  assertCanCreatePlace_(user, venue, event);
  // REQ: zoneId can be blank, 'ALL' (explicit "every zone"), one zone, or -- Operators only -- a
  // comma-joined list of several (see Utils.gs's zoneField helpers for how this gets read back).
  if (p.zoneId && p.zoneId !== 'ALL') {
    var zoneIds = String(p.zoneId).split(',').filter(Boolean);
    if (zoneIds.length > 1 && p.type !== 'Operator') {
      throw new HululError('BAD_REQUEST', 'Only Operators can be assigned to more than one zone');
    }
    zoneIds.forEach(function (zid) {
      var zone = getById('Zones', zid);
      if (!zone || zone.venueId !== venueId) throw new HululError('BAD_REQUEST', 'zoneId must belong to this venue');
    });
  }

  var lat = '', lng = '';
  if (p.lat !== undefined && p.lat !== '' && p.lng !== undefined && p.lng !== '') {
    lat = Number(p.lat); lng = Number(p.lng);
    if (isNaN(lat) || isNaN(lng)) throw new HululError('BAD_REQUEST', 'lat/lng must be numbers');
    // REQ: "remove the 1 km restriction, restriction now will be venue boundary." A place must land
    // inside the venue's drawn polygon when one exists; a venue with no boundary drawn yet is
    // unrestricted (same fallback already used when a venue has no lat/lng at all).
    var boundary = parseBoundary_(venue.boundary);
    if (boundary && !pointInPolygon_(lat, lng, boundary)) {
      throw new HululError('BAD_REQUEST', 'This spot is outside the venue boundary.');
    }
  }

  var place = {
    id: newId('Places'), venueId: venueId, zoneId: p.zoneId || '', name: p.name, type: p.type,
    location: p.location || '', lat: lat, lng: lng, createdBy: user.id, createdAt: nowIso_(), accountIds: '',
    eventId: event ? event.id : ''
  };
  insertRow('Places', place);
  audit(user.id, 'CREATE_PLACE', 'Places', place.id, { type: p.type, eventId: place.eventId });

  var account = provisionPlaceAccount_(user, place, event);
  return { place: getById('Places', place.id), account: account };
}

// REQ: "Add a helper button to identify all places within the venue boundary and add them
// automatically." The actual map lookup (Overpass API) happens client-side (venues.js), same
// call-OSM-directly-from-the-browser pattern already used for the venue address search and the
// closest-map-POI Name suggestion -- this endpoint is only the bulk-create step, once the PM has
// reviewed candidates in the picker modal and confirmed which ones to actually add. Loops createPlace
// so every existing validation (boundary containment, zone ownership, type check) and side effect
// (account provisioning -- REQ: "no duplicated allowed, check by name and geolocation" is enforced
// client-side before this ever runs, precisely so a bad batch doesn't spam real login accounts) runs
// exactly the same as a single manual Add-a-place submission. One bad entry in the batch (e.g. a
// zoneId that no longer exists by the time this runs) is skipped and reported rather than aborting
// the rest of the import.
function bulkImportPlaces(user, p) {
  var entries = (p && p.places) || [];
  if (!entries.length) return { created: [], createdCount: 0, failed: [] };
  var created = [];
  var failed = [];
  entries.forEach(function (entry) {
    try {
      var payload = Object.assign({}, entry, { venueId: p.venueId, eventId: p.eventId });
      var res = createPlace(user, payload);
      created.push(res.place);
    } catch (e) {
      failed.push({ name: entry.name, reason: (e && e.message) || 'Failed to create' });
    }
  });
  if (created.length) audit(user.id, 'BULK_IMPORT_PLACES', 'Places', '', { count: created.length, venueId: p.venueId, eventId: p.eventId });
  return { created: created, createdCount: created.length, failed: failed };
}

// REQ: "one place can have more than one account" -- separate morning/afternoon shift staff, each
// able to respond to risk logging independently. Always the same role/type as the place itself
// (there's no way to pick a different one here) so the "vendor place -> vendor account" rule holds
// by construction rather than needing separate validation.
function addPlaceAccount(user, p) {
  var place = getById('Places', p.placeId);
  if (!place) throw new HululError('NOT_FOUND', 'Place not found');
  var venue = getById('Venues', place.venueId);
  if (!venue) throw new HululError('NOT_FOUND', 'Venue not found');
  var event = place.eventId ? getById('Events', place.eventId) : null;
  assertCanManagePlace_(user, venue, event);
  var account = provisionPlaceAccount_(user, place, event);
  return { place: getById('Places', place.id), account: account };
}

// Re-shows an existing Place account's login (the venues.js "🔑 View credentials" button) --
// the password is always the fixed PLACE_ACCOUNT_DEFAULT_PASSWORD constant, never randomly
// generated, so there's nothing secret to "recover"; this just re-assembles the same credentials
// card shown at creation time. Reuses the account's existing quick-login token rather than minting
// a new one each time, so a QR someone already printed keeps being the one shown here too.
function getPlaceAccountCredentials(user, p) {
  var account = getById('Users', p.userId);
  if (!account) throw new HululError('NOT_FOUND', 'Account not found');
  var place = findWhere('Places', function (pl) { return (pl.accountIds || '').split(',').indexOf(p.userId) !== -1; })[0];
  var venue = place ? getById('Venues', place.venueId) : null;
  var event = place && place.eventId ? getById('Events', place.eventId) : null;
  if (venue) {
    assertCanManagePlace_(user, venue, event);
  } else {
    // Fallback for an account whose originating Place row is gone (deletePlace never deletes the
    // account) -- same org-ownership check as before, EMC-admin roles only.
    requireRole(user, [ROLES.SYSTEM_ADMIN, ROLES.EMC_ADMIN, ROLES.EMC_MANAGER]);
    if (user.role !== ROLES.SYSTEM_ADMIN && account.orgId !== user.orgId) {
      throw new HululError('FORBIDDEN', 'Not your organization\'s account');
    }
  }
  var existingToken = findWhere('QuickLoginTokens', function (t) { return t.userId === account.id; })[0];
  var quickLoginToken = existingToken ? existingToken.token : mintQuickLoginToken_(account.id);
  return { id: account.id, name: account.name, email: account.email, password: PLACE_ACCOUNT_DEFAULT_PASSWORD, role: account.role, quickLoginToken: quickLoginToken };
}

// REQ: "allow to edit a place." Same validation as createPlace (type, zone ownership, boundary
// containment) but patches the existing row instead of inserting one, and never re-provisions an
// account -- editing a place must not spam a second login for the same physical spot. name/zoneId/
// location/lat/lng are also pushed onto every linked account's Participant row (place.accountIds),
// same "shared physical-spot fields propagate to every sibling account" rule updateParticipant
// (Participants.gs) uses -- those Participant rows were only ever a snapshot taken at creation time
// (provisionPlaceAccount_), so without this an edited Place would drift out of sync with what the
// Participants tab / live inspection map shows for the same spot.
function updatePlace(user, p) {
  var place = getById('Places', p.placeId);
  if (!place) throw new HululError('NOT_FOUND', 'Place not found');
  var venue = getById('Venues', place.venueId);
  if (!venue) throw new HululError('NOT_FOUND', 'Venue not found');
  var event = place.eventId ? getById('Events', place.eventId) : null;
  assertCanManagePlace_(user, venue, event);

  var name = p.name !== undefined ? String(p.name).trim() : place.name;
  if (!name) throw new HululError('BAD_REQUEST', 'name is required');
  var type = p.type !== undefined ? p.type : place.type;
  if (PLACE_TYPES.indexOf(type) === -1) throw new HululError('BAD_REQUEST', 'Invalid place type');

  var zoneId = p.zoneId !== undefined ? p.zoneId : place.zoneId;
  if (zoneId && zoneId !== 'ALL') {
    var zoneIds = String(zoneId).split(',').filter(Boolean);
    if (zoneIds.length > 1 && type !== 'Operator') {
      throw new HululError('BAD_REQUEST', 'Only Operators can be assigned to more than one zone');
    }
    zoneIds.forEach(function (zid) {
      var zone = getById('Zones', zid);
      if (!zone || zone.venueId !== place.venueId) throw new HululError('BAD_REQUEST', 'zoneId must belong to this venue');
    });
  }

  var lat = place.lat, lng = place.lng;
  if (p.lat !== undefined || p.lng !== undefined) {
    if (p.lat === '' || p.lng === '' || p.lat === undefined || p.lng === undefined) {
      lat = ''; lng = '';
    } else {
      lat = Number(p.lat); lng = Number(p.lng);
      if (isNaN(lat) || isNaN(lng)) throw new HululError('BAD_REQUEST', 'lat/lng must be numbers');
      var boundary = parseBoundary_(venue.boundary);
      if (boundary && !pointInPolygon_(lat, lng, boundary)) {
        throw new HululError('BAD_REQUEST', 'This spot is outside the venue boundary.');
      }
    }
  }

  var location = p.location !== undefined ? p.location : place.location;

  updateRow('Places', place.id, { name: name, type: type, zoneId: zoneId || '', location: location || '', lat: lat, lng: lng });

  var accountIds = place.accountIds ? String(place.accountIds).split(',').filter(Boolean) : [];
  if (accountIds.length) {
    var sharedPatch = { name: name, zoneId: zoneId || '', location: location || '', lat: lat, lng: lng };
    getAll('Participants').forEach(function (pt) {
      if (accountIds.indexOf(pt.userId) !== -1) updateRow('Participants', pt.id, sharedPatch);
    });
  }

  audit(user.id, 'UPDATE_PLACE', 'Places', place.id, { name: name, type: type });
  return { place: getById('Places', place.id) };
}

function deletePlace(user, p) {
  var place = getById('Places', p.placeId);
  if (!place) throw new HululError('NOT_FOUND', 'Place not found');
  var venue = getById('Venues', place.venueId);
  var event = place.eventId ? getById('Events', place.eventId) : null;
  if (venue) assertCanManagePlace_(user, venue, event);
  else requireRole(user, [ROLES.SYSTEM_ADMIN, ROLES.EMC_ADMIN, ROLES.EMC_MANAGER, ROLES.EVENT_MANAGER]);
  // Deliberately does not touch the accounts/participants this place provisioned -- they may have
  // Findings/Resolutions history attached, and stay valid logins independent of the catalog entry
  // that originally created them.
  deleteRow('Places', p.placeId);
  audit(user.id, 'DELETE_PLACE', 'Places', p.placeId, {});
  return { deleted: true };
}

// REQ: "when an event ends all participant accounts registered under events will be deactivated."
// Runs off the same 30-min trigger as the escalation engine (see scheduledEscalationCheck in
// Setup.gs) rather than installing a second time-driven trigger. Deliberately only flips the login
// (Users.status) to Inactive -- the Place/Participant rows and their Findings/Resolutions history
// stay on record, same "never delete history" principle as deletePlace above.
function deactivateEndedEventPlaceAccounts() {
  var now = new Date();
  var endedEventIds = {};
  findWhere('Events', function (e) { return e.endDateTime && new Date(e.endDateTime) < now; })
    .forEach(function (e) { endedEventIds[e.id] = true; });
  if (!Object.keys(endedEventIds).length) return { deactivated: 0 };

  var places = findWhere('Places', function (pl) { return pl.eventId && endedEventIds[pl.eventId]; });
  var deactivated = 0;
  places.forEach(function (pl) {
    (pl.accountIds ? String(pl.accountIds).split(',').filter(Boolean) : []).forEach(function (uid) {
      var u = getById('Users', uid);
      if (u && u.status === 'Active') {
        updateRow('Users', uid, { status: 'Inactive' });
        deactivated++;
      }
    });
  });
  if (deactivated) audit('system', 'DEACTIVATE_EVENT_PLACE_ACCOUNTS', 'Places', '', { count: deactivated });
  return { deactivated: deactivated };
}

// ---- Auto account provisioning --------------------------------------------

// Creates one Users login (role/name/email derived from the place, password is always the fixed
// default below -- this is an internal low-security convenience account, not meant to gate
// anything sensitive) plus a matching Participant (venue-scoped if place.eventId is blank,
// event-scoped otherwise -- see place.eventId), links the new account onto the place's accountIds,
// and mints a reusable quick-login token for its QR code. Returns everything the frontend needs to
// show/print a credentials card: the plaintext password is only ever available here, right after
// creation -- Users.gs never stores or returns it again.
// orgId (for the account's email domain slug and Users.orgId) comes from the Place's Event's
// renting EMC when there is one (event.emcId -- the org relationship that's actually authoritative
// for an Event, see Events.gs) -- a permanent Venue Place has no event and so no EMC context at all
// (a Venue is a shared catalog entry, not owned by any one EMC), and falls back to a generic domain.
function provisionPlaceAccount_(actingUser, place, event) {
  var role = mapParticipantRole_(place.type);
  var orgId = event ? event.emcId : '';
  var org = orgId ? getById('Organizations', orgId) : null;
  var domain = placeAccountDomain_(org);
  var seq = nextPlaceAccountSeq_(orgId, role);
  var email = role.toLowerCase() + Utilities.formatString('%03d', seq) + '@' + domain;
  var plainPassword = PLACE_ACCOUNT_DEFAULT_PASSWORD;

  var loginUser = createUserWithPassword({
    id: newId('Users'), name: place.name, email: email, orgType: 'PARTICIPANT',
    orgId: orgId || '', role: role, createdBy: actingUser.id
  }, plainPassword);

  var participant = {
    id: newId('Participants'), eventId: place.eventId || '', venueId: place.venueId, type: place.type, name: place.name,
    zoneId: place.zoneId || '', location: place.location || '', contactEmail: email, userId: loginUser.id,
    createdAt: nowIso_(), lat: place.lat, lng: place.lng, disciplineIds: ''
  };
  insertRow('Participants', participant);

  var accountIds = place.accountIds ? String(place.accountIds).split(',').filter(Boolean) : [];
  accountIds.push(loginUser.id);
  updateRow('Places', place.id, { accountIds: accountIds.join(',') });

  var quickLoginToken = mintQuickLoginToken_(loginUser.id);
  audit(actingUser.id, 'CREATE_PLACE_ACCOUNT', 'Users', loginUser.id, { placeId: place.id, role: role });

  return {
    id: loginUser.id, name: loginUser.name, email: email, password: plainPassword, role: role,
    participantId: participant.id, quickLoginToken: quickLoginToken
  };
}

// Falls back to slugifying the org name (lowercase, strip anything but a-z0-9) when the org has no
// explicit `domain` set on record -- e.g. "Yawad" -> "yawad.sa". Admins can set an exact domain on
// the Organization record (Organizations page, SystemAdmin only) to override this.
function placeAccountDomain_(org) {
  if (org && org.domain) return org.domain;
  var slug = String(org && org.name ? org.name : 'org').toLowerCase().replace(/[^a-z0-9]/g, '');
  return (slug || 'org') + '.sa';
}

// Next sequence number for "{role}{seq}@..." under one EMC -- scans existing Users under that org
// with that role for the highest existing numeric email suffix and adds 1, so gaps left by
// deactivated accounts never cause a collision (a plain count would).
function nextPlaceAccountSeq_(orgId, role) {
  var prefix = String(role).toLowerCase();
  var max = 0;
  getAll('Users').forEach(function (u) {
    if (u.orgId !== orgId || u.role !== role) return;
    var m = String(u.email || '').match(/^([a-z]+)(\d+)@/i);
    if (m && m[1].toLowerCase() === prefix) max = Math.max(max, Number(m[2]));
  });
  return max + 1;
}

// ---- QR quick-login --------------------------------------------------------
// A persistent, reusable, opaque token (never the plaintext password) so a QR code printed and
// left at the physical place keeps working every shift. See QuickLoginTokens in Utils.gs SCHEMA.
function mintQuickLoginToken_(userId) {
  var token = randomToken_(24);
  insertRow('QuickLoginTokens', { token: token, userId: userId, createdAt: nowIso_() });
  return token;
}

// Redeems a QR-encoded quick-login token into a normal session -- same result shape as login().
// Public (no auth) action -- see PUBLIC_ACTIONS in Code.gs. Deactivating the underlying account is
// what invalidates this: the status check below is identical to a normal login's.
function redeemQuickLogin(token) {
  if (!token) throw new HululError('INVALID_CREDENTIALS', 'This QR code is no longer valid');
  var row = getById('QuickLoginTokens', token, 'token');
  if (!row) throw new HululError('INVALID_CREDENTIALS', 'This QR code is no longer valid');
  var user = getById('Users', row.userId);
  if (!user) throw new HululError('INVALID_CREDENTIALS', 'This QR code is no longer valid');
  if (user.status !== 'Active') throw new HululError('ACCOUNT_INACTIVE', 'This account is suspended or deactivated');

  var sessionToken = randomToken_(32);
  var now = new Date();
  var expires = new Date(now.getTime() + SESSION_TTL_HOURS * 3600 * 1000);
  insertRow('Sessions', { token: sessionToken, userId: user.id, createdAt: now.toISOString(), expiresAt: expires.toISOString() });
  updateRow('Users', user.id, { lastLoginAt: now.toISOString() });
  audit(user.id, 'QUICK_LOGIN', 'Users', user.id, {});
  return { token: sessionToken, user: stripSecrets_(user) };
}

// Great-circle distance in km between two lat/lng points (haversine formula).
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
