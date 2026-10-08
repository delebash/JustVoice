// SPDX-License-Identifier: MIT
// Speaker identification — parser + discover/promote endpoints (the port of
// tests/test_discover_speakers.py): the parser, then the app's routes — Discover, ＋ Add,
// Ignore, the ad-hoc Lab door, the usage ledger, show notes.
//
// Every model call is stubbed: `identify.identifySpeakers` (Python's
// `justvoice.extraction.identify.identify_speakers`), `run.runFeature`
// (`justvoice.engines.llm.run.run_feature`), `pipeline.runFeature` / `measureFeature`, or a fake
// adapter registered under the preset's `local-llamacpp` id with the bundled-runner load off.
import { getLedger } from "@delebash/llm-runner/llm/usage";
import { getLlmRegistry, LLMResponse } from "@delebash/llm-runner/llm";
import * as dispatch from "@delebash/llm-runner/llm/dispatch";
import { LLMNotConfiguredError, setEnsureLocalModel } from "@delebash/llm-runner/llm/dispatch";
import * as http from "@delebash/llm-runner/platform/http";
import { afterEach, expect, test, vi } from "vitest";
import { _resolveCast } from "../src/api/extraction_api.js";
import { getState } from "../src/app_state.js";
import * as session from "../src/database/session.js";
import * as run from "../src/engines/llm/run.js";
import * as identify from "../src/extraction/identify.js";
import { IDENTIFY_SYSTEM, SpeakerCandidate, parseCandidates } from "../src/extraction/identify.js";
import * as pipeline from "../src/extraction/pipeline.js";
import { appClient, closeApps } from "./app_helpers.js";
import { bookJson } from "./jw_fixtures.js";

// ── parser ───────────────────────────────────────────────────────────

test("parse_plain_array", () => {
  const raw = '[{"name": "Tom Harlan", "role_hint": "neighbor", "approx_lines": 11}]';
  expect(parseCandidates(raw, ["Mara Vance"])).toEqual([new SpeakerCandidate({ name: "Tom Harlan", role_hint: "neighbor", approx_lines: 11 })]);
});

test("parse_code_fenced_with_chatter", () => {
  const raw = 'Sure! Here are the new speakers:\n```json\n[{"name": "The Stranger"}]\n```\nLet me know!';
  expect(parseCandidates(raw, []).map((c) => c.name)).toEqual(["The Stranger"]);
});

test("parse_dedupes_known_and_self_case_insensitive", () => {
  const raw = '[{"name": "MARA VANCE"}, {"name": "Tom"}, {"name": "tom"}, {"name": "narrator"}]';
  expect(parseCandidates(raw, ["Mara Vance"]).map((c) => c.name)).toEqual(["Tom"]);
});

test("parse_keeps_the_evidence_quote", () => {
  const raw = '[{"name": "Edith", "role_hint": "poured the tea", "approx_lines": 0, "evidence": "Edith’s hands"}]';
  expect(parseCandidates(raw, [])).toEqual([new SpeakerCandidate({ name: "Edith", role_hint: "poured the tea", approx_lines: 0, evidence: "Edith’s hands" })]);
});

test("the_shipped_prompt_asks_for_named_people_not_speakers_or_descriptors", () => {
  // 2026-09-27: the old default asked for speakers only and offered "the stranger" as a name —
  // the demo got "child" / "the elder" and lost Edith.
  expect(IDENTIFY_SYSTEM).toContain("whether or not they speak");
  expect(IDENTIFY_SYSTEM).toContain('"child"');
  expect(IDENTIFY_SYSTEM).toContain("are not characters");
  expect(IDENTIFY_SYSTEM).toContain('"evidence"');
  expect(IDENTIFY_SYSTEM.toLowerCase()).not.toContain("the stranger");
  expect(IDENTIFY_SYSTEM).toContain("named object"); // fix B — not "Gudgeon" the maul
  expect(IDENTIFY_SYSTEM).toContain("nickname"); // fix 2 — not "Ode" for Odeline
});

test("parse_garbage_returns_empty", () => {
  expect(parseCandidates("I could not find any JSON to give you.", [])).toEqual([]);
  expect(parseCandidates('{"name": "not a list"}', [])).toEqual([]);
});

// ── endpoints ────────────────────────────────────────────────────────

afterEach(async () => {
  await closeApps();
  // The tests that empty the registry or register a fake adapter leave it as the next app
  // build finds it.
  getLlmRegistry()._adapters = new Map();
  setEnsureLocalModel(null);
});

