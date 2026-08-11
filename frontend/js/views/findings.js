/**
 * HULUL - Risk Logging (Findings) full-page workflow.
 *
 * "Log finding" / "view a log" / "resolve" / accept / reject used to be popups (a create modal and
 * a generic status-dropdown modal). They're now dedicated pages -- routes #/events/:id/findings/new
 * and #/events/:id/findings/:findingId -- same "full page, not an overlay" pattern already used for
 * New/Edit Venue (see venues.js's header comment: a modal's ~520px/90vh box was too cramped). Here
 * the actual reason is the workflow itself: each status needs a different, sometimes multi-field
 * action (camera evidence capture, rejection remarks) plus a growing resolution history underneath
 * it -- all of that never fit a modal without scrolling inside a scrolling box.
 *
 * The status workflow itself lives server-side (Findings.gs -- see its header comment for the full
 * Open -> Viewed -> Submitted -> InReview -> Resolved/ReOpen -> Resubmitted -> Resolved/Rejected
 * state machine). This file only renders whatever viewFinding/resolveFinding/reviewFindingResolution
 * return and offers whichever single action applies to the current viewer + the finding's current
 * status -- it never sets status directly.
 *
 * Depends on globals defined in eventDetail.js (uploadEvidenceFile_/renderEvidenceList_/
 * retryEvidenceEntry_/EVIDENCE_MAX_UPLOAD_BYTES_) and evidence.js (EvidenceCapture) -- load this
 * file after both in index.html. The Resolve section's camera capture reuses those exact functions
 * (keyed by a fixed itemId of 'resolve') instead of duplicating the upload/retry/progress-list logic.
 */
var FINDING_ROLE_PARTICIPANT_ = ['Vendor', 'Operator', 'Exhibitor'];
var FINDING_ROLE_REVIEWER_ = ['Inspector', 'ProjectManager', 'SystemAdmin'];

function driveEvidenceThumbUrl_(url) {
  var m = String(url || '').match(/\/d\/([a-zA-Z0-9_-]+)/) || String(url || '').match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m ? 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w400' : '';
}

function evidenceThumbsHtml_(urls) {
  if (!urls || !urls.length) return '<div class="muted" style="font-size:12px;">No evidence attached.</div>';
  return '<div style="display:flex;flex-wrap:wrap;gap:10px;">' + urls.map(function (u, i) {
    var thumb = driveEvidenceThumbUrl_(u);
    return '<a href="' + esc(u) + '" target="_blank" rel="noopener" title="Open evidence ' + (i + 1) + '" ' +
      'style="display:flex;align-items:center;justify-content:center;width:96px;height:96px;border-radius:10px;overflow:hidden;border:1px solid var(--border);background:var(--surface);">' +
      (thumb
        ? '<img src="' + esc(thumb) + '" alt="Evidence ' + (i + 1) + '" style="width:100%;height:100%;object-fit:cover;" ' +
          'onerror="this.replaceWith(Object.assign(document.createElement(\'span\'),{textContent:\'' + ICON('capture_photo') + '\',style:\'font-size:24px;\'}));" />'
        : '<span style="font-size:24px;">' + ICON('capture_photo') + '</span>') +
    '</a>';
  }).join('') + '</div>';
}

// One self-contained label+value block per field, laid out in a responsive grid where auto-fit
// sizes each field to its own column -- deliberately NOT built from separate UI.field() calls
// spread across a shared .form-row (that put every label in one grid track and every value in
// another once more than 2 fields shared a row, which is what made the old detail page's fields
// render as two disconnected columns instead of paired label/value blocks).
function detailField_(label, valueHtml) {
  return '<div><div class="field-label" style="margin-top:0;">' + esc(label) + '</div>' +
    '<div style="font-size:13.5px;line-height:1.4;margin-top:4px;">' + valueHtml + '</div></div>';
}
function detailGrid_(fieldsHtml) {
  return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:16px 20px;">' + fieldsHtml.join('') + '</div>';
}

