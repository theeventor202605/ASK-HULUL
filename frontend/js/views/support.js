/**
 * HULUL - Support view: the global "report a technical issue" capture flow (openSupportCapture,
 * wired to #supportBtn in the topbar by app.js's wireChrome, reachable from any page in the app)
 * plus the ticket queue/thread pages (renderSupport, renderSupportDetail, routed at /support and
 * /support/:id in router.js). Backend counterpart: backend/Support.gs.
 *
 * Status lifecycle (see Support.gs header comment for the full rationale):
 *   Open -> InProgress -> Resolved -> Completed, with a Resolved ticket the raiser rejects going
 *   back to InProgress instead of a separate "Reopened" status.
 */
var SUPPORT_MAX_RECORDING_MS = 90 * 1000; // ~90s cap (locked-in Option A) -- keeps recordings well
// under the ~15MB base64 upload ceiling this app's other evidence uploads already work within
// (see Inspections.gs uploadEvidence / DEPLOYMENT.md's "File size" note), without building out
// chunked/resumable upload just for this feature.

function isSupportManager_() {
  return !!(HululState.user && ['SystemAdmin', 'SupportAgent'].indexOf(HululState.user.role) !== -1);
}

/* ================= Raise-a-ticket capture flow ================= */

// Entry point, called from #supportBtn (app.js wireChrome). Takes a DOM screenshot of whatever's
// currently on screen BEFORE showing the capture UI (REQ: capture-on-click, no permission prompt --
// html2canvas rasterizes the DOM client-side, unlike getDisplayMedia which would ask permission),
// so the shot reflects the actual problem, dialogs and all, not the capture UI itself.
async function openSupportCapture() {
  var overlay = document.getElementById('supportCaptureOverlay');
  if (!overlay || typeof html2canvas !== 'function') { UI.toast(t('screenshot_capture_unavailable'), 'error'); return; }
  var canvas = null;
  try {
    canvas = await html2canvas(document.body, { useCORS: true, logging: false, backgroundColor: '#ffffff' });
  } catch (e) {
    console.error('[Support] screenshot capture failed', e);
    UI.toast(t('toast_screenshot_capture_failed'), 'error');
  }
  renderSupportCaptureModal_(overlay, canvas);
}

function closeSupportCapture_() {
  var overlay = document.getElementById('supportCaptureOverlay');
  if (!overlay) return;
  overlay.classList.add('hidden');
  overlay.innerHTML = '';
}

