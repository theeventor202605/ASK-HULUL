/**
 * HULUL - Dashboard view.
 *
 * REQ: "reconsider redesigning the dashboards ... something modern and elegant." Kept fully within
 * the existing design-token system (CSS vars, theme.js's 5 accent themes, the "no background colours
 * behind icons" rule from before) rather than introducing anything new -- see styles.css's
 * .dashboard-* rules for the actual visual treatment.
 *
 * REQ follow-up: "In Dashboard add Live map showing all inspector locations and number of Log
 * photos each inspector took. Need to add another tab to show venue attendance ..." -- turned this
 * from a single flat page into a tabbed one (same #/dashboard?tab=x + tabbar/renderer-map pattern
 * venues.js's renderVenueDetail already established for a standalone page): Overview (the original
 * hero/KPIs/chart/recent-events content, unchanged), Live Map, and Venue Attendance. Each tab fetches
 * its own data on demand rather than the page eagerly loading everything up front.
 */
var DASHBOARD_TABS_ = [
  ['overview', 'tab_dashboard_overview'],
  ['liveMap', 'tab_dashboard_live_map'],
  ['venueAttendance', 'tab_dashboard_venue_attendance']
];
var DASHBOARD_RENDERERS_ = null;
function dashboardRenderers_() {
  if (!DASHBOARD_RENDERERS_) DASHBOARD_RENDERERS_ = { overview: dashboardTabOverview_, liveMap: dashboardTabLiveMap_, venueAttendance: dashboardTabVenueAttendance_ };
  return DASHBOARD_RENDERERS_;
}

async function renderDashboard(params) {
  // A fresh render (including just switching tabs, which fully re-renders this page like every other
  // tabbed page in the app) always starts from a clean slate -- same reasoning as renderVenueDetail's
  // own destroy*Map_() calls, venues.js.
  destroyDashboardLiveMap_();
  var root = document.getElementById('viewRoot');
  var activeTab = (params && params.tab) || 'overview';
  if (!DASHBOARD_TABS_.some(function (tb) { return tb[0] === activeTab; })) activeTab = 'overview';

  root.innerHTML =
    '<div class="tabbar" id="dashboardTabbar"></div>' +
    '<div id="dashboardTabContent"></div>';

  var tabbar = document.getElementById('dashboardTabbar');
  tabbar.innerHTML = DASHBOARD_TABS_.map(function (tb) {
    return '<div class="tab-btn ' + (tb[0] === activeTab ? 'active' : '') + '" data-dashboard-tab="' + tb[0] + '">' + esc(t(tb[1])) + '</div>';
  }).join('');
  tabbar.querySelectorAll('[data-dashboard-tab]').forEach(function (btn) {
    btn.onclick = function () {
      var key = btn.getAttribute('data-dashboard-tab');
      window.location.hash = '#/dashboard' + (key === 'overview' ? '' : '?tab=' + key);
    };
  });

  var content = document.getElementById('dashboardTabContent');
  content.innerHTML = '<div class="empty-state">' + t('loading') + '</div>';
  try { await (dashboardRenderers_()[activeTab] || dashboardTabOverview_)(content); }
  catch (err) { UI.error(err); content.innerHTML = '<div class="empty-state">' + esc(t('failed_load_tab')) + '</div>'; }
}

/* ---------------- Tab 1: Overview (hero greeting, KPI cards, risk chart, recent events) ----------
 * Reuses the same kpiCard() markup as the Event Overview/Findings tab KPI grids, eventDetail.js, so
 * the top-accent-stripe treatment is consistent across every KPI grid in the app, not just here.
 * All data comes from dashboardSummary (Reports.gs) -- unchanged from before this tab split. */
