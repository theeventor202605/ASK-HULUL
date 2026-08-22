/**
 * HULUL - Permissions.gs (RBAC foundation, "admin-configurable permissions")
 *
 * REQ: "It is time we build Role-Based Access Control" -> clarified as: a SystemAdmin should be able
 * to change WHICH ROLES can do WHAT, from a Settings screen, without a code deploy. The app already
 * had role-based access control (every backend action gates on requireRole(user, [ROLES...])) -- what
 * it lacked was a way to change those role lists without editing code. This file adds that layer on
 * top of requireRole rather than replacing it:
 *
 *   requirePermission(user, key, contextOrgId)
 *     -> look up the effective allowed-roles list for `key` (an admin override if one has been saved,
 *        else PERMISSION_REGISTRY_[key].defaultRoles -- i.e. exactly what used to be hardcoded inline)
 *     -> requireRole(user, effectiveRoles, contextOrgId)
 *
 * Rollout status: started as foundation + ONE pilot module (Findings/Risk Logging) as a working
 * end-to-end proof, then grown module-by-module across most of the app (Events/Venues/Zones,
 * Participants/Places, Categories, Inspections, Accounts/Organizations, Notifications, Escalations,
 * Projects, Venue Approval, Reassignment, Support, Reports, Templates/Meetings -- see the `requirePermission(user, '...')`
 * call sites throughout backend/*.gs for the current, authoritative list; PERMISSION_REGISTRY_ below
 * is kept in sync with exactly those). A small number of requireRole call sites are DELIBERATELY left
 * untouched -- mostly SystemAdmin-only bootstrapping (account/org creation, escalation/template
 * config) that intentionally isn't meant to become admin-configurable.
 *
 * Storage: a single global row (id 'GLOBAL') in the Permissions sheet holding a JSON blob -- same
 * one-row-JSON-blob convention as AppIcons (getAppIcons/setAppIcons, Accounts.gs). A key absent from
 * the blob simply means "no override yet, use the default" -- so a brand new install (empty
 * Permissions sheet) behaves byte-for-byte like the old hardcoded requireRole calls.
 *
 * REQ follow-up: "set for an Organisation the permissions they can set ... when an organization's
 * admin wants to reconfigure permissions they can but are limited according to system admin
 * Organization [Type] set permissions." (clarified: the SystemAdmin's ceiling is set per Organization
 * TYPE -- GA/EMC/INSPECTION -- not per individual organization; see ORG_TYPE_CEILING_CONFIG_KEY_/
 * getOrgTypeCeiling_ below.) The blob now has two layers -- overrides.global (what used to be the WHOLE
 * blob: a SystemAdmin's platform-wide default) and overrides.orgs[orgId] (one Organization's OWN
 * override, settable only by that org's own GAAdmin/EMCAdmin/InspectionAdmin, only for a key their
 * organization's TYPE has been unlocked for via getOrgTypeCeiling_/setOrgTypePermissionCeiling). So the
 * ceiling (which keys are unlockable at all) is per-type, shared by every org of that type, while each
 * org's actual override (which roles it's chosen within that ceiling) stays independently scoped to
 * `orgId`, same as before. See effectivePermissionRoles_'s own comment for exactly how the two override
 * layers + the built-in default resolve, and requirePermission's for why this needed no changes at any
 * of its ~90 existing call sites.
 */

