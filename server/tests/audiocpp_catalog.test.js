// SPDX-License-Identifier: MIT
// The speech engine list built from audio.cpp's own files (scripts/audiocpp-catalog.js →
// engines/audiocpp/catalog.json; docs/plans/2026-10-11-audiocpp-engine-catalog.md slice 1;
// docs/plans/2026-10-13-adopt-everything-audiocpp.md slice 1). The file must match the pin — the
// model revision the script pins and, built at a release tag, the build the kit pins (its runner/
// config.js DEFAULT_AUDIOCPP_BUILD; engines/audiocpp/release.js held both until round E, 2026-10-29)
// — every speech family in it must carry what the app shows before anything is downloaded — a name,
// a status, a model to register, its files' sizes, and a licence verdict in audio.cpp's own words —
// and every package audio.cpp's own web UI offers must be in it, by its own rule.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { DEFAULT_AUDIOCPP_BUILD } from "@delebash/core/runner/config";
import {
  builtinVoices,
  CHECKOUT,
  installChoices,
  MODEL_REPO,
  MODEL_REVISION,
  packageLabel,
  parseLicences,
  parsePresets,
  withPresetValues,
  workflowForEntry,
} from "../../scripts/audiocpp-catalog.js";
import { generatedEngines } from "../src/engines/audiocpp/generated.js";

const catalog = JSON.parse(readFileSync(new URL("../src/engines/audiocpp/catalog.json", import.meta.url), "utf8"));
const speech = Object.values(catalog.families).filter((f) => (f.tasks || []).some((t) => t === "tts" || t === "clone"));
const VERDICTS = ["Yes", "Conditional", "No", "Unclear"];

test("the catalog was built at the pinned model revision, from a commit it records", () => {
  expect(catalog.generated_from.model_repo).toBe(MODEL_REPO);
  expect(catalog.generated_from.model_revision).toBe(MODEL_REVISION);
  expect(catalog.generated_from.audiocpp_commit).toMatch(/^[0-9a-f]{40}$/);
});

// Built at a release tag, the catalog is the pinned release's — the kit's pinned build since round
// E. Built at our fork's branch, it runs ahead of the pin until that release exists (the adoption
// plan's slice 1 builds it at `jv`, v0.9.2 with our additions, and the pin moves only once jv.6 is
// published) — then the script is re-run at the new tag, its default, and this holds again.
test.skipIf(!/^v\d/.test(catalog.generated_from.audiocpp_ref))("a catalog built at a release tag is the pinned release's", () => {
  expect(catalog.generated_from.audiocpp_ref).toBe(DEFAULT_AUDIOCPP_BUILD);
});

test("every speech family says what it is and how sure audio.cpp is of it", () => {
  expect(speech.length).toBeGreaterThan(0);
  for (const f of speech) {
    expect(f.display_name, f.family).toBeTruthy();
    expect(["supported", "community", "experimental", "wip", "unsupported", "testing"], f.family).toContain(f.status);
    if (f.licence) expect(VERDICTS, f.family).toContain(f.licence.commercial_use);
  }
});

test("every speech entry names a task and a package the family has, with sized files", () => {
  for (const f of speech) {
    for (const e of f.entries) {
      expect(e.task, `${f.family}/${e.id}`).toBeTruthy();
      if (!e.package) continue; // audio.cpp offers no download for it (weights placed by hand)
      const pkg = f.packages.find((p) => p.id === e.package);
      expect(pkg, `${f.family}/${e.id} → ${e.package}`).toBeTruthy();
      for (const file of pkg.source.files) {
        if (file.missing) continue; // not at the pinned revision — the app leaves it out
        expect(file.size_bytes, `${pkg.id}: ${file.path}`).toBeGreaterThan(0);
      }
    }
  }
});

test("every package audio.cpp's web UI offers is in the catalog, with its files", () => {
  // The acceptance of the adoption plan's slice 1: each entry's downloads by audio.cpp's own rule
  // (installChoices) are packages of its family in catalog.json.
  let offered = 0;
  for (const f of Object.values(catalog.families)) {
    for (const e of f.entries) {
      for (const choice of e.install_packages) {
        offered++;
        const pkg = f.packages.find((p) => p.id === choice.id);
        expect(pkg, `${f.family}/${e.id} → ${choice.id}`).toBeTruthy();
        expect(pkg.source.files.length, choice.id).toBeGreaterThan(0);
      }
    }
  }
  expect(offered).toBeGreaterThan(0);
});

