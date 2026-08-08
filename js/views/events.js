/**
 * HULUL - Events list view + "New Event" creation (REQ-EVT-01/02).
 * One "Event" (e.g. "Riyadh Season 2026") is often really a program that runs at many venues —
 * each venue gets its own Event record sharing the same name. The side panel groups by that
 * shared name so you can browse "every venue under this event" instead of one flat table.
 */
// Only these roles can create/import events (matches createEvent's backend requireRole), so only
// they need the Organizations lookup (used to build the Inspection Company dropdown). Everyone
// else — Inspectors, EMC/Inspection analysts, Vendors, etc. — just views the events already
// scoped to them by listEvents. Fetching listOrganizations unconditionally used to break the
// whole page for those roles: it 403s for anyone outside its allow-list, and since it was in the
// same Promise.all as listEvents/listVenues, that one rejection failed the entire page load.
var EVENT_MANAGE_ROLES = ['SystemAdmin', 'GAAdmin', 'GAUser'];

async function renderEventsList() {
  var root = document.getElementById('viewRoot');
  var canManage = EVENT_MANAGE_ROLES.indexOf(HululState.user.role) !== -1;
  var [events, venues, orgs] = await Promise.all([
    Api.call('listEvents', {}), Api.call('listVenues', {}),
    canManage ? Api.call('listOrganizations', {}) : Promise.resolve([])
  ]);
  var inspectionCos = orgs.filter(function (o) { return o.type === 'INSPECTION'; });
  var venueById = {};
  venues.forEach(function (v) { venueById[v.id] = v; });
  var view = { name: '' };

  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + t('events_title') + '</div>' +
    '<div class="page-subtitle">All events across your organisation</div></div>' +
    '<div style="display:flex;gap:8px;">' +
      '<button class="btn btn-secondary" id="exportCsvBtn">Export CSV</button>' +
      (canManage ?
        '<button class="btn btn-secondary" id="importCsvBtn">Import CSV</button>' +
        '<input type="file" id="importCsvInput" accept=".csv" style="display:none;" />' +
        '<button class="btn btn-primary" id="newEventBtn">+ ' + t('new_event') + '</button>'
        : '') +
    '</div></div>' +
    '<div style="display:flex;gap:16px;align-items:flex-start;">' +
      '<div class="card" style="width:230px;flex-shrink:0;"><div class="card-header"><div class="card-title">Events</div></div>' +
      '<div id="eventPanel" style="padding:8px;max-height:560px;overflow-y:auto;"></div></div>' +
      '<div class="card" style="flex:1;min-width:0;"><div class="card-body" id="eventsTableWrap"></div></div>' +
    '</div>';

  renderEventPanel();
  renderEventsTable();

  function renderEventPanel() {
    var counts = {};
    events.forEach(function (e) { counts[e.name] = (counts[e.name] || 0) + 1; });
    var names = Array.from(new Set(events.map(function (e) { return e.name; }))).sort();
    var panel = document.getElementById('eventPanel');
    var rowStyle = 'padding:8px 10px;border-radius:8px;cursor:pointer;font-size:13px;margin-top:2px;';
    var html = '<div class="event-row" data-name="" style="' + rowStyle + 'font-weight:700;' +
      (!view.name ? 'background:var(--accent);color:#fff;' : '') + '">All events <span style="opacity:.75;font-size:11.5px;">(' + events.length + ')</span></div>';
    html += names.map(function (n) {
      var active = view.name === n;
      return '<div class="event-row" data-name="' + esc(n) + '" style="' + rowStyle + (active ? 'background:var(--accent);color:#fff;font-weight:600;' : '') + '">' +
        esc(n) + ' <span style="opacity:.75;font-size:11.5px;">(' + (counts[n] || 0) + ')</span></div>';
    }).join('');
    panel.innerHTML = html;
    panel.querySelectorAll('.event-row').forEach(function (row) {
      row.onclick = function () { view.name = row.getAttribute('data-name'); renderEventPanel(); renderEventsTable(); };
    });
  }

  function renderEventsTable() {
    var filtered = view.name ? events.filter(function (e) { return e.name === view.name; }) : events;
    var wrap = document.getElementById('eventsTableWrap');
    wrap.innerHTML = UI.table(
      [
        { key: 'name', label: 'Event', render: function (r) { return '<a href="#/events/' + r.id + '" style="color:var(--accent);font-weight:600;text-decoration:none;">' + esc(r.name) + '</a>'; } },
        { key: 'venueId', label: 'Venue', render: function (r) { return esc(venueById[r.venueId] ? venueById[r.venueId].name : r.venueId); } },
        { key: 'code', label: 'Code' },
        { key: 'city', label: 'City' },
        { key: 'startDateTime', label: 'Start', render: function (r) { return UI.fmtDate(r.startDateTime); } },
        { key: 'endDateTime', label: 'End', render: function (r) { return UI.fmtDate(r.endDateTime); } },
        { key: 'status', label: t('status'), render: function (r) { return UI.statusBadge(r.status); } },
        { key: 'actions', label: t('actions'), render: function (r) {
            var html = '<a class="btn btn-secondary btn-sm" href="#/events/' + r.id + '">Open</a>';
            var canEdit = ['SystemAdmin', 'GAAdmin', 'GAUser'].indexOf(HululState.user.role) !== -1;
            if (canEdit) html += ' <button class="btn btn-secondary btn-sm" data-edit-event="' + r.id + '">Edit</button>';
            var canDelete = r.status === 'Planning' && ['SystemAdmin', 'GAAdmin'].indexOf(HululState.user.role) !== -1;
            if (canDelete) html += ' <button class="btn btn-danger btn-sm" data-del-event="' + r.id + '">Delete</button>';
            return html;
          } }
      ],
      filtered, {}
    );
    wrap.querySelectorAll('[data-edit-event]').forEach(function (b) {
      b.onclick = function () {
        var ev = events.filter(function (e) { return e.id === b.getAttribute('data-edit-event'); })[0];
        openEditEventModal(ev, venueById);
      };
    });
    wrap.querySelectorAll('[data-del-event]').forEach(function (b) {
      b.onclick = function () {
        var eventId = b.getAttribute('data-del-event');
        UI.confirmModal('Delete this event? This cannot be undone.', async function () {
          try { await Api.call('deleteEvent', { eventId: eventId }); UI.toast('Event deleted', 'success'); Router.resolve(); }
          catch (err) { UI.error(err); }
        }, { confirmLabel: 'Delete' });
      };
    });
  }

  document.getElementById('exportCsvBtn').onclick = function () {
    var filtered = view.name ? events.filter(function (e) { return e.name === view.name; }) : events;
    exportEventsCsv(filtered, venueById);
  };
  if (canManage) {
    document.getElementById('newEventBtn').onclick = function () { openNewEventModal(venues, inspectionCos); };
    var importInput = document.getElementById('importCsvInput');
    document.getElementById('importCsvBtn').onclick = function () { importInput.click(); };
    importInput.onchange = function (e) {
      var file = e.target.files[0];
      if (file) importEventsCsv(file, venues, inspectionCos);
      e.target.value = '';
    };
  }
}

