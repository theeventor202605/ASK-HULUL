/**
 * HULUL - full Notifications view (the topbar bell is a lightweight preview of this).
 */
async function renderNotificationsView() {
  var root = document.getElementById('viewRoot');
  var list = await Api.call('listNotifications', { limit: 200 });
  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + t('nav_notifications') + '</div></div></div>' +
    '<div class="card"><div class="card-body">' +
    (list.length ? list.map(n =>
      '<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #f0f1f6;padding:12px 4px;">' +
      '<div><div style="font-size:13.5px;' + (n.isRead ? 'color:var(--text-600);' : 'font-weight:600;') + '">' + esc(n.message) + '</div>' +
      '<div class="muted" style="font-size:11.5px;margin-top:2px;">' + esc(n.type) + ' · ' + UI.fmtDate(n.createdAt) + '</div></div>' +
      (n.isRead ? '' : '<button class="btn btn-secondary btn-sm" data-read="' + n.id + '">Mark read</button>') + '</div>'
    ).join('') : '<div class="empty-state">' + t('no_data') + '</div>') + '</div></div>';

  root.querySelectorAll('[data-read]').forEach(b => b.onclick = async function () {
    try { await Api.call('markNotificationRead', { notificationId: b.getAttribute('data-read') }); Router.resolve(); refreshNotifBadge(); }
    catch (err) { UI.error(err); }
  });
}
