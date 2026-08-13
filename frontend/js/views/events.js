/**
 * HULUL - Events list view + "New Event" creation (REQ-EVT-01/02).
 * Two independent, combinable side filters: Project (see Projects.gs/projects.js -- a GA-level
 * grouping of several Events) above Venue -- picking one of each narrows the table by both at
 * once (e.g. "this Project, at this Venue").
 *
 * REQ (decoupling pass): a Venue is no longer connected to any one EMC organization (see Events.gs
 * / venues.js file header comments), so it can no longer supply a default renting EMC when an Event
 * is created. GA now picks the Venue and the renting EMC as two independent fields on this same New
 * Event form (createEvent's p.emcId is required).
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
  var [events, venues, orgs, projects] = await Promise.all([
    Api.call('listEvents', {}), Api.call('listVenues', {}),
    canManage ? Api.call('listOrganizations', {}) : Promise.resolve([]),
    Api.call('listProjects', {})
  ]);
  var inspectionCos = orgs.filter(function (o) { return o.type === 'INSPECTION'; });
  var emcOrgs = orgs.filter(function (o) { return o.type === 'EMC'; });
  var emcOrgById = {};
  emcOrgs.forEach(function (o) { emcOrgById[o.id] = o; });
  var venueById = {};
  venues.forEach(function (v) { venueById[v.id] = v; });
  var projectById = {};
  projects.forEach(function (pr) { projectById[pr.id] = pr; });
  var view = { projectId: '', venueId: '' };

  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + esc(Term('event_plural')) + '</div>' +
    '<div class="page-subtitle">' + esc(t('events_subtitle', { term: Term('event_plural') })) + '</div></div>' +
    '<div style="display:flex;gap:8px;">' +
      (canManage ? '<button class="btn btn-primary" id="newEventBtn">' + esc(t('new_x', { term: Term('event') })) + '</button>' : '') +
    '</div></div>' +
    '<div style="display:flex;gap:16px;align-items:flex-start;">' +
      '<div style="width:230px;flex-shrink:0;display:flex;flex-direction:column;gap:16px;">' +
        '<div class="card"><div class="card-header"><div class="card-title">' + esc(Term('project_plural')) + '</div></div>' +
        '<div id="projectFilterPanel" style="padding:8px;max-height:280px;overflow-y:auto;"></div></div>' +
        '<div class="card"><div class="card-header"><div class="card-title">' + esc(Term('venue_plural')) + '</div></div>' +
        '<div id="venueFilterPanel" style="padding:8px;max-height:280px;overflow-y:auto;"></div></div>' +
      '</div>' +
      '<div class="card" style="flex:1;min-width:0;">' +
        // Import/Export CSV live inside this list-section card (not the page header, and not text
        // buttons) -- REQ: these controls stay with the list they act on, everywhere in the app.
        '<div class="card-header" style="display:flex;justify-content:flex-end;gap:6px;">' +
          '<button type="button" class="btn btn-secondary btn-sm btn-icon" id="exportCsvBtn" title="' + esc(t('export_csv')) + '">' + ICON('export_csv') + '</button>' +
          (canManage ?
            '<button type="button" class="btn btn-secondary btn-sm btn-icon" id="importCsvBtn" title="' + esc(t('import_csv')) + '">' + ICON('import_csv') + '</button>' +
            '<input type="file" id="importCsvInput" accept=".csv" style="display:none;" />'
            : '') +
        '</div>' +
        '<div class="card-body" id="eventsTableWrap"></div>' +
      '</div>' +
    '</div>';

  renderProjectFilterPanel();
  renderVenueFilterPanel();
  renderEventsTable();

  // Shared by both filter panels below -- an "All ___" row plus one row per group with a live
  // count, and (for Projects only) a trailing "No project" bucket so unassigned events are still
  // reachable as their own filter instead of only visible via "All".
  function filterPanelHtml_(allLabel, rows, activeId) {
    var rowStyle = 'padding:8px 10px;border-radius:8px;cursor:pointer;font-size:13px;margin-top:2px;';
    var total = rows.reduce(function (sum, r) { return sum + r.count; }, 0);
    var html = '<div class="filter-row" data-id="" style="' + rowStyle + 'font-weight:700;' +
      (!activeId ? 'background:var(--accent);color:#fff;' : '') + '">' + esc(allLabel) +
      ' <span style="opacity:.75;font-size:11.5px;">(' + total + ')</span></div>';
    html += rows.map(function (r) {
      var active = activeId === r.id;
      return '<div class="filter-row" data-id="' + esc(r.id) + '" style="' + rowStyle + (active ? 'background:var(--accent);color:#fff;font-weight:600;' : '') + '">' +
        esc(r.name) + ' <span style="opacity:.75;font-size:11.5px;">(' + r.count + ')</span></div>';
    }).join('');
    return html;
  }

  function eventMatchesProject_(e, projectId) {
    if (!projectId) return true;
    if (projectId === '__none__') return !e.projectId;
    return e.projectId === projectId;
  }

  // Each panel's own options are computed from events filtered by every OTHER active filter, but
  // never by its own -- so picking a Project narrows which Venues can even be selected (and vice
  // versa) instead of the two filters staying independent of each other. General rule: a filter's
  // option list only ever shows options that still have at least one matching row.
  function eventsFilteredExcept_(exclude) {
    return events.filter(function (e) {
      if (exclude !== 'project' && !eventMatchesProject_(e, view.projectId)) return false;
      if (exclude !== 'venue' && view.venueId && e.venueId !== view.venueId) return false;
      return true;
    });
  }

  function filteredEvents_() { return eventsFilteredExcept_(null); }

  function renderProjectFilterPanel() {
    var base = eventsFilteredExcept_('project'); // respects the Venue filter, ignores its own
    var counts = {}, noProject = 0;
    base.forEach(function (e) { if (e.projectId) counts[e.projectId] = (counts[e.projectId] || 0) + 1; else noProject++; });
    var rows = projects.filter(function (pr) { return counts[pr.id]; })
      .map(function (pr) { return { id: pr.id, name: pr.name, count: counts[pr.id] }; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
    if (noProject) rows.push({ id: '__none__', name: t('no_x', { term: Term('project') }), count: noProject });
    // The active Venue filter may have made the currently-selected Project impossible (0 matches)
    // -- fall back to "All Projects" rather than showing that dead-end combination.
    if (view.projectId && !rows.some(function (r) { return r.id === view.projectId; })) view.projectId = '';
    var panel = document.getElementById('projectFilterPanel');
    panel.innerHTML = filterPanelHtml_(t('all_x', { term: Term('project_plural') }), rows, view.projectId);
    panel.querySelectorAll('.filter-row').forEach(function (row) {
      row.onclick = function () {
        view.projectId = row.getAttribute('data-id');
        renderProjectFilterPanel(); renderVenueFilterPanel(); renderEventsTable();
      };
    });
  }

  function renderVenueFilterPanel() {
    var base = eventsFilteredExcept_('venue'); // respects the Project filter, ignores its own
    var counts = {};
    base.forEach(function (e) { counts[e.venueId] = (counts[e.venueId] || 0) + 1; });
    var rows = Array.from(new Set(base.map(function (e) { return e.venueId; }))).filter(Boolean)
      .map(function (vid) { return { id: vid, name: venueById[vid] ? venueById[vid].name : vid, count: counts[vid] || 0 }; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
    if (view.venueId && !rows.some(function (r) { return r.id === view.venueId; })) view.venueId = '';
    var panel = document.getElementById('venueFilterPanel');
    panel.innerHTML = filterPanelHtml_(t('all_x', { term: Term('venue_plural') }), rows, view.venueId);
    panel.querySelectorAll('.filter-row').forEach(function (row) {
      row.onclick = function () {
        view.venueId = row.getAttribute('data-id');
        renderVenueFilterPanel(); renderProjectFilterPanel(); renderEventsTable();
      };
    });
  }

  function renderEventsTable() {
    var filtered = filteredEvents_();
    var wrap = document.getElementById('eventsTableWrap');
    wrap.innerHTML = UI.table(
      [
        { key: 'name', label: Term('event'), render: function (r) { return '<a href="#/events/' + r.id + '" style="color:var(--accent);font-weight:600;text-decoration:none;">' + esc(r.name) + '</a>'; } },
        { key: 'venueId', label: Term('venue'), render: function (r) { return esc(venueById[r.venueId] ? venueById[r.venueId].name : r.venueId); } },
        { key: 'projectId', label: Term('project'), render: function (r) { return r.projectId && projectById[r.projectId]
            ? '<a href="#/projects/' + r.projectId + '" style="color:var(--accent);text-decoration:none;">' + esc(projectById[r.projectId].name) + '</a>'
            : '<span class="muted">—</span>'; } },
        { key: 'code', label: t('col_code') },
        { key: 'city', label: t('col_city') },
        { key: 'startDateTime', label: t('col_start'), render: function (r) { return UI.fmtDate(r.startDateTime); } },
        { key: 'endDateTime', label: t('col_end'), render: function (r) { return UI.fmtDate(r.endDateTime); } },
        { key: 'status', label: t('status'), render: function (r) { return UI.statusBadge(r.status); } },
        { key: 'actions', label: t('actions'), render: function (r) {
            var html = '<div style="display:inline-flex;gap:6px;white-space:nowrap;">' +
              '<a class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('action_open')) + '" href="#/events/' + r.id + '">' + ICON('view_open') + '</a>';
            var canEdit = ['SystemAdmin', 'GAAdmin', 'GAUser'].indexOf(HululState.user.role) !== -1;
            if (canEdit) html += '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('action_edit')) + '" data-edit-event="' + r.id + '">' + ICON('edit') + '</button>';
            var canDelete = r.status === 'Planning' && ['SystemAdmin', 'GAAdmin'].indexOf(HululState.user.role) !== -1;
            if (canDelete) html += '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('action_delete')) + '" data-del-event="' + r.id + '">' + ICON('delete') + '</button>';
            return html + '</div>';
          } }
      ],
      filtered, {}
    );
    wrap.querySelectorAll('[data-edit-event]').forEach(function (b) {
      b.onclick = function () {
        var ev = events.filter(function (e) { return e.id === b.getAttribute('data-edit-event'); })[0];
        openEditEventModal(ev, venueById, emcOrgs, projects);
      };
    });
    wrap.querySelectorAll('[data-del-event]').forEach(function (b) {
      b.onclick = function () {
        var eventId = b.getAttribute('data-del-event');
        UI.confirmModal(t('delete_x_confirm', { term: Term('event') }), async function () {
          try { await Api.call('deleteEvent', { eventId: eventId }); UI.toast(t('x_deleted', { term: Term('event') }), 'success'); Router.resolve(); }
          catch (err) { UI.error(err); }
        }, { confirmLabel: t('delete') });
      };
    });
  }

  document.getElementById('exportCsvBtn').onclick = function () {
    exportEventsCsv(filteredEvents_(), venueById, emcOrgById);
  };
  if (canManage) {
    document.getElementById('newEventBtn').onclick = function () { openNewEventModal(venues, inspectionCos, emcOrgs, projects); };
    var importInput = document.getElementById('importCsvInput');
    document.getElementById('importCsvBtn').onclick = function () { importInput.click(); };
    importInput.onchange = function (e) {
      var file = e.target.files[0];
      if (file) importEventsCsv(file, venues, inspectionCos, emcOrgs);
      e.target.value = '';
    };
  }
}

// projects/presetProjectId are optional -- presetProjectId pre-selects (and locks in, via the
// caller passing it) that Project when this modal is opened from a Project's own page (see
// renderProjectDetail in projects.js) so the new event is immediately grouped under it.
// emcOrgs: the renting EMC is chosen here independently of the Venue (a Venue isn't connected to
// any one EMC -- see file header comment) and is required by createEvent (Events.gs).
function openNewEventModal(venues, inspectionCos, emcOrgs, projects, presetProjectId) {
  var venueOptions = venues.map(function (v) { return '<option value="' + v.id + '">' + esc(v.name) + ' (' + esc(v.city) + ')</option>'; }).join('');
  var inspCoOptions = inspectionCos.length
    ? inspectionCos.map(function (o) { return '<option value="' + o.id + '">' + esc(o.name) + '</option>'; }).join('')
    : '<option value="">' + esc(t('no_inspection_cos_found')) + '</option>';
  var emcOptions = (emcOrgs || []).length
    ? emcOrgs.map(function (o) { return '<option value="' + o.id + '">' + esc(o.name) + '</option>'; }).join('')
    : '<option value="">' + esc(t('no_emc_orgs_found')) + '</option>';
  var projectOptions = '<option value="">' + esc(t('label_no_project', { term: Term('project') })) + '</option>' +
    (projects || []).map(function (pr) { return '<option value="' + pr.id + '"' + (pr.id === presetProjectId ? ' selected' : '') + '>' + esc(pr.name) + '</option>'; }).join('');
  var body =
    UI.field(t('field_x_name', { term: Term('event') }), '<input id="fEventName" class="field-input" />') +
    UI.field(Term('venue'), '<select id="fVenueId" class="field-input">' + venueOptions + '</select>') +
    '<div class="form-row">' +
      UI.field(t('col_address'), '<input id="fAddress" class="field-input" readonly />') +
      UI.field(t('col_city'), '<input id="fCity" class="field-input" readonly />') +
    '</div>' +
    '<div class="muted" style="font-size:11.5px;margin:-6px 0 12px;">' + esc(t('field_address_city_hint', { term: Term('venue').toLowerCase() })) + '</div>' +
    '<div class="form-row">' +
      UI.field(t('col_start'), '<input id="fStart" type="datetime-local" class="field-input" />') +
      UI.field(t('col_end'), '<input id="fEnd" type="datetime-local" class="field-input" />') +
    '</div>' +
    UI.field(t('field_renting_emc'), '<select id="fEmcId" class="field-input">' + emcOptions + '</select>') +
    UI.field(t('field_inspection_co'), '<select id="fInspCo" class="field-input">' + inspCoOptions + '</select>') +
    UI.field(t('field_project_optional', { term: Term('project') }), '<select id="fProjectId" class="field-input">' + projectOptions + '</select>');

  UI.openModal(t('new_x', { term: Term('event') }), body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('create'), className: 'btn-primary', onClick: async function () {
        try {
          var emcId = document.getElementById('fEmcId').value;
          if (!emcId) { UI.toast(t('toast_emc_required'), 'error'); return; }
          await Api.call('createEvent', {
            name: document.getElementById('fEventName').value,
            venueId: document.getElementById('fVenueId').value,
            address: document.getElementById('fAddress').value,
            city: document.getElementById('fCity').value,
            startDateTime: document.getElementById('fStart').value,
            endDateTime: document.getElementById('fEnd').value,
            emcId: emcId,
            inspectionCoId: document.getElementById('fInspCo').value,
            projectId: document.getElementById('fProjectId').value
          });
          UI.closeModal();
          UI.toast(t('x_created', { term: Term('event') }), 'success');
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
// those means recreating the event. This covers the common fix: a wrong name/address/city/time,
// plus moving the event into a different Project (or out of one, via "No project") -- the other
// way to do that being renderProjectDetail's "Add existing events" / "Remove from project". The
// renting EMC IS editable here (updateEvent accepts emcId) -- unlike Venue/Inspection Co it isn't
// fixed at creation, since GA may need to re-rent the venue to a different EMC later.
function openEditEventModal(event, venueById, emcOrgs, projects) {
  if (!event) return;
  var venue = venueById[event.venueId];
  var emcOptions = (emcOrgs || []).map(function (o) {
    return '<option value="' + o.id + '"' + (o.id === event.emcId ? ' selected' : '') + '>' + esc(o.name) + '</option>';
  }).join('');
  var projectOptions = '<option value="">' + esc(t('label_no_project', { term: Term('project') })) + '</option>' +
    (projects || []).map(function (pr) { return '<option value="' + pr.id + '"' + (pr.id === event.projectId ? ' selected' : '') + '>' + esc(pr.name) + '</option>'; }).join('');
  var body =
    (venue ? '<div class="muted" style="font-size:12px;margin-bottom:12px;">' + esc(t('venue_edit_hint', { venueTerm: Term('venue'), venueName: venue.name })) + '</div>' : '') +
    UI.field(t('field_x_name', { term: Term('event') }), '<input id="fEditName" class="field-input" value="' + esc(event.name) + '" />') +
    '<div class="form-row">' +
      UI.field(t('col_address'), '<input id="fEditAddress" class="field-input" value="' + esc(event.address) + '" />') +
      UI.field(t('col_city'), '<input id="fEditCity" class="field-input" value="' + esc(event.city) + '" />') +
    '</div>' +
    '<div class="form-row">' +
      UI.field(t('col_start'), '<input id="fEditStart" type="datetime-local" class="field-input" value="' + esc(normalizeDateTimeLocal(event.startDateTime)) + '" />') +
      UI.field(t('col_end'), '<input id="fEditEnd" type="datetime-local" class="field-input" value="' + esc(normalizeDateTimeLocal(event.endDateTime)) + '" />') +
    '</div>' +
    UI.field(t('field_renting_emc'), '<select id="fEditEmcId" class="field-input">' + emcOptions + '</select>') +
    UI.field(t('field_project_optional', { term: Term('project') }), '<select id="fEditProjectId" class="field-input">' + projectOptions + '</select>');
  UI.openModal(t('edit_x', { term: Term('event') }), body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('save'), className: 'btn-primary', onClick: async function () {
        try {
          await Api.call('updateEvent', {
            eventId: event.id,
            name: document.getElementById('fEditName').value,
            address: document.getElementById('fEditAddress').value,
            city: document.getElementById('fEditCity').value,
            startDateTime: document.getElementById('fEditStart').value,
            endDateTime: document.getElementById('fEditEnd').value,
            emcId: document.getElementById('fEditEmcId').value,
            projectId: document.getElementById('fEditProjectId').value
          });
          UI.closeModal(); UI.toast(t('x_updated', { term: Term('event') }), 'success'); Router.resolve();
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

function exportEventsCsv(rows, venueById, emcOrgById) {
  var headers = ['Event Name', 'Venue', 'Address', 'City', 'Start', 'End', 'EMC', 'Status', 'Code', 'Project'];
  var lines = [headers.map(csvEscape_).join(',')];
  rows.forEach(function (r) {
    var venue = venueById[r.venueId];
    var emc = emcOrgById && emcOrgById[r.emcId];
    lines.push([
      r.name, venue ? venue.name : r.venueId, r.address, r.city, r.startDateTime, r.endDateTime,
      emc ? emc.name : r.emcId, r.status, r.code, r.project
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

async function importEventsCsv(file, venues, inspectionCos, emcOrgs) {
  var text = await file.text();
  var rows = parseCsv_(text);
  if (!rows.length) { UI.toast(t('empty_csv'), 'error'); return; }
  var headers = rows[0].map(function (h) { return h.trim().toLowerCase(); });
  var col = function (name) { return headers.indexOf(name); };
  var idxName = col('event name') !== -1 ? col('event name') : col('name');
  var idxVenue = col('venue');
  var idxAddress = col('address');
  var idxCity = col('city');
  var idxStart = col('start');
  var idxEnd = col('end');
  var idxEmc = col('emc') !== -1 ? col('emc') : col('renting emc');
  var idxInsp = col('inspection company') !== -1 ? col('inspection company') : col('inspection co');
  var idxCode = col('code');
  var idxProject = col('project');
  if (idxName === -1 || idxVenue === -1 || idxStart === -1 || idxEnd === -1) {
    UI.toast(t('csv_columns_required'), 'error');
    return;
  }

  var totalRows = 0;
  for (var i = 1; i < rows.length; i++) {
    if (rows[i].length && !rows[i].every(function (c) { return c.trim() === ''; })) totalRows++;
  }
  var progress = UI.progressModal(t('importing_events'), totalRows);
  var processed = 0;
  var results = { created: [], failed: [] };
  for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    if (!row.length || row.every(function (c) { return c.trim() === ''; })) continue;
    var name = (row[idxName] || '').trim();
    processed++;
    progress.update(processed, processed + ' of ' + totalRows + (name ? ' — ' + name : ''));
    var venueName = (row[idxVenue] || '').trim();
    var venue = venues.filter(function (v) { return v.name.toLowerCase() === venueName.toLowerCase(); })[0];
    if (!venue) { results.failed.push({ row: r + 1, name: name || '(unnamed)', reason: 'Venue "' + venueName + '" not found' }); continue; }
    // REQ (decoupling pass): a Venue no longer implies a renting EMC, so it must come from the CSV
    // itself now -- same "blank column defaults to the only option" convenience Inspection Company
    // already had, for the common single-EMC-org case.
    var emcName = idxEmc !== -1 ? (row[idxEmc] || '').trim() : '';
    var emcOrg = emcName
      ? (emcOrgs || []).filter(function (o) { return o.name.toLowerCase() === emcName.toLowerCase(); })[0]
      : (emcOrgs && emcOrgs.length === 1 ? emcOrgs[0] : undefined);
    if (!emcOrg) { results.failed.push({ row: r + 1, name: name || '(unnamed)', reason: 'EMC "' + emcName + '" not found (or ambiguous with no EMC column)' }); continue; }
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
      emcId: emcOrg.id,
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
  UI.closeModal();
  showImportResults_(results);
  if (results.created.length) Router.resolve();
}

function showImportResults_(results) {
  var body = '<div style="font-size:13.5px;">' +
    '<div style="margin-bottom:8px;">' + esc(t('import_created_count', { count: results.created.length, term: results.created.length === 1 ? Term('event') : Term('event_plural') })) + '</div>' +
    (results.failed.length
      ? '<div style="color:var(--danger);font-weight:600;margin-bottom:6px;">' + esc(t('import_failed_count', { count: results.failed.length })) + '</div>' +
        '<div style="max-height:240px;overflow-y:auto;">' + results.failed.map(function (f) {
          return '<div style="padding:6px 8px;background:#fef2f2;border-radius:6px;margin-bottom:4px;font-size:12.5px;">Row ' + f.row + ' (' + esc(f.name) + '): ' + esc(f.reason) + '</div>';
        }).join('') + '</div>'
      : '') +
    '</div>';
  UI.openModal(t('import_results_title'), body, [{ label: t('ok'), className: 'btn-primary', onClick: UI.closeModal }]);
}
