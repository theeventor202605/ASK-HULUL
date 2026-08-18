/**
 * HULUL - Findings.gs  (REQ-NCF, Section 3 "Non-Compliance Finding")
 * Findings are usually auto-created from a Crossed checklist item (see Inspections.gs)
 * but can also be logged directly (e.g. ad-hoc observation), and can be updated/re-opened.
 *
 * Status lifecycle (REQ workflow, Risk Logging tab -- each finding is a full page now, not a
 * popup; see findings.js on the frontend):
 *   Open        -- Inspector just raised it.
 *   Viewed      -- the Participant it's against has opened the log (auto, on first view).
 *   Submitted   -- Participant submitted a resolution: remarks + a camera photo/video (see
 *                  resolveFinding). Camera-only is enforced client-side (capture="environment",
 *                  no plain file picker) -- same pattern as the Record Results evidence field.
 *   InReview    -- Inspector/PM/SysAdmin opened a Submitted/Resubmitted log (auto, on view).
 *   Resolved    -- Inspector accepted the resolution (terminal, success).
 *   ReOpen      -- Inspector rejected the FIRST resolution attempt (rejection remarks required).
 *                  Participant can resubmit from here.
 *   Resubmitted -- Participant resubmitted (2nd photo + remarks) after a ReOpen.
 *   Rejected    -- Inspector rejected the SECOND resolution attempt (terminal, no further
 *                  participant action from the app -- needs manual/escalated follow-up).
 * reopenCount on the Findings row tracks how many times a resolution has been rejected, so
 * reviewFindingResolution knows whether a fresh rejection should land on ReOpen (first time) or
 * Rejected (second time, terminal) without needing a separate review-cycle table.
 */

var FINDING_STATUSES = ['Open', 'Viewed', 'Submitted', 'InReview', 'Resolved', 'ReOpen', 'Resubmitted', 'Rejected'];
// "Still outstanding" -- everything except the two terminal states. Used by the escalation engine
// (Resolutions.gs runEscalationCheck) so a finding stuck mid-workflow (e.g. Viewed but never
// resolved, or ReOpen but never resubmitted) still escalates once its resolutionWindowAt lapses.
var FINDING_OPEN_STATUSES = ['Open', 'Viewed', 'Submitted', 'InReview', 'ReOpen', 'Resubmitted'];
// REQ (Risk Logging list, follow-up): "Actions (Allow edit and delete if not submitted)." Once a
// Participant has submitted a resolution (or beyond), the finding is part of a workflow other people
// are already acting on -- editing/deleting it out from under that would be confusing at best and
// destroy review history at worst. "Not submitted yet" = still Open or Viewed.
var FINDING_EDITABLE_STATUSES_ = ['Open', 'Viewed'];

function findingVisibleTo_(user, finding) {
  // BUG FIX: was a hardcoded VENDOR/OPERATOR/EXHIBITOR check -- a self-served custom Place/
  // Participant type (e.g. "Facilities", Settings > Roles > isParticipantType) fell through to the
  // "sees everything" branch below instead of being scoped to its own Participant record, unlike
  // EventChat.gs/Resolutions.gs which already used isParticipantRoleCode_ for this. Now consistent.
  if (isParticipantRoleCode_(user.role)) {
    // Shared across every account/shift at the same physical spot -- see participantSiblingIds_.
    return participantSiblingIds_(user.id).indexOf(finding.participantId) !== -1;
  }
  return true; // every non-participant role currently sees every finding on events it can already reach
}

