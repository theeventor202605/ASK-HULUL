/**
 * HULUL - RoadmapPlans.gs
 * REQ: "After an event is created, the PM must create the event management plan, they call it
 * Roadmap. Usually it is similar to the below, depending on how they categorize the event. So they
 * have normal plan, they have parachute plan and others. Add Roadmap sidebar where they will be able
 * to add types of plan. and configure how it will rollout. for example: Event Kick Off Meeting 3
 * weeks before event start date. EMC Download Ops Docs 3 weeks 3 days before event start date.
 * Doc. Sub. Reminder 5 days after Event Kick Off Meeting; and so on."
 *
 * Two layers, same split as TemplateLibrary (shared catalog) vs. Templates (per-event copy):
 *  - RoadmapPlans / RoadmapPlanItems: admin-defined, reusable named templates ("Normal Plan",
 *    "Parachute Plan") -- managed from the new Roadmap Plans sidebar page (Settings-adjacent, not
 *    inside Settings itself, since the user explicitly asked for a sidebar entry). Each item's
 *    rollout rule is an offset anchored either to the Event's own start/end date, or to another item
 *    already in the same plan (chained relative offsets) -- see resolveOffsetMs_/rolloutEventRoadmap_.
 *  - EventRoadmapItems: the materialized, dated copy for one specific Event, created the moment that
 *    Event is created with a planTypeId set (createEvent, Events.gs) and re-synced on demand via
 *    generateEventRoadmap ("Regenerate" button, Event > Roadmap tab). A PM can also add/remove/edit
 *    individual items on just their one Event without touching the shared template (sourceItemId is
 *    blank for those -- regenerate never touches them).
 */

// ---- Plan templates (admin catalog) ---------------------------------------

function getRoadmapPlanItems_(planId) {
  return findWhere('RoadmapPlanItems', function (it) { return it.planId === planId && it.status !== 'Deleted'; })
    .sort(function (a, b) { return Number(a.sortOrder) - Number(b.sortOrder); })
    .map(function (it) {
      return {
        id: it.id, planId: it.planId, name: it.name, sortOrder: Number(it.sortOrder),
        anchorType: it.anchorType, anchorItemId: it.anchorItemId || '',
        offsetSign: it.offsetSign, offsetWeeks: Number(it.offsetWeeks) || 0,
        offsetDays: Number(it.offsetDays) || 0, offsetHours: Number(it.offsetHours) || 0,
        requiresAttachment: it.requiresAttachment === true || it.requiresAttachment === 'true',
        icon: it.icon || '',
        actionType: it.actionType || '', actionConfig: parseRoadmapActionConfig_(it.actionConfig)
      };
    });
}

// Safe parse -- actionConfig is only ever written by validRoadmapActionInput_ below, but guarded the
// same way every other JSON-in-a-cell field in this app is (see meetingRecipientIdsFromJson_,
// Templates.gs) so a hand-edited/blank cell can never crash a read.
function parseRoadmapActionConfig_(raw) {
  if (!raw) return {};
  try { var parsed = JSON.parse(raw); return (parsed && typeof parsed === 'object') ? parsed : {}; }
  catch (e) { return {}; }
}

// Every active plan template (id/name only -- used by the Create Event "Plan Type" dropdown and the
// Roadmap Plans list page). Open to any authenticated user, same reasoning as listParticipantTypes:
// plan names aren't sensitive, and any GA/EMC/Inspection user creating or viewing an Event's Roadmap
// needs this list.
function listRoadmapPlans(user) {
  if (!user) throw new HululError('UNAUTHENTICATED', 'Login required');
  return findWhere('RoadmapPlans', function (p) { return p.status === 'Active'; })
    .map(function (p) { return { id: p.id, name: p.name, createdAt: p.createdAt, itemCount: getRoadmapPlanItems_(p.id).length }; })
    .sort(function (a, b) { return a.name.localeCompare(b.name); });
}

// Single plan + its full ordered item list -- the Roadmap Plans editor's "open a plan" view.
function getRoadmapPlan(user, p) {
  if (!user) throw new HululError('UNAUTHENTICATED', 'Login required');
  var plan = getById('RoadmapPlans', p && p.planId);
  if (!plan || plan.status !== 'Active') throw new HululError('NOT_FOUND', 'Roadmap plan not found');
  return { id: plan.id, name: plan.name, createdAt: plan.createdAt, items: getRoadmapPlanItems_(plan.id) };
}

function createRoadmapPlan(user, p) {
  requirePermission(user, 'roadmapPlan.manage');
  var name = String((p && p.name) || '').trim();
  if (!name) throw new HululError('BAD_REQUEST', 'A plan name is required');
  var row = insertRow('RoadmapPlans', { id: newId('RoadmapPlans'), name: name, status: 'Active', createdBy: user.id, createdAt: nowIso_() });
  audit(user.id, 'CREATE_ROADMAP_PLAN', 'RoadmapPlans', row.id, { name: name });
  return { id: row.id, name: row.name, createdAt: row.createdAt, items: [] };
}

function updateRoadmapPlan(user, p) {
  requirePermission(user, 'roadmapPlan.manage');
  var plan = getById('RoadmapPlans', p && p.planId);
  if (!plan || plan.status !== 'Active') throw new HululError('NOT_FOUND', 'Roadmap plan not found');
  var name = String((p && p.name) || '').trim();
  if (!name) throw new HululError('BAD_REQUEST', 'A plan name is required');
  var updated = updateRow('RoadmapPlans', plan.id, { name: name });
  audit(user.id, 'UPDATE_ROADMAP_PLAN', 'RoadmapPlans', plan.id, { name: name });
  return { id: updated.id, name: updated.name };
}

