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
        '<button class="btn btn-ghost btn-sm" id="modalCloseBtn">✕</button></div>' +
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
      Open: ['badge-open', 'Open'], InReview: ['badge-inreview', 'In Review'], Resolved: ['badge-resolved', 'Resolved'],
      ReOpen: ['badge-reopen', 'Re-open'], Rejected: ['badge-rejected', 'Rejected'],
      Approved: ['badge-resolved', 'Approved'], 'Not Approved': ['badge-rejected', 'Not Approved'],
      Pending: ['badge-neutral', 'Pending'], Scheduled: ['badge-open', 'Scheduled'], Completed: ['badge-resolved', 'Completed'],
      Planning: ['badge-neutral', 'Planning'], VenueApproved: ['badge-resolved', 'Venue Approved'], VenueRejected: ['badge-rejected', 'Venue Rejected']
    };
    var m = map[status] || ['badge-neutral', status || '—'];
    return '<span class="badge ' + m[0] + '"><span class="badge-dot"></span>' + esc(m[1]) + '</span>';
  },

  riskBadge(risk) {
    var cls = risk === 'Critical' ? 'badge-critical' : risk === 'High' ? 'badge-high' : risk === 'Medium' ? 'badge-medium' : risk === 'Low' ? 'badge-low' : 'badge-neutral';
    return '<span class="badge ' + cls + '">' + esc(risk || '—') + '</span>';
  },

  table(columns, rows, opts) {
    opts = opts || {};
    var head = columns.map(function (c) { return '<th>' + esc(c.label) + '</th>'; }).join('');
    var body = rows.length
      ? rows.map(function (row) {
          return '<tr>' + columns.map(function (c) {
            var val = typeof c.render === 'function' ? c.render(row) : esc(row[c.key] != null ? row[c.key] : '—');
            return '<td>' + val + '</td>';
          }).join('') + '</tr>';
        }).join('')
      : '<tr><td colspan="' + columns.length + '"><div class="empty-state">' + (opts.emptyText || t('no_data')) + '</div></td></tr>';
    return '<div class="table-wrap"><table class="data-table"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>';
  },

  fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  },

  field(label, inputHtml) {
    return '<label class="field-label">' + esc(label) + '</label>' + inputHtml;
  }
};

function esc(s) {
  if (s === undefined || s === null) return '';
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
