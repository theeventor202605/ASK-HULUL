/**
 * HULUL - API client.
 * Talks to the Apps Script Web App. Uses POST with Content-Type: text/plain
 * to keep requests "simple" (no CORS preflight, which Apps Script can't handle).
 */
window.Api = {
  async call(action, payload) {
    var body = JSON.stringify({ action: action, payload: payload || {}, token: HululState.token });
    var res = await fetch(window.HULUL_CONFIG.API_BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: body
    });
    var json;
    try { json = await res.json(); }
    catch (e) { throw new Error('Unexpected response from server. Check API_BASE_URL in config.js.'); }
    if (!json.ok) {
      var err = new Error(json.error ? json.error.message : 'Request failed');
      err.code = json.error ? json.error.code : 'UNKNOWN';
      err.allowedRoles = json.error && json.error.allowedRoles;
      err.contacts = json.error && json.error.contacts;
      if (err.code === 'UNAUTHENTICATED') { HululState.clearSession(); window.location.hash = '#/login'; }
      throw err;
    }
    return json.data;
  },
  async ping() {
    var res = await fetch(window.HULUL_CONFIG.API_BASE_URL + '?action=ping');
    return res.json();
  }
};
