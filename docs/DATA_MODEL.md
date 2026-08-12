# HULUL Data Model (Google Sheets)

Extends `HULUL Database.ods` with auth, session, history, and config sheets needed to implement the full SRS. Every sheet's first row is the header row; `Setup.gs` creates/repairs these automatically.

| Sheet | Columns |
|---|---|
| Organizations | id, type, name, status, createdAt |
| Users | id, name, email, orgType, orgId, role, status, passwordHash, passwordSalt, createdBy, createdAt, lastLoginAt |
| Sessions | token, userId, createdAt, expiresAt |
| Venues | id, name, address, city, emcId (legacy, unused — see Notes), createdAt, lat, lng, status, boundary, color |
| Zones | id, venueId, name, createdAt, status, boundary, color |
| Events | id, name, code, project, venueId, address, city, startDateTime, endDateTime, emcId (renting EMC for this event, required — see Notes), inspectionCoId, eventManagerId, status, createdBy, createdAt |
| SubEvents | id, eventId, name, startDateTime, endDateTime |
| VenueEvaluations | id, eventId, venueId, inspectionCoId, recommendation, recommendationBy, recommendationAt, decision, decisionBy, decisionAt, status |
| Templates | id, eventId, type, status, fileUrl, fileName, uploadedBy, updatedAt |
| Meetings | id, eventId, type, scheduledAt, notes, createdBy, createdAt |
| Disciplines | id, name, code |
| EventDisciplines | id, eventId, disciplineId, venueId, identifiedBy, createdAt |
| InspectorQualifications | id, userId, disciplineId |
| InspectorAssignments | id, eventId, disciplineId, inspectorId, assignedBy, assignedAt |
| ChecklistItems | id, checklistType, category, description, defaultRisk, defaultWindowHours, phase |
| Inspections | id, eventId, disciplineId, inspectorId, checklistType, scheduledAt, phase, status |
| InspectionResults | id, inspectionId, checklistItemId, state, riskLevel, resolutionWindowHours, notes, recordedAt |
| Findings | id, eventId, inspectionId, disciplineId, category, subCategory, description, suggestedAction, riskLevel, resolutionWindowAt, nextInspectionAt, participantId, subZone, location, status, evidenceUrls, lat, lng, createdBy, createdAt |
| Escalations | id, findingId, tier, triggeredAt, recipientUserId, resolvedAt |
| Resolutions | id, findingId, participantId, evidenceUrls, remarks, submittedAt, reviewedBy, decision, comments, reviewedAt |
| Participants | id, eventId, type, name, zoneId, location, contactEmail, userId, createdAt |
| Reports | id, eventId, type, generatedAt, generatedBy, summaryJson |
| Notifications | id, userId, type, message, relatedType, relatedId, isRead, createdAt, eventId |
| AuditLog | id, actor, action, targetType, targetId, timestamp, details |
| Config | key, value |
| SupportTickets | id, createdBy, subject, remarks, pageContext, screenshotUrl, voiceNoteUrl, status, assignedTo, reopenCount, createdAt, updatedAt, resolvedAt, completedAt |
| SupportTicketComments | id, ticketId, authorId, message, voiceNoteUrl, recordingUrl, recordingMimeType, createdAt |

## Roles (Section 2.2 / 5.1)
`SystemAdmin, GAAdmin, GAUser, EMCAdmin, EventManager, EMCManager, EMCAnalyst, InspectionAdmin, ProjectManager, InspectionAnalyst, Inspector, Vendor, Operator, Exhibitor, SupportAgent`

## Notes
- EMC / Venue / Event relationship (decoupled): a Venue is a shared catalog entry, not owned by or
  connected to any one EMC organization — any SystemAdmin/EMCAdmin/EMCManager can create, edit, or
  delete any Venue, and every authenticated user can see the full Venue list (`listVenues` has no
  org-scoped filtering). `Venues.emcId` is a legacy column left in the sheet only so existing
  physical rows don't shift columns (see Utils.gs SCHEMA); the app never reads or writes it. A
  Venue is *rented* to exactly one EMC per Event, recorded on `Events.emcId` — GA picks the Venue
  and the renting EMC as two independent, required fields when creating the Event (no default to
  fall back to, since the Venue no longer implies one). Every EMC-scoped permission/visibility
  check in the backend keys off `Events.emcId` (including Event Places' `assertCanManagePlace_` in
  Places.gs), so this is the field that actually governs who can act on a given event.
- Passwords: salted SHA-256 via `Utilities.computeDigest`, unique salt per user. Never stored in plaintext.
- `status` on Findings: `Open, InReview, Resolved, ReOpen, Rejected` (matches the reference UI's Logs Overview cards).
- Escalation tiers and delay hours are configurable in the `Config` sheet (`escalationTier2DelayHours`, `escalationTier3DelayHours`), defaulting to values set in `Setup.gs`.
- `Venues.color` / `Zones.color`: a hex string (e.g. `#4f46e5`) the creator/editor picks for how
  that Venue's or Zone's drawn boundary renders on every map that shows it (New/Edit Venue's own
  map, the Add-a-Place map, the Add/Edit zone map, and the Event > Venue & Zones "Places map").
  Blank (existing rows predating this feature) falls back to a shared default indigo for Venues, or
  `ZONE_BOUNDARY_COLORS_`'s auto-cycled palette per zone for Zones (both in `eventDetail.js`).
- Support tickets (`backend/Support.gs`, `frontend/js/views/support.js`): in-app technical support, raised by any user from anywhere in the app via the topbar Support button — captures a DOM screenshot (html2canvas, no OS permission prompt) with an optional highlight box drawn on it, plus a remark and an optional short (~90s) voice note. Platform-level, not scoped to an Event or Organization. Lifecycle: `Open` (raised) → `InProgress` (auto-set the first time SupportAgent/SystemAdmin opens it, or after any back-and-forth) → `Resolved` (Support marks it fixed, remarks required, raiser notified to review) → `Completed` (raiser approves, terminal) — a raiser rejecting a `Resolved` ticket sends it back to `InProgress` with further comments/voice note (`reopenCount` tracks how many times, no hard cap, mirrors `Findings.reopenCount`'s convention). Both SupportAgent and SystemAdmin can work the shared queue; SupportAgent accounts are created the same way as any other SystemAdmin-created role (`ACCOUNT_CREATION_MATRIX`, Auth.gs). Screen+voice walkthrough recordings (`getDisplayMedia` + mic, same ~90s cap) are Support/SystemAdmin-only, enforced both in the UI and server-side (`addTicketComment` rejects `recordingUrl` from anyone else).
