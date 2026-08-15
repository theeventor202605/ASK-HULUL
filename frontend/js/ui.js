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
    var body = '<div style="font-size:13.5px;line-height:1.6;">' + esc(err && err.message ? err.message : t('something_went_wrong')) + '</div>';
    this.openModal(t('error_title'), body, [{ label: t('ok'), className: 'btn-primary', onClick: UI.closeModal }]);
  },

  // Replaces the browser's native window.confirm() with a popup in the app's own style.
  // onConfirm can be async; the modal closes first either way so a slow request doesn't leave a
  // stuck dialog on screen.
  confirmModal(message, onConfirm, opts) {
    opts = opts || {};
    var body = '<div style="font-size:13.5px;line-height:1.6;">' + esc(message) + '</div>';
    this.openModal(opts.title || t('are_you_sure'), body, [
      { label: opts.cancelLabel || t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
      { label: opts.confirmLabel || t('confirm'), className: opts.confirmClass || 'btn-danger', onClick: function () {
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
      '<div id="progressLabel" style="font-size:13px;margin-bottom:10px;">' + esc(t('starting_ellipsis')) + '</div>' +
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
        if (lbl) lbl.textContent = label || t('x_of_y_processed', { current: current, total: total });
      }
    };
  },

  // Shown instead of a toast for FORBIDDEN errors, since these need more room to explain
  // who *can* do this and — when the backend was able to work it out — who that is right now.
  permissionModal(err) {
    var body = '<div style="font-size:13.5px;line-height:1.6;">' + esc(err.message || t('not_permitted_default')) + '</div>';
    if (err.contacts && err.contacts.length) {
      body += '<div style="margin-top:14px;"><div class="field-label">' + esc(t('who_to_contact')) + '</div>' +
        err.contacts.map(function (c) {
          return '<div style="padding:8px 10px;background:#f6f7fb;border-radius:8px;margin-top:6px;font-size:13px;">' +
            '<strong>' + esc(c.name) + '</strong> — ' + esc(c.role) +
            (c.email ? '<br/><span class="muted">' + esc(c.email) + '</span>' : '') + '</div>';
        }).join('') + '</div>';
    }
    this.openModal(t('not_permitted_title'), body, [{ label: t('ok'), className: 'btn-primary', onClick: UI.closeModal }]);
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
      // innerHTML (not textContent) so a label built from ICON('x') + ' ' + t('y') (e.g. venues.js's
      // Print/Share buttons, eventDetail.js's Record Results Print/Export CSV) actually renders the
      // icon instead of printing its raw <svg> markup as text -- every b.label in the app is
      // developer-authored (t()/ICON()/static strings), never raw user input, so this is safe.
      btn.innerHTML = b.label;
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

  // REQ follow-up: "event-workspace field labels are still English-only." Every status badge in the
  // app (Findings, Templates, Venue Approval, Events, Inspections, Support tickets) rendered through
  // this ONE shared map, which used to hardcode its own English label text -- so no matter how many
  // individual call sites got their own labels translated, every status badge anywhere still came out
  // English. Fixing it once here covers every badge app-wide, not just eventDetail.js. Status keys
  // themselves (left-hand side) stay exactly as they are -- those are the real data values compared
  // elsewhere (finding.status === 'Open' etc.), only the display text (routed through t()) changes
  // with the language. Module-level (not inline in statusBadge) so statusLabel below -- and non-badge
  // callers like a board column's plain-text header (eventDetail.js's Templates/Findings pipeline
  // boards, which don't want the colored pill markup) -- can reuse the exact same lookup instead of
  // eventDetail.js keeping its own separate, easy-to-forget-to-translate copy of these labels.
  _STATUS_BADGE_MAP: {
    Open: ['badge-open', 'status_open'], Viewed: ['badge-open', 'status_viewed'],
    Submitted: ['badge-inreview', 'status_submitted'], InReview: ['badge-inreview', 'status_inreview'],
    Resubmitted: ['badge-inreview', 'status_resubmitted'], Resolved: ['badge-resolved', 'status_resolved'],
    ReOpen: ['badge-reopen', 'status_reopen'], Rejected: ['badge-rejected', 'status_rejected'],
    Approved: ['badge-resolved', 'status_approved'], 'Not Approved': ['badge-rejected', 'status_not_approved'],
    // Readiness Templates (Templates.gs) -- formerly Approved/Rejected, renamed to avoid clashing
    // with the Venue Approval / Findings decisions above, which keep their own separate statuses.
    Evaluated: ['badge-resolved', 'status_evaluated'], Missed: ['badge-rejected', 'status_missed'],
    Pending: ['badge-neutral', 'status_pending'], Scheduled: ['badge-open', 'status_scheduled'], Completed: ['badge-resolved', 'status_completed'],
    Planning: ['badge-neutral', 'status_planning'], VenueApproved: ['badge-resolved', 'status_venue_approved'], VenueRejected: ['badge-rejected', 'status_venue_rejected'],
    // Support tickets (Support.gs) -- Open/Resolved/Completed/Rejected all reuse maps above.
    InProgress: ['badge-inreview', 'status_inprogress'],
    // Readiness Templates' own 4 remaining statuses (TEMPLATE_BOARD_COLUMNS, eventDetail.js) -- these
    // were missing entirely (Submitted/Evaluated/Missed above already covered the other 3), which is
    // why the Templates status column and pipeline board only translated 3 of 7 columns. 'In Progress'
    // reuses InProgress's own status_inprogress key -- same displayed word either way, just a
    // differently-spaced source status string ('In Progress' here vs 'InProgress' for Support tickets).
    'Not Sent': ['badge-neutral', 'status_not_sent'], Sent: ['badge-open', 'status_sent'],
    'In Progress': ['badge-open', 'status_inprogress'], 'Under Review': ['badge-reopen', 'status_under_review']
  },

  // Bare translated text, no badge markup -- for places that show a status as plain text (a board
  // column header) rather than a colored pill. statusBadge below is just this wrapped in the pill.
  statusLabel(status) {
    var m = UI._STATUS_BADGE_MAP[status];
    return m ? t(m[1]) : (status || '—');
  },

  statusBadge(status) {
    var m = UI._STATUS_BADGE_MAP[status];
    return '<span class="badge ' + (m ? m[0] : 'badge-neutral') + '"><span class="badge-dot"></span>' + esc(UI.statusLabel(status)) + '</span>';
  },

  // Same "shared function, one fix covers every call site" reasoning as statusBadge above --
  // risk (Critical/High/Medium/Low, RISK_LEVELS_ in backend/Resolutions.gs) is itself the data value
  // compared elsewhere, so it's kept as the lookup key; only the rendered text is translated.
  riskBadge(risk) {
    var cls = risk === 'Critical' ? 'badge-critical' : risk === 'High' ? 'badge-high' : risk === 'Medium' ? 'badge-medium' : risk === 'Low' ? 'badge-low' : 'badge-neutral';
    var riskLabelKeys = { Critical: 'risk_critical', High: 'risk_high', Medium: 'risk_medium', Low: 'risk_low' };
    var label = riskLabelKeys[risk] ? t(riskLabelKeys[risk]) : (risk || '—');
    return '<span class="badge ' + cls + '">' + esc(label) + '</span>';
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
          if (row && row.id != null) trAttrs.push('data-row-id="' + esc(String(row.id)) + '"'); // generic row->data hook, e.g. UI.syncMapDotsToTableFilter below
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
      // REQ: "in any list search box typing /c lists all columns ... selecting a column will
      // suggest values user can select multi-values from the suggestions or continue typing to
      // narrow down." .table-filter-suggest/.table-filter-chips are wired generically for every
      // table by the shared document-level listeners below (hululShowFilterSuggest_ etc.) -- no
      // per-view code needed, same "every table gets this for free" approach as sort/export/paging.
      toolbarHtml = '<div class="table-toolbar">' +
        '<div class="table-filter-wrap">' +
          '<input type="search" class="table-filter-input field-input" placeholder="' + esc(t('filter')) + '… /c for columns" />' +
          '<div class="table-filter-suggest chat-suggest-box" style="display:none;"></div>' +
        '</div>' +
        // Icon-only (title tooltip, not a text label) -- REQ: Import/Export CSV controls read as
        // icons everywhere, not text buttons; this one call site covers every table in the app.
        // opts.hideExportButton: for the handful of pages (Events, Checklist Items) that already
        // have their own richer Export/Import CSV icons in the list-section header -- this table's
        // auto export button would just be a second, redundant one right below it. exportCols still
        // gets computed either way (it also drives which columns the filter box searches), only the
        // button itself is skipped.
        (exportCols.length && !opts.hideExportButton ? '<button type="button" class="btn btn-secondary btn-sm btn-icon table-export-btn" title="' + esc(t('export_csv')) + '">' + ICON('export_csv') + '</button>' : '') +
      '</div>' +
      '<div class="table-filter-chips"></div>';
    }

    // REQ: "lists may become very long apply the x/page dropdown ... automatically appear to lists
    // containing more than 10 items" -- gated purely on row count (not opts.toolbar), same "every
    // table gets this for free" philosophy as the filter/sort/export above. See
    // hululApplyPagination_ (below) for how this interacts with filtering/sorting: pagination never
    // touches which rows MATCH, only which of the matching rows are currently on-screen.
    var paginate = rows.length > HULUL_TABLE_DEFAULT_PAGE_SIZE_;
    var pagerHtml = paginate
      ? '<div class="table-pager">' +
          '<div class="table-pager-size">' +
            '<span class="muted" style="font-size:12px;">' + esc(t('show_label')) + '</span>' +
            '<select class="table-page-size-select field-input">' +
              HULUL_TABLE_PAGE_SIZE_OPTIONS_.map(function (n) {
                return '<option value="' + n + '"' + (n === HULUL_TABLE_DEFAULT_PAGE_SIZE_ ? ' selected' : '') + '>' + n + '</option>';
              }).join('') +
            '</select>' +
            '<span class="muted" style="font-size:12px;">' + esc(t('per_page_label')) + '</span>' +
          '</div>' +
          '<div class="table-pager-nav">' +
            '<button type="button" class="btn btn-secondary btn-sm btn-icon table-page-prev" title="' + esc(t('previous_page')) + '">' + ICON('page_prev') + '</button>' +
            '<span class="table-pager-indicator muted" style="font-size:12px;"></span>' +
            '<button type="button" class="btn btn-secondary btn-sm btn-icon table-page-next" title="' + esc(t('next_page')) + '">' + ICON('page_next') + '</button>' +
          '</div>' +
        '</div>'
      : '';

    return '<div class="table-wrap"' + wrapAttrs + '>' + toolbarHtml +
      '<table class="data-table"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>' + pagerHtml + '</div>';
  },

  // Wraps whatever action button(s) HTML a view's own 'actions' column render() already builds
  // (edit/delete/view/approve/etc. -- unchanged per-view) into a single three-dot toggle. Nothing
  // about how those buttons are built or wired changes -- views still attach their own onclick
  // handlers via querySelectorAll('[data-x]') right after inserting the table HTML, exactly like
  // before; this just hides them inside a popover that opens on click instead of always showing
  // them inline in the cell. buttonsHtml may be '' (e.g. a row with no actions available under the
  // current permissions) -- the toggle still renders so the column stays visually consistent, it
  // just opens an empty popover.
  // See the delegated open/close/position wiring (hululActionsMenu*) further down this file, and
  // .actions-menu/.actions-menu-popover in styles.css for why the popover is position:fixed rather
  // than a normal absolute-positioned dropdown (it has to escape .table-wrap's overflow:auto, which
  // would otherwise clip it).
  actionsCell(buttonsHtml) {
    return '<div class="actions-menu">' +
      '<button type="button" class="btn btn-secondary btn-sm btn-icon actions-menu-toggle" title="' + esc(t('actions')) + '">' + ICON('actions_menu') + '</button>' +
      '<div class="actions-menu-popover">' + buttonsHtml + '</div>' +
    '</div>';
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
    return overdue ? (t('overdue_prefix') + label) : (label + t('left_suffix'));
  },

  // Wrapped in a single div (not just the bare label+input pair) so this always behaves as ONE
  // cohesive unit wherever it's dropped -- crucially inside a .form-row grid (display:grid, 2
  // columns): unwrapped, the label and input become two SEPARATE grid items, so two UI.field() calls
  // in one .form-row produce 4 auto-placed items instead of 2, silently reflowing into "label beside
  // value, one pair per row" (or worse, a mismatched item count when paired with an already-wrapped
  // field like the Zones checkbox box, leaving stray empty grid cells). Wrapping restores the
  // intended "two fields side by side, each stacked label-above-input" layout every .form-row expects.
  field(label, inputHtml) {
    return '<div class="field-group"><label class="field-label">' + esc(label) + '</label>' + inputHtml + '</div>';
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
    btn.title = t('expand_fullscreen');
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
      btn.title = active ? t('exit_fullscreen') : t('expand_fullscreen');
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

  // REQ bug report: "When scrolling down or up on a page and the mouse pointer comes on the map the
  // map starts to zoom. No map interactions unless user clicks on the map." Every interactive map in
  // the app (venue/place/zone/participant-discipline/live-inspection maps -- NOT the Overview tab's
  // read-only zone thumbnail, which already has every interaction permanently off on purpose) starts
  // fully inert: dragging, scroll-wheel zoom, double-click zoom, box zoom, keyboard panning, and
  // touch zoom are all disabled right after creation, so a page scroll that happens to pass over the
  // map behaves like a normal page scroll instead of hijacking it into a map zoom. Clicking anywhere
  // on the map re-enables all of them; a small side hint makes that discoverable.
  //
  // REQ: "After clicking on map and interacting, if focus is set outside map, then map locks again.
  // This rule applies to all maps." -- registers with hululMapLocks_ (below) instead of wiring its
  // own one-shot listener per map, so the single delegated document click handler down there can
  // re-lock ANY registered map the instant a click lands outside it, and unlock it again the instant
  // a click lands back inside -- one shared mechanism for every map this is called on, not something
  // each call site has to remember to re-implement (or every existing call site to be updated for).
  // No cleanup function needed either: that same delegated handler drops an entry itself the first
  // time it notices mapEl is no longer in the document (the view that owned it was re-rendered/torn
  // down), so callers don't need to unregister on destroy.
  requireClickToActivateMap(map, mapEl) {
    if (!map || !mapEl) return;
    var handlers = ['dragging', 'scrollWheelZoom', 'doubleClickZoom', 'boxZoom', 'keyboard', 'touchZoom', 'tap']
      .map(function (name) { return map[name]; })
      .filter(function (h) { return h && typeof h.disable === 'function'; });

    var hint = document.createElement('div');
    hint.className = 'hulul-map-click-hint';
    hint.textContent = t('click_to_interact_map');

    var entry = { mapEl: mapEl, handlers: handlers, hint: hint, locked: true };
    hululLockMap_(entry); // starting state: inert, hint shown
    hululMapLocks_.push(entry);
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

  // Small always-visible key for what a map's dot colors mean (e.g. Places' Operator/Vendor/
  // Exhibitor/Other -- EVENT_PLACE_TYPE_COLORS_, eventDetail.js). Appended directly into mapEl, same
  // appendChild-after-map-creation technique as wireMapFullscreen's own button and mapControls above
  // -- living inside mapEl from the start means it survives going full screen without needing
  // extraControls' reparenting trick. Bottom-right corner: clear of mapControls (bottom-left) and the
  // fullscreen toggle (top-right). Re-callable (replaces its own contents) so a caller can refresh it
  // if the item set ever changes without leaving a stale duplicate legend behind.
  mapLegend(mapEl, items) {
    if (!mapEl) return null;
    var wrap = mapEl.querySelector('.hulul-map-legend');
    if (!wrap) { wrap = document.createElement('div'); wrap.className = 'hulul-map-legend'; mapEl.appendChild(wrap); }
    wrap.innerHTML = (items || []).map(function (it) {
      return '<span style="display:flex;align-items:center;gap:5px;"><span class="place-type-swatch" style="background:' + it.color + ';"></span>' + esc(it.label) + '</span>';
    }).join('');
    return wrap;
  },

  // REQ: "Zone boundaries to be visible. This applies to all maps." Draws every zone's own boundary
  // polygon (its own picked color, falling back to the auto-cycled ZONE_BOUNDARY_COLORS_ palette --
  // eventDetail.js, loaded app-wide -- for zones predating the color field) with a permanent centered
  // name label, same style eventDetail.js's "Places map" originally established. zones: raw Zone rows
  // (z.boundary is the raw JSON string field -- parseBoundaryClient_, venues.js, loaded app-wide,
  // parses it). Read-only (interactive: false) everywhere this is called from -- editing a zone's
  // boundary only ever happens from its own Add/Edit zone map. tooltipClassName (optional) lets a
  // small map override the label style -- REQ report: on the Overview tab's small zone-map thumbnail,
  // the normal label's white background/text size hid the (much smaller, at that zoom/size) boundary
  // underneath it; defaults to the normal style everywhere else. Returns the layers added, so the
  // caller can remove them on destroy.
  drawZoneBoundaries(map, zones, tooltipClassName) {
    var layers = [];
    (zones || []).forEach(function (z, i) {
      var boundary = (typeof parseBoundaryClient_ === 'function') ? parseBoundaryClient_(z.boundary) : null;
      if (!boundary || boundary.length < 3) return;
      var color = z.color || ZONE_BOUNDARY_COLORS_[i % ZONE_BOUNDARY_COLORS_.length];
      var latlngs = boundary.map(function (pt) { return [pt.lat, pt.lng]; });
      var layer = HululLeaflet.polygon(latlngs, { color: color, fillColor: color, fillOpacity: 0.10, weight: 2, interactive: false }).addTo(map);
      layer.bindTooltip(esc(z.name), { permanent: true, direction: 'center', className: tooltipClassName || 'place-marker-tooltip' });
      layers.push(layer);
    });
    return layers;
  },

  // REQ: "Across all maps any participant with a logged risk turns red dot with a number above the
  // dot showing unresolved logs. Only when a log is closed then the dot returns to default colour."
  // Single shared builder for the small place/participant divIcon used by every map in the app --
  // centralized here so the red-override + numbered-badge treatment only has to be written once.
  // `color` is the caller's normal (non-risk) color for this dot (type palette, relevance/completion
  // color, etc.); it's completely ignored in favor of var(--danger) whenever openFindingsCount > 0,
  // since an open risk log outranks whatever else that color was communicating. openFindingsCount is
  // clamped to a "9+" display past 9 so the badge never has to grow past its fixed small size.
  placeMarkerIcon(color, openFindingsCount) {
    var hasRisk = (openFindingsCount || 0) > 0;
    var dotColor = hasRisk ? 'var(--danger)' : color;
    return HululLeaflet.divIcon({
      className: 'place-marker-icon', iconSize: [14, 14], iconAnchor: [7, 7],
      html: '<div class="place-marker">' +
        (hasRisk ? '<div class="place-marker-badge">' + (openFindingsCount > 9 ? '9+' : openFindingsCount) + '</div>' : '') +
        '<div class="place-marker-dot' + (hasRisk ? ' place-marker-dot-risk' : '') + '" style="background:' + dotColor + ';"></div></div>'
    });
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
      var icon = UI.placeMarkerIcon(color, pl.openFindingsCount);
      var marker = HululLeaflet.marker([Number(pl.lat), Number(pl.lng)], { icon: icon }).addTo(map);
      marker.bindTooltip(esc(pl.name), { direction: 'top', offset: [0, -10], className: 'place-marker-tooltip' });
      if (onClick) marker.on('click', function () { onClick(pl); });
      markers[pl.id] = marker;
    });
    return markers;
  },

  // BUG FIX (audit, this session): every list page that pairs a UI.table of places/participants
  // with a Leaflet map of the same rows (drawPlaceDots' markers, keyed by id) had the same gap the
  // Venue & Zones Places tab was originally reported for -- the table's own built-in filter box
  // hides non-matching rows, but nothing told the map's dots to follow, so a filtered list still
  // showed every dot. Rather than re-copy that tab's bespoke MutationObserver into every other view
  // (venues.js's Places catalog, eventPlaces.js's Participants tab, eventDetail.js's zone-drawing
  // map), this is that same fix generalized: wrapId is the table's wrapping element id (its rows
  // must have gone through UI.table so they carry data-row-id, added above -- requires each row
  // object to have an `id` field, true for every Place/Participant), map is the Leaflet instance the
  // markers were added to, and markers is exactly what drawPlaceDots returned ({id: marker}).
  // Returns a cleanup() function the caller's destroy*Map_() MUST call (disconnects the observer),
  // same convention as wireMapFullscreen/startInspectorLocationPolling above.
  syncMapDotsToTableFilter(wrapId, map, markers) {
    var wrap = document.getElementById(wrapId);
    if (!wrap || !map || !markers) return function () {};
    function sync() {
      wrap.querySelectorAll('tbody tr[data-row-id]').forEach(function (tr) {
        var marker = markers[tr.dataset.rowId];
        if (!marker) return;
        var show = tr.dataset.hululFilteredOut !== '1';
        if (show) { if (!map.hasLayer(marker)) marker.addTo(map); }
        else if (map.hasLayer(marker)) map.removeLayer(marker);
      });
    }
    var observer = new MutationObserver(sync);
    observer.observe(wrap, { attributes: true, attributeFilter: ['data-hulul-filtered-out'], subtree: true });
    sync();
    return function () { observer.disconnect(); };
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

// Backing state + delegated listener for UI.requireClickToActivateMap above -- one shared mechanism
// so every map registered through it (venue/place/zone/participant-discipline/live-inspection, etc.)
// gets both halves of the same rule: a click inside unlocks it, a click anywhere else re-locks it.
// Capture phase, same as the other delegated listeners in this file, so it sees every click
// regardless of what else on the page might stop propagation.
var hululMapLocks_ = [];
function hululLockMap_(entry) {
  entry.locked = true;
  entry.handlers.forEach(function (h) { h.disable(); });
  if (!entry.hint.parentNode) entry.mapEl.appendChild(entry.hint);
}
function hululUnlockMap_(entry) {
  entry.locked = false;
  entry.handlers.forEach(function (h) { h.enable(); });
  entry.hint.remove();
}
document.addEventListener('click', function (e) {
  if (!hululMapLocks_.length) return;
  // Drop any entry whose mapEl is no longer in the document -- the view that owned it was
  // re-rendered/torn down (e.g. innerHTML replaced on tab switch), so there's nothing left to
  // lock/unlock and no listener to leak by leaving it registered forever.
  hululMapLocks_ = hululMapLocks_.filter(function (entry) { return document.body.contains(entry.mapEl); });
  hululMapLocks_.forEach(function (entry) {
    if (entry.mapEl.contains(e.target)) { if (entry.locked) hululUnlockMap_(entry); }
    else if (!entry.locked) hululLockMap_(entry);
  });
}, true);

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

// UI.table's own filter/sort/export/pagination wiring, delegated once here (same pattern as the
// click-guard above) so every table built by UI.table -- present and future, anywhere in the app --
// gets this for free. Sorting/filtering/paging only ever move or hide the rows already in the DOM;
// they never regenerate a row's HTML, so any per-row button handlers a view wired up right after
// rendering stay intact.
var HULUL_TABLE_DEFAULT_PAGE_SIZE_ = 10;
var HULUL_TABLE_PAGE_SIZE_OPTIONS_ = [10, 25, 50, 100];

function hululTableRows_(tbody) {
  return Array.prototype.slice.call(tbody.querySelectorAll('tr')).filter(function (r) {
    return !r.classList.contains('table-empty-row') && !r.classList.contains('table-filter-empty-row');
  });
}

// A row can be hidden for two independent reasons -- it doesn't match the filter box, or it's on a
// different page -- tracked separately (data-hulul-filtered-out / row membership in the current page
// slice) so neither one has to know about the other; final visibility is just "hidden by either."
// Export (below) deliberately reads data-hulul-filtered-out instead of style.display so exporting
// isn't silently limited to whatever happens to be the current page.
function hululApplyPagination_(wrap) {
  var pager = wrap.querySelector('.table-pager');
  if (!pager) return; // rows.length was <= HULUL_TABLE_DEFAULT_PAGE_SIZE_ at render time -- no pager, nothing to do
  var tbody = wrap.querySelector('tbody');
  if (!tbody) return;
  var pageSize = Number(wrap.dataset.hululPageSize || HULUL_TABLE_DEFAULT_PAGE_SIZE_);
  var allRows = hululTableRows_(tbody);
  var matching = allRows.filter(function (r) { return r.dataset.hululFilteredOut !== '1'; });
  // BUG FIX: "filtered to Vendor but list displays other types" -- this loop used to only walk
  // `matching`, so a row that WAS visible on the current page and then gets filtered out (a facet
  // is picked) was never touched -- its stale style.display:'' from before the filter stuck around
  // forever, since nothing outside `matching` was ever revisited. Explicitly hide every filtered-out
  // row here too, not just the ones still in the running for a page slot.
  allRows.forEach(function (r) { if (r.dataset.hululFilteredOut === '1') r.style.display = 'none'; });
  var totalPages = Math.max(1, Math.ceil(matching.length / pageSize));
  var page = Math.min(Math.max(1, Number(wrap.dataset.hululPage || 1)), totalPages);
  wrap.dataset.hululPage = String(page);
  var start = (page - 1) * pageSize, end = start + pageSize;
  matching.forEach(function (r, i) { r.style.display = (i >= start && i < end) ? '' : 'none'; });

  var indicator = pager.querySelector('.table-pager-indicator');
  if (indicator) indicator.textContent = matching.length ? t('page_of_total', { page: page, total: totalPages }) : '';
  var prevBtn = pager.querySelector('.table-page-prev');
  var nextBtn = pager.querySelector('.table-page-next');
  if (prevBtn) prevBtn.disabled = page <= 1;
  if (nextBtn) nextBtn.disabled = page >= totalPages;
}

// Sets initial pagination state the moment a paginated table-wrap first appears in the DOM.
// UI.table() only returns an HTML string -- callers just splice it into innerHTML themselves (often
// interleaved with a lot of other markup for the rest of the page), so there's no single "this
// table just finished rendering" call every view already makes that an init step could hook into.
// A MutationObserver on the whole document catches it generically instead. data-hulul-paginated
// guards against re-initializing (and silently resetting back to page 1) on some later, unrelated
// mutation inside the same subtree.
document.addEventListener('DOMContentLoaded', function () {}); // no-op; keeps intent obvious next to the observer below
var hululPagerObserver_ = new MutationObserver(function (mutations) {
  mutations.forEach(function (m) {
    Array.prototype.forEach.call(m.addedNodes || [], function (node) {
      if (node.nodeType !== 1) return;
      var wraps = node.classList && node.classList.contains('table-wrap') ? [node]
        : (node.querySelectorAll ? Array.prototype.slice.call(node.querySelectorAll('.table-wrap')) : []);
      wraps.forEach(function (wrap) {
        if (wrap.dataset.hululPaginated === '1' || !wrap.querySelector('.table-pager')) return;
        wrap.dataset.hululPaginated = '1';
        wrap.dataset.hululPage = '1';
        wrap.dataset.hululPageSize = wrap.dataset.hululPageSize || String(HULUL_TABLE_DEFAULT_PAGE_SIZE_);
        hululApplyPagination_(wrap);
      });
    });
  });
});
hululPagerObserver_.observe(document.body, { childList: true, subtree: true });

// UI.actionsCell's three-dot toggle -- delegated once here, same "wired generically for every
// table on every page, no per-view code needed" approach as everything else in this file. Only
// one popover is ever open at a time. The popover itself is position:fixed (see styles.css) so it
// escapes .table-wrap's overflow:auto instead of getting clipped/scrolled with the table -- which
// means its on-screen position has to be computed in JS from the toggle button's own
// getBoundingClientRect() rather than plain CSS anchoring, and closed again on scroll/resize since
// a fixed position won't track the row if the page moves under it.
function hululCloseActionsMenus_() {
  document.querySelectorAll('.actions-menu-popover.show').forEach(function (p) { p.classList.remove('show'); });
}
document.addEventListener('click', function (e) {
  var toggle = e.target.closest ? e.target.closest('.actions-menu-toggle') : null;
  if (!toggle) { hululCloseActionsMenus_(); return; } // outside click (or a click on an action button inside an open popover, after its own handler already ran) closes everything
  e.stopPropagation();
  var popover = toggle.parentElement.querySelector('.actions-menu-popover');
  var wasOpen = popover.classList.contains('show');
  hululCloseActionsMenus_();
  if (wasOpen) return; // second click on the same toggle just closes it
  popover.classList.add('show'); // display:flex now, so it has real dimensions to measure below
  var rect = toggle.getBoundingClientRect();
  var pw = popover.offsetWidth;
  var left = document.documentElement.dir === 'rtl' ? rect.left : (rect.right - pw);
  left = Math.max(8, Math.min(left, window.innerWidth - pw - 8)); // never run off either edge
  popover.style.left = left + 'px';
  popover.style.top = (rect.bottom + 4) + 'px';
});
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hululCloseActionsMenus_(); });
window.addEventListener('scroll', hululCloseActionsMenus_, true); // capture:true -- also catches .table-wrap's own horizontal scroll, not just window scroll
window.addEventListener('resize', hululCloseActionsMenus_);

// REQ: "in any list search box typing /c lists all columns typing or selecting a column will
// suggest values user can select multi-values from the suggestions or continue typing to narrow
// down." -- a column-value faceted filter layered on top of the plain free-text search below,
// wired generically for every UI.table() on every page (same delegated-listener approach as
// sort/export/paging above, so no per-view code is needed anywhere in the app).
//
// wrap._hululFacets: [{ colIdx, colLabel, values: [str,...] }] -- values within one facet are
// OR'd (row matches if it equals ANY of them), different facets are AND'd. Stored as a plain JS
// property directly on the .table-wrap element, same convention already used for
// wrap._hululFilterTimer just below.
// wrap._hululActiveColumn: {idx,label} while the value-suggestion dropdown for that column is
// open (i.e. between typing /c<column> and picking a column, and while narrowing/picking its
// values) -- while set, further keystrokes in the box narrow THIS column's own value list instead
// of running the plain substring search.

// Every column a row actually carries a data-tx-i for -- exactly the exportable-column set
// table() computed at render time (isExportable_), read back off the live DOM since table() only
// ever returns an HTML string, not the original columns array.
function hululFilterableColumns_(wrap) {
  var table = wrap.querySelector('table');
  var sampleRow = wrap.querySelector('tbody tr:not(.table-empty-row):not(.table-filter-empty-row)');
  if (!table || !sampleRow) return [];
  return Array.prototype.slice.call(table.querySelectorAll('thead th'))
    .map(function (th, i) { return { idx: i, label: th.textContent.replace(/[▲▼]/g, '').trim() }; })
    .filter(function (c) { return sampleRow.hasAttribute('data-tx-' + c.idx); });
}

// Every distinct value currently on record for one column, across ALL rows (not just the
// currently-visible/matching ones -- picking a value for a second facet should still be able to
// find values that only exist on rows the first facet just hid).
function hululFilterableValues_(wrap, colIdx) {
  var tbody = wrap.querySelector('tbody');
  if (!tbody) return [];
  var seen = {}, values = [];
  hululTableRows_(tbody).forEach(function (r) {
    var v = r.getAttribute('data-tx-' + colIdx);
    if (v === null || v === '' || seen[v.toLowerCase()]) return;
    seen[v.toLowerCase()] = true;
    values.push(v);
  });
  values.sort(function (a, b) { return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }); });
  return values;
}

