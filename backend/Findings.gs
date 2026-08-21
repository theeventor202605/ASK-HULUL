/**
 * HULUL - Findings.gs  (REQ-NCF, Section 3 "Non-Compliance Finding")
 * Findings are usually auto-created from a Crossed checklist item (see Inspections.gs)
 * but can also be logged directly (e.g. ad-hoc observation), and can be updated/re-opened.
 *
 * Status lifecycle (REQ workflow, Risk Logging tab -- each finding is a full page now, not a
 * popup; see findings.js on the frontend):
 *   Open        -- Inspector just raised it.
 *   Viewed      -- the Participant it's against has opened the log (auto, on first view).
 *   Submitted   -- Participant submitted a resolution: remarks + a camera photo/video (see
 *                  resolveFinding). Camera-only is enforced client-side (capture="environment",
 *                  no plain file picker) -- same pattern as the Record Results evidence field.
 *   InReview    -- Inspector/PM/SysAdmin opened a Submitted/Resubmitted log (auto, on view).
 *   Resolved    -- Inspector accepted the resolution (terminal, success).
 *   ReOpen      -- Inspector rejected a resolution attempt (rejection remarks required).
 *                  Participant can resubmit from here. Every rejection lands here, no matter how
 *                  many times a finding has already been rejected -- see reopenCount below (REQ
 *                  follow-up: "keep all rejections going back to re-open", superseding the earlier
 *                  first-rejection-only rule and its second-rejection auto-recreate).
 *   Resubmitted -- Participant resubmitted (another photo + remarks) after a ReOpen.
 * A Log has no terminal "Rejected" state -- every rejected resolution attempt lands back on ReOpen
 * (see reviewFindingResolution) so it can be fixed and resubmitted. The only terminal state is
 * Resolved.
 * reopenCount on the Findings row counts how many times a resolution has been rejected -- now a
 * plain visible counter (Risk Logging list's Rejection count column), not a branch condition.
 */

var FINDING_STATUSES = ['Open', 'Viewed', 'Submitted', 'InReview', 'Resolved', 'ReOpen', 'Resubmitted'];
// "Still outstanding" -- everything except the terminal state (Resolved). Used by the escalation
// engine (Resolutions.gs runEscalationCheck) so a finding stuck mid-workflow (e.g. Viewed but never
// resolved, or ReOpen but never resubmitted) still escalates once its resolutionWindowAt lapses.
var FINDING_OPEN_STATUSES = ['Open', 'Viewed', 'Submitted', 'InReview', 'ReOpen', 'Resubmitted'];
// REQ (Risk Logging list, follow-up): "Actions (Allow edit and delete if not submitted)." Once a
// Participant has submitted a resolution (or beyond), the finding is part of a workflow other people
// are already acting on -- editing/deleting it out from under that would be confusing at best and
// destroy review history at worst. "Not submitted yet" = still Open or Viewed.
var FINDING_EDITABLE_STATUSES_ = ['Open', 'Viewed'];

function findingVisibleTo_(user, finding) {
  // BUG FIX: was a hardcoded VENDOR/OPERATOR/EXHIBITOR check -- a self-served custom Place/
  // Participant type (e.g. "Facilities", Settings > Roles > isParticipantType) fell through to the
  // "sees everything" branch below instead of being scoped to its own Participant record, unlike
  // EventChat.gs/Resolutions.gs which already used isParticipantRoleCode_ for this. Now consistent.
  if (isParticipantRoleCode_(user.role)) {
    // Shared across every account/shift at the same physical spot -- see participantSiblingIds_.
    return participantSiblingIds_(user.id).indexOf(finding.participantId) !== -1;
  }
  return true; // every non-participant role currently sees every finding on events it can already reach
}

