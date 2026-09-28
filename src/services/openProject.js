// SPDX-License-Identifier: MIT
//
// The one door for "open this project". Ruled 2026-09-27: Studio is the
// project's home and opening a project always lands on its Overview. Projects,
// Home's Resume, the title-bar switcher, create and import all come through
// here, so none of them can drift back to landing somewhere else.
//
// The step rides the same sessionStorage hand-off Chapters already uses to
// send you to a Studio step (StudioView consumes it on activation), because
// Studio is kept alive and a mount-time read would fire once per session.

export function openProjectInStudio(activeProject, project, step = "overview") {
  if (!project) return;
  activeProject.open(project);
  try { window.sessionStorage?.setItem("jv.studio.tab", step); } catch { /* ignore */ }
  window.location.hash = "#studio";
}