// Soft-delete only (status -> 'Inactive'), same reasoning as deleteRole -- Events already rolled out
// from this plan keep their own materialized EventRoadmapItems rows (planId there is just informational
// provenance), so retiring the template doesn't touch any Event that already used it. Its items are
// left in place too (harmless once the plan itself is inactive and can't be picked or opened again).
function deleteRoadmapPlan(user, p) {
  requirePermission(user, 'roadmapPlan.manage');
  var plan = getById('RoadmapPlans', p && p.planId);
  if (!plan || plan.status !== 'Active') throw new HululError('NOT_FOUND', 'Roadmap plan not found');
  updateRow('RoadmapPlans', plan.id, { status: 'Inactive' });
  audit(user.id, 'DELETE_ROADMAP_PLAN', 'RoadmapPlans', plan.id, { name: plan.name });
  return { ok: true };
}

var ROADMAP_ANCHOR_TYPES_ = ['eventStart', 'eventEnd', 'item'];
var ROADMAP_OFFSET_SIGNS_ = ['before', 'after'];

// REQ follow-up: "connect roadmap plans items to actionable items or items with date time" -- '' is
// the original, purely-informational behavior (nothing fires when the item's due date arrives, a PM
// just sees it on the checklist). See the RoadmapPlanItems schema comment (Utils.gs) for why these
// reference role CODES and docType CODES rather than specific Users/TemplateLibrary rows.
var ROADMAP_ACTION_TYPES_ = ['', 'scheduleMeeting', 'sendTemplates', 'reminder'];

// Cleans a raw role-code array down to real, de-duplicated, currently-valid role codes (built-in or
// active custom) -- same "silently drop anything bad instead of hard-failing" posture as
// meetingRecipientIds_ (Templates.gs), since a role retired after a plan item was configured to use
// it shouldn't block every future save of that item.
function validRoadmapRoleList_(raw) {
  if (!Array.isArray(raw)) return [];
  var valid = {}; allRoleCodes_().forEach(function (r) { valid[r] = true; });
  var seen = {}, out = [];
  raw.forEach(function (r) {
    r = String(r || '').trim();
    if (!r || seen[r] || !valid[r]) return;
    seen[r] = true; out.push(r);
  });
  return out;
}

// Validates actionType + builds the type-specific actionConfig object, returned pre-serialized
// (actionConfig: a JSON string, '' when actionType is '') ready to spread straight into the
// RoadmapPlanItems insert/update row -- mirrors how validRoadmapItemInput_ already hands back
// ready-to-store fields for everything else on the item.
function validRoadmapActionInput_(p) {
  var actionType = (p && p.actionType) || '';
  if (ROADMAP_ACTION_TYPES_.indexOf(actionType) === -1) throw new HululError('BAD_REQUEST', 'Invalid actionType');
  if (!actionType) return { actionType: '', actionConfig: '' };
  var raw = (p && p.actionConfig) || {};
  var config;
  if (actionType === 'scheduleMeeting') {
    // subject falls back to the item's own name at fire time if left blank here (see
    // autoScheduleRoadmapMeeting_) -- not defaulted here so an edit that only changes the item's name
    // later still flows through to a not-yet-fired meeting's subject.
    config = {
      subject: String(raw.subject || '').trim().slice(0, 120),
      toRoles: validRoadmapRoleList_(raw.toRoles), ccRoles: validRoadmapRoleList_(raw.ccRoles)
    };
  } else if (actionType === 'sendTemplates') {
    // Empty docTypes means "every Readiness template currently in the event's Inspection Company
    // library" -- see autoSendRoadmapTemplates_. isValidDocTypeCode_ (Templates.gs) is the same
    // format check createLibraryTemplate/updateLibraryTemplate already apply to a library entry's own
    // docType, so anything selectable here is guaranteed to be able to actually match one.
    config = { docTypes: (Array.isArray(raw.docTypes) ? raw.docTypes : []).filter(function (d) { return isValidDocTypeCode_(d); }) };
  } else { // reminder
    config = { toRoles: validRoadmapRoleList_(raw.toRoles), message: String(raw.message || '').trim().slice(0, 500) };
  }
  return { actionType: actionType, actionConfig: JSON.stringify(config) };
}

function validRoadmapItemInput_(p, planId) {
  var name = String((p && p.name) || '').trim();
  if (!name) throw new HululError('BAD_REQUEST', 'An item name is required');
  var anchorType = (p && p.anchorType) || 'eventStart';
  if (ROADMAP_ANCHOR_TYPES_.indexOf(anchorType) === -1) throw new HululError('BAD_REQUEST', 'Invalid anchorType');
  var anchorItemId = '';
  if (anchorType === 'item') {
    anchorItemId = (p && p.anchorItemId) || '';
    // Anchoring only to an item ALREADY in this plan -- since new items are always appended at the
    // end (sortOrder = current max + 1, see addRoadmapPlanItem), any existing row here is guaranteed
    // to sit earlier in the list than the one being saved, so this single existence check also
    // guarantees no forward reference or cycle is possible -- no separate topological check needed.
    var anchorRow = findWhere('RoadmapPlanItems', function (it) { return it.id === anchorItemId && it.planId === planId && it.status !== 'Deleted'; })[0];
    if (!anchorRow) throw new HululError('BAD_REQUEST', 'anchorItemId must reference an existing item already in this plan');
  }
  var offsetSign = (p && p.offsetSign) || 'before';
  if (ROADMAP_OFFSET_SIGNS_.indexOf(offsetSign) === -1) throw new HululError('BAD_REQUEST', 'Invalid offsetSign');
  function nonNegInt_(v) { var n = Number(v || 0); return (isNaN(n) || n < 0) ? 0 : Math.floor(n); }
  return Object.assign({
    name: name, anchorType: anchorType, anchorItemId: anchorItemId, offsetSign: offsetSign,
    offsetWeeks: nonNegInt_(p && p.offsetWeeks), offsetDays: nonNegInt_(p && p.offsetDays), offsetHours: nonNegInt_(p && p.offsetHours),
    // requiresAttachment (REQ: "allow to choose whether an attachment is required") -- enforced later,
    // per-Event, when a PM tries to mark the rolled-out copy Done (updateEventRoadmapItem below), not
    // here -- a plan item has no attachment of its own to check. icon (REQ: "Allow to change dot to
    // icon per item") -- raw SVG markup/typed glyph from openIconPickerModal_ (settings.js), or blank
    // to keep the plain colored dot on the Event Roadmap tab's timeline; capped well above any real
    // icon's length purely as a sanity bound, not a meaningful validation.
    requiresAttachment: !!(p && p.requiresAttachment),
    icon: String((p && p.icon) || '').slice(0, 2000)
  }, validRoadmapActionInput_(p));
}