function hululShowFilterSuggest_(wrap, header, items, renderItemFn, onPick) {
  var box = wrap.querySelector('.table-filter-suggest');
  if (!box) return;
  box.innerHTML = '<div class="chat-suggest-header">' + esc(header) + '</div>' +
    (items.length
      ? items.slice(0, 30).map(function (it, i) { return '<div class="chat-suggest-item" data-idx="' + i + '">' + renderItemFn(it) + '</div>'; }).join('')
      : '<div class="chat-suggest-empty">' + esc(t('no_suggestion_matches')) + '</div>');
  box.style.display = '';
  box.querySelectorAll('.chat-suggest-item').forEach(function (el) {
    // mousedown (not click) + preventDefault -- keeps the input focused so multiple values can be
    // picked in a row without the dropdown closing between each one (same reasoning as Event
    // Chat's own suggestion dropdown, eventDetail.js).
    el.addEventListener('mousedown', function (e) {
      e.preventDefault();
      onPick(items[Number(el.getAttribute('data-idx'))]);
    });
  });
  // REQ: "tab key... first suggestion will autocomplete and allow selection by pressing on arrow
  // keys." -- the first item starts highlighted every time this (re)renders (each keystroke while
  // narrowing), so Tab always has a sane default even before any arrow key is pressed.
  hululSetActiveSuggestItem_(box, items.length ? 0 : -1);
}
function hululHideFilterSuggest_(wrap) {
  var box = wrap.querySelector('.table-filter-suggest');
  if (box) { box.style.display = 'none'; box.innerHTML = ''; }
}