function openNewEventModal(venues, inspectionCos) {
  var venueOptions = venues.map(function (v) { return '<option value="' + v.id + '">' + esc(v.name) + ' (' + esc(v.city) + ')</option>'; }).join('');
  var inspCoOptions = inspectionCos.length
    ? inspectionCos.map(function (o) { return '<option value="' + o.id + '">' + esc(o.name) + '</option>'; }).join('')
    : '<option value="">No inspection companies found</option>';
  var body =
    UI.field('Event name', '<input id="fEventName" class="field-input" />') +
    UI.field('Venue', '<select id="fVenueId" class="field-input">' + venueOptions + '</select>') +
    '<div class="form-row">' +
      UI.field('Address', '<input id="fAddress" class="field-input" readonly />') +
      UI.field('City', '<input id="fCity" class="field-input" readonly />') +
    '</div>' +
    '<div class="muted" style="font-size:11.5px;margin:-6px 0 12px;">Address & city are pulled from the selected venue.</div>' +
    '<div class="form-row">' +
      UI.field('Start', '<input id="fStart" type="datetime-local" class="field-input" />') +
      UI.field('End', '<input id="fEnd" type="datetime-local" class="field-input" />') +
    '</div>' +
    UI.field('Inspection Company', '<select id="fInspCo" class="field-input">' + inspCoOptions + '</select>');

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

  var venueSelect = document.getElementById('fVenueId');
  function fillFromVenue() {
    var venue = venues.filter(function (v) { return v.id === venueSelect.value; })[0];
    document.getElementById('fAddress').value = venue ? venue.address : '';
    document.getElementById('fCity').value = venue ? venue.city : '';
  }
  venueSelect.onchange = fillFromVenue;
  fillFromVenue();
}

