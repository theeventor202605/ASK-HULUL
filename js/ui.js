/**
 * HULUL - shared UI helpers: toasts, modals, badges, tables, formatting.
 */
window.UI = {
  toast(message, type) {
    var root = document.getElementById('toastRoot');
    var el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.textContent = message;
    root.appendChild(el);
    setTimeout(function () { el.remove(); }, 3800);
  },

  error(err) {
    console.error(err);
    this.toast(err && err.message ? err.message : 'Something went wrong', 'error');
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
      Pending: ['badge-neutral', 'Pending'], Scheduled: ['badge-open', 'Scheduled'], Completed: ['badge-resolved', 'Completed']
    };
    var m = map[status] || ['badge-neutral', status || '—'];
    return '<span class="badge ' + m[0] + '"><span class="badge-dot"></span>' + esc(m[1]) + '</span>';
  },

  riskBadge(risk) {
    var cls = risk === 'High' ? 'badge-high' : risk === 'Medium' ? 'badge-medium' : risk === 'Low' ? 'badge-low' : 'badge-neutral';
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
