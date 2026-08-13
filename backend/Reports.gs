/**
 * HULUL - Reports.gs  (REQ-RPT)
 * Opening / Operational summary reports, plus the dashboard KPI feed
 * used by the frontend's Logs Overview cards (mirrors the reference UI: Total / Open / In Review /
 * Resolved / Re-open / Rejected).
 */

function generateReport(user, p) {
  requireRole(user, [ROLES.PROJECT_MANAGER, ROLES.SYSTEM_ADMIN, ROLES.INSPECTION_ADMIN]);
  if (['Opening', 'Operational'].indexOf(p.type) === -1) {
    throw new HululError('BAD_REQUEST', 'type must be "Opening" or "Operational"');
  }
  var findings = findWhere('Findings', function (f) { return f.eventId === p.eventId; });
  var inspections = findWhere('Inspections', function (i) { return i.eventId === p.eventId && i.phase === p.type; });
  var summary = {
    totalInspections: inspections.length,
    completed: inspections.filter(function (i) { return i.status === 'Completed'; }).length,
    totalFindings: findings.length,
    byRisk: groupCount_(findings, 'riskLevel'),
    byStatus: groupCount_(findings, 'status'),
    byDiscipline: groupCount_(findings, 'disciplineId')
  };
  var report = {
    id: newId('Reports'), eventId: p.eventId, type: p.type, generatedAt: nowIso_(),
    generatedBy: user.id, summaryJson: JSON.stringify(summary)
  };
  insertRow('Reports', report);
  audit(user.id, 'GENERATE_REPORT', 'Reports', report.id, { type: p.type });
  var event = getById('Events', p.eventId);
  notifyEventStakeholders_(p.eventId, 'REPORT_READY', p.type + ' report generated for ' + (event ? event.name : p.eventId), 'Reports', report.id);
  return Object.assign({}, report, { summary: summary });
}

function groupCount_(rows, field) {
  var out = {};
  rows.forEach(function (r) { var k = r[field] || 'Unspecified'; out[k] = (out[k] || 0) + 1; });
  return out;
}

function listReports(user, p) {
  return findWhere('Reports', function (r) { return r.eventId === p.eventId; })
    .sort(function (a, b) { return new Date(b.generatedAt) - new Date(a.generatedAt); })
    .map(function (r) { return Object.assign({}, r, { summary: JSON.parse(r.summaryJson || '{}') }); });
}

function dashboardSummary(user, p) {
  var events = listEvents(user, {});
  var eventIds = p && p.eventId ? [p.eventId] : events.map(function (e) { return e.id; });
  var findings = getAll('Findings').filter(function (f) { return eventIds.indexOf(f.eventId) !== -1; });
  return {
    totalEvents: events.length,
    activeEvents: events.filter(function (e) { return ['Planning', 'VenueApproved'].indexOf(e.status) !== -1; }).length,
    logsOverview: findingKpiBuckets_(findings),
    riskBreakdown: groupCount_(findings, 'riskLevel'),
    // REQ bug report: SystemAdmin saw only a handful of events, all one city, and read it as a
    // permissions bug -- listEvents itself is unfiltered for SystemAdmin (this returns every event
    // it can see), but the dashboard preview below only ever showed the 6 most-recently-created ones,
    // and its card was labeled just "Events" with nothing to say it was a partial list. Bumped to 8
    // and (see dashboard.js) relabeled "Recent events" so it reads as the preview it's always been --
    // the full, unfiltered list is one click away via the card's own "Events ->" link.
    recentEvents: events.slice(0, 8)
  };
}
