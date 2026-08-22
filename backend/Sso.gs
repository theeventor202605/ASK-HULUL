/**
 * HULUL - Sso.gs
 * REQ: "Add Login through MS Entra or google login."
 *
 * Design mirrors the existing bearer-token session model (Auth.gs's login/getUserByToken) exactly --
 * a successful Google/Microsoft sign-in mints the SAME kind of opaque Sessions row a password login
 * does (mintSsoSession_ below), so every other part of the app (Api.call's token header,
 * getUserByToken, hasPermission, ...) needs zero changes to support SSO.
 *
 * Account model: SSO is sign-IN only, never sign-UP. A Google/Microsoft sign-in is matched to an
 * existing, Active Users row by email (case-insensitive) -- exactly like password login's own lookup
 * in Auth.gs. No new Users row is ever created just because someone successfully authenticated with
 * Google/Microsoft; an unmatched email is rejected with a clear message telling them to contact their
 * SystemAdmin, the same "accounts are provisioned by an admin, not self-served" model this whole app
 * already uses for every other role (createUser, Accounts.gs).
 *
 * Config-backed, not hardcoded: Google/Microsoft Client IDs are NOT secrets (they're public OAuth
 * client identifiers, same as any browser-based SPA flow -- Google's and Microsoft's own docs say so
 * explicitly) so storing them in the Config sheet and returning them from a PUBLIC endpoint
 * (getSsoConfig) is safe; the login screen needs them before anyone is authenticated in order to even
 * initialize the Google/MSAL SDKs. See docs/SSO_SETUP.md for the step-by-step walkthrough a SystemAdmin
 * follows to obtain these IDs and paste them into Settings > Single Sign-On.
 *
 * REQ follow-up (own judgment call, flagged to the user): "replace password login entirely" is
 * honored via ssoPasswordLoginDisabled -- but it defaults to false and setSsoConfig refuses to turn it
 * on unless at least one provider is already enabled, so a SystemAdmin can never accidentally lock
 * every account out of the app before SSO is actually working. Once an admin has confirmed SSO signs
 * them in successfully, they flip this on themselves from Settings > Single Sign-On and the login
 * screen stops offering the password form to anyone.
 *
 * Multi-tenant Microsoft, deliberately: HULUL is used by multiple separate organizations (GA, EMC,
 * Inspection companies), each almost certainly its own Entra ID tenant -- so there is no single
 * Tenant ID that would work for everyone. The frontend (login.js) authenticates against the
 * `/organizations` multi-tenant authority instead of a specific tenant, meaning any Entra work/school
 * account can attempt to sign in. That's safe: findActiveUserByEmail_ below is the actual access
 * boundary regardless of which tenant authenticated someone -- their verified email still has to
 * match an existing, Active HULUL account an admin already provisioned, exactly like Google.
 */

var SSO_CONFIG_KEYS_ = {
  googleEnabled: 'ssoGoogleEnabled', googleClientId: 'ssoGoogleClientId',
  microsoftEnabled: 'ssoMicrosoftEnabled', microsoftClientId: 'ssoMicrosoftClientId',
  passwordLoginDisabled: 'ssoPasswordLoginDisabled'
};

function ssoConfigBool_(key) {
  var raw = getConfig(key, false);
  return raw === true || raw === 'true' || raw === 1 || raw === '1';
}

// PUBLIC (no auth) -- see PUBLIC_ACTIONS in Code.gs. The login screen calls this BEFORE anyone is
// signed in, to decide which button(s) to show and to initialize the Google/MSAL SDKs with the right
// Client ID. Only ever returns public-safe values (see this file's header comment).
function getSsoConfig() {
  return {
    googleEnabled: ssoConfigBool_(SSO_CONFIG_KEYS_.googleEnabled),
    googleClientId: getConfig(SSO_CONFIG_KEYS_.googleClientId, ''),
    microsoftEnabled: ssoConfigBool_(SSO_CONFIG_KEYS_.microsoftEnabled),
    microsoftClientId: getConfig(SSO_CONFIG_KEYS_.microsoftClientId, ''),
    passwordLoginDisabled: ssoConfigBool_(SSO_CONFIG_KEYS_.passwordLoginDisabled)
  };
}

