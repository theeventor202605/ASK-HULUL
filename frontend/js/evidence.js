/**
 * HULUL - evidence.js
 * REQ (Record results / Risk Logging, eventDetail.js): every photo captured through the app's
 * camera (capture="environment" file inputs) must be stamped with date/time + GPS + a live Arabic
 * address (bottom-left), a QR code linking to the exact capture location on Google Maps
 * (bottom-right), the Inspection Company's logo (top-left) and the GA's logo (top-right) -- and must
 * be saved to the device *before* attempting to upload it, so a dropped connection never loses the
 * photo (only the upload needs to retry; the evidence itself is already safe on disk).
 *
 * Depends on `fileToBase64` (defined in eventDetail.js) and the global `Api`/`QRCode` -- load this
 * script after both in index.html.
 *
 * Public surface: window.EvidenceCapture = { prepare, saveAndUpload, retryPending, pendingCount,
 * getPosition, saveLogPhoto, listLogPhotos, deleteLogPhoto, trashLogPhoto, restoreLogPhoto,
 * listTrashedLogPhotos, purgeExpiredLogPhotos, emptyLogPhotoTrash }
 */

/* ---------------- Local-first durable queue (IndexedDB) ----------------
 * Stores the finished (already watermarked/compressed) File as a Blob, keyed by a locally-generated
 * id, so it survives a page reload even if the upload never completed. Deliberately tolerant of
 * IndexedDB being unavailable (very old browsers, private-mode restrictions in some browsers) --
 * every function below degrades to "skip local durability, still try the network upload" rather than
 * blocking evidence capture outright.
 *
 * Two stores share this DB: EVIDENCE_STORE_ ("pending") is the transient upload-retry safety net
 * above, keyed to a specific in-flight Finding/Resolution submission. LOG_PHOTOS_STORE_ ("logPhotos")
 * is a separate, longer-lived local gallery -- REQ (Log Photos tab): "every photo taken in this tab
 * gets stored locally with geolocation and user id" so an inspector can snap photos in the heat first
 * and group/log them later from somewhere cool. Every db helper below takes a storeName so both
 * stores reuse the same open/put/delete/getAll plumbing.
 */
var EVIDENCE_DB_NAME_ = 'hulul-evidence';
var EVIDENCE_DB_VERSION_ = 2;
var EVIDENCE_STORE_ = 'pending';
var LOG_PHOTOS_STORE_ = 'logPhotos';
// REQ: "Any deleted item stays 30 days in trash then gets permanently deleted." See trashLogPhoto/
// purgeExpiredLogPhotos below.
var LOG_PHOTO_TRASH_RETENTION_MS_ = 30 * 24 * 60 * 60 * 1000;

function evidenceOpenDb_() {
  return new Promise(function (resolve, reject) {
    if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
    var req = indexedDB.open(EVIDENCE_DB_NAME_, EVIDENCE_DB_VERSION_);
    req.onupgradeneeded = function () {
      var db = req.result;
      if (!db.objectStoreNames.contains(EVIDENCE_STORE_)) db.createObjectStore(EVIDENCE_STORE_, { keyPath: 'localId' });
      if (!db.objectStoreNames.contains(LOG_PHOTOS_STORE_)) db.createObjectStore(LOG_PHOTOS_STORE_, { keyPath: 'localId' });
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error || new Error('Could not open local storage')); };
  });
}
function evidenceDbPut_(record, storeName) {
  return evidenceOpenDb_().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(storeName || EVIDENCE_STORE_, 'readwrite');
      tx.objectStore(storeName || EVIDENCE_STORE_).put(record);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  });
}
function evidenceDbDelete_(localId, storeName) {
  return evidenceOpenDb_().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(storeName || EVIDENCE_STORE_, 'readwrite');
      tx.objectStore(storeName || EVIDENCE_STORE_).delete(localId);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  });
}
function evidenceDbAll_(storeName) {
  return evidenceOpenDb_().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(storeName || EVIDENCE_STORE_, 'readonly');
      var req = tx.objectStore(storeName || EVIDENCE_STORE_).getAll();
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function () { reject(req.error); };
    });
  }).catch(function () { return []; });
}
// Single-record read -- needed by the trash flow below (trashLogPhoto/restoreLogPhoto do a
// read-modify-write on the deletedAt field; IndexedDB's put() replaces the whole record, so the
// current one has to be fetched first rather than blind-writing a partial object).
function evidenceDbGet_(localId, storeName) {
  return evidenceOpenDb_().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(storeName || EVIDENCE_STORE_, 'readonly');
      var req = tx.objectStore(storeName || EVIDENCE_STORE_).get(localId);
      req.onsuccess = function () { resolve(req.result || null); };
      req.onerror = function () { reject(req.error); };
    });
  }).catch(function () { return null; });
}

