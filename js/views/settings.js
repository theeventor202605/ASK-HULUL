/**
 * HULUL - Settings: profile + language + change password.
 */
async function renderSettings() {
  var root = document.getElementById('viewRoot');
  var u = HululState.user;
  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + t('nav_settings') + '</div></div></div>' +
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">Profile</div></div>' +
    '<div class="card-body">' + infoRow('Name', u.name) + infoRow('Email', u.email) + infoRow('Role', u.role) + infoRow('Organization', u.orgId) + '</div></div>' +
    '<div class="card" style="margin-bottom:16px;"><div class="card-header"><div class="card-title">Language</div></div>' +
    '<div class="card-body"><button class="btn btn-secondary btn-sm" id="settingsLangBtn">Switch to ' + (HululState.lang === 'en' ? 'العربية' : 'English') + '</button></div></div>' +
    '<div class="card"><div class="card-header"><div class="card-title">Change password</div></div>' +
    '<div class="card-body">' + UI.field('Current password', '<input id="fOldPw" type="password" class="field-input" />') +
    UI.field('New password', '<input id="fNewPw" type="password" class="field-input" />') +
    '<button class="btn btn-primary btn-sm" id="changePwBtn" style="margin-top:10px;">Update password</button></div></div>';

  document.getElementById('settingsLangBtn').onclick = toggleLanguage;
  document.getElementById('changePwBtn').onclick = async function () {
    try {
      await Api.call('changePassword', { oldPassword: document.getElementById('fOldPw').value, newPassword: document.getElementById('fNewPw').value });
      UI.toast('Password updated', 'success');
    } catch (err) { UI.error(err); }
  };
}