// The permission catalog. Each entry's defaultRoles is exactly the allowedRoles array that used to be
// hardcoded inline at that requireRole call site -- migrating a call site to requirePermission is a
// no-op for behavior until a SystemAdmin actually changes it in Settings > Permissions. module/label
// are display-only, for grouping/rendering the admin UI.
//
// NOTE: defaultRoles use plain role-code strings, not ROLES.X -- Apps Script concatenates every
// backend/*.gs file in alphabetical order into one script, and Permissions.gs (P) loads before
// Utils.gs (U), which is where `var ROLES = {...}` is actually defined. A top-level ROLES.X reference
// here would throw at load time before ROLES exists (same bug class fixed earlier for a top-level
// ROLES reference elsewhere). Auth.gs's ACCOUNT_CREATION_MATRIX has the same load-order constraint
// (A also loads before U) and uses the same plain-string convention for the same reason.
// REQ: "control who has Create, Read, Update and Delete for sections or Pages or tabs" -- each entry
// now also carries `page` (a stable id -- see PERMISSION_PAGES_ in settings.js for the real
// translated nav/tab label + "go to page" link each one maps to) and `crud` (one or more of
// create/read/update/delete). Most backend actions were never split into 3 separate create/update/
// delete role-checks in the first place -- a single function/role-check often already covers all
// three (e.g. manageVenue's create-or-edit-or-delete) -- so `crud` legitimately lists more than one
// letter for those; the Settings > Permissions matrix (settings.js) shows the SAME key/role-editor
// under every column it's tagged with and says so, rather than pretending independent control exists
// where the backend doesn't actually have it. `read` is sparse on purpose: most page/tab VISIBILITY
// (who even sees a nav item or Event-workspace tab) is still hardcoded role arrays in app.js
// (NAV_ITEMS) / eventDetail.js (EVENT_TABS), not wired into this registry -- a separate, larger
// follow-up (turning those into their own admin-configurable 'X.view' keys) if ever needed.
var PERMISSION_REGISTRY_ = {
  'finding.create': {
    module: 'Risk Logging', label: 'Log a new finding', page: 'findings', crud: ['create'],
    defaultRoles: ['Inspector', 'ProjectManager', 'SystemAdmin']
  },
  // REQ: "For Inspection company Analysts, they need to be able to view all logs regardless of which
  // event they are in ... The same should be available for all organization types." Backs the new
  // "All Logs" tab on the standalone Logs page (logs.js, route #/logs) -- listAllFindings (Findings.gs)
  // rolls up every Finding across every event the caller can already reach via listEvents' own
  // role/org scoping (EMC -> its own emcId events, INSPECTION -> its own inspectionCoId events, GA/
  // SystemAdmin -> everything), so "all logs" always means "all logs my organization can see," never
  // literally every org's logs. defaultRoles deliberately spans every non-participant role across all
  // three org types (not just Inspection) per the REQ's own "for all organization types" follow-up --
  // an admin can still narrow or widen this per role from the Permissions matrix like any other key.
  'finding.viewAll': {
    module: 'Risk Logging', label: 'View all logs across every event (not just one at a time)', page: 'findings', crud: ['read'],
    defaultRoles: ['SystemAdmin', 'GAAdmin', 'GAUser', 'EMCAdmin', 'EventManager', 'EMCManager', 'EMCAnalyst',
      'InspectionAdmin', 'ProjectManager', 'InspectionAnalyst', 'Inspector']
  },
  'finding.edit': {
    module: 'Risk Logging', label: 'Edit a finding (before it\'s submitted)', page: 'findings', crud: ['update'],
    defaultRoles: ['Inspector', 'ProjectManager', 'SystemAdmin']
  },
  'finding.delete': {
    module: 'Risk Logging', label: 'Delete a finding (before it\'s submitted)', page: 'findings', crud: ['delete'],
    defaultRoles: ['Inspector', 'ProjectManager', 'SystemAdmin']
  },
  'finding.addEvidence': {
    module: 'Risk Logging', label: 'Attach evidence photos to a finding', page: 'findings', crud: ['update'],
    defaultRoles: ['Inspector', 'ProjectManager', 'SystemAdmin']
  },
  // REQ: "In Logs allow inspectors to delete log photos." Also gates viewing/restoring/emptying the
  // resulting Log Photos Trash (listFindingEvidenceTrash/restoreFindingEvidence/
  // emptyFindingEvidenceTrash, Findings.gs) -- same "one action, one permission" pattern, but whoever
  // can delete a log photo is also who should be able to see and undo that deletion.
  'finding.deleteEvidence': {
    module: 'Risk Logging', label: 'Delete a log photo (moves it to Log Photos Trash)', page: 'findings', crud: ['delete'],
    defaultRoles: ['Inspector', 'ProjectManager', 'SystemAdmin']
  },
  // REQ: "Throughout the platform Do not allow Log Photos in any section to upload from device,
  // unless permission is set for that specific role." Every camera-icon capture flow in the app
  // (Record Results, Log Photos tab, New Log, Resolve Log -- see EVIDENCE.md-style header comment on
  // evidence.js) is already camera-only by default (capture="environment", no plain file picker --
  // that's the existing, unconditional behavior, not something this permission turns on). This
  // permission instead reveals a SECOND, explicit "upload from device" button next to the camera
  // button, only for whichever role(s) an admin grants it to -- defaultRoles deliberately starts
  // empty so no one gets the bypass until an admin opts a role in via the Permissions matrix (same
  // admin-override mechanism every other permission here already uses).
  'evidence.uploadFromDevice': {
    module: 'Risk Logging', label: 'Upload an evidence/log photo from device storage (bypasses camera-only capture)', page: 'findings', crud: ['create'],
    defaultRoles: []
  },
  'finding.resolve': {
    module: 'Risk Logging', label: 'Submit a resolution to a finding', page: 'findings', crud: ['update'],
    defaultRoles: ['Vendor', 'Operator', 'Exhibitor']
  },
  'finding.review': {
    module: 'Risk Logging', label: 'Accept/reject a submitted resolution', page: 'findings', crud: ['update'],
    defaultRoles: ['Inspector', 'ProjectManager', 'SystemAdmin']
  },
  // REQ ("Opening checklists are done against the venue not participants, but they can assign
  // operational participants to resolve the raised log"): a checklist-raised log from an Opening-
  // phase inspection starts with no participant at all (see recordInspectionResults, Inspections.gs)
  // -- this is the separate, later step that picks who's actually responsible for fixing it.
  // Deliberately its own permission key rather than reusing finding.resolve/finding.review -- an
  // Inspector or PM assigning responsibility isn't the same action as the Operator submitting the
  // fix, or a reviewer accepting/rejecting it.
  'finding.assignParticipant': {
    module: 'Risk Logging', label: 'Assign an operational participant to resolve a finding', page: 'findings', crud: ['update'],
    defaultRoles: ['Inspector', 'ProjectManager', 'SystemAdmin']
  },
  // participant.create/participant.edit (the old venue-wide Participants.gs create/update API) were
  // removed from here -- Places.gs's createPlace/updatePlace (place.create/place.manage below) fully
  // superseded them and these two keys had no requirePermission() call site left anywhere (confirmed
  // by grep), same dead-code cleanup as the functions themselves.
  'place.create': {
    module: 'Participants', label: 'Add a temporary participant to an event (Participants tab map + form)',
    page: 'participants', crud: ['create'],
    // Same five roles Places.gs's EVENT_PLACE_MANAGE_ROLES already allowed (SystemAdmin/EMCAdmin/
    // EMCManager/EventManager), plus Inspector -- REQ: "Inspector ... ability to add a temporary
    // participant."
    defaultRoles: ['SystemAdmin', 'EMCAdmin', 'EMCManager', 'EventManager', 'Inspector']
  },
  'participant.assignDisciplines': {
    module: 'Participants', label: 'Assign categories to participants (bulk)', page: 'participantDisciplines', crud: ['update'],
    defaultRoles: ['ProjectManager', 'SystemAdmin']
  },
  'participant.dedupe': {
    module: 'Participants', label: 'Remove duplicate participants', page: 'participants', crud: ['delete'],
    defaultRoles: ['SystemAdmin', 'EventManager']
  },
  'place.manage': {
    module: 'Participants', label: 'Manage an event\'s participants (add account/edit/delete/view credentials)',
    page: 'participants', crud: ['create', 'update', 'delete'],
    // Exactly Places.gs's old hardcoded EVENT_PLACE_MANAGE_ROLES -- migrating this call site is a
    // no-op for behavior until a SystemAdmin actually changes it in Settings > Permissions, same as
    // every other pilot migration.
    defaultRoles: ['SystemAdmin', 'EMCAdmin', 'EMCManager', 'EventManager']
  },
  'venuePlace.manage': {
    module: 'Venues', label: 'Manage places within a venue\'s permanent catalog (add/edit/delete/view credentials)',
    page: 'venues', crud: ['create', 'update', 'delete'],
    defaultRoles: ['SystemAdmin', 'EMCAdmin', 'EMCManager']
  },
  'venue.manage': {
    module: 'Venues', label: 'Create, edit, or delete a venue', page: 'venues', crud: ['create', 'update', 'delete'],
    defaultRoles: ['SystemAdmin', 'EMCAdmin', 'EMCManager']
  },
  'zone.manage': {
    module: 'Venues', label: 'Create, edit, or delete a zone', page: 'venues', crud: ['create', 'update', 'delete'],
    defaultRoles: ['SystemAdmin', 'EMCAdmin', 'EMCManager', 'EventManager']
  },
  'event.manage': {
    module: 'Events', label: 'Create or edit an event', page: 'events', crud: ['create', 'update'],
    defaultRoles: ['SystemAdmin', 'GAAdmin', 'GAUser']
  },
  'event.delete': {
    module: 'Events', label: 'Delete an event (Planning status only)', page: 'events', crud: ['delete'],
    defaultRoles: ['SystemAdmin', 'GAAdmin']
  },
  'subEvent.create': {
    module: 'Events', label: 'Create a sub-event', page: 'subEvents', crud: ['create'],
    defaultRoles: ['SystemAdmin', 'GAAdmin', 'GAUser', 'EventManager']
  },
  'event.assignManager': {
    // REQ follow-up: "Move Venue & Zones to venue sidebar page" removed the Event workspace's own
    // 'venue' tab (and settings.js's now-orphaned 'venueTab' permissionPages_ entry) -- this
    // permission's actual UI home was always the standalone Reassign Venue page (reassignment.js),
    // not that tab, so it repoints there instead.
    module: 'Events', label: 'Assign an Event Manager to an event', page: 'reassignment', crud: ['update'],
    defaultRoles: ['SystemAdmin', 'EMCManager', 'EMCAdmin']
  },
  'templateLibrary.manage': {
    module: 'Templates', label: 'Add or replace a library template (Inspection Company master documents)',
    page: 'templateLibrary', crud: ['create', 'update'],
    defaultRoles: ['InspectionAdmin', 'SystemAdmin']
  },
  'template.send': {
    module: 'Templates', label: 'Send readiness templates to an event', page: 'templates', crud: ['update'],
    defaultRoles: ['ProjectManager', 'SystemAdmin']
  },
  'template.setDeadline': {
    module: 'Templates', label: 'Set an event\'s documents deadline', page: 'templates', crud: ['update'],
    defaultRoles: ['ProjectManager', 'SystemAdmin']
  },
  // REQ follow-up: "move items in the Process tab to Permissions tab." These two used to live behind
  // their own dedicated Settings > Process editor (templateUploaderRoles_/templateReviewerRoles_,
  // backed by their own Config-sheet keys) instead of this registry -- that was a deliberate call at
  // the time, to avoid a second parallel "who can do this" control for the same actions. Since then
  // the Process tab has been retired and these are now ordinary registry entries like everything else
  // -- templateUploaderRoles_/templateReviewerRoles_ (Templates.gs) now just read effectivePermissionRoles_
  // for these two keys instead of a separate Config-JSON value.
  'template.upload': {
    module: 'Templates', label: 'Upload/replace and submit an event\'s document (the "Event Manager" step)',
    page: 'templates', crud: ['update'],
    defaultRoles: ['EventManager', 'SystemAdmin']
  },
  'template.review': {
    module: 'Templates', label: 'Review and evaluate a submitted document (the "Inspection Analyst" step)',
    page: 'templates', crud: ['update'],
    defaultRoles: ['InspectionAnalyst', 'SystemAdmin']
  },
  // REQ follow-up: "Finalize closes score editing" -- once a Document Review scoring form is
  // finalized (finalizeTemplateScoring, Templates.gs -- reuses 'template.review' above, same role
  // that can score it can finalize it) it becomes read-only for everyone. Reopening it is
  // deliberately its own, separately-configurable permission (default SystemAdmin only) rather than
  // reusing 'template.review' again, so an org can let its Inspection Analysts finalize freely while
  // still requiring a manager/admin sign-off to undo one.
  'template.reopenScoring': {
    module: 'Templates', label: 'Reopen a finalized Document Review scoring form for editing again',
    page: 'templates', crud: ['update'],
    defaultRoles: ['SystemAdmin']
  },
  'meeting.manage': {
    module: 'Meetings', label: 'Schedule, edit, or delete a meeting', page: 'meetings', crud: ['create', 'update', 'delete'],
    defaultRoles: ['SystemAdmin', 'InspectionAdmin', 'ProjectManager', 'EMCManager']
  },
  // REQ: "In Meetings sidebar allow creation of templates ... Allow admins to modify these templates
  // and create new ones." Separate from meeting.manage (scheduling an actual meeting) the same way
  // templateLibrary.manage is separate from template.send -- curating the org's reusable agenda
  // catalog is a lower-frequency, more "define the standard" action than day-to-day scheduling, so it
  // gets its own key even though today's default roles happen to overlap. EMCManager deliberately
  // excluded (templates are an Inspection Company's own agenda catalog, same org-ownership scoping as
  // templateLibrary.manage, which is InspectionAdmin/SystemAdmin only).
  'meetingTemplate.manage': {
    module: 'Meetings', label: 'Create, edit, or delete meeting agenda templates', page: 'meetings', crud: ['create', 'update', 'delete'],
    defaultRoles: ['SystemAdmin', 'InspectionAdmin', 'ProjectManager']
  },
  'checklistItem.manage': {
    module: 'Inspections', label: 'Create, edit, or delete a checklist catalogue item', page: 'checklistItems', crud: ['create', 'update', 'delete'],
    defaultRoles: ['SystemAdmin', 'InspectionAdmin', 'ProjectManager']
  },
  'checklistItem.dedupe': {
    module: 'Inspections', label: 'Remove duplicate checklist catalogue items', page: 'checklistItems', crud: ['delete'],
    defaultRoles: ['SystemAdmin', 'InspectionAdmin']
  },
  // REQ: "Some inspectors are junior level and could use help. We have created a guide which should
  // give them a list of descriptions once they select the category and sub-category." Same admin
  // audience as checklistItem.manage/discipline.manage -- whoever maintains the Categories/Checklists
  // catalogues also maintains this one. Reading the guide (listFindingGuide, used by every Inspector
  // logging a finding) has no permission gate of its own, same as listChecklistItems/listDisciplines.
  'findingGuide.manage': {
    module: 'Inspections', label: 'Create, edit, or delete a Log Assistance Guide entry', page: 'findingGuide', crud: ['create', 'update', 'delete'],
    defaultRoles: ['SystemAdmin', 'InspectionAdmin', 'ProjectManager']
  },
  'inspection.manage': {
    module: 'Inspections', label: 'Schedule, edit, or delete an inspection visit', page: 'inspectionsTab', crud: ['create', 'update', 'delete'],
    defaultRoles: ['ProjectManager', 'SystemAdmin']
  },
  'inspection.recordResults': {
    module: 'Inspections', label: 'Record checklist results for an inspection', page: 'inspectionsTab', crud: ['update'],
    defaultRoles: ['Inspector', 'SystemAdmin']
  },
  // REQ follow-up: "Completed Checklists can be viewed as a full page filterable list" -- a
  // standalone, cross-event page (listAllCompletedChecklists, Inspections.gs), distinct from the
  // per-event Completed Checklists tab (that one has no permission gate of its own -- it's already
  // implicitly behind having opened an Event you can see). This one needs its own gate since it's a
  // top-level nav destination that spans every event at once. Same-ish audience as the two
  // inspection.* permissions above (whoever schedules or records inspections) plus InspectionAdmin,
  // who oversees the whole discipline/inspection setup but isn't on either of those by default.
  'completedChecklist.view': {
    module: 'Inspections', label: 'View completed checklists across every event', page: 'completedChecklists', crud: ['read'],
    defaultRoles: ['SystemAdmin', 'InspectionAdmin', 'ProjectManager', 'Inspector']
  },
  // REQ: "Throughout the platform change: Discipline to Category." This Settings > Permissions
  // matrix is plain static English metadata (unlike the frontend's Term() system, it isn't org-
  // configurable/localized), so it's updated by hand here to stay consistent with the new default
  // label -- the permission KEYS themselves ('discipline.manage', etc.) are untouched.
  'discipline.manage': {
    module: 'Categories', label: 'Add a category to the catalogue', page: 'disciplinesCatalog', crud: ['create'],
    defaultRoles: ['SystemAdmin', 'InspectionAdmin']
  },
  'discipline.identify': {
    module: 'Categories', label: 'Identify which categories apply to an event', page: 'disciplinesTab', crud: ['update'],
    defaultRoles: ['ProjectManager', 'SystemAdmin']
  },
  'inspectorQualification.manage': {
    module: 'Categories', label: 'Set an inspector\'s qualification profile', page: 'inspectorQualifications', crud: ['create', 'update'],
    defaultRoles: ['InspectionAdmin', 'SystemAdmin', 'ProjectManager']
  },
  'inspectorAssignment.manage': {
    module: 'Categories', label: 'Assign or remove an inspector on a category', page: 'disciplinesTab', crud: ['create', 'update', 'delete'],
    defaultRoles: ['ProjectManager', 'SystemAdmin']
  },
  'escalation.create': {
    module: 'Risk Logging', label: 'Manually trigger an escalation for a finding', page: 'escalations', crud: ['create'],
    defaultRoles: ['SystemAdmin', 'InspectionAdmin', 'ProjectManager']
  },
  'escalation.runCheck': {
    module: 'Risk Logging', label: 'Manually run the escalation sweep', page: 'escalations', crud: ['update'],
    // Same default roles as escalation.create today (kept as a separate key since they're different
    // actions) -- the automated interval trigger (Setup.gs) calls runEscalationCheck with no user at
    // all and is unaffected by this; this key only gates a signed-in caller manually running it.
    defaultRoles: ['SystemAdmin', 'ProjectManager', 'InspectionAdmin']
  },
  'project.manage': {
    module: 'Projects', label: 'Create or edit a project', page: 'projects', crud: ['create', 'update'],
    defaultRoles: ['SystemAdmin', 'GAAdmin', 'GAUser']
  },
  'project.delete': {
    module: 'Projects', label: 'Delete a project', page: 'projects', crud: ['delete'],
    defaultRoles: ['SystemAdmin', 'GAAdmin']
  },
  'venueApproval.recommend': {
    module: 'Venue Approval', label: 'Record a venue evaluation recommendation', page: 'approval', crud: ['update'],
    defaultRoles: ['ProjectManager', 'SystemAdmin']
  },
  'venueApproval.decide': {
    module: 'Venue Approval', label: 'Record the GA venue decision or reassign the venue', page: 'approval', crud: ['update'],
    defaultRoles: ['GAAdmin', 'GAUser', 'SystemAdmin']
  },
  'reassignment.manage': {
    module: 'Reassignment', label: 'Mark a user unavailable/available and reassign their work', page: 'reassignment', crud: ['update'],
    defaultRoles: ['SystemAdmin', 'GAAdmin', 'EMCAdmin', 'InspectionAdmin', 'EMCManager', 'ProjectManager']
  },
  'evidence.upload': {
    module: 'Risk Logging', label: 'Upload evidence (photo/video) for a finding or resolution', page: 'findings', crud: ['update'],
    // Shared by two different moments: an Inspector attaching evidence while logging a finding, and
    // a Vendor/Operator/Exhibitor attaching a required photo/video when submitting a resolution (see
    // resolveFinding, Findings.gs). Kept separate from finding.addEvidence (also Risk Logging) --
    // that key gates a narrower, Inspector/PM-only action elsewhere; this one is the shared
    // file-upload primitive both flows call, so its role set has to include the resolver roles too.
    defaultRoles: ['Inspector', 'SystemAdmin', 'Vendor', 'Operator', 'Exhibitor']
  },
  'user.list': {
    module: 'Accounts', label: 'View the user directory', page: 'accounts', crud: ['read'],
    defaultRoles: ['SystemAdmin', 'GAAdmin', 'EMCAdmin', 'InspectionAdmin', 'EMCManager', 'ProjectManager']
  },
  'organization.list': {
    module: 'Accounts', label: 'View the organization directory', page: 'organizations', crud: ['read'],
    defaultRoles: ['SystemAdmin', 'GAAdmin', 'GAUser', 'EMCAdmin', 'InspectionAdmin', 'ProjectManager', 'EventManager', 'EMCManager']
  },
  'orgLabels.manage': {
    module: 'Accounts', label: 'Change an organization\'s custom terminology labels', page: 'settings', crud: ['update'],
    defaultRoles: ['SystemAdmin', 'GAAdmin', 'EMCAdmin', 'InspectionAdmin']
  },
  'auditLog.view': {
    module: 'Accounts', label: 'View the audit log', page: 'auditLog', crud: ['read'],
    defaultRoles: ['SystemAdmin', 'GAAdmin', 'EMCAdmin', 'InspectionAdmin']
  },
  'user.resetPassword': {
    module: 'Accounts', label: 'Reset another user\'s password', page: 'accounts', crud: ['update'],
    defaultRoles: ['SystemAdmin', 'GAAdmin', 'EMCAdmin', 'InspectionAdmin']
  },
  'notification.send': {
    module: 'Notifications', label: 'Manually send a notification', page: 'notifications', crud: ['create'],
    defaultRoles: ['SystemAdmin', 'GAAdmin', 'EMCAdmin', 'InspectionAdmin', 'EMCManager', 'ProjectManager']
  },
  'report.generate': {
    module: 'Reports', label: 'Generate an opening/operational report', page: 'reports', crud: ['create'],
    defaultRoles: ['ProjectManager', 'SystemAdmin', 'InspectionAdmin']
  },
  'ticket.resolve': {
    module: 'Support', label: 'Mark a support ticket resolved', page: 'support', crud: ['update'],
    defaultRoles: ['SystemAdmin', 'SupportAgent']
  },
  // Roadmap Plans (RoadmapPlans.gs) -- REQ: "Add Roadmap sidebar where they will be able to add types
  // of plan. and configure how it will rollout." Two separate keys, same "admin catalog vs. per-event
  // use" split as templateLibrary.manage/template.send above: roadmapPlan.manage gates the shared
  // Settings-level template catalog (Normal Plan/Parachute Plan/etc, GA-wide), roadmapItem.manage
  // gates working an individual Event's already-rolled-out items (mark done, override a date, add an
  // ad hoc item, Regenerate) -- deliberately broader (includes ProjectManager/EventManager, the roles
  // that actually run an event day to day) since that's a much lower-stakes action than redefining the
  // shared template every future event will roll out from.
  'roadmapPlan.manage': {
    module: 'Roadmap', label: 'Create, edit, or delete a Roadmap plan template', page: 'roadmapPlans', crud: ['create', 'update', 'delete'],
    defaultRoles: ['SystemAdmin', 'GAAdmin']
  },
  'roadmapItem.manage': {
    module: 'Roadmap', label: 'Edit an event\'s rolled-out Roadmap items (mark done, override a date, add/remove, regenerate)', page: 'roadmap', crud: ['create', 'update', 'delete'],
    defaultRoles: ['SystemAdmin', 'GAAdmin', 'GAUser', 'EventManager', 'ProjectManager']
  },
  // Annex (Annex.gs) -- REQ: "Under readiness add 'Annex': Allows EMC Event manager to upload
  // documents under each category ... Inspection Company PM or analyst can mark document as required
  // ... accept uploaded documents, then mark as provided ... ask for more information per category."
  // Same "who provides vs. who reviews" split as template.upload/template.review above: annex.upload
  // is the EMC's own upload action, annex.manage covers every PM/Analyst-side action (mark required,
  // accept/reject a document, mark a category Provided, request more info).
  'annex.upload': {
    module: 'Readiness', label: 'Upload an Annex document (the "EMC Event Manager" step)', page: 'annex', crud: ['create', 'delete'],
    defaultRoles: ['EventManager', 'SystemAdmin']
  },
  'annex.manage': {
    module: 'Readiness', label: 'Manage Annex categories (mark required, accept/reject documents, mark provided, request info)', page: 'annex', crud: ['update', 'delete'],
    defaultRoles: ['ProjectManager', 'InspectionAnalyst', 'InspectionAdmin', 'SystemAdmin']
  },
  // REQ follow-up: "I would rather have this part of the inspection setup so the responsible person
  // can make changes or add new categories and mark default required uploads." A distinct permission
  // from annex.manage above on purpose -- that one is the per-EVENT required/accept/provide workflow
  // (ProjectManager/InspectionAnalyst on every event), this one is maintaining the shared CATALOG
  // itself (add/edit/soft-delete a category, set its default-required starting point) -- same "setup
  // catalogue" audience as discipline.manage/checklistItem.manage/findingGuide.manage, not every PM.
  'annex.manageCatalog': {
    module: 'Readiness', label: 'Add, edit, or delete an Annex category in the catalogue (Inspection Setup)', page: 'annexCategories', crud: ['create', 'update', 'delete'],
    defaultRoles: ['SystemAdmin', 'InspectionAdmin', 'ProjectManager']
  },
  // REQ: "We have a team of translators ... having an interface for this specific task would be
  // helpful. We also need to know the percentage of translation, they also get to know what has not
  // been translated yet." Translations.gs's worklist covers every optional Arabic field in the app
  // (Categories/Checklist Types/Log Assistance Guide/Risk Logs/Places) -- crud is 'read'+'update' only
  // (no create/delete; a translator fills in the Arabic counterpart of an already-existing English
  // value, never originates a new catalogue row), so a SystemAdmin can create a 'Translator' custom
  // role (Settings > Roles) scoped to just this permission/page, without also granting
  // discipline.manage/finding.edit/place.manage/etc. that record-level editing would otherwise require.
  'translation.manage': {
    module: 'Translations', label: 'View and edit Arabic translations across the app', page: 'translations', crud: ['read', 'update'],
    defaultRoles: ['SystemAdmin', 'InspectionAdmin', 'ProjectManager']
  }
};

