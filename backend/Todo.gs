/**
 * HULUL - Todo.gs (To-Do Inbox)
 * REQ: "Add to do inbox where it will show all pending items on a user. All logs that have been
 * created but not yet resolved. Pending documents that have not yet been evaluated, all scores that
 * have not been completed. all required annexes that have not been uploaded. any upcoming meetings not
 * yet attended. All translations not yet translated. and all other related tasks. once a task has been
 * completed it is automatically date time stamped, ticked, crossed and goes to the bottom of the list.
 * add search filter."
 *
 * One flat, cross-module worklist scoped to the CALLER. Two very different scoping rules apply
 * depending on the category, per the user's own answers when this was scoped:
 *   - Logs (Findings), Inspections, Escalations and Meetings ARE assigned to a specific individual in
 *     the data model (createdBy/participantId->userId, inspectorId, toUserIds/ccUserIds, toJson/
 *     ccJson) -- these show only items actually tied to the caller.
 *   - Documents (Templates), Scores (Template scoring) and Annexes are only ROLE-scoped in the data
 *     model today (any user holding 'template.upload'/'template.review'/'annex.upload'/'annex.manage'
 *     can act on any pending one for an event they can see) -- there is no per-person assignment to
 *     read. REQ follow-up, when asked how to scope these: "There is a project director role that
 *     assigns roles known as 'Cluster' to events, Clusters then assigns supervisors and inspectors to
 *     checklists or zones. I will give you the full roles and what they can do later." That hierarchy
 *     (ProjectDirector/Cluster/Supervisor) doesn't exist anywhere in this codebase yet (confirmed: no
 *     such role codes anywhere in ROLES or the Roles sheet) -- until it's built, these three categories
 *     are scoped to "events visible to this user" (listEvents' own existing per-org/per-role
 *     visibility) filtered to the permission keys the user's role actually holds. Revisit this once the
 *     real assignment hierarchy exists.
 *   - Translations: gated by 'translation.manage' like the Translation Hub itself; genuinely global
 *     (not per-user) by design (see Translations.gs's own header comment), same as Documents/Scores/
 *     Annexes above.
 *
 * "Completed" items: only shown for a category where the underlying data actually has a real
 * completion timestamp to show (resolvedAt/reviewedAt/scoringFinalizedAt/attendedAt/escalation
 * resolvedAt/annex document reviewedAt) -- and only within TODO_COMPLETED_WINDOW_DAYS_ of that
 * timestamp, so a user's inbox doesn't accumulate years of finished history; it just rolls off after a
 * couple of weeks. Translations and Inspections have no such timestamp anywhere in their own schema
 * today (an untranslated item simply stops existing once translated; Inspections has no completedAt
 * field) -- those two stay pending-only rather than inventing a timestamp nothing else in the app
 * tracks.
 */

var TODO_COMPLETED_WINDOW_DAYS_ = 14;

var TODO_TRANSLATION_CATEGORY_LABELS_ = {
  categories: 'Categories', checklistTypes: 'Checklist Types', findingGuide: 'Log Assistance Guide',
  findings: 'Risk Logging', places: 'Places'
};

function todoWithinWindow_(iso) {
  if (!iso) return false;
  var ts = new Date(iso).getTime();
  if (isNaN(ts)) return false;
  return (Date.now() - ts) <= TODO_COMPLETED_WINDOW_DAYS_ * 24 * 60 * 60 * 1000;
}

