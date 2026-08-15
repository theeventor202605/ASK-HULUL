/**
 * HULUL - Accounts.gs  (REQ-ACC-01..12)
 * Account hierarchy: SystemAdmin -> {GAAdmin, EMCAdmin, InspectionAdmin} -> org users -> participants.
 */

function listUsers(user, p) {
  requirePermission(user, 'user.list'); // RBAC pilot -- same default roles as before, no behavior change
  var all = getAll('Users').map(stripSecrets_);
  if (p && p.orgId) all = all.filter(function (u) { return String(u.orgId) === String(p.orgId); });
  if (p && p.role) all = all.filter(function (u) { return u.role === p.role; });
  return scopeToOrg(user, all);
}

function stripSecrets_(u) {
  var c = Object.assign({}, u);
  delete c.passwordHash; delete c.passwordSalt;
  return c;
}

function createUser(actingUser, p) {
  if (!canCreateRole(actingUser.role, p.role)) {
    throw new HululError('FORBIDDEN', actingUser.role + ' cannot create a ' + p.role + ' account');
  }
  if (!p.email || !p.name || !p.password) throw new HululError('BAD_REQUEST', 'name, email, and password are required');
  if (findWhere('Users', function (u) { return u.email.toLowerCase() === p.email.toLowerCase(); }).length > 0) {
    throw new HululError('CONFLICT', 'A user with this email already exists');
  }
  // Non-admin creators can only create accounts within their own organisation (REQ-ACC-11).
  var orgId = (actingUser.role === ROLES.SYSTEM_ADMIN) ? (p.orgId || '') : actingUser.orgId;
  var orgType = (actingUser.role === ROLES.SYSTEM_ADMIN) ? (p.orgType || '') : actingUser.orgType;

  var user = createUserWithPassword({
    id: newId('Users'), name: p.name, email: p.email, orgType: orgType, orgId: orgId,
    role: p.role, status: 'Active', createdBy: actingUser.id
  }, p.password);

  audit(actingUser.id, 'CREATE_USER', 'Users', user.id, { role: p.role, orgId: orgId });
  return stripSecrets_(user);
}

function updateUserAccount(actingUser, p) {
  var target = getById('Users', p.userId);
  if (!target) throw new HululError('NOT_FOUND', 'User not found');
  assertCanManage_(actingUser, target);
  var patch = {};
  ['name', 'email', 'role'].forEach(function (f) { if (p[f] !== undefined) patch[f] = p[f]; });
  var updated = updateRow('Users', p.userId, patch);
  audit(actingUser.id, 'UPDATE_USER', 'Users', p.userId, patch);
  return stripSecrets_(updated);
}

function deactivateUser(actingUser, targetUserId) {
  var target = getById('Users', targetUserId);
  if (!target) throw new HululError('NOT_FOUND', 'User not found');
  assertCanManage_(actingUser, target);
  var updated = updateRow('Users', targetUserId, { status: 'Inactive' });
  audit(actingUser.id, 'DEACTIVATE_USER', 'Users', targetUserId, {});
  // notify_ still emails a deactivated user even though they can no longer log in to see the
  // in-app copy (getUserByToken requires status === 'Active') -- MailApp doesn't check that.
  notify_(targetUserId, 'ACCOUNT_DEACTIVATED', 'Your account has been deactivated.', 'Users', targetUserId, '');
  return stripSecrets_(updated);
}

function activateUser(actingUser, targetUserId) {
  var target = getById('Users', targetUserId);
  if (!target) throw new HululError('NOT_FOUND', 'User not found');
  assertCanManage_(actingUser, target);
  var updated = updateRow('Users', targetUserId, { status: 'Active' });
  audit(actingUser.id, 'ACTIVATE_USER', 'Users', targetUserId, {});
  notify_(targetUserId, 'ACCOUNT_ACTIVATED', 'Your account has been reactivated. You can log in again.', 'Users', targetUserId, '');
  return stripSecrets_(updated);
}

// REQ-ACC-12: suspended/deactivated by the admin level that created it, or any higher-privilege role.
function assertCanManage_(actingUser, target) {
  if (actingUser.role === ROLES.SYSTEM_ADMIN) return true;
  if (target.createdBy === actingUser.id) return true;
  var adminRoles = [ROLES.GA_ADMIN, ROLES.EMC_ADMIN, ROLES.INSPECTION_ADMIN];
  if (adminRoles.indexOf(actingUser.role) !== -1 && actingUser.orgId === target.orgId) return true;
  throw new HululError('FORBIDDEN', 'Not permitted to manage this account');
}

