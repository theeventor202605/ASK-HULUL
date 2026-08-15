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

// size (optional, default 400): Drive's thumbnail endpoint will scale to whatever width you ask for --
// the small evidence grid asks for 400 (plenty for a ~120-168px CSS box on any real display), the
// lightbox below asks for something much bigger since it fills most of the viewport.
function driveEvidenceThumbUrl_(url, size) {
  var m = String(url || '').match(/\/d\/([a-zA-Z0-9_-]+)/) || String(url || '').match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m ? 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w' + (size || 400) : '';
}

// size (optional, default 120): REQ (Finding detail redesign) "The photos are very small" -- the main
// Finding evidence gallery below passes a bigger size (168); Resolution history entries keep the
// default, still noticeably larger than the original fixed 96px everywhere.
//
// REQ (follow-up): "Expand Photos to the max when clicked." Each thumbnail carries the URL of a much
// larger rendition via data-lightbox-url; a single delegated click listener (below, registered once
// at module load -- same pattern as ui.js's app-wide button click-guard) intercepts the click and
// opens openEvidenceLightbox_ instead of letting the <a> navigate. Left as a real <a href target=_blank>
// underneath so ctrl/cmd/middle-click still opens the original in a new tab the normal way (those
// don't run through our click handler's preventDefault).
function evidenceThumbsHtml_(urls, size) {
  size = size || 120;
  if (!urls || !urls.length) return '<div class="muted" style="font-size:12px;">' + esc(t('no_evidence_attached')) + '</div>';
  return '<div style="display:flex;flex-wrap:wrap;gap:12px;">' + urls.map(function (u, i) {
    var thumb = driveEvidenceThumbUrl_(u);
    var full = driveEvidenceThumbUrl_(u, 1600) || u;
    return '<a href="' + esc(u) + '" target="_blank" rel="noopener" title="' + esc(t('click_to_expand')) + '" ' +
      'class="evidence-thumb" data-lightbox-url="' + esc(full) + '" style="width:' + size + 'px;height:' + size + 'px;">' +
      (thumb
        ? '<img src="' + esc(thumb) + '" alt="Evidence ' + (i + 1) + '" ' +
          'onerror="this.replaceWith(Object.assign(document.createElement(\'span\'),{textContent:\'' + ICON('capture_photo') + '\',style:\'font-size:28px;\'}));" />'
        : '<span style="font-size:28px;">' + ICON('capture_photo') + '</span>') +
    '</a>';
  }).join('') + '</div>';
}

// Fills as much of the viewport as sensibly possible (92vw/88vh, object-fit:contain) rather than
// reusing UI.openModal's modal-box -- that's capped at 520px with header/footer chrome, which is
// exactly the "not very big" look this REQ is trying to get away from.
function openEvidenceLightbox_(fullImgUrl, originalUrl) {
  var overlay = document.createElement('div');
  overlay.className = 'evidence-lightbox-overlay';
  overlay.innerHTML =
    '<button type="button" class="evidence-lightbox-close" aria-label="' + esc(t('close')) + '" title="' + esc(t('close')) + '">' + ICON('close_modal') + '</button>' +
    '<img src="' + esc(fullImgUrl) + '" alt="Evidence" />' +
    '<a href="' + esc(originalUrl) + '" target="_blank" rel="noopener" class="evidence-lightbox-open">' + ICON('view_open') + ' ' + esc(t('open_original')) + '</a>';
  document.body.appendChild(overlay);
  function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
  overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); }); // background only -- not the image/buttons
  overlay.querySelector('.evidence-lightbox-close').onclick = close;
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
}
document.addEventListener('click', function (e) {
  var el = e.target.closest ? e.target.closest('.evidence-thumb[data-lightbox-url]') : null;
  if (!el) return;
  e.preventDefault();
  openEvidenceLightbox_(el.getAttribute('data-lightbox-url'), el.getAttribute('href'));
});

// REQ (Finding detail redesign): "Risk level and status are barely noticeable." Maps each risk level
// to a color + soft background used by the hero strip at the top of the Finding card below -- same
// severity colors UI.riskBadge already uses elsewhere, just surfaced here too since the strip needs
// the raw color (not just a badge class) for its background/dot.
function findingRiskMeta_(risk) {
  // NOTE: the `risk` param itself stays the raw English enum value (Low/Medium/High/Critical) --
  // it round-trips into <select> values and API payloads elsewhere (see the New/Edit Finding
  // forms below), so only the displayed `label` is translated here.
  var map = {
    Critical: { label: t('risk_critical'), color: 'var(--critical)', soft: 'var(--critical-soft)' },
    High: { label: t('risk_high'), color: 'var(--danger)', soft: 'var(--danger-soft)' },
    Medium: { label: t('risk_medium'), color: 'var(--warning)', soft: 'var(--warning-soft)' },
    Low: { label: t('risk_low'), color: 'var(--success)', soft: 'var(--success-soft)' }
  };
  return map[risk] || { label: risk || '—', color: 'var(--text-600)', soft: '#f1f3f9' };
}

