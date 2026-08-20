/**
 * HULUL - API client.
 * Talks to the Apps Script Web App. Uses POST with Content-Type: text/plain
 * to keep requests "simple" (no CORS preflight, which Apps Script can't handle).
 */
window.Api = {
  async call(action, payload) {
    var body = JSON.stringify({ action: action, payload: payload || {}, token: HululState.token });
    // Tied to the current page render (see Router._abortController) -- navigating away aborts
    // whatever request the page you left was still waiting on, instead of letting it resolve late
    // against a page that's no longer there. window.Router may not exist yet the very first time
    // this runs (before router.js's script tag executes), hence the guard.
    var signal = window.Router && window.Router._abortController ? window.Router._abortController.signal : undefined;
    var res = await Api._fetchWithRetry(body, signal);
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

  // BUG FIX (report): "Getting lots of 'Failed to fetch' errors." fetch() throws a raw, unformatted
  // TypeError for any transport-layer hiccup -- a momentarily dropped mobile connection, the Apps
  // Script Web App cold-starting, a brief DNS blip -- and its message really is just "Failed to
  // fetch" (Chrome), "NetworkError when attempting to fetch resource" (Firefox), or "Load failed"
  // (Safari). call() above used to let that raw string surface straight into UI.errorModal()
  // unmodified (uploadWithProgress, below, already wrapped its own fetch() in a try/catch for a
  // friendlier message -- call() had just never gotten the same treatment). Reported as
  // "intermittent, been happening a while" and "everywhere," which is exactly what a transient
  // network blip looks like across an app that calls Api.call() on virtually every page load -- so a
  // couple of quick automatic retries (600ms, then 1200ms) resolve most of these before the user ever
  // sees anything at all; only once every attempt has failed does this surface a clear, actionable
  // message instead of the raw browser string.
  async _fetchWithRetry(body, signal, attempt) {
    attempt = attempt || 0;
    try {
      return await fetch(window.HULUL_CONFIG.API_BASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: body,
        signal: signal
      });
    } catch (e) {
      // Router navigated away and intentionally aborted this request -- not a network failure, and
      // retrying/rewrapping it would just produce a confusing error for a page the user already left.
      // UI.error already has its own dedicated "err.name === 'AbortError'" no-op for exactly this.
      if (e && e.name === 'AbortError') throw e;
      if (attempt < 2) {
        await new Promise(function (resolve) { setTimeout(resolve, 600 * (attempt + 1)); });
        return Api._fetchWithRetry(body, signal, attempt + 1);
      }
      throw new Error('Network error — check your connection and try again.');
    }
  },

  async ping() {
    var res = await fetch(window.HULUL_CONFIG.API_BASE_URL + '?action=ping');
    return res.json();
  },

  // Was XHR-based (for xhr.upload.onprogress byte-level progress bars), but Apps Script Web Apps
  // respond to every POST with a 302 redirect to a script.googleusercontent.com URL that actually
  // serves the JSON -- fetch() follows that transparently (same as every other call() in this file,
  // which all work fine), but XMLHttpRequest hit it inconsistently and failed outright with a
  // generic "Network error during upload." even on a fast, low-latency connection and a tiny (under
  // 1MB) payload -- i.e. nothing to do with network speed or file size, a transport-layer quirk
  // specific to XHR against this kind of redirecting endpoint. Now uses the same fetch() path as
  // call() above, which is proven to work against this exact backend. Trade-off: no true byte-level
  // upload progress (the Fetch API doesn't expose that for request bodies in most browsers), so
  // onProgress only ever fires "started" (0/1) and "done" (1/1) -- acceptable since evidence photos
  // are compressed down to a few hundred KB before this is ever called, so the bar isn't visible for
  // long anyway; reliability matters far more here than a granular percentage.
  async uploadWithProgress(action, payload, onProgress) {
    if (onProgress) onProgress(0, 1);
    var body = JSON.stringify({ action: action, payload: payload || {}, token: HululState.token });
    var res;
    try {
      res = await fetch(window.HULUL_CONFIG.API_BASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: body
      });
    } catch (e) {
      throw new Error('Network error during upload.');
    }
    var json;
    try { json = await res.json(); }
    catch (e) { throw new Error('Unexpected response from server.'); }
    if (!json.ok) {
      var err = new Error(json.error ? json.error.message : 'Request failed');
      err.code = json.error ? json.error.code : 'UNKNOWN';
      throw err;
    }
    if (onProgress) onProgress(1, 1);
    return json.data;
  }
};
