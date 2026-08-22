/**
 * HULUL - Utils.gs
 * Generic Sheet-as-DB helpers, schema definition, id generation, audit log, JSON response helpers.
 */

// ---- Schema: single source of truth for every sheet's columns -----------
var SCHEMA = {
  // domain appended at the end (established pattern -- see Venues below) -- used to build
  // auto-generated Place-account login emails (e.g. 'vendor001@yawad.sa'); blank on old rows,
  // in which case placeAccountDomain_ (Places.gs) falls back to slugifying the org name.
  // photoPropsJson: REQ (Settings > Photos Properties) -- per-org JSON blob controlling how this
  // org's own logo is stamped onto captured evidence photos ({logoEnabled, logoPosition}), plus (for
  // Inspection Company-type orgs only, since they're the ones actually capturing evidence)
  // {geoEnabled, geoPosition, qrEnabled, qrPosition} for the geolocation stamp + QR code. Blank/absent
  // means "use the pre-existing hardcoded defaults" -- see photoProps_ (Accounts.gs). Same single-JSON-
  // column pattern as AppIcons.iconsJson, just scoped per-org instead of one global row.
  // REQ: "set for an Organisation the permissions they can set" (clarified: per Organization TYPE, not
  // per individual org) -- no schema field needed here for it; the ceiling lives in Config
  // (ORG_TYPE_CEILING_CONFIG_KEY_, Permissions.gs) keyed by `type` ('GA'/'EMC'/'INSPECTION'), shared by
  // every organization of that type. See getOrgTypeCeiling_.
  Organizations:          ['id','type','name','status','createdAt','logoUrl','domain','photoPropsJson'],
  // unavailable/unavailableReason/unavailableSince appended at the end -- REQ: "If a user is absent
  // then he will be added to list in this page as unavailable" (Sidebar Re-assignment, see
  // Reassignment.gs). Deliberately separate from `status` (Active/Inactive, which gates login) --
  // marking someone unavailable is a temporary scheduling signal, not an account suspension; an
  // absent Inspector should still be able to log in and see their own assignments, just not be
  // assignable to new ones while flagged.
  // lastLat/lastLng/lastSeenAt appended at the end -- REQ (Dashboard): "Live map showing all
  // inspector locations." General-purpose location ping, not tied to any one Inspection/Event like
  // Inspections.lastLat/lastLng/lastSeenAt already is (see pingInspectionLocation) -- this one covers
  // ANY logged-in user regardless of role, so a future custom role (e.g. "Cluster") is tracked the
  // same way with no code change, see pingUserLocation (LiveLocation.gs). Blank until a device has
  // ever sent one.
  // photoUrl/mobile/jobTitle/bio appended at the end -- REQ: "Make user profile rich. Add personal
  // information like photo, mobile, email, certificates, and other related profile information."
  // email already existed; certificates are their own sheet (UserCertificates below, many-per-user).
  // Self-service only (getMyProfile/updateMyProfile/uploadMyProfilePhoto, Accounts.gs) -- every one of
  // these is the CALLING user's own row, never another user's, so no new admin permission was needed.
  // Blank on any pre-existing row. photoUrl follows the exact same Drive-thumbnail-URL convention as
  // Organizations.logoUrl (see uploadOrgLogo's own comment) -- safeUser/stripSecrets_ (Auth.gs/
  // Accounts.gs) already pass every Users field through as-is (just strips password fields), so these
  // reach the frontend for free with no changes needed there.
  Users:                  ['id','name','email','orgType','orgId','role','status','passwordHash','passwordSalt','createdBy','createdAt','lastLoginAt','unavailable','unavailableReason','unavailableSince','lastLat','lastLng','lastSeenAt','photoUrl','mobile','jobTitle','bio'],
  // REQ: "Make user profile rich ... certificates." One row per uploaded certificate/qualification
  // document -- a user can have any number, unlike the single-row-per-field pattern the Users columns
  // above use for the simpler text fields. issuedAt/expiresAt are both optional free-text-ish date
  // strings (not validated against a strict format) since a scanned certificate's own printed dates
  // vary in precision (some are year-only). File storage mirrors uploadOrgLogo's Drive pattern exactly
  // -- see addMyCertificate (Accounts.gs).
  UserCertificates:       ['id','userId','name','issuer','fileUrl','fileName','mimeType','issuedAt','expiresAt','uploadedAt'],
  Sessions:               ['token','userId','createdAt','expiresAt'],
  // lat/lng/status appended at the end (not inserted mid-schema) so existing Venues rows in the
  // live sheet -- whose data sits in fixed physical columns -- don't get silently reread under the
  // wrong header. status is blank for every pre-existing row, which listVenues treats as active
  // (same convention as Zones' status column) -- soft-deleted venues get 'Deleted' (see deleteVenue).
  // boundary appended at the end on both Venues and Zones -- REQ: "Allow to draw venue boundaries
  // when creating venue, and remove the 1 km restriction, restriction now will be venue boundary...
  // When creating zones, allow to draw zone boundary." A JSON-stringified array of {lat,lng} points
  // (a closed polygon, first point not repeated at the end), or '' when no boundary has been drawn
  // yet -- Places.gs's createPlace falls back to unrestricted placement in that case (same "no
  // coordinates on record = no restriction" fallback already used when a Venue has no lat/lng at
  // all), exactly like the 1km-circle behavior it replaces. See pointInPolygon_ below for how this
  // gets checked.
  // color appended at the end -- hex string (e.g. '#4f46e5') the user picks for how this venue's
  // boundary renders on every map that shows it (venues.js's own venueMap/placeMap, the Event >
  // Venue & Zones "Places map" in eventDetail.js). Blank means "use the app's default boundary
  // color" (every render site already falls back to the same default when this is empty).
  Venues:                 ['id','name','address','city','emcId','createdAt','lat','lng','status','boundary','color'],
  // color appended at the end, same idea/fallback convention as Venues.color above -- REQ: "provide
  // the ability to choose zone colour after zone boundaries are drawn". Blank falls back to
  // ZONE_BOUNDARY_COLORS_' auto-cycled palette (eventDetail.js) so existing zones created before
  // this field existed still render distinguishably without needing a migration.
  Zones:                  ['id','venueId','name','createdAt','status','boundary','color'],
  // projectId appended at the end -- links this Event into a Projects group (see Projects.gs).
  // 'project' (the older free-text field) is kept as-is for backward compatibility/CSV import, but
  // is no longer what the app's grouping UI uses; projectId is the structured version of the same
  // idea, so a project can exist (and be added to) before it has any events, be renamed without
  // breaking anything, and group events regardless of exact-name typos.
  // templatesDeadlineAt appended at the end (established pattern, see Participants above) -- REQ: PM
  // sets ONE deadline that applies to every Readiness Template sent for this event (not a per-
  // template field). Unlike startDateTime/endDateTime above, this is NOT in DATE_TEXT_COLUMNS_ below
  // and is deliberately stored as a full toISOString() UTC instant (same convention as
  // Findings.resolutionWindowAt) rather than literal local wall-clock text -- it gets compared
  // against `new Date()` server-side every 30 minutes (checkTemplateDeadlines, Templates.gs) to
  // auto-mark overdue templates Missed, and a 'Z'-suffixed ISO string parses back to the same exact
  // instant everywhere regardless of the spreadsheet's timezone, sidestepping the whole class of
  // drift bug that DATE_TEXT_COLUMNS_ exists to guard against for the *display*-oriented fields.
  // Computed once at save time even when the PM picks "N days/weeks before start" rather than an
  // absolute date -- so it doesn't silently shift if startDateTime is edited afterward. Blank = no
  // deadline set yet.
  // planTypeId appended at the end -- REQ: "the PM must create the event management plan, they call
  // it Roadmap ... they have normal plan, they have parachute plan and others." Points at a
  // RoadmapPlans row (see RoadmapPlans.gs) chosen on the Create Event form; the moment the event is
  // created, every item in that plan template is rolled out into dated EventRoadmapItems rows for
  // THIS event (rolloutEventRoadmap_). Blank = no plan assigned, same "feature simply doesn't apply"
  // convention as every other optional Events field here.
  Events:                 ['id','name','code','project','venueId','address','city','startDateTime','endDateTime','emcId','inspectionCoId','eventManagerId','status','createdBy','createdAt','projectId','templatesDeadlineAt','planTypeId'],
  // A GA-level grouping of several Events (e.g. a multi-venue program) -- see Projects.gs.
  Projects:               ['id','name','description','createdBy','createdAt'],
  SubEvents:              ['id','eventId','name','startDateTime','endDateTime'],
  VenueEvaluations:       ['id','eventId','venueId','inspectionCoId','recommendation','recommendationBy','recommendationAt','decision','decisionBy','decisionAt','status'],
  // A per-event Templates row only exists once a Project Manager has actually sent that library
  // document to the event (see Templates.gs) -- there's no row for "not sent yet". libraryTemplateId
  // links back to the TemplateLibrary entry it was sent from; name/fileUrl/fileName/mimeType are a
  // locked-in snapshot of that library entry at send time, independent of later library updates.
  // docType appended at the end -- REQ: "convert the templates to forms and include evaluation
  // process" (Document Review Tool, GA26/JDCB workbook). Snapshotted from the TemplateLibrary entry
  // at send time (same locked-in-copy convention as name/fileUrl/fileName/mimeType above), so a
  // scoring form always uses the catalog that matched this document when it was sent, even if the
  // library entry's own docType is later retagged. 'ZSMP'/'ZERP' (v1 scope) drive
  // TemplateScoringItems lookups (see listTemplateScoringItems, Templates.gs); blank or any other
  // value just means this document type has no structured scoring form yet -- the plain Evaluated/
  // Missed decision (reviewEventTemplate) keeps working exactly as before either way.
  // scoringFinalizedAt/scoringFinalizedBy: REQ follow-up: "After all items are scored prompt to
  // finalize instead of save. Finalize closes score editing." -- blank means the Document Review
  // scoring form is still open for editing (or was never started); once set, saveTemplateScoring
  // rejects further writes until reopenTemplateScoring (admin-only, see Permissions.gs
  // 'template.reopenScoring') clears them again. Independent of `status` (Sent/Submitted/Evaluated/
  // etc, the upload/review workflow) -- a document can be Evaluated without its scoring form ever
  // being finalized, or vice versa; these two workflows track different things.
  // versionNumber: which documents-deadline round (TemplateDeadlineVersions.versionNumber) this row
  // currently reflects -- the round it was sent/reset for, UNLESS it's since been Evaluated, in which
  // case it stays pinned to whichever round it was actually approved in even after later rounds open
  // (REQ follow-up: "those approved [documents]... I wanted them to stay in their current state" --
  // see resetTemplatesForNewVersion_, Templates.gs).
  Templates:              ['id','eventId','libraryTemplateId','name','status','fileUrl','fileName','mimeType','sentBy','sentAt','uploadedBy','updatedAt','reviewedBy','reviewedAt','reviewReason','createdAt','docType','scoringFinalizedAt','scoringFinalizedBy','versionNumber'],
  // REQ: "When Documents deadline (first version) is reached; Lock all documents no editing allowed
  // no upload allowed, reserve the status of the documents. Then create a second deadline one week
  // (configurable) after first version deadline ... A third or fourth version deadline can be
  // created manually by responsible role." One row per deadline "round" for an event -- version 1 is
  // the PM's original deadline (setTemplatesDeadline), version 2 is auto-created the instant version
  // 1's deadline passes (gap from Config key templateDeadlineVersionGapDays, default 7 days), and
  // version 3+ can only be created manually (createNextTemplateDeadlineVersion) once the current
  // latest version's deadline has already passed -- see Templates.gs for the full lock/transition
  // logic (isTemplatesLocked_, maybeAutoCreateVersion2_).
  TemplateDeadlineVersions: ['id','eventId','versionNumber','deadlineAt','autoCreated','createdBy','createdAt'],
  // REQ (same feature): "reserve the status of the documents" -- once a version's deadline passes,
  // every per-event Templates row's state at that moment is archived here (one row per Templates row
  // per versionNumber, written once via snapshotOverdueVersionsIfNeeded_ and never touched again)
  // before the live Templates row resets to a fresh 'Sent' state for whichever version comes next --
  // see resetTemplatesForNewVersion_, Templates.gs. This is what lets a PM look back at exactly what
  // was submitted (and its reviewed status) as of each past deadline.
  TemplateVersionSnapshots: ['id','eventId','templateId','libraryTemplateId','versionNumber','name','status','fileUrl','fileName','mimeType','reviewedBy','reviewedAt','reviewReason','snapshotAt'],
  // toJson/ccJson: JSON-stringified arrays of Users.id (invitee/cc userIds) -- same
  // array-in-a-single-cell convention as the Permissions sheet's overridesJson (Permissions.gs).
  // status: 'Scheduled' (default) or 'Deleted' (soft delete -- see deleteMeeting in Templates.gs,
  // same pattern as ChecklistItems' status:'Deleted').
  Meetings:               ['id','eventId','subEventId','type','scheduledAt','toJson','ccJson','meetingLink','notes','status','createdBy','createdAt','updatedBy','updatedAt'],
  // REQ (To-Do Inbox): "Any upcoming meetings not yet attended." Meetings itself has no per-person
  // attendance concept (toJson/ccJson is just who's invited) -- one row per (meeting, user) who has
  // explicitly marked themselves attended, same many-to-many-via-its-own-sheet shape as VenueAttendance
  // below, but written by an explicit self-service action (markMeetingAttended, Meetings.gs) rather
  // than a passive geofence ping. markedBy is almost always the same as userId (self-mark) but kept
  // separate in case an organizer ever marks attendance on someone else's behalf later.
  MeetingAttendance:      ['id','meetingId','userId','attendedAt','markedBy'],
  // catRef appended at the end (established pattern, see Venues above) -- REQ: "Add new column
  // name it 'Cat Ref.' This holds reference number for this specific category but should be
  // displayed in Roman values." Stored as a plain whole number; the Roman-numeral conversion is
  // display-only, done client-side (disciplines.js's toRoman_) so sorting/CSV/etc. stay numeric.
  // Blank on any pre-existing row created before this field existed.
  // nameAr appended at the end -- REQ: "When turning platform to Arabic, some information is still
  // in English" (Discipline/Category names, e.g. "Crowd Safety"). Optional: an admin fills it in
  // once, and the frontend shows it instead of `name` whenever HululState.lang === 'ar' (see bi_(),
  // i18n.js), falling back to `name` when blank -- same "blank == not set yet" convention as every
  // other appended column, so nothing about an existing row changes until someone deliberately adds
  // an Arabic name.
  Disciplines:            ['id','name','code','catRef','nameAr'],
  EventDisciplines:       ['id','eventId','disciplineId','venueId','identifiedBy','createdAt'],
  InspectorQualifications:['id','userId','disciplineId'],
  // checklistTypes (REQ follow-up: "In Assign inspector section, Sub category can be selected or by
  // default all sub-categories are selected.") -- comma-joined ChecklistItems.checklistType values
  // this assignment covers, same convention as zoneIds just above. Blank means "covers every
  // sub-category under this discipline" -- both for assignments made before this field existed AND
  // for a deliberate blanket assignment on a discipline with no sub-category catalogue -- so nothing
  // about existing rows/behavior changes just from this column appearing. See
  // coveredChecklistTypesForDiscipline_ (Disciplines.gs) for how "already picked up" sub-categories
  // are excluded from a later assignment's picker.
  InspectorAssignments:   ['id','eventId','disciplineId','inspectorId','assignedBy','assignedAt','zoneIds','checklistTypes'],
  // subRef/itemRef appended at the end (established pattern, see Venues above) -- REQ: "Sub-Category
  // must also have 'Sub Ref.' which is a whole number but always displayed as two digits ... each
  // item in the checklist must have 'Item Ref.' ... always displayed as three digits." Both stored
  // as plain whole numbers; the zero-padded display formatting is done client-side (checklistItems.js)
  // so sorting/CSV/etc. stay numeric. Blank on any pre-existing row created before these fields existed.
  // checklistTypeAr appended at the end -- REQ: "When turning platform to Arabic, some information
  // is still in English" (Sub-Category/Checklist Type names, e.g. "CSM Queue & Flow Management").
  // Same optional/fallback convention as Disciplines.nameAr just above: blank until an admin fills
  // it in, shown instead of `checklistType` only when HululState.lang === 'ar' (bi_(), i18n.js).
  // `category` (the Discipline name snapshot) doesn't get its own Ar copy here -- its Arabic value
  // comes from resolving the linked Discipline's own nameAr instead, so there's exactly one place
  // an Arabic Discipline name is ever stored, not one per ChecklistItems row.
  ChecklistItems:         ['id','checklistType','category','description','defaultRisk','defaultWindowHours','phase','status','subRef','itemRef','checklistTypeAr'],
  // lastLat/lastLng/lastSeenAt appended at the end (established pattern, see Venues above) -- REQ:
  // "Inspectors live location as they start inspections. This applies to all maps." Written by
  // pingInspectionLocation (Inspections.gs), called periodically from the inspector's own device
  // while their live-tracking view (startLiveInspectionTracking_, eventDetail.js) is open. Blank on
  // every pre-existing row and on any inspection an inspector hasn't opened yet, which
  // listActiveInspectorLocations correctly treats as "nothing to show" rather than a stale (0,0) dot.
  // assignedVia -- REQ: "Any inspector who has not been assigned can start on a checklist that has
  // not been assigned to anyone as long as he is qualified in that category. Once he picks up an
  // opening sub-checklist it becomes unavailable to other inspectors unless cancelled by the
  // inspector." 'self' on a row created via claimOpenInspectionSlot (Inspections.gs), blank on the
  // normal PM-driven scheduleInspection path -- distinguishes which ones the assigned Inspector is
  // allowed to cancel themselves (cancelSelfAssignedInspection) vs. only a PM/SystemAdmin can
  // (deleteInspection), so a PM's own manually-scheduled visit can never vanish out from under them.
  Inspections:            ['id','eventId','disciplineId','inspectorId','checklistType','scheduledAt','phase','status','lastLat','lastLng','lastSeenAt','assignedVia'],
  // participantId appended at the end (established pattern, see Venues above) -- pre-existing
  // results from before per-participant tracking existed read back with participantId === '',
  // which correctly counts toward no one's completion rather than silently miscounting.
  // findingId: REQ follow-up: "are logs traceable back to that checklist item?" -- the reverse
  // direction too. Set (recordInspectionResults, Inspections.gs) right after the Finding it produced
  // is created, only ever non-blank for a Crossed result -- lets the Completed Checklists detail view
  // link straight to the Finding that came out of a given crossing.
  InspectionResults:      ['id','inspectionId','checklistItemId','state','riskLevel','resolutionWindowHours','notes','evidenceUrls','recordedAt','participantId','findingId'],
  // checklistItemId/recreatedFromId appended at the end (established pattern, see Venues above).
  // checklistItemId -- REQ: "Any log created through a checklist must be traceable to that specific
  // item in the checklist." Set only when a Finding is auto-created from a Crossed checklist item
  // (recordInspectionResults, Inspections.gs); blank on manually-logged findings (Log Finding has no
  // single checklist item to point at -- see createFinding, Findings.gs). Pre-existing rows read back
  // with checklistItemId === '', same as any other appended column.
  // recreatedFromId -- REQ: "A second rejection lands on Rejected, which is terminal, but
  // automatically creates a new instance from the rejected log and lands it in Open." Points at the
  // Findings.id this row was auto-cloned from; blank on every normally-created finding. See
  // reviewFindingResolution, Findings.gs.
  // evidenceMeta -- REQ follow-up: "Instead of showing 'OUTSIDE VENUE BOUNDARY' on photos make it a
  // badge also provide distance away from participant in meters." JSON string of
  // [{url, outsideBoundary, distanceMeters}, ...], one entry per evidence URL that was captured
  // outside the venue boundary (see evidenceComposite_/prepare, evidence.js) -- entries with no badge
  // to show are never added, so this stays blank on the vast majority of findings. See enrichFinding_/
  // createFinding/addFindingEvidence below.
  // descriptionAr/suggestedActionAr -- REQ follow-up: "there will be no Arabic for Finding
  // descriptions...!" appended at the end, same convention as every other *Ar column added so far --
  // optional, blank on any pre-existing row created before this field existed. Unlike the catalog *Ar
  // fields (Disciplines.nameAr etc.), these are filled in by whoever logs/edits the Finding itself,
  // not a separate admin -- see the Arabic textareas next to Description/Suggested Action on the New
  // Log and Edit Finding forms (findings.js).
  // resolvedAt appended at the end -- REQ (To-Do Inbox): "All logs that have been created but not yet
  // resolved" needed a real timestamp for the moment a Finding reaches its terminal 'Resolved' status,
  // so a completed inbox item can be dated/sorted -- blank until then, set alongside status:'Resolved'
  // at both places that transition happens (the auto-resolve-Info path and reviewFindingResolution's
  // Approved branch, Findings.gs). Never read anywhere else in the app besides the inbox.
  Findings:               ['id','eventId','inspectionId','disciplineId','category','subCategory','description','suggestedAction','riskLevel','resolutionWindowAt','nextInspectionAt','participantId','subZone','location','status','evidenceUrls','lat','lng','createdBy','createdAt','reopenCount','checklistItemId','recreatedFromId','evidenceMeta','descriptionAr','suggestedActionAr','resolvedAt'],
  // REQ: "Some inspectors are junior level and could use help. We have created a guide which should
  // give them a list of descriptions once they select the category and sub-category." A reference
  // catalogue (seeded once from the user's "Log Assistance Guide" spreadsheet, see
  // seedFindingGuide_ in Setup.gs) that the New/Edit Finding form (findings.js) uses to suggest a
  // pre-written Description + Suggestion once the inspector picks a Discipline (category) and
  // Checklist Type (subCategory) -- see findingGuide.js for the admin CRUD/CSV page that keeps it
  // maintainable going forward. category/subCategory are plain text, matched against
  // Disciplines.name / the Checklist Type field by exact string (case-insensitive) at read time in
  // the frontend, not a foreign key -- same "match by name" convention ChecklistItems.category
  // already uses for Disciplines.
  // descriptionAr/suggestionAr appended at the end -- REQ: "When turning platform to Arabic, some
  // information is still in English" (the suggested Description/Suggestion text this catalogue
  // hands the New/Edit Finding form). Same optional/fallback convention as Disciplines.nameAr:
  // blank until an admin fills them in, shown instead of description/suggestion only when
  // HululState.lang === 'ar' (bi_(), i18n.js).
  FindingGuide:           ['id','category','subCategory','description','suggestion','descriptionAr','suggestionAr'],
  // toUserIds/ccUserIds/notedUserIds replace the old single recipientUserId -- REQ: "ability to
  // modify the To user role and the Cc: user roles", each tier can now resolve to MULTIPLE users
  // per role (e.g. every EMCManager in the org), and each of them needs their own independent
  // "Noted" dismissal for the full-screen lock alert (REQ: "user must click Noted"). All three are
  // comma-joined id lists, same convention as InspectorAssignments.zoneIds. Only toUserIds get the
  // full-screen lock (Cc is notification/badge only, see escalationLockOverlay in app.js);
  // notedUserIds only ever grows from toUserIds. resolvedAt unchanged: still stamped when the
  // parent Finding's resolution is approved (see reviewFindingResolution, Findings.gs).
  Escalations:            ['id','findingId','tier','triggeredAt','toUserIds','ccUserIds','notedUserIds','resolvedAt'],
  // submittedBy added at the end (REQ follow-up: "know who opens, solves, and closes a log") -- the
  // literal caller who clicked Submit, distinct from participantId (the shared Operator/Participant
  // record the resolution is filed under, which can span multiple individual logins across shifts --
  // see participantSiblingIds_, Findings.gs). Appended, not inserted, so existing rows' positional
  // column mapping doesn't shift (same convention as every other schema extension in this file).
  Resolutions:            ['id','findingId','participantId','evidenceUrls','remarks','submittedAt','reviewedBy','decision','comments','reviewedAt','submittedBy'],
  // lat/lng/disciplineIds appended at the end (established pattern, see Venues above). Empty zoneId
  // means "operates in every zone" for coverage purposes (see participantRelevantToInspection_ in
  // Inspections.gs) -- most Operators have no single zone, unlike Vendors/Exhibitors. disciplineIds
  // is a comma-joined list (same convention as InspectorAssignments.zoneIds) of which Disciplines
  // this participant needs to be inspected against.
  // venueId appended at the end -- most Participants are scoped to a Venue, not one Event, so the
  // same Vendor/Operator/Exhibitor naturally covers every Event held at that venue instead of being
  // re-entered per event. eventId is revived (see Places.gs's eventId column, added for the same
  // reason) for a second, temporary kind of Participant: one registered for a single Event only
  // (e.g. a vendor attending just this one season), auto-deactivated once that Event ends (see
  // deactivateEndedEventPlaceAccounts in Places.gs) instead of persisting across every future Event
  // at the venue. Blank eventId = permanent/venue-wide, as before.
  // nameAr -- REQ follow-up: "Add an optional Arabic field to Findings (and ... Participants)."
  // Participants don't actually have their own create/edit form -- a Participant's name is copied
  // from its linked Place (provisionPlaceAccount_/updatePlace, Places.gs) whenever an account is
  // provisioned/edited there, so nameAr is kept in sync the same way (blank on pre-existing rows).
  Participants:           ['id','eventId','type','name','zoneId','location','contactEmail','userId','createdAt','lat','lng','disciplineIds','venueId','nameAr'],
  // A persistent, reusable, opaque login token minted once for a Place-account's auto-generated
  // login, so a QR code printed and left at that physical spot can encode just the token (never
  // the plaintext password) and keep working every shift, not just once -- see
  // mintQuickLoginToken_/redeemQuickLogin in Places.gs. Deliberately NOT single-use/expiring: the
  // whole point is a shift worker scanning the same posted QR every day. Deactivating the
  // underlying Users account (see deactivateUser in Accounts.gs) is what invalidates it -- redeem
  // re-checks the account's status exactly like a normal login.
  QuickLoginTokens:       ['token','userId','createdAt'],
  Reports:                ['id','eventId','type','generatedAt','generatedBy','summaryJson'],
  // eventId appended at the end -- lets the frontend turn a notification click into a direct link
  // to that Event (the right tab is derived from relatedType client-side, see NOTIF_TAB_BY_RELATED_
  // in notifications.js), without having to reverse-map relatedId (usually a child record's own id,
  // not the eventId) back to an event. Blank for notifications that aren't about one event.
  Notifications:          ['id','userId','type','message','relatedType','relatedId','isRead','createdAt','eventId'],
  AuditLog:               ['id','actor','action','targetType','targetId','timestamp','details'],
  Config:                 ['key','value'],
  // Per-organization custom terminology (REQ: "call Events Projects" etc.) — one row per org,
  // labelsJson is a JSON object of entityKey -> custom label overriding the built-in default.
  OrgLabels:              ['id','orgId','labelsJson','updatedAt','updatedBy'],
  // Single global row (id 'GLOBAL') -- see getAppIcons/setAppIcons in Accounts.gs.
  // customLibrariesJson: SystemAdmin-imported custom emoji/glyph sets, shown as extra groups in
  // the icon picker alongside the built-in ICON_LIBRARY -- see getCustomIconLibraries/
  // addCustomIconLibrary/deleteCustomIconLibrary in Accounts.gs.
  AppIcons:               ['id','iconsJson','customLibrariesJson','updatedAt','updatedBy'],
  // Admin-configurable RBAC overrides -- single global row (id 'GLOBAL'), same one-row-JSON-blob
  // convention as AppIcons above. overridesJson is a JSON object of permissionKey -> array of role
  // codes; any key absent from it just falls back to that permission's defaultRoles (see
  // PERMISSION_REGISTRY_, Permissions.gs), so an empty/missing row is a fully valid, zero-overrides
  // state and behavior is unchanged from the old hardcoded requireRole calls until a SystemAdmin
  // actually edits something in Settings > Permissions.
  Permissions:            ['id','overridesJson','updatedAt','updatedBy'],
  // REQ: "I need to have the functionality to create a new role." -- admin-defined roles alongside
  // the built-in ROLES enum (Utils.gs below). code is the value actually stored on Users.role and
  // compared everywhere (requireRole/requirePermission do plain string checks, so a custom code works
  // anywhere a built-in one does -- see canCreateRole/getCustomRoles_, Roles.gs). orgType mirrors
  // ROLE_ORG_TYPE (users.js): '' for a platform-level role (like SupportAgent), else 'GA'/'EMC'/
  // 'INSPECTION' so the account-creation Organization picker can filter correctly. creatableBy is a
  // JSON array of role codes (built-in or custom) allowed to create accounts under this role -- same
  // idea as ACCOUNT_CREATION_MATRIX (Auth.gs) but per-role and admin-editable instead of hardcoded.
  // basedOnRole records which role's permissions were cloned as a starting point at creation time
  // (display-only, "started from X"). status ('Active'/'Inactive', same convention as Users.status)
  // -- deleteRole soft-deletes rather than removing the row, so AuditLog/Permission-override history
  // referencing this code stays meaningful; getCustomRoles_ filters to Active only.
  // isParticipantType: REQ ("configurable Place/Participant types, allow adding others") -- marks a
  // custom role as usable in the Place/Participant "type" picker (Venues > Places, Event >
  // Participants) alongside the 3 built-in types (Vendor/Operator/Exhibitor). See
  // isParticipantRoleCode_/listParticipantTypes (Roles.gs).
  // isMandatoryOperator appended at the end -- REQ ("Opening checklists are done against the venue
  // not participants, but they can assign operational participants to resolve the raised log ... a
  // security operator must be available in every event, a H&S Operator must be available on every
  // event"): flags an isParticipantType role (a custom Operator sub-type, e.g. "Security Operator")
  // as one every event's venue is expected to have at least one Participant account for -- managed
  // from the new Settings > Mandatory Operators tab, checked by getMandatoryOperatorCompliance
  // (Events.gs). Meaningless on a role that isn't also isParticipantType.
  Roles:                  ['id','code','label','orgType','creatableBy','basedOnRole','status','createdBy','createdAt','isParticipantType','isMandatoryOperator'],
  // An Inspection Company's master readiness documents (ZSMP, ZERP, TTP, CSM, SEC, and any others
  // they add) -- uploaded once, with a newer version simply replacing the current file. Not
  // per-event; see Templates above for what gets sent to a specific event.
  // docType appended at the end -- REQ: "convert the templates to forms and include evaluation
  // process." Tags which structured scoring catalog (TemplateScoringItems below) applies to this
  // library document, e.g. 'ZSMP'/'ZERP' (v1 scope) or '' for a document with no scoring form yet
  // (Traffic & Transport, Crowd Management, Security Management, or any custom entry an org adds --
  // those keep working exactly as a plain upload+review document, same as before this feature).
  TemplateLibrary:        ['id','orgId','name','fileUrl','fileName','mimeType','uploadedBy','createdAt','updatedAt','docType'],
  // REQ follow-up: "Can I convert the templates to forms and include evaluation process as per
  // attached file?" -- a reusable, admin-seeded catalog of the scoring items an Inspection Analyst
  // reviews a submitted document against, one row per item (not per section -- section grouping is
  // denormalized onto every item row, sectionCode/sectionName, same flat convention ChecklistItems
  // already uses for category/phase rather than a separate lookup table). Sourced from the GA26/JDCB
  // "Document Review Tool" workbook's own ZSMP/ZERP sheets (seedTemplateScoringItems, Setup.gs) --
  // itemCode/sectionCode mirror that workbook's own numbering (e.g. '4.00' / '4.00.01') purely for
  // traceability back to the source tool, not because the app parses/relies on the numbering scheme
  // itself. multiplier is the item's scoring weight (workbook's own "Multiplier" column) -- an
  // item's max possible contribution is always 4 * multiplier (Quality tops out at 4, see
  // TemplateScoringResults below), matching the workbook's own MaxScore column exactly. Global, not
  // per-org -- this is a fixed audit standard, not something each Inspection Company customizes
  // (same reasoning ChecklistItems' own catalog is global, not per-org). status: 'Active'/'Deleted'
  // (same soft-delete convention as ChecklistItems).
  TemplateScoringItems:   ['id','docType','sectionCode','sectionName','itemCode','description','multiplier','sortOrder','status'],
  // One row per (Templates row, TemplateScoringItems row) an Inspection Analyst has scored --
  // sparse: a row only exists once that specific item has actually been scored (same "nothing
  // written until acted on" convention as the Templates row itself only existing once sent).
  // completeness: 'Yes'/'No'/'N/A' (workbook's own "Completion" checklist axis). quality: 0-4
  // (workbook's own "Quality" review-score axis) -- this item's Score (workbook's own Score column)
  // is quality * the matching TemplateScoringItems.multiplier, computed on read rather than stored,
  // so it never drifts if the catalog's multiplier is ever corrected. remarks/detail mirror the
  // workbook's own "Free Text" and "Detail" columns -- remarks for the short review comment, detail
  // for a longer note or link to bespoke coaching material (see the workbook's own Guide sheet on
  // coaching cards).
  TemplateScoringResults: ['id','templateId','itemId','completeness','quality','remarks','detail','recordedBy','recordedAt'],
  // A reusable catalog of exact physical spots within a Venue (see Places.gs). accountIds appended
  // at the end -- comma-joined Users ids (same convention as InspectorAssignments.zoneIds) for the
  // login account(s) auto-created for this place; more than one supports e.g. separate morning/
  // afternoon shift staff who each need their own login to respond to risk logging. eventId
  // appended at the end -- blank means a permanent, venue-wide Place (original behavior, covers
  // every Event at the venue); set means this Place (and the Participant/login it provisions) only
  // exists for that one Event and gets deactivated once the Event ends -- see the Event Places page
  // (findings.js-style dedicated route) and deactivateEndedEventPlaceAccounts below.
  // nameAr -- REQ follow-up: "When turning platform to Arabic, some information is still in
  // English" (Participants follow-up). Optional, admin/creator-filled, blank on pre-existing rows.
  Places:                 ['id','venueId','zoneId','name','type','location','lat','lng','createdBy','createdAt','accountIds','eventId','nameAr'],
  // In-app technical support ticketing (see Support.gs) -- platform-level, not scoped to an Event or
  // Organization. screenshotUrl/voiceNoteUrl are the raiser's initial capture (see
  // frontend/js/views/support.js's raise-a-ticket flow); the back-and-forth after that lives in
  // SupportTicketComments below. reopenCount mirrors Findings.reopenCount's convention (see
  // Findings.gs) -- how many times the raiser has rejected a resolution, tracked for visibility only
  // (no hard cap, unlike Findings).
  SupportTickets:         ['id','createdBy','subject','remarks','pageContext','screenshotUrl','voiceNoteUrl','status','assignedTo','reopenCount','createdAt','updatedAt','resolvedAt','completedAt'],
  // One row per message in a ticket's thread -- from either the raiser or Support/SystemAdmin.
  // voiceNoteUrl: an optional recorded remark (either side can attach one). recordingUrl/
  // recordingMimeType: an optional screen+voice walkthrough recording -- Support/SystemAdmin only
  // (enforced in addTicketComment, Support.gs), a first for this app (see MediaRecorder/
  // getDisplayMedia usage in support.js), capped to a short duration client-side to fit the existing
  // base64-upload pipeline (see uploadTicketMedia).
  SupportTicketComments:  ['id','ticketId','authorId','message','voiceNoteUrl','recordingUrl','recordingMimeType','createdAt'],
  // Event Chat (see EventChat.gs) -- one row per posted message. mentionedUserIds/
  // mentionedParticipantIds/logRefIds are comma-joined id lists (same convention as
  // InspectorAssignments.zoneIds): who/what was tagged, and which AuditLog entries (Event Log tab)
  // were referenced inline. Participant-account roles (Vendor/Operator/Exhibitor) are blocked from
  // this whole feature server-side -- see assertChatAccess_ -- so mentioning a Participant is purely
  // informational, never a notification to someone who could actually read the thread.
  // screenshotUrls appended at the end -- REQ: "a screenshot will be captured and added as large
  // thumbnail image" (# tab/section picker, see EventChat.gs uploadChatScreenshot). Comma-joined
  // Drive thumbnail-endpoint URLs, same convention as every other id-list column on this row.
  EventChatMessages:      ['id','eventId','authorId','message','mentionedUserIds','mentionedParticipantIds','logRefIds','createdAt','screenshotUrls'],

  // Roadmap Plans (see RoadmapPlans.gs) -- REQ: "Add Roadmap sidebar where they will be able to add
  // types of plan. and configure how it will rollout." An admin-defined, reusable named template
  // (e.g. "Normal Plan", "Parachute Plan") -- RoadmapPlanItems below holds its ordered milestone
  // items. Soft-delete like Roles/TemplateLibrary (status -> 'Inactive'), never hard-removed, so a
  // plan an Event was already rolled out from stays meaningful in the audit trail even after retired.
  RoadmapPlans:           ['id','name','status','createdBy','createdAt'],
  // One ordered milestone within a RoadmapPlans template. sortOrder is assignment order (every new
  // item is appended at the end -- see addRoadmapPlanItem) and doubles as the ordering constraint
  // rollout relies on: anchorType 'item' may only point at another item already in the same plan,
  // which (since items are only ever appended) is guaranteed to have a smaller sortOrder already --
  // no separate cycle/forward-reference check needed. anchorType is 'eventStart' | 'eventEnd' |
  // 'item' (anchorItemId then names which sibling row). offsetSign is 'before' | 'after';
  // offsetWeeks/Days/Hours are non-negative integers combined at rollout time (resolveOffsetMs_) --
  // kept as three separate unit fields rather than one pre-multiplied total so "3 weeks 3 days
  // before" round-trips through the editor exactly as typed, instead of collapsing to "24 days" and
  // losing the PM's original phrasing.
  // requiresAttachment/icon appended at the end -- REQ: "allow to choose whether an attachment is
  // required, if attachment is requirement check will not accept unless attachment or link ... is
  // provided" and "Allow to change dot to icon per item only in Roadmap Plans." requiresAttachment is
  // a plain boolean, enforced when a PM tries to mark the rolled-out EventRoadmapItems copy Done (see
  // updateEventRoadmapItem, RoadmapPlans.gs) -- the plan item itself never carries an attachment, only
  // the per-Event instance does (Events don't share attachments). icon is raw SVG markup (or a typed
  // emoji/character) chosen via the same openIconPickerModal_ used by Settings > Icons, or blank to
  // keep the plain colored dot -- displayed on the Event Roadmap tab's timeline instead of a dot when
  // set (eventRoadmapHtml_, eventDetail.js).
  // actionType/actionConfig appended at the end -- REQ follow-up: "connect roadmap plans items to
  // actionable items... creates and connects to a meeting template... Automatically sends (Selected)
  // Readiness templates... Sends notification reminder to submit the document before deadline."
  // actionType is '' (no automation, the original behavior) | 'scheduleMeeting' | 'sendTemplates' |
  // 'reminder'. actionConfig is a JSON-stringified, type-specific object (see
  // validRoadmapActionInput_, RoadmapPlans.gs) -- kept as one opaque blob rather than one column per
  // possible field (same reasoning as Meetings.toJson/ccJson) since each action type needs a
  // different shape and nothing here is ever queried/filtered on, only read back and executed.
  // Because RoadmapPlans/RoadmapPlanItems are a single GA-wide catalog (no orgId -- see RoadmapPlans
  // schema comment above), an action can't reference a specific org's own data (a specific
  // TemplateLibrary row, a specific User) -- it references portable concepts instead: role CODES
  // (resolved against the rolled-out Event's own EMC/Inspection Company at fire time -- see
  // roleCodesToEventUserIds_) for who a meeting/reminder goes to, and docType CODES (resolved against
  // the Event's own Inspection Company library at fire time) for which Readiness templates to send.
  // anchorVersionNumber appended at the end -- REQ follow-up: "Doc. Sub. (Pre Opening Doors) is tied
  // to the closing of Readiness Templates Version 1. Doc. Rev. (Pre Opening Doors) is tied to the
  // initiation of ... Version 2." Only meaningful when anchorType is 'templateVersionClose' or
  // 'templateVersionOpen' (0 otherwise) -- which round of the Event's own TemplateDeadlineVersions
  // (Templates.gs) this item's due date tracks. Unlike eventStart/eventEnd/item, these two anchor
  // types can't be resolved once at rollout time -- Version 1's deadline is set later by a PM
  // (setTemplatesDeadline), and Version 2+ doesn't even exist until the previous round actually
  // lapses or a PM manually opens the next one (see the TemplateDeadlineVersions comment block,
  // Templates.gs) -- so resolveTemplateVersionAnchorMs_/resyncTemplateVersionAnchoredRoadmapItems_
  // (RoadmapPlans.gs) keep re-checking on the same periodic sweep as the escalation engine until real
  // data exists, same "self-heals on the next sweep" pattern runRoadmapItemActions_ already uses for
  // a blocked action.
  RoadmapPlanItems:       ['id','planId','name','sortOrder','anchorType','anchorItemId','offsetSign','offsetWeeks','offsetDays','offsetHours','status','requiresAttachment','icon','actionType','actionConfig','anchorVersionNumber'],
  // One rolled-out, per-Event instance of a plan item -- REQ: "configure how it will rollout." Created
  // in bulk by rolloutEventRoadmap_ the moment an Event is created with a planTypeId set (or later via
  // the Roadmap tab's manual "Regenerate" action). dueAt is the fully resolved absolute instant (same
  // "compute once, don't silently drift if the anchor changes later" convention as
  // Events.templatesDeadlineAt -- see that field's comment above). sourceItemId links back to the
  // RoadmapPlanItems row this came from, blank for an item the PM added ad hoc on this one Event
  // (regenerate never touches sourceItemId==='' rows). status is 'Pending' or 'Done'; "Overdue" is a
  // derived display state (Pending + dueAt in the past), not stored. sortOrder mirrors the source
  // item's sortOrder at generation time so the tab can list them in plan order even though dueAt
  // (used for the timeline dot placement) may not be perfectly monotonic once a PM manually overrides
  // one item's date. requiresAttachment/icon are copied down from the source RoadmapPlanItems row at
  // rollout (blank/false for an ad hoc item, since the icon feature is scoped to plan items only, but
  // requiresAttachment IS still settable ad hoc -- see addEventRoadmapItem). attachmentUrl/
  // attachmentName hold whatever the PM actually provided (an uploaded file's Drive URL, or a pasted
  // link to an external doc or another page inside HULUL itself) -- rolloutEventRoadmap_ never
  // touches these on an upsert, so re-generating the Roadmap can't silently wipe an attachment a PM
  // already attached.
  // actionType/actionConfig appended at the end -- copied down (re-synced, same convention as
  // requiresAttachment/icon) from the source RoadmapPlanItems row at rollout; blank for an ad hoc item
  // (the feature is scoped to plan-template items only, same reasoning as icon). actionExecutedAt is
  // blank until runRoadmapItemActions_ (RoadmapPlans.gs, run off the same periodic trigger as the
  // escalation engine -- see scheduledEscalationCheck, Setup.gs) actually fires the action once dueAt
  // has passed; it's deliberately a SEPARATE concept from status/completedAt (the PM's own Done
  // checkbox) -- an automated action firing doesn't itself mark the item Done, so a
  // requiresAttachment item with an action still needs a PM's attachment before it's considered
  // finished, and a PM can always tell "did the automation actually run" apart from "did I check this
  // off". actionResult is a short human-readable outcome ("Meeting scheduled: ...", "3 template(s)
  // sent", "Reminder sent to 2 recipient(s)") OR, while actionExecutedAt is still blank, the reason
  // it hasn't fired yet ("Waiting for a documents deadline to be set") -- surfaced on the Roadmap tab
  // so a PM isn't left guessing why nothing happened.
  // anchorType/anchorVersionNumber appended at the end -- re-synced from the source RoadmapPlanItems
  // row every rollout, same convention as requiresAttachment/icon/actionType/actionConfig (blank/0 for
  // an ad hoc item, which never has this kind of anchor). Kept here (not just looked up back through
  // sourceItemId each time) specifically so resyncTemplateVersionAnchoredRoadmapItems_ (RoadmapPlans.gs)
  // can find every item that needs its dueAt re-checked on each periodic sweep with one plain query
  // over this sheet alone -- it never has to touch RoadmapPlanItems, which might have since had that
  // row edited or deleted from the template entirely. dueAt itself is blank ('', not a placeholder
  // date) for a 'templateVersionClose'/'templateVersionOpen' item until the targeted
  // TemplateDeadlineVersions round actually exists -- see resolveTemplateVersionAnchorMs_.
  EventRoadmapItems:      ['id','eventId','planId','name','sourceItemId','dueAt','status','completedBy','completedAt','sortOrder','createdBy','createdAt','requiresAttachment','attachmentUrl','attachmentName','icon','actionType','actionConfig','actionExecutedAt','actionResult','anchorType','anchorVersionNumber'],
  // REQ (Dashboard): "add another tab to show venue attendance -- first time inspector or user ...
  // attended venue must be inside boundary or no more than 5 meters outside venue boundaries. also
  // the same for last date time user left venue boundaries." One row per (userId, venueId) pair,
  // upserted by pingUserLocation (LiveLocation.gs) every time that user's ping lands inside-or-near
  // (see insideOrNearBoundary_ below) that venue's drawn boundary: firstAttendedAt is set once and
  // never touched again, lastSeenInsideAt is overwritten on every matching ping. There's no discrete
  // "exit" event to observe (pings are periodic, not continuous) -- lastSeenInsideAt IS the
  // "last time seen inside/near" timestamp, which doubles as the practical answer to "when did they
  // leave": some time after that moment, since no later ping ever matched this venue again.
  VenueAttendance:        ['id','userId','venueId','firstAttendedAt','lastSeenInsideAt','createdAt'],
  // REQ: "Under readiness add 'Annex' ... divided into three sections: Risk Assessments, Sign-Offs /
  // Approvals, Certifications / TUVs / Supporting Records." A global, admin-maintained reference
  // catalog (mirrors Disciplines/ChecklistItems -- seedAnnexCategories_, Setup.gs seeds the original
  // 28 rows one time; annexCategories.js, the "Inspection Setup" admin page, is how it's maintained
  // going forward -- add/edit/soft-delete a category, same pattern as Categories/Checklists/Log
  // Assistance Guide) of every named category across the 3 fixed sections -- NOT per-event; every
  // event sees the same catalog, same "shared reference list, per-event tracking lives in its own join
  // table" split Templates.gs already uses (TemplateLibrary vs Templates). section is one of
  // 'RiskAssessments'/'SignOffs'/'Certifications'. orderIndex preserves the exact numbered order given
  // in the REQ (existing rows) or "added at the end of its section" (new rows via the admin page).
  // defaultRequired (REQ follow-up: "mark default required uploads") is the catalog-level starting
  // point for a category's per-event 'required' flag -- listEventAnnex's virtual per-event default
  // (no AnnexEventCategories row touched yet) now reads this instead of always defaulting to false,
  // so an admin can pre-mark a category mandatory once instead of every PM re-checking it per event.
  // A PM/Analyst's own per-event override (setAnnexCategoryRequired) still always wins once it exists.
  AnnexCategories:        ['id','section','name','orderIndex','status','defaultRequired'],
  // Per-(event, category) override -- lazily created (see listEventAnnex, Annex.gs) so a brand new
  // event doesn't need 28 rows pre-inserted; a category with no row here yet is just "not required,
  // not provided" by default, same virtual-row convention getEventTemplates (Templates.gs) uses for
  // TemplateLibrary entries with no Templates row yet. required: PM/Analyst-set flag ("mark document
  // as required" REQ) that drives the EMC-facing missing-mandatory count. status: 'Provided' once at
  // least one uploaded AnnexDocuments row under this (event, category) has been Accepted, else
  // 'NotProvided' -- recomputed by reviewAnnexDocument, never hand-set. infoRequestNote/By/At: REQ
  // "Allow PM or analyst to ask for more information per category" -- the latest such request, shown
  // to the EMC as a banner on that category until a new document is uploaded or reviewed.
  AnnexEventCategories:   ['id','eventId','categoryId','required','status','infoRequestNote','infoRequestedBy','infoRequestedAt'],
  // REQ: "Allows EMC Event manager to upload documents under each category. So an EMC manager can
  // upload 10 documents under 'Event General Risk Assessment'." Many-per-category, unlike Templates'
  // one-current-file-per-entry model -- every upload is its own row, kept even after review (so the
  // full history stays visible), status: 'Pending' (just uploaded) / 'Accepted' / 'Rejected' -- REQ
  // "accept uploaded documents, then mark as provided" -- Accepted is what flips the parent
  // AnnexEventCategories row to 'Provided' (reviewAnnexDocument, Annex.gs).
  AnnexDocuments:         ['id','eventId','categoryId','fileUrl','fileName','mimeType','uploadedBy','uploadedAt','status','reviewedBy','reviewedAt','reviewComments'],
  // REQ: "In Logs allow inspectors to delete log photos. Deleted log photos go to Log Photos Trash."
  // A server-side counterpart to the client-only "Log Photos Trash" the Log Photos tab already has
  // (EvidenceCapture's IndexedDB-backed trashLogPhoto/restoreLogPhoto/emptyLogPhotoTrash, evidence.js
  // -- for photos captured but not yet turned into a Log) -- this one instead covers a photo already
  // attached to an existing Finding row's evidenceUrls (deleteFindingEvidence, Findings.gs), which is
  // shared/uploaded data other people may already be viewing, so "detach, don't destroy" alone (the
  // pre-existing behavior) isn't enough on its own -- it needs to land somewhere recoverable, same
  // 30-day-then-gone / restore / empty-now UX as the client-side trash, not silently vanish. One row
  // per trashed photo; evidenceMetaJson preserves that photo's own evidenceMeta entry (outsideBoundary/
  // distanceMeters, see findingEvidenceMeta_) so restoring it doesn't lose that badge. status:
  // 'Trashed' (default) / 'Restored' -- a permanent purge (past LOG_PHOTO_TRASH_RETENTION_DAYS_) or an
  // explicit "empty now" just deleteRow()s it outright (no PurgedPermanently status kept around --
  // nothing left worth showing once it's gone).
  FindingEvidenceTrash:   ['id','findingId','eventId','url','evidenceMetaJson','deletedBy','deletedAt','status','restoredBy','restoredAt'],
  // REQ: "In Meetings sidebar allow creation of templates and create a template for each meeting
  // subject. Allow admins to modify these templates and create new ones." Org-scoped (per Inspection
  // Company, same convention as TemplateLibrary) reusable agenda/notes bodies, one per meeting
  // Subject -- listMeetingTemplates (Templates.gs) merges real rows here with a virtual placeholder
  // for every MEETING_TYPES subject that doesn't have one yet, same "nothing written until an admin
  // actually saves something" convention getEventTemplates uses for TemplateLibrary. subject isn't
  // constrained to the built-in MEETING_TYPES list -- an admin can also create a template for a
  // custom/"Other" subject their org uses often. body is rich-text HTML (same sanitize-on-read
  // convention as Meetings.notes -- see sanitizeRichText_, meetings.js). status: 'Active'/'Deleted'
  // (soft delete, same convention as ChecklistItems/Roles).
  // defaultToRoles/defaultCcRoles appended at the end -- REQ follow-up: "In Meeting Templates I would
  // like to assign default attendees roles in the To and Cc." JSON-stringified arrays of role CODES
  // (built-in or active custom, same convention as RoadmapPlanItems.actionConfig's toRoles/ccRoles --
  // see that schema comment, Utils.gs) rather than specific Users, since a template is shared across
  // every Event an org runs, each with its own actual EMC Manager/Event Manager/etc. Resolved against
  // whichever Event is picked at New Meeting time (see roleCodesToEventUserIds_-equivalent logic,
  // meetings.js) so the right real people get pre-filled regardless of which Event the meeting is for.
  MeetingTemplates:       ['id','orgId','subject','body','status','createdBy','createdAt','updatedBy','updatedAt','defaultToRoles','defaultCcRoles']
};

