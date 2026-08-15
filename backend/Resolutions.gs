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

// REQ: "the below can be switched off from settings" + "modify escalation timer in hours and
// minutes" + "modify the To user role and the Cc: user roles" + risk-level-scoped Tier 2/3 delays.
// One structured config object (stored as a single JSON blob under Config key
// 'escalationSettings', via getConfigJson_/setConfigJson_ -- same "JSON in one Config cell"
// convention OrgLabels/AppIcons already use) instead of a pile of individual Config rows, so
// reading/writing it is always atomic and the frontend gets/sends one coherent shape.
//
// Shape:
//   { tier1: {toRoles:[...], ccRoles:[...]},
//     tier2: {toRoles:[...], ccRoles:[...], delayMinutesByRisk:{Low,Medium,High,Critical}},
//     tier3: {toRoles:[...], ccRoles:[...], delayMinutesByRisk:{Low,Medium,High,Critical}},
//     lockScreenEnabled: true }
//
// Tier 1 has no delayMinutesByRisk -- REQ (clarified): each Finding already carries its own
// resolution deadline via its checklist item's "default resolution window" (Findings.resolutionWindowAt),
// and that per-item timer is what decides when Tier 1 fires; only Tier 2 and Tier 3's delays became
// admin-editable here. Defaults below exactly match the previous hardcoded behavior (Tier
// 1=EventManager, Tier 2=EMCManager/24h flat, Tier 3=GAAdmin+GAUser/48h flat) so nothing changes
// for an org that's never touched this setting.
var RISK_LEVELS_ = ['Low', 'Medium', 'High', 'Critical'];
var ESCALATION_CONFIG_KEY_ = 'escalationSettings';

function escalationDefaultDelayMinutesByRisk_(legacyHoursConfigKey, legacyDefaultHours) {
  // Falls back to the old flat escalationTier2/3DelayHours Config key if it was ever set (so an
  // org that already customized the old single hour value keeps that behavior for every risk
  // level until they explicitly set per-level values), then to the hardcoded default.
  var legacyHours = Number(getConfig(legacyHoursConfigKey, legacyDefaultHours));
  var minutes = (isNaN(legacyHours) ? legacyDefaultHours : legacyHours) * 60;
  var byRisk = {};
  RISK_LEVELS_.forEach(function (level) { byRisk[level] = minutes; });
  return byRisk;
}

// Public, dispatched route (Settings panel read) -- role-gated. Internal callers that already did
// their OWN permission check (createEscalation, runEscalationCheck below) call
// getEscalationConfig_() directly instead, so reading config for the automated 30-min trigger
// (which runs as no particular user at all) doesn't need a fake user object just to satisfy this.
function getEscalationConfig(user) {
  requireRole(user, [ROLES.SYSTEM_ADMIN]);
  var cfg = getEscalationConfig_();
  // Same "server hands back the picklist" convention as getTemplateProcessConfig (Templates.gs) --
  // the Settings panel never needs its own hardcoded copy of which roles are offerable.
  cfg.allRoles = ESCALATION_SELECTABLE_ROLES_.map(function (r) { return { value: r, label: roleLabel_(r) }; });
  cfg.riskLevels = RISK_LEVELS_;
  return cfg;
}

function getEscalationConfig_() {
  var saved = getConfigJson_(ESCALATION_CONFIG_KEY_, null);
  var defaults = {
    tier1: { toRoles: [ROLES.EVENT_MANAGER], ccRoles: [] },
    tier2: { toRoles: [ROLES.EMC_MANAGER], ccRoles: [], delayMinutesByRisk: escalationDefaultDelayMinutesByRisk_('escalationTier2DelayHours', 24) },
    tier3: { toRoles: [ROLES.GA_ADMIN, ROLES.GA_USER], ccRoles: [], delayMinutesByRisk: escalationDefaultDelayMinutesByRisk_('escalationTier3DelayHours', 48) },
    lockScreenEnabled: true
  };
  if (!saved) return defaults;
  // Shallow-merge over defaults so a config saved before a new sub-field existed (e.g. an org that
  // saved before lockScreenEnabled or a given risk level was added) still comes back complete
  // instead of throwing on a missing key elsewhere in the app.
  return {
    tier1: Object.assign({}, defaults.tier1, saved.tier1),
    tier2: Object.assign({}, defaults.tier2, saved.tier2, { delayMinutesByRisk: Object.assign({}, defaults.tier2.delayMinutesByRisk, saved.tier2 && saved.tier2.delayMinutesByRisk) }),
    tier3: Object.assign({}, defaults.tier3, saved.tier3, { delayMinutesByRisk: Object.assign({}, defaults.tier3.delayMinutesByRisk, saved.tier3 && saved.tier3.delayMinutesByRisk) }),
    lockScreenEnabled: saved.lockScreenEnabled !== undefined ? !!saved.lockScreenEnabled : defaults.lockScreenEnabled
  };
}

