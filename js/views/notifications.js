/**
 * HULUL - full Notifications view (the topbar bell is a lightweight preview of this).
 */
async function renderNotificationsView() {
  var root = document.getElementById('viewRoot');
  var list = await Api.call('listNotifications', { limit: 200 });
  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + t('nav_notifications') + '</div></div>' +
    '<button class="btn btn-primary" id="sendNotifBtn">+ Send notification</button></div>' +
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

  document.getElementById('sendNotifBtn').onclick = function () {
    var body = UI.field('Target User ID', '<input id="fNTarget" class="field-input" placeholder="USR-0002" />') +
      UI.field('Type', '<input id="fNType" class="field-input" value="MANUAL" />') +
      UI.field('Message', '<textarea id="fNMessage" class="field-input" rows="3"></textarea>');
    UI.openModal('Send notification', body, [
      { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
      { label: t('create'), className: 'btn-primary', onClick: async function () {
          try {
            await Api.call('sendNotification', {
              targetUserId: document.getElementById('fNTarget').value, type: document.getElementById('fNType').value,
              message: document.getElementById('fNMessage').value
            });
            UI.closeModal(); UI.toast('Notification sent', 'success'); Router.resolve();
          } catch (err) { UI.error(err); }
        } }
    ]);
  };
}