function listOrganizations(user) {
  requirePermission(user, 'organization.list'); // RBAC pilot -- same default roles as before, no behavior change
  return getAll('Organizations');
}

function createOrganization(user, p) {
  requireRole(user, [ROLES.SYSTEM_ADMIN]);
  if (!p.name || !p.type) throw new HululError('BAD_REQUEST', 'name and type are required');
  var org = { id: newId('Organizations'), type: p.type, name: p.name, status: 'Active', createdAt: nowIso_(), logoUrl: '', domain: (p.domain || '').trim().toLowerCase() };
  insertRow('Organizations', org);
  audit(user.id, 'CREATE_ORG', 'Organizations', org.id, { type: p.type });
  return org;
}

// Domain is used to build auto-generated Place-account login emails (see placeAccountDomain_ in
// Places.gs) -- e.g. set once to 'yawad.sa' on the Yawad EMC. Left blank, that helper falls back to
// slugifying the org's name instead.
function updateOrganizationDomain(user, p) {
  requireRole(user, [ROLES.SYSTEM_ADMIN]);
  var org = getById('Organizations', p.orgId);
  if (!org) throw new HululError('NOT_FOUND', 'Organization not found');
  var updated = updateRow('Organizations', p.orgId, { domain: String(p.domain || '').trim().toLowerCase() });
  audit(user.id, 'UPDATE_ORG_DOMAIN', 'Organizations', p.orgId, { domain: updated.domain });
  return updated;
}

// Minimal, permission-light lookup used to show "your organization"'s logo in the app chrome on
// every page. Deliberately open to any authenticated user (unlike listOrganizations, which is
// restricted) since it only exposes the name + logo of the org the user already belongs to.
function getMyOrg(user) {
  if (!user.orgId) return null;
  var org = getById('Organizations', user.orgId);
  if (!org) return null;
  return { id: org.id, name: org.name, logoUrl: org.logoUrl || '' };
}