/** The `client` fixture: the app on a fresh data dir, workspace seeded. */
async function makeClient() {
  return (await appClient(undefined, { seed: true })).c;
}

/** A real JustWrite book.json (jw_fixtures.js). Its lines arrive SPEAKERLESS — JustWrite does
 * not attribute dialogue — which is exactly the state these discovery tests are about. */
async function _importProject(c) {
  const r = await c.post("/v1/projects/import?source=justwrite", { json: bookJson() });
  expect(r.status, r.text).toBe(200);
  const pid = r.json().project_id;
  const scenes = (await c.get(`/v1/projects/${pid}/scenes`)).json();
  return [pid, scenes[0].id];
}

test("discover_501_without_llm", async () => {
  // No LLM configured must map to 501, and the no-LLM state is FORCED — both sides of the seam
  // are patched, so the test does not depend on what is installed.
  const refuse = () => {
    throw new LLMNotConfiguredError("no LLM provider registered");
  };
  vi.spyOn(dispatch, "chat").mockImplementation(refuse);
  vi.spyOn(identify, "identifySpeakers").mockImplementation(async () => refuse());

  const c = await makeClient();
  const [, sceneId] = await _importProject(c);
  const r = await c.post(`/v1/scenes/${sceneId}/discover-speakers`, { json: { text: "“Hi,” said Tom." } });
  expect(r.status, r.text).toBe(501);
});

test("discover_with_stubbed_llm", async () => {
  const c = await makeClient();
  const [, sceneId] = await _importProject(c);

  vi.spyOn(identify, "identifySpeakers").mockImplementation(async (_text, known) => {
    // The cast arrives as people, not bare names (fix 2): name, aliases, and the character
    // sheet the model gets one line of.
    expect(known.map((k) => k.name)).toContain("Mara Vance");
    expect(known.every((k) => "aliases" in k && "description" in k)).toBe(true);
    return [new SpeakerCandidate({ name: "Tom Harlan", role_hint: "neighbor", approx_lines: 3 })];
  });
  const r = await c.post(`/v1/scenes/${sceneId}/discover-speakers`, { json: { text: "“Hi,” said Tom." } });
  expect(r.status, r.text).toBe(200);
  expect(r.json().candidates).toEqual([{ name: "Tom Harlan", role_hint: "neighbor", approx_lines: 3, evidence: null, evidence_found: null }]);
  expect(r.json().named_cast, "the text names nobody in the cast").toEqual([]);
});

async function _speakers(c, pid) {
  return (await c.get(`/v1/projects/${pid}/speakers`)).json().speakers;
}

test("add_makes_a_speaker_and_no_persona", async () => {
  // Since 2026-09-29 Discover's Add makes a speaker in this book; the library of personas (the
  // voices) is not touched. Adding the same name again is refused — names are unique within a
  // book.
  const c = await makeClient();
  const [pid] = await _importProject(c);
  const body = { candidates: [{ name: "Tom Harlan", description: "neighbor" }] };
  const r1 = await c.post(`/v1/projects/${pid}/speakers/promote`, { json: body });
  expect(r1.status, r1.text).toBe(200);
  expect(r1.json().created.length).toBe(1);
  expect(r1.json().reused).toEqual([]);
  const tom = (await _speakers(c, pid)).find((sp) => sp.name === "Tom Harlan");
  expect([tom.id, tom.description, tom.persona_id]).toEqual([r1.json().created[0], "neighbor", null]);
  expect((await c.get("/v1/personas")).json().personas).toEqual([]);
  expect((await c.post(`/v1/projects/${pid}/speakers/promote`, { json: body })).status).toBe(409);
});

async function _scan(c, sceneId, names) {
  vi.spyOn(identify, "identifySpeakers").mockImplementation(async () => names.map((n) => new SpeakerCandidate({ name: n, role_hint: null, approx_lines: 2 })));
  const r = await c.post(`/v1/scenes/${sceneId}/discover-speakers`, { json: { text: "“Hi,” said Tom." } });
  expect(r.status, r.text).toBe(200);
}

async function _saved(c, pid, sceneId) {
  const sc = (await c.get(`/v1/projects/${pid}/scenes`)).json().find((s) => s.id === sceneId);
  return sc.metadata.discover ?? null;
}

