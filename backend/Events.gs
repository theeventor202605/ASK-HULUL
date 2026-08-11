/**
 * HULUL - Events.gs  (REQ-EVT-01..12)
 * Events, Venues, Zones, Sub-Events.
 *
 * REQ (decoupling pass): a Venue is no longer connected to any one EMC organization -- it's a
 * shared catalog entry any EMCAdmin/EMCManager/SystemAdmin can add to and manage, and every
 * authenticated user can see the full list (no more org-scoped filtering in listVenues). The
 * EMC/Venue/Event relationship now lives entirely on the Event: which EMC is renting a Venue for a
 * given Event is chosen explicitly when that Event is created (p.emcId, required -- see
 * createEvent/assertEmcOrg_), not inherited or defaulted from the Venue. The Venues sheet still has
 * a legacy `emcId` column (left in place so existing physical rows don't shift columns -- see
 * Utils.gs SCHEMA's Venues comment) but the app no longer reads or writes it anywhere.
 */

// Deleted venues (status: 'Deleted') are hidden from every normal listing -- e.g. so a soft-deleted
// venue can't be picked when creating an Event -- but includeDeleted lets the Venues admin page and
// the Edit Venue form (which needs to load a venue by id regardless of status) see it anyway. Open
// to any authenticated user -- a Venue isn't scoped to one organization (see file header comment).
function listVenues(user, p) {
  return p && p.includeDeleted ? getAll('Venues') : getAll('Venues').filter(function (v) { return v.status !== 'Deleted'; });
}

// A Venue is a shared catalog entry, not owned by any one EMC (see file header comment) -- any
// SystemAdmin/EMCAdmin/EMCManager can add one, and which EMC ends up renting it for a given Event is
// chosen independently at Event creation (createEvent's required p.emcId).
function createVenue(user, p) {
  requireRole(user, [ROLES.SYSTEM_ADMIN, ROLES.EMC_ADMIN, ROLES.EMC_MANAGER]);
  if (!p.name) throw new HululError('BAD_REQUEST', 'name is required');
  // p.boundary arrives as an array of {lat,lng} points (drawn on the map, see venues.js) or is
  // omitted entirely -- stringifyBoundary_ handles both that and a malformed/too-short array by
  // storing '' (no boundary yet), same as leaving it undrawn.
  var venue = {
    id: newId('Venues'), name: p.name, address: p.address || '', city: p.city || '',
    lat: p.lat || '', lng: p.lng || '', createdAt: nowIso_(), status: 'Active',
    boundary: p.boundary ? stringifyBoundary_(p.boundary) : ''
  };
  insertRow('Venues', venue);
  audit(user.id, 'CREATE_VENUE', 'Venues', venue.id, {});
  return venue;
}

// name/address/city/lat/lng/boundary are editable by any SystemAdmin/EMCAdmin/EMCManager -- a Venue
// isn't scoped to one organization (see file header comment), so there's no owning-org check here.
function updateVenue(user, p) {
  requireRole(user, [ROLES.SYSTEM_ADMIN, ROLES.EMC_ADMIN, ROLES.EMC_MANAGER]);
  var venue = getById('Venues', p.venueId);
  if (!venue) throw new HululError('NOT_FOUND', 'Venue not found');
  var patch = {};
  ['name', 'address', 'city', 'lat', 'lng'].forEach(function (f) { if (p[f] !== undefined) patch[f] = p[f]; });
  // boundary is redrawn/cleared as a whole array (or []/null to clear it), never patched piecemeal.
  if (p.boundary !== undefined) patch.boundary = p.boundary ? stringifyBoundary_(p.boundary) : '';
  if (patch.name !== undefined && !String(patch.name).trim()) throw new HululError('BAD_REQUEST', 'name is required');
  var updated = updateRow('Venues', p.venueId, patch);
  audit(user.id, 'UPDATE_VENUE', 'Venues', p.venueId, {});
  return updated;
}

// What's already been built on top of a Venue -- checked before allowing a delete, and shown to
// the caller when blocking one. Zones/Places count only their own active rows (a soft-deleted Zone
// no longer "belongs" to anything); Events and VenueEvaluations are never soft-deleted so all of
// them count.
function venueImpact_(venueId) {
  var zones = activeZonesForVenue_(venueId);
  var places = findWhere('Places', function (pl) { return pl.venueId === venueId; });
  var events = findWhere('Events', function (e) { return e.venueId === venueId; });
  var evaluations = findWhere('VenueEvaluations', function (v) { return v.venueId === venueId; });
  return { zonesCount: zones.length, placesCount: places.length, eventsCount: events.length, evaluationsCount: evaluations.length };
}

