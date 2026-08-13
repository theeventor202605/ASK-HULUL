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
    all_x: 'All {{term}}', no_x: 'No {{term}}', x_not_found: '{{term}} not found.',

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
    no_inspection_cos_found: 'No inspection companies found', no_emc_orgs_found: 'No EMC organizations found',
    back: 'Back',

    // ---- Findings / Risk Logging (findings.js) ----
    finding_log_title: 'Log {{term}}', finding_log_subtitle: 'Record a new non-compliance finding for this {{term}}',
    participant_search_placeholder: 'Search {{term}} by name…', live_location_map_soon: 'Live location side map — coming soon.',
    checklist_type: 'Checklist Type', checklist_type_default_hint: '— (defaults to Other)',
    description: 'Description', suggested_action: 'Suggested action', risk_level: 'Risk level',
    resolution_window_hours: 'Resolution window (hours)', evidence_photo_video: 'Photo or video evidence',
    take_photo_video: 'Take photo / video', your_location: 'Your location',
    map_unavailable: 'Map unavailable (couldn\'t load the map library).',
    outside_boundary_banner: 'You\'re outside the venue boundary — your location isn\'t shown.',
    location_not_available_browser: 'Location isn\'t available in this browser.', gps_locating: 'Getting your location…',
    location_error: 'Couldn\'t get your location — check GPS/location permission.',
    toast_participant_required: '{{term}} is required — search and select one', toast_discipline_required: '{{term}} is required',
    toast_x_logged: '{{term}} logged', toast_x_logged_uploading: '{{term}} logged — evidence still uploading, it\'ll attach automatically',
    no_matches_suggest: 'No matches', no_permission_edit_x: 'You don\'t have permission to edit this {{term}}.',
    could_not_load_x: 'Could not load this {{term}}.', x_already_submitted: 'This {{term}} has already been submitted and can no longer be edited',
    edit_x_title: 'Edit {{term}}', edit_finding_subtitle: 'Update this {{term}} before it\'s submitted', save_changes: 'Save changes',
    no_evidence_attached: 'No evidence attached.', click_to_expand: 'Click to expand', open_original: 'Open original',
    sub_x: 'Sub-{{term}}', category: 'Category', logged: 'Logged', resolution_window: 'Resolution window', location: 'Location',
    risk_logging_evidence: 'Risk Logging evidence', rejected_by_inspector: 'Rejected by inspector',
    rejected_final: ' — final', rejected_fix_resubmit: ' — please fix and resubmit',
    resolution_history: 'Resolution history', resolution_history_subtitle: 'Remarks & photos submitted by the {{term}}',
    reviewer_remarks: 'Reviewer remarks: ', resolve_this_x: 'Resolve this {{term}}', remarks: 'Remarks',
    resolution_evidence_required: 'Photo or video evidence of resolution (required)', submit_resolution: 'Submit resolution',
    review_resolution: 'Review resolution', accept: 'Accept', reject: 'Reject',
    rejection_remarks_required_label: 'Rejection remarks (required)', confirm_rejection: 'Confirm rejection',
    toast_remarks_required: 'Remarks are required', toast_evidence_uploading_wait: 'Evidence is still uploading — please wait for it to finish',
    toast_evidence_required: 'A photo or video of the resolution is required', toast_resolution_submitted: 'Resolution submitted',
    toast_x_resolved: '{{term}} resolved', toast_rejection_remarks_required: 'Rejection remarks are required', toast_resolution_rejected: 'Resolution rejected',
    risk_critical: 'Critical', risk_high: 'High', risk_medium: 'Medium', risk_low: 'Low', risk_label_suffix: '{{label}} RISK',

    // ---- Settings (settings.js) ----
    settings_tab_profile: 'Profile', settings_tab_appearance: 'Appearance', settings_tab_security: 'Security',
    settings_tab_terminology: 'Terminology', settings_tab_icons: 'Icons', settings_tab_permissions: 'Permissions',
    field_organization: 'Organization',
    appearance_language: 'Language', switch_to_lang: 'Switch to {{lang}}', appearance_theme: 'Theme',
    security_current_password: 'Current password', security_new_password: 'New password', update_password: 'Update password',
    toast_password_updated: 'Password updated',
    terminology_create_org_first: 'Create an Organization first to customize its terminology.',
    terminology_intro: 'Rename what these objects are called across the app for your organization\'s users — e.g. call "Events" "Projects". Leave a field blank to use the default. This only changes labels; nothing about the underlying data changes.',
    col_object: 'Object', col_singular: 'Singular', col_plural: 'Plural', toast_terminology_saved: 'Terminology saved',
    icons_intro: 'Click any icon to change it, app-wide for every organization. Hover an icon to see what it\'s for.',
    icons_search_placeholder: 'Search icons…', toast_icons_saved: 'Icons saved',
    permissions_intro: 'Choose which roles can perform each action below. Changes apply immediately, app-wide, and don\'t require a deploy.',
    modules_label: 'Modules', roles_label: 'Roles', all_modules: 'All modules', all_roles: 'All roles',
    no_permissions_match_filter: 'No permissions match the selected filters.',
    toast_at_least_one_role: 'At least one role must be allowed', toast_permission_saved: 'Permission saved',
    toast_reverted_default: 'Reverted to default', customized_default_is: 'Customized — default is {{roles}}',
    reset_to_default: 'Reset to default', choose_icon_modal_title: 'Choose icon',
    choose_icon_intro: 'Choose an icon below, or paste/type your own.', custom_icon_placeholder: 'Paste or type any icon…',
    use_btn: 'Use', toast_type_icon_first: 'Type or paste an icon first', nav_group_label: 'Navigation',

    // ---- Venues + Places (venues.js) ----
    venues_subtitle: '{{term}} available to assign to {{eventTerm}}', places_label: 'Places', col_name: 'Name', col_coordinates: 'Coordinates',
    col_created: 'Created', word_place: 'place', word_place_plural: 'places',
    word_venue_evaluation: 'venue evaluation', word_venue_evaluation_plural: 'venue evaluations',
    toast_cant_delete_has_parts: 'Can\'t delete — this {{term}} already has {{parts}} tied to it.',
    delete_modal_title: 'Delete {{term}}',
    new_x_title: 'New {{term}}', venue_edit_subtitle: 'Update {{term}} information',
    venue_new_subtitle: 'Add a {{term}} your {{eventTerm}} can be held at',
    field_search_place: 'Search a place (optional)', search_place_placeholder: 'Type a place name…',
    field_boundary_color: 'Boundary color',
    venue_map_hint: 'Search above, or drag the pin, to fill in the location — or just type the fields below manually. Use the polygon tool on the map (optional) to draw this {{term}}\'s boundary — Places will need to land inside it once drawn; leave undrawn to keep placement unrestricted. The color picker above sets how the boundary renders on this and every other map that shows it.',
    venue_map_hint_dots: ' Dots show this {{term}}\'s {{count}} already-registered place(s).',
    field_latitude: 'Latitude', field_longitude: 'Longitude', toast_name_required: 'Name is required',
    venue_map_unavailable: 'Map unavailable (couldn\'t load the map library) — search still works if the network allows it, or fill in the fields below manually.',
    map_satellite: 'Satellite', map_view: 'Map',
    search_unavailable_extension: 'Search unavailable — a browser extension may be blocking it. Fill in the fields below manually instead.',
    places_title: 'Places — {{venueName}}', places_subtitle: 'Reusable spots at this {{term}} for Vendors, Operators, and Exhibitors',
    detect_places_btn: 'Detect places in boundary', col_type: 'Type', col_location: 'Location', col_accounts: 'Account(s)',
    word_inactive: '(inactive)', col_created_by: 'Created By', empty_places: 'No places yet.', add_place_card_title: 'Add a place',
    view_credentials_label: 'View credentials', add_another_account_label: 'Add another account',
    field_location_optional: 'Location (optional)', location_placeholder: 'e.g. Near Gate A, north entrance',
    place_map_hint_bounded: 'Click or drag the pin to set the exact spot — must stay within the {{term}} boundary (shaded area).',
    place_map_hint_unbounded: 'This {{term}} has no boundary drawn yet, so location isn\'t map-restricted — click the map or type coordinates manually.',
    add_place_btn: 'Add place', toast_place_added: 'Place added', edit_place_modal_title: 'Edit place',
    toast_place_updated: 'Place updated', confirm_delete_place: 'Remove this place? This can\'t be undone.',
    delete_place_modal_title: 'Delete place', toast_place_deleted: 'Place deleted',
    toast_geolocation_unavailable: 'Geolocation isn\'t available in this browser', locating: 'Locating…', use_my_location: 'Use my location',
    toast_location_denied: 'Location permission denied', toast_location_failed: 'Could not get your location',
    toast_must_stay_within_boundary: 'Must stay within the {{term}} boundary',
    place_map_unavailable: 'Map unavailable (couldn\'t load the map library) — type coordinates manually below.',
    account_credentials_title: 'Account credentials', account_role_login_prefix: 'A {{role}} login for ',
    qr_hint: 'Scan on the participant\'s phone to sign them in automatically — no typing required. The same code keeps working every time.',
    print_btn: 'Print', share_btn: 'Share', qr_unavailable: 'QR code unavailable — share the email/password above instead.',
    toast_allow_popups: 'Please allow pop-ups to print', print_scan_hint: 'Scan the QR code to sign in automatically.',
    toast_copied_clipboard: 'Copied to clipboard', toast_copy_failed: 'Could not copy — copy the details manually',
    no_zone_option: 'No zone', all_zones_option: 'All Zones', no_zones_setup_yet: 'No {{term}} set up yet.',
    change_btn: 'Change', field_zone_optional: '{{term}} (optional)', auto_detected_prefix: 'Auto-detected: {{name}}',
    toast_draw_boundary_first: 'Draw this {{term}}\'s boundary first (Edit {{term}}) -- there\'s nothing to search within yet.',
    searching_osm: 'Searching OpenStreetMap for named places inside this {{term}}\'s boundary…',
    toast_no_osm_places_found: 'No named places found on OpenStreetMap inside this boundary.',
    found_places_new: 'Found {{total}} place(s), {{newCount}} new -- review, adjust type if needed, and uncheck any you don\'t want.',
    found_places_all_existing: 'Found {{total}} place(s), all already on record at this {{term}}.',
    add_selected_places_btn: 'Add selected places', toast_select_at_least_one_place: 'Select at least one place to add',
    adding_places_title: 'Adding places…', adding_places_body: 'Adding {{count}} place(s)…',
    places_added_count: '{{count}} place(s) added', places_failed_suffix: ', {{count}} failed ({{names}})', near_prefix: 'Near '
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
    all_x: 'كل {{term}}', no_x: 'بدون {{term}}', x_not_found: 'لم يُعثر على {{term}}.',

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
    no_inspection_cos_found: 'لا توجد شركات تفتيش', no_emc_orgs_found: 'لا توجد جهات منظمة',
    back: 'رجوع',

    // ---- Findings / Risk Logging (findings.js) ----
    finding_log_title: 'تسجيل {{term}}', finding_log_subtitle: 'تسجيل ملاحظة عدم امتثال جديدة لهذه {{term}}',
    participant_search_placeholder: 'ابحث عن {{term}} بالاسم…', live_location_map_soon: 'خريطة الموقع المباشر الجانبية — قريبًا.',
    checklist_type: 'نوع قائمة المراجعة', checklist_type_default_hint: '— (تُحدَّد افتراضيًا كأخرى)',
    description: 'الوصف', suggested_action: 'الإجراء المقترح', risk_level: 'مستوى الخطورة',
    resolution_window_hours: 'مهلة الحل (ساعات)', evidence_photo_video: 'دليل مصور (صورة أو فيديو)',
    take_photo_video: 'التقاط صورة / فيديو', your_location: 'موقعك',
    map_unavailable: 'الخريطة غير متاحة (تعذّر تحميل مكتبة الخرائط).',
    outside_boundary_banner: 'أنت خارج حدود الموقع — لا يظهر موقعك.',
    location_not_available_browser: 'الموقع غير متاح في هذا المتصفح.', gps_locating: 'جارٍ تحديد موقعك…',
    location_error: 'تعذّر تحديد موقعك — تحقق من إذن GPS/الموقع.',
    toast_participant_required: '{{term}} مطلوب — ابحث واختر واحدًا', toast_discipline_required: '{{term}} مطلوب',
    toast_x_logged: 'تم تسجيل {{term}}', toast_x_logged_uploading: 'تم تسجيل {{term}} — الدليل ما زال قيد الرفع، وسيُرفق تلقائيًا',
    no_matches_suggest: 'لا توجد نتائج', no_permission_edit_x: 'ليس لديك صلاحية تعديل هذا العنصر ({{term}}).',
    could_not_load_x: 'تعذّر تحميل {{term}}.', x_already_submitted: 'تم تقديم هذا العنصر ({{term}}) بالفعل ولم يعد قابلاً للتعديل',
    edit_x_title: 'تعديل {{term}}', edit_finding_subtitle: 'تحديث {{term}} قبل تقديمه', save_changes: 'حفظ التغييرات',
    no_evidence_attached: 'لا يوجد دليل مرفق.', click_to_expand: 'اضغط للتكبير', open_original: 'فتح الأصل',
    sub_x: 'منطقة فرعية ({{term}})', category: 'الفئة', logged: 'تاريخ التسجيل', resolution_window: 'مهلة الحل', location: 'الموقع',
    risk_logging_evidence: 'دليل سجل المخاطر', rejected_by_inspector: 'مرفوض من قِبل المفتش',
    rejected_final: ' — نهائي', rejected_fix_resubmit: ' — يرجى الإصلاح وإعادة التقديم',
    resolution_history: 'سجل الحلول', resolution_history_subtitle: 'ملاحظات وصور مقدَّمة من {{term}}',
    reviewer_remarks: 'ملاحظات المراجع: ', resolve_this_x: 'حل هذا العنصر ({{term}})', remarks: 'ملاحظات',
    resolution_evidence_required: 'دليل مصور للحل (صورة أو فيديو) — مطلوب', submit_resolution: 'تقديم الحل',
    review_resolution: 'مراجعة الحل', accept: 'قبول', reject: 'رفض',
    rejection_remarks_required_label: 'ملاحظات الرفض (مطلوبة)', confirm_rejection: 'تأكيد الرفض',
    toast_remarks_required: 'الملاحظات مطلوبة', toast_evidence_uploading_wait: 'الدليل ما زال قيد الرفع — يرجى الانتظار حتى ينتهي',
    toast_evidence_required: 'مطلوب صورة أو فيديو للحل', toast_resolution_submitted: 'تم تقديم الحل',
    toast_x_resolved: 'تم حل {{term}}', toast_rejection_remarks_required: 'ملاحظات الرفض مطلوبة', toast_resolution_rejected: 'تم رفض الحل',
    risk_critical: 'حرج', risk_high: 'مرتفع', risk_medium: 'متوسط', risk_low: 'منخفض', risk_label_suffix: 'خطورة {{label}}',

    // ---- Settings (settings.js) ----
    settings_tab_profile: 'الملف الشخصي', settings_tab_appearance: 'المظهر', settings_tab_security: 'الأمان',
    settings_tab_terminology: 'المصطلحات', settings_tab_icons: 'الأيقونات', settings_tab_permissions: 'الصلاحيات',
    field_organization: 'الجهة',
    appearance_language: 'اللغة', switch_to_lang: 'التبديل إلى {{lang}}', appearance_theme: 'السمة',
    security_current_password: 'كلمة المرور الحالية', security_new_password: 'كلمة المرور الجديدة', update_password: 'تحديث كلمة المرور',
    toast_password_updated: 'تم تحديث كلمة المرور',
    terminology_create_org_first: 'أنشئ جهة أولاً لتخصيص مصطلحاتها.',
    terminology_intro: 'أعد تسمية هذه العناصر كما تظهر في التطبيق لمستخدمي جهتك — على سبيل المثال تسمية "الفعاليات" بـ"المشاريع". اترك الحقل فارغًا لاستخدام الاسم الافتراضي. هذا يغيّر التسميات فقط؛ لا شيء يتغير في البيانات نفسها.',
    col_object: 'العنصر', col_singular: 'المفرد', col_plural: 'الجمع', toast_terminology_saved: 'تم حفظ المصطلحات',
    icons_intro: 'اضغط على أي أيقونة لتغييرها على مستوى التطبيق لكل الجهات. مرّر المؤشر فوق الأيقونة لمعرفة استخدامها.',
    icons_search_placeholder: 'ابحث عن أيقونة…', toast_icons_saved: 'تم حفظ الأيقونات',
    permissions_intro: 'اختر الأدوار التي يمكنها تنفيذ كل إجراء أدناه. تُطبَّق التغييرات فورًا على مستوى التطبيق دون الحاجة لنشر جديد.',
    modules_label: 'الوحدات', roles_label: 'الأدوار', all_modules: 'كل الوحدات', all_roles: 'كل الأدوار',
    no_permissions_match_filter: 'لا توجد صلاحيات مطابقة للمرشحات المحددة.',
    toast_at_least_one_role: 'يجب السماح بدور واحد على الأقل', toast_permission_saved: 'تم حفظ الصلاحية',
    toast_reverted_default: 'تمت الإعادة إلى الوضع الافتراضي', customized_default_is: 'مخصص — الوضع الافتراضي هو {{roles}}',
    reset_to_default: 'إعادة إلى الوضع الافتراضي', choose_icon_modal_title: 'اختر أيقونة',
    choose_icon_intro: 'اختر أيقونة أدناه، أو الصق/اكتب أيقونتك الخاصة.', custom_icon_placeholder: 'الصق أو اكتب أي أيقونة…',
    use_btn: 'استخدام', toast_type_icon_first: 'اكتب أو الصق أيقونة أولاً', nav_group_label: 'التنقل',

    // ---- Venues + Places (venues.js) ----
    venues_subtitle: '{{term}} متاحة لتُسند إلى {{eventTerm}}', places_label: 'الأماكن', col_name: 'الاسم', col_coordinates: 'الإحداثيات',
    col_created: 'تاريخ الإنشاء', word_place: 'مكان', word_place_plural: 'أماكن',
    word_venue_evaluation: 'تقييم موقع', word_venue_evaluation_plural: 'تقييمات مواقع',
    toast_cant_delete_has_parts: 'تعذّر الحذف — يرتبط بهذا العنصر ({{term}}) حاليًا {{parts}}.',
    delete_modal_title: 'حذف {{term}}',
    new_x_title: '{{term}} جديد', venue_edit_subtitle: 'تحديث بيانات {{term}}',
    venue_new_subtitle: 'أضف {{term}} يمكن أن تُقام فيه {{eventTerm}}',
    field_search_place: 'ابحث عن مكان (اختياري)', search_place_placeholder: 'اكتب اسم مكان…',
    field_boundary_color: 'لون الحدود',
    venue_map_hint: 'ابحث أعلاه، أو اسحب المؤشر، لملء الموقع — أو اكتب الحقول أدناه يدويًا. استخدم أداة الرسم على الخريطة (اختياري) لرسم حدود {{term}} — يجب أن تقع الأماكن داخلها بعد رسمها؛ اتركها بلا رسم لإبقاء التحديد غير مقيَّد. يحدد منتقي اللون أعلاه شكل الحدود على هذه الخريطة وكل خريطة أخرى تعرضها.',
    venue_map_hint_dots: ' تُظهر النقاط {{count}} من الأماكن المسجَّلة مسبقًا في {{term}}.',
    field_latitude: 'خط العرض', field_longitude: 'خط الطول', toast_name_required: 'الاسم مطلوب',
    venue_map_unavailable: 'الخريطة غير متاحة (تعذّر تحميل مكتبة الخرائط) — البحث ما زال يعمل إذا سمحت الشبكة، أو املأ الحقول أدناه يدويًا.',
    map_satellite: 'قمر صناعي', map_view: 'خريطة',
    search_unavailable_extension: 'البحث غير متاح — قد تحجبه إحدى إضافات المتصفح. املأ الحقول أدناه يدويًا بدلاً من ذلك.',
    places_title: 'الأماكن — {{venueName}}', places_subtitle: 'أماكن قابلة لإعادة الاستخدام في {{term}} للبائعين والمشغّلين والعارضين',
    detect_places_btn: 'اكتشاف الأماكن داخل الحدود', col_type: 'النوع', col_location: 'الموقع', col_accounts: 'الحساب (الحسابات)',
    word_inactive: '(غير نشط)', col_created_by: 'أُنشئ بواسطة', empty_places: 'لا توجد أماكن بعد.', add_place_card_title: 'إضافة مكان',
    view_credentials_label: 'عرض بيانات الاعتماد', add_another_account_label: 'إضافة حساب آخر',
    field_location_optional: 'الموقع (اختياري)', location_placeholder: 'مثال: بالقرب من البوابة أ، المدخل الشمالي',
    place_map_hint_bounded: 'اضغط أو اسحب المؤشر لتحديد الموقع الدقيق — يجب أن يبقى داخل حدود {{term}} (المنطقة المظللة).',
    place_map_hint_unbounded: 'لم تُرسم حدود {{term}} بعد، لذا الموقع غير مقيَّد بالخريطة — اضغط على الخريطة أو اكتب الإحداثيات يدويًا.',
    add_place_btn: 'إضافة مكان', toast_place_added: 'تمت إضافة المكان', edit_place_modal_title: 'تعديل المكان',
    toast_place_updated: 'تم تحديث المكان', confirm_delete_place: 'إزالة هذا المكان؟ لا يمكن التراجع عن هذا الإجراء.',
    delete_place_modal_title: 'حذف المكان', toast_place_deleted: 'تم حذف المكان',
    toast_geolocation_unavailable: 'تحديد الموقع الجغرافي غير متاح في هذا المتصفح', locating: 'جارٍ التحديد…', use_my_location: 'استخدام موقعي',
    toast_location_denied: 'تم رفض إذن الموقع', toast_location_failed: 'تعذّر تحديد موقعك',
    toast_must_stay_within_boundary: 'يجب البقاء داخل حدود {{term}}',
    place_map_unavailable: 'الخريطة غير متاحة (تعذّر تحميل مكتبة الخرائط) — اكتب الإحداثيات يدويًا أدناه.',
    account_credentials_title: 'بيانات اعتماد الحساب', account_role_login_prefix: 'تسجيل دخول بدور {{role}} لـ ',
    qr_hint: 'امسح الرمز على هاتف المشارك لتسجيل دخوله تلقائيًا — دون الحاجة للكتابة. يستمر عمل الرمز نفسه في كل مرة.',
    print_btn: 'طباعة', share_btn: 'مشاركة', qr_unavailable: 'رمز QR غير متاح — شارك البريد الإلكتروني وكلمة المرور أعلاه بدلاً من ذلك.',
    toast_allow_popups: 'يرجى السماح بالنوافذ المنبثقة للطباعة', print_scan_hint: 'امسح رمز QR لتسجيل الدخول تلقائيًا.',
    toast_copied_clipboard: 'تم النسخ إلى الحافظة', toast_copy_failed: 'تعذّر النسخ — انسخ التفاصيل يدويًا',
    no_zone_option: 'بدون منطقة', all_zones_option: 'كل المناطق', no_zones_setup_yet: 'لا توجد {{term}} معدّة بعد.',
    change_btn: 'تغيير', field_zone_optional: '{{term}} (اختياري)', auto_detected_prefix: 'تم الاكتشاف التلقائي: {{name}}',
    toast_draw_boundary_first: 'ارسم حدود {{term}} أولاً (تعديل {{term}}) — لا يوجد شيء للبحث ضمنه بعد.',
    searching_osm: 'جارٍ البحث في OpenStreetMap عن أماكن مسمّاة داخل حدود {{term}}…',
    toast_no_osm_places_found: 'لم يُعثر على أماكن مسمّاة في OpenStreetMap داخل هذه الحدود.',
    found_places_new: 'تم العثور على {{total}} مكان (أماكن)، منها {{newCount}} جديد — راجع، وعدّل النوع إن لزم، وألغِ تحديد ما لا تريده.',
    found_places_all_existing: 'تم العثور على {{total}} مكان (أماكن)، كلها مسجَّلة بالفعل في {{term}}.',
    add_selected_places_btn: 'إضافة الأماكن المحددة', toast_select_at_least_one_place: 'اختر مكانًا واحدًا على الأقل للإضافة',
    adding_places_title: 'جارٍ إضافة الأماكن…', adding_places_body: 'جارٍ إضافة {{count}} مكان (أماكن)…',
    places_added_count: 'تمت إضافة {{count}} مكان (أماكن)', places_failed_suffix: '، فشل {{count}} ({{names}})', near_prefix: 'بالقرب من '
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
