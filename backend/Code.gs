/**
 * HULUL - Code.gs
 * Web App entry point. Deployed as: Execute as "Me", Access "Anyone".
 *
 * CORS NOTE: the frontend lives on GitHub Pages (a different origin), so every
 * request from it is cross-origin. Apps Script Web Apps cannot handle a custom
 * OPTIONS preflight, so the frontend MUST send POST requests with
 * `Content-Type: text/plain;charset=utf-8` (a "simple request" that skips
 * preflight) with a JSON string as the body; this file parses it manually.
 * GET requests are used only for lightweight, non-sensitive calls (e.g. ping).
 */

function doGet(e) {
  try {
    var action = e.parameter.action || 'ping';
    if (action === 'ping') return jsonOut_({ ok: true, service: 'HULUL', time: nowIso_() });
    var result = dispatch_(action, e.parameter, e.parameter.token);
    return jsonOut_({ ok: true, data: result });
  } catch (err) {
    return jsonOut_(errorPayload_(err));
  }
}

function doPost(e) {
  try {
    var body = {};
    if (e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }
    var action = body.action || (e.parameter && e.parameter.action);
    var result = dispatch_(action, body.payload || {}, body.token);
    return jsonOut_({ ok: true, data: result });
  } catch (err) {
    return jsonOut_(errorPayload_(err));
  }
}

