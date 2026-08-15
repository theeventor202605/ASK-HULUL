/**
 * HULUL - Users & Roles admin view (REQ-ACC).
 */
var CREATABLE_ROLES_BY_ACTOR = {
  SystemAdmin: ['GAAdmin', 'EMCAdmin', 'InspectionAdmin', 'SystemAdmin', 'SupportAgent'],
  GAAdmin: ['GAUser'], EMCAdmin: ['EventManager', 'EMCManager', 'EMCAnalyst', 'Operator', 'Vendor'],
  InspectionAdmin: ['ProjectManager', 'InspectionAnalyst', 'Inspector']
};
// Which Organization "type" each SystemAdmin-creatable role belongs to (SystemAdmin itself
// isn't tied to any org). Used to filter the Organization picker and set orgType correctly —
// this used to never get sent at all, which left every SystemAdmin-created account's orgType
// blank and broke org-scoped filtering (Events/Venues/Users lists) for that whole branch of
// the account hierarchy.
var ROLE_ORG_TYPE = { GAAdmin: 'GA', EMCAdmin: 'EMC', InspectionAdmin: 'INSPECTION' };

// Custom roles (Roles.gs) each carry their own admin-configured creatableBy list instead of a
// hardcoded ACCOUNT_CREATION_MATRIX/CREATABLE_ROLES_BY_ACTOR entry -- merged in here at render time
// so this page (and the modals below) offer them exactly like a built-in role, with zero further
// frontend code needed when a SystemAdmin defines a new one. listCustomRoles is open to any
// authenticated user (see backend/Roles.gs) precisely so THIS lookup works no matter who's signed in,
// not just SystemAdmin.
function mergeCustomRolesIntoCreatable_(actorRole, customRoles) {
  var base = CREATABLE_ROLES_BY_ACTOR[actorRole] || [];
  var custom = customRoles.filter(function (r) { return (r.creatableBy || []).indexOf(actorRole) !== -1; }).map(function (r) { return r.code; });
  return base.concat(custom);
}
function mergeCustomRolesIntoOrgType_(customRoles) {
  var merged = Object.assign({}, ROLE_ORG_TYPE);
  customRoles.forEach(function (r) { if (r.orgType) merged[r.code] = r.orgType; });
  return merged;
}
function roleDisplayLabel_(code, customRoles) {
  var custom = customRoles.filter(function (r) { return r.code === code; })[0];
  return custom ? custom.label : code; // built-in roles show their raw code, same as before this change
}

async function renderUsers() {
  var root = document.getElementById('viewRoot');
  var users = await Api.call('listUsers', {});
  var customRoles = [];
  try { customRoles = await Api.call('listCustomRoles', {}); } catch (e) { /* fall back to built-in roles only */ }
  var creatable = mergeCustomRolesIntoCreatable_(HululState.user.role, customRoles);
  var orgs = [];
  try { orgs = await Api.call('listOrganizations', {}); } catch (e) { /* fall back to raw id below */ }
  var orgsById = {}; orgs.forEach(function (o) { orgsById[o.id] = o; });

  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + t('nav_users') + '</div>' +
    '<div class="page-subtitle">' + esc(t('users_subtitle')) + '</div></div>' +
    (creatable.length ? '<button class="btn btn-primary" id="newUserBtn">' + esc(t('new_account_btn')) + '</button>' : '') + '</div>' +
    '<div class="card"><div class="card-body">' + UI.table([
      { key: 'name', label: t('col_name') }, { key: 'email', label: t('col_email') }, { key: 'role', label: t('col_role') },
      { key: 'orgId', label: t('col_org'), render: r => r.orgId ? esc(orgsById[r.orgId] ? orgsById[r.orgId].name : r.orgId) : '—' },
      { key: 'status', label: t('status'), render: r => UI.statusBadge(r.status === 'Active' ? 'Resolved' : 'Rejected') },
      { key: 'actions', label: t('actions'), render: r => UI.actionsCell(
          '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('edit_title')) + '" data-edit="' + r.id + '">' + ICON('edit') + '</button>' +
          '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('reset_password_title')) + '" data-reset="' + r.id + '">' + ICON('view_credentials') + '</button>' +
          (r.status === 'Active'
            ? '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('deactivate_title')) + '" data-deact="' + r.id + '">' + ICON('deactivate') + '</button>'
            : '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('activate_title')) + '" data-act="' + r.id + '">' + ICON('activate') + '</button>')) }
    ], users, {}) + '</div></div>';

  if (creatable.length) document.getElementById('newUserBtn').onclick = () => openNewUserModal(creatable, orgs, customRoles);
  root.querySelectorAll('[data-deact]').forEach(b => b.onclick = () => toggle(b.getAttribute('data-deact'), 'deactivateUser'));
  root.querySelectorAll('[data-act]').forEach(b => b.onclick = () => toggle(b.getAttribute('data-act'), 'activateUser'));
  root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
    var target = users.filter(u => u.id === b.getAttribute('data-edit'))[0];
    if (target) openEditUserModal(target, orgs, customRoles);
  });
  root.querySelectorAll('[data-reset]').forEach(b => b.onclick = () => {
    var target = users.filter(u => u.id === b.getAttribute('data-reset'))[0];
    if (target) openResetPasswordModal(target);
  });
  async function toggle(userId, action) {
    try { await Api.call(action, { userId: userId }); UI.toast(t('toast_updated'), 'success'); Router.resolve(); } catch (err) { UI.error(err); }
  }
}

// REQ-ACC-02..07 imply admins keep managing the accounts they create; updateUserAccount (Accounts.gs)
// already supports patching name/email/role (assertCanManage_ enforces who's allowed -- same
// hierarchy as activate/deactivate above), it just had no frontend caller until now. Role is only
// editable among the roles this actor could have created in the first place (creatable), same set
// openNewUserModal already offers, so this can't be used to promote someone outside the actor's own
// authority; if the target's current role isn't in that set (e.g. a SystemAdmin editing an
// EventManager) the role field is shown read-only instead of silently omitted.
function openEditUserModal(user, orgs, customRoles) {
  customRoles = customRoles || [];
  var creatable = mergeCustomRolesIntoCreatable_(HululState.user.role, customRoles);
  var roleOptions = creatable.indexOf(user.role) === -1 ? [user.role] : creatable;
  var body =
    UI.field(t('field_full_name'), '<input id="fEUName" class="field-input" value="' + esc(user.name || '') + '" />') +
    UI.field(t('email'), '<input id="fEUEmail" type="email" class="field-input" value="' + esc(user.email || '') + '" />') +
    UI.field(t('field_role'), '<select id="fEURole" class="field-input"' + (roleOptions.length <= 1 ? ' disabled' : '') + '>' +
      roleOptions.map(r => '<option value="' + esc(r) + '"' + (r === user.role ? ' selected' : '') + '>' + esc(roleDisplayLabel_(r, customRoles)) + '</option>').join('') + '</select>');
  UI.openModal(t('edit_account_title'), body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('save_changes_btn'), className: 'btn-primary', onClick: async function () {
        try {
          await Api.call('updateUser', {
            userId: user.id, name: document.getElementById('fEUName').value,
            email: document.getElementById('fEUEmail').value, role: document.getElementById('fEURole').value
          });
          UI.closeModal(); UI.toast(t('toast_account_updated'), 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      } }
  ]);
}

// resetPassword (Auth.gs adminResetPassword) -- same assertCanManage_-gated hierarchy as
// deactivate/activate; only had no frontend caller. Notifies the affected user server-side
// (adminResetPassword's own notify_ call), so nothing extra needed here beyond the toast.
function openResetPasswordModal(user) {
  var body =
    '<div class="muted" style="font-size:12.5px;margin-bottom:10px;">' + esc(t('reset_password_hint')) + '</div>' +
    UI.field(t('field_new_password'), '<input id="fRPNew" type="text" class="field-input" value="ChangeMe123!" />');
  UI.openModal(t('reset_password_title') + ' — ' + esc(user.name), body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('reset_password_btn'), className: 'btn-primary', onClick: async function () {
        try {
          var newPassword = document.getElementById('fRPNew').value;
          if (!newPassword) { UI.toast(t('field_new_password'), 'error'); return; }
          await Api.call('resetPassword', { userId: user.id, newPassword: newPassword });
          UI.closeModal(); UI.toast(t('toast_password_reset'), 'success');
        } catch (err) { UI.error(err); }
      } }
  ]);
}

