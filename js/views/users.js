/**
 * HULUL - Users & Roles admin view (REQ-ACC).
 */
var CREATABLE_ROLES_BY_ACTOR = {
  SystemAdmin: ['GAAdmin', 'EMCAdmin', 'InspectionAdmin', 'SystemAdmin'],
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
  var orgs = (HululState.user.role === 'SystemAdmin' && creatable.length) ? await Api.call('listOrganizations', {}) : [];

  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + t('nav_users') + '</div>' +
    '<div class="page-subtitle">Account hierarchy &amp; access control</div></div>' +
    (creatable.length ? '<button class="btn btn-primary" id="newUserBtn">+ New account</button>' : '') + '</div>' +
    '<div class="card"><div class="card-body">' + UI.table([
      { key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'role', label: 'Role' },
      { key: 'orgId', label: 'Org' }, { key: 'status', label: t('status'), render: r => UI.statusBadge(r.status === 'Active' ? 'Resolved' : 'Rejected') },
      { key: 'actions', label: t('actions'), render: r => (r.status === 'Active'
          ? '<button class="btn btn-danger btn-sm" data-deact="' + r.id + '">Deactivate</button>'
          : '<button class="btn btn-secondary btn-sm" data-act="' + r.id + '">Activate</button>') }
    ], users, {}) + '</div></div>';

  if (creatable.length) document.getElementById('newUserBtn').onclick = () => openNewUserModal(creatable, orgs);
  root.querySelectorAll('[data-deact]').forEach(b => b.onclick = () => toggle(b.getAttribute('data-deact'), 'deactivateUser'));
  root.querySelectorAll('[data-act]').forEach(b => b.onclick = () => toggle(b.getAttribute('data-act'), 'activateUser'));
  async function toggle(userId, action) {
    try { await Api.call(action, { userId: userId }); UI.toast('Updated', 'success'); Router.resolve(); } catch (err) { UI.error(err); }
  }
}

function openNewUserModal(creatableRoles, orgs) {
  var isSystemAdmin = HululState.user.role === 'SystemAdmin';
  var body =
    UI.field('Full name', '<input id="fName" class="field-input" />') +
    UI.field('Email', '<input id="fUEmail" type="email" class="field-input" />') +
    UI.field('Temporary password', '<input id="fUPass" type="text" class="field-input" value="ChangeMe123!" />') +
    UI.field('Role', '<select id="fURole" class="field-input">' + creatableRoles.map(r => '<option>' + r + '</option>').join('') + '</select>') +
    (isSystemAdmin ? UI.field('Organization', '<select id="fUOrg" class="field-input"></select>') : '');
  UI.openModal('New account', body, [
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
          UI.closeModal(); UI.toast('Account created', 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      } }
  ]);

  if (isSystemAdmin) {
    var roleSelect = document.getElementById('fURole');
    var orgSelect = document.getElementById('fUOrg');
    var syncOrgOptions = function () {
      var wantedType = ROLE_ORG_TYPE[roleSelect.value] || '';
      if (!wantedType) { orgSelect.innerHTML = '<option value="">No organization required</option>'; orgSelect.disabled = true; return; }
      var matching = orgs.filter(function (o) { return o.type === wantedType; });
      orgSelect.disabled = false;
      orgSelect.innerHTML = matching.length
        ? matching.map(o => '<option value="' + o.id + '">' + esc(o.name) + '</option>').join('')
        : '<option value="">No ' + wantedType + ' organizations found — create one first</option>';
    };
    roleSelect.onchange = syncOrgOptions;
    syncOrgOptions();
  }
}