// Keyboard highlight for the suggestion dropdown -- kept separate from :hover so arrowing with the
// mouse sitting elsewhere still shows unambiguously which item Tab/Enter is about to pick.
// box._hululActiveIdx tracks the current highlight across keystrokes (read by the Tab/Enter/Arrow
// keydown handler below); -1 means nothing to highlight (empty suggestion list).
function hululSetActiveSuggestItem_(box, idx, itemEls) {
  var items = itemEls || Array.prototype.slice.call(box.querySelectorAll('.chat-suggest-item'));
  items.forEach(function (el, i) { el.classList.toggle('active', i === idx); });
  box._hululActiveIdx = idx;
  if (idx >= 0 && items[idx] && items[idx].scrollIntoView) items[idx].scrollIntoView({ block: 'nearest' });
}
function hululMoveSuggestActive_(box, delta) {
  var items = Array.prototype.slice.call(box.querySelectorAll('.chat-suggest-item'));
  if (!items.length) return;
  var cur = box._hululActiveIdx == null || box._hululActiveIdx < 0 ? -1 : box._hululActiveIdx;
  var next = ((cur + delta) % items.length + items.length) % items.length; // wraps both directions
  hululSetActiveSuggestItem_(box, next, items);
}

function hululShowColumnValues_(wrap, input, col, query) {
  var already = {};
  (wrap._hululFacets || []).forEach(function (f) {
    if (f.colIdx === col.idx) f.values.forEach(function (v) { already[v.toLowerCase()] = true; });
  });
  var values = hululFilterableValues_(wrap, col.idx).filter(function (v) {
    return (!query || v.toLowerCase().indexOf(query) !== -1) && !already[v.toLowerCase()];
  });
  hululShowFilterSuggest_(wrap, t('choose_value_multiselect', { col: col.label }), values, function (v) { return esc(v); }, function (v) {
    wrap._hululFacets = wrap._hululFacets || [];
    var facet = wrap._hululFacets.filter(function (f) { return f.colIdx === col.idx; })[0];
    if (!facet) { facet = { colIdx: col.idx, colLabel: col.label, values: [] }; wrap._hululFacets.push(facet); }
    if (facet.values.indexOf(v) === -1) facet.values.push(v);
    hululRenderFilterChips_(wrap);
    hululRecomputeTableFilter_(wrap);
    input.value = '';
    input.focus();
    hululShowColumnValues_(wrap, input, col, ''); // stay in value-picking mode -- REQ: multi-select
  });
}

