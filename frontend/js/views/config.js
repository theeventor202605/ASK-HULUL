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
function CONFIG_TABS_() {
  return [
    ['general', t('tab_general')],
    ['process', t('tab_process')],
    ['escalations', t('tab_escalations')]
  ];
}

async function renderConfig(params) {
  var root = document.getElementById('viewRoot');
  var activeTab = (params && params.tab) || 'general';

  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + t('nav_config') + '</div>' +
    '<div class="page-subtitle">' + esc(t('config_subtitle')) + '</div></div></div>' +
    '<div class="tabbar" id="configTabbar"></div>' +
    '<div id="configTabContent"></div>';

  var tabbar = document.getElementById('configTabbar');
  tabbar.innerHTML = CONFIG_TABS_().map(function (tb) {
    return '<div class="tab-btn ' + (tb[0] === activeTab ? 'active' : '') + '" data-tab="' + tb[0] + '">' + esc(tb[1]) + '</div>';
  }).join('');
  tabbar.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.onclick = function () { window.location.hash = '#/config?tab=' + btn.getAttribute('data-tab'); };
  });

  var content = document.getElementById('configTabContent');
  content.innerHTML = '<div class="empty-state">' + t('loading') + '</div>';
  var renderers = { general: renderConfigGeneral_, process: renderConfigProcess_, escalations: renderConfigEscalations_ };
  try { await (renderers[activeTab] || renderConfigGeneral_)(content); }
  catch (err) { UI.error(err); content.innerHTML = '<div class="empty-state">' + esc(t('failed_load_tab')) + '</div>'; }
}