/* ---------------- New Finding page (route: #/events/:id/findings/new) ---------------- */
async function renderNewFinding(params) {
  var eventId = params.id;
  var root = document.getElementById('viewRoot');
  var disciplines = [];
  try { disciplines = await Api.call('listDisciplines', {}); } catch (e) { /* fall back to no options below */ }

  root.innerHTML =
    '<div class="breadcrumb"><a href="#/events/' + eventId + '?tab=findings">' + esc(t('tab_findings')) + '</a></div>' +
    '<div class="page-header"><div><div class="page-title">Log ' + esc(Term('finding')) + '</div>' +
    '<div class="page-subtitle">Record a new non-compliance finding for this ' + esc(Term('event').toLowerCase()) + '</div></div>' +
    '<button class="btn btn-secondary" id="backFindingBtn">' + ICON('back') + ' Back</button></div>' +
    '<div class="card"><div class="card-body" style="display:flex;flex-direction:column;gap:4px;max-width:640px;">' +
      UI.field(Term('discipline'), '<select id="fDiscipline" class="field-input"><option value="">—</option>' +
        disciplines.map(function (d) { return '<option value="' + esc(d.id) + '">' + esc(d.name) + '</option>'; }).join('') + '</select>') +
      UI.field('Description', '<textarea id="fDesc" class="field-input" rows="3"></textarea>') +
      UI.field('Suggested action', '<input id="fAction" class="field-input" />') +
      '<div class="form-row">' +
        UI.field('Risk level', '<select id="fRisk" class="field-input"><option>Low</option><option selected>Medium</option><option>High</option><option>Critical</option></select>') +
        UI.field('Resolution window (hours)', '<input id="fWindow" type="number" class="field-input" value="24" />') +
      '</div>' +
      '<div class="form-row">' +
        UI.field('Sub-' + Term('zone').toLowerCase(), '<input id="fSubZone" class="field-input" />') +
        UI.field('Location', '<input id="fLocation" class="field-input" />') +
      '</div>' +
      '<button class="btn btn-primary" id="createFindingBtn" style="margin-top:10px;align-self:flex-start;">Log ' + esc(Term('finding')) + '</button>' +
    '</div></div>';

  document.getElementById('backFindingBtn').onclick = function () { window.location.hash = '#/events/' + eventId + '?tab=findings'; };
  document.getElementById('createFindingBtn').onclick = async function () {
    try {
      var f = await Api.call('createFinding', {
        eventId: eventId, disciplineId: document.getElementById('fDiscipline').value,
        description: document.getElementById('fDesc').value, suggestedAction: document.getElementById('fAction').value,
        riskLevel: document.getElementById('fRisk').value, resolutionWindowHours: Number(document.getElementById('fWindow').value),
        subZone: document.getElementById('fSubZone').value, location: document.getElementById('fLocation').value
      });
      UI.toast(Term('finding') + ' logged', 'success');
      window.location.hash = '#/events/' + eventId + '/findings/' + f.id;
    } catch (err) { UI.error(err); }
  };
}