function hululRenderFilterChips_(wrap) {
  var chipsBox = wrap.querySelector('.table-filter-chips');
  if (!chipsBox) return;
  var facets = wrap._hululFacets || [];
  var html = [];
  facets.forEach(function (f, fi) {
    f.values.forEach(function (v, vi) {
      html.push('<span class="table-filter-chip"><strong>' + esc(f.colLabel) + ':</strong> ' + esc(v) +
        ' <button type="button" data-facet-idx="' + fi + '" data-value-idx="' + vi + '" title="' + esc(t('remove_btn')) + '">' + ICON('close_modal') + '</button></span>');
    });
  });
  if (html.length) html.push('<button type="button" class="table-filter-clear-btn">' + esc(t('clear_filters_btn')) + '</button>');
  chipsBox.innerHTML = html.join('');
  chipsBox.querySelectorAll('[data-facet-idx]').forEach(function (btn) {
    btn.onclick = function () {
      var facet = facets[Number(btn.getAttribute('data-facet-idx'))];
      if (!facet) return;
      facet.values.splice(Number(btn.getAttribute('data-value-idx')), 1);
      wrap._hululFacets = facets.filter(function (f) { return f.values.length; });
      hululRenderFilterChips_(wrap);
      hululRecomputeTableFilter_(wrap);
    };
  });
  var clearBtn = chipsBox.querySelector('.table-filter-clear-btn');
  if (clearBtn) clearBtn.onclick = function () {
    wrap._hululFacets = [];
    hululRenderFilterChips_(wrap);
    hululRecomputeTableFilter_(wrap);
  };
}

