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
 * Open -> Viewed -> Submitted -> InReview -> Resolved/ReOpen -> Resubmitted -> InReview -> ...
 * state machine -- every rejection loops back to ReOpen, however many times). This file only renders
 * whatever viewFinding/resolveFinding/reviewFindingResolution return and offers whichever single
 * action applies to the current viewer + the finding's current status -- it never sets status directly.
 *
 * Depends on globals defined in eventDetail.js (uploadEvidenceFile_/renderEvidenceList_/
 * retryEvidenceEntry_/EVIDENCE_MAX_UPLOAD_BYTES_) and evidence.js (EvidenceCapture) -- load this
 * file after both in index.html. The Resolve section's camera capture reuses those exact functions
 * (keyed by a fixed itemId of 'resolve') instead of duplicating the upload/retry/progress-list logic.
 */
// REQ ("Can this be configurable, and allow to add other types"): was a fixed 3-item array; now
// isParticipantRole_ (venues.js, loaded app-wide) checks HululState.participantTypes dynamically, so a
// newly added custom type is treated the same as Vendor/Operator/Exhibitor everywhere this gated
// (currently just the Chat tab's own visibility below).
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
// evidenceMeta (optional): [{url, outsideBoundary, distanceMeters}, ...] -- REQ follow-up: "Instead
// of showing 'OUTSIDE VENUE BOUNDARY' on photos make it a badge also provide distance away from
// participant in meters." Only the Finding's own main evidence grid (evidenceMeta comes from
// Finding.evidenceMeta, Findings.gs) passes this; Resolution-history evidence call sites simply omit
// it and get no badge, same "missing metadata -> no badge" rule as everywhere else this shows up.
// opts (optional): { findingId, deletable } -- REQ: "In Logs allow inspectors to delete log photos."
// deletable adds a small remove button over each thumbnail (only when the caller also passes
// findingId, since deleting needs to know which Finding row to detach the URL from); wireEvidenceThumbDeletes_
// (below) is what the caller runs after this HTML lands in the DOM to actually hook the buttons up --
// kept as a separate step (same split as e.g. renderLogPhotoGroups_'s render-then-wire two-step in
// logPhotos.js) rather than inline onclick= strings, since the delete handler needs a real closure
// (confirm dialog + Api.call + re-render), not just a location.hash-style one-liner. Only the finding's
// own primary evidence gallery (viewFinding) passes deletable -- resolution-history/photo-timeline uses
// of this same helper show past submissions as read-only records, not something to prune retroactively.
function evidenceThumbsHtml_(urls, size, evidenceMeta, opts) {
  size = size || 120;
  opts = opts || {};
  if (!urls || !urls.length) return '<div class="muted" style="font-size:12px;">' + esc(t('no_evidence_attached')) + '</div>';
  var deletable = opts.deletable && opts.findingId && hasPermission('finding.deleteEvidence');
  return '<div style="display:flex;flex-wrap:wrap;gap:12px;">' + urls.map(function (u, i) {
    var thumb = driveEvidenceThumbUrl_(u);
    var full = driveEvidenceThumbUrl_(u, 1600) || u;
    var meta = evidenceMetaFor_(evidenceMeta, u);
    return '<div style="display:flex;flex-direction:column;align-items:center;">' +
      '<div style="position:relative;">' +
        '<a href="' + esc(u) + '" target="_blank" rel="noopener" title="' + esc(t('click_to_expand')) + '" ' +
          'class="evidence-thumb" data-lightbox-url="' + esc(full) + '" style="width:' + size + 'px;height:' + size + 'px;">' +
          (thumb
            ? '<img src="' + esc(thumb) + '" alt="Evidence ' + (i + 1) + '" class="evidence-thumb-img" />'
            : '<span style="font-size:28px;">' + ICON('capture_photo') + '</span>') +
        '</a>' +
        (deletable
          ? '<button type="button" class="btn btn-secondary btn-sm btn-icon evidence-thumb-delete" data-finding-id="' + esc(opts.findingId) + '" data-url="' + esc(u) + '" title="' + esc(t('move_to_trash_title')) + '" style="position:absolute;top:4px;right:4px;padding:2px 5px;">' + ICON('delete') + '</button>'
          : '') +
      '</div>' +
      evidenceOutsideBadgeHtml_(meta) +
    '</div>';
  }).join('') + '</div>';
}
// Wires up every .evidence-thumb-delete button rendered by evidenceThumbsHtml_'s deletable mode.
// Called once after the HTML containing them is in the DOM (viewFinding). onDone re-renders the
// caller's own gallery/page so the removed thumbnail (and updated count) disappear immediately.
function wireEvidenceThumbDeletes_(container, onDone) {
  container.querySelectorAll('.evidence-thumb-delete').forEach(function (btn) {
    btn.onclick = function (e) {
      e.preventDefault(); e.stopPropagation();
      var findingId = btn.getAttribute('data-finding-id');
      var url = btn.getAttribute('data-url');
      UI.confirmModal(t('delete_evidence_confirm'), async function () {
        try {
          await Api.call('deleteFindingEvidence', { findingId: findingId, url: url });
          UI.toast(t('toast_photo_moved_to_trash'), 'success');
          if (onDone) onDone(); else Router.resolve();
        } catch (err) { UI.error(err); }
      }, { confirmLabel: t('delete'), confirmClass: 'btn-danger' });
    };
  });
}
// evidenceThumbsHtml_'s <img> used to carry an inline onerror="..." attribute whose fallback markup
// embedded ICON('capture_photo') -- raw SVG containing its own double-quoted attributes (viewBox="...",
// d="...") -- directly inside that double-quoted HTML attribute string. The browser's parser closed the
// onerror="..." attribute (and then the <img> tag itself) at the SVG's first unescaped quote, corrupting
// the surrounding DOM at parse time (not just when onerror actually fired): shrunken thumbnails plus
// literal leftover markup spilling out as text. Fixed by dropping the inline handler entirely and using
// one delegated capture-phase listener instead -- 'error' on <img> doesn't bubble, but capture-phase
// delegation still catches it -- which replaces the failed image via real DOM APIs, no string-into-
// attribute escaping involved.
document.addEventListener('error', function (e) {
  var img = e.target;
  if (!img || !img.classList || !img.classList.contains('evidence-thumb-img')) return;
  var span = document.createElement('span');
  span.style.fontSize = '28px';
  span.innerHTML = ICON('capture_photo');
  img.replaceWith(span);
}, true);

