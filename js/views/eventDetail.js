/**
 * HULUL - Event workspace: tabbed view covering EVT/TPL/VAP/DIS/INS/NCF/RES/PAR/RPT modules
 * for a single event. Mirrors the reference UI's tab layout, modernized.
 */
var EVENT_TABS = [
  ['overview', 'tab_overview'], ['venue', 'tab_venue'], ['templates', 'tab_templates'],
  ['approval', 'tab_approval'], ['disciplines', 'tab_disciplines'], ['inspections', 'tab_inspections'],
  ['findings', 'tab_findings'], ['resolutions', 'tab_resolutions'], ['escalations', 'tab_escalations'],
  ['participants', 'tab_participants'], ['reports', 'tab_reports']
];

async function renderEventDetail(params) {
  var root = document.getElementById('viewRoot');
  var eventId = params.id;
  var detail = await Api.call('getEvent', { eventId: eventId });
  HululState.currentEventId = eventId;
  var activeTab = params.tab || 'overview';

  root.innerHTML =
    '<div class="breadcrumb"><a href="#/events">' + t('events_title') + '</a> / ' + esc(detail.event.name) + '</div>' +
    '<div class="page-header"><div><div class="page-title">' + esc(detail.event.name) + '</div>' +
    '<div class="page-subtitle">' + esc(detail.venue ? detail.venue.name : '') + ' · ' + esc(detail.event.city) + ' · ' +
    UI.fmtDate(detail.event.startDateTime) + ' – ' + UI.fmtDate(detail.event.endDateTime) + '</div></div>' +
    UI.statusBadge(detail.event.status) + '</div>' +
    '<div class="tabbar" id="eventTabbar"></div>' +
    '<div id="eventTabContent"></div>';

  var tabbar = document.getElementById('eventTabbar');
  tabbar.innerHTML = EVENT_TABS.map(function (tb) {
    return '<div class="tab-btn ' + (tb[0] === activeTab ? 'active' : '') + '" data-tab="' + tb[0] + '">' + t(tb[1]) + '</div>';
  }).join('');
  tabbar.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.onclick = function () { window.location.hash = '#/events/' + eventId + '?tab=' + btn.getAttribute('data-tab'); };
  });

  var content = document.getElementById('eventTabContent');
  var renderers = {
    overview: tabOverview, venue: tabVenue, templates: tabTemplates, approval: tabApproval,
    disciplines: tabDisciplines, inspections: tabInspections, findings: tabFindings,
    resolutions: tabResolutions, escalations: tabEscalations, participants: tabParticipants, reports: tabReports
  };
  content.innerHTML = '<div class="empty-state">' + t('loading') + '</div>';
  try { await (renderers[activeTab] || tabOverview)(content, eventId, detail); }
  catch (err) { UI.error(err); content.innerHTML = '<div class="empty-state">Failed to load this tab.</div>'; }
}

/* ---------------- Overview ---------------- */
async function tabOverview(content, eventId, detail) {
  content.innerHTML =
    '<div class="kpi-grid">' +
      kpiCard('kpi_total', detail.kpi.totalLogs, '📊', 'var(--info)') +
      kpiCard('kpi_open', detail.kpi.open, '🔵', 'var(--info)') +
      kpiCard('kpi_inreview', detail.kpi.inReview, '🟣', '#7c3aed') +
      kpiCard('kpi_resolved', detail.kpi.resolved, '✅', 'var(--success)') +
      kpiCard('kpi_reopen', detail.kpi.reopened, '↩️', 'var(--warning)') +
      kpiCard('kpi_rejected', detail.kpi.rejected, '⛔', 'var(--danger)') +
    '</div>' +
    '<div class="card"><div class="card-header"><div class="card-title">Event details</div></div><div class="card-body">' +
      infoRow('Code', detail.event.code) + infoRow('Project', detail.event.project) +
      infoRow('EMC', detail.event.emcId) + infoRow('Inspection Company', detail.event.inspectionCoId) +
      infoRow('Event Manager', detail.event.eventManagerId) +
      infoRow('Sub-events', detail.subEvents.length) + infoRow('Zones', detail.zones.length) +
    '</div></div>';
}
function kpiCard(labelKey, value, icon, color) {
  return '<div class="kpi-card"><div class="kpi-top"><span class="kpi-label">' + t(labelKey) + '</span>' +
    '<span class="kpi-icon" style="background:' + color + '22;">' + icon + '</span></div><div class="kpi-value">' + value + '</div></div>';
}
function infoRow(label, val) {
  return '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0f1f6;font-size:13.5px;">' +
    '<span class="muted">' + esc(label) + '</span><span style="font-weight:600;">' + esc(val || '—') + '</span></div>';
}

/* ---------------- Venue & Zones ---------------- */
// Matches createZone/deleteZone's backend requireRole — only these roles get zone controls.
var ZONE_MANAGE_ROLES = ['SystemAdmin', 'EMCAdmin', 'EMCManager', 'EventManager'];