/* ---------------- GPS ---------------- */
function evidenceGetPosition_(timeoutMs) {
  return new Promise(function (resolve) {
    if (!navigator.geolocation) { resolve(null); return; }
    var done = false;
    var timer = setTimeout(function () { if (!done) { done = true; resolve(null); } }, timeoutMs);
    navigator.geolocation.getCurrentPosition(function (pos) {
      if (done) return; done = true; clearTimeout(timer);
      resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    }, function () {
      if (done) return; done = true; clearTimeout(timer);
      resolve(null);
    }, { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 10000 });
  });
}

/* ---------------- Reverse geocoding (Arabic address) ---------------- */
function evidenceFetchWithTimeout_(url, ms) {
  if (typeof AbortController === 'undefined') return fetch(url);
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, ms);
  return fetch(url, { signal: controller.signal }).then(function (res) { clearTimeout(timer); return res; },
    function (err) { clearTimeout(timer); throw err; });
}
function evidenceReverseGeocodeArabic_(lat, lng) {
  var url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=' + lat + '&lon=' + lng + '&accept-language=ar&zoom=18';
  return evidenceFetchWithTimeout_(url, 8000)
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (data) { return (data && data.display_name) ? data.display_name : ''; })
    .catch(function () { return ''; });
}

/* ---------------- QR code (Google Maps link to the exact capture point) ---------------- */
// Reuses the same qrcodejs library/pattern already used for Place account credentials (venues.js) --
// renders synchronously into a throwaway offscreen element, then lifts a data URL out of whatever
// it produced (canvas, or an <img> fallback on very old browsers).
function evidenceQrDataUrl_(text, sizePx) {
  return new Promise(function (resolve) {
    if (typeof QRCode === 'undefined' || !text) { resolve(''); return; }
    var holder = document.createElement('div');
    holder.style.position = 'fixed'; holder.style.left = '-9999px'; holder.style.top = '-9999px';
    document.body.appendChild(holder);
    try {
      new QRCode(holder, { text: text, width: sizePx, height: sizePx, correctLevel: QRCode.CorrectLevel.M });
    } catch (e) {
      document.body.removeChild(holder);
      resolve('');
      return;
    }
    setTimeout(function () {
      var canvas = holder.querySelector('canvas');
      var img = holder.querySelector('img');
      var dataUrl = canvas ? canvas.toDataURL('image/png') : (img ? img.src : '');
      document.body.removeChild(holder);
      resolve(dataUrl);
    }, 50);
  });
}

/* ---------------- Branding logos (cached per event) ---------------- */
var evidenceBrandingCache_ = {};
function evidenceGetBranding_(eventId) {
  if (!evidenceBrandingCache_[eventId]) {
    evidenceBrandingCache_[eventId] = Api.call('getEventBrandingLogos', { eventId: eventId })
      .catch(function () { return { gaLogoDataUri: '', inspectionCoLogoDataUri: '' }; });
  }
  return evidenceBrandingCache_[eventId];
}

/* ---------------- Venue boundary (cached per event, for the outside-boundary badge below) ----
 * REQ: "Any photos taken outside boundaries should be marked." getEvent already returns venue
 * (with its boundary string) as part of the normal event-detail payload -- same shape eventDetail.js
 * itself uses -- so this is one extra cached call, not a new endpoint. parseBoundaryClient_/
 * pointInPolygonClient_/haversineKm_ are defined in venues.js, which loads after this file (see
 * index.html) -- safe to reference anyway since all three are only ever called from inside prepare()'s
 * async pipeline, long after every script has finished loading (same reasoning as this file's own
 * header comment about fileToBase64/Api/QRCode). A venue with no boundary drawn yet resolves null,
 * same as a missing/denied GPS fix -- either way the badge below simply doesn't apply, never a false
 * positive.
 */
var evidenceVenueBoundaryCache_ = {};
function evidenceGetVenueBoundary_(eventId) {
  if (!evidenceVenueBoundaryCache_[eventId]) {
    evidenceVenueBoundaryCache_[eventId] = Api.call('getEvent', { eventId: eventId })
      .then(function (detail) { return (detail && detail.venue) ? parseBoundaryClient_(detail.venue.boundary) : null; })
      .catch(function () { return null; });
  }
  return evidenceVenueBoundaryCache_[eventId];
}

