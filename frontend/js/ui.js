/**
 * HULUL - shared UI helpers: toasts, modals, badges, tables, formatting.
 */
window.UI = {
  // Error-type toasts are routed to a popup instead (see errorModal below) — every call site
  // across the app that does UI.toast(msg, 'error') for a validation message (empty CSV, missing
  // selection, etc.) automatically becomes a popup this way, with no need to touch each call site.
  toast(message, type) {
    if (type === 'error') { this.errorModal({ message: message }); return; }
    var root = document.getElementById('toastRoot');
    var el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.textContent = message;
    root.appendChild(el);
    setTimeout(function () { el.remove(); }, 3800);
  },

  error(err) {
    // A request cancelled by Router._abortController because the user navigated away (see api.js /
    // router.js) -- not a real failure, and by the time this runs the button/page that triggered it
    // is usually gone anyway. Every catch block across the app funnels here via UI.error(err), so
    // this one check covers all of them instead of needing every call site to special-case it.
    if (err && err.name === 'AbortError') return;
    console.error(err);
    if (err && err.code === 'FORBIDDEN') { this.permissionModal(err); return; }
    this.errorModal(err);
  },

  // Generic error popup for anything that isn't a FORBIDDEN permission error (those get the
  // richer permissionModal below, with contacts).
  errorModal(err) {
    var body = '<div style="font-size:13.5px;line-height:1.6;">' + esc(err && err.message ? err.message : 'Something went wrong') + '</div>';
    this.openModal('Error', body, [{ label: 'OK', className: 'btn-primary', onClick: UI.closeModal }]);
  },

  // Replaces the browser's native window.confirm() with a popup in the app's own style.
  // onConfirm can be async; the modal closes first either way so a slow request doesn't leave a
  // stuck dialog on screen.
  confirmModal(message, onConfirm, opts) {
    opts = opts || {};
    var body = '<div style="font-size:13.5px;line-height:1.6;">' + esc(message) + '</div>';
    this.openModal(opts.title || 'Are you sure?', body, [
      { label: opts.cancelLabel || t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
      { label: opts.confirmLabel || 'Confirm', className: opts.confirmClass || 'btn-danger', onClick: function () {
          UI.closeModal();
          onConfirm();
        } }
    ]);
  },

  // Live progress bar shown while a batch of async operations (CSV row imports, etc.) runs, so
  // the user sees something is happening instead of the app appearing to hang for however long
  // the row-by-row API calls take. Call .update(current, label) after each item completes, then
  // UI.closeModal() when done (typically right before showing a results modal).
  progressModal(title, total) {
    var body =
      '<div id="progressLabel" style="font-size:13px;margin-bottom:10px;">Starting…</div>' +
      '<div style="background:#f1f3f9;border-radius:8px;height:10px;overflow:hidden;">' +
        '<div id="progressBarFill" style="background:var(--accent);height:100%;width:0%;transition:width .15s;"></div>' +
      '</div>';
    this.openModal(title, body, []);
    return {
      update: function (current, label) {
        var pct = total ? Math.min(100, Math.round((current / total) * 100)) : 0;
        var fill = document.getElementById('progressBarFill');
        var lbl = document.getElementById('progressLabel');
        if (fill) fill.style.width = pct + '%';
        if (lbl) lbl.textContent = label || (current + ' of ' + total + ' processed…');
      }
    };
  },

  // Shown instead of a toast for FORBIDDEN errors, since these need more room to explain
  // who *can* do this and — when the backend was able to work it out — who that is right now.
  permissionModal(err) {
    var body = '<div style="font-size:13.5px;line-height:1.6;">' + esc(err.message || 'You are not permitted to perform this action.') + '</div>';
    if (err.contacts && err.contacts.length) {
      body += '<div style="margin-top:14px;"><div class="field-label">Who to contact</div>' +
        err.contacts.map(function (c) {
          return '<div style="padding:8px 10px;background:#f6f7fb;border-radius:8px;margin-top:6px;font-size:13px;">' +
            '<strong>' + esc(c.name) + '</strong> — ' + esc(c.role) +
            (c.email ? '<br/><span class="muted">' + esc(c.email) + '</span>' : '') + '</div>';
        }).join('') + '</div>';
    }
    this.openModal('Not permitted', body, [{ label: 'OK', className: 'btn-primary', onClick: UI.closeModal }]);
  },

  openModal(title, bodyHtml, footerButtons) {
    var root = document.getElementById('modalRoot');
    root.innerHTML =
      '<div class="modal-box">' +
        '<div class="modal-header"><div class="modal-title">' + esc(title) + '</div>' +
        '<button class="btn btn-ghost btn-sm" id="modalCloseBtn">' + ICON('close_modal') + '</button></div>' +
        '<div class="modal-body">' + bodyHtml + '</div>' +
        '<div class="modal-footer" id="modalFooter"></div>' +
      '</div>';
    root.classList.remove('hidden');
    document.getElementById('modalCloseBtn').onclick = UI.closeModal;
    var footer = document.getElementById('modalFooter');
    (footerButtons || []).forEach(function (b) {
      var btn = document.createElement('button');
      btn.className = 'btn ' + (b.className || 'btn-secondary');
      btn.textContent = b.label;
      btn.onclick = b.onClick;
      footer.appendChild(btn);
    });
    return root;
  },
  closeModal() {
    var root = document.getElementById('modalRoot');
    root.classList.add('hidden');
    root.innerHTML = '';
  },

  statusBadge(status) {
    var map = {
      Open: ['badge-open', 'Open'], Viewed: ['badge-open', 'Viewed'],
      Submitted: ['badge-inreview', 'Submitted'], InReview: ['badge-inreview', 'In Review'],
      Resubmitted: ['badge-inreview', 'Resubmitted'], Resolved: ['badge-resolved', 'Resolved'],
      ReOpen: ['badge-reopen', 'Re-open'], Rejected: ['badge-rejected', 'Rejected'],
      Approved: ['badge-resolved', 'Approved'], 'Not Approved': ['badge-rejected', 'Not Approved'],
      // Readiness Templates (Templates.gs) -- formerly Approved/Rejected, renamed to avoid clashing
      // with the Venue Approval / Findings decisions above, which keep their own separate statuses.
      Evaluated: ['badge-resolved', 'Evaluated'], Missed: ['badge-rejected', 'Missed'],
      Pending: ['badge-neutral', 'Pending'], Scheduled: ['badge-open', 'Scheduled'], Completed: ['badge-resolved', 'Completed'],
      Planning: ['badge-neutral', 'Planning'], VenueApproved: ['badge-resolved', 'Venue Approved'], VenueRejected: ['badge-rejected', 'Venue Rejected'],
      // Support tickets (Support.gs) -- Open/Resolved/Completed/Rejected all reuse maps above.
      InProgress: ['badge-inreview', 'In Progress']
    };
    var m = map[status] || ['badge-neutral', status || '—'];
    return '<span class="badge ' + m[0] + '"><span class="badge-dot"></span>' + esc(m[1]) + '</span>';
  },

  riskBadge(risk) {
    var cls = risk === 'Critical' ? 'badge-critical' : risk === 'High' ? 'badge-high' : risk === 'Medium' ? 'badge-medium' : risk === 'Low' ? 'badge-low' : 'badge-neutral';
    return '<span class="badge ' + cls + '">' + esc(risk || '—') + '</span>';
  },

  // Every table built through here gets a filter box, sortable columns, and a CSV export button
  // for free -- no call site needs to opt in or change anything (existing signature/behavior is
  // unchanged; opts.toolbar:false is the only way to suppress it, for the rare table too trivial
  // to bother, e.g. a 2-row lookup list). Crucial constraint: once rendered, rows are NEVER
  // regenerated from data again -- sorting reorders the *existing* <tr> DOM nodes and filtering
  // just toggles their display, because callers routinely attach their own onclick handlers to
  // buttons inside these rows right after inserting this HTML (querySelectorAll('[data-x]')...),
  // and regenerating a row's innerHTML would silently drop those handlers.
  //
  // Per-column opt-outs: c.sortable = false / c.exportable = false. A column literally named
  // 'actions' is excluded from both automatically (that's the icon-button-only convention used
  // everywhere in this app). c.sortValue(row)/c.exportValue(row) can override what's compared or
  // exported when the visible render() output isn't the right thing to sort/export by.
  table(columns, rows, opts) {
    opts = opts || {};
    var toolbarOn = opts.toolbar !== false;

    function stripTags_(html) {
      return String(html == null ? '' : html).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    }
    function isExportable_(c) { return toolbarOn && c.exportable !== false && c.key !== 'actions'; }
    function isSortable_(c) { return toolbarOn && c.sortable !== false && c.key !== 'actions' && (c.key !== undefined || typeof c.sortValue === 'function'); }
    function plainText_(c, row) {
      if (typeof c.exportValue === 'function') { var v = c.exportValue(row); return v == null ? '' : String(v); }
      if (typeof c.render === 'function') return stripTags_(c.render(row));
      return row[c.key] != null ? String(row[c.key]) : '';
    }
    function sortValue_(c, row) {
      if (typeof c.sortValue === 'function') { var v = c.sortValue(row); return v == null ? '' : v; }
      if (c.key !== undefined) {
        var raw = row[c.key];
        if (raw !== undefined && raw !== null && typeof raw !== 'object') return raw;
      }
      return plainText_(c, row);
    }

    var head = columns.map(function (c, i) {
      var sortable = isSortable_(c);
      return '<th' + (sortable ? ' class="th-sortable" data-sort-idx="' + i + '"' : '') + '>' +
        esc(c.label) + (sortable ? ' <span class="th-sort-arrow"></span>' : '') + '</th>';
    }).join('');

    var body = rows.length
      ? rows.map(function (row) {
          var trAttrs = [];
          var searchParts = [];
          var cellsHtml = columns.map(function (c, i) {
            var html = typeof c.render === 'function' ? c.render(row) : esc(row[c.key] != null ? row[c.key] : '—');
            if (isExportable_(c)) {
              var txt = plainText_(c, row);
              trAttrs.push('data-tx-' + i + '="' + esc(txt) + '"');
              searchParts.push(txt.toLowerCase());
            }
            if (isSortable_(c)) trAttrs.push('data-sv-' + i + '="' + esc(String(sortValue_(c, row))) + '"');
            return '<td>' + html + '</td>';
          }).join('');
          return '<tr ' + trAttrs.join(' ') + ' data-search="' + esc(searchParts.join(' ')) + '">' + cellsHtml + '</tr>';
        }).join('')
      : '<tr class="table-empty-row"><td colspan="' + columns.length + '"><div class="empty-state">' + (opts.emptyText || t('no_data')) + '</div></td></tr>';
    body += '<tr class="table-filter-empty-row" style="display:none;"><td colspan="' + columns.length + '"><div class="empty-state">' + esc(t('no_matches')) + '</div></td></tr>';

    var toolbarHtml = '';
    var wrapAttrs = '';
    if (toolbarOn) {
      var exportCols = [];
      columns.forEach(function (c, i) { if (isExportable_(c)) exportCols.push(i); });
      var exportHeaders = exportCols.map(function (i) { return columns[i].label; });
      wrapAttrs = ' data-export-cols="' + exportCols.join(',') + '" data-export-headers="' + esc(JSON.stringify(exportHeaders)) + '" data-export-name="' + esc(opts.exportName || 'export.csv') + '"';
      toolbarHtml = '<div class="table-toolbar">' +
        '<input type="search" class="table-filter-input field-input" placeholder="' + esc(t('filter')) + '…" />' +
        (exportCols.length ? '<button type="button" class="btn btn-secondary btn-sm table-export-btn">' + ICON('export_csv') + ' ' + esc(t('export_csv')) + '</button>' : '') +
      '</div>';
    }

    return '<div class="table-wrap"' + wrapAttrs + '>' + toolbarHtml +
      '<table class="data-table"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>';
  },

  // String-vs-numeric-aware comparator used by the sort-on-header-click handler below: numbers
  // (including numeric strings) compare numerically, everything else (including ISO date strings,
  // which sort correctly as plain strings) falls back to a locale-aware string compare.
  compareValues(a, b) {
    var ea = (a === null || a === undefined || a === ''), eb = (b === null || b === undefined || b === '');
    if (ea && eb) return 0;
    if (ea) return -1;
    if (eb) return 1;
    var na = Number(a), nb = Number(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true });
  },

  csvEscape(v) {
    v = v == null ? '' : String(v);
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  },

  downloadCsv(filename, rows2d) {
    var csv = rows2d.map(function (r) { return r.map(UI.csvEscape).join(','); }).join('\r\n');
    var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  },

  fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  },

  // "2h 15m left" / "Overdue by 2h 15m" -- used by the Risk Logging pipeline cards to show time
  // remaining against a Finding's resolutionWindowAt without a full date/time (which doesn't fit a
  // small card and isn't what the reader needs at a glance anyway).
  fmtCountdown(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d)) return '—';
    var diffMs = d - new Date();
    var overdue = diffMs < 0;
    var abs = Math.abs(diffMs);
    var hours = Math.floor(abs / 3600000);
    var mins = Math.floor((abs % 3600000) / 60000);
    var label = hours > 0 ? (hours + 'h ' + mins + 'm') : (mins + 'm');
    return overdue ? ('Overdue ' + label) : (label + ' left');
  },

  field(label, inputHtml) {
    return '<label class="field-label">' + esc(label) + '</label>' + inputHtml;
  },

  // Kanban-style status board: one column per status, cards grouped into whichever column
  // matches their status. Click-to-open, not drag-and-drop — cards just call whatever onClick
  // the caller wires up (typically the same status-update modal already used by the table below).
  // columns: [{ label, cards: [{ id, title, meta, borderColor, bodyHtml }] }]
  // bodyHtml is optional -- if given, it fully replaces the default title/meta rendering (caller
  // supplies its own already-escaped HTML, same convention as UI.table's column render()); every
  // existing caller that only ever passed title/meta is unaffected.
  board(columns) {
    return '<div class="board-wrap" style="display:flex;gap:14px;overflow-x:auto;padding-bottom:6px;margin-bottom:18px;">' +
      columns.map(function (col) {
        return '<div style="min-width:220px;flex-shrink:0;">' +
          '<div style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text-600);margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">' +
            '<span>' + esc(col.label) + '</span>' +
            '<span style="background:var(--surface);color:var(--text-600);border-radius:10px;padding:1px 8px;font-size:11px;">' + col.cards.length + '</span>' +
          '</div>' +
          (col.cards.length
            ? col.cards.map(function (c) {
                return '<div class="board-card" data-board-card="' + esc(c.id) + '" style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:8px;border-left:4px solid ' + (c.borderColor || 'var(--border)') + ';cursor:pointer;">' +
                  (c.bodyHtml || (
                    '<div style="font-size:12.5px;font-weight:600;margin-bottom:3px;line-height:1.35;">' + esc(c.title) + '</div>' +
                    '<div style="font-size:11px;color:var(--text-600);">' + esc(c.meta || '') + '</div>'
                  )) +
                '</div>';
              }).join('')
            : '<div class="muted" style="font-size:11.5px;padding:6px 2px;">—</div>') +
        '</div>';
      }).join('') +
    '</div>';
  },

  // Wires every [data-board-card] rendered by UI.board() inside `root` to onClick(id). Call once
  // right after inserting the board's HTML.
  wireBoard(root, onClick) {
    root.querySelectorAll('[data-board-card]').forEach(function (el) {
      el.onclick = function () { onClick(el.getAttribute('data-board-card')); };
    });
  },

  // Adds a "expand to full screen" toggle button onto a Leaflet map's container div (REQ: drawing
  // a venue/zone boundary polygon is fiddly on the map's normal ~340px embedded height). Deliberately
  // NOT the browser Fullscreen API (element.requestFullscreen()) -- that has no effect on iOS Safari
  // for anything but <video>, which would silently do nothing on an iPhone/iPad, and this app is used
  // by on-site inspectors who are as likely to be on a phone as a desktop. Instead this just makes
  // the map div fill the viewport via CSS (position:fixed, see .hulul-map-fullscreen in styles.css),
  // which works identically everywhere.
  //
  // mapEl: the Leaflet container div (e.g. document.getElementById('venueMap')).
  // mapInstance: that div's Leaflet map instance, so invalidateSize() can be called once the resize
  //   transition settles -- otherwise Leaflet keeps rendering tiles sized for the old, smaller box.
  // extraControls: optional array of EXISTING DOM elements that live outside mapEl but need to stay
  //   usable while full screen (e.g. venues.js's Satellite / "Use my location" buttons, which render
  //   in the card header above the map, not inside it). Full screen makes the map cover the whole
  //   viewport via position:fixed -- BUG (REQ report): anything left behind in its original spot
  //   ends up invisible underneath it. These elements are reparented into an overlay inside the map
  //   while active, and put back exactly where they came from (same parent, same sibling position)
  //   the moment full screen is exited, so nothing else about the page's layout/behavior changes.
  // Returns a cleanup() function the caller's destroy*Map_() MUST call: it removes the keydown
  // listener (window-level, would otherwise pile up one per page visit and never get freed), puts
  // back any still-reparented extraControls, and un-locks body scroll -- in case the page was torn
  // down while still in full screen, so the rest of the app doesn't stay stuck non-scrollable.
  wireMapFullscreen(mapEl, mapInstance, extraControls) {
    if (!mapEl) return function () {};
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hulul-map-fullscreen-btn';
    btn.title = 'Expand map to full screen';
    btn.innerHTML = ICON('map_fullscreen_enter');
    mapEl.appendChild(btn);

    extraControls = (extraControls || []).filter(Boolean);
    var extraWrap = null;
    var parked = []; // [{el, parent, nextSibling}] -- only populated while active, so exit can undo it exactly
    if (extraControls.length) {
      extraWrap = document.createElement('div');
      extraWrap.className = 'hulul-map-fullscreen-extra-controls';
      mapEl.appendChild(extraWrap);
    }

    function parkExtraControls(park) {
      if (!extraWrap) return;
      if (park) {
        parked = extraControls.map(function (el) { return { el: el, parent: el.parentNode, nextSibling: el.nextSibling }; });
        extraControls.forEach(function (el) { extraWrap.appendChild(el); });
      } else if (parked.length) {
        // Reverse order: each record's nextSibling might be ANOTHER parked element that hasn't been
        // restored yet -- restoring last-parked-first guarantees that by the time any record's
        // nextSibling is looked up, it's already back in its original parent (or was never moved),
        // so insertBefore always has a valid target instead of silently falling through to
        // appendChild and scrambling the original order.
        parked.slice().reverse().forEach(function (rec) {
          if (rec.nextSibling && rec.nextSibling.parentNode === rec.parent) rec.parent.insertBefore(rec.el, rec.nextSibling);
          else rec.parent.appendChild(rec.el);
        });
        parked = [];
      }
    }

    var active = false;
    var controller = new AbortController();

    function toggle() {
      active = !active;
      mapEl.classList.toggle('hulul-map-fullscreen', active);
      document.body.classList.toggle('hulul-map-fullscreen-lock', active);
      btn.innerHTML = ICON(active ? 'map_fullscreen_exit' : 'map_fullscreen_enter');
      btn.title = active ? 'Exit full screen' : 'Expand map to full screen';
      parkExtraControls(active);
      // Matches the CSS transition length below; invalidateSize() needs the box to have already
      // reached its final size or Leaflet measures mid-transition and gets it wrong.
      setTimeout(function () { if (mapInstance) mapInstance.invalidateSize(); }, 220);
    }

    btn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); toggle(); }, { signal: controller.signal });
    window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && active) toggle(); }, { signal: controller.signal });

    return function cleanup() {
      controller.abort();
      document.body.classList.remove('hulul-map-fullscreen-lock');
      if (active) parkExtraControls(false);
    };
  },

  // REQ: "Move the Use my location / Satellite buttons inside map canvas. This applies to all maps."
  // Creates (or reuses) a `.hulul-map-controls` wrapper permanently inside a Leaflet map container and
  // appends the given button elements to it, same appendChild-after-map-creation technique
  // wireMapFullscreen already uses for its own expand button. Living inside mapEl from the start means
  // these buttons no longer need wireMapFullscreen's extraControls reparenting trick to survive going
  // full screen -- they're already inside the div that goes full screen.
  mapControls(mapEl, buttons) {
    if (!mapEl) return null;
    var wrap = mapEl.querySelector('.hulul-map-controls');
    if (!wrap) { wrap = document.createElement('div'); wrap.className = 'hulul-map-controls'; mapEl.appendChild(wrap); }
    (buttons || []).forEach(function (b) { if (b) wrap.appendChild(b); });
    return wrap;
  },

  // Builds one `.map-toggle-btn` (same look as the existing Satellite/"Use my location" buttons) as a
  // detached DOM element, for callers to place via UI.mapControls above. id is set so call sites can
  // still `document.getElementById` it afterward to wire onclick, same as every existing call site did
  // when these were plain HTML strings.
  mapToggleButton(id, iconKey, label) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'map-toggle-btn';
    btn.id = id;
    btn.innerHTML = ICON(iconKey) + ' ' + label;
    return btn;
  },

  // REQ: "Zone boundaries to be visible. This applies to all maps." Draws every zone's own boundary
  // polygon (its own picked color, falling back to the auto-cycled ZONE_BOUNDARY_COLORS_ palette --
  // eventDetail.js, loaded app-wide -- for zones predating the color field) with a permanent centered
  // name label, same style eventDetail.js's "Places map" originally established. zones: raw Zone rows
  // (z.boundary is the raw JSON string field -- parseBoundaryClient_, venues.js, loaded app-wide,
  // parses it). Read-only (interactive: false) everywhere this is called from -- editing a zone's
  // boundary only ever happens from its own Add/Edit zone map. Returns the layers added, so the caller
  // can remove them on destroy.
  drawZoneBoundaries(map, zones) {
    var layers = [];
    (zones || []).forEach(function (z, i) {
      var boundary = (typeof parseBoundaryClient_ === 'function') ? parseBoundaryClient_(z.boundary) : null;
      if (!boundary || boundary.length < 3) return;
      var color = z.color || ZONE_BOUNDARY_COLORS_[i % ZONE_BOUNDARY_COLORS_.length];
      var latlngs = boundary.map(function (pt) { return [pt.lat, pt.lng]; });
      var layer = HululLeaflet.polygon(latlngs, { color: color, fillColor: color, fillOpacity: 0.10, weight: 2, interactive: false }).addTo(map);
      layer.bindTooltip(esc(z.name), { permanent: true, direction: 'center', className: 'place-marker-tooltip' });
      layers.push(layer);
    });
    return layers;
  },

  // REQ: "Participant dots to be visible. This applies to all maps." Plots every place/participant
  // that has coordinates as a colored dot (EVENT_PLACE_TYPE_COLORS_, eventDetail.js, loaded app-wide --
  // Places and Participants share the same underlying record and type palette, see createPlace in
  // Places.gs) with a hover name tooltip, same place-marker-icon style used everywhere else in the app.
  // onClick (optional) fires with the raw place/participant row. Returns {id: marker}, same shape as
  // eventDetail.js's own eventPlacesMarkers_, so a caller that needs to track/remove them individually
  // can.
  drawPlaceDots(map, places, onClick) {
    var markers = {};
    (places || []).forEach(function (pl) {
      if (pl.lat === '' || pl.lat == null || pl.lng === '' || pl.lng == null) return;
      var color = EVENT_PLACE_TYPE_COLORS_[pl.type] || EVENT_PLACE_TYPE_COLORS_.Other;
      var icon = HululLeaflet.divIcon({
        className: 'place-marker-icon', iconSize: [14, 14], iconAnchor: [7, 7],
        html: '<div class="place-marker"><div class="place-marker-dot" style="background:' + color + ';"></div></div>'
      });
      var marker = HululLeaflet.marker([Number(pl.lat), Number(pl.lng)], { icon: icon }).addTo(map);
      marker.bindTooltip(esc(pl.name), { direction: 'top', offset: [0, -10], className: 'place-marker-tooltip' });
      if (onClick) marker.on('click', function () { onClick(pl); });
      markers[pl.id] = marker;
    });
    return markers;
  },

  // REQ: "Inspectors live location as they start inspections. This applies to all maps." Polls
  // listActiveInspectorLocations (Inspections.gs) every intervalMs and keeps a set of inspector-dot
  // markers on `map` in sync with the response -- shared by every map in the app instead of each
  // duplicating its own setInterval/marker-diffing logic. fetchParams is either {venueId} or {eventId}
  // (exactly one, see listActiveInspectorLocations). Markers are keyed by inspectorId and diffed each
  // tick: moved if still present, added if new, removed if no longer in the (already freshness-
  // filtered server-side) response -- so an inspector who closes their live-tracking page or goes
  // stale simply stops appearing within one poll interval, no explicit "stop" signal needed.
  // Silently no-ops on a fetch error (transient network hiccup) rather than ever breaking the map --
  // the next tick retries. Returns a stop() function the caller's destroy*Map_() MUST call, same
  // convention as wireMapFullscreen's cleanup: clears the interval and removes every marker it added.
  startInspectorLocationPolling(map, fetchParams, intervalMs) {
    var markers = {};
    var stopped = false;
    function tick() {
      if (stopped || !map) return;
      Api.call('listActiveInspectorLocations', fetchParams).then(function (live) {
        if (stopped || !map) return;
        var seenIds = {};
        (live || []).forEach(function (insp) {
          if (insp.lat === '' || insp.lat == null || insp.lng === '' || insp.lng == null) return;
          seenIds[insp.inspectorId] = true;
          var latlng = [Number(insp.lat), Number(insp.lng)];
          var marker = markers[insp.inspectorId];
          if (marker) {
            marker.setLatLng(latlng);
          } else {
            var icon = HululLeaflet.divIcon({
              className: 'inspector-marker-icon', iconSize: [16, 16], iconAnchor: [8, 8], html: '<div class="inspector-marker-dot"></div>'
            });
            marker = HululLeaflet.marker(latlng, { icon: icon, zIndexOffset: 900 }).addTo(map);
            markers[insp.inspectorId] = marker;
          }
          marker.unbindTooltip();
          marker.bindTooltip(esc(insp.inspectorName) + ' — inspecting', { direction: 'top', offset: [0, -10], className: 'place-marker-tooltip' });
        });
        Object.keys(markers).forEach(function (id) {
          if (!seenIds[id]) { map.removeLayer(markers[id]); delete markers[id]; }
        });
      }).catch(function () { /* transient -- next tick retries */ });
    }
    tick();
    var timer = setInterval(tick, intervalMs || 20000);
    return function stop() {
      stopped = true;
      clearInterval(timer);
      Object.keys(markers).forEach(function (id) { if (map) map.removeLayer(markers[id]); });
      markers = {};
    };
  }
};