function errorPayload_(err) {
  var code = err && err.code ? err.code : 'SERVER_ERROR';
  var message = err && err.message ? err.message : String(err);
  var error = { code: code, message: message };
  if (err && err.allowedRoles) error.allowedRoles = err.allowedRoles;
  if (err && err.contacts) error.contacts = err.contacts;
  return { ok: false, error: error };
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Actions that do not require a logged-in user.
// REQ: "Add Login through MS Entra or google login." getSsoConfig/loginWithGoogle/loginWithMicrosoft
// (Sso.gs) all have to be reachable before anyone is signed in, same reasoning as login/redeemQuickLogin.
var PUBLIC_ACTIONS = { login: 1, ping: 1, redeemQuickLogin: 1, getSsoConfig: 1, loginWithGoogle: 1, loginWithMicrosoft: 1 };

function dispatch_(action, payload, token) {
  if (!action) throw new HululError('BAD_REQUEST', 'Missing action');
  var user = null;
  if (!PUBLIC_ACTIONS[action]) {
    user = getUserByToken(token);
  }
  var handler = ROUTES[action];
  if (!handler) throw new HululError('NOT_FOUND', 'Unknown action: ' + action);
  return handler(user, payload || {});
}

// ---- Route table: action name -> (user, payload) => result ---------------
var ROUTES = {
  // Auth
  login: function (_u, p) { return login(p.email, p.password); },
  logout: function (_u, p) { return logout(p.token); },
  me: function (u) { return u; },
  changePassword: function (u, p) { return changePassword(u.id, p.oldPassword, p.newPassword); },

  // Single Sign-On (Sso.gs) -- REQ: "Add Login through MS Entra or google login."
  getSsoConfig: function () { return getSsoConfig(); },
  setSsoConfig: function (u, p) { return setSsoConfig(u, p); },
  loginWithGoogle: function (_u, p) { return loginWithGoogle(p); },
  loginWithMicrosoft: function (_u, p) { return loginWithMicrosoft(p); },

  // Accounts (ACC)
  listUsers: function (u, p) { return listUsers(u, p); },
  createUser: function (u, p) { return createUser(u, p); },
  updateUser: function (u, p) { return updateUserAccount(u, p); },
  deactivateUser: function (u, p) { return deactivateUser(u, p.userId); },
  activateUser: function (u, p) { return activateUser(u, p.userId); },
  hardDeleteUser: function (u, p) { return hardDeleteUser(u, p); },
  resetPassword: function (u, p) { return adminResetPassword(u, p.userId, p.newPassword); },
  listOrganizations: function (u) { return listOrganizations(u); },
  createOrganization: function (u, p) { return createOrganization(u, p); },
  updateOrganizationDomain: function (u, p) { return updateOrganizationDomain(u, p); },
  getMyOrg: function (u) { return getMyOrg(u); },
  getEventBrandingLogos: function (u, p) { return getEventBrandingLogos(u, p); },
  uploadOrgLogo: function (u, p) { return uploadOrgLogo(u, p); },
  // My Profile (Accounts.gs) -- self-service only, see that section's own header comment.
  getMyProfile: function (u, p) { return getMyProfile(u); },
  updateMyProfile: function (u, p) { return updateMyProfile(u, p); },
  uploadMyProfilePhoto: function (u, p) { return uploadMyProfilePhoto(u, p); },
  addMyCertificate: function (u, p) { return addMyCertificate(u, p); },
  deleteMyCertificate: function (u, p) { return deleteMyCertificate(u, p); },
  setOrgPhotoProperties: function (u, p) { return setOrgPhotoProperties(u, p); },
  getOrgLabels: function (u, p) { return getOrgLabels(u, p); },
  setOrgLabels: function (u, p) { return setOrgLabels(u, p); },
  getAppIcons: function (u, p) { return getAppIcons(u, p); },
  setAppIcons: function (u, p) { return setAppIcons(u, p); },
  getCustomIconLibraries: function (u, p) { return getCustomIconLibraries(u, p); },
  addCustomIconLibrary: function (u, p) { return addCustomIconLibrary(u, p); },
  deleteCustomIconLibrary: function (u, p) { return deleteCustomIconLibrary(u, p); },
  auditLog: function (u, p) { return listAuditLog(u, p); },
  // Admin-configurable RBAC (Permissions.gs) -- see its header comment for current rollout status.
  listPermissions: function (u, p) { return listPermissions(u, p); },
  updatePermission: function (u, p) { return updatePermission(u, p); },
  resetPermission: function (u, p) { return resetPermission(u, p); },
  // REQ: "set for an Organisation the permissions they can set" -- SystemAdmin-only ceiling editor;
  // listPermissions/updatePermission/resetPermission above already branch on the ACTING user's own
  // role/org to enforce it (Permissions.gs), no separate routes needed for the org-admin side.
  getOrgTypePermissionCeiling: function (u, p) { return getOrgTypePermissionCeiling(u, p); },
  setOrgTypePermissionCeiling: function (u, p) { return setOrgTypePermissionCeiling(u, p); },
  getMyPermissions: function (u, p) { return getMyPermissions(u, p); },
  getMyPageAccess: function (u, p) { return getMyPageAccess(u, p); },
  // Translation Hub (Translations.gs) -- REQ: dedicated worklist for a translator team, with
  // percentage-translated tracking and an "untranslated only" view (both derived client-side from this
  // one flat list, translations.js).
  listTranslationItems: function (u, p) { return listTranslationItems(u); },
  updateTranslation: function (u, p) { return updateTranslation(u, p); },
  // Admin-defined custom roles (Roles.gs) -- "create a new role" without a code deploy.
  listCustomRoles: function (u, p) { return listCustomRoles(u); },
  listAllRolesPicklist: function (u, p) { return listAllRolesPicklist(u); },
  createRole: function (u, p) { return createRole(u, p); },
  updateRole: function (u, p) { return updateRole(u, p); },
  deleteRole: function (u, p) { return deleteRole(u, p); },
  setMandatoryOperator: function (u, p) { return setMandatoryOperator(u, p); },
  listParticipantTypes: function (u, p) { return listParticipantTypes(u); },
  // Roadmap Plans (RoadmapPlans.gs) -- admin-defined plan templates + their per-Event rollout.
  listRoadmapPlans: function (u, p) { return listRoadmapPlans(u); },
  getRoadmapPlan: function (u, p) { return getRoadmapPlan(u, p); },
  createRoadmapPlan: function (u, p) { return createRoadmapPlan(u, p); },
  updateRoadmapPlan: function (u, p) { return updateRoadmapPlan(u, p); },
  deleteRoadmapPlan: function (u, p) { return deleteRoadmapPlan(u, p); },
  addRoadmapPlanItem: function (u, p) { return addRoadmapPlanItem(u, p); },
  updateRoadmapPlanItem: function (u, p) { return updateRoadmapPlanItem(u, p); },
  deleteRoadmapPlanItem: function (u, p) { return deleteRoadmapPlanItem(u, p); },
  moveRoadmapPlanItem: function (u, p) { return moveRoadmapPlanItem(u, p); },
  listEventRoadmapItems: function (u, p) { return listEventRoadmapItems(u, p); },
  generateEventRoadmap: function (u, p) { return generateEventRoadmap(u, p); },
  addEventRoadmapItem: function (u, p) { return addEventRoadmapItem(u, p); },
  updateEventRoadmapItem: function (u, p) { return updateEventRoadmapItem(u, p); },
  deleteEventRoadmapItem: function (u, p) { return deleteEventRoadmapItem(u, p); },
  uploadRoadmapItemAttachment: function (u, p) { return uploadRoadmapItemAttachment(u, p); },

  // Projects (grouping of several Events)
  listProjects: function (u, p) { return listProjects(u, p); },
  createProject: function (u, p) { return createProject(u, p); },
  updateProject: function (u, p) { return updateProject(u, p); },
  deleteProject: function (u, p) { return deleteProject(u, p); },

  // Events / Venues / Zones (EVT)
  listEvents: function (u, p) { return listEvents(u, p); },
  getEvent: function (u, p) { return getEventDetail(u, p.eventId); },
  getMandatoryOperatorCompliance: function (u, p) { return getMandatoryOperatorCompliance(u, p); },
  createEvent: function (u, p) { return createEvent(u, p); },
  updateEvent: function (u, p) { return updateEvent(u, p); },
  deleteEvent: function (u, p) { return deleteEvent(u, p); },
  createSubEvent: function (u, p) { return createSubEvent(u, p); },
  listSubEvents: function (u, p) { return listSubEvents(u, p); },
  listVenues: function (u, p) { return listVenues(u, p); },
  createVenue: function (u, p) { return createVenue(u, p); },
  updateVenue: function (u, p) { return updateVenue(u, p); },
  listVenueImpact: function (u, p) { return listVenueImpact(u, p); },
  deleteVenue: function (u, p) { return deleteVenue(u, p); },
  listZones: function (u, p) { return listZones(u, p); },
  createZone: function (u, p) { return createZone(u, p); },
  updateZone: function (u, p) { return updateZone(u, p); },
  deleteZone: function (u, p) { return deleteZone(u, p); },
  listZoneImpact: function (u, p) { return listZoneImpact(u, p); },
  assignEventManager: function (u, p) { return assignEventManagerToVenue(u, p); },

  // Places (PLC)
  listPlaces: function (u, p) { return listPlaces(u, p); },
  createPlace: function (u, p) { return createPlace(u, p); },
  updatePlace: function (u, p) { return updatePlace(u, p); },
  bulkImportPlaces: function (u, p) { return bulkImportPlaces(u, p); },
  addPlaceAccount: function (u, p) { return addPlaceAccount(u, p); },
  getPlaceAccountCredentials: function (u, p) { return getPlaceAccountCredentials(u, p); },
  deletePlace: function (u, p) { return deletePlace(u, p); },
  redeemQuickLogin: function (_u, p) { return redeemQuickLogin(p.token); },

  // Templates (TPL)
  listTemplateLibrary: function (u, p) { return listTemplateLibrary(u, p); },
  createLibraryTemplate: function (u, p) { return createLibraryTemplate(u, p); },
  updateLibraryTemplate: function (u, p) { return updateLibraryTemplate(u, p); },
  uploadLibraryTemplateVersion: function (u, p) { return uploadLibraryTemplateVersion(u, p); },
  getEventTemplates: function (u, p) { return getEventTemplates(u, p); },
  sendTemplates: function (u, p) { return sendTemplates(u, p); },
  openEventTemplate: function (u, p) { return openEventTemplate(u, p); },
  pickTemplateLanguage: function (u, p) { return pickTemplateLanguage(u, p); },
  uploadEventTemplateFile: function (u, p) { return uploadEventTemplateFile(u, p); },
  submitEventTemplate: function (u, p) { return submitEventTemplate(u, p); },
  reviewEventTemplate: function (u, p) { return reviewEventTemplate(u, p); },
  setTemplatesDeadline: function (u, p) { return setTemplatesDeadline(u, p); },
  extendTemplateDeadlineVersion: function (u, p) { return extendTemplateDeadlineVersion(u, p); },
  createNextTemplateDeadlineVersion: function (u, p) { return createNextTemplateDeadlineVersion(u, p); },
  listTemplateDeadlineVersions: function (u, p) { return listTemplateDeadlineVersions(u, p); },
  listTemplateVersionSnapshots: function (u, p) { return listTemplateVersionSnapshots(u, p); },
  getTemplateDeadlineVersionGapDays: function (u, p) { return getTemplateDeadlineVersionGapDays(u); },
  setTemplateDeadlineVersionGapDays: function (u, p) { return setTemplateDeadlineVersionGapDays(u, p); },
  getTemplateProcessRoles: function (u, p) { return getTemplateProcessRoles(u); },
  // Document Review scoring (REQ follow-up: "convert the templates to forms and include evaluation process")
  listTemplateScoringItems: function (u, p) { return listTemplateScoringItems(u, p); },
  getTemplateScoringResults: function (u, p) { return getTemplateScoringResults(u, p); },
  saveTemplateScoring: function (u, p) { return saveTemplateScoring(u, p); },
  finalizeTemplateScoring: function (u, p) { return finalizeTemplateScoring(u, p); },
  reopenTemplateScoring: function (u, p) { return reopenTemplateScoring(u, p); },
  getEventTemplatesScoringSummary: function (u, p) { return getEventTemplatesScoringSummary(u, p); },
  listEventScoringItems: function (u, p) { return listEventScoringItems(u, p); },
  importTemplateScoringCatalog: function (u, p) { return importTemplateScoringCatalog(u, p); },
  listScoringCatalogSummary: function (u, p) { return listScoringCatalogSummary(u); },

  // Annex (ANX)
  listEventAnnex: function (u, p) { return listEventAnnex(u, p); },
  runSeedAnnexCategories: function (u, p) { return runSeedAnnexCategories(u, p); },
  setAnnexCategoryRequired: function (u, p) { return setAnnexCategoryRequired(u, p); },
  uploadAnnexDocument: function (u, p) { return uploadAnnexDocument(u, p); },
  reviewAnnexDocument: function (u, p) { return reviewAnnexDocument(u, p); },
  markAnnexCategoryProvided: function (u, p) { return markAnnexCategoryProvided(u, p); },
  requestAnnexInfo: function (u, p) { return requestAnnexInfo(u, p); },
  deleteAnnexDocument: function (u, p) { return deleteAnnexDocument(u, p); },
  // Annex Categories catalog admin (Inspection Setup)
  listAnnexCategories: function (u, p) { return listAnnexCategories(u, p); },
  createAnnexCategory: function (u, p) { return createAnnexCategory(u, p); },
  updateAnnexCategory: function (u, p) { return updateAnnexCategory(u, p); },
  deleteAnnexCategory: function (u, p) { return deleteAnnexCategory(u, p); },

  scheduleKickoff: function (u, p) { return scheduleKickoff(u, p); },
  listMeetings: function (u, p) { return listMeetings(u, p); },
  updateMeeting: function (u, p) { return updateMeeting(u, p); },
  deleteMeeting: function (u, p) { return deleteMeeting(u, p); },
  markMeetingAttended: function (u, p) { return markMeetingAttended(u, p); },
  // To-Do Inbox (Todo.gs) -- open to every signed-in user, self-scoped internally (no permission
  // gate needed, same as Dashboard/Notifications/Support -- see NAV_ITEMS' own comment, app.js).
  listMyTodoItems: function (u, p) { return listMyTodoItems(u); },
  listMeetingTemplates: function (u, p) { return listMeetingTemplates(u, p); },
  getMeetingTemplatesBySubject: function (u, p) { return getMeetingTemplatesBySubject(u, p); },
  saveMeetingTemplate: function (u, p) { return saveMeetingTemplate(u, p); },
  deleteMeetingTemplate: function (u, p) { return deleteMeetingTemplate(u, p); },

  // Venue approval (VAP)
  recordRecommendation: function (u, p) { return recordRecommendation(u, p); },
  recordVenueDecision: function (u, p) { return recordVenueDecision(u, p); },
  listVenueEvaluations: function (u, p) { return listVenueEvaluations(u, p); },
  reassignVenue: function (u, p) { return reassignVenue(u, p); },

  // Disciplines / Inspectors (DIS)
  listDisciplines: function () { return listDisciplines(); },
  createDiscipline: function (u, p) { return createDiscipline(u, p); },
  updateDiscipline: function (u, p) { return updateDiscipline(u, p); },
  identifyDisciplines: function (u, p) { return identifyDisciplines(u, p); },
  listEventDisciplines: function (u, p) { return listEventDisciplines(p.eventId); },
  setInspectorQualifications: function (u, p) { return setInspectorQualifications(u, p); },
  listInspectorQualifications: function (u, p) { return listInspectorQualifications(u, p); },
  listQualifiedInspectors: function (u, p) { return listQualifiedInspectors(u, p); },
  listAssignableChecklistTypes: function (u, p) { return listAssignableChecklistTypes(u, p); },
  assignInspector: function (u, p) { return assignInspector(u, p); },
  removeInspectorAssignment: function (u, p) { return removeInspectorAssignment(u, p); },
  listInspectorAssignments: function (u, p) { return listInspectorAssignments(u, p); },
  listCoverageGaps: function (u, p) { return listCoverageGaps(u, p); },
  listConflictFreeQualifiedInspectors: function (u, p) { return listConflictFreeQualifiedInspectors(u, p); },
  reassignInspector: function (u, p) { return reassignInspector(u, p); },

  // Event Chat & Event Log (see EventChat.gs)
  listEventChatMessages: function (u, p) { return listEventChatMessages(u, p); },
  postEventChatMessage: function (u, p) { return postEventChatMessage(u, p); },
  listChatTaggableUsers: function (u, p) { return listChatTaggableUsers(u, p); },
  listChatTaggableParticipants: function (u, p) { return listChatTaggableParticipants(u, p); },
  listEventLog: function (u, p) { return listEventLog(u, p); },
  uploadChatScreenshot: function (u, p) { return uploadChatScreenshot(u, p); },

  // Sidebar Re-assignment (see Reassignment.gs)
  setUserUnavailable: function (u, p) { return setUserUnavailable(u, p); },
  setUserAvailable: function (u, p) { return setUserAvailable(u, p); },
  listUnavailableUsers: function (u, p) { return listUnavailableUsers(u); },
  listUserAssignments: function (u, p) { return listUserAssignments(u, p); },
  listReplacementSuggestions: function (u, p) { return listReplacementSuggestions(u, p); },

  // Inspections & checklists (INS)
  listChecklistItems: function (u, p) { return listChecklistItems(p); },
  createChecklistItem: function (u, p) { return createChecklistItem(u, p); },
  bulkCreateChecklistItems: function (u, p) { return bulkCreateChecklistItems(u, p); },
  updateChecklistItem: function (u, p) { return updateChecklistItem(u, p); },
  deleteChecklistItem: function (u, p) { return deleteChecklistItem(u, p); },
  dedupeChecklistItems: function (u) { return dedupeChecklistItems(u); },

  // Log Assistance Guide (see FindingGuide.gs) -- REQ: "Some inspectors are junior level and could
  // use help. We have created a guide which should give them a list of descriptions once they select
  // the category and sub-category."
  listFindingGuide: function () { return listFindingGuide(); },
  createFindingGuideEntry: function (u, p) { return createFindingGuideEntry(u, p); },
  bulkCreateFindingGuideEntries: function (u, p) { return bulkCreateFindingGuideEntries(u, p); },
  updateFindingGuideEntry: function (u, p) { return updateFindingGuideEntry(u, p); },
  deleteFindingGuideEntry: function (u, p) { return deleteFindingGuideEntry(u, p); },
  scheduleInspection: function (u, p) { return scheduleInspection(u, p); },
  updateInspection: function (u, p) { return updateInspection(u, p); },
  deleteInspection: function (u, p) { return deleteInspection(u, p); },
  listInspections: function (u, p) { return listInspections(u, p); },
  // REQ: self-service "open checklist" pickup for qualified-but-unassigned Inspectors.
  listOpenInspectionSlots: function (u, p) { return listOpenInspectionSlots(u, p); },
  claimOpenInspectionSlot: function (u, p) { return claimOpenInspectionSlot(u, p); },
  cancelSelfAssignedInspection: function (u, p) { return cancelSelfAssignedInspection(u, p); },
  listCompletedChecklists: function (u, p) { return listCompletedChecklists(u, p); },
  listAllCompletedChecklists: function (u, p) { return listAllCompletedChecklists(u, p); },
  listInspectionResults: function (u, p) { return listInspectionResults(u, p); },
  recordInspectionResults: function (u, p) { return recordInspectionResults(u, p); },
  updateInspectionResult: function (u, p) { return updateInspectionResult(u, p); },
  listInspectionParticipants: function (u, p) { return listInspectionParticipants(u, p); },
  uploadEvidence: function (u, p) { return uploadEvidence(u, p); },
  pingInspectionLocation: function (u, p) { return pingInspectionLocation(u, p); },
  listActiveInspectorLocations: function (u, p) { return listActiveInspectorLocations(u, p); },

  // Findings (NCF) -- full Risk Logging workflow (Open -> Viewed -> Submitted -> InReview -> ...)
  listFindings: function (u, p) { return listFindings(u, p); },
  listAllFindings: function (u, p) { return listAllFindings(u, p); },
  // Operator Organizations (Operators.gs) -- REQ: "Add Operator as an organization ... security
  // operators or housekeeping operators or crowd management operators ... can track logs directed
  // to them from different events."
  listOperatorOrganizations: function (u) { return listOperatorOrganizations(u); },
  listEventOperatorAssignments: function (u, p) { return listEventOperatorAssignments(u, p); },
  assignEventOperator: function (u, p) { return assignEventOperator(u, p); },
  createFinding: function (u, p) { return createFinding(u, p); },
  updateFinding: function (u, p) { return updateFinding(u, p); },
  deleteFinding: function (u, p) { return deleteFinding(u, p); },
  addFindingEvidence: function (u, p) { return addFindingEvidence(u, p); },
  deleteFindingEvidence: function (u, p) { return deleteFindingEvidence(u, p); },
  listFindingEvidenceTrash: function (u, p) { return listFindingEvidenceTrash(u, p); },
  restoreFindingEvidence: function (u, p) { return restoreFindingEvidence(u, p); },
  emptyFindingEvidenceTrash: function (u, p) { return emptyFindingEvidenceTrash(u, p); },
  viewFinding: function (u, p) { return viewFinding(u, p); },
  resolveFinding: function (u, p) { return resolveFinding(u, p); },
  addResolutionEvidence: function (u, p) { return addResolutionEvidence(u, p); },
  reviewFindingResolution: function (u, p) { return reviewFindingResolution(u, p); },
  assignFindingParticipant: function (u, p) { return assignFindingParticipant(u, p); },
  // REQ follow-up: "Make this optional in the settings so admin may want to enforce taking a photo"
  // -- SystemAdmin-only, same posture as getTemplateDeadlineVersionGapDays/set... above.
  getResolutionEvidenceRequired: function (u, p) { return getResolutionEvidenceRequired(u); },
  setResolutionEvidenceRequired: function (u, p) { return setResolutionEvidenceRequired(u, p); },

  // Resolutions & escalations (RES) -- submitResolution/reviewResolution removed, superseded by
  // resolveFinding/reviewFindingResolution above (see Resolutions.gs header comment).
  listResolutions: function (u, p) { return listResolutions(u, p); },
  listEscalations: function (u, p) { return listEscalations(u, p); },
  createEscalation: function (u, p) { return createEscalation(u, p); },
  runEscalationCheck: function (u) { return runEscalationCheck(u); },
  getEscalationConfig: function (u) { return getEscalationConfig(u); },
  setEscalationConfig: function (u, p) { return setEscalationConfig(u, p); },
  listMyPendingEscalations: function (u) { return listMyPendingEscalations(u); },
  acknowledgeEscalation: function (u, p) { return acknowledgeEscalation(u, p); },

  // Participants (PAR) -- direct createParticipant/updateParticipant routes were removed (dead code,
  // no frontend caller): Places.gs's createPlace/updatePlace fully superseded manual participant
  // creation (auto-provisions the linked Users account too). listParticipants/dedupe/bulk-assign
  // still operate on the same underlying Participants rows Places writes, so nothing else changes.
  listParticipants: function (u, p) { return listParticipants(u, p); },
  bulkAssignParticipantDisciplines: function (u, p) { return bulkAssignParticipantDisciplines(u, p); },
  dedupeParticipants: function (u, p) { return dedupeParticipants(u, p); },

  // Reports (RPT)
  generateReport: function (u, p) { return generateReport(u, p); },
  listReports: function (u, p) { return listReports(u, p); },

  // Notifications
  listNotifications: function (u, p) { return listNotifications(u, p); },
  markNotificationRead: function (u, p) { return markNotificationRead(u, p.notificationId); },
  deleteNotification: function (u, p) { return deleteNotification(u, p.notificationId); },
  clearAllNotifications: function (u) { return clearAllNotifications(u); },
  sendNotification: function (u, p) { return sendNotification(u, p); },

  // Support tickets (in-app technical support -- Support.gs)
  createTicket: function (u, p) { return createTicket(u, p); },
  listTickets: function (u, p) { return listTickets(u, p); },
  getTicketDetail: function (u, p) { return getTicketDetail(u, p); },
  addTicketComment: function (u, p) { return addTicketComment(u, p); },
  resolveTicket: function (u, p) { return resolveTicket(u, p); },
  approveTicketResolution: function (u, p) { return approveTicketResolution(u, p); },
  rejectTicketResolution: function (u, p) { return rejectTicketResolution(u, p); },
  uploadTicketMedia: function (u, p) { return uploadTicketMedia(u, p); },

  // Config (SystemAdmin only)
  listConfig: function (u) { return listConfig(u); },
  setConfig: function (u, p) { return setConfigEntry(u, p); },

  // Dashboard
  dashboardSummary: function (u, p) { return dashboardSummary(u, p); },
  dashboardLiveMapData: function (u, p) { return dashboardLiveMapData(u, p); },
  dashboardVenueAttendance: function (u, p) { return dashboardVenueAttendance(u, p); },
  pingUserLocation: function (u, p) { return pingUserLocation(u, p); }
};