/* ---------------- Canvas drawing helpers ---------------- */
function evidenceLoadImage_(src) {
  return new Promise(function (resolve) {
    if (!src) { resolve(null); return; }
    var img = new Image();
    img.onload = function () { resolve(img); };
    img.onerror = function () { resolve(null); }; // a missing/broken logo shouldn't fail the whole photo
    img.src = src;
  });
}
function evidenceRoundRect_(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
// REQ (Settings > Photos Properties): each overlay (a logo, the geolocation box, the QR code) can be
// placed at one of 6 named positions instead of a hardcoded corner. `slots` accumulates how much
// vertical space has already been claimed at each position on THIS photo, so if two overlays are
// configured to the same position they stack (top ones grow downward, bottom ones grow upward)
// instead of drawing directly on top of each other. Returns the box's top-left {x,y} for a box of
// size w x h. Same 6-position list as PHOTO_POSITIONS_ (backend/Accounts.gs).
function evidencePlace_(slots, position, w, h, cw, ch, pad) {
  if (!slots[position]) slots[position] = 0;
  var used = slots[position];
  var isTop = position.indexOf('top-') === 0;
  var align = position.indexOf('left') !== -1 ? 'left' : (position.indexOf('right') !== -1 ? 'right' : 'center');
  var x = align === 'left' ? pad : (align === 'right' ? (cw - pad - w) : (cw - w) / 2);
  var y = isTop ? (pad + used) : (ch - pad - h - used);
  slots[position] = used + h + pad * 0.5;
  return { x: x, y: y };
}
function evidenceWrapText_(ctx, text, maxWidth, maxLines) {
  if (!text) return [];
  var words = text.split(' ');
  var lines = []; var current = '';
  words.forEach(function (w) {
    var test = current ? current + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && current) { lines.push(current); current = w; }
    else current = test;
  });
  if (current) lines.push(current);
  return lines.slice(0, maxLines);
}