async function dashboardTabOverview_(content) {
  var data = await Api.call('dashboardSummary', {});

  var kpis = [
    ['kpi_total', data.logsOverview.total, ICON('kpi_total'), 'var(--info)'],
    ['kpi_open', data.logsOverview.open, ICON('kpi_open'), 'var(--info)'],
    ['kpi_inreview', data.logsOverview.inReview, ICON('kpi_inreview'), 'var(--purple)'],
    ['kpi_resolved', data.logsOverview.resolved, ICON('kpi_resolved'), 'var(--success)'],
    ['kpi_reopen', data.logsOverview.reopen, ICON('kpi_reopen'), 'var(--warning)'],
    ['kpi_rejected', data.logsOverview.rejected, ICON('kpi_rejected'), 'var(--danger)'],
    ['kpi_active_events', data.activeEvents, ICON('kpi_active_events'), 'var(--accent)']
  ];

  content.innerHTML =
    '<div class="dashboard-hero">' +
      '<div><div class="dashboard-greeting">' + esc(dashboardGreeting_()) + '</div>' +
      '<div class="dashboard-hero-sub">' + esc(dashboardHeroSubtitle_(data)) + '</div></div>' +
      '<div class="dashboard-hero-date">' + esc(dashboardFmtToday_()) + '</div>' +
    '</div>' +

    '<div class="kpi-grid">' + kpis.map(function (k) {
      var labelHtml = k[0] === 'kpi_active_events' ? esc('Active ' + Term('event_plural')) : t(k[0]);
      return kpiCard_i18nOrPlain_(labelHtml, k[1], k[2], k[3]);
    }).join('') + '</div>' +

    '<div class="dashboard-columns">' +
      '<div class="dashboard-col-main card"><div class="card-header"><div class="card-title">' + esc('Recent ' + Term('event_plural')) + '</div>' +
        '<a class="btn btn-secondary btn-sm" href="#/events">' + esc(Term('event_plural')) + ' ' + ICON('forward_link') + '</a></div>' +
        '<div class="card-body" id="dashboardRecentEvents"></div></div>' +

      '<div class="dashboard-col-side card"><div class="card-header"><div class="card-title">Risk breakdown</div></div>' +
        '<div class="card-body"><canvas id="riskChart" height="200"></canvas></div></div>' +
    '</div>';

  applyI18n(content);
  renderDashboardRecentEvents_(data.recentEvents || []);
  renderDashboardRiskChart_(data.riskBreakdown || {});
}

// t()-driven KPI labels (kpi_total etc.) carry a data-i18n attribute (see applyI18n); the one
// plain-string label (Active Events, built with Term()) doesn't need one. Both go through the same
// kpiCard() markup (eventDetail.js) so every KPI grid in the app -- this page, Event Overview, the
// Findings tab -- looks and behaves identically.
function kpiCard_i18nOrPlain_(label, value, icon, color) {
  return '<div class="kpi-card" style="--kpi-color:' + color + ';"><div class="kpi-top"><span class="kpi-label">' + label + '</span>' +
    '<span class="kpi-icon" style="color:' + color + ';">' + icon + '</span></div><div class="kpi-value">' + value + '</div></div>';
}

// Local time-of-day greeting, first name only (mirrors renderProfileTab_'s own use of the user's
// name in settings.js) -- purely a warmer, more personal opener than the old generic page title.
function dashboardGreeting_() {
  var hour = new Date().getHours();
  var timeOfDay = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  var firstName = ((HululState.user && HululState.user.name) || '').trim().split(' ')[0];
  return 'Good ' + timeOfDay + (firstName ? ', ' + firstName : '') + '!';
}

