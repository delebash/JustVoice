// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
//
// Captures' ● Record (decided 2026-11-06, the finish run's item 2): the microphone until ■ Stop, then the
// recording as WAV to POST /v1/captures as the microphone's, its transcription a task; the new capture is
// listed and opened. The cards that showed hotkeys, auto-paste and the pill's window are gone.
import { h, nextTick } from "vue";
import { afterEach, expect, test, vi } from "vitest";
import { DOMWrapper } from "@vue/test-utils";
import { createTestApp } from "@delebash/ui/quasar/install.js";

const NEW = { id: "c-new-0001", source: "mic", transcript: "Call the harbour master.", raw_transcript: "call the harbour master", language: null, duration_ms: 2000, created_at: "2026-11-06T09:00:00Z", pinned: false };
const listed = { value: [] };
const postForm = vi.fn(async () => {
  listed.value = [NEW];
  return NEW;
});
vi.mock("../stores/api.js", () => ({
  useApi: () => ({
    request: async (url) => (url === "/v1/captures" ? { captures: listed.value } : {}),
    safeRequest: async (_url, fallback) => fallback,
    postForm,
  }),
}));
vi.mock("../services/projects.js", () => ({ captureReadinessService: { get: async () => ({ stt: { ready: true }, llm: { ready: true } }) } }));
vi.mock("../services/captureLanguage.js", () => ({ captureLanguageWord: (c) => (c === "auto" ? "Auto-detect" : c) }));

const recorded = new Blob(["webm"], { type: "audio/webm" });
const wav = new Blob(["RIFF"], { type: "audio/wav" });
const stop = vi.fn(async () => recorded);
const recordMicrophone = vi.fn(async () => ({ stop }));
const toWav = vi.fn(async () => wav);
const withAiTask = vi.fn(async (_opts, fn) => fn({ signal: "the-task-signal" }));
const reportError = vi.fn();
const slot = (tag) => ({ setup: (_p, { slots }) => () => h(tag, slots.default?.()) });
vi.mock("@delebash/ui", () => ({
  pushToast: vi.fn(),
  reportError,
  pageFlow: () => ({}),
  recordMicrophone,
  toWav,
  withAiTask,
  AiTaskStrips: { render: () => null },
  UiButton: { props: ["label"], emits: ["click"], setup: (p, { emit }) => () => h("button", { onClick: () => emit("click") }, p.label) },
  UiInput: { render: () => h("input") },
  UiTag: slot("span"),
  UiChip: slot("span"),
}));

const { default: CapturesPage } = await import("./CapturesPage.vue");

let app;
let el;
afterEach(() => {
  app?.unmount();
  el?.remove();
  vi.clearAllMocks();
  listed.value = [];
});

async function settle() {
  for (let i = 0; i < 5; i++) await nextTick();
  await new Promise((r) => setTimeout(r, 0));
  await nextTick();
}
const button = (re) => [...el.querySelectorAll("button")].find((b) => re.test(b.textContent));

async function mount() {
  el = document.createElement("div");
  document.body.appendChild(el);
  app = createTestApp(CapturesPage);
  app.component("QPage", slot("div"));
  app.mount(el);
  await settle();
}

test("record_then_stop_sends_the_recording_as_wav_and_opens_its_capture", async () => {
  await mount();
  expect(el.textContent).toContain("No captures yet. Press ● Record to dictate.");
  await new DOMWrapper(button(/^● Record$/)).trigger("click");
  await settle();
  expect(recordMicrophone).toHaveBeenCalledTimes(1);
  expect(button(/^■ Stop · 0:00$/)).toBeTruthy();

  await new DOMWrapper(button(/^■ Stop/)).trigger("click");
  await settle();
  expect(stop).toHaveBeenCalledTimes(1);
  expect(toWav).toHaveBeenCalledWith(recorded);
  expect(withAiTask.mock.calls[0][0]).toMatchObject({ feature: "transcription", label: "Transcribing a recording" });
  const [url, form, opts] = postForm.mock.calls[0];
  expect(url).toBe("/v1/captures");
  expect(form.get("source")).toBe("mic");
  expect(form.get("file").name).toBe("recording.wav");
  expect(form.get("file").type).toBe("audio/wav");
  expect(opts).toEqual({ signal: "the-task-signal" });
  expect(button(/^● Record$/)).toBeTruthy();
  expect(el.querySelector(".captures__body").textContent).toBe("Call the harbour master.");
  expect(reportError).not.toHaveBeenCalled();
});

test("a_refused_microphone_says_so_and_records_nothing", async () => {
  recordMicrophone.mockRejectedValueOnce(Object.assign(new Error("Permission denied"), { name: "NotAllowedError" }));
  await mount();
  await new DOMWrapper(button(/^● Record$/)).trigger("click");
  await settle();
  expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ name: "NotAllowedError" }), { title: "Microphone unavailable" });
  expect(button(/^● Record$/)).toBeTruthy();
  expect(postForm).not.toHaveBeenCalled();
});

test("no_card_shows_hotkeys_auto_paste_or_the_pill_window", async () => {
  await mount();
  expect(el.textContent).not.toMatch(/Hotkeys|Auto-paste|Push-to-talk|coming soon|pill/i);
  expect(el.textContent).toContain("Source: Default mic");
  expect(el.textContent).toContain("Capture language: Auto-detect");
});
