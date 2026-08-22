/**
 * HULUL - Log Photos tab
 * REQ: "In Saudi Arabia temperature is high in the morning, and inspectors would prefer taking
 * photos of findings first then going to a cool place and adding the logs. We need to have a tab
 * called Log Photos, every photo taken in this tab gets stored locally with geolocation and user id.
 * Photos taken through the app will follow the global photo video practice of the logos, QR code &
 * Geolocation. In Log Photos; photo are grouped according to their geolocation proximity and date
 * time proximity. 'Select group' checkbox selects the group. User can unselect one or more.
 * 'Create Log' will open the Log Finding page and add selected photos and suggest nearest
 * participant name and all related info."
 *
 * Every photo here goes through the SAME EvidenceCapture.prepare() watermark pipeline (logos/QR/
 * geolocation) as any other evidence in the app, then is saved into a dedicated local-only IndexedDB
 * store (EvidenceCapture.saveLogPhoto, evidence.js) -- nothing is uploaded to the backend from this
 * tab. A photo only leaves local storage when "Create Log" hands the selection off to the New Finding
 * page (findings.js, renderNewFinding's "Log Photos handoff" block), which uploads it through the
 * normal evidence pipeline (uploadEvidenceFile_ with skipPrepare=true, so it isn't watermarked twice).
 *
 * Depends on globals: EvidenceCapture (evidence.js), haversineKm_ (venues.js), UI/ICON/esc/Api/
 * HululState (loaded before this file, see index.html), driveEvidenceThumbUrl_/hasPermission
 * (findings.js/permissions.js -- used by renderLogPhotoTrash_'s "deleted from a Log" subsection, see
 * that function's own header comment) -- all only referenced inside function bodies, so load order
 * relative to venues.js/findings.js doesn't matter (same reasoning already documented on this app's
 * other cross-file references).
 */

// "Same spot, same visit" thresholds for the greedy grouping below. Not specified by the request --
// chosen as reasonable defaults for an inspector walking a venue: GPS is commonly accurate to within
// a few meters outdoors, and venues/places are normally spaced well beyond 50m apart; 15 minutes
// covers one continuous walk-by without merging two separate visits to the same spot hours apart.
var LOG_PHOTO_GROUP_DISTANCE_M_ = 50;
var LOG_PHOTO_GROUP_TIME_MS_ = 15 * 60 * 1000;

var logPhotoObjectUrls_ = [];
function revokeLogPhotoObjectUrls_() {
  logPhotoObjectUrls_.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} });
  logPhotoObjectUrls_ = [];
}

// Greedy grouping: photos sorted by capture time; a photo joins the previous group when it's both
// within LOG_PHOTO_GROUP_TIME_MS_ of that group's most recent photo AND within
// LOG_PHOTO_GROUP_DISTANCE_M_ of the group's anchor (its first photo's coordinates -- kept fixed
// rather than a running centroid so a long, slow walk in one direction doesn't drift the anchor and
// silently pull in a much later, farther-away photo). Missing GPS on either side falls back to time
// proximity alone rather than always forcing a new group.
function groupLogPhotos_(photos) {
  var sorted = photos.slice().sort(function (a, b) { return a.capturedAt - b.capturedAt; });
  var groups = [];
  sorted.forEach(function (p) {
    var g = groups[groups.length - 1];
    var fits = false;
    if (g && (p.capturedAt - g.lastCapturedAt) <= LOG_PHOTO_GROUP_TIME_MS_) {
      var hasCoords = p.lat != null && p.lng != null && g.anchorLat != null && g.anchorLng != null;
      fits = hasCoords ? (haversineKm_(p.lat, p.lng, g.anchorLat, g.anchorLng) * 1000 <= LOG_PHOTO_GROUP_DISTANCE_M_) : true;
    }
    if (fits) { g.photos.push(p); g.lastCapturedAt = p.capturedAt; }
    else groups.push({ photos: [p], anchorLat: p.lat, anchorLng: p.lng, lastCapturedAt: p.capturedAt });
  });
  return groups;
}

