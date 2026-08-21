/**
 * HULUL - Sidebar Re-assignment page.
 * REQ: "If a user is absent then he will be added to list in this page as unavailable. Accordingly
 * all assignments related to the user will appear and can be assigned to temporary another user. If
 * an inspector is unavailable then a matching discipline inspector will be suggested. If suggested
 * inspector has conflicting schedule with the current unassigned user schedule then it can be
 * rescheduled from within this page."
 *
 * Two "assignment" relations exist as a direct userId column: InspectorAssignments.inspectorId (the
 * main case -- matching-discipline suggestions + conflict-aware reschedule) and Events.eventManagerId
 * (reassigned via the existing assignEventManager). See backend/Reassignment.gs for the full design
 * rationale and backend/Disciplines.gs for eventsOverlap_/inspectorConflict_, reused server-side.
 */
async function renderReassignment() {
  var root = document.getElementById('viewRoot');
  root.innerHTML = '<div class="empty-state">' + t('loading') + '</div>';

  var results = await Promise.all([
    Api.call('listUnavailableUsers', {}),
    Api.call('listUsers', {})
  ]);
  var unavailableUsers = results[0], allUsers = results[1];
  var unavailableIds = {}; unavailableUsers.forEach(function (u) { unavailableIds[u.id] = true; });
  var availableCandidates = allUsers.filter(function (u) { return u.status === 'Active' && !unavailableIds[u.id]; });
  var eventManagerCandidates = allUsers.filter(function (u) { return u.role === 'EventManager' && u.status === 'Active' && !unavailableIds[u.id]; });

  // Fetch every unavailable user's assignments + replacement suggestions up front so each card
  // below renders complete, with no further per-card loading state.
  var assignmentsByUser = {};
  await Promise.all(unavailableUsers.map(async function (u) {
    assignmentsByUser[u.id] = await Api.call('listUserAssignments', { userId: u.id });
  }));
  var suggestionsByAssignment = {};
  await Promise.all(unavailableUsers.map(function (u) {
    return Promise.all((assignmentsByUser[u.id].inspectorAssignments || []).map(async function (a) {
      suggestionsByAssignment[a.id] = await Api.call('listReplacementSuggestions', { eventId: a.eventId, disciplineId: a.disciplineId, excludeUserId: u.id });
    }));
  }));

  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + esc(t('reassignment_title')) + '</div>' +
    '<div class="page-subtitle">' + esc(t('reassignment_subtitle')) + '</div></div></div>' +
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + esc(t('mark_unavailable_card_title')) + '</div></div>' +
    '<div class="card-body form-row">' +
      UI.field(t('field_user'), '<select id="fMarkUser" class="field-input">' +
        (availableCandidates.length
          ? availableCandidates.map(function (u) { return '<option value="' + u.id + '">' + esc(u.name) + ' (' + esc(u.role) + ')</option>'; }).join('')
          : '<option value="">' + esc(t('no_available_users')) + '</option>') +
        '</select>') +
      UI.field(t('field_reason_optional'), '<input type="text" id="fMarkReason" class="field-input" placeholder="' + esc(t('reason_placeholder')) + '" />') +
    '</div>' +
    '<div class="card-body" style="padding-top:0;"><button class="btn btn-primary btn-sm" id="markUnavailBtn"' + (availableCandidates.length ? '' : ' disabled') + '>' + esc(t('mark_unavailable_btn')) + '</button></div></div>' +
    (unavailableUsers.length
      ? unavailableUsers.map(function (u) { return unavailableUserCardHtml_(u, assignmentsByUser[u.id], suggestionsByAssignment, eventManagerCandidates); }).join('')
      : '<div class="card"><div class="card-body"><div class="empty-state">' + esc(t('empty_no_one_unavailable')) + '</div></div></div>');

  document.getElementById('markUnavailBtn').onclick = async function () {
    var userId = document.getElementById('fMarkUser').value;
    if (!userId) { UI.toast(t('toast_select_user'), 'error'); return; }
    var reason = document.getElementById('fMarkReason').value.trim();
    try {
      await Api.call('setUserUnavailable', { userId: userId, reason: reason });
      UI.toast(t('toast_marked_unavailable'), 'success'); Router.resolve();
    } catch (err) { UI.error(err); }
  };

  root.querySelectorAll('[data-mark-available]').forEach(function (btn) {
    btn.onclick = async function () {
      try {
        await Api.call('setUserAvailable', { userId: btn.getAttribute('data-mark-available') });
        UI.toast(t('toast_marked_available'), 'success'); Router.resolve();
      } catch (err) { UI.error(err); }
    };
  });

  function updateConflictNote_(select) {
    var note = root.querySelector('.reassign-conflict-note[data-for="' + select.getAttribute('data-assignment') + '"]');
    if (!note) return;
    var opt = select.options[select.selectedIndex];
    if (opt && opt.getAttribute('data-conflict-event')) {
      note.innerHTML = '<span style="color:var(--danger);">' + t('also_assigned_to', { name: '<strong>' + esc(opt.getAttribute('data-conflict-name')) + '</strong>', start: esc(opt.getAttribute('data-conflict-start')), end: esc(opt.getAttribute('data-conflict-end')) }) + '</span> ' +
        '<button type="button" class="btn btn-secondary btn-sm" data-reschedule-btn data-candidate="' + esc(opt.value) + '" data-conflict-event="' + esc(opt.getAttribute('data-conflict-event')) + '">' + esc(t('reschedule_btn')) + '</button>';
      note.style.display = '';
      wireRescheduleButtons_(note);
    } else {
      note.innerHTML = ''; note.style.display = 'none';
    }
  }
  root.querySelectorAll('.reassign-select').forEach(function (select) {
    updateConflictNote_(select);
    select.onchange = function () { updateConflictNote_(select); };
  });

  root.querySelectorAll('[data-reassign-btn]').forEach(function (btn) {
    btn.onclick = async function () {
      var assignmentId = btn.getAttribute('data-reassign-btn');
      var select = root.querySelector('.reassign-select[data-assignment="' + assignmentId + '"]');
      if (!select.value) { UI.toast(t('toast_choose_replacement_x', { term: Term('inspector').toLowerCase() }), 'error'); return; }
      try {
        await Api.call('reassignInspector', { eventId: select.getAttribute('data-event'), oldAssignmentId: assignmentId, newInspectorId: select.value });
        UI.toast(t('toast_x_reassigned', { term: Term('inspector') }), 'success'); Router.resolve();
      } catch (err) { UI.error(err); }
    };
  });

  root.querySelectorAll('[data-reassign-em-btn]').forEach(function (btn) {
    btn.onclick = async function () {
      var eventId = btn.getAttribute('data-reassign-em-btn');
      var select = root.querySelector('.reassign-em-select[data-event="' + eventId + '"]');
      if (!select || !select.value) { UI.toast(t('toast_choose_replacement_em'), 'error'); return; }
      try {
        await Api.call('assignEventManager', { eventId: eventId, eventManagerId: select.value });
        UI.toast(t('toast_em_reassigned'), 'success'); Router.resolve();
      } catch (err) { UI.error(err); }
    };
  });

  wireRescheduleButtons_(root);
}

