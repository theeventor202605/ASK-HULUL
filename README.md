# HULUL — Event Readiness & Compliance Platform

Implementation of the HULUL SRS (v1.0): Google Sheets as the database, Google Apps Script as
the JSON API backend, and a static HTML/CSS/JS frontend deployed on GitHub Pages.

## How the pieces fit together

```
GitHub Pages (frontend/)  --HTTPS fetch-->  Apps Script Web App (backend/)  <-->  Google Sheet (DB)
     static HTML/CSS/JS                     Code.gs router + modules              "HULUL Database"
```

Apps Script cannot run on GitHub — it only executes on Google's servers, bound to your Sheet.
So the split is: **backend/** is a Google Apps Script project (deployed as a Web App and also
mirrored to this repo via `clasp` for version control), and **frontend/** is a plain static site
you can serve from GitHub Pages, Netlify, or anywhere — it talks to the Web App over HTTPS as a
JSON API.

## Contents

- `backend/` — Apps Script project (`Code.gs` router, one file per SRS module, `Setup.gs`).
- `frontend/` — static site: `index.html`, `css/`, `js/` (vanilla JS, no build step, Tailwind
  via CDN, Chart.js via CDN).
- `docs/DATA_MODEL.md` — full sheet/column reference.
- `docs/DEPLOYMENT.md` — step-by-step setup (Apps Script + GitHub Pages + CORS notes).

## Quick start

1. Follow `docs/DEPLOYMENT.md` to create the Apps Script project bound to `HULUL Database`,
   run `setupHulul()` once, and deploy it as a Web App.
2. Paste the deployment's `/exec` URL into `frontend/js/config.js` (`API_BASE_URL`).
3. Push this repo to GitHub and enable GitHub Pages on the `frontend/` folder (or `/docs` if
   you prefer — see DEPLOYMENT.md for both options).
4. Log in with the seeded System Admin (its email = your Google account email at setup time,
   temporary password `ChangeMe123!` — change it immediately from Settings).

## Scope covered vs. SRS

All 10 functional modules (ACC, EVT, TPL, VAP, DIS, INS, NCF, RES, PAR, RPT) are implemented,
including RBAC, audit logging, tiered escalation (via a 30-minute time-driven trigger), evidence
uploads to Drive, and email notifications.

Venues are no longer connected to an EMC organization at all (see `docs/DATA_MODEL.md`'s Notes) —
a Venue is a shared catalog entry any EMCAdmin/EMCManager/SystemAdmin can manage, and which EMC
rents it is chosen independently, per Event, on the Create/Edit Event form (a required "Renting
EMC" field), not defaulted from the Venue.

Two things are intentionally partial and flagged for a follow-up pass — see "Known gaps" in
`docs/DEPLOYMENT.md`: full Arabic translation of every field label (chrome/navigation is bilingual
now, per-view field labels are English-first), and live GPS capture on evidence upload (the API
accepts `lat`/`lng`, but the frontend doesn't yet call `navigator.geolocation` — a small addition,
noted in the doc).
"# ASK-HULUL" 