// Adds display-only fields the frontend needs but the raw Findings row doesn't carry: the
// participant's and discipline's names (participantId/disciplineId alone mean nothing in the UI),
// and evidenceUrls turned into a real array instead of the raw comma-joined string the sheet stores.
// checklistItemsById (optional) -- REQ: "Any log created through a checklist must be traceable to
// that specific item in the checklist" -- resolves checklistItemId into a readable description.
// usersById (optional) -- REQ follow-up (Risk Logging table column reorder): "Created by" needs the
// user's name, not the raw id audit_/createdBy already carries.
function enrichFinding_(f, participantsById, disciplinesById, checklistItemsById, usersById) {
  var pt = participantsById[f.participantId];
  var d = disciplinesById[f.disciplineId];
  var item = checklistItemsById && f.checklistItemId ? checklistItemsById[f.checklistItemId] : null;
  var creator = usersById && f.createdBy ? usersById[f.createdBy] : null;
  return Object.assign({}, f, {
    participantName: pt ? pt.name : '',
    disciplineName: d ? d.name : '',
    // REQ follow-up: "Category Code as Category" -- the Risk Logging table's Category column shows
    // the Discipline's short code (e.g. "CSM") instead of its full name to stay compact; disciplineName
    // (full name) stays available too for anywhere else that still wants it (e.g. the detail page chip).
    disciplineCode: d ? d.code : '',
    checklistItemDescription: item ? item.description : '',
    createdByName: creator ? creator.name : '',
    evidenceUrls: f.evidenceUrls ? String(f.evidenceUrls).split(',').filter(Boolean) : [],
    // REQ follow-up: "Instead of showing 'OUTSIDE VENUE BOUNDARY' on photos make it a badge also
    // provide distance away from participant in meters." [{url, outsideBoundary, distanceMeters}, ...] --
    // malformed/blank JSON (older findings, before this field existed) safely falls back to [], same
    // "missing metadata -> no badge" rule the frontend already follows everywhere else.
    evidenceMeta: findingEvidenceMeta_(f.evidenceMeta)
  });
}
function findingEvidenceMeta_(raw) {
  if (!raw) return [];
  try { var parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : []; } catch (e) { return []; }
}

function listFindings(user, p) {
  var all = getAll('Findings');
  if (p && p.eventId) all = all.filter(function (f) { return f.eventId === p.eventId; });
  if (p && p.status) all = all.filter(function (f) { return f.status === p.status; });
  if (p && p.disciplineId) all = all.filter(function (f) { return f.disciplineId === p.disciplineId; });
  if (isParticipantRoleCode_(user.role)) { // BUG FIX: see findingVisibleTo_'s comment above
    // Shared across every account/shift at the same physical spot (see participantSiblingIds_ in
    // Participants.gs) -- not just this exact login's own Participant row, so a finding recorded
    // against the morning shift is still visible (and resolvable) to the afternoon shift before its
    // resolution window lapses.
    var myParticipantIds = participantSiblingIds_(user.id);
    all = all.filter(function (f) { return myParticipantIds.indexOf(f.participantId) !== -1; });
  }
  var participantsById = {};
  getAll('Participants').forEach(function (pt) { participantsById[pt.id] = pt; });
  var disciplinesById = {};
  getAll('Disciplines').forEach(function (d) { disciplinesById[d.id] = d; });
  var checklistItemsById = {};
  getAll('ChecklistItems').forEach(function (ci) { checklistItemsById[ci.id] = ci; });
  var usersById = {};
  getAll('Users').forEach(function (u) { usersById[u.id] = u; });
  all = all.map(function (f) { return enrichFinding_(f, participantsById, disciplinesById, checklistItemsById, usersById); });
  return all.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
}

