// SPDX-License-Identifier: MIT AND GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 JustWrite contributors
// SPDX-FileCopyrightText: 2026 JustVoice contributors
//
// Lifted with adaptation from JustWrite's helpDocs.js. MIT permission
// notice continues for upstream-derived portions; JustVoice changes
// are GPL-3.0-or-later.
//
// In-app help docs loader.
//
// docs/*.md and docs/toc.json live at the repo root (one level above
// the vite root, `src/renderer/`). Both are bundled at build time —
// markdown via import.meta.glob as raw strings, the TOC as a plain
// JSON import.

import HELP_TOC_DATA from "../../../../docs/toc.json";

const modules = import.meta.glob("../../../../docs/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
});

const DOCS = {};
for (const path in modules) {
  const slug = path.split("/").pop().replace(/\.md$/, "");
  const key = slug === "README" ? "index" : slug;
  DOCS[key] = modules[path];
}

export const HELP_TOC = HELP_TOC_DATA;

export function getDoc(slug) {
  return DOCS[slug || "index"] || null;
}

export function hasDoc(slug) {
  return Boolean(DOCS[slug || "index"]);
}

export function titleForSlug(slug) {
  if (!slug || slug === "index") return "Help";
  for (const group of HELP_TOC) {
    const hit = group.items.find((i) => i.slug === slug);
    if (hit) return hit.title;
  }
  return slug;
}