// REQ: "In Permissions I would like to set for an Organisation the permissions they can set. So when
// an organization's admin wants to reconfigure permissions they can but are limited according to
// system admin Organization set permissions." Two layers now live in this same JSON blob:
//   overrides.global  -- exactly what used to be the whole blob before this REQ: a SystemAdmin's
//                        platform-wide override, applies to every org that hasn't set its own.
//   overrides.orgs[orgId] -- one Organization's own override of a permission key, settable ONLY by
//                        that org's own GAAdmin/EMCAdmin/InspectionAdmin, and ONLY for a key their
//                        organization's TYPE has been unlocked for (getOrgTypeCeiling_, set by
//                        SystemAdmin via setOrgTypePermissionCeiling below).
// getPermissionOverrides_ back-compat-parses the OLD flat {key:[roles]} shape (no global/orgs wrapper)
// as if it were `global` -- so every override a SystemAdmin already saved before this REQ keeps
// working unchanged, no migration script needed.
function getPermissionOverrides_() {
  var row = findWhere('Permissions', function (r) { return r.id === 'GLOBAL'; })[0];
  if (!row || !row.overridesJson) return { global: {}, orgs: {} };
  var parsed;
  try { parsed = JSON.parse(row.overridesJson); } catch (e) { return { global: {}, orgs: {} }; }
  if (parsed && !parsed.global && !parsed.orgs) return { global: parsed, orgs: {} };
  return { global: (parsed && parsed.global) || {}, orgs: (parsed && parsed.orgs) || {} };
}

