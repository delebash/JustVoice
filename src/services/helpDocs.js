// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 JustWrite contributors
// SPDX-FileCopyrightText: 2026 JustVoice contributors
//
// Lifted with adaptation from JustWrite's helpDocs.js. MIT permission
// notice continues for upstream-derived portions; JustVoice changes
// are MIT.
//
// In-app help docs loader.
//
// docs/*.md and docs/toc.json live at the repo root, which is also the vite
// root. The TOC is a small JSON import; the markdown is loaded LAZILY
// (import.meta.glob without `eager`) — a doc's content is fetched only when
// its Help drawer opens, not bundled into / fetched on the boot path.
// Loaded docs are cached for the session.

import HELP_TOC_DATA from "../../docs/toc.json";

const loaders = import.meta.glob("../../docs/*.md", {
  query: "?raw",
  import: "default",
});

// slug → () => Promise<rawMarkdown>
const DOC_LOADERS = {};
for (const path in loaders) {
  const slug = path.split("/").pop().replace(/\.md$/, "");
  const key = slug === "README" ? "index" : slug;
  DOC_LOADERS[key] = loaders[path];
}

const _cache = {};

export const HELP_TOC = HELP_TOC_DATA;

// Async: loads (and caches) a doc's markdown on demand. Returns null if absent.
export async function loadDoc(slug) {
  const key = slug || "index";
  if (key in _cache) return _cache[key];
  const loader = DOC_LOADERS[key];
  if (!loader) return null;
  const raw = await loader();
  _cache[key] = raw;
  return raw;
}

export function hasDoc(slug) {
  return Boolean(DOC_LOADERS[slug || "index"]);
}

export function titleForSlug(slug) {
  if (!slug || slug === "index") return "Help";
  for (const group of HELP_TOC) {
    const hit = group.items.find((i) => i.slug === slug);
    if (hit) return hit.title;
  }
  return slug;
}