// Draws the base photo (downscaled to maxDim on its long edge) plus every overlay, and resolves a
// JPEG File ready to upload. Any single overlay that fails to load (missing logo, no GPS fix, no
// address) is simply omitted -- the photo itself is never blocked on any of them.
function evidenceComposite_(file, meta) {
  var maxDim = 1600, quality = 0.85;
  return new Promise(function (resolve, reject) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      URL.revokeObjectURL(url);
      var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      var cw = Math.max(1, Math.round(img.width * scale));
      var ch = Math.max(1, Math.round(img.height * scale));
      var canvas = document.createElement('canvas');
      canvas.width = cw; canvas.height = ch;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, cw, ch);

      Promise.all([
        evidenceLoadImage_(meta.gaLogoDataUri),
        evidenceLoadImage_(meta.inspectionCoLogoDataUri),
        evidenceLoadImage_(meta.qrDataUrl)
      ]).then(function (imgs) {
        // The canvas already has the downscaled photo drawn on it (see drawImage above) -- that's
        // the size reduction that actually matters for upload reliability. Everything below is
        // decorative overlay on top of it; if ANY of it throws (a bad font, an unsupported canvas
        // API, a malformed logo), it must not take the resize down with it and fall back to
        // uploading the full-resolution original -- so it's wrapped in one try/catch that just skips
        // straight to exporting the (still properly-sized) canvas as-is.
        try {
          var gaLogo = imgs[0], coLogo = imgs[1], qrImg = imgs[2];
          var pad = Math.max(6, Math.round(ch * 0.02));
          var logoH = Math.round(ch * 0.09);
          // REQ (Settings > Photos Properties): tracks claimed space per position across every
          // overlay drawn below (logos, geolocation box, QR) so two overlays sharing a position stack
          // instead of overlapping -- see evidencePlace_ above.
          var slots = {};

          var drawLogo = function (logoImg, position) {
            if (!logoImg || !logoImg.width) return;
            var w = logoImg.width * (logoH / logoImg.height);
            var pos = evidencePlace_(slots, position, w, logoH, cw, ch, pad);
            ctx.save();
            ctx.fillStyle = 'rgba(255,255,255,0.85)';
            evidenceRoundRect_(ctx, pos.x - pad * 0.4, pos.y - pad * 0.4, w + pad * 0.8, logoH + pad * 0.8, pad * 0.4);
            ctx.fill();
            ctx.drawImage(logoImg, pos.x, pos.y, w, logoH);
            ctx.restore();
          };
          if (meta.inspectionCoLogoEnabled !== false) drawLogo(coLogo, meta.inspectionCoLogoPosition || 'top-left');
          if (meta.gaLogoEnabled !== false) drawLogo(gaLogo, meta.gaLogoPosition || 'top-right');

          // REQ follow-up: "Instead of showing 'OUTSIDE VENUE BOUNDARY' on photos make it a badge
          // also provide distance away from participant in meters." No longer burned into the photo's
          // own pixels -- meta.outsideBoundary/meta.distanceMeters are attached onto the returned File
          // below (prepare()) instead, so the app can render a proper UI badge (with the distance
          // figure, which wouldn't fit/update well baked into a banner) wherever this evidence's
          // thumbnail is shown, see evidenceOutsideBadgeHtml_ (eventDetail.js).

          // Geolocation box: date/time, GPS, Arabic address -- REQ (Photos Properties): a single
          // on/off toggle hides the whole box (date/time included, not just GPS/address), placed at
          // whichever configured position (default bottom-left, matching the original hardcoded spot).
          if (meta.geoEnabled !== false) {
            var now = new Date();
            var p2 = function (n) { return String(n).padStart(2, '0'); };
            var dateTimeStr = now.getFullYear() + '-' + p2(now.getMonth() + 1) + '-' + p2(now.getDate()) +
              '  ' + p2(now.getHours()) + ':' + p2(now.getMinutes()) + ':' + p2(now.getSeconds());
            var gpsStr = (meta.lat != null && meta.lng != null)
              ? (Math.abs(meta.lat).toFixed(6) + '°' + (meta.lat >= 0 ? 'N' : 'S') + ', ' + Math.abs(meta.lng).toFixed(6) + '°' + (meta.lng >= 0 ? 'E' : 'W'))
              : 'GPS unavailable';
            var addressStr = meta.address || 'العنوان غير متاح'; // "Address unavailable"

            var fontSize = Math.max(11, Math.round(ch * 0.022));
            ctx.font = fontSize + 'px Tajawal, Arial, sans-serif';
            var boxW = Math.round(cw * 0.62);
            var addrLines = evidenceWrapText_(ctx, addressStr, boxW - pad * 1.6, 2);
            var allLines = [dateTimeStr, gpsStr].concat(addrLines.length ? addrLines : ['']);
            var lineH = Math.round(fontSize * 1.4);
            var boxH = lineH * allLines.length + pad;
            var geoPos = evidencePlace_(slots, meta.geoPosition || 'bottom-left', boxW, boxH, cw, ch, pad);
            var boxX = geoPos.x, boxY = geoPos.y;

            ctx.save();
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            evidenceRoundRect_(ctx, boxX, boxY, boxW, boxH, pad * 0.5);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.textBaseline = 'top';
            allLines.forEach(function (line, i) {
              var isArabic = /[؀-ۿ]/.test(line);
              ctx.direction = isArabic ? 'rtl' : 'ltr';
              ctx.textAlign = isArabic ? 'right' : 'left';
              var lineX = isArabic ? (boxX + boxW - pad * 0.6) : (boxX + pad * 0.6);
              ctx.fillText(line, lineX, boxY + pad * 0.5 + i * lineH);
            });
            ctx.restore();
          }

          // QR linking to the exact capture point on Google Maps -- REQ (Photos Properties):
          // toggleable + placed at whichever configured position (default bottom-right, matching the
          // original hardcoded spot).
          if (meta.qrEnabled !== false && qrImg && qrImg.width) {
            var qrSize = Math.round(ch * 0.16);
            var qrPos = evidencePlace_(slots, meta.qrPosition || 'bottom-right', qrSize, qrSize, cw, ch, pad);
            var qx = qrPos.x, qy = qrPos.y;
            ctx.save();
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            evidenceRoundRect_(ctx, qx - pad * 0.3, qy - pad * 0.3, qrSize + pad * 0.6, qrSize + pad * 0.6, pad * 0.3);
            ctx.fill();
            ctx.drawImage(qrImg, qx, qy, qrSize, qrSize);
            ctx.restore();
          }
        } catch (overlayErr) {
          // Watermark overlay failed -- fine, the resized photo underneath is still good to go.
        }

        canvas.toBlob(function (blob) {
          if (!blob) { reject(new Error('Could not process photo')); return; }
          var name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
          var outFile = new File([blob], name, { type: 'image/jpeg' });
          // REQ follow-up: badge + distance metadata, carried on the File itself (not baked into the
          // image) so callers can read it straight off entry.file (eventDetail.js's
          // evidencePendingThumbHtml_) and forward it into the Finding's own evidenceMeta once
          // submitted (findings.js). Not present at all on the plain fallback `file` returned by
          // prepare()'s outer .catch -- that's fine, evidenceOutsideBadgeHtml_ already treats missing
          // metadata as "no badge," never a false positive.
          outFile._hululOutsideBoundary = !!meta.outsideBoundary;
          outFile._hululDistanceMeters = (meta.distanceMeters != null) ? meta.distanceMeters : null;
          outFile._hululLat = (meta.lat != null) ? meta.lat : null;
          outFile._hululLng = (meta.lng != null) ? meta.lng : null;
          resolve(outFile);
        }, 'image/jpeg', quality);
      });
    };
    img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Could not read captured photo')); };
    img.src = url;
  });
}