function dashboardFmtToday_() {
  return new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

// Reuses totalEvents/activeEvents already in dashboardSummary's response (no new backend call) for a
// subtitle that actually says something, instead of the old static "Here's what's happening..." line.
function dashboardHeroSubtitle_(data) {
  if (!data.totalEvents) return "You don't have any " + Term('event_plural').toLowerCase() + ' yet.';
  return data.activeEvents + ' of ' + data.totalEvents + ' ' + Term('event_plural').toLowerCase() + ' currently active';
}

// Replaces the old plain UI.table with a lighter, clickable row list -- more appropriate for an
// at-a-glance overview page than a full sortable/filterable/exportable data table (that's what the
// Events list page itself is for; UI.table's toolbar would be overkill here).
function renderDashboardRecentEvents_(events) {
  var holder = document.getElementById('dashboardRecentEvents');
  if (!holder) return;
  if (!events.length) {
    holder.innerHTML = '<div class="empty-state">No ' + esc(Term('event_plural').toLowerCase()) + ' yet.</div>';
    return;
  }
  holder.innerHTML = events.map(function (e) {
    var initial = (e.name || '?').trim().slice(0, 1).toUpperCase();
    return '<div class="recent-event-row" data-event-id="' + esc(e.id) + '">' +
      '<div class="avatar avatar-tile">' + esc(initial) + '</div>' +
      '<div style="flex:1;min-width:0;">' +
        '<div class="recent-event-name">' + esc(e.name || '—') + '</div>' +
        '<div class="recent-event-meta">' + esc(e.city || '—') + ' · ' + UI.fmtDate(e.startDateTime) + '</div>' +
      '</div>' +
      UI.statusBadge(e.status) +
    '</div>';
  }).join('');
  holder.querySelectorAll('[data-event-id]').forEach(function (row) {
    row.onclick = function () { window.location.hash = '#/events/' + row.getAttribute('data-event-id'); };
  });
}

// Risk level -> color, matching the exact hex values behind --critical/--danger/--warning/--success
// in styles.css (Chart.js needs a concrete color at chart-creation time, not a live CSS var). Fixed
// severity order (worst first) rather than whatever order Object.keys(riskBreakdown) happens to
// return, and -- unlike the old version -- actually has a Critical entry, which used to silently fall
// through to the "Low" green.
// REQ follow-up: "risk level Info that sits below Low" -- appended last (lowest severity) with the
// app's info blue (matches --info in styles.css), distinct from the red/amber/green progression above.
var DASHBOARD_RISK_ORDER_ = ['Critical', 'High', 'Medium', 'Low', 'Info'];
var DASHBOARD_RISK_COLOR_ = { Critical: '#7f1d1d', High: '#dc2626', Medium: '#d97706', Low: '#16a34a', Info: '#2563eb' };

function renderDashboardRiskChart_(riskBreakdown) {
  var canvas = document.getElementById('riskChart');
  if (!canvas) return;
  var labels = DASHBOARD_RISK_ORDER_.filter(function (l) { return riskBreakdown[l]; });
  if (!labels.length) {
    canvas.closest('.card-body').innerHTML = '<div class="empty-state">No findings logged yet.</div>';
    return;
  }
  if (!window.Chart) return; // Chart.js failed to load -- leave the empty canvas rather than a misleading "no data" message
  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{ data: labels.map(function (l) { return riskBreakdown[l]; }),
        backgroundColor: labels.map(function (l) { return DASHBOARD_RISK_COLOR_[l]; }),
        borderRadius: 6, barThickness: 22 }]
    },
    options: {
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, ticks: { precision: 0 }, grid: { display: false } },
        y: { grid: { display: false } }
      }
    }
  });
}

/* ---------------- Tab 2: Live Map -------------------------------------------------------------
 * REQ: "Live map showing all inspector locations and number of Log photos each inspector took."
 * Polls dashboardLiveMapData (LiveLocation.gs) every 20s -- a self-contained poller rather than
 * reusing UI.startInspectorLocationPolling, since that helper is hard-wired to
 * listActiveInspectorLocations' specific {inspectorId, inspectorName} response shape (this one's
 * response also carries role/venue and isn't Inspector-only, see LiveLocation.gs's header comment).
 * The photo-count side panel comes from the same call (one aggregate request, same convention as
 * dashboardSummary), so it refreshes in lockstep with the map on every tick. */
var dashboardLiveMapInstance_ = null;
var dashboardLiveMapFullscreenCleanup_ = null;
var dashboardLiveMapPollStop_ = null;

function destroyDashboardLiveMap_() {
  if (dashboardLiveMapPollStop_) { dashboardLiveMapPollStop_(); dashboardLiveMapPollStop_ = null; }
  if (dashboardLiveMapFullscreenCleanup_) { dashboardLiveMapFullscreenCleanup_(); dashboardLiveMapFullscreenCleanup_ = null; }
  if (dashboardLiveMapInstance_) { dashboardLiveMapInstance_.remove(); dashboardLiveMapInstance_ = null; }
}