// REQ: "A log can be created on any event from the time it is initiated even if it event did not
// start yet. Logs can not be created only if event ended or Venue Rejected." A brand-new/not-yet-
// started event is deliberately fine (no lower bound at all) -- only the two explicit end states are
// blocked. Shared by both places that ever insert a Findings row: createFinding just below (manual
// Log) and recordInspectionResults (Inspections.gs, the auto-created-from-a-Crossed-checklist-item
// path), so the rule can't be bypassed by going through the other entry point.
function assertEventAcceptsNewLogs_(eventId) {
  var event = getById('Events', eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');
  if (event.status === 'VenueRejected') {
    throw new HululError('BAD_REQUEST', 'This event\'s venue was rejected -- logs can no longer be created against it.');
  }
  if (event.endDateTime && new Date(event.endDateTime) < new Date()) {
    throw new HululError('BAD_REQUEST', 'This event has already ended -- logs can no longer be created against it.');
  }
  return event;
}

// REQ: "Log finding must be tied to a participant. Participant must first be selected... Discipline
// ... is a mandatory field... Remove location and sub-zone." participantId/disciplineId are now
// required inputs (previously optional); subZone/location/lat/lng are no longer collected directly
// from the inspector on the manual Log Finding form at all -- they're derived from the selected
// Participant's own record instead (p.subZone/p.location/p.lat/p.lng are still honored if a future
// caller supplies them explicitly, so this stays backward compatible). Note: the auto-created-from-
// checklist-crossing path (recordInspectionResults, Inspections.gs) builds its own Findings row
// directly via insertRow and does NOT go through createFinding, so it's unaffected by any of this
// (it enforces assertEventAcceptsNewLogs_ itself instead, see that function).
function createFinding(user, p) {
  requirePermission(user, 'finding.create');
  ['eventId', 'description', 'riskLevel', 'participantId', 'disciplineId'].forEach(function (f) { if (!p[f]) throw new HululError('BAD_REQUEST', f + ' is required'); });
  assertEventAcceptsNewLogs_(p.eventId);
  var participant = getById('Participants', p.participantId);
  if (!participant) throw new HululError('NOT_FOUND', 'Participant not found');
  var zone = participant.zoneId ? getById('Zones', participant.zoneId) : null;
  var windowHours = p.resolutionWindowHours || 24;
  var finding = {
    id: newId('Findings'), eventId: p.eventId, inspectionId: p.inspectionId || '', disciplineId: p.disciplineId,
    // REQ: "Checklist Type: should be picked if left blank it will reflect as Other."
    category: p.category || 'Other', subCategory: p.subCategory || '', description: p.description,
    suggestedAction: p.suggestedAction || '', riskLevel: p.riskLevel,
    resolutionWindowAt: new Date(Date.now() + Number(windowHours) * 3600 * 1000).toISOString(),
    nextInspectionAt: p.nextInspectionAt || '', participantId: p.participantId,
    subZone: p.subZone || (zone ? zone.name : ''), location: p.location || participant.location || '',
    status: 'Open', evidenceUrls: (p.evidenceUrls || []).join(','),
    lat: p.lat || participant.lat || '', lng: p.lng || participant.lng || '', createdBy: user.id, createdAt: nowIso_(), reopenCount: 0,
    // Manually-logged findings (this path) have no single checklist item to point at -- only the
    // auto-created-from-a-Crossed-item path (recordInspectionResults, Inspections.gs) sets
    // checklistItemId. p.checklistItemId is still honored if a future caller supplies one explicitly.
    checklistItemId: p.checklistItemId || '', recreatedFromId: '',
    // REQ follow-up: "distance away from participant in meters." Only entries the frontend actually
    // flagged outsideBoundary are ever sent (findings.js) -- so this stays '' on the common case.
    evidenceMeta: (p.evidenceMeta && p.evidenceMeta.length) ? JSON.stringify(p.evidenceMeta) : ''
  };
  insertRow('Findings', finding);
  audit(user.id, 'CREATE_FINDING', 'Findings', finding.id, {});
  notifyFindingCreated_(finding);
  return finding;
}

function updateFinding(user, p) {
  var finding = getById('Findings', p.findingId);
  if (!finding) throw new HululError('NOT_FOUND', 'Finding not found');
  requirePermission(user, 'finding.edit');
  // REQ (Risk Logging list, follow-up): "Allow edit ... if not submitted." A resolution already in
  // flight (or further along) means someone else is already acting on this finding as it stands --
  // see FINDING_EDITABLE_STATUSES_ above.
  if (FINDING_EDITABLE_STATUSES_.indexOf(finding.status) === -1) {
    throw new HululError('FORBIDDEN', 'This finding has already been submitted and can no longer be edited');
  }
  var patch = {};
  // status is deliberately NOT patchable here -- it only moves through the workflow actions below
  // (viewFinding / resolveFinding / reviewFindingResolution), each of which enforces its own
  // valid-from-status + role + evidence/remarks rules that a raw status edit would bypass.
  ['description', 'suggestedAction', 'riskLevel', 'subZone', 'location', 'participantId', 'disciplineId', 'category', 'subCategory'].forEach(function (f) {
    if (p[f] !== undefined) patch[f] = p[f];
  });
  var updated = updateRow('Findings', p.findingId, patch);
  audit(user.id, 'UPDATE_FINDING', 'Findings', p.findingId, patch);
  return updated;
}

// REQ (Risk Logging list, follow-up): "Actions (Allow edit and delete if not submitted)." Same
// not-yet-submitted gate as updateFinding above. Findings that have already moved past Open/Viewed
// have review/resolution history hanging off them (Resolutions rows) -- deleting those out from under
// that history would orphan it, so this simply refuses rather than trying to cascade-delete.
function deleteFinding(user, p) {
  var finding = getById('Findings', p.findingId);
  if (!finding) throw new HululError('NOT_FOUND', 'Finding not found');
  requirePermission(user, 'finding.delete');
  if (FINDING_EDITABLE_STATUSES_.indexOf(finding.status) === -1) {
    throw new HululError('FORBIDDEN', 'This finding has already been submitted and can no longer be deleted');
  }
  deleteRow('Findings', p.findingId);
  audit(user.id, 'DELETE_FINDING', 'Findings', p.findingId, {});
  return { deleted: true };
}

// REQ: "Log findings while photo is uploading in the background." createFinding no longer waits for
// every evidence file to finish uploading before the frontend submits -- it's called immediately with
// whatever's already done, and each remaining file calls this once its own upload finishes (see
// attachFindingEvidenceInBackground_, findings.js) to append itself onto the now-already-created
// Finding. Append-only and de-duped (a retried/duplicate call with the same URL is a harmless no-op)
// -- never replaces the existing list, unlike updateFinding's other patchable fields.
function addFindingEvidence(user, p) {
  var finding = getById('Findings', p.findingId);
  if (!finding) throw new HululError('NOT_FOUND', 'Finding not found');
  requirePermission(user, 'finding.addEvidence');
  if (!p.evidenceUrl) throw new HululError('BAD_REQUEST', 'evidenceUrl is required');
  var urls = finding.evidenceUrls ? String(finding.evidenceUrls).split(',').filter(Boolean) : [];
  if (urls.indexOf(p.evidenceUrl) === -1) urls.push(p.evidenceUrl);
  var patch = { evidenceUrls: urls.join(',') };
  // REQ follow-up: "distance away from participant in meters." Covers evidence that was still
  // uploading at createFinding time and got attached afterward (attachFindingEvidenceInBackground_,
  // findings.js) -- same evidenceMeta array, just appended to rather than set from scratch.
  if (p.evidenceMeta && p.evidenceMeta.outsideBoundary) {
    var meta = findingEvidenceMeta_(finding.evidenceMeta);
    if (!meta.some(function (m) { return m.url === p.evidenceUrl; })) {
      meta.push({ url: p.evidenceUrl, outsideBoundary: true, distanceMeters: (p.evidenceMeta.distanceMeters != null) ? p.evidenceMeta.distanceMeters : null });
      patch.evidenceMeta = JSON.stringify(meta);
    }
  }
  var updated = updateRow('Findings', p.findingId, patch);
  audit(user.id, 'ADD_FINDING_EVIDENCE', 'Findings', p.findingId, {});
  return updated;
}

// REQ: "In logs add ability to delete a photo." The inverse of addFindingEvidence above -- removes
// one URL from the finding's own evidence gallery (and its matching evidenceMeta entry, if any) so a
// wrongly-attached or duplicate photo can be corrected without needing to delete/recreate the whole
// Log. Only detaches the URL from this row; the underlying Drive file itself is left alone (same
// "detach, don't destroy" precedent as deleteAnnexDocument, Annex.gs -- a shared/linked file elsewhere
// shouldn't be silently destroyed). Deliberately its own permission (finding.deleteEvidence) rather
// than reusing finding.edit -- same "add vs. edit vs. delete are each their own admin-configurable
// action" pattern as every other Findings permission, and not gated to FINDING_EDITABLE_STATUSES_
// (same reasoning as addFindingEvidence -- correcting a mistake shouldn't depend on how far the
// workflow has already moved).
// REQ follow-up: "Deleted log photos go to Log Photos Trash." A detach alone now isn't the end of the
// story -- a FindingEvidenceTrash row is written alongside it (see schema comment, Utils.gs) so the
// photo can be restored, same 30-day/restore/empty-now contract the client-side Log Photos tab trash
// already promises (evidence.js) -- see listFindingEvidenceTrash/restoreFindingEvidence/
// emptyFindingEvidenceTrash below for the other half of that lifecycle.
function deleteFindingEvidence(user, p) {
  var finding = getById('Findings', p && p.findingId);
  if (!finding) throw new HululError('NOT_FOUND', 'Finding not found');
  requirePermission(user, 'finding.deleteEvidence');
  if (!p.url) throw new HululError('BAD_REQUEST', 'url is required');
  var urls = finding.evidenceUrls ? String(finding.evidenceUrls).split(',').filter(Boolean) : [];
  var idx = urls.indexOf(p.url);
  if (idx === -1) throw new HululError('NOT_FOUND', 'That photo is not attached to this log');
  urls.splice(idx, 1);
  var patch = { evidenceUrls: urls.join(',') };
  var meta = findingEvidenceMeta_(finding.evidenceMeta);
  var ownMeta = meta.filter(function (m) { return m.url === p.url; })[0] || null;
  if (meta.length) patch.evidenceMeta = JSON.stringify(meta.filter(function (m) { return m.url !== p.url; }));
  var updated = updateRow('Findings', p.findingId, patch);
  insertRow('FindingEvidenceTrash', {
    id: newId('FindingEvidenceTrash'), findingId: p.findingId, eventId: finding.eventId, url: p.url,
    evidenceMetaJson: ownMeta ? JSON.stringify(ownMeta) : '', deletedBy: user.id, deletedAt: new Date().toISOString(),
    status: 'Trashed', restoredBy: '', restoredAt: ''
  });
  audit(user.id, 'DELETE_FINDING_EVIDENCE', 'Findings', p.findingId, { url: p.url });
  return updated;
}

// 30 days, matching the client-only Log Photos tab trash (LOG_PHOTO_TRASH_RETENTION_MS_, evidence.js)
// -- same retention window for both halves of "Log Photos Trash" even though they're two separate
// stores (IndexedDB for not-yet-a-Log captures, this sheet for already-attached Finding evidence).
var FINDING_EVIDENCE_TRASH_RETENTION_DAYS_ = 30;

// Swept on every list call (no background trigger needed for this) -- same "sweep on load" pattern
// the client-side trash already uses (purgeExpiredLogPhotos, called from tabLogPhotos). Purges only
// -- never touches the underlying Drive file (same "detach, don't destroy" rule as everywhere else in
// this app that "deletes" an already-uploaded file).
function purgeExpiredFindingEvidenceTrash_() {
  var cutoff = Date.now() - FINDING_EVIDENCE_TRASH_RETENTION_DAYS_ * 24 * 60 * 60 * 1000;
  findWhere('FindingEvidenceTrash', function (r) {
    return r.status === 'Trashed' && r.deletedAt && new Date(r.deletedAt).getTime() <= cutoff;
  }).forEach(function (r) { deleteRow('FindingEvidenceTrash', r.id); });
}

// eventId (required): scopes the trash view to one event, same "one event's Log Photos tab" scope the
// client-side trash already has -- an inspector shouldn't see every other event's deleted photos here.
function listFindingEvidenceTrash(user, p) {
  requirePermission(user, 'finding.deleteEvidence');
  if (!p || !p.eventId) throw new HululError('BAD_REQUEST', 'eventId is required');
  purgeExpiredFindingEvidenceTrash_();
  return findWhere('FindingEvidenceTrash', function (r) { return r.eventId === p.eventId && r.status === 'Trashed'; })
    .sort(function (a, b) { return new Date(b.deletedAt) - new Date(a.deletedAt); });
}

// REQ: "Photos deleted go to trash and can be restored." Re-appends the URL onto the parent Finding's
// evidenceUrls (a no-op if it's somehow already there again) and restores its evidenceMeta entry, then
// marks the trash row Restored (kept, not deleted -- same "history stays visible" reasoning
// AnnexDocuments rows already follow) so it drops out of listFindingEvidenceTrash's 'Trashed' filter.
function restoreFindingEvidence(user, p) {
  requirePermission(user, 'finding.deleteEvidence');
  var trashRow = getById('FindingEvidenceTrash', p && p.trashId);
  if (!trashRow || trashRow.status !== 'Trashed') throw new HululError('NOT_FOUND', 'Trashed photo not found');
  var finding = getById('Findings', trashRow.findingId);
  if (!finding) throw new HululError('NOT_FOUND', 'The log this photo belonged to no longer exists');
  var urls = finding.evidenceUrls ? String(finding.evidenceUrls).split(',').filter(Boolean) : [];
  if (urls.indexOf(trashRow.url) === -1) urls.push(trashRow.url);
  var patch = { evidenceUrls: urls.join(',') };
  if (trashRow.evidenceMetaJson) {
    var restoredMeta = JSON.parse(trashRow.evidenceMetaJson);
    var meta = findingEvidenceMeta_(finding.evidenceMeta);
    if (!meta.some(function (m) { return m.url === trashRow.url; })) {
      meta.push(restoredMeta);
      patch.evidenceMeta = JSON.stringify(meta);
    }
  }
  updateRow('Findings', trashRow.findingId, patch);
  updateRow('FindingEvidenceTrash', trashRow.id, { status: 'Restored', restoredBy: user.id, restoredAt: new Date().toISOString() });
  audit(user.id, 'RESTORE_FINDING_EVIDENCE', 'Findings', trashRow.findingId, { url: trashRow.url });
  return { restored: true };
}

// REQ: "Trash has an empty now button." Permanently removes every currently-Trashed row for one
// event -- same scope as listFindingEvidenceTrash, same "detach, don't destroy the Drive file" rule.
function emptyFindingEvidenceTrash(user, p) {
  requirePermission(user, 'finding.deleteEvidence');
  if (!p || !p.eventId) throw new HululError('BAD_REQUEST', 'eventId is required');
  var rows = findWhere('FindingEvidenceTrash', function (r) { return r.eventId === p.eventId && r.status === 'Trashed'; });
  rows.forEach(function (r) { deleteRow('FindingEvidenceTrash', r.id); });
  audit(user.id, 'EMPTY_FINDING_EVIDENCE_TRASH', 'Findings', p.eventId, { count: rows.length });
  return { emptied: rows.length };
}

// Fetches one finding for its detail page, auto-advancing status on view exactly at the two points
// the process flow calls for:
//  - a Participant's first open of an Open finding -> Viewed
//  - an Inspector/PM/SysAdmin's first open of a Submitted/Resubmitted finding -> InReview
// Any other view (re-opening something already Viewed/InReview/Resolved/etc, or an Inspector just
// browsing an Open finding nothing's been submitted for yet) leaves status untouched. Also returns
// the finding's resolution history (newest first) so the detail page can show every past attempt.
function viewFinding(user, p) {
  if (!p || !p.findingId) throw new HululError('BAD_REQUEST', 'findingId is required');
  var finding = getById('Findings', p.findingId);
  if (!finding) throw new HululError('NOT_FOUND', 'Finding not found');
  if (!findingVisibleTo_(user, finding)) throw new HululError('FORBIDDEN', 'Not your finding');

  // BUG FIX (reported: "Inspector has been given finding.resolve permission, but still doesn't get
  // the option to resolve a log"): this used to be isParticipantRoleCode_(user.role) -- a hardcoded
  // check for the 3 built-in Participant-type roles, deaf to Settings > Permissions overrides. The
  // frontend's action-section gate (renderFindingDetail, findings.js) was already migrated to the
  // real finding.resolve permission a while back, but this status-transition trigger (the thing that
  // actually flips Open -> Viewed on first open, which the frontend gate also requires) never was --
  // so granting finding.resolve to a non-Participant role like Inspector let them see the Resolve
  // button's *permission* check pass, but the finding stayed stuck on Open forever because nothing
  // ever advanced it to Viewed for that role. hasPermissionRole_ respects the same overrides
  // Settings > Permissions writes, so any role granted finding.resolve now gets both halves.
  var isParticipant = hasPermissionRole_(user, 'finding.resolve');
  var isReviewer = hasPermissionRole_(user, 'finding.review');
  // REQ follow-up: "Info when opened jumps to resolved." An Info-level Risk Log carries no real
  // compliance action to take (same reasoning as its escalation exemption -- runEscalationCheck,
  // Resolutions.gs), so unlike every other risk level it skips the whole submit/review workflow
  // entirely: the very first open by ANYONE with view access (participant or reviewer alike, hence
  // checked before the isParticipant/isReviewer branches below) closes it straight to Resolved -- no
  // Viewed/Submitted/InReview stop along the way, no resolution evidence required.
  if (finding.status === 'Open' && finding.riskLevel === 'Info') {
    finding = updateRow('Findings', p.findingId, { status: 'Resolved' });
    audit(user.id, 'AUTO_RESOLVE_INFO_FINDING', 'Findings', p.findingId, { status: 'Resolved' });
    findWhere('Escalations', function (e) { return e.findingId === p.findingId && !e.resolvedAt; })
      .forEach(function (e) { updateRow('Escalations', e.id, { resolvedAt: nowIso_() }); });
    notifyFindingStatusChange_(finding, 'Resolved');
  } else if (isParticipant && finding.status === 'Open') {
    finding = updateRow('Findings', p.findingId, { status: 'Viewed' });
    audit(user.id, 'VIEW_FINDING', 'Findings', p.findingId, { status: 'Viewed' });
  } else if (isReviewer && (finding.status === 'Submitted' || finding.status === 'Resubmitted')) {
    finding = updateRow('Findings', p.findingId, { status: 'InReview' });
    audit(user.id, 'VIEW_FINDING', 'Findings', p.findingId, { status: 'InReview' });
  }

  var participantsById = {};
  getAll('Participants').forEach(function (pt) { participantsById[pt.id] = pt; });
  var disciplinesById = {};
  getAll('Disciplines').forEach(function (d) { disciplinesById[d.id] = d; });
  var resolutions = findWhere('Resolutions', function (r) { return r.findingId === p.findingId; })
    .map(function (r) { return Object.assign({}, r, { evidenceUrls: r.evidenceUrls ? String(r.evidenceUrls).split(',').filter(Boolean) : [] }); })
    .sort(function (a, b) { return new Date(b.submittedAt) - new Date(a.submittedAt); });

  var checklistItemsById = {};
  getAll('ChecklistItems').forEach(function (ci) { checklistItemsById[ci.id] = ci; });
  var enriched = enrichFinding_(finding, participantsById, disciplinesById, checklistItemsById);

  // REQ: "A second rejection lands on Rejected ... but automatically creates a new instance from the
  // rejected log and lands it in Open." Surface BOTH directions of that link on the detail page: the
  // original (this finding, if it has one) it was recreated from, and -- the reverse, only knowable
  // by searching -- the newer finding it was recreated INTO, if this one is the rejected original.
  // A single reverse lookup on one finding's detail view is cheap; deliberately not done in bulk
  // listFindings (would be an O(n) scan per row there).
  if (finding.recreatedFromId) {
    var original = getById('Findings', finding.recreatedFromId);
    if (original) enriched.recreatedFrom = { id: original.id, description: original.description, status: original.status };
  }
  var recreatedInto = findWhere('Findings', function (f) { return f.recreatedFromId === finding.id; })
    .sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); })[0];
  if (recreatedInto) enriched.recreatedInto = { id: recreatedInto.id, description: recreatedInto.description, status: recreatedInto.status };

  return { finding: enriched, resolutions: resolutions };
}

