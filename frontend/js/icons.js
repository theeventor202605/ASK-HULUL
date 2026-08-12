/**
 * HULUL - central icon system for Settings > Icons (SystemAdmin picks any icon in the app from a
 * curated palette instead of typing free text, so every choice renders consistently across
 * browsers/OS). Two independent registries share the same picker/override mechanism:
 *  - Sidebar nav icons: keyed by NAV_ITEMS' own `path` (e.g. '/events'), default comes from each
 *    item's own `icon` field (see app.js renderSidebar) -- unchanged from the first Icons pass.
 *  - Every other icon in the app (buttons, badges, status markers): keyed by a semantic name (e.g.
 *    'delete', 'approve', 'kpi_open') via ICON_DEFAULTS/ICON() below. Call sites use `ICON('key')`
 *    instead of a hardcoded emoji literal.
 * Both registries are stored in the same flat override JSON on the backend (getAppIcons/
 * setAppIcons) -- nav paths always start with '/', semantic keys never do, so the two never collide.
 *
 * A few glyphs are deliberately NOT wired into this system and stay hardcoded:
 *  - The table sort-direction arrows (▲/▼, ui.js) -- their shape IS the functional meaning
 *    (ascending vs descending); swapping them to a non-directional icon would break the affordance.
 *  - The generic post-click checkmark (css/styles.css `.btn.btn-clicked::after`) -- pure CSS
 *    feedback applied to every button app-wide, not tied to one action, and not reachable from a
 *    JS icon lookup without a parallel CSS-variable mechanism.
 */
window.ICON_LIBRARY = [
  { section: 'General', icons: ['🏠', '⚙️', '🛠️', '🔔', '🔍', '📌', '⭐', '🏷️', '🔗', '↩', '➕', '➖', '✏️', '🗑️', '💡', '🌐'] },
  { section: 'People & Orgs', icons: ['👥', '👤', '🧑‍💼', '🧑‍🔧', '🧑‍✈️', '🎓', '🏢', '🏛️', '🤝', '📇'] },
  { section: 'Places', icons: ['📍', '🗺️', '🏟️', '🏗️', '🏭', '🏨', '🏪', '🏫', '🅿️', '🚧', '🛰️'] },
  { section: 'Calendar & Events', icons: ['📅', '🗓️', '⏰', '⏱️', '🧩', '🎪', '🎫', '📆'] },
  { section: 'Documents & Checklists', icons: ['✅', '📋', '📄', '📑', '🗂️', '📚', '📊', '📈', '📝', '🧾', '🖨️'] },
  { section: 'Status & Alerts', icons: ['⚠️', '🚫', '❌', '🔴', '🟢', '🟡', '🔵', '🟣', '🚩', '🔒', '🔑'] },
  { section: 'Safety & Inspection', icons: ['🛡️', '🦺', '⛑️', '🧯', '🚒', '🧭', '🔎', '📡'] },
  { section: 'Actions & Arrows', icons: ['✔️', '✓', '✕', '👁️', '🖼️', '🔄', '📤', '📥', '⬆️', '⬇️', '⬅️', '➡️', '↩️', '↪️', '←', '→', '⬆', '⬇'] }
];

// Default emoji for every non-nav icon in the app, keyed by the semantic name each call site passes
// to ICON(key). Grouped/labelled in ICON_KEY_GROUPS below for the Settings > Icons picker; this
// object alone is what actually renders (ICON_KEY_GROUPS is just picker metadata).
window.ICON_DEFAULTS = {
  // Actions
  edit: '✏️', delete: '🗑️', approve: '✅', reject: '❌', upload: '⬆️', send: '📤',
  submit: '✔️', print: '🖨️', share: '🔗', back: '←', forward_link: '→',
  close_modal: '✕', clear: '✕', view_open: '👁️', view_credentials: '🔑',
  domain: '🌐', upload_logo: '🖼️', reupload_version: '🔄', deactivate: '🚫',
  activate: '✅', add_account: '➕', remove_from_project: '➖', location_pin: '📍',
  satellite_toggle: '🛰️', map_toggle: '🗺️', open_calendar: '📅', record_results: '📝',
  export_csv: '⬇', logout: '↩', capture_photo: '📷',
  map_fullscreen_enter: '⤢', map_fullscreen_exit: '⤡', detect_places: '🔎',
  page_prev: '←', page_next: '→',
  // Status & badges
  mark_read: '✅', coverage_complete: '✅', locked_indicator: '🔒', gps_locating: '📡',
  warning_banner: '⚠️', file_upload_done: '✓', file_upload_failed: '✕', active_selected: '✓',
  checklist_done: '✅', checklist_pending: '🟡',
  kpi_total: '📊', kpi_open: '🔵', kpi_inreview: '🟣', kpi_reopen: '↩️', kpi_rejected: '⛔',
  kpi_resolved: '✅', kpi_active_events: '🎪',
  // Support tickets (Support.gs / support.js)
  mic_record: '🎙️', mic_stop: '⏹', screen_record: '🎥', resolve_ticket: '✅',
  approve_ticket: '👍', reject_ticket: '↩️'
};

