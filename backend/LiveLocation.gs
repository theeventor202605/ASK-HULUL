/**
 * HULUL - LiveLocation.gs
 * REQ (Dashboard): "add Live map showing all inspector locations and number of Log photos each
 * inspector took. Need to add another tab to show venue attendance -- first time inspector or user
 * (for example Cluster, a new user type not yet created) attended venue must be inside boundary or
 * no more than 5 meters outside venue boundaries, also the same for last date time user left venue
 * boundaries."
 *
 * This is a SEPARATE, more general mechanism from Inspections.gs's pingInspectionLocation/
 * listActiveInspectorLocations pair -- that one is scoped to an Inspector actively running one
 * Inspection, and stays exactly as-is (still used by the per-venue/per-event "inspector dot" maps
 * elsewhere in the app). This one covers ANY logged-in user regardless of role -- so a future custom
 * role (Settings > Roles, e.g. "Cluster") is tracked the same way with zero code changes here -- and
 * powers two new Dashboard-only views: a platform-wide live map, and first-attended/last-seen-inside
 * venue attendance. Ping frequency is deliberately low (~30s, see startUserLocationPing_ in app.js)
 * since this runs for every logged-in session, not just an inspector's dedicated tracking screen.
 */

// Same idea as Inspections.gs's INSPECTOR_LIVE_LOCATION_FRESHNESS_MS_, just a little more generous
// since the general ping loop (app.js) fires roughly every 30s rather than every 20s -- comfortably
// survives one missed tick without a user's dot flickering on/off the live map.
var USER_LIVE_LOCATION_FRESHNESS_MS_ = 3 * 60 * 1000;

// REQ: "must be inside boundary or no more than 5 meters outside venue boundaries."
var VENUE_ATTENDANCE_TOLERANCE_M_ = 5;

// Called from every logged-in device roughly every 30s (see startUserLocationPing_, app.js) --
// deliberately NOT gated by any particular role or by having an open Inspection, unlike
// pingInspectionLocation. No audit() entry, same reasoning as that function: this is a high-
// frequency telemetry ping, not a user action worth an audit trail row.
function pingUserLocation(user, p) {
  if (!user) throw new HululError('UNAUTHENTICATED', 'Login required');
  if (!p || p.lat === undefined || p.lat === '' || p.lat === null || p.lng === undefined || p.lng === '' || p.lng === null) {
    throw new HululError('BAD_REQUEST', 'lat/lng are required');
  }
  var lat = Number(p.lat), lng = Number(p.lng);
  updateRow('Users', user.id, { lastLat: lat, lastLng: lng, lastSeenAt: nowIso_() });

  // REQ: venue attendance tracking. Venues are a shared catalog (see Events.gs listVenues' own
  // comment -- not owned by any one EMC), so this checks every active venue with a drawn boundary
  // rather than only ones tied to an event this user happens to be assigned to -- a Cluster user (or
  // anyone else) standing inside a venue should be recorded there regardless of whether they have any
  // Event/Inspection link to it at all.
  var venues = getAll('Venues').filter(function (v) { return v.status !== 'Deleted' && v.boundary; });
  venues.forEach(function (v) {
    var boundary = parseBoundary_(v.boundary);
    if (!boundary || !insideOrNearBoundary_(lat, lng, boundary, VENUE_ATTENDANCE_TOLERANCE_M_)) return;
    var existing = findWhere('VenueAttendance', function (a) { return a.userId === user.id && a.venueId === v.id; })[0];
    if (existing) {
      updateRow('VenueAttendance', existing.id, { lastSeenInsideAt: nowIso_() });
    } else {
      insertRow('VenueAttendance', {
        id: newId('VenueAttendance'), userId: user.id, venueId: v.id,
        firstAttendedAt: nowIso_(), lastSeenInsideAt: nowIso_(), createdAt: nowIso_()
      });
    }
  });
  return { ok: true };
}

