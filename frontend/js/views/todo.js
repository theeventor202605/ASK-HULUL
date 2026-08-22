/**
 * HULUL - To-Do Inbox (Todo.gs's listMyTodoItems).
 * REQ: "Add to do inbox where it will show all pending items on a user. All logs that have been
 * created but not yet resolved. Pending documents that have not yet been evaluated, all scores that
 * have not been completed. all required annexes that have not been uploaded. any upcoming meetings not
 * yet attended. All translations not yet translated. and all other related tasks. once a task has been
 * completed it is automatically date time stamped, ticked, crossed and goes to the bottom of the list.
 * add search filter."
 *
 * The backend already returns pending items first, completed ones last (most recently completed
 * first) -- this page just renders that order via UI.table, which gives the search filter, sort, and
 * CSV export for free (same "every table gets this for free" convention as every other list page in
 * this app -- see translations.js for the closest sibling: category filter chips + one UI.table).
 * Category chips reuse the same labelFn-at-render-time pattern as translations.js's own
 * TRANSLATION_CATEGORIES_ for the same reason (stays correct across a language switch mid-session with
 * no extra wiring).
 */

var TODO_CATEGORIES_ = [
  { id: 'log', labelFn: function () { return t('todo_category_log'); } },
  { id: 'document', labelFn: function () { return t('todo_category_document'); } },
  { id: 'score', labelFn: function () { return t('todo_category_score'); } },
  { id: 'annex', labelFn: function () { return t('todo_category_annex'); } },
  { id: 'meeting', labelFn: function () { return t('todo_category_meeting'); } },
  { id: 'translation', labelFn: function () { return t('todo_category_translation'); } },
  { id: 'inspection', labelFn: function () { return t('todo_category_inspection'); } },
  { id: 'escalation', labelFn: function () { return t('todo_category_escalation'); } }
];

function todoCategoryLabel_(id) {
  var cat = TODO_CATEGORIES_.filter(function (c) { return c.id === id; })[0];
  return cat ? cat.labelFn() : id;
}

// Module-level (not closed over renderTodoInbox) so the category filter survives a re-render --
// same reasoning/convention as HululTranslationState_ (translations.js).
// logsOpenedByMeOnly: REQ follow-up -- "provide toggle to display logs opened by current user."
// Logs are scoped (by design, see Todo.gs's header comment) to created-by-me OR assigned-to-me-
// to-resolve; this toggle narrows that down to created-by-me only, using the openedByMe flag
// listMyTodoItems now returns on every 'log' item. Only ever affects category 'log' -- every other
// category is already scoped to the caller by construction (assignee/invitee/role), so there's
// nothing for an "opened by me" toggle to narrow there.
var HululTodoState_ = { items: [], categoryFilter: 'all', logsOpenedByMeOnly: false };

async function renderTodoInbox() {
  var root = document.getElementById('viewRoot');
  root.innerHTML = '<div class="empty-state">' + esc(t('loading')) + '</div>';
  var items;
  try { items = await Api.call('listMyTodoItems', {}); }
  catch (err) { UI.error(err); return; }
  HululTodoState_.items = items;
  HululTodoState_.categoryFilter = 'all';
  HululTodoState_.logsOpenedByMeOnly = false;
  renderTodoInboxBody_();
}

function todoCatCountHtml_(id, label, count, active) {
  return '<button type="button" class="translation-cat-card' + (active ? ' active' : '') + '" data-tocat="' + esc(id) + '">' +
    '<div class="translation-cat-label">' + esc(label) + '</div>' +
    '<div class="translation-cat-pct">' + count + '</div>' +
  '</button>';
}

