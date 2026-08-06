// SPDX-License-Identifier: MIT
// The speaker-attribution Lab adapter (parity batch 2026-08-06 — the Speaker
// Lab reunification). Registered under the `speaker_attribution` FEATURE via
// installLlmUi({ labAdapters }), so every attribution action's Lab column runs
// the REAL pipeline (/v1/extraction/analyze-text — segmentation, [D#] tags,
// anchors, floors; the discovery action runs /v1/extraction/discover-speakers)
// instead of the generic /v1/ai/run, renders the speaker table with reassign
// (AttributionResult), and carries the floor + anchor controls
// (AttributionConfigExtra). Each card's run forces its OWN route — the card
// IS the route (the Auto simplification, 2026-08-06). CONCEPTS §16 holds:
// the lab and production share one pipeline, so they cannot drift.
import AttributionConfigExtra from "../components/lab/AttributionConfigExtra.vue";
import AttributionResult from "../components/lab/AttributionResult.vue";
import { useApi } from "../stores/api.js";

// The passage text can arrive under any of the rows' template names —
// guided/direct use {{paragraphs}}, discovery uses {{manuscript}}.
function passageFrom(vars) {
  return vars.paragraphs || vars.manuscript || vars.text || vars.user_content || "";
}

// Cast lines → structured characters. One per line:
//   "Mara"  ·  "Mara | Lady Mara, the captain"  ·  "Mara: Lady Mara"
function parseCharacters(raw) {
  return String(raw || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => {
      const m = line.split(/[|:]/);
      const name = (m[0] || "").trim();
      const aliases = (m[1] || "").split(",").map((a) => a.trim()).filter(Boolean);
      return { id: `c_${name.toLowerCase().replace(/\s+/g, "_")}_${i}`, name, aliases };
    })
    .filter((c) => c.name);
}

// Each card IS its route (the Auto simplification, 2026-08-06): a card's Lab
// run always forces its own route, so the column's edited prompt boxes
// always ride as overrides — "what you see is what runs", with no
// route-vs-prompt mismatch possible.
const ACTION_ROUTE = {
  "speaker_attribution.guided": "guided",
  "speaker_attribution.direct": "direct",
  "speaker_attribution.reasoned": "reasoned",
};

async function run(body, { signal } = {}) {
  const api = useApi();
  const vars = body.variables || {};
  const extra = body.extra || {};

  // Discovery ("Find new speakers") has its own pipeline door — the ad-hoc
  // identify twin of analyze-text. The column's prompt boxes ARE this action's
  // row, so they always ride as overrides; known characters come from the
  // {{known_characters}} box (one name per line, "- " bullets tolerated).
  if (body.action === "speaker_attribution.identify") {
    const known = String(vars.known_characters || vars.characters || "")
      .split("\n")
      .map((s) => s.trim().replace(/^[-•]\s*/, ""))
      .filter(Boolean)
      .map((s) => s.split(/[|:]/)[0].trim())
      .filter(Boolean);
    const r = await api.request("/v1/extraction/discover-speakers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: passageFrom(vars),
        known_characters: known,
        providerId: body.providerId || null,
        model: body.model || null,
        temperature: body.temperature ?? null,
        systemPrompt: body.system || null,
        userPrompt: body.userTemplate || null,
      }),
      signal,
    });
    return {
      content: JSON.stringify(r?.candidates || [], null, 2),
      data: { candidates: r?.candidates || [] },
    };
  }

  const tier = ACTION_ROUTE[body.action] || null; // the card's own route, forced

  const payload = {
    text: passageFrom(vars),
    characters: parseCharacters(vars.characters),
    corrections: [],
    tier,
    propagate: extra.propagate ?? true,
    use_floor: extra.useFloor ?? true,
    providerId: body.providerId || null,
    model: body.model || null,
    temperature: body.temperature ?? null,
    systemPrompt: body.system || null,
    userPrompt: body.userTemplate || null,
    confidence_floor:
      (extra.useFloor ?? true) && extra.floor !== "" && extra.floor != null
        ? Number(extra.floor)
        : null,
  };
  const r = await api.request("/v1/extraction/analyze-text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  return {
    content: r?.raw_llm || "",
    // The render needs the parsed cast beside the rows (labels + reassign).
    data: { ...r, characters: payload.characters },
  };
}

export const attributionLabAdapter = {
  run,
  render: AttributionResult,
  configExtra: AttributionConfigExtra,
};
