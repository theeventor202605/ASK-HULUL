/**
 * HULUL - Roles.gs
 * REQ: "I need to have the functionality to create a new role." Clarified scope (explicit user
 * decisions): (1) a newly-created role's page/tab access should be FULLY DYNAMIC -- derived from
 * whatever the Settings > Permissions CRUD matrix grants it, no code change needed to onboard a role
 * (see getMyPageAccess, Permissions.gs, and pageIdForNavPath_/navItemVisible_, app.js); (2) who may
 * create accounts under a role, and which organization type (if any) it's tied to, are configurable
 * per role at creation time, not fixed to SystemAdmin-only; (3) a new role's starting permission
 * grants can be cloned from an existing role as a template.
 *
 * Custom roles live alongside the built-in ROLES enum (Utils.gs) -- a role CODE is just a string
 * everywhere it's used (Users.role, requireRole's allowedRoles arrays, requirePermission's overrides),
 * so a custom code works anywhere a built-in one does with zero changes to the enforcement layer
 * itself. This file only adds: a place to define/list/retire custom role codes (the Roles sheet), and
 * the small number of places that used to enumerate ONLY the built-in ROLES object and now need to
 * see custom ones too (the CRUD matrix's role picklist, and account-creation's canCreateRole check).
 */

// Active custom roles, parsed (creatableBy JSON -> real array). Built-in roles are NOT included here
// -- callers that need "every role, built-in and custom" should use allRolePicklist_ below.
function getCustomRoles_() {
  return findWhere('Roles', function (r) { return r.status === 'Active'; }).map(function (r) {
    var creatableBy = [];
    try { creatableBy = r.creatableBy ? JSON.parse(r.creatableBy) : []; } catch (e) { /* ignore malformed row */ }
    return {
      code: r.code, label: r.label, orgType: r.orgType || '', creatableBy: creatableBy, basedOnRole: r.basedOnRole || '',
      isParticipantType: r.isParticipantType === true || r.isParticipantType === 'true',
      isMandatoryOperator: r.isMandatoryOperator === true || r.isMandatoryOperator === 'true'
    };
  });
}

// Every role (built-in + active custom) as a {value, label} picklist -- same shape listPermissions
// already handed the frontend for ROLES alone, now just a superset. Used by listPermissions/
// updatePermission (Permissions.gs) so the CRUD matrix and its Save action both recognize custom
// role codes, not just the hardcoded enum.
function allRolePicklist_() {
  var builtin = Object.keys(ROLES).map(function (k) { return ROLES[k]; }).map(function (r) { return { value: r, label: roleLabel_(r) }; });
  var custom = getCustomRoles_().map(function (r) { return { value: r.code, label: r.label }; });
  return builtin.concat(custom);
}

function allRoleCodes_() {
  return allRolePicklist_().map(function (r) { return r.value; });
}

// Any authenticated user (not SystemAdmin-only) -- every account-creation form (SystemAdmin's New
// Account modal, but also an EMCAdmin/InspectionAdmin/etc.'s own, since a custom role's creatableBy
// might name any of them) needs to know which custom roles it's allowed to offer, and role codes/
// labels/org-type aren't sensitive information (every built-in role name is already visible in the
// UI to everyone).
function listCustomRoles(user) {
  if (!user) throw new HululError('UNAUTHENTICATED', 'Login required');
  return getCustomRoles_();
}

var ROLE_CODE_RESERVED_ = { '': 1 }; // guards against an empty generated code

function generateRoleCode_(label) {
  var base = String(label || '').trim().split(/\s+/).map(function (w) {
    return w.charAt(0).toUpperCase() + w.slice(1).replace(/[^a-zA-Z0-9]/g, '');
  }).join('').replace(/[^a-zA-Z0-9]/g, '');
  if (!base) base = 'Role';
  var existing = {};
  allRoleCodes_().forEach(function (c) { existing[c] = true; });
  // Also block codes belonging to a since-deactivated role -- never reissue a retired code, so old
  // AuditLog/permission-override entries referencing it can't be misread as meaning the new role.
  findWhere('Roles', function () { return true; }).forEach(function (r) { existing[r.code] = true; });
  if (!existing[base] && !ROLE_CODE_RESERVED_[base]) return base;
  var n = 2;
  while (existing[base + n]) n++;
  return base + n;
}