// SystemAdmin-only -- same CONFIG_MANAGE_ROLES posture as Escalations/version-gap-days/resolution-
// evidence (Findings.gs), all plain Config-sheet settings gated the same simple way.
function setSsoConfig(user, p) {
  requireRole(user, [ROLES.SYSTEM_ADMIN]);
  if (!p) p = {};
  var googleEnabled = !!p.googleEnabled;
  var microsoftEnabled = !!p.microsoftEnabled;
  var passwordLoginDisabled = !!p.passwordLoginDisabled;
  var googleClientId = String(p.googleClientId || '').trim();
  var microsoftClientId = String(p.microsoftClientId || '').trim();

  if (googleEnabled && !googleClientId) throw new HululError('BAD_REQUEST', 'A Google Client ID is required to enable Google sign-in.');
  if (microsoftEnabled && !microsoftClientId) {
    throw new HululError('BAD_REQUEST', 'A Microsoft Application (client) ID is required to enable Microsoft sign-in.');
  }
  // The one guardrail that actually matters here: never let password login be disabled unless at
  // least one SSO provider would end up enabled by this same save -- otherwise a SystemAdmin could
  // lock every single account (including their own) out of the app with one click, with no way back
  // in short of editing the Config sheet directly. See this file's header comment.
  if (passwordLoginDisabled && !googleEnabled && !microsoftEnabled) {
    throw new HululError('BAD_REQUEST', 'Enable and configure at least one sign-in provider before disabling password login -- otherwise no one could sign in at all.');
  }

  setConfig(SSO_CONFIG_KEYS_.googleEnabled, googleEnabled);
  setConfig(SSO_CONFIG_KEYS_.googleClientId, googleClientId);
  setConfig(SSO_CONFIG_KEYS_.microsoftEnabled, microsoftEnabled);
  setConfig(SSO_CONFIG_KEYS_.microsoftClientId, microsoftClientId);
  setConfig(SSO_CONFIG_KEYS_.passwordLoginDisabled, passwordLoginDisabled);
  audit(user.id, 'SET_SSO_CONFIG', 'Config', 'sso', {
    googleEnabled: googleEnabled, microsoftEnabled: microsoftEnabled, passwordLoginDisabled: passwordLoginDisabled
  });
  return getSsoConfig();
}

// Verifies a Google Identity Services ID token server-side via Google's own tokeninfo endpoint --
// the standard lightweight verification path for a backend (like Apps Script) that has no JWT/JWKS
// library available. tokeninfo itself checks the signature, issuer and expiry; this only has to check
// the token was actually issued FOR our own Client ID (aud) and that the email is verified. Throws
// HululError on anything invalid; returns { email, name } on success.
function verifyGoogleIdToken_(idToken) {
  var clientId = getConfig(SSO_CONFIG_KEYS_.googleClientId, '');
  if (!ssoConfigBool_(SSO_CONFIG_KEYS_.googleEnabled) || !clientId) {
    throw new HululError('BAD_REQUEST', 'Google sign-in is not enabled for this organization.');
  }
  if (!idToken) throw new HululError('INVALID_CREDENTIALS', 'Missing Google credential.');
  var resp;
  try {
    resp = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), { muteHttpExceptions: true });
  } catch (e) {
    throw new HululError('SERVER_ERROR', 'Could not reach Google to verify sign-in. Please try again.');
  }
  if (resp.getResponseCode() !== 200) throw new HululError('INVALID_CREDENTIALS', 'Google sign-in could not be verified -- the credential may have expired. Please try again.');
  var payload;
  try { payload = JSON.parse(resp.getContentText()); } catch (e) { throw new HululError('INVALID_CREDENTIALS', 'Google sign-in could not be verified.'); }
  if (payload.aud !== clientId) throw new HululError('INVALID_CREDENTIALS', 'This Google sign-in was issued for a different application.');
  if (payload.email_verified !== 'true' && payload.email_verified !== true) {
    throw new HululError('INVALID_CREDENTIALS', 'Your Google account\'s email address is not verified.');
  }
  if (!payload.email) throw new HululError('INVALID_CREDENTIALS', 'Google did not provide an email address for this account.');
  return { email: payload.email, name: payload.name || '' };
}