test("a_scan_is_saved_on_its_chapter_and_replaces_the_last_one", async () => {
  // Decided 2026-09-27 ("both"): a chapter's scan survives a restart.
  const c = await makeClient();
  const [pid, sceneId] = await _importProject(c);
  await _scan(c, sceneId, ["Tom Harlan", "The Stranger"]);
  const saved = await _saved(c, pid, sceneId);
  expect(saved.scanned_at).toBeTruthy();
  expect(saved.candidates.map((x) => x.name)).toEqual(["Tom Harlan", "The Stranger"]);

  await _scan(c, sceneId, ["Old Crow"]);
  expect((await _saved(c, pid, sceneId)).candidates.map((x) => x.name)).toEqual(["Old Crow"]);
});

test("add_and_ignore_keep_the_saved_scan", async () => {
  // Decided 2026-09-29 ("your rec go"): Add and Ignore change a name's status, they don't
  // remove it — the chapter's record of who it names stays whole.
  const c = await makeClient();
  const [pid, sceneId] = await _importProject(c);
  await _scan(c, sceneId, ["Tom Harlan", "The Stranger", "Old Crow"]);
  const everyone = ["Tom Harlan", "The Stranger", "Old Crow"];

  let r = await c.post(`/v1/projects/${pid}/speakers/promote`, { json: { candidates: [{ name: "tom harlan" }] } });
  expect(r.status, r.text).toBe(200);
  expect((await _saved(c, pid, sceneId)).candidates.map((x) => x.name)).toEqual(everyone);

  r = await c.post(`/v1/projects/${pid}/discover/ignore`, { json: { names: ["THE STRANGER"] } });
  expect(r.status).toBe(200);
  expect(r.json()).toEqual({ ignored: ["THE STRANGER"] });
  expect((await _saved(c, pid, sceneId)).candidates.map((x) => x.name)).toEqual(everyone);
});

function _stub(cands) {
  vi.spyOn(identify, "identifySpeakers").mockImplementation(async () => cands.map((x) => new SpeakerCandidate(x)));
}

test("a_scan_records_the_cast_members_the_chapter_names", async () => {
  // The book's speakers are found by name in the text, without the AI: the fixture book has
  // Mara Vance, named here in full and by her first name.
  const c = await makeClient();
  const [pid, sceneId] = await _importProject(c);
  const mara = (await _speakers(c, pid)).find((sp) => sp.name === "Mara Vance");
  _stub([]);
  const text = "Rain fell. Mara Vance opened the door. Later Mara laughed.";
  const r = await c.post(`/v1/scenes/${sceneId}/discover-speakers`, { json: { text } });
  expect(r.status, r.text).toBe(200);
  const want = [{ speaker_id: mara.id, name: "Mara Vance", mentions: 2, evidence: "Mara Vance opened the door." }];
  expect(r.json().named_cast).toEqual(want);
  expect((await _saved(c, pid, sceneId)).named_cast).toEqual(want);
});

async function _discover(c, sceneId, text = "Brick said nothing. Tom Harlan laughed.") {
  const r = await c.post(`/v1/scenes/${sceneId}/discover-speakers`, { json: { text } });
  expect(r.status, r.text).toBe(200);
  return r.json().candidates;
}

test("a_cast_member_named_by_first_or_last_name_is_not_proposed", async () => {
  // The fixture book has Mara Vance: "Mara" alone is her, not a newcomer.
  const c = await makeClient();
  const [, sceneId] = await _importProject(c);
  _stub([{ name: "Mara" }, { name: "Tom Harlan" }]);
  expect((await _discover(c, sceneId)).map((x) => x.name)).toEqual(["Tom Harlan"]);
});

test("add_casts_a_new_speaker_with_the_persona_of_exactly_its_name", async () => {
  // "In your library" (2026-09-29) = a persona of EXACTLY the found name — Add makes the
  // speaker already cast with it. A first name alone is not that name, and two personas sharing
  // the name mean neither.
  const c = await makeClient();
  const [pid, sceneId] = await _importProject(c);

  const brick = (await c.post("/v1/personas", { json: { name: "Brick Halvorn" } })).json();
  // Two personas of one name: the API refuses the second since 2026-09-29, but a library from
  // before then can hold them — the store makes them here.
  for (let i = 0; i < 2; i++) getState().personas.create("Anna");
  const r = await c.post(`/v1/projects/${pid}/speakers/promote`, {
    json: { candidates: [{ name: "brick  halvorn" }, { name: "Brick" }, { name: "Anna" }] },
  });
  expect(r.status, r.text).toBe(200);
  const cast = Object.fromEntries((await _speakers(c, pid)).map((sp) => [sp.name, sp.persona_id]));
  expect(cast["brick halvorn"]).toBe(brick.id);
  expect(cast.Brick).toBeNull();
  expect(cast.Anna).toBeNull();
  // Now a speaker — so a re-scan proposes nobody new, and records him.
  _stub([{ name: "Brick Halvorn" }]);
  expect(await _discover(c, sceneId, "Brick Halvorn said nothing.")).toEqual([]);
  const named = (await _saved(c, pid, sceneId)).named_cast;
  const brickSpeaker = (await _speakers(c, pid)).find((sp) => sp.name === "brick halvorn").id;
  expect(named.map((n) => n.speaker_id)).toContain(brickSpeaker);
});