// App-wide click guard: the instant ANY .btn is clicked, disable it and mark it visibly clicked
// (see .btn-clicked / :disabled in styles.css) for 10s. Delegated once here on document, in the
// capture phase, so it runs before the button's own onclick fires for that same click -- the click
// still does its job normally, this only blocks a second click on the same button while the first
// request is in flight (or the user is double-tapping), which is what was producing "not found" /
// duplicate-create style errors from firing the same action twice. Every current and future button
// gets this for free; no call site needs to wire it up itself.
//
// The disabling itself is deferred one tick (setTimeout 0) -- this is NOT cosmetic. The login
// button is a real <button type="submit"> inside a <form>, and setting .disabled = true
// synchronously, before the browser has finished running that same click's native activation
// behavior, can cancel the form's submit event outright in some browsers -- login would then
// silently do nothing (no error, no request, nothing). Deferring by a tick lets that native
// submit fire first; the button is still disabled a moment later, well before a human could
// double-click it.
document.addEventListener('click', function (e) {
  var btn = e.target.closest ? e.target.closest('button.btn') : null;
  if (!btn || btn.disabled) return;
  btn.classList.add('btn-clicked');
  setTimeout(function () {
    if (!btn.isConnected) { btn.classList.remove('btn-clicked'); return; } // already re-rendered away
    btn.disabled = true;
    setTimeout(function () {
      btn.disabled = false;
      btn.classList.remove('btn-clicked');
    }, 10000);
  }, 0);
}, true);