// Adds display-only fields the frontend needs but the raw Findings row doesn't carry: the
// participant's and discipline's names (participantId/disciplineId alone mean nothing in the UI),
// and evidenceUrls turned into a real array instead of the raw comma-joined string the sheet stores.
// checklistItemsById (optional) -- REQ: "Any log created through a checklist must be traceable to
// that specific item in the checklist" -- resolves checklistItemId into a readable description.
function enrichFinding_(f, participantsById, disciplinesById, checklistItemsById) {
  var pt = participantsById[f.participantId];
  var d = disciplinesById[f.disciplineId];
  var item = checklistItemsById && f.checklistItemId ? checklistItemsById[f.checklistItemId] : null;
  return Object.assign({}, f, {
    participantName: pt ? pt.name : '',
    disciplineName: d ? d.name : '',
    checklistItemDescription: item ? item.description : '',
    evidenceUrls: f.evidenceUrls ? String(f.evidenceUrls).split(',').filter(Boolean) : []
  });
}

function listFindings(user, p) {
  var all = getAll('Findings');
  if (p && p.eventId) all = all.filter(function (f) { return f.eventId === p.eventId; });
  if (p && p.status) all = all.filter(function (f) { return f.status === p.status; });
  if (p && p.disciplineId) all = all.filter(function (f) { return f.disciplineId === p.disciplineId; });
  if (isParticipantRoleCode_(user.role)) { // BUG FIX: see findingVisibleTo_'s comment above
    // Shared across every account/shift at the same physical spot (see participantSiblingIds_ in
    // Participants.gs) -- not just this exact login's own Participant row, so a finding recorded
    // against the morning shift is still visible (and resolvable) to the afternoon shift before its
    // resolution window lapses.
    var myParticipantIds = participantSiblingIds_(user.id);
    all = all.filter(function (f) { return myParticipantIds.indexOf(f.participantId) !== -1; });
  }
  var participantsById = {};
  getAll('Participants').forEach(function (pt) { participantsById[pt.id] = pt; });
  var disciplinesById = {};
  getAll('Disciplines').forEach(function (d) { disciplinesById[d.id] = d; });
  var checklistItemsById = {};
  getAll('ChecklistItems').forEach(function (ci) { checklistItemsById[ci.id] = ci; });
  all = all.map(function (f) { return enrichFinding_(f, participantsById, disciplinesById, checklistItemsById); });
  return all.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
}

// REQ: "Log finding must be tied to a participant. Participant must first be selected... Discipline
// ... is a mandatory field... Remove location and sub-zone." participantId/disciplineId are now
// required inputs (previously optional); subZone/location/lat/lng are no longer collected directly
// from the inspector on the manual Log Finding form at all -- they're derived from the selected
// Participant's own record instead (p.subZone/p.location/p.lat/p.lng are still honored if a future
// caller supplies them explicitly, so this stays backward compatible). Note: the auto-created-from-
// checklist-crossing path (recordInspectionResults, Inspections.gs) builds its own Findings row
// directly via insertRow and does NOT go through createFinding, so it's unaffected by any of this.
function createFinding(user, p) {
  requirePermission(user, 'finding.create');
  ['eventId', 'description', 'riskLevel', 'participantId', 'disciplineId'].forEach(function (f) { if (!p[f]) throw new HululError('BAD_REQUEST', f + ' is required'); });
  var participant = getById('Participants', p.participantId);
  if (!participant) throw new HululError('NOT_FOUND', 'Participant not found');
  var zone = participant.zoneId ? getById('Zones', participant.zoneId) : null;
  var windowHours = p.resolutionWindowHours || 24;
  var finding = {
    id: newId('Findings'), eventId: p.eventId, inspectionId: p.inspectionId || '', disciplineId: p.disciplineId,
    // REQ: "Checklist Type: should be picked if left blank it will reflect as Other."
    category: p.category || 'Other', subCategory: p.subCategory || '', description: p.description,
    suggestedAction: p.suggestedAction || '', riskLevel: p.riskLevel,
    resolutionWindowAt: new Date(Date.now() + Number(windowHours) * 3600 * 1000).toISOString(),
    nextInspectionAt: p.nextInspectionAt || '', participantId: p.participantId,
    subZone: p.subZone || (zone ? zone.name : ''), location: p.location || participant.location || '',
    status: 'Open', evidenceUrls: (p.evidenceUrls || []).join(','),
    lat: p.lat || participant.lat || '', lng: p.lng || participant.lng || '', createdBy: user.id, createdAt: nowIso_(), reopenCount: 0,
    // Manually-logged findings (this path) have no single checklist item to point at -- only the
    // auto-created-from-a-Crossed-item path (recordInspectionResults, Inspections.gs) sets
    // checklistItemId. p.checklistItemId is still honored if a future caller supplies one explicitly.
    checklistItemId: p.checklistItemId || '', recreatedFromId: ''
  };
  insertRow('Findings', finding);
  audit(user.id, 'CREATE_FINDING', 'Findings', finding.id, {});
  notifyFindingCreated_(finding);
  return finding;
}

