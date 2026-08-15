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
 * Rollout (explicit user decision, see PERMISSION_REGISTRY_ below): foundation + ONE pilot module
 * (Findings/Risk Logging, migrated in Findings.gs) as a working end-to-end proof. The other ~78
 * requireRole call sites across the rest of the app are DELIBERATELY left untouched for now -- they
 * keep working exactly as before, and get migrated to requirePermission (each adding its own
 * PERMISSION_REGISTRY_ entry) in later passes, not all at once.
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
var PERMISSION_REGISTRY_ = {
  'finding.create': {
    module: 'Risk Logging', label: 'Log a new finding',
    defaultRoles: ['Inspector', 'ProjectManager', 'SystemAdmin']
  },
  'finding.edit': {
    module: 'Risk Logging', label: 'Edit a finding (before it\'s submitted)',
    defaultRoles: ['Inspector', 'ProjectManager', 'SystemAdmin']
  },
  'finding.delete': {
    module: 'Risk Logging', label: 'Delete a finding (before it\'s submitted)',
    defaultRoles: ['Inspector', 'ProjectManager', 'SystemAdmin']
  },
  'finding.addEvidence': {
    module: 'Risk Logging', label: 'Attach evidence photos to a finding',
    defaultRoles: ['Inspector', 'ProjectManager', 'SystemAdmin']
  },
  'finding.resolve': {
    module: 'Risk Logging', label: 'Submit a resolution to a finding',
    defaultRoles: ['Vendor', 'Operator', 'Exhibitor']
  },
  'finding.review': {
    module: 'Risk Logging', label: 'Accept/reject a submitted resolution',
    defaultRoles: ['Inspector', 'ProjectManager', 'SystemAdmin']
  },
  'participant.create': {
    module: 'Participants', label: 'Create a participant (vendor/operator/exhibitor)',
    defaultRoles: ['EventManager', 'Inspector', 'SystemAdmin']
  },
  'place.create': {
    module: 'Participants', label: 'Add a temporary participant to an event (Participants tab map + form)',
    // Same five roles Places.gs's EVENT_PLACE_MANAGE_ROLES already allowed (SystemAdmin/EMCAdmin/
    // EMCManager/EventManager), plus Inspector -- REQ: "Inspector ... ability to add a temporary
    // participant." A separate key from participant.create (not a shared one) because that key also
    // gates the unrelated venue-wide createParticipant (Participants.gs); overriding its role list
    // here would have silently changed that other feature too.
    defaultRoles: ['SystemAdmin', 'EMCAdmin', 'EMCManager', 'EventManager', 'Inspector']
  },
  'participant.edit': {
    module: 'Participants', label: 'Edit a participant',
    defaultRoles: ['EventManager', 'Inspector', 'SystemAdmin']
  },
  'participant.assignDisciplines': {
    module: 'Participants', label: 'Assign disciplines to participants (bulk)',
    defaultRoles: ['ProjectManager', 'SystemAdmin']
  },
  'participant.dedupe': {
    module: 'Participants', label: 'Remove duplicate participants',
    defaultRoles: ['SystemAdmin', 'EventManager']
  },
  'place.manage': {
    module: 'Participants', label: 'Manage an event\'s participants (add account/edit/delete/view credentials)',
    // Exactly Places.gs's old hardcoded EVENT_PLACE_MANAGE_ROLES -- migrating this call site is a
    // no-op for behavior until a SystemAdmin actually changes it in Settings > Permissions, same as
    // every other pilot migration.
    defaultRoles: ['SystemAdmin', 'EMCAdmin', 'EMCManager', 'EventManager']
  },
  'venuePlace.manage': {
    module: 'Venues', label: 'Manage places within a venue\'s permanent catalog (add/edit/delete/view credentials)',
    defaultRoles: ['SystemAdmin', 'EMCAdmin', 'EMCManager']
  },
  'venue.manage': {
    module: 'Venues', label: 'Create, edit, or delete a venue',
    defaultRoles: ['SystemAdmin', 'EMCAdmin', 'EMCManager']
  },
  'zone.manage': {
    module: 'Venues', label: 'Create, edit, or delete a zone',
    defaultRoles: ['SystemAdmin', 'EMCAdmin', 'EMCManager', 'EventManager']
  },
  'event.manage': {
    module: 'Events', label: 'Create or edit an event',
    defaultRoles: ['SystemAdmin', 'GAAdmin', 'GAUser']
  },
  'event.delete': {
    module: 'Events', label: 'Delete an event (Planning status only)',
    defaultRoles: ['SystemAdmin', 'GAAdmin']
  },
  'subEvent.create': {
    module: 'Events', label: 'Create a sub-event',
    defaultRoles: ['SystemAdmin', 'GAAdmin', 'GAUser', 'EventManager']
  },
  'event.assignManager': {
    module: 'Events', label: 'Assign an Event Manager to an event',
    defaultRoles: ['SystemAdmin', 'EMCManager', 'EMCAdmin']
  },
  'templateLibrary.manage': {
    module: 'Templates', label: 'Add or replace a library template (Inspection Company master documents)',
    defaultRoles: ['InspectionAdmin', 'SystemAdmin']
  },
  'template.send': {
    module: 'Templates', label: 'Send readiness templates to an event',
    defaultRoles: ['ProjectManager', 'SystemAdmin']
  },
  'template.setDeadline': {
    module: 'Templates', label: 'Set an event\'s documents deadline',
    defaultRoles: ['ProjectManager', 'SystemAdmin']
  },
  'meeting.manage': {
    module: 'Meetings', label: 'Schedule, edit, or delete a meeting',
    // NOTE: uploadEventTemplateFile/submitEventTemplate/reviewEventTemplate/openEventTemplate
    // (Templates.gs) are deliberately NOT migrated here -- those already have their own dedicated,
    // purpose-built admin surface (Settings > Configuration > Process tab, templateUploaderRoles_/
    // templateReviewerRoles_, backed by the Config sheet) predating this Permissions module. Adding a
    // second, parallel "who can do this" control for the same actions would just be confusing.
    defaultRoles: ['SystemAdmin', 'InspectionAdmin', 'ProjectManager', 'EMCManager']
  },
  'checklistItem.manage': {
    module: 'Inspections', label: 'Create, edit, or delete a checklist catalogue item',
    defaultRoles: ['SystemAdmin', 'InspectionAdmin', 'ProjectManager']
  },
  'checklistItem.dedupe': {
    module: 'Inspections', label: 'Remove duplicate checklist catalogue items',
    defaultRoles: ['SystemAdmin', 'InspectionAdmin']
  },
  'inspection.manage': {
    module: 'Inspections', label: 'Schedule, edit, or delete an inspection visit',
    defaultRoles: ['ProjectManager', 'SystemAdmin']
  },
  'inspection.recordResults': {
    module: 'Inspections', label: 'Record checklist results for an inspection',
    defaultRoles: ['Inspector', 'SystemAdmin']
  },
  'discipline.manage': {
    module: 'Disciplines', label: 'Add a discipline to the catalogue',
    defaultRoles: ['SystemAdmin', 'InspectionAdmin']
  },
  'discipline.identify': {
    module: 'Disciplines', label: 'Identify which disciplines apply to an event',
    defaultRoles: ['ProjectManager', 'SystemAdmin']
  },
  'inspectorQualification.manage': {
    module: 'Disciplines', label: 'Set an inspector\'s qualification profile',
    defaultRoles: ['InspectionAdmin', 'SystemAdmin', 'ProjectManager']
  },
  'inspectorAssignment.manage': {
    module: 'Disciplines', label: 'Assign or remove an inspector on a discipline',
    defaultRoles: ['ProjectManager', 'SystemAdmin']
  },
  'escalation.create': {
    module: 'Risk Logging', label: 'Manually trigger an escalation for a finding',
    defaultRoles: ['SystemAdmin', 'InspectionAdmin', 'ProjectManager']
  },
  'escalation.runCheck': {
    module: 'Risk Logging', label: 'Manually run the escalation sweep',
    // Same default roles as escalation.create today (kept as a separate key since they're different
    // actions) -- the automated 30-min trigger (Setup.gs) calls runEscalationCheck with no user at
    // all and is unaffected by this; this key only gates a signed-in caller manually running it.
    defaultRoles: ['SystemAdmin', 'ProjectManager', 'InspectionAdmin']
  },
  'project.manage': {
    module: 'Projects', label: 'Create or edit a project',
    defaultRoles: ['SystemAdmin', 'GAAdmin', 'GAUser']
  },
  'project.delete': {
    module: 'Projects', label: 'Delete a project',
    defaultRoles: ['SystemAdmin', 'GAAdmin']
  },
  'venueApproval.recommend': {
    module: 'Venue Approval', label: 'Record a venue evaluation recommendation',
    defaultRoles: ['ProjectManager', 'SystemAdmin']
  },
  'venueApproval.decide': {
    module: 'Venue Approval', label: 'Record the GA venue decision or reassign the venue',
    defaultRoles: ['GAAdmin', 'GAUser', 'SystemAdmin']
  },
  'reassignment.manage': {
    module: 'Reassignment', label: 'Mark a user unavailable/available and reassign their work',
    defaultRoles: ['SystemAdmin', 'GAAdmin', 'EMCAdmin', 'InspectionAdmin', 'EMCManager', 'ProjectManager']
  },
  'evidence.upload': {
    module: 'Risk Logging', label: 'Upload evidence (photo/video) for a finding or resolution',
    // Shared by two different moments: an Inspector attaching evidence while logging a finding, and
    // a Vendor/Operator/Exhibitor attaching a required photo/video when submitting a resolution (see
    // resolveFinding, Findings.gs). Kept separate from finding.addEvidence (also Risk Logging) --
    // that key gates a narrower, Inspector/PM-only action elsewhere; this one is the shared
    // file-upload primitive both flows call, so its role set has to include the resolver roles too.
    defaultRoles: ['Inspector', 'SystemAdmin', 'Vendor', 'Operator', 'Exhibitor']
  },
  'user.list': {
    module: 'Accounts', label: 'View the user directory',
    defaultRoles: ['SystemAdmin', 'GAAdmin', 'EMCAdmin', 'InspectionAdmin', 'EMCManager', 'ProjectManager']
  },
  'organization.list': {
    module: 'Accounts', label: 'View the organization directory',
    defaultRoles: ['SystemAdmin', 'GAAdmin', 'GAUser', 'EMCAdmin', 'InspectionAdmin', 'ProjectManager', 'EventManager', 'EMCManager']
  },
  'orgLabels.manage': {
    module: 'Accounts', label: 'Change an organization\'s custom terminology labels',
    defaultRoles: ['SystemAdmin', 'GAAdmin', 'EMCAdmin', 'InspectionAdmin']
  },
  'auditLog.view': {
    module: 'Accounts', label: 'View the audit log',
    defaultRoles: ['SystemAdmin', 'GAAdmin', 'EMCAdmin', 'InspectionAdmin']
  },
  'user.resetPassword': {
    module: 'Accounts', label: 'Reset another user\'s password',
    defaultRoles: ['SystemAdmin', 'GAAdmin', 'EMCAdmin', 'InspectionAdmin']
  },
  'notification.send': {
    module: 'Notifications', label: 'Manually send a notification',
    defaultRoles: ['SystemAdmin', 'GAAdmin', 'EMCAdmin', 'InspectionAdmin', 'EMCManager', 'ProjectManager']
  },
  'report.generate': {
    module: 'Reports', label: 'Generate an opening/operational report',
    defaultRoles: ['ProjectManager', 'SystemAdmin', 'InspectionAdmin']
  },
  'ticket.resolve': {
    module: 'Support', label: 'Mark a support ticket resolved',
    defaultRoles: ['SystemAdmin', 'SupportAgent']
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

// SystemAdmin-only: the full catalog (every registered key, its module/label/defaultRoles) merged
// with whatever's currently overridden, for the Settings > Permissions admin screen. allRoles (every
// role code + display label) rides along too -- same "server hands back its own picklist" convention
// as getTemplateProcessConfig (Templates.gs)/getEscalationConfig (Resolutions.gs), so the frontend
// never needs its own hardcoded copy of the role list.
function listPermissions(user, p) {
  requireRole(user, [ROLES.SYSTEM_ADMIN]);
  var overrides = getPermissionOverrides_();
  var permissions = Object.keys(PERMISSION_REGISTRY_).map(function (key) {
    var entry = PERMISSION_REGISTRY_[key];
    var override = overrides[key];
    return {
      key: key, module: entry.module, label: entry.label,
      defaultRoles: entry.defaultRoles,
      roles: (override && override.length) ? override : entry.defaultRoles,
      isOverridden: !!(override && override.length)
    };
  });
  var allRoles = Object.keys(ROLES).map(function (k) { return ROLES[k]; }).map(function (r) { return { value: r, label: roleLabel_(r) }; });
  return { permissions: permissions, allRoles: allRoles };
}

// SystemAdmin-only: set the effective role list for one permission key.
function updatePermission(user, p) {
  requireRole(user, [ROLES.SYSTEM_ADMIN]);
  if (!p || !p.key || !PERMISSION_REGISTRY_[p.key]) throw new HululError('BAD_REQUEST', 'A valid permission key is required');
  if (!p.roles || !p.roles.length) throw new HululError('BAD_REQUEST', 'At least one role must be allowed');
  var validRoles = Object.keys(ROLES).map(function (k) { return ROLES[k]; });
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
