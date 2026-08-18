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
        offsetDays: Number(it.offsetDays) || 0, offsetHours: Number(it.offsetHours) || 0
      };
    });
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
  return {
    name: name, anchorType: anchorType, anchorItemId: anchorItemId, offsetSign: offsetSign,
    offsetWeeks: nonNegInt_(p && p.offsetWeeks), offsetDays: nonNegInt_(p && p.offsetDays), offsetHours: nonNegInt_(p && p.offsetHours)
  };
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
    if (existing) {
      updateRow('EventRoadmapItems', existing.id, { name: entry.item.name, dueAt: dueAt, sortOrder: entry.item.sortOrder });
    } else {
      insertRow('EventRoadmapItems', {
        id: newId('EventRoadmapItems'), eventId: event.id, planId: planId, name: entry.item.name,
        sourceItemId: entry.item.id, dueAt: dueAt, status: 'Pending', completedBy: '', completedAt: '',
        sortOrder: entry.item.sortOrder, createdBy: user.id, createdAt: nowIso_()
      });
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
        sortOrder: Number(r.sortOrder) || 0
      };
    })
    .sort(function (a, b) { return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime(); });
}

// Ad hoc item added directly on one Event (sourceItemId left blank) -- e.g. something specific to
// this event that isn't worth adding to the shared template. p: { eventId, name, dueAt }.
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
    sortOrder: 999999, createdBy: user.id, createdAt: nowIso_()
  });
  audit(user.id, 'ADD_EVENT_ROADMAP_ITEM', 'EventRoadmapItems', row.id, { eventId: event.id, name: name });
  return listEventRoadmapItems(user, { eventId: event.id });
}

// Covers every PM-facing edit on one item: rename, move its due date, and mark Done/Pending. p:
// { itemId, name?, dueAt?, done? }. Marking Done stamps completedBy/completedAt; reopening (done:
// false) clears both, same convention as Templates' reviewedBy/reviewedAt on reopenTemplateScoring.
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
  if (p.done !== undefined) {
    if (p.done) { patch.status = 'Done'; patch.completedBy = user.id; patch.completedAt = nowIso_(); }
    else { patch.status = 'Pending'; patch.completedBy = ''; patch.completedAt = ''; }
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
