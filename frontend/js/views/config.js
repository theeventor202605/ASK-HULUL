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
  ['process', 'Process'],
  ['escalations', 'Escalations']
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
  var renderers = { general: renderConfigGeneral_, process: renderConfigProcess_, escalations: renderConfigEscalations_ };
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

/* ---------------- Escalations (timers, To/Cc roles, lock-screen toggle) ----------------
 * REQ: "Admin user would like to modify escalation timer in hours and minutes. Also ability to
 * modify the To user role and the Cc user roles." getEscalationConfig (Resolutions.gs) returns
 * tier1/tier2/tier3 + lockScreenEnabled + allRoles (the picklist, same "server hands back its own
 * picklist" convention as getTemplateProcessConfig above) + riskLevels. Tier 1 has no delay editor
 * here on purpose -- REQ (clarified): each Finding already carries its own deadline from its
 * checklist item, so only Tier 2 and Tier 3's delays (which fire a configurable time AFTER the
 * previous tier) are admin-editable, and per risk level -- REQ: "if risk level is Low level 2
 * trigger might be set to 48 hours and level 3 trigger might be set to 24 hours."
 */
async function renderConfigEscalations_(content) {
  var cfg = await Api.call('getEscalationConfig', {});
  content.innerHTML =
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">Escalation alerts</div>' +
    '<div class="muted" style="font-size:11.5px;">When an escalation triggers, the recipient\'s screen locks with a red alert and outline until they click Noted, which opens the Escalations tab with that finding selected.</div></div>' +
    '<div class="card-body">' +
      '<label style="display:flex;align-items:center;gap:8px;font-size:13.5px;cursor:pointer;">' +
        '<input type="checkbox" id="cfgLockScreenEnabled"' + (cfg.lockScreenEnabled ? ' checked' : '') + ' /> Lock the recipient\'s screen until they click Noted' +
      '</label>' +
      '<div class="muted" style="font-size:11px;margin-top:6px;">Turning this off still shows the blinking alert icon and badge count in the top bar — it just won\'t take over the screen.</div>' +
    '</div></div>' +
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">Tier 1</div>' +
    '<div class="muted" style="font-size:11.5px;">Fires once a Finding\'s own resolution deadline (set per checklist item) passes. That timing isn\'t changed here — only who it notifies.</div></div>' +
    '<div class="card-body" style="display:flex;flex-direction:column;gap:20px;max-width:640px;">' +
      processRoleFieldHtml_('To', 'Gets the full-screen alert (if enabled above).', cfg.allRoles, cfg.tier1.toRoles, 'cfgTier1To') +
      processRoleFieldHtml_('Cc', 'Notified and counted on the bell badge — no screen lock.', cfg.allRoles, cfg.tier1.ccRoles, 'cfgTier1Cc') +
    '</div></div>' +
    escalationTierCardHtml_('Tier 2', 'Fires this long after Tier 1, if the finding is still unresolved.', 2, cfg) +
    escalationTierCardHtml_('Tier 3', 'Fires this long after Tier 2, if the finding is still unresolved.', 3, cfg) +
    '<div style="display:flex;justify-content:flex-end;gap:8px;padding:14px 20px;">' +
      '<button class="btn btn-primary" id="saveEscalationCfgBtn">' + t('save') + '</button>' +
    '</div>';

  document.getElementById('saveEscalationCfgBtn').onclick = async function () {
    try {
      var tier1ToRoles = readCheckedRoles_('cfgTier1To');
      var tier2ToRoles = readCheckedRoles_('cfgTier2To');
      var tier3ToRoles = readCheckedRoles_('cfgTier3To');
      if (!tier1ToRoles.length || !tier2ToRoles.length || !tier3ToRoles.length) {
        UI.toast('Each tier needs at least one To role', 'error');
        return;
      }
      await Api.call('setEscalationConfig', {
        tier1: { toRoles: tier1ToRoles, ccRoles: readCheckedRoles_('cfgTier1Cc') },
        tier2: { toRoles: tier2ToRoles, ccRoles: readCheckedRoles_('cfgTier2Cc'), delayMinutesByRisk: escalationReadDelayMinutesByRisk_('cfgTier2', cfg.riskLevels) },
        tier3: { toRoles: tier3ToRoles, ccRoles: readCheckedRoles_('cfgTier3Cc'), delayMinutesByRisk: escalationReadDelayMinutesByRisk_('cfgTier3', cfg.riskLevels) },
        lockScreenEnabled: document.getElementById('cfgLockScreenEnabled').checked
      });
      UI.toast('Escalation settings saved', 'success');
      Router.resolve();
    } catch (err) { UI.error(err); }
  };
}

function escalationTierCardHtml_(title, subtitle, tierNum, cfg) {
  var tierCfg = cfg['tier' + tierNum];
  var prefix = 'cfgTier' + tierNum;
  return '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + esc(title) + '</div>' +
    '<div class="muted" style="font-size:11.5px;">' + esc(subtitle) + '</div></div>' +
    '<div class="card-body" style="display:flex;flex-direction:column;gap:20px;max-width:640px;">' +
      processRoleFieldHtml_('To', 'Gets the full-screen alert (if enabled above).', cfg.allRoles, tierCfg.toRoles, prefix + 'To') +
      processRoleFieldHtml_('Cc', 'Notified and counted on the bell badge — no screen lock.', cfg.allRoles, tierCfg.ccRoles, prefix + 'Cc') +
      '<div><div class="field-label" style="margin-top:0;">Delay by risk level</div>' +
        escalationDelayRowsHtml_(prefix, tierCfg.delayMinutesByRisk, cfg.riskLevels) +
      '</div>' +
    '</div></div>';
}

function escalationDelayRowsHtml_(prefix, delayMinutesByRisk, riskLevels) {
  return '<table class="data-table" style="margin-top:8px;"><thead><tr><th>Risk level</th><th>Hours</th><th>Minutes</th></tr></thead><tbody>' +
    riskLevels.map(function (level) {
      var total = Number(delayMinutesByRisk[level]) || 0;
      var hours = Math.floor(total / 60), minutes = total % 60;
      return '<tr><td>' + esc(level) + '</td>' +
        '<td><input type="number" min="0" class="field-input ' + prefix + '-delay-hours" data-level="' + esc(level) + '" value="' + hours + '" style="width:90px;" /></td>' +
        '<td><input type="number" min="0" max="59" class="field-input ' + prefix + '-delay-minutes" data-level="' + esc(level) + '" value="' + minutes + '" style="width:90px;" /></td></tr>';
    }).join('') +
  '</tbody></table>';
}

function escalationReadDelayMinutesByRisk_(prefix, riskLevels) {
  var out = {};
  riskLevels.forEach(function (level) {
    var hEl = document.querySelector('.' + prefix + '-delay-hours[data-level="' + level + '"]');
    var mEl = document.querySelector('.' + prefix + '-delay-minutes[data-level="' + level + '"]');
    var hours = Number(hEl ? hEl.value : 0) || 0;
    var minutes = Number(mEl ? mEl.value : 0) || 0;
    out[level] = Math.max(1, hours * 60 + minutes);
  });
  return out;
}
