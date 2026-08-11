/**
 * HULUL - Resolutions.gs  (REQ-RES, Section 2.5 escalation constraint)
 * Participant submits resolution evidence -> Inspector reviews (approve/reject) ->
 * on approve the Finding is Resolved; on reject it re-opens. Escalation tiers fire strictly
 * in sequence via a time-driven trigger (Setup.gs installs scheduledEscalationCheck every 30 min).
 *
 * submitResolution/reviewResolution used to live here as the only way to submit/review a
 * resolution (picking any finding from a dropdown, no evidence required, no status-transition
 * rules). They've been superseded by Findings.gs's resolveFinding/reviewFindingResolution, which
 * drive the full Risk Logging status workflow (Open -> Viewed -> Submitted -> InReview -> ...) from
 * the finding's own detail page and enforce the camera-evidence + rejection-remarks requirements --
 * removed here (and their Code.gs routes) so there's exactly one way to submit/review a resolution.
 */

function listResolutions(user, p) {
  var all = getAll('Resolutions');
  if (p && p.findingId) all = all.filter(function (r) { return r.findingId === p.findingId; });
  return all.sort(function (a, b) { return new Date(b.submittedAt) - new Date(a.submittedAt); });
}

// Manual escalation entry (admin/PM override) — the normal path is the automatic engine below.
function createEscalation(user, p) {
  requireRole(user, [ROLES.SYSTEM_ADMIN, ROLES.INSPECTION_ADMIN, ROLES.PROJECT_MANAGER]);
  var finding = getById('Findings', p.findingId);
  if (!finding) throw new HululError('NOT_FOUND', 'Finding not found');
  if (['1', '2', '3'].indexOf(String(p.tier)) === -1) throw new HululError('BAD_REQUEST', 'tier must be 1, 2, or 3');
  var row = { id: newId('Escalations'), findingId: p.findingId, tier: p.tier, triggeredAt: nowIso_(), recipientUserId: p.recipientUserId || '', resolvedAt: '' };
  insertRow('Escalations', row);
  audit(user.id, 'MANUAL_ESCALATION', 'Findings', p.findingId, { tier: p.tier });
  if (p.recipientUserId) notify_(p.recipientUserId, 'ESCALATION_TIER_' + p.tier, 'Finding manually escalated to Tier ' + p.tier + ': ' + (finding.description || finding.category || finding.id), 'Findings', p.findingId, finding.eventId);
  return row;
}

function listEscalations(user, p) {
  var all = getAll('Escalations');
  if (p && p.findingId) all = all.filter(function (e) { return e.findingId === p.findingId; });
  if (p && p.eventId) {
    var findingIds = findWhere('Findings', function (f) { return f.eventId === p.eventId; }).map(function (f) { return f.id; });
    all = all.filter(function (e) { return findingIds.indexOf(e.findingId) !== -1; });
  }
  return all.sort(function (a, b) { return new Date(b.triggeredAt) - new Date(a.triggeredAt); });
}

// ---- Escalation engine ------------------------------------------------
// Tier 1 = Event Manager, fires once Finding.resolutionWindowAt has lapsed and it's still unresolved.
// Tier 2 = EMC Manager, fires `escalationTier2DelayHours` after Tier 1 triggers, if still unresolved.
// Tier 3 = GA, fires `escalationTier3DelayHours` after Tier 2 triggers, if still unresolved.
// Tiers strictly sequential: a later tier can never fire before the earlier tier's own trigger time (Section 2.5).
function runEscalationCheck(user) {
  if (user) requireRole(user, [ROLES.SYSTEM_ADMIN, ROLES.PROJECT_MANAGER, ROLES.INSPECTION_ADMIN]);
  var openFindings = findWhere('Findings', function (f) { return FINDING_OPEN_STATUSES.indexOf(f.status) !== -1; });
  var tier2Delay = Number(getConfig('escalationTier2DelayHours', 24));
  var tier3Delay = Number(getConfig('escalationTier3DelayHours', 48));
  var now = new Date();
  var triggered = [];

  openFindings.forEach(function (finding) {
    if (!finding.resolutionWindowAt) return;
    var windowAt = new Date(finding.resolutionWindowAt);
    var escalations = findWhere('Escalations', function (e) { return e.findingId === finding.id; });
    var tier1 = escalations.filter(function (e) { return String(e.tier) === '1'; })[0];
    var tier2 = escalations.filter(function (e) { return String(e.tier) === '2'; })[0];

    if (!tier1 && now >= windowAt) {
      triggered.push(fireEscalation_(finding, 1, eventTier1Recipient_(finding.eventId)));
      return;
    }
    if (tier1 && !tier2 && now >= new Date(new Date(tier1.triggeredAt).getTime() + tier2Delay * 3600 * 1000)) {
      triggered.push(fireEscalation_(finding, 2, eventTier2Recipients_(finding.eventId)));
      return;
    }
    var tier3 = escalations.filter(function (e) { return String(e.tier) === '3'; })[0];
    if (tier1 && tier2 && !tier3 && now >= new Date(new Date(tier2.triggeredAt).getTime() + tier3Delay * 3600 * 1000)) {
      triggered.push(fireEscalation_(finding, 3, eventTier3Recipients_(finding.eventId)));
    }
  });

  return { checkedAt: now.toISOString(), triggeredCount: triggered.length, triggered: triggered };
}

function fireEscalation_(finding, tier, recipientIds) {
  var recipient = (recipientIds && recipientIds[0]) || '';
  var row = { id: newId('Escalations'), findingId: finding.id, tier: tier, triggeredAt: nowIso_(), recipientUserId: recipient, resolvedAt: '' };
  insertRow('Escalations', row);
  audit('system', 'ESCALATION_TIER_' + tier, 'Findings', finding.id, {});
  notify_(recipientIds, 'ESCALATION_TIER_' + tier, 'Finding escalated to Tier ' + tier + ': ' + (finding.description || finding.category || finding.id), 'Findings', finding.id, finding.eventId);
  return row;
}

function eventTier1Recipient_(eventId) {
  var event = getById('Events', eventId);
  return event && event.eventManagerId ? [event.eventManagerId] : [];
}
function eventTier2Recipients_(eventId) {
  var event = getById('Events', eventId);
  if (!event) return [];
  return findWhere('Users', function (u) { return u.orgId === event.emcId && u.role === ROLES.EMC_MANAGER; }).map(function (u) { return u.id; });
}
function eventTier3Recipients_(eventId) {
  return findWhere('Users', function (u) { return u.role === ROLES.GA_ADMIN || u.role === ROLES.GA_USER; }).map(function (u) { return u.id; });
}
