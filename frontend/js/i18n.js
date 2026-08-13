/**
 * HULUL - i18n. English + Arabic (RTL) for chrome/navigation and common labels,
 * consistent with SRS 2.3 ("checklist and template content should support both languages").
 *
 * SCALE-UP (full-app Arabic rollout, done in phases -- same "foundation then module-by-module"
 * pattern as the Permissions RBAC rollout): this dictionary is being expanded module by module
 * until every view is bilingual. Two conventions to keep in mind when adding new keys:
 *
 * 1. t(key, vars) now supports {{token}} interpolation, e.g. t('x_created', {term: Term('event')})
 *    -> "Event created" / "تم إنشاء الفعالية". This exists because so many strings in this app
 *    are "New {{term}}" / "{{term}} created" etc. where {{term}} comes from the SEPARATE,
 *    org-configurable Term() system (labels.js) -- t() must never try to translate what Term()
 *    returns, only the fixed words around it. A small set of reusable "verb + {{term}}" templates
 *    (new_x/edit_x/delete_x_confirm/x_created/x_updated/x_deleted/all_x/no_x below) covers most of
 *    that pattern across every module instead of each module inventing its own phrasing.
 * 2. Known limitation: Arabic adjective/verb agreement depends on the grammatical gender of the
 *    noun, which varies per entity (e.g. "فعالية جديدة" feminine vs "مشروع جديد" masculine). The
 *    templates below use the masculine form as a pragmatic default since Term() entity names are
 *    unpredictable admin-configured text; a handful of high-traffic phrases (new_event, tab_*)
 *    stay hand-composed as their own dedicated keys instead of going through the template, exactly
 *    like the existing nav_events/new_event keys already did before this pass.
 */