// One shape for every category so the frontend (todo.js) never has to branch on category to read a
// common field. `link` tells the frontend how to navigate on click: an event-scoped item carries
// eventId (+ eventTab for a specific tab inside that Event workspace), a global one carries navPath
// instead. `meetingId` is only ever set for category 'meeting' -- todo.js uses it to show its own
// "Mark attended" action inline (the one category where completing the task IS an action taken from
// inside the inbox itself, not somewhere else in the app).
// REQ follow-up: "provide toggle to display logs opened by current user." Logs (category 'log')
// are scoped to createdBy-me OR assigned-to-me-to-resolve (see the Logs block below and this file's
// header comment) -- openedByMe distinguishes the two so the frontend can offer an "opened by me
// only" toggle without needing a second round-trip. Always present on every item (not just 'log')
// so todoItem_ keeps one common shape, but only 'log' ever sets it true; every other category is
// already scoped to the caller by construction (assignee/invitee/role), so "opened by me" doesn't
// apply to them.
function todoItem_(opts) {
  return {
    id: opts.id, category: opts.category, title: opts.title || '', subtitle: opts.subtitle || '',
    eventId: opts.eventId || '', eventTab: opts.eventTab || '', navPath: opts.navPath || '',
    meetingId: opts.meetingId || '', openedByMe: !!opts.openedByMe,
    createdAt: opts.createdAt || '', completed: !!opts.completed, completedAt: opts.completedAt || ''
  };
}