function updateFinding(user, p) {
  var finding = getById('Findings', p.findingId);
  if (!finding) throw new HululError('NOT_FOUND', 'Finding not found');
  requirePermission(user, 'finding.edit');
  // REQ (Risk Logging list, follow-up): "Allow edit ... if not submitted." A resolution already in
  // flight (or further along) means someone else is already acting on this finding as it stands --
  // see FINDING_EDITABLE_STATUSES_ above.
  if (FINDING_EDITABLE_STATUSES_.indexOf(finding.status) === -1) {
    throw new HululError('FORBIDDEN', 'This finding has already been submitted and can no longer be edited');
  }
  var patch = {};
  // status is deliberately NOT patchable here -- it only moves through the workflow actions below
  // (viewFinding / resolveFinding / reviewFindingResolution), each of which enforces its own
  // valid-from-status + role + evidence/remarks rules that a raw status edit would bypass.
  ['description', 'suggestedAction', 'riskLevel', 'subZone', 'location', 'participantId', 'disciplineId', 'category', 'subCategory'].forEach(function (f) {
    if (p[f] !== undefined) patch[f] = p[f];
  });
  var updated = updateRow('Findings', p.findingId, patch);
  audit(user.id, 'UPDATE_FINDING', 'Findings', p.findingId, patch);
  return updated;
}

// REQ (Risk Logging list, follow-up): "Actions (Allow edit and delete if not submitted)." Same
// not-yet-submitted gate as updateFinding above. Findings that have already moved past Open/Viewed
// have review/resolution history hanging off them (Resolutions rows) -- deleting those out from under
// that history would orphan it, so this simply refuses rather than trying to cascade-delete.
function deleteFinding(user, p) {
  var finding = getById('Findings', p.findingId);
  if (!finding) throw new HululError('NOT_FOUND', 'Finding not found');
  requirePermission(user, 'finding.delete');
  if (FINDING_EDITABLE_STATUSES_.indexOf(finding.status) === -1) {
    throw new HululError('FORBIDDEN', 'This finding has already been submitted and can no longer be deleted');
  }
  deleteRow('Findings', p.findingId);
  audit(user.id, 'DELETE_FINDING', 'Findings', p.findingId, {});
  return { deleted: true };
}

// REQ: "Log findings while photo is uploading in the background." createFinding no longer waits for
// every evidence file to finish uploading before the frontend submits -- it's called immediately with
// whatever's already done, and each remaining file calls this once its own upload finishes (see
// attachFindingEvidenceInBackground_, findings.js) to append itself onto the now-already-created
// Finding. Append-only and de-duped (a retried/duplicate call with the same URL is a harmless no-op)
// -- never replaces the existing list, unlike updateFinding's other patchable fields.
function addFindingEvidence(user, p) {
  var finding = getById('Findings', p.findingId);
  if (!finding) throw new HululError('NOT_FOUND', 'Finding not found');
  requirePermission(user, 'finding.addEvidence');
  if (!p.evidenceUrl) throw new HululError('BAD_REQUEST', 'evidenceUrl is required');
  var urls = finding.evidenceUrls ? String(finding.evidenceUrls).split(',').filter(Boolean) : [];
  if (urls.indexOf(p.evidenceUrl) === -1) urls.push(p.evidenceUrl);
  var updated = updateRow('Findings', p.findingId, { evidenceUrls: urls.join(',') });
  audit(user.id, 'ADD_FINDING_EVIDENCE', 'Findings', p.findingId, {});
  return updated;
}

