// SPDX-License-Identifier: MIT
//
// A page's own AI tasks (decided 2026-10-05: a page shows only its own tasks —
// the app-wide strip at the top of every page went). The kit's task store
// holds every task; a page picks the ones it started by feature, and by the
// meta it stamped on them (its project, its chapter). The header's ✨ AI
// button and the AI Tasks page still show everything.

/** The visible tasks with one of `features` whose meta matches every key of `meta`, oldest first. */
export function pageTasks(tasks, features, meta = {}) {
  const want = Object.entries(meta);
  return tasks.visibleTasks.filter((t) => features.includes(t.feature)
    && want.every(([k, v]) => t.meta?.[k] === v));
}
