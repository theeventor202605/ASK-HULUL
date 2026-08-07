/**
 * HULUL - Config admin view (SystemAdmin only). Key/value settings such as
 * escalationTier2DelayHours / escalationTier3DelayHours (Setup.gs seeds the defaults).
 */
async function renderConfig() {
  var root = document.getElementById('viewRoot');
  var rows = await Api.call('listConfig', {});
  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + t('nav_config') + '</div>' +
    '<div class="page-subtitle">System settings (escalation timers, etc.)</div></div>' +
    '<button class="btn btn-primary" id="newCfgBtn">+ New / update setting</button></div>' +
    '<div class="card"><div class="card-body">' + UI.table([
      { key: 'key', label: 'Key' }, { key: 'value', label: 'Value' },
      { key: 'actions', label: t('actions'), render: r => '<button class="btn btn-secondary btn-sm" data-edit="' + esc(r.key) + '" data-value="' + esc(r.value) + '">Edit</button>' }
    ], rows, {}) + '</div></div>';

  document.getElementById('newCfgBtn').onclick = () => openCfgModal('', '');
  root.querySelectorAll('[data-edit]').forEach(function (b) {
    b.onclick = () => openCfgModal(b.getAttribute('data-edit'), b.getAttribute('data-value'));
  });

  function openCfgModal(key, value) {
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
}