// Venue and Inspection Company aren't editable here (updateEvent doesn't patch them) — fixing
// those means recreating the event. This covers the common fix: a wrong name/address/city/time.
function openEditEventModal(event, venueById) {
  if (!event) return;
  var venue = venueById[event.venueId];
  var body =
    (venue ? '<div class="muted" style="font-size:12px;margin-bottom:12px;">Venue: ' + esc(venue.name) + ' — not editable here (fixed at creation)</div>' : '') +
    UI.field('Event name', '<input id="fEditName" class="field-input" value="' + esc(event.name) + '" />') +
    '<div class="form-row">' +
      UI.field('Address', '<input id="fEditAddress" class="field-input" value="' + esc(event.address) + '" />') +
      UI.field('City', '<input id="fEditCity" class="field-input" value="' + esc(event.city) + '" />') +
    '</div>' +
    '<div class="form-row">' +
      UI.field('Start', '<input id="fEditStart" type="datetime-local" class="field-input" value="' + esc(normalizeDateTimeLocal(event.startDateTime)) + '" />') +
      UI.field('End', '<input id="fEditEnd" type="datetime-local" class="field-input" value="' + esc(normalizeDateTimeLocal(event.endDateTime)) + '" />') +
    '</div>';
  UI.openModal('Edit event', body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('save'), className: 'btn-primary', onClick: async function () {
        try {
          await Api.call('updateEvent', {
            eventId: event.id,
            name: document.getElementById('fEditName').value,
            address: document.getElementById('fEditAddress').value,
            city: document.getElementById('fEditCity').value,
            startDateTime: document.getElementById('fEditStart').value,
            endDateTime: document.getElementById('fEditEnd').value
          });
          UI.closeModal(); UI.toast('Event updated', 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      } }
  ]);
}