function renderTodoInboxBody_() {
  var root = document.getElementById('viewRoot');
  var hasLogs = HululTodoState_.items.some(function (i) { return i.category === 'log'; });
  // Applied before category-splitting/counting so the "Logs" chip's own count, and the "All" total,
  // both reflect what the toggle is actually hiding -- not just the table underneath it.
  var items = HululTodoState_.logsOpenedByMeOnly
    ? HululTodoState_.items.filter(function (i) { return i.category !== 'log' || i.openedByMe; })
    : HululTodoState_.items;

  var byCategory = {};
  items.forEach(function (i) { (byCategory[i.category] = byCategory[i.category] || []).push(i); });
  var pendingCountFor_ = function (list) { return list.filter(function (i) { return !i.completed; }).length; };

  var totalPending = pendingCountFor_(items);
  var catCardsHtml = todoCatCountHtml_('all', t('todo_all_categories'), totalPending, HululTodoState_.categoryFilter === 'all') +
    TODO_CATEGORIES_.map(function (cat) {
      var list = byCategory[cat.id] || [];
      if (!list.length) return '';
      return todoCatCountHtml_(cat.id, cat.labelFn(), pendingCountFor_(list), HululTodoState_.categoryFilter === cat.id);
    }).join('');

  var logsToggleHtml = hasLogs
    ? '<label class="todo-logs-toggle"><input type="checkbox" id="todoLogsOpenedByMe"' +
      (HululTodoState_.logsOpenedByMeOnly ? ' checked' : '') + ' /> ' + esc(t('todo_logs_opened_by_me_only')) + '</label>'
    : '';

  var filtered = HululTodoState_.categoryFilter === 'all' ? items
    : items.filter(function (i) { return i.category === HululTodoState_.categoryFilter; });

  var indexOfItem_ = new Map();
  filtered.forEach(function (it, idx) { indexOfItem_.set(it, idx); });

  var tableHtml = filtered.length ? UI.table([
    { key: 'category', label: t('col_category'), render: r => '<span class="badge badge-neutral">' + esc(todoCategoryLabel_(r.category)) + '</span>' },
    { key: 'title', label: t('col_title'), render: r => '<span' + (r.completed ? ' style="text-decoration:line-through;color:var(--text-600);"' : '') + '>' + esc(r.title) + '</span>' },
    { key: 'subtitle', label: t('col_context'), render: r => esc(r.subtitle || '—') },
    // REQ follow-up: "We don't have a column showing who created that log." Only 'log' items carry
    // createdByName (see Todo.gs's todoItem_/todoUserName_) -- every other category shows '—' since
    // there's no per-item creator concept for them (role-scoped, invitee-based, etc.).
    { key: 'createdByName', label: t('col_created_by'), render: r => esc(r.createdByName || '—') },
    // REQ follow-up: "know who opens (creates) a log, solves a log, and closes a log." Same idea,
    // blank until a log's resolution is actually Approved (Todo.gs's approvedResolutionByFinding).
    { key: 'solvedByName', label: t('col_solved_by'), render: r => esc(r.solvedByName || '—') },
    { key: 'closedByName', label: t('col_closed_by'), render: r => esc(r.closedByName || '—') },
    { key: 'status', label: t('col_status'),
      exportValue: r => r.completed ? t('todo_status_done') : t('todo_status_pending'),
      render: r => r.completed
        ? '<span class="badge badge-low">' + ICON('mark_read') + ' ' + esc(t('todo_status_done')) + (r.completedAt ? ' · ' + esc(UI.fmtDate(r.completedAt)) : '') + '</span>'
        : '<span class="badge badge-medium">' + esc(t('todo_status_pending')) + '</span>' },
    { key: 'actions', label: t('actions'), sortable: false, render: r => {
        var idx = indexOfItem_.get(r);
        var openBtn = '<button type="button" class="btn btn-secondary btn-sm" data-todo-open="' + idx + '">' + esc(t('todo_open_action')) + '</button>';
        var attendBtn = (r.category === 'meeting' && !r.completed)
          ? ' <button type="button" class="btn btn-primary btn-sm" data-todo-attend="' + idx + '">' + esc(t('todo_mark_attended')) + '</button>'
          : '';
        return openBtn + attendBtn;
      } }
  ], filtered, { exportName: 'todo.csv' }) : '<div class="empty-state">' + esc(t('todo_empty')) + '</div>';

  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + esc(t('nav_todo')) + '</div>' +
    '<div class="page-subtitle">' + esc(t('todo_subtitle')) + '</div></div>' + logsToggleHtml + '</div>' +
    '<div class="translation-cat-grid">' + catCardsHtml + '</div>' +
    '<div class="card"><div class="card-body">' + tableHtml + '</div></div>';

  wireTodoInboxBody_(filtered);
}

function wireTodoInboxBody_(filtered) {
  var root = document.getElementById('viewRoot');

  root.querySelectorAll('[data-tocat]').forEach(function (btn) {
    btn.onclick = function () { HululTodoState_.categoryFilter = btn.getAttribute('data-tocat'); renderTodoInboxBody_(); };
  });

  var logsToggle = document.getElementById('todoLogsOpenedByMe');
  if (logsToggle) {
    logsToggle.onchange = function () { HululTodoState_.logsOpenedByMeOnly = logsToggle.checked; renderTodoInboxBody_(); };
  }

  root.querySelectorAll('[data-todo-open]').forEach(function (btn) {
    btn.onclick = function () {
      var item = filtered[Number(btn.getAttribute('data-todo-open'))];
      if (!item) return;
      if (item.eventId) window.location.hash = '#/events/' + item.eventId + (item.eventTab ? '?tab=' + item.eventTab : '');
      else if (item.navPath) window.location.hash = '#' + item.navPath;
    };
  });

  root.querySelectorAll('[data-todo-attend]').forEach(function (btn) {
    btn.onclick = async function () {
      var item = filtered[Number(btn.getAttribute('data-todo-attend'))];
      if (!item || !item.meetingId) return;
      btn.disabled = true;
      try {
        await Api.call('markMeetingAttended', { meetingId: item.meetingId });
        UI.toast(t('todo_attended_saved'), 'success');
        await refetchTodoItems_();
      } catch (err) { UI.error(err); btn.disabled = false; }
    };
  });
}

async function refetchTodoItems_() {
  try {
    HululTodoState_.items = await Api.call('listMyTodoItems', {});
    renderTodoInboxBody_();
  } catch (err) { UI.error(err); }
}