// Always appended at the end of the plan (see comment in validRoadmapItemInput_ for why this matters
// beyond just display order). Reordering (moveRoadmapPlanItem below) can only move a same-or-later
// item downward past it, or an item back up -- never past its own anchor -- enforced there.
function addRoadmapPlanItem(user, p) {
  requirePermission(user, 'roadmapPlan.manage');
  var plan = getById('RoadmapPlans', p && p.planId);
  if (!plan || plan.status !== 'Active') throw new HululError('NOT_FOUND', 'Roadmap plan not found');
  var input = validRoadmapItemInput_(p, plan.id);
  var existing = getRoadmapPlanItems_(plan.id);
  var nextOrder = existing.length ? Math.max.apply(null, existing.map(function (it) { return it.sortOrder; })) + 1 : 0;
  var row = insertRow('RoadmapPlanItems', Object.assign({ id: newId('RoadmapPlanItems'), planId: plan.id, sortOrder: nextOrder, status: 'Active' }, input));
  audit(user.id, 'ADD_ROADMAP_PLAN_ITEM', 'RoadmapPlanItems', row.id, { planId: plan.id, name: input.name });
  return getRoadmapPlanItems_(plan.id);
}

function updateRoadmapPlanItem(user, p) {
  requirePermission(user, 'roadmapPlan.manage');
  var item = getById('RoadmapPlanItems', p && p.itemId);
  if (!item || item.status !== 'Active') throw new HululError('NOT_FOUND', 'Roadmap plan item not found');
  var input = validRoadmapItemInput_(p, item.planId);
  // An item can't anchor to itself, and (since anchoring only to an already-earlier item is allowed
  // at all, see validRoadmapItemInput_) can't anchor to anything at or after its own sortOrder either
  // -- both would create a cycle or a forward reference once this save lands.
  if (input.anchorType === 'item' && input.anchorItemId === item.id) {
    throw new HululError('BAD_REQUEST', 'An item cannot be anchored to itself');
  }
  if (input.anchorType === 'item') {
    var anchor = getById('RoadmapPlanItems', input.anchorItemId);
    if (anchor && Number(anchor.sortOrder) >= Number(item.sortOrder)) {
      throw new HululError('BAD_REQUEST', 'Can only anchor to an item earlier in the plan');
    }
  }
  var updated = updateRow('RoadmapPlanItems', item.id, input);
  audit(user.id, 'UPDATE_ROADMAP_PLAN_ITEM', 'RoadmapPlanItems', item.id, input);
  return getRoadmapPlanItems_(updated.planId);
}

// Soft-delete + also clear any OTHER item in the same plan that anchored to this one, falling them
// back to anchoring on the Event's own start date -- otherwise saving/rolling out the plan later
// would hit an anchorItemId pointing at a row that no longer resolves. Surfaced back to the caller
// (relinkedCount) so the editor can tell the admin this happened rather than silently changing their
// plan's meaning.
function deleteRoadmapPlanItem(user, p) {
  requirePermission(user, 'roadmapPlan.manage');
  var item = getById('RoadmapPlanItems', p && p.itemId);
  if (!item || item.status !== 'Active') throw new HululError('NOT_FOUND', 'Roadmap plan item not found');
  updateRow('RoadmapPlanItems', item.id, { status: 'Deleted' });
  var dependents = findWhere('RoadmapPlanItems', function (it) { return it.planId === item.planId && it.anchorItemId === item.id && it.status === 'Active'; });
  dependents.forEach(function (dep) { updateRow('RoadmapPlanItems', dep.id, { anchorType: 'eventStart', anchorItemId: '' }); });
  audit(user.id, 'DELETE_ROADMAP_PLAN_ITEM', 'RoadmapPlanItems', item.id, { planId: item.planId, relinkedCount: dependents.length });
  return { items: getRoadmapPlanItems_(item.planId), relinkedCount: dependents.length };
}

