// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
//
// The re-import dialog's "What is this format?" (2026-10-15, P28's lean "keep, and bring back
// 'What is this format?'"): it opened docs/import-and-export.md in a new window, which the
// desktop window never opens for an app:// link and the headless server doesn't serve. It opens
// the chosen format's section in the Help drawer, as New project's dialog does.
import { h, nextTick } from "vue";
import { afterEach, expect, test, vi } from "vitest";
import { createTestApp } from "@delebash/ui/quasar/install.js";

const openHelp = vi.fn();
vi.mock("@delebash/ui", () => ({
  openHelp: (...a) => openHelp(...a),
  pushToast: vi.fn(),
  UiButton: { props: ["label", "disabled", "intent", "loading"], setup: (p) => () => h("button", { disabled: p.disabled }, p.label) },
  UiSelect: { props: ["modelValue", "options", "placeholder", "disabled"], setup: () => () => h("select") },
  AppModal: { setup: (_p, { slots }) => () => h("div", [slots.default?.(), slots.footer?.()]) },
}));
vi.mock("../services/projects.js", () => ({
  projectsService: {
    listImportAdapters: async () => ({
      adapters: [{ id: "justwrite", label: "JustWrite", description: "A JustWrite book.", file_extensions: [".justwrite"], implemented: true, docs_anchor: "import-justwrite" }],
    }),
  },
}));
vi.mock("../stores/importDraft.js", () => ({ setImportDraft: vi.fn() }));

const { default: ImportModal } = await import("./ImportModal.vue");

let app;
let el;
afterEach(() => {
  app?.unmount();
  el?.remove();
  openHelp.mockReset();
});

test("what_is_this_format_opens_the_formats_help", async () => {
  el = document.createElement("div");
  document.body.appendChild(el);
  app = createTestApp(ImportModal, { projectId: "p1" });
  app.mount(el);
  for (let i = 0; i < 5; i++) await nextTick();
  await new Promise((r) => setTimeout(r, 0));
  await nextTick();
  const link = [...el.querySelectorAll("a")].find((a) => a.textContent === "What is this format?");
  expect(link).toBeTruthy();
  expect(link.getAttribute("target")).toBeNull();
  link.click();
  expect(openHelp).toHaveBeenCalledWith("import-and-export", "import-justwrite");
});
