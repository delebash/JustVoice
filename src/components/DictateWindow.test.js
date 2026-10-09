// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
//
// The dictation window's agent-speech cycle plays the generation from the
// route that serves it, /v1/generations/<id>/audio (ruling 6 of the 2026-10-08
// clean-room rewrite — it used to ask for /audio/<id>, which no route serves).
import { h, nextTick } from "vue";
import { afterEach, expect, test, vi } from "vitest";
// Quasar installed as in the real app — the kit's controls are Quasar components
import { createTestApp } from "@delebash/llm-ui/quasar/install.js";

const handlers = {};
const emitted = [];
vi.mock("../services/native.js", () => ({
  dictateEmit: (event, payload) => {
    emitted.push([event, payload]);
    return Promise.resolve();
  },
  onDictateEvent: (event, fn) => {
    handlers[event] = fn;
    return () => delete handlers[event];
  },
}));
vi.mock("../stores/api.js", () => ({ useApi: () => ({ serverUrl: "http://127.0.0.1:17494" }) }));
vi.mock("@delebash/llm-ui", () => ({
  Icon: { setup: () => () => h("i") },
  UiButton: { setup: (_p, { slots }) => () => h("button", slots.icon?.()) },
}));

const streams = [];
class FakeEventSource {
  constructor(url) {
    this.url = url;
    this.closed = false;
    streams.push(this);
  }
  close() {
    this.closed = true;
  }
}
const players = [];
class FakeAudio {
  constructor(src) {
    this.src = src;
    players.push(this);
  }
  play() {
    return Promise.resolve();
  }
  pause() {}
  removeAttribute() {}
}

const { default: DictateWindow } = await import("./DictateWindow.vue");

let app;
let el;
afterEach(() => {
  app?.unmount();
  el?.remove();
  streams.length = 0;
  players.length = 0;
  emitted.length = 0;
});

async function mount() {
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("Audio", FakeAudio);
  el = document.createElement("div");
  document.body.appendChild(el);
  app = createTestApp({ render: () => h(DictateWindow) });
  app.mount(el);
  await nextTick();
}

test("an_agents_generation_plays_from_its_audio_route", async () => {
  await mount();
  handlers["dictate:speak-start"](JSON.stringify({ generation_id: "gen-1" }));
  await nextTick();
  expect(streams[0].url).toBe("http://127.0.0.1:17494/v1/generate/gen-1/status");
  expect(el.textContent).toContain("Transcribing…");

  streams[0].onmessage({ data: JSON.stringify({ id: "gen-1", status: "completed" }) });
  expect(streams[0].closed).toBe(true);
  expect(players).toHaveLength(1);
  expect(players[0].src).toBe("http://127.0.0.1:17494/v1/generations/gen-1/audio");

  players[0].onplaying();
  await nextTick();
  expect(emitted.map(([e]) => e)).toContain("dictate:show");
  expect(el.textContent).toContain("Speaking…");

  players[0].onended();
  await nextTick();
  expect(emitted.at(-1)[0]).toBe("dictate:hide");
  expect(el.textContent).not.toContain("Speaking…");
});