// Swaps this item's sortOrder with its immediate neighbor in the given direction ('up'|'down').
// Blocked if the swap would leave an 'item' anchor pointing FORWARD (an anchor must always have a
// smaller sortOrder than its dependent -- see validRoadmapItemInput_). Only the pair actually being
// swapped can ever break that: whichever of the two currently sits LATER in the list is the only one
// that could legally be anchored to the other (the earlier one) in the first place, so it's the only
// direction worth checking -- everything else in the plan keeps its position, so every other item's
// anchor stays exactly as valid/invalid as it already was. Deliberately keyed off original sortOrder,
// not off which one the caller asked to move "up" vs "down", since that's what actually determines
// which anchor relationship (if any) is even possible here.
function moveRoadmapPlanItem(user, p) {
  requirePermission(user, 'roadmapPlan.manage');
  var item = getById('RoadmapPlanItems', p && p.itemId);
  if (!item || item.status !== 'Active') throw new HululError('NOT_FOUND', 'Roadmap plan item not found');
  var dir = (p && p.direction) === 'up' ? 'up' : 'down';
  var items = getRoadmapPlanItems_(item.planId);
  var idx = items.map(function (it) { return it.id; }).indexOf(item.id);
  var swapIdx = dir === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= items.length) return items; // already at an edge -- no-op
  var a = items[idx], b = items[swapIdx];
  var later = a.sortOrder > b.sortOrder ? a : b, earlier = later === a ? b : a;
  if (later.anchorType === 'item' && later.anchorItemId === earlier.id) {
    throw new HululError('CONFLICT', later.name + ' is anchored to ' + earlier.name + ' -- move it away from its anchor first');
  }
  updateRow('RoadmapPlanItems', a.id, { sortOrder: b.sortOrder });
  updateRow('RoadmapPlanItems', b.id, { sortOrder: a.sortOrder });
  audit(user.id, 'REORDER_ROADMAP_PLAN_ITEM', 'RoadmapPlanItems', item.id, { planId: item.planId, direction: dir });
  return getRoadmapPlanItems_(item.planId);
}

// ---- Rollout engine (per-Event materialization) ---------------------------

var ROADMAP_MS_PER_HOUR_ = 60 * 60 * 1000;
var ROADMAP_MS_PER_DAY_ = 24 * ROADMAP_MS_PER_HOUR_;
var ROADMAP_MS_PER_WEEK_ = 7 * ROADMAP_MS_PER_DAY_;

// Signed millisecond delta from the anchor instant: negative for "before", positive for "after" --
// so callers just do `new Date(anchorMs + resolveOffsetMs_(item))`.
function resolveOffsetMs_(item) {
  var magnitude = (Number(item.offsetWeeks) || 0) * ROADMAP_MS_PER_WEEK_ +
    (Number(item.offsetDays) || 0) * ROADMAP_MS_PER_DAY_ + (Number(item.offsetHours) || 0) * ROADMAP_MS_PER_HOUR_;
  return item.offsetSign === 'after' ? magnitude : -magnitude;
}

// Resolves every item in a plan to an absolute ms instant, in sortOrder order -- by construction
// (validRoadmapItemInput_/moveRoadmapPlanItem both guarantee an 'item' anchor always has a smaller
// sortOrder than its dependent) a single forward pass is always enough; no item is ever visited
// before the anchor it depends on. Throws if that invariant was somehow violated anyway (e.g. a
// pre-existing row from before those guards existed) rather than silently producing a wrong date.
function resolveRoadmapPlanDates_(items, eventStartMs, eventEndMs) {
  var resolvedById = {};
  var out = [];
  items.forEach(function (item) {
    var anchorMs;
    if (item.anchorType === 'eventStart') anchorMs = eventStartMs;
    else if (item.anchorType === 'eventEnd') anchorMs = eventEndMs;
    else {
      if (resolvedById[item.anchorItemId] === undefined) {
        throw new HululError('SERVER_ERROR', 'Roadmap plan item "' + item.name + '" is anchored out of order -- fix it in Roadmap Plans');
      }
      anchorMs = resolvedById[item.anchorItemId];
    }
    var dueMs = anchorMs + resolveOffsetMs_(item);
    resolvedById[item.id] = dueMs;
    out.push({ item: item, dueMs: dueMs });
  });
  return out;
}