function setEscalationConfig(user, p) {
  requireRole(user, [ROLES.SYSTEM_ADMIN]);
  if (!p || !p.tier1 || !p.tier2 || !p.tier3) throw new HululError('BAD_REQUEST', 'tier1/tier2/tier3 are required');
  function cleanRoles_(list) {
    return Array.isArray(list) ? list.filter(function (r) { return ESCALATION_SELECTABLE_ROLES_.indexOf(r) !== -1; }) : [];
  }
  var clean = {
    tier1: { toRoles: cleanRoles_(p.tier1.toRoles), ccRoles: cleanRoles_(p.tier1.ccRoles) },
    tier2: { toRoles: cleanRoles_(p.tier2.toRoles), ccRoles: cleanRoles_(p.tier2.ccRoles), delayMinutesByRisk: {} },
    tier3: { toRoles: cleanRoles_(p.tier3.toRoles), ccRoles: cleanRoles_(p.tier3.ccRoles), delayMinutesByRisk: {} },
    lockScreenEnabled: !!p.lockScreenEnabled
  };
  if (!clean.tier1.toRoles.length || !clean.tier2.toRoles.length || !clean.tier3.toRoles.length) {
    throw new HululError('BAD_REQUEST', 'Each tier needs at least one "To" role');
  }
  RISK_LEVELS_.forEach(function (level) {
    clean.tier2.delayMinutesByRisk[level] = Math.max(1, Number((p.tier2.delayMinutesByRisk || {})[level]) || 1);
    clean.tier3.delayMinutesByRisk[level] = Math.max(1, Number((p.tier3.delayMinutesByRisk || {})[level]) || 1);
  });
  setConfigJson_(ESCALATION_CONFIG_KEY_, clean);
  audit(user.id, 'SET_ESCALATION_CONFIG', 'Config', ESCALATION_CONFIG_KEY_, clean);
  return clean;
}

// Manual escalation entry (admin/PM override) — the normal path is the automatic engine below.
// Recipients are resolved the same way an automatic escalation resolves them (configured tier
// roles), rather than picking one person by hand -- keeps manual and automatic escalations
// consistent with each other and with whatever the admin has configured in Settings.
function createEscalation(user, p) {
  requirePermission(user, 'escalation.create'); // RBAC pilot -- same default roles as before, no behavior change
  var finding = getById('Findings', p.findingId);
  if (!finding) throw new HululError('NOT_FOUND', 'Finding not found');
  if (['1', '2', '3'].indexOf(String(p.tier)) === -1) throw new HululError('BAD_REQUEST', 'tier must be 1, 2, or 3');
  var event = getById('Events', finding.eventId);
  var cfg = getEscalationConfig_()['tier' + p.tier];
  var recipients = escalationResolveRecipients_(cfg.toRoles, cfg.ccRoles, event);
  var row = fireEscalation_(finding, Number(p.tier), recipients.toUserIds, recipients.ccUserIds);
  audit(user.id, 'MANUAL_ESCALATION', 'Findings', p.findingId, { tier: p.tier });
  return row;
}

function listEscalations(user, p) {
  var all = getAll('Escalations');
  if (p && p.findingId) all = all.filter(function (e) { return e.findingId === p.findingId; });
  if (p && p.eventId) {
    var findingIds = findWhere('Findings', function (f) { return f.eventId === p.eventId; }).map(function (f) { return f.id; });
    all = all.filter(function (e) { return findingIds.indexOf(e.findingId) !== -1; });
  }
  all.sort(function (a, b) { return new Date(b.triggeredAt) - new Date(a.triggeredAt); });
  var userIds = [];
  all.forEach(function (e) {
    (e.toUserIds ? e.toUserIds.split(',').filter(Boolean) : []).forEach(function (id) { userIds.push(id); });
    (e.ccUserIds ? e.ccUserIds.split(',').filter(Boolean) : []).forEach(function (id) { userIds.push(id); });
  });
  var namesById = {};
  Array.from(new Set(userIds)).forEach(function (id) { var u = getById('Users', id); if (u) namesById[id] = u.name; });
  function idsToPeople_(csv) {
    return (csv ? csv.split(',').filter(Boolean) : []).map(function (id) { return { id: id, name: namesById[id] || id }; });
  }
  return all.map(function (e) {
    return {
      id: e.id, findingId: e.findingId, tier: e.tier, triggeredAt: e.triggeredAt, resolvedAt: e.resolvedAt,
      to: idsToPeople_(e.toUserIds), cc: idsToPeople_(e.ccUserIds),
      notedUserIds: e.notedUserIds ? e.notedUserIds.split(',').filter(Boolean) : []
    };
  });
}

