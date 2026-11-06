// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
//
// Discover's names: the AI suggests, you link (decided 2026-10-16) — the real page in the states
// its mock draws (pages/mock/MockDiscoverPage.vue): before the AI, finding, its suggestions,
// linked, kept apart, after Make the audiobook, a new scan, failed. The server is a fake that
// answers as the discover routes do; the names are gemma's scans of Alice VII–VIII.
import { h, nextTick, ref } from "vue";
import { afterEach, expect, test, vi } from "vitest";
import { DOMWrapper } from "@vue/test-utils";
import { createTestApp } from "@delebash/ui/quasar/install.js";

const slot = (tag, cls) => ({ props: ["title"], setup: (p, { slots }) => () => h(tag, { class: cls, title: p.title }, slots.default?.()) });
const toasts = [];
let findReply = null;
const runAiEndpoint = vi.fn(async ({ request, path }) => (findReply ? findReply() : request(path, { method: "POST" })));
vi.mock("@delebash/ui", () => ({
  confirmDialog: vi.fn(async () => true),
  pushToast: (t) => toasts.push(t),
  runAiEndpoint: (...a) => runAiEndpoint(...a),
  withAiTask: vi.fn(),
  reportError: vi.fn(),
  saveBlob: vi.fn(),
  UiButton: {
    props: ["label", "disabled", "loading", "title"],
    emits: ["click"],
    setup: (p, { emit }) => () => h("button", { disabled: p.disabled, title: p.title, "data-loading": p.loading ? "1" : null, onClick: () => emit("click") }, p.label),
  },
  UiCheckbox: {
    props: ["modelValue", "disabled", "title"],
    emits: ["update:modelValue"],
    setup: (p, { emit }) => () => h("input", { type: "checkbox", checked: p.modelValue, disabled: p.disabled, onChange: (e) => emit("update:modelValue", e.target.checked) }),
  },
  UiChip: { props: ["selected", "title"], emits: ["click"], setup: (_p, { slots, emit }) => () => h("button", { class: "chip", onClick: () => emit("click") }, slots.default?.()) },
  UiTag: slot("span", "tag"),
  UiTable: {
    props: ["data", "columns"],
    setup: (p, { slots, attrs }) => () =>
      h("table", { class: attrs.class }, [
        h("tbody", p.data.length
          ? p.data.map((row) => h("tr", p.columns.map((c) => h("td", slots[c.id] ? slots[c.id]({ row }) : String(row[c.id] ?? "")))))
          : [h("tr", [h("td", slots.empty?.())])]),
      ]),
  },
}));
const requests = [];
let routes = {};
vi.mock("../stores/api.js", () => ({
  useApi: () => ({
    request: async (path, opts = {}) => {
      requests.push([opts.method || "GET", path, opts.body ? JSON.parse(opts.body) : null]);
      const answer = routes[`${opts.method || "GET"} ${path.replace(/^\/v1\/projects\/p1/, "")}`];
      if (!answer) throw new Error(`no route ${path}`);
      return answer(opts.body ? JSON.parse(opts.body) : null);
    },
  }),
}));
vi.mock("../stores/projects.js", () => ({ useProjectsStore: () => ({ reload: vi.fn() }) }));
vi.mock("../services/copy.js", () => ({
  useCopy: () => ref({ chapter: { singular: "Chapter", plural: "Chapters" }, book: { singular: "Book" } }),
}));
vi.mock("../services/chapterRun.js", () => ({
  chapterRunFor: () => null, failureOf: () => null, inRun: () => null, queueChapters: vi.fn(),
}));
vi.mock("../services/narrator.js", () => ({ addNarrator: vi.fn(), hasNarrator: () => true }));
vi.mock("./StudioRunBanner.vue", () => ({ default: { setup: () => () => null } }));

const { default: StudioDiscover } = await import("./StudioDiscover.vue");

const QUEEN = ["Queen of Hearts", "the Queen"];
const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();
const scan = (at, candidates) => ({ discover: { scanned_at: at, candidates, named_cast: [] } });
const SCENES = (viiAt = minutesAgo(12), viiiAt = minutesAgo(11)) => [
  { id: "vii", title: "VII", position: 0, metadata: scan(viiAt, [
    { name: "Hatter", approx_lines: 23, evidence: "The Hatter opened his eyes very wide" },
    { name: "Queen of Hearts", approx_lines: 0, evidence: "the great concert given by the Queen of Hearts" },
  ]) },
  { id: "viii", title: "VIII", position: 1, metadata: scan(viiiAt, [
    { name: "the Queen", approx_lines: 13, evidence: "if the Queen was to find it out" },
    { name: "Five", approx_lines: 4, evidence: "said Five, in a sulky tone" },
  ]) },
];
const NARRATOR = { id: "s_narrator", name: "Narrator", aliases: [], narrator: true, lines: 0 };
const people = (more = {}) => ({ check: { status: "none" }, suggestions: [], links: [], apart: [], ...more });
const DONE = (m, by = "button") => ({ status: "done", at: minutesAgo(m), by, model: "gemma-4-26b-a4b-qat", recipe: "local", error: null });