// Upsert, not wipe-and-recreate -- called both right after createEvent (nothing to upsert against
// yet, so every row is an insert) and from generateEventRoadmap ("Regenerate", Event > Roadmap tab,
// e.g. after the Event's own start/end date changed). Matches existing EventRoadmapItems rows by
// sourceItemId: an already-generated item gets its dueAt recomputed but keeps its status/completedAt
// (a PM's "Done" isn't wiped out by a date-only regenerate); a plan item added since the last rollout
// gets a new row; a plan item that's been removed from the template gets its row deleted. Ad hoc items
// a PM added directly on this one Event (sourceItemId === '') are never touched by any of this.
function rolloutEventRoadmap_(user, event, planId) {
  var plan = getById('RoadmapPlans', planId);
  if (!plan) throw new HululError('NOT_FOUND', 'Roadmap plan not found');
  var items = getRoadmapPlanItems_(planId);
  var eventStartMs = new Date(event.startDateTime).getTime();
  var eventEndMs = new Date(event.endDateTime).getTime();
  if (isNaN(eventStartMs) || isNaN(eventEndMs)) {
    throw new HululError('BAD_REQUEST', 'Event must have valid start/end dates before a Roadmap plan can be rolled out');
  }
  var resolved = resolveRoadmapPlanDates_(items, eventStartMs, eventEndMs);

  var existingRows = findWhere('EventRoadmapItems', function (r) { return r.eventId === event.id && r.sourceItemId; });
  var existingBySourceId = {};
  existingRows.forEach(function (r) { existingBySourceId[r.sourceItemId] = r; });
  var stillPresentSourceIds = {};

  resolved.forEach(function (entry) {
    stillPresentSourceIds[entry.item.id] = true;
    var existing = existingBySourceId[entry.item.id];
    var dueAt = new Date(entry.dueMs).toISOString();
    // requiresAttachment/icon/actionType/actionConfig are re-synced from the template every rollout
    // (an admin editing the plan should apply to Events that already rolled it out too) -- but
    // attachmentUrl/attachmentName are deliberately NOT touched here: they live only on the per-Event
    // row, and a PM's already-provided attachment must survive a Regenerate (see EventRoadmapItems
    // schema comment, Utils.gs). actionExecutedAt/actionResult are ALSO left untouched on an existing
    // row -- an admin tweaking, say, the meeting's To roles after it already fired shouldn't erase the
    // record that it fired, and if the actionType itself changed, the new one just won't have a
    // record yet (actionExecutedAt blank) so runRoadmapItemActions_ picks it up on its next sweep.
    var actionFields = { actionType: entry.item.actionType || '', actionConfig: entry.item.actionType ? JSON.stringify(entry.item.actionConfig) : '' };
    if (existing) {
      updateRow('EventRoadmapItems', existing.id, Object.assign({
        name: entry.item.name, dueAt: dueAt, sortOrder: entry.item.sortOrder,
        requiresAttachment: entry.item.requiresAttachment, icon: entry.item.icon
      }, actionFields));
    } else {
      insertRow('EventRoadmapItems', Object.assign({
        id: newId('EventRoadmapItems'), eventId: event.id, planId: planId, name: entry.item.name,
        sourceItemId: entry.item.id, dueAt: dueAt, status: 'Pending', completedBy: '', completedAt: '',
        sortOrder: entry.item.sortOrder, createdBy: user.id, createdAt: nowIso_(),
        requiresAttachment: entry.item.requiresAttachment, attachmentUrl: '', attachmentName: '', icon: entry.item.icon,
        actionExecutedAt: '', actionResult: ''
      }, actionFields));
    }
  });
  // A plan item removed from the template since the last rollout -- drop its stale per-Event row too.
  existingRows.forEach(function (r) { if (!stillPresentSourceIds[r.sourceItemId]) deleteRow('EventRoadmapItems', r.id); });

  audit(user.id, 'ROLLOUT_EVENT_ROADMAP', 'Events', event.id, { planId: planId, itemCount: resolved.length });
}

// Public entry point for createEvent (Events.gs) -- separated from rolloutEventRoadmap_ itself so
// createEvent can call it without duplicating the plan-lookup/date-validation above.
function rolloutEventRoadmapOnCreate_(user, event) {
  if (!event.planTypeId) return;
  rolloutEventRoadmap_(user, event, event.planTypeId);
}