// REQ: "user must click Noted" -- one entry per still-open escalation where the CURRENT user is a
// To recipient (never Cc, per REQ clarification) who hasn't Noted it yet, newest-triggered first.
// Includes just enough Finding/Event context for the lock-screen overlay to display something
// useful without a second round trip.
// Returns { lockScreenEnabled, items } rather than a bare array -- lockScreenEnabled comes from
// getEscalationConfig_() (bypassing the SystemAdmin gate on the public getEscalationConfig route)
// because ANY user with a pending escalation needs to know whether the full-screen lock is turned
// on, and most of them aren't SystemAdmin.
function listMyPendingEscalations(user) {
  var mine = findWhere('Escalations', function (e) {
    if (e.resolvedAt) return false;
    var toIds = e.toUserIds ? e.toUserIds.split(',').filter(Boolean) : [];
    if (toIds.indexOf(user.id) === -1) return false;
    var noted = e.notedUserIds ? e.notedUserIds.split(',').filter(Boolean) : [];
    return noted.indexOf(user.id) === -1;
  });
  mine.sort(function (a, b) { return new Date(b.triggeredAt) - new Date(a.triggeredAt); });
  var items = mine.map(function (e) {
    var finding = getById('Findings', e.findingId);
    var event = finding ? getById('Events', finding.eventId) : null;
    return {
      id: e.id, findingId: e.findingId, tier: e.tier, triggeredAt: e.triggeredAt,
      eventId: finding ? finding.eventId : '', eventName: event ? event.name : '',
      findingDescription: finding ? finding.description : '', findingCategory: finding ? finding.category : '',
      riskLevel: finding ? finding.riskLevel : '', subZone: finding ? finding.subZone : '', location: finding ? finding.location : ''
    };
  });
  return { lockScreenEnabled: getEscalationConfig_().lockScreenEnabled, items: items };
}

// REQ: "To remove alert user must click Noted." Only ever appends the ACTING user's own id --
// nobody can dismiss someone else's lock screen through this route, even if they happen to know
// the escalation id (requireRole isn't needed here since being listed in toUserIds already IS the
// permission check).
function acknowledgeEscalation(user, p) {
  if (!p || !p.escalationId) throw new HululError('BAD_REQUEST', 'escalationId is required');
  var esc = getById('Escalations', p.escalationId);
  if (!esc) throw new HululError('NOT_FOUND', 'Escalation not found');
  var toIds = esc.toUserIds ? esc.toUserIds.split(',').filter(Boolean) : [];
  if (toIds.indexOf(user.id) === -1) throw new HululError('FORBIDDEN', 'You are not a recipient of this escalation');
  var noted = esc.notedUserIds ? esc.notedUserIds.split(',').filter(Boolean) : [];
  if (noted.indexOf(user.id) === -1) {
    noted.push(user.id);
    updateRow('Escalations', esc.id, { notedUserIds: noted.join(',') });
    audit(user.id, 'NOTE_ESCALATION', 'Escalations', esc.id, {});
  }
  return { id: esc.id, findingId: esc.findingId };
}

