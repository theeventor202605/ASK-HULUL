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
 *  - Venue Places (eventId blank) -- permanent, managed by whoever manages the Venue itself
 *    (SystemAdmin / EMC Admin / EMC Manager), cover every Event held at the venue. Venues > Places.
 *  - Event Places (eventId set) -- REQ: a vendor "may just be attending this season of events," so
 *    these are registered under one specific Event instead, managed by whoever manages that Event's
 *    other on-the-ground infrastructure (SystemAdmin / EMC Admin / EMC Manager / Event Manager --
 *    same set as createZone/deleteZone in Events.gs), and every account they provision is
 *    auto-deactivated once that Event ends (see deactivateEndedEventPlaceAccounts). Event > Participants tab.
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
  return places.map(function (pl) {
    var accountIds = pl.accountIds ? String(pl.accountIds).split(',').filter(Boolean) : [];
    var accounts = accountIds.map(function (id) { return usersById[id]; }).filter(Boolean)
      .map(function (u) { return { id: u.id, name: u.name, email: u.email, role: u.role, status: u.status }; });
    return Object.assign({}, pl, { accounts: accounts });
  });
}

// Shared by createPlace/addPlaceAccount/getPlaceAccountCredentials/deletePlace: resolves and
// authorizes against either a Venue Place or an Event Place depending on whether `event` is given.
function assertCanManagePlace_(user, venue, event) {
  if (event) {
    requireRole(user, EVENT_PLACE_MANAGE_ROLES);
    if (user.role !== ROLES.SYSTEM_ADMIN && venue.emcId !== user.orgId && event.eventManagerId !== user.id) {
      throw new HululError('FORBIDDEN', 'Not your event');
    }
  } else {
    requireRole(user, [ROLES.SYSTEM_ADMIN, ROLES.EMC_ADMIN, ROLES.EMC_MANAGER]);
    if (user.role !== ROLES.SYSTEM_ADMIN && venue.emcId !== user.orgId) {
      throw new HululError('FORBIDDEN', 'Not your organization\'s venue');
    }
  }
}

function createPlace(user, p) {
  var event = p.eventId ? getById('Events', p.eventId) : null;
  if (p.eventId && !event) throw new HululError('NOT_FOUND', 'Event not found');
  var venueId = event ? event.venueId : p.venueId;
  if (!venueId || !p.name) throw new HululError('BAD_REQUEST', (event ? 'This event has no venue assigned yet' : 'venueId') + ' and name are required');
  if (PLACE_TYPES.indexOf(p.type) === -1) throw new HululError('BAD_REQUEST', 'Invalid place type');
  var venue = getById('Venues', venueId);
  if (!venue) throw new HululError('NOT_FOUND', 'Venue not found');
  assertCanManagePlace_(user, venue, event);
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

  var account = provisionPlaceAccount_(user, place, venue);
  return { place: getById('Places', place.id), account: account };
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
  var account = provisionPlaceAccount_(user, place, venue);
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
function provisionPlaceAccount_(actingUser, place, venue) {
  var role = mapParticipantRole_(place.type);
  var org = venue.emcId ? getById('Organizations', venue.emcId) : null;
  var domain = placeAccountDomain_(org);
  var seq = nextPlaceAccountSeq_(venue.emcId, role);
  var email = role.toLowerCase() + Utilities.formatString('%03d', seq) + '@' + domain;
  var plainPassword = PLACE_ACCOUNT_DEFAULT_PASSWORD;

  var loginUser = createUserWithPassword({
    id: newId('Users'), name: place.name, email: email, orgType: 'PARTICIPANT',
    orgId: venue.emcId || '', role: role, createdBy: actingUser.id
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