let app;
let el;
afterEach(() => {
  app?.unmount();
  el?.remove();
  toasts.length = 0;
  requests.length = 0;
  routes = {};
  findReply = null;
  runAiEndpoint.mockClear();
});

async function mount({ discoverPeople = people(), cast = [NARRATOR], scenes = SCENES() } = {}) {
  el = document.createElement("div");
  document.body.appendChild(el);
  const events = [];
  app = createTestApp(StudioDiscover, {
    project: { id: "p1", name: "Alice", discover_ignored: [], discover_people: discoverPeople },
    scenes, cast, personas: [], linesByScene: { vii: 105, viii: 71 },
    onCastChanged: (...a) => events.push(["cast-changed", ...a]),
  });
  app.mount(el);
  await settle();
  return events;
}
async function settle() {
  for (let i = 0; i < 4; i++) await nextTick();
  await new Promise((r) => setTimeout(r, 0));
  await nextTick();
}
const text = () => el.textContent.replace(/\s+/g, " ");
const button = (label) => [...el.querySelectorAll("button")].find((b) => b.textContent.trim() === label);
const click = async (node) => {
  await new DOMWrapper(node).trigger("click");
  await settle();
};
// The Speakers found table's names, in order (its first column is the tick).
const rowNames = () => [...[...el.querySelectorAll("table")].at(-1).querySelectorAll("tbody tr")]
  .map((tr) => tr.querySelectorAll("td")[1]?.querySelector("strong")?.textContent).filter(Boolean);

test("before the AI: every name is its own row, and the line says what Find same people does", async () => {
  await mount();
  expect(text()).toContain("Some people are named more than one way — “the Queen” and “Queen of Hearts”. Find same people asks the AI which names are one person; you link them.");
  expect(button("Find same people")).toBeTruthy();
  expect(rowNames()).toEqual(["Hatter", "the Queen", "Five", "Queen of Hearts"]);
  expect(text()).not.toContain("also written");
  expect(text()).not.toContain("Same person?");
  expect(text()).toContain("Kept apart 0");
});

test("Find same people asks the model it names, then lists the AI's answer — nothing in the table changes", async () => {
  routes["GET /discover/find"] = () => ({ configured: true, model: "gemma-4-26b-a4b-qat", recipe: "local", detail: null });
  let answer;
  findReply = () => new Promise((resolve) => { answer = resolve; });
  await mount();
  await click(button("Find same people"));
  expect(text()).toContain("Asking gemma-4-26b-a4b-qat which of these names are one person…");
  expect(runAiEndpoint.mock.calls[0][0]).toMatchObject({ path: "/v1/projects/p1/discover/find", task: { feature: "speaker_merge" } });
  answer({ discover_people: people({ check: DONE(0), suggestions: [{ names: QUEEN, name: "Queen of Hearts" }] }), added: 1 });
  await settle();
  expect(text()).toContain("Checked just now by gemma-4-26b-a4b-qat · Local.");
  expect(text()).toContain("Same person? · 1");
  expect(text()).toContain("from gemma-4-26b-a4b-qat · Local");
  expect(text()).toContain("Queen of Hearts + the Queen");
  expect(text()).toContain("≈ 13");
  expect(button("Link all")).toBeTruthy();
  expect(button("Not the same")).toBeTruthy();
  expect(rowNames()).toEqual(["Hatter", "the Queen", "Five", "Queen of Hearts"]);
});

test("Link: one row going by the fullest name, also written the Queen with Unlink", async () => {
  const linked = people({ check: DONE(4), suggestions: [{ names: QUEEN, name: "Queen of Hearts" }], links: [{ names: QUEEN, name: "Queen of Hearts", by: "you" }] });
  routes["POST /discover/link"] = () => ({ discover_people: linked, speaker_id: null });
  await mount({ discoverPeople: people({ check: DONE(4), suggestions: [{ names: QUEEN, name: "Queen of Hearts" }] }) });
  await click(button("Link"));
  expect(requests.at(-1)).toEqual(["POST", "/v1/projects/p1/discover/link", { names: QUEEN }]);
  expect(toasts.at(-1).message).toBe("Queen of Hearts and the Queen linked as one person, Queen of Hearts. Unlink takes it back.");
  expect(text()).not.toContain("Same person?");
  expect(rowNames()).toEqual(["Hatter", "Queen of Hearts", "Five"]);
  expect(text()).toContain("also written the Queen");
  expect(button("Unlink")).toBeTruthy();
});

