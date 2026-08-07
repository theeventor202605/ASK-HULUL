/**
 * HULUL - Meetings admin view. Currently only the kickoff meeting (Inspection Co, EMC Manager,
 * Event Manager) is scheduled through the API (REQ-TPL-02).
 */
async function renderMeetings(params) {
  var root = document.getElementById('viewRoot');
  var events = await Api.call('listEvents', {});
  var selectedId = params && params.eventId ? params.eventId : (events[0] && events[0].id);

  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + t('nav_meetings') + '</div>' +
    '<div class="page-subtitle">Kickoff meetings scheduled per Event</div></div></div>' +
    '<div class="card" style="margin-bottom:16px;"><div class="card-body">' +
    UI.field('Event', '<select id="fMtgEvent" class="field-input">' +
      events.map(e => '<option value="' + e.id + '"' + (e.id === selectedId ? ' selected' : '') + '>' + esc(e.name) + '</option>').join('') +
      '</select>') + '</div></div>' +
    '<div id="meetingsBody"></div>';

  if (!events.length) {
    document.getElementById('meetingsBody').innerHTML = '<div class="empty-state">' + t('no_data') + '</div>';
    return;
  }

  document.getElementById('fMtgEvent').onchange = function () { loadFor(this.value); };
  await loadFor(selectedId);

  async function loadFor(eventId) {
    var body = document.getElementById('meetingsBody');
    body.innerHTML = '<div class="empty-state">' + t('loading') + '</div>';
    var meetings = await Api.call('listMeetings', { eventId: eventId });
    body.innerHTML =
      '<div class="card"><div class="card-header"><div class="card-title">Meetings</div>' +
      '<button class="btn btn-primary btn-sm" id="newMtgBtn">+ Schedule kickoff</button></div>' +
      '<div class="card-body">' + UI.table([
        { key: 'type', label: 'Type' },
        { key: 'scheduledAt', label: 'When', render: r => UI.fmtDate(r.scheduledAt) },
        { key: 'notes', label: 'Notes' }
      ], meetings, {}) + '</div></div>';

    document.getElementById('newMtgBtn').onclick = function () {
      var m = UI.field('Scheduled at', '<input id="fMtgWhen" type="datetime-local" class="field-input" />') +
        UI.field('Notes', '<textarea id="fMtgNotes" class="field-input" rows="2"></textarea>');
      UI.openModal('Schedule kickoff meeting', m, [
        { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
        { label: t('create'), className: 'btn-primary', onClick: async function () {
            try {
              await Api.call('scheduleKickoff', {
                eventId: eventId, scheduledAt: document.getElementById('fMtgWhen').value,
                notes: document.getElementById('fMtgNotes').value
              });
              UI.closeModal(); UI.toast('Meeting scheduled', 'success');
              window.location.hash = '#/meetings?eventId=' + eventId; Router.resolve();
            } catch (err) { UI.error(err); }
          } }
      ]);
    };
  }
}