// REQ: "...it can be rescheduled from within this page." Assignments themselves carry no time slot
// (event-wide only, see Disciplines.gs), so what's actually reschedulable is the suggested
// candidate's already-*booked* Inspections on the conflicting event -- moving one to a different
// time/day within that event's own range is what can turn a same-events-overlap "conflict" into two
// visits that no longer collide in practice. Opens a modal (stays on this page) rather than
// navigating away.
function wireRescheduleButtons_(scope) {
  scope.querySelectorAll('[data-reschedule-btn]').forEach(function (btn) {
    btn.onclick = async function () {
      var candidateId = btn.getAttribute('data-candidate');
      var conflictEventId = btn.getAttribute('data-conflict-event');
      var inspections;
      try { inspections = await Api.call('listInspections', { eventId: conflictEventId }); } catch (err) { UI.error(err); return; }
      inspections = inspections.filter(function (i) { return i.inspectorId === candidateId && i.status === 'Scheduled'; });
      if (!inspections.length) {
        UI.toast(t('toast_no_scheduled_visits', { term: Term('inspector').toLowerCase(), eventTerm: Term('event').toLowerCase() }), 'error');
        return;
      }
      var body = '<div style="font-size:13px;margin-bottom:10px;">' + esc(t('reschedule_intro', { term: Term('inspector').toLowerCase(), eventTerm: Term('event').toLowerCase() })) + '</div>' +
        inspections.map(function (i) {
          return '<div style="display:flex;align-items:center;gap:8px;margin:8px 0;">' +
            '<span style="font-size:12.5px;flex:1;">' + esc(i.disciplineName) + ' · ' + esc(i.phase) + '</span>' +
            '<input type="datetime-local" class="field-input reschedule-input" data-inspection="' + esc(i.id) + '" value="' + toDatetimeLocalValue_(i.scheduledAt) + '" style="width:auto;" />' +
          '</div>';
        }).join('');
      UI.openModal(t('reschedule_modal_title'), body, [
        { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
        { label: t('save'), className: 'btn-primary', onClick: async function () {
            var inputs = Array.from(document.querySelectorAll('.reschedule-input'));
            try {
              for (var i = 0; i < inputs.length; i++) {
                if (!inputs[i].value) continue;
                // Inspections.scheduledAt is a literal wall-clock string (no timezone attached, same
                // convention as every other scheduling field -- see DATE_TEXT_COLUMNS_, Utils.gs), sent
                // straight from the <input type="datetime-local"> exactly like every other reschedule/
                // schedule flow in the app. This USED to run inputs[i].value through
                // `new Date(...).toISOString()` first, which silently reinterpreted the picked local
                // clock time as a UTC instant and shifted it by the browser's timezone offset before
                // saving -- the fix for "I ran against a different saved date time than the one I
                // selected": the picked value must be saved byte-for-byte, never round-tripped through
                // a Date object.
                await Api.call('updateInspection', { eventId: conflictEventId, inspectionId: inputs[i].getAttribute('data-inspection'), scheduledAt: inputs[i].value });
              }
              UI.closeModal(); UI.toast(t('toast_rescheduled'), 'success'); Router.resolve();
            } catch (err) { UI.error(err); }
          } }
      ]);
    };
  });
}

function unavailableUserCardHtml_(u, assignments, suggestionsByAssignment, eventManagerCandidates) {
  var inspectorAssignments = (assignments && assignments.inspectorAssignments) || [];
  var managedEvents = (assignments && assignments.managedEvents) || [];
  var rows = inspectorAssignments.map(function (a) {
    var suggestions = suggestionsByAssignment[a.id] || [];
    return '<div style="padding:10px 0;border-bottom:1px solid #f0f1f6;">' +
      '<div style="font-size:13px;"><strong>' + esc(a.disciplineName) + '</strong> — ' + esc(a.eventName) +
        '<span class="muted"> (' + esc(UI.fmtDate(a.eventStart)) + ' – ' + esc(UI.fmtDate(a.eventEnd)) + ')</span>' +
        (a.zoneNames.length ? '<span class="muted"> · ' + esc(a.zoneNames.join(', ')) + '</span>' : '') + '</div>' +
      (suggestions.length
        ? '<div style="margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
            '<select class="reassign-select field-input" data-assignment="' + esc(a.id) + '" data-event="' + esc(a.eventId) + '" style="width:auto;">' +
              suggestions.map(function (s, i) {
                var conflictAttrs = s.conflict
                  ? ' data-conflict-event="' + esc(s.conflict.eventId) + '" data-conflict-name="' + esc(s.conflict.eventName) + '" data-conflict-start="' + esc(UI.fmtDate(s.conflict.startDateTime)) + '" data-conflict-end="' + esc(UI.fmtDate(s.conflict.endDateTime)) + '"'
                  : '';
                return '<option value="' + esc(s.id) + '"' + (i === 0 ? ' selected' : '') + conflictAttrs + '>' + esc(s.name) + (s.conflict ? esc(t('label_conflict_suffix')) : esc(t('label_suggested_suffix'))) + '</option>';
              }).join('') +
            '</select>' +
            '<button class="btn btn-primary btn-sm" data-reassign-btn="' + esc(a.id) + '">' + esc(t('reassign_btn')) + '</button>' +
          '</div>' +
          '<div class="reassign-conflict-note" data-for="' + esc(a.id) + '" style="font-size:11.5px;margin-top:6px;display:none;"></div>'
        : '<div class="muted" style="font-size:12px;margin-top:6px;color:var(--danger);">' + esc(t('no_qualified_replacement', { term: Term('discipline').toLowerCase() })) + '</div>') +
      '</div>';
  }).join('');

  var emRows = managedEvents.map(function (e) {
    return '<div style="padding:10px 0;border-bottom:1px solid #f0f1f6;">' +
      '<div style="font-size:13px;"><strong>' + esc(t('label_event_manager')) + '</strong> — ' + esc(e.name) +
        '<span class="muted"> (' + esc(UI.fmtDate(e.startDateTime)) + ' – ' + esc(UI.fmtDate(e.endDateTime)) + ')</span></div>' +
      (eventManagerCandidates.length
        ? '<div style="margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
            '<select class="reassign-em-select field-input" data-event="' + esc(e.id) + '" style="width:auto;">' +
              eventManagerCandidates.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>'; }).join('') +
            '</select>' +
            '<button class="btn btn-primary btn-sm" data-reassign-em-btn="' + esc(e.id) + '">' + esc(t('reassign_btn')) + '</button>' +
          '</div>'
        : '<div class="muted" style="font-size:12px;margin-top:6px;">' + esc(t('no_other_em_available')) + '</div>') +
      '</div>';
  }).join('');

  var body = (rows + emRows) || '<div class="empty-state">' + esc(t('no_current_assignments')) + '</div>';

  return '<div class="card" style="margin-bottom:16px;">' +
    '<div class="card-header" style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">' +
    '<div><div class="card-title">' + esc(u.name) + ' <span class="muted" style="font-weight:400;font-size:12px;">(' + esc(u.role) + ')</span></div>' +
    '<div class="muted" style="font-size:11.5px;margin-top:2px;">' + esc(t('unavailable_since_prefix', { date: UI.fmtDate(u.unavailableSince) })) + (u.unavailableReason ? ' — ' + esc(u.unavailableReason) : '') + '</div></div>' +
    '<button class="btn btn-secondary btn-sm" data-mark-available="' + esc(u.id) + '">' + esc(t('mark_available_btn')) + '</button>' +
    '</div>' +
    '<div class="card-body">' + body + '</div></div>';
}
