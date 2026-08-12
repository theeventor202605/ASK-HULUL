/**
 * HULUL - tiny global state store (no framework needed for this scope).
 */
window.HululState = {
  user: null,
  token: null,
  lang: localStorage.getItem('hulul_lang') || 'en',
  theme: localStorage.getItem('hulul_theme') || 'indigo',
  currentEventId: null,
  notifications: [],
  notifBadgeLoadedAt: 0,
  escalationAlertLoadedAt: 0,
  escalationLockShownId: null, // id of the escalation currently occupying the full-screen lock (or null) -- see refreshEscalationAlert in app.js

  setSession(token, user) {
    this.token = token; this.user = user;
    localStorage.setItem('hulul_token', token);
    localStorage.setItem('hulul_user', JSON.stringify(user));
  },
  loadSession() {
    this.token = localStorage.getItem('hulul_token');
    var u = localStorage.getItem('hulul_user');
    this.user = u ? JSON.parse(u) : null;
    return !!(this.token && this.user);
  },
  clearSession() {
    this.token = null; this.user = null;
    this.orgLogoLoaded = false; this.orgLogoUrl = '';
    this.orgLabelsLoaded = false; this.orgLabels = {};
    this.appIconsLoaded = false; this.appIcons = {};
    this.notifBadgeLoadedAt = 0;
    this.escalationAlertLoadedAt = 0; this.escalationLockShownId = null;
    localStorage.removeItem('hulul_token'); localStorage.removeItem('hulul_user');
  }
};
