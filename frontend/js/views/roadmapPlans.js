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
  var plan;
  try { plan = await Api.call('getRoadmapPlan', { planId: params.id }); }
  catch (err) { root.innerHTML = '<div class="empty-state">' + esc(t('x_not_found', { term: t('roadmap_plan_term') })) + '</div>'; return; }

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
  document.getElementById('addPlanItemBtn').onclick = function () { openRoadmapPlanItemModal_(plan.id, null, plan.items); };
  wirePlanItemRows_(plan);
}

function roadmapPlanItemRowHtml_(item, idx, count, itemsById, canManage) {
  return '<div class="roadmap-item-row" data-plan-item-id="' + esc(item.id) + '">' +
    '<span class="roadmap-item-name">' + esc(item.name) + '</span>' +
    '<span class="roadmap-item-date">' + esc(roadmapOffsetLabel_(item)) + ' ' + esc(roadmapAnchorLabel_(item, itemsById)) + '</span>' +
    (canManage ? '<span style="display:flex;gap:4px;flex:none;">' +
      '<button type="button" class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('roadmap_move_up_title')) + '"' + (idx === 0 ? ' disabled' : '') + ' data-move-up="' + esc(item.id) + '">' + ICON('chevron_up') + '</button>' +
      '<button type="button" class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('roadmap_move_down_title')) + '"' + (idx === count - 1 ? ' disabled' : '') + ' data-move-down="' + esc(item.id) + '">' + ICON('chevron_down') + '</button>' +
      '<button type="button" class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('action_edit')) + '" data-edit-plan-item="' + esc(item.id) + '">' + ICON('edit') + '</button>' +
      '<button type="button" class="btn btn-secondary btn-sm btn-icon" title="' + esc(t('action_delete')) + '" data-delete-plan-item="' + esc(item.id) + '">' + ICON('delete') + '</button>' +
    '</span>' : '') +
  '</div>';
}

function wirePlanItemRows_(plan) {
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
      if (item) openRoadmapPlanItemModal_(plan.id, item, plan.items);
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

// Add/Edit an item's name + rollout rule (anchor + signed offset). anchorOptions only ever lists
// items ABOVE this one in the plan (see addRoadmapPlanItem/updateRoadmapPlanItem, RoadmapPlans.gs,
// for why that's a hard backend rule, not just a UI nicety) -- when editing, that's every item whose
// sortOrder is less than the one being edited; when adding, it's every item that already exists
// (a brand new item is always appended at the end, so all of them qualify).
function openRoadmapPlanItemModal_(planId, existingItem, allItems) {
  var isEdit = !!existingItem;
  var eligibleAnchors = allItems.filter(function (it) {
    return !existingItem || it.sortOrder < existingItem.sortOrder;
  });
  var anchorOptions =
    '<option value="eventStart">' + esc(t('roadmap_anchor_event_start', { term: Term('event') })) + '</option>' +
    '<option value="eventEnd">' + esc(t('roadmap_anchor_event_end', { term: Term('event') })) + '</option>' +
    eligibleAnchors.map(function (it) { return '<option value="item:' + esc(it.id) + '">' + esc(it.name) + '</option>'; }).join('');
  var selectedAnchorValue = existingItem
    ? (existingItem.anchorType === 'item' ? 'item:' + existingItem.anchorItemId : existingItem.anchorType)
    : 'eventStart';

  var body =
    UI.field(t('field_item_name'), '<input id="fPiName" class="field-input" maxlength="120" value="' + esc(existingItem ? existingItem.name : '') + '" />') +
    UI.field(t('roadmap_anchor_label'), '<select id="fPiAnchor" class="field-input">' + anchorOptions + '</select>') +
    '<div class="form-row-3" style="margin-top:8px;">' +
      UI.field(t('unit_weeks'), '<input id="fPiWeeks" type="number" min="0" class="field-input" value="' + (existingItem ? existingItem.offsetWeeks : 0) + '" />') +
      UI.field(t('unit_days'), '<input id="fPiDays" type="number" min="0" class="field-input" value="' + (existingItem ? existingItem.offsetDays : 0) + '" />') +
      UI.field(t('unit_hours'), '<input id="fPiHours" type="number" min="0" class="field-input" value="' + (existingItem ? existingItem.offsetHours : 0) + '" />') +
    '</div>' +
    UI.field(t('roadmap_offset_direction_label'), '<select id="fPiSign" class="field-input">' +
      '<option value="before"' + (!existingItem || existingItem.offsetSign === 'before' ? ' selected' : '') + '>' + esc(t('roadmap_offset_before')) + '</option>' +
      '<option value="after"' + (existingItem && existingItem.offsetSign === 'after' ? ' selected' : '') + '>' + esc(t('roadmap_offset_after')) + '</option>' +
    '</select>');

  UI.openModal(isEdit ? t('roadmap_edit_item_title') : t('roadmap_add_item_title'), body, [
    { label: t('cancel'), className: 'btn-secondary', onClick: UI.closeModal },
    { label: isEdit ? t('save') : t('create'), className: 'btn-primary', onClick: async function () {
        var name = document.getElementById('fPiName').value.trim();
        if (!name) { UI.toast(t('field_item_name'), 'error'); return; }
        var anchorRaw = document.getElementById('fPiAnchor').value;
        var payload = {
          planId: planId, name: name,
          anchorType: anchorRaw.indexOf('item:') === 0 ? 'item' : anchorRaw,
          anchorItemId: anchorRaw.indexOf('item:') === 0 ? anchorRaw.slice(5) : '',
          offsetSign: document.getElementById('fPiSign').value,
          offsetWeeks: document.getElementById('fPiWeeks').value,
          offsetDays: document.getElementById('fPiDays').value,
          offsetHours: document.getElementById('fPiHours').value
        };
        try {
          if (isEdit) { payload.itemId = existingItem.id; await Api.call('updateRoadmapPlanItem', payload); }
          else await Api.call('addRoadmapPlanItem', payload);
          UI.closeModal(); UI.toast(t('toast_saved'), 'success'); Router.resolve();
        } catch (err) { UI.error(err); }
      } }
  ]);
}
