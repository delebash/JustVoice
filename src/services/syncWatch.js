// SPDX-License-Identifier: MIT
// Changes from another device (sync — server/src/sync.js; docs/sync.md): the server's counter
// (GET /v1/sync/rev) moves when another device's changes land — a sync with the cloud folder or a
// paired device, or a file imported by hand. An open window then says so and offers a reload,
// which reads every view afresh from the server. The interval is the server's sync setting
// "pollSeconds". JustWrite's twin reloads its one open book instead (its services/projectApi.js
// watchSync); JustVoice's views each hold their own data, so the window reloads.
import { get, pushToast } from "@delebash/llm-ui";

export function watchSync({ onChange = offerReload } = {}) {
  let last = null;
  let timer = null;
  let stopped = false;
  const tick = async () => {
    let wait = 5;
    try {
      const r = await get("/v1/sync/rev");
      wait = Number(r?.pollSeconds) > 0 ? Number(r.pollSeconds) : wait;
      if (last !== null && r.rev !== last) onChange();
      last = r.rev;
    } catch {
      // the server is busy or restarting: try again next time
    }
    if (!stopped) timer = setTimeout(tick, wait * 1000);
  };
  void tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

function offerReload() {
  pushToast({
    message: "Changes from another device arrived.",
    description: "Reload to see them.",
    action: { label: "Reload", fn: () => window.location.reload() },
    duration: 30000,
  });
}
