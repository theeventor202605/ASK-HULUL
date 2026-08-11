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

function findingVisibleTo_(user, finding) {
  if (user.role === ROLES.VENDOR || user.role === ROLES.OPERATOR || user.role === ROLES.EXHIBITOR) {
    // Shared across every account/shift at the same physical spot -- see participantSiblingIds_.
    return participantSiblingIds_(user.id).indexOf(finding.participantId) !== -1;
  }
  return true; // every non-participant role currently sees every finding on events it can already reach
}

// Adds display-only fields the frontend needs but the raw Findings row doesn't carry: the
// participant's and discipline's names (participantId/disciplineId alone mean nothing in the UI),
// and evidenceUrls turned into a real array instead of the raw comma-joined string the sheet stores.
function enrichFinding_(f, participantsById, disciplinesById) {
  var pt = participantsById[f.participantId];
  var d = disciplinesById[f.disciplineId];
  return Object.assign({}, f, {
    participantName: pt ? pt.name : '',
    disciplineName: d ? d.name : '',
    evidenceUrls: f.evidenceUrls ? String(f.evidenceUrls).split(',').filter(Boolean) : []
  });
}

function listFindings(user, p) {
  var all = getAll('Findings');
  if (p && p.eventId) all = all.filter(function (f) { return f.eventId === p.eventId; });
  if (p && p.status) all = all.filter(function (f) { return f.status === p.status; });
  if (p && p.disciplineId) all = all.filter(function (f) { return f.disciplineId === p.disciplineId; });
  if (user.role === ROLES.VENDOR || user.role === ROLES.OPERATOR || user.role === ROLES.EXHIBITOR) {
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
  all = all.map(function (f) { return enrichFinding_(f, participantsById, disciplinesById); });
  return all.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
}

function createFinding(user, p) {
  requireRole(user, [ROLES.INSPECTOR, ROLES.PROJECT_MANAGER, ROLES.SYSTEM_ADMIN]);
  ['eventId', 'description', 'riskLevel'].forEach(function (f) { if (!p[f]) throw new HululError('BAD_REQUEST', f + ' is required'); });
  var windowHours = p.resolutionWindowHours || 24;
  var finding = {
    id: newId('Findings'), eventId: p.eventId, inspectionId: p.inspectionId || '', disciplineId: p.disciplineId || '',
    category: p.category || '', subCategory: p.subCategory || '', description: p.description,
    suggestedAction: p.suggestedAction || '', riskLevel: p.riskLevel,
    resolutionWindowAt: new Date(Date.now() + Number(windowHours) * 3600 * 1000).toISOString(),
    nextInspectionAt: p.nextInspectionAt || '', participantId: p.participantId || '', subZone: p.subZone || '',
    location: p.location || '', status: 'Open', evidenceUrls: (p.evidenceUrls || []).join(','),
    lat: p.lat || '', lng: p.lng || '', createdBy: user.id, createdAt: nowIso_(), reopenCount: 0
  };
  insertRow('Findings', finding);
  audit(user.id, 'CREATE_FINDING', 'Findings', finding.id, {});
  notifyFindingCreated_(finding);
  return finding;
}

function updateFinding(user, p) {
  var finding = getById('Findings', p.findingId);
  if (!finding) throw new HululError('NOT_FOUND', 'Finding not found');
  requireRole(user, [ROLES.INSPECTOR, ROLES.PROJECT_MANAGER, ROLES.SYSTEM_ADMIN]);
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

  var isParticipant = user.role === ROLES.VENDOR || user.role === ROLES.OPERATOR || user.role === ROLES.EXHIBITOR;
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
  return { finding: enrichFinding_(finding, participantsById, disciplinesById), resolutions: resolutions };
}

// REQ workflow steps 3/7: Participant submits a resolution -- free-text remarks + at least one
// camera-captured photo/video (evidence requirement enforced here as well as client-side, same
// pattern as recordInspectionResults). Only valid from Viewed (first attempt) or ReOpen (retry after
// a first rejection) -- Open (not viewed yet), Submitted/InReview/Resubmitted (already has a pending
// resolution), and Resolved/Rejected (terminal) can't be resolved from here.
function resolveFinding(user, p) {
  requireRole(user, [ROLES.VENDOR, ROLES.OPERATOR, ROLES.EXHIBITOR]);
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
  requireRole(user, [ROLES.INSPECTOR, ROLES.PROJECT_MANAGER, ROLES.SYSTEM_ADMIN]);
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

  if (newStatus === 'Resolved') {
    // Clear any open escalation recipients tracking (resolvedAt on escalations).
    findWhere('Escalations', function (e) { return e.findingId === p.findingId && !e.resolvedAt; })
      .forEach(function (e) { updateRow('Escalations', e.id, { resolvedAt: nowIso_() }); });
  }
  audit(user.id, 'REVIEW_FINDING_RESOLUTION', 'Findings', p.findingId, { decision: p.decision, status: newStatus });
  var updated = getById('Findings', p.findingId);
  notifyFindingStatusChange_(updated, newStatus);
  return { finding: updated, resolution: getById('Resolutions', pending.id) };
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