/* ---------------- CSV export / import ---------------- */
function csvEscape_(v) {
  var s = v === undefined || v === null ? '' : String(v);
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function exportEventsCsv(rows, venueById) {
  var headers = ['Event Name', 'Venue', 'Address', 'City', 'Start', 'End', 'Status', 'Code', 'Project'];
  var lines = [headers.map(csvEscape_).join(',')];
  rows.forEach(function (r) {
    var venue = venueById[r.venueId];
    lines.push([
      r.name, venue ? venue.name : r.venueId, r.address, r.city, r.startDateTime, r.endDateTime, r.status, r.code, r.project
    ].map(csvEscape_).join(','));
  });
  // Leading UTF-8 BOM: without it, Excel guesses the system ANSI codepage instead of UTF-8 and
  // renders any non-Latin text (Arabic address/city, etc.) as mojibake.
  var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = 'hulul-events-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Minimal RFC4180-ish CSV parser: handles quoted fields, embedded commas/quotes/newlines.
function parseCsv_(text) {
  var rows = [], row = [], field = '', inQuotes = false;
  for (var i = 0; i < text.length; i++) {
    var c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip, \n handles the break */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(function (r) { return !(r.length === 1 && r[0].trim() === ''); });
}

// Accepts "YYYY-MM-DD HH:mm" / "YYYY-MM-DDTHH:mm" as-is (no timezone shifting); anything else is
// run through Date parsing using local wall-clock fields, matching how the New Event form's
// datetime-local input stores values.
function normalizeDateTimeLocal(raw) {
  if (!raw) return '';
  var s = String(raw).trim().replace(' ', 'T');
  var m = s.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (m) return m[1] + 'T' + m[2];
  var d = new Date(s);
  if (!isNaN(d)) {
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  return s;
}

async function importEventsCsv(file, venues, inspectionCos) {
  var text = await file.text();
  var rows = parseCsv_(text);
  if (!rows.length) { UI.toast('Empty CSV file', 'error'); return; }
  var headers = rows[0].map(function (h) { return h.trim().toLowerCase(); });
  var col = function (name) { return headers.indexOf(name); };
  var idxName = col('event name') !== -1 ? col('event name') : col('name');
  var idxVenue = col('venue');
  var idxAddress = col('address');
  var idxCity = col('city');
  var idxStart = col('start');
  var idxEnd = col('end');
  var idxInsp = col('inspection company') !== -1 ? col('inspection company') : col('inspection co');
  var idxCode = col('code');
  var idxProject = col('project');
  if (idxName === -1 || idxVenue === -1 || idxStart === -1 || idxEnd === -1) {
    UI.toast('CSV needs at least: Event Name, Venue, Start, End columns', 'error');
    return;
  }

  var results = { created: [], failed: [] };
  for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    if (!row.length || row.every(function (c) { return c.trim() === ''; })) continue;
    var name = (row[idxName] || '').trim();
    var venueName = (row[idxVenue] || '').trim();
    var venue = venues.filter(function (v) { return v.name.toLowerCase() === venueName.toLowerCase(); })[0];
    if (!venue) { results.failed.push({ row: r + 1, name: name || '(unnamed)', reason: 'Venue "' + venueName + '" not found' }); continue; }
    var inspName = idxInsp !== -1 ? (row[idxInsp] || '').trim() : '';
    var inspCo = inspName
      ? inspectionCos.filter(function (o) { return o.name.toLowerCase() === inspName.toLowerCase(); })[0]
      : inspectionCos[0];
    if (!inspCo) { results.failed.push({ row: r + 1, name: name || '(unnamed)', reason: 'Inspection company "' + inspName + '" not found' }); continue; }
    var payload = {
      name: name,
      venueId: venue.id,
      address: (idxAddress !== -1 && row[idxAddress] && row[idxAddress].trim()) || venue.address,
      city: (idxCity !== -1 && row[idxCity] && row[idxCity].trim()) || venue.city,
      startDateTime: normalizeDateTimeLocal(row[idxStart]),
      endDateTime: normalizeDateTimeLocal(row[idxEnd]),
      inspectionCoId: inspCo.id,
      code: idxCode !== -1 ? (row[idxCode] || '').trim() : '',
      project: idxProject !== -1 ? (row[idxProject] || '').trim() : ''
    };
    try {
      await Api.call('createEvent', payload);
      results.created.push(name);
    } catch (err) {
      results.failed.push({ row: r + 1, name: name || '(unnamed)', reason: err.message });
    }
  }
  showImportResults_(results);
  if (results.created.length) Router.resolve();
}

function showImportResults_(results) {
  var body = '<div style="font-size:13.5px;">' +
    '<div style="margin-bottom:8px;"><strong>' + results.created.length + '</strong> event(s) created successfully.</div>' +
    (results.failed.length
      ? '<div style="color:var(--danger);font-weight:600;margin-bottom:6px;">' + results.failed.length + ' row(s) failed:</div>' +
        '<div style="max-height:240px;overflow-y:auto;">' + results.failed.map(function (f) {
          return '<div style="padding:6px 8px;background:#fef2f2;border-radius:6px;margin-bottom:4px;font-size:12.5px;">Row ' + f.row + ' (' + esc(f.name) + '): ' + esc(f.reason) + '</div>';
        }).join('') + '</div>'
      : '') +
    '</div>';
  UI.openModal('Import results', body, [{ label: 'OK', className: 'btn-primary', onClick: UI.closeModal }]);
}
