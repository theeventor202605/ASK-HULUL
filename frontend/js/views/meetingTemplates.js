/**
 * HULUL - Meeting Templates admin view (REQ: "In Meetings sidebar allow creation of templates and
 * create a template for each meeting subject. Allow admins to modify these templates and create new
 * ones."). Reached from the Meetings sidebar page (meetings.js) via a "Manage Templates" link, not a
 * nav item of its own -- same relationship the Readiness Templates' own admin catalog
 * (templateLibrary.js) has to the Templates tab on an event.
 *
 * A template is a reusable rich-text agenda/notes body per meeting Subject, scoped per Inspection
 * Company (same org-ownership convention as the Template Library). listMeetingTemplates
 * (Templates.gs) always returns one row per built-in MEETING_TYPES subject -- real if an admin has
 * saved content for it, otherwise a virtual blank placeholder -- so every subject is always here,
 * ready to fill in, with no seed step. "+ New template" is for a custom subject beyond the 12
 * built-ins; a built-in subject's own row can be edited (content only, never its subject text, so the
 * one-subject-one-template guarantee never silently drifts) but not deleted from the list -- deleting
 * just clears its saved content back to the same blank placeholder it started as.
 *
 * Reuses meetings.js's rich-text editor helpers (richTextFieldHtml_/wireRichTextField_/
 * readRichTextField_/richTextPreview_) and MEETING_TYPES -- both files are loaded on every page (no
 * per-view module system in this app), so nothing needs re-declaring here.
 */
async function renderMeetingTemplates() {
  // RBAC pilot (backend/Permissions.gs): admin-configurable from Settings > Permissions > Meetings >
  // "Create, edit, or delete meeting agenda templates".
  var canManage = hasPermission('meetingTemplate.manage');
  var isSystemAdmin = HululState.user.role === 'SystemAdmin';
  var orgs = [];
  var orgId = HululState.user.orgId;
  if (isSystemAdmin) {
    orgs = (await Api.call('listOrganizations', {})).filter(function (o) { return o.type === 'INSPECTION'; });
    orgId = (orgs[0] && orgs[0].id) || '';
  }
  // REQ follow-up: "assign default attendees roles in the To and Cc" -- fetched once here (not
  // SystemAdmin/org-admin-gated, see listAllRolesPicklist, Roles.gs) and threaded down to the
  // template editor modal for its role checkbox grids.
  var allRoles = await Api.call('listAllRolesPicklist', {});
  await renderMeetingTemplatesFor_(orgId, orgs, isSystemAdmin, canManage, allRoles);
}

function isBuiltInMeetingSubject_(subject) {
  return MEETING_TYPES.indexOf(subject) !== -1;
}

async function renderMeetingTemplatesFor_(orgId, orgs, isSystemAdmin, canManage, allRoles) {
  var root = document.getElementById('viewRoot');

  if (isSystemAdmin && !orgId) {
    root.innerHTML = '<div class="page-header"><div><div class="page-title">' + esc(t('meeting_templates_title')) + '</div></div></div>' +
      '<div class="empty-state">' + esc(t('empty_no_inspection_orgs')) + '</div>';
    return;
  }

  var templates = orgId ? await Api.call('listMeetingTemplates', { orgId: orgId }) : [];

  var orgPicker = isSystemAdmin
    ? '<div class="card" style="margin-bottom:16px;"><div class="card-body">' + UI.field(t('field_inspection_company'),
        '<select id="fMtgTplOrg" class="field-input">' +
          orgs.map(function (o) { return '<option value="' + o.id + '"' + (o.id === orgId ? ' selected' : '') + '>' + esc(o.name) + '</option>'; }).join('') +
        '</select>') + '</div></div>'
    : '';

  root.innerHTML =
    '<div class="breadcrumb"><a href="#/meetings">' + esc(Term('meeting_plural')) + '</a></div>' +
    '<div class="page-header"><div><div class="page-title">' + esc(t('meeting_templates_title')) + '</div>' +
    '<div class="page-subtitle">' + esc(t('meeting_templates_subtitle')) + '</div></div>' +
    (canManage ? '<button class="btn btn-primary" id="newMtgTplBtn">' + esc(t('new_template_btn')) + '</button>' : '') + '</div>' +
    orgPicker +
    '<div class="card"><div class="card-body">' + UI.table([
      { key: 'subject', label: t('field_meeting_type'), render: r => esc(r.subject) + (isBuiltInMeetingSubject_(r.subject) ? '' : ' <span class="badge badge-neutral" style="font-size:10px;">' + esc(t('custom_badge')) + '</span>') },
      { key: 'body', label: t('col_agenda_template'), render: r => {
        var preview = richTextPreview_(r.body, 90);
        return preview ? esc(preview) : '<span class="muted">' + esc(t('template_empty_hint')) + '</span>';
      } },
      { key: 'updatedAt', label: t('col_updated'), render: r => r.updatedAt ? UI.fmtDate(r.updatedAt) : '—' }
    ].concat(canManage ? [{ key: 'actions', label: t('actions'), render: r => UI.actionsCell(
        '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('action_edit')) + '" data-edit-mtg-tpl="' + esc(r.id || ('subj:' + r.subject)) + '">' + ICON('edit') + '</button> ' +
        (r.id ? '<button class="btn btn-secondary btn-sm btn-icon btn-danger" title="' + esc(t('action_delete')) + '" data-delete-mtg-tpl="' + esc(r.id) + '">' + ICON('delete') + '</button>' : '')
      ) }] : []),
      templates, { emptyText: esc(t('empty_no_templates')) }) + '</div></div>';

  if (isSystemAdmin) {
    document.getElementById('fMtgTplOrg').onchange = function () { renderMeetingTemplatesFor_(this.value, orgs, true, canManage, allRoles); };
  }
  if (canManage) {
    document.getElementById('newMtgTplBtn').onclick = function () { openMeetingTemplateModal_(null, orgId, orgs, isSystemAdmin, canManage, allRoles); };
    document.querySelectorAll('[data-edit-mtg-tpl]').forEach(function (btn) {
      btn.onclick = function () {
        var key = btn.getAttribute('data-edit-mtg-tpl');
        var tpl = key.indexOf('subj:') === 0
          ? templates.filter(function (x) { return !x.id && x.subject === key.slice(5); })[0]
          : templates.filter(function (x) { return x.id === key; })[0];
        if (tpl) openMeetingTemplateModal_(tpl, orgId, orgs, isSystemAdmin, canManage, allRoles);
      };
    });
    document.querySelectorAll('[data-delete-mtg-tpl]').forEach(function (btn) {
      btn.onclick = async function () {
        if (!confirm(t('confirm_delete_template'))) return;
        try {
          await Api.call('deleteMeetingTemplate', { id: btn.getAttribute('data-delete-mtg-tpl') });
          UI.toast(t('toast_deleted'), 'success');
          renderMeetingTemplatesFor_(orgId, orgs, isSystemAdmin, canManage, allRoles);
        } catch (err) { UI.error(err); }
      };
    });
  }
}

