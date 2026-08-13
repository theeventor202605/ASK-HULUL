/**
 * HULUL - full Notifications view (the topbar bell is a lightweight preview of this).
 */
// relatedType -> which Event tab clicking a notification about it should open. Every relatedType
// notify_() is ever called with is listed here; anything unrecognized falls back to 'overview'.
// Notifications with no eventId on record (see Notifications SCHEMA in Utils.gs) aren't about one
// event and aren't clickable at all -- see notifTargetHash_ below.
var NOTIF_TAB_BY_RELATED_ = {
  VenueEvaluations: 'approval', Templates: 'templates', Inspections: 'inspections',
  InspectorAssignments: 'disciplines', Findings: 'findings', Resolutions: 'resolutions',
  Reports: 'reports', Events: 'overview', EventChatMessages: 'chat'
};

function notifTargetHash_(n) {
  // Support tickets (Support.gs) are platform-level, not tied to an Event -- notify_() is always
  // called with eventId '' for these (see createTicket/addTicketComment/etc.), so the eventId
  // check below would otherwise make every ticket notification unclickable. Checked first since
  // relatedType, not eventId, is what actually tells them apart here.
  if (n.relatedType === 'SupportTickets') return n.relatedId ? '#/support/' + n.relatedId : null;
  if (!n.eventId) return null;
  return '#/events/' + n.eventId + '?tab=' + (NOTIF_TAB_BY_RELATED_[n.relatedType] || 'overview');
}

// Shared by the full Notifications page and the topbar bell dropdown (renderNotifPanel_ in
// app.js) -- marks the notification read (best-effort; navigation proceeds either way) then jumps
// to the Event tab it's about.
async function goToNotification_(n) {
  var hash = notifTargetHash_(n);
  if (!hash) return;
  if (!n.isRead) { try { await Api.call('markNotificationRead', { notificationId: n.id }); refreshNotifBadge(true); } catch (e) {} }
  window.location.hash = hash;
}

async function renderNotificationsView() {
  var root = document.getElementById('viewRoot');
  var list = await Api.call('listNotifications', { limit: 200 });
  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + t('nav_notifications') + '</div></div>' +
    '<div style="display:flex;gap:8px;">' +
      (list.length ? '<button class="btn btn-danger btn-sm" id="clearAllNotifBtn">' + esc(t('clear_all_btn')) + '</button>' : '') +
      '<button class="btn btn-primary" id="sendNotifBtn">' + esc(t('send_notification_btn')) + '</button>' +
    '</div></div>' +
    '<div class="card"><div class="card-body">' +
    (list.length ? list.map(n => {
      var clickable = !!notifTargetHash_(n);
      return '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;border-bottom:1px solid #f0f1f6;padding:12px 4px;">' +
      '<div data-goto-notif="' + n.id + '" style="flex:1;min-width:0;' + (clickable ? 'cursor:pointer;' : '') + '" title="' + (clickable ? esc(t('title_open_related_event')) : '') + '">' +
      '<div style="font-size:13.5px;' + (n.isRead ? 'color:var(--text-600);' : 'font-weight:600;') + '">' + esc(n.message) + '</div>' +
      '<div class="muted" style="font-size:11.5px;margin-top:2px;">' + esc(n.type) + ' · ' + UI.fmtDate(n.createdAt) + '</div></div>' +
      '<div style="display:inline-flex;gap:6px;flex:none;">' +
        (n.isRead ? '' : '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('mark_read_title')) + '" data-read="' + n.id + '">' + ICON('mark_read') + '</button>') +
        '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('clear_title')) + '" data-clear-notif="' + n.id + '">' + ICON('delete') + '</button>' +
      '</div></div>';
    }).join('') : '<div class="empty-state">' + t('no_data') + '</div>') + '</div></div>';

  var byId = {}; list.forEach(function (n) { byId[n.id] = n; });
  root.querySelectorAll('[data-goto-notif]').forEach(b => b.onclick = function () {
    var n = byId[b.getAttribute('data-goto-notif')];
    if (n) goToNotification_(n);
  });
  root.querySelectorAll('[data-read]').forEach(b => b.onclick = async function () {
    try { await Api.call('markNotificationRead', { notificationId: b.getAttribute('data-read') }); Router.resolve(); refreshNotifBadge(true); }
    catch (err) { UI.error(err); }
  });
  root.querySelectorAll('[data-clear-notif]').forEach(b => b.onclick = async function () {
    try { await Api.call('deleteNotification', { notificationId: b.getAttribute('data-clear-notif') }); Router.resolve(); refreshNotifBadge(true); }
    catch (err) { UI.error(err); }
  });
  var clearAllBtn = document.getElementById('clearAllNotifBtn');
  if (clearAllBtn) clearAllBtn.onclick = function () {
    UI.confirmModal(t('confirm_clear_all_notifications'), async function () {
      try { await Api.call('clearAllNotifications', {}); Router.resolve(); refreshNotifBadge(true); }
      catch (err) { UI.error(err); }
    }, { title: t('clear_all_notifications_title'), confirmLabel: t('clear_all_btn') });
  };

  document.getElementById('sendNotifBtn').onclick = async function () {
    // sendNotification and listUsers are permitted to the same set of admin roles, so this should
    // always succeed for anyone who can actually see this button -- but fall back to a raw-id
    // field rather than breaking the modal outright if it ever doesn't.
    var users = [];
    try { users = await Api.call('listUsers', {}); } catch (e) { /* fall back below */ }
    var targetFieldHtml = users.length
      ? UI.field(t('field_target_user'), '<select id="fNTarget" class="field-input">' +
          users.map(function (u) { return '<option value="' + u.id + '">' + esc(u.name) + ' (' + esc(u.role) + ')</option>'; }).join('') + '</select>')
      : UI.field(t('field_target_user_id'), '<input id="fNTarget" class="field-input" placeholder="' + esc(t('placeholder_target_user_id')) + '" />');
    var body = targetFieldHtml +
      UI.field(t('field_type'), '<input id="fNType" class="field-input" value="MANUAL" />') +
      UI.field(t('field_message'), '<textarea id="fNMessage" class="field-input" rows="3"></textarea>');
    UI.openModal(t('send_notification_title'), body, [
      { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
      { label: t('create'), className: 'btn-primary', onClick: async function () {
          try {
            await Api.call('sendNotification', {
              targetUserId: document.getElementById('fNTarget').value, type: document.getElementById('fNType').value,
              message: document.getElementById('fNMessage').value
            });
            UI.closeModal(); UI.toast(t('toast_notification_sent'), 'success'); Router.resolve();
          } catch (err) { UI.error(err); }
        } }
    ]);
  };
}