// GA + Inspection Company logos for one Event, used to stamp Risk Logging evidence photos (see
// EvidenceCapture in evidence.js). Deliberately open to any authenticated user (unlike
// listOrganizations, which excludes Inspector -- and Inspectors are exactly who's capturing these
// photos) since logos aren't sensitive. Returned as base64 data URIs rather than the stored
// drive.google.com/thumbnail links: those links don't send permissive CORS headers, so drawing them
// into a <canvas> (needed to composite the watermark) would taint the canvas and block exporting the
// finished photo entirely. Reading the same Drive file server-side and inlining its bytes sidesteps
// that -- the browser never makes a cross-origin request for the logo at all.
function getEventBrandingLogos(user, p) {
  var event = getById('Events', p.eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');
  var ga = findWhere('Organizations', function (o) { return o.type === 'GA'; })[0];
  var inspectionCo = event.inspectionCoId ? getById('Organizations', event.inspectionCoId) : null;
  return {
    gaLogoDataUri: ga ? logoDataUri_(ga.logoUrl) : '',
    inspectionCoLogoDataUri: inspectionCo ? logoDataUri_(inspectionCo.logoUrl) : ''
  };
}

function driveFileIdFromThumbnailUrl_(url) {
  var m = String(url || '').match(/[?&]id=([^&]+)/);
  return m ? m[1] : '';
}

function logoDataUri_(logoUrl) {
  var fileId = driveFileIdFromThumbnailUrl_(logoUrl);
  if (!fileId) return '';
  try {
    var blob = DriveApp.getFileById(fileId).getBlob();
    return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
  } catch (e) {
    return ''; // deleted/inaccessible file -- watermarking just skips this logo rather than failing
  }
}

// SystemAdmin uploads/replaces the logo shown across the app for a GA, EMC, or Inspection
// Company. Stored in Drive the same way Template uploads are (REQ-TPL-03/04) — a shared,
// publicly-viewable file whose URL is saved on the Organization record.
function uploadOrgLogo(user, p) {
  requireRole(user, [ROLES.SYSTEM_ADMIN]);
  var org = getById('Organizations', p.orgId);
  if (!org) throw new HululError('NOT_FOUND', 'Organization not found');
  if (!p.fileBase64) throw new HululError('BAD_REQUEST', 'fileBase64 is required');
  var folder = getOrCreateFolder_('HULUL Org Logos');
  var blob = Utilities.newBlob(Utilities.base64Decode(p.fileBase64), p.mimeType || 'image/png', p.fileName || (org.name + ' logo'));
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  // The old "uc?export=view" hotlink format is unreliable for <img> embedding — Google frequently
  // serves an interstitial/warning page instead of the raw image bytes. The thumbnail endpoint is
  // the one that reliably works for embedding a publicly-shared Drive file as an image.
  var logoUrl = 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w400';
  var updated = updateRow('Organizations', p.orgId, { logoUrl: logoUrl });
  audit(user.id, 'UPLOAD_ORG_LOGO', 'Organizations', p.orgId, {});
  return updated;
}

// ---- Custom terminology (per-org) -----------------------------------------
// Lets each org rename the platform's core object names for their own users — e.g. a GA that
// calls Events "Projects" internally. Purely a display-label override: nothing about the
// underlying data model, sheet names, or routes changes. Scoped per-org, not global: each user
// only ever sees the labels their own org set (or the built-in defaults if their org hasn't set
// any), so an Inspection Company working across multiple GA clients isn't affected by any one
// client's relabeling.
// Any authenticated user can read their own org's labels (needed to render the UI); no separate
// permission check beyond being logged in, mirroring getMyOrg's reasoning above. SystemAdmin may
// pass p.orgId to look up a specific org's labels (e.g. to prefill the Terminology editor for an
// org they don't themselves belong to) — everyone else always gets their own org's labels.
function getOrgLabels(user, p) {
  var orgId = (user.role === ROLES.SYSTEM_ADMIN && p && p.orgId) ? p.orgId : user.orgId;
  if (!orgId) return {};
  var row = findWhere('OrgLabels', function (l) { return l.orgId === orgId; })[0];
  if (!row || !row.labelsJson) return {};
  try { return JSON.parse(row.labelsJson); } catch (e) { return {}; }
}

// Only the org's own admin-type role (or SystemAdmin) may change its labels; always scoped to the
// acting user's own org (SystemAdmin must pass p.orgId explicitly since they may not belong to one).
function setOrgLabels(user, p) {
  requirePermission(user, 'orgLabels.manage'); // RBAC pilot -- same default roles as before, no behavior change
  var orgId = user.role === ROLES.SYSTEM_ADMIN ? (p.orgId || user.orgId) : user.orgId;
  if (!orgId) throw new HululError('BAD_REQUEST', 'orgId is required');
  if (!p.labels || typeof p.labels !== 'object') throw new HululError('BAD_REQUEST', 'labels object is required');
  // Drop empty/whitespace-only overrides so clearing a field reverts it to the built-in default
  // instead of persisting an empty string as the "custom" label.
  var clean = {};
  Object.keys(p.labels).forEach(function (k) {
    var v = String(p.labels[k] || '').trim();
    if (v) clean[k] = v;
  });
  var existing = findWhere('OrgLabels', function (l) { return l.orgId === orgId; })[0];
  var row = { orgId: orgId, labelsJson: JSON.stringify(clean), updatedAt: nowIso_(), updatedBy: user.id };
  if (existing) updateRow('OrgLabels', existing.id, row);
  else insertRow('OrgLabels', Object.assign({ id: newId('OrgLabels') }, row));
  audit(user.id, 'SET_ORG_LABELS', 'OrgLabels', orgId, { count: Object.keys(clean).length });
  return clean;
}

// SystemAdmin-only, single global row (id 'GLOBAL') overriding the sidebar's nav icons app-wide --
// distinct from getOrgLabels/setOrgLabels above, which are per-org terminology overrides. Any
// authenticated user may READ these (needed to render their own sidebar); only SystemAdmin may
// change them, since nav icons are a platform-wide look, not something each org controls for
// itself. Keyed by NAV_ITEMS' own path (e.g. '/events') on the frontend side.
function getAppIcons(user, p) {
  var row = findWhere('AppIcons', function (r) { return r.id === 'GLOBAL'; })[0];
  if (!row || !row.iconsJson) return {};
  try { return JSON.parse(row.iconsJson); } catch (e) { return {}; }
}

function setAppIcons(user, p) {
  requireRole(user, [ROLES.SYSTEM_ADMIN]);
  if (!p.icons || typeof p.icons !== 'object') throw new HululError('BAD_REQUEST', 'icons object is required');
  // Drop empty overrides so clearing a pick reverts it to the built-in default rather than
  // persisting an empty string as the "custom" icon -- same rule setOrgLabels uses above.
  var clean = {};
  Object.keys(p.icons).forEach(function (k) {
    var v = String(p.icons[k] || '').trim();
    if (v) clean[k] = v;
  });
  var existing = findWhere('AppIcons', function (r) { return r.id === 'GLOBAL'; })[0];
  var row = { iconsJson: JSON.stringify(clean), updatedAt: nowIso_(), updatedBy: user.id };
  if (existing) updateRow('AppIcons', existing.id, row);
  else insertRow('AppIcons', Object.assign({ id: 'GLOBAL' }, row));
  audit(user.id, 'SET_APP_ICONS', 'AppIcons', 'GLOBAL', { count: Object.keys(clean).length });
  return clean;
}

// Custom emoji/glyph sets a SystemAdmin can import (paste/upload) so the icon picker isn't limited
// to the curated ICON_LIBRARY (icons.js) -- e.g. an org's own brand emoji set. Stored alongside the
// nav/semantic icon overrides above, on the SAME 'GLOBAL' row (one more JSON-blob column), since
// this is app-wide platform config too, not per-org. Any authenticated user may READ (needed to
// render the picker); only SystemAdmin may add/delete a library.
function getCustomIconLibraries(user, p) {
  var row = findWhere('AppIcons', function (r) { return r.id === 'GLOBAL'; })[0];
  if (!row || !row.customLibrariesJson) return [];
  try { return JSON.parse(row.customLibrariesJson) || []; } catch (e) { return []; }
}

function addCustomIconLibrary(user, p) {
  requireRole(user, [ROLES.SYSTEM_ADMIN]);
  var name = String((p && p.name) || '').trim();
  if (!name) throw new HululError('BAD_REQUEST', 'name is required');
  var icons = Array.isArray(p && p.icons) ? p.icons : [];
  var seen = {};
  icons = icons.map(function (ic) { return String(ic || '').trim(); }).filter(function (ic) {
    if (!ic || seen[ic]) return false;
    seen[ic] = true;
    return true;
  });
  if (!icons.length) throw new HululError('BAD_REQUEST', 'At least one icon is required');
  var existing = findWhere('AppIcons', function (r) { return r.id === 'GLOBAL'; })[0];
  var libs = [];
  if (existing && existing.customLibrariesJson) {
    try { libs = JSON.parse(existing.customLibrariesJson) || []; } catch (e) { libs = []; }
  }
  libs.push({ id: Utilities.getUuid(), name: name, icons: icons, createdAt: nowIso_(), createdBy: user.id });
  var row = { customLibrariesJson: JSON.stringify(libs), updatedAt: nowIso_(), updatedBy: user.id };
  if (existing) updateRow('AppIcons', existing.id, row);
  else insertRow('AppIcons', Object.assign({ id: 'GLOBAL' }, row));
  audit(user.id, 'ADD_CUSTOM_ICON_LIBRARY', 'AppIcons', 'GLOBAL', { name: name, count: icons.length });
  return libs;
}

function deleteCustomIconLibrary(user, p) {
  requireRole(user, [ROLES.SYSTEM_ADMIN]);
  if (!p || !p.libraryId) throw new HululError('BAD_REQUEST', 'libraryId is required');
  var existing = findWhere('AppIcons', function (r) { return r.id === 'GLOBAL'; })[0];
  var libs = [];
  if (existing && existing.customLibrariesJson) {
    try { libs = JSON.parse(existing.customLibrariesJson) || []; } catch (e) { libs = []; }
  }
  var next = libs.filter(function (lib) { return lib.id !== p.libraryId; });
  if (next.length === libs.length) throw new HululError('NOT_FOUND', 'Icon library not found');
  var row = { customLibrariesJson: JSON.stringify(next), updatedAt: nowIso_(), updatedBy: user.id };
  if (existing) updateRow('AppIcons', existing.id, row);
  else insertRow('AppIcons', Object.assign({ id: 'GLOBAL' }, row));
  audit(user.id, 'DELETE_CUSTOM_ICON_LIBRARY', 'AppIcons', 'GLOBAL', { libraryId: p.libraryId });
  return next;
}

// REQ-ACC-10: immutable audit trail.
function listAuditLog(user, p) {
  requirePermission(user, 'auditLog.view'); // RBAC pilot -- same default roles as before, no behavior change
  var all = getAll('AuditLog').sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
  if (p && p.targetType) all = all.filter(function (a) { return a.targetType === p.targetType; });
  return all.slice(0, (p && p.limit) || 200);
}