function validOrgType_(v) { return ['', 'GA', 'EMC', 'INSPECTION'].indexOf(v) !== -1; }

// SystemAdmin-only: define a new role. p: { label, orgType, creatableBy: [roleCode...], basedOnRole,
// isParticipantType }. basedOnRole (optional) clones that role's CURRENT effective permissions
// (defaults + any admin overrides already in place) as this role's starting grants in the CRUD matrix
// -- additive only (the new code is appended alongside whoever already had that permission, never
// replacing them). isParticipantType (optional, default false) -- REQ ("configurable Place/
// Participant types, allow adding others") -- makes this role selectable as a Place/Participant type
// (Venues > Places, Event > Participants) alongside the 3 built-in types, and folds it into every
// place that today only special-cases Vendor/Operator/Exhibitor (event chat blocking, escalation/
// meeting recipient exclusion -- see isParticipantRoleCode_ below).
function createRole(user, p) {
  requireRole(user, [ROLES.SYSTEM_ADMIN]);
  var label = String((p && p.label) || '').trim();
  if (!label) throw new HululError('BAD_REQUEST', 'A role name is required');
  var orgType = (p && p.orgType) || '';
  if (!validOrgType_(orgType)) throw new HululError('BAD_REQUEST', 'Invalid organization type');
  var validCodes = allRoleCodes_();
  var creatableBy = ((p && p.creatableBy) || []).filter(function (r) { return validCodes.indexOf(r) !== -1; });
  var basedOnRole = (p && p.basedOnRole) || '';
  if (basedOnRole && validCodes.indexOf(basedOnRole) === -1) basedOnRole = '';
  var isParticipantType = !!(p && p.isParticipantType);
  // REQ ("a security operator must be available in every event ... EMC just needs to set up their
  // accounts accordingly"): normally toggled later from Settings > Mandatory Operators, but accepted
  // here too so a role can be created already flagged in one step. Meaningless without
  // isParticipantType -- getMandatoryOperatorCompliance (Events.gs) only ever looks at roles where
  // both are true.
  var isMandatoryOperator = !!(p && p.isMandatoryOperator);

  var code = generateRoleCode_(label);
  var row = insertRow('Roles', {
    id: newId('Roles'), code: code, label: label, orgType: orgType,
    creatableBy: JSON.stringify(creatableBy), basedOnRole: basedOnRole,
    status: 'Active', createdBy: user.id, createdAt: nowIso_(), isParticipantType: isParticipantType,
    isMandatoryOperator: isMandatoryOperator
  });

  var clonedCount = 0;
  if (basedOnRole) {
    var overrides = getPermissionOverrides_();
    Object.keys(PERMISSION_REGISTRY_).forEach(function (key) {
      var effective = effectivePermissionRoles_(key, overrides);
      if (effective.indexOf(basedOnRole) === -1) return;
      var list = overrides[key] && overrides[key].length ? overrides[key].slice() : effective.slice();
      if (list.indexOf(code) === -1) { list.push(code); overrides[key] = list; clonedCount++; }
    });
    if (clonedCount) savePermissionOverrides_(user, overrides);
  }

  audit(user.id, 'CREATE_ROLE', 'Roles', row.id, { code: code, label: label, orgType: orgType, basedOnRole: basedOnRole, clonedPermissions: clonedCount, isParticipantType: isParticipantType, isMandatoryOperator: isMandatoryOperator });
  return { code: code, label: label, orgType: orgType, creatableBy: creatableBy, basedOnRole: basedOnRole, isParticipantType: isParticipantType, isMandatoryOperator: isMandatoryOperator };
}