/* ---------------- General (raw key/value settings) ---------------- */
async function renderConfigGeneral_(content) {
  var rows = await Api.call('listConfig', {});
  content.innerHTML =
    '<div class="card"><div class="card-header"><div class="card-title">' + esc(t('settings_card_title')) + '</div>' +
    '<button class="btn btn-primary btn-sm" id="newCfgBtn">' + esc(t('new_update_setting_btn')) + '</button></div>' +
    '<div class="card-body">' + UI.table([
      { key: 'key', label: t('col_key') }, { key: 'value', label: t('col_value') },
      { key: 'actions', label: t('actions'), render: r => UI.actionsCell('<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('action_edit')) + '" data-edit="' + esc(r.key) + '" data-value="' + esc(r.value) + '">' + ICON('edit') + '</button>') }
    ], rows, {}) + '</div></div>';

  document.getElementById('newCfgBtn').onclick = () => openCfgModal_('', '');
  content.querySelectorAll('[data-edit]').forEach(function (b) {
    b.onclick = () => openCfgModal_(b.getAttribute('data-edit'), b.getAttribute('data-value'));
  });
}

function openCfgModal_(key, value) {
  var body = UI.field(t('field_key'), '<input id="fCfgKey" class="field-input" value="' + esc(key) + '" ' + (key ? 'readonly' : '') + ' />') +
    UI.field(t('field_value'), '<input id="fCfgValue" class="field-input" value="' + esc(value) + '" />');
  UI.openModal(key ? t('update_setting_title') : t('new_setting_title'), body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('save'), className: 'btn-primary', onClick: async function () {
        try {
          await Api.call('setConfig', { key: document.getElementById('fCfgKey').value, value: document.getElementById('fCfgValue').value });
          UI.closeModal(); UI.toast(t('toast_setting_saved'), 'success'); Router.resolve();
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
    '<div class="card"><div class="card-header"><div class="card-title">' + esc(t('readiness_process_title', { term: Term('template_plural') })) + '</div>' +
    '<div class="muted" style="font-size:11.5px;">' + esc(t('readiness_process_subtitle')) + '</div></div>' +
    '<div class="card-body" style="display:flex;flex-direction:column;gap:20px;max-width:640px;">' +
      processRoleFieldHtml_(t('upload_submit_docs_title'), t('upload_submit_docs_subtitle'), cfg.allRoles, cfg.uploaderRoles, 'cfgUploader') +
      processRoleFieldHtml_(t('review_evaluate_docs_title'), t('review_evaluate_docs_subtitle'), cfg.allRoles, cfg.reviewerRoles, 'cfgReviewer') +
    '</div>' +
    '<div style="display:flex;justify-content:flex-end;gap:8px;padding:14px 20px;border-top:1px solid var(--border);">' +
      '<button class="btn btn-primary" id="saveProcessBtn">' + t('save') + '</button>' +
    '</div></div>';

  document.getElementById('saveProcessBtn').onclick = async function () {
    try {
      var uploaderRoles = readCheckedRoles_('cfgUploader');
      var reviewerRoles = readCheckedRoles_('cfgReviewer');
      if (!uploaderRoles.length) { UI.toast(t('toast_pick_uploader_role'), 'error'); return; }
      if (!reviewerRoles.length) { UI.toast(t('toast_pick_reviewer_role'), 'error'); return; }
      await Api.call('setTemplateProcessConfig', { uploaderRoles: uploaderRoles, reviewerRoles: reviewerRoles });
      UI.toast(t('toast_process_settings_saved'), 'success');
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
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + esc(t('escalation_alerts_title')) + '</div>' +
    '<div class="muted" style="font-size:11.5px;">' + esc(t('escalation_alerts_subtitle')) + '</div></div>' +
    '<div class="card-body">' +
      '<label style="display:flex;align-items:center;gap:8px;font-size:13.5px;cursor:pointer;">' +
        '<input type="checkbox" id="cfgLockScreenEnabled"' + (cfg.lockScreenEnabled ? ' checked' : '') + ' /> ' + esc(t('lock_screen_label')) +
      '</label>' +
      '<div class="muted" style="font-size:11px;margin-top:6px;">' + esc(t('lock_screen_hint')) + '</div>' +
    '</div></div>' +
    // REQ follow-up: "resolution of tier timing, not true real-time" -- the sweep that actually
    // checks whether a delay has elapsed used to run every 30 minutes no matter how short a delay
    // was configured below; now editable here too (escalationCheckIntervalMinutes_/
    // reinstallEscalationTrigger_, Setup.gs). Only the 5 values ScriptApp's ClockTriggerBuilder
    // actually accepts are offered -- anything else would just get silently snapped server-side.
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + esc(t('check_interval_title')) + '</div>' +
    '<div class="muted" style="font-size:11.5px;">' + esc(t('check_interval_subtitle')) + '</div></div>' +
    '<div class="card-body">' +
      UI.field(t('check_interval_field'), '<select id="cfgCheckIntervalMinutes" class="field-input" style="max-width:200px;">' +
        (cfg.checkIntervalAllowedMinutes || [1, 5, 10, 15, 30]).map(function (m) {
          return '<option value="' + m + '"' + (m === cfg.checkIntervalMinutes ? ' selected' : '') + '>' + esc(t('x_minutes', { count: m })) + '</option>';
        }).join('') + '</select>') +
    '</div></div>' +
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">' + esc(t('tier1_title')) + '</div>' +
    '<div class="muted" style="font-size:11.5px;">' + esc(t('tier1_subtitle')) + '</div></div>' +
    '<div class="card-body" style="display:flex;flex-direction:column;gap:20px;max-width:640px;">' +
      processRoleFieldHtml_(esc(t('field_to')), t('field_to_hint'), cfg.allRoles, cfg.tier1.toRoles, 'cfgTier1To') +
      processRoleFieldHtml_(esc(t('field_cc')), t('field_cc_hint'), cfg.allRoles, cfg.tier1.ccRoles, 'cfgTier1Cc') +
    '</div></div>' +
    escalationTierCardHtml_(t('tier2_title'), t('tier2_subtitle'), 2, cfg) +
    escalationTierCardHtml_(t('tier3_title'), t('tier3_subtitle'), 3, cfg) +
    '<div style="display:flex;justify-content:flex-end;gap:8px;padding:14px 20px;">' +
      '<button class="btn btn-primary" id="saveEscalationCfgBtn">' + t('save') + '</button>' +
    '</div>';

  document.getElementById('saveEscalationCfgBtn').onclick = async function () {
    try {
      var tier1ToRoles = readCheckedRoles_('cfgTier1To');
      var tier2ToRoles = readCheckedRoles_('cfgTier2To');
      var tier3ToRoles = readCheckedRoles_('cfgTier3To');
      if (!tier1ToRoles.length || !tier2ToRoles.length || !tier3ToRoles.length) {
        UI.toast(t('toast_each_tier_needs_to_role'), 'error');
        return;
      }
      await Api.call('setEscalationConfig', {
        tier1: { toRoles: tier1ToRoles, ccRoles: readCheckedRoles_('cfgTier1Cc') },
        tier2: { toRoles: tier2ToRoles, ccRoles: readCheckedRoles_('cfgTier2Cc'), delayMinutesByRisk: escalationReadDelayMinutesByRisk_('cfgTier2', cfg.riskLevels) },
        tier3: { toRoles: tier3ToRoles, ccRoles: readCheckedRoles_('cfgTier3Cc'), delayMinutesByRisk: escalationReadDelayMinutesByRisk_('cfgTier3', cfg.riskLevels) },
        lockScreenEnabled: document.getElementById('cfgLockScreenEnabled').checked,
        checkIntervalMinutes: Number(document.getElementById('cfgCheckIntervalMinutes').value)
      });
      UI.toast(t('toast_escalation_settings_saved'), 'success');
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
      processRoleFieldHtml_(esc(t('field_to')), t('field_to_hint'), cfg.allRoles, tierCfg.toRoles, prefix + 'To') +
      processRoleFieldHtml_(esc(t('field_cc')), t('field_cc_hint'), cfg.allRoles, tierCfg.ccRoles, prefix + 'Cc') +
      '<div><div class="field-label" style="margin-top:0;">' + esc(t('delay_by_risk_level')) + '</div>' +
        escalationDelayRowsHtml_(prefix, tierCfg.delayMinutesByRisk, cfg.riskLevels) +
      '</div>' +
    '</div></div>';
}

function escalationDelayRowsHtml_(prefix, delayMinutesByRisk, riskLevels) {
  return '<table class="data-table" style="margin-top:8px;"><thead><tr><th>' + esc(t('col_risk_level')) + '</th><th>' + esc(t('col_hours')) + '</th><th>' + esc(t('col_minutes')) + '</th></tr></thead><tbody>' +
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