// The actual row-matching pass: free-text substring search (data-search) AND every active column
// facet, then the same "reset to page 1 / reapply pagination" tail every other filter change here
// already uses. wrap._hululActiveColumn is deliberately excluded from the free-text query -- while
// it's set, whatever's typed in the box is an in-progress value-narrowing query, not a committed
// search term (nothing is filtered by it until a suggestion is actually clicked into a chip).
function hululRecomputeTableFilter_(wrap) {
  var tbody = wrap.querySelector('tbody');
  if (!tbody) return;
  var input = wrap.querySelector('.table-filter-input');
  var q = (input && !wrap._hululActiveColumn) ? input.value.trim().toLowerCase() : '';
  var facets = wrap._hululFacets || [];
  var rows = hululTableRows_(tbody);
  var visible = 0;
  rows.forEach(function (r) {
    var textMatch = !q || (r.getAttribute('data-search') || '').indexOf(q) !== -1;
    var facetMatch = facets.every(function (f) {
      var val = (r.getAttribute('data-tx-' + f.colIdx) || '').toLowerCase();
      return f.values.some(function (v) { return v.toLowerCase() === val; });
    });
    var match = textMatch && facetMatch;
    r.dataset.hululFilteredOut = match ? '' : '1';
    if (match) visible++;
  });
  var filterEmptyRow = tbody.querySelector('.table-filter-empty-row');
  if (filterEmptyRow) filterEmptyRow.style.display = ((q || facets.length) && visible === 0 && rows.length > 0) ? '' : 'none';
  if (wrap.querySelector('.table-pager')) {
    wrap.dataset.hululPage = '1'; // the filtered result set changed -- back to page 1
    hululApplyPagination_(wrap);
  } else {
    rows.forEach(function (r) { r.style.display = r.dataset.hululFilteredOut === '1' ? 'none' : ''; });
  }
}

