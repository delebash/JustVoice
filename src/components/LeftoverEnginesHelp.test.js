// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
//
// The boot splash's help under a failed model load (2026-09-29): names the
// speech engines left over from an earlier session and what they hold, and
// "Stop them and retry" stops them, then re-runs the load.
import { createApp, h, nextTick } from "vue";
import { afterEach, expect, test, vi } from "vitest";

const request = vi.fn();
const pushToast = vi.fn();
vi.mock("../stores/api.js", () => ({ useApi: () => ({ request }) }));
vi.mock("@delebash/llm-ui", () => ({
  pushToast: (...a) => pushToast(...a),
  UiButton: {
    props: ["disabled", "intent", "size"],
    emits: ["click"],
    setup: (p, { slots, emit }) => () =>
      h("button", { disabled: p.disabled, onClick: () => emit("click") }, slots.default?.()),
  },
}));

const { default: LeftoverEnginesHelp } = await import("./LeftoverEnginesHelp.vue");

// Since the 2026-10-01 switch the only engine process is the speech runtime
// (audio.cpp) — one per server that started it.
const TWO_RUNTIMES = {
  gpu_mb: 1581,
  leftovers: [
    { pid: 10, engine_id: "audiocpp", engine_name: "Speech runtime", gpu_mb: 1295 },
    { pid: 20, engine_id: "audiocpp", engine_name: "Speech runtime", gpu_mb: 286 },
  ],
};

let app;
let el;
afterEach(() => {
  app?.unmount();
  el?.remove();
  request.mockReset();
  pushToast.mockReset();
});

async function mount(task) {
  el = document.createElement("div");
  document.body.appendChild(el);
  app = createApp(LeftoverEnginesHelp, { task });
  app.mount(el);
  for (let i = 0; i < 5; i++) await nextTick();
  await new Promise((r) => setTimeout(r, 0));
  await nextTick();
}

test("names the leftover engines and what they hold", async () => {
  request.mockResolvedValueOnce(TWO_RUNTIMES);
  await mount({ retry: vi.fn() });
  expect(el.textContent).toContain(
    "1.5 GB of GPU memory is held by 2 Speech runtime processes from an earlier session.",
  );
  expect(el.querySelector("button").textContent).toBe("Stop them and retry");
});

test("memory unmeasurable", async () => {
  request.mockResolvedValueOnce({
    gpu_mb: null,
    leftovers: [
      { pid: 1, engine_name: "Speech runtime", gpu_mb: null },
      { pid: 2, engine_name: "Speech runtime", gpu_mb: null },
      { pid: 3, engine_name: "Speech runtime", gpu_mb: null },
    ],
  });
  await mount({ retry: vi.fn() });
  expect(el.textContent).toContain(
    "3 Speech runtime processes from an earlier session are still running.",
  );
});

test("renders nothing when there are none", async () => {
  request.mockResolvedValueOnce({ gpu_mb: null, leftovers: [] });
  await mount({ retry: vi.fn() });
  expect(el.textContent.trim()).toBe("");
});

test("Stop them and retry stops them, then re-runs the load", async () => {
  const retry = vi.fn();
  request.mockResolvedValueOnce(TWO_RUNTIMES).mockResolvedValueOnce(TWO_RUNTIMES);
  await mount({ retry });
  el.querySelector("button").click();
  await new Promise((r) => setTimeout(r, 0));
  await nextTick();
  expect(request).toHaveBeenLastCalledWith("/v1/engines/leftovers/stop", { method: "POST" });
  expect(retry).toHaveBeenCalledOnce();
  expect(pushToast).toHaveBeenCalledWith({ kind: "success", message: "Stopped 2 leftover engines." });
});
