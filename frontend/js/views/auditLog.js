/**
 * HULUL - Audit Log viewer (REQ-ACC-10: "The System shall maintain an immutable audit log of all
 * account-management actions... recording the acting user, target account, and timestamp.")
 * listAuditLog (Accounts.gs) and the underlying audit() writer (Utils.gs, called from every module,
 * not just account management) already existed and worked -- this view was the missing piece: there
 * was no route/nav entry/page anywhere that ever called listAuditLog, so nobody could actually see
 * the log through the UI. Read-only by design (the log is immutable -- nothing here writes to it).
 */
async function renderAuditLog() {
  var root = document.getElementById('viewRoot');
  var entries = await Api.call('auditLog', { limit: 500 });
  var users = [];
  try { users = await Api.call('listUsers', {}); } catch (e) { /* fall back to raw actor id below */ }
  var usersById = {}; users.forEach(function (u) { usersById[u.id] = u; });

  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + esc(t('nav_audit_log')) + '</div>' +
    '<div class="page-subtitle">' + esc(t('audit_log_subtitle')) + '</div></div></div>' +
    '<div class="card"><div class="card-body">' + UI.table([
      { key: 'timestamp', label: t('col_timestamp'), render: r => UI.fmtDate(r.timestamp) },
      { key: 'actor', label: t('col_actor'), render: r => {
          var u = usersById[r.actor];
          return u ? esc(u.name) + ' <span class="muted" style="font-size:11px;">(' + esc(u.role || '') + ')</span>' : esc(r.actor || 'system');
        } },
      { key: 'action', label: t('col_action') },
      { key: 'targetType', label: t('col_target_type'), render: r => r.targetType ? esc(r.targetType) : '<span class="muted">—</span>' },
      { key: 'targetId', label: t('col_target_id'), render: r => r.targetId ? esc(r.targetId) : '<span class="muted">—</span>' },
      { key: 'details', label: t('col_details'), render: r => {
          if (!r.details) return '<span class="muted">—</span>';
          var parsed; try { parsed = JSON.parse(r.details); } catch (e) { parsed = null; }
          var text = parsed ? Object.keys(parsed).map(k => k + ': ' + JSON.stringify(parsed[k])).join(', ') : String(r.details);
          return '<span style="font-size:11.5px;font-family:monospace;" title="' + esc(text) + '">' + esc(text.length > 80 ? text.slice(0, 80) + '…' : text) + '</span>';
        } }
    ], entries, { exportName: 'hulul-audit-log.csv' }) + '</div></div>';
}
