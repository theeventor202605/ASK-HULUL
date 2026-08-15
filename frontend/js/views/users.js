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

async function renderUsers() {
  var root = document.getElementById('viewRoot');
  var users = await Api.call('listUsers', {});
  var creatable = CREATABLE_ROLES_BY_ACTOR[HululState.user.role] || [];
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
      { key: 'actions', label: t('actions'), render: r => UI.actionsCell(r.status === 'Active'
          ? '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('deactivate_title')) + '" data-deact="' + r.id + '">' + ICON('deactivate') + '</button>'
          : '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('activate_title')) + '" data-act="' + r.id + '">' + ICON('activate') + '</button>') }
    ], users, {}) + '</div></div>';

  if (creatable.length) document.getElementById('newUserBtn').onclick = () => openNewUserModal(creatable, orgs);
  root.querySelectorAll('[data-deact]').forEach(b => b.onclick = () => toggle(b.getAttribute('data-deact'), 'deactivateUser'));
  root.querySelectorAll('[data-act]').forEach(b => b.onclick = () => toggle(b.getAttribute('data-act'), 'activateUser'));
  async function toggle(userId, action) {
    try { await Api.call(action, { userId: userId }); UI.toast(t('toast_updated'), 'success'); Router.resolve(); } catch (err) { UI.error(err); }
  }
}

function openNewUserModal(creatableRoles, orgs) {
  var isSystemAdmin = HululState.user.role === 'SystemAdmin';
  var body =
    UI.field(t('field_full_name'), '<input id="fName" class="field-input" />') +
    UI.field(t('email'), '<input id="fUEmail" type="email" class="field-input" />') +
    UI.field(t('field_temp_password'), '<input id="fUPass" type="text" class="field-input" value="ChangeMe123!" />') +
    UI.field(t('field_role'), '<select id="fURole" class="field-input">' + creatableRoles.map(r => '<option>' + r + '</option>').join('') + '</select>') +
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
    var roleSelect = document.getElementById('fURole');
    var orgSelect = document.getElementById('fUOrg');
    var syncOrgOptions = function () {
      var wantedType = ROLE_ORG_TYPE[roleSelect.value] || '';
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
