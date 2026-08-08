/**
 * HULUL - Sub-Events admin view. A Sub-Event inherits its parent Event's Venue/EMC/Inspection Co
 * and must fall within the parent's date window (REQ-EVT-03).
 * One Event *name* (e.g. "Riyadh Season 2026") is often really several Event records, one per
 * venue. Rather than a flat dropdown with the same name repeated once per venue, the left rail
 * has two stacked lists: pick the Event name up top, then pick which Venue underneath it — that
 * combination resolves to a single Event record whose sub-events show on the right.
 */
async function renderSubEvents(params) {
  var root = document.getElementById('viewRoot');
  var [events, venues] = await Promise.all([Api.call('listEvents', {}), Api.call('listVenues', {})]);
  var venueById = {};
  venues.forEach(function (v) { venueById[v.id] = v; });

  if (!events.length) {
    root.innerHTML =
      '<div class="page-header"><div><div class="page-title">' + t('nav_subevents') + '</div>' +
      '<div class="page-subtitle">Sub-events nested inside a parent Event</div></div></div>' +
      '<div class="empty-state">' + t('no_data') + '</div>';
    return;
  }

  var preselected = params && params.eventId ? events.filter(function (e) { return e.id === params.eventId; })[0] : null;
  var view = { name: preselected ? preselected.name : events[0].name, eventId: preselected ? preselected.id : '' };
  if (!view.eventId) {
    var firstInName = events.filter(function (e) { return e.name === view.name; })[0];
    view.eventId = firstInName ? firstInName.id : events[0].id;
  }

  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + t('nav_subevents') + '</div>' +
    '<div class="page-subtitle">Sub-events nested inside a parent Event</div></div></div>' +
    '<div style="display:flex;gap:16px;align-items:flex-start;">' +
      '<div class="card" style="width:230px;flex-shrink:0;">' +
        '<div class="card-header"><div class="card-title">Events</div></div>' +
        '<div id="sevEventPanel" style="padding:8px;max-height:260px;overflow-y:auto;"></div>' +
        '<div class="card-header" style="border-top:1px solid var(--border);"><div class="card-title">Venues</div></div>' +
        '<div id="sevVenuePanel" style="padding:8px;max-height:260px;overflow-y:auto;"></div>' +
      '</div>' +
      '<div style="flex:1;min-width:0;" id="subEventsBody"></div>' +
    '</div>';

  var rowStyle = 'padding:8px 10px;border-radius:8px;cursor:pointer;font-size:13px;margin-top:2px;';

  function renderEventPanel() {
    var names = Array.from(new Set(events.map(function (e) { return e.name; }))).sort();
    var panel = document.getElementById('sevEventPanel');
    panel.innerHTML = names.map(function (n) {
      var active = n === view.name;
      return '<div class="sev-event-row" data-name="' + esc(n) + '" style="' + rowStyle + (active ? 'background:var(--accent);color:#fff;font-weight:600;' : '') + '">' + esc(n) + '</div>';
    }).join('');
    panel.querySelectorAll('.sev-event-row').forEach(function (row) {
      row.onclick = function () {
        view.name = row.getAttribute('data-name');
        var firstInName = events.filter(function (e) { return e.name === view.name; })[0];
        view.eventId = firstInName ? firstInName.id : '';
        renderEventPanel(); renderVenuePanel(); loadFor(view.eventId);
      };
    });
  }

  function renderVenuePanel() {
    var inName = events.filter(function (e) { return e.name === view.name; });
    var panel = document.getElementById('sevVenuePanel');
    panel.innerHTML = inName.length
      ? inName.map(function (e) {
          var venue = venueById[e.venueId];
          var active = e.id === view.eventId;
          return '<div class="sev-venue-row" data-id="' + e.id + '" style="' + rowStyle + (active ? 'background:var(--accent);color:#fff;font-weight:600;' : '') + '">' + esc(venue ? venue.name : e.venueId) + '</div>';
        }).join('')
      : '<div class="muted" style="font-size:12px;padding:6px 10px;">No venues under this event.</div>';
    panel.querySelectorAll('.sev-venue-row').forEach(function (row) {
      row.onclick = function () {
        view.eventId = row.getAttribute('data-id');
        renderVenuePanel(); loadFor(view.eventId);
      };
    });
  }

  renderEventPanel();
  renderVenuePanel();
  await loadFor(view.eventId);

  async function loadFor(eventId) {
    var body = document.getElementById('subEventsBody');
    body.innerHTML = '<div class="empty-state">' + t('loading') + '</div>';
    var detail = await Api.call('getEvent', { eventId: eventId });
    var venue = venueById[detail.event.venueId];
    body.innerHTML =
      '<div class="card"><div class="card-header"><div class="card-title">Sub-events of ' + esc(detail.event.name) +
      (venue ? ' <span class="muted" style="font-weight:400;font-size:12.5px;">(' + esc(venue.name) + ')</span>' : '') + '</div>' +
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
