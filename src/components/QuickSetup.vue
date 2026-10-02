<!-- SPDX-License-Identifier: MIT -->
<!--
  Voice engine setup — the TTS-engine wizard (renamed from "Quick Setup",
  ruling 6 2026-08-05: JV has two engine kinds and the pair names them —
  the LLM sibling is the KIT wizard under AI Settings). The feature-pin
  recipe died with the pin era (F1 Phase 2): AI routing lives in the shared
  presets now, seeded working out of the box.

  Affordance Table (source: JustWrite's QuickSetup.vue:1-200 +
  quickSetupPresets.js read this turn):
    ✅ multi-step wizard (detect → confirm → install → done)
    ✅ GPU detection via /v1/system
    ✅ tier auto-pick from VRAM + manual override dropdown
    ✅ preset blurb + estimated download GB
    ✅ per-engine install progress (poll job_id via /v1/jobs/{id})
    ✅ LLM provider auto-recommend ("register a Claude key for richer
       attribution" or "Ollama covers Compose if you don't want cloud")
    ⚠ manual provider picker — not implemented; user goes to Engines
      after the wizard to register cloud providers
    N/A "tier mismatch" nudge — JustVoice has no saved tier yet
    ✅ done step with summary
-->
<script setup>
import { computed, onMounted, ref } from "vue";
import { useApi } from "../stores/api.js";
import { DownloadBar, pushToast } from "@delebash/llm-ui";
import { makeEngineDownloadTask } from "../services/ttsJobChannel.js";
import { UiButton, UiCheckbox, UiTag, UiSelect, AppModal } from "@delebash/llm-ui";

const emit = defineEmits(["close"]);

const api = useApi();

const open = ref(true);
const step = ref("detect");  // "detect" | "confirm" | "install" | "done"
const detectError = ref("");
const gpu = ref(null);
const engines = ref([]);
const llmProviders = ref([]);

// ── Tier recipes ────────────────────────────────────────────────────
// Per-tier recipe: which VOICE engines to set up (the pin half died with
// the pin era — AI routing lives in the shared presets). Every engine runs
// on the one speech runtime since the 2026-10-01 switch, so setting up is
// ONE runtime install; the tier only decides which engines' models you'll
// be downloading, and those come down the first time each one loads. The
// sizes are the default 8-bit models' real files (the engine manifests);
// the tiers follow memory measured on an 8 GB card (switch plan §2.1, §8):
// Qwen3 1.7B peaked at 7.8 GB on its own, so it starts the 12 GB tier.
//
// Where each engine runs (decided 2026-10-02, CPU placement — the tiers of decision 3):
// the CPU-fast engines (Kokoro 3.2×, KittenTTS 3.4×, Pocket TTS 3.9× real time, measured
// on an 8-core Ryzen) go on the CPU so the card stays free for the AI model; Chatterbox
// and Qwen3-TTS need the card. `runsOn` is what the list says; Auto decides at each load.
const RUNS_ON = {
  cpu: "on the CPU",
  cpuBesideAi: "on the CPU — keeps the card free for the AI model",
  gpu: "on the graphics card",
};
const TIER_RECIPES = {
  cpu: {
    label: "CPU / low VRAM",
    blurb: "Kokoro, KittenTTS and Pocket TTS — preset voices and voice cloning, all on the CPU.",
    ttsEngineIds: ["kokoro", "kitten", "pocket"],
    runsOn: { kokoro: "cpu", kitten: "cpu", pocket: "cpu" },
    estimatedDownloadGb: 0.8,
  },
  vram8: {
    label: "8 GB tier",
    blurb: "Kokoro and Pocket TTS on the CPU, plus Chatterbox Multilingual on the graphics card for cloning in 19 languages.",
    ttsEngineIds: ["kokoro", "pocket", "chatterbox"],
    runsOn: { kokoro: "cpuBesideAi", pocket: "cpuBesideAi", chatterbox: "gpu" },
    estimatedDownloadGb: 2.5,
  },
  vram12: {
    label: "12 GB+ tier",
    blurb: "Adds Qwen3-TTS on the graphics card — preset speakers you direct in plain words, designed voices, and cloning.",
    ttsEngineIds: ["kokoro", "pocket", "chatterbox", "qwen3"],
    runsOn: { kokoro: "cpuBesideAi", pocket: "cpuBesideAi", chatterbox: "gpu", qwen3: "gpu" },
    estimatedDownloadGb: 5.4,
  },
};

const TIER_ORDER = ["cpu", "vram8", "vram12"];

function tierForVramMb(mb) {
  if (!mb || mb < 7 * 1024) return "cpu";
  if (mb < 11 * 1024) return "vram8";
  return "vram12";
}

// Auto-detected tier (from /v1/system) — used as the dropdown default.
const detectedTierKey = ref("cpu");
// Active tier — drives recipe selection. User can override via dropdown.
const tierKey = ref("cpu");

const recipe = computed(() => TIER_RECIPES[tierKey.value] || TIER_RECIPES.cpu);
const tierOptions = TIER_ORDER.map((k) => ({ value: k, label: TIER_RECIPES[k].label }));

// Per-engine opt-out (mock: "pick what to install") — recipe engines
// start checked; unchecking drops them from the install run.
const deselectedEngineIds = ref(new Set());
function toggleEngine(id) {
  const next = new Set(deselectedEngineIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  deselectedEngineIds.value = next;
}
// The tier's engine ids, minus anything the server has marked for removal
// (manifest DEPRECATED, 2026-08-17). Filtered at RUNTIME against the served
// catalog rather than hand-edited out of TIER_RECIPES, so marking one engine
// never needs a renderer edit — and so a first run can never install an engine
// we are dropping. An id the server does not serve at all also falls out here,
// which is the class of bug that let `moss_tts` (real id: `moss-tts`) sit dead
// in two tiers. The recipe itself is still hardcoded — see the TASKS finding.
const tierEngineIds = computed(() => {
  const byId = new Map((engines.value || []).map((e) => [e.id, e]));
  return recipe.value.ttsEngineIds.filter((id) => {
    const e = byId.get(id);
    if (!e) return !engines.value?.length;  // pre-fetch: show the recipe as written
    return !(e.deprecated || "").trim();
  });
});
const enginesToInstall = computed(() => {
  return tierEngineIds.value
    .filter((id) => !deselectedEngineIds.value.has(id))
    .map((id) => engines.value.find((e) => e.id === id))
    .filter(Boolean)
    .filter((e) => e.status === "not_installed");
});
const enginesAlreadyInstalled = computed(() => {
  return tierEngineIds.value
    .map((id) => engines.value.find((e) => e.id === id))
    .filter(Boolean)
    .filter((e) => e.status !== "not_installed");
});

// ── Detect step ─────────────────────────────────────────────────────
async function detect() {
  step.value = "detect";
  detectError.value = "";
  try {
    const [sys, eng, llm] = await Promise.all([
      api.safeRequest("/v1/system/info", null),
      api.safeRequest("/v1/engines", { engines: [] }),
      api.safeRequest("/v1/llm-providers", { providers: [] }),
    ]);
    if (sys?.gpus?.length) {
      gpu.value = sys.gpus[0];
    } else {
      gpu.value = { vram_mb: 0, name: "CPU only" };
    }
    engines.value = eng?.engines || [];
    llmProviders.value = llm?.providers || [];
    detectedTierKey.value = tierForVramMb(gpu.value.vram_mb || 0);
    tierKey.value = detectedTierKey.value;
  } catch (e) {
    detectError.value = e?.message || String(e);
  } finally {
    step.value = "confirm";
  }
}

// ── Install step ────────────────────────────────────────────────────
// ONE kit download task (ttsJobChannel over the job API): installing any
// engine installs the speech runtime they all share, so the first chosen
// engine's install is the whole step. The shared DownloadBar renders it.
const runtimeTask = ref(null);

async function runInstalls() {
  step.value = "install";
  const first = enginesToInstall.value[0];
  if (first) {
    runtimeTask.value = makeEngineDownloadTask(api, first.id, {});
    await runtimeTask.value.start();
  }
  step.value = "done";
}

function cancelInstalls() {
  if (runtimeTask.value?.state === "running") runtimeTask.value.cancel();
  pushToast({ message: "Install cancelled.", kind: "info" });
}

// ── Optional helpers — local LLM detect-and-connect + STT readiness ──
// (CONCEPTS §10: connect, don't bundle; skipping costs named features.)
const detectedLocal = ref([]);  // [{providerType, name, baseUrl, models, alreadyRegistered}]
const sttReadiness = ref(null); // {ready, display_name, size_mb}
const connectingLocal = ref("");

async function probeHelpers() {
  try {
    const r = await api.request("/v1/llm-providers/detect-local");
    detectedLocal.value = r?.detected || [];
  } catch { detectedLocal.value = []; }
  try {
    const r = await api.request("/v1/capture/readiness");
    sttReadiness.value = r?.stt || null;
  } catch { sttReadiness.value = null; }
}

async function connectLocal(d) {
  connectingLocal.value = d.baseUrl;
  try {
    await api.request("/v1/llm-providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: d.providerType === "ollama" ? "ollama-local" : "lmstudio-local",
        name: d.name,
        providerType: d.providerType,
        baseUrl: d.baseUrl,
        apiKey: null,
        defaultModel: d.models[0] || "",
        timeoutSeconds: 120,
      }),
    });
    pushToast({ message: `${d.name} connected — the AI features can route to it.`, kind: "success" });
    await probeHelpers();
    await detect(); // refresh llmProviders so pins pick it up
  } catch (e) {
    pushToast({ message: `Connect failed: ${e?.message || e}`, kind: "error" });
  } finally {
    connectingLocal.value = "";
  }
}