// REQ: "Create a Log photos timeline for every photo under an event with details like Baskin
// Robbins High Risk Open, in modern design. This also applies to participants level and project
// level." One shared renderer for both call sites -- eventDetail.js's own Photo Timeline subtab
// (tabFindingPhotos, under the Findings group) and projects.js's Project detail page (rolled up
// across every linked event) -- so the actual timeline markup/behavior/filtering lives in exactly
// one place instead of being copy-pasted per level. "Participant level" is a filter within this same
// timeline (pick one participant from the dropdown) rather than a separate page, per how this was
// scoped -- there's no standalone participant detail page in the app to hang a dedicated view off of.
//
// `findings` should already be enriched the way listFindings returns them (participantName resolved,
// evidenceUrls as a real array, newest-first) -- this function only groups/filters/renders, it never
// fetches. Findings with no evidence photos are dropped entirely (nothing to show in a PHOTO
// timeline) rather than appearing as an empty card.
//
// opts: { usersById (createdBy -> user row, for the "Logged by" credit line -- omitted/blank credit
// if not supplied, e.g. a caller without user.list permission), emptyText (empty-state override) }
function renderFindingPhotoTimeline_(container, findings, opts) {
  opts = opts || {};
  var usersById = opts.usersById || {};
  var withPhotos = (findings || []).filter(function (f) { return f.evidenceUrls && f.evidenceUrls.length; });

  if (!withPhotos.length) {
    container.innerHTML = '<div class="empty-state">' + esc(opts.emptyText || t('empty_no_finding_photos')) + '</div>';
    return;
  }

  var participantNames = Array.from(new Set(withPhotos.map(function (f) { return f.participantName; }).filter(Boolean))).sort();
  var riskLevels = Array.from(new Set(withPhotos.map(function (f) { return f.riskLevel; }).filter(Boolean)));
  var statuses = Array.from(new Set(withPhotos.map(function (f) { return f.status; }).filter(Boolean)));
  var state = { participant: '', risk: '', status: '' };

  function optionsHtml_(values, allLabel, renderLabel) {
    return '<option value="">' + esc(allLabel) + '</option>' +
      values.map(function (v) { return '<option value="' + esc(v) + '">' + esc(renderLabel ? renderLabel(v) : v) + '</option>'; }).join('');
  }

  container.innerHTML =
    '<div class="photo-timeline-filters">' +
      '<select class="field-input" id="ptFilterParticipant">' + optionsHtml_(participantNames, t('photo_timeline_all_participants')) + '</select>' +
      '<select class="field-input" id="ptFilterRisk">' + optionsHtml_(riskLevels, t('photo_timeline_all_risk'), function (v) { return findingRiskMeta_(v).label; }) + '</select>' +
      '<select class="field-input" id="ptFilterStatus">' + optionsHtml_(statuses, t('photo_timeline_all_status')) + '</select>' +
    '</div>' +
    '<div id="photoTimelineBody"></div>';

  ['ptFilterParticipant', 'ptFilterRisk', 'ptFilterStatus'].forEach(function (id) {
    container.querySelector('#' + id).onchange = function (e) {
      state.participant = container.querySelector('#ptFilterParticipant').value;
      state.risk = container.querySelector('#ptFilterRisk').value;
      state.status = container.querySelector('#ptFilterStatus').value;
      renderPhotoTimelineBody_();
    };
  });

  function dayKey_(iso) { var d = new Date(iso); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }
  function dayLabel_(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString(undefined, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  }
  function timeLabel_(iso) {
    return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  function renderPhotoTimelineBody_() {
    var bodyEl = container.querySelector('#photoTimelineBody');
    var visible = withPhotos.filter(function (f) {
      return (!state.participant || f.participantName === state.participant) &&
        (!state.risk || f.riskLevel === state.risk) &&
        (!state.status || f.status === state.status);
    });
    if (!visible.length) { bodyEl.innerHTML = '<div class="empty-state">' + esc(t('no_matches')) + '</div>'; return; }

    // withPhotos is already newest-first (listFindings' own sort) -- grouping preserves that order,
    // so days AND findings within a day both come out newest-first with no extra sort needed here.
    var groups = [], byKey = {};
    visible.forEach(function (f) {
      var k = dayKey_(f.createdAt);
      if (!byKey[k]) { byKey[k] = { label: dayLabel_(f.createdAt), items: [] }; groups.push(byKey[k]); }
      byKey[k].items.push(f);
    });

    bodyEl.innerHTML = '<div class="photo-timeline">' + groups.map(function (g) {
      return '<div class="photo-timeline-day-label">' + esc(g.label) + '</div>' +
        g.items.map(function (f) {
          var rm = findingRiskMeta_(f.riskLevel);
          var creator = usersById[f.createdBy];
          return '<div class="photo-timeline-item">' +
            '<span class="photo-timeline-dot" style="background:' + rm.color + ';"></span>' +
            '<div class="photo-timeline-card" style="border-inline-start-color:' + rm.color + ';">' +
              '<div class="photo-timeline-meta">' +
                '<span class="photo-timeline-time">' + esc(timeLabel_(f.createdAt)) + '</span>' +
                '<strong>' + esc(f.participantName || '—') + '</strong>' +
                UI.riskBadge(f.riskLevel) + UI.statusBadge(f.status) +
              '</div>' +
              (f.description ? '<div class="photo-timeline-desc">' + esc(f.description) + '</div>' : '') +
              '<div style="margin-top:10px;">' + evidenceThumbsHtml_(f.evidenceUrls, 140) + '</div>' +
              (creator ? '<div class="photo-timeline-credit">' + ICON('capture_photo') + ' ' + esc(t('photo_timeline_logged_by', { name: creator.name })) + '</div>' : '') +
            '</div>' +
          '</div>';
        }).join('');
    }).join('') + '</div>';
  }

  renderPhotoTimelineBody_();
}

function findingHeroStripHtml_(finding) {
  var rm = findingRiskMeta_(finding.riskLevel);
  return '<div class="finding-hero-strip" style="background:' + rm.soft + ';border-bottom:1px solid var(--border);' +
    'padding:16px 20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">' +
    '<div style="display:flex;align-items:center;gap:10px;">' +
      '<span style="width:12px;height:12px;border-radius:50%;background:' + rm.color + ';box-shadow:0 0 0 4px rgba(15,23,42,.06);flex:none;"></span>' +
      '<span style="font-size:13px;font-weight:800;letter-spacing:.03em;color:' + rm.color + ';">' + esc(t('risk_label_suffix', { label: rm.label.toUpperCase() })) + '</span>' +
    '</div>' +
    UI.statusBadge(finding.status) +
  '</div>';
}

// One compact "icon + label + value" card per meta field -- flex-wraps to fill the row instead of
// leaving the sparse, unevenly-spaced two-column grid the old layout used (part of the "messy and
// shattered" feedback). Purely decorative icons (not wired through ICON(), same as this file's other
// unwired decorative emoji) since these aren't actionable/overridable controls.
function findingMetaChipHtml_(icon, label, valueHtml) {
  return '<div style="display:flex;align-items:center;gap:10px;background:var(--surface);border:1px solid var(--border);' +
    'border-radius:var(--radius-md);padding:10px 14px;flex:1 1 160px;min-width:150px;">' +
    '<div style="font-size:18px;line-height:1;">' + icon + '</div>' +
    '<div style="min-width:0;">' +
      '<div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:var(--text-400);">' + esc(label) + '</div>' +
      '<div style="font-size:13.5px;font-weight:600;color:var(--text-900);margin-top:2px;overflow-wrap:break-word;">' + valueHtml + '</div>' +
    '</div>' +
  '</div>';
}

// One self-contained label+value block -- deliberately NOT built from a shared .form-row (that put
// every label in one grid track and every value in another once more than 2 fields shared a row,
// disconnecting labels from their values). Used for the standalone fields below (Suggested action,
// Review resolution's Remarks); the multi-field meta row uses findingMetaChipHtml_ instead (see its
// own comment above) rather than this in a grid, which is what the "messy and shattered" feedback
// was largely about.
function detailField_(label, valueHtml) {
  return '<div><div class="field-label" style="margin-top:0;">' + esc(label) + '</div>' +
    '<div style="font-size:13.5px;line-height:1.4;margin-top:4px;">' + valueHtml + '</div></div>';
}

/* ---------------- New Finding page (route: #/events/:id/findings/new) ---------------- */
// REQ: "Log finding must be tied to a participant. Participant must first be selected from
// searchable dropdown or live location side map (to be added). Discipline: should pick up as a
// suggestion, and is a mandatory field. Checklist Type: should be picked if left blank it will
// reflect as Other. Risk level: default to Medium. Resolution window (hours): default to 24.
// Remove location and sub-zone. Inspector must be able to take photos or one video."
// Follow-up REQ: "Move Checklist Type to be after Discipline. Add map to the left with max zoom as
// default, showing Inspector live location centred. When an inspector moves the map moves but his
// location remains centred."
//
// Location/sub-zone inputs are removed entirely -- createFinding (Findings.gs) now derives both
// from the selected Participant's own record instead. The map on the left is this device's OWN live
// GPS position (findingLocationMap* below, mirroring eventDetail.js's liveInspectionMap "my
// position" pattern) -- not a participant picker; the searchable dropdown participant selection
// requested earlier is still the only way to choose one (a map-based picker was explicitly deferred
// as "to be added" and is a separate, still-unbuilt enhancement).
async function renderNewFinding(params) {
  var eventId = params.id;
  var root = document.getElementById('viewRoot');
  var disciplines = [], checklistItems = [], participants = [];
  try {
    // getEvent first, on its own -- listParticipants needs the event's venueId to scope the picker
    // to participants actually registered at this event's venue (same { venueId, eventId } pairing
    // eventPlaces.js's own Places tab uses); without venueId it would also pull in every OTHER
    // venue's permanent participants.
    var detail = await Api.call('getEvent', { eventId: eventId });
    var results = await Promise.all([
      Api.call('listDisciplines', {}), Api.call('listChecklistItems', {}),
      Api.call('listParticipants', { eventId: eventId, venueId: detail.venue ? detail.venue.id : '' })
    ]);
    disciplines = results[0]; checklistItems = results[1]; participants = results[2];
  } catch (e) { /* fall back to whichever loaded -- the pickers below just end up with fewer options */ }
  var disciplinesById = {}; disciplines.forEach(function (d) { disciplinesById[d.id] = d; });

  root.innerHTML =
    '<div class="breadcrumb"><a href="#/events/' + eventId + '?tab=findings">' + esc(t('tab_findings')) + '</a></div>' +
    '<div class="page-header"><div><div class="page-title">' + esc(t('finding_log_title', { term: Term('finding') })) + '</div>' +
    '<div class="page-subtitle">' + esc(t('finding_log_subtitle', { term: Term('event').toLowerCase() })) + '</div></div>' +
    '<button class="btn btn-secondary" id="backFindingBtn">' + ICON('back') + ' ' + esc(t('back')) + '</button></div>' +
    // REQ (follow-up): "move map to the right, and enlarge the canvas to cover empty space." No
    // align-items:flex-start here (default stretch instead) so both cards match the taller column's
    // height -- the map card/body/canvas below are all flex:1 column so the map itself grows to fill
    // whatever that height ends up being, instead of sitting at a fixed 380px with empty space
    // under it.
    '<div style="display:flex;gap:20px;flex-wrap:wrap;">' +
      '<div class="card" style="flex:2 1 400px;max-width:640px;"><div class="card-body" style="display:flex;flex-direction:column;gap:4px;">' +
        '<div class="field-group" style="position:relative;">' +
          '<label class="field-label" style="margin-top:0;">' + esc(Term('participant')) + '</label>' +
          '<input id="fParticipantSearch" class="field-input" placeholder="' + esc(t('participant_search_placeholder', { term: Term('participant').toLowerCase() })) + '" autocomplete="off" />' +
          '<div id="participantSuggestBox" class="chat-suggest-box" style="display:none;"></div>' +
          '<div class="muted" style="font-size:11px;margin-top:4px;">🗺️ ' + esc(t('live_location_map_soon')) + '</div>' +
        '</div>' +
        UI.field(Term('discipline'), '<select id="fDiscipline" class="field-input"><option value="">—</option>' +
          disciplines.map(function (d) { return '<option value="' + esc(d.id) + '">' + esc(d.name) + '</option>'; }).join('') + '</select>') +
        // REQ (follow-up): "Move Checklist Type to be after Discipline."
        UI.field(t('checklist_type'), '<select id="fChecklistType" class="field-input"><option value="">' + esc(t('checklist_type_default_hint')) + '</option></select>') +
        UI.field(t('description'), '<textarea id="fDesc" class="field-input" rows="3"></textarea>') +
        UI.field(t('suggested_action'), '<input id="fAction" class="field-input" />') +
        '<div class="form-row">' +
          UI.field(t('risk_level'), '<select id="fRisk" class="field-input"><option>Low</option><option selected>Medium</option><option>High</option><option>Critical</option></select>') +
          UI.field(t('resolution_window_hours'), '<input id="fWindow" type="number" class="field-input" value="24" />') +
        '</div>' +
        '<div class="field-label" style="margin-top:8px;">' + esc(t('evidence_photo_video')) + '</div>' +
        // Same camera-only pattern (hidden file input + capture="environment") as the Resolve
        // section further down this file -- opens the device camera directly, no gallery/file picker.
        '<input type="file" id="fFindingFile" accept="image/*,video/*" capture="environment" style="display:none;" />' +
        '<button type="button" class="btn btn-secondary btn-icon" id="fFindingCameraBtn" title="' + esc(t('take_photo_video')) + '" aria-label="' + esc(t('take_photo_video')) + '">' + ICON('capture_photo') + '</button>' +
        '<div class="evidence-list" data-evlist="newFinding" style="margin-top:6px;"></div>' +
        '<button class="btn btn-primary" id="createFindingBtn" style="margin-top:10px;align-self:flex-start;">' + esc(t('finding_log_title', { term: Term('finding') })) + '</button>' +
      '</div></div>' +
      // REQ: "Add map... showing Inspector live location centred." This device's own GPS position
      // -- see initFindingLocationMap_ below. No max-width here (unlike the form card, capped at
      // 640px so its text fields don't stretch absurdly wide) -- REQ (follow-up): "expand map to
      // fill outlined empty space" -- once the form card hits its own cap, flexbox redistributes
      // all remaining row width to this card since it's the only sibling left that can still grow.
      '<div class="card" style="flex:1 1 320px;display:flex;flex-direction:column;">' +
        '<div class="card-header"><div class="card-title">' + esc(t('your_location')) + '</div></div>' +
        '<div class="card-body" style="display:flex;flex-direction:column;flex:1;">' +
          '<div id="findingLocationMap" style="flex:1;min-height:380px;border-radius:var(--radius-sm);border:1px solid var(--border);"></div>' +
          '<div id="findingLocationBanner" class="muted" style="font-size:11.5px;margin-top:8px;"></div>' +
        '</div>' +
      '</div>' +
    '</div>';

  document.getElementById('backFindingBtn').onclick = function () { destroyFindingLocationMap_(); window.location.hash = '#/events/' + eventId + '?tab=findings'; };
  initFindingLocationMap_(detail && detail.venue, detail && detail.zones, participants);

  /* ---- Participant: searchable dropdown (mandatory) ---- */
  var selectedParticipant = null;
  var pSearch = document.getElementById('fParticipantSearch');
  var pSuggest = document.getElementById('participantSuggestBox');
  var pMatches = [];
  function renderParticipantSuggest_(query) {
    var q = (query || '').toLowerCase();
    pMatches = participants.filter(function (pt) { return !q || pt.name.toLowerCase().indexOf(q) !== -1; });
    pSuggest.innerHTML = '<div class="chat-suggest-header">' + esc(Term('participant_plural')) + '</div>' +
      (pMatches.length
        ? pMatches.slice(0, 20).map(function (pt, i) {
            return '<div class="chat-suggest-item" data-idx="' + i + '">' + esc(pt.name) +
              '<span class="muted" style="font-size:11px;"> · ' + esc(pt.type) + '</span></div>';
          }).join('')
        : '<div class="chat-suggest-empty">' + esc(t('no_matches_suggest')) + '</div>');
    pSuggest.style.display = '';
    pSuggest.querySelectorAll('.chat-suggest-item').forEach(function (el) {
      // mousedown+preventDefault (not click) fires before the input's own blur-hide below, same
      // pattern as the Chat compose suggest box (tabEventChat).
      el.addEventListener('mousedown', function (e) {
        e.preventDefault();
        pickParticipant_(pMatches[Number(el.getAttribute('data-idx'))]);
      });
    });
  }
  function pickParticipant_(pt) {
    selectedParticipant = pt;
    pSearch.value = pt.name;
    pSuggest.style.display = 'none';
    // REQ: "Discipline: should pick up as a suggestion" -- pre-fills from the participant's own
    // registered discipline (Participants.disciplineIds) but the dropdown stays fully editable; this
    // is a starting suggestion, not a lock.
    var firstDisciplineId = (pt.disciplineIds || '').split(',').filter(Boolean)[0];
    if (firstDisciplineId && disciplinesById[firstDisciplineId]) {
      document.getElementById('fDiscipline').value = firstDisciplineId;
      renderChecklistTypeOptions_();
    }
  }
  pSearch.addEventListener('focus', function () { renderParticipantSuggest_(pSearch.value); });
  pSearch.addEventListener('input', function () {
    if (selectedParticipant && pSearch.value !== selectedParticipant.name) selectedParticipant = null; // edited past a selection -- must re-pick
    renderParticipantSuggest_(pSearch.value);
  });
  pSearch.addEventListener('keydown', function (e) { if (e.key === 'Escape') pSuggest.style.display = 'none'; });
  pSearch.addEventListener('blur', function () { setTimeout(function () { pSuggest.style.display = 'none'; }, 150); });

  /* ---- Checklist Type: options filtered to the selected Discipline ----
   * ChecklistItems.category stores the discipline NAME (see checklistItems.js header comment),
   * checklistType is the actual type (Restaurants, Food Truck, …). Blank selection = "Other",
   * enforced server-side (createFinding defaults category to 'Other' when not supplied). */
  function renderChecklistTypeOptions_() {
    var typeSelect = document.getElementById('fChecklistType');
    var prev = typeSelect.value;
    var disciplineId = document.getElementById('fDiscipline').value;
    var disciplineName = disciplineId && disciplinesById[disciplineId] ? disciplinesById[disciplineId].name : '';
    var relevant = disciplineName ? checklistItems.filter(function (i) { return i.category === disciplineName; }) : checklistItems;
    var types = Array.from(new Set(relevant.map(function (i) { return i.checklistType; }).filter(Boolean))).sort();
    typeSelect.innerHTML = '<option value="">— (defaults to Other)</option>' +
      types.map(function (ty) { return '<option value="' + esc(ty) + '">' + esc(ty) + '</option>'; }).join('');
    if (types.indexOf(prev) !== -1) typeSelect.value = prev;
  }
  document.getElementById('fDiscipline').addEventListener('change', renderChecklistTypeOptions_);
  renderChecklistTypeOptions_();

  /* ---- Evidence: photo or video, camera capture only ---- */
  var pendingFiles = { newFinding: [] };
  document.getElementById('fFindingCameraBtn').onclick = function () { document.getElementById('fFindingFile').click(); };
  document.getElementById('fFindingFile').onchange = function (e) {
    Array.from(e.target.files).forEach(function (file) { uploadEvidenceFile_(eventId, 'newFinding', file, pendingFiles); });
    e.target.value = '';
  };

  /* ---- Log Photos handoff ----
   * REQ (Log Photos tab): "'Create Log' will open the Log Finding page and add selected photos and
   * suggest nearest participant name and all related info." logPhotos.js stages the picked photos +
   * a suggested participant id on window.HululLogPhotoStaging just before navigating here. The photos
   * are already fully watermarked (captured through the same EvidenceCapture.prepare() pipeline as
   * any other evidence, see logPhotos.js) -- uploadEvidenceFile_'s skipPrepare=true (5th arg) avoids
   * stamping them a second time. Cleared immediately so a later, unstaged visit to this page never
   * accidentally reuses stale data.
   */
  var staged = (window.HululLogPhotoStaging && window.HululLogPhotoStaging.eventId === eventId) ? window.HululLogPhotoStaging : null;
  window.HululLogPhotoStaging = null;
  if (staged) {
    staged.photos.forEach(function (p) {
      uploadEvidenceFile_(eventId, 'newFinding', p.file, pendingFiles, true);
      if (p.localId && window.EvidenceCapture) EvidenceCapture.deleteLogPhoto(p.localId);
    });
    if (staged.suggestedParticipantId) {
      var suggested = participants.filter(function (pt) { return pt.id === staged.suggestedParticipantId; })[0];
      if (suggested) pickParticipant_(suggested);
    }
  }

  // REQ: "Log findings while photo is uploading in the background." No longer blocks/errors on
  // still-uploading evidence -- the finding is created immediately with whatever's already done;
  // anything still preparing/uploading is watched (attachFindingEvidenceInBackground_ below) and
  // appended (addFindingEvidence, Findings.gs) the moment each one finishes.
  document.getElementById('createFindingBtn').onclick = async function () {
    if (!selectedParticipant) { UI.toast(t('toast_participant_required', { term: Term('participant') }), 'error'); return; }
    var disciplineId = document.getElementById('fDiscipline').value;
    if (!disciplineId) { UI.toast(t('toast_discipline_required', { term: Term('discipline') }), 'error'); return; }
    var files = pendingFiles.newFinding || [];
    var doneUrls = files.filter(function (f) { return f.status === 'done'; }).map(function (f) { return f.url; });
    var stillUploading = files.some(function (f) { return f.status === 'uploading' || f.status === 'preparing'; });
    try {
      var f = await Api.call('createFinding', {
        eventId: eventId, participantId: selectedParticipant.id, disciplineId: disciplineId,
        description: document.getElementById('fDesc').value, suggestedAction: document.getElementById('fAction').value,
        category: document.getElementById('fChecklistType').value,
        riskLevel: document.getElementById('fRisk').value, resolutionWindowHours: Number(document.getElementById('fWindow').value),
        evidenceUrls: doneUrls
      });
      if (stillUploading) {
        UI.toast(t('toast_x_logged_uploading', { term: Term('finding') }), 'success');
        attachFindingEvidenceInBackground_(f.id, files, doneUrls);
      } else {
        UI.toast(t('toast_x_logged', { term: Term('finding') }), 'success');
      }
      destroyFindingLocationMap_();
      window.location.hash = '#/events/' + eventId + '/findings/' + f.id;
    } catch (err) { UI.error(err); }
  };
}

/* ---------------- Edit Finding page (route: #/events/:id/findings/:findingId/edit) ----------------
 * REQ (Risk Logging list, follow-up): "Actions (Allow edit and delete if not submitted)." Reuses the
 * same participant/discipline/checklist-type field set as the New Finding form above, pre-filled from
 * the existing finding, saving via updateFinding (Findings.gs) instead of createFinding. Deliberately
 * NOT reusing the live-location map or evidence capture from renderNewFinding -- neither
 * resolutionWindowAt nor evidenceUrls are in updateFinding's patchable field list (by design, see its
 * own comment in Findings.gs), so there's nothing for those to do here; Resolution window and
 * evidence stay read-only, still viewable on the finding's own detail page.
 *
 * viewFinding (used below to load the finding) only flips status as a side effect for a Participant
 * viewing an Open finding, or a Reviewer viewing a Submitted/Resubmitted one -- an Inspector/PM/
 * SysAdmin loading an Open/Viewed finding (the only statuses this page is reachable for, see the gate
 * below) triggers neither branch, so this is safe to call without accidentally advancing the workflow.
 */
async function renderEditFinding(params) {
  var eventId = params.id;
  var findingId = params.findingId;
  var root = document.getElementById('viewRoot');
  root.innerHTML = '<div class="empty-state">' + t('loading') + '</div>';

  if (!hasPermission('finding.edit')) {
    root.innerHTML = '<div class="empty-state">' + esc(t('no_permission_edit_x', { term: Term('finding').toLowerCase() })) + '</div>';
    return;
  }

  var data;
  try { data = await Api.call('viewFinding', { findingId: findingId }); }
  catch (err) { UI.error(err); root.innerHTML = '<div class="empty-state">' + esc(t('could_not_load_x', { term: Term('finding').toLowerCase() })) + '</div>'; return; }

  var finding = data.finding;
  // Same gate updateFinding itself enforces server-side -- checked here too so someone who reaches
  // this page via a stale link/back-button gets a clear page instead of a save that just fails later.
  if (FINDING_EDITABLE_STATUSES_.indexOf(finding.status) === -1) {
    UI.toast(t('x_already_submitted', { term: Term('finding').toLowerCase() }), 'error');
    window.location.hash = '#/events/' + eventId + '/findings/' + findingId;
    return;
  }

  var disciplines = [], checklistItems = [], participants = [];
  try {
    var detail = await Api.call('getEvent', { eventId: eventId });
    var results = await Promise.all([
      Api.call('listDisciplines', {}), Api.call('listChecklistItems', {}),
      Api.call('listParticipants', { eventId: eventId, venueId: detail.venue ? detail.venue.id : '' })
    ]);
    disciplines = results[0]; checklistItems = results[1]; participants = results[2];
  } catch (e) { /* pickers below just end up with fewer options */ }
  var disciplinesById = {}; disciplines.forEach(function (d) { disciplinesById[d.id] = d; });

  root.innerHTML =
    '<div class="breadcrumb"><a href="#/events/' + eventId + '/findings/' + findingId + '">' + esc(finding.description || t('tab_findings')) + '</a></div>' +
    '<div class="page-header"><div><div class="page-title">' + esc(t('edit_x_title', { term: Term('finding') })) + '</div>' +
    '<div class="page-subtitle">' + esc(t('edit_finding_subtitle', { term: Term('finding').toLowerCase() })) + '</div></div>' +
    '<button class="btn btn-secondary" id="backEditFindingBtn">' + ICON('back') + ' ' + esc(t('back')) + '</button></div>' +
    '<div class="card" style="max-width:640px;"><div class="card-body" style="display:flex;flex-direction:column;gap:4px;">' +
      '<div class="field-group" style="position:relative;">' +
        '<label class="field-label" style="margin-top:0;">' + esc(Term('participant')) + '</label>' +
        '<input id="fParticipantSearch" class="field-input" placeholder="' + esc(t('participant_search_placeholder', { term: Term('participant').toLowerCase() })) + '" autocomplete="off" />' +
        '<div id="participantSuggestBox" class="chat-suggest-box" style="display:none;"></div>' +
      '</div>' +
      UI.field(Term('discipline'), '<select id="fDiscipline" class="field-input"><option value="">—</option>' +
        disciplines.map(function (d) { return '<option value="' + esc(d.id) + '">' + esc(d.name) + '</option>'; }).join('') + '</select>') +
      UI.field(t('checklist_type'), '<select id="fChecklistType" class="field-input"><option value="">' + esc(t('checklist_type_default_hint')) + '</option></select>') +
      UI.field(t('description'), '<textarea id="fDesc" class="field-input" rows="3">' + esc(finding.description || '') + '</textarea>') +
      UI.field(t('suggested_action'), '<input id="fAction" class="field-input" value="' + esc(finding.suggestedAction || '') + '" />') +
      UI.field(t('risk_level'), '<select id="fRisk" class="field-input">' +
        ['Low', 'Medium', 'High', 'Critical'].map(function (r) { return '<option' + (finding.riskLevel === r ? ' selected' : '') + '>' + r + '</option>'; }).join('') + '</select>') +
      '<button class="btn btn-primary" id="saveEditFindingBtn" style="margin-top:10px;align-self:flex-start;">' + esc(t('save_changes')) + '</button>' +
    '</div></div>';

  document.getElementById('backEditFindingBtn').onclick = function () { window.location.hash = '#/events/' + eventId + '/findings/' + findingId; };

  /* ---- Participant: searchable dropdown, pre-filled from the finding's current participant ---- */
  var selectedParticipant = participants.filter(function (pt) { return pt.id === finding.participantId; })[0] || null;
  var pSearch = document.getElementById('fParticipantSearch');
  pSearch.value = selectedParticipant ? selectedParticipant.name : (finding.participantName || '');
  var pSuggest = document.getElementById('participantSuggestBox');
  var pMatches = [];
  function renderParticipantSuggest_(query) {
    var q = (query || '').toLowerCase();
    pMatches = participants.filter(function (pt) { return !q || pt.name.toLowerCase().indexOf(q) !== -1; });
    pSuggest.innerHTML = '<div class="chat-suggest-header">' + esc(Term('participant_plural')) + '</div>' +
      (pMatches.length
        ? pMatches.slice(0, 20).map(function (pt, i) {
            return '<div class="chat-suggest-item" data-idx="' + i + '">' + esc(pt.name) +
              '<span class="muted" style="font-size:11px;"> · ' + esc(pt.type) + '</span></div>';
          }).join('')
        : '<div class="chat-suggest-empty">' + esc(t('no_matches_suggest')) + '</div>');
    pSuggest.style.display = '';
    pSuggest.querySelectorAll('.chat-suggest-item').forEach(function (el) {
      el.addEventListener('mousedown', function (e) {
        e.preventDefault();
        pickParticipant_(pMatches[Number(el.getAttribute('data-idx'))]);
      });
    });
  }
  function pickParticipant_(pt) {
    selectedParticipant = pt;
    pSearch.value = pt.name;
    pSuggest.style.display = 'none';
  }
  pSearch.addEventListener('focus', function () { renderParticipantSuggest_(pSearch.value); });
  pSearch.addEventListener('input', function () {
    if (selectedParticipant && pSearch.value !== selectedParticipant.name) selectedParticipant = null; // edited past a selection -- must re-pick
    renderParticipantSuggest_(pSearch.value);
  });
  pSearch.addEventListener('keydown', function (e) { if (e.key === 'Escape') pSuggest.style.display = 'none'; });
  pSearch.addEventListener('blur', function () { setTimeout(function () { pSuggest.style.display = 'none'; }, 150); });

  /* ---- Discipline + Checklist Type, pre-filled from the finding's current values ---- */
  document.getElementById('fDiscipline').value = finding.disciplineId || '';
  function renderChecklistTypeOptions_() {
    var typeSelect = document.getElementById('fChecklistType');
    var prev = typeSelect.value;
    var disciplineId = document.getElementById('fDiscipline').value;
    var disciplineName = disciplineId && disciplinesById[disciplineId] ? disciplinesById[disciplineId].name : '';
    var relevant = disciplineName ? checklistItems.filter(function (i) { return i.category === disciplineName; }) : checklistItems;
    var types = Array.from(new Set(relevant.map(function (i) { return i.checklistType; }).filter(Boolean))).sort();
    typeSelect.innerHTML = '<option value="">— (defaults to Other)</option>' +
      types.map(function (ty) { return '<option value="' + esc(ty) + '">' + esc(ty) + '</option>'; }).join('');
    if (types.indexOf(prev) !== -1) typeSelect.value = prev;
  }
  document.getElementById('fDiscipline').addEventListener('change', renderChecklistTypeOptions_);
  renderChecklistTypeOptions_();
  // A stored category of exactly 'Other' is indistinguishable from "left blank at creation" (both
  // collapse to the same value server-side, see createFinding) -- shown as blank here too, same as
  // the New Finding form's own convention.
  document.getElementById('fChecklistType').value = (finding.category && finding.category !== 'Other') ? finding.category : '';

  document.getElementById('saveEditFindingBtn').onclick = async function () {
    if (!selectedParticipant) { UI.toast(t('toast_participant_required', { term: Term('participant') }), 'error'); return; }
    var disciplineId = document.getElementById('fDiscipline').value;
    if (!disciplineId) { UI.toast(t('toast_discipline_required', { term: Term('discipline') }), 'error'); return; }
    try {
      await Api.call('updateFinding', {
        findingId: findingId, participantId: selectedParticipant.id, disciplineId: disciplineId,
        description: document.getElementById('fDesc').value, suggestedAction: document.getElementById('fAction').value,
        // Same "blank -> Other" convention createFinding applies at creation time -- updateFinding
        // itself doesn't reapply it (see its own comment), so it's done here instead.
        category: document.getElementById('fChecklistType').value || 'Other',
        riskLevel: document.getElementById('fRisk').value
      });
      UI.toast(t('x_updated', { term: Term('finding') }), 'success');
      window.location.hash = '#/events/' + eventId + '/findings/' + findingId;
    } catch (err) { UI.error(err); }
  };
}

// REQ: "Log findings while photo is uploading in the background." entries is the SAME pendingFiles.
// newFinding array uploadEvidenceFile_ keeps mutating in place (status/url) as each file's
// prepare-then-upload pipeline progresses -- polled here rather than given a completion callback so
// this doesn't have to touch that shared function (also used by the Resolve section further down this
// file). alreadyAttachedUrls seeds the de-dupe set with whatever createFinding was already given, so a
// file that finished between "read pendingFiles" and "call createFinding" doesn't get attached twice.
// Api.uploadWithProgress (api.js) doesn't carry Router's navigation-abort signal, so this keeps
// running fine even after the user has already navigated to the finding's own page. Note: a file that
// ends up 'saved-locally' (upload failed -- see uploadEvidenceFile_) is left for EvidenceCapture's own
// retryPending/'online' sweep, but that sweep has no way to know it belongs to THIS finding, so a
// failed-then-later-retried upload won't auto-attach here -- an accepted edge case, not silently
// losing the photo (it's still safely saved to the device), just not auto-linked.
function attachFindingEvidenceInBackground_(findingId, entries, alreadyAttachedUrls) {
  var attached = {};
  (alreadyAttachedUrls || []).forEach(function (u) { attached[u] = true; });
  var timer = setInterval(function () {
    var stillPending = false;
    entries.forEach(function (entry) {
      if (entry.status === 'uploading' || entry.status === 'preparing') { stillPending = true; return; }
      if (entry.status === 'done' && entry.url && !attached[entry.url]) {
        attached[entry.url] = true;
        Api.call('addFindingEvidence', { findingId: findingId, evidenceUrl: entry.url }).catch(function () {});
      }
    });
    if (!stillPending) clearInterval(timer);
  }, 1500);
}

/* ---------------- Log Finding's own live-location map (this device's GPS, not other inspectors') ----
 * Mirrors eventDetail.js's liveInspectionMap "my position" pattern (updateLiveInspectionMyPosition_):
 * a single self marker that's moved (not recreated) on every watchPosition tick, with the map
 * re-centered on it each time via setView(latlng, currentZoom, {animate:false}) -- so the inspector
 * stays centered no matter where they walk, while still being free to zoom in/out between ticks (the
 * next recenter keeps whatever zoom they left it at).
 *
 * REQ (follow-up): "map should follow our standard maps by displaying boundaries and dots." Now draws
 * the venue boundary + zone boundaries + participant dots on load, same composition as
 * eventPlacesMap/participantDisciplineMap (UI.drawZoneBoundaries/UI.drawPlaceDots, ui.js -- dots get
 * the same red+badge open-risk treatment for free). Initial view fitBounds()s to that content instead
 * of a flat max zoom -- showing boundaries/dots and starting at "max zoom, nothing else visible" are
 * mutually exclusive, and matching the rest of the app's maps wins; once a GPS fix arrives,
 * updateFindingMyPosition_ recenters on the inspector at whatever zoom is then active, same as
 * liveInspectionMap.
 *
 * Module-level state + explicit destroy (called from the Back button and on successful submit above)
 * follows the same manual-cleanup convention already used everywhere else in the app for a Leaflet
 * map + geolocation watch pairing -- see destroyLiveInspectionMap_'s own header comment in
 * eventDetail.js for why there's no generic route-change hook to rely on instead.
 */
var findingLocationMapInstance_ = null;
var findingLocationMyMarker_ = null;
var findingLocationWatchId_ = null;
var findingLocationResizeObserver_ = null;
// GOLDEN RULE: "Users locations can never be visible if outside events boundaries." Parsed once per
// visit (initFindingLocationMap_, from the event's own venue) via parseBoundaryClient_ (venues.js,
// loaded app-wide) -- same client-side containment check used for eventDetail.js's liveInspectionMap.
// Read by updateFindingMyPosition_ below to hide this device's own live dot the moment it steps
// outside; findingLocationMap never broadcasts this position to any other user, so a client-side
// check is sufficient here (nothing server-side needs to change).
var findingLocationVenueBoundary_ = null;

function stopFindingLocationWatch_() {
  if (findingLocationWatchId_ != null && navigator.geolocation) { navigator.geolocation.clearWatch(findingLocationWatchId_); findingLocationWatchId_ = null; }
}
function destroyFindingLocationMap_() {
  stopFindingLocationWatch_();
  if (findingLocationResizeObserver_) { findingLocationResizeObserver_.disconnect(); findingLocationResizeObserver_ = null; }
  if (findingLocationMapInstance_) { findingLocationMapInstance_.remove(); findingLocationMapInstance_ = null; }
  findingLocationMyMarker_ = null;
  findingLocationVenueBoundary_ = null;
}

function initFindingLocationMap_(venue, zones, participants) {
  destroyFindingLocationMap_(); // in case a previous visit left a GPS watch/map running (same defensive pattern as tabInspections/destroyLiveInspectionMap_)
  findingLocationVenueBoundary_ = venue ? parseBoundaryClient_(venue.boundary) : null;
  var el = document.getElementById('findingLocationMap');
  if (!el) return;
  if (typeof HululLeaflet === 'undefined') {
    el.style.display = 'flex'; el.style.alignItems = 'center'; el.style.justifyContent = 'center';
    el.style.color = 'var(--text-600)'; el.style.fontSize = '12px'; el.style.textAlign = 'center'; el.style.padding = '12px';
    el.textContent = t('map_unavailable');
    return;
  }
  setTimeout(function () {
    if (!document.getElementById('findingLocationMap')) return;
    findingLocationMapInstance_ = HululLeaflet.map('findingLocationMap', { preferCanvas: true }).setView(EVENT_MAP_DEFAULT_CENTER_, 16); // see eventDetail.js overviewZoneMap's preferCanvas comment
    UI.requireClickToActivateMap(findingLocationMapInstance_, el);
    HululLeaflet.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19
    }).addTo(findingLocationMapInstance_);

    // REQ: "map should follow our standard maps by displaying boundaries and dots."
    var bounds = [];
    if (findingLocationVenueBoundary_) {
      var venueColor = (venue && venue.color) || VENUE_BOUNDARY_DEFAULT_COLOR_;
      var venueLayer = HululLeaflet.polygon(findingLocationVenueBoundary_.map(function (pt) { return [pt.lat, pt.lng]; }), {
        color: venueColor, fillColor: venueColor, fillOpacity: 0.06, weight: 1.5, interactive: false
      }).addTo(findingLocationMapInstance_);
      bounds = bounds.concat(venueLayer.getLatLngs()[0]);
    }
    UI.drawZoneBoundaries(findingLocationMapInstance_, zones).forEach(function (layer) {
      bounds = bounds.concat(layer.getLatLngs()[0]);
    });
    UI.drawPlaceDots(findingLocationMapInstance_, participants);
    (participants || []).forEach(function (pt) {
      if (pt.lat !== '' && pt.lat != null && pt.lng !== '' && pt.lng != null) bounds.push([Number(pt.lat), Number(pt.lng)]);
    });
    if (bounds.length) findingLocationMapInstance_.fitBounds(bounds, { padding: [24, 24], maxZoom: 18 });

    // REQ (follow-up): "expand map canvas to fill empty width" -- the map card's height is stretched
    // to match its taller sibling column (see the flex CSS above), so its final pixel size isn't known
    // until layout settles; a plain setTimeout(invalidateSize) guess isn't reliable against that (or
    // against fonts/content still shifting height after the fact). ResizeObserver re-syncs Leaflet's
    // internal size to the container's real size continuously instead of guessing a delay.
    if (window.ResizeObserver) {
      findingLocationResizeObserver_ = new ResizeObserver(function () { if (findingLocationMapInstance_) findingLocationMapInstance_.invalidateSize(); });
      findingLocationResizeObserver_.observe(el);
    }
    setTimeout(function () { if (findingLocationMapInstance_) findingLocationMapInstance_.invalidateSize(); }, 150);
    startFindingLocationWatch_();
  }, 0);
}