function savePermissionOverrides_(user, overrides) {
  var existing = findWhere('Permissions', function (r) { return r.id === 'GLOBAL'; })[0];
  var row = { overridesJson: JSON.stringify(overrides), updatedAt: nowIso_(), updatedBy: user.id };
  if (existing) updateRow('Permissions', existing.id, row);
  else insertRow('Permissions', Object.assign({ id: 'GLOBAL' }, row));
}

// The role list actually in effect for a permission key right now, for ONE org (or none, for
// SystemAdmin/platform-level checks): that org's own override if it has one, else the platform-wide
// override if a SystemAdmin has set one, else the key's built-in default. Falls back to an empty array
// (nobody allowed) for an unknown key rather than throwing, so a stale override referencing a
// since-removed key can't crash a live request.
function effectivePermissionRoles_(key, overrides, orgId) {
  var entry = PERMISSION_REGISTRY_[key];
  if (!entry) return [];
  var orgOverride = orgId && overrides.orgs ? overrides.orgs[orgId] : null;
  if (orgOverride && orgOverride[key] && orgOverride[key].length) return orgOverride[key];
  var globalOverride = overrides.global ? overrides.global[key] : undefined;
  if (globalOverride && globalOverride.length) return globalOverride;
  return entry.defaultRoles;
}