/* ---------------- Live in-browser camera capture (getUserMedia) ----------------
 * REQ follow-up: "Users logged in can still upload photos from their local machine! haven't we
 * disabled this action?" The previous camera-only enforcement relied entirely on
 * <input type=file capture="environment">. capture is a mobile-only hint -- every desktop browser
 * (Chrome/Edge/Firefox/Safari on Windows/Mac/Linux) silently ignores it and just opens the normal OS
 * file picker, so a desktop user could always browse and attach any file from disk no matter their
 * role or permissions. There is no way to close that from the file-input side; capture is simply
 * unenforceable there. This replaces it everywhere evidence is camera-captured (New Log, Resolve Log,
 * Record Results, Log Photos tab) with a real live camera view via getUserMedia, which behaves
 * identically on desktop and mobile and never exposes a file-system picker. The one remaining
 * sanctioned way to attach a file from disk is still the separate evidence.uploadFromDevice-gated
 * "Upload from device" button/input next to this one at each of those 4 call sites -- unchanged, still
 * permission-gated, still opt-in per role from Settings > Permissions.
 */
var evidenceCameraStream_ = null;
var evidenceCameraRecorder_ = null;

function evidenceStopCameraStream_() {
  if (evidenceCameraRecorder_ && evidenceCameraRecorder_.state !== 'inactive') {
    try { evidenceCameraRecorder_.stop(); } catch (e) { /* already stopped */ }
  }
  evidenceCameraRecorder_ = null;
  if (evidenceCameraStream_) {
    evidenceCameraStream_.getTracks().forEach(function (t) { t.stop(); });
    evidenceCameraStream_ = null;
  }
}

// opts: { allowVideo: bool, onFile: function(file) }. onFile fires once per captured photo or
// finished video recording -- the modal stays open afterward so the caller can take several shots in
// one session (mirrors how the old capture="environment" flow let someone tap the camera button again
// for a second photo, just without reopening the OS camera app each time). Every produced File flows
// into the exact same handler each call site already had for its old hidden file input's onchange --
// this only changes how the File is obtained, not anything downstream (still goes through
// EvidenceCapture.prepare/saveAndUpload, still respects resolutionEvidenceRequired/background-upload,
// etc).
function evidenceOpenCameraModal_(opts) {
  var allowVideo = !!(opts && opts.allowVideo);
  var onFile = (opts && opts.onFile) || function () {};
  var bodyHtml =
    '<div style="display:flex;flex-direction:column;align-items:center;gap:10px;">' +
      '<div id="evCamStatus" class="muted" style="font-size:12.5px;text-align:center;"></div>' +
      '<video id="evCamVideo" autoplay playsinline muted style="width:100%;max-width:480px;border-radius:var(--radius-sm);background:#000;display:none;"></video>' +
      '<canvas id="evCamCanvas" style="display:none;"></canvas>' +
      '<div id="evCamRecordTimer" class="muted" style="font-size:12.5px;display:none;"></div>' +
    '</div>';
  var footerButtons = [
    { label: ICON('capture_photo') + ' ' + t('camera_take_photo'), className: 'btn-primary', onClick: function () { evidenceCameraSnapPhoto_(onFile); } }
  ];
  if (allowVideo && window.MediaRecorder) {
    footerButtons.push({ label: ICON('capture_photo') + ' ' + t('camera_record_video'), className: 'btn-secondary', id: 'evCamRecordBtn', onClick: function () { evidenceCameraToggleRecording_(onFile); } });
  }
  footerButtons.push({ label: t('close'), className: 'btn-secondary', onClick: function () { evidenceStopCameraStream_(); UI.closeModal(); } });
  UI.openModal(t('camera_capture_title'), bodyHtml, footerButtons);
  // UI.openModal's own X button just wipes the DOM -- override it to release the camera first (same
  // reasoning as the explicit Close button above), otherwise the device's camera-in-use indicator
  // stays lit until the whole page is reloaded.
  var xBtn = document.getElementById('modalCloseBtn');
  if (xBtn) xBtn.onclick = function () { evidenceStopCameraStream_(); UI.closeModal(); };

  var statusEl = document.getElementById('evCamStatus');
  var videoEl = document.getElementById('evCamVideo');
  statusEl.textContent = t('camera_starting');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    statusEl.textContent = t('camera_unsupported');
    return;
  }
  navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: allowVideo })
    .then(function (stream) {
      evidenceCameraStream_ = stream;
      videoEl.srcObject = stream;
      videoEl.style.display = '';
      statusEl.textContent = '';
    })
    .catch(function () {
      statusEl.textContent = t('camera_access_denied');
    });
}

function evidenceCameraSnapPhoto_(onFile) {
  var videoEl = document.getElementById('evCamVideo');
  var canvas = document.getElementById('evCamCanvas');
  if (!videoEl || !evidenceCameraStream_ || !videoEl.videoWidth) return;
  canvas.width = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;
  canvas.getContext('2d').drawImage(videoEl, 0, 0, canvas.width, canvas.height);
  canvas.toBlob(function (blob) {
    if (!blob) return;
    var file = new File([blob], 'camera-' + Date.now() + '.jpg', { type: 'image/jpeg' });
    onFile(file);
    var statusEl = document.getElementById('evCamStatus');
    if (statusEl) {
      statusEl.textContent = t('camera_photo_captured');
      setTimeout(function () { if (statusEl) statusEl.textContent = ''; }, 1500);
    }
  }, 'image/jpeg', 0.9);
}

