// SPDX-License-Identifier: MIT AND GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 JustWrite contributors
// SPDX-FileCopyrightText: 2026 JustVoice contributors
//
// Lifted with adaptation from JustWrite's helpMarkdown.js (sibling app
// at E:\Dev\Web\justwrite-app\). MIT permission notice continues to
// apply to upstream-derived portions; JustVoice modifications are
// GPL-3.0-or-later.
//
// Shared marked renderer for the in-app help drawer. The JvHelpDrawer
// renders docs/*.md content; intra-doc link rewriting lives here so
// "voices.md#cloning" links open inside the drawer instead of trying
// to navigate the SPA somewhere unknown.

import { marked } from "marked";

const renderer = new marked.Renderer();
const baseLinkRenderer = renderer.link.bind(renderer);
renderer.link = ({ href, title, tokens }) => {
  let h = href || "";
  let internal = false;
  // foo.md  or  foo.md#section  → /help/foo[#section] with data-help-link.
  if (/^[^/:#?]+\.md(#.*)?$/.test(h)) {
    const [file, anchor = ""] = h.split("#");
    const slug = file.replace(/\.md$/, "");
    const realSlug = slug === "README" ? "" : slug;
    h = `/help${realSlug ? "/" + realSlug : ""}${anchor ? "#" + anchor : ""}`;
    internal = true;
  }
  const html = baseLinkRenderer({ href: h, title, tokens });
  if (internal) return html.replace("<a ", `<a data-help-link="1" `);
  if (/^https?:/i.test(h)) {
    return html.replace("<a ", `<a target="_blank" rel="noopener noreferrer" `);
  }
  return html;
};

marked.setOptions({ renderer, gfm: true, breaks: false });

/** Strip the leading H1 since the drawer renders the title in its own header. */
export function renderHelpMarkdown(md) {
  if (!md) return "";
  const stripped = md.replace(/^#\s+.+\n+/, "");
  return marked.parse(stripped);
}