// UI.table's own filter/sort/export wiring, delegated once here (same pattern as the click-guard
// above) so every table built by UI.table -- present and future, anywhere in the app -- gets this
// for free. Sorting/filtering only ever move or hide the rows already in the DOM; they never
// regenerate a row's HTML, so any per-row button handlers a view wired up right after rendering
// stay intact.
function hululTableRows_(tbody) {
  return Array.prototype.slice.call(tbody.querySelectorAll('tr')).filter(function (r) {
    return !r.classList.contains('table-empty-row') && !r.classList.contains('table-filter-empty-row');
  });
}

// Filter box: substring match (case-insensitive) against each row's precomputed data-search
// attribute (built from every exportable column's plain-text value at render time).
document.addEventListener('input', function (e) {
  var input = e.target.closest ? e.target.closest('.table-filter-input') : null;
  if (!input) return;
  var wrap = input.closest('.table-wrap');
  if (!wrap) return;
  clearTimeout(wrap._hululFilterTimer);
  wrap._hululFilterTimer = setTimeout(function () {
    var q = input.value.trim().toLowerCase();
    var tbody = wrap.querySelector('tbody');
    if (!tbody) return;
    var rows = hululTableRows_(tbody);
    var visible = 0;
    rows.forEach(function (r) {
      var match = !q || (r.getAttribute('data-search') || '').indexOf(q) !== -1;
      r.style.display = match ? '' : 'none';
      if (match) visible++;
    });
    var filterEmptyRow = tbody.querySelector('.table-filter-empty-row');
    if (filterEmptyRow) filterEmptyRow.style.display = (q && visible === 0 && rows.length > 0) ? '' : 'none';
  }, 150);
}, true);