// Fetches one finding for its detail page, auto-advancing status on view exactly at the two points
// the process flow calls for:
//  - a Participant's first open of an Open finding -> Viewed
//  - an Inspector/PM/SysAdmin's first open of a Submitted/Resubmitted finding -> InReview
// Any other view (re-opening something already Viewed/InReview/Resolved/etc, or an Inspector just
// browsing an Open finding nothing's been submitted for yet) leaves status untouched. Also returns
// the finding's resolution history (newest first) so the detail page can show every past attempt.
function viewFinding(user, p) {
  if (!p || !p.findingId) throw new HululError('BAD_REQUEST', 'findingId is required');
  var finding = getById('Findings', p.findingId);
  if (!finding) throw new HululError('NOT_FOUND', 'Finding not found');
  if (!findingVisibleTo_(user, finding)) throw new HululError('FORBIDDEN', 'Not your finding');

  var isParticipant = isParticipantRoleCode_(user.role); // BUG FIX: see findingVisibleTo_'s comment above
  var isReviewer = user.role === ROLES.INSPECTOR || user.role === ROLES.PROJECT_MANAGER || user.role === ROLES.SYSTEM_ADMIN;
  if (isParticipant && finding.status === 'Open') {
    finding = updateRow('Findings', p.findingId, { status: 'Viewed' });
    audit(user.id, 'VIEW_FINDING', 'Findings', p.findingId, { status: 'Viewed' });
  } else if (isReviewer && (finding.status === 'Submitted' || finding.status === 'Resubmitted')) {
    finding = updateRow('Findings', p.findingId, { status: 'InReview' });
    audit(user.id, 'VIEW_FINDING', 'Findings', p.findingId, { status: 'InReview' });
  }

  var participantsById = {};
  getAll('Participants').forEach(function (pt) { participantsById[pt.id] = pt; });
  var disciplinesById = {};
  getAll('Disciplines').forEach(function (d) { disciplinesById[d.id] = d; });
  var resolutions = findWhere('Resolutions', function (r) { return r.findingId === p.findingId; })
    .map(function (r) { return Object.assign({}, r, { evidenceUrls: r.evidenceUrls ? String(r.evidenceUrls).split(',').filter(Boolean) : [] }); })
    .sort(function (a, b) { return new Date(b.submittedAt) - new Date(a.submittedAt); });

  var checklistItemsById = {};
  getAll('ChecklistItems').forEach(function (ci) { checklistItemsById[ci.id] = ci; });
  var enriched = enrichFinding_(finding, participantsById, disciplinesById, checklistItemsById);

  // REQ: "A second rejection lands on Rejected ... but automatically creates a new instance from the
  // rejected log and lands it in Open." Surface BOTH directions of that link on the detail page: the
  // original (this finding, if it has one) it was recreated from, and -- the reverse, only knowable
  // by searching -- the newer finding it was recreated INTO, if this one is the rejected original.
  // A single reverse lookup on one finding's detail view is cheap; deliberately not done in bulk
  // listFindings (would be an O(n) scan per row there).
  if (finding.recreatedFromId) {
    var original = getById('Findings', finding.recreatedFromId);
    if (original) enriched.recreatedFrom = { id: original.id, description: original.description, status: original.status };
  }
  var recreatedInto = findWhere('Findings', function (f) { return f.recreatedFromId === finding.id; })
    .sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); })[0];
  if (recreatedInto) enriched.recreatedInto = { id: recreatedInto.id, description: recreatedInto.description, status: recreatedInto.status };

  return { finding: enriched, resolutions: resolutions };
}