// Drop-in replacement for requireRole at any migrated call site -- same signature plus the
// permission key in place of a literal allowedRoles array. Org-scoping is always the ACTING user's own
// orgId (never contextOrgId, which keeps its pre-existing, unrelated job below of listing "who at that
// org could do this" in the 403 message) -- so a permission check for a GA/EMC/Inspection-org user
// always reflects THEIR OWN organization's override, regardless of which org's data they're touching,
// and SystemAdmin (no orgId of their own) always sees the platform-wide default, never any single org's
// override. This is what makes an org's admin's Settings > Permissions edits affect only their own
// org's staff, with no changes needed at any of this function's ~90 existing call sites.
function requirePermission(user, key, contextOrgId) {
  if (!PERMISSION_REGISTRY_[key]) throw new HululError('SERVER_ERROR', 'Unknown permission key: ' + key);
  var roles = effectivePermissionRoles_(key, getPermissionOverrides_(), user && user.orgId);
  return requireRole(user, roles, contextOrgId);
}

// Non-throwing companion to requirePermission -- for call sites that need to branch on "can this
// user do X" (e.g. openEventTemplate's auto-transition logic, Templates.gs) rather than reject the
// whole request when they can't. Returns false (not an error) for a signed-out user.
function hasPermissionRole_(user, key) {
  if (!user) return false;
  return effectivePermissionRoles_(key, getPermissionOverrides_(), user.orgId).indexOf(user.role) !== -1;
}

