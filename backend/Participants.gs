/**
 * HULUL - Participants.gs  (REQ-ACC-08, REQ-PAR)
 * Vendors, Operators, Exhibitors created by an Event Manager or Inspector, scoped to a Venue (not
 * one Event) -- so the same Participant naturally covers every Event held at that venue instead of
 * being re-entered per event. Optionally linked to a login-capable Users account. See Places.gs for
 * the auto-provisioned version of this (one Participant + Users account per catalog Place).
 */

function listParticipants(user, p) {
  var all = getAll('Participants');
  if (p && p.venueId) all = all.filter(function (pt) { return pt.venueId === p.venueId; });
  // Exact "does this participant's zoneId list explicitly name this zone" (zoneFieldIds_, Utils.gs)
  // -- same semantics as zoneImpact_ (Events.gs), not the broader "every zone" coverage matching
  // used for inspection relevance.
  if (p && p.zoneId) all = all.filter(function (pt) { return zoneFieldIds_(pt.zoneId).indexOf(p.zoneId) !== -1; });
  // Optional: narrow to what's relevant for one Event -- every permanent (eventId blank)
  // Participant plus that Event's own temporary ones, excluding another Event's temporary
  // Participants even at the same venue. Omit eventId to see everything (e.g. the Venues > Places
  // page's own venue-wide participant views, unaffected by this).
  if (p && p.eventId) all = all.filter(function (pt) { return !pt.eventId || pt.eventId === p.eventId; });
  var merged = mergeParticipantsByLocation_(all);
  // REQ: "Across all maps any participant with a logged risk turns red dot with a number above the
  // dot." Every map that plots participants sources its dots from this call.
  var countById = findingsOpenCountByParticipant_();
  return merged.map(function (pt) { return Object.assign({}, pt, { openFindingsCount: countById[pt.id] || 0 }); });
}

// NOTE: the original manual createParticipant/updateParticipant API (REQ-ACC-08's direct-creation
// path) was removed here -- Places.gs's createPlace/updatePlace fully superseded it (auto-provisions
// the linked Users account in the same step) and had zero remaining frontend callers. mapParticipantRole_
// is kept because Places.gs's provisionPlaceAccount_ still uses it to pick the right role per place type.
// REQ ("configurable Place/Participant types, allow adding others"): a custom type IS a role code by
// construction -- it only ever reaches here after validPlaceType_ (Places.gs) confirmed it's either a
// built-in or an active custom role flagged isParticipantType (participantTypes_, Roles.gs) -- so any
// type other than the 3 hardcoded ones is trusted and returned as-is, same as a built-in code would be.
// 'Other' keeps its original fallback (no role of its own, provisions a Vendor-role account).
function mapParticipantRole_(type) {
  if (type === 'Vendor') return ROLES.VENDOR;
  if (type === 'Operator') return ROLES.OPERATOR;
  if (type === 'Exhibitor') return ROLES.EXHIBITOR;
  if (type === 'Other' || !type) return ROLES.VENDOR;
  return type;
}

// REQ: "PM must select relevant disciplines for every participant; PM may select one or more
// participants then apply all relevant disciplines." Deliberately separate from
// createParticipant/updateParticipant (a different role manages this). REQ follow-up: this used to
// union-merge (add to whatever was already set) rather than overwrite, on the theory that batch-
// applying one discipline to a group shouldn't wipe out something set individually on one of them --
// but that surprised the PM in practice ("I checked one box and ended up with two"), since the
// popup's checkboxes looked like "this is the participant's discipline list" rather than "these get
// added on top of whatever's already there." Now overwrites: whatever is checked becomes the
// selected participant(s)' full discipline list. The frontend (eventPlaces.js) pre-checks each
// selected participant's current disciplines in the popup precisely so nothing already set is lost
// by surprise -- the PM sees and can deliberately uncheck it, instead of it vanishing silently.
function bulkAssignParticipantDisciplines(user, p) {
  requirePermission(user, 'participant.assignDisciplines');
  if (!p.participantIds || !p.participantIds.length) throw new HululError('BAD_REQUEST', 'Select at least one participant');
  if (!p.disciplineIds || !p.disciplineIds.length) throw new HululError('BAD_REQUEST', 'Select at least one category to apply');

  var disciplineIds = Array.from(new Set(p.disciplineIds));
  var updated = p.participantIds.map(function (participantId) {
    var participant = getById('Participants', participantId);
    if (!participant) throw new HululError('NOT_FOUND', 'Participant not found: ' + participantId);
    return updateRow('Participants', participantId, { disciplineIds: disciplineIds.join(',') });
  });
  audit(user.id, 'BULK_ASSIGN_PARTICIPANT_DISCIPLINES', 'Participants', '', { participantIds: p.participantIds, disciplineIds: disciplineIds });
  return updated;
}

