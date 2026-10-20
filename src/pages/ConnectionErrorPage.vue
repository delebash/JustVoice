<script setup>
// The server didn't answer at start-up: the kit's connection-error screen, on its own route outside
// the layout (boot/jv.js sends every route here while the server is down). The renderer has no
// data of its own, so nothing else loads without the server; Retry reloads the window, and the boot
// then returns to the page the user was on (the route's `from`).
import { ConnectionError, serverUrl } from "@delebash/ui";
import { onMounted, ref } from "vue";
import { shellServerStatus } from "../services/native.js";

// Why the desktop app's server didn't start, when its shell knows (approved 2026-10-15): another
// program holds the port (the narrowings review, P6), or another JustVoice server holds the data
// folder (the shell's words — the kit's platform/data_lock.js). Since 2026-10-20 also the template's
// three: another person signed in to this computer has JustVoice open on the port (the shell never
// stops it), Windows reserved the port, or the server stopped as it started (its own first error line).
const detail = ref("");
onMounted(async () => {
  const status = await shellServerStatus();
  if (status?.dataFolderInUse) detail.value = status.dataFolderInUse;
  else if (status?.portOtherUser) {
    detail.value = `Another person signed in to this computer has JustVoice open, on port ${status.portOtherUser}. One copy runs at a time: they can quit theirs (its tray icon), then press Retry.`;
  } else if (status?.portReserved) {
    detail.value = `Windows has reserved port ${status.portReserved} for another use (Hyper-V, WSL or Docker), so JustVoice can't use it.`;
  } else if (status?.portTaken) {
    // Settings → Server can't open while the server is down, so the page sends you to Retry, which
    // starts the server again (decided 2026-10-15, the build's question 1).
    detail.value = `Port ${status.portTaken} is in use by another program — close that program, then press Retry.`;
  } else if (status?.serverError) detail.value = `Its server stopped as it started: ${status.serverError}`;
});
</script>

<template>
  <ConnectionError
    app-name="JustVoice"
    :server-url="serverUrl('')"
    need="load voices, projects, and settings"
    :detail="detail"
    dev-hint="Dev: it should start automatically with `npm run dev`, or run it yourself with `npm run server`, then retry."
  />
</template>
