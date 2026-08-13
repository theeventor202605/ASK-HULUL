/**
 * HULUL - Dashboard view: a hero greeting, KPI cards (mirrors the reference UI's "Logs Overview" --
 * reuses the same kpiCard() helper as the Event Overview/Findings tab KPI grids, eventDetail.js, so
 * the top-accent-stripe treatment below is consistent across every KPI grid in the app, not just this
 * page), a risk-breakdown chart, and a lightweight "recent events" list.
 *
 * REQ: "reconsider redesigning the dashboards ... something modern and elegant." Kept fully within
 * the existing design-token system (CSS vars, theme.js's 5 accent themes, the "no background colours
 * behind icons" rule from before) rather than introducing anything new -- see styles.css's
 * .dashboard-* rules for the actual visual treatment. All data below already came from
 * dashboardSummary (Reports.gs); nothing new was added on the backend.
 */
async function renderDashboard() {
  var root = document.getElementById('viewRoot');
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

  root.innerHTML =
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

  applyI18n(root);
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
var DASHBOARD_RISK_ORDER_ = ['Critical', 'High', 'Medium', 'Low'];
var DASHBOARD_RISK_COLOR_ = { Critical: '#7f1d1d', High: '#dc2626', Medium: '#d97706', Low: '#16a34a' };

function renderDashboardRiskChart_(riskBreakdown) {
  var canvas = document.getElementById('riskChart');
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