// ---- Escalation engine ------------------------------------------------
// Tier 1 = configured tier1 roles (default Event Manager), fires once Finding.resolutionWindowAt
// has lapsed and it's still unresolved -- see the big comment above getEscalationConfig for why
// Tier 1's TIMING stays per-finding/per-checklist-item even though its RECIPIENTS are now configurable.
// Tier 2 = configured tier2 roles (default EMC Manager), fires configured tier2 delay (now
// risk-level-scoped) after Tier 1 triggers, if still unresolved.
// Tier 3 = configured tier3 roles (default GA Admin/User), fires configured tier3 delay
// (risk-level-scoped) after Tier 2 triggers, if still unresolved.
// Tiers strictly sequential: a later tier can never fire before the earlier tier's own trigger time (Section 2.5).
function runEscalationCheck(user) {
  if (user) requirePermission(user, 'escalation.runCheck'); // RBAC pilot -- same default roles as before, no behavior change
  var openFindings = findWhere('Findings', function (f) { return FINDING_OPEN_STATUSES.indexOf(f.status) !== -1; });
  // Read once per run, not once per finding -- getConfigJson_ hits the Config sheet, and this can
  // scan a lot of open findings on a busy event.
  var cfg = getEscalationConfig_();
  var eventsById = {}; // small per-run cache -- many open findings usually share the same handful of events
  function eventFor_(eventId) {
    if (!(eventId in eventsById)) eventsById[eventId] = getById('Events', eventId);
    return eventsById[eventId];
  }
  var now = new Date();
  var triggered = [];

  openFindings.forEach(function (finding) {
    if (!finding.resolutionWindowAt) return;
    var windowAt = new Date(finding.resolutionWindowAt);
    var escalations = findWhere('Escalations', function (e) { return e.findingId === finding.id; });
    var tier1 = escalations.filter(function (e) { return String(e.tier) === '1'; })[0];
    var tier2 = escalations.filter(function (e) { return String(e.tier) === '2'; })[0];
    var event = eventFor_(finding.eventId);
    if (!event) return;

    if (!tier1 && now >= windowAt) {
      var t1 = escalationResolveRecipients_(cfg.tier1.toRoles, cfg.tier1.ccRoles, event);
      triggered.push(fireEscalation_(finding, 1, t1.toUserIds, t1.ccUserIds));
      return;
    }
    // Tier 2/3 delays are risk-level-scoped (REQ: "if risk level is Low level 2 trigger might be
    // set to 48 hours and level 3 trigger might be set to 24 hours") -- an unrecognized/blank
    // riskLevel falls back to Medium's configured delay rather than failing to escalate at all.
    var riskLevel = RISK_LEVELS_.indexOf(finding.riskLevel) !== -1 ? finding.riskLevel : 'Medium';
    var tier2DelayMin = cfg.tier2.delayMinutesByRisk[riskLevel];
    var tier3DelayMin = cfg.tier3.delayMinutesByRisk[riskLevel];
    if (tier1 && !tier2 && now >= new Date(new Date(tier1.triggeredAt).getTime() + tier2DelayMin * 60 * 1000)) {
      var t2 = escalationResolveRecipients_(cfg.tier2.toRoles, cfg.tier2.ccRoles, event);
      triggered.push(fireEscalation_(finding, 2, t2.toUserIds, t2.ccUserIds));
      return;
    }
    var tier3 = escalations.filter(function (e) { return String(e.tier) === '3'; })[0];
    if (tier1 && tier2 && !tier3 && now >= new Date(new Date(tier2.triggeredAt).getTime() + tier3DelayMin * 60 * 1000)) {
      var t3 = escalationResolveRecipients_(cfg.tier3.toRoles, cfg.tier3.ccRoles, event);
      triggered.push(fireEscalation_(finding, 3, t3.toUserIds, t3.ccUserIds));
    }
  });

  return { checkedAt: now.toISOString(), triggeredCount: triggered.length, triggered: triggered };
}

function fireEscalation_(finding, tier, toUserIds, ccUserIds) {
  toUserIds = toUserIds || [];
  ccUserIds = ccUserIds || [];
  var row = {
    id: newId('Escalations'), findingId: finding.id, tier: tier, triggeredAt: nowIso_(),
    toUserIds: toUserIds.join(','), ccUserIds: ccUserIds.join(','), notedUserIds: '', resolvedAt: ''
  };
  insertRow('Escalations', row);
  audit('system', 'ESCALATION_TIER_' + tier, 'Findings', finding.id, {});
  var message = 'Finding escalated to Tier ' + tier + ': ' + (finding.description || finding.category || finding.id);
  if (toUserIds.length) notify_(toUserIds, 'ESCALATION_TIER_' + tier, message, 'Findings', finding.id, finding.eventId);
  if (ccUserIds.length) notify_(ccUserIds, 'ESCALATION_TIER_' + tier + '_CC', 'Cc: ' + message, 'Findings', finding.id, finding.eventId);
  return row;
}