function openNewUserModal(creatableRoles, orgs, customRoles) {
  customRoles = customRoles || [];
  var isSystemAdmin = HululState.user.role === 'SystemAdmin';
  var body =
    UI.field(t('field_full_name'), '<input id="fName" class="field-input" />') +
    UI.field(t('email'), '<input id="fUEmail" type="email" class="field-input" />') +
    UI.field(t('field_temp_password'), '<input id="fUPass" type="text" class="field-input" value="ChangeMe123!" />') +
    UI.field(t('field_role'), '<select id="fURole" class="field-input">' +
      creatableRoles.map(r => '<option value="' + esc(r) + '">' + esc(roleDisplayLabel_(r, customRoles)) + '</option>').join('') + '</select>') +
    (isSystemAdmin ? UI.field(t('field_organization'), '<select id="fUOrg" class="field-input"></select>') : '');
  UI.openModal(t('new_account_title'), body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('create'), className: 'btn-primary', onClick: async function () {
        try {
          var payload = { name: document.getElementById('fName').value, email: document.getElementById('fUEmail').value,
            password: document.getElementById('fUPass').value, role: document.getElementById('fURole').value };
          var orgSelect = document.getElementById('fUOrg');
          if (orgSelect && orgSelect.value) {
            var org = orgs.filter(o => o.id === orgSelect.value)[0];
            payload.orgId = orgSelect.value;
            payload.orgType = org ? org.type : '';
          }
          await Api.call('createUser', payload);
          UI.closeModal(); UI.toast(t('toast_account_created'), 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      } }
  ]);

  if (isSystemAdmin) {
    var roleOrgTypeMerged = mergeCustomRolesIntoOrgType_(customRoles);
    var roleSelect = document.getElementById('fURole');
    var orgSelect = document.getElementById('fUOrg');
    var syncOrgOptions = function () {
      var wantedType = roleOrgTypeMerged[roleSelect.value] || '';
      if (!wantedType) { orgSelect.innerHTML = '<option value="">' + esc(t('no_org_required_option')) + '</option>'; orgSelect.disabled = true; return; }
      var matching = orgs.filter(function (o) { return o.type === wantedType; });
      orgSelect.disabled = false;
      orgSelect.innerHTML = matching.length
        ? matching.map(o => '<option value="' + o.id + '">' + esc(o.name) + '</option>').join('')
        : '<option value="">' + esc(t('no_orgs_of_type_found', { type: wantedType })) + '</option>';
    };
    roleSelect.onchange = syncOrgOptions;
    syncOrgOptions();
  }
}
