/**
 * HULUL - standalone Logs page (route: #/logs).
 *
 * REQ: "For Inspection company Analysts, they need to be able to view all logs regardless of which
 * event they are in. Move the sidebar '+ Add Log' to become a tab inside 'Logs', and add a new tab to
 * contain all logs under the Inspection company. The same should be available for all organization
 * types." Two tabs, same #/logs?tab=x + tabbar/renderer-map pattern dashboard.js established for a
 * standalone tabbed page:
 *   - addLog  -- the pre-existing cross-event "Add Log" picker (findings.js's renderAddLogTab_),
 *                moved here from its own #/add-log sidebar entry, unchanged in behavior.
 *   - allLogs -- new: every Finding across every event the caller's own organization can see
 *                (listAllFindings, Findings.gs -- reuses listEvents' existing role/org scoping, so
 *                "all logs" always means "everything my own org's events cover," not literally every
 *                org on the platform), with an Event column linking back into that event's own Risk
 *                Logging tab.
 * Each tab is independently permission-gated (finding.create / finding.viewAll) -- a role with only
 * one of the two sees a single un-tabbed page (same "collapse to standalone" convention
 * NAV_GROUPS_/renderSidebar, app.js, already uses), and a role with neither sees a friendly
 * empty-state instead of an API 403.
 */
var LOGS_TABS_ = [
  ['addLog', 'tab_logs_add_log'],
  ['allLogs', 'tab_logs_all_logs']
];

function logsVisibleTabs_() {
  return LOGS_TABS_.filter(function (tb) {
    if (tb[0] === 'addLog') return hasPermission('finding.create');
    if (tb[0] === 'allLogs') return hasPermission('finding.viewAll');
    return false;
  });
}

async function renderLogsPage(params) {
  // Same "fresh render always starts from a clean slate" reasoning as renderDashboard's own
  // destroyDashboardLiveMap_() call -- switching tabs (or leaving this page) must stop the Add Log
  // tab's live GPS watch, not leave it running in the background against a DOM that's gone.
  destroyAddLogWatch_();
  var root = document.getElementById('viewRoot');
  var tabs = logsVisibleTabs_();
  if (!tabs.length) {
    root.innerHTML = '<div class="empty-state">' + esc(t('logs_no_access')) + '</div>';
    return;
  }
  var activeTab = (params && params.tab) || tabs[0][0];
  if (!tabs.some(function (tb) { return tb[0] === activeTab; })) activeTab = tabs[0][0];

  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + esc(t('nav_logs')) + '</div></div></div>' +
    (tabs.length > 1 ? '<div class="tabbar" id="logsTabbar"></div>' : '') +
    '<div id="logsTabContent"></div>';

  if (tabs.length > 1) {
    var tabbar = document.getElementById('logsTabbar');
    tabbar.innerHTML = tabs.map(function (tb) {
      return '<div class="tab-btn ' + (tb[0] === activeTab ? 'active' : '') + '" data-logs-tab="' + tb[0] + '">' + esc(t(tb[1])) + '</div>';
    }).join('');
    tabbar.querySelectorAll('[data-logs-tab]').forEach(function (btn) {
      btn.onclick = function () {
        var key = btn.getAttribute('data-logs-tab');
        window.location.hash = '#/logs' + (key === tabs[0][0] ? '' : '?tab=' + key);
      };
    });
  }

  var content = document.getElementById('logsTabContent');
  content.innerHTML = '<div class="empty-state">' + t('loading') + '</div>';
  try {
    if (activeTab === 'addLog') await renderAddLogTab_(content);
    else await logsTabAllLogs_(content);
  } catch (err) { UI.error(err); content.innerHTML = '<div class="empty-state">' + esc(t('failed_load_tab')) + '</div>'; }
}

// Same redirect treatment as venues.js's renderEditVenueRedirect_ -- the old standalone #/add-log
// sidebar page is gone (it's now the Add Log tab here), but any existing bookmark/deep-link should
// still land somewhere useful instead of 404ing.
function renderAddLogRedirect_() { window.location.hash = '#/logs?tab=addLog'; }

/* ---------------- Tab: All Logs (every Finding across every event this org can see) ----------------
 * Same columns as eventDetail.js's own tabFindings (Risk Logging tab), minus the Do (edit/delete)
 * column -- managing/resolving a log still happens from inside its own event, not from this rolled-up
 * view -- plus an added Event column (same styled-link treatment as completedChecklists.js's own
 * eventName column) so a click jumps straight back into that event's Risk Logging tab.
 */
