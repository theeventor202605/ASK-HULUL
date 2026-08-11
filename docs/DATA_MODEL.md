# HULUL Data Model (Google Sheets)

Extends `HULUL Database.ods` with auth, session, history, and config sheets needed to implement the full SRS. Every sheet's first row is the header row; `Setup.gs` creates/repairs these automatically.

| Sheet | Columns |
|---|---|
| Organizations | id, type, name, status, createdAt |
| Users | id, name, email, orgType, orgId, role, status, passwordHash, passwordSalt, createdBy, createdAt, lastLoginAt |
| Sessions | token, userId, createdAt, expiresAt |
| Venues | id, name, address, city, emcId (operating/default EMC — see Notes), createdAt |
| Zones | id, venueId, name, createdAt |
| Events | id, name, code, project, venueId, address, city, startDateTime, endDateTime, emcId (renting EMC for this event — see Notes), inspectionCoId, eventManagerId, status, createdBy, createdAt |
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
| Notifications | id, userId, type, message, relatedType, relatedId, isRead, createdAt |
| AuditLog | id, actor, action, targetType, targetId, timestamp, details |
| Config | key, value |

## Roles (Section 2.2 / 5.1)
`SystemAdmin, GAAdmin, GAUser, EMCAdmin, EventManager, EMCManager, EMCAnalyst, InspectionAdmin, ProjectManager, InspectionAnalyst, Inspector, Vendor, Operator, Exhibitor`

## Notes
- EMC / Venue / Event relationship: an EMC *operates* one or more Venues, but that's an
  administrative default, not an exclusive lock — `Venues.emcId` just says who maintains that
  venue's zones/boundary/etc. A Venue is *rented* to exactly one EMC per Event, recorded
  independently on `Events.emcId` (defaults to the venue's operating EMC when GA doesn't pick a
  different one at creation, but can be set/changed to any EMC — e.g. EMC-B renting a venue
  EMC-A normally operates). Every EMC-scoped permission/visibility check in the backend keys off
  `Events.emcId`, not `Venues.emcId`, so this is the field that actually governs who can act on a
  given event.
- Passwords: salted SHA-256 via `Utilities.computeDigest`, unique salt per user. Never stored in plaintext.
- `status` on Findings: `Open, InReview, Resolved, ReOpen, Rejected` (matches the reference UI's Logs Overview cards).
- Escalation tiers and delay hours are configurable in the `Config` sheet (`escalationTier2DelayHours`, `escalationTier3DelayHours`), defaulting to values set in `Setup.gs`.