// Picker metadata: groups + friendly labels for every ICON_DEFAULTS key, shown in Settings > Icons
// alongside the sidebar nav items. Every key in ICON_DEFAULTS must appear exactly once below.
window.ICON_KEY_GROUPS = [
  { group: 'Actions', keys: [
    { key: 'edit', label: 'Edit' }, { key: 'delete', label: 'Delete' }, { key: 'approve', label: 'Approve' },
    { key: 'reject', label: 'Reject' }, { key: 'upload', label: 'Upload' }, { key: 'upload_logo', label: 'Upload logo' },
    { key: 'reupload_version', label: 'Upload new version' }, { key: 'send', label: 'Send' }, { key: 'submit', label: 'Submit' },
    { key: 'print', label: 'Print' }, { key: 'share', label: 'Share' }, { key: 'back', label: 'Back' },
    { key: 'forward_link', label: 'View all / forward link' }, { key: 'close_modal', label: 'Close modal' },
    { key: 'clear', label: 'Clear notification' }, { key: 'view_open', label: 'Open / view' },
    { key: 'view_credentials', label: 'View credentials' }, { key: 'domain', label: 'Edit domain' },
    { key: 'deactivate', label: 'Deactivate' }, { key: 'activate', label: 'Activate' },
    { key: 'add_account', label: 'Add account' }, { key: 'remove_from_project', label: 'Remove from project' },
    { key: 'location_pin', label: 'Location / use my location' }, { key: 'satellite_toggle', label: 'Satellite map toggle' },
    { key: 'map_toggle', label: 'Standard map toggle' }, { key: 'open_calendar', label: 'Open calendar picker' },
    { key: 'record_results', label: 'Record inspection results' }, { key: 'export_csv', label: 'Export CSV' },
    { key: 'logout', label: 'Log out' }, { key: 'capture_photo', label: 'Take photo / video (evidence)' },
    { key: 'map_fullscreen_enter', label: 'Expand map to full screen' }, { key: 'map_fullscreen_exit', label: 'Exit full screen map' },
    { key: 'detect_places', label: 'Detect places in boundary' },
    { key: 'page_prev', label: 'Previous page (table pagination)' }, { key: 'page_next', label: 'Next page (table pagination)' }
  ] },
  { group: 'Status & Badges', keys: [
    { key: 'mark_read', label: 'Mark notification read' }, { key: 'coverage_complete', label: 'Coverage complete banner' },
    { key: 'locked_indicator', label: 'Locked / already assigned' }, { key: 'gps_locating', label: 'GPS locating' },
    { key: 'warning_banner', label: 'Warning banner' }, { key: 'file_upload_done', label: 'File upload done' },
    { key: 'file_upload_failed', label: 'File upload failed' }, { key: 'active_selected', label: 'Active selection mark' },
    { key: 'checklist_done', label: 'Checklist item done' }, { key: 'checklist_pending', label: 'Checklist item pending' }
  ] },
  { group: 'Dashboard KPI icons', keys: [
    { key: 'kpi_total', label: 'Total' }, { key: 'kpi_open', label: 'Open' }, { key: 'kpi_inreview', label: 'In Review' },
    { key: 'kpi_reopen', label: 'Re-open' }, { key: 'kpi_rejected', label: 'Rejected' }, { key: 'kpi_resolved', label: 'Resolved' },
    { key: 'kpi_active_events', label: 'Active events' }
  ] },
  { group: 'Support tickets', keys: [
    { key: 'mic_record', label: 'Start voice recording' }, { key: 'mic_stop', label: 'Stop voice recording' },
    { key: 'screen_record', label: 'Record screen + voice' }, { key: 'resolve_ticket', label: 'Mark ticket resolved' },
    { key: 'approve_ticket', label: 'Approve resolution' }, { key: 'reject_ticket', label: 'Reject resolution' }
  ] }
];

// Looks up a semantic icon by key: a SystemAdmin override (Settings > Icons) if one's been saved,
// else the built-in default above. Call sites use ICON('delete') etc. instead of a hardcoded emoji
// literal, so every occurrence of "the delete icon" across the whole app updates from one place.
function ICON(key) {
  var overrides = (window.HululState && HululState.appIcons) || {};
  return overrides[key] || window.ICON_DEFAULTS[key] || '';
}