function renderSupportCaptureModal_(overlay, canvas) {
  var voiceBlob = null, voiceUrl = null;
  var rect = null; // {x,y,w,h} in on-screen annotation-canvas pixel space; scaled to the real
                    // screenshot's resolution at submit time (screen vs. captured canvas rarely
                    // match 1:1 on high-DPI displays).
  var dataUrl = canvas ? canvas.toDataURL('image/png') : '';

  overlay.innerHTML =
    '<div class="support-capture-box">' +
      '<div class="support-capture-header"><div class="support-capture-title">' + esc(t('report_issue_title')) + '</div>' +
        '<button type="button" class="btn btn-ghost btn-sm" id="scCloseBtn">' + ICON('close_modal') + '</button></div>' +
      '<div class="support-capture-body">' +
        (canvas
          ? '<div>' +
              '<div class="support-shot-wrap" id="scShotWrap"><img id="scShotImg" src="' + dataUrl + '" alt="' + esc(t('screenshot_alt')) + '" />' +
                '<canvas id="scAnnotateCanvas"></canvas></div>' +
              '<div class="support-shot-hint">' + esc(t('annotate_hint')) + '</div>' +
            '</div>'
          : '<div class="empty-state">' + esc(t('no_screenshot_captured')) + '</div>') +
        UI.field(t('field_what_went_wrong'), '<textarea id="scRemarks" class="field-input" rows="4" placeholder="' + esc(t('describe_issue_placeholder')) + '"></textarea>') +
        '<div>' +
          '<label class="field-label">' + esc(t('voice_note_label')) + '</label>' +
          '<div class="support-voice-row" id="scVoiceRow">' +
            '<button type="button" class="btn btn-secondary btn-sm" id="scVoiceBtn">' + ICON('mic_record') + ' ' + esc(t('record_btn')) + '</button>' +
            '<span id="scVoiceStatus" class="muted" style="font-size:12px;">' + esc(t('no_recording_yet')) + '</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="support-capture-footer">' +
        '<button type="button" class="btn btn-secondary" id="scCancelBtn">' + t('cancel') + '</button>' +
        '<button type="button" class="btn btn-primary" id="scSubmitBtn">' + esc(t('submit_ticket_btn')) + '</button>' +
      '</div>' +
    '</div>';
  overlay.classList.remove('hidden');

  document.getElementById('scCloseBtn').onclick = closeSupportCapture_;
  document.getElementById('scCancelBtn').onclick = closeSupportCapture_;

  if (canvas) wireSupportAnnotation_(canvas, function (r) { rect = r; });

  var voiceCtl = wireSupportVoiceRecorder_('scVoiceBtn', 'scVoiceStatus', function (blob, url) { voiceBlob = blob; voiceUrl = url; });

  document.getElementById('scSubmitBtn').onclick = async function () {
    var remarks = document.getElementById('scRemarks').value.trim();
    if (!remarks) { UI.toast(t('toast_describe_first'), 'error'); return; }
    if (voiceCtl.isRecording()) voiceCtl.stop();
    try {
      var screenshotUrl = '';
      if (canvas) {
        if (rect) drawAnnotationOntoCanvas_(canvas, document.getElementById('scAnnotateCanvas'), rect);
        var blob = await new Promise(function (res) { canvas.toBlob(res, 'image/png'); });
        var b64 = await fileToBase64(blob);
        var up = await Api.call('uploadTicketMedia', { fileBase64: b64, fileName: 'screenshot.png', mimeType: 'image/png' });
        screenshotUrl = up.url;
      }
      var voiceNoteUrl = '';
      if (voiceBlob) {
        var vb64 = await fileToBase64(voiceBlob);
        var vup = await Api.call('uploadTicketMedia', { fileBase64: vb64, fileName: 'voice-note.webm', mimeType: voiceBlob.type || 'audio/webm' });
        voiceNoteUrl = vup.url;
      }
      await Api.call('createTicket', { remarks: remarks, pageContext: window.location.hash, screenshotUrl: screenshotUrl, voiceNoteUrl: voiceNoteUrl });
      closeSupportCapture_();
      UI.toast(t('toast_ticket_submitted'), 'success');
      if (window.location.hash.indexOf('#/support') === 0) Router.resolve();
    } catch (err) { UI.error(err); }
  };
}