// Every GA/EMC/Inspection Company "org admin" role -- the tier REQ means by "an organization's admin".
var ORG_ADMIN_ROLES_ = ['GAAdmin', 'EMCAdmin', 'InspectionAdmin']; // plain strings, not ROLES.X -- see
// the load-order note above PERMISSION_REGISTRY_: Permissions.gs (P) loads before Utils.gs (U).

// REQ follow-up: "I meant as in Organization Type" -- the ceiling is unlocked per Organization TYPE
// (GA/EMC/INSPECTION, the same three values as Users.orgType/Organizations.type -- see users.js'
// ROLE_ORG_TYPE and organizations.js' New Organization Type dropdown), not per individual organization.
// One ceiling covers every org of that type, including ones created after it's set, with nothing to
// re-configure per new org. Stored as one Config row (getConfigJson_/setConfigJson_, Utils.gs) rather
// than a field on Organizations -- there's no per-org state left to keep here at all.
var ORG_TYPES_ = ['GA', 'EMC', 'INSPECTION'];
var ORG_TYPE_CEILING_CONFIG_KEY_ = 'orgTypePermissionCeilings';

// Which permission keys `orgType`'s own admins have been unlocked to reconfigure themselves -- set by
// SystemAdmin via setOrgTypePermissionCeiling. Blank/malformed -> empty (nothing unlocked), never
// throws, same defensive convention as effectivePermissionRoles_ above.
function getOrgTypeCeiling_(orgType) {
  if (!orgType) return [];
  var ceilings = getConfigJson_(ORG_TYPE_CEILING_CONFIG_KEY_, {});
  var arr = ceilings[orgType];
  return Array.isArray(arr) ? arr.filter(function (k) { return !!PERMISSION_REGISTRY_[k]; }) : [];
}

