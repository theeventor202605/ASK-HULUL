# HULUL Deployment Guide

Three parts: (1) the Google Sheet database, (2) the Apps Script backend (Web App), (3) the
static frontend on GitHub Pages. Do them in this order.

## 1. Set up the Google Sheet

1. Go to [Google Drive](https://drive.google.com), click **New → File upload**, and upload
   `HULUL Database.ods` (the file you already have). Right-click it → **Open with → Google
   Sheets** — this converts it to a native Google Sheet. Rename it to `HULUL Database`.
   (If you'd rather start clean, just create a new blank Google Sheet named `HULUL Database` —
   `Setup.gs` in step 2 creates every sheet and header from scratch either way.)
2. Keep this Sheet's tab open; you'll bind the script project to it next.

## 2. Deploy the backend (Apps Script)

1. In the Sheet, go to **Extensions → Apps Script**. This creates a script project bound to
   the Sheet (so `SpreadsheetApp.getActiveSpreadsheet()` in the code always finds it).
2. Delete the default empty `Code.gs`. Create each file listed below (**File → New → Script
   file**, matching names exactly, no `.gs` needed in the dialog) and paste in the matching
   file's contents from this repo's `backend/` folder:
   `Code, Utils, Auth, Setup, Accounts, Events, Templates, VenueApproval, Disciplines,
   Inspections, Findings, Resolutions, Participants, Reports, Notifications`
3. Click the gear icon (**Project Settings**) → check "Show `appsscript.json` manifest file in
   editor" → open it → replace its contents with `backend/appsscript.json` from this repo.
4. In the function dropdown (top toolbar) select `setupHulul`, then click **Run**. The first
   run will prompt you to authorize the script (Sheets, Drive, Mail, and trigger scopes) —
   accept. Check **Execution log** for `HULUL setup complete.` and the seeded admin email.
5. **Deploy → New deployment → type: Web app.**
   - Execute as: **Me**
   - Who has access: **Anyone** (the frontend is a separate origin with no Google login, so
     this must be public; all real access control happens inside the code via the token/RBAC
     system, not via Google's deployment-level access)
6. Copy the resulting `/exec` URL — this is your `API_BASE_URL`.
7. Optional but recommended: install `clasp` (`npm i -g @google/clasp`) locally, `clasp login`,
   `clasp clone <scriptId>` into `backend/`, and commit `.clasp.json` — this keeps the Apps
   Script project and this GitHub repo's `backend/` folder in sync going forward
   (`clasp push` / `clasp pull`).

### CORS — why POST uses `text/plain`

Apps Script Web Apps cannot respond to a custom CORS preflight (`OPTIONS`) request. The
frontend's `js/api.js` works around this by sending `Content-Type: text/plain;charset=utf-8`
(which keeps the browser from triggering a preflight) with a JSON string as the body; `Code.gs`
parses `e.postData.contents` manually regardless of the declared content type. Don't change the
frontend to send `application/json` — that will break cross-origin calls from GitHub Pages.

## 3. Deploy the frontend (GitHub Pages)

1. Edit `frontend/js/config.js` and set `API_BASE_URL` to the `/exec` URL from step 2.6.
2. Create a GitHub repo and push this whole folder:
   ```
   git init
   git add .
   git commit -m "HULUL v1"
   git branch -M main
   git remote add origin https://github.com/<you>/hulul.git
   git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch →
   Branch: main, folder: /frontend** (GitHub Pages supports `/frontend` as the publish
   folder directly — no need to rename it to `/docs`).
4. Your app is live at `https://<you>.github.io/hulul/`. Every push to `main` redeploys it.

## 4. First login

`setupHulul()` seeded one System Admin using the Google account that ran the script, with
temporary password `ChangeMe123!`. Log in, go to **Settings → Change password** immediately,
then use **Users & Roles** to create your first GA Admin / EMC Admin / Inspection Company Admin
accounts (Section 5.1 of the SRS — System Admin creates the three admin tiers; each admin then
creates their own org's users).

## Known gaps / good follow-ups

Last verified against the actual code (not just this doc) on 2026-08-15 — see the note at the
bottom on why that distinction matters here.

- **Arabic coverage**: `UI.statusBadge`/`UI.riskBadge` (`ui.js`) — the single shared renderer every
  status/risk badge in the app goes through (Findings, Templates, Venue Approval, Events,
  Inspections, Support tickets) — used to hardcode English label text internally regardless of the
  active language; now routed through `t()`. Some event-workspace form field labels and a few
  data-driven legend labels (e.g. Place type names) in `eventDetail.js` are still English-only —
  those are shared data vocabulary used identically across several other views (`venues.js`,
  `eventPlaces.js`), so translating them needs a coordinated pass across all of those, not just
  `eventDetail.js` alone, to avoid the same term showing translated in one tab and English in
  another.
- **Live GPS on evidence**: fixed. `findings.js` (New Finding) and `eventDetail.js` (Record
  results, live inspection tracking) now attach the inspector's live GPS fix to `createFinding`/
  `recordInspectionResults` when one's available, instead of only ever falling back to the
  participant's static coordinates.
- **File size**: already handled — `eventDetail.js`'s `uploadEvidenceFile_` hard-caps any single
  evidence file (photo or video) at 15MB client-side with a clear error before upload is attempted,
  well under Apps Script's ~50MB `doPost` ceiling even after base64's ~33% inflation.
- **Escalation cadence**: fixed. The sweep interval (which also gates Place-account deactivation
  and template-deadline checks — they piggyback on the same trigger) is now admin-configurable from
  **Config > Escalations** (`escalationCheckIntervalMinutes_`/`reinstallEscalationTrigger_`,
  `Setup.gs`), defaulting to 5 minutes instead of the old hardcoded 30. Limited to the 5 values
  `ScriptApp.ClockTriggerBuilder.everyMinutes` actually accepts (1/5/10/15/30).
- **Multi-admin System Admin**: not actually a gap — `frontend/js/views/users.js` already offers
  "SystemAdmin" in the role picker when a SystemAdmin creates a new account, matching
  `ACCOUNT_CREATION_MATRIX` (REQ-ACC-01).
- **Reassign Venue screen**: fixed. The Venue Approval tab now shows a "Reassign venue" action once
  a venue's been rejected (`VenueRejected`), opening a Venue/EMC/Inspection Co picker that calls the
  existing `reassignVenue` backend route.
- **Audit log viewer**: fixed. `listAuditLog`/`auditLog.view` (REQ-ACC-10) existed server-side with
  no frontend caller anywhere — added `frontend/js/views/auditLog.js` + nav entry, visible to
  SystemAdmin/GAAdmin/EMCAdmin/InspectionAdmin.
- **Admin reset-password / edit-user UI**: fixed. `resetPassword`/`updateUser` were registered
  backend routes with no frontend caller; **Users & Roles** now has Edit and Reset password actions
  per account.
- **Orphaned Participants create/update code**: removed. `createParticipant`/`updateParticipant`
  (`Participants.gs`) had zero frontend callers — fully superseded by `Places.gs`'s `createPlace`/
  `updatePlace`, which auto-provisions the linked account in the same step. `listParticipants` and
  everything else in that file (dedup, bulk discipline assignment) is untouched and still used.
- **"Live location side map — coming soon"**: fixed. The New Finding form's own live-GPS map
  (`findingLocationMap`) now lets an inspector tap a participant's dot to pick them, via
  `UI.drawPlaceDots`'s existing click-callback support — it just wasn't wired up before.

Note on how this list gets kept honest: a doc like this one is a snapshot, not a live view of the
code — the previous version of this list had drifted (claimed gaps that were already fixed,
missed real gaps like the audit log viewer entirely). Anyone re-verifying this list should grep the
actual call sites (`grep -rn 'auditLog\|resetPassword\|updateUser' frontend/js/`, etc.) rather than
trust this file at face value, this note included.