function listVenueImpact(user, p) {
  var venue = getById('Venues', p.venueId);
  if (!venue) throw new HululError('NOT_FOUND', 'Venue not found');
  var impact = venueImpact_(p.venueId);
  return Object.assign({
    hasImpact: impact.zonesCount > 0 || impact.placesCount > 0 || impact.eventsCount > 0 || impact.evaluationsCount > 0
  }, impact);
}

// Soft-delete: allowed ONLY when nothing has been added on top of the venue yet (no Zones, Places,
// Events, or Venue Evaluations) -- unlike Zones, there's no "reassign and delete anyway" option
// here, since a Venue is the root of that whole tree and there's nowhere to reassign it to.
function deleteVenue(user, p) {
  requireRole(user, [ROLES.SYSTEM_ADMIN, ROLES.EMC_ADMIN, ROLES.EMC_MANAGER]);
  var venue = getById('Venues', p.venueId);
  if (!venue) throw new HululError('NOT_FOUND', 'Venue not found');
  if (venue.status === 'Deleted') throw new HululError('BAD_REQUEST', 'Venue is already deleted');
  var impact = venueImpact_(p.venueId);
  if (impact.zonesCount > 0 || impact.placesCount > 0 || impact.eventsCount > 0 || impact.evaluationsCount > 0) {
    throw new HululError('BAD_REQUEST', 'This venue already has zones, places, or events tied to it and can\'t be deleted.');
  }
  updateRow('Venues', p.venueId, { status: 'Deleted' });
  audit(user.id, 'DELETE_VENUE', 'Venues', p.venueId, {});
  return { ok: true };
}

// Deleted zones are soft-deleted (status: 'Deleted') so historical records that still reference
// them (old assignments, findings via participants) keep resolving a real name — they're just
// hidden from every active listing. Every place that needs "the zones of this venue" for normal
// use should go through this helper rather than querying the Zones sheet directly.
function activeZonesForVenue_(venueId) {
  return findWhere('Zones', function (z) { return z.venueId === venueId && z.status !== 'Deleted'; });
}

function listZones(user, p) {
  var all = p && p.includeDeleted ? getAll('Zones') : getAll('Zones').filter(function (z) { return z.status !== 'Deleted'; });
  if (p && p.venueId) all = all.filter(function (z) { return z.venueId === p.venueId; });
  return all;
}

// REQ-EVT-06/07: a Zone belongs to a Venue and has one or more Vendors (Participants).
function createZone(user, p) {
  requireRole(user, [ROLES.SYSTEM_ADMIN, ROLES.EMC_ADMIN, ROLES.EMC_MANAGER, ROLES.EVENT_MANAGER]);
  if (!p.name || !p.venueId) throw new HululError('BAD_REQUEST', 'name and venueId are required');
  var zone = {
    id: newId('Zones'), venueId: p.venueId, name: p.name, createdAt: nowIso_(), status: 'Active',
    boundary: p.boundary ? stringifyBoundary_(p.boundary) : ''
  };
  insertRow('Zones', zone);
  audit(user.id, 'CREATE_ZONE', 'Zones', zone.id, {});
  return zone;
}

// How much work is tied to a zone before deleting it: Inspector Assignments that cover it, and
// Findings logged against Participants (vendors) located in it. Used to warn the caller and offer
// an (optional) alternative zone to move that work to. Deliberately an exact "does this participant's
// zoneId list explicitly name this zone" check (zoneFieldIds_), NOT the broader zoneFieldCoversZone_
// coverage semantics used for inspection relevance -- a participant left blank/'ALL' ("every zone")
// was never actually tied to this specific zone, so deleting it doesn't impact them and there's
// nothing to reassign.
function zoneImpact_(zoneId) {
  var assignments = findWhere('InspectorAssignments', function (a) {
    return (a.zoneIds ? String(a.zoneIds).split(',').filter(Boolean) : []).indexOf(zoneId) !== -1;
  });
  var participantIds = findWhere('Participants', function (pt) { return zoneFieldIds_(pt.zoneId).indexOf(zoneId) !== -1; }).map(function (pt) { return pt.id; });
  var findings = participantIds.length ? findWhere('Findings', function (f) { return participantIds.indexOf(f.participantId) !== -1; }) : [];
  return { assignmentsCount: assignments.length, logsCount: findings.length, participantsCount: participantIds.length };
}

