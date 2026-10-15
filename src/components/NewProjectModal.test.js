// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
//
// New project's table of sources (2026-10-15, the build's question 9 — "its source table's columns
// and words go plain, toward the mock's"): Source with its file endings, What lands in the
// server's words, and Says who speaks? as a yes / no tag from the server's `says_who_speaks`.
import { h, nextTick } from "vue";
import { afterEach, expect, test, vi } from "vitest";
import { createTestApp } from "@delebash/llm-ui/quasar/install.js";

vi.mock("@delebash/llm-ui", () => ({
  openHelp: vi.fn(),
  pushToast: vi.fn(),
  fmtBytes: (n) => `${n} B`,
  languageName: (c) => c,
  UiButton: { props: ["label", "disabled", "intent"], setup: (p, { slots }) => () => h("button", { disabled: p.disabled }, p.label ?? slots.default?.()) },
  UiInput: { setup: (_p, { expose }) => { expose({ focus() {}, select() {} }); return () => h("input"); } },
  UiSelect: { props: ["modelValue", "options"], setup: () => () => h("select") },
  UiTag: { props: ["intent"], setup: (p, { slots }) => () => h("span", { class: `tag tag--${p.intent}` }, slots.default?.()) },
  UiTable: {
    props: ["data", "columns"],
    setup: (p, { slots }) => () =>
      h("table", [
        h("thead", [h("tr", p.columns.map((c) => h("th", c.header)))]),
        h("tbody", p.data.map((row) =>
          h("tr", p.columns.map((c) => h("td", slots[c.id] ? slots[c.id]({ row }) : row[c.accessorKey]))))),
      ]),
  },
  AppModal: { setup: (_p, { slots }) => () => h("div", [slots.default?.(), slots.footer?.()]) },
}));
vi.mock("../services/projects.js", () => ({
  projectsService: {
    listImportAdapters: async () => ({
      adapters: [
        { id: "book_prose", label: "Book / manuscript", description: "Chapters and paragraphs.", file_extensions: [".epub", ".txt"], implemented: true, says_who_speaks: false },
        { id: "csv_lines", label: "CSV lines", description: "A line per row.", file_extensions: [".csv"], implemented: true, says_who_speaks: true },
      ],
    }),
  },
}));
vi.mock("../stores/importDraft.js", () => ({ setImportDraft: vi.fn() }));
vi.mock("../stores/voices.js", () => ({ useVoicesStore: () => ({ items: [], ensureLoaded() {} }) }));

const { default: NewProjectModal } = await import("./NewProjectModal.vue");

let app;
let el;
afterEach(() => {
  app?.unmount();
  el?.remove();
});

test("the_sources_table_says_what_lands_and_who_speaks", async () => {
  el = document.createElement("div");
  document.body.appendChild(el);
  app = createTestApp(NewProjectModal, {});
  app.mount(el);
  for (let i = 0; i < 5; i++) await nextTick();
  await new Promise((r) => setTimeout(r, 0));
  await nextTick();
  expect([...el.querySelectorAll("th")].map((th) => th.textContent)).toEqual(["Source", "What lands", "Says who speaks?"]);
  const rows = [...el.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent.trim()));
  expect(rows).toEqual([
    ["Book / manuscript.epub · .txt", "Chapters and paragraphs.", "no"],
    ["CSV lines.csv", "A line per row.", "yes"],
  ]);
  expect(el.querySelector("tbody tr:nth-child(2) .tag").className).toContain("tag--success");
});