document.addEventListener('click', function (e) {
  // Sortable column header -- reorders the existing <tr> nodes in place (tbody.appendChild on a
  // node already in the document moves it rather than cloning it, so listeners survive).
  var th = e.target.closest ? e.target.closest('.th-sortable') : null;
  if (th) {
    var table = th.closest('table');
    var idx = th.getAttribute('data-sort-idx');
    var dir = th.getAttribute('data-sort-dir') === 'asc' ? 'desc' : 'asc';
    Array.prototype.forEach.call(table.querySelectorAll('.th-sortable'), function (h) {
      h.removeAttribute('data-sort-dir');
      var arrow = h.querySelector('.th-sort-arrow');
      if (arrow) arrow.textContent = '';
    });
    th.setAttribute('data-sort-dir', dir);
    var arrow = th.querySelector('.th-sort-arrow');
    if (arrow) arrow.textContent = dir === 'asc' ? '▲' : '▼';
    var tbody = table.querySelector('tbody');
    var rows = hululTableRows_(tbody);
    var mult = dir === 'asc' ? 1 : -1;
    rows.sort(function (a, b) {
      return mult * UI.compareValues(a.getAttribute('data-sv-' + idx), b.getAttribute('data-sv-' + idx));
    });
    rows.forEach(function (r) { tbody.appendChild(r); });
    return;
  }
  // Export CSV -- only the currently-visible (post-filter) rows, in their currently-sorted order.
  var exportBtn = e.target.closest ? e.target.closest('.table-export-btn') : null;
  if (exportBtn) {
    var wrap = exportBtn.closest('.table-wrap');
    if (!wrap) return;
    var headers = JSON.parse(wrap.getAttribute('data-export-headers') || '[]');
    var colIdxs = (wrap.getAttribute('data-export-cols') || '').split(',').filter(function (s) { return s !== ''; }).map(Number);
    var tbody = wrap.querySelector('tbody');
    if (!tbody) return;
    var rows = hululTableRows_(tbody).filter(function (r) { return r.style.display !== 'none'; });
    var out = [headers];
    rows.forEach(function (r) { out.push(colIdxs.map(function (i) { return r.getAttribute('data-tx-' + i) || ''; })); });
    UI.downloadCsv(wrap.getAttribute('data-export-name') || 'export.csv', out);
  }
}, true);

function esc(s) {
  if (s === undefined || s === null) return '';
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