async function dashboardTabLiveMap_(content) {
  content.innerHTML =
    '<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;">' +
      '<div class="card" style="flex:2 1 480px;">' +
        '<div class="card-header"><div class="card-title">' + esc(t('dashboard_live_map_title')) + '</div>' +
        '<div class="muted" style="font-size:11.5px;">' + esc(t('dashboard_live_map_subtitle')) + '</div></div>' +
        '<div class="card-body"><div id="dashboardLiveMap" style="height:500px;border-radius:var(--radius-sm);"></div></div>' +
      '</div>' +
      '<div style="flex:1 1 260px;min-width:240px;display:flex;flex-direction:column;gap:16px;">' +
        '<div class="card">' +
          '<div class="card-header"><div class="card-title">' + esc(t('dashboard_online_users_title')) + '</div>' +
          '<div class="muted" style="font-size:11.5px;">' + esc(t('dashboard_online_users_subtitle')) + '</div></div>' +
          '<div class="card-body" id="dashboardOnlineUsers"><div class="empty-state">' + esc(t('loading')) + '</div></div>' +
        '</div>' +
        '<div class="card">' +
          '<div class="card-header"><div class="card-title">' + esc(t('dashboard_photo_counts_title')) + '</div>' +
          '<div class="muted" style="font-size:11.5px;">' + esc(t('dashboard_photo_counts_subtitle')) + '</div></div>' +
          '<div class="card-body" id="dashboardPhotoCounts"><div class="empty-state">' + esc(t('loading')) + '</div></div>' +
        '</div>' +
      '</div>' +
    '</div>';
  initDashboardLiveMap_();
}

function initDashboardLiveMap_() {
  var mapEl = document.getElementById('dashboardLiveMap');
  if (!mapEl) return;
  if (typeof HululLeaflet === 'undefined') {
    mapEl.style.display = 'flex'; mapEl.style.alignItems = 'center'; mapEl.style.justifyContent = 'center';
    mapEl.style.color = 'var(--text-600)'; mapEl.style.fontSize = '12px'; mapEl.style.textAlign = 'center'; mapEl.style.padding = '12px';
    mapEl.textContent = t('place_map_unavailable');
    return;
  }
  dashboardLiveMapInstance_ = HululLeaflet.map('dashboardLiveMap', { preferCanvas: true }).setView(VENUE_DEFAULT_CENTER, 6);
  UI.requireClickToActivateMap(dashboardLiveMapInstance_, mapEl);
  hululTileLayer_().addTo(dashboardLiveMapInstance_);
  dashboardLiveMapFullscreenCleanup_ = UI.wireMapFullscreen(mapEl, dashboardLiveMapInstance_);

  var markers = {};
  var fittedOnce = false;
  function tick() {
    if (!dashboardLiveMapInstance_) return;
    Api.call('dashboardLiveMapData', {}).then(function (data) {
      if (!dashboardLiveMapInstance_) return; // tab switched away mid-request
      renderDashboardOnlineUsers_(data.locations || []);
      renderDashboardPhotoCounts_(data.inspectorPhotoCounts || []);
      var seenIds = {};
      (data.locations || []).forEach(function (loc) {
        if (loc.lat === '' || loc.lat == null || loc.lng === '' || loc.lng == null) return;
        seenIds[loc.userId] = true;
        var latlng = [Number(loc.lat), Number(loc.lng)];
        var marker = markers[loc.userId];
        if (marker) {
          marker.setLatLng(latlng);
        } else {
          var icon = HululLeaflet.divIcon({
            className: 'inspector-marker-icon', iconSize: [16, 16], iconAnchor: [8, 8], html: '<div class="inspector-marker-dot"></div>'
          });
          marker = HululLeaflet.marker(latlng, { icon: icon, zIndexOffset: 900 }).addTo(dashboardLiveMapInstance_);
          markers[loc.userId] = marker;
        }
        marker.unbindTooltip();
        marker.bindTooltip(esc(loc.userName) + ' — ' + esc(loc.roleLabel) + ' · ' + esc(loc.venueName), { direction: 'top', offset: [0, -10], className: 'place-marker-tooltip' });
      });
      Object.keys(markers).forEach(function (id) {
        if (!seenIds[id]) { dashboardLiveMapInstance_.removeLayer(markers[id]); delete markers[id]; }
      });
      // Only ever auto-fits ONCE (the first tick that actually has dots) -- afterward the admin may
      // have panned/zoomed on purpose, and a later ping shouldn't yank the view back.
      if (!fittedOnce && Object.keys(markers).length) {
        fittedOnce = true;
        var group = HululLeaflet.featureGroup(Object.keys(markers).map(function (id) { return markers[id]; }));
        dashboardLiveMapInstance_.fitBounds(group.getBounds().pad(0.3));
      }
    }).catch(function () { /* transient -- next tick retries */ });
  }
  tick();
  var timer = setInterval(tick, 20000);
  dashboardLiveMapPollStop_ = function () {
    clearInterval(timer);
    Object.keys(markers).forEach(function (id) { if (dashboardLiveMapInstance_) dashboardLiveMapInstance_.removeLayer(markers[id]); });
    markers = {};
  };
}

