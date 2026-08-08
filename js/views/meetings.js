/**
 * HULUL - Meetings admin view. Currently only the kickoff meeting (Inspection Co, EMC Manager,
 * Event Manager) is scheduled through the API (REQ-TPL-02).
 * One Event *name* (e.g. "Riyadh Season 2026") is often really several Event records, one per
 * venue. Rather than a flat dropdown with the same name repeated once per venue, the left rail
 * has two stacked lists: pick the Event name up top, then pick which Venue underneath it — that
 * combination resolves to a single Event record whose meetings show on the right.
 */
async function renderMeetings(params) {
  var root = document.getElementById('viewRoot');
  var [events, venues] = await Promise.all([Api.call('listEvents', {}), Api.call('listVenues', {})]);
  var venueById = {};
  venues.forEach(function (v) { venueById[v.id] = v; });

  if (!events.length) {
    root.innerHTML =
      '<div class="page-header"><div><div class="page-title">' + t('nav_meetings') + '</div>' +
      '<div class="page-subtitle">Kickoff meetings scheduled per Event</div></div></div>' +
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
    '<div class="page-header"><div><div class="page-title">' + t('nav_meetings') + '</div>' +
    '<div class="page-subtitle">Kickoff meetings scheduled per Event</div></div></div>' +
    '<div style="display:flex;gap:16px;align-items:flex-start;">' +
      '<div class="card" style="width:230px;flex-shrink:0;">' +
        '<div class="card-header"><div class="card-title">Events</div></div>' +
        '<div id="mtgEventPanel" style="padding:8px;max-height:260px;overflow-y:auto;"></div>' +
        '<div class="card-header" style="border-top:1px solid var(--border);"><div class="card-title">Venues</div></div>' +
        '<div id="mtgVenuePanel" style="padding:8px;max-height:260px;overflow-y:auto;"></div>' +
      '</div>' +
      '<div style="flex:1;min-width:0;" id="meetingsBody"></div>' +
    '</div>';

  var rowStyle = 'padding:8px 10px;border-radius:8px;cursor:pointer;font-size:13px;margin-top:2px;';

  function renderEventPanel() {
    var names = Array.from(new Set(events.map(function (e) { return e.name; }))).sort();
    var panel = document.getElementById('mtgEventPanel');
    panel.innerHTML = names.map(function (n) {
      var active = n === view.name;
      return '<div class="mtg-event-row" data-name="' + esc(n) + '" style="' + rowStyle + (active ? 'background:var(--accent);color:#fff;font-weight:600;' : '') + '">' + esc(n) + '</div>';
    }).join('');
    panel.querySelectorAll('.mtg-event-row').forEach(function (row) {
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
    var panel = document.getElementById('mtgVenuePanel');
    panel.innerHTML = inName.length
      ? inName.map(function (e) {
          var venue = venueById[e.venueId];
          var active = e.id === view.eventId;
          return '<div class="mtg-venue-row" data-id="' + e.id + '" style="' + rowStyle + (active ? 'background:var(--accent);color:#fff;font-weight:600;' : '') + '">' + esc(venue ? venue.name : e.venueId) + '</div>';
        }).join('')
      : '<div class="muted" style="font-size:12px;padding:6px 10px;">No venues under this event.</div>';
    panel.querySelectorAll('.mtg-venue-row').forEach(function (row) {
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
    var body = document.getElementById('meetingsBody');
    body.innerHTML = '<div class="empty-state">' + t('loading') + '</div>';
    var meetings = await Api.call('listMeetings', { eventId: eventId });
    var event = events.filter(function (e) { return e.id === eventId; })[0];
    var venue = event ? venueById[event.venueId] : null;
    body.innerHTML =
      '<div class="card"><div class="card-header"><div class="card-title">Meetings' +
      (venue ? ' <span class="muted" style="font-weight:400;font-size:12.5px;">(' + esc(venue.name) + ')</span>' : '') + '</div>' +
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