// audio.cpp's own web UI module, read from our fork's checkout beside this repo when it holds the
// commit the catalog was built from: the port must give exactly what it gives.
const checkoutAtCatalog = (() => {
  try {
    if (!existsSync(CHECKOUT)) return false;
    const git = (...a) => execFileSync("git", ["-C", CHECKOUT, ...a], { encoding: "utf8" }).trim();
    return git("rev-parse", "HEAD") === catalog.generated_from.audiocpp_commit && git("status", "--porcelain", "--", "model_specs", "webui/configs") === "";
  } catch {
    return false;
  }
})();

test.skipIf(!checkoutAtCatalog)("each entry offers what audio.cpp's own web UI offers — its catalog.ts, run on the same files", async () => {
  const ui = await import("../../../audio.cpp/webui/native/src/lib/catalog.ts");
  const byId = new Map(Object.values(catalog.families).flatMap((f) => f.entries.map((e) => [e.id, e])));
  let compared = 0;
  for (const entry of ui.catalog) {
    const ours = byId.get(entry.id);
    if (!ours) continue; // a family with no spec (audio.cpp's built-in utilities)
    expect(ours.install_packages, entry.id).toEqual(JSON.parse(JSON.stringify(entry.install_packages)));
    // Its UI reads only the spec's list; the voice option's choices are the plan's fallback.
    if (entry.builtin_voices) expect(ours.builtin_voices, entry.id).toEqual(entry.builtin_voices);
    compared++;
  }
  // An entry audio.cpp's UI hides (a download with no GGUF to install) offers nothing here either.
  for (const f of Object.values(catalog.families)) {
    for (const e of f.entries) if (!ui.catalog.some((x) => x.id === e.id)) expect(e.install_packages, e.id).toEqual([]);
  }
  expect(compared).toBeGreaterThan(100);
});

test("audio.cpp's web UI rule, ported: expose-all folders, stem families, labels, tabs", () => {
  const pkg = (family, id, precision, extra = {}) => ({ family, id, precision, format: "gguf", target_directory: `${family}-dir`, files: [`${family}-dir/${id}.gguf`], ...extra });
  const packages = [
    pkg("cosyvoice3", "cosyvoice3_q8_0", "q8_0", { default: true }),
    pkg("cosyvoice3", "cosyvoice3_f32", "f32"),
    pkg("moss_ttsd", "moss_ttsd_q8_0_codec_f16", "q8_0"),
    pkg("moss_ttsd", "moss_ttsd_q4_k_codec_f16", "q4_k"),
    pkg("moss_ttsd", "moss_ttsd_bf16_codec_f16", "bf16"),
    pkg("echo_tts", "echo_tts_q8_0", "q8_0"),
    pkg("echo_tts", "echo_tts_f16", "f16"),
    pkg("echo_tts", "echo_tts_orig", "orig"),
  ];
  // An expose-all family offers every GGUF in the entry's folder, its own download first.
  expect(installChoices({ family: "cosyvoice3", download_id: "cosyvoice3_q8_0" }, packages).map((c) => c.id)).toEqual(["cosyvoice3_q8_0", "cosyvoice3_f32"]);
  // A stem family offers each precision of the download's stem, the download first.
  expect(installChoices({ family: "moss_ttsd", download_id: "moss_ttsd_q8_0_codec_f16" }, packages).map((c) => c.id)).toEqual([
    "moss_ttsd_q8_0_codec_f16",
    "moss_ttsd_q4_k_codec_f16",
    "moss_ttsd_bf16_codec_f16",
  ]);
  // Any other family: one 8-bit and one 16-bit package.
  expect(installChoices({ family: "echo_tts", download_id: "echo_tts_q8_0" }, packages).map((c) => c.id)).toEqual(["echo_tts_q8_0", "echo_tts_f16"]);
  expect(packageLabel({ family: "irodori_tts", id: "irodori_tts_v4_1_anime_q8_0", precision: "q8_0", format: "gguf" })).toBe("Anime Q8");
  expect(packageLabel({ family: "x", id: "x_q4_k", precision: "q4_k", format: "gguf" })).toBe("GGUF Q4");
  // The tab an entry sits under: its own workflow, else its task's.
  expect(workflowForEntry({ family: "dots_tts", task: "tts", workflow: "conversion" })).toBe("conversion");
  expect(workflowForEntry({ family: "chatterbox", task: "clon" })).toBe("tts");
  expect(workflowForEntry({ family: "audiosr", task: "s2s" })).toBe("enhancement");
  expect(workflowForEntry({ family: "breeze_tts", task: "vdes" })).toBe("design");
});