// GOLDEN RULE: "Users locations can never be visible if outside events boundaries." Checked first,
// against findingLocationVenueBoundary_ -- if the device is outside the event's venue, the dot is
// removed (not just left where it was) and a banner explains why, same treatment as
// updateLiveInspectionMyPosition_ (eventDetail.js).
function updateFindingMyPosition_(latlng) {
  if (!findingLocationMapInstance_) return;
  var banner = document.getElementById('findingLocationBanner');
  if (findingLocationVenueBoundary_ && !pointInPolygonClient_(latlng[0], latlng[1], findingLocationVenueBoundary_)) {
    if (findingLocationMyMarker_) { findingLocationMapInstance_.removeLayer(findingLocationMyMarker_); findingLocationMyMarker_ = null; }
    if (banner) banner.innerHTML = '<div class="muted" style="font-size:11.5px;">' + ICON('warning_banner') + ' ' + esc(t('outside_boundary_banner')) + '</div>';
    return;
  }
  if (!findingLocationMyMarker_) {
    var icon = HululLeaflet.divIcon({
      className: 'my-location-icon', iconSize: [18, 18], iconAnchor: [9, 9], html: '<div class="my-location-dot"></div>'
    });
    findingLocationMyMarker_ = HululLeaflet.marker(latlng, { icon: icon, zIndexOffset: 1000 }).addTo(findingLocationMapInstance_);
  } else {
    findingLocationMyMarker_.setLatLng(latlng);
  }
  // REQ: "When an inspector moves the map moves but his location remains centred."
  findingLocationMapInstance_.setView(latlng, findingLocationMapInstance_.getZoom(), { animate: false });
}

