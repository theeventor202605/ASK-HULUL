/**
 * HULUL - Events list view + "New Event" creation (REQ-EVT-01/02).
 */
async function renderEventsList() {
  var root = document.getElementById('viewRoot');
  var [events, venues] = await Promise.all([Api.call('listEvents', {}), Api.call('listVenues', {})]);

  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + t('events_title') + '</div>' +
    '<div class="page-subtitle">All events across your organisation</div></div>' +
    '<button class="btn btn-primary" id="newEventBtn">+ ' + t('new_event') + '</button></div>' +
    '<div class="card"><div class="card-body">' + UI.table(
      [
        { key: 'name', label: 'Event', render: function (r) { return '<a href="#/events/' + r.id + '" style="color:var(--accent);font-weight:600;text-decoration:none;">' + esc(r.name) + '</a>'; } },
        { key: 'code', label: 'Code' },
        { key: 'city', label: 'City' },
        { key: 'startDateTime', label: 'Start', render: function (r) { return UI.fmtDate(r.startDateTime); } },
        { key: 'endDateTime', label: 'End', render: function (r) { return UI.fmtDate(r.endDateTime); } },
        { key: 'status', label: t('status'), render: function (r) { return UI.statusBadge(r.status); } },
        { key: 'actions', label: t('actions'), render: function (r) { return '<a class="btn btn-secondary btn-sm" href="#/events/' + r.id + '">Open</a>'; } }
      ],
      events, {}
    ) + '</div></div>';

  document.getElementById('newEventBtn').onclick = function () { openNewEventModal(venues); };
}

function openNewEventModal(venues) {
  var venueOptions = venues.map(function (v) { return '<option value="' + v.id + '">' + esc(v.name) + ' (' + esc(v.city) + ')</option>'; }).join('');
  var body =
    UI.field('Event name', '<input id="fEventName" class="field-input" />') +
    UI.field('Venue', '<select id="fVenueId" class="field-input">' + venueOptions + '</select>') +
    '<div class="form-row">' +
      UI.field('Address', '<input id="fAddress" class="field-input" />') +
      UI.field('City', '<input id="fCity" class="field-input" />') +
    '</div>' +
    '<div class="form-row">' +
      UI.field('Start', '<input id="fStart" type="datetime-local" class="field-input" />') +
      UI.field('End', '<input id="fEnd" type="datetime-local" class="field-input" />') +
    '</div>' +
    UI.field('Inspection Company ID', '<input id="fInspCo" class="field-input" placeholder="ORG-0001" />');

  UI.openModal(t('new_event'), body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('create'), className: 'btn-primary', onClick: async function () {
        try {
          await Api.call('createEvent', {
            name: document.getElementById('fEventName').value,
            venueId: document.getElementById('fVenueId').value,
            address: document.getElementById('fAddress').value,
            city: document.getElementById('fCity').value,
            startDateTime: document.getElementById('fStart').value,
            endDateTime: document.getElementById('fEnd').value,
            inspectionCoId: document.getElementById('fInspCo').value
          });
          UI.closeModal();
          UI.toast('Event created', 'success');
          Router.resolve();
        } catch (err) { UI.error(err); }
      } }
  ]);
}