var ROLES = {
  SYSTEM_ADMIN: 'SystemAdmin',
  GA_ADMIN: 'GAAdmin', GA_USER: 'GAUser',
  EMC_ADMIN: 'EMCAdmin', EVENT_MANAGER: 'EventManager', EMC_MANAGER: 'EMCManager', EMC_ANALYST: 'EMCAnalyst',
  INSPECTION_ADMIN: 'InspectionAdmin', PROJECT_MANAGER: 'ProjectManager', INSPECTION_ANALYST: 'InspectionAnalyst', INSPECTOR: 'Inspector',
  VENDOR: 'Vendor', OPERATOR: 'Operator', EXHIBITOR: 'Exhibitor',
  // Platform-level, not tied to any GA/EMC/Inspection org -- works the shared Support ticket queue
  // (see Support.gs) alongside SystemAdmin. Created by SystemAdmin (ACCOUNT_CREATION_MATRIX, Auth.gs).
  SUPPORT_AGENT: 'SupportAgent'
};

// Human-readable labels for role codes, used to build "who can do this" permission messages.
var ROLE_LABELS = {
  SystemAdmin: 'System Admin', GAAdmin: 'GA Admin', GAUser: 'GA User', EMCAdmin: 'EMC Admin',
  EventManager: 'Event Manager', EMCManager: 'EMC Manager', EMCAnalyst: 'EMC Analyst',
  InspectionAdmin: 'Inspection Admin', ProjectManager: 'Project Manager', InspectionAnalyst: 'Inspection Analyst',
  Inspector: 'Inspector', Vendor: 'Vendor', Operator: 'Operator', Exhibitor: 'Exhibitor',
  SupportAgent: 'Support Agent'
};
// Falls back to a custom role's own label (Roles sheet, see Roles.gs) when `role` isn't one of the
// built-in codes above -- getCustomRoles_ isn't defined until Roles.gs loads (R comes after U
// alphabetically), but that's fine: this is a function body, only ever called at request time after
// every file has finished loading, not at top-level parse time (see the load-order note on
// PERMISSION_REGISTRY_ in Permissions.gs for the actual constraint this doesn't run into).
function roleLabel_(role) {
  if (ROLE_LABELS[role]) return ROLE_LABELS[role];
  var custom = findWhere('Roles', function (r) { return r.code === role && r.status === 'Active'; })[0];
  return custom ? custom.label : role;
}

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function sheet_(name) {
  var ss = ss_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(SCHEMA[name]);
    lockDateTextColumns_(sh, name);
  }
  return sh;
}