function startFindingLocationWatch_() {
  var banner = document.getElementById('findingLocationBanner');
  if (!navigator.geolocation) {
    if (banner) banner.textContent = t('location_not_available_browser');
    return;
  }
  if (banner) banner.innerHTML = ICON('gps_locating') + ' ' + esc(t('gps_locating'));
  stopFindingLocationWatch_();
  findingLocationWatchId_ = navigator.geolocation.watchPosition(function (pos) {
    var freshBanner = document.getElementById('findingLocationBanner');
    if (freshBanner) freshBanner.innerHTML = '';
    updateFindingMyPosition_([pos.coords.latitude, pos.coords.longitude]);
  }, function () {
    var freshBanner = document.getElementById('findingLocationBanner');
    if (freshBanner) freshBanner.textContent = t('location_error');
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
}

/* ---------------- Finding detail / workflow page (route: #/events/:id/findings/:findingId) ---------------- */
async function renderFindingDetail(params) {
  var eventId = params.id;
  var findingId = params.findingId;
  var root = document.getElementById('viewRoot');
  destroyFindingLocationMap_(); // in case a New Finding visit left the GPS watch/map running (same defensive pattern as tabInspections)
  root.innerHTML = '<div class="empty-state">' + t('loading') + '</div>';

  var data;
  try { data = await Api.call('viewFinding', { findingId: findingId }); }
  catch (err) { UI.error(err); root.innerHTML = '<div class="empty-state">' + esc(t('could_not_load_x', { term: Term('finding').toLowerCase() })) + '</div>'; return; }

  var finding = data.finding, resolutions = data.resolutions || [];
  // RBAC pilot: which action section renders is now driven by the same admin-configurable
  // finding.resolve/finding.review permissions the backend enforces (resolveFinding/
  // reviewFindingResolution, Findings.gs), not the hardcoded FINDING_ROLE_PARTICIPANT_/
  // FINDING_ROLE_REVIEWER_ arrays (those two constants still gate unrelated things -- the Chat and
  // Log Photos tab visibility in eventDetail.js -- and are deliberately left as-is for now).
  var isParticipant = hasPermission('finding.resolve');
  var isReviewer = hasPermission('finding.review');
  var latestPending = resolutions.filter(function (r) { return r.decision === 'Pending'; })[0];
  // Whichever rejection is still "live" -- the reason ReOpen exists, or (if terminal) the reason
  // Rejected happened -- shown as a callout so the Participant knows what to fix without having to
  // dig through the full history list below.
  var latestRejected = resolutions.filter(function (r) { return r.decision === 'Rejected'; })[0];

  root.innerHTML =
    '<div class="breadcrumb"><a href="#/events/' + eventId + '?tab=findings">' + esc(t('tab_findings')) + '</a></div>' +
    '<div class="page-header"><div><div class="page-title">' + esc(finding.description || '(no description)') + '</div>' +
    '<div class="page-subtitle">' + esc(finding.disciplineName || '—') + (finding.category ? ' · ' + esc(finding.category) : '') + '</div></div>' +
    '<button class="btn btn-secondary" id="backFindingBtn">' + ICON('back') + ' ' + esc(t('back')) + '</button></div>' +

    // REQ (follow-up): "Re-arrange in the following order: Card header: Risk Level and Status (as
    // they are); 1. Participant 2. Zone 3. Discipline 4. Category 5. Logged 6. Resolution Window
    // 7. Description 8. Suggested action 9. Risk Logging Evidence (expand photos to the max when
    // clicked)." Hero strip unchanged; everything below it now follows that exact order top to
    // bottom -- meta chips (1-6) first, then the two text sections (7-8), with the evidence gallery
    // last (9) instead of the previous description-first layout.
    '<div class="card" style="margin-bottom:16px;overflow:hidden;">' +
      findingHeroStripHtml_(finding) +
      '<div class="card-body">' +
        '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:18px;">' +
          findingMetaChipHtml_('👤', Term('participant'), esc(finding.participantName || '—')) +
          findingMetaChipHtml_('📍', t('sub_x', { term: Term('zone').toLowerCase() }), esc(finding.subZone || '—')) +
          findingMetaChipHtml_('🧩', Term('discipline'), esc(finding.disciplineName || '—')) +
          findingMetaChipHtml_('📋', t('category'), esc([finding.category, finding.subCategory].filter(Boolean).join(' / ') || '—')) +
          findingMetaChipHtml_('🕓', t('logged'), UI.fmtDate(finding.createdAt)) +
          findingMetaChipHtml_('⏱️', t('resolution_window'), UI.fmtDate(finding.resolutionWindowAt)) +
          // Not in the requested list (no Location field going forward -- see createFinding's own
          // header comment) but still shown, tacked onto the end, for older records that have one.
          (finding.location ? findingMetaChipHtml_('🧭', t('location'), esc(finding.location)) : '') +
        '</div>' +
        '<div style="background:var(--surface);border-radius:var(--radius-md);padding:14px 16px;margin-bottom:16px;">' +
          '<div class="field-label" style="margin-top:0;">' + esc(t('description')) + '</div>' +
          '<div style="font-size:15px;line-height:1.55;margin-top:4px;color:var(--text-900);">' + esc(finding.description || '—') + '</div>' +
        '</div>' +
        (finding.suggestedAction
          ? '<div style="margin-bottom:16px;">' + detailField_(t('suggested_action'), esc(finding.suggestedAction)) + '</div>'
          : '') +
        '<div class="field-label" style="margin-bottom:8px;">' + esc(t('risk_logging_evidence')) + '</div>' +
        evidenceThumbsHtml_(finding.evidenceUrls, 168) +
      '</div>' +
    '</div>' +

    (latestRejected && (finding.status === 'ReOpen' || finding.status === 'Rejected')
      ? '<div class="card" style="margin-bottom:16px;border-left:4px solid var(--danger);"><div class="card-body">' +
          '<div style="font-weight:700;font-size:12.5px;color:var(--danger);margin-bottom:4px;">' + esc(t('rejected_by_inspector')) +
          esc(finding.status === 'Rejected' ? t('rejected_final') : t('rejected_fix_resubmit')) + '</div>' +
          '<div style="font-size:13px;">' + esc(latestRejected.comments || '—') + '</div></div></div>'
      : '') +

    findingActionSectionHtml_(finding, isParticipant, isReviewer, latestPending) +

    (resolutions.length
      ? '<div class="card"><div class="card-header"><div class="card-title">' + esc(t('resolution_history')) + '</div>' +
        '<div class="muted" style="font-size:11.5px;">' + esc(t('resolution_history_subtitle', { term: Term('participant').toLowerCase() })) + '</div></div>' +
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
    (r.comments ? '<div style="font-size:12.5px;color:var(--danger);margin-top:4px;">' + esc(t('reviewer_remarks')) + esc(r.comments) + '</div>' : '') +
    '<div style="margin-top:8px;">' + evidenceThumbsHtml_(r.evidenceUrls) + '</div>' +
  '</div>';
}

// The one action available to the current viewer for the finding's current status -- Resolve
// (Participant, status Viewed/ReOpen) or Accept/Reject (Reviewer, status InReview with a pending
// resolution). Anything else (wrong role for this status, or a terminal/no-action status) renders
// nothing here -- the read-only card above and the history below are the whole page.
function findingActionSectionHtml_(finding, isParticipant, isReviewer, latestPending) {
  if (isParticipant && (finding.status === 'Viewed' || finding.status === 'ReOpen')) {
    return '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + esc(t('resolve_this_x', { term: Term('finding').toLowerCase() })) + '</div></div>' +
      '<div class="card-body">' +
        UI.field(t('remarks'), '<textarea id="fResolveRemarks" class="field-input" rows="3"></textarea>') +
        '<div class="field-label" style="font-size:11.5px;margin-top:8px;">' + esc(t('resolution_evidence_required')) + '</div>' +
        // Same camera-only pattern as Record Results' Risk Logging evidence field (eventDetail.js) --
        // the native file input is hidden, a plain camera-icon button triggers it, capture="environment"
        // opens the device camera directly instead of a general file/gallery picker.
        '<input type="file" id="fResolveFile" accept="image/*,video/*" capture="environment" style="display:none;" />' +
        '<button type="button" class="btn btn-secondary btn-icon" id="fResolveCameraBtn" title="' + esc(t('take_photo_video')) + '" aria-label="' + esc(t('take_photo_video')) + '">' + ICON('capture_photo') + '</button>' +
        '<div class="evidence-list" data-evlist="resolve" style="margin-top:6px;"></div>' +
        '<button class="btn btn-primary btn-sm" id="submitResolveBtn" style="margin-top:12px;">' + esc(t('submit_resolution')) + '</button>' +
      '</div></div>';
  }
  if (isReviewer && finding.status === 'InReview' && latestPending) {
    return '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + esc(t('review_resolution')) + '</div></div>' +
      '<div class="card-body">' +
        detailField_(t('remarks'), esc(latestPending.remarks || '—')) +
        '<div style="margin-top:12px;">' + evidenceThumbsHtml_(latestPending.evidenceUrls) + '</div>' +
        '<div style="display:flex;gap:8px;margin-top:16px;">' +
          '<button class="btn btn-secondary btn-icon" id="acceptFindingBtn" title="' + esc(t('accept')) + '">' + ICON('approve') + '</button>' +
          '<button class="btn btn-secondary btn-icon" id="rejectFindingBtn" title="' + esc(t('reject')) + '">' + ICON('reject') + '</button>' +
        '</div>' +
        '<div id="rejectRemarksSection" style="display:none;margin-top:10px;">' +
          UI.field(t('rejection_remarks_required_label'), '<textarea id="fRejectRemarks" class="field-input" rows="2"></textarea>') +
          '<button class="btn btn-primary btn-sm" id="confirmRejectBtn" style="margin-top:8px;">' + esc(t('confirm_rejection')) + '</button>' +
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
      if (!remarks) { UI.toast(t('toast_remarks_required'), 'error'); return; }
      var files = pendingFiles.resolve || [];
      if (files.some(function (f) { return f.status === 'uploading' || f.status === 'preparing'; })) {
        UI.toast(t('toast_evidence_uploading_wait'), 'error'); return;
      }
      var urls = files.filter(function (f) { return f.status === 'done'; }).map(function (f) { return f.url; });
      if (!urls.length) { UI.toast(t('toast_evidence_required'), 'error'); return; }
      try {
        await Api.call('resolveFinding', { findingId: finding.id, remarks: remarks, evidenceUrls: urls });
        UI.toast(t('toast_resolution_submitted'), 'success');
        Router.resolve();
      } catch (err) { UI.error(err); }
    };
    return;
  }
  if (isReviewer && finding.status === 'InReview' && latestPending) {
    document.getElementById('acceptFindingBtn').onclick = async function () {
      try { await Api.call('reviewFindingResolution', { findingId: finding.id, decision: 'Approved' }); UI.toast(t('toast_x_resolved', { term: Term('finding') }), 'success'); Router.resolve(); }
      catch (err) { UI.error(err); }
    };
    document.getElementById('rejectFindingBtn').onclick = function () {
      document.getElementById('rejectRemarksSection').style.display = 'block';
    };
    document.getElementById('confirmRejectBtn').onclick = async function () {
      var comments = document.getElementById('fRejectRemarks').value;
      if (!comments) { UI.toast(t('toast_rejection_remarks_required'), 'error'); return; }
      try { await Api.call('reviewFindingResolution', { findingId: finding.id, decision: 'Rejected', comments: comments }); UI.toast(t('toast_resolution_rejected'), 'success'); Router.resolve(); }
      catch (err) { UI.error(err); }
    };
  }
}