/* ---------------- Finding detail / workflow page (route: #/events/:id/findings/:findingId) ---------------- */
async function renderFindingDetail(params) {
  var eventId = params.id;
  var findingId = params.findingId;
  var root = document.getElementById('viewRoot');
  root.innerHTML = '<div class="empty-state">' + t('loading') + '</div>';

  var data;
  try { data = await Api.call('viewFinding', { findingId: findingId }); }
  catch (err) { UI.error(err); root.innerHTML = '<div class="empty-state">Could not load this finding.</div>'; return; }

  var finding = data.finding, resolutions = data.resolutions || [];
  var role = HululState.user.role;
  var isParticipant = FINDING_ROLE_PARTICIPANT_.indexOf(role) !== -1;
  var isReviewer = FINDING_ROLE_REVIEWER_.indexOf(role) !== -1;
  var latestPending = resolutions.filter(function (r) { return r.decision === 'Pending'; })[0];
  // Whichever rejection is still "live" -- the reason ReOpen exists, or (if terminal) the reason
  // Rejected happened -- shown as a callout so the Participant knows what to fix without having to
  // dig through the full history list below.
  var latestRejected = resolutions.filter(function (r) { return r.decision === 'Rejected'; })[0];

  root.innerHTML =
    '<div class="breadcrumb"><a href="#/events/' + eventId + '?tab=findings">' + esc(t('tab_findings')) + '</a></div>' +
    '<div class="page-header"><div><div class="page-title">' + esc(finding.description || '(no description)') + '</div>' +
    '<div class="page-subtitle">' + esc(finding.disciplineName || '—') + (finding.category ? ' · ' + esc(finding.category) : '') + '</div></div>' +
    '<button class="btn btn-secondary" id="backFindingBtn">' + ICON('back') + ' Back</button></div>' +

    // One "Finding" card, fields laid out top-to-bottom in process order -- everything the Inspector
    // filled in at step 1 (Discipline/Category -> what was found -> what to do about it -> who/where
    // -> by when -> when it was logged -> proof), rather than split across separate Overview/notes/
    // evidence cards in no particular order. Every field is its own self-contained detailField_
    // block (see comment above) so nothing separates a label from its value.
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">Finding</div>' +
      '<div style="display:flex;gap:8px;">' + UI.riskBadge(finding.riskLevel) + UI.statusBadge(finding.status) + '</div>' +
    '</div><div class="card-body">' +
      detailGrid_([
        detailField_(Term('discipline'), esc(finding.disciplineName || '—')),
        detailField_('Category', esc([finding.category, finding.subCategory].filter(Boolean).join(' / ') || '—'))
      ]) +
      '<div style="margin-top:16px;">' + detailField_('Description', esc(finding.description || '—')) + '</div>' +
      '<div style="margin-top:14px;">' + detailField_('Suggested action', esc(finding.suggestedAction || '—')) + '</div>' +
      '<div style="margin-top:16px;">' + detailGrid_([
        detailField_(Term('participant'), esc(finding.participantName || '—')),
        detailField_('Sub-' + Term('zone').toLowerCase(), esc(finding.subZone || '—')),
        detailField_('Location', esc(finding.location || '—')),
        detailField_('Resolution window', UI.fmtDate(finding.resolutionWindowAt)),
        detailField_('Logged', UI.fmtDate(finding.createdAt))
      ]) + '</div>' +
      '<div style="margin-top:16px;">' + detailField_('Risk Logging evidence', evidenceThumbsHtml_(finding.evidenceUrls)) + '</div>' +
    '</div></div>' +

    (latestRejected && (finding.status === 'ReOpen' || finding.status === 'Rejected')
      ? '<div class="card" style="margin-bottom:16px;border-left:4px solid var(--danger);"><div class="card-body">' +
          '<div style="font-weight:700;font-size:12.5px;color:var(--danger);margin-bottom:4px;">Rejected by inspector' +
          (finding.status === 'Rejected' ? ' — final' : ' — please fix and resubmit') + '</div>' +
          '<div style="font-size:13px;">' + esc(latestRejected.comments || '—') + '</div></div></div>'
      : '') +

    findingActionSectionHtml_(finding, isParticipant, isReviewer, latestPending) +

    (resolutions.length
      ? '<div class="card"><div class="card-header"><div class="card-title">Resolution history</div>' +
        '<div class="muted" style="font-size:11.5px;">Remarks &amp; photos submitted by the ' + esc(Term('participant').toLowerCase()) + '</div></div>' +
        '<div class="card-body">' + resolutions.map(findingResolutionHistoryRowHtml_).join('') + '</div></div>'
      : '');

  document.getElementById('backFindingBtn').onclick = function () { window.location.hash = '#/events/' + eventId + '?tab=findings'; };
  wireFindingActionSection_(eventId, finding, isParticipant, isReviewer, latestPending);
}

function findingResolutionHistoryRowHtml_(r) {
  return '<div style="border-bottom:1px solid #f0f1f6;padding:12px 0;">' +
    '<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;">' +
      '<strong style="font-size:12.5px;">' + UI.fmtDate(r.submittedAt) + '</strong>' + UI.statusBadge(r.decision) +
    '</div>' +
    '<div style="font-size:13px;margin-top:6px;">' + esc(r.remarks || '—') + '</div>' +
    (r.comments ? '<div style="font-size:12.5px;color:var(--danger);margin-top:4px;">Reviewer remarks: ' + esc(r.comments) + '</div>' : '') +
    '<div style="margin-top:8px;">' + evidenceThumbsHtml_(r.evidenceUrls) + '</div>' +
  '</div>';
}