function evidenceCameraToggleRecording_(onFile) {
  var timerEl = document.getElementById('evCamRecordTimer');
  var recordBtn = document.getElementById('evCamRecordBtn');
  if (evidenceCameraRecorder_ && evidenceCameraRecorder_.state === 'recording') {
    evidenceCameraRecorder_.stop();
    return;
  }
  if (!evidenceCameraStream_) return;
  var mimeType = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'].filter(function (m) {
    return window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported(m);
  })[0] || '';
  var chunks = [];
  var recorder;
  try {
    recorder = mimeType ? new MediaRecorder(evidenceCameraStream_, { mimeType: mimeType }) : new MediaRecorder(evidenceCameraStream_);
  } catch (e) { return; }
  evidenceCameraRecorder_ = recorder;
  // innerHTML (not textContent) -- ICON() returns raw SVG markup, same reasoning as UI.openModal's
  // own footer-button rendering (ui.js).
  if (recordBtn) recordBtn.innerHTML = ICON('capture_photo') + ' ' + t('camera_stop_recording');
  var startedAt = Date.now();
  var tick = setInterval(function () {
    if (!timerEl) return;
    var secs = Math.floor((Date.now() - startedAt) / 1000);
    timerEl.style.display = '';
    timerEl.textContent = t('camera_recording_seconds', { count: secs });
  }, 500);
  recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
  recorder.onstop = function () {
    clearInterval(tick);
    if (timerEl) timerEl.style.display = 'none';
    if (recordBtn) recordBtn.innerHTML = ICON('capture_photo') + ' ' + t('camera_record_video');
    evidenceCameraRecorder_ = null;
    if (!chunks.length) return;
    var blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
    var ext = (recorder.mimeType || '').indexOf('mp4') !== -1 ? 'mp4' : 'webm';
    var file = new File([blob], 'camera-' + Date.now() + '.' + ext, { type: blob.type });
    onFile(file);
  };
  recorder.start();
}

