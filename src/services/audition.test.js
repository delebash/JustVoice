// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { buildAuditionBody, canonicalDelivery, loadNotice, resolvedStack } from "./audition.js";

describe("canonicalDelivery", () => {
  it("sorts keys so knob order can't split one sound across two cache entries", () => {
    expect(Object.keys(canonicalDelivery({ speed: 1.1, pitch: 2, gain_db: -3 }))).toEqual([
      "gain_db",
      "pitch",
      "speed",
    ]);
  });

  it("drops empty cells — an unset knob falls through to the engine default", () => {
    expect(canonicalDelivery({ speed: 1.2, pitch: "", gain_db: null, temperature: undefined })).toEqual({
      speed: 1.2,
    });
  });

  it("routes engine-private knobs into the subdict every engine reads", () => {
    // Flat `exaggeration` reaches nothing — engines read delivery.engine.*
    expect(canonicalDelivery({ speed: 1, exaggeration: 1.3, cfg_weight: 0.4 })).toEqual({
      speed: 1,
      engine: { cfg_weight: 0.4, exaggeration: 1.3 },
    });
  });

  it("leaves the subdict off entirely when no engine knob is set", () => {
    expect(canonicalDelivery({ speed: 1 })).toEqual({ speed: 1 });
  });

  it("merges an already-nested engine subdict without passing it through raw", () => {
    expect(canonicalDelivery({ exaggeration: 1.3, engine: { cfg_weight: 0.4 } })).toEqual({
      engine: { cfg_weight: 0.4, exaggeration: 1.3 },
    });
  });
});

describe("buildAuditionBody", () => {
  it("sends nothing at all for the canned audition", () => {
    expect(buildAuditionBody({ text: "   ", delivery: {} })).toBe(null);
    expect(buildAuditionBody()).toBe(null);
  });

  it("carries a typed line and the set knobs only", () => {
    expect(buildAuditionBody({ text: "  The fog came in.  ", delivery: { speed: 1.1, pitch: "" } })).toEqual({
      text: "The fog came in.",
      delivery: { speed: 1.1 },
    });
  });
});

describe("loadNotice — the audition is not free", () => {
  const engines = [
    { id: "kokoro", name: "Kokoro", status: "loaded" },
    { id: "qwen3", name: "Qwen3-TTS", status: "installed" },
  ];

  it("says quick when this voice's engine is the resident one", () => {
    const n = loadNotice("kokoro", engines);
    expect(n.ready).toBe(true);
    expect(n.text).toContain("loaded");
  });

  it("names the swap when another engine holds the slot", () => {
    const n = loadNotice("qwen3", engines);
    expect(n.ready).toBe(false);
    expect(n.text).toContain("Qwen3-TTS");
    expect(n.text).toContain("Kokoro");
    expect(n.text).toContain("swaps");
  });

  it("still warns when nothing is loaded at all", () => {
    const n = loadNotice("qwen3", [{ id: "qwen3", name: "Qwen3-TTS", status: "installed" }]);
    expect(n.ready).toBe(false);
    expect(n.text).toContain("can take a minute");
  });

  it("is honest when the voice names no engine", () => {
    expect(loadNotice("", engines).ready).toBe(false);
  });
});

describe("resolvedStack — what am I actually hearing", () => {
  it("names voice, engine and every knob that differs", () => {
    expect(
      resolvedStack({
        voiceName: "Heart",
        engineName: "Kokoro",
        delivery: { speed: 1.1, pitch: 2 },
      }),
    ).toBe("Hearing Heart (Kokoro) · pitch +2 st · speed 1.10×");
  });

  it("names engine-private knobs too, not just the cross-engine ones", () => {
    expect(
      resolvedStack({
        voiceName: "Old Crow",
        engineName: "Chatterbox",
        delivery: { speed: 1.05, exaggeration: 1.4 },
      }),
    ).toBe("Hearing Old Crow (Chatterbox) · speed 1.05× · exaggeration 1.4");
  });

  it("leads with the persona when auditioning in character", () => {
    expect(resolvedStack({ personaName: "Mara", voiceName: "Heart", engineName: "Kokoro" })).toBe(
      "Hearing Mara: Heart (Kokoro)",
    );
  });

  it("marks the layers the preview cannot apply instead of implying them", () => {
    const line = resolvedStack({
      voiceName: "Heart",
      engineName: "Kokoro",
      effects: [{ type: "reverb" }, { type: "eq" }],
      lexicon: "Harbor names",
    });
    expect(line).toContain("2 effects · Harbor names (applies on render)");
  });

  it("says so when no voice is cast", () => {
    expect(resolvedStack({ engineName: "Kokoro" })).toBe("Hearing no voice (Kokoro)");
  });
});
