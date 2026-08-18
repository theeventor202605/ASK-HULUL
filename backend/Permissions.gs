/**
 * HULUL - Permissions.gs (RBAC foundation, "admin-configurable permissions")
 *
 * REQ: "It is time we build Role-Based Access Control" -> clarified as: a SystemAdmin should be able
 * to change WHICH ROLES can do WHAT, from a Settings screen, without a code deploy. The app already
 * had role-based access control (every backend action gates on requireRole(user, [ROLES...])) -- what
 * it lacked was a way to change those role lists without editing code. This file adds that layer on
 * top of requireRole rather than replacing it:
 *
 *   requirePermission(user, key, contextOrgId)
 *     -> look up the effective allowed-roles list for `key` (an admin override if one has been saved,
 *        else PERMISSION_REGISTRY_[key].defaultRoles -- i.e. exactly what used to be hardcoded inline)
 *     -> requireRole(user, effectiveRoles, contextOrgId)
 *
 * Rollout status: started as foundation + ONE pilot module (Findings/Risk Logging) as a working
 * end-to-end proof, then grown module-by-module across most of the app (Events/Venues/Zones,
 * Participants/Places, Disciplines, Inspections, Accounts/Organizations, Notifications, Escalations,
 * Projects, Venue Approval, Reassignment, Support, Reports, Templates/Meetings -- see the `requirePermission(user, '...')`
 * call sites throughout backend/*.gs for the current, authoritative list; PERMISSION_REGISTRY_ below
 * is kept in sync with exactly those). A small number of requireRole call sites are DELIBERATELY left
 * untouched -- mostly SystemAdmin-only bootstrapping (account/org creation, escalation/template
 * config) that intentionally isn't meant to become admin-configurable.
 *
 * Storage: a single global row (id 'GLOBAL') in the Permissions sheet holding a JSON blob of
 * permissionKey -> array of role codes -- same one-row-JSON-blob convention as AppIcons
 * (getAppIcons/setAppIcons, Accounts.gs). A key absent from the blob simply means "no override yet,
 * use the default" -- so a brand new install (empty Permissions sheet) behaves byte-for-byte like the
 * old hardcoded requireRole calls.
 */