// ── Lifecycle / close ──────────────────────────────────────────────
function close() {
  open.value = false;
  setTimeout(() => emit("close"), 180);
}

onMounted(() => { detect(); probeHelpers(); });

const runtimeInstalled = computed(() => runtimeTask.value?.state === "done");
const runtimeFailed = computed(() => runtimeTask.value?.state === "error");
const hasLlmProvider = computed(() => llmProviders.value.length > 0);
</script>

<template>
  <AppModal
    v-if="open"
    :eyebrow="`Voice engine setup · step ${step === 'detect' ? '1/3' : step === 'confirm' ? '1/3' : step === 'install' ? '2/3' : '3/3'}`"
    :title="step === 'detect' ? 'Probing your hardware…' : step === 'confirm' ? 'Recommended setup' : step === 'install' ? 'Installing voice engines' : 'All set'"
    :max-width="'620px'"
    no-padding
    :closable="step !== 'install'"
    :dismissable="step !== 'install'"
    @close="close"
  >
      <div class="quick-setup__body">
        <!-- ── DETECT step ───────────────────────────────────────── -->
        <div v-if="step === 'detect'" class="jv-muted quick-setup__loading">
          Probing GPU + engines + LLM providers…
        </div>

        <!-- ── CONFIRM step ─────────────────────────────────────── -->
        <template v-else-if="step === 'confirm'">
          <section>
            <div class="quick-setup__row-label">Detected</div>
            <div class="quick-setup__row-value">
              {{ gpu?.name || "No GPU" }}
              <UiTag intent="ghost" v-if="gpu?.vram_mb">{{ (gpu.vram_mb / 1024).toFixed(1) }} GB VRAM</UiTag>
              <UiTag :intent="tierKey === detectedTierKey ? 'solid' : 'ghost'">
                Suggested: {{ TIER_RECIPES[detectedTierKey]?.label }}
              </UiTag>
            </div>
          </section>

          <section>
            <div class="quick-setup__row-label">Hardware fit</div>
            <div class="quick-setup__row-value">
              <UiSelect v-model="tierKey" width="name"
                :options="tierOptions.map((opt) => ({ value: opt.value, label: opt.label + (opt.value === detectedTierKey ? '  · suggested' : '') }))" />
              <span v-if="tierKey !== detectedTierKey" class="jv-muted quick-setup__note">
                Overriding the suggestion
              </span>
            </div>
            <p class="jv-muted quick-setup__blurb">{{ recipe.blurb }}</p>
          </section>

          <section>
            <div class="quick-setup__row-label">TTS engines</div>
            <ul class="quick-setup__engines">
              <li v-for="id in tierEngineIds" :key="id" class="quick-setup__engine-row">
                <UiCheckbox
                  :model-value="!deselectedEngineIds.has(id)"
                  :disabled="enginesAlreadyInstalled.some((e) => e.id === id)"
                  :title="enginesAlreadyInstalled.some((e) => e.id === id) ? 'Ready — the speech runtime is installed' : 'Uncheck to skip this engine'"
                  @change="toggleEngine(id)"
                />
                <span class="quick-setup__engine-name">{{ engines.find((e) => e.id === id)?.name || id }}</span>
                <span class="quick-setup__engine-where">{{ RUNS_ON[recipe.runsOn?.[id]] || "" }}</span>
                <span v-if="engines.find((e) => e.id === id)?.description" class="jv-muted quick-setup__engine-blurb">{{ engines.find((e) => e.id === id)?.description }}</span>
                <UiTag v-if="enginesAlreadyInstalled.some((e) => e.id === id)" intent="success">ready</UiTag>
                <UiTag intent="ghost" v-else>needs the speech runtime</UiTag>
              </li>
            </ul>
            <p class="jv-muted quick-setup__note quick-setup__note--est">
              Every engine runs on one speech runtime — it downloads now (60–460 MB, depending on
              your graphics card). Each engine's model downloads the first time you load it:
              about <strong>{{ recipe.estimatedDownloadGb }} GB</strong> for this tier.
            </p>
          </section>

          <section>
            <div class="quick-setup__row-label">Feature routing</div>
            <p class="jv-muted quick-setup__note quick-setup__note--lede">
              AI features route themselves: careful-reading work (Script speaker attribution)
              goes to your strongest model; quick tasks (Compose, Rewrite, Smart-assign,
              preset suggestions) go to the fastest. Tune any of it later on the AI
              page under Routing by feature.
            </p>
            <div v-if="!hasLlmProvider" class="jv-banner jv-banner--warn quick-setup__note quick-setup__note--banner">
              <strong>No language-model provider connected yet.</strong> The AI text features wait quietly — after this wizard, open the AI page and run the LLM engine setup (or connect a provider on its LLM providers tab).
            </div>
          </section>

          <section>
            <div class="quick-setup__row-label">Optional helpers</div>
            <p class="jv-muted quick-setup__note quick-setup__note--lede">
              Skip either — the features that need them wait quietly until you connect one.
            </p>
            <ul class="quick-setup__helpers">
              <li v-for="d in detectedLocal" :key="d.baseUrl">
                <span class="quick-setup__helper-ic">🧠</span>
                <span class="quick-setup__helper-name"><strong>{{ d.name }} detected</strong>
                  <span v-if="d.models.length" class="jv-muted"> · {{ d.models[0] }}{{ d.models.length > 1 ? ` +${d.models.length - 1}` : "" }}</span>
                </span>
                <UiTag intent="success" v-if="d.alreadyRegistered">connected</UiTag>
                <UiButton v-else size="small" intent="secondary" :loading="connectingLocal === d.baseUrl" label="Connect" :title="`Register ${d.name} as an LLM provider`" @click="connectLocal(d)" />
              </li>
              <li v-if="!detectedLocal.length">
                <span class="quick-setup__helper-ic">🧠</span>
                <span class="quick-setup__helper-name jv-muted">No local LLM server detected (Ollama :11434 / LM Studio :1234) — Script attribution + Smart-assign stay manual until one is connected.</span>
              </li>
              <li v-if="sttReadiness">
                <span class="quick-setup__helper-ic">🎤</span>
                <span class="quick-setup__helper-name"><strong>STT — {{ sttReadiness.display_name }}</strong>
                  <span class="jv-muted"> · Capture promotion + dictation</span>
                </span>
                <UiTag intent="success" v-if="sttReadiness.ready">cached</UiTag>
                <UiTag intent="ghost" v-else  :title="'Downloads on first use'">{{ sttReadiness.size_mb ? `${sttReadiness.size_mb} MB on first use` : "downloads on first use" }}</UiTag>
              </li>
            </ul>
          </section>

          <section>
            <div class="quick-setup__row-label">What happens next</div>
            <ol class="quick-setup__next">
              <li>The speech runtime downloads &amp; verifies (one-time)</li>
              <li>Clone your voice from ~30 s of audio — or skip and use preset voices</li>
              <li>Pick what you're making (audiobook · game · podcast) and import</li>
            </ol>
            <div class="jv-banner jv-banner--info quick-setup__note quick-setup__note--banner">
              Everything runs <strong>locally</strong>. No audio or text leaves this machine
              unless you add an external provider yourself.
            </div>
          </section>
        </template>

        <!-- ── INSTALL step ─────────────────────────────────────── -->
        <template v-else-if="step === 'install'">
          <p class="jv-muted quick-setup__note-md quick-setup__note-md--lede">
            The speech runtime downloads, is checked, and is put in place. Every
            voice engine runs on it.
          </p>
          <!-- THE one download bar (kit DownloadBar over the kit task — same
               control every download in the family renders). -->
          <DownloadBar title="Speech runtime" role="runs every voice engine"
            :task="runtimeTask || { state: '', label: 'Waiting…', done: 0, total: 0, error: '' }" />
        </template>

        <!-- ── DONE step ────────────────────────────────────────── -->
        <template v-else>
          <p v-if="runtimeInstalled">
            The speech runtime is installed. Each engine's model downloads the first
            time you load it — on the Voices page, or AI Settings → Speech engines.
          </p>
          <p v-else-if="runtimeFailed">
            The speech runtime didn't install: {{ runtimeTask?.error || "unknown error" }}.
            Retry from AI Settings → Speech engines.
          </p>
          <p v-else>Install cancelled — nothing was changed.</p>
          <p v-if="!hasLlmProvider" class="jv-muted quick-setup__note-md">
            The AI text features (attribution, dictation cleanup, compose) have their own
            setup — open <a href="#/ai">AI Settings</a> and run the LLM engine setup.
          </p>
        </template>
      </div>

      <template #footer>
        <template v-if="step === 'confirm'">
          <UiButton intent="ghost" label="Skip — configure later" @click="close" />
          <span class="jv-spacer" />
          <UiButton
            intent="primary"
            :label="enginesToInstall.length ? 'Install speech runtime' : 'Finish'"
            title="Nothing here blocks you: the AI text features have their own setup under AI Settings"
            @click="enginesToInstall.length ? runInstalls() : close()"
          />
        </template>
        <template v-else-if="step === 'install'">
          <UiButton intent="ghost" label="Cancel" @click="cancelInstalls" />
        </template>
        <template v-else-if="step === 'done'">
          <span class="jv-spacer" />
          <UiButton intent="primary" label="Close" @click="close" />
        </template>
      </template>
  </AppModal>
