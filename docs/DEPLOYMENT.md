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

- **Arabic coverage**: navigation chrome and common labels are bilingual (`js/i18n.js`); the
  event-workspace view field labels (form inputs inside each tab) are still English-only.
  Extend `HULUL_I18N` and swap the hardcoded strings in `frontend/js/views/eventDetail.js`.
- **Live GPS on evidence**: the API already accepts `lat`/`lng` on findings/results; wire
  `navigator.geolocation.getCurrentPosition` into the "Record results" and "Log finding"
  modals in `eventDetail.js` to auto-fill them on mobile.
- **File size**: Apps Script's `doPost` has a ~50MB payload ceiling; base64-encoding inflates
  file size ~33%, so keep individual evidence uploads well under 30MB, or switch to Drive's
  resumable upload API for large video evidence.
- **Escalation cadence**: the time-driven trigger runs every 30 minutes (`Setup.gs`), which is
  the resolution of tier timing, not true real-time — tighten via `ScriptApp` trigger frequency
  if your GA's SLA needs finer granularity (Apps Script's minimum is 1 minute).
- **Multi-admin System Admin**: `ACCOUNT_CREATION_MATRIX` already allows SystemAdmin to create
  more SystemAdmins (REQ-ACC-01); do this from **Users & Roles** once logged in as the seeded
  admin.
- **EMC picker on Event forms**: a Venue is operated by one default EMC, but can be *rented* to
  any EMC per Event (see `docs/DATA_MODEL.md` Notes). `createEvent`/`updateEvent`/`reassignVenue`
  already accept an explicit `emcId` and validate it against Organizations, but
  `frontend/js/views/events.js` and the Reassign Venue flow don't yet render an EMC dropdown —
  they still rely on the default (the venue's own operating EMC). Add the picker (populate from
  `listOrganizations` filtered to `type === 'EMC'`) to actually let GA rent a venue out to a
  different EMC from the UI.
