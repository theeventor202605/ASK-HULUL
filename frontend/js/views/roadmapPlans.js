/**
 * HULUL - Roadmap Plans admin sidebar page (RoadmapPlans.gs).
 * REQ: "After an event is created, the PM must create the event management plan, they call it
 * Roadmap ... they have normal plan, they have parachute plan and others. Add Roadmap sidebar where
 * they will be able to add types of plan. and configure how it will rollout." Two pages: a list
 * (renderRoadmapPlans) and a single plan's ordered-item editor (renderRoadmapPlanDetail) -- same
 * list-then-detail shape as Venues (venues.js), not a Settings tab, since the user explicitly asked
 * for a standalone sidebar entry, not something buried under Settings.
 */

async function renderRoadmapPlans() {
  var root = document.getElementById('viewRoot');
  var canManage = hasPermission('roadmapPlan.manage');
  var plans = await Api.call('listRoadmapPlans', {});

  root.innerHTML =
    '<div class="page-header"><div><div class="page-title">' + esc(t('nav_roadmap_plans')) + '</div>' +
    '<div class="page-subtitle">' + esc(t('roadmap_plans_subtitle')) + '</div></div>' +
    (canManage ? '<button class="btn btn-primary" id="newRoadmapPlanBtn">' + esc(t('roadmap_new_plan_btn')) + '</button>' : '') +
    '</div>' +
    '<div class="card"><div class="card-body">' +
    (plans.length ? UI.table([
      { key: 'name', label: t('col_name'), render: r => '<a href="#/roadmap-plans/' + r.id + '" style="color:var(--accent);font-weight:600;text-decoration:none;">' + esc(r.name) + '</a>' },
      { key: 'itemCount', label: t('roadmap_item_count_col'), render: r => String(r.itemCount) }
    ].concat(canManage ? [{ key: 'actions', label: t('actions'), render: r => UI.actionsCell(
        '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('action_edit')) + '" data-edit-plan="' + r.id + '">' + ICON('edit') + '</button>' +
        '<button class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('delete')) + '" data-delete-plan="' + r.id + '">' + ICON('delete') + '</button>') }] : []),
      plans, {}) : '<div class="empty-state">' + esc(t('roadmap_no_plans_yet')) + '</div>') +
    '</div></div>';

  if (!canManage) return;
  document.getElementById('newRoadmapPlanBtn').onclick = function () { openNewRoadmapPlanModal_(); };
  root.querySelectorAll('[data-edit-plan]').forEach(function (btn) {
    btn.onclick = function () {
      var plan = plans.filter(function (p) { return p.id === btn.getAttribute('data-edit-plan'); })[0];
      if (plan) openRenamePlanModal_(plan);
    };
  });
  root.querySelectorAll('[data-delete-plan]').forEach(function (btn) {
    btn.onclick = function () {
      var planId = btn.getAttribute('data-delete-plan');
      UI.confirmModal(t('roadmap_delete_plan_confirm'), async function () {
        try { await Api.call('deleteRoadmapPlan', { planId: planId }); UI.toast(t('toast_deleted'), 'success'); Router.resolve(); }
        catch (err) { UI.error(err); }
      });
    };
  });
}

function openNewRoadmapPlanModal_() {
  var body = UI.field(t('field_plan_name'), '<input id="fPlanName" class="field-input" maxlength="80" placeholder="' + esc(t('roadmap_plan_name_placeholder')) + '" />');
  UI.openModal(t('roadmap_new_plan_title'), body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('create'), className: 'btn-primary', onClick: async function () {
        var name = document.getElementById('fPlanName').value.trim();
        if (!name) { UI.toast(t('field_plan_name'), 'error'); return; }
        try {
          var plan = await Api.call('createRoadmapPlan', { name: name });
          UI.closeModal();
          window.location.hash = '#/roadmap-plans/' + plan.id;
        } catch (err) { UI.error(err); }
      } }
  ]);
}

function openRenamePlanModal_(plan) {
  var body = UI.field(t('field_plan_name'), '<input id="fEPlanName" class="field-input" maxlength="80" value="' + esc(plan.name) + '" />');
  UI.openModal(t('roadmap_rename_plan_title'), body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: t('save'), className: 'btn-primary', onClick: async function () {
        var name = document.getElementById('fEPlanName').value.trim();
        if (!name) { UI.toast(t('field_plan_name'), 'error'); return; }
        try {
          await Api.call('updateRoadmapPlan', { planId: plan.id, name: name });
          UI.closeModal(); UI.toast(t('toast_saved'), 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      } }
  ]);
}

// ---- Single plan editor: ordered item list ---------------------------------

var ROADMAP_ANCHOR_LABELS_ = {
  eventStart: 'roadmap_anchor_event_start', eventEnd: 'roadmap_anchor_event_end'
};

function roadmapAnchorLabel_(item, itemsById) {
  if (item.anchorType === 'eventStart') return t(ROADMAP_ANCHOR_LABELS_.eventStart, { term: Term('event') });
  if (item.anchorType === 'eventEnd') return t(ROADMAP_ANCHOR_LABELS_.eventEnd, { term: Term('event') });
  var anchor = itemsById[item.anchorItemId];
  return anchor ? anchor.name : t('roadmap_anchor_unknown');
}

function roadmapOffsetLabel_(item) {
  var parts = [];
  if (item.offsetWeeks) parts.push(item.offsetWeeks + ' ' + (item.offsetWeeks === 1 ? t('unit_week') : t('unit_weeks')));
  if (item.offsetDays) parts.push(item.offsetDays + ' ' + (item.offsetDays === 1 ? t('unit_day') : t('unit_days')));
  if (item.offsetHours) parts.push(item.offsetHours + ' ' + (item.offsetHours === 1 ? t('unit_hour') : t('unit_hours')));
  if (!parts.length) return t('roadmap_offset_zero');
  return parts.join(' ') + ' ' + (item.offsetSign === 'after' ? t('roadmap_offset_after') : t('roadmap_offset_before'));
}

async function renderRoadmapPlanDetail(params) {
  var root = document.getElementById('viewRoot');
  var canManage = hasPermission('roadmapPlan.manage');
  var plan, allRoles;
  try {
    var results = await Promise.all([Api.call('getRoadmapPlan', { planId: params.id }), Api.call('listAllRolesPicklist', {})]);
    plan = results[0]; allRoles = results[1];
  } catch (err) { root.innerHTML = '<div class="empty-state">' + esc(t('x_not_found', { term: t('roadmap_plan_term') })) + '</div>'; return; }

  var itemsById = {}; plan.items.forEach(function (it) { itemsById[it.id] = it; });

  root.innerHTML =
    '<div class="page-header"><div>' +
      '<a href="#/roadmap-plans" style="font-size:12px;color:var(--accent);text-decoration:none;">&larr; ' + esc(t('roadmap_back_to_plans')) + '</a>' +
      '<div class="page-title" style="margin-top:4px;">' + esc(plan.name) + '</div>' +
      '<div class="page-subtitle">' + esc(t('roadmap_plan_detail_subtitle')) + '</div>' +
    '</div>' +
    (canManage ? '<button class="btn btn-primary" id="addPlanItemBtn">' + esc(t('roadmap_add_item_btn')) + '</button>' : '') +
    '</div>' +
    '<div class="card"><div class="card-body">' +
    (plan.items.length
      ? plan.items.map(function (item, idx) { return roadmapPlanItemRowHtml_(item, idx, plan.items.length, itemsById, canManage); }).join('')
      : '<div class="empty-state">' + esc(t('roadmap_plan_no_items_yet')) + '</div>') +
    '</div></div>';

  if (!canManage) return;
  document.getElementById('addPlanItemBtn').onclick = function () { openRoadmapPlanItemModal_(plan.id, null, plan.items, allRoles); };
  wirePlanItemRows_(plan, allRoles);
}

function roadmapPlanItemRowHtml_(item, idx, count, itemsById, canManage) {
  return '<div class="roadmap-item-row" data-plan-item-id="' + esc(item.id) + '">' +
    // REQ: "Allow to change dot to icon per item" -- a small live preview of whatever icon (if any)
    // this item will show on the Event Roadmap tab's timeline instead of a plain dot.
    (item.icon ? '<span class="roadmap-item-icon-preview" title="' + esc(t('roadmap_icon_label')) + '">' + item.icon + '</span>' : '') +
    '<span class="roadmap-item-name">' + esc(item.name) +
      // REQ: "allow to choose whether an attachment is required" -- badge so the admin can tell at a
      // glance which items will block a PM's checkbox without an attachment/link first.
      (item.requiresAttachment ? ' <span class="badge badge-neutral" style="font-size:10px;">' + ICON('link') + ' ' + esc(t('roadmap_requires_attachment_badge')) + '</span>' : '') +
      // REQ follow-up: "connect roadmap plans items to actionable items or items with date time" --
      // small badge naming which automation (if any) fires when this item's due date arrives, so an
      // admin scanning the plan can tell at a glance which items are just checklist entries vs. ones
      // that actually DO something (see ROADMAP_ACTION_TYPE_LABELS_ below).
      (item.actionType ? ' <span class="badge badge-info" style="font-size:10px;">' + ICON('send') + ' ' + esc(t(ROADMAP_ACTION_TYPE_LABELS_[item.actionType])) + '</span>' : '') +
    '</span>' +
    '<span class="roadmap-item-date">' + esc(roadmapOffsetLabel_(item)) + ' ' + esc(roadmapAnchorLabel_(item, itemsById)) + '</span>' +
    (canManage ? '<span style="display:flex;gap:4px;flex:none;">' +
      '<button type="button" class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('roadmap_move_up_title')) + '"' + (idx === 0 ? ' disabled' : '') + ' data-move-up="' + esc(item.id) + '">' + ICON('chevron_up') + '</button>' +
      '<button type="button" class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('roadmap_move_down_title')) + '"' + (idx === count - 1 ? ' disabled' : '') + ' data-move-down="' + esc(item.id) + '">' + ICON('chevron_down') + '</button>' +
      '<button type="button" class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('action_edit')) + '" data-edit-plan-item="' + esc(item.id) + '">' + ICON('edit') + '</button>' +
      '<button type="button" class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('action_delete')) + '" data-delete-plan-item="' + esc(item.id) + '">' + ICON('delete') + '</button>' +
    '</span>' : '') +
  '</div>';
}

function wirePlanItemRows_(plan, allRoles) {
  document.querySelectorAll('[data-move-up]').forEach(function (btn) {
    btn.onclick = async function () {
      try { await Api.call('moveRoadmapPlanItem', { itemId: btn.getAttribute('data-move-up'), direction: 'up' }); Router.resolve(); }
      catch (err) { UI.error(err); }
    };
  });
  document.querySelectorAll('[data-move-down]').forEach(function (btn) {
    btn.onclick = async function () {
      try { await Api.call('moveRoadmapPlanItem', { itemId: btn.getAttribute('data-move-down'), direction: 'down' }); Router.resolve(); }
      catch (err) { UI.error(err); }
    };
  });
  document.querySelectorAll('[data-edit-plan-item]').forEach(function (btn) {
    btn.onclick = function () {
      var item = plan.items.filter(function (it) { return it.id === btn.getAttribute('data-edit-plan-item'); })[0];
      if (item) openRoadmapPlanItemModal_(plan.id, item, plan.items, allRoles);
    };
  });
  document.querySelectorAll('[data-delete-plan-item]').forEach(function (btn) {
    btn.onclick = function () {
      var itemId = btn.getAttribute('data-delete-plan-item');
      UI.confirmModal(t('roadmap_delete_item_confirm'), async function () {
        try {
          var result = await Api.call('deleteRoadmapPlanItem', { itemId: itemId });
          if (result.relinkedCount) UI.toast(t('roadmap_relinked_notice', { count: result.relinkedCount }), 'info');
          else UI.toast(t('toast_deleted'), 'success');
          Router.resolve();
        } catch (err) { UI.error(err); }
      });
    };
  });
}

// Add/Edit an item's name + rollout rule (anchor + signed offset) + REQ follow-ups: whether this
// item requires an attachment before a PM can mark it Done, and which icon (if any) it shows on the
// Event Roadmap tab's timeline instead of a plain dot. anchorOptions only ever lists items ABOVE this
// one in the plan (see addRoadmapPlanItem/updateRoadmapPlanItem, RoadmapPlans.gs, for why that's a
// hard backend rule, not just a UI nicety) -- when editing, that's every item whose sortOrder is less
// than the one being edited; when adding, it's every item that already exists (a brand new item is
// always appended at the end, so all of them qualify).
//
// REQ follow-up: "connect roadmap plans items to actionable items or items with date time" -- which
// automation (if any) fires the moment this item's resolved due date arrives. '' keeps the original
// purely-informational behavior. See the RoadmapPlanItems schema comment (Utils.gs) and
// validRoadmapActionInput_ (RoadmapPlans.gs) for why toRoles/ccRoles are role CODES and docTypes are
// docType CODES rather than specific Users/TemplateLibrary rows (this is a single GA-wide catalog,
// not scoped to one org).
var ROADMAP_ACTION_TYPE_LABELS_ = {
  '': 'roadmap_action_none', scheduleMeeting: 'roadmap_action_schedule_meeting',
  sendTemplates: 'roadmap_action_send_templates', reminder: 'roadmap_action_reminder'
};
var ROADMAP_ACTION_TYPES_ORDER_ = ['', 'scheduleMeeting', 'sendTemplates', 'reminder'];
// Same fixed suggestion list templateLibrary.js's own TEMPLATE_DOC_TYPES_ offers on a library entry
// (minus 'Other', which isn't a real matchable code) -- any other code is still usable via the free-
// text "additional codes" field below, isValidDocTypeCode_ (Templates.gs) is a format check, not a
// closed enum.
var ROADMAP_DOCTYPE_SUGGESTIONS_ = ['ZSMP', 'ZERP', 'TTP', 'CSM', 'SEC'];

// roleChecksHtml_/readRoleChecks_ (shared To/Cc role checkbox grid) now live in ui.js -- also used by
// meetingTemplates.js's default To/Cc roles editor.

// draftOverride: UI.openModal fully replaces #modalRoot's contents, so opening the icon picker (its
// own modal) from inside THIS modal would destroy whatever the admin already typed here. The "Browse
// icons" button below works around that by reading every current field into a plain object, closing
// this modal, opening the picker, and -- once an icon is chosen -- calling this same function again
// with that object as draftOverride so the form reopens exactly as it was, just with the new icon.
function openRoadmapPlanItemModal_(planId, existingItem, allItems, allRoles, draftOverride) {
  var isEdit = !!existingItem;
  var draft = draftOverride || (existingItem ? {
    name: existingItem.name, anchorType: existingItem.anchorType, anchorItemId: existingItem.anchorItemId,
    offsetSign: existingItem.offsetSign, offsetWeeks: existingItem.offsetWeeks, offsetDays: existingItem.offsetDays,
    offsetHours: existingItem.offsetHours, requiresAttachment: existingItem.requiresAttachment, icon: existingItem.icon,
    actionType: existingItem.actionType || '', actionConfig: existingItem.actionConfig || {}
  } : { name: '', anchorType: 'eventStart', anchorItemId: '', offsetSign: 'before', offsetWeeks: 0, offsetDays: 0, offsetHours: 0, requiresAttachment: false, icon: '', actionType: '', actionConfig: {} });

  var eligibleAnchors = allItems.filter(function (it) {
    return !existingItem || it.sortOrder < existingItem.sortOrder;
  });
  var selectedAnchorValue = draft.anchorType === 'item' ? 'item:' + draft.anchorItemId : draft.anchorType;
  var anchorOptions =
    '<option value="eventStart"' + (selectedAnchorValue === 'eventStart' ? ' selected' : '') + '>' + esc(t('roadmap_anchor_event_start', { term: Term('event') })) + '</option>' +
    '<option value="eventEnd"' + (selectedAnchorValue === 'eventEnd' ? ' selected' : '') + '>' + esc(t('roadmap_anchor_event_end', { term: Term('event') })) + '</option>' +
    eligibleAnchors.map(function (it) {
      var val = 'item:' + it.id;
      return '<option value="' + esc(val) + '"' + (val === selectedAnchorValue ? ' selected' : '') + '>' + esc(it.name) + '</option>';
    }).join('');

  var body =
    UI.field(t('field_item_name'), '<input id="fPiName" class="field-input" maxlength="120" value="' + esc(draft.name) + '" />') +
    UI.field(t('roadmap_anchor_label'), '<select id="fPiAnchor" class="field-input">' + anchorOptions + '</select>') +
    '<div class="form-row-3" style="margin-top:8px;">' +
      UI.field(t('unit_weeks'), '<input id="fPiWeeks" type="number" min="0" class="field-input" value="' + draft.offsetWeeks + '" />') +
      UI.field(t('unit_days'), '<input id="fPiDays" type="number" min="0" class="field-input" value="' + draft.offsetDays + '" />') +
      UI.field(t('unit_hours'), '<input id="fPiHours" type="number" min="0" class="field-input" value="' + draft.offsetHours + '" />') +
    '</div>' +
    UI.field(t('roadmap_offset_direction_label'), '<select id="fPiSign" class="field-input">' +
      '<option value="before"' + (draft.offsetSign === 'before' ? ' selected' : '') + '>' + esc(t('roadmap_offset_before')) + '</option>' +
      '<option value="after"' + (draft.offsetSign === 'after' ? ' selected' : '') + '>' + esc(t('roadmap_offset_after')) + '</option>' +
    '</select>') +
    // REQ: "allow to choose whether an attachment is required, if attachment is requirement check
    // will not accept unless attachment or link ... is provided" -- enforced server-side (see
    // updateEventRoadmapItem, RoadmapPlans.gs) the moment a PM tries to mark the rolled-out copy
    // Done; this checkbox is just where that requirement gets defined.
    '<label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;margin:14px 0 4px;">' +
      '<input type="checkbox" id="fPiRequiresAttachment"' + (draft.requiresAttachment ? ' checked' : '') + ' /> ' + esc(t('roadmap_requires_attachment_label')) +
    '</label>' +
    '<div class="muted" style="font-size:11px;margin:0 0 14px;">' + esc(t('roadmap_requires_attachment_hint')) + '</div>' +
    // REQ: "Allow to change dot to icon per item" -- reuses the same curated grid the app's own icon
    // customization (Settings > Icons) uses, see openIconPickerModal_ (settings.js).
    '<div class="field-label">' + esc(t('roadmap_icon_label')) + '</div>' +
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">' +
      '<div id="fPiIconPreview" style="width:34px;height:34px;border:1px solid var(--border);border-radius:8px;display:flex;align-items:center;justify-content:center;flex:none;">' + (draft.icon || '<span class="muted" style="font-size:10px;">' + esc(t('roadmap_icon_none')) + '</span>') + '</div>' +
      '<button type="button" class="btn btn-secondary btn-sm" id="fPiBrowseIconBtn">' + esc(t('roadmap_browse_icons_btn')) + '</button>' +
      (draft.icon ? '<button type="button" class="btn btn-secondary btn-sm" id="fPiClearIconBtn">' + esc(t('roadmap_clear_icon_btn')) + '</button>' : '') +
    '</div>' +
    // REQ follow-up: "connect roadmap plans items to actionable items or items with date time" -- one
    // of three automations fires automatically the moment this item's own resolved due date arrives
    // (see runRoadmapItemActions_, RoadmapPlans.gs); the panel below the select just changes to match.
    '<div class="field-label">' + esc(t('roadmap_action_label')) + '</div>' +
    '<div class="muted" style="font-size:11px;margin:0 0 8px;">' + esc(t('roadmap_action_hint')) + '</div>' +
    '<select id="fPiActionType" class="field-input" style="margin-bottom:12px;">' +
      ROADMAP_ACTION_TYPES_ORDER_.map(function (at) {
        return '<option value="' + esc(at) + '"' + (draft.actionType === at ? ' selected' : '') + '>' + esc(t(ROADMAP_ACTION_TYPE_LABELS_[at])) + '</option>';
      }).join('') +
    '</select>' +
    '<div id="fPiActionPanelScheduleMeeting" style="display:' + (draft.actionType === 'scheduleMeeting' ? 'block' : 'none') + ';">' +
      UI.field(t('roadmap_action_meeting_subject_label'), '<input id="fPiActionSubject" class="field-input" maxlength="120" placeholder="' + esc(t('roadmap_action_meeting_subject_placeholder')) + '" value="' + esc(draft.actionConfig.subject || '') + '" />') +
      '<div class="field-label" style="margin-top:8px;">' + esc(t('roadmap_action_to_roles_label')) + '</div>' +
      roleChecksHtml_('fPiActionToRoles', allRoles, draft.actionConfig.toRoles) +
      '<div class="field-label" style="margin-top:8px;">' + esc(t('roadmap_action_cc_roles_label')) + '</div>' +
      roleChecksHtml_('fPiActionCcRoles', allRoles, draft.actionConfig.ccRoles) +
    '</div>' +
    '<div id="fPiActionPanelSendTemplates" style="display:' + (draft.actionType === 'sendTemplates' ? 'block' : 'none') + ';">' +
      '<div class="field-label">' + esc(t('roadmap_action_doctypes_label')) + '</div>' +
      '<div class="muted" style="font-size:11px;margin:0 0 6px;">' + esc(t('roadmap_action_doctypes_hint')) + '</div>' +
      '<div class="roadmap-role-checks">' + ROADMAP_DOCTYPE_SUGGESTIONS_.map(function (d) {
        var checked = (draft.actionConfig.docTypes || []).indexOf(d) !== -1;
        return '<label class="roadmap-role-check-item"><input type="checkbox" class="roadmap-doctype-cb" value="' + esc(d) + '"' + (checked ? ' checked' : '') + ' /> ' + esc(d) + '</label>';
      }).join('') + '</div>' +
      UI.field(t('roadmap_action_doctypes_extra_label'), '<input id="fPiActionDocTypesExtra" class="field-input" placeholder="' + esc(t('roadmap_action_doctypes_extra_placeholder')) + '" value="' + esc((draft.actionConfig.docTypes || []).filter(function (d) { return ROADMAP_DOCTYPE_SUGGESTIONS_.indexOf(d) === -1; }).join(', ')) + '" />') +
    '</div>' +
    '<div id="fPiActionPanelReminder" style="display:' + (draft.actionType === 'reminder' ? 'block' : 'none') + ';">' +
      '<div class="field-label">' + esc(t('roadmap_action_to_roles_label')) + '</div>' +
      roleChecksHtml_('fPiActionReminderRoles', allRoles, draft.actionConfig.toRoles) +
      UI.field(t('roadmap_action_reminder_message_label'), '<textarea id="fPiActionMessage" class="field-input" rows="2" maxlength="500" placeholder="' + esc(t('roadmap_action_reminder_message_placeholder')) + '">' + esc(draft.actionConfig.message || '') + '</textarea>') +
    '</div>';

  function readActionConfigFromForm_(actionType) {
    if (actionType === 'scheduleMeeting') {
      return { subject: document.getElementById('fPiActionSubject').value, toRoles: readRoleChecks_('fPiActionToRoles'), ccRoles: readRoleChecks_('fPiActionCcRoles') };
    }
    if (actionType === 'sendTemplates') {
      var checked = Array.from(document.querySelectorAll('.roadmap-doctype-cb:checked')).map(function (cb) { return cb.value; });
      var extra = (document.getElementById('fPiActionDocTypesExtra').value || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      return { docTypes: Array.from(new Set(checked.concat(extra))) };
    }
    if (actionType === 'reminder') {
      return { toRoles: readRoleChecks_('fPiActionReminderRoles'), message: document.getElementById('fPiActionMessage').value };
    }
    return {};
  }

  function readDraftFromForm_() {
    var anchorRaw = document.getElementById('fPiAnchor').value;
    var actionType = document.getElementById('fPiActionType').value;
    return {
      name: document.getElementById('fPiName').value,
      anchorType: anchorRaw.indexOf('item:') === 0 ? 'item' : anchorRaw,
      anchorItemId: anchorRaw.indexOf('item:') === 0 ? anchorRaw.slice(5) : '',
      offsetSign: document.getElementById('fPiSign').value,
      offsetWeeks: document.getElementById('fPiWeeks').value,
      offsetDays: document.getElementById('fPiDays').value,
      offsetHours: document.getElementById('fPiHours').value,
      requiresAttachment: document.getElementById('fPiRequiresAttachment').checked,
      icon: draft.icon,
      actionType: actionType, actionConfig: readActionConfigFromForm_(actionType)
    };
  }

  UI.openModal(isEdit ? t('roadmap_edit_item_title') : t('roadmap_add_item_title'), body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: isEdit ? t('save') : t('create'), className: 'btn-primary', onClick: async function () {
        var current = readDraftFromForm_();
        var name = current.name.trim();
        if (!name) { UI.toast(t('field_item_name'), 'error'); return; }
        var payload = Object.assign({ planId: planId }, current, { name: name });
        try {
          if (isEdit) { payload.itemId = existingItem.id; await Api.call('updateRoadmapPlanItem', payload); }
          else await Api.call('addRoadmapPlanItem', payload);
          UI.closeModal(); UI.toast(t('toast_saved'), 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      } }
  ]);

  // No re-render needed for switching between action panels (unlike the icon picker's own modal-
  // stacking problem below) -- just toggle which of the three pre-rendered panels is visible so
  // whatever the admin already typed into any of them survives a change of mind.
  document.getElementById('fPiActionType').onchange = function (e) {
    var val = e.target.value;
    document.getElementById('fPiActionPanelScheduleMeeting').style.display = val === 'scheduleMeeting' ? 'block' : 'none';
    document.getElementById('fPiActionPanelSendTemplates').style.display = val === 'sendTemplates' ? 'block' : 'none';
    document.getElementById('fPiActionPanelReminder').style.display = val === 'reminder' ? 'block' : 'none';
  };

  document.getElementById('fPiBrowseIconBtn').onclick = async function () {
    var currentDraft = readDraftFromForm_();
    var customLibraries = [];
    try { customLibraries = await Api.call('getCustomIconLibraries', {}); } catch (e) { /* picker still works with just the built-in library */ }
    openIconPickerModal_(customLibraries, function (chosenIcon) {
      currentDraft.icon = chosenIcon;
      openRoadmapPlanItemModal_(planId, existingItem, allItems, allRoles, currentDraft);
    });
  };
  var clearBtn = document.getElementById('fPiClearIconBtn');
  if (clearBtn) clearBtn.onclick = function () {
    var currentDraft = readDraftFromForm_();
    currentDraft.icon = '';
    openRoadmapPlanItemModal_(planId, existingItem, allItems, currentDraft);
  };
}
