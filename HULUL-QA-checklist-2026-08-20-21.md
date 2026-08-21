# HULUL QA Checklist — updates from Aug 20–21, 2026

Everything below was shipped in the last two days (commits from Aug 20, 09:44 through Aug 21, 08:10). Grouped by area — work through each section on the live site, tick items off as you confirm them, and flag anything that doesn't match the expected behavior.

Site: https://theeventor202605.github.io/ASK-HULUL/

---

## 1. Risk Logging (Logs) — layout & evidence

- [ ] "+ Log" button sits fixed/floating at the top of the Risk Logging list (no longer scrolls out of view).
- [ ] New Log page title reads "New Log" (not "New Finding").
- [ ] New Log form: "Suggested description" searchable dropdown sits **above** the Description field.
- [ ] New Log form: a "Log Location" text field appears below Description.
- [ ] New Log form: after picking a photo, a thumbnail preview shows immediately, before submitting.
- [ ] Clicking any evidence thumbnail opens a full-size lightbox; if a Log has multiple photos, Prev/Next arrows (and arrow keys) step through all of them.
- [ ] Risk Logging table Image column shows a small badge with the photo count when a Log has more than one photo.
- [ ] Risk Logging table columns read in this order: Do, Image, Category Code as Category, Suggestion, Log Location, Date/time, Created by.
- [ ] Risk Logging table "Created by" shows the person's name, not a raw user ID.
- [ ] A photo taken outside the venue boundary shows an "Outside boundary" **badge** on the thumbnail (not plain red text), including distance in meters from the assigned participant.
- [ ] On an open Log's detail page, each evidence photo has a small trash-can button; clicking it asks for confirmation and moves the photo to **Log Photos Trash** (not the finding's status).
- [ ] Log Photos tab (per event): Trash section now shows two groups when both exist — "Not yet logged" (captured but not yet turned into a Log) and "Deleted from Logs" (removed off an existing Log). Restore and "Empty now" work on both.
- [ ] Every camera-capture button (Record Results, Log Photos tab, New Log, Resolve Log) still only opens the device camera by default — no gallery/file picker unless your role has been explicitly granted the new "upload from device" permission in Settings > Permissions.

## 2. Risk Logging — workflow

- [ ] A rejected resolution always lands the Log back on **ReOpen** — there is no more terminal "Rejected" status anywhere (board columns, filters, KPIs).
- [ ] The Pipeline/board view groups the long list into manageable sub-sections instead of one continuous scroll.
- [ ] On the Pipeline board, **Resolved** cards sit at the very end of the list, not mixed in with active ones.
- [ ] If your role has been granted `finding.resolve` (e.g. a custom Inspector variant) but isn't one of the original Vendor/Operator/Exhibitor roles, you can still open and resolve a Log assigned to you — it correctly advances from Open → Viewed.
- [ ] Clicking any row in a Log/Finding-related table opens that row's detail view (not just tables that already had a View button).
- [ ] Clicking a column header on any table shows a filter control for that column — check this on at least 2–3 different tables app-wide, not just Risk Logging.
- [ ] Long lists keep their action bar (Save/Create Log/etc.) pinned to the bottom of the screen while scrolling.

## 3. Checklists & Categories

- [ ] Categories page (Disciplines): existing categories can be edited (name, code, Cat Ref) via an Edit button — not just created.
- [ ] Scheduling an inspection for the **Operational** phase only shows Operational-phase categories — Opening-phase-only categories no longer leak into the list.
- [ ] "Identify applicable categories" step has a "Select all" checkbox.
- [ ] Checklist items catalog: Category values match the Categories page exactly (spot-check "Transport & Traffic" specifically — it was previously showing reversed in some places).
- [ ] Inspector Qualifications page: a "Select all" checkbox above the discipline list checks/unchecks every category at once.
- [ ] Log Assistance Guide's Category field is a plain dropdown of existing Categories only — no free-text "Add new category" option, and it can't be bypassed via CSV import either (try importing a row with a made-up category name — it should fail with a clear reason).
- [ ] Log Assistance Guide's Sub-Category field, when adding/editing an entry, now also suggests Sub-Category names already used in Checklists for that Category (not just names used elsewhere in the Guide itself).
- [ ] Completed Checklists tab: a Sub-Category column is visible, and a participant's checklist shows one row per completed Sub-Category (not one blended row for the whole checklist).

## 4. Self-service checklist pickup

- [ ] An unassigned but qualified Inspector can "pick up" an open checklist (discipline + phase + sub-category) themselves from the Inspections tab.
- [ ] Once picked up, that slot becomes unavailable to other inspectors until the original inspector cancels it.
- [ ] "Add Log" sidebar lets an inspector log a finding against any event under their inspection company — but only while inside that venue's boundary, or within 50 meters of it.

## 5. Opening-phase checklists & operators

- [ ] Opening-phase checklists are scored against the **venue** as a whole, not against individual participants.
- [ ] From an Opening-phase checklist, you can still assign an operational participant to resolve a raised Log.
- [ ] Settings has a "Mandatory Operators" tab where you can configure required operator roles (e.g. Security Operator, H&S Operator) per event type.
- [ ] The event workspace shows a compliance status indicator for whether all mandatory operators have been assigned.

## 6. Live map

- [ ] While tracking a live inspector location, the map shows the estimated distance (in meters) from the inspector's real registered location.

## 7. Annex (Readiness)

- [ ] Annex tab in an event workspace shows an upload option for EMC managers (previously blank for orgs whose spreadsheet predated this feature — should now always show something, even a seed prompt).
- [ ] An EMC manager can upload multiple documents under one Annex category.
- [ ] A PM/Analyst can Accept or Reject an uploaded Annex document, and request more information on a category.
- [ ] A category flips to "Provided" once at least one uploaded document under it has been Accepted.
- [ ] Inspection Setup has a new "Annex Categories" admin page (separate from the per-event Annex tab) where SystemAdmin/InspectionAdmin/ProjectManager can add, edit, and soft-delete catalog categories.
- [ ] On that admin page, each category has a "Default Required" checkbox — turning it on pre-marks that category as required on any event that hasn't already overridden it.
- [ ] When adding/editing an Annex category, the Section field lets you pick an existing section (Risk Assessments / Sign-Offs / Certifications) or type a brand-new section name.

---

**Total: ~40 items across 7 areas.** If anything doesn't behave as described, note the exact page/role/steps and send it back — that's usually enough to track down and fix.
