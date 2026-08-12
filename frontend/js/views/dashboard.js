/**
 * HULUL - Dashboard view: KPI cards (mirrors the reference UI's "Logs Overview")
 * + a risk-breakdown chart + recent events.
 */
async function renderDashboard() {
  var root = document.getElementById('viewRoot');
  var data = await Api.call('dashboardSummary', {});
  var kpis = [
    ['kpi_total', data.logsOverview.total, ICON('kpi_total'), 'var(--info)'],
    ['kpi_open', data.logsOverview.open, ICON('kpi_open'), 'var(--info)'],
    ['kpi_inreview', data.logsOverview.inReview, ICON('kpi_inreview'), '#7c3aed'],
    ['kpi_resolved', data.logsOverview.resolved, ICON('kpi_resolved'), 'var(--success)'],
    ['kpi_reopen', data.logsOverview.reopen, ICON('kpi_reopen'), 'var(--warning)'],
    ['kpi_rejected', data.logsOverview.rejected, ICON('kpi_rejected'), 'var(--danger)']
  ];

  root.innerHTML =
    '<div class="page-header"><div><div class="page-title" data-i18n="dashboard_title">' + t('dashboard_title') + '</div>' +
    '<div class="page-subtitle">' + esc("Here's what's happening across your " + Term('event_plural')) + '</div></div></div>' +
    '<div class="kpi-grid">' + kpis.map(function (k) {
      return '<div class="kpi-card"><div class="kpi-top"><span class="kpi-label">' + t(k[0]) + '</span>' +
        '<span class="kpi-icon" style="color:' + k[3] + ';">' + k[2] + '</span></div>' +
        '<div class="kpi-value">' + k[1] + '</div></div>';
    }).join('') +
    '<div class="kpi-card"><div class="kpi-top"><span class="kpi-label">' + esc('Active ' + Term('event_plural')) + '</span>' +
      '<span class="kpi-icon" style="color:var(--accent);">' + ICON('kpi_active_events') + '</span></div>' +
      '<div class="kpi-value">' + data.activeEvents + '</div></div>' +
    '</div>' +
    '<div class="card" style="margin-bottom:20px;"><div class="card-header"><div class="card-title">Risk breakdown</div></div>' +
    '<div class="card-body"><canvas id="riskChart" height="90"></canvas></div></div>' +
    '<div class="card"><div class="card-header"><div class="card-title">' + esc(Term('event_plural')) + '</div>' +
    '<a class="btn btn-secondary btn-sm" href="#/events">' + esc(Term('event_plural')) + ' ' + ICON('forward_link') + '</a></div>' +
    '<div class="card-body">' + UI.table(
      [{ key: 'name', label: Term('event') }, { key: 'city', label: 'City' },
       { key: 'startDateTime', label: 'Start', render: function (r) { return UI.fmtDate(r.startDateTime); } },
       { key: 'status', label: t('status'), render: function (r) { return UI.statusBadge(r.status); } }],
      data.recentEvents,
      {}
    ) + '</div></div>';

  applyI18n(root);
  var riskLabels = Object.keys(data.riskBreakdown);
  if (riskLabels.length && window.Chart) {
    new Chart(document.getElementById('riskChart'), {
      type: 'bar',
      data: { labels: riskLabels, datasets: [{ label: 'Findings by risk', data: riskLabels.map(function (l) { return data.riskBreakdown[l]; }),
        backgroundColor: riskLabels.map(function (l) { return l === 'High' ? '#dc2626' : l === 'Medium' ? '#d97706' : '#16a34a'; }),
        borderRadius: 6 }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });
  }
}