// REQ: "Add list to only show online users and in which venue." Reuses the exact same locations[]
// the map plots each tick (dashboardLiveMapData, LiveLocation.gs already filters to a fresh ping --
// see USER_LIVE_LOCATION_FRESHNESS_MS_ -- AND a match against a venue boundary), so "online" here
// means the same thing the dots on the map mean: no separate online/offline concept was introduced.
function renderDashboardOnlineUsers_(locations) {
  var holder = document.getElementById('dashboardOnlineUsers');
  if (!holder) return;
  if (!locations.length) { holder.innerHTML = '<div class="empty-state">' + esc(t('dashboard_no_online_users')) + '</div>'; return; }
  var sorted = locations.slice().sort(function (a, b) { return String(a.userName).localeCompare(String(b.userName)); });
  holder.innerHTML = sorted.map(function (loc) {
    return '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #f0f1f6;font-size:13px;">' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(loc.userName) + '</div>' +
        '<div class="muted" style="font-size:11px;">' + esc(loc.roleLabel) + '</div>' +
      '</div>' +
      '<span class="badge badge-neutral" style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(loc.venueName) + '</span>' +
    '</div>';
  }).join('');
}

function renderDashboardPhotoCounts_(counts) {
  var holder = document.getElementById('dashboardPhotoCounts');
  if (!holder) return;
  if (!counts.length) { holder.innerHTML = '<div class="empty-state">' + esc(t('dashboard_no_photo_counts')) + '</div>'; return; }
  holder.innerHTML = counts.map(function (c) {
    return '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #f0f1f6;font-size:13px;">' +
      '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(c.inspectorName) + '</span>' +
      '<span class="badge badge-neutral">' + ICON('roadmap_attachment') + ' ' + esc(c.photoCount) + '</span>' +
    '</div>';
  }).join('');
}

/* ---------------- Tab 3: Venue Attendance -------------------------------------------------------
 * REQ: "add another tab to show venue attendance -- first time inspector or user ... attended venue
 * must be inside boundary or no more than 5 meters outside venue boundaries. also the same for last
 * date time user left venue boundaries." One row per (user, venue) -- see VenueAttendance schema/
 * dashboardVenueAttendance (LiveLocation.gs) for how first/last are actually derived from pings. */
async function dashboardTabVenueAttendance_(content) {
  var rows = await Api.call('dashboardVenueAttendance', {});
  var bodyHtml = rows.length
    ? UI.table([
        { key: 'userName', label: t('col_name') },
        { key: 'roleLabel', label: t('col_role') },
        { key: 'venueName', label: Term('venue') },
        { key: 'firstAttendedAt', label: t('dashboard_first_attended_col'), render: r => '<span>' + esc(UI.fmtDate(r.firstAttendedAt)) + '</span>' },
        { key: 'lastSeenInsideAt', label: t('dashboard_last_seen_col'), render: r => '<span>' + esc(UI.fmtDate(r.lastSeenInsideAt)) + '</span>' }
      ], rows, {})
    : '<div class="empty-state">' + esc(t('dashboard_no_attendance_yet')) + '</div>';
  content.innerHTML =
    '<div class="card"><div class="card-header"><div class="card-title">' + esc(t('dashboard_venue_attendance_title')) + '</div>' +
    '<div class="muted" style="font-size:11.5px;">' + esc(t('dashboard_venue_attendance_subtitle')) + '</div></div>' +
    '<div class="card-body">' + bodyHtml + '</div></div>';
}