// ---- Read caching -----------------------------------------------------
// Every request (including the auth check on literally every single API call -- see
// getUserByToken in Auth.gs) used to re-read the full sheet via getAll(), which is the slowest
// thing Apps Script does. CacheService is shared across every concurrent execution of this script
// (i.e. across every user hitting the Web App), so a short TTL here turns "N users each re-reading
// Sessions/Users on every click" into one live read per TTL window. Invalidated eagerly by
// insertRow/updateRow/deleteRow/insertRows below, so writers never see stale data -- the TTL only
// matters for how long *other* concurrent requests can keep reading a just-now-stale cached copy,
// which is fine for this app (nothing here needs read-after-write consistency across users within
// a couple seconds).
var CACHE_TTL_SEC_ = 20;

function cache_() { return CacheService.getScriptCache(); }

function invalidateCache_(sheetName) {
  try { cache_().remove('sheet_' + sheetName); } catch (e) { /* cache unavailable -- not fatal */ }
}

// Every "schedule a date/time" field in the app (Events.startDateTime/endDateTime,
// SubEvents.startDateTime/endDateTime, Meetings.scheduledAt, Inspections.scheduledAt) is a plain
// literal wall-clock string straight from a <input type="datetime-local"> ("YYYY-MM-DDTHH:mm", no
// timezone attached on purpose -- the whole app treats it as "this exact clock time", not an
// absolute instant to be converted). Google Sheets, however, auto-recognizes text that looks like a
// date/time and silently converts it into a real Date value on write (exactly like typing it into
// the UI), UNLESS the column is explicitly formatted as Plain Text -- and it interprets that literal
// text using the *spreadsheet's own timezone*, not the browser's. When those two timezones don't
// match, the stored instant (and therefore everything read back and redisplayed) drifts by the
// difference -- this is the "the time saved is different from the one I picked" bug. The columns
// below must never be allowed to auto-convert.
var DATE_TEXT_COLUMNS_ = {
  Events: ['startDateTime', 'endDateTime'],
  SubEvents: ['startDateTime', 'endDateTime'],
  Meetings: ['scheduledAt'],
  Inspections: ['scheduledAt']
};

