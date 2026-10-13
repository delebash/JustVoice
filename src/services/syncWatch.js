// SPDX-License-Identifier: MIT
// Changes from another device (sync — server/src/sync.js; docs/sync.md): the kit's sync watcher
// (`watchSync` — copied from JustWrite's, which is to switch to this one) sees the server's counter move,
// and the window reloads by itself, reading every view afresh from the server. JustWrite reloads
// its book list and open book instead; JustVoice's views each hold their own data, so the window
// reloads.
import { watchSync as watchServerSync } from "@delebash/llm-ui";

export function watchSync() {
  return watchServerSync(() => window.location.reload());
}