// Dashboard > Live Map. Bundles both pieces the tab needs into one call (same "one aggregate call
// per dashboard section" convention as dashboardSummary, Reports.gs):
//   locations: every user with a fresh ping, scoped to venues tied to an event this caller can
//     already see (listEvents is itself org/role-scoped -- same boundary-membership scoping
//     listActiveInspectorLocations, Inspections.gs, already uses, just generalized to any role).
//   inspectorPhotoCounts: REQ: "number of Log photos each inspector took." Log Photos are captured
//     to local device storage only (see logPhotos.js) and never reach the server unless "Create Log"
//     turns them into Finding evidence -- that's the only copy this endpoint can ever see, so it
//     counts evidence photos attached to Findings each Inspector created, same events scope as above.
function dashboardLiveMapData(user, p) {
  if (!user) throw new HululError('UNAUTHENTICATED', 'Login required');
  var events = listEvents(user, {});
  var venueIds = Array.from(new Set(events.map(function (e) { return e.venueId; }).filter(Boolean)));
  var venuesById = {};
  venueIds.forEach(function (vid) {
    var v = getById('Venues', vid);
    if (v) venuesById[vid] = { id: v.id, name: v.name, boundary: parseBoundary_(v.boundary) };
  });

  var cutoff = Date.now() - USER_LIVE_LOCATION_FRESHNESS_MS_;
  var users = getAll('Users').filter(function (u) {
    return u.status === 'Active' && u.lastSeenAt && new Date(u.lastSeenAt).getTime() >= cutoff &&
      u.lastLat !== '' && u.lastLat != null && u.lastLng !== '' && u.lastLng != null;
  });
  var locations = [];
  users.forEach(function (u) {
    var lat = Number(u.lastLat), lng = Number(u.lastLng);
    var matched = null;
    Object.keys(venuesById).forEach(function (vid) {
      if (matched) return;
      var v = venuesById[vid];
      if (v.boundary && pointInPolygon_(lat, lng, v.boundary)) matched = v;
    });
    if (!matched) return; // not inside any venue this caller can see -- same filtering listActiveInspectorLocations applies
    locations.push({
      userId: u.id, userName: u.name, role: u.role, roleLabel: roleLabel_(u.role),
      lat: u.lastLat, lng: u.lastLng, lastSeenAt: u.lastSeenAt, venueId: matched.id, venueName: matched.name
    });
  });

  var eventIds = events.map(function (e) { return e.id; });
  var findings = getAll('Findings').filter(function (f) { return eventIds.indexOf(f.eventId) !== -1; });
  var photoCounts = {};
  findings.forEach(function (f) {
    var n = String(f.evidenceUrls || '').split(',').filter(Boolean).length;
    if (!n) return;
    photoCounts[f.createdBy] = (photoCounts[f.createdBy] || 0) + n;
  });
  var usersById = {};
  getAll('Users').forEach(function (u) { usersById[u.id] = u; });
  var inspectorPhotoCounts = Object.keys(photoCounts)
    .filter(function (uid) { return usersById[uid] && usersById[uid].role === ROLES.INSPECTOR; })
    .map(function (uid) { return { inspectorId: uid, inspectorName: usersById[uid].name, photoCount: photoCounts[uid] }; })
    .sort(function (a, b) { return b.photoCount - a.photoCount; });

  return { locations: locations, inspectorPhotoCounts: inspectorPhotoCounts };
}

// Dashboard > Venue Attendance tab. Every VenueAttendance row for a venue tied to an event this
// caller can see (optionally narrowed further to one venue via p.venueId), joined with the user's
// name/role and the venue's name for display. Sorted most-recently-seen first, same "what's fresh
// matters most" ordering the rest of the app's activity-style lists use.
function dashboardVenueAttendance(user, p) {
  if (!user) throw new HululError('UNAUTHENTICATED', 'Login required');
  var events = listEvents(user, {});
  var venueIds = Array.from(new Set(events.map(function (e) { return e.venueId; }).filter(Boolean)));
  if (p && p.venueId) venueIds = venueIds.filter(function (id) { return id === p.venueId; });
  if (!venueIds.length) return [];

  var venuesById = {};
  getAll('Venues').forEach(function (v) { venuesById[v.id] = v; });
  var usersById = {};
  getAll('Users').forEach(function (u) { usersById[u.id] = u; });

  return getAll('VenueAttendance')
    .filter(function (a) { return venueIds.indexOf(a.venueId) !== -1; })
    .map(function (a) {
      var u = usersById[a.userId], v = venuesById[a.venueId];
      return {
        id: a.id, userId: a.userId, userName: u ? u.name : '—', role: u ? u.role : '', roleLabel: u ? roleLabel_(u.role) : '—',
        venueId: a.venueId, venueName: v ? v.name : '—',
        firstAttendedAt: a.firstAttendedAt, lastSeenInsideAt: a.lastSeenInsideAt
      };
    })
    .sort(function (a, b) { return new Date(b.lastSeenInsideAt).getTime() - new Date(a.lastSeenInsideAt).getTime(); });
}