// REQ workflow steps 3/7: Participant submits a resolution -- free-text remarks + at least one
// camera-captured photo/video (evidence requirement enforced here as well as client-side, same
// pattern as recordInspectionResults). Only valid from Viewed (first attempt) or ReOpen (retry after
// a first rejection) -- Open (not viewed yet), Submitted/InReview/Resubmitted (already has a pending
// resolution), and Resolved (terminal) can't be resolved from here.
function resolveFinding(user, p) {
  requirePermission(user, 'finding.resolve');
  if (!p || !p.findingId) throw new HululError('BAD_REQUEST', 'findingId is required');
  var finding = getById('Findings', p.findingId);
  if (!finding) throw new HululError('NOT_FOUND', 'Finding not found');
  if (!findingVisibleTo_(user, finding)) throw new HululError('FORBIDDEN', 'Not your finding');
  if (['Viewed', 'ReOpen'].indexOf(finding.status) === -1) {
    throw new HululError('BAD_REQUEST', 'This finding cannot be resolved from its current status (' + finding.status + ')');
  }
  if (!p.remarks) throw new HululError('BAD_REQUEST', 'Remarks are required');
  if (!p.evidenceUrls || !p.evidenceUrls.length) throw new HululError('BAD_REQUEST', 'A photo or video of the resolution is required');

  var resolution = {
    id: newId('Resolutions'), findingId: p.findingId, participantId: finding.participantId,
    evidenceUrls: p.evidenceUrls.join(','), remarks: p.remarks, submittedAt: nowIso_(),
    reviewedBy: '', decision: 'Pending', comments: '', reviewedAt: ''
  };
  insertRow('Resolutions', resolution);
  var newStatus = finding.status === 'ReOpen' ? 'Resubmitted' : 'Submitted';
  updateRow('Findings', p.findingId, { status: newStatus });
  audit(user.id, 'RESOLVE_FINDING', 'Findings', p.findingId, { status: newStatus });
  notifyFindingStatusChange_(getById('Findings', p.findingId), newStatus);
  return { finding: getById('Findings', p.findingId), resolution: resolution };
}