// Lets the user drag exactly one rectangle over the screenshot <img> (REQ: "outline a part of the
// screen to set focus on the issue"). The visible canvas is sized to the IMG's on-screen (CSS)
// pixels for a 1:1 pointer mapping while drawing; onRectChange receives that same on-screen-pixel
// rect, which drawAnnotationOntoCanvas_ later rescales onto the real (often higher-res) screenshot.
function wireSupportAnnotation_(shotCanvas, onRectChange) {
  var img = document.getElementById('scShotImg');
  var annCanvas = document.getElementById('scAnnotateCanvas');
  var drawing = false, startX = 0, startY = 0, rect = null;

  function syncSize() { annCanvas.width = img.clientWidth; annCanvas.height = img.clientHeight; }
  function redraw(curX, curY) {
    var ctx = annCanvas.getContext('2d');
    ctx.clearRect(0, 0, annCanvas.width, annCanvas.height);
    var box = drawing && curX !== undefined
      ? { x: Math.min(startX, curX), y: Math.min(startY, curY), w: Math.abs(curX - startX), h: Math.abs(curY - startY) }
      : rect;
    if (!box) return;
    ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 3; ctx.strokeRect(box.x, box.y, box.w, box.h);
  }
  if (img.complete) syncSize(); else img.onload = syncSize;

  annCanvas.addEventListener('pointerdown', function (e) {
    var r = annCanvas.getBoundingClientRect();
    startX = e.clientX - r.left; startY = e.clientY - r.top; drawing = true;
  });
  annCanvas.addEventListener('pointermove', function (e) {
    if (!drawing) return;
    var r = annCanvas.getBoundingClientRect();
    redraw(e.clientX - r.left, e.clientY - r.top);
  });
  window.addEventListener('pointerup', function (e) {
    if (!drawing) return;
    drawing = false;
    var r = annCanvas.getBoundingClientRect();
    var curX = e.clientX - r.left, curY = e.clientY - r.top;
    var w = Math.abs(curX - startX), h = Math.abs(curY - startY);
    rect = (w > 4 && h > 4) ? { x: Math.min(startX, curX), y: Math.min(startY, curY), w: w, h: h } : null;
    redraw();
    onRectChange(rect ? { x: rect.x / annCanvas.width, y: rect.y / annCanvas.height, w: rect.w / annCanvas.width, h: rect.h / annCanvas.height } : null);
  });
}

// rect here is in FRACTIONAL coordinates (0..1 of the annotation canvas's width/height, as stored
// by wireSupportAnnotation_ above) so it scales correctly onto shotCanvas's real pixel dimensions
// regardless of any difference between on-screen CSS size and actual captured resolution.
function drawAnnotationOntoCanvas_(shotCanvas, _annCanvasUnused, rect) {
  var ctx = shotCanvas.getContext('2d');
  ctx.strokeStyle = '#dc2626'; ctx.lineWidth = Math.max(3, Math.round(shotCanvas.width * 0.004));
  ctx.strokeRect(rect.x * shotCanvas.width, rect.y * shotCanvas.height, rect.w * shotCanvas.width, rect.h * shotCanvas.height);
}

// Wires a Record/Stop button + status area to an audio-only MediaRecorder session, auto-stopping at
// SUPPORT_MAX_RECORDING_MS. onDone(blob, objectUrl) fires once a recording finishes (manual stop or
// the cap). Returns { isRecording(), stop() } so a caller (e.g. the submit button above) can force a
// stop before reading the result.
function wireSupportVoiceRecorder_(btnId, statusId, onDone) {
  var recorder = null, chunks = [], timer = null, startedAt = 0;
  var btn = document.getElementById(btnId);
  var status = document.getElementById(statusId);

  async function start() {
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.onstop = function () {
        stream.getTracks().forEach(function (tr) { tr.stop(); });
        clearInterval(timer);
        var blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        var url = URL.createObjectURL(blob);
        btn.innerHTML = ICON('mic_record') + ' ' + esc(t('re_record_btn'));
        status.innerHTML = '<audio controls src="' + url + '"></audio>';
        onDone(blob, url);
      };
      recorder.start();
      startedAt = Date.now();
      btn.innerHTML = ICON('mic_stop') + ' ' + esc(t('stop_btn'));
      status.innerHTML = '<span class="support-rec-dot"></span> <span class="support-rec-time" id="' + statusId + 'Time">0:00</span>';
      timer = setInterval(function () {
        var secs = Math.floor((Date.now() - startedAt) / 1000);
        var el = document.getElementById(statusId + 'Time');
        if (el) el.textContent = Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
        if (secs * 1000 >= SUPPORT_MAX_RECORDING_MS) recorder.stop();
      }, 500);
    } catch (e) {
      UI.toast(t('toast_mic_denied'), 'error');
    }
  }

  btn.onclick = function () {
    if (recorder && recorder.state === 'recording') recorder.stop();
    else start();
  };

  return {
    isRecording: function () { return !!(recorder && recorder.state === 'recording'); },
    stop: function () { if (recorder && recorder.state === 'recording') recorder.stop(); }
  };
}