function listZoneImpact(user, p) {
  var zone = getById('Zones', p.zoneId);
  if (!zone) throw new HululError('NOT_FOUND', 'Zone not found');
  var impact = zoneImpact_(p.zoneId);
  return Object.assign({ hasImpact: impact.assignmentsCount > 0 || impact.logsCount > 0 || impact.participantsCount > 0 }, impact);
}

// Soft-delete: the row stays (old records keep a real name to resolve against) but it's marked
// Deleted and filtered out of every active zone list. If the zone had assignments/participants
// tied to it and the caller supplied reassignToZoneId, that work is moved to the alternative zone
// first — but per REQ, this is offered, not required: deletion proceeds either way.
function deleteZone(user, p) {
  requireRole(user, [ROLES.SYSTEM_ADMIN, ROLES.EMC_ADMIN, ROLES.EMC_MANAGER, ROLES.EVENT_MANAGER]);
  var zone = getById('Zones', p.zoneId);
  if (!zone) throw new HululError('NOT_FOUND', 'Zone not found');
  if (zone.status === 'Deleted') throw new HululError('BAD_REQUEST', 'Zone is already deleted');

  if (p.reassignToZoneId) {
    var target = getById('Zones', p.reassignToZoneId);
    if (!target || target.venueId !== zone.venueId || target.status === 'Deleted') {
      throw new HululError('BAD_REQUEST', 'The alternative zone must be an active zone in the same venue');
    }
    // Replace the deleted zone WITHIN each participant's zoneId list (same pattern as
    // InspectorAssignments.zoneIds just below) rather than overwriting the whole field -- an
    // Operator with several zones must keep the others, not lose them because one got reassigned.
    findWhere('Participants', function (pt) { return zoneFieldIds_(pt.zoneId).indexOf(p.zoneId) !== -1; }).forEach(function (pt) {
      var ids = zoneFieldIds_(pt.zoneId).filter(function (zid) { return zid !== p.zoneId; });
      if (ids.indexOf(p.reassignToZoneId) === -1) ids.push(p.reassignToZoneId);
      updateRow('Participants', pt.id, { zoneId: ids.join(',') });
    });
    findWhere('InspectorAssignments', function (a) {
      return (a.zoneIds ? String(a.zoneIds).split(',').filter(Boolean) : []).indexOf(p.zoneId) !== -1;
    }).forEach(function (a) {
      var ids = String(a.zoneIds).split(',').filter(Boolean).filter(function (zid) { return zid !== p.zoneId; });
      if (ids.indexOf(p.reassignToZoneId) === -1) ids.push(p.reassignToZoneId);
      updateRow('InspectorAssignments', a.id, { zoneIds: ids.join(',') });
    });
  }

  updateRow('Zones', p.zoneId, { status: 'Deleted' });
  audit(user.id, 'DELETE_ZONE', 'Zones', p.zoneId, { reassignToZoneId: p.reassignToZoneId || '' });
  return { ok: true };
}

// A Venue is a shared catalog entry, not owned by any EMC (see file header comment) -- any EMC may
// rent it for a specific Event. This is what actually validates and resolves an Event's renting EMC
// wherever it's set (createEvent/updateEvent/reassignVenue).
function assertEmcOrg_(emcId) {
  var org = getById('Organizations', emcId);
  if (!org || org.type !== 'EMC') throw new HululError('BAD_REQUEST', 'emcId must reference an EMC organization');
  return org;
}

