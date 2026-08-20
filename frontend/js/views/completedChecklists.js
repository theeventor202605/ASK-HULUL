/**
 * HULUL - standalone Completed Checklists page (route: /completed-checklists).
 *
 * REQ follow-up: "Completed Checklists can be viewed as a full page filterable list." Same
 * columns/actions as eventDetail.js's own per-event tabCompletedChecklists, but rolled up across
 * every event the caller can see (listAllCompletedChecklists, Inspections.gs) with an added Event
 * column, and reusing UI.table's built-in search/column-filter/CSV-export toolbar for the
 * "filterable" part -- no bespoke filter UI needed.
 *
 * Opening a row reuses openRecordResultsModal (eventDetail.js) exactly as the per-event tab does --
 * that modal is entirely self-contained (its own API calls, its own UI.openModal), so calling it from
 * a page outside any specific event's workspace works with no changes needed there.
 */
async function renderCompletedChecklistsPage() {
  var root = document.getElementById('viewRoot');
  var rows = await Api.call('listAllCompletedChecklists', {});

  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + esc(t('tab_completed_checklists')) + '</div>' +
    '<div class="page-subtitle">' + esc(t('completed_checklists_hint')) + '</div></div></div>' +
    '<div class="card"><div class="card-body">' + UI.table([
      // Same accent-color/bold/no-underline treatment as venues.js's own name-link column --
      // Tailwind's preflight reset otherwise leaves an unstyled <a> looking like plain text.
      { key: 'eventName', label: Term('event'), render: r => '<a href="#/events/' + esc(r.eventId) + '?tab=completedChecklists" style="color:var(--accent);font-weight:600;text-decoration:none;">' + esc(r.eventName) + '</a>' },
      { key: 'participantName', label: Term('participant') },
      { key: 'disciplineName', label: Term('discipline') },
      // REQ follow-up: same reasoning as tabCompletedChecklists (eventDetail.js) -- one row per
      // completed sub-category now, not one per whole inspection, so this column distinguishes them.
      { key: 'checklistType', label: Term('checklistType') },
      { key: 'phase', label: t('col_phase') },
      { key: 'inspectorName', label: Term('inspector') },
      { key: 'progress', label: t('col_progress'), render: r => t('progress_fraction', { done: r.done, total: r.total, term: Term('checklistItem_plural').toLowerCase() }) },
      { key: 'lastRecordedAt', label: t('col_last_recorded'), render: r => UI.fmtDate(r.lastRecordedAt) },
      { key: 'actions', label: t('actions'), exportable: false, sortable: false, render: r => {
          // Same gate as the per-event tab's own Open action (canRecordInspection_, eventDetail.js) --
          // SystemAdmin or the assigned Inspector -- so who can reopen/edit a completed checklist here
          // matches who could have recorded it in the first place.
          if (!canRecordInspection_({ inspectorId: r.inspectorId })) return '—';
          return UI.actionsCell('<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('title_open_checklist')) + '" data-open-checklist="' + r.inspectionId + '::' + r.participantId + '">' + ICON('record_results') + '</button>');
        } }
    ], rows, { emptyText: t('empty_no_completed_checklists') }) + '</div></div>';

  root.querySelectorAll('[data-open-checklist]').forEach(function (btn) {
    btn.onclick = function () {
      var parts = btn.getAttribute('data-open-checklist').split('::');
      var row = rows.filter(function (r) { return r.inspectionId === parts[0] && r.participantId === parts[1]; })[0];
      if (!row) return;
      var inspection = { id: row.inspectionId, disciplineName: row.disciplineName, phase: row.phase };
      var participant = { id: row.participantId, name: row.participantName };
      openRecordResultsModal(row.eventId, inspection, participant);
    };
  });
}