// Same venue + name + type + zone -- identifies "the same physical vendor spot" regardless of which
// account is logged into it (deliberately looser than participantDupKey_ below, which also requires
// coordinates + the same account and is used only to decide what's safe to delete). Used to let
// every shift account at one spot see the same Findings -- see participantSiblingIds_.
function participantLocationKey_(p) {
  return String(p.venueId || '') + '|' + String(p.name || '').trim().toLowerCase() + '|' + String(p.type || '') + '|' + String(p.zoneId || '');
}

// REQ: "Across all maps any participant with a logged risk turns red dot with a number above the
// dot showing unresolved logs. Only when a log is closed then the dot returns to default colour."
// Returns { [participantId]: count } for EVERY Participant row (not just merged primaries) --
// counts every still-open Finding (FINDING_OPEN_STATUSES, Findings.gs) recorded against ANY account
// sharing that participant's physical spot (participantLocationKey_ above), same "shared across
// every shift" semantics listFindings already uses for Vendor/Operator/Exhibitor visibility, so
// every account/shift at one spot shows the identical badge count. Keyed by every individual
// Participant id (not just the merged primary) so callers working from either a merged list
// (listParticipants) or a raw per-account lookup (listPlaces, via accountIds) can look themselves up
// directly without re-merging. FINDING_OPEN_STATUSES lives in Findings.gs -- referenced only inside
// this function body (not at top level), so file load order doesn't matter.
function findingsOpenCountByParticipant_() {
  var openFindings = findWhere('Findings', function (f) { return FINDING_OPEN_STATUSES.indexOf(f.status) !== -1; });
  var allParticipants = getAll('Participants');
  var participantsById = {};
  allParticipants.forEach(function (pt) { participantsById[pt.id] = pt; });
  var countByKey = {};
  openFindings.forEach(function (f) {
    var pt = participantsById[f.participantId];
    if (!pt) return;
    var key = participantLocationKey_(pt);
    countByKey[key] = (countByKey[key] || 0) + 1;
  });
  var countById = {};
  allParticipants.forEach(function (pt) { countById[pt.id] = countByKey[participantLocationKey_(pt)] || 0; });
  return countById;
}

// REQ bug report: a Critical finding logged against the morning-shift account of a two-account
// vendor (see addPlaceAccount/"add another account" in Places.gs -- e.g. separate morning/afternoon
// shift staff) was invisible to the afternoon-shift account once the shift changed, because
// visibility used to be scoped to the exact Participant row an inspection was recorded against. With
// a 6-hour resolution window, that gap alone could burn the whole window before anyone who's
// actually on shift even sees the finding. This returns every Participant id that represents the
// same physical vendor spot as any of userId's own Participant rows (across every account/shift at
// that spot, not just their own), so Findings.listFindings can show the full shared history instead
// of just what happened to be recorded against this one login.
function participantSiblingIds_(userId) {
  var all = getAll('Participants');
  var myKeys = {};
  all.forEach(function (pt) { if (pt.userId === userId) myKeys[participantLocationKey_(pt)] = true; });
  return all.filter(function (pt) { return myKeys[participantLocationKey_(pt)]; }).map(function (pt) { return pt.id; });
}

// REQ follow-up: a vendor with two shift accounts must appear (and count) as ONE vendor everywhere
// it's listed -- the Participants tab, the Resolutions "participant" dropdown, and the live
// inspection's choose-participant screen -- not once per account. Collapses every Participant row
// sharing the same physical spot (see participantLocationKey_) down to one entry: the earliest-
// created row at that spot ("primary" -- its id is what inspection results/findings get recorded
// against from here on, and what any bulk edit is applied to), tagged with participantAccountIds so
// callers that need every linked account (see participantAccountIds_ below) still can. Order-
// preserving: primaries come out in the same relative order they first appeared in `list`.
function mergeParticipantsByLocation_(list) {
  var groups = {};
  var order = [];
  list.forEach(function (p) {
    var key = participantLocationKey_(p);
    if (!groups[key]) { groups[key] = { primary: p, accountIds: [p.id] }; order.push(key); }
    else { groups[key].accountIds.push(p.id); }
  });
  return order.map(function (key) {
    var g = groups[key];
    return Object.assign({}, g.primary, { participantAccountIds: g.accountIds });
  });
}