async function tabVenue(content, eventId, detail) {
  var canManage = ZONE_MANAGE_ROLES.indexOf(HululState.user.role) !== -1;
  content.innerHTML =
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">Venue</div></div>' +
    '<div class="card-body">' + infoRow('Name', detail.venue && detail.venue.name) + infoRow('Address', detail.venue && detail.venue.address) +
    infoRow('City', detail.venue && detail.venue.city) + '</div></div>' +
    '<div class="card"><div class="card-header"><div class="card-title">Zones</div>' +
    (canManage ? '<button class="btn btn-primary btn-sm" id="newZoneBtn">+ Add zone</button>' : '') + '</div>' +
    '<div class="card-body">' + UI.table([
      { key: 'name', label: 'Zone' }, { key: 'createdAt', label: 'Created', render: r => UI.fmtDate(r.createdAt) }
    ].concat(canManage ? [{ key: 'actions', label: t('actions'), render: r => '<button class="btn btn-danger btn-sm" data-del-zone="' + r.id + '">Delete</button>' }] : []),
      detail.zones, {}) +
    '</div></div>';

  if (canManage) document.getElementById('newZoneBtn').onclick = function () {
    UI.openModal('Add zone', UI.field('Zone name', '<input id="fZoneName" class="field-input" />'), [
      { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
      { label: t('create'), className: 'btn-primary', onClick: async function () {
          try {
            await Api.call('createZone', { venueId: detail.venue.id, name: document.getElementById('fZoneName').value });
            UI.closeModal(); UI.toast('Zone added', 'success'); Router.resolve();
          } catch (err) { UI.error(err); }
        } }
    ]);
  };

  if (!canManage) return;
  content.querySelectorAll('[data-del-zone]').forEach(function (b) {
    b.onclick = async function () { openDeleteZoneModal_(b.getAttribute('data-del-zone'), detail.zones); };
  });
}

// Deleting a zone soft-deletes it (hidden everywhere, but old records still resolve its name).
// If it has assignments/logs tied to it, offer — but don't require — moving that work to another
// active zone in the same venue first.
async function openDeleteZoneModal_(zoneId, allZones) {
  var zone = allZones.filter(function (z) { return z.id === zoneId; })[0];
  var impact;
  try { impact = await Api.call('listZoneImpact', { zoneId: zoneId }); } catch (err) { UI.error(err); return; }

  var otherZones = allZones.filter(function (z) { return z.id !== zoneId; });
  var body = '<div style="font-size:13.5px;line-height:1.6;">';
  if (impact.hasImpact) {
    var parts = [];
    if (impact.assignmentsCount) parts.push(impact.assignmentsCount + ' inspector assignment(s)');
    if (impact.logsCount) parts.push(impact.logsCount + ' log(s)');
    if (impact.participantsCount) parts.push(impact.participantsCount + ' participant(s)');
    body += '<div>"' + esc(zone ? zone.name : zoneId) + '" has ' + parts.join(', ') + ' tied to it.</div>' +
      '<div class="muted" style="margin-top:6px;">You can optionally move this to another zone, or just delete — nothing breaks either way.</div>';
    if (otherZones.length) {
      body += '<div style="margin-top:12px;">' + UI.field('Move to zone (optional)',
        '<select id="fReassignZone" class="field-input"><option value="">Don\'t reassign</option>' +
        otherZones.map(function (z) { return '<option value="' + z.id + '">' + esc(z.name) + '</option>'; }).join('') + '</select>'
      ) + '</div>';
    }
  } else {
    body += '<div>Delete "' + esc(zone ? zone.name : zoneId) + '"? This zone has no assignments or logs tied to it.</div>';
  }
  body += '</div>';

  UI.openModal('Delete zone', body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: 'Delete', className: 'btn-danger', onClick: async function () {
        try {
          var reassignSelect = document.getElementById('fReassignZone');
          await Api.call('deleteZone', { zoneId: zoneId, reassignToZoneId: reassignSelect ? reassignSelect.value : '' });
          UI.closeModal(); UI.toast('Zone deleted', 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      } }
  ]);
}

/* ---------------- Templates ---------------- */
async function tabTemplates(content, eventId) {
  var templates = await Api.call('listTemplates', { eventId: eventId });
  content.innerHTML = '<div class="card"><div class="card-header"><div class="card-title">Readiness templates (ZSMP · ZERP · TTP · CSM · SEC)</div></div>' +
    '<div class="card-body">' + UI.table([
      { key: 'type', label: 'Template' },
      { key: 'status', label: t('status'), render: r => UI.statusBadge(r.status) },
      { key: 'fileName', label: 'File', render: r => r.fileUrl ? '<a href="' + r.fileUrl + '" target="_blank" style="color:var(--accent);">' + esc(r.fileName || 'view') + '</a>' : '—' },
      { key: 'updatedAt', label: 'Updated', render: r => UI.fmtDate(r.updatedAt) },
      { key: 'actions', label: t('actions'), render: r => '<button class="btn btn-secondary btn-sm" data-upload="' + r.id + '">Upload</button>' }
    ], templates, {}) + '</div></div>';

  content.querySelectorAll('[data-upload]').forEach(function (btn) {
    btn.onclick = function () { openTemplateUploadModal(btn.getAttribute('data-upload')); };
  });
}
function openTemplateUploadModal(templateId) {
  var body = UI.field('File', '<input type="file" id="fTplFile" class="field-input" />') +
    UI.field(t('status'), '<select id="fTplStatus" class="field-input">' +
      ['Sent', 'In Progress', 'Submitted', 'Under Review', 'Approved', 'Rejected'].map(s => '<option>' + s + '</option>').join('') + '</select>');
  UI.openModal('Upload template', body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('save'), className: 'btn-primary', onClick: async function () {
        try {
          var fileInput = document.getElementById('fTplFile');
          var payload = { templateId: templateId, status: document.getElementById('fTplStatus').value };
          if (fileInput.files[0]) {
            payload.fileBase64 = await fileToBase64(fileInput.files[0]);
            payload.fileName = fileInput.files[0].name;
            payload.mimeType = fileInput.files[0].type;
          }
          await Api.call('uploadTemplate', payload);
          UI.closeModal(); UI.toast('Template updated', 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      } }
  ]);
}
function fileToBase64(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () { resolve(reader.result.split(',')[1]); };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ---------------- Venue Approval ---------------- */
async function tabApproval(content, eventId) {
  var evals = await Api.call('listVenueEvaluations', { eventId: eventId });
  content.innerHTML =
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">Record recommendation</div></div>' +
    '<div class="card-body">' + UI.field('Recommendation', '<textarea id="fRecommendation" class="field-input" rows="3"></textarea>') +
    '<button class="btn btn-primary btn-sm" id="submitRecBtn" style="margin-top:10px;">Submit recommendation</button></div></div>' +
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">Venue decision (GA)</div></div>' +
    '<div class="card-body"><button class="btn btn-secondary btn-sm" id="approveBtn">Approve</button> ' +
    '<button class="btn btn-danger btn-sm" id="rejectBtn">Not Approved</button></div></div>' +
    '<div class="card"><div class="card-header"><div class="card-title">Evaluation history</div></div>' +
    '<div class="card-body">' + UI.table([
      { key: 'venueId', label: 'Venue' }, { key: 'recommendation', label: 'Recommendation' },
      { key: 'decision', label: 'Decision', render: r => r.decision ? UI.statusBadge(r.decision) : '—' },
      { key: 'status', label: 'Record' }, { key: 'decisionAt', label: 'Decided', render: r => UI.fmtDate(r.decisionAt) }
    ], evals, {}) + '</div></div>';

  document.getElementById('submitRecBtn').onclick = async function () {
    try {
      await Api.call('recordRecommendation', { eventId: eventId, recommendation: document.getElementById('fRecommendation').value });
      UI.toast('Recommendation recorded', 'success'); Router.resolve();
    } catch (err) { UI.error(err); }
  };
  document.getElementById('approveBtn').onclick = () => decide('Approved');
  document.getElementById('rejectBtn').onclick = () => decide('Not Approved');
  async function decide(decision) {
    try { await Api.call('recordVenueDecision', { eventId: eventId, decision: decision }); UI.toast('Decision recorded', 'success'); Router.resolve(); }
    catch (err) { UI.error(err); }
  }
}

/* ---------------- Disciplines & Inspectors ---------------- */
// Only Project Managers (and SystemAdmin) can identify disciplines / assign / unassign
// inspectors — everyone else viewing this tab gets a read-only view of the same data instead
// of controls that would just come back "Not permitted" when clicked.
var DISCIPLINE_MANAGER_ROLES = ['ProjectManager', 'SystemAdmin'];

async function tabDisciplines(content, eventId, detail) {
  var canManage = DISCIPLINE_MANAGER_ROLES.indexOf(HululState.user.role) !== -1;
  var zones = (detail && detail.zones) || [];
  var zonesRequired = zones.length > 1;
  var [disciplines, assignments, eventDisciplines, gaps] = await Promise.all([
    Api.call('listDisciplines', {}), Api.call('listInspectorAssignments', { eventId: eventId }), Api.call('listEventDisciplines', { eventId: eventId }),
    Api.call('listCoverageGaps', { eventId: eventId })
  ]);
  var identifiedIds = eventDisciplines.map(function (ed) { return ed.disciplineId; });
  var assignedDisciplineIds = Array.from(new Set(assignments.map(function (a) { return a.disciplineId; })));
  var identifiedDisciplines = disciplines.filter(function (d) { return identifiedIds.indexOf(d.id) !== -1; });
  var disciplineOptions = identifiedDisciplines.map(d => '<option value="' + d.id + '">' + esc(d.name) + '</option>').join('');

  content.innerHTML =
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">Identify applicable disciplines</div></div>' +
    '<div class="card-body">' + disciplines.map(function (d) {
      var checked = identifiedIds.indexOf(d.id) !== -1;
      var locked = !canManage || (checked && assignedDisciplineIds.indexOf(d.id) !== -1);
      var lockReason = !canManage ? 'Only a Project Manager or System Admin can change this.' : 'An inspector is already assigned to this discipline — remove that assignment below before it can be unselected.';
      return '<label style="display:inline-flex;align-items:center;gap:6px;margin:4px 12px 4px 0;font-size:13px;' + (locked ? 'opacity:0.65;' : '') + '"' +
        (locked ? ' title="' + lockReason + '"' : '') + '>' +
        '<input type="checkbox" class="disc-check" value="' + d.id + '"' + (checked ? ' checked' : '') + (locked ? ' disabled' : '') + ' /> ' +
        esc(d.name) + (checked && assignedDisciplineIds.indexOf(d.id) !== -1 ? ' 🔒' : '') + '</label>';
    }).join('') +
    (canManage
      ? '<div><button class="btn btn-primary btn-sm" id="saveDiscBtn" style="margin-top:12px;">Save</button></div>' +
        (assignedDisciplineIds.length ? '<div class="muted" style="font-size:11.5px;margin-top:8px;">🔒 An inspector is already assigned — remove the assignment below to unselect.</div>' : '')
      : '<div class="muted" style="font-size:11.5px;margin-top:10px;">Read-only — only a Project Manager or System Admin can change this.</div>') +
    '</div></div>' +
    renderCoverageGapsCard_(gaps, canManage) +
    (canManage
      ? '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">Assign inspector</div></div>' +
        '<div class="card-body form-row">' +
          UI.field('Discipline', '<select id="fAssignDisc" class="field-input">' + (disciplineOptions || '<option value="">No disciplines identified yet</option>') + '</select>') +
          UI.field('Qualified inspector', '<select id="fAssignInsp" class="field-input"></select>') +
        '</div>' +
        (zonesRequired
          ? '<div class="card-body" style="padding-top:0;">' + UI.field('Zones (required — this venue has multiple zones)',
              zones.map(function (z) { return '<label style="display:inline-flex;align-items:center;gap:6px;margin:4px 12px 4px 0;font-size:13px;">' +
                '<input type="checkbox" class="assign-zone-check" value="' + z.id + '" /> ' + esc(z.name) + '</label>'; }).join('')
            ) + '</div>'
          : '') +
        '<div class="card-body" style="padding-top:0;"><button class="btn btn-primary btn-sm" id="assignBtn"' + (identifiedDisciplines.length ? '' : ' disabled') + '>Assign</button></div></div>'
      : '') +
    '<div class="card"><div class="card-header"><div class="card-title">Assignments</div></div><div class="card-body">' +
    UI.table([
      { key: 'disciplineName', label: 'Discipline' }, { key: 'inspectorName', label: 'Inspector' },
      { key: 'zoneNames', label: 'Zones', render: r => (r.zoneNames && r.zoneNames.length) ? esc(r.zoneNames.join(', ')) : '—' },
      { key: 'assignedAt', label: 'Assigned', render: r => UI.fmtDate(r.assignedAt) }
    ].concat(canManage ? [{ key: 'actions', label: t('actions'), render: r => '<button class="btn btn-danger btn-sm" data-remove-assign="' + r.id + '">Remove</button>' }] : []),
      assignments, {}) +
    '</div></div>';

  if (!canManage) return;

  document.getElementById('saveDiscBtn').onclick = async function () {
    var ids = Array.from(content.querySelectorAll('.disc-check:checked')).map(c => c.value);
    try {
      await Api.call('identifyDisciplines', { eventId: eventId, disciplineIds: ids });
      UI.toast('Disciplines saved', 'success'); Router.resolve();
    } catch (err) { UI.error(err); }
  };

  var discSelect = document.getElementById('fAssignDisc');
  var inspSelect = document.getElementById('fAssignInsp');
  async function loadQualifiedInspectors() {
    if (!discSelect.value) { inspSelect.innerHTML = ''; return; }
    inspSelect.innerHTML = '<option value="">' + t('loading') + '</option>';
    try {
      var inspectors = await Api.call('listQualifiedInspectors', { disciplineId: discSelect.value, eventId: eventId });
      inspSelect.innerHTML = inspectors.length
        ? inspectors.map(i => '<option value="' + i.id + '">' + esc(i.name) + ' (' + esc(i.email) + ')</option>').join('')
        : '<option value="">No qualified inspectors for this discipline</option>';
    } catch (err) { UI.error(err); }
  }
  discSelect.onchange = loadQualifiedInspectors;
  if (identifiedDisciplines.length) loadQualifiedInspectors();

  document.getElementById('assignBtn').onclick = async function () {
    if (!inspSelect.value) { UI.toast('No qualified inspector selected', 'error'); return; }
    var zoneIds = Array.from(content.querySelectorAll('.assign-zone-check:checked')).map(c => c.value);
    if (zonesRequired && !zoneIds.length) { UI.toast('This venue has multiple zones — select at least one', 'error'); return; }
    try {
      await Api.call('assignInspector', { eventId: eventId, disciplineId: discSelect.value, inspectorId: inspSelect.value, zoneIds: zoneIds });
      UI.toast('Inspector assigned', 'success'); Router.resolve();
    } catch (err) { UI.error(err); }
  };

  content.querySelectorAll('[data-remove-assign]').forEach(function (b) {
    b.onclick = function () {
      UI.confirmModal('Remove this inspector assignment?', async function () {
        try {
          await Api.call('removeInspectorAssignment', { eventId: eventId, assignmentId: b.getAttribute('data-remove-assign') });
          UI.toast('Assignment removed', 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      }, { confirmLabel: 'Remove' });
    };
  });

  // Coverage-gap "Quick assign" chips pre-fill the form above (discipline, qualified inspector,
  // and — if this venue has multiple zones — the specific uncovered zones) so the PM only has to
  // review and hit Assign, instead of re-finding the same discipline/inspector combo by hand.
  content.querySelectorAll('[data-qa-insp]').forEach(function (btn) {
    btn.onclick = async function () {
      discSelect.value = btn.getAttribute('data-qa-disc');
      await loadQualifiedInspectors();
      inspSelect.value = btn.getAttribute('data-qa-insp');
      var zoneIds = (btn.getAttribute('data-qa-zones') || '').split(',').filter(Boolean);
      content.querySelectorAll('.assign-zone-check').forEach(function (cb) { cb.checked = zoneIds.indexOf(cb.value) !== -1; });
      document.getElementById('assignBtn').scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
  });
}

// Summarizes listCoverageGaps() into a card: which identified disciplines still have zones (or,
// for a single/no-zone venue, the whole venue) without an assigned inspector, and which
// qualified-but-unassigned Inspectors could fill each gap. Shown to every viewer (it's just
// information), but the "Quick assign" shortcut only appears for roles that can act on it.
function renderCoverageGapsCard_(gaps, canManage) {
  var body;
  if (!gaps || !gaps.items || !gaps.items.length) {
    body = '<div class="muted" style="font-size:13px;">✅ Every identified discipline is fully covered' + (gaps && gaps.zoneMode ? ' across all zones.' : '.') + '</div>';
  } else {
    body = gaps.items.map(function (item) {
      var whereText = gaps.zoneMode
        ? 'Uncovered zones: <strong>' + item.uncoveredZones.map(function (z) { return esc(z.name); }).join(', ') + '</strong>'
        : '<strong>Not yet assigned</strong>';
      var zoneIdsAttr = gaps.zoneMode ? item.uncoveredZones.map(function (z) { return z.id; }).join(',') : '';
      var inspectorsHtml = item.availableInspectors.length
        ? item.availableInspectors.map(function (i) {
            return '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px;background:#f6f7fb;border-radius:8px;margin-top:6px;font-size:12.5px;">' +
              '<span><strong>' + esc(i.name) + '</strong> <span class="muted">' + esc(i.email) + '</span></span>' +
              (canManage ? '<button class="btn btn-secondary btn-sm" data-qa-disc="' + item.disciplineId + '" data-qa-insp="' + i.id + '" data-qa-zones="' + esc(zoneIdsAttr) + '">Quick assign</button>' : '') +
              '</div>';
          }).join('')
        : '<div class="muted" style="font-size:12px;margin-top:6px;">No qualified, unassigned inspectors available for this discipline.</div>';
      return '<div style="padding:10px 0;border-bottom:1px solid #f0f1f6;">' +
        '<div style="font-weight:600;font-size:13.5px;">' + esc(item.disciplineName) + '</div>' +
        '<div style="font-size:12.5px;margin-top:2px;">' + whereText + '</div>' + inspectorsHtml + '</div>';
    }).join('');
  }
  return '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">Coverage gaps</div></div><div class="card-body">' + body + '</div></div>';
}

/* ---------------- Inspections & Checklists ---------------- */
// Scheduling is a Project Manager (or SystemAdmin) action; recording results is the assigned
// Inspector's (or SystemAdmin's) alone. Hiding what a viewer can't actually use avoids the
// "click it, get told Not permitted" dead end — e.g. a GAAdmin/EMCManager browsing this tab
// would otherwise see every inspection's Record results button even though none are theirs.
var INSPECTION_SCHEDULER_ROLES = ['ProjectManager', 'SystemAdmin'];
function canRecordInspection_(r) {
  return HululState.user.role === 'SystemAdmin' || (HululState.user.role === 'Inspector' && r.inspectorId === HululState.user.id);
}

async function tabInspections(content, eventId) {
  var canSchedule = INSPECTION_SCHEDULER_ROLES.indexOf(HululState.user.role) !== -1;
  var [inspections, assignments, checklistItems] = await Promise.all([
    Api.call('listInspections', { eventId: eventId }),
    Api.call('listInspectorAssignments', { eventId: eventId }),
    Api.call('listChecklistItems', {})
  ]);
  var inspectorAssignCount = {};
  assignments.forEach(function (a) { inspectorAssignCount[a.inspectorId] = (inspectorAssignCount[a.inspectorId] || 0) + 1; });
  var assignOptions = assignments.map(function (a) {
    var label = a.inspectorName + (inspectorAssignCount[a.inspectorId] > 1 ? ' (' + a.disciplineName + ')' : '');
    return '<option value="' + a.id + '" data-discipline="' + esc(a.disciplineName) + '">' + esc(label) + '</option>';
  }).join('');

  content.innerHTML =
    (canSchedule
      ? '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">Schedule inspection</div></div>' +
        '<div class="card-body form-row">' +
          UI.field('Inspector', '<select id="fInsAssignment" class="field-input">' + (assignOptions || '<option value="">No inspectors assigned yet</option>') + '</select>') +
          UI.field('Discipline', '<input id="fInsDisc" class="field-input" readonly />') +
        '</div><div class="card-body form-row" style="padding-top:0;">' +
          UI.field('Checklist type', '<select id="fInsChecklist" class="field-input"></select>') +
          UI.field('Phase', '<select id="fInsPhase" class="field-input"><option>Operational Readiness</option><option>Operational Inspection</option></select>') +
        '</div><div class="card-body" style="padding-top:0;">' +
          UI.field('Scheduled at', '<input id="fInsWhen" type="datetime-local" class="field-input" />') +
          '<button class="btn btn-primary btn-sm" id="scheduleBtn" style="margin-top:10px;"' + (assignments.length ? '' : ' disabled') + '>Schedule</button></div></div>'
      : '') +
    '<div class="card"><div class="card-header"><div class="card-title">Inspections</div></div><div class="card-body">' +
    UI.table([
      { key: 'disciplineName', label: 'Discipline' }, { key: 'checklistType', label: 'Checklist' }, { key: 'phase', label: 'Phase' },
      { key: 'inspectorName', label: 'Inspector' },
      { key: 'scheduledAt', label: 'When', render: r => UI.fmtDate(r.scheduledAt) },
      { key: 'status', label: t('status'), render: r => UI.statusBadge(r.status) },
      { key: 'actions', label: t('actions'), render: r => (r.status !== 'Completed' && canRecordInspection_(r))
          ? '<button class="btn btn-secondary btn-sm" data-record="' + r.id + '" data-checklist="' + r.checklistType + '">Record results</button>' : '—' }
    ], inspections, {}) + '</div></div>';

  if (canSchedule) {
    var assignSelect = document.getElementById('fInsAssignment');
    var discField = document.getElementById('fInsDisc');
    var checklistSelect = document.getElementById('fInsChecklist');

    var syncFromAssignment = function () {
      var opt = assignSelect.options[assignSelect.selectedIndex];
      var disciplineName = opt ? (opt.getAttribute('data-discipline') || '') : '';
      discField.value = disciplineName;
      var typesForDiscipline = Array.from(new Set(
        checklistItems.filter(function (i) { return i.category === disciplineName; }).map(function (i) { return i.checklistType; })
      )).sort();
      checklistSelect.innerHTML = typesForDiscipline.length
        ? typesForDiscipline.map(c => '<option>' + esc(c) + '</option>').join('')
        : '<option value="">No checklist items for this discipline</option>';
    };
    assignSelect.onchange = syncFromAssignment;
    if (assignments.length) syncFromAssignment();

    document.getElementById('scheduleBtn').onclick = async function () {
      var assignment = assignments.filter(a => a.id === assignSelect.value)[0];
      if (!assignment) { UI.toast('Select an assigned inspector first', 'error'); return; }
      if (!checklistSelect.value) { UI.toast('No checklist type available for this discipline yet', 'error'); return; }
      try {
        await Api.call('scheduleInspection', {
          eventId: eventId, disciplineId: assignment.disciplineId, inspectorId: assignment.inspectorId,
          checklistType: checklistSelect.value, phase: document.getElementById('fInsPhase').value,
          scheduledAt: document.getElementById('fInsWhen').value
        });
        UI.toast('Inspection scheduled', 'success'); Router.resolve();
      } catch (err) { UI.error(err); }
    };
  }

  content.querySelectorAll('[data-record]').forEach(btn => {
    btn.onclick = () => openRecordResultsModal(eventId, btn.getAttribute('data-record'), btn.getAttribute('data-checklist'));
  });
}

async function openRecordResultsModal(eventId, inspectionId, checklistType) {
  var items = await Api.call('listChecklistItems', { checklistType: checklistType });
  if (!items.length) items = await Api.call('listChecklistItems', {});
  var body = items.map(function (it) {
    return '<div style="border-bottom:1px solid #f0f1f6;padding:10px 0;">' +
      '<div style="font-weight:600;font-size:13px;">' + esc(it.description) + '</div>' +
      '<div class="muted" style="font-size:11.5px;margin-bottom:6px;">' + esc(it.category) + ' · default risk ' + esc(it.defaultRisk) + '</div>' +
      '<select class="field-input result-state" data-item="' + it.id + '" style="display:inline-block;width:auto;">' +
      '<option value="Ticked">Ticked</option><option value="Crossed">Crossed</option><option value="N/A">N/A</option></select>' +
      '</div>';
  }).join('') || '<div class="empty-state">No checklist items found for this type — add some in the ChecklistItems sheet.</div>';

  UI.openModal('Record results — ' + checklistType, body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('save'), className: 'btn-primary', onClick: async function () {
        var results = Array.from(document.querySelectorAll('.result-state')).map(function (sel) {
          return { checklistItemId: sel.getAttribute('data-item'), state: sel.value };
        });
        try {
          var res = await Api.call('recordInspectionResults', { inspectionId: inspectionId, results: results });
          UI.closeModal();
          UI.toast(res.findingsCreated.length + ' finding(s) created', 'success');
          Router.resolve();
        } catch (err) { UI.error(err); }
      } }
  ]);
}

/* ---------------- Findings (Risk Logging) ---------------- */
async function tabFindings(content, eventId) {
  var findings = await Api.call('listFindings', { eventId: eventId });
  var counts = { Open: 0, InReview: 0, Resolved: 0, ReOpen: 0, Rejected: 0 };
  findings.forEach(f => { if (counts[f.status] !== undefined) counts[f.status]++; });

  content.innerHTML =
    '<div class="kpi-grid">' +
      kpiCard('kpi_total', findings.length, '📊', 'var(--info)') +
      kpiCard('kpi_open', counts.Open, '🔵', 'var(--info)') +
      kpiCard('kpi_inreview', counts.InReview, '🟣', '#7c3aed') +
      kpiCard('kpi_resolved', counts.Resolved, '✅', 'var(--success)') +
      kpiCard('kpi_reopen', counts.ReOpen, '↩️', 'var(--warning)') +
      kpiCard('kpi_rejected', counts.Rejected, '⛔', 'var(--danger)') +
    '</div>' +
    '<div class="card"><div class="card-header"><div class="card-title">' + t('tab_findings') + '</div>' +
    '<button class="btn btn-primary btn-sm" id="newFindingBtn">+ Log finding</button></div>' +
    '<div class="card-body">' + UI.table([
      { key: 'category', label: 'Category' }, { key: 'subCategory', label: 'Sub category' },
      { key: 'riskLevel', label: 'Severity', render: r => UI.riskBadge(r.riskLevel) },
      { key: 'status', label: t('status'), render: r => UI.statusBadge(r.status) },
      { key: 'description', label: 'Description' }, { key: 'suggestedAction', label: 'Suggested actions' },
      { key: 'subZone', label: 'Sub-zone' }, { key: 'location', label: 'Location' },
      { key: 'actions', label: t('actions'), render: r => '<button class="btn btn-secondary btn-sm" data-finding="' + r.id + '">Update</button>' }
    ], findings, {}) + '</div></div>';

  document.getElementById('newFindingBtn').onclick = () => openFindingModal(eventId);
  content.querySelectorAll('[data-finding]').forEach(btn => {
    btn.onclick = () => openFindingStatusModal(btn.getAttribute('data-finding'));
  });
}

function openFindingModal(eventId) {
  var body =
    UI.field('Description', '<textarea id="fDesc" class="field-input" rows="2"></textarea>') +
    UI.field('Suggested action', '<input id="fAction" class="field-input" />') +
    '<div class="form-row">' + UI.field('Risk level', '<select id="fRisk" class="field-input"><option>Low</option><option selected>Medium</option><option>High</option><option>Critical</option></select>') +
    UI.field('Resolution window (hours)', '<input id="fWindow" type="number" class="field-input" value="24" />') + '</div>' +
    '<div class="form-row">' + UI.field('Sub-zone', '<input id="fSubZone" class="field-input" />') + UI.field('Location', '<input id="fLocation" class="field-input" />') + '</div>';
  UI.openModal('Log finding', body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('create'), className: 'btn-primary', onClick: async function () {
        try {
          await Api.call('createFinding', {
            eventId: eventId, description: document.getElementById('fDesc').value, suggestedAction: document.getElementById('fAction').value,
            riskLevel: document.getElementById('fRisk').value, resolutionWindowHours: Number(document.getElementById('fWindow').value),
            subZone: document.getElementById('fSubZone').value, location: document.getElementById('fLocation').value
          });
          UI.closeModal(); UI.toast('Finding logged', 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      } }
  ]);
}
function openFindingStatusModal(findingId) {
  var body = UI.field(t('status'), '<select id="fStatus" class="field-input">' +
    ['Open', 'InReview', 'Resolved', 'ReOpen', 'Rejected'].map(s => '<option>' + s + '</option>').join('') + '</select>');
  UI.openModal('Update finding', body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('save'), className: 'btn-primary', onClick: async function () {
        try { await Api.call('updateFinding', { findingId: findingId, status: document.getElementById('fStatus').value });
          UI.closeModal(); UI.toast('Finding updated', 'success'); Router.resolve(); }
        catch (err) { UI.error(err); }
      } }
  ]);
}

/* ---------------- Resolutions ---------------- */
async function tabResolutions(content, eventId) {
  var findings = await Api.call('listFindings', { eventId: eventId });
  var allRes = [];
  for (var f of findings) { var rs = await Api.call('listResolutions', { findingId: f.id }); rs.forEach(r => allRes.push(Object.assign({ findingDesc: f.description }, r))); }

  content.innerHTML =
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">Submit resolution</div></div>' +
    '<div class="card-body form-row">' + UI.field('Finding ID', '<input id="fResFinding" class="field-input" placeholder="FND-0001" />') +
    UI.field('Participant ID', '<input id="fResParticipant" class="field-input" placeholder="PAR-0001" />') + '</div>' +
    '<div class="card-body" style="padding-top:0;">' + UI.field('Remarks', '<textarea id="fResRemarks" class="field-input" rows="2"></textarea>') +
    '<button class="btn btn-primary btn-sm" id="submitResBtn" style="margin-top:10px;">Submit</button></div></div>' +
    '<div class="card"><div class="card-header"><div class="card-title">Resolutions</div></div><div class="card-body">' +
    UI.table([
      { key: 'findingDesc', label: 'Finding' }, { key: 'remarks', label: 'Remarks' },
      { key: 'decision', label: 'Decision', render: r => UI.statusBadge(r.decision) },
      { key: 'submittedAt', label: 'Submitted', render: r => UI.fmtDate(r.submittedAt) },
      { key: 'actions', label: t('actions'), render: r => r.decision === 'Pending' ?
        '<button class="btn btn-secondary btn-sm" data-approve="' + r.id + '">Approve</button> <button class="btn btn-danger btn-sm" data-reject="' + r.id + '">Reject</button>' : '—' }
    ], allRes, {}) + '</div></div>';

  document.getElementById('submitResBtn').onclick = async function () {
    try {
      await Api.call('submitResolution', { findingId: document.getElementById('fResFinding').value, participantId: document.getElementById('fResParticipant').value, remarks: document.getElementById('fResRemarks').value });
      UI.toast('Resolution submitted', 'success'); Router.resolve();
    } catch (err) { UI.error(err); }
  };
  content.querySelectorAll('[data-approve]').forEach(b => b.onclick = () => reviewRes(b.getAttribute('data-approve'), 'Approved'));
  content.querySelectorAll('[data-reject]').forEach(b => b.onclick = () => reviewRes(b.getAttribute('data-reject'), 'Rejected'));
  async function reviewRes(id, decision) {
    try { await Api.call('reviewResolution', { resolutionId: id, decision: decision }); UI.toast('Resolution ' + decision.toLowerCase(), 'success'); Router.resolve(); }
    catch (err) { UI.error(err); }
  }
}

/* ---------------- Escalations ---------------- */
async function tabEscalations(content, eventId) {
  var escalations = await Api.call('listEscalations', { eventId: eventId });
  content.innerHTML =
    '<div class="card" style="margin-bottom:16px;"><div class="card-body" style="display:flex;justify-content:space-between;align-items:center;">' +
    '<div class="muted" style="font-size:13px;">Escalations run automatically every 30 minutes. You can also trigger a check manually.</div>' +
    '<button class="btn btn-secondary btn-sm" id="runEscBtn">Run check now</button></div></div>' +
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">Manual escalation (admin override)</div></div>' +
    '<div class="card-body form-row">' +
      UI.field('Finding ID', '<input id="fEscFinding" class="field-input" placeholder="FND-0001" />') +
      UI.field('Tier', '<select id="fEscTier" class="field-input"><option value="1">1</option><option value="2">2</option><option value="3">3</option></select>') +
    '</div><div class="card-body" style="padding-top:0;">' +
      UI.field('Recipient User ID', '<input id="fEscRecipient" class="field-input" placeholder="USR-0002" />') +
      '<button class="btn btn-primary btn-sm" id="newEscBtn" style="margin-top:10px;">Create escalation</button></div></div>' +
    '<div class="card"><div class="card-header"><div class="card-title">' + t('tab_escalations') + '</div></div><div class="card-body">' +
    UI.table([
      { key: 'findingId', label: 'Finding' }, { key: 'tier', label: 'Tier', render: r => 'Tier ' + r.tier },
      { key: 'recipientUserId', label: 'Recipient' }, { key: 'triggeredAt', label: 'Triggered', render: r => UI.fmtDate(r.triggeredAt) },
      { key: 'resolvedAt', label: 'Resolved', render: r => r.resolvedAt ? UI.fmtDate(r.resolvedAt) : '—' }
    ], escalations, {}) + '</div></div>';

  document.getElementById('runEscBtn').onclick = async function () {
    try { var res = await Api.call('runEscalationCheck', {}); UI.toast(res.triggeredCount + ' escalation(s) triggered', 'success'); Router.resolve(); }
    catch (err) { UI.error(err); }
  };
  document.getElementById('newEscBtn').onclick = async function () {
    try {
      await Api.call('createEscalation', {
        findingId: document.getElementById('fEscFinding').value, tier: document.getElementById('fEscTier').value,
        recipientUserId: document.getElementById('fEscRecipient').value
      });
      UI.toast('Escalation created', 'success'); Router.resolve();
    } catch (err) { UI.error(err); }
  };
}

/* ---------------- Participants ---------------- */
async function tabParticipants(content, eventId) {
  var participants = await Api.call('listParticipants', { eventId: eventId });
  content.innerHTML =
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">Add participant</div></div>' +
    '<div class="card-body form-row">' + UI.field('Type', '<select id="fPType" class="field-input"><option>Vendor</option><option>Operator</option><option>Exhibitor</option><option>Other</option></select>') +
    UI.field('Name', '<input id="fPName" class="field-input" />') + '</div>' +
    '<div class="card-body form-row" style="padding-top:0;">' + UI.field('Zone ID', '<input id="fPZone" class="field-input" placeholder="ZON-0001" />') +
    UI.field('Contact email', '<input id="fPEmail" type="email" class="field-input" />') + '</div>' +
    '<div class="card-body" style="padding-top:0;"><button class="btn btn-primary btn-sm" id="addParticipantBtn">Add</button></div></div>' +
    '<div class="card"><div class="card-header"><div class="card-title">Participants</div></div><div class="card-body">' +
    UI.table([{ key: 'type', label: 'Type' }, { key: 'name', label: 'Name' }, { key: 'zoneId', label: 'Zone' }, { key: 'contactEmail', label: 'Contact' }], participants, {}) +
    '</div></div>';

  document.getElementById('addParticipantBtn').onclick = async function () {
    try {
      await Api.call('createParticipant', {
        eventId: eventId, type: document.getElementById('fPType').value, name: document.getElementById('fPName').value,
        zoneId: document.getElementById('fPZone').value, contactEmail: document.getElementById('fPEmail').value
      });
      UI.toast('Participant added', 'success'); Router.resolve();
    } catch (err) { UI.error(err); }
  };
}

/* ---------------- Reports ---------------- */
async function tabReports(content, eventId) {
  var reports = await Api.call('listReports', { eventId: eventId });
  content.innerHTML =
    '<div class="card" style="margin-bottom:16px;"><div class="card-body" style="display:flex;gap:10px;">' +
    '<button class="btn btn-primary btn-sm" id="genReadinessBtn">Generate Operational Readiness report</button>' +
    '<button class="btn btn-secondary btn-sm" id="genInspectionBtn">Generate Operational Inspection report</button></div></div>' +
    '<div class="card"><div class="card-header"><div class="card-title">' + t('tab_reports') + '</div></div><div class="card-body">' +
    reports.map(r =>
      '<div style="border-bottom:1px solid #f0f1f6;padding:12px 0;">' +
      '<div style="display:flex;justify-content:space-between;"><strong>' + esc(r.type) + '</strong><span class="muted">' + UI.fmtDate(r.generatedAt) + '</span></div>' +
      '<pre style="font-size:11.5px;background:#f6f7fb;padding:8px 10px;border-radius:8px;margin-top:6px;overflow-x:auto;">' + esc(JSON.stringify(r.summary, null, 2)) + '</pre></div>'
    ).join('') + (reports.length ? '' : '<div class="empty-state">' + t('no_data') + '</div>') +
    '</div></div>';

  document.getElementById('genReadinessBtn').onclick = () => gen('Operational Readiness');
  document.getElementById('genInspectionBtn').onclick = () => gen('Operational Inspection');
  async function gen(type) {
    try { await Api.call('generateReport', { eventId: eventId, type: type }); UI.toast('Report generated', 'success'); Router.resolve(); }
    catch (err) { UI.error(err); }
  }
}
