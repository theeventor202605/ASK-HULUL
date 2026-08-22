/**
 * HULUL - Login screen SSO wiring (Google Identity Services + Microsoft MSAL).
 * REQ: "Add Login through MS Entra or google login."
 *
 * initSsoLogin_() is called once from wireChrome() (app.js), the same lifecycle point the
 * password-login <form> submit handler is wired at (see index.html: #ssoButtonsWrap, #ssoDivider,
 * #passwordLoginBlock, #ssoNoAccessNotice). It fetches getSsoConfig (public, Sso.gs) and:
 *   - renders a "Sign in with Google" button via Google Identity Services, if configured+enabled
 *   - renders a "Sign in with Microsoft" button wired to MSAL's loginPopup, if configured+enabled
 *   - shows the "or" divider only when at least one SSO button AND the password form are visible
 *   - hides #passwordLoginBlock (and the divider) once ssoPasswordLoginDisabled is on (Settings >
 *     Single Sign-On) -- see Sso.gs's header comment for why that flag defaults off/coexisting
 *   - falls back to #ssoNoAccessNotice in the edge case (guarded against server-side in
 *     setSsoConfig, but handled here too) where password login is disabled and no provider ended
 *     up enabled either
 *
 * Both onGoogleCredential_ and msalLoginPopup_'s success path mirror wireChrome's own password-
 * login submit handler (app.js) exactly: HululState.setSession(...) -> #/dashboard ->
 * Router.resolve(), with the same #loginError box used for failures.
 */

var msalInstance_ = null;

async function initSsoLogin_() {
  var wrap = document.getElementById('ssoButtonsWrap');
  var divider = document.getElementById('ssoDivider');
  var passwordBlock = document.getElementById('passwordLoginBlock');
  var noticeBox = document.getElementById('ssoNoAccessNotice');

  var cfg;
  try {
    cfg = await Api.call('getSsoConfig', {});
  } catch (err) {
    // Can't reach the backend yet -- leave the password form as the only option, exactly like
    // before this feature existed. The normal login submit handler surfaces the same connectivity
    // error the moment the user tries it anyway.
    return;
  }

  var anyProvider = false;

  if (cfg.googleEnabled && cfg.googleClientId && window.google && window.google.accounts && window.google.accounts.id) {
    var googleSlot = document.createElement('div');
    wrap.appendChild(googleSlot);
    try {
      window.google.accounts.id.initialize({ client_id: cfg.googleClientId, callback: onGoogleCredential_ });
      window.google.accounts.id.renderButton(googleSlot, { theme: 'outline', size: 'large', width: 320, text: 'signin_with' });
      anyProvider = true;
    } catch (err) { googleSlot.remove(); /* GIS failed to init (e.g. blocked script) -- just don't show the button */ }
  }

  if (cfg.microsoftEnabled && cfg.microsoftClientId && window.msal) {
    try {
      // /organizations (not a specific tenant) -- REQ follow-up: "would someone from a different
      // company's Entra tenant still be able to sign in." HULUL is used by multiple separate
      // organizations (GA, EMC, Inspection companies), each its own Entra tenant, so there's no
      // single Tenant ID that would work for everyone. Any Entra work/school account can attempt
      // to authenticate here -- findActiveUserByEmail_ (Sso.gs) is the real access boundary
      // regardless of which tenant they came from, same as Google.
      msalInstance_ = new msal.PublicClientApplication({
        auth: { clientId: cfg.microsoftClientId, authority: 'https://login.microsoftonline.com/organizations' }
      });
      var msBtn = document.createElement('button');
      msBtn.type = 'button';
      msBtn.className = 'btn btn-ms-signin';
      msBtn.textContent = t('sso_sign_in_microsoft');
      msBtn.onclick = msalLoginPopup_;
      wrap.appendChild(msBtn);
      anyProvider = true;
    } catch (err) { msalInstance_ = null; /* MSAL failed to init -- just don't show the button */ }
  }

  wrap.classList.toggle('hidden', !anyProvider);

  if (cfg.passwordLoginDisabled) {
    passwordBlock.classList.add('hidden');
    divider.classList.add('hidden');
    noticeBox.classList.toggle('hidden', anyProvider);
  } else {
    divider.classList.toggle('hidden', !anyProvider);
    noticeBox.classList.add('hidden');
  }
}

async function onGoogleCredential_(response) {
  var errBox = document.getElementById('loginError');
  errBox.classList.add('hidden');
  try {
    var res = await Api.call('loginWithGoogle', { idToken: response.credential });
    HululState.setSession(res.token, res.user);
    window.location.hash = '#/dashboard';
    Router.resolve();
  } catch (err) {
    errBox.textContent = err.message || t('toast_login_failed');
    errBox.classList.remove('hidden');
  }
}

// Wired as msBtn.onclick above, so `this` is the button itself -- same disable-during-request /
// re-enable-only-on-failure guard the password form's submit button uses (wireChrome, app.js).
async function msalLoginPopup_() {
  if (this.disabled) return;
  this.disabled = true;
  var errBox = document.getElementById('loginError');
  errBox.classList.add('hidden');
  try {
    var result = await msalInstance_.loginPopup({ scopes: ['User.Read'] });
    var res = await Api.call('loginWithMicrosoft', { accessToken: result.accessToken });
    HululState.setSession(res.token, res.user);
    window.location.hash = '#/dashboard';
    Router.resolve();
  } catch (err) {
    // MSAL's own errors use an `errorMessage` field (e.g. popup closed by the user) rather than
    // `.message` -- Api.call's errors already use `.message`, same as every other failure path on
    // this screen, so fall back across both.
    errBox.textContent = (err && (err.message || err.errorMessage)) || t('toast_login_failed');
    errBox.classList.remove('hidden');
    this.disabled = false;
  }
}