</template>

<style scoped>
.quick-setup__body { padding: 18px 22px; display: flex; flex-direction: column; gap: 18px; }
.quick-setup__loading { text-align: center; padding: 24px 0; }
.quick-setup__row-label {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-3);
  font-weight: 600;
  margin-bottom: 4px;
}
.quick-setup__row-value {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  flex-wrap: wrap;
}
.quick-setup__blurb { font-size: 12px; line-height: 1.5; margin: 6px 0 0; }
/* Inline-style purge (parity batch slice 10) — the repeated note literals
   became these; values stay the exact ones the template used. */
.quick-setup__note { font-size: 11.5px; }
.quick-setup__note--est { margin: 4px 0 0; }
.quick-setup__note--lede { margin: 0 0 6px; }
.quick-setup__note--banner { margin-top: 8px; }
.quick-setup__note-md { font-size: 12px; }
.quick-setup__note-md--lede { margin: 0 0 10px; }
.quick-setup__engines, .quick-setup__pins {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.quick-setup__engines li, .quick-setup__pins li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  background: var(--surface-2);
  border-radius: 4px;
  font-size: 12px;
}
.quick-setup__pins code {
  font-family: var(--font-mono);
  font-size: 11px;
}
.quick-setup__progress-row strong { grid-column: 1; font-size: 12.5px; }
.quick-setup__progress-row > span:nth-child(2) { grid-column: 2; }
.quick-setup__helpers { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.quick-setup__helpers li {
  display: flex; align-items: center; gap: 10px;
  border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; font-size: 12.5px;
}
.quick-setup__helper-ic { flex: none; }
.quick-setup__helper-name { flex: 1; min-width: 0; }
.quick-setup__engine-row { display: flex; align-items: center; gap: 8px; }
.quick-setup__engine-row input { accent-color: var(--accent); width: 15px; height: 15px; flex: none; }
.quick-setup__engine-name { font-weight: 600; }
.quick-setup__engine-where { color: var(--ink-2); white-space: nowrap; }
.quick-setup__engine-blurb { font-size: 11px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.quick-setup__next { margin: 0; padding-left: 18px; font-size: 12.5px; line-height: 1.8; }
</style>