// REQ: "ability to modify the To user role and the Cc: user roles." Generic replacement for the
// old fixed eventTier1Recipient_/eventTier2Recipients_/eventTier3Recipients_ trio -- resolves ANY
// role string to the concrete user id(s) it means for a given event, using whichever scoping
// strategy actually fits that role (there's no single formula that works for all of them):
//   - EventManager: the ONE specific person assigned on the event itself (Events.eventManagerId),
//     not a role-pool -- an event only ever has one.
//   - EMCAdmin/EMCManager/EMCAnalyst: every User with that role in the event's own EMC org
//     (Users.orgId === Events.emcId) -- same scoping eventTier2Recipients_ used to hardcode.
//   - ProjectManager/InspectionAdmin/InspectionAnalyst/Inspector: every User with that role in the
//     event's own Inspection Company org (Users.orgId === Events.inspectionCoId) -- same scoping
//     already established for template libraries/inspector pools (Templates.gs, Disciplines.gs).
//   - SystemAdmin/GAAdmin/GAUser/SupportAgent: platform-level roles, not scoped to any one
//     org/event -- every User holding that role, same as eventTier3Recipients_ used to hardcode.
// Vendor/Operator/Exhibitor deliberately return [] -- they're Participant-account roles (no
// meaningful "escalation recipient" concept, see ESCALATION_SELECTABLE_ROLES_ below, which is what
// the Settings picker actually offers so this case shouldn't normally be reached).
function escalationRoleRecipients_(role, event) {
  if (!event) return [];
  if (role === ROLES.EVENT_MANAGER) return event.eventManagerId ? [event.eventManagerId] : [];
  if ([ROLES.EMC_ADMIN, ROLES.EMC_MANAGER, ROLES.EMC_ANALYST].indexOf(role) !== -1) {
    return findWhere('Users', function (u) { return u.role === role && u.orgId === event.emcId; }).map(function (u) { return u.id; });
  }
  if ([ROLES.PROJECT_MANAGER, ROLES.INSPECTION_ADMIN, ROLES.INSPECTION_ANALYST, ROLES.INSPECTOR].indexOf(role) !== -1) {
    return findWhere('Users', function (u) { return u.role === role && u.orgId === event.inspectionCoId; }).map(function (u) { return u.id; });
  }
  if ([ROLES.SYSTEM_ADMIN, ROLES.GA_ADMIN, ROLES.GA_USER, ROLES.SUPPORT_AGENT].indexOf(role) !== -1) {
    return findWhere('Users', function (u) { return u.role === role; }).map(function (u) { return u.id; });
  }
  return [];
}

// Roles offered in the Escalation Settings To/Cc pickers (config.js) -- every staff role
// escalationRoleRecipients_ actually knows how to scope. Excludes Vendor/Operator/Exhibitor
// (Participant-account roles with no login-based "recipient" concept) and deliberately excludes
// nothing else, so a newly added staff role only needs a scoping rule added above to become
// selectable here too.
// Deliberately plain string literals, not [ROLES.EVENT_MANAGER, ...] -- this array is built at
// module load time, and Apps Script concatenates every .gs file's top-level code in file order
// (alphabetical: "Resolutions.gs" loads before "Utils.gs", which is where ROLES is defined), so
// referencing ROLES here would read it before Utils.gs has run, throwing a script-wide
// initialization error that breaks every API call, not just this one (same trap already documented
// on EVENT_PLACE_MANAGE_ROLES in Places.gs -- missed here when this was first added). requireRole(user,
// [ROLES.SYSTEM_ADMIN, ...]) calls *inside* functions are fine -- those only run after every file's
// top-level code has already finished.
var ESCALATION_SELECTABLE_ROLES_ = [
  'EventManager', 'EMCAdmin', 'EMCManager', 'EMCAnalyst',
  'ProjectManager', 'InspectionAdmin', 'InspectionAnalyst', 'Inspector',
  'SystemAdmin', 'GAAdmin', 'GAUser', 'SupportAgent'
];

// Resolves a whole {toRoles, ccRoles} pair (as stored in escalation config) into deduped
// {toUserIds, ccUserIds} arrays for one event. A user showing up in both To and Cc (e.g. holds two
// roles, or one role is listed in both lists by mistake) is kept in To only -- REQ: only To gets
// the full-screen lock, so nobody should end up locked out AND merely Cc'd at the same time.
function escalationResolveRecipients_(toRoles, ccRoles, event) {
  var toIds = [];
  (toRoles || []).forEach(function (role) {
    escalationRoleRecipients_(role, event).forEach(function (id) { if (toIds.indexOf(id) === -1) toIds.push(id); });
  });
  var ccIds = [];
  (ccRoles || []).forEach(function (role) {
    escalationRoleRecipients_(role, event).forEach(function (id) { if (ccIds.indexOf(id) === -1 && toIds.indexOf(id) === -1) ccIds.push(id); });
  });
  return { toUserIds: toIds, ccUserIds: ccIds };
}
