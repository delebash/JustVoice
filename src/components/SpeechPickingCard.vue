<!-- SPDX-License-Identifier: MIT -->
<!--
  "Picking an engine is picking what a voice can do" (mock _s13; the rows as approved 2026-10-09,
  plan docs/plans/2026-10-09-finishing-the-open-work.md §5 — facts from the manifests; the wording
  approved 2026-10-10, TASKS "Four answers", 2) — on AI Settings → Speech, the kit's audio.cpp
  tab, its `before-models` slot (round E, docs/plans/2026-10-29-round-e-onto-the-kit.md §4 step 5).
  Moved from the Speech engines tab, which went with round E.
-->
<script setup>
import { computed } from "vue";
import { UiTable } from "@delebash/ui";
import { COMMERCIAL_HINTS } from "../services/engineFacts.js";
import { rolesText } from "../services/modelPicks.js";
import { useVoicePicksStore } from "../stores/voicePicks.js";

// The voice sets' two best picks lead the table (latest-models D12): what to use to sell what you make,
// and the best acting that isn't for sale — from the server, as the one-click card's Voices.
const picksStore = useVoicePicksStore();
void picksStore.ensureLoaded();
const pickRows = computed(() =>
  [...new Set(picksStore.picks.map((p) => p.label))].map((label) => {
    const set = picksStore.picks.filter((p) => p.label === label);
    const limits = set.filter((p) => p.commercial !== "Yes");
    return {
      want: label,
      use: set.map((p) => `${p.name} ${rolesText(p.roles)}`).join(" · "),
      give: limits.length
        ? limits.map((p) => `${p.name}: commercial use ${p.commercial} — ${COMMERCIAL_HINTS[p.commercial] ?? ""}`).join(" ")
        : "—",
    };
  }),
);
const rows = computed(() => [...pickRows.value, ...PICKING]);

const PICKING_COLUMNS = [
  { id: "want", header: "If you want…", accessorKey: "want" },
  { id: "use", header: "Use", accessorKey: "use" },
  { id: "give", header: "What you give up", accessorKey: "give" },
];
const PICKING = [
  { want: "Ready-made voices, fast, on any machine", use: "Kokoro — 54 built-in voices, 9 languages", give: "No cloning and no written direction — pace, pitch, gain and pauses only" },
  { want: "English voices made for the CPU", use: "Kitten — 8 built-in voices", give: "English only; no cloning, no written direction" },
  { want: "Someone's own voice on a modest machine", use: "Pocket — cloning, 20 built-in voices", give: "One language per model; no written direction" },
  { want: "To direct performances in words", use: "Qwen3 CustomVoice — 9 built-in voices, 10 languages", give: "Cannot clone" },
  { want: "Someone's own voice, in 10 languages", use: "Qwen3 Base", give: "Written direction is dropped" },
  { want: "A voice designed from a description", use: "Qwen3 VoiceDesign", give: "—" },
  { want: "Someone's own voice, with per-line emotion tags", use: "Chatterbox Turbo or Nano — 19 tags", give: "English only; no written direction" },
  { want: "Someone's own voice in another language", use: "Chatterbox Multilingual — 23 languages", give: "No written direction, no tags" },
  { want: "Cloning, designing and written direction together", use: "VoxCPM2 — 30 languages", give: "The largest download (2.8 GB at 8-bit)" },
];
</script>

<template>
  <section class="jv-card">
    <div class="jv-card__header"><h3 class="jv-card__title">Picking an engine is picking what a voice can do</h3></div>
    <p class="jv-lede">
      A persona's voice brings its model, and the model decides what that persona can do on every line:
      whether it can clone someone's voice, and whether it takes written direction, tags, or only pace,
      pitch and gain.
    </p>
    <UiTable class="jv-table-look" :data="rows" :columns="PICKING_COLUMNS" />
  </section>
</template>