// The permission catalog. Each entry's defaultRoles is exactly the allowedRoles array that used to be
// hardcoded inline at that requireRole call site -- migrating a call site to requirePermission is a
// no-op for behavior until a SystemAdmin actually changes it in Settings > Permissions. module/label
// are display-only, for grouping/rendering the admin UI.
//
// NOTE: defaultRoles use plain role-code strings, not ROLES.X -- Apps Script concatenates every
// backend/*.gs file in alphabetical order into one script, and Permissions.gs (P) loads before
// Utils.gs (U), which is where `var ROLES = {...}` is actually defined. A top-level ROLES.X reference
// here would throw at load time before ROLES exists (same bug class fixed earlier for a top-level
// ROLES reference elsewhere). Auth.gs's ACCOUNT_CREATION_MATRIX has the same load-order constraint
// (A also loads before U) and uses the same plain-string convention for the same reason.
// REQ: "control who has Create, Read, Update and Delete for sections or Pages or tabs" -- each entry
// now also carries `page` (a stable id -- see PERMISSION_PAGES_ in settings.js for the real
// translated nav/tab label + "go to page" link each one maps to) and `crud` (one or more of
// create/read/update/delete). Most backend actions were never split into 3 separate create/update/
// delete role-checks in the first place -- a single function/role-check often already covers all
// three (e.g. manageVenue's create-or-edit-or-delete) -- so `crud` legitimately lists more than one
// letter for those; the Settings > Permissions matrix (settings.js) shows the SAME key/role-editor
// under every column it's tagged with and says so, rather than pretending independent control exists
// where the backend doesn't actually have it. `read` is sparse on purpose: most page/tab VISIBILITY
// (who even sees a nav item or Event-workspace tab) is still hardcoded role arrays in app.js
// (NAV_ITEMS) / eventDetail.js (EVENT_TABS), not wired into this registry -- a separate, larger
// follow-up (turning those into their own admin-configurable 'X.view' keys) if ever needed.
var PERMISSION_REGISTRY_ = {
  'finding.create': {
    module: 'Risk Logging', label: 'Log a new finding', page: 'findings', crud: ['create'],
    defaultRoles: ['Inspector', 'ProjectManager', 'SystemAdmin']
  },
  'finding.edit': {
    module: 'Risk Logging', label: 'Edit a finding (before it\'s submitted)', page: 'findings', crud: ['update'],
    defaultRoles: ['Inspector', 'ProjectManager', 'SystemAdmin']
  },
  'finding.delete': {
    module: 'Risk Logging', label: 'Delete a finding (before it\'s submitted)', page: 'findings', crud: ['delete'],
    defaultRoles: ['Inspector', 'ProjectManager', 'SystemAdmin']
  },
  'finding.addEvidence': {
    module: 'Risk Logging', label: 'Attach evidence photos to a finding', page: 'findings', crud: ['update'],
    defaultRoles: ['Inspector', 'ProjectManager', 'SystemAdmin']
  },
  'finding.resolve': {
    module: 'Risk Logging', label: 'Submit a resolution to a finding', page: 'findings', crud: ['update'],
    defaultRoles: ['Vendor', 'Operator', 'Exhibitor']
  },
  'finding.review': {
    module: 'Risk Logging', label: 'Accept/reject a submitted resolution', page: 'findings', crud: ['update'],
    defaultRoles: ['Inspector', 'ProjectManager', 'SystemAdmin']
  },
  // participant.create/participant.edit (the old venue-wide Participants.gs create/update API) were
  // removed from here -- Places.gs's createPlace/updatePlace (place.create/place.manage below) fully
  // superseded them and these two keys had no requirePermission() call site left anywhere (confirmed
  // by grep), same dead-code cleanup as the functions themselves.
  'place.create': {
    module: 'Participants', label: 'Add a temporary participant to an event (Participants tab map + form)',
    page: 'participants', crud: ['create'],
    // Same five roles Places.gs's EVENT_PLACE_MANAGE_ROLES already allowed (SystemAdmin/EMCAdmin/
    // EMCManager/EventManager), plus Inspector -- REQ: "Inspector ... ability to add a temporary
    // participant."
    defaultRoles: ['SystemAdmin', 'EMCAdmin', 'EMCManager', 'EventManager', 'Inspector']
  },
  'participant.assignDisciplines': {
    module: 'Participants', label: 'Assign disciplines to participants (bulk)', page: 'participantDisciplines', crud: ['update'],
    defaultRoles: ['ProjectManager', 'SystemAdmin']
  },
  'participant.dedupe': {
    module: 'Participants', label: 'Remove duplicate participants', page: 'participants', crud: ['delete'],
    defaultRoles: ['SystemAdmin', 'EventManager']
  },
  'place.manage': {
    module: 'Participants', label: 'Manage an event\'s participants (add account/edit/delete/view credentials)',
    page: 'participants', crud: ['create', 'update', 'delete'],
    // Exactly Places.gs's old hardcoded EVENT_PLACE_MANAGE_ROLES -- migrating this call site is a
    // no-op for behavior until a SystemAdmin actually changes it in Settings > Permissions, same as
    // every other pilot migration.
    defaultRoles: ['SystemAdmin', 'EMCAdmin', 'EMCManager', 'EventManager']
  },
  'venuePlace.manage': {
    module: 'Venues', label: 'Manage places within a venue\'s permanent catalog (add/edit/delete/view credentials)',
    page: 'venues', crud: ['create', 'update', 'delete'],
    defaultRoles: ['SystemAdmin', 'EMCAdmin', 'EMCManager']
  },
  'venue.manage': {
    module: 'Venues', label: 'Create, edit, or delete a venue', page: 'venues', crud: ['create', 'update', 'delete'],
    defaultRoles: ['SystemAdmin', 'EMCAdmin', 'EMCManager']
  },
  'zone.manage': {
    module: 'Venues', label: 'Create, edit, or delete a zone', page: 'venues', crud: ['create', 'update', 'delete'],
    defaultRoles: ['SystemAdmin', 'EMCAdmin', 'EMCManager', 'EventManager']
  },
  'event.manage': {
    module: 'Events', label: 'Create or edit an event', page: 'events', crud: ['create', 'update'],
    defaultRoles: ['SystemAdmin', 'GAAdmin', 'GAUser']
  },
  'event.delete': {
    module: 'Events', label: 'Delete an event (Planning status only)', page: 'events', crud: ['delete'],
    defaultRoles: ['SystemAdmin', 'GAAdmin']
  },
  'subEvent.create': {
    module: 'Events', label: 'Create a sub-event', page: 'subEvents', crud: ['create'],
    defaultRoles: ['SystemAdmin', 'GAAdmin', 'GAUser', 'EventManager']
  },
  'event.assignManager': {
    // REQ follow-up: "Move Venue & Zones to venue sidebar page" removed the Event workspace's own
    // 'venue' tab (and settings.js's now-orphaned 'venueTab' permissionPages_ entry) -- this
    // permission's actual UI home was always the standalone Reassign Venue page (reassignment.js),
    // not that tab, so it repoints there instead.
    module: 'Events', label: 'Assign an Event Manager to an event', page: 'reassignment', crud: ['update'],
    defaultRoles: ['SystemAdmin', 'EMCManager', 'EMCAdmin']
  },
  'templateLibrary.manage': {
    module: 'Templates', label: 'Add or replace a library template (Inspection Company master documents)',
    page: 'templateLibrary', crud: ['create', 'update'],
    defaultRoles: ['InspectionAdmin', 'SystemAdmin']
  },
  'template.send': {
    module: 'Templates', label: 'Send readiness templates to an event', page: 'templates', crud: ['update'],
    defaultRoles: ['ProjectManager', 'SystemAdmin']
  },
  'template.setDeadline': {
    module: 'Templates', label: 'Set an event\'s documents deadline', page: 'templates', crud: ['update'],
    defaultRoles: ['ProjectManager', 'SystemAdmin']
  },
  // REQ follow-up: "move items in the Process tab to Permissions tab." These two used to live behind
  // their own dedicated Settings > Process editor (templateUploaderRoles_/templateReviewerRoles_,
  // backed by their own Config-sheet keys) instead of this registry -- that was a deliberate call at
  // the time, to avoid a second parallel "who can do this" control for the same actions. Since then
  // the Process tab has been retired and these are now ordinary registry entries like everything else
  // -- templateUploaderRoles_/templateReviewerRoles_ (Templates.gs) now just read effectivePermissionRoles_
  // for these two keys instead of a separate Config-JSON value.
  'template.upload': {
    module: 'Templates', label: 'Upload/replace and submit an event\'s document (the "Event Manager" step)',
    page: 'templates', crud: ['update'],
    defaultRoles: ['EventManager', 'SystemAdmin']
  },
  'template.review': {
    module: 'Templates', label: 'Review and evaluate a submitted document (the "Inspection Analyst" step)',
    page: 'templates', crud: ['update'],
    defaultRoles: ['InspectionAnalyst', 'SystemAdmin']
  },
  // REQ follow-up: "Finalize closes score editing" -- once a Document Review scoring form is
  // finalized (finalizeTemplateScoring, Templates.gs -- reuses 'template.review' above, same role
  // that can score it can finalize it) it becomes read-only for everyone. Reopening it is
  // deliberately its own, separately-configurable permission (default SystemAdmin only) rather than
  // reusing 'template.review' again, so an org can let its Inspection Analysts finalize freely while
  // still requiring a manager/admin sign-off to undo one.
  'template.reopenScoring': {
    module: 'Templates', label: 'Reopen a finalized Document Review scoring form for editing again',
    page: 'templates', crud: ['update'],
    defaultRoles: ['SystemAdmin']
  },
  'meeting.manage': {
    module: 'Meetings', label: 'Schedule, edit, or delete a meeting', page: 'meetings', crud: ['create', 'update', 'delete'],
    defaultRoles: ['SystemAdmin', 'InspectionAdmin', 'ProjectManager', 'EMCManager']
  },
  'checklistItem.manage': {
    module: 'Inspections', label: 'Create, edit, or delete a checklist catalogue item', page: 'checklistItems', crud: ['create', 'update', 'delete'],
    defaultRoles: ['SystemAdmin', 'InspectionAdmin', 'ProjectManager']
  },
  'checklistItem.dedupe': {
    module: 'Inspections', label: 'Remove duplicate checklist catalogue items', page: 'checklistItems', crud: ['delete'],
    defaultRoles: ['SystemAdmin', 'InspectionAdmin']
  },
  'inspection.manage': {
    module: 'Inspections', label: 'Schedule, edit, or delete an inspection visit', page: 'inspectionsTab', crud: ['create', 'update', 'delete'],
    defaultRoles: ['ProjectManager', 'SystemAdmin']
  },
  'inspection.recordResults': {
    module: 'Inspections', label: 'Record checklist results for an inspection', page: 'inspectionsTab', crud: ['update'],
    defaultRoles: ['Inspector', 'SystemAdmin']
  },
  // REQ follow-up: "Completed Checklists can be viewed as a full page filterable list" -- a
  // standalone, cross-event page (listAllCompletedChecklists, Inspections.gs), distinct from the
  // per-event Completed Checklists tab (that one has no permission gate of its own -- it's already
  // implicitly behind having opened an Event you can see). This one needs its own gate since it's a
  // top-level nav destination that spans every event at once. Same-ish audience as the two
  // inspection.* permissions above (whoever schedules or records inspections) plus InspectionAdmin,
  // who oversees the whole discipline/inspection setup but isn't on either of those by default.
  'completedChecklist.view': {
    module: 'Inspections', label: 'View completed checklists across every event', page: 'completedChecklists', crud: ['read'],
    defaultRoles: ['SystemAdmin', 'InspectionAdmin', 'ProjectManager', 'Inspector']
  },
  'discipline.manage': {
    module: 'Disciplines', label: 'Add a discipline to the catalogue', page: 'disciplinesCatalog', crud: ['create'],
    defaultRoles: ['SystemAdmin', 'InspectionAdmin']
  },
  'discipline.identify': {
    module: 'Disciplines', label: 'Identify which disciplines apply to an event', page: 'disciplinesTab', crud: ['update'],
    defaultRoles: ['ProjectManager', 'SystemAdmin']
  },
  'inspectorQualification.manage': {
    module: 'Disciplines', label: 'Set an inspector\'s qualification profile', page: 'inspectorQualifications', crud: ['create', 'update'],
    defaultRoles: ['InspectionAdmin', 'SystemAdmin', 'ProjectManager']
  },
  'inspectorAssignment.manage': {
    module: 'Disciplines', label: 'Assign or remove an inspector on a discipline', page: 'disciplinesTab', crud: ['create', 'update', 'delete'],
    defaultRoles: ['ProjectManager', 'SystemAdmin']
  },
  'escalation.create': {
    module: 'Risk Logging', label: 'Manually trigger an escalation for a finding', page: 'escalations', crud: ['create'],
    defaultRoles: ['SystemAdmin', 'InspectionAdmin', 'ProjectManager']
  },
  'escalation.runCheck': {
    module: 'Risk Logging', label: 'Manually run the escalation sweep', page: 'escalations', crud: ['update'],
    // Same default roles as escalation.create today (kept as a separate key since they're different
    // actions) -- the automated interval trigger (Setup.gs) calls runEscalationCheck with no user at
    // all and is unaffected by this; this key only gates a signed-in caller manually running it.
    defaultRoles: ['SystemAdmin', 'ProjectManager', 'InspectionAdmin']
  },
  'project.manage': {
    module: 'Projects', label: 'Create or edit a project', page: 'projects', crud: ['create', 'update'],
    defaultRoles: ['SystemAdmin', 'GAAdmin', 'GAUser']
  },
  'project.delete': {
    module: 'Projects', label: 'Delete a project', page: 'projects', crud: ['delete'],
    defaultRoles: ['SystemAdmin', 'GAAdmin']
  },
  'venueApproval.recommend': {
    module: 'Venue Approval', label: 'Record a venue evaluation recommendation', page: 'approval', crud: ['update'],
    defaultRoles: ['ProjectManager', 'SystemAdmin']
  },
  'venueApproval.decide': {
    module: 'Venue Approval', label: 'Record the GA venue decision or reassign the venue', page: 'approval', crud: ['update'],
    defaultRoles: ['GAAdmin', 'GAUser', 'SystemAdmin']
  },
  'reassignment.manage': {
    module: 'Reassignment', label: 'Mark a user unavailable/available and reassign their work', page: 'reassignment', crud: ['update'],
    defaultRoles: ['SystemAdmin', 'GAAdmin', 'EMCAdmin', 'InspectionAdmin', 'EMCManager', 'ProjectManager']
  },
  'evidence.upload': {
    module: 'Risk Logging', label: 'Upload evidence (photo/video) for a finding or resolution', page: 'findings', crud: ['update'],
    // Shared by two different moments: an Inspector attaching evidence while logging a finding, and
    // a Vendor/Operator/Exhibitor attaching a required photo/video when submitting a resolution (see
    // resolveFinding, Findings.gs). Kept separate from finding.addEvidence (also Risk Logging) --
    // that key gates a narrower, Inspector/PM-only action elsewhere; this one is the shared
    // file-upload primitive both flows call, so its role set has to include the resolver roles too.
    defaultRoles: ['Inspector', 'SystemAdmin', 'Vendor', 'Operator', 'Exhibitor']
  },
  'user.list': {
    module: 'Accounts', label: 'View the user directory', page: 'accounts', crud: ['read'],
    defaultRoles: ['SystemAdmin', 'GAAdmin', 'EMCAdmin', 'InspectionAdmin', 'EMCManager', 'ProjectManager']
  },
  'organization.list': {
    module: 'Accounts', label: 'View the organization directory', page: 'organizations', crud: ['read'],
    defaultRoles: ['SystemAdmin', 'GAAdmin', 'GAUser', 'EMCAdmin', 'InspectionAdmin', 'ProjectManager', 'EventManager', 'EMCManager']
  },
  'orgLabels.manage': {
    module: 'Accounts', label: 'Change an organization\'s custom terminology labels', page: 'settings', crud: ['update'],
    defaultRoles: ['SystemAdmin', 'GAAdmin', 'EMCAdmin', 'InspectionAdmin']
  },
  'auditLog.view': {
    module: 'Accounts', label: 'View the audit log', page: 'auditLog', crud: ['read'],
    defaultRoles: ['SystemAdmin', 'GAAdmin', 'EMCAdmin', 'InspectionAdmin']
  },
  'user.resetPassword': {
    module: 'Accounts', label: 'Reset another user\'s password', page: 'accounts', crud: ['update'],
    defaultRoles: ['SystemAdmin', 'GAAdmin', 'EMCAdmin', 'InspectionAdmin']
  },
  'notification.send': {
    module: 'Notifications', label: 'Manually send a notification', page: 'notifications', crud: ['create'],
    defaultRoles: ['SystemAdmin', 'GAAdmin', 'EMCAdmin', 'InspectionAdmin', 'EMCManager', 'ProjectManager']
  },
  'report.generate': {
    module: 'Reports', label: 'Generate an opening/operational report', page: 'reports', crud: ['create'],
    defaultRoles: ['ProjectManager', 'SystemAdmin', 'InspectionAdmin']
  },
  'ticket.resolve': {
    module: 'Support', label: 'Mark a support ticket resolved', page: 'support', crud: ['update'],
    defaultRoles: ['SystemAdmin', 'SupportAgent']
  },
  // Roadmap Plans (RoadmapPlans.gs) -- REQ: "Add Roadmap sidebar where they will be able to add types
  // of plan. and configure how it will rollout." Two separate keys, same "admin catalog vs. per-event
  // use" split as templateLibrary.manage/template.send above: roadmapPlan.manage gates the shared
  // Settings-level template catalog (Normal Plan/Parachute Plan/etc, GA-wide), roadmapItem.manage
  // gates working an individual Event's already-rolled-out items (mark done, override a date, add an
  // ad hoc item, Regenerate) -- deliberately broader (includes ProjectManager/EventManager, the roles
  // that actually run an event day to day) since that's a much lower-stakes action than redefining the
  // shared template every future event will roll out from.
  'roadmapPlan.manage': {
    module: 'Roadmap', label: 'Create, edit, or delete a Roadmap plan template', page: 'roadmapPlans', crud: ['create', 'update', 'delete'],
    defaultRoles: ['SystemAdmin', 'GAAdmin']
  },
  'roadmapItem.manage': {
    module: 'Roadmap', label: 'Edit an event\'s rolled-out Roadmap items (mark done, override a date, add/remove, regenerate)', page: 'roadmap', crud: ['create', 'update', 'delete'],
    defaultRoles: ['SystemAdmin', 'GAAdmin', 'GAUser', 'EventManager', 'ProjectManager']
  }
};

