/**
 * HULUL - tiny global state store (no framework needed for this scope).
 */
window.HululState = {
  user: null,
  token: null,
  lang: localStorage.getItem('hulul_lang') || 'en',
  theme: localStorage.getItem('hulul_theme') || 'light',
  currentEventId: null,
  notifications: [],
  notifBadgeLoadedAt: 0,
  // Which PERMISSION_REGISTRY_ `page` ids the signed-in role has any granted action on (getMyPageAccess,
  // backend/Permissions.gs) -- lets a brand-new custom role (Roles.gs) automatically see nav items its
  // Settings > Permissions grants cover, on top of the existing hardcoded NAV_ITEMS `roles` arrays.
  // See navItemVisible_, app.js.
  pageAccess: {},
  // Every selectable Place/Participant type (loadParticipantTypes, app.js) -- defaults to just the 4
  // built-ins until that first loads, so any view rendered before then still gets a sane dropdown.
  participantTypes: [
    { code: 'Operator', label: 'Operator', builtin: true }, { code: 'Vendor', label: 'Vendor', builtin: true },
    { code: 'Exhibitor', label: 'Exhibitor', builtin: true }, { code: 'Other', label: 'Other', builtin: true }
  ],
  escalationAlertLoadedAt: 0,
  escalationLockShownId: null, // id of the escalation currently occupying the full-screen lock (or null) -- see refreshEscalationAlert in app.js
  // REQ (Dashboard): general-purpose "any logged-in user" location ping (see startUserLocationPing_,
  // app.js, and LiveLocation.gs) -- guards against starting a second setInterval every time showApp()
  // re-runs (it fires on every navigation, not just login), and lets clearSession() actually stop the
  // loop on logout instead of it quietly pinging (and 401-ing) forever in the background.
  locationPingStarted: false,
  locationPingIntervalId: null,

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
    this.permissionsLoaded = false; this.permissions = {}; this.pageAccess = {};
    this.participantTypesLoaded = false; // participantTypes itself is left at its built-in default, not cleared
    this.notifBadgeLoadedAt = 0;
    this.escalationAlertLoadedAt = 0; this.escalationLockShownId = null;
    if (this.locationPingIntervalId) { clearInterval(this.locationPingIntervalId); this.locationPingIntervalId = null; }
    this.locationPingStarted = false;
    localStorage.removeItem('hulul_token'); localStorage.removeItem('hulul_user');
  }
};