test("add_keeps_the_other_spellings_as_also_called", async () => {
  // A merged proposal ("Old Sedge" + "Sedge") becomes one speaker that knows both names. The
  // saved scan keeps both names (Add changes status only).
  const c = await makeClient();
  const [pid, sceneId] = await _importProject(c);
  _stub([{ name: "Old Sedge" }, { name: "Sedge" }]);
  await _discover(c, sceneId);
  const r = await c.post(`/v1/projects/${pid}/speakers/promote`, { json: { candidates: [{ name: "Old Sedge", aliases: ["Sedge"] }] } });
  const created = r.json().created;
  expect(created.length).toBe(1);
  const [newId] = created;
  expect((await _speakers(c, pid)).find((sp) => sp.id === newId).aliases).toEqual(["Sedge"]);
  expect((await _saved(c, pid, sceneId)).candidates.map((x) => x.name)).toEqual(["Old Sedge", "Sedge"]);
});

test("the_quote_is_checked_against_the_chapter", async () => {
  // Fix 3: an invented quote is flagged, a real one (any quote marks) passes.
  const c = await makeClient();
  const [, sceneId] = await _importProject(c);
  _stub([
    { name: "Tom Harlan", evidence: "Tom Harlan laughed" },
    { name: "Old Crow", evidence: "Old Crow spat" },
  ]);
  const got = Object.fromEntries((await _discover(c, sceneId)).map((x) => [x.name, x.evidence_found]));
  expect(got).toEqual({ "Tom Harlan": true, "Old Crow": false });
});

test("ignore_is_remembered_across_scans_and_can_be_undone", async () => {
  // Fix 4: an ignored name is remembered for the project. Since 2026-09-29 a re-scan still
  // records it — the page shows it as Ignored, with Undo.
  const c = await makeClient();
  const [pid, sceneId] = await _importProject(c);
  _stub([{ name: "Gudgeon" }, { name: "Tom Harlan" }]);
  await _discover(c, sceneId);
  let r = await c.post(`/v1/projects/${pid}/discover/ignore`, { json: { names: ["Gudgeon"] } });
  expect(r.json().ignored).toEqual(["Gudgeon"]);
  expect((await c.get(`/v1/projects/${pid}`)).json().discover_ignored).toEqual(["Gudgeon"]);
  expect((await _discover(c, sceneId)).map((x) => x.name)).toEqual(["Gudgeon", "Tom Harlan"]);

  r = await c.post(`/v1/projects/${pid}/discover/unignore`, { json: { names: ["gudgeon"] } });
  expect(r.json().ignored).toEqual([]);
  expect((await c.get(`/v1/projects/${pid}`)).json().discover_ignored).toEqual([]);
});

test("analyze_gets_speaker_aliases", async () => {
  // "Also called" reaches attribution: anchors.js and the prompt read `aliases`.
  const c = await makeClient();
  const [pid, sceneId] = await _importProject(c);
  const mara = (await _speakers(c, pid)).find((sp) => sp.name === "Mara Vance");
  const r = await c.patch(`/v1/speakers/${mara.id}`, { json: { aliases: ["Mara", " mara ", "Mara Vance"] } });
  expect(r.json().aliases, "trimmed, de-duplicated, never the speaker's own name").toEqual(["Mara"]);
  const cast = _resolveCast(sceneId, session.getDb());
  expect(cast.find((x) => x.name === "Mara Vance").aliases).toEqual(["Mara"]);
});

test("ignore_on_a_missing_project_is_404", async () => {
  const c = await makeClient();
  expect((await c.post("/v1/projects/nope/discover/ignore", { json: { names: ["x"] } })).status).toBe(404);
});

// ── The ad-hoc discovery door (the attribution Lab's identify twin) ──