function getPermissionOverrides_() {
  var row = findWhere('Permissions', function (r) { return r.id === 'GLOBAL'; })[0];
  if (!row || !row.overridesJson) return {};
  try { return JSON.parse(row.overridesJson); } catch (e) { return {}; }
}

function savePermissionOverrides_(user, overrides) {
  var existing = findWhere('Permissions', function (r) { return r.id === 'GLOBAL'; })[0];
  var row = { overridesJson: JSON.stringify(overrides), updatedAt: nowIso_(), updatedBy: user.id };
  if (existing) updateRow('Permissions', existing.id, row);
  else insertRow('Permissions', Object.assign({ id: 'GLOBAL' }, row));
}

// The role list actually in effect for a permission key right now -- an admin override if one's been
// saved for it, else the key's built-in default. Falls back to an empty array (nobody allowed) for an
// unknown key rather than throwing, so a stale override referencing a since-removed key can't crash a
// live request.
function effectivePermissionRoles_(key, overrides) {
  var entry = PERMISSION_REGISTRY_[key];
  if (!entry) return [];
  var override = overrides ? overrides[key] : undefined;
  return (override && override.length) ? override : entry.defaultRoles;
}

// Drop-in replacement for requireRole at any migrated call site -- same signature plus the
// permission key in place of a literal allowedRoles array.
function requirePermission(user, key, contextOrgId) {
  if (!PERMISSION_REGISTRY_[key]) throw new HululError('SERVER_ERROR', 'Unknown permission key: ' + key);
  var roles = effectivePermissionRoles_(key, getPermissionOverrides_());
  return requireRole(user, roles, contextOrgId);
}