function listMyTodoItems(user) {
  if (!user) throw new HululError('UNAUTHENTICATED', 'Login required');
  var items = [];
  var eventById = {};
  listEvents(user, {}).forEach(function (e) { eventById[e.id] = e; });

  // ---- Logs (Findings): created by me OR assigned to me as the resolving Operator ----------------
  findWhere('Findings', function (f) {
    if (f.createdBy === user.id) return true;
    if (f.participantId) {
      var pt = getById('Participants', f.participantId);
      if (pt && pt.userId === user.id) return true;
    }
    return false;
  }).forEach(function (f) {
    var ev = eventById[f.eventId] || getById('Events', f.eventId);
    var evName = ev ? ev.name : f.eventId;
    var title = (f.description || '').slice(0, 80) || f.id;
    var openedByMe = f.createdBy === user.id;
    if (FINDING_OPEN_STATUSES.indexOf(f.status) !== -1) {
      items.push(todoItem_({
        id: 'log:' + f.id, category: 'log', title: title, subtitle: evName,
        eventId: f.eventId, eventTab: 'findings', createdAt: f.createdAt, openedByMe: openedByMe
      }));
    } else if (f.status === 'Resolved' && todoWithinWindow_(f.resolvedAt)) {
      items.push(todoItem_({
        id: 'log:' + f.id, category: 'log', title: title, subtitle: evName,
        eventId: f.eventId, eventTab: 'findings', createdAt: f.createdAt, openedByMe: openedByMe,
        completed: true, completedAt: f.resolvedAt
      }));
    }
  });

  // ---- Documents + Scores (Templates): role-scoped to events visible to this user (see file header
  // comment for why -- no per-person assignment exists yet for these) ------------------------------
  var canUpload = hasPermissionRole_(user, 'template.upload');
  var canReview = hasPermissionRole_(user, 'template.review');
  if (canUpload || canReview) {
    getAll('Templates').filter(function (t) { return eventById[t.eventId]; }).forEach(function (tpl) {
      var ev = eventById[tpl.eventId];
      var title = tpl.name || tpl.docType || tpl.id;
      if (canUpload && ['Sent', 'In Progress'].indexOf(tpl.status) !== -1) {
        items.push(todoItem_({
          id: 'document:' + tpl.id + ':upload', category: 'document', title: title, subtitle: ev.name,
          eventId: ev.id, eventTab: 'templates', createdAt: tpl.sentAt || tpl.createdAt
        }));
      }
      if (canReview && ['Submitted', 'Under Review'].indexOf(tpl.status) !== -1) {
        items.push(todoItem_({
          id: 'document:' + tpl.id + ':review', category: 'document', title: title, subtitle: ev.name,
          eventId: ev.id, eventTab: 'approval', createdAt: tpl.updatedAt || tpl.createdAt
        }));
      }
      if (tpl.status === 'Evaluated' && todoWithinWindow_(tpl.reviewedAt) && (canUpload || canReview)) {
        items.push(todoItem_({
          id: 'document:' + tpl.id + ':done', category: 'document', title: title, subtitle: ev.name,
          eventId: ev.id, eventTab: 'approval', createdAt: tpl.createdAt,
          completed: true, completedAt: tpl.reviewedAt
        }));
      }
      // Scores: only for docTypes that actually have an active scoring catalog (templateScoringJoin_,
      // Templates.gs) -- same signal the Readiness Templates table's own Score button uses.
      if (canReview) {
        var scorable = templateScoringJoin_(tpl).items.length > 0;
        if (scorable) {
          if (!tpl.scoringFinalizedAt && ['Submitted', 'Under Review', 'Evaluated'].indexOf(tpl.status) !== -1) {
            items.push(todoItem_({
              id: 'score:' + tpl.id, category: 'score', title: title, subtitle: ev.name,
              eventId: ev.id, eventTab: 'scoreOverview', createdAt: tpl.createdAt
            }));
          } else if (tpl.scoringFinalizedAt && todoWithinWindow_(tpl.scoringFinalizedAt)) {
            items.push(todoItem_({
              id: 'score:' + tpl.id, category: 'score', title: title, subtitle: ev.name,
              eventId: ev.id, eventTab: 'scoreOverview', createdAt: tpl.createdAt,
              completed: true, completedAt: tpl.scoringFinalizedAt
            }));
          }
        }
      }
    });
  }

  // ---- Annexes: required categories not yet Provided, for events visible to this user -------------
  if (hasPermissionRole_(user, 'annex.upload') || hasPermissionRole_(user, 'annex.manage')) {
    Object.keys(eventById).forEach(function (eventId) {
      var ev = eventById[eventId];
      var annex;
      try { annex = listEventAnnex(user, { eventId: eventId }); } catch (e) { return; }
      annex.categories.forEach(function (cat) {
        if (!cat.required) return;
        if (cat.status !== 'Provided') {
          items.push(todoItem_({
            id: 'annex:' + eventId + ':' + cat.categoryId, category: 'annex', title: cat.name, subtitle: ev.name,
            eventId: eventId, eventTab: 'annex', createdAt: ''
          }));
        } else {
          // No providedAt field exists on the category itself -- the most recently Accepted document's
          // own reviewedAt is the closest real timestamp for "when this category was satisfied."
          var acceptedAt = (cat.documents || []).filter(function (d) { return d.status === 'Accepted'; })
            .reduce(function (max, d) { return (!max || d.reviewedAt > max) ? d.reviewedAt : max; }, '');
          if (todoWithinWindow_(acceptedAt)) {
            items.push(todoItem_({
              id: 'annex:' + eventId + ':' + cat.categoryId, category: 'annex', title: cat.name, subtitle: ev.name,
              eventId: eventId, eventTab: 'annex', createdAt: '',
              completed: true, completedAt: acceptedAt
            }));
          }
        }
      });
    });
  }

  // ---- Meetings: I'm an invitee (To or Cc), haven't marked myself attended yet ---------------------
  var myAttendance = {};
  findWhere('MeetingAttendance', function (a) { return a.userId === user.id; }).forEach(function (a) { myAttendance[a.meetingId] = a; });
  getAll('Meetings').filter(function (m) { return m.status !== 'Deleted'; }).forEach(function (m) {
    var to = meetingRecipientIdsFromJson_(m.toJson);
    var cc = meetingRecipientIdsFromJson_(m.ccJson);
    if (to.indexOf(user.id) === -1 && cc.indexOf(user.id) === -1) return;
    var ev = eventById[m.eventId] || getById('Events', m.eventId);
    var evName = ev ? ev.name : m.eventId;
    var att = myAttendance[m.id];
    if (!att) {
      // Bounded so a years-old meeting invite from before attendance tracking existed doesn't flood
      // the inbox forever -- anything upcoming always shows; anything past only within the same
      // completed-items window used everywhere else in this file.
      var scheduledTs = m.scheduledAt ? new Date(m.scheduledAt).getTime() : 0;
      var isUpcoming = scheduledTs && scheduledTs >= Date.now();
      if (isUpcoming || todoWithinWindow_(m.scheduledAt)) {
        // No "Meetings" tab exists inside the Event workspace itself (Meetings live on their own
        // standalone /meetings page, filterable by event) -- navPath, not eventId/eventTab.
        items.push(todoItem_({
          id: 'meeting:' + m.id, category: 'meeting', title: m.type, subtitle: evName,
          navPath: '/meetings?eventId=' + encodeURIComponent(m.eventId), createdAt: m.scheduledAt || m.createdAt,
          meetingId: m.id
        }));
      }
    } else if (todoWithinWindow_(att.attendedAt)) {
      items.push(todoItem_({
        id: 'meeting:' + m.id, category: 'meeting', title: m.type, subtitle: evName,
        navPath: '/meetings?eventId=' + encodeURIComponent(m.eventId), createdAt: m.scheduledAt || m.createdAt,
        meetingId: m.id, completed: true, completedAt: att.attendedAt
      }));
    }
  });

  // ---- Translations: pending only (no completion timestamp exists in the data to show a done row) --
  // TODO_TRANSLATION_CATEGORY_LABELS_ is a plain-English fallback, not a real i18n lookup -- backend
  // code has no access to the frontend's t()/Term() (same reasoning PERMISSION_REGISTRY_'s own labels
  // above are plain English only); the frontend's own translationCategoryLabel_ (translations.js)
  // already knows how to prettify these same category ids if todo.js ever wants to re-map them.
  if (hasPermissionRole_(user, 'translation.manage')) {
    listTranslationItems(user).filter(function (it) { return !(it.target && it.target.trim()); }).forEach(function (it) {
      items.push(todoItem_({
        id: 'translation:' + it.recordType + ':' + (it.recordId || it.checklistType || it.context),
        category: 'translation', title: it.context || it.category,
        subtitle: TODO_TRANSLATION_CATEGORY_LABELS_[it.category] || it.category, navPath: '/translations', createdAt: ''
      }));
    });
  }

  // ---- Other related tasks: my own open Inspections (Inspector role only; no completedAt to show) --
  if (user.role === 'Inspector') {
    getAll('Inspections').filter(function (i) { return i.inspectorId === user.id && i.status !== 'Completed'; })
      .forEach(function (i) {
        var ev = eventById[i.eventId] || getById('Events', i.eventId);
        items.push(todoItem_({
          id: 'inspection:' + i.id, category: 'inspection', title: i.checklistType || i.id,
          subtitle: ev ? ev.name : i.eventId, eventId: i.eventId, eventTab: 'inspections', createdAt: i.scheduledAt
        }));
      });
  }

  // ---- Other related tasks: Escalations addressed to me ---------------------------------------------
  getAll('Escalations').forEach(function (e) {
    var toIds = e.toUserIds ? e.toUserIds.split(',').filter(Boolean) : [];
    var ccIds = e.ccUserIds ? e.ccUserIds.split(',').filter(Boolean) : [];
    if (toIds.indexOf(user.id) === -1 && ccIds.indexOf(user.id) === -1) return;
    var finding = getById('Findings', e.findingId);
    if (!finding) return;
    var ev = eventById[finding.eventId] || getById('Events', finding.eventId);
    var title = (finding.description || '').slice(0, 80) || finding.id;
    if (!e.resolvedAt) {
      items.push(todoItem_({
        id: 'escalation:' + e.id, category: 'escalation', title: title, subtitle: ev ? ev.name : finding.eventId,
        eventId: finding.eventId, eventTab: 'findings', createdAt: e.triggeredAt
      }));
    } else if (todoWithinWindow_(e.resolvedAt)) {
      items.push(todoItem_({
        id: 'escalation:' + e.id, category: 'escalation', title: title, subtitle: ev ? ev.name : finding.eventId,
        eventId: finding.eventId, eventTab: 'findings', createdAt: e.triggeredAt,
        completed: true, completedAt: e.resolvedAt
      }));
    }
  });

  // Pending first (most recently surfaced first), completed last (most recently completed first) --
  // "once a task has been completed it is automatically date time stamped, ticked, crossed and goes to
  // the bottom of the list."
  items.sort(function (a, b) {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    if (a.completed) return new Date(b.completedAt || 0) - new Date(a.completedAt || 0);
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });
  return items;
}