// Support/SystemAdmin-only: records the screen (getDisplayMedia -- this DOES prompt, unlike the
// html2canvas screenshot above; a live walkthrough recording inherently requires the browser's own
// share picker) combined with the mic, capped the same as voice notes. Used from the ticket detail
// thread (renderSupportDetail) to attach a screen+voice walkthrough as a comment or as part of
// resolving a ticket. Resolves to a Blob, or null if the user cancels/denies permission.
async function recordSupportScreenAndVoice_(onProgress) {
  var screenStream, micStream;
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  } catch (e) { return null; }
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) { micStream = null; /* proceed video-only if mic is denied */ }

  var tracks = screenStream.getVideoTracks().slice();
  if (micStream) tracks = tracks.concat(micStream.getAudioTracks());
  var combined = new MediaStream(tracks);

  return new Promise(function (resolve) {
    var chunks = [];
    var recorder;
    try { recorder = new MediaRecorder(combined, { mimeType: 'video/webm' }); }
    catch (e) { recorder = new MediaRecorder(combined); }
    var startedAt = Date.now();
    var timer = setInterval(function () {
      var secs = Math.floor((Date.now() - startedAt) / 1000);
      if (onProgress) onProgress(secs);
      if (secs * 1000 >= SUPPORT_MAX_RECORDING_MS && recorder.state === 'recording') recorder.stop();
    }, 500);
    recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = function () {
      clearInterval(timer);
      screenStream.getTracks().forEach(function (t) { t.stop(); });
      if (micStream) micStream.getTracks().forEach(function (t) { t.stop(); });
      resolve(new Blob(chunks, { type: recorder.mimeType || 'video/webm' }));
    };
    // The browser's own "Stop sharing" control ends the video track directly -- treat that the
    // same as clicking Stop in-app, rather than leaving the recorder hanging with a dead track.
    screenStream.getVideoTracks()[0].onended = function () { if (recorder.state === 'recording') recorder.stop(); };
    recorder.__hululStop = function () { if (recorder.state === 'recording') recorder.stop(); };
    window._hululActiveScreenRecorder = recorder;
    recorder.start();
  });
}

/* ================= Ticket queue ================= */

