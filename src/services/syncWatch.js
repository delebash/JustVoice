// SPDX-License-Identifier: MIT
// Changes from another device (sync — server/src/sync.js; docs/sync.md): the kit's sync watcher
// (`watchSync` — copied from JustWrite's, which is to switch to this one) sees the server's counter move,
// and the window reloads by itself, reading every view afresh from the server. JustWrite reloads
// its book list and open book instead; JustVoice's views each hold their own data, so the window
// reloads — but not while a dialog is open or the cursor is in a text box (`waitWhileEditing`,
// decided 2026-10-15, P18): then it reloads at the first check after.
import { watchSync as watchServerSync } from "@delebash/ui";

export function watchSync() {
  return watchServerSync(() => window.location.reload(), { waitWhileEditing: true });
}