function logPhotoAverageLatLng_(photos) {
  var withCoords = photos.filter(function (p) { return p.lat != null && p.lng != null; });
  if (!withCoords.length) return null;
  return {
    lat: withCoords.reduce(function (s, p) { return s + p.lat; }, 0) / withCoords.length,
    lng: withCoords.reduce(function (s, p) { return s + p.lng; }, 0) / withCoords.length
  };
}

// Same nearest-by-haversine pattern already used for the live-inspection "closest participant" label
// (eventDetail.js) and the auto-suggested place name when dropping a pin (venues.js/eventPlaces.js).
function logPhotoNearestParticipant_(latlng, participants) {
  if (!latlng) return null;
  var best = null, bestDist = Infinity;
  (participants || []).forEach(function (pt) {
    if (pt.lat == null || pt.lng == null || pt.lat === '' || pt.lng === '') return;
    var d = haversineKm_(latlng.lat, latlng.lng, Number(pt.lat), Number(pt.lng));
    if (d < bestDist) { bestDist = d; best = pt; }
  });
  return best;
}

async function tabLogPhotos(content, eventId, detail) {
  revokeLogPhotoObjectUrls_();
  // REQ: "Any deleted item stays 30 days in trash then gets permanently deleted." Swept once per tab
  // visit -- same "sweep on load" pattern already used for the pending-evidence retry queue
  // (EvidenceCapture.retryPending, called from tabInspections) -- rather than a timer, since there's
  // no background process available for a purely client-side IndexedDB store.
  try { await EvidenceCapture.purgeExpiredLogPhotos(); } catch (e) { /* non-critical housekeeping */ }

  var participants = [];
  try {
    participants = await Api.call('listParticipants', { eventId: eventId, venueId: detail && detail.venue ? detail.venue.id : '' });
  } catch (e) { /* tab still works without nearest-participant suggestions */ }

  var selected = {}; // localId -> true

  content.innerHTML =
    '<div class="card" style="margin-bottom:16px;"><div class="card-body" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">' +
      '<div class="muted" style="font-size:13px;max-width:520px;">' + esc(t('log_photos_intro')) + '</div>' +
      '<div>' +
        // REQ follow-up: "Users logged in can still upload photos from their local machine!" -- was a
        // hidden file input + capture="environment", which desktop browsers ignore outright (capture
        // is a mobile-only hint). Opens a real live camera view instead (EvidenceCapture.openCameraModal,
        // evidence.js) -- works identically on desktop and mobile, no file-system picker ever appears.
        '<button type="button" class="btn btn-primary btn-icon" id="logPhotoCameraBtn" title="' + esc(t('take_photo_btn')) + '">' + ICON('capture_photo') + ' ' + esc(t('take_photo_btn')) + '</button> ' +
        // REQ: "Throughout the platform Do not allow Log Photos in any section to upload from
        // device, unless permission is set for that specific role." Same evidence.uploadFromDevice
        // bypass as every other capture flow -- see eventDetail.js's Record Results row for the
        // header comment on why this is a second explicit button rather than just dropping
        // capture="environment" from the one input.
        (hasPermission('evidence.uploadFromDevice')
          ? '<input type="file" id="logPhotoUploadFile" accept="image/*" style="display:none;" multiple />' +
            '<button type="button" class="btn btn-secondary btn-icon" id="logPhotoUploadBtn" title="' + esc(t('upload_from_device_btn')) + '">' + ICON('upload') + '</button>'
          : '') +
      '</div>' +
    '</div></div>' +
    '<div id="logPhotoGroups"></div>' +
    '<div id="logPhotoActionBar" style="position:sticky;bottom:12px;display:flex;justify-content:flex-end;margin-top:12px;">' +
      '<button class="btn btn-primary" id="createLogBtn" disabled>' + esc(t('create_log_btn')) + '</button>' +
    '</div>' +
    // REQ: "Photos deleted go to trash and can be restored... Trash has an empty now button." Rendered
    // empty (no card at all) when there's nothing trashed -- see renderLogPhotoTrash_.
    '<div id="logPhotoTrash"></div>';

  document.getElementById('logPhotoCameraBtn').onclick = function () {
    // Photo-only (allowVideo omitted/false) -- Log Photos never accepted video, same as the old input's
    // accept="image/*". The modal stays open across multiple shots, same as the old multiple-file
    // capture input let someone tap the camera button again for a second photo.
    EvidenceCapture.openCameraModal({
      onFile: async function (file) {
        // Sequential-safe -- each capture does its own GPS fix + reverse-geocode; captureLogPhoto_
        // await-ing here (rather than firing several in parallel) avoids hammering Nominatim with
        // concurrent requests (same care evidence.js's own pipeline already takes per-photo).
        await captureLogPhoto_(eventId, file);
        await renderLogPhotoGroups_(eventId, participants, selected);
      }
    });
  };
  var uploadBtn = document.getElementById('logPhotoUploadBtn');
  if (uploadBtn) {
    uploadBtn.onclick = function () { document.getElementById('logPhotoUploadFile').click(); };
    document.getElementById('logPhotoUploadFile').onchange = async function (e) {
      var files = Array.from(e.target.files);
      e.target.value = '';
      for (var i = 0; i < files.length; i++) { await captureLogPhoto_(eventId, files[i]); }
      await renderLogPhotoGroups_(eventId, participants, selected);
    };
  }

  document.getElementById('createLogBtn').onclick = async function () {
    var all = await EvidenceCapture.listLogPhotos(eventId, HululState.user.id);
    var chosen = all.filter(function (p) { return selected[p.localId]; });
    if (!chosen.length) return;
    var anchor = logPhotoAverageLatLng_(chosen);
    var nearest = logPhotoNearestParticipant_(anchor, participants);
    // REQ: "'Create Log' will open the Log Finding page and add selected photos and suggest nearest
    // participant name and all related info." Staged in-memory (hash navigation can't carry Blobs) --
    // renderNewFinding (findings.js) picks this up on load, uploads the photos, and pre-selects the
    // suggested participant (which itself pre-fills Discipline, via that page's own pickParticipant_).
    window.HululLogPhotoStaging = {
      eventId: eventId,
      photos: chosen.map(function (p) { return { localId: p.localId, file: p.blob, lat: p.lat, lng: p.lng }; }),
      suggestedParticipantId: nearest ? nearest.id : ''
    };
    window.location.hash = '#/events/' + eventId + '/findings/new';
  };

  await renderLogPhotoGroups_(eventId, participants, selected);
  await renderLogPhotoTrash_(eventId, participants, selected);
}