// REQ workflow steps 3/7: Participant submits a resolution -- free-text remarks + at least one
// camera-captured photo/video (evidence requirement enforced here as well as client-side, same
// pattern as recordInspectionResults). Only valid from Viewed (first attempt) or ReOpen (retry after
// a first rejection) -- Open (not viewed yet), Submitted/InReview/Resubmitted (already has a pending
// resolution), and Resolved/Rejected (terminal) can't be resolved from here.
function resolveFinding(user, p) {
  requirePermission(user, 'finding.resolve');
  if (!p || !p.findingId) throw new HululError('BAD_REQUEST', 'findingId is required');
  var finding = getById('Findings', p.findingId);
  if (!finding) throw new HululError('NOT_FOUND', 'Finding not found');
  if (!findingVisibleTo_(user, finding)) throw new HululError('FORBIDDEN', 'Not your finding');
  if (['Viewed', 'ReOpen'].indexOf(finding.status) === -1) {
    throw new HululError('BAD_REQUEST', 'This finding cannot be resolved from its current status (' + finding.status + ')');
  }
  if (!p.remarks) throw new HululError('BAD_REQUEST', 'Remarks are required');
  if (!p.evidenceUrls || !p.evidenceUrls.length) throw new HululError('BAD_REQUEST', 'A photo or video of the resolution is required');

  var resolution = {
    id: newId('Resolutions'), findingId: p.findingId, participantId: finding.participantId,
    evidenceUrls: p.evidenceUrls.join(','), remarks: p.remarks, submittedAt: nowIso_(),
    reviewedBy: '', decision: 'Pending', comments: '', reviewedAt: ''
  };
  insertRow('Resolutions', resolution);
  var newStatus = finding.status === 'ReOpen' ? 'Resubmitted' : 'Submitted';
  updateRow('Findings', p.findingId, { status: newStatus });
  audit(user.id, 'RESOLVE_FINDING', 'Findings', p.findingId, { status: newStatus });
  notifyFindingStatusChange_(getById('Findings', p.findingId), newStatus);
  return { finding: getById('Findings', p.findingId), resolution: resolution };
}