// tpl === null -> "+ New template" (free-text subject, since every built-in already has its own
// always-present row -- there'd be nothing left to "create new" for otherwise). Editing an existing
// row (built-in or custom) never lets the subject text change -- for a built-in that's what keeps the
// one-subject-one-template guarantee from silently drifting; for a custom one it's just simpler (a
// rename is really "make a new one, delete the old", already possible via the two actions
// separately) and avoids ever accidentally colliding two rows onto the same subject.
function openMeetingTemplateModal_(tpl, orgId, orgs, isSystemAdmin, canManage, allRoles) {
  var isNew = !tpl;
  var subjectHtml = isNew
    ? UI.field(t('field_meeting_type'), '<input id="fMtgTplSubject" class="field-input" placeholder="' + esc(t('custom_subject_placeholder')) + '" />')
    : '<div style="font-weight:600;font-size:14px;margin-bottom:10px;">' + esc(tpl.subject) +
        (isBuiltInMeetingSubject_(tpl.subject) ? '' : ' <span class="badge badge-neutral" style="font-size:10px;">' + esc(t('custom_badge')) + '</span>') + '</div>';
  // REQ follow-up: "In Meeting Templates I would like to assign default attendees roles in the To
  // and Cc." Role CODES (not specific Users -- see MeetingTemplates schema comment, Utils.gs),
  // resolved against the real Users at whichever Event the New Meeting form is actually for (see
  // applyTemplateToForm_, meetings.js) -- same reasoning/mechanism as the Roadmap Plans item editor's
  // own scheduleMeeting action (roleChecksHtml_/readRoleChecks_, ui.js).
  var rolesHtml =
    '<div class="field-label" style="margin-top:14px;">' + esc(t('field_default_to_roles')) + '</div>' +
    roleChecksHtml_('fMtgTplToRoles', allRoles, isNew ? [] : tpl.defaultToRoles) +
    '<div class="field-label">' + esc(t('field_default_cc_roles')) + '</div>' +
    roleChecksHtml_('fMtgTplCcRoles', allRoles, isNew ? [] : tpl.defaultCcRoles) +
    '<div class="muted" style="font-size:11px;margin:-6px 0 4px;">' + esc(t('default_roles_hint')) + '</div>';
  var body = subjectHtml + richTextFieldHtml_('fMtgTplBody', t('col_agenda_template'), isNew ? '' : (tpl.body || '')) + rolesHtml;

  UI.openModal(isNew ? t('new_template_title') : t('edit_x', { term: Term('template') }), body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('save'), className: 'btn-primary', onClick: async function () {
        var subject = isNew ? document.getElementById('fMtgTplSubject').value.trim() : tpl.subject;
        if (!subject) { UI.toast(t('toast_subject_required'), 'error'); return; }
        try {
          var payload = {
            orgId: orgId, subject: subject, body: readRichTextField_('fMtgTplBody'),
            toRoles: readRoleChecks_('fMtgTplToRoles'), ccRoles: readRoleChecks_('fMtgTplCcRoles')
          };
          if (!isNew && tpl.id) payload.id = tpl.id;
          await Api.call('saveMeetingTemplate', payload);
          UI.closeModal(); UI.toast(t('toast_template_saved'), 'success');
          renderMeetingTemplatesFor_(orgId, orgs, isSystemAdmin, canManage, allRoles);
        } catch (err) { UI.error(err); }
      } }
  ]);
  wireRichTextField_('fMtgTplBody');
}
