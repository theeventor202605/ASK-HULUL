/**
 * HULUL - Sub-Events admin view. A Sub-Event inherits its parent Event's Venue/EMC/Inspection Co
 * and must fall within the parent's date window (REQ-EVT-03).
 */
async function renderSubEvents(params) {
  var root = document.getElementById('viewRoot');
  var events = await Api.call('listEvents', {});
  var selectedId = params && params.eventId ? params.eventId : (events[0] && events[0].id);

  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + t('nav_subevents') + '</div>' +
    '<div class="page-subtitle">Sub-events nested inside a parent Event</div></div></div>' +
    '<div class="card" style="margin-bottom:16px;"><div class="card-body">' +
    UI.field('Event', '<select id="fSevEvent" class="field-input">' +
      events.map(e => '<option value="' + e.id + '"' + (e.id === selectedId ? ' selected' : '') + '>' + esc(e.name) + '</option>').join('') +
      '</select>') + '</div></div>' +
    '<div id="subEventsBody"></div>';

  if (!events.length) {
    document.getElementById('subEventsBody').innerHTML = '<div class="empty-state">' + t('no_data') + '</div>';
    return;
  }

  document.getElementById('fSevEvent').onchange = function () { loadFor(this.value); };
  await loadFor(selectedId);

  async function loadFor(eventId) {
    var body = document.getElementById('subEventsBody');
    body.innerHTML = '<div class="empty-state">' + t('loading') + '</div>';
    var detail = await Api.call('getEvent', { eventId: eventId });
    body.innerHTML =
      '<div class="card"><div class="card-header"><div class="card-title">Sub-events of ' + esc(detail.event.name) + '</div>' +
      '<button class="btn btn-primary btn-sm" id="newSevBtn">+ New sub-event</button></div>' +
      '<div class="card-body">' + UI.table([
        { key: 'name', label: 'Name' },
        { key: 'startDateTime', label: 'Start', render: r => UI.fmtDate(r.startDateTime) },
        { key: 'endDateTime', label: 'End', render: r => UI.fmtDate(r.endDateTime) }
      ], detail.subEvents, {}) + '</div></div>';

    document.getElementById('newSevBtn').onclick = function () {
      var m = UI.field('Name', '<input id="fSevName" class="field-input" />') +
        '<div class="form-row">' + UI.field('Start', '<input id="fSevStart" type="datetime-local" class="field-input" />') +
        UI.field('End', '<input id="fSevEnd" type="datetime-local" class="field-input" />') + '</div>';
      UI.openModal('New sub-event', m, [
        { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
        { label: t('create'), className: 'btn-primary', onClick: async function () {
            try {
              await Api.call('createSubEvent', {
                eventId: eventId, name: document.getElementById('fSevName').value,
                startDateTime: document.getElementById('fSevStart').value, endDateTime: document.getElementById('fSevEnd').value
              });
              UI.closeModal(); UI.toast('Sub-event created', 'success');
              window.location.hash = '#/sub-events?eventId=' + eventId; Router.resolve();
            } catch (err) { UI.error(err); }
          } }
      ]);
    };
  }
}
