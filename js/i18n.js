/**
 * HULUL - i18n. English + Arabic (RTL) for chrome/navigation and common labels,
 * consistent with SRS 2.3 ("checklist and template content should support both languages").
 * Add more keys here as views are extended.
 */
window.HULUL_I18N = {
  en: {
    tagline: 'Event Readiness & Compliance Platform', email: 'Email', password: 'Password', signIn: 'Sign in',
    searchPlaceholder: 'Search events, findings, users…',
    nav_dashboard: 'Dashboard', nav_events: 'Events', nav_users: 'Users & Roles', nav_orgs: 'Organizations',
    nav_notifications: 'Notifications', nav_settings: 'Settings', nav_logout: 'Log out',
    nav_venues: 'Venues', nav_subevents: 'Sub-Events', nav_meetings: 'Meetings', nav_disciplines: 'Disciplines',
    nav_checklist: 'Checklist Items', nav_qualifications: 'Inspector Qualifications', nav_config: 'Config',
    section_main: 'Main', section_admin: 'Administration',
    dashboard_title: 'Dashboard', dashboard_subtitle: "Here's what's happening across your events",
    kpi_total: 'Total Logs', kpi_open: 'Open', kpi_inreview: 'In Review', kpi_resolved: 'Resolved',
    kpi_reopen: 'Re-open', kpi_rejected: 'Rejected', kpi_events: 'Active Events',
    events_title: 'Events', new_event: 'New Event', tab_overview: 'Overview', tab_venue: 'Venue & Zones',
    tab_templates: 'Readiness Templates', tab_approval: 'Venue Approval', tab_disciplines: 'Disciplines & Inspectors',
    tab_inspections: 'Inspections & Checklists', tab_findings: 'Risk Logging', tab_resolutions: 'Resolutions',
    tab_escalations: 'Escalations', tab_participants: 'Participants', tab_reports: 'Reports',
    save: 'Save', cancel: 'Cancel', create: 'Create', close: 'Close', actions: 'Actions', status: 'Status',
    loading: 'Loading…', no_data: 'Nothing here yet.'
  },
  ar: {
    tagline: 'منصة جاهزية الفعاليات والامتثال', email: 'البريد الإلكتروني', password: 'كلمة المرور', signIn: 'تسجيل الدخول',
    searchPlaceholder: 'ابحث عن الفعاليات والملاحظات والمستخدمين…',
    nav_dashboard: 'لوحة التحكم', nav_events: 'الفعاليات', nav_users: 'المستخدمون والأدوار', nav_orgs: 'الجهات',
    nav_notifications: 'الإشعارات', nav_settings: 'الإعدادات', nav_logout: 'تسجيل الخروج',
    nav_venues: 'المواقع', nav_subevents: 'الفعاليات الفرعية', nav_meetings: 'الاجتماعات', nav_disciplines: 'التخصصات',
    nav_checklist: 'عناصر قوائم المراجعة', nav_qualifications: 'تأهيل المفتشين', nav_config: 'الإعدادات العامة',
    section_main: 'الرئيسية', section_admin: 'الإدارة',
    dashboard_title: 'لوحة التحكم', dashboard_subtitle: 'ملخص ما يجري في فعالياتك',
    kpi_total: 'إجمالي السجلات', kpi_open: 'مفتوح', kpi_inreview: 'قيد المراجعة', kpi_resolved: 'تم الحل',
    kpi_reopen: 'إعادة فتح', kpi_rejected: 'مرفوض', kpi_events: 'فعاليات نشطة',
    events_title: 'الفعاليات', new_event: 'فعالية جديدة', tab_overview: 'نظرة عامة', tab_venue: 'الموقع والمناطق',
    tab_templates: 'قوالب الجاهزية', tab_approval: 'اعتماد الموقع', tab_disciplines: 'التخصصات والمفتشون',
    tab_inspections: 'التفتيش وقوائم المراجعة', tab_findings: 'سجل المخاطر', tab_resolutions: 'الحلول',
    tab_escalations: 'التصعيد', tab_participants: 'المشاركون', tab_reports: 'التقارير',
    save: 'حفظ', cancel: 'إلغاء', create: 'إنشاء', close: 'إغلاق', actions: 'إجراءات', status: 'الحالة',
    loading: 'جارٍ التحميل…', no_data: 'لا توجد بيانات بعد.'
  }
};

function t(key) {
  var dict = window.HULUL_I18N[HululState.lang] || window.HULUL_I18N.en;
  return dict[key] || window.HULUL_I18N.en[key] || key;
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