// PM-facing manual re-sync -- "Regenerate" button, Event > Roadmap tab. Re-reads event.planTypeId
// fresh (so this also picks up a plan type changed later via Edit Event) and re-resolves every date
// against the Event's CURRENT start/end -- the fix for "I changed the event's start date and the
// Roadmap didn't move."
function generateEventRoadmap(user, p) {
  var event = getById('Events', p && p.eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');
  requirePermission(user, 'roadmapItem.manage');
  if (!event.planTypeId) throw new HululError('BAD_REQUEST', 'This event has no Roadmap plan assigned');
  rolloutEventRoadmap_(user, event, event.planTypeId);
  return listEventRoadmapItems(user, { eventId: event.id });
}

// ---- Per-event item list + PM overrides ------------------------------------

// Read is intentionally as open as the rest of the Roadmap tab's other data sources (getEventTemplates/
// listMeetings, Templates.gs) -- no extra role gate beyond "this Event exists and you're signed in".
function listEventRoadmapItems(user, p) {
  if (!user) throw new HululError('UNAUTHENTICATED', 'Login required');
  var event = getById('Events', p && p.eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');
  var now = Date.now();
  return findWhere('EventRoadmapItems', function (r) { return r.eventId === event.id; })
    .map(function (r) {
      var overdue = r.status === 'Pending' && r.dueAt && new Date(r.dueAt).getTime() < now;
      return {
        id: r.id, eventId: r.eventId, planId: r.planId, name: r.name, sourceItemId: r.sourceItemId || '',
        dueAt: r.dueAt, status: r.status, overdue: overdue, completedBy: r.completedBy || '', completedAt: r.completedAt || '',
        sortOrder: Number(r.sortOrder) || 0,
        requiresAttachment: r.requiresAttachment === true || r.requiresAttachment === 'true',
        attachmentUrl: r.attachmentUrl || '', attachmentName: r.attachmentName || '', icon: r.icon || '',
        actionType: r.actionType || '', actionConfig: parseRoadmapActionConfig_(r.actionConfig),
        actionExecutedAt: r.actionExecutedAt || '', actionResult: r.actionResult || ''
      };
    })
    .sort(function (a, b) { return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime(); });
}

// Ad hoc item added directly on one Event (sourceItemId left blank) -- e.g. something specific to
// this event that isn't worth adding to the shared template. p: { eventId, name, dueAt,
// requiresAttachment? }. requiresAttachment is settable here too (unlike icon, which REQ scoped to
// Roadmap Plans template items only) so an ad hoc item can still be held to the same "must attach
// before Done" rule as a plan-sourced one -- enforced uniformly by updateEventRoadmapItem below
// regardless of where the item came from.
function addEventRoadmapItem(user, p) {
  var event = getById('Events', p && p.eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');
  requirePermission(user, 'roadmapItem.manage');
  var name = String((p && p.name) || '').trim();
  if (!name) throw new HululError('BAD_REQUEST', 'An item name is required');
  var d = new Date(p && p.dueAt);
  if (isNaN(d)) throw new HululError('BAD_REQUEST', 'dueAt is not a valid date');
  var row = insertRow('EventRoadmapItems', {
    id: newId('EventRoadmapItems'), eventId: event.id, planId: event.planTypeId || '', name: name,
    sourceItemId: '', dueAt: d.toISOString(), status: 'Pending', completedBy: '', completedAt: '',
    sortOrder: 999999, createdBy: user.id, createdAt: nowIso_(),
    requiresAttachment: !!(p && p.requiresAttachment), attachmentUrl: '', attachmentName: '', icon: ''
  });
  audit(user.id, 'ADD_EVENT_ROADMAP_ITEM', 'EventRoadmapItems', row.id, { eventId: event.id, name: name });
  return listEventRoadmapItems(user, { eventId: event.id });
}

// Covers every PM-facing edit on one item: rename, move its due date, set/replace its attachment
// link, and mark Done/Pending. p: { itemId, name?, dueAt?, requiresAttachment?, attachmentUrl?,
// attachmentName?, done? }. Marking Done stamps completedBy/completedAt; reopening (done: false)
// clears both, same convention as Templates' reviewedBy/reviewedAt on reopenTemplateScoring.
//
// REQ: "allow to choose whether an attachment is required, if attachment is requirement check will
// not accept unless attachment or link to the attachment or link to report in the system is
// provided." Enforced right here, at the one place Done actually gets set -- not in the frontend --
// so it can't be bypassed by calling this endpoint directly. attachmentUrl covers all three phrasings
// in the REQ identically (an uploaded file's Drive URL via uploadRoadmapItemAttachment, a pasted link
// to an external document, or a pasted link to another page inside HULUL itself, e.g. a Finding or
// Template) -- from this endpoint's point of view they're all just "a URL was provided", nothing
// distinguishes where it points. The check uses whichever value WILL be true after this patch lands
// (this call's own p.requiresAttachment/p.attachmentUrl if supplied, else the item's current stored
// value) so a single call that sets the link AND marks Done in one round-trip works correctly too.
function updateEventRoadmapItem(user, p) {
  var item = getById('EventRoadmapItems', p && p.itemId);
  if (!item) throw new HululError('NOT_FOUND', 'Roadmap item not found');
  var event = getById('Events', item.eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');
  requirePermission(user, 'roadmapItem.manage');
  var patch = {};
  if (p.name !== undefined) {
    var name = String(p.name).trim();
    if (!name) throw new HululError('BAD_REQUEST', 'An item name is required');
    patch.name = name;
  }
  if (p.dueAt !== undefined) {
    var d = new Date(p.dueAt);
    if (isNaN(d)) throw new HululError('BAD_REQUEST', 'dueAt is not a valid date');
    patch.dueAt = d.toISOString();
  }
  if (p.requiresAttachment !== undefined) patch.requiresAttachment = !!p.requiresAttachment;
  if (p.attachmentUrl !== undefined) patch.attachmentUrl = String(p.attachmentUrl).trim();
  if (p.attachmentName !== undefined) patch.attachmentName = String(p.attachmentName).trim();
  if (p.done !== undefined) {
    if (p.done) {
      var effectiveRequires = patch.requiresAttachment !== undefined ? patch.requiresAttachment
        : (item.requiresAttachment === true || item.requiresAttachment === 'true');
      var effectiveAttachmentUrl = patch.attachmentUrl !== undefined ? patch.attachmentUrl : (item.attachmentUrl || '');
      if (effectiveRequires && !effectiveAttachmentUrl) {
        throw new HululError('BAD_REQUEST', 'This item requires an attachment or link before it can be marked done');
      }
      patch.status = 'Done'; patch.completedBy = user.id; patch.completedAt = nowIso_();
    } else { patch.status = 'Pending'; patch.completedBy = ''; patch.completedAt = ''; }
  }
  updateRow('EventRoadmapItems', item.id, patch);
  audit(user.id, 'UPDATE_EVENT_ROADMAP_ITEM', 'EventRoadmapItems', item.id, patch);
  return listEventRoadmapItems(user, { eventId: event.id });
}

function deleteEventRoadmapItem(user, p) {
  var item = getById('EventRoadmapItems', p && p.itemId);
  if (!item) throw new HululError('NOT_FOUND', 'Roadmap item not found');
  var event = getById('Events', item.eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');
  requirePermission(user, 'roadmapItem.manage');
  deleteRow('EventRoadmapItems', item.id);
  audit(user.id, 'DELETE_EVENT_ROADMAP_ITEM', 'EventRoadmapItems', item.id, { eventId: event.id, name: item.name });
  return listEventRoadmapItems(user, { eventId: event.id });
}

// REQ: "will not accept unless attachment or link to the attachment ... is provided" -- the "upload a
// file" half of that; the "paste a link" half needs no endpoint at all (the PM just types/pastes a
// URL straight into attachmentUrl via updateEventRoadmapItem above). Mirrors uploadEvidence
// (Inspections.gs) / uploadTemplateFile_ (Templates.gs)'s Drive-upload mechanics exactly, just its
// own per-event folder and gated by roadmapItem.manage instead of evidence.upload/templateLibrary.manage
// -- the PM/EventManager roles attaching a Roadmap item's proof aren't necessarily the same roles
// allowed to upload Risk Logging evidence or Template Library master documents. p: { eventId,
// fileBase64, fileName, mimeType }. Returns { url, fileName } -- the frontend then folds that
// straight into its own updateEventRoadmapItem call (attachmentUrl/attachmentName [+ done: true]).
function uploadRoadmapItemAttachment(user, p) {
  var event = getById('Events', p && p.eventId);
  if (!event) throw new HululError('NOT_FOUND', 'Event not found');
  requirePermission(user, 'roadmapItem.manage');
  if (!p.fileBase64) throw new HululError('BAD_REQUEST', 'fileBase64 is required');
  var folder = getOrCreateFolder_('HULUL Roadmap Attachments - ' + event.id);
  var blob = Utilities.newBlob(Utilities.base64Decode(p.fileBase64), p.mimeType || 'application/octet-stream', p.fileName || 'attachment');
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  audit(user.id, 'UPLOAD_ROADMAP_ITEM_ATTACHMENT', 'Events', event.id, { fileName: p.fileName || file.getName() });
  return { url: file.getUrl(), fileName: p.fileName || file.getName() };
}

// ---- Roadmap item automation (REQ follow-up: "connect roadmap plans items to actionable items or
// items with date time" -- a plan item can, instead of just sitting on the checklist, actually DO
// something the moment its resolved due date arrives: schedule a meeting, auto-send Readiness
// templates, or send a reminder notification. Fired by runRoadmapItemActions_ below, run off the same
// periodic trigger as the escalation engine (scheduledEscalationCheck, Setup.gs). --------------------

// Resolves a role CODE to the individual Users it means for THIS Event. EventManager is the Event's
// own single named field (Events.eventManagerId), not a role lookup. Everything else is looked up by
// (role, orgId) against BOTH the Event's EMC and its Inspection Company -- a role can plausibly exist
// at either side (e.g. a custom role), and most built-in roles only ever match one side anyway, so
// checking both is harmless. A role that matches neither org (GAAdmin/GAUser/SystemAdmin/SupportAgent,
// or any custom role not tied to an org type) falls back to a plain global lookup by role code alone
// -- same "GA-wide" reasoning eventStakeholderIds_ (Notifications.gs) already applies to GA roles.
function roleCodesToEventUserIds_(roleCodes, event) {
  if (!roleCodes || !roleCodes.length) return [];
  var ids = [];
  roleCodes.forEach(function (role) {
    if (role === ROLES.EVENT_MANAGER) { if (event.eventManagerId) ids.push(event.eventManagerId); return; }
    var emcMatches = event.emcId ? findWhere('Users', function (u) { return u.orgId === event.emcId && u.role === role; }) : [];
    var inspMatches = event.inspectionCoId ? findWhere('Users', function (u) { return u.orgId === event.inspectionCoId && u.role === role; }) : [];
    var globalMatches = (!emcMatches.length && !inspMatches.length) ? findWhere('Users', function (u) { return u.role === role; }) : [];
    emcMatches.concat(inspMatches).concat(globalMatches).forEach(function (u) { ids.push(u.id); });
  });
  return Array.from(new Set(ids));
}

// actionType 'scheduleMeeting' -- REQ example: "Event Kick Off Meeting: creates and connects to a
// meeting template... with predefined To roles and Cc roles and body template." The item's own
// resolved dueAt (already the point of this whole rollout engine -- "3 weeks before event start
// date") IS the meeting's scheduledAt; the body auto-fills from MeetingTemplates by subject exactly
// like the manual New Meeting form does (getMeetingTemplatesBySubject ignores its `user` argument
// entirely, so it's safe to call with none here). createdBy: 'system', same sentinel
// maybeAutoCreateVersion2_ (Templates.gs) already uses for a backend-initiated row nobody clicked to
// create.
function autoScheduleRoadmapMeeting_(event, item) {
  var config = item.actionConfig || {};
  var subject = String(config.subject || '').trim() || item.name;
  var to = roleCodesToEventUserIds_(config.toRoles, event);
  var cc = roleCodesToEventUserIds_(config.ccRoles, event);
  var bodyBySubject = getMeetingTemplatesBySubject(null, { eventId: event.id });
  var meeting = {
    id: newId('Meetings'), eventId: event.id, subEventId: '', type: subject, scheduledAt: item.dueAt,
    toJson: JSON.stringify(to), ccJson: JSON.stringify(cc), meetingLink: '',
    notes: bodyBySubject[subject.toLowerCase()] || '', status: 'Scheduled',
    createdBy: 'system', createdAt: nowIso_(), updatedBy: '', updatedAt: ''
  };
  insertRow('Meetings', meeting);
  audit('system', 'AUTO_SCHEDULE_ROADMAP_MEETING', 'Meetings', meeting.id, { eventId: event.id, roadmapItemId: item.id, subject: subject });
  notifyMeetingRecipients_(meeting, to, cc, 'scheduled');
  var inviteeCount = Array.from(new Set(to.concat(cc))).length;
  return { ok: true, message: 'Meeting scheduled: ' + subject + (inviteeCount ? ' (' + inviteeCount + ' invitee(s))' : ' (no matching recipients found)') };
}

// actionType 'sendTemplates' -- REQ example: "EMC Download Ops Docs: Automatically sends (Selected)
// Readiness templates." docTypes (empty = every template currently in the library) is matched against
// the Event's OWN Inspection Company library at fire time -- see the RoadmapPlanItems schema comment
// (Utils.gs) for why this can't reference specific TemplateLibrary rows the way a manual Send does.
// Mirrors sendTemplates (Templates.gs) exactly (independent Drive copy via copyTemplateDriveFile_,
// same locked-in docType/versionNumber snapshot) minus the requirePermission/audit-as-a-user framing,
// since there's no acting user here. Deliberately non-throwing: every "can't send yet" case returns
// {ok:false, message} so runRoadmapItemActions_ just leaves actionExecutedAt blank and retries on the
// next sweep once the blocking condition clears (e.g. a PM finally sets the documents deadline).
function autoSendRoadmapTemplates_(event, item) {
  if (!event.inspectionCoId) return { ok: false, message: 'Waiting for an Inspection Company to be assigned to this event' };
  if (!event.templatesDeadlineAt) return { ok: false, message: 'Waiting for a documents deadline to be set before templates can be sent' };
  if (isTemplatesLocked_(event.id)) return { ok: false, message: 'Documents are locked -- waiting for a new version to open' };
  var config = item.actionConfig || {};
  var docTypes = Array.isArray(config.docTypes) ? config.docTypes : [];
  var library = findWhere('TemplateLibrary', function (l) { return l.orgId === event.inspectionCoId; });
  if (docTypes.length) library = library.filter(function (l) { return docTypes.indexOf(l.docType) !== -1; });
  if (!library.length) return { ok: false, message: 'No matching Readiness template(s) found yet in the library' };
  var alreadySentIds = {};
  findWhere('Templates', function (t) { return t.eventId === event.id; }).forEach(function (t) { if (t.libraryTemplateId) alreadySentIds[t.libraryTemplateId] = true; });
  var toSend = library.filter(function (l) { return !alreadySentIds[l.id]; });
  if (!toSend.length) return { ok: true, message: 'Already sent -- nothing new to send' };
  var sentCount = 0;
  toSend.forEach(function (lib) {
    var fileCopy = copyTemplateDriveFile_(lib.fileUrl, event.inspectionCoId, lib.fileName);
    insertRow('Templates', {
      id: newId('Templates'), eventId: event.id, libraryTemplateId: lib.id, name: lib.name, status: 'Sent',
      fileUrl: fileCopy.fileUrl, fileName: fileCopy.fileName, mimeType: lib.mimeType, sentBy: 'system', sentAt: nowIso_(),
      uploadedBy: '', updatedAt: nowIso_(), reviewedBy: '', reviewedAt: '', reviewReason: '', createdAt: nowIso_(),
      docType: lib.docType || '', versionNumber: currentTemplateVersionNumber_(event.id)
    });
    sentCount++;
  });
  audit('system', 'AUTO_SEND_ROADMAP_TEMPLATES', 'Events', event.id, { roadmapItemId: item.id, count: sentCount });
  if (event.eventManagerId) {
    notify_(event.eventManagerId, 'TEMPLATES_SENT', sentCount + ' readiness template(s) sent for ' + event.name, 'Events', event.id, event.id);
  }
  return { ok: true, message: sentCount + ' template(s) sent' };
}

// actionType 'reminder' -- REQ example: "Doc. Sub. Reminder: Sends notification reminder to submit
// the document before deadline." Defaults to the Event Manager (the role that actually uploads/
// submits documents -- see templateUploaderRoles_, Templates.gs) if no toRoles were configured, so a
// reminder item still does SOMETHING useful out of the box rather than silently going nowhere.
function autoSendRoadmapReminder_(event, item) {
  var config = item.actionConfig || {};
  var toRoles = (Array.isArray(config.toRoles) && config.toRoles.length) ? config.toRoles : [ROLES.EVENT_MANAGER];
  var ids = roleCodesToEventUserIds_(toRoles, event);
  if (!ids.length) return { ok: false, message: 'No recipients found yet for the configured role(s)' };
  var deadlineNote = event.templatesDeadlineAt
    ? ' Deadline: ' + Utilities.formatDate(new Date(event.templatesDeadlineAt), Session.getScriptTimeZone(), 'MMM d, yyyy HH:mm') + '.'
    : '';
  var message = String(config.message || '').trim() || ('Reminder: ' + item.name + ' -- ' + event.name + '.' + deadlineNote);
  notify_(ids, 'ROADMAP_REMINDER', message, 'EventRoadmapItems', item.id, event.id);
  audit('system', 'AUTO_SEND_ROADMAP_REMINDER', 'EventRoadmapItems', item.id, { eventId: event.id, recipientCount: ids.length });
  return { ok: true, message: 'Reminder sent to ' + ids.length + ' recipient(s)' };
}

// The sweep itself -- called from scheduledEscalationCheck (Setup.gs), same as checkTemplateDeadlines/
// deactivateEndedEventPlaceAccounts. Only ever looks at rows with actionType set AND actionExecutedAt
// still blank AND a dueAt that's already passed -- so an item fires exactly once, whenever the sweep
// next runs after its due date (default every 5 min, see escalationCheckIntervalMinutes_). A failed/
// not-yet-possible attempt leaves actionExecutedAt blank (so it's retried next sweep) but still writes
// actionResult, so a PM looking at the Roadmap tab isn't left guessing why nothing happened yet.
function runRoadmapItemActions_() {
  var now = Date.now();
  var pending = findWhere('EventRoadmapItems', function (r) {
    return r.actionType && !r.actionExecutedAt && r.dueAt && new Date(r.dueAt).getTime() <= now;
  });
  pending.forEach(function (row) {
    var event = getById('Events', row.eventId);
    if (!event) return;
    var item = Object.assign({}, row, { actionConfig: parseRoadmapActionConfig_(row.actionConfig) });
    var result;
    try {
      if (item.actionType === 'scheduleMeeting') result = autoScheduleRoadmapMeeting_(event, item);
      else if (item.actionType === 'sendTemplates') result = autoSendRoadmapTemplates_(event, item);
      else if (item.actionType === 'reminder') result = autoSendRoadmapReminder_(event, item);
      else return;
    } catch (e) {
      result = { ok: false, message: 'Failed: ' + (e && e.message ? e.message : String(e)) };
    }
    if (result.ok) updateRow('EventRoadmapItems', row.id, { actionExecutedAt: nowIso_(), actionResult: result.message });
    else updateRow('EventRoadmapItems', row.id, { actionResult: result.message });
  });
}