document.addEventListener('input', function (e) {
  var input = e.target.closest ? e.target.closest('.table-filter-input') : null;
  if (!input) return;
  var wrap = input.closest('.table-wrap');
  if (!wrap) return;

  // Caret-relative /c detection -- same convention as Event Chat's /u //p /e /# triggers
  // (eventDetail.js's tabEventChat): the token starting at the last whitespace boundary before the
  // cursor, so /c can appear anywhere the user happens to be typing, not just at position 0.
  var cursor = input.selectionStart == null ? input.value.length : input.selectionStart;
  var text = input.value;
  var tokenStart = cursor;
  while (tokenStart > 0 && !/\s/.test(text[tokenStart - 1])) tokenStart--;
  var token = text.slice(tokenStart, cursor);
  var columnQuery = /^\/c/i.test(token) ? token.slice(2).toLowerCase() : null;

  if (columnQuery !== null) {
    wrap._hululActiveColumn = null; // picking the column itself, not narrowing a chosen one's values yet
    var cols = hululFilterableColumns_(wrap).filter(function (c) { return !columnQuery || c.label.toLowerCase().indexOf(columnQuery) !== -1; });
    hululShowFilterSuggest_(wrap, t('filter_by_column'), cols, function (c) { return esc(c.label); }, function (c) {
      wrap._hululActiveColumn = c;
      input.value = '';
      input.focus();
      hululShowColumnValues_(wrap, input, c, '');
    });
    return;
  }

  if (wrap._hululActiveColumn) {
    hululShowColumnValues_(wrap, input, wrap._hululActiveColumn, text.toLowerCase());
    return;
  }

  hululHideFilterSuggest_(wrap);
  clearTimeout(wrap._hululFilterTimer);
  wrap._hululFilterTimer = setTimeout(function () { hululRecomputeTableFilter_(wrap); }, 150);
}, true);