async function captureLogPhoto_(eventId, file) {
  try {
    // One GPS fix reused for both the watermark (prepare's knownPos, evidence.js) and this record's
    // own lat/lng (used for grouping + nearest-participant below) -- avoids a second GPS read landing
    // on a slightly different fix than what's stamped on the photo itself.
    var pos = await EvidenceCapture.getPosition(8000);
    var prepared = await EvidenceCapture.prepare(file, eventId, pos);
    await EvidenceCapture.saveLogPhoto(prepared, eventId, {
      userId: HululState.user.id, lat: pos ? pos.lat : null, lng: pos ? pos.lng : null
    });
  } catch (err) { UI.error(err); }
}

function logPhotoTimeRangeLabel_(photos) {
  var times = photos.map(function (p) { return p.capturedAt; }).sort(function (a, b) { return a - b; });
  var p2 = function (n) { return String(n).padStart(2, '0'); };
  var fmt = function (ts) { var d = new Date(ts); return p2(d.getHours()) + ':' + p2(d.getMinutes()); };
  return times.length > 1 ? (fmt(times[0]) + '–' + fmt(times[times.length - 1])) : fmt(times[0]);
}

async function renderLogPhotoGroups_(eventId, participants, selected) {
  revokeLogPhotoObjectUrls_();
  var holder = document.getElementById('logPhotoGroups');
  if (!holder) return; // tab was navigated away from mid-await
  var photos = await EvidenceCapture.listLogPhotos(eventId, HululState.user.id);

  // Selection may reference a localId that no longer exists (e.g. right after a delete) -- drop it
  // so the Create Log count/button stay accurate.
  var stillThere = {};
  photos.forEach(function (p) { stillThere[p.localId] = true; });
  Object.keys(selected).forEach(function (id) { if (!stillThere[id]) delete selected[id]; });

  if (!photos.length) {
    holder.innerHTML = '<div class="empty-state">' + esc(t('empty_no_log_photos')) + '</div>';
    updateCreateLogButton_(selected);
    return;
  }

  var groups = groupLogPhotos_(photos);
  holder.innerHTML = groups.map(function (g, gi) {
    var anchor = logPhotoAverageLatLng_(g.photos);
    var nearest = logPhotoNearestParticipant_(anchor, participants);
    var label = nearest ? (esc(t('near_prefix')) + esc(nearest.name)) : esc(t('location_unknown'));
    return '<div class="card" style="margin-bottom:14px;">' +
      '<div class="card-header" style="display:flex;align-items:center;gap:10px;">' +
        '<input type="checkbox" class="log-group-check" data-group-idx="' + gi + '" title="' + esc(t('select_group_title')) + '" />' +
        '<div class="card-title" style="flex:1;">' + label + ' · ' + g.photos.length + ' ' + esc(g.photos.length > 1 ? t('word_photo_plural') : t('word_photo')) + '</div>' +
        '<div class="muted" style="font-size:11.5px;">' + esc(logPhotoTimeRangeLabel_(g.photos)) + '</div>' +
      '</div>' +
      '<div class="card-body" style="display:flex;flex-wrap:wrap;gap:10px;">' +
        g.photos.map(function (p) {
          var url = URL.createObjectURL(p.blob);
          logPhotoObjectUrls_.push(url);
          return '<div style="position:relative;width:110px;">' +
            '<img src="' + url + '" style="width:110px;height:110px;object-fit:cover;border-radius:var(--radius-sm);border:1px solid var(--border);display:block;" />' +
            '<input type="checkbox" class="log-photo-check" data-local-id="' + esc(p.localId) + '" style="position:absolute;top:6px;left:6px;width:18px;height:18px;" ' + (selected[p.localId] ? 'checked' : '') + ' />' +
            '<button type="button" class="btn btn-secondary btn-sm btn-icon log-photo-remove" data-local-id="' + esc(p.localId) + '" title="' + esc(t('move_to_trash_title')) + '" style="position:absolute;top:4px;right:4px;padding:2px 5px;">' + ICON('delete') + '</button>' +
          '</div>';
        }).join('') +
      '</div>' +
    '</div>';
  }).join('');

  syncGroupCheckboxStates_(groups, selected);
  updateCreateLogButton_(selected);

  holder.querySelectorAll('.log-photo-check').forEach(function (cb) {
    cb.addEventListener('change', function () {
      var id = cb.getAttribute('data-local-id');
      if (cb.checked) selected[id] = true; else delete selected[id];
      syncGroupCheckboxStates_(groups, selected);
      updateCreateLogButton_(selected);
    });
  });
  holder.querySelectorAll('.log-group-check').forEach(function (cb) {
    cb.addEventListener('change', function () {
      var gi = Number(cb.getAttribute('data-group-idx'));
      groups[gi].photos.forEach(function (p) { if (cb.checked) selected[p.localId] = true; else delete selected[p.localId]; });
      renderLogPhotoGroups_(eventId, participants, selected);
    });
  });
  // REQ: "Photos deleted go to trash and can be restored." Soft-delete (trashLogPhoto), not
  // deleteLogPhoto -- the photo moves into the Trash section below rather than disappearing outright.
  holder.querySelectorAll('.log-photo-remove').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      var id = btn.getAttribute('data-local-id');
      await EvidenceCapture.trashLogPhoto(id);
      delete selected[id];
      UI.toast(t('toast_photo_moved_to_trash'), 'success');
      await renderLogPhotoGroups_(eventId, participants, selected);
      await renderLogPhotoTrash_(eventId, participants, selected);
    });
  });
}