// SystemAdmin-only: edit an existing CUSTOM role's label/orgType/creatableBy. Built-in roles (not in
// the Roles sheet at all) can't be targeted here -- there's nothing to look up, findWhere just
// returns no match and this throws NOT_FOUND, same as trying to edit any other nonexistent record.
function updateRole(user, p) {
  requireRole(user, [ROLES.SYSTEM_ADMIN]);
  var row = findWhere('Roles', function (r) { return r.code === (p && p.code) && r.status === 'Active'; })[0];
  if (!row) throw new HululError('NOT_FOUND', 'Role not found');
  var patch = {};
  if (p.label !== undefined) {
    var label = String(p.label).trim();
    if (!label) throw new HululError('BAD_REQUEST', 'A role name is required');
    patch.label = label;
  }
  if (p.orgType !== undefined) {
    if (!validOrgType_(p.orgType)) throw new HululError('BAD_REQUEST', 'Invalid organization type');
    patch.orgType = p.orgType;
  }
  if (p.creatableBy !== undefined) {
    var validCodes = allRoleCodes_();
    patch.creatableBy = JSON.stringify((p.creatableBy || []).filter(function (r) { return validCodes.indexOf(r) !== -1; }));
  }
  if (p.isParticipantType !== undefined) patch.isParticipantType = !!p.isParticipantType;
  var updated = updateRow('Roles', row.id, patch);
  audit(user.id, 'UPDATE_ROLE', 'Roles', row.id, patch);
  return {
    code: updated.code, label: updated.label, orgType: updated.orgType || '', creatableBy: JSON.parse(updated.creatableBy || '[]'),
    isParticipantType: updated.isParticipantType === true || updated.isParticipantType === 'true'
  };
}

// True for a Place/Participant "type" role -- the 3 built-in ones (Vendor/Operator/Exhibitor) plus any
// active custom role an admin flagged isParticipantType when creating/editing it (Settings > Roles).
// Used everywhere the app treats "any participant-account role" as a group instead of a hardcoded
// 3-item list -- event chat blocking (EventChat.gs), escalation/meeting recipient exclusion
// (Resolutions.gs, meetings.js) -- so a newly added custom type automatically gets the same treatment.
function isParticipantRoleCode_(code) {
  if (code === ROLES.VENDOR || code === ROLES.OPERATOR || code === ROLES.EXHIBITOR) return true;
  var row = findWhere('Roles', function (r) { return r.code === code && r.status === 'Active'; })[0];
  return !!(row && (row.isParticipantType === true || row.isParticipantType === 'true'));
}

// Every selectable Place/Participant type: the 4 built-ins (Vendor/Operator/Exhibitor each map to a
// real login role via mapParticipantRole_, Participants.gs; Other has no role of its own, falls back
// to Vendor there, same as before this feature existed) plus any active custom role flagged
// isParticipantType. Internal (no auth check) -- Places.gs's createPlace/updatePlace validate against
// this directly; listParticipantTypes below is the public, auth-checked endpoint wrapping it.
function participantTypes_() {
  var builtin = [
    { code: 'Operator', label: roleLabel_(ROLES.OPERATOR), builtin: true },
    { code: 'Vendor', label: roleLabel_(ROLES.VENDOR), builtin: true },
    { code: 'Exhibitor', label: roleLabel_(ROLES.EXHIBITOR), builtin: true },
    { code: 'Other', label: 'Other', builtin: true }
  ];
  var custom = getCustomRoles_().filter(function (r) { return r.isParticipantType; })
    .map(function (r) { return { code: r.code, label: r.label, builtin: false }; });
  return builtin.concat(custom);
}

// Open to any authenticated user -- same reasoning as listCustomRoles (type names aren't sensitive,
// and every Place/Participant create/edit form needs this list to build its type dropdown).
function listParticipantTypes(user) {
  if (!user) throw new HululError('UNAUTHENTICATED', 'Login required');
  return participantTypes_();
}

// SystemAdmin-only: retire a custom role. Soft-delete (status -> 'Inactive') rather than removing the
// row -- same reasoning as deactivateUser/Users.status -- so AuditLog entries and any lingering
// permission-override references to this code stay meaningful instead of pointing at a vanished row.
// Blocked while any Active user still holds this role: reassigning/deactivating those accounts first
// is the admin's call to make, not something this should do silently on their behalf.
function deleteRole(user, p) {
  requireRole(user, [ROLES.SYSTEM_ADMIN]);
  var row = findWhere('Roles', function (r) { return r.code === (p && p.code) && r.status === 'Active'; })[0];
  if (!row) throw new HululError('NOT_FOUND', 'Role not found');
  var holders = findWhere('Users', function (u) { return u.role === row.code && u.status === 'Active'; });
  if (holders.length) {
    throw new HululError('CONFLICT', holders.length + ' active user(s) still have this role -- reassign or deactivate them first');
  }
  updateRow('Roles', row.id, { status: 'Inactive' });
  audit(user.id, 'DELETE_ROLE', 'Roles', row.id, { code: row.code });
  return { ok: true };
}