function lockDateTextColumns_(sh, sheetName) {
  var cols = DATE_TEXT_COLUMNS_[sheetName];
  if (!cols) return;
  var headers = SCHEMA[sheetName];
  cols.forEach(function (col) {
    var colIdx = headers.indexOf(col);
    if (colIdx === -1) return;
    sh.getRange(1, colIdx + 1, Math.max(sh.getMaxRows(), 2), 1).setNumberFormat('@');
  });
}

// Repairs rows that already drifted: any cell in a DATE_TEXT_COLUMNS_ column that Sheets already
// silently converted into a real Date value gets converted back into the literal wall-clock text it
// started as, by formatting that Date using the *same* spreadsheet timezone Sheets used to interpret
// it in the first place -- which recovers the exact original text losslessly. Also (re)locks every
// such column to Plain Text so it can't happen again. Idempotent -- safe to re-run; matches nothing
// once every column is already text. Called from ensureAllSheets(), and also runnable standalone
// (see fixScheduledDateTimeDrift in Setup.gs) so it can be applied immediately without re-seeding.
function ensureDateColumnsAreText_() {
  var ss = ss_();
  var tz = ss.getSpreadsheetTimeZone();
  var fixed = 0;
  Object.keys(DATE_TEXT_COLUMNS_).forEach(function (sheetName) {
    var sh = ss.getSheetByName(sheetName);
    if (!sh) return;
    var headers = SCHEMA[sheetName];
    var lastRow = sh.getLastRow();
    lockDateTextColumns_(sh, sheetName);
    if (lastRow < 2) return;
    DATE_TEXT_COLUMNS_[sheetName].forEach(function (col) {
      var colIdx = headers.indexOf(col);
      if (colIdx === -1) return;
      var dataRange = sh.getRange(2, colIdx + 1, lastRow - 1, 1);
      var values = dataRange.getValues();
      var changed = false;
      var repaired = values.map(function (row) {
        var v = row[0];
        if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) {
          changed = true;
          fixed++;
          return [Utilities.formatDate(v, tz, "yyyy-MM-dd'T'HH:mm")];
        }
        return [v];
      });
      if (changed) { dataRange.setValues(repaired); invalidateCache_(sheetName); }
    });
  });
  return fixed;
}

