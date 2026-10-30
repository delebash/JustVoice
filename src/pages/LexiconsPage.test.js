// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
//
// Lexicons' editor beside its mock (`_s10`, decided 2026-10-15 — the build's question 9): the IPA
// note is the app's amber warning banner, and Affects is a card of its own, with its words as they
// were.
import { h, nextTick, reactive } from "vue";
import { afterEach, expect, test, vi } from "vitest";
import { DOMWrapper } from "@vue/test-utils";
import { createTestApp } from "@delebash/ui/quasar/install.js";

const reach = { value: null };
vi.mock("../stores/api.js", () => ({
  useApi: () => ({
    request: async () => ({}),
    safeRequest: async (url, fallback) => {
      if (url === "/v1/engines/capabilities") return { engines: { kokoro: { supports_phoneme_input: true, display_name: "Kokoro" } } };
      if (url.endsWith("/reach")) return reach.value;
      return fallback;
    },
  }),
}));
const store = (items) => () => reactive({ items, reload: async () => {} });
vi.mock("../stores/lexicons.js", () => ({
  useLexiconsStore: store([{ id: "lx1", name: "Harbor names", scope: "global", entries: [{ grapheme: "quay", phoneme_ipa: "/kiː/" }] }]),
}));
vi.mock("../stores/projects.js", () => ({ useProjectsStore: store([]) }));
vi.mock("../stores/personas.js", () => ({ usePersonasStore: store([{ id: "p1", name: "June" }]) }));
vi.mock("../stores/activeProject.js", () => ({ useActiveProject: () => ({ id: null }) }));
vi.mock("../services/voiceAudition.js", () => ({ auditionWithLexicon: vi.fn(), lexiconTake: vi.fn(), replaysTake: vi.fn() }));
vi.mock("../components/PagePlayer.vue", () => ({ default: { render: () => null } }));
vi.mock("../components/PlayTransport.vue", () => ({ default: { render: () => null } }));
const slot = (tag) => ({ setup: (_p, { slots }) => () => h(tag, slots.default?.()) });
vi.mock("@delebash/ui", () => ({
  pushToast: vi.fn(),
  saveBlob: vi.fn(),
  pageFlow: () => ({}),
  confirmDialog: vi.fn(),
  promptDialog: vi.fn(),
  UiButton: { props: ["label"], setup: (p) => () => h("button", p.label) },
  UiField: { props: ["label"], setup: (p, { slots }) => () => h("div", { class: "field" }, [h("label", p.label), slots.default?.()]) },
  UiInput: { setup: (_p, { expose }) => { expose({ focus() {} }); return () => h("input"); } },
  UiTag: slot("span"),
  UiChip: slot("span"),
  UiSelect: { setup: () => () => h("select") },
  EmptyState: { render: () => null },
  AppModal: { setup: (_p, { slots }) => () => h("div", { class: "modal" }, [slots.default?.(), slots.footer?.()]) },
  UiTable: {
    props: ["data", "columns"],
    setup: (p, { slots }) => () =>
      h("table", p.data.map((row) => h("tr", p.columns.map((c) => h("td", slots[c.id] ? slots[c.id]({ row }) : row[c.accessorKey]))))),
  },
}));

const { default: LexiconsPage } = await import("./LexiconsPage.vue");

let app;
let el;
afterEach(() => {
  app?.unmount();
  el?.remove();
});

async function settle() {
  for (let i = 0; i < 5; i++) await nextTick();
  await new Promise((r) => setTimeout(r, 0));
  await nextTick();
}

/** The page, its editor opened on the one lexicon. */
async function openEditor() {
  el = document.createElement("div");
  document.body.appendChild(el);
  app = createTestApp(LexiconsPage);
  app.component("QPage", slot("div"));
  app.mount(el);
  await settle();
  await new DOMWrapper([...el.querySelectorAll("button")].find((b) => b.textContent === "Edit")).trigger("click");
  await settle();
}

test("the_ipa_note_is_the_amber_warning_banner", async () => {
  reach.value = { projects: [], personas: [], lines: 0 };
  await openEditor();
  const banner = el.querySelector(".jv-banner.jv-banner--warn");
  expect(banner?.textContent).toBe(
    "Spoken as IPA by Kokoro. Every other model reads the respelling — an entry with only IPA does nothing there.",
  );
});

test("affects_is_a_card_with_its_words", async () => {
  reach.value = { projects: [{ id: "b1", name: "The Ninth Facet" }], personas: [{ id: "p1" }], lines: 37 };
  await openEditor();
  const card = el.querySelector(".jv-card.jv-card--soft");
  expect(card.querySelector(".jv-card__title").textContent).toBe("Affects");
  expect(card.querySelector(".jv-card__body").textContent).toBe(
    "37 lines contain one of these words. Editing an entry makes them read stale on Render — nothing renders again until you choose to.",
  );
});

test("affects_says_when_nothing_reads_the_lexicon", async () => {
  reach.value = { projects: [], personas: [], lines: 0 };
  await openEditor();
  expect(el.querySelector(".jv-card.jv-card--soft .jv-card__body").textContent).toBe(
    "Nothing reads this lexicon yet — choose it on a book's Overview or on a persona's page.",
  );
});
