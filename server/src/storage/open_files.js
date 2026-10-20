// SPDX-License-Identifier: MIT
// The audio files the server is reading out to a player — a take, a capture — closed at once when a
// restore replaces the data folders (data_admin.js). Windows refuses to rename a folder with a file
// open inside it (EPERM), so one paused player would make every restore refuse with 409
// "files-in-use" (the kit's data_api, measured on Windows 2026-10-20).
//
// One AbortController for them all (Node's `stream.addAbortSignal`), replaced after each close so
// the files opened next are not closed with them.

import { addAbortSignal } from "node:stream";

let controller = new AbortController();

/** `stream`, closed when `closeOpenFiles()` runs. */
export const closedOnRestore = (stream) => addAbortSignal(controller.signal, stream);

/** Close every file `closedOnRestore` handed out that is still open. */
export function closeOpenFiles() {
  controller.abort();
  controller = new AbortController();
}
