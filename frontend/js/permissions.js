/**
 * HULUL - permissions.js (RBAC foundation, frontend half -- see backend/Permissions.gs)
 *
 * HululState.permissions is a plain { permissionKey: boolean } map for the SIGNED-IN user's own
 * role, fetched once per session (getMyPermissions) the same way loadAppIcons/loadOrgLabels cache
 * their own once-per-session fetches in app.js. hasPermission(key) is what views should call instead
 * of hardcoding a role-array check -- it stays in sync with whatever a SystemAdmin has configured in
 * Settings > Permissions without any frontend code change.
 *
 * Most backend modules are wired through requirePermission by now (see the header comment in
 * backend/Permissions.gs for the current list) -- a handful of frontend call sites still gate their
 * own buttons/forms with a hardcoded role array instead of hasPermission(key), which is a real gap
 * for a brand-new custom role (Roles.gs): the backend will correctly allow the action, but a button
 * gated by an old hardcoded array won't show up to offer it. Not attempted as one sweep here -- flag
 * and fix these opportunistically as they're found, same as any other pre-existing hardcoded check.
 *
 * HululState.pageAccess (getMyPageAccess, backend/Permissions.gs) is the same idea one level up --
 * which whole PAGES/tabs the signed-in role can see at all -- see navItemVisible_ (app.js).
 */
function hasPermission(key) {
  return !!(window.HululState && HululState.permissions && HululState.permissions[key]);
}
