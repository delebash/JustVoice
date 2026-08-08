// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 JustVoice contributors
//
// In-app help docs loader — the app half of the kit Help system. The adapter
// LOGIC (README→index aliasing, lazy load + cache, TOC titles) is the kit's
// makeDocsHelpAdapter — one implementation for the family (it absorbed the
// JustWrite-lifted copy this file used to carry). What stays here is what vite
// resolves relative to THIS file: the import.meta.glob over docs/*.md and the
// toc.json import. docs/ lives at the repo root, which is also the vite root;
// markdown loads LAZILY (no `eager`) — a doc is fetched only when its Help
// drawer opens, never on the boot path — and is cached for the session.

import { makeDocsHelpAdapter } from "@delebash/llm-ui";
import HELP_TOC_DATA from "../../docs/toc.json";

export const HELP_TOC = HELP_TOC_DATA;

export const { loadDoc, hasDoc, titleForSlug } = makeDocsHelpAdapter(
  import.meta.glob("../../docs/*.md", { query: "?raw", import: "default" }),
  HELP_TOC_DATA,
);