// Non-throwing companion to requirePermission -- for call sites that need to branch on "can this
// user do X" (e.g. openEventTemplate's auto-transition logic, Templates.gs) rather than reject the
// whole request when they can't. Returns false (not an error) for a signed-out user.
function hasPermissionRole_(user, key) {
  if (!user) return false;
  return effectivePermissionRoles_(key, getPermissionOverrides_()).indexOf(user.role) !== -1;
}

// SystemAdmin-only: the full catalog (every registered key, its module/label/defaultRoles) merged
// with whatever's currently overridden, for the Settings > Permissions admin screen. allRoles (every
// role code + display label) rides along too -- same "server hands back its own picklist" convention
// as getEscalationConfig (Resolutions.gs), so the frontend never needs its own hardcoded copy of the
// role list.
function listPermissions(user, p) {
  requireRole(user, [ROLES.SYSTEM_ADMIN]);
  var overrides = getPermissionOverrides_();
  var permissions = Object.keys(PERMISSION_REGISTRY_).map(function (key) {
    var entry = PERMISSION_REGISTRY_[key];
    var override = overrides[key];
    return {
      key: key, module: entry.module, label: entry.label,
      page: entry.page || null, crud: entry.crud || [],
      defaultRoles: entry.defaultRoles,
      roles: (override && override.length) ? override : entry.defaultRoles,
      isOverridden: !!(override && override.length)
    };
  });
  // allRolePicklist_ (Roles.gs) is built-in ROLES + any active custom roles -- a custom role needs to
  // show up here to be checkable in the CRUD matrix's role-chip editor at all.
  var allRoles = allRolePicklist_();
  return { permissions: permissions, allRoles: allRoles };
}

