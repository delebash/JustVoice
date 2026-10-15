<script setup>
// The server didn't answer at start-up: the kit's connection-error screen, on its own route outside
// the layout (boot/jv.js sends every route here while the server is down). The renderer has no
// data of its own, so nothing else loads without the server; Retry reloads the window, and the boot
// then returns to the page the user was on (the route's `from`).
import { ConnectionError, serverUrl } from "@delebash/llm-ui";
import { onMounted, ref } from "vue";
import { shellServerStatus } from "../services/native.js";

// Why the desktop app's server didn't start, when its shell knows (approved 2026-10-15): another
// program holds the port (the narrowings review, P6), or another JustVoice server holds the data
// folder (the shell's words — the kit's platform/data_lock.js).
const detail = ref("");
onMounted(async () => {
  const status = await shellServerStatus();
  if (status?.dataFolderInUse) detail.value = status.dataFolderInUse;
  else if (status?.portTaken) {
    detail.value = `Port ${status.portTaken} is in use by another program — change the Port in Settings → Server, or close that program.`;
  }
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
