/**
 * HULUL - Projects.gs
 * A GA-level grouping of several Events (e.g. a multi-venue program like "Riyadh Season 2026")
 * into one Project. Distinct from the existing free-text Events.project column (kept only for
 * backward-compat/CSV import) and from SubEvents (which are sub-slices of a single Event, not a
 * grouping of several Events). A Project can exist with zero Events -- create it first, then add
 * Events under it, or link existing Events into it -- and can be renamed freely since Events
 * reference it by id, not by name.
 *
 * Managed by the same roles that manage Events themselves (GA Admin/User, SystemAdmin); listing is
 * open to any authenticated user (matches listEvents/listVenues), so anyone can browse the
 * grouping even if only GA can create/edit/delete it.
 */
// String literals (not ROLES.X) deliberately -- this runs at file-load time, before Utils.gs's
// top-level `var ROLES = {...}` has necessarily executed yet (Apps Script evaluates every file's
// top-level statements in filename order, and "Projects.gs" sorts before "Utils.gs"). Matches
// ACCOUNT_CREATION_MATRIX in Accounts.gs, which uses the same string-literal convention for the
// same reason.
var PROJECT_MANAGE_ROLES = ['SystemAdmin', 'GAAdmin', 'GAUser'];

function listProjects(user, p) {
  return getAll('Projects').sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
}

function createProject(user, p) {
  requireRole(user, PROJECT_MANAGE_ROLES);
  if (!p.name || !String(p.name).trim()) throw new HululError('BAD_REQUEST', 'name is required');
  var project = { id: newId('Projects'), name: p.name.trim(), description: p.description || '', createdBy: user.id, createdAt: nowIso_() };
  insertRow('Projects', project);
  audit(user.id, 'CREATE_PROJECT', 'Projects', project.id, {});
  return project;
}

function updateProject(user, p) {
  var project = getById('Projects', p.projectId);
  if (!project) throw new HululError('NOT_FOUND', 'Project not found');
  requireRole(user, PROJECT_MANAGE_ROLES);
  var patch = {};
  ['name', 'description'].forEach(function (f) { if (p[f] !== undefined) patch[f] = p[f]; });
  if (patch.name !== undefined && !String(patch.name).trim()) throw new HululError('BAD_REQUEST', 'name cannot be blank');
  var updated = updateRow('Projects', p.projectId, patch);
  audit(user.id, 'UPDATE_PROJECT', 'Projects', p.projectId, patch);
  return updated;
}

// Deleting a Project never deletes or hides its Events -- they're simply unlinked (projectId
// cleared) and remain exactly as they were, just no longer grouped under this project.
function deleteProject(user, p) {
  var project = getById('Projects', p.projectId);
  if (!project) throw new HululError('NOT_FOUND', 'Project not found');
  requireRole(user, [ROLES.SYSTEM_ADMIN, ROLES.GA_ADMIN]);
  findWhere('Events', function (e) { return e.projectId === p.projectId; })
    .forEach(function (e) { updateRow('Events', e.id, { projectId: '' }); });
  deleteRow('Projects', p.projectId);
  audit(user.id, 'DELETE_PROJECT', 'Projects', p.projectId, {});
  return { deleted: true };
}
