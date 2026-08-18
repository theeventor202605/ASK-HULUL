/**
 * HULUL - custom terminology.
 * Every org can rename the platform's core object names for its own users (e.g. call Events
 * "Projects"). This is a pure display-label override — the data model, sheet names, routes, and
 * field names (eventId, etc.) never change, only what's printed on screen. Scoped per-org: a
 * user only ever sees their own org's overrides (or the defaults below if their org has none),
 * see setOrgLabels/getOrgLabels in backend/Accounts.gs for why.
 *
 * Term('event') / Term('event_plural') is the lookup used across the frontend wherever one of these
 * object names appears in nav labels, page/tab titles, buttons, table headers, or empty states.
 */
window.HULUL_LABEL_DEFAULTS = {
  en: {
    event: 'Event', event_plural: 'Events',
    subEvent: 'Sub-Event', subEvent_plural: 'Sub-Events',
    venue: 'Venue', venue_plural: 'Venues',
    zone: 'Zone', zone_plural: 'Zones',
    meeting: 'Meeting', meeting_plural: 'Meetings',
    // REQ: "Throughout the platform change: Discipline to Category." Same entity (the Disciplines
    // sheet/inspector specialty), just a new default display word -- data model, routes, and field
    // names (disciplineId, etc.) are untouched, per this whole Term() system's own design.
    discipline: 'Category', discipline_plural: 'Categories',
    inspector: 'Inspector', inspector_plural: 'Inspectors',
    // REQ: "Rename Checklist Items left sidebar and Checklist Items page to just 'Checklists'."
    // Same Term() mechanism as discipline/checklistType above -- both the sidebar nav label
    // (app.js NAV_ITEMS' entityLabel) and the page's own title (checklistItems.js) already read
    // this one value, so changing it here keeps every other place it appears (New/Edit/Delete
    // modals on that same page, the Completed Checklists progress column, Settings > Permissions'
    // module list) consistent instead of just the two REQ'd spots.
    checklistItem: 'Checklist', checklistItem_plural: 'Checklists',
    // REQ: "Throughout the platform change: Checklist Type to Sub-Category." New term (checklistType
    // wasn't previously part of this pluggable-terminology system -- it was hardcoded i18n text in a
    // handful of places) added here purely so it can rename consistently with (and the same way as)
    // discipline above, and so an org could independently rename it later from Settings > Terminology.
    checklistType: 'Sub-Category', checklistType_plural: 'Sub-Categories',
    finding: 'Risk Log', finding_plural: 'Risk Logs',
    inspection: 'Inspection', inspection_plural: 'Inspections',
    template: 'Template', template_plural: 'Templates',
    report: 'Report', report_plural: 'Reports',
    escalation: 'Escalation', escalation_plural: 'Escalations',
    resolution: 'Resolution', resolution_plural: 'Resolutions',
    participant: 'Participant', participant_plural: 'Participants',
    project: 'Project', project_plural: 'Projects'
  },
  ar: {
    event: 'فعالية', event_plural: 'الفعاليات',
    subEvent: 'فعالية فرعية', subEvent_plural: 'الفعاليات الفرعية',
    venue: 'موقع', venue_plural: 'المواقع',
    zone: 'منطقة', zone_plural: 'المناطق',
    meeting: 'اجتماع', meeting_plural: 'الاجتماعات',
    discipline: 'الفئة', discipline_plural: 'الفئات',
    inspector: 'مفتش', inspector_plural: 'المفتشون',
    checklistItem: 'قائمة المراجعة', checklistItem_plural: 'قوائم المراجعة',
    checklistType: 'الفئة الفرعية', checklistType_plural: 'الفئات الفرعية',
    finding: 'سجل المخاطر', finding_plural: 'سجلات المخاطر',
    inspection: 'تفتيش', inspection_plural: 'عمليات التفتيش',
    template: 'قالب', template_plural: 'القوالب',
    report: 'تقرير', report_plural: 'التقارير',
    escalation: 'تصعيد', escalation_plural: 'التصعيدات',
    resolution: 'حل', resolution_plural: 'الحلول',
    participant: 'مشارك', participant_plural: 'المشاركون',
    project: 'مشروع', project_plural: 'المشاريع'
  }
};

// Ordered list (with a short description) driving the Terminology settings screen.
window.HULUL_LABEL_FIELDS = [
  { key: 'event', desc: 'An event being made ready for launch' },
  { key: 'subEvent', desc: 'A smaller activity within an event' },
  { key: 'venue', desc: 'A physical location hosting an event' },
  { key: 'zone', desc: 'A subdivision of a venue' },
  { key: 'meeting', desc: 'A scheduled kickoff/coordination meeting' },
  { key: 'discipline', desc: 'An inspection specialty (Fire Safety, Security, ...)' },
  { key: 'inspector', desc: 'A person who performs inspections' },
  { key: 'checklistItem', desc: 'A single line item on an inspection checklist' },
  { key: 'checklistType', desc: 'A sub-classification of a checklist item within its Category (Restaurants, Food Truck, ...)' },
  { key: 'inspection', desc: 'A scheduled inspection visit' },
  { key: 'finding', desc: 'A logged non-compliance / risk' },
  { key: 'template', desc: 'A readiness template document' },
  { key: 'report', desc: 'A generated summary report' },
  { key: 'escalation', desc: 'An automatic overdue-finding escalation' },
  { key: 'resolution', desc: 'A submitted fix for a finding' },
  { key: 'participant', desc: 'A vendor/operator/exhibitor taking part in an event' },
  { key: 'project', desc: 'A group of several related events (e.g. a multi-venue program)' }
];

// Renamed from a bare global `L` (its original, and briefer, name) to `Term` because a global
// `function L(key) {...}` PERMANENTLY overwrites window.L, and Leaflet's own namespace also
// lives at window.L -- worse, leaflet-draw's minified bundle reads the *global* `L` identifier
// at call time (not load time) for its own internal cross-references (Control.Draw's
// initialize, DrawToolbar/EditToolbar, the CREATED/EDITED event constants, etc). Since those
// calls happen long after this script runs (whenever a user actually opens a map or draws a
// shape), window.L would already be this function by then, not Leaflet -- causing the
// "Cannot read properties of undefined" crashes chased across venues.js/eventDetail.js's map
// init code. HululLeaflet (index.html) was a partial workaround for the app's OWN Leaflet
// calls, but could never fix leaflet-draw's own bare `L.X` references. This rename is the
// actual root-cause fix: window.L now always stays Leaflet, permanently, and this lookup lives
// at its own name instead.
function Term(key) {
  var overrides = (window.HululState && HululState.orgLabels) || {};
  if (overrides[key]) return overrides[key];
  var lang = (window.HululState && HululState.lang) || 'en';
  var dict = window.HULUL_LABEL_DEFAULTS[lang] || window.HULUL_LABEL_DEFAULTS.en;
  return dict[key] || window.HULUL_LABEL_DEFAULTS.en[key] || key;
}