// REQ-EVT-01/02/04: GA creates Event with Venue + Inspection Co assigned at creation.
// REQ (decoupling pass): Venue and EMC are chosen independently at Event creation -- the Venue no
// longer has an "operating EMC" to default from, so GA must explicitly pick the renting EMC
// (p.emcId, required) every time, same as picking the Venue itself. The Event's own emcId is what
// governs which EMC's users (EMC Manager/Event Manager/etc.) can see and act on this Event (see
// listEvents' orgType==='EMC' branch and every requireRole(..., event.emcId)-style check downstream).
function createEvent(user, p) {
  requireRole(user, [ROLES.SYSTEM_ADMIN, ROLES.GA_ADMIN, ROLES.GA_USER]);
  ['name', 'venueId', 'address', 'city', 'startDateTime', 'endDateTime', 'inspectionCoId', 'emcId'].forEach(function (f) {
    if (!p[f]) throw new HululError('BAD_REQUEST', f + ' is required');
  });
  var venue = getById('Venues', p.venueId);
  if (!venue) throw new HululError('NOT_FOUND', 'Venue not found');
  if (p.projectId && !getById('Projects', p.projectId)) throw new HululError('NOT_FOUND', 'Project not found');
  var emcId = assertEmcOrg_(p.emcId).id;
  var event = {
    id: newId('Events'), name: p.name, code: p.code || ('EVT-' + Date.now().toString(36).toUpperCase()),
    project: p.project || '', venueId: p.venueId, address: p.address, city: p.city,
    startDateTime: p.startDateTime, endDateTime: p.endDateTime, emcId: emcId,
    inspectionCoId: p.inspectionCoId, eventManagerId: p.eventManagerId || '', status: 'Planning',
    createdBy: user.id, createdAt: nowIso_(), projectId: p.projectId || ''
  };
  insertRow('Events', event);
  audit(user.id, 'CREATE_EVENT', 'Events', event.id, {});
  // Readiness templates are no longer auto-provisioned here — the assigned Inspection Company's
  // template library (Templates.gs) is available to send as soon as a Project Manager is ready;
  // see sendTemplates.
  notifyEventStakeholders_(event.id, 'EVENT_CREATED', 'Event ' + event.name + ' created', 'Events', event.id);
  return event;
}