test("Not the same, or Unlink: the pair goes to Kept apart, with Undo", async () => {
  const apart = people({ check: DONE(4), suggestions: [{ names: QUEEN, name: "Queen of Hearts" }], apart: [{ names: QUEEN, from: "suggestion", link: null }] });
  routes["POST /discover/keep-apart"] = () => ({ discover_people: apart, speaker_id: null });
  routes["POST /discover/undo-apart"] = () => ({ discover_people: people({ check: DONE(4), suggestions: [{ names: QUEEN, name: "Queen of Hearts" }] }), speaker_id: null });
  await mount({ discoverPeople: people({ check: DONE(4), suggestions: [{ names: QUEEN, name: "Queen of Hearts" }] }) });
  await click(button("Not the same"));
  expect(toasts.at(-1).message).toBe("Queen of Hearts and the Queen kept apart — Find same people won't suggest them again. Undo is under Kept apart.");
  expect(text()).not.toContain("Same person?");
  expect(text()).toContain("Kept apart 1");
  expect(text()).toContain("kept apart from Queen of Hearts");
  expect(text()).toContain("kept apart from the Queen");
  await click([...el.querySelectorAll("button")].find((b) => b.textContent === "Undo"));
  expect(requests.at(-1)).toEqual(["POST", "/v1/projects/p1/discover/undo-apart", { names: QUEEN }]);
  expect(toasts.at(-1).message).toBe("Queen of Hearts and the Queen are back under Same person?.");
  expect(text()).toContain("Same person? · 1");
});

test("after Make the audiobook: the row says the run linked it; Unlink takes the name out of her Also called", async () => {
  const cast = [NARRATOR, { id: "s_queen", name: "Queen of Hearts", aliases: ["the Queen"], narrator: false, lines: 22 }];
  const run = people({ check: DONE(20, "run"), links: [{ names: QUEEN, name: "Queen of Hearts", by: "run" }] });
  routes["POST /discover/unlink"] = () => ({
    discover_people: people({ check: DONE(20, "run"), apart: [{ names: QUEEN, from: "unlink", link: { name: "Queen of Hearts", by: "run" } }] }),
    speaker_id: "s_queen",
  });
  const events = await mount({ discoverPeople: run, cast, scenes: SCENES(minutesAgo(21), minutesAgo(21)) });
  expect(text()).toContain("Checked 20 min ago by gemma-4-26b-a4b-qat · Local, during Make the audiobook.");
  expect(text()).toContain("also written the Queen");
  expect(text()).toContain("linked by Make the audiobook");
  await click(button("Unlink"));
  expect(requests.at(-1)).toEqual(["POST", "/v1/projects/p1/discover/unlink", { name: "the Queen" }]);
  expect(events).toEqual([["cast-changed"]]);
  expect(toasts.at(-1).message).toBe("the Queen is no longer Queen of Hearts' other name and shows as new. Lines already given to Queen of Hearts stay. Undo is under Kept apart.");
});

test("a new scan after a check: the line counts it and Find again stands out", async () => {
  await mount({ discoverPeople: people({ check: DONE(25) }), scenes: SCENES(minutesAgo(40), minutesAgo(2)) });
  expect(text()).toContain("Checked 25 min ago by gemma-4-26b-a4b-qat · Local · 1 chapter scanned since.");
  expect(button("Find again")).toBeTruthy();
});

test("failed: the line says why, with Try again", async () => {
  await mount({ discoverPeople: people({ check: { status: "failed", at: minutesAgo(1), by: "button", model: null, recipe: "local", error: "No language model is set up — set one in AI Settings first." } }) });
  expect(text()).toContain("failed");
  expect(text()).toContain("Couldn't check the names. No language model is set up — set one in AI Settings first.");
  expect(button("Try again")).toBeTruthy();
});

test("Link selected as one person: two or more ticked names, never two speakers", async () => {
  const cast = [NARRATOR, { id: "s_hatter", name: "Hatter", aliases: [], narrator: false, lines: 0 }, { id: "s_five", name: "Five", aliases: [], narrator: false, lines: 0 }];
  await mount({ cast });
  const linkButton = () => [...el.querySelectorAll("button")].find((b) => b.textContent.startsWith("Link") && b.textContent.endsWith("as one person"));
  expect(linkButton().disabled).toBe(true);
  expect(linkButton().title).toBe("Tick two or more names that are one person.");
  const tick = async (name) => {
    const tr = [...[...el.querySelectorAll("table")].at(-1).querySelectorAll("tbody tr")].find((r) => r.querySelector("strong")?.textContent === name);
    const box = tr.querySelector("input");
    box.checked = true;
    await new DOMWrapper(box).trigger("change");
    await settle();
  };
  await tick("Hatter");
  await tick("Five");
  expect(linkButton().disabled).toBe(true);
  expect(linkButton().title).toBe("Two of the ticked names are already speakers in this book — joining speakers isn't done here.");
});