test("every built-in voice, session option and preset is read from the spec", () => {
  // Built-in voices: the spec's list, else its voice option's choices.
  expect(builtinVoices({ ui: { builtin_voices: ["alba"], default_voice: "alba" } })).toEqual({ builtin_voices: ["alba"], default_voice: "alba" });
  expect(builtinVoices({ options: { request: [{ name: "voice_id", type: "enum", values: ["a", "b"], default: "b" }] } })).toEqual({
    builtin_voices: ["a", "b"],
    default_voice: "b",
  });
  expect(catalog.families.kokoro_tts.builtin_voices).toHaveLength(54);
  expect(catalog.families.qwen3_tts.builtin_voices).toContain("uncle_fu");
  // An enum option naming a preset carries the preset's values.
  const md = "| Preset | Values |\n|---|---|\n| `weight_type_conv` | `native`, `f32`, `f16` |\n";
  expect(parsePresets(md)).toEqual({ weight_type_conv: ["native", "f32", "f16"] });
  expect(withPresetValues({ session: [{ name: "w", type: "enum", preset: "weight_type_conv" }] }, parsePresets(md)).session[0].values).toEqual(["native", "f32", "f16"]);
  const kokoroSession = catalog.families.kokoro_tts.options.session.find((o) => o.name === "weight_type");
  expect(kokoroSession.values).toEqual(["native", "f32", "f16", "bf16", "q8_0"]);
  // Our fork's additions, declared in its own specs (the plan's F2).
  expect(catalog.families.kokoro_tts.options.request.some((o) => o.name === "voice_pack")).toBe(true);
  expect(catalog.families.chatterbox.languages).toEqual(expect.arrayContaining(["he", "ru", "zh", "ja"]));
  expect(catalog.families.voxcpm2.options.request.some((o) => o.name === "reference_text")).toBe(true);
  const turbo = catalog.families.chatterbox_turbo.packages.map((p) => p.id);
  expect(turbo).toEqual(expect.arrayContaining(["chatterbox_turbo_clone_q8_0", "chatterbox_turbo_clone_f16", "chatterbox_nano_q8_0", "chatterbox_nano_f16"]));
});

test("our fork's catalog gives an entry to every speech package that had none (the plan's E7)", () => {
  const entryIds = (family) => catalog.families[family].entries.map((e) => e.id);
  expect(entryIds("f5_tts")).toContain("f5-tts-habibi-unified");
  expect(entryIds("omnivoice")).toContain("voicetut-tts");
  expect(entryIds("qwen3_asr")).toContain("qwencleo-asr");
  const edit = catalog.families.dots_tts.entries.find((e) => e.id === "dots-tts-edit");
  // A speech editor: on audio.cpp's Voice Conversion / S2S tab, so never a speech engine here.
  expect(edit.workflow).toBe("conversion");
  expect(generatedEngines().get("dots_tts").VARIANTS.some((v) => v.audiocpp.file.includes("edit"))).toBe(false);
});