function updateEvent(user, p) {
  var event = getById('Events', p.eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');
  requireRole(user, [ROLES.SYSTEM_ADMIN, ROLES.GA_ADMIN, ROLES.GA_USER]);
  if (p.projectId && !getById('Projects', p.projectId)) throw new HululError('NOT_FOUND', 'Project not found');
  var patch = {};
  ['name', 'address', 'city', 'startDateTime', 'endDateTime', 'status', 'eventManagerId', 'project', 'projectId'].forEach(function (f) {
    if (p[f] !== undefined) patch[f] = p[f];
  });
  // REQ (rental model): GA may re-rent the venue to a different EMC without reassigning the venue
  // itself. Changing it invalidates whichever Event Manager was assigned under the old EMC (they
  // very likely don't belong to the new one), so it's cleared unless the caller also supplies a
  // fresh eventManagerId in this same call (already captured into patch by the loop above).
  if (p.emcId !== undefined && p.emcId !== event.emcId) {
    patch.emcId = assertEmcOrg_(p.emcId).id;
    if (p.eventManagerId === undefined) patch.eventManagerId = '';
  }
  var updated = updateRow('Events', p.eventId, patch);
  audit(user.id, 'UPDATE_EVENT', 'Events', p.eventId, patch);
  return updated;
}

// GA Admin (and SystemAdmin) may remove an Event only while it's still in Planning —
// before venue approval, disciplines, inspections, or findings have started against it.
function deleteEvent(user, p) {
  requireRole(user, [ROLES.SYSTEM_ADMIN, ROLES.GA_ADMIN]);
  var event = getById('Events', p.eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');
  if (event.status !== 'Planning') throw new HululError('FORBIDDEN', 'Only events still in Planning status can be deleted');
  findWhere('Templates', function (t) { return t.eventId === p.eventId; }).forEach(function (t) { deleteRow('Templates', t.id); });
  findWhere('SubEvents', function (s) { return s.eventId === p.eventId; }).forEach(function (s) { deleteRow('SubEvents', s.id); });
  deleteRow('Events', p.eventId);
  audit(user.id, 'DELETE_EVENT', 'Events', p.eventId, {});
  return { ok: true };
}

// REQ-EVT-03: Sub-Event inherits parent Venue/EMC/InspectionCo and must fall within parent window.
function createSubEvent(user, p) {
  var parent = getById('Events', p.eventId);
  if (!parent) throw new HululError('NOT_FOUND', 'Parent event not found');
  requireRole(user, [ROLES.SYSTEM_ADMIN, ROLES.GA_ADMIN, ROLES.GA_USER, ROLES.EVENT_MANAGER]);
  if (new Date(p.startDateTime) < new Date(parent.startDateTime) || new Date(p.endDateTime) > new Date(parent.endDateTime)) {
    throw new HululError('BAD_REQUEST', 'Sub-event must fall within the parent event window');
  }
  var sub = { id: newId('SubEvents'), eventId: p.eventId, name: p.name, startDateTime: p.startDateTime, endDateTime: p.endDateTime };
  insertRow('SubEvents', sub);
  audit(user.id, 'CREATE_SUBEVENT', 'SubEvents', sub.id, {});
  return sub;
}

// Used by the Sub-Events page (all sub-events under one event) and the Projects page (sub-event
// counts per project, summed across its events). Reuses listEvents' own role-scoping instead of
// duplicating it, so a Vendor/Operator/Exhibitor login still only sees sub-events under events at
// their own venue(s).
function listSubEvents(user, p) {
  var visibleEventIds = {};
  listEvents(user, {}).forEach(function (e) { visibleEventIds[e.id] = true; });
  var all = getAll('SubEvents').filter(function (s) { return visibleEventIds[s.eventId]; });
  if (p && p.eventId) all = all.filter(function (s) { return s.eventId === p.eventId; });
  return all;
}

function listEvents(user, p) {
  var all = getAll('Events');
  if (user.role === ROLES.GA_ADMIN || user.role === ROLES.GA_USER) {
    // GA sees events for venues under GAs they administer: for simplicity GA sees all (GA is the regulator).
  } else if (user.role === ROLES.VENDOR || user.role === ROLES.OPERATOR || user.role === ROLES.EXHIBITOR) {
    // Participant logins (see Places.gs/Participants.gs) are scoped to a Venue, not one Event --
    // they should only see Events held at whichever venue(s) their Participant record(s) belong to.
    var venueIds = findWhere('Participants', function (pt) { return pt.userId === user.id; })
      .map(function (pt) { return pt.venueId; }).filter(Boolean);
    all = all.filter(function (e) { return venueIds.indexOf(e.venueId) !== -1; });
  } else if (user.orgType === 'EMC') {
    all = all.filter(function (e) { return e.emcId === user.orgId; });
  } else if (user.orgType === 'INSPECTION') {
    all = all.filter(function (e) { return e.inspectionCoId === user.orgId; });
  }
  if (p && p.status) all = all.filter(function (e) { return e.status === p.status; });
  if (p && p.projectId) all = all.filter(function (e) { return e.projectId === p.projectId; });
  return all.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
}

function getEventDetail(user, eventId) {
  var event = getById('Events', eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');
  if (user.role === ROLES.VENDOR || user.role === ROLES.OPERATOR || user.role === ROLES.EXHIBITOR) {
    // Same venue-scoping as listEvents -- also enforced here so a direct link to an event outside
    // their venue doesn't bypass the list filter.
    var myVenueIds = findWhere('Participants', function (pt) { return pt.userId === user.id; })
      .map(function (pt) { return pt.venueId; }).filter(Boolean);
    if (myVenueIds.indexOf(event.venueId) === -1) throw new HululError('FORBIDDEN', 'Not your venue\'s event');
  }
  var venue = getById('Venues', event.venueId);
  var zones = venue ? activeZonesForVenue_(venue.id) : [];
  var subEvents = findWhere('SubEvents', function (s) { return s.eventId === eventId; });
  var findings = findWhere('Findings', function (f) { return f.eventId === eventId; });
  var project = event.projectId ? getById('Projects', event.projectId) : null;
  var buckets = findingKpiBuckets_(findings);
  return {
    event: event, venue: venue, zones: zones, subEvents: subEvents, project: project,
    kpi: {
      totalLogs: buckets.total, open: buckets.open, inReview: buckets.inReview,
      resolved: buckets.resolved, reopened: buckets.reopen, rejected: buckets.rejected
    }
  };
}

// REQ-EVT-11: EMC Manager assigns an Event Manager to a Venue (recorded on the Event).
function assignEventManagerToVenue(user, p) {
  requireRole(user, [ROLES.SYSTEM_ADMIN, ROLES.EMC_MANAGER, ROLES.EMC_ADMIN]);
  var updated = updateRow('Events', p.eventId, { eventManagerId: p.eventManagerId });
  audit(user.id, 'ASSIGN_EVENT_MANAGER', 'Events', p.eventId, { eventManagerId: p.eventManagerId });
  var event = getById('Events', p.eventId);
  notify_(p.eventManagerId, 'ASSIGNMENT', 'You were assigned as Event Manager for ' + (event ? event.name : p.eventId), 'Events', p.eventId, p.eventId);
  return updated;
}