// SystemAdmin-only: the full catalog (every registered key, its module/label/page) so the ceiling
// editor (Settings > Permissions) can render a checklist without a second endpoint, plus which keys
// `p.orgType` is currently unlocked for.
function getOrgTypePermissionCeiling(user, p) {
  requireRole(user, [ROLES.SYSTEM_ADMIN]);
  if (!p || !p.orgType) throw new HululError('BAD_REQUEST', 'orgType is required');
  if (ORG_TYPES_.indexOf(p.orgType) === -1) throw new HululError('BAD_REQUEST', 'Invalid orgType');
  var catalog = Object.keys(PERMISSION_REGISTRY_).map(function (key) {
    var entry = PERMISSION_REGISTRY_[key];
    return { key: key, module: entry.module, label: entry.label, page: entry.page || null };
  });
  return { orgType: p.orgType, keys: getOrgTypeCeiling_(p.orgType), catalog: catalog };
}

// SystemAdmin-only: set which permission keys `p.orgType`'s own admins may reconfigure. Replaces the
// whole set (not a per-key toggle endpoint) -- the frontend always sends the full checked list, same
// "resend everything" convention as updateInspectionResult's full-item-array saves.
function setOrgTypePermissionCeiling(user, p) {
  requireRole(user, [ROLES.SYSTEM_ADMIN]);
  if (!p || !p.orgType) throw new HululError('BAD_REQUEST', 'orgType is required');
  if (ORG_TYPES_.indexOf(p.orgType) === -1) throw new HululError('BAD_REQUEST', 'Invalid orgType');
  var keys = Array.isArray(p.keys) ? p.keys.filter(function (k) { return !!PERMISSION_REGISTRY_[k]; }) : [];
  var ceilings = getConfigJson_(ORG_TYPE_CEILING_CONFIG_KEY_, {});
  ceilings[p.orgType] = keys;
  setConfigJson_(ORG_TYPE_CEILING_CONFIG_KEY_, ceilings);
  audit(user.id, 'SET_ORG_TYPE_PERMISSION_CEILING', 'Config', ORG_TYPE_CEILING_CONFIG_KEY_, { orgType: p.orgType, keys: keys });
  return { orgType: p.orgType, keys: keys };
}

// SystemAdmin sees the full platform-wide catalog + current global overrides (unchanged behavior from
// before this REQ). An org admin (ORG_ADMIN_ROLES_) sees a FILTERED view instead: only the permission
// keys their own org has been unlocked for (getOrgPermissionCeiling_), each showing what's currently
// effective for their org (their own org-scoped override if they've already set one, else whatever the
// platform-wide default currently is, so their starting point in the editor is accurate). allRoles
// (every role code + display label) rides along either way -- same "server hands back its own
// picklist" convention as getEscalationConfig (Resolutions.gs).
function listPermissions(user, p) {
  if (!user) throw new HululError('UNAUTHENTICATED', 'Login required');
  var overrides = getPermissionOverrides_();
  var allRoles = allRolePicklist_();

  if (user.role === ROLES.SYSTEM_ADMIN) {
    var permissions = Object.keys(PERMISSION_REGISTRY_).map(function (key) {
      var entry = PERMISSION_REGISTRY_[key];
      var override = overrides.global[key];
      return {
        key: key, module: entry.module, label: entry.label,
        page: entry.page || null, crud: entry.crud || [],
        defaultRoles: entry.defaultRoles,
        roles: (override && override.length) ? override : entry.defaultRoles,
        isOverridden: !!(override && override.length)
      };
    });
    return { permissions: permissions, allRoles: allRoles, scope: 'global' };
  }

  if (ORG_ADMIN_ROLES_.indexOf(user.role) === -1) throw new HululError('FORBIDDEN', 'Not permitted to view permissions');
  if (!user.orgId) throw new HululError('FORBIDDEN', 'No organization on this account');
  var ceiling = getOrgTypeCeiling_(user.orgType);
  var orgOverrides = (overrides.orgs && overrides.orgs[user.orgId]) || {};
  var scopedPermissions = ceiling.map(function (key) {
    var entry = PERMISSION_REGISTRY_[key];
    if (!entry) return null;
    var override = orgOverrides[key];
    return {
      key: key, module: entry.module, label: entry.label,
      page: entry.page || null, crud: entry.crud || [],
      defaultRoles: effectivePermissionRoles_(key, overrides, null), // the platform default (no org
      // scoping) -- shown in the editor as "Reset to" target, same meaning defaultRoles has for
      // SystemAdmin's own view above.
      roles: (override && override.length) ? override : effectivePermissionRoles_(key, overrides, user.orgId),
      isOverridden: !!(override && override.length)
    };
  }).filter(Boolean);
  return { permissions: scopedPermissions, allRoles: allRoles, scope: 'org', orgId: user.orgId };
}

