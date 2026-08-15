/**
 * HULUL - Auth.gs
 * Custom email/password auth (no Google Sign-In dependency, since the frontend
 * is a separate static site on GitHub Pages calling this Web App as a JSON API).
 * Tokens are opaque random strings stored in the Sessions sheet (bearer-token model).
 */

var SESSION_TTL_HOURS = 12;

function hashPassword_(password, salt) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + password);
  return raw.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

function randomToken_(bytes) {
  var raw = [];
  for (var i = 0; i < (bytes || 32); i++) raw.push(Math.floor(Math.random() * 256));
  return raw.map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join('') + Date.now().toString(36);
}

function createUserWithPassword(userObj, plainPassword) {
  var salt = randomToken_(16);
  userObj.passwordSalt = salt;
  userObj.passwordHash = hashPassword_(plainPassword, salt);
  userObj.id = userObj.id || newId('Users');
  userObj.createdAt = nowIso_();
  userObj.status = userObj.status || 'Active';
  insertRow('Users', userObj);
  return userObj;
}

function login(email, password) {
  var user = findWhere('Users', function (u) { return u.email.toLowerCase() === String(email).toLowerCase(); })[0];
  if (!user) throw new HululError('INVALID_CREDENTIALS', 'Invalid email or password');
  if (user.status !== 'Active') throw new HululError('ACCOUNT_INACTIVE', 'This account is suspended or deactivated');
  var hash = hashPassword_(password, user.passwordSalt);
  if (hash !== user.passwordHash) throw new HululError('INVALID_CREDENTIALS', 'Invalid email or password');

  var token = randomToken_(32);
  var now = new Date();
  var expires = new Date(now.getTime() + SESSION_TTL_HOURS * 3600 * 1000);
  insertRow('Sessions', { token: token, userId: user.id, createdAt: now.toISOString(), expiresAt: expires.toISOString() });
  updateRow('Users', user.id, { lastLoginAt: now.toISOString() });
  audit(user.id, 'LOGIN', 'Users', user.id, {});

  var safeUser = Object.assign({}, user);
  delete safeUser.passwordHash;
  delete safeUser.passwordSalt;
  return { token: token, user: safeUser };
}

function logout(token) {
  deleteRow('Sessions', token, 'token');
  return { ok: true };
}

function getUserByToken(token) {
  if (!token) throw new HululError('UNAUTHENTICATED', 'Missing auth token');
  var session = getById('Sessions', token, 'token');
  if (!session) throw new HululError('UNAUTHENTICATED', 'Invalid or expired session');
  if (new Date(session.expiresAt) < new Date()) {
    deleteRow('Sessions', token, 'token');
    throw new HululError('UNAUTHENTICATED', 'Session expired, please log in again');
  }
  var user = getById('Users', session.userId);
  if (!user || user.status !== 'Active') throw new HululError('UNAUTHENTICATED', 'Account no longer active');
  var safeUser = Object.assign({}, user);
  delete safeUser.passwordHash;
  delete safeUser.passwordSalt;
  return safeUser;
}

function changePassword(userId, oldPassword, newPassword) {
  var user = getById('Users', userId);
  if (!user) throw new HululError('NOT_FOUND', 'User not found');
  if (hashPassword_(oldPassword, user.passwordSalt) !== user.passwordHash) {
    throw new HululError('INVALID_CREDENTIALS', 'Current password is incorrect');
  }
  var salt = randomToken_(16);
  updateRow('Users', userId, { passwordSalt: salt, passwordHash: hashPassword_(newPassword, salt) });
  audit(userId, 'CHANGE_PASSWORD', 'Users', userId, {});
  return { ok: true };
}

function adminResetPassword(actingUser, targetUserId, newPassword) {
  requirePermission(actingUser, 'user.resetPassword'); // RBAC pilot -- same default roles as before, no behavior change
  var salt = randomToken_(16);
  updateRow('Users', targetUserId, { passwordSalt: salt, passwordHash: hashPassword_(newPassword, salt) });
  audit(actingUser.id, 'RESET_PASSWORD', 'Users', targetUserId, {});
  // Security-sensitive: the affected user should always know their password was changed, even
  // though they didn't do it themselves -- notify_ is defined in Notifications.gs, which loads
  // after Auth.gs alphabetically, but this only runs inside a function body (not at file-load
  // time), so the load-order restriction that applies to top-level code doesn't apply here.
  notify_(targetUserId, 'PASSWORD_RESET', 'Your password was reset by an administrator. If this wasn\'t you, contact your organization admin.', 'Users', targetUserId, '');
  return { ok: true };
}

// ---- RBAC -----------------------------------------------------------------
// Section 5.1 account hierarchy: who may create which accounts.
var ACCOUNT_CREATION_MATRIX = {
  SystemAdmin: ['GAAdmin', 'EMCAdmin', 'InspectionAdmin', 'SystemAdmin', 'SupportAgent'],
  GAAdmin: ['GAUser'],
  EMCAdmin: ['EventManager', 'EMCManager', 'EMCAnalyst', 'Operator', 'Vendor'],
  InspectionAdmin: ['ProjectManager', 'InspectionAnalyst', 'Inspector'],
  EventManager: ['Vendor', 'Operator', 'Exhibitor'],
  Inspector: ['Vendor', 'Operator', 'Exhibitor']
};

// contextOrgId (optional): when given, and the caller lacks permission, we look up active
// users at that org already holding one of the allowed roles so the error can name exactly
// who to ask, instead of just which role is missing.
function requireRole(user, allowedRoles, contextOrgId) {
  if (!user) throw new HululError('UNAUTHENTICATED', 'Login required');
  if (allowedRoles.indexOf(user.role) === -1) {
    var labels = allowedRoles.map(roleLabel_);
    var contacts = [];
    if (contextOrgId) {
      contacts = findWhere('Users', function (u) {
        return u.orgId === contextOrgId && u.status === 'Active' && allowedRoles.indexOf(u.role) !== -1;
      }).map(function (u) { return { name: u.name, email: u.email, role: roleLabel_(u.role) }; });
    }
    var err = new HululError('FORBIDDEN', 'This action can only be performed by: ' + labels.join(' or ') + '.');
    err.allowedRoles = labels;
    if (contacts.length) err.contacts = contacts;
    throw err;
  }
  return user;
}

function canCreateRole(actingRole, targetRole) {
  var allowed = ACCOUNT_CREATION_MATRIX[actingRole] || [];
  return allowed.indexOf(targetRole) !== -1;
}

// Org-scoping: everything except SystemAdmin belongs to exactly one org (REQ-ACC-11).
// This enforces "own org / own event" visibility for list endpoints.
function scopeToOrg(user, rows, orgField) {
  orgField = orgField || 'orgId';
  if (user.role === ROLES.SYSTEM_ADMIN) return rows;
  return rows.filter(function (r) { return String(r[orgField]) === String(user.orgId); });
}