// The one action available to the current viewer for the finding's current status -- Resolve
// (Participant, status Viewed/ReOpen) or Accept/Reject (Reviewer, status InReview with a pending
// resolution). Anything else (wrong role for this status, or a terminal/no-action status) renders
// nothing here -- the read-only card above and the history below are the whole page.
function findingActionSectionHtml_(finding, isParticipant, isReviewer, latestPending) {
  if (isParticipant && (finding.status === 'Viewed' || finding.status === 'ReOpen')) {
    return '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">Resolve this finding</div></div>' +
      '<div class="card-body">' +
        UI.field('Remarks', '<textarea id="fResolveRemarks" class="field-input" rows="3"></textarea>') +
        '<div class="field-label" style="font-size:11.5px;margin-top:8px;">Photo or video evidence of resolution (required)</div>' +
        // Same camera-only pattern as Record Results' Risk Logging evidence field (eventDetail.js) --
        // the native file input is hidden, a plain camera-icon button triggers it, capture="environment"
        // opens the device camera directly instead of a general file/gallery picker.
        '<input type="file" id="fResolveFile" accept="image/*,video/*" capture="environment" style="display:none;" />' +
        '<button type="button" class="btn btn-secondary btn-icon" id="fResolveCameraBtn" title="Take photo / video" aria-label="Take photo or video">' + ICON('capture_photo') + '</button>' +
        '<div class="evidence-list" data-evlist="resolve" style="margin-top:6px;"></div>' +
        '<button class="btn btn-primary btn-sm" id="submitResolveBtn" style="margin-top:12px;">Submit resolution</button>' +
      '</div></div>';
  }
  if (isReviewer && finding.status === 'InReview' && latestPending) {
    return '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">Review resolution</div></div>' +
      '<div class="card-body">' +
        detailField_('Remarks', esc(latestPending.remarks || '—')) +
        '<div style="margin-top:12px;">' + evidenceThumbsHtml_(latestPending.evidenceUrls) + '</div>' +
        '<div style="display:flex;gap:8px;margin-top:16px;">' +
          '<button class="btn btn-secondary btn-icon" id="acceptFindingBtn" title="Accept">' + ICON('approve') + '</button>' +
          '<button class="btn btn-secondary btn-icon" id="rejectFindingBtn" title="Reject">' + ICON('reject') + '</button>' +
        '</div>' +
        '<div id="rejectRemarksSection" style="display:none;margin-top:10px;">' +
          UI.field('Rejection remarks (required)', '<textarea id="fRejectRemarks" class="field-input" rows="2"></textarea>') +
          '<button class="btn btn-primary btn-sm" id="confirmRejectBtn" style="margin-top:8px;">Confirm rejection</button>' +
        '</div>' +
      '</div></div>';
  }
  return '';
}

function wireFindingActionSection_(eventId, finding, isParticipant, isReviewer, latestPending) {
  if (isParticipant && (finding.status === 'Viewed' || finding.status === 'ReOpen')) {
    var pendingFiles = { resolve: [] };
    document.getElementById('fResolveCameraBtn').onclick = function () { document.getElementById('fResolveFile').click(); };
    document.getElementById('fResolveFile').onchange = function (e) {
      Array.from(e.target.files).forEach(function (file) { uploadEvidenceFile_(eventId, 'resolve', file, pendingFiles); });
      e.target.value = '';
    };
    document.getElementById('submitResolveBtn').onclick = async function () {
      var remarks = document.getElementById('fResolveRemarks').value;
      if (!remarks) { UI.toast('Remarks are required', 'error'); return; }
      var files = pendingFiles.resolve || [];
      if (files.some(function (f) { return f.status === 'uploading' || f.status === 'preparing'; })) {
        UI.toast('Evidence is still uploading — please wait for it to finish', 'error'); return;
      }
      var urls = files.filter(function (f) { return f.status === 'done'; }).map(function (f) { return f.url; });
      if (!urls.length) { UI.toast('A photo or video of the resolution is required', 'error'); return; }
      try {
        await Api.call('resolveFinding', { findingId: finding.id, remarks: remarks, evidenceUrls: urls });
        UI.toast('Resolution submitted', 'success');
        Router.resolve();
      } catch (err) { UI.error(err); }
    };
    return;
  }
  if (isReviewer && finding.status === 'InReview' && latestPending) {
    document.getElementById('acceptFindingBtn').onclick = async function () {
      try { await Api.call('reviewFindingResolution', { findingId: finding.id, decision: 'Approved' }); UI.toast('Finding resolved', 'success'); Router.resolve(); }
      catch (err) { UI.error(err); }
    };
    document.getElementById('rejectFindingBtn').onclick = function () {
      document.getElementById('rejectRemarksSection').style.display = 'block';
    };
    document.getElementById('confirmRejectBtn').onclick = async function () {
      var comments = document.getElementById('fRejectRemarks').value;
      if (!comments) { UI.toast('Rejection remarks are required', 'error'); return; }
      try { await Api.call('reviewFindingResolution', { findingId: finding.id, decision: 'Rejected', comments: comments }); UI.toast('Resolution rejected', 'success'); Router.resolve(); }
      catch (err) { UI.error(err); }
    };
  }
}