function ensureAllSheets() {
  var ss = ss_();
  Object.keys(SCHEMA).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.appendRow(SCHEMA[name]);
      lockDateTextColumns_(sh, name);
      return;
    }
    var headers = SCHEMA[name];
    var lastCol = Math.max(sh.getLastColumn(), 1);
    var existing = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    if (existing.join('|') !== headers.join('|')) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  });
  ensureDateColumnsAreText_();
  var defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1) {
    // leave Sheet1 alone; harmless placeholder
  }
}

function headerMap_(sheetName) {
  return SCHEMA[sheetName];
}

function rowToObj_(headers, row) {
  var o = {};
  headers.forEach(function (h, i) { o[h] = row[i] !== undefined ? row[i] : ''; });
  return o;
}

function objToRow_(headers, obj) {
  return headers.map(function (h) { return obj[h] !== undefined ? obj[h] : ''; });
}

// Generic reads
function getAll(sheetName) {
  var cacheKey = 'sheet_' + sheetName;
  try {
    var cached = cache_().get(cacheKey);
    if (cached != null) return JSON.parse(cached);
  } catch (e) { /* cache unavailable -- fall through to a live read */ }

  var sh = sheet_(sheetName);
  var headers = headerMap_(sheetName);
  var lastRow = sh.getLastRow();
  var rows = lastRow < 2 ? [] :
    sh.getRange(2, 1, lastRow - 1, headers.length).getValues()
      .filter(function (r) { return r.join('') !== ''; })
      .map(function (r) { return rowToObj_(headers, r); });

  try {
    var json = JSON.stringify(rows);
    // CacheService rejects values over 100KB -- large/growing sheets (AuditLog, Findings, ...)
    // just skip caching past that point and fall back to a live read every time, same behavior
    // as before this change. Everything smaller (which is most sheets, most of the time) is fast.
    if (json.length < 100000) cache_().put(cacheKey, json, CACHE_TTL_SEC_);
  } catch (e) { /* not fatal -- caching is a pure speed optimization */ }

  return rows;
}