// REQ workflow steps 5/6/8: Inspector/PM/SysAdmin accepts or rejects the latest pending resolution.
// Only valid from InReview. Accept -> Resolved (terminal). Reject requires rejection remarks; the
// first rejection on a finding -> ReOpen (participant can retry), the second -> Rejected (terminal)
// -- tracked via reopenCount (see module header comment).
function reviewFindingResolution(user, p) {
  requirePermission(user, 'finding.review');
  if (!p || !p.findingId) throw new HululError('BAD_REQUEST', 'findingId is required');
  var finding = getById('Findings', p.findingId);
  if (!finding) throw new HululError('NOT_FOUND', 'Finding not found');
  if (finding.status !== 'InReview') throw new HululError('BAD_REQUEST', 'This finding is not awaiting review');
  if (['Approved', 'Rejected'].indexOf(p.decision) === -1) throw new HululError('BAD_REQUEST', 'decision must be Approved or Rejected');
  if (p.decision === 'Rejected' && !p.comments) throw new HululError('BAD_REQUEST', 'Rejection remarks are required');

  var pending = findWhere('Resolutions', function (r) { return r.findingId === p.findingId && r.decision === 'Pending'; })
    .sort(function (a, b) { return new Date(b.submittedAt) - new Date(a.submittedAt); })[0];
  if (!pending) throw new HululError('BAD_REQUEST', 'No pending resolution to review');

  updateRow('Resolutions', pending.id, { decision: p.decision, reviewedBy: user.id, comments: p.comments || '', reviewedAt: nowIso_() });

  var reopenCount = Number(finding.reopenCount) || 0;
  var newStatus;
  if (p.decision === 'Approved') {
    newStatus = 'Resolved';
  } else {
    newStatus = reopenCount === 0 ? 'ReOpen' : 'Rejected';
    reopenCount++;
  }
  updateRow('Findings', p.findingId, { status: newStatus, reopenCount: reopenCount });

  var recreatedFinding = null;
  if (newStatus === 'Resolved' || newStatus === 'Rejected') {
    // Clear any open escalation recipients tracking (resolvedAt on escalations) -- both terminal
    // outcomes mean THIS finding row is done escalating; Rejected's replacement (below) starts its
    // own fresh escalation clock as a brand-new Finding rather than inheriting the old one's.
    findWhere('Escalations', function (e) { return e.findingId === p.findingId && !e.resolvedAt; })
      .forEach(function (e) { updateRow('Escalations', e.id, { resolvedAt: nowIso_() }); });
  }

  if (newStatus === 'Rejected') {
    // REQ: "A second rejection lands on Rejected, which is terminal, but automatically creates a new
    // instance from the rejected log and lands it in Open." Rejected means THIS resolution thread is
    // exhausted (2 failed attempts), not that the underlying compliance issue is closed -- so a fresh
    // Finding carries it forward with a clean slate (Open, no resolution history yet, its own new
    // resolution deadline) while this row stays Rejected forever as the permanent record of what
    // happened. Linked both ways via recreatedFromId (see viewFinding's recreatedFrom/recreatedInto
    // enrichment, which resolves the reverse direction by lookup).
    var srcItem = finding.checklistItemId ? getById('ChecklistItems', finding.checklistItemId) : null;
    var windowHours = srcItem ? srcItem.defaultWindowHours : 24;
    recreatedFinding = {
      id: newId('Findings'), eventId: finding.eventId, inspectionId: finding.inspectionId, disciplineId: finding.disciplineId,
      category: finding.category, subCategory: finding.subCategory, description: finding.description,
      suggestedAction: finding.suggestedAction, riskLevel: finding.riskLevel,
      resolutionWindowAt: new Date(Date.now() + Number(windowHours) * 3600 * 1000).toISOString(),
      nextInspectionAt: finding.nextInspectionAt || '', participantId: finding.participantId,
      subZone: finding.subZone, location: finding.location, status: 'Open', evidenceUrls: '',
      lat: finding.lat, lng: finding.lng, createdBy: finding.createdBy, createdAt: nowIso_(), reopenCount: 0,
      checklistItemId: finding.checklistItemId || '', recreatedFromId: finding.id
    };
    insertRow('Findings', recreatedFinding);
    audit(user.id, 'AUTO_RECREATE_FINDING', 'Findings', recreatedFinding.id, { recreatedFromId: finding.id });
    notifyFindingCreated_(recreatedFinding);
  }

  audit(user.id, 'REVIEW_FINDING_RESOLUTION', 'Findings', p.findingId, { decision: p.decision, status: newStatus });
  var updated = getById('Findings', p.findingId);
  notifyFindingStatusChange_(updated, newStatus);
  return { finding: updated, resolution: getById('Resolutions', pending.id), recreatedFinding: recreatedFinding };
}

// Groups findings into the 5 summary buckets the Dashboard/Overview KPI cards already have icons for
// (kpi_open/kpi_inreview/kpi_resolved/kpi_reopen/kpi_rejected) -- Viewed rolls into "open" (still
// nobody's submitted a resolution) and Submitted/Resubmitted roll into "in review" (something's
// pending someone's action), so the fuller 8-status workflow doesn't need 3 more KPI cards to stay
// accurate. Used by Events.gs getEventDetail and Reports.gs dashboardSummary.
function findingKpiBuckets_(findings) {
  var count = function (statuses) { return findings.filter(function (f) { return statuses.indexOf(f.status) !== -1; }).length; };
  return {
    total: findings.length,
    open: count(['Open', 'Viewed']),
    inReview: count(['InReview', 'Submitted', 'Resubmitted']),
    resolved: count(['Resolved']),
    reopen: count(['ReOpen']),
    rejected: count(['Rejected'])
  };
}