// SystemAdmin: sets the platform-wide default for one permission key (unchanged behavior). An org
// admin: sets THEIR OWN org's override instead -- gated to only keys their org has been unlocked for
// (getOrgPermissionCeiling_), and never allowed to grant the SystemAdmin role itself through this path
// (belt-and-suspenders on top of the org-scoping in effectivePermissionRoles_ already making such a
// grant a no-op in practice, since SystemAdmin has no orgId of its own to be scoped by).
function updatePermission(user, p) {
  if (!user) throw new HululError('UNAUTHENTICATED', 'Login required');
  if (!p || !p.key || !PERMISSION_REGISTRY_[p.key]) throw new HululError('BAD_REQUEST', 'A valid permission key is required');
  if (!p.roles || !p.roles.length) throw new HululError('BAD_REQUEST', 'At least one role must be allowed');
  var validRoles = allRoleCodes_(); // built-in + active custom roles (Roles.gs) -- else a grant to a
  // newly-created custom role would be silently filtered out right here and never actually save.
  var clean = p.roles.filter(function (r) { return validRoles.indexOf(r) !== -1; });

  if (user.role === ROLES.SYSTEM_ADMIN) {
    if (!clean.length) throw new HululError('BAD_REQUEST', 'No valid roles supplied');
    var overrides = getPermissionOverrides_();
    overrides.global[p.key] = clean;
    savePermissionOverrides_(user, overrides);
    audit(user.id, 'UPDATE_PERMISSION', 'Permissions', p.key, { roles: clean, scope: 'global' });
    return { key: p.key, roles: clean };
  }

  if (ORG_ADMIN_ROLES_.indexOf(user.role) === -1 || !user.orgId) throw new HululError('FORBIDDEN', 'Not permitted to change permissions');
  var ceiling = getOrgTypeCeiling_(user.orgType);
  if (ceiling.indexOf(p.key) === -1) throw new HululError('FORBIDDEN', 'Your organization has not been granted control over this permission');
  var orgClean = clean.filter(function (r) { return r !== ROLES.SYSTEM_ADMIN; });
  if (!orgClean.length) throw new HululError('BAD_REQUEST', 'No valid roles supplied');
  var orgOverrides_ = getPermissionOverrides_();
  if (!orgOverrides_.orgs[user.orgId]) orgOverrides_.orgs[user.orgId] = {};
  orgOverrides_.orgs[user.orgId][p.key] = orgClean;
  savePermissionOverrides_(user, orgOverrides_);
  audit(user.id, 'UPDATE_PERMISSION', 'Permissions', p.key, { roles: orgClean, scope: 'org', orgId: user.orgId });
  return { key: p.key, roles: orgClean };
}

// Symmetric with updatePermission -- SystemAdmin clears the platform-wide override; an org admin
// clears (only) their own org's override, both reverting to whatever's effective one level up.
function resetPermission(user, p) {
  if (!user) throw new HululError('UNAUTHENTICATED', 'Login required');
  if (!p || !p.key || !PERMISSION_REGISTRY_[p.key]) throw new HululError('BAD_REQUEST', 'A valid permission key is required');
  var overrides = getPermissionOverrides_();

  if (user.role === ROLES.SYSTEM_ADMIN) {
    delete overrides.global[p.key];
    savePermissionOverrides_(user, overrides);
    audit(user.id, 'RESET_PERMISSION', 'Permissions', p.key, { scope: 'global' });
    return { key: p.key, roles: PERMISSION_REGISTRY_[p.key].defaultRoles };
  }

  if (ORG_ADMIN_ROLES_.indexOf(user.role) === -1 || !user.orgId) throw new HululError('FORBIDDEN', 'Not permitted to change permissions');
  if (overrides.orgs[user.orgId]) delete overrides.orgs[user.orgId][p.key];
  savePermissionOverrides_(user, overrides);
  audit(user.id, 'RESET_PERMISSION', 'Permissions', p.key, { scope: 'org', orgId: user.orgId });
  return { key: p.key, roles: effectivePermissionRoles_(p.key, overrides, null) };
}

// Any authenticated user: a plain boolean map (permissionKey -> can-I-do-this) for their OWN role AND
// org, covering every registered key -- this (not listPermissions, which is admin-only and exposes
// every role's access) is what the frontend fetches once at login and uses to show/hide
// create/edit/delete controls consistently with what the backend will actually allow.
function getMyPermissions(user, p) {
  if (!user) throw new HululError('UNAUTHENTICATED', 'Login required');
  var overrides = getPermissionOverrides_();
  var out = {};
  Object.keys(PERMISSION_REGISTRY_).forEach(function (key) {
    out[key] = effectivePermissionRoles_(key, overrides, user.orgId).indexOf(user.role) !== -1;
  });
  return out;
}

// Any authenticated user: which PERMISSION_REGISTRY_ `page` ids their role has at least one granted
// action on. REQ follow-up: "a newly-created role should see pages/tabs it's been granted access to
// without a code change" -- NAV_ITEMS (app.js) still hardcodes its own `roles` arrays for the
// built-in roles (unchanged, so nothing about their behavior changes), but navItemVisible_ (app.js)
// ALSO checks this map so a nav item whose page has ANY permission key granted to the signed-in
// user's role shows up too -- the one path that makes a brand new custom role's Settings > Permissions
// grants actually visible in the sidebar with zero code changes. Deliberately its own endpoint rather
// than folded into getMyPermissions above: that one's shape (permissionKey -> boolean) is a stable
// contract several call sites already depend on (hasPermission, permissions.js), and every real key
// contains a '.' while every page id doesn't, so mixing them into one flat object risked confusion for
// no real benefit.
function getMyPageAccess(user, p) {
  if (!user) throw new HululError('UNAUTHENTICATED', 'Login required');
  var overrides = getPermissionOverrides_();
  var pages = {};
  Object.keys(PERMISSION_REGISTRY_).forEach(function (key) {
    var entry = PERMISSION_REGISTRY_[key];
    if (!entry.page || pages[entry.page]) return;
    if (effectivePermissionRoles_(key, overrides, user.orgId).indexOf(user.role) !== -1) pages[entry.page] = true;
  });
  return pages;
}
