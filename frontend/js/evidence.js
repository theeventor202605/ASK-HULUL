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
 * Public surface: window.EvidenceCapture = { prepare, saveAndUpload, retryPending, pendingCount }
 */

/* ---------------- Local-first durable queue (IndexedDB) ----------------
 * Stores the finished (already watermarked/compressed) File as a Blob, keyed by a locally-generated
 * id, so it survives a page reload even if the upload never completed. Deliberately tolerant of
 * IndexedDB being unavailable (very old browsers, private-mode restrictions in some browsers) --
 * every function below degrades to "skip local durability, still try the network upload" rather than
 * blocking evidence capture outright.
 */
var EVIDENCE_DB_NAME_ = 'hulul-evidence';
var EVIDENCE_DB_VERSION_ = 1;
var EVIDENCE_STORE_ = 'pending';

function evidenceOpenDb_() {
  return new Promise(function (resolve, reject) {
    if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
    var req = indexedDB.open(EVIDENCE_DB_NAME_, EVIDENCE_DB_VERSION_);
    req.onupgradeneeded = function () {
      var db = req.result;
      if (!db.objectStoreNames.contains(EVIDENCE_STORE_)) db.createObjectStore(EVIDENCE_STORE_, { keyPath: 'localId' });
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error || new Error('Could not open local storage')); };
  });
}
function evidenceDbPut_(record) {
  return evidenceOpenDb_().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(EVIDENCE_STORE_, 'readwrite');
      tx.objectStore(EVIDENCE_STORE_).put(record);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  });
}
function evidenceDbDelete_(localId) {
  return evidenceOpenDb_().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(EVIDENCE_STORE_, 'readwrite');
      tx.objectStore(EVIDENCE_STORE_).delete(localId);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  });
}
function evidenceDbAll_() {
  return evidenceOpenDb_().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(EVIDENCE_STORE_, 'readonly');
      var req = tx.objectStore(EVIDENCE_STORE_).getAll();
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function () { reject(req.error); };
    });
  }).catch(function () { return []; });
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
 * pointInPolygonClient_ are defined in venues.js, which loads after this file (see index.html) --
 * safe to reference anyway since both are only ever called from inside prepare()'s async pipeline,
 * long after every script has finished loading (same reasoning as this file's own header comment
 * about fileToBase64/Api/QRCode). A venue with no boundary drawn yet resolves null, same as a
 * missing/denied GPS fix -- either way the badge below simply doesn't apply, never a false positive.
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

          var drawLogo = function (logoImg, alignRight) {
            if (!logoImg || !logoImg.width) return;
            var w = logoImg.width * (logoH / logoImg.height);
            var x = alignRight ? (cw - pad - w) : pad;
            var y = pad;
            ctx.save();
            ctx.fillStyle = 'rgba(255,255,255,0.85)';
            evidenceRoundRect_(ctx, x - pad * 0.4, y - pad * 0.4, w + pad * 0.8, logoH + pad * 0.8, pad * 0.4);
            ctx.fill();
            ctx.drawImage(logoImg, x, y, w, logoH);
            ctx.restore();
          };
          drawLogo(coLogo, false); // top-left: Inspection Company
          drawLogo(gaLogo, true);  // top-right: GA

          // REQ: "Any photos taken outside boundaries should be marked." A full-width red banner
          // just below the logo row -- deliberately loud/unmissable (not a small corner badge) since
          // the whole point is that whoever reviews this finding later can't miss it at a glance.
          if (meta.outsideBoundary) {
            var bannerH = Math.max(20, Math.round(ch * 0.05));
            var bannerY = pad + logoH + pad * 0.6;
            ctx.save();
            ctx.fillStyle = 'rgba(220,38,38,0.92)';
            ctx.fillRect(0, bannerY, cw, bannerH);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold ' + Math.round(bannerH * 0.55) + 'px Tajawal, Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.direction = 'ltr';
            ctx.fillText('⚠ OUTSIDE VENUE BOUNDARY', cw / 2, bannerY + bannerH / 2 + 1);
            ctx.restore();
          }

          // Bottom-left: date/time, GPS, Arabic address.
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
          var boxX = pad, boxY = ch - boxH - pad;

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

          // Bottom-right: QR linking to the exact capture point on Google Maps.
          if (qrImg && qrImg.width) {
            var qrSize = Math.round(ch * 0.16);
            var qx = cw - pad - qrSize, qy = ch - pad - qrSize;
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
          resolve(new File([blob], name, { type: 'image/jpeg' }));
        }, 'image/jpeg', quality);
      });
    };
    img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Could not read captured photo')); };
    img.src = url;
  });
}

/* ---------------- Public API ---------------- */
window.EvidenceCapture = {
  // Full pipeline for one captured file: GPS -> Arabic reverse-geocode -> QR (Google Maps link) ->
  // branding logos -> composite onto a downscaled JPEG. Videos (and anything that isn't an image)
  // pass through untouched -- a watermark overlay doesn't apply to video the same way, and
  // re-encoding video client-side isn't practical.
  prepare: function (file, eventId) {
    if (!file.type || file.type.indexOf('image/') !== 0) return Promise.resolve(file);
    return Promise.all([evidenceGetPosition_(8000), evidenceGetBranding_(eventId), evidenceGetVenueBoundary_(eventId)])
      .then(function (r) {
        var pos = r[0], branding = r[1] || {}, boundary = r[2];
        // REQ: "Any photos taken outside boundaries should be marked." Only a definite "yes, outside"
        // sets this -- no GPS fix, or no boundary drawn for the venue, both leave it false rather than
        // guessing (see evidenceGetVenueBoundary_'s comment).
        var outsideBoundary = !!(pos && boundary && !pointInPolygonClient_(pos.lat, pos.lng, boundary));
        var addressPromise = pos ? evidenceReverseGeocodeArabic_(pos.lat, pos.lng) : Promise.resolve('');
        var mapsUrl = pos ? ('https://www.google.com/maps?q=' + pos.lat + ',' + pos.lng) : '';
        var qrPromise = evidenceQrDataUrl_(mapsUrl, 220);
        return Promise.all([addressPromise, qrPromise]).then(function (r2) {
          return evidenceComposite_(file, {
            lat: pos ? pos.lat : null, lng: pos ? pos.lng : null, address: r2[0],
            gaLogoDataUri: branding.gaLogoDataUri, inspectionCoLogoDataUri: branding.inspectionCoLogoDataUri,
            qrDataUrl: r2[1], outsideBoundary: outsideBoundary
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
  }
};

window.addEventListener('online', function () {
  if (window.EvidenceCapture) EvidenceCapture.retryPending();
});