// Escape / clicking away -- closes the dropdown, and if a value-picking session for some column
// was left mid-way, clears whatever partial query text is still sitting in the box (it was never a
// real search term) and re-applies filtering from just the facet chips actually picked so far.
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  var input = e.target.closest ? e.target.closest('.table-filter-input') : null;
  if (!input) return;
  var wrap = input.closest('.table-wrap');
  if (!wrap) return;
  hululHideFilterSuggest_(wrap);
  if (wrap._hululActiveColumn) { wrap._hululActiveColumn = null; input.value = ''; hululRecomputeTableFilter_(wrap); }
}, true);
document.addEventListener('focusout', function (e) {
  var input = e.target.closest ? e.target.closest('.table-filter-input') : null;
  if (!input) return;
  var wrap = input.closest('.table-wrap');
  if (!wrap) return;
  setTimeout(function () {
    if (document.activeElement === input) return; // a suggestion pick's mousedown/preventDefault kept focus
    hululHideFilterSuggest_(wrap);
    if (wrap._hululActiveColumn) { wrap._hululActiveColumn = null; input.value = ''; hululRecomputeTableFilter_(wrap); }
  }, 150);
}, true);

// REQ: "when typing on any filter list if tab key is pressed first suggestion will autocomplete
// and allow selection by pressing on arrow keys." -- standard combobox keyboard behavior: Up/Down
// move a highlight (hululMoveSuggestActive_ above, defaults to the first item so plain Tab with no
// arrowing still autocompletes that one), Tab or Enter confirms whichever item is highlighted.
// Confirming reuses the exact same pick path a mouse click already uses (each .chat-suggest-item's
// own mousedown handler, wired in hululShowFilterSuggest_ above) rather than duplicating the two
// onPick behaviors (column-picking vs. value-picking) here, so this stays correct however those
// evolve. Only intercepts these keys while a suggestion box is actually open with items in it --
// otherwise Tab/Enter/arrows keep their normal browser behavior.
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Tab' && e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  var input = e.target.closest ? e.target.closest('.table-filter-input') : null;
  if (!input) return;
  var wrap = input.closest('.table-wrap');
  if (!wrap) return;
  var box = wrap.querySelector('.table-filter-suggest');
  if (!box || box.style.display === 'none') return;
  var items = box.querySelectorAll('.chat-suggest-item');
  if (!items.length) return; // "no matches" state -- nothing to navigate/autocomplete into

  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); // stay in the box instead of moving the caret/scrolling the page
    hululMoveSuggestActive_(box, e.key === 'ArrowDown' ? 1 : -1);
    return;
  }
  e.preventDefault();
  var idx = box._hululActiveIdx >= 0 ? box._hululActiveIdx : 0;
  (items[idx] || items[0]).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
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
    var wrap = table.closest('.table-wrap');
    if (wrap && wrap.querySelector('.table-pager')) {
      wrap.dataset.hululPage = '1'; // the row order changed -- "page 2" would now show different rows than before
      hululApplyPagination_(wrap);
    }
    return;
  }
  // Export CSV -- every filter-matching row (not just the current page), in their currently-sorted order.
  var exportBtn = e.target.closest ? e.target.closest('.table-export-btn') : null;
  if (exportBtn) {
    var exportWrap = exportBtn.closest('.table-wrap');
    if (!exportWrap) return;
    var headers = JSON.parse(exportWrap.getAttribute('data-export-headers') || '[]');
    var colIdxs = (exportWrap.getAttribute('data-export-cols') || '').split(',').filter(function (s) { return s !== ''; }).map(Number);
    var exportTbody = exportWrap.querySelector('tbody');
    if (!exportTbody) return;
    var exportRows = hululTableRows_(exportTbody).filter(function (r) { return r.dataset.hululFilteredOut !== '1'; });
    var out = [headers];
    exportRows.forEach(function (r) { out.push(colIdxs.map(function (i) { return r.getAttribute('data-tx-' + i) || ''; })); });
    UI.downloadCsv(exportWrap.getAttribute('data-export-name') || 'export.csv', out);
    return;
  }
  // Pager prev/next.
  var prevBtn = e.target.closest ? e.target.closest('.table-page-prev') : null;
  var nextBtn = e.target.closest ? e.target.closest('.table-page-next') : null;
  if (prevBtn || nextBtn) {
    var pagerWrap = (prevBtn || nextBtn).closest('.table-wrap');
    if (!pagerWrap) return;
    var curPage = Number(pagerWrap.dataset.hululPage || 1);
    pagerWrap.dataset.hululPage = String(curPage + (prevBtn ? -1 : 1));
    hululApplyPagination_(pagerWrap);
  }
}, true);

// Pager page-size dropdown.
document.addEventListener('change', function (e) {
  var select = e.target.closest ? e.target.closest('.table-page-size-select') : null;
  if (!select) return;
  var wrap = select.closest('.table-wrap');
  if (!wrap) return;
  wrap.dataset.hululPageSize = select.value;
  wrap.dataset.hululPage = '1';
  hululApplyPagination_(wrap);
}, true);

function esc(s) {
  if (s === undefined || s === null) return '';
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