function getById(sheetName, id, idField) {
  idField = idField || 'id';
  var all = getAll(sheetName);
  for (var i = 0; i < all.length; i++) {
    if (String(all[i][idField]) === String(id)) return all[i];
  }
  return null;
}

function findWhere(sheetName, predicate) {
  return getAll(sheetName).filter(predicate);
}

function findRowIndexById_(sheetName, id, idField) {
  idField = idField || 'id';
  var sh = sheet_(sheetName);
  var headers = headerMap_(sheetName);
  var idCol = headers.indexOf(idField);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return -1;
  var values = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][idCol]) === String(id)) return i + 2; // 1-based sheet row
  }
  return -1;
}

function insertRow(sheetName, obj) {
  var sh = sheet_(sheetName);
  var headers = headerMap_(sheetName);
  sh.appendRow(objToRow_(headers, obj));
  invalidateCache_(sheetName);
  return obj;
}

// Batch version of insertRow -- writes every row in a single setValues() call instead of one
// appendRow() per row. This (plus newIds() below) is what makes bulk imports fast: O(1) Sheets
// API calls instead of O(n) -- see bulkCreateChecklistItems in Inspections.gs, which is what a
// 300-row CSV import now goes through instead of looping createChecklistItem() once per row.
function insertRows(sheetName, objs) {
  if (!objs || !objs.length) return objs || [];
  var sh = sheet_(sheetName);
  var headers = headerMap_(sheetName);
  var startRow = sh.getLastRow() + 1;
  var values = objs.map(function (obj) { return objToRow_(headers, obj); });
  sh.getRange(startRow, 1, values.length, headers.length).setValues(values);
  invalidateCache_(sheetName);
  return objs;
}