// SystemAdmin-only: set the effective role list for one permission key.
function updatePermission(user, p) {
  requireRole(user, [ROLES.SYSTEM_ADMIN]);
  if (!p || !p.key || !PERMISSION_REGISTRY_[p.key]) throw new HululError('BAD_REQUEST', 'A valid permission key is required');
  if (!p.roles || !p.roles.length) throw new HululError('BAD_REQUEST', 'At least one role must be allowed');
  var validRoles = allRoleCodes_(); // built-in + active custom roles (Roles.gs) -- else a grant to a
  // newly-created custom role would be silently filtered out right here and never actually save.
  var clean = p.roles.filter(function (r) { return validRoles.indexOf(r) !== -1; });
  if (!clean.length) throw new HululError('BAD_REQUEST', 'No valid roles supplied');
  var overrides = getPermissionOverrides_();
  overrides[p.key] = clean;
  savePermissionOverrides_(user, overrides);
  audit(user.id, 'UPDATE_PERMISSION', 'Permissions', p.key, { roles: clean });
  return { key: p.key, roles: clean };
}

// SystemAdmin-only: clear an override, reverting a permission key back to its built-in default.
function resetPermission(user, p) {
  requireRole(user, [ROLES.SYSTEM_ADMIN]);
  if (!p || !p.key || !PERMISSION_REGISTRY_[p.key]) throw new HululError('BAD_REQUEST', 'A valid permission key is required');
  var overrides = getPermissionOverrides_();
  delete overrides[p.key];
  savePermissionOverrides_(user, overrides);
  audit(user.id, 'RESET_PERMISSION', 'Permissions', p.key, {});
  return { key: p.key, roles: PERMISSION_REGISTRY_[p.key].defaultRoles };
}