// Verifies a Microsoft access token server-side by calling Microsoft Graph's own /me endpoint with
// it -- Graph rejects an invalid/expired/wrong-audience token on its own, so this doubles as both
// verification AND the authoritative source for the signed-in email, with no RS256/JWKS
// implementation needed in Apps Script (unlike Google, Entra ID tokens have no simple "tokeninfo"-
// style endpoint for arbitrary verification). userPrincipalName is used as the email fallback since
// Graph's own `mail` field is sometimes blank for accounts provisioned without a mailbox.
function verifyMicrosoftAccessToken_(accessToken) {
  var clientId = getConfig(SSO_CONFIG_KEYS_.microsoftClientId, '');
  if (!ssoConfigBool_(SSO_CONFIG_KEYS_.microsoftEnabled) || !clientId) {
    throw new HululError('BAD_REQUEST', 'Microsoft sign-in is not enabled for this organization.');
  }
  if (!accessToken) throw new HululError('INVALID_CREDENTIALS', 'Missing Microsoft credential.');
  var resp;
  try {
    resp = UrlFetchApp.fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: 'Bearer ' + accessToken }, muteHttpExceptions: true
    });
  } catch (e) {
    throw new HululError('SERVER_ERROR', 'Could not reach Microsoft to verify sign-in. Please try again.');
  }
  if (resp.getResponseCode() !== 200) throw new HululError('INVALID_CREDENTIALS', 'Microsoft sign-in could not be verified -- the credential may have expired. Please try again.');
  var profile;
  try { profile = JSON.parse(resp.getContentText()); } catch (e) { throw new HululError('INVALID_CREDENTIALS', 'Microsoft sign-in could not be verified.'); }
  var email = profile.mail || profile.userPrincipalName || '';
  if (!email) throw new HululError('INVALID_CREDENTIALS', 'Microsoft did not provide an email address for this account.');
  return { email: email, name: profile.displayName || '' };
}

// Same session-minting shape as login()/redeemQuickLogin() (Auth.gs/Places.gs) -- an SSO sign-in is
// indistinguishable from a password sign-in to the rest of the app from this point on.
function mintSsoSession_(user, provider) {
  var token = randomToken_(32);
  var now = new Date();
  var expires = new Date(now.getTime() + SESSION_TTL_HOURS * 3600 * 1000);
  insertRow('Sessions', { token: token, userId: user.id, createdAt: now.toISOString(), expiresAt: expires.toISOString() });
  updateRow('Users', user.id, { lastLoginAt: now.toISOString() });
  audit(user.id, 'SSO_LOGIN', 'Users', user.id, { provider: provider });
  return { token: token, user: stripSecrets_(user) };
}

// Looks up the one Active Users row matching this email -- SSO never creates an account, only signs
// into one an admin already provisioned (see this file's header comment).
function findActiveUserByEmail_(email) {
  var user = findWhere('Users', function (u) { return u.email.toLowerCase() === String(email).toLowerCase(); })[0];
  if (!user) {
    throw new HululError('INVALID_CREDENTIALS', 'No HULUL account was found for ' + email + '. Contact your SystemAdmin to have one created.');
  }
  if (user.status !== 'Active') throw new HululError('ACCOUNT_INACTIVE', 'This account is suspended or deactivated');
  return user;
}

// PUBLIC (no auth) -- see PUBLIC_ACTIONS in Code.gs. p.idToken is the Google Identity Services
// credential from the frontend's Sign in with Google button (see login.js).
function loginWithGoogle(p) {
  var identity = verifyGoogleIdToken_(p && p.idToken);
  var user = findActiveUserByEmail_(identity.email);
  return mintSsoSession_(user, 'google');
}

// PUBLIC (no auth) -- see PUBLIC_ACTIONS in Code.gs. p.accessToken is the Microsoft Graph access
// token MSAL.js returned from the frontend's Sign in with Microsoft button (see login.js).
function loginWithMicrosoft(p) {
  var identity = verifyMicrosoftAccessToken_(p && p.accessToken);
  var user = findActiveUserByEmail_(identity.email);
  return mintSsoSession_(user, 'microsoft');
}