window.HULUL_I18N = {
  en: {
    tagline: 'Event Readiness & Compliance Platform', email: 'Email', password: 'Password', signIn: 'Sign in',
    searchPlaceholder: 'Search events, findings, users…',
    nav_dashboard: 'Dashboard', nav_events: 'Events', nav_projects: 'Projects', nav_users: 'Users & Roles', nav_orgs: 'Organizations',
    nav_notifications: 'Notifications', nav_settings: 'Settings', nav_logout: 'Log out', nav_support: 'Support',
    nav_reassignment: 'Re-assignment',
    nav_venues: 'Venues', nav_subevents: 'Sub-Events', nav_meetings: 'Meetings', nav_disciplines: 'Disciplines',
    nav_checklist: 'Checklist Items', nav_qualifications: 'Inspector Qualifications', nav_config: 'Config',
    nav_template_library: 'Template Library',
    section_main: 'Main', section_admin: 'Administration',
    dashboard_title: 'Dashboard', dashboard_subtitle: "Here's what's happening across your events",
    kpi_total: 'Total Logs', kpi_open: 'Open', kpi_inreview: 'In Review', kpi_resolved: 'Resolved',
    kpi_reopen: 'Re-open', kpi_rejected: 'Rejected', kpi_events: 'Active Events',
    events_title: 'Events', new_event: 'New Event', tab_overview: 'Overview', tab_chat: 'Chat', tab_venue: 'Venue & Zones',
    tab_templates: 'Readiness Templates', tab_approval: 'Opening Approval', tab_disciplines: 'Disciplines & Inspectors',
    tab_inspections: 'Inspections & Checklists', tab_findings: 'Risk Logging', tab_resolutions: 'Resolutions',
    tab_escalations: 'Escalations', tab_participants: 'Participants', tab_reports: 'Reports', tab_event_log: 'Logs',
    save: 'Save', cancel: 'Cancel', create: 'Create', close: 'Close', actions: 'Actions', status: 'Status',
    loading: 'Loading…', no_data: 'Nothing here yet.',
    filter: 'Filter', export_csv: 'Export CSV', no_matches: 'No rows match your filter.',

    // ---- reusable "verb + {{term}}" templates (see file header) ----
    new_x: '+ New {{term}}', edit_x: 'Edit {{term}}', delete_x_confirm: 'Delete this {{term}}? This cannot be undone.',
    x_created: '{{term}} created', x_updated: '{{term}} updated', x_deleted: '{{term}} deleted',
    all_x: 'All {{term}}', no_x: 'No {{term}}',

    // ---- generic table columns / row actions (reused across most list views) ----
    col_code: 'Code', col_city: 'City', col_start: 'Start', col_end: 'End', col_address: 'Address',
    action_open: 'Open', action_edit: 'Edit', action_delete: 'Delete', ok: 'OK', delete: 'Delete',

    // ---- Events list + New/Edit Event modal (events.js) ----
    events_subtitle: 'All {{term}} across your organisation',
    import_csv: 'Import CSV', field_x_name: '{{term}} name', field_venue: 'Venue', field_address_city_hint: 'Address & city are pulled from the selected {{term}}.',
    field_renting_emc: 'Renting EMC', field_inspection_co: 'Inspection Company', field_project_optional: '{{term}} (optional)',
    toast_emc_required: 'Renting EMC is required', label_no_project: 'No {{term}}',
    venue_edit_hint: '{{venueTerm}}: {{venueName}} — not editable here (fixed at creation)',
    import_results_title: 'Import results', import_created_count: '{{count}} {{term}} created successfully.',
    import_failed_count: '{{count}} row(s) failed:', importing_events: 'Importing events…',
    empty_csv: 'Empty CSV file', csv_columns_required: 'CSV needs at least: Event Name, Venue, Start, End columns',
    no_inspection_cos_found: 'No inspection companies found', no_emc_orgs_found: 'No EMC organizations found'
  },
  ar: {
    tagline: 'منصة جاهزية الفعاليات والامتثال', email: 'البريد الإلكتروني', password: 'كلمة المرور', signIn: 'تسجيل الدخول',
    searchPlaceholder: 'ابحث عن الفعاليات والملاحظات والمستخدمين…',
    nav_dashboard: 'لوحة التحكم', nav_events: 'الفعاليات', nav_projects: 'المشاريع', nav_users: 'المستخدمون والأدوار', nav_orgs: 'الجهات',
    nav_notifications: 'الإشعارات', nav_settings: 'الإعدادات', nav_logout: 'تسجيل الخروج', nav_support: 'الدعم الفني',
    nav_reassignment: 'إعادة التكليف',
    nav_venues: 'المواقع', nav_subevents: 'الفعاليات الفرعية', nav_meetings: 'الاجتماعات', nav_disciplines: 'التخصصات',
    nav_checklist: 'عناصر قوائم المراجعة', nav_qualifications: 'تأهيل المفتشين', nav_config: 'الإعدادات العامة',
    nav_template_library: 'مكتبة القوالب',
    section_main: 'الرئيسية', section_admin: 'الإدارة',
    dashboard_title: 'لوحة التحكم', dashboard_subtitle: 'ملخص ما يجري في فعالياتك',
    kpi_total: 'إجمالي السجلات', kpi_open: 'مفتوح', kpi_inreview: 'قيد المراجعة', kpi_resolved: 'تم الحل',
    kpi_reopen: 'إعادة فتح', kpi_rejected: 'مرفوض', kpi_events: 'فعاليات نشطة',
    events_title: 'الفعاليات', new_event: 'فعالية جديدة', tab_overview: 'نظرة عامة', tab_chat: 'المحادثة', tab_venue: 'الموقع والمناطق',
    tab_templates: 'قوالب الجاهزية', tab_approval: 'اعتماد الافتتاح', tab_disciplines: 'التخصصات والمفتشون',
    tab_inspections: 'التفتيش وقوائم المراجعة', tab_findings: 'سجل المخاطر', tab_resolutions: 'الحلول',
    tab_escalations: 'التصعيد', tab_participants: 'المشاركون', tab_reports: 'التقارير', tab_event_log: 'السجلات',
    save: 'حفظ', cancel: 'إلغاء', create: 'إنشاء', close: 'إغلاق', actions: 'إجراءات', status: 'الحالة',
    loading: 'جارٍ التحميل…', no_data: 'لا توجد بيانات بعد.',
    filter: 'تصفية', export_csv: 'تصدير CSV', no_matches: 'لا توجد صفوف مطابقة للتصفية.',

    // ---- reusable "verb + {{term}}" templates (see file header) ----
    new_x: '+ {{term}} جديد', edit_x: 'تعديل {{term}}', delete_x_confirm: 'هل تريد حذف {{term}}؟ لا يمكن التراجع عن هذا الإجراء.',
    x_created: 'تم إنشاء {{term}}', x_updated: 'تم تحديث {{term}}', x_deleted: 'تم حذف {{term}}',
    all_x: 'كل {{term}}', no_x: 'بدون {{term}}',

    // ---- generic table columns / row actions (reused across most list views) ----
    col_code: 'الرمز', col_city: 'المدينة', col_start: 'البداية', col_end: 'النهاية', col_address: 'العنوان',
    action_open: 'فتح', action_edit: 'تعديل', action_delete: 'حذف', ok: 'موافق', delete: 'حذف',

    // ---- Events list + New/Edit Event modal (events.js) ----
    events_subtitle: 'كل {{term}} في مؤسستك',
    import_csv: 'استيراد CSV', field_x_name: 'اسم {{term}}', field_venue: 'الموقع', field_address_city_hint: 'العنوان والمدينة مأخوذان من {{term}} المحدد.',
    field_renting_emc: 'الجهة المنظمة المستأجرة', field_inspection_co: 'شركة التفتيش', field_project_optional: '{{term}} (اختياري)',
    toast_emc_required: 'الجهة المنظمة المستأجرة مطلوبة', label_no_project: 'بدون {{term}}',
    venue_edit_hint: '{{venueTerm}}: {{venueName}} — غير قابل للتعديل هنا (يُحدَّد عند الإنشاء)',
    import_results_title: 'نتائج الاستيراد', import_created_count: 'تم إنشاء {{count}} {{term}} بنجاح.',
    import_failed_count: 'فشل {{count}} من الصفوف:', importing_events: 'جارٍ استيراد الفعاليات…',
    empty_csv: 'ملف CSV فارغ', csv_columns_required: 'يجب أن يحتوي ملف CSV على الأعمدة التالية على الأقل: اسم الفعالية، الموقع، البداية، النهاية',
    no_inspection_cos_found: 'لا توجد شركات تفتيش', no_emc_orgs_found: 'لا توجد جهات منظمة'
  }
};

function t(key, vars) {
  var dict = window.HULUL_I18N[HululState.lang] || window.HULUL_I18N.en;
  var str = dict[key] || window.HULUL_I18N.en[key] || key;
  if (vars) {
    Object.keys(vars).forEach(function (k) {
      str = str.replace(new RegExp('\\{\\{' + k + '\\}\\}', 'g'), vars[k]);
    });
  }
  return str;
}

function applyI18n(root) {
  root = root || document;
  root.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) { el.placeholder = t(el.getAttribute('data-i18n-placeholder')); });
}

function setLanguage(lang) {
  HululState.lang = lang;
  localStorage.setItem('hulul_lang', lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  applyI18n();
  if (window.renderCurrentView) window.renderCurrentView();
}

function toggleLanguage() { setLanguage(HululState.lang === 'en' ? 'ar' : 'en'); }