// Fills as much of the viewport as sensibly possible (92vw/88vh, object-fit:contain) rather than
// reusing UI.openModal's modal-box -- that's capped at 520px with header/footer chrome, which is
// exactly the "not very big" look this REQ is trying to get away from.
//
// gallery/startIndex (both optional, REQ follow-up: "when clicked expand and iterate between
// images"): gallery is an array of { full, original } pairs -- when it has more than one entry, Prev/
// Next controls (and left/right arrow keys) step through the rest of that finding's evidence without
// closing back out to the grid/table first. Single-image callers (most existing evidenceThumbsHtml_
// uses) simply omit these two args and get the old single-image behavior unchanged.
function openEvidenceLightbox_(fullImgUrl, originalUrl, gallery, startIndex) {
  var hasGallery = gallery && gallery.length > 1;
  var idx = hasGallery ? (startIndex || 0) : 0;
  var overlay = document.createElement('div');
  overlay.className = 'evidence-lightbox-overlay';
  overlay.innerHTML =
    '<button type="button" class="evidence-lightbox-close" aria-label="' + esc(t('close')) + '" title="' + esc(t('close')) + '">' + ICON('close_modal') + '</button>' +
    (hasGallery ? '<button type="button" class="evidence-lightbox-nav evidence-lightbox-prev" aria-label="' + esc(t('previous')) + '" title="' + esc(t('previous')) + '">' + ICON('page_prev') + '</button>' : '') +
    '<img src="' + esc(fullImgUrl) + '" alt="Evidence" />' +
    (hasGallery ? '<button type="button" class="evidence-lightbox-nav evidence-lightbox-next" aria-label="' + esc(t('next')) + '" title="' + esc(t('next')) + '">' + ICON('page_next') + '</button>' : '') +
    '<a href="' + esc(originalUrl) + '" target="_blank" rel="noopener" class="evidence-lightbox-open">' + ICON('view_open') + ' ' + esc(t('open_original')) + '</a>' +
    (hasGallery ? '<div class="evidence-lightbox-count">' + esc(t('gallery_count', { current: idx + 1, total: gallery.length })) + '</div>' : '');
  document.body.appendChild(overlay);
  function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
  overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); }); // background only -- not the image/buttons
  overlay.querySelector('.evidence-lightbox-close').onclick = close;
  function show(i) {
    idx = (i + gallery.length) % gallery.length; // wraps both directions -- no dead-end at either edge
    var entry = gallery[idx];
    overlay.querySelector('img').src = entry.full;
    overlay.querySelector('.evidence-lightbox-open').href = entry.original;
    var count = overlay.querySelector('.evidence-lightbox-count');
    if (count) count.textContent = t('gallery_count', { current: idx + 1, total: gallery.length });
  }
  if (hasGallery) {
    overlay.querySelector('.evidence-lightbox-prev').onclick = function (e) { e.stopPropagation(); show(idx - 1); };
    overlay.querySelector('.evidence-lightbox-next').onclick = function (e) { e.stopPropagation(); show(idx + 1); };
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
    else if (hasGallery && e.key === 'ArrowLeft') show(idx - 1);
    else if (hasGallery && e.key === 'ArrowRight') show(idx + 1);
  }
  document.addEventListener('keydown', onKey);
}
// data-gallery-b64 (optional, REQ follow-up: "Image (show last image thumbnail) when clicked expand
// and iterate between images"): a base64-encoded JSON array of every evidence URL for the thumbnail's
// own finding/pending-upload set, used when only ONE thumbnail is actually rendered (e.g. the Risk
// Logging table's Image column, which shows just the last image) but all of them should still be
// browsable once expanded. Falls back to scanning sibling .evidence-thumb elements (evidenceThumbsHtml_'s
// own grid, where every image IS already rendered) when that attribute isn't present.
document.addEventListener('click', function (e) {
  var el = e.target.closest ? e.target.closest('.evidence-thumb[data-lightbox-url]') : null;
  if (!el) return;
  e.preventDefault();
  var gallery = null, startIndex = 0;
  var b64 = el.getAttribute('data-gallery-b64');
  if (b64) {
    try {
      var urls = JSON.parse(atob(b64));
      gallery = urls.map(function (u) { return { full: driveEvidenceThumbUrl_(u, 1600) || u, original: u }; });
      startIndex = gallery.length - 1; // the rendered thumb is always the LAST image (REQ: "last image thumbnail")
    } catch (err) { gallery = null; }
  } else if (el.parentElement) {
    var siblings = Array.prototype.slice.call(el.parentElement.querySelectorAll('.evidence-thumb[data-lightbox-url]'));
    if (siblings.length > 1) {
      gallery = siblings.map(function (s) { return { full: s.getAttribute('data-lightbox-url'), original: s.getAttribute('href') }; });
      startIndex = siblings.indexOf(el);
    }
  }
  openEvidenceLightbox_(el.getAttribute('data-lightbox-url'), el.getAttribute('href'), gallery, startIndex);
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
    Low: { label: t('risk_low'), color: 'var(--success)', soft: 'var(--success-soft)' },
    // REQ follow-up: "risk level Info that sits below Low" -- reuses the app's info blue, same as
    // UI.riskBadge's badge-info (calmer than the red/amber/green severity progression above).
    Info: { label: t('risk_info'), color: 'var(--info)', soft: 'var(--info-soft)' }
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
              '<div style="margin-top:10px;">' + evidenceThumbsHtml_(f.evidenceUrls, 140, f.evidenceMeta) + '</div>' +
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

// REQ: "A second rejection lands on Rejected, which is terminal, but automatically creates a new
// instance from the rejected log and lands it in Open." finding.recreatedFrom/recreatedInto (both
// optional, viewFinding enrichment, Findings.gs) are mutually exclusive in practice -- a finding is
// either the fresh replacement (recreatedFrom set) or the exhausted original (recreatedInto set,
// only possible once its own status is already Rejected), never both.
function findingRecreationBannerHtml_(finding, eventId) {
  function link_(id) { return '#/events/' + eventId + '/findings/' + id; }
  if (finding.recreatedFrom) {
    return '<div class="card" style="margin-bottom:16px;border-left:4px solid var(--info);"><div class="card-body">' +
      '<div style="font-weight:700;font-size:12.5px;color:var(--info);margin-bottom:4px;">' + esc(t('recreated_from_banner_title')) + '</div>' +
      '<div style="font-size:13px;">' + esc(t('recreated_from_banner_body')) + ' ' +
        '<a href="' + link_(finding.recreatedFrom.id) + '">' + esc(finding.recreatedFrom.description || finding.recreatedFrom.id) + '</a>' +
      '</div></div></div>';
  }
  if (finding.recreatedInto) {
    return '<div class="card" style="margin-bottom:16px;border-left:4px solid var(--warning);"><div class="card-body">' +
      '<div style="font-weight:700;font-size:12.5px;color:var(--warning);margin-bottom:4px;">' + esc(t('recreated_into_banner_title')) + '</div>' +
      '<div style="font-size:13px;">' + esc(t('recreated_into_banner_body')) + ' ' +
        '<a href="' + link_(finding.recreatedInto.id) + '">' + esc(finding.recreatedInto.description || finding.recreatedInto.id) + '</a>' +
      '</div></div></div>';
  }
  return '';
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

/* ---------------- Log Assistance Guide suggestions (shared by New + Edit Finding) ----------------
 * REQ: "Some inspectors are junior level and could use help. We have created a guide which should
 * give them a list of descriptions once they select the category and sub-category." findingGuide is
 * the full FindingGuide catalogue (listFindingGuide, backend/FindingGuide.gs) -- matched here by
 * exact string against the selected Discipline's name and the Checklist Type field's value, same
 * "match by name" convention ChecklistItems.category already uses against Disciplines.
 */
// Guide subCategories available under a Discipline name -- unioned into the Checklist Type dropdown
// (renderChecklistTypeOptions_ in both forms below) alongside whatever real ChecklistItems.checklistType
// values already exist, so a category with guide coverage but no checklist items yet still offers
// something to pick.
function findingGuideTypesFor_(findingGuide, disciplineName) {
  if (!disciplineName) return [];
  return Array.from(new Set(findingGuide.filter(function (g) { return g.category === disciplineName; }).map(function (g) { return g.subCategory; }).filter(Boolean)));
}

// Renders the clickable suggested-description list into #fgSuggestions for the currently selected
// Discipline + Checklist Type, or hides it when there's nothing to suggest. Clicking a suggestion
// fills the Description + Suggested Action fields -- both stay fully editable afterward, this is a
// starting point, not a lock (same "suggestion, not a lock" spirit as the participant-driven
// Discipline pre-fill above).
function renderFindingGuideSuggestions_(findingGuide, disciplineName, checklistType, descInput, actionInput) {
  var box = document.getElementById('fgSuggestions');
  if (!box) return;
  var matches = (disciplineName && checklistType)
    ? findingGuide.filter(function (g) { return g.category === disciplineName && g.subCategory === checklistType; })
    : [];
  if (!matches.length) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  box.classList.remove('hidden');
  box.innerHTML = '<div class="finding-guide-suggestions-header">' + esc(t('suggested_descriptions')) + '</div>' +
    matches.map(function (g, i) {
      return '<div class="finding-guide-suggestion-item" data-fg-idx="' + i + '">' + esc(g.description) + '</div>';
    }).join('');
  box.querySelectorAll('[data-fg-idx]').forEach(function (el) {
    // mousedown+preventDefault (not click) -- same pattern as the Participant suggest box above,
    // fires before the textarea's own blur handling.
    el.addEventListener('mousedown', function (e) {
      e.preventDefault();
      var match = matches[Number(el.getAttribute('data-fg-idx'))];
      descInput.value = match.description;
      if (match.suggestion) actionInput.value = match.suggestion;
    });
  });
}

/* ---------------- Add Log picker (route: #/add-log) ---------------- */
// REQ: "Add Log sidebar, which allows inspector to add logs to any event under his inspection
// company. it only works if he is inside a venue boundary or no more than 50 meters from an
// event." Unlike the Risk Logging tab inside an Event workspace (scoped to whichever one event
// you already have open), this is a cross-event entry point: it lists every event under the
// Inspector's own Inspection Company (listEvents already scopes to user.orgId for
// orgType === 'INSPECTION' -- see Events.gs), fetched with includeVenue so each row carries its
// venue's boundary, and gates a "Add Log" action per row on the device's live GPS being inside
// that venue's drawn boundary or within 50m of it (distanceToPolygonMeters_/pointInPolygonClient_,
// venues.js). Picking an eligible event just navigates into the existing, already-built
// #/events/:id/findings/new page (renderNewFinding below) -- no duplicate form here.
var ADD_LOG_PROXIMITY_M_ = 50;
var addLogWatchId_ = null;

function destroyAddLogWatch_() {
  if (addLogWatchId_ != null && navigator.geolocation) { navigator.geolocation.clearWatch(addLogWatchId_); }
  addLogWatchId_ = null;
}

async function renderAddLogPicker_() {
  var root = document.getElementById('viewRoot');
  destroyAddLogWatch_();
  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + esc(t('add_log_picker_title')) + '</div>' +
    '<div class="page-subtitle">' + esc(t('add_log_picker_hint')) + '</div></div></div>' +
    '<div class="card"><div class="card-body">' +
    '<div id="addLogStatus" class="muted" style="font-size:12px;margin-bottom:10px;">' + esc(t('add_log_locating')) + '</div>' +
    '<div id="addLogListWrap"></div>' +
    '</div></div>';

  var events = [];
  try { events = await Api.call('listEvents', { includeVenue: true, status: 'Active' }); } catch (e) { events = []; }

  function renderRows(pos) {
    var statusEl = document.getElementById('addLogStatus');
    var wrap = document.getElementById('addLogListWrap');
    if (!wrap) return; // navigated away
    if (!pos) {
      if (statusEl) statusEl.textContent = t('add_log_location_error');
    } else if (statusEl) {
      statusEl.textContent = '';
    }
    if (!events.length) {
      wrap.innerHTML = '<div class="muted" style="font-size:13px;">' + esc(t('add_log_no_events')) + '</div>';
      return;
    }
    var rows = events.map(function (e) {
      var boundary = parseBoundaryClient_(e.venueBoundary);
      var eligible = false, distanceM = null;
      if (pos && boundary) {
        var lat = pos.coords.latitude, lng = pos.coords.longitude;
        distanceM = distanceToPolygonMeters_(lat, lng, boundary);
        eligible = distanceM <= ADD_LOG_PROXIMITY_M_;
      }
      return Object.assign({}, e, { _eligible: eligible, _distanceM: distanceM });
    });
    wrap.innerHTML = UI.table([
      { key: 'name', label: t('col_name') },
      { key: 'venueName', label: Term('venue'), render: r => esc(r.venueName || '—') },
      { key: '_eligible', label: t('col_status'), render: r =>
          r._eligible
            ? '<span class="badge badge-resolved">' + esc(t('add_log_eligible_badge')) + '</span>'
            : '<span class="badge badge-neutral">' + esc(t('add_log_ineligible_badge')) +
              (r._distanceM != null ? ' · ' + Math.round(r._distanceM) + 'm' + esc(t('add_log_distance_suffix')) : '') + '</span>'
      },
      { key: 'actions', label: t('actions'), render: r =>
          r._eligible
            ? '<button class="btn btn-primary btn-sm" data-add-log-event="' + esc(r.id) + '">' + esc(t('add_log_go_btn')) + '</button>'
            : '<button class="btn btn-secondary btn-sm" disabled>' + esc(t('add_log_go_btn')) + '</button>'
      }
    ], rows, {});
    wrap.querySelectorAll('[data-add-log-event]').forEach(function (btn) {
      btn.onclick = function () {
        destroyAddLogWatch_();
        window.location.hash = '#/events/' + btn.getAttribute('data-add-log-event') + '/findings/new';
      };
    });
  }

  renderRows(null);
  if (navigator.geolocation) {
    addLogWatchId_ = navigator.geolocation.watchPosition(
      function (pos) { renderRows(pos); },
      function () { renderRows(null); },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    );
  } else {
    renderRows(null);
  }
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
  var disciplines = [], checklistItems = [], participants = [], findingGuide = [];
  try {
    // getEvent first, on its own -- listParticipants needs the event's venueId to scope the picker
    // to participants actually registered at this event's venue (same { venueId, eventId } pairing
    // eventPlaces.js's own Places tab uses); without venueId it would also pull in every OTHER
    // venue's permanent participants.
    var detail = await Api.call('getEvent', { eventId: eventId });
    var results = await Promise.all([
      Api.call('listDisciplines', {}), Api.call('listChecklistItems', {}),
      Api.call('listParticipants', { eventId: eventId, venueId: detail.venue ? detail.venue.id : '' }),
      // REQ: "Some inspectors are junior level and could use help. We have created a guide which
      // should give them a list of descriptions once they select the category and sub-category."
      Api.call('listFindingGuide', {})
    ]);
    disciplines = results[0]; checklistItems = results[1]; participants = results[2]; findingGuide = results[3];
  } catch (e) { /* fall back to whichever loaded -- the pickers below just end up with fewer options */ }
  var disciplinesById = {}; disciplines.forEach(function (d) { disciplinesById[d.id] = d; });

  root.innerHTML =
    '<div class="breadcrumb"><a href="#/events/' + eventId + '?tab=findings">' + esc(t('tab_findings')) + '</a></div>' +
    // REQ follow-up: "Change page title to 'New Log'." A separate key from finding_log_title (which
    // stays "Log {{term}}" -- still used for the submit button below) so the two don't drift together.
    '<div class="page-header"><div><div class="page-title">' + esc(t('new_log_page_title')) + '</div>' +
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
          '<div class="muted" style="font-size:11px;margin-top:4px;">🗺️ ' + esc(t('live_location_map_hint')) + '</div>' +
        '</div>' +
        UI.field(Term('discipline'), '<select id="fDiscipline" class="field-input"><option value="">—</option>' +
          disciplines.map(function (d) { return '<option value="' + esc(d.id) + '">' + esc(d.name) + '</option>'; }).join('') + '</select>') +
        // REQ (follow-up): "Move Checklist Type to be after Discipline."
        UI.field(Term('checklistType'), '<select id="fChecklistType" class="field-input"><option value="">' + esc(t('checklist_type_default_hint')) + '</option></select>') +
        // REQ follow-up: "Move Suggested description above description and make it a searchable
        // dropdown. User can search and accordingly Category and sub-category auto fill." Supersedes
        // the old Discipline+Checklist-Type-gated suggestion list (which only appeared after both were
        // picked) -- this is now the primary entry point: search across the whole Log Assistance Guide
        // catalogue by description/category/sub-category, and picking one fills Description + Suggested
        // Action AND drives Discipline + Checklist Type (see pickSuggestion_ below), instead of the
        // other way around.
        '<div class="field-group" style="position:relative;">' +
          '<label class="field-label" style="margin-top:0;">' + esc(t('suggested_descriptions')) + '</label>' +
          '<input id="fSuggestSearch" class="field-input" placeholder="' + esc(t('suggested_description_search_placeholder')) + '" autocomplete="off" />' +
          '<div id="fSuggestBox" class="chat-suggest-box" style="display:none;"></div>' +
        '</div>' +
        UI.field(t('description'), '<textarea id="fDesc" class="field-input" rows="3"></textarea>') +
        // REQ follow-up: "Add Log Location (editable field below Description)."
        UI.field(t('field_log_location'), '<input id="fLogLocation" class="field-input" />') +
        UI.field(t('suggested_action'), '<input id="fAction" class="field-input" />') +
        '<div class="form-row">' +
          UI.field(t('risk_level'), '<select id="fRisk" class="field-input"><option>Info</option><option>Low</option><option selected>Medium</option><option>High</option><option>Critical</option></select>') +
          UI.field(t('resolution_window_hours'), '<input id="fWindow" type="number" class="field-input" value="24" />') +
        '</div>' +
        '<div class="field-label" style="margin-top:8px;">' + esc(t('evidence_photo_video')) + '</div>' +
        // Same camera-only pattern (hidden file input + capture="environment") as the Resolve
        // section further down this file -- opens the device camera directly, no gallery/file picker.
        '<input type="file" id="fFindingFile" accept="image/*,video/*" capture="environment" style="display:none;" />' +
        '<button type="button" class="btn btn-secondary btn-icon" id="fFindingCameraBtn" title="' + esc(t('take_photo_video')) + '" aria-label="' + esc(t('take_photo_video')) + '">' + ICON('capture_photo') + '</button> ' +
        // REQ: "Throughout the platform Do not allow Log Photos in any section to upload from
        // device, unless permission is set for that specific role." evidence.uploadFromDevice bypass.
        (hasPermission('evidence.uploadFromDevice')
          ? '<input type="file" id="fFindingFileAlt" accept="image/*,video/*" style="display:none;" multiple />' +
            '<button type="button" class="btn btn-secondary btn-icon" id="fFindingUploadBtn" title="' + esc(t('upload_from_device_btn')) + '" aria-label="' + esc(t('upload_from_device_btn')) + '">' + ICON('upload') + '</button>'
          : '') +
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
          // REQ follow-up: "While live on map show estimated distance from real location like: 5 m
          // etc..." -- how far the inspector's own live GPS dot currently is from the selected
          // Participant's registered ("real") location, updated on every watchPosition tick (see
          // updateFindingLocationDistance_ below).
          '<div id="findingLocationDistance" class="muted" style="font-size:11.5px;margin-top:4px;"></div>' +
        '</div>' +
      '</div>' +
    '</div>';

  document.getElementById('backFindingBtn').onclick = function () { destroyFindingLocationMap_(); window.location.hash = '#/events/' + eventId + '?tab=findings'; };
  // pickParticipant_ is declared with `function` below (hoisted -- already fully defined by the time
  // this runs, even though it's textually further down this same function body), so it's safe to
  // hand it straight to the map as the dot-click callback here.
  initFindingLocationMap_(detail && detail.venue, detail && detail.zones, participants, function (pt) { pickParticipant_(pt); });

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
    // REQ follow-up: "While live on map show estimated distance from real location." Refresh
    // immediately using whatever GPS fix is already on record (updateFindingLocationDistance_ below
    // is a no-op until a fix exists -- the next watchPosition tick fills it in either way).
    findingLocationSelectedParticipant_ = pt;
    updateFindingLocationDistance_();
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
    // REQ: "...a list of descriptions once they select the category and sub-category." Guide
    // subCategories for this Discipline are unioned in so a category with Log Assistance Guide
    // coverage but no real checklist items yet still offers something to pick.
    var types = Array.from(new Set(relevant.map(function (i) { return i.checklistType; }).concat(findingGuideTypesFor_(findingGuide, disciplineName)).filter(Boolean))).sort();
    typeSelect.innerHTML = '<option value="">— (defaults to Other)</option>' +
      types.map(function (ty) { return '<option value="' + esc(ty) + '">' + esc(ty) + '</option>'; }).join('');
    if (types.indexOf(prev) !== -1) typeSelect.value = prev;
  }
  document.getElementById('fDiscipline').addEventListener('change', renderChecklistTypeOptions_);
  renderChecklistTypeOptions_();

  /* ---- Suggested description: searchable dropdown (REQ follow-up) ----
   * Searches the whole Log Assistance Guide catalogue (findingGuide) by description/category/
   * sub-category -- unlike the old Discipline+Checklist-Type-gated list, this works before either is
   * picked. Choosing a match fills Description + Suggested Action and drives Discipline + Checklist
   * Type from that guide entry's own category/subCategory (match-by-name, same convention
   * ChecklistItems.category already uses against Disciplines) -- a starting point, still fully
   * editable afterward, same "suggestion, not a lock" spirit as the participant-driven Discipline
   * pre-fill above. */
  var sSearch = document.getElementById('fSuggestSearch');
  var sSuggest = document.getElementById('fSuggestBox');
  var sMatches = [];
  function renderSuggestBox_(query) {
    var q = (query || '').toLowerCase();
    sMatches = !q ? findingGuide.slice(0, 20) : findingGuide.filter(function (g) {
      return (g.description && g.description.toLowerCase().indexOf(q) !== -1) ||
        (g.category && g.category.toLowerCase().indexOf(q) !== -1) ||
        (g.subCategory && g.subCategory.toLowerCase().indexOf(q) !== -1);
    });
    sSuggest.innerHTML = '<div class="chat-suggest-header">' + esc(t('suggested_descriptions')) + '</div>' +
      (sMatches.length
        ? sMatches.slice(0, 20).map(function (g, i) {
            return '<div class="chat-suggest-item" data-idx="' + i + '">' + esc(g.description) +
              '<span class="muted" style="font-size:11px;"> · ' + esc(g.category) + (g.subCategory ? ' / ' + esc(g.subCategory) : '') + '</span></div>';
          }).join('')
        : '<div class="chat-suggest-empty">' + esc(t('no_matches_suggest')) + '</div>');
    sSuggest.style.display = '';
    sSuggest.querySelectorAll('.chat-suggest-item').forEach(function (el) {
      // mousedown+preventDefault (not click) -- same pattern as the Participant suggest box above,
      // fires before the input's own blur handling.
      el.addEventListener('mousedown', function (e) {
        e.preventDefault();
        pickSuggestion_(sMatches[Number(el.getAttribute('data-idx'))]);
      });
    });
  }
  function pickSuggestion_(g) {
    sSearch.value = g.description;
    sSuggest.style.display = 'none';
    document.getElementById('fDesc').value = g.description;
    if (g.suggestion) document.getElementById('fAction').value = g.suggestion;
    var disc = disciplines.filter(function (d) { return d.name === g.category; })[0];
    if (disc) {
      document.getElementById('fDiscipline').value = disc.id;
      renderChecklistTypeOptions_();
      if (g.subCategory) document.getElementById('fChecklistType').value = g.subCategory;
    }
  }
  sSearch.addEventListener('focus', function () { renderSuggestBox_(sSearch.value); });
  sSearch.addEventListener('input', function () { renderSuggestBox_(sSearch.value); });
  sSearch.addEventListener('keydown', function (e) { if (e.key === 'Escape') sSuggest.style.display = 'none'; });
  sSearch.addEventListener('blur', function () { setTimeout(function () { sSuggest.style.display = 'none'; }, 150); });

  /* ---- Evidence: photo or video, camera capture only ---- */
  var pendingFiles = { newFinding: [] };
  document.getElementById('fFindingCameraBtn').onclick = function () { document.getElementById('fFindingFile').click(); };
  document.getElementById('fFindingFile').onchange = function (e) {
    // REQ follow-up: "provide distance away from participant in meters." Only meaningful once a
    // Participant has actually been picked (selectedParticipant, above) -- a photo taken before that
    // simply gets no distance figure (still gets the plain outside-boundary flag either way).
    var participantPos = selectedParticipant ? { lat: selectedParticipant.lat, lng: selectedParticipant.lng } : null;
    Array.from(e.target.files).forEach(function (file) { uploadEvidenceFile_(eventId, 'newFinding', file, pendingFiles, false, participantPos); });
    e.target.value = '';
  };
  var fFindingUploadBtn = document.getElementById('fFindingUploadBtn');
  if (fFindingUploadBtn) {
    fFindingUploadBtn.onclick = function () { document.getElementById('fFindingFileAlt').click(); };
    document.getElementById('fFindingFileAlt').onchange = function (e) {
      var participantPos = selectedParticipant ? { lat: selectedParticipant.lat, lng: selectedParticipant.lng } : null;
      Array.from(e.target.files).forEach(function (file) { uploadEvidenceFile_(eventId, 'newFinding', file, pendingFiles, false, participantPos); });
      e.target.value = '';
    };
  }

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
    var btn = document.getElementById('createFindingBtn');
    // BUG FIX: "Logs are becoming doubles ... user pressing the submission button twice." A second
    // click before the first Api.call('createFinding', ...) round-trip finishes created a second,
    // near-identical Finding -- guard with the button's own disabled state (re-entrant onclick calls
    // are otherwise perfectly free to overlap) rather than a separate flag, so there's exactly one
    // source of truth and no way for it to drift out of sync with what the user actually sees.
    if (btn.disabled) return;
    if (!selectedParticipant) { UI.toast(t('toast_participant_required', { term: Term('participant') }), 'error'); return; }
    var disciplineId = document.getElementById('fDiscipline').value;
    if (!disciplineId) { UI.toast(t('toast_discipline_required', { term: Term('discipline') }), 'error'); return; }
    var files = pendingFiles.newFinding || [];
    var doneFiles = files.filter(function (f) { return f.status === 'done'; });
    var doneUrls = doneFiles.map(function (f) { return f.url; });
    // REQ follow-up: "Instead of showing 'OUTSIDE VENUE BOUNDARY' on photos make it a badge also
    // provide distance away from participant in meters." Metadata was attached onto each prepared
    // File at capture time (EvidenceCapture.prepare, evidence.js) -- collect it here, keyed by the
    // final Drive URL, so it can be persisted on the Finding (createFinding, Findings.gs) and shown as
    // a badge anywhere this evidence's thumbnail is rendered later.
    var evidenceMeta = doneFiles.map(function (f) {
      return {
        url: f.url,
        outsideBoundary: !!(f.file && f.file._hululOutsideBoundary),
        distanceMeters: (f.file && f.file._hululDistanceMeters != null) ? f.file._hululDistanceMeters : null
      };
    }).filter(function (m) { return m.outsideBoundary; }); // no badge to show -- no point carrying the row
    var stillUploading = files.some(function (f) { return f.status === 'uploading' || f.status === 'preparing'; });
    btn.disabled = true;
    try {
      var f = await Api.call('createFinding', Object.assign({
        eventId: eventId, participantId: selectedParticipant.id, disciplineId: disciplineId,
        description: document.getElementById('fDesc').value, suggestedAction: document.getElementById('fAction').value,
        category: document.getElementById('fChecklistType').value,
        // REQ follow-up: "Add Log Location (editable field below Description)." createFinding
        // (Findings.gs) already accepts location and falls back to the participant's own when blank.
        location: document.getElementById('fLogLocation').value,
        riskLevel: document.getElementById('fRisk').value, resolutionWindowHours: Number(document.getElementById('fWindow').value),
        evidenceUrls: doneUrls, evidenceMeta: evidenceMeta
        // REQ follow-up: findings used to always fall back to the participant's static coordinates,
        // never the inspector's actual live GPS fix, even though startFindingLocationWatch_ tracks
        // it the whole time this form is open (only used for the map/banner). Attach it when we have
        // one -- createFinding (Findings.gs) still falls back to the participant's own lat/lng when
        // this is omitted (no fix yet, denied, or unsupported browser).
      }, findingLocationLastCoords_ ? { lat: findingLocationLastCoords_.lat, lng: findingLocationLastCoords_.lng } : {}));
      if (stillUploading) {
        UI.toast(t('toast_x_logged_uploading', { term: Term('finding') }), 'success');
        attachFindingEvidenceInBackground_(f.id, files, doneUrls);
      } else {
        UI.toast(t('toast_x_logged', { term: Term('finding') }), 'success');
      }
      destroyFindingLocationMap_();
      window.location.hash = '#/events/' + eventId + '/findings/' + f.id;
    } catch (err) { UI.error(err); btn.disabled = false; }
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

  var disciplines = [], checklistItems = [], participants = [], findingGuide = [];
  try {
    var detail = await Api.call('getEvent', { eventId: eventId });
    var results = await Promise.all([
      Api.call('listDisciplines', {}), Api.call('listChecklistItems', {}),
      Api.call('listParticipants', { eventId: eventId, venueId: detail.venue ? detail.venue.id : '' }),
      Api.call('listFindingGuide', {})
    ]);
    disciplines = results[0]; checklistItems = results[1]; participants = results[2]; findingGuide = results[3];
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
      UI.field(Term('checklistType'), '<select id="fChecklistType" class="field-input"><option value="">' + esc(t('checklist_type_default_hint')) + '</option></select>') +
      UI.field(t('description'), '<textarea id="fDesc" class="field-input" rows="3">' + esc(finding.description || '') + '</textarea>') +
      '<div id="fgSuggestions" class="finding-guide-suggestions hidden"></div>' +
      UI.field(t('suggested_action'), '<input id="fAction" class="field-input" value="' + esc(finding.suggestedAction || '') + '" />') +
      UI.field(t('risk_level'), '<select id="fRisk" class="field-input">' +
        ['Info', 'Low', 'Medium', 'High', 'Critical'].map(function (r) { return '<option' + (finding.riskLevel === r ? ' selected' : '') + '>' + r + '</option>'; }).join('') + '</select>') +
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
    // REQ: "...a list of descriptions once they select the category and sub-category." Guide
    // subCategories for this Discipline are unioned in, same as the New Finding form above.
    var types = Array.from(new Set(relevant.map(function (i) { return i.checklistType; }).concat(findingGuideTypesFor_(findingGuide, disciplineName)).filter(Boolean))).sort();
    typeSelect.innerHTML = '<option value="">— (defaults to Other)</option>' +
      types.map(function (ty) { return '<option value="' + esc(ty) + '">' + esc(ty) + '</option>'; }).join('');
    if (types.indexOf(prev) !== -1) typeSelect.value = prev;
    updateFindingGuideSuggestions_();
  }
  function updateFindingGuideSuggestions_() {
    var disciplineId = document.getElementById('fDiscipline').value;
    var disciplineName = disciplineId && disciplinesById[disciplineId] ? disciplinesById[disciplineId].name : '';
    renderFindingGuideSuggestions_(findingGuide, disciplineName, document.getElementById('fChecklistType').value, document.getElementById('fDesc'), document.getElementById('fAction'));
  }
  document.getElementById('fDiscipline').addEventListener('change', renderChecklistTypeOptions_);
  document.getElementById('fChecklistType').addEventListener('change', updateFindingGuideSuggestions_);
  renderChecklistTypeOptions_();
  // A stored category of exactly 'Other' is indistinguishable from "left blank at creation" (both
  // collapse to the same value server-side, see createFinding) -- shown as blank here too, same as
  // the New Finding form's own convention.
  document.getElementById('fChecklistType').value = (finding.category && finding.category !== 'Other') ? finding.category : '';
  // fChecklistType.value was set directly above (not via the change event renderChecklistTypeOptions_
  // already fired from), so the suggestion box needs its own explicit refresh here too.
  updateFindingGuideSuggestions_();

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
        // REQ follow-up: "distance away from participant in meters" -- carry the same per-file
        // metadata (attached onto entry.file at capture time, evidence.js) that createFinding's own
        // evidenceMeta payload sends for files that were already 'done' at submit time; addFindingEvidence
        // (Findings.gs) merges it in the same way.
        var meta = (entry.file && entry.file._hululOutsideBoundary) ? {
          outsideBoundary: true,
          distanceMeters: (entry.file._hululDistanceMeters != null) ? entry.file._hululDistanceMeters : null
        } : null;
        Api.call('addFindingEvidence', { findingId: findingId, evidenceUrl: entry.url, evidenceMeta: meta }).catch(function () {});
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
// Latest GPS fix from the watch below, { lat, lng } or null -- read by createFindingBtn's onclick
// (renderNewFinding) so a submitted finding carries the inspector's actual live position instead of
// only falling back to the participant's static location (createFinding, Findings.gs, still falls
// back to that when this is null -- no GPS fix yet, or the browser denied/lacks geolocation). Cleared
// whenever the map/watch is torn down or the position steps outside the venue boundary, matching the
// "never visible if outside the event's boundary" rule already enforced for the live dot itself.
var findingLocationLastCoords_ = null;
// GOLDEN RULE: "Users locations can never be visible if outside events boundaries." Parsed once per
// visit (initFindingLocationMap_, from the event's own venue) via parseBoundaryClient_ (venues.js,
// loaded app-wide) -- same client-side containment check used for eventDetail.js's liveInspectionMap.
// Read by updateFindingMyPosition_ below to hide this device's own live dot the moment it steps
// outside; findingLocationMap never broadcasts this position to any other user, so a client-side
// check is sufficient here (nothing server-side needs to change).
var findingLocationVenueBoundary_ = null;
// REQ follow-up: "While live on map show estimated distance from real location like: 5 m etc..."
// The currently-selected Participant (pickParticipant_ below), so updateFindingMyPosition_'s
// watchPosition tick has something to measure the live GPS fix against. Cleared on teardown same as
// the other findingLocation* module state above.
var findingLocationSelectedParticipant_ = null;

function stopFindingLocationWatch_() {
  if (findingLocationWatchId_ != null && navigator.geolocation) { navigator.geolocation.clearWatch(findingLocationWatchId_); findingLocationWatchId_ = null; }
}
function destroyFindingLocationMap_() {
  stopFindingLocationWatch_();
  if (findingLocationResizeObserver_) { findingLocationResizeObserver_.disconnect(); findingLocationResizeObserver_ = null; }
  if (findingLocationMapInstance_) { findingLocationMapInstance_.remove(); findingLocationMapInstance_ = null; }
  findingLocationMyMarker_ = null;
  findingLocationVenueBoundary_ = null;
  findingLocationLastCoords_ = null;
  findingLocationSelectedParticipant_ = null;
}

// REQ follow-up: "While live on map show estimated distance from real location like: 5 m etc..."
// Distance between the inspector's own live GPS fix (findingLocationLastCoords_) and the selected
// Participant's registered location -- haversineKm_ (venues.js) is the same great-circle helper used
// for every other "how far is X from Y" figure in the app (live-inspection nearest-participant label,
// Log Photos grouping, etc.). No-ops (clears the line) whenever either half is missing -- no GPS fix
// yet, no participant picked yet, or the participant has no registered coordinates.
function updateFindingLocationDistance_() {
  var el = document.getElementById('findingLocationDistance');
  if (!el) return;
  var pt = findingLocationSelectedParticipant_;
  var hasParticipantCoords = pt && pt.lat !== '' && pt.lat != null && pt.lng !== '' && pt.lng != null;
  if (!findingLocationLastCoords_ || !hasParticipantCoords) { el.innerHTML = ''; return; }
  var meters = Math.round(haversineKm_(findingLocationLastCoords_.lat, findingLocationLastCoords_.lng, Number(pt.lat), Number(pt.lng)) * 1000);
  el.innerHTML = ICON('location_pin') + ' ' + esc(t('live_distance_from_participant', { m: meters, name: pt.name }));
}

// onParticipantClick (optional): REQ ("live location side map") -- lets an inspector tap a
// participant's dot on this map to pick them, instead of only the searchable text dropdown. Was
// a "coming soon" placeholder under the search box; UI.drawPlaceDots (ui.js) already supported a
// per-dot click callback (used elsewhere, e.g. eventPlaces.js) -- this map just never passed one in.
function initFindingLocationMap_(venue, zones, participants, onParticipantClick) {
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
    hululTileLayer_().addTo(findingLocationMapInstance_);

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
    UI.drawPlaceDots(findingLocationMapInstance_, participants, onParticipantClick);
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
    findingLocationLastCoords_ = null; // outside the venue boundary -- don't attach this fix to the finding either
    if (banner) banner.innerHTML = '<div class="muted" style="font-size:11.5px;">' + ICON('warning_banner') + ' ' + esc(t('outside_boundary_banner')) + '</div>';
    updateFindingLocationDistance_(); // no fix to measure from anymore -- clears the distance line
    return;
  }
  findingLocationLastCoords_ = { lat: latlng[0], lng: latlng[1] };
  updateFindingLocationDistance_();
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
  // reviewFindingResolution, Findings.gs), not isParticipantRole_/FINDING_ROLE_REVIEWER_ (those two
  // still gate unrelated things -- the Chat and Log Photos tab visibility in eventDetail.js -- and are
  // deliberately left as-is for now).
  var isParticipant = hasPermission('finding.resolve');
  var isReviewer = hasPermission('finding.review');
  // REQ ("Opening checklists are done against the venue not participants, but they can assign
  // operational participants to resolve the raised log"): who's responsible for THIS finding can be
  // set/changed from here any time before it's closed -- gated on the finding.assignParticipant
  // permission, separate from resolve/review since assigning responsibility isn't the same action as
  // submitting or reviewing the fix.
  var canAssign = hasPermission('finding.assignParticipant') && finding.status !== 'Resolved';
  var operators = [];
  if (canAssign) {
    try {
      var eventForAssign = await Api.call('getEvent', { eventId: eventId });
      var venueIdForAssign = eventForAssign && eventForAssign.venue ? eventForAssign.venue.id : '';
      var allParticipantsForAssign = venueIdForAssign ? await Api.call('listParticipants', { eventId: eventId, venueId: venueIdForAssign }) : [];
      operators = allParticipantsForAssign.filter(function (pt) { return pt.type === 'Operator'; });
    } catch (e) { /* best-effort -- the assign control below just shows an empty picker */ }
  }
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

    // REQ: "A second rejection lands on Rejected, which is terminal, but automatically creates a new
    // instance from the rejected log and lands it in Open." Surfaces both directions of that link --
    // recreatedFrom (this IS the fresh replacement) and recreatedInto (this IS the exhausted original,
    // now superseded) -- see viewFinding's enrichment, Findings.gs.
    findingRecreationBannerHtml_(finding, eventId) +

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
          // REQ: "Throughout the platform change: Discipline to Category." Discipline now displays as
          // "Category" (chip above), so this chip -- which actually shows finding.category (the New
          // Finding form's own Checklist Type field, see the REQ log at eventDetail.js's findings
          // table below) -- is relabeled to Term('checklistType') too, both to stay consistent with
          // what it really holds and to avoid two differently-meaning chips both saying "Category".
          findingMetaChipHtml_('📋', Term('checklistType'), esc([finding.category, finding.subCategory].filter(Boolean).join(' / ') || '—')) +
          findingMetaChipHtml_('🕓', t('logged'), UI.fmtDate(finding.createdAt)) +
          findingMetaChipHtml_('⏱️', t('resolution_window'), UI.fmtDate(finding.resolutionWindowAt)) +
          // Not in the requested list (no Location field going forward -- see createFinding's own
          // header comment) but still shown, tacked onto the end, for older records that have one.
          (finding.location ? findingMetaChipHtml_('🧭', t('location'), esc(finding.location)) : '') +
        '</div>' +
        // REQ: "Any log created through a checklist must be traceable to that specific item in the
        // checklist." checklistItemDescription (viewFinding enrichment, Findings.gs) is only present
        // when this finding was auto-created from a Crossed checklist item -- blank on manually
        // logged findings (Log Finding has no single checklist item to point at), so this line simply
        // doesn't render for those. REQ follow-up: "are logs identifiable and traceable back to that
        // checklist item?" -- the description is now a link into the Checklist Items catalog
        // (#/checklist-items?itemId=..., checklistItems.js), which scrolls to and highlights that
        // exact row, instead of just naming it in plain text. t()'s interpolation is a raw string
        // replace (see i18n.js), so the pre-built <a> tag below is safe to pass straight through as
        // the {{description}} value -- only the link's own visible text needs esc(), not the tag.
        (finding.checklistItemDescription
          ? '<div class="muted" style="font-size:12px;margin:-8px 0 16px;">' + t('checklist_item_traceability', {
              description: '<a href="#/checklist-items?itemId=' + esc(finding.checklistItemId) + '" style="color:var(--accent);font-weight:600;">' + esc(finding.checklistItemDescription) + '</a>'
            }) + '</div>'
          : '') +
        '<div style="background:var(--surface);border-radius:var(--radius-md);padding:14px 16px;margin-bottom:16px;">' +
          '<div class="field-label" style="margin-top:0;">' + esc(t('description')) + '</div>' +
          '<div style="font-size:15px;line-height:1.55;margin-top:4px;color:var(--text-900);">' + esc(finding.description || '—') + '</div>' +
        '</div>' +
        (finding.suggestedAction
          ? '<div style="margin-bottom:16px;">' + detailField_(t('suggested_action'), esc(finding.suggestedAction)) + '</div>'
          : '') +
        '<div class="field-label" style="margin-bottom:8px;">' + esc(t('risk_logging_evidence')) + '</div>' +
        evidenceThumbsHtml_(finding.evidenceUrls, 168, finding.evidenceMeta, { findingId: findingId, deletable: true }) +
      '</div>' +
    '</div>' +

    (latestRejected && finding.status === 'ReOpen'
      ? '<div class="card" style="margin-bottom:16px;border-left:4px solid var(--danger);"><div class="card-body">' +
          '<div style="font-weight:700;font-size:12.5px;color:var(--danger);margin-bottom:4px;">' + esc(t('rejected_by_inspector')) +
          esc(t('rejected_fix_resubmit')) + '</div>' +
          '<div style="font-size:13px;">' + esc(latestRejected.comments || '—') + '</div></div></div>'
      : '') +

    assignOperatorSectionHtml_(finding, canAssign, operators) +

    findingActionSectionHtml_(finding, isParticipant, isReviewer, latestPending) +

    (resolutions.length
      ? '<div class="card"><div class="card-header"><div class="card-title">' + esc(t('resolution_history')) + '</div>' +
        '<div class="muted" style="font-size:11.5px;">' + esc(t('resolution_history_subtitle', { term: Term('participant').toLowerCase() })) + '</div></div>' +
        '<div class="card-body">' + resolutions.map(findingResolutionHistoryRowHtml_).join('') + '</div></div>'
      : '');

  document.getElementById('backFindingBtn').onclick = function () { window.location.hash = '#/events/' + eventId + '?tab=findings'; };
  wireEvidenceThumbDeletes_(root, function () { Router.resolve(); });
  wireFindingActionSection_(eventId, finding, isParticipant, isReviewer, latestPending);
  if (canAssign) {
    document.getElementById('saveAssignOperatorBtn').onclick = async function () {
      var select = document.getElementById('fAssignOperator');
      try {
        await Api.call('assignFindingParticipant', { findingId: findingId, participantId: select.value });
        UI.toast(t('toast_operator_assigned'), 'success');
        Router.resolve();
      } catch (err) { UI.error(err); }
    };
  }
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

// REQ ("Opening checklists are done against the venue not participants, but they can assign
// operational participants to resolve the raised log"): renders nothing at all when canAssign is
// false (finding.assignParticipant permission missing, or the finding's already closed) -- same
// "just don't show it" pattern as findingActionSectionHtml_ below, not a disabled control.
function assignOperatorSectionHtml_(finding, canAssign, operators) {
  if (!canAssign) return '';
  var options = '<option value="">' + esc(t('assign_operator_unassigned_option')) + '</option>' +
    operators.map(function (o) { return '<option value="' + esc(o.id) + '"' + (o.id === finding.participantId ? ' selected' : '') + '>' + esc(o.name) + '</option>'; }).join('');
  return '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + esc(t('assign_operator_title')) + '</div></div>' +
    '<div class="card-body">' +
      (operators.length ? '' : '<div class="muted" style="font-size:12px;margin-bottom:8px;">' + esc(t('assign_operator_none_hint')) + '</div>') +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
        '<select id="fAssignOperator" class="field-input" style="max-width:280px;">' + options + '</select>' +
        '<button class="btn btn-primary btn-sm" id="saveAssignOperatorBtn">' + esc(t('save')) + '</button>' +
      '</div>' +
    '</div></div>';
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
        '<button type="button" class="btn btn-secondary btn-icon" id="fResolveCameraBtn" title="' + esc(t('take_photo_video')) + '" aria-label="' + esc(t('take_photo_video')) + '">' + ICON('capture_photo') + '</button> ' +
        // REQ: "Throughout the platform Do not allow Log Photos in any section to upload from
        // device, unless permission is set for that specific role." evidence.uploadFromDevice bypass.
        (hasPermission('evidence.uploadFromDevice')
          ? '<input type="file" id="fResolveFileAlt" accept="image/*,video/*" style="display:none;" multiple />' +
            '<button type="button" class="btn btn-secondary btn-icon" id="fResolveUploadBtn" title="' + esc(t('upload_from_device_btn')) + '" aria-label="' + esc(t('upload_from_device_btn')) + '">' + ICON('upload') + '</button>'
          : '') +
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
    var fResolveUploadBtn = document.getElementById('fResolveUploadBtn');
    if (fResolveUploadBtn) {
      fResolveUploadBtn.onclick = function () { document.getElementById('fResolveFileAlt').click(); };
      document.getElementById('fResolveFileAlt').onchange = function (e) {
        Array.from(e.target.files).forEach(function (file) { uploadEvidenceFile_(eventId, 'resolve', file, pendingFiles); });
        e.target.value = '';
      };
    }
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
      try {
        // REQ follow-up: "keep all rejections going back to re-open" -- every rejection lands on
        // ReOpen now (Findings.gs reviewFindingResolution), however many times a finding has already
        // been rejected, so there's just the one outcome/toast here.
        await Api.call('reviewFindingResolution', { findingId: finding.id, decision: 'Rejected', comments: comments });
        UI.toast(t('toast_resolution_rejected'), 'success');
        Router.resolve();
      } catch (err) { UI.error(err); }
    };
  }
}