test("discover_adhoc_free_text", async () => {
  // POST /v1/extraction/discover-speakers — no scene, caller-supplied known names (parity
  // batch 2026-08-06: the Lab's identify columns run this).
  const c = await makeClient();
  vi.spyOn(identify, "identifySpeakers").mockImplementation(async (text, known) => {
    expect(known).toEqual(["Mara Vance"]);
    expect(text).toContain("Tom");
    return [new SpeakerCandidate({ name: "Tom Harlan", role_hint: "neighbor", approx_lines: 3 })];
  });
  const r = await c.post("/v1/extraction/discover-speakers", { json: { text: "“Hi,” said Tom.", known_characters: ["Mara Vance"] } });
  expect(r.status, r.text).toBe(200);
  expect(r.json().scene_id).toBe("(adhoc)");
  expect(r.json().candidates).toEqual([{ name: "Tom Harlan", role_hint: "neighbor", approx_lines: 3, evidence: null, evidence_found: null }]);
});

test("discover_adhoc_threads_column_pins", async () => {
  // The Lab column's pins (provider/model/temperature/prompts) thread through the route's runFn
  // into the shared run path's kwargs.
  const c = await makeClient();
  const captured = {};
  vi.spyOn(run, "runFeature").mockImplementation(async (action, _variables, overrides) => {
    Object.assign(captured, { action, ...overrides });
    return { text: '[{"name": "Tom Harlan"}]' };
  });
  const r = await c.post("/v1/extraction/discover-speakers", {
    json: {
      text: "“Hi,” said Tom.",
      known_characters: ["Mara Vance"],
      providerId: "anthropic",
      model: "claude-sonnet-5",
      temperature: 0.1,
      systemPrompt: "CUSTOM DISCOVERY PROMPT",
    },
  });
  expect(r.status, r.text).toBe(200);
  expect(captured.action).toBe("speaker_attribution.identify");
  expect(captured.providerId).toBe("anthropic");
  expect(captured.model).toBe("claude-sonnet-5");
  expect(captured.temperature).toBe(0.1);
  expect(captured.system).toBe("CUSTOM DISCOVERY PROMPT");
  expect(r.json().candidates.map((x) => x.name)).toEqual(["Tom Harlan"]);
});

// ── Speaker Lab per-column overrides reach the LLM call ──────────────

test("analyze_text_threads_model_temp_prompt_overrides", async () => {
  // The pipeline runs through the shared run path (F1 Phase 2); the seam is its runFeature door
  // — capture what the Lab's overrides thread into the RunRequest kwargs. (The prompt measure
  // is stubbed to "run unmeasured" so nothing reaches a model.)
  const c = await makeClient();
  const captured = {};
  vi.spyOn(pipeline, "measureFeature").mockImplementation(async () => null);
  vi.spyOn(pipeline, "runFeature").mockImplementation(async (action, variables, overrides) => {
    Object.assign(captured, { action, variables, ...overrides });
    return { text: '[{"speaker": "mara", "confidence": 0.9}]' };
  });
  const r = await c.post("/v1/extraction/analyze-text", {
    json: {
      text: '"Hello," said Mara.',
      characters: [{ id: "mara", name: "Mara" }],
      model: "qwen3:14b",
      temperature: 0.05,
      systemPrompt: "CUSTOM PROMPT BODY",
    },
  });
  expect(r.status, r.text).toBe(200);
  expect(captured.model).toBe("qwen3:14b");
  expect(captured.temperature).toBe(0.05);
  expect(captured.system).toBe("CUSTOM PROMPT BODY");
  // A per-call model override is the model that actually runs, so Auto judges IT: qwen3:14b
  // reads 14B ≥ 14 → the Direct route (Auto is SIZE-ONLY since the tier-debris cleanup
  // 2026-08-07). The pipeline still never FORCES think — the caller sent none, so it rides as
  // null (Part 2, 2026-08-06: null = the route's preset value).
  expect(captured.action).toBe("speaker_attribution.direct");
  expect(captured.think ?? null).toBeNull();
  expect(captured.variables.speakers).toContain('id="mara"');
  expect(r.json().raw_llm).toBe('[{"speaker": "mara", "confidence": 0.9}]');
});

// ── local LLM detection probe ────────────────────────────────────────

test("detect_local_llm_providers", async () => {
  const c = await makeClient();
  vi.spyOn(http, "fetch").mockImplementation(async (url) => {
    if (url.includes("11434")) return Response.json({ models: [{ name: "llama3.1:8b" }, { name: "qwen3:14b" }] });
    throw new Error("down");
  });
  const r = await c.get("/v1/llm-providers/detect-local");
  expect(r.status, r.text).toBe(200);
  const det = r.json().detected;
  expect(det.length).toBe(1);
  expect(det[0].providerType).toBe("ollama");
  expect(det[0].models).toContain("qwen3:14b");
  expect(det[0].alreadyRegistered).toBe(false);
});