// REQ: "Photos deleted go to trash and can be restored. Any deleted item stays 30 days in trash then
// gets permanently deleted. Trash has an empty now button." Rendered as its own compact card below
// the groups, only when there's actually something trashed -- keeps the common case (empty trash)
// out of the way entirely rather than showing a permanently-visible empty section.
//
// REQ follow-up: "In Logs allow inspectors to delete log photos. Deleted log photos go to Log Photos
// Trash." A second, separate source now feeds this same card: photos deleted off an already-submitted
// Log's own evidence gallery (deleteFindingEvidence, Findings.gs) rather than a not-yet-logged capture
// from this tab. That's server-side (FindingEvidenceTrash sheet, restorable from any device) instead
// of the client-only IndexedDB store the "not yet logged" section above already used, so the two are
// fetched and rendered as two clearly-labeled subsections of one card rather than merged into a single
// list -- same "Log Photos Trash" name and 30-day/restore/empty-now contract either way, just two
// underlying stores. The finding-evidence subsection only fetches/renders at all for a user who holds
// finding.deleteEvidence (same permission that let them delete a Log's photo in the first place).
async function renderLogPhotoTrash_(eventId, participants, selected) {
  var holder = document.getElementById('logPhotoTrash');
  if (!holder) return; // tab was navigated away from mid-await
  var trashed = await EvidenceCapture.listTrashedLogPhotos(eventId, HululState.user.id);
  var canSeeEvidenceTrash = hasPermission('finding.deleteEvidence');
  var evidenceTrash = [];
  if (canSeeEvidenceTrash) {
    try { evidenceTrash = await Api.call('listFindingEvidenceTrash', { eventId: eventId }); }
    catch (e) { /* non-critical -- the not-yet-logged section below still works without it */ }
  }
  if (!trashed.length && !evidenceTrash.length) { holder.innerHTML = ''; return; }

  var dayMs = 24 * 60 * 60 * 1000;
  var totalCount = trashed.length + evidenceTrash.length;
  holder.innerHTML =
    '<div class="card" style="margin-top:4px;">' +
      '<div class="card-header" style="display:flex;align-items:center;gap:10px;">' +
        '<div class="card-title" style="flex:1;">' + esc(t('trash_label')) + ' · ' + totalCount + ' ' + esc(totalCount > 1 ? t('word_photo_plural') : t('word_photo')) + '</div>' +
        '<button type="button" class="btn btn-secondary btn-sm" id="emptyLogPhotoTrashBtn">' + esc(t('empty_now_btn')) + '</button>' +
      '</div>' +
      '<div class="card-body">' +
        '<div class="muted" style="font-size:11.5px;margin-bottom:10px;">' + esc(t('trash_retention_hint')) + '</div>' +
        (trashed.length
          ? (evidenceTrash.length ? '<div class="field-label" style="margin-bottom:6px;">' + esc(t('trash_section_not_yet_logged')) + '</div>' : '') +
            '<div style="display:flex;flex-wrap:wrap;gap:14px;' + (evidenceTrash.length ? 'margin-bottom:16px;' : '') + '">' +
              trashed.map(function (p) {
                var url = URL.createObjectURL(p.blob);
                logPhotoObjectUrls_.push(url);
                var daysLeft = Math.max(0, Math.ceil((LOG_PHOTO_TRASH_RETENTION_MS_ - (Date.now() - p.deletedAt)) / dayMs));
                return '<div style="width:100px;">' +
                  '<div style="position:relative;width:100px;height:100px;">' +
                    '<img src="' + url + '" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm);border:1px solid var(--border);display:block;opacity:.6;" />' +
                  '</div>' +
                  '<div class="muted" style="font-size:10.5px;text-align:center;margin-top:4px;">' + esc(t(daysLeft === 1 ? 'word_day_left' : 'word_days_left', { n: daysLeft })) + '</div>' +
                  '<button type="button" class="btn btn-secondary btn-sm log-photo-restore" data-local-id="' + esc(p.localId) + '" style="width:100%;margin-top:4px;font-size:11px;padding:4px 0;">' + esc(t('restore_btn')) + '</button>' +
                '</div>';
              }).join('') +
            '</div>'
          : '') +
        (evidenceTrash.length
          ? (trashed.length ? '<div class="field-label" style="margin-bottom:6px;">' + esc(t('trash_section_deleted_from_logs')) + '</div>' : '') +
            '<div style="display:flex;flex-wrap:wrap;gap:14px;">' +
              evidenceTrash.map(function (r) {
                var thumb = driveEvidenceThumbUrl_(r.url) || r.url;
                var daysLeft = Math.max(0, Math.ceil((FINDING_EVIDENCE_TRASH_RETENTION_MS_ - (Date.now() - new Date(r.deletedAt).getTime())) / dayMs));
                return '<div style="width:100px;">' +
                  '<div style="position:relative;width:100px;height:100px;">' +
                    '<img src="' + esc(thumb) + '" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm);border:1px solid var(--border);display:block;opacity:.6;" />' +
                  '</div>' +
                  '<div class="muted" style="font-size:10.5px;text-align:center;margin-top:4px;">' + esc(t(daysLeft === 1 ? 'word_day_left' : 'word_days_left', { n: daysLeft })) + '</div>' +
                  '<button type="button" class="btn btn-secondary btn-sm evidence-trash-restore" data-trash-id="' + esc(r.id) + '" style="width:100%;margin-top:4px;font-size:11px;padding:4px 0;">' + esc(t('restore_btn')) + '</button>' +
                '</div>';
              }).join('') +
            '</div>'
          : '') +
      '</div>' +
    '</div>';

  document.getElementById('emptyLogPhotoTrashBtn').onclick = function () {
    UI.confirmModal(
      t('confirm_empty_trash', { count: totalCount, unit: totalCount > 1 ? t('word_photo_plural') : t('word_photo') }),
      async function () {
        await EvidenceCapture.emptyLogPhotoTrash(eventId, HululState.user.id);
        if (canSeeEvidenceTrash && evidenceTrash.length) {
          try { await Api.call('emptyFindingEvidenceTrash', { eventId: eventId }); } catch (e) { UI.error(e); }
        }
        UI.toast(t('toast_trash_emptied'), 'success');
        await renderLogPhotoTrash_(eventId, participants, selected);
      },
      { title: t('empty_trash_title'), confirmLabel: t('empty_now_btn'), confirmClass: 'btn-danger' }
    );
  };
  holder.querySelectorAll('.log-photo-restore').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      var id = btn.getAttribute('data-local-id');
      await EvidenceCapture.restoreLogPhoto(id);
      UI.toast(t('toast_photo_restored'), 'success');
      await renderLogPhotoGroups_(eventId, participants, selected);
      await renderLogPhotoTrash_(eventId, participants, selected);
    });
  });
  holder.querySelectorAll('.evidence-trash-restore').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      try {
        await Api.call('restoreFindingEvidence', { trashId: btn.getAttribute('data-trash-id') });
        UI.toast(t('toast_photo_restored'), 'success');
        await renderLogPhotoTrash_(eventId, participants, selected);
      } catch (err) { UI.error(err); }
    });
  });
}
// Mirrors FINDING_EVIDENCE_TRASH_RETENTION_DAYS_ (Findings.gs) for the "days left" countdown above --
// kept as its own frontend constant (not fetched from the backend) since it's purely a display value,
// same "duplicate the constant, don't add a round-trip just to read one number" call the client-side
// LOG_PHOTO_TRASH_RETENTION_MS_ already makes for its own 30-day figure.
var FINDING_EVIDENCE_TRASH_RETENTION_MS_ = 30 * 24 * 60 * 60 * 1000;

function syncGroupCheckboxStates_(groups, selected) {
  groups.forEach(function (g, gi) {
    var groupCb = document.querySelector('.log-group-check[data-group-idx="' + gi + '"]');
    if (!groupCb) return;
    var selectedCount = g.photos.filter(function (p) { return selected[p.localId]; }).length;
    groupCb.checked = selectedCount === g.photos.length;
    groupCb.indeterminate = selectedCount > 0 && selectedCount < g.photos.length;
  });
}

function updateCreateLogButton_(selected) {
  var btn = document.getElementById('createLogBtn');
  if (!btn) return;
  var count = Object.keys(selected).length;
  btn.disabled = count === 0;
  btn.textContent = count ? t('create_log_with_count', { count: count }) : t('create_log_btn');
}