async function logsTabAllLogs_(content) {
  var rows = await Api.call('listAllFindings', {});
  content.innerHTML =
    '<div class="card"><div class="card-header"><div class="card-title">' + esc(t('tab_logs_all_logs')) + '</div>' +
    '<div class="muted" style="font-size:11.5px;">' + esc(t('logs_all_hint')) + '</div></div>' +
    '<div class="card-body">' + UI.table([
      { key: 'eventName', label: Term('event'), render: r => '<a href="#/events/' + esc(r.eventId) + '?tab=findings" style="color:var(--accent);font-weight:600;text-decoration:none;">' + esc(r.eventName) + '</a>' },
      { key: 'id', label: t('col_log_id') },
      { key: 'evidenceUrls', label: t('col_image'), exportValue: r => (r.evidenceUrls && r.evidenceUrls.length) ? r.evidenceUrls[r.evidenceUrls.length - 1] : '', render: r => {
        var urls = r.evidenceUrls || [];
        if (!urls.length) return '—';
        var last = urls[urls.length - 1];
        var thumb = driveEvidenceThumbUrl_(last) || '';
        var full = driveEvidenceThumbUrl_(last, 1600) || last;
        return '<div>' +
          '<a href="' + esc(last) + '" target="_blank" rel="noopener" title="' + esc(t('click_to_expand')) + '" ' +
            'class="evidence-thumb" data-lightbox-url="' + esc(full) + '" data-gallery-b64="' + esc(btoa(JSON.stringify(urls))) + '" style="width:44px;height:44px;">' +
            (thumb ? '<img src="' + esc(thumb) + '" class="evidence-thumb-img" alt="Evidence" />' : ICON('capture_photo')) +
            (urls.length > 1 ? '<span class="evidence-thumb-count">' + (urls.length > 99 ? '99+' : urls.length) + '</span>' : '') +
          '</a>' +
          evidenceOutsideBadgeHtml_(evidenceMetaFor_(r.evidenceMeta, last)) +
        '</div>';
      } },
      { key: 'participantName', label: Term('participant'), render: r => esc(bi_(r.participantName, r.participantNameAr)) },
      { key: 'disciplineCode', label: Term('discipline'), render: r => esc(r.disciplineCode || r.disciplineName || '—') },
      { key: 'category', label: Term('checklistType') },
      { key: 'riskLevel', label: t('col_severity'), render: r => UI.riskBadge(r.riskLevel) },
      { key: 'status', label: t('status'), render: r => UI.statusBadge(r.status) },
      { key: 'reopenCount', label: t('col_rejection_count'), render: r => r.reopenCount || 0 },
      { key: 'description', label: t('field_description'), render: r => esc(bi_(r.description, r.descriptionAr)) },
      { key: 'suggestedAction', label: t('col_suggestion'), render: r => esc(bi_(r.suggestedAction, r.suggestedActionAr) || '—') },
      { key: 'location', label: t('field_log_location'), render: r => esc(r.location || '—') },
      { key: 'createdAt', label: t('col_date_time'), render: r => UI.fmtDate(r.createdAt) },
      { key: 'createdByName', label: t('col_created_by'), render: r => esc(r.createdByName || r.createdBy || '—') },
      { key: 'solvedByName', label: t('col_solved_by'), render: r => esc(r.solvedByName || '—') },
      { key: 'closedByName', label: t('col_closed_by'), render: r => esc(r.closedByName || '—') },
      { key: 'actions', label: t('actions'), exportable: false, sortable: false, render: r =>
          UI.actionsCell('<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('title_open_log')) + '" data-log-view="' + r.id + '" data-row-view="1">' + ICON('view_open') + '</button>')
      }
    ], rows, { emptyText: t('empty_no_logs') }) + '</div></div>';

  content.querySelectorAll('[data-log-view]').forEach(function (btn) {
    btn.onclick = function () {
      var findingId = btn.getAttribute('data-log-view');
      var row = rows.filter(function (r) { return r.id === findingId; })[0];
      if (!row) return;
      window.location.hash = '#/events/' + row.eventId + '/findings/' + findingId;
    };
  });
}