// Every model the generated engines offered before the adoption plan's slice 1 (built at
// v0.9.0-jv.5, 2026-10-11): saved voices, personas and prices use these ids (the plan's §4).
const OFFERED_BEFORE = (
  "audio8_tts-q8 breeze_tts-q8 breeze_tts-bf16 confucius4_tts-orig cosyvoice3-q8 dots_tts-dotsttssoar-q8 " +
  "dots_tts-dotsttssoar-bf16 dots_tts-dotsttsmeanflow-q8 dots_tts-dotsttsmeanflow-bf16 dramabox-q8 echo_tts-q8 " +
  "echo_tts-f16 firered_audio-q8 firered_audio-orig fireredtts3-fireredtts3instruct-q8 fireredtts3-fireredtts3instruct-orig " +
  "fireredtts3-fireredtts3base-q8 fireredtts3-fireredtts3base-orig fish_audio-q8 fish_audio-bf16 glm_tts-q8 " +
  "higgs_audio_tts-q8 higgs_audio_tts-bf16 index_tts2-indextts2-q8 index_tts2-indextts2-f16 index_tts2-indextts2-orig " +
  "index_tts2-indextts25-q8 index_tts2-indextts25-f16 index_tts2-indextts25-orig irodori_tts-irodoritts-q8 " +
  "irodori_tts-irodoritts-f16 irodori_tts-irodorittsv3500m-q8 irodori_tts-irodorittsv3500m-f16 miotts-q8 miotts-bf16 " +
  "miotts-orig moss_tts_local-q8 moss_tts_local-bf16 moss_tts_nano-q8 moss_tts_nano-bf16 moss_tts_v15-q8 moss_ttsd-q8 " +
  "omnivoice-q8 omnivoice-bf16 omnivoice-f16 voxcpm1-q8 zipvoice-orig"
).split(" ");

test("nothing offered before is removed, and each keeps its id", () => {
  const ids = new Set([...generatedEngines().values()].flatMap((m) => m.VARIANTS.map((v) => v.id)));
  for (const id of OFFERED_BEFORE) expect(ids.has(id), id).toBe(true);
  // audio.cpp's web UI adds downloads beside them (the plan's E6) — each its own row.
  for (const id of ["moss_ttsd-q4k", "moss_ttsd-bf16", "cosyvoice3-f32", "breeze_tts-q4", "irodori_tts-irodoritts-animeq8"]) {
    expect(ids.has(id), id).toBe(true);
  }
  // Each engine's default stays the model with its spec's recommended package (audio.cpp's v0.9.2
  // catalog reordered DotTTS, FireRedTTS3 and Irodori's entries).
  const defaults = Object.fromEntries([...generatedEngines()].map(([id, m]) => [id, m.DEFAULT_VARIANT_ID]));
  expect(defaults).toMatchObject({
    dots_tts: "dots_tts-dotsttssoar-q8",
    fireredtts3: "fireredtts3-fireredtts3instruct-q8",
    irodori_tts: "irodori_tts-irodoritts-q8",
    omnivoice: "omnivoice-q8",
  });
  // OmniVoice keeps its id now that VoiceTut-TTS shares its family.
  const omni = generatedEngines().get("omnivoice").VARIANTS;
  expect(omni.find((v) => v.id === "omnivoice-q8").audiocpp.model).toBe("omnivoice");
  expect(omni.some((v) => v.id === "omnivoice-voicetuttts-q8")).toBe(true);
});

test("the licence table is read in audio.cpp's own words, every family of a row", () => {
  const md = [
    "| Family | Original weights | License | Commercial use | Notes | Checked |",
    "|---|---|---|---|---|---|",
    "| `a_tts` | [Org/A](https://hf.co/Org/A) | [A Licence](https://hf.co/Org/A/LICENSE) | Conditional | Under 1M users. | 2026-09-21 |",
    "| `b_tts`, `b_asr` | Not linked | Apache-2.0 | Yes | | 2026-09-22 |",
  ].join("\n");
  const rows = parseLicences(md);
  expect(rows.a_tts).toEqual({
    licence: "A Licence",
    licence_links: [{ name: "A Licence", url: "https://hf.co/Org/A/LICENSE" }],
    commercial_use: "Conditional",
    notes: "Under 1M users.",
    weights: [{ name: "Org/A", url: "https://hf.co/Org/A" }],
    checked: "2026-09-21",
  });
  expect(rows.b_asr.commercial_use).toBe("Yes");
  expect(rows.b_tts.licence).toBe("Apache-2.0");
});
