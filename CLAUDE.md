# HULUL — working memory

Persistent context for picking this project back up in a fresh session. `README.md` is the
user-facing project overview; this file is "what Claude should already know" — conventions,
in-progress work, and decisions made along the way that aren't obvious from the code alone.

## Standing instruction

Every response that touches code must close with exactly:

```
Frontend: git push / no push
Backend: clasp push / no push
```

Claude cannot run `clasp push` or `git push` itself in this environment (no Google/clasp OAuth,
and git push needs the user's own credentials) — the footer is a reminder for the user to deploy,
not a claim that it already happened. Don't assume a fix is "live" just because the local code is
correct; a "this used to work, now it's broken" report right after a backend change is almost
always a not-yet-deployed/not-yet-redeployed issue, not a real regression. For permission-key
changes specifically, also remember: `HululState.permissions` is fetched once per session at
login, so even after `clasp push` a user needs to log out and back in to pick up a permission
change.

## Architecture

- `backend/*.gs` — Google Apps Script, one file per SRS module, concatenated by Apps Script in
  **alphabetical filename order** at load time. Any top-level (non-function-body) code that
  references something defined in a later-alphabetical file will throw at load time and break
  every API call — this has bitten the project before (see `ROLES` references at top level).
  Comments throughout the codebase flag this constraint wherever it applies (e.g. why some
  `defaultRoles` arrays use plain string literals instead of `ROLES.X`).
- `frontend/js/views/*.js` — one file per page, vanilla JS, no build step, spliced into
  `index.html` via `<script>` tags in a specific order (some files depend on globals defined by
  files loaded earlier — see the comments in `index.html` next to each `<script>` tag).
- `frontend/js/ui.js` — shared UI primitives (`UI.table`, `UI.actionsCell`, modals, toasts). Any
  table built via `UI.table()` gets filter/sort/export/pagination for free; delegated
  document-level listeners in this file wire all of that generically so no per-view code is
  needed. Rows are rendered once and never regenerated (sorting/filtering/paging only reorder or
  hide existing `<tr>` nodes) — views attach their own button handlers via
  `querySelectorAll('[data-x]')` right after inserting a table's HTML, and that would silently
  break if a row's innerHTML were ever regenerated later.

## RBAC / Permissions module

`backend/Permissions.gs` is the admin-configurable layer on top of the original hardcoded
`requireRole(user, [ROLES...])` calls. Pattern:

```js
requirePermission(user, 'some.key', contextOrgId)
// -> looks up an admin override (Settings > Permissions) if one's been saved,
//    else PERMISSION_REGISTRY_['some.key'].defaultRoles (== the old hardcoded array)
// -> requireRole(user, effectiveRoles, contextOrgId)
```

**Migration status: complete.** Every `requireRole` call site across the backend has been
reviewed. Sites deliberately left as raw `requireRole`/hardcoded (not bugs, don't "fix" these):

- Pure `[ROLES.SYSTEM_ADMIN]`-only meta-config gates (e.g. `Utils.gs` config routes,
  `Permissions.gs`'s own admin endpoints, `Accounts.gs`'s org/icon/logo config routes) — kept
  hardcoded to avoid self-lockout/circular-config risk, same reasoning the Permissions module
  applies to itself.
- Actions with their own pre-existing, purpose-built admin mechanism (Templates.gs's
  `uploadEventTemplateFile`/`submitEventTemplate`/`reviewEventTemplate`, governed by
  `templateUploaderRoles_()`/`templateReviewerRoles_()` off the Config sheet) — not migrated, to
  avoid a second parallel "who can do this" control for the same action.
- Domain-defining role arrays that are also used for non-action purposes (visibility, recipient
  resolution, etc.), e.g. Support.gs's `SUPPORT_MANAGE_ROLES` — the *specific action* got its own
  new permission key (`ticket.resolve`) layered on top, but the underlying array stayed hardcoded
  since it also drives queue visibility and notification routing that shouldn't move in lockstep
  with "who can resolve a ticket."

When adding a new permission-gated action: add one `PERMISSION_REGISTRY_` entry (module/label/
defaultRoles matching whatever the old hardcoded array would have been), swap the `requireRole`
call for `requirePermission(user, key[, contextOrgId])`, and if the frontend has its own hardcoded
role-array gate for the same action, replace it with `hasPermission('key')`
(`frontend/js/permissions.js`, reads `HululState.permissions`, fetched once per session via
`getMyPermissions`). Ownership/org-scope checks (e.g. "is this event's `emcId` actually yours")
stay as plain hardcoded conditions — they're business-relationship checks, not admin-configurable
permissions, and should never become a permission key.

Frontend `NAV_ITEMS[].roles` (`app.js`, sidebar link visibility) is a known, deliberate exception
— **not** migrated to `hasPermission()`. A nav link doesn't correspond to one backend action (e.g.
the Venues link's roles don't match `venue.manage`'s roles — viewing differs from managing), so
migrating it would mean inventing a new "page visibility" permission category, not a mechanical
swap. Flagged as a real follow-on if ever wanted, deliberately not done casually.

## Notifications (`backend/Notifications.gs`)

`notify_()` (in-app row + best-effort email) / `notifyEventStakeholders_()` /
`notifyFindingCreated_()` / `notifyFindingStatusChange_()`. A full audit of every mutating backend
function against these was done and all found gaps were fixed — current state should be complete,
but if a "no notification fired" report comes in, check the specific action's function for a
`notify_`/`notifyEventStakeholders_` call before assuming it's a new gap.

## Frontend UI conventions established this session

- **Sidebar**: `#sidebar.collapsed` = fully hidden (not a narrow icon rail) at every screen width.
  Desktop: width animates to 0, content reflows. Mobile (`<=900px`): slides off-screen via
  `transform`, overlay + backdrop instead of pushing content. One toggle mechanism
  (`applySidebarCollapsed_`, `app.js`) drives the sidebar's own `‹`/☰ button, the topbar's
  `#mobileNavBtn` (shown only while collapsed), and `#sidebarBackdrop` (mobile tap-to-close scrim).
  State persists via `localStorage['hulul_sidebar_collapsed']`; if unset, defaults to collapsed
  under 900px, expanded above it.
- **Table action columns**: every `UI.table()` column with `key: 'actions'` renders through
  `UI.actionsCell(buttonsHtml)` — a three-dot toggle that opens a floating popover containing
  whatever icon buttons the view already built (nothing about the buttons themselves changed).
  The popover is `position:fixed` (not `absolute`) because `.table-wrap` is `overflow-x:auto`,
  which per the CSS spec also clips vertically once any axis is non-visible — `position:fixed`
  escapes that. Position is computed in JS from the toggle button's `getBoundingClientRect()`
  (`ui.js`, delegated listener near the bottom of the file, `hululCloseActionsMenus_` etc.). The
  column header i18n key is `actions` → labelled "Do" (EN) / "تنفيذ" (AR), one shared key so it
  updates everywhere at once. When a render function can return "no buttons at all" for some rows
  (e.g. `templateActionsHtml_`), keep the old bare `'—'` fallback instead of wrapping an empty
  popover — don't show a dots-menu that opens to nothing.
- **Icons**: `ICON('key')` (`icons.js`) looks up `ICON_DEFAULTS[key]`, an inline Lucide SVG,
  overridable per-install from Settings > Icons. Add new semantic icons there, not as raw emoji
  literals in view files.

## Verification workflow

No test suite exists. After any backend change, run:

1. Per-file syntax check (Node doesn't recognize `.gs`, so copy first):
   `cp backend/X.gs /tmp/X.js && node --check /tmp/X.js`
2. Full alphabetical load-order simulation — concatenates all `backend/*.gs` files in the same
   order Apps Script would, stubs Apps Script globals (`SpreadsheetApp`, `PropertiesService`,
   `Utilities`, `MailApp`, `DriveApp`, etc.), and actually **executes** the concatenated top-level
   code (`new Function(src).call({})`, then calling the result — constructing alone only parses,
   doesn't run) to catch "top-level reference to something defined in a later file" crashes before
   they hit production. Rebuild this script fresh each time rather than assuming one is lying
   around.

After any frontend change: `node --check` on every touched `.js` file at minimum.

## Known gaps (carried from README/docs)

- Full Arabic translation is chrome/navigation-complete but not every per-view field label yet.
- Evidence upload accepts `lat`/`lng` server-side but the frontend doesn't yet call
  `navigator.geolocation` to supply them.
