# Project memory — HULUL

## What this project is
HULUL: an Event Readiness & Compliance Platform. Backend is Google Apps Script (`backend/*.gs`,
deployed via `clasp push`). Frontend is a vanilla JS single-page app (`frontend/js/`, hash router),
deployed via GitHub Pages from the `frontend/` folder through `.github/workflows/pages.yml`
(GitHub Actions source — do not switch Pages "Source" to "Deploy from a branch", it only serves
the repo root/`docs`, not arbitrary subfolders, and will break the site).

## Standing instruction
Every response involving code changes must close with exactly:
```
Frontend: git push / no push
Backend: clasp push / no push
```

## Technical conventions established in this project
- Backend `.gs` files auto-concatenate alphabetically at load. Top-level `var X = [...]` that
  references `ROLES.X` before `Utils.gs` has loaded breaks the whole script — use plain string
  literals for such cases instead (e.g. `SUPPORT_MANAGE_ROLES = ['SystemAdmin','SupportAgent']`).
- Google Sheets is the DB. `SCHEMA` in `Utils.gs` maps sheet name → ordered column array. New
  columns must always be appended at the end only — rows are read positionally.
- Frontend is one file per view (`frontend/js/views/*.js`). Function declarations are available
  app-wide once all scripts have loaded, regardless of `<script>` tag order in `index.html` — only
  top-level immediately-executed code is order-sensitive. This is used deliberately: helper
  functions defined in one view file (e.g. `parseBoundaryClient_`, `applyBoundaryPanLimit_`,
  `VENUE_BOUNDARY_DEFAULT_COLOR_`, all in `venues.js`) are called directly from other view files
  (`eventDetail.js`, `eventPlaces.js`) without importing anything.
- Maps use Leaflet.js, aliased as `window.HululLeaflet` (not the bare global `L`, which the app's
  own `labels.js` clobbers with its `Term()` function) + the Leaflet.draw plugin for boundary
  drawing.
- Every map that displays a venue's or zone's boundary: (1) renders it in that venue's/zone's own
  picked `color` (hex string on `Venues.color`/`Zones.color`, falling back to a shared default
  indigo for venues or an auto-cycled palette for zones with no color set), and (2) restricts
  panning via Leaflet `setMaxBounds` (padded, viscosity 1.0) so the boundary can never be fully
  scrolled out of view — lifted automatically when no boundary exists yet.

## Git workflow — known recurring issue
This repo has repeatedly hit stuck `.git/index.lock` and `.git/HEAD.lock` files that resist normal
deletion (permission errors on delete, not just "file exists"). Root cause: a git operation was
interrupted before completing its final rename-lock-into-place step, and the lock file's owning
context doesn't match the context trying to delete it afterward (this happens when a repository's
working directory is written to from more than one execution context — e.g. a sandboxed/agent tool
process alongside the normal local shell). A `.gitattributes` (`* text=auto eol=lf`) is already in
place to stop line-ending-only noise diffs.

**Resolution when this happens again:**
1. Close anything that might have the folder open (editors, git GUIs, extra terminal tabs).
2. Delete `.git/index.lock` and `.git/HEAD.lock` (and any other `.git/*.lock`) directly via File
   Explorer or an elevated Command Prompt (`del /f "...\.git\index.lock"`) if a normal delete is
   refused.
3. Run `git status` first (not push) to confirm a clean read with the expected modified files
   listed and no lock errors.
4. `git add -A`, then `git commit -m "..."` (an actual commit — `git add` alone does nothing;
   `git push` only sends existing commits, so it will report "Everything up-to-date" if the commit
   step never happened, even with real uncommitted changes sitting in the working tree).
5. `git push`.

A `git push` alias was previously configured to auto-add/commit/push in one step
(`git config alias.push '!f(){ rm -f .git/index.lock 2>/dev/null; git add -A; git commit -m "Update"; git -c alias.push= push "$@"; }; f'`)
but has been observed to silently not fire (falls through to a plain push) at least once — verify
with `git config --get alias.push` if `git push` alone stops auto-committing again.

Fine-grained personal access tokens are unrelated to lock-file problems — they authenticate the
remote push (GitHub), not local filesystem locking. Don't touch the token to troubleshoot locks.