// REQ ("Opening checklists are done against the venue not participants, but they can assign
// operational participants to resolve the raised log"): a checklist-raised log from an Opening-phase
// inspection starts with participantId blank (see recordInspectionResults, Inspections.gs) -- this is
// the separate step an Inspector or PM uses to pick who's actually responsible for fixing it, any
// time from the Log's own detail page (not required at Crossed-time). Also works to REASSIGN an
// already-assigned finding (e.g. the wrong operator was picked), and to clear it back to blank
// (p.participantId === ''). Restricted to "Operator" type participants at the finding's own venue --
// same eligibility the person confirmed when this feature was scoped.
function assignFindingParticipant(user, p) {
  requirePermission(user, 'finding.assignParticipant');
  if (!p || !p.findingId) throw new HululError('BAD_REQUEST', 'findingId is required');
  var finding = getById('Findings', p.findingId);
  if (!finding) throw new HululError('NOT_FOUND', 'Finding not found');
  if (!findingVisibleTo_(user, finding)) throw new HululError('FORBIDDEN', 'Not your finding');
  if (finding.status === 'Resolved') {
    throw new HululError('BAD_REQUEST', 'This finding is already closed -- its assigned participant can no longer be changed.');
  }
  var participantId = p.participantId || '';
  if (participantId) {
    var participant = getById('Participants', participantId);
    var event = getById('Events', finding.eventId);
    var venueId = event ? event.venueId : '';
    if (!participant || participant.type !== 'Operator' || !venueId || participant.venueId !== venueId) {
      throw new HululError('BAD_REQUEST', 'participantId must be an Operator at this finding\'s venue');
    }
  }
  updateRow('Findings', p.findingId, { participantId: participantId });
  audit(user.id, 'ASSIGN_FINDING_PARTICIPANT', 'Findings', p.findingId, { participantId: participantId });
  return { finding: getById('Findings', p.findingId) };
}