/* ---------------- Public API ---------------- */
window.EvidenceCapture = {
  openCameraModal: evidenceOpenCameraModal_,
  // Full pipeline for one captured file: GPS -> Arabic reverse-geocode -> QR (Google Maps link) ->
  // branding logos -> composite onto a downscaled JPEG. Videos (and anything that isn't an image)
  // pass through untouched -- a watermark overlay doesn't apply to video the same way, and
  // re-encoding video client-side isn't practical.
  // knownPos (optional): a {lat,lng} already fetched by the caller -- Log Photos capture needs the
  // same fix both for the watermark AND for local grouping metadata, and fetching GPS twice risks two
  // slightly different readings (device jitter) between "what's stamped on the photo" and "what's
  // stored for grouping." Pass it through here so both use the exact same fix; omit it and prepare()
  // fetches its own, as before.
  // participantPos (optional): {lat,lng} of the log's selected Participant -- REQ follow-up: "provide
  // distance away from participant in meters." Only findings.js's New Log form currently has a
  // participant to offer; every other caller omits it and simply gets no distance figure (still gets
  // the plain outsideBoundary flag either way).
  prepare: function (file, eventId, knownPos, participantPos) {
    if (!file.type || file.type.indexOf('image/') !== 0) return Promise.resolve(file);
    var posPromise = knownPos ? Promise.resolve(knownPos) : evidenceGetPosition_(8000);
    return Promise.all([posPromise, evidenceGetBranding_(eventId), evidenceGetVenueBoundary_(eventId)])
      .then(function (r) {
        var pos = r[0], branding = r[1] || {}, boundary = r[2];
        // REQ: "Any photos taken outside boundaries should be marked." Only a definite "yes, outside"
        // sets this -- no GPS fix, or no boundary drawn for the venue, both leave it false rather than
        // guessing (see evidenceGetVenueBoundary_'s comment).
        var outsideBoundary = !!(pos && boundary && !pointInPolygonClient_(pos.lat, pos.lng, boundary));
        // REQ follow-up: "distance away from participant in meters." haversineKm_ (venues.js) is
        // loaded app-wide, same "safe to reference from inside this async pipeline even though venues.js
        // loads after this file" reasoning as pointInPolygonClient_ above.
        var distanceMeters = (pos && participantPos && participantPos.lat != null && participantPos.lat !== '' && participantPos.lng != null && participantPos.lng !== '')
          ? Math.round(haversineKm_(pos.lat, pos.lng, Number(participantPos.lat), Number(participantPos.lng)) * 1000)
          : null;
        var addressPromise = pos ? evidenceReverseGeocodeArabic_(pos.lat, pos.lng) : Promise.resolve('');
        var mapsUrl = pos ? ('https://www.google.com/maps?q=' + pos.lat + ',' + pos.lng) : '';
        var qrPromise = evidenceQrDataUrl_(mapsUrl, 220);
        return Promise.all([addressPromise, qrPromise]).then(function (r2) {
          return evidenceComposite_(file, {
            lat: pos ? pos.lat : null, lng: pos ? pos.lng : null, address: r2[0],
            gaLogoDataUri: branding.gaLogoDataUri, inspectionCoLogoDataUri: branding.inspectionCoLogoDataUri,
            qrDataUrl: r2[1], outsideBoundary: outsideBoundary, distanceMeters: distanceMeters,
            // REQ (Settings > Photos Properties): per-org enabled/position config, already resolved
            // server-side by getEventBrandingLogos -- see evidenceComposite_'s drawLogo/geo-box/QR.
            gaLogoEnabled: branding.gaLogoEnabled, gaLogoPosition: branding.gaLogoPosition,
            inspectionCoLogoEnabled: branding.inspectionCoLogoEnabled, inspectionCoLogoPosition: branding.inspectionCoLogoPosition,
            geoEnabled: branding.geoEnabled, geoPosition: branding.geoPosition,
            qrEnabled: branding.qrEnabled, qrPosition: branding.qrPosition
          });
        });
      })
      .catch(function () { return file; }); // anything in the pipeline failing shouldn't lose the photo
  },

  // Saves the finished file to IndexedDB *before* attempting the network upload -- REQ: "store
  // locally and then upload from the local copy ... to prevent losing upload due to bad internet
  // connection." Same resolve/reject + onProgress contract as Api.uploadWithProgress, so callers
  // don't need special-casing for the happy path. On failure the record deliberately stays in
  // IndexedDB (unless local storage itself is unavailable) -- retryPending() and the 'online'
  // listener below pick it up later; callers should show a "saved locally" status, not a hard error.
  saveAndUpload: function (localId, eventId, file, onProgress) {
    var record = { localId: localId, eventId: eventId, fileName: file.name, mimeType: file.type, blob: file, savedAt: Date.now() };
    return evidenceDbPut_(record).catch(function () {}).then(function () {
      return fileToBase64(file);
    }).then(function (base64) {
      return Api.uploadWithProgress('uploadEvidence', { eventId: eventId, fileBase64: base64, fileName: file.name, mimeType: file.type }, onProgress);
    }).then(function (res) {
      return evidenceDbDelete_(localId).catch(function () {}).then(function () { return res; });
    });
  },

  // Re-attempts every evidence file still sitting in IndexedDB (optionally narrowed to one event) --
  // called on the 'online' event below and whenever the Inspections tab loads, so anything saved
  // locally during a dead connection gets uploaded the moment a connection is available again, even
  // if the user never manually retries or the tab was closed and reopened in between.
  retryPending: function (eventId) {
    return evidenceDbAll_().then(function (all) {
      var mine = eventId ? all.filter(function (r) { return r.eventId === eventId; }) : all;
      var uploaded = 0;
      return mine.reduce(function (chain, record) {
        return chain.then(function () {
          return fileToBase64(record.blob)
            .then(function (base64) { return Api.call('uploadEvidence', { eventId: record.eventId, fileBase64: base64, fileName: record.fileName, mimeType: record.mimeType }); })
            .then(function () { return evidenceDbDelete_(record.localId).catch(function () {}); })
            .then(function () { uploaded++; })
            .catch(function () { /* still offline/failing -- leave it queued, try again next time */ });
        });
      }, Promise.resolve()).then(function () { return uploaded; });
    });
  },

  pendingCount: function (eventId) {
    return evidenceDbAll_().then(function (all) {
      return eventId ? all.filter(function (r) { return r.eventId === eventId; }).length : all.length;
    });
  },

  // Exposes the same GPS fetch prepare() uses internally, so a caller that needs the fix for its own
  // purposes (Log Photos: grouping metadata) can grab it once and hand it back into prepare() via
  // knownPos above, instead of duplicating the geolocation logic.
  getPosition: function (timeoutMs) {
    return evidenceGetPosition_(timeoutMs || 8000);
  },

  /* ---------------- Log Photos local gallery ----------------
   * REQ: "In Saudi Arabia temperature is high in the morning, and inspectors would prefer taking
   * photos of findings first then going to a cool place and adding the logs... every photo taken in
   * this tab gets stored locally with geolocation and user id." These photos are ALREADY fully
   * watermarked (via prepare(), same as any other evidence capture) by the time they're saved here --
   * this store is pure local staging, never uploaded on its own. A photo leaves this store only when
   * "Create Log" hands it to the New Finding page, which uploads it through the normal evidence
   * pipeline (see findings.js/eventDetail.js, uploadEvidenceFile_ with skipPrepare=true so it isn't
   * watermarked a second time) and then deletes the local record.
   */
  saveLogPhoto: function (file, eventId, meta) {
    var localId = 'lp_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    var record = {
      localId: localId, eventId: eventId, userId: (meta && meta.userId) || '',
      fileName: file.name, mimeType: file.type, blob: file,
      lat: (meta && meta.lat != null) ? meta.lat : null, lng: (meta && meta.lng != null) ? meta.lng : null,
      capturedAt: Date.now()
    };
    return evidenceDbPut_(record, LOG_PHOTOS_STORE_).then(function () { return record; });
  },

  // Scoped to eventId and (by default) the current user -- IndexedDB is already device-local, but
  // filtering by userId too guards against a shared/handed-down device where a different inspector
  // was previously logged in and left photos behind. Pass includeAllUsers=true to bypass that (not
  // currently used, kept for flexibility). Trashed photos (deletedAt set -- see below) never show up
  // here; they only appear via listTrashedLogPhotos.
  listLogPhotos: function (eventId, userId, includeAllUsers) {
    return evidenceDbAll_(LOG_PHOTOS_STORE_).then(function (all) {
      return all.filter(function (r) {
        if (r.deletedAt) return false;
        if (eventId && r.eventId !== eventId) return false;
        if (!includeAllUsers && userId && r.userId !== userId) return false;
        return true;
      });
    });
  },

  // Permanent delete -- no trash involved. Used internally by purgeExpiredLogPhotos/emptyLogPhotoTrash
  // below, and by findings.js/renderNewFinding once a photo has actually been handed off to a Finding
  // (at that point it's been carried into the Finding's own evidence pipeline, not "deleted" by the
  // user -- trashing it would be pointless since there's nothing left to restore *to*).
  deleteLogPhoto: function (localId) {
    return evidenceDbDelete_(localId, LOG_PHOTOS_STORE_).catch(function () {});
  },

  /* ---------------- Log Photos trash ----------------
   * REQ: "Photos deleted go to trash and can be restored. Any deleted item stays 30 days in trash
   * then gets permanently deleted. Trash has an empty now button." Soft-delete via a deletedAt
   * timestamp on the same record/store (no separate trash store to keep in sync) -- listLogPhotos
   * above already excludes anything with deletedAt set, restore just clears it back to null.
   */
  trashLogPhoto: function (localId) {
    return evidenceDbGet_(localId, LOG_PHOTOS_STORE_).then(function (record) {
      if (!record) return null;
      record.deletedAt = Date.now();
      return evidenceDbPut_(record, LOG_PHOTOS_STORE_).then(function () { return record; });
    });
  },

  restoreLogPhoto: function (localId) {
    return evidenceDbGet_(localId, LOG_PHOTOS_STORE_).then(function (record) {
      if (!record) return null;
      record.deletedAt = null;
      return evidenceDbPut_(record, LOG_PHOTOS_STORE_).then(function () { return record; });
    });
  },

  listTrashedLogPhotos: function (eventId, userId) {
    return evidenceDbAll_(LOG_PHOTOS_STORE_).then(function (all) {
      return all.filter(function (r) {
        if (!r.deletedAt) return false;
        if (eventId && r.eventId !== eventId) return false;
        if (userId && r.userId !== userId) return false;
        return true;
      });
    });
  },

  // REQ: "Any deleted item stays 30 days in trash then gets permanently deleted." Called once when
  // the Log Photos tab loads (see logPhotos.js) -- same "sweep on load" pattern already used for the
  // pending-evidence retry queue (retryPending, called from tabInspections). Deliberately not scoped
  // to one event/user -- it's a housekeeping sweep over the whole local trash, cheap either way.
  purgeExpiredLogPhotos: function () {
    var cutoff = Date.now() - LOG_PHOTO_TRASH_RETENTION_MS_;
    return evidenceDbAll_(LOG_PHOTOS_STORE_).then(function (all) {
      var expired = all.filter(function (r) { return r.deletedAt && r.deletedAt <= cutoff; });
      return expired.reduce(function (chain, r) {
        return chain.then(function () { return evidenceDbDelete_(r.localId, LOG_PHOTOS_STORE_).catch(function () {}); });
      }, Promise.resolve()).then(function () { return expired.length; });
    });
  },

  // REQ: "Trash has an empty now button." Same as purgeExpiredLogPhotos but ignores the 30-day
  // cutoff -- every currently-trashed photo for this event/user is permanently deleted right away.
  emptyLogPhotoTrash: function (eventId, userId) {
    return EvidenceCapture.listTrashedLogPhotos(eventId, userId).then(function (trashed) {
      return trashed.reduce(function (chain, r) {
        return chain.then(function () { return evidenceDbDelete_(r.localId, LOG_PHOTOS_STORE_).catch(function () {}); });
      }, Promise.resolve()).then(function () { return trashed.length; });
    });
  }
};

window.addEventListener('online', function () {
  if (window.EvidenceCapture) EvidenceCapture.retryPending();
});