// ── AI usage ledger ──────────────────────────────────────────────────

/** Registered under the preset's provider id (local-llamacpp), so the REAL resolution finds it
 * (no resolve patching). `respond(messages, opts)` → an LLMResponse. */
class FakeAdapter {
  constructor(defaultModel, respond) {
    this.provider_id = "local-llamacpp";
    this.provider_type = "openai-compat";
    this.default_model = defaultModel;
    this.respond = respond;
  }

  // The rest of the options: the shared chat() surface grows (extra, reasoning knobs); a strict
  // stub signature breaks on every addition — tolerate like a real adapter does.
  async chat(messages, opts = {}) {
    return this.respond(messages, opts);
  }

  async models() {
    return [this.default_model];
  }

  async ping() {
    return true;
  }
}

test("usage_ledger_records_chat_calls", async () => {
  const c = await makeClient();
  getLedger().clear();

  getLlmRegistry()._adapters = new Map();
  getLlmRegistry().register(
    new FakeAdapter("qwen3:8b", (_messages, { model = null } = {}) =>
      LLMResponse({ text: '[{"speaker": "mara", "confidence": 0.9}]', model: model || "qwen3:8b", prompt_tokens: 120, completion_tokens: 18 }),
    ),
  );
  setEnsureLocalModel(null); // no bundled-runner load in unit tests
  const r = await c.post("/v1/extraction/analyze-text", {
    json: { text: '"Hi," said Mara.', characters: [{ id: "mara", name: "Mara" }] },
  });
  expect(r.status, r.text).toBe(200);

  const usage = (await c.get("/v1/ai-usage")).json();
  const feat = usage.by_feature.speaker_attribution;
  expect(feat.calls).toBe(1);
  expect(feat.errors).toBe(0);
  expect(feat.prompt_tokens).toBe(120);
  expect(feat.completion_tokens).toBe(18);
  expect(usage.recent[0].model).toBe("qwen3:8b");

  await c.delete("/v1/ai-usage");
  expect((await c.get("/v1/ai-usage")).json().total_calls).toBe(0);
});

// ── show notes ───────────────────────────────────────────────────────

test("show_notes_501_without_llm_and_works_with_stub", async () => {
  const c = await makeClient();
  const [pid] = await _importProject(c);

  // Force the no-LLM half: an EMPTY registry makes the shared run path's own resolution throw
  // LLMNotConfiguredError — testing the real 501 mapping.
  getLlmRegistry()._adapters = new Map();
  setEnsureLocalModel(null);
  let r = await c.post(`/v1/projects/${pid}/show-notes`);
  expect(r.status, r.text).toBe(501);

  // Success half: a capturing adapter under the preset's provider id — the {{script}} template
  // row renders the project's segments into the user turn.
  getLlmRegistry().register(
    new FakeAdapter("m", (messages, { model = null, system = null } = {}) => {
      // The chapter heading and its prose, rendered from the project's segments. The speaker
      // reads NARRATION, not "Mara Vance": a JustWrite import arrives speakerless by design,
      // and Analyze is what assigns characters to lines.
      expect(messages.at(-1).content).toContain("## One");
      expect(messages.at(-1).content).toContain("NARRATION: Hello.");
      expect((system || "").toLowerCase()).toContain("show notes");
      return LLMResponse({ text: "## Episode summary\nA test episode.", model: model || "m" });
    }),
  );
  r = await c.post(`/v1/projects/${pid}/show-notes`);
  expect(r.status, r.text).toBe(200);
  expect(r.json().markdown.startsWith("## Episode summary")).toBe(true);
});

test("a_justwrite_characters_aliases_become_the_speakers_also_called", async () => {
  // A JustWrite book can list `aliases` per character; the import keeps them on the speaker
  // (not only as prose in Who they are).
  const c = await makeClient();
  const book = bookJson();
  book.characters[0].aliases = ["Mar", "The Widow"];
  const name = book.characters[0].name;
  const r = await c.post("/v1/projects/import?source=justwrite", { json: book });
  expect(r.status, r.text).toBe(200);
  const pid = r.json().project_id;
  const speaker = (await _speakers(c, pid)).find((sp) => sp.name === name);
  expect(speaker.aliases).toEqual(["Mar", "The Widow"]);
});