// REQ workflow steps 5/6/8: Inspector/PM/SysAdmin accepts or rejects the latest pending resolution.
// Only valid from InReview. Accept -> Resolved (terminal). Reject requires rejection remarks and
// always -> ReOpen (participant can retry again), no matter how many times a finding has already
// been rejected -- a Log has no terminal "Rejected" outcome, only Resolved or ReOpen (REQ follow-up:
// "keep all rejections going back to re-open"). reopenCount on the Findings row still increments on
// every rejection purely as a visible counter (Risk Logging list's own Rejection count column) -- it
// no longer changes which status a rejection lands on.
function reviewFindingResolution(user, p) {
  requirePermission(user, 'finding.review');
  if (!p || !p.findingId) throw new HululError('BAD_REQUEST', 'findingId is required');
  var finding = getById('Findings', p.findingId);
  if (!finding) throw new HululError('NOT_FOUND', 'Finding not found');
  if (finding.status !== 'InReview') throw new HululError('BAD_REQUEST', 'This finding is not awaiting review');
  if (['Approved', 'Rejected'].indexOf(p.decision) === -1) throw new HululError('BAD_REQUEST', 'decision must be Approved or Rejected');
  if (p.decision === 'Rejected' && !p.comments) throw new HululError('BAD_REQUEST', 'Rejection remarks are required');

  var pending = findWhere('Resolutions', function (r) { return r.findingId === p.findingId && r.decision === 'Pending'; })
    .sort(function (a, b) { return new Date(b.submittedAt) - new Date(a.submittedAt); })[0];
  if (!pending) throw new HululError('BAD_REQUEST', 'No pending resolution to review');

  updateRow('Resolutions', pending.id, { decision: p.decision, reviewedBy: user.id, comments: p.comments || '', reviewedAt: nowIso_() });

  var reopenCount = Number(finding.reopenCount) || 0;
  var newStatus;
  if (p.decision === 'Approved') {
    newStatus = 'Resolved';
  } else {
    newStatus = 'ReOpen';
    reopenCount++;
  }
  updateRow('Findings', p.findingId, { status: newStatus, reopenCount: reopenCount });

  if (newStatus === 'Resolved') {
    // Clear any open escalation recipients tracking (resolvedAt on escalations) -- terminal outcome
    // means this finding row is done escalating.
    findWhere('Escalations', function (e) { return e.findingId === p.findingId && !e.resolvedAt; })
      .forEach(function (e) { updateRow('Escalations', e.id, { resolvedAt: nowIso_() }); });
  }

  audit(user.id, 'REVIEW_FINDING_RESOLUTION', 'Findings', p.findingId, { decision: p.decision, status: newStatus });
  var updated = getById('Findings', p.findingId);
  notifyFindingStatusChange_(updated, newStatus);
  return { finding: updated, resolution: getById('Resolutions', pending.id), recreatedFinding: null };
}

// Groups findings into the 4 summary buckets the Dashboard/Overview KPI cards already have icons for
// (kpi_open/kpi_inreview/kpi_resolved/kpi_reopen) -- Viewed rolls into "open" (still nobody's
// submitted a resolution) and Submitted/Resubmitted roll into "in review" (something's pending
// someone's action), so the fuller 7-status workflow doesn't need 3 more KPI cards to stay accurate.
// Used by Events.gs getEventDetail and Reports.gs dashboardSummary.
function findingKpiBuckets_(findings) {
  var count = function (statuses) { return findings.filter(function (f) { return statuses.indexOf(f.status) !== -1; }).length; };
  return {
    total: findings.length,
    open: count(['Open', 'Viewed']),
    inReview: count(['InReview', 'Submitted', 'Resubmitted']),
    resolved: count(['Resolved']),
    reopen: count(['ReOpen'])
  };
}