// Inverse of mergeParticipantsByLocation_, keyed by a single participant id instead of a whole list --
// every Participant id (participantId itself included) that shares its physical spot, i.e. every
// shift account at that vendor. Used to aggregate/look up inspection results and coverage across all
// of a vendor's accounts even though only the primary id is ever shown or recorded against going
// forward, so pre-merge history recorded under a non-primary account still counts.
function participantAccountIds_(participantId) {
  var target = getById('Participants', participantId);
  if (!target) return [participantId];
  var key = participantLocationKey_(target);
  return getAll('Participants').filter(function (p) { return participantLocationKey_(p) === key; }).map(function (p) { return p.id; });
}

// REQ bug report: when a finding was logged, its participant (vendor/operator/exhibitor) never got
// notified -- only Event Manager/EMC/GA/PM (see eventStakeholderIds_ in Notifications.gs). This
// resolves a single Participant id to every Users id that can act on it: every shift account at that
// physical spot (participantAccountIds_), same reasoning as participantSiblingIds_ -- whichever
// shift is logged in when the finding is raised must be notified, not just whichever account the
// finding happens to be recorded against.
function participantAccountUserIds_(participantId) {
  if (!participantId) return [];
  return participantAccountIds_(participantId)
    .map(function (id) { var p = getById('Participants', id); return p && p.userId; })
    .filter(Boolean);
}

// Same venue + name + type + zone + coordinates + linked account -- an exact copy, not just the
// same brand at a different spot in the venue (e.g. two separate "Baskin Robbins" kiosks in
// different zones are legitimate, not duplicates) AND not the same vendor's second account (e.g.
// separate morning/afternoon shift staff provisioned via addPlaceAccount/"add another account" in
// Places.gs -- each gets its own Participant row with a different userId on purpose, so each shift's
// risk-logging responses route to the right login; those must never be treated as duplicates even
// though the name/type/zone/coordinates all match). Only flag it when literally everything,
// including which account it's linked to, matches.
function participantDupKey_(p) {
  return String(p.venueId || '') + '|' + String(p.name || '').trim().toLowerCase() + '|' + String(p.type || '') + '|' +
    String(p.zoneId || '') + '|' + String(p.lat || '') + '|' + String(p.lng || '') + '|' + String(p.userId || '');
}

// Cleanup for accidental duplicate Participants (e.g. a double form submission) -- REQ bug report:
// the live inspection map's participant list showed the same vendor at the same distance twice.
// Scoped to one venue at a time (matches the "Remove duplicates" button on that venue's Participants
// tab) rather than scanning every venue in the system. Only removes a duplicate that's never been
// referenced by an InspectionResults or Findings row -- one that already has recorded history is
// left alone (and counted in skippedWithHistory) rather than silently destroying data an inspector
// already logged against it; merging two histories needs a human decision, not an automatic one.
function dedupeParticipants(user, p) {
  requirePermission(user, 'participant.dedupe');
  var referencedIds = {};
  getAll('InspectionResults').forEach(function (r) { if (r.participantId) referencedIds[r.participantId] = true; });
  getAll('Findings').forEach(function (f) { if (f.participantId) referencedIds[f.participantId] = true; });

  var seen = {};
  var toDelete = [];
  var skipped = 0;
  getAll('Participants')
    .filter(function (pt) { return !p || !p.venueId || pt.venueId === p.venueId; })
    .forEach(function (pt) {
      var key = participantDupKey_(pt);
      if (!seen[key]) { seen[key] = pt.id; return; }
      if (referencedIds[pt.id]) { skipped++; return; }
      toDelete.push(pt.id);
    });
  toDelete.forEach(function (id) { deleteRow('Participants', id); });
  if (toDelete.length) audit(user.id, 'DEDUPE_PARTICIPANTS', 'Participants', '', { venueId: p && p.venueId, removed: toDelete.length, skipped: skipped });
  return { removed: toDelete.length, skippedWithHistory: skipped };
}