async function renderSupport() {
  var root = document.getElementById('viewRoot');
  var manager = isSupportManager_();
  var tickets = await Api.call('listTickets', {});
  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + t('nav_support') + '</div>' +
    '<div class="page-subtitle">' + esc(manager ? t('support_subtitle_manager') : t('support_subtitle_raiser')) + '</div></div>' +
    '<button class="btn btn-primary" id="newTicketBtn">' + esc(t('report_issue_btn')) + '</button></div>' +
    '<div class="card"><div class="card-body">' + UI.table([
      { key: 'subject', label: t('col_subject') },
      { key: 'createdByName', label: t('col_raised_by'), render: r => esc(r.createdByName || r.createdBy) },
      { key: 'status', label: t('status'), render: r => UI.statusBadge(r.status) },
      { key: 'createdAt', label: t('col_raised'), render: r => UI.fmtDate(r.createdAt) },
      { key: 'updatedAt', label: t('col_updated'), render: r => UI.fmtDate(r.updatedAt) },
      { key: 'actions', label: t('actions'), render: r =>
          '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('action_open')) + '" data-open="' + r.id + '">' + ICON('view_open') + '</button>' }
    ], tickets, { exportName: 'support-tickets.csv', emptyText: manager ? t('empty_tickets_manager') : t('empty_tickets_raiser') }) + '</div></div>';

  document.getElementById('newTicketBtn').onclick = function () { openSupportCapture(); };
  root.querySelectorAll('[data-open]').forEach(function (b) {
    b.onclick = function () { window.location.hash = '#/support/' + b.getAttribute('data-open'); };
  });
}

/* ================= Ticket detail / thread ================= */

async function renderSupportDetail(params) {
  var root = document.getElementById('viewRoot');
  var ticketId = params.id;
  var data = await Api.call('getTicketDetail', { ticketId: ticketId });
  var ticket = data.ticket, comments = data.comments;
  var manager = isSupportManager_();
  var isRaiser = HululState.user.id === ticket.createdBy;

  root.innerHTML =
    '<div class="breadcrumb"><a href="#/support">' + t('nav_support') + '</a> / ' + esc(ticket.subject) + '</div>' +
    '<div class="page-header"><div><div class="page-title">' + esc(ticket.subject) + '</div>' +
    '<div class="page-subtitle">' + esc(t('raised_by_on', { name: ticket.createdByName || ticket.createdBy, date: UI.fmtDate(ticket.createdAt) })) + '</div></div>' +
    UI.statusBadge(ticket.status) + '</div>' +

    '<div class="card" style="margin-bottom:16px;"><div class="card-body" style="display:flex;flex-direction:column;gap:12px;">' +
      '<div><div class="field-label">' + esc(t('field_description')) + '</div><div style="font-size:13.5px;white-space:pre-wrap;">' + esc(ticket.remarks) + '</div></div>' +
      (ticket.pageContext ? '<div class="muted" style="font-size:12px;">' + esc(t('reported_from', { context: ticket.pageContext })) + '</div>' : '') +
      (ticket.screenshotUrl ? '<div><div class="field-label">' + esc(t('field_screenshot')) + '</div><a href="' + esc(ticket.screenshotUrl) + '" target="_blank" rel="noopener"><img src="' + esc(ticket.screenshotUrl) + '" style="max-width:100%;border:1px solid var(--border);border-radius:var(--radius-sm);" /></a></div>' : '') +
      (ticket.voiceNoteUrl ? '<div><div class="field-label">' + esc(t('field_voice_note')) + '</div><audio controls src="' + esc(ticket.voiceNoteUrl) + '"></audio></div>' : '') +
    '</div></div>' +

    '<div class="card" style="margin-bottom:16px;"><div class="card-body">' +
      '<div class="field-label" style="margin-bottom:10px;">' + esc(t('field_thread')) + '</div>' +
      '<div id="ticketThread" style="display:flex;flex-direction:column;gap:12px;">' +
        (comments.length ? comments.map(supportCommentHtml_).join('') : '<div class="muted" style="font-size:12.5px;">' + esc(t('no_replies_yet')) + '</div>') +
      '</div>' +
    '</div></div>' +

    '<div class="card" id="ticketActionsCard"><div class="card-body" style="display:flex;flex-direction:column;gap:14px;"></div></div>';

  wireSupportDetailActions_(document.getElementById('ticketActionsCard').querySelector('.card-body'), ticket, manager, isRaiser);
}

function supportCommentHtml_(c) {
  return '<div style="border-left:3px solid var(--border);padding-left:10px;">' +
    '<div style="font-size:12.5px;font-weight:700;">' + esc(c.authorName || c.authorId) + '<span class="muted" style="font-weight:400;"> · ' + UI.fmtDate(c.createdAt) + '</span></div>' +
    (c.message ? '<div style="font-size:13px;margin-top:3px;white-space:pre-wrap;">' + esc(c.message) + '</div>' : '') +
    (c.voiceNoteUrl ? '<div style="margin-top:6px;"><audio controls src="' + esc(c.voiceNoteUrl) + '"></audio></div>' : '') +
    (c.recordingUrl ? '<div style="margin-top:6px;"><video controls src="' + esc(c.recordingUrl) + '" style="max-width:100%;border-radius:var(--radius-sm);"></video></div>' : '') +
  '</div>';
}

// Builds the bottom "what can I do right now" card: a reply box everyone gets, plus
// status-and-role-specific actions (Support: mark resolved / record a screen walkthrough; raiser:
// approve/reject a Resolved ticket). Re-rendering the whole page after every action (Router.resolve)
// keeps this in sync with the ticket's current status rather than trying to patch the DOM in place.
function wireSupportDetailActions_(body, ticket, manager, isRaiser) {
  var closed = ticket.status === 'Completed';
  var html = '';

  if (!closed) {
    html +=
      '<div>' +
        '<label class="field-label">' + esc(t('field_add_reply')) + '</label>' +
        '<textarea id="tcMessage" class="field-input" rows="3" placeholder="' + esc(t('comment_placeholder')) + '"></textarea>' +
        '<div class="support-voice-row" style="margin-top:8px;">' +
          '<button type="button" class="btn btn-secondary btn-sm" id="tcVoiceBtn">' + ICON('mic_record') + ' ' + esc(t('voice_note_btn')) + '</button>' +
          '<span id="tcVoiceStatus" class="muted" style="font-size:12px;">' + esc(t('no_recording_yet')) + '</span>' +
        '</div>' +
        (manager ? '<div style="margin-top:8px;"><button type="button" class="btn btn-secondary btn-sm" id="tcScreenBtn">' + ICON('screen_record') + ' ' + esc(t('record_screen_voice_btn')) + '</button> ' +
          '<span id="tcScreenStatus" class="muted" style="font-size:12px;"></span></div>' : '') +
        '<div style="margin-top:10px;"><button type="button" class="btn btn-primary btn-sm" id="tcSendBtn">' + t('submit') + '</button></div>' +
      '</div>';
  }

  if (hasPermission('ticket.resolve') && ['Open', 'InProgress'].indexOf(ticket.status) !== -1) {
    html += '<div style="border-top:1px solid var(--border);padding-top:14px;">' +
      '<button type="button" class="btn btn-primary" id="tcResolveBtn">' + ICON('resolve_ticket') + ' ' + esc(t('mark_resolved_btn')) + '</button></div>';
  }
  if (isRaiser && ticket.status === 'Resolved') {
    html += '<div style="border-top:1px solid var(--border);padding-top:14px;display:flex;gap:8px;">' +
      '<button type="button" class="btn btn-primary" id="tcApproveBtn">' + ICON('approve_ticket') + ' ' + esc(t('approve_mark_completed_btn')) + '</button>' +
      '<button type="button" class="btn btn-secondary" id="tcRejectBtn">' + ICON('reject_ticket') + ' ' + esc(t('not_fixed_send_back_btn')) + '</button></div>';
  }
  if (closed) html += '<div class="empty-state">' + esc(t('ticket_closed')) + '</div>';

  body.innerHTML = html;
  if (closed) return;

  var pendingRecordingUrl = '', pendingRecordingMime = '';
  var voiceCtl = wireSupportVoiceRecorder_('tcVoiceBtn', 'tcVoiceStatus', function () {});

  var screenBtn = document.getElementById('tcScreenBtn');
  if (screenBtn) {
    screenBtn.onclick = async function () {
      var status = document.getElementById('tcScreenStatus');
      screenBtn.disabled = true;
      status.textContent = t('choose_screen_share_hint');
      var blob = await recordSupportScreenAndVoice_(function (secs) {
        status.innerHTML = '<span class="support-rec-dot"></span> ' + esc(t('recording_prefix')) + Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0') +
          ' — <a href="javascript:void(0)" id="tcScreenStopLink">' + esc(t('stop_link_label')) + '</a>';
        var stopLink = document.getElementById('tcScreenStopLink');
        if (stopLink) stopLink.onclick = function () { if (window._hululActiveScreenRecorder) window._hululActiveScreenRecorder.__hululStop(); };
      });
      screenBtn.disabled = false;
      if (!blob) { status.textContent = ''; return; }
      try {
        var b64 = await fileToBase64(blob);
        var up = await Api.call('uploadTicketMedia', { fileBase64: b64, fileName: 'screen-recording.webm', mimeType: blob.type || 'video/webm' });
        pendingRecordingUrl = up.url; pendingRecordingMime = blob.type || 'video/webm';
        status.innerHTML = esc(t('recording_attached_note')) + '<video controls src="' + up.url + '" style="max-width:220px;display:block;margin-top:6px;border-radius:var(--radius-sm);"></video>';
      } catch (err) { UI.error(err); status.textContent = ''; }
    };
  }

  document.getElementById('tcSendBtn').onclick = async function () {
    if (voiceCtl.isRecording()) voiceCtl.stop();
    var message = document.getElementById('tcMessage').value.trim();
    if (!message && !pendingRecordingUrl) { UI.toast(t('toast_write_comment_or_attach'), 'error'); return; }
    try {
      var voiceNoteUrl = '';
      var audioEl = document.querySelector('#tcVoiceStatus audio');
      if (audioEl && audioEl.src && audioEl.src.indexOf('blob:') === 0) {
        var blob = await fetch(audioEl.src).then(function (r) { return r.blob(); });
        var b64 = await fileToBase64(blob);
        var up = await Api.call('uploadTicketMedia', { fileBase64: b64, fileName: 'voice-note.webm', mimeType: blob.type || 'audio/webm' });
        voiceNoteUrl = up.url;
      }
      await Api.call('addTicketComment', {
        ticketId: ticket.id, message: message, voiceNoteUrl: voiceNoteUrl,
        recordingUrl: pendingRecordingUrl, recordingMimeType: pendingRecordingMime
      });
      UI.toast(t('toast_reply_sent'), 'success');
      Router.resolve();
    } catch (err) { UI.error(err); }
  };

  var resolveBtn = document.getElementById('tcResolveBtn');
  if (resolveBtn) resolveBtn.onclick = function () { openResolveTicketModal_(ticket); };
  var approveBtn = document.getElementById('tcApproveBtn');
  if (approveBtn) approveBtn.onclick = function () {
    UI.confirmModal(t('confirm_approve_ticket'), async function () {
      try { await Api.call('approveTicketResolution', { ticketId: ticket.id }); UI.toast(t('toast_ticket_completed'), 'success'); Router.resolve(); }
      catch (err) { UI.error(err); }
    }, { confirmLabel: t('approve_btn'), confirmClass: 'btn-primary' });
  };
  var rejectBtn = document.getElementById('tcRejectBtn');
  if (rejectBtn) rejectBtn.onclick = function () { openRejectTicketModal_(ticket); };
}

function openResolveTicketModal_(ticket) {
  var body = UI.field(t('field_resolution_remarks'), '<textarea id="rtMessage" class="field-input" rows="4" placeholder="' + esc(t('resolution_remarks_placeholder')) + '"></textarea>');
  UI.openModal(t('mark_ticket_resolved_title'), body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('mark_resolved_btn'), className: 'btn-primary', onClick: async function () {
        var message = document.getElementById('rtMessage').value.trim();
        if (!message) { UI.toast(t('toast_resolution_remarks_required'), 'error'); return; }
        try {
          await Api.call('resolveTicket', { ticketId: ticket.id, message: message });
          UI.closeModal(); UI.toast(t('toast_ticket_marked_resolved'), 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      } }
  ]);
}

function openRejectTicketModal_(ticket) {
  var body = UI.field(t('field_what_needs_work'), '<textarea id="rjMessage" class="field-input" rows="4" placeholder="' + esc(t('needs_work_placeholder')) + '"></textarea>');
  UI.openModal(t('send_back_title'), body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('send_back_btn'), className: 'btn-danger', onClick: async function () {
        var message = document.getElementById('rjMessage').value.trim();
        if (!message) { UI.toast(t('toast_let_support_know'), 'error'); return; }
        try {
          await Api.call('rejectTicketResolution', { ticketId: ticket.id, message: message });
          UI.closeModal(); UI.toast(t('toast_sent_back'), 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      } }
  ]);
}
