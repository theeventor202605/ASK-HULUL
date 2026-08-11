/**
 * HULUL - Config admin view (SystemAdmin only). Tabbed (route: #/config?tab=general|process,
 * pattern mirrors eventDetail.js's EVENT_TABS -- tabbar + hash query param + per-tab renderer).
 *  - General: raw key/value settings CRUD (escalationTier2DelayHours/escalationTier3DelayHours,
 *    Setup.gs seeds the defaults, and anything else added to the Config sheet directly). This was
 *    the entire page before the Process tab was added.
 *  - Process: friendlier settings surfaces for specific processes -- currently just the Readiness
 *    Templates role assignment (REQ: "role assignments... Inspection Analyst and Event Manager,
 *    where I can change them and allow one or multiple role assignment"). Stored under the same
 *    Config sheet as a JSON-array value (see templateUploaderRoles_/templateReviewerRoles_ in
 *    Templates.gs) but edited here as a proper multi-select instead of raw JSON text on General.
 */
var CONFIG_TABS = [
  ['general', 'General'],
  ['process', 'Process']
];

async function renderConfig(params) {
  var root = document.getElementById('viewRoot');
  var activeTab = (params && params.tab) || 'general';

  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + t('nav_config') + '</div>' +
    '<div class="page-subtitle">System settings</div></div></div>' +
    '<div class="tabbar" id="configTabbar"></div>' +
    '<div id="configTabContent"></div>';

  var tabbar = document.getElementById('configTabbar');
  tabbar.innerHTML = CONFIG_TABS.map(function (tb) {
    return '<div class="tab-btn ' + (tb[0] === activeTab ? 'active' : '') + '" data-tab="' + tb[0] + '">' + esc(tb[1]) + '</div>';
  }).join('');
  tabbar.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.onclick = function () { window.location.hash = '#/config?tab=' + btn.getAttribute('data-tab'); };
  });

  var content = document.getElementById('configTabContent');
  content.innerHTML = '<div class="empty-state">' + t('loading') + '</div>';
  var renderers = { general: renderConfigGeneral_, process: renderConfigProcess_ };
  try { await (renderers[activeTab] || renderConfigGeneral_)(content); }
  catch (err) { UI.error(err); content.innerHTML = '<div class="empty-state">Failed to load this tab.</div>'; }
}

/* ---------------- General (raw key/value settings) ---------------- */
async function renderConfigGeneral_(content) {
  var rows = await Api.call('listConfig', {});
  content.innerHTML =
    '<div class="card"><div class="card-header"><div class="card-title">Settings</div>' +
    '<button class="btn btn-primary btn-sm" id="newCfgBtn">+ New / update setting</button></div>' +
    '<div class="card-body">' + UI.table([
      { key: 'key', label: 'Key' }, { key: 'value', label: 'Value' },
      { key: 'actions', label: t('actions'), render: r => '<button class="btn btn-secondary btn-sm btn-icon" title="Edit" data-edit="' + esc(r.key) + '" data-value="' + esc(r.value) + '">' + ICON('edit') + '</button>' }
    ], rows, {}) + '</div></div>';

  document.getElementById('newCfgBtn').onclick = () => openCfgModal_('', '');
  content.querySelectorAll('[data-edit]').forEach(function (b) {
    b.onclick = () => openCfgModal_(b.getAttribute('data-edit'), b.getAttribute('data-value'));
  });
}

function openCfgModal_(key, value) {
  var body = UI.field('Key', '<input id="fCfgKey" class="field-input" value="' + esc(key) + '" ' + (key ? 'readonly' : '') + ' />') +
    UI.field('Value', '<input id="fCfgValue" class="field-input" value="' + esc(value) + '" />');
  UI.openModal(key ? 'Update setting' : 'New setting', body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('save'), className: 'btn-primary', onClick: async function () {
        try {
          await Api.call('setConfig', { key: document.getElementById('fCfgKey').value, value: document.getElementById('fCfgValue').value });
          UI.closeModal(); UI.toast('Setting saved', 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      } }
  ]);
}

/* ---------------- Process (per-process settings, starting with Readiness Templates roles) ------
 * getTemplateProcessConfig (SystemAdmin-only, Templates.gs) returns the currently-configured
 * uploaderRoles/reviewerRoles plus allRoles (every role code + display label, from ROLES/
 * ROLE_LABELS in Utils.gs) so this page never needs its own hardcoded copy of the role list.
 */
async function renderConfigProcess_(content) {
  var cfg = await Api.call('getTemplateProcessConfig', {});
  content.innerHTML =
    '<div class="card"><div class="card-header"><div class="card-title">Readiness ' + esc(Term('template_plural')) + ' process</div>' +
    '<div class="muted" style="font-size:11.5px;">Who fills each step — pick one or more roles for each. SystemAdmin can always act, regardless of what\'s picked here.</div></div>' +
    '<div class="card-body" style="display:flex;flex-direction:column;gap:20px;max-width:640px;">' +
      processRoleFieldHtml_('Upload &amp; submit documents', 'Event Manager step — uploads the completed document and clicks Submit.', cfg.allRoles, cfg.uploaderRoles, 'cfgUploader') +
      processRoleFieldHtml_('Review &amp; evaluate documents', 'Inspection Analyst step — marks a submitted document Evaluated or Missed.', cfg.allRoles, cfg.reviewerRoles, 'cfgReviewer') +
    '</div>' +
    '<div style="display:flex;justify-content:flex-end;gap:8px;padding:14px 20px;border-top:1px solid var(--border);">' +
      '<button class="btn btn-primary" id="saveProcessBtn">' + t('save') + '</button>' +
    '</div></div>';

  document.getElementById('saveProcessBtn').onclick = async function () {
    try {
      var uploaderRoles = readCheckedRoles_('cfgUploader');
      var reviewerRoles = readCheckedRoles_('cfgReviewer');
      if (!uploaderRoles.length) { UI.toast('Pick at least one role for uploading & submitting', 'error'); return; }
      if (!reviewerRoles.length) { UI.toast('Pick at least one role for reviewing', 'error'); return; }
      await Api.call('setTemplateProcessConfig', { uploaderRoles: uploaderRoles, reviewerRoles: reviewerRoles });
      UI.toast('Process settings saved', 'success');
      Router.resolve();
    } catch (err) { UI.error(err); }
  };
}

function processRoleFieldHtml_(title, subtitle, allRoles, checkedRoles, prefix) {
  var checkedSet = {}; (checkedRoles || []).forEach(function (r) { checkedSet[r] = true; });
  return '<div>' +
    '<div style="font-weight:600;font-size:13.5px;margin-bottom:2px;">' + title + '</div>' +
    '<div class="muted" style="font-size:11.5px;margin-bottom:8px;">' + esc(subtitle) + '</div>' +
    '<div style="max-height:220px;overflow:auto;border:1px solid var(--border);border-radius:var(--radius-sm);padding:6px 10px;">' +
      allRoles.map(function (r) {
        return '<label style="display:flex;align-items:center;gap:6px;font-size:13px;padding:3px 0;">' +
          '<input type="checkbox" class="' + prefix + '-check" value="' + esc(r.value) + '"' + (checkedSet[r.value] ? ' checked' : '') + ' /> ' + esc(r.label) + '</label>';
      }).join('') +
    '</div>' +
  '</div>';
}

function readCheckedRoles_(prefix) {
  var ids = [];
  document.querySelectorAll('.' + prefix + '-check:checked').forEach(function (c) { ids.push(c.value); });
  return ids;
}
