/**
 * HULUL - permissions.js (RBAC foundation, frontend half -- see backend/Permissions.gs)
 *
 * HululState.permissions is a plain { permissionKey: boolean } map for the SIGNED-IN user's own
 * role, fetched once per session (getMyPermissions) the same way loadAppIcons/loadOrgLabels cache
 * their own once-per-session fetches in app.js. hasPermission(key) is what views should call instead
 * of hardcoding a role-array check -- it stays in sync with whatever a SystemAdmin has configured in
 * Settings > Permissions without any frontend code change.
 *
 * Only the Findings/Risk Logging module is wired through this so far (the explicit "foundation +
 * pilot module" rollout) -- every other role check in the app still uses its own hardcoded array and
 * is unaffected by this file.
 */
function hasPermission(key) {
  return !!(window.HululState && HululState.permissions && HululState.permissions[key]);
}