function updateRow(sheetName, id, patch, idField) {
  idField = idField || 'id';
  var rowIdx = findRowIndexById_(sheetName, id, idField);
  if (rowIdx === -1) throw new HululError('NOT_FOUND', sheetName + ' ' + id + ' not found');
  var sh = sheet_(sheetName);
  var headers = headerMap_(sheetName);
  var current = rowToObj_(headers, sh.getRange(rowIdx, 1, 1, headers.length).getValues()[0]);
  var updated = Object.assign({}, current, patch);
  sh.getRange(rowIdx, 1, 1, headers.length).setValues([objToRow_(headers, updated)]);
  invalidateCache_(sheetName);
  return updated;
}

function deleteRow(sheetName, id, idField) {
  idField = idField || 'id';
  var rowIdx = findRowIndexById_(sheetName, id, idField);
  if (rowIdx === -1) return false;
  sheet_(sheetName).deleteRow(rowIdx);
  invalidateCache_(sheetName);
  return true;
}

// ---- ID generation --------------------------------------------------------
var ID_PREFIX = {
  Organizations: 'ORG', Users: 'USR', Venues: 'VEN', Zones: 'ZON', Events: 'EVT', SubEvents: 'SEV',
  VenueEvaluations: 'VEV', Templates: 'TPL', Meetings: 'MTG', Disciplines: 'DIS', EventDisciplines: 'EDS',
  InspectorQualifications: 'IQ', InspectorAssignments: 'IA', ChecklistItems: 'CHK', Inspections: 'INS',
  InspectionResults: 'IR', Findings: 'FND', Escalations: 'ESC', Resolutions: 'RES', Participants: 'PAR',
  Reports: 'RPT', Notifications: 'NTF', AuditLog: 'AUD', OrgLabels: 'LBL', TemplateLibrary: 'TLB', Places: 'PLC',
  Projects: 'PRJ', SupportTickets: 'TKT', SupportTicketComments: 'TKC', EventChatMessages: 'ECM', Roles: 'ROL',
  TemplateScoringItems: 'TSI', TemplateScoringResults: 'TSR',
  RoadmapPlans: 'RMP', RoadmapPlanItems: 'RMI', EventRoadmapItems: 'ERI', VenueAttendance: 'VAT',
  FindingGuide: 'FGD', TemplateDeadlineVersions: 'TDV', TemplateVersionSnapshots: 'TVS',
  AnnexCategories: 'ANC', AnnexEventCategories: 'AEC', AnnexDocuments: 'AND',
  FindingEvidenceTrash: 'FET', MeetingTemplates: 'MTT', MeetingAttendance: 'MAT', UserCertificates: 'UCT'
};