// Any authenticated user: a plain boolean map (permissionKey -> can-I-do-this) for their OWN role,
// covering every registered key -- this (not listPermissions, which is SystemAdmin-only and exposes
// every role's access) is what the frontend fetches once at login and uses to show/hide
// create/edit/delete controls consistently with what the backend will actually allow.
function getMyPermissions(user, p) {
  if (!user) throw new HululError('UNAUTHENTICATED', 'Login required');
  var overrides = getPermissionOverrides_();
  var out = {};
  Object.keys(PERMISSION_REGISTRY_).forEach(function (key) {
    out[key] = effectivePermissionRoles_(key, overrides).indexOf(user.role) !== -1;
  });
  return out;
}

// Any authenticated user: which PERMISSION_REGISTRY_ `page` ids their role has at least one granted
// action on. REQ follow-up: "a newly-created role should see pages/tabs it's been granted access to
// without a code change" -- NAV_ITEMS (app.js) still hardcodes its own `roles` arrays for the
// built-in roles (unchanged, so nothing about their behavior changes), but navItemVisible_ (app.js)
// ALSO checks this map so a nav item whose page has ANY permission key granted to the signed-in
// user's role shows up too -- the one path that makes a brand new custom role's Settings > Permissions
// grants actually visible in the sidebar with zero code changes. Deliberately its own endpoint rather
// than folded into getMyPermissions above: that one's shape (permissionKey -> boolean) is a stable
// contract several call sites already depend on (hasPermission, permissions.js), and every real key
// contains a '.' while every page id doesn't, so mixing them into one flat object risked confusion for
// no real benefit.
function getMyPageAccess(user, p) {
  if (!user) throw new HululError('UNAUTHENTICATED', 'Login required');
  var overrides = getPermissionOverrides_();
  var pages = {};
  Object.keys(PERMISSION_REGISTRY_).forEach(function (key) {
    var entry = PERMISSION_REGISTRY_[key];
    if (!entry.page || pages[entry.page]) return;
    if (effectivePermissionRoles_(key, overrides).indexOf(user.role) !== -1) pages[entry.page] = true;
  });
  return pages;
}
