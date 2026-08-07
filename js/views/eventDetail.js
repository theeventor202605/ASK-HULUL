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
async function tabVenue(content, eventId, detail) {
  content.innerHTML =
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">Venue</div></div>' +
    '<div class="card-body">' + infoRow('Name', detail.venue && detail.venue.name) + infoRow('Address', detail.venue && detail.venue.address) +
    infoRow('City', detail.venue && detail.venue.city) + '</div></div>' +
    '<div class="card"><div class="card-header"><div class="card-title">Zones</div>' +
    '<button class="btn btn-primary btn-sm" id="newZoneBtn">+ Add zone</button></div>' +
    '<div class="card-body">' + UI.table([{ key: 'name', label: 'Zone' }, { key: 'createdAt', label: 'Created', render: r => UI.fmtDate(r.createdAt) }], detail.zones, {}) +
    '</div></div>';
  document.getElementById('newZoneBtn').onclick = function () {
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
async function tabDisciplines(content, eventId) {
  var [disciplines, assignments] = await Promise.all([
    Api.call('listDisciplines', {}), Api.call('listInspectorAssignments', { eventId: eventId })
  ]);
  content.innerHTML =
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">Identify applicable disciplines</div></div>' +
    '<div class="card-body">' + disciplines.map(d =>
      '<label style="display:inline-flex;align-items:center;gap:6px;margin:4px 12px 4px 0;font-size:13px;">' +
      '<input type="checkbox" class="disc-check" value="' + d.id + '" /> ' + esc(d.name) + '</label>').join('') +
    '<div><button class="btn btn-primary btn-sm" id="saveDiscBtn" style="margin-top:12px;">Save</button></div></div></div>' +
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">Assign inspector</div></div>' +
    '<div class="card-body form-row">' +
      UI.field('Discipline ID', '<input id="fAssignDisc" class="field-input" placeholder="DIS-0001" />') +
      UI.field('Inspector User ID', '<input id="fAssignInsp" class="field-input" placeholder="USR-0002" />') +
    '</div><div class="card-body" style="padding-top:0;"><button class="btn btn-primary btn-sm" id="assignBtn">Assign</button></div></div>' +
    '<div class="card"><div class="card-header"><div class="card-title">Assignments</div></div><div class="card-body">' +
    UI.table([{ key: 'disciplineId', label: 'Discipline' }, { key: 'inspectorId', label: 'Inspector' }, { key: 'assignedAt', label: 'Assigned', render: r => UI.fmtDate(r.assignedAt) }], assignments, {}) +
    '</div></div>';

  document.getElementById('saveDiscBtn').onclick = async function () {
    var ids = Array.from(content.querySelectorAll('.disc-check:checked')).map(c => c.value);
    try { await Api.call('identifyDisciplines', { eventId: eventId, disciplineIds: ids }); UI.toast('Disciplines saved', 'success'); }
    catch (err) { UI.error(err); }
  };
  document.getElementById('assignBtn').onclick = async function () {
    try {
      await Api.call('assignInspector', { eventId: eventId, disciplineId: document.getElementById('fAssignDisc').value, inspectorId: document.getElementById('fAssignInsp').value });
      UI.toast('Inspector assigned', 'success'); Router.resolve();
    } catch (err) { UI.error(err); }
  };
}

/* ---------------- Inspections & Checklists ---------------- */
async function tabInspections(content, eventId) {
  var inspections = await Api.call('listInspections', { eventId: eventId });
  content.innerHTML =
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">Schedule inspection</div></div>' +
    '<div class="card-body form-row">' +
      UI.field('Discipline ID', '<input id="fInsDisc" class="field-input" placeholder="DIS-0001" />') +
      UI.field('Inspector User ID', '<input id="fInsInsp" class="field-input" placeholder="USR-0002" />') +
    '</div><div class="card-body form-row" style="padding-top:0;">' +
      UI.field('Checklist type', '<input id="fInsChecklist" class="field-input" placeholder="Restaurants" />') +
      UI.field('Phase', '<select id="fInsPhase" class="field-input"><option>Operational Readiness</option><option>Operational Inspection</option></select>') +
    '</div><div class="card-body" style="padding-top:0;">' +
      UI.field('Scheduled at', '<input id="fInsWhen" type="datetime-local" class="field-input" />') +
      '<button class="btn btn-primary btn-sm" id="scheduleBtn" style="margin-top:10px;">Schedule</button></div></div>' +
    '<div class="card"><div class="card-header"><div class="card-title">Inspections</div></div><div class="card-body">' +
    UI.table([
      { key: 'checklistType', label: 'Checklist' }, { key: 'phase', label: 'Phase' }, { key: 'inspectorId', label: 'Inspector' },
      { key: 'scheduledAt', label: 'When', render: r => UI.fmtDate(r.scheduledAt) },
      { key: 'status', label: t('status'), render: r => UI.statusBadge(r.status) },
      { key: 'actions', label: t('actions'), render: r => r.status !== 'Completed' ? '<button class="btn btn-secondary btn-sm" data-record="' + r.id + '" data-checklist="' + r.checklistType + '">Record results</button>' : '—' }
    ], inspections, {}) + '</div></div>';

  document.getElementById('scheduleBtn').onclick = async function () {
    try {
      await Api.call('scheduleInspection', {
        eventId: eventId, disciplineId: document.getElementById('fInsDisc').value, inspectorId: document.getElementById('fInsInsp').value,
        checklistType: document.getElementById('fInsChecklist').value, phase: document.getElementById('fInsPhase').value,
        scheduledAt: document.getElementById('fInsWhen').value
      });
      UI.toast('Inspection scheduled', 'success'); Router.resolve();
    } catch (err) { UI.error(err); }
  };
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
    '<div class="form-row">' + UI.field('Risk level', '<select id="fRisk" class="field-input"><option>Low</option><option selected>Medium</option><option>High</option></select>') +
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
