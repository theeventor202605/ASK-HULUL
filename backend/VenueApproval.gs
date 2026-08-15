/**
 * HULUL - VenueApproval.gs  (REQ-VAP-01..05, REQ-EVT-12)
 * Inspection Co PM records evaluation/recommendation; GA records the decision.
 * Full history of every venue evaluated for an Event is retained (VenueEvaluations rows are never deleted).
 */

// REQ-VAP-01: Inspection Co PM records evaluation and recommendation. Can only be done once per
// current venue evaluation -- reassignVenue starts a fresh 'current' row (empty recommendation)
// after a rejection, so this doesn't block recommending again on a newly assigned venue.
function recordRecommendation(user, p) {
  requirePermission(user, 'venueApproval.recommend'); // RBAC pilot -- same default roles as before, no behavior change
  var event = getById('Events', p.eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');
  if (!p.recommendation || !String(p.recommendation).trim()) throw new HululError('BAD_REQUEST', 'Recommendation is required');
  var current = currentVenueEvaluation_(p.eventId);
  if (current && current.recommendation) throw new HululError('BAD_REQUEST', 'A recommendation has already been submitted for this venue evaluation.');
  if (!current) {
    current = insertRow('VenueEvaluations', {
      id: newId('VenueEvaluations'), eventId: p.eventId, venueId: event.venueId, inspectionCoId: event.inspectionCoId,
      recommendation: '', recommendationBy: '', recommendationAt: '', decision: '', decisionBy: '', decisionAt: '', status: 'current'
    });
  }
  var updated = updateRow('VenueEvaluations', current.id, {
    recommendation: p.recommendation, recommendationBy: user.id, recommendationAt: nowIso_()
  });
  audit(user.id, 'RECORD_RECOMMENDATION', 'VenueEvaluations', current.id, { recommendation: p.recommendation });
  notifyEventStakeholders_(p.eventId, 'RECOMMENDATION_READY', 'Venue recommendation submitted for ' + event.name, 'VenueEvaluations', current.id);
  return updated;
}

// REQ-VAP-03: GA records Approved / Not Approved.
function recordVenueDecision(user, p) {
  requirePermission(user, 'venueApproval.decide'); // RBAC pilot -- same default roles as before, no behavior change
  var event = getById('Events', p.eventId);
  var current = currentVenueEvaluation_(p.eventId);
  if (!current) throw new HululError('NOT_FOUND', 'No venue evaluation on record for this event');
  if (['Approved', 'Not Approved'].indexOf(p.decision) === -1) throw new HululError('BAD_REQUEST', 'decision must be Approved or Not Approved');
  var updated = updateRow('VenueEvaluations', current.id, { decision: p.decision, decisionBy: user.id, decisionAt: nowIso_() });

  if (p.decision === 'Approved') {
    updateRow('Events', p.eventId, { status: 'VenueApproved' });
  } else {
    updateRow('Events', p.eventId, { status: 'VenueRejected' });
  }
  audit(user.id, 'VENUE_DECISION', 'VenueEvaluations', current.id, { decision: p.decision });
  notifyEventStakeholders_(p.eventId, 'VENUE_DECISION', 'Venue decision: ' + p.decision + ' for ' + (event ? event.name : p.eventId), 'VenueEvaluations', current.id);
  return updated;
}

// REQ-VAP-04 / REQ-EVT-12: on rejection, assign a new Venue/EMC and restart the template workflow,
// preserving the rejected evaluation's history.
// REQ (decoupling pass): reassigning the Venue doesn't have to change which EMC is renting it for
// this Event -- a Venue has no "operating EMC" to default from anymore (see Events.gs file header
// comment), so this simply keeps the Event's current renting EMC unless GA explicitly passes a
// different p.emcId. If the renting EMC actually changes, the previously assigned Event Manager
// (who belonged to the old EMC) is cleared -- same safeguard as updateEvent's emcId patch.
function reassignVenue(user, p) {
  requirePermission(user, 'venueApproval.decide'); // RBAC pilot -- same default roles as before, no behavior change
  var event = getById('Events', p.eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');
  var venue = getById('Venues', p.venueId);
  if (!venue) throw new HululError('NOT_FOUND', 'Venue not found');

  // Mark the old evaluation as superseded (kept for history, REQ-VAP-05).
  var old = currentVenueEvaluation_(p.eventId);
  if (old) updateRow('VenueEvaluations', old.id, { status: 'superseded' });

  var emcId = p.emcId ? assertEmcOrg_(p.emcId).id : event.emcId;
  var eventPatch = {
    venueId: p.venueId, emcId: emcId,
    inspectionCoId: p.inspectionCoId || event.inspectionCoId, status: 'Planning'
  };
  if (emcId !== event.emcId) eventPatch.eventManagerId = '';
  updateRow('Events', p.eventId, eventPatch);

  // Clear out any templates already sent under the old venue/Inspection Co — getEventTemplates
  // recomputes the "Not Sent" set from the (possibly new) inspectionCoId's library automatically,
  // so there's nothing to re-provision here.
  var freshTemplates = findWhere('Templates', function (t) { return t.eventId === p.eventId; });
  freshTemplates.forEach(function (t) { deleteRow('Templates', t.id); });

  insertRow('VenueEvaluations', {
    id: newId('VenueEvaluations'), eventId: p.eventId, venueId: p.venueId, inspectionCoId: p.inspectionCoId || event.inspectionCoId,
    recommendation: '', recommendationBy: '', recommendationAt: '', decision: '', decisionBy: '', decisionAt: '', status: 'current'
  });

  audit(user.id, 'REASSIGN_VENUE', 'Events', p.eventId, { newVenueId: p.venueId });
  // recordRecommendation/recordVenueDecision both notify stakeholders; this restarts the whole
  // readiness workflow on a new venue (clears templates, resets status) and deserves the same.
  notifyEventStakeholders_(p.eventId, 'VENUE_REASSIGNED', 'Venue reassigned to ' + venue.name + ' for ' + event.name, 'Events', p.eventId);
  return getEventDetail(user, p.eventId);
}

function currentVenueEvaluation_(eventId) {
  var rows = findWhere('VenueEvaluations', function (v) { return v.eventId === eventId && v.status === 'current'; });
  return rows[0] || null;
}

// REQ-VAP-05: full timestamped history of every venue evaluated for an Event.
function listVenueEvaluations(user, p) {
  return findWhere('VenueEvaluations', function (v) { return v.eventId === p.eventId; })
    .sort(function (a, b) { return new Date(b.recommendationAt || 0) - new Date(a.recommendationAt || 0); });
}