// QuickLoginTokens' primary key is its own random token string (see mintQuickLoginToken_ in
// Places.gs), not a newId()-generated id -- no ID_PREFIX entry needed for it.

function newId(sheetName) {
  var prefix = ID_PREFIX[sheetName] || 'ID';
  var props = PropertiesService.getScriptProperties();
  var key = 'seq_' + sheetName;
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var next = Number(props.getProperty(key) || '0') + 1;
    props.setProperty(key, String(next));
  } finally {
    lock.releaseLock();
  }
  return prefix + '-' + Utilities.formatString('%04d', next);
}

// Batch version of newId() -- reserves `count` sequential ids under a single lock
// acquire/release instead of one lock cycle per id, which is what made looped single-row inserts
// (e.g. a checklist CSV import calling createChecklistItem in a per-row loop) slow under
// contention. See bulkCreateChecklistItems in Inspections.gs for the caller.
function newIds(sheetName, count) {
  if (!count) return [];
  var prefix = ID_PREFIX[sheetName] || 'ID';
  var props = PropertiesService.getScriptProperties();
  var key = 'seq_' + sheetName;
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  var start;
  try {
    start = Number(props.getProperty(key) || '0') + 1;
    props.setProperty(key, String(start + count - 1));
  } finally {
    lock.releaseLock();
  }
  var ids = [];
  for (var i = 0; i < count; i++) ids.push(prefix + '-' + Utilities.formatString('%04d', start + i));
  return ids;
}

// ---- Audit log --------------------------------------------------------
function audit(actorId, action, targetType, targetId, details) {
  insertRow('AuditLog', {
    id: newId('AuditLog'),
    actor: actorId || 'system',
    action: action,
    targetType: targetType || '',
    targetId: targetId || '',
    timestamp: nowIso_(),
    details: details ? JSON.stringify(details) : ''
  });
}

function nowIso_() { return new Date().toISOString(); }

// ---- Errors --------------------------------------------------------
function HululError(code, message) {
  this.code = code;
  this.message = message;
}
HululError.prototype = Object.create(Error.prototype);

// ---- Config --------------------------------------------------------
function getConfig(key, fallback) {
  var row = getById('Config', key, 'key');
  return row ? row.value : fallback;
}

function setConfig(key, value) {
  var existing = getById('Config', key, 'key');
  if (existing) updateRow('Config', key, { value: value }, 'key');
  else insertRow('Config', { key: key, value: value });
}

// getConfig/setConfig treat Config.value as an opaque scalar; these two add a JSON convention on
// top for structured settings (e.g. a list of role names) without changing the Config sheet's
// schema -- same "JSON blob in one cell" trick already used by OrgLabels.labelsJson.
function getConfigJson_(key, fallback) {
  var raw = getConfig(key, '');
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch (e) { return fallback; }
}
function setConfigJson_(key, value) {
  setConfig(key, JSON.stringify(value));
}

// ---- Config admin routes (SystemAdmin only) --------------------------------
function listConfig(user) {
  requireRole(user, [ROLES.SYSTEM_ADMIN]);
  return getAll('Config');
}

function setConfigEntry(user, p) {
  requireRole(user, [ROLES.SYSTEM_ADMIN]);
  if (!p.key) throw new HululError('BAD_REQUEST', 'key is required');
  setConfig(p.key, p.value);
  audit(user.id, 'SET_CONFIG', 'Config', p.key, { value: p.value });
  return { key: p.key, value: p.value };
}

// ---- Zone field helpers (Places.zoneId / Participants.zoneId) --------------------------------
// REQ: "add All Zones as an option, also allow to select more than one zone for operators only."
// The field stays a single text column (no schema change) but can now hold four shapes:
//   ''                      -- no zone set (existing meaning: "operates in every zone" for coverage)
//   'ALL'                   -- explicit "All Zones" pick, same coverage meaning as blank, just an
//                               intentional choice rather than an unset field -- shown as "All Zones"
//                               instead of "-" wherever it's displayed
//   'ZON-0001'               -- a single zone (existing meaning, unchanged)
//   'ZON-0001,ZON-0002'      -- Operators only (enforced in createPlace) -- operates in exactly these
//                               zones, same comma-joined convention as InspectorAssignments.zoneIds
// Every place that used to compare a zoneId field with === now goes through one of these two
// helpers instead, so all four shapes are handled consistently everywhere (coverage matching, zone
// delete impact/reassignment, listParticipants' zoneId filter).
function zoneFieldCoversZone_(zoneIdField, zoneId) {
  if (!zoneIdField || zoneIdField === 'ALL') return true;
  return String(zoneIdField).split(',').filter(Boolean).indexOf(zoneId) !== -1;
}
// The actual list of specific zone ids a field names -- [] for blank/'ALL' (nothing specific, it
// covers everything instead), otherwise every id in the comma-joined list (a single zone yields a
// one-element array).
function zoneFieldIds_(zoneIdField) {
  if (!zoneIdField || zoneIdField === 'ALL') return [];
  return String(zoneIdField).split(',').filter(Boolean);
}

// ---- Boundary helpers (Venues.boundary / Zones.boundary) -------------------------------------
// REQ: "remove the 1 km restriction, restriction now will be venue boundary." Boundary is stored as
// a JSON-stringified array of {lat,lng} points (a closed polygon, first point not repeated at the
// end) or '' when nothing's been drawn yet. parseBoundary_/stringifyBoundary_ centralize the
// JSON <-> array conversion (with graceful fallback to null on malformed/empty input) so callers
// never touch JSON.parse/stringify directly, and pointInPolygon_ is the actual containment test,
// shared by Places.gs's createPlace (venue boundary) and any future zone-boundary check.
function parseBoundary_(boundaryField) {
  if (!boundaryField) return null;
  try {
    var pts = JSON.parse(boundaryField);
    return (Array.isArray(pts) && pts.length >= 3) ? pts : null;
  } catch (e) { return null; }
}
function stringifyBoundary_(points) {
  if (!points || !Array.isArray(points) || points.length < 3) return '';
  return JSON.stringify(points.map(function (pt) { return { lat: Number(pt.lat), lng: Number(pt.lng) }; }));
}
// Standard ray-casting point-in-polygon test. points: array of {lat,lng} (>=3 points, not required
// to be closed -- the loop wraps from the last point back to the first). Works for simple (non-
// self-intersecting) polygons, which is all the Leaflet.draw UI ever produces.
function pointInPolygon_(lat, lng, points) {
  if (!points || points.length < 3) return false;
  var inside = false;
  for (var i = 0, j = points.length - 1; i < points.length; j = i++) {
    var yi = Number(points[i].lat), xi = Number(points[i].lng);
    var yj = Number(points[j].lat), xj = Number(points[j].lng);
    var intersect = ((yi > lat) !== (yj > lat)) &&
      (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// REQ (Dashboard > Venue Attendance): "must be inside boundary or no more than 5 meters outside
// venue boundaries." pointInPolygon_ alone only answers inside-or-not; this adds the "how far
// outside" half. Projects every point to local meters using a flat equirectangular approximation
// centered on (lat,lng) itself -- accurate to a few centimeters at the scale this ever gets used at
// (tens/hundreds of meters, one venue), so there's no need for full geodesic segment math. Returns
// the shortest distance in meters from (lat,lng) to any edge of the polygon.
function distanceToBoundaryMeters_(lat, lng, points) {
  if (!points || points.length < 3) return Infinity;
  var metersPerDegLat = 111320;
  var metersPerDegLng = 111320 * Math.cos(lat * Math.PI / 180);
  function toXY_(pt) { return { x: (Number(pt.lng) - lng) * metersPerDegLng, y: (Number(pt.lat) - lat) * metersPerDegLat }; }
  var minDist = Infinity;
  for (var i = 0, j = points.length - 1; i < points.length; j = i++) {
    var a = toXY_(points[j]), b = toXY_(points[i]);
    minDist = Math.min(minDist, distanceToSegmentMeters_(0, 0, a.x, a.y, b.x, b.y));
  }
  return minDist;
}
// Shortest distance from point (px,py) to segment (ax,ay)-(bx,by), all already in the same flat
// meters-based coordinate space -- standard "project onto segment, clamp to its ends" formula.
function distanceToSegmentMeters_(px, py, ax, ay, bx, by) {
  var dx = bx - ax, dy = by - ay;
  var lenSq = dx * dx + dy * dy;
  var t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  var cx = ax + t * dx, cy = ay + t * dy;
  return Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
}
// The actual "attended this venue" test: inside the drawn boundary, or within toleranceM of it.
// No boundary drawn yet -> can't determine attendance at all (false), same "feature simply doesn't
// apply without a boundary" fallback every other boundary check in this app already uses.
function insideOrNearBoundary_(lat, lng, points, toleranceM) {
  if (!points || points.length < 3) return false;
  if (pointInPolygon_(lat, lng, points)) return true;
  return distanceToBoundaryMeters_(lat, lng, points) <= toleranceM;
}
