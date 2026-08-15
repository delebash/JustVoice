// SPDX-License-Identifier: MIT
// The ONE memory feed (the 2026-08-15 one-strip consolidation): a shared
// poller over `/v1/engines/vram` whose cells the kit's top strip renders
// (AiModelsArea `hwCells` + `llmClaim` — AiView feeds them) and whose raw
// snapshot the Speech-engines tab keeps for its per-row measured hints.
// One module, one poll, one event cursor — two subscribers must never mean
// two pollers or double eviction toasts (the exact two-truths shape the
// 2026-08-13 redesign exists to kill).
import { computed, ref } from "vue";
import { pushToast } from "@delebash/llm-ui";
import { useApi } from "../stores/api.js";

export const vram = ref(null);

export function fmtDisk(mb) {
  if (mb == null) return "—";
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
}

let timer = null;
let subscribers = 0;
let lastEventSeq = 0;
let primed = false; // absorb pre-mount events silently on the first poll

async function poll() {
  const api = useApi();
  const v = await api.safeRequest(`/v1/engines/vram?events_since=${lastEventSeq}`, null);
  if (!v) return;
  for (const ev of v.events || []) {
    lastEventSeq = Math.max(lastEventSeq, ev.seq);
    if (primed) {
      pushToast({
        message: `${ev.victim_key} was unloaded to make room${ev.reason ? ` — ${ev.reason}` : ""}.`,
        kind: "info", duration: 6000,
      });
    }
  }
  primed = true;
  vram.value = v;
}

// Refcounted: the poll runs while anyone is mounted, stops at zero.
export function subscribeVramFeed() {
  subscribers += 1;
  if (subscribers === 1) {
    poll();
    timer = setInterval(poll, 4000);
  }
  let live = true;
  return () => {
    if (!live) return;
    live = false;
    subscribers -= 1;
    if (subscribers === 0 && timer) { clearInterval(timer); timer = null; }
  };
}

// ── The strip's host cells (rendered by the kit strip after its own) ────
// Server-side pre-joined truth: `loaded` carries kind + engine + model name
// + resolved device, reservations carry the measured take with provenance.
// TTS and STT cells are ALWAYS present (user, 2026-08-15: "i dont see a
// place for tts or sst" — an empty slot shows "—" exactly like the LLM
// cell, so the strip's shape never changes). A loaded engine with no
// booking is "not measured yet"; a CPU-placed engine on a discrete box
// holds no VRAM by policy (Q2) — its cell says so instead of hiding; a
// booking with no live engine (crashed) still shows — the ledger is truth
// about what is booked.
export const hostCells = computed(() => {
  const v = vram.value;
  if (!v) return [];
  const res = v.reservations || [];
  const cells = [];
  const claimed = new Set();
  for (const kind of ["tts", "stt"]) {
    const row = (v.loaded || []).find((x) => x.kind === kind);
    if (!row) {
      // No live engine in this slot. A lingering booking (crashed engine)
      // still owns the cell — the ledger is truth — else the "—" placeholder.
      const orphan = res.find((x) => x.kind === kind);
      if (orphan) {
        claimed.add(orphan.key);
        const oEst = orphan.source !== "measured";
        cells.push({
          key: orphan.key, label: kind.toUpperCase(),
          value: oEst ? `~${fmtDisk(orphan.vram_mb)}` : fmtDisk(orphan.vram_mb),
          sub: orphan.label || orphan.key.split(":").slice(1).join(":"),
          title: "Booked in the ledger with no live engine — an unload or restart releases it",
        });
      } else {
        cells.push({ key: kind, label: kind.toUpperCase(), value: "—" });
      }
      continue;
    }
    const r = res.find((x) => x.key === row.key);
    if (r) claimed.add(r.key);
    if (v.mem_arch === "discrete" && (row.device || "").toLowerCase() === "cpu") {
      cells.push({
        key: row.key, label: kind.toUpperCase(), value: "on CPU",
        sub: row.model || row.label,
        title: "CPU-placed — holds no VRAM on a discrete card; its RAM use is shown for information, never budgeted",
      });
      continue;
    }
    const est = r && r.source !== "measured";
    cells.push({
      key: row.key,
      label: kind.toUpperCase(),
      value: r ? (est ? `~${fmtDisk(r.vram_mb)}` : fmtDisk(r.vram_mb)) : "not measured yet",
      sub: row.model || row.label,
      title: r
        ? (est
          ? "Approximate — read from the device-wide change during load; a real per-process measurement replaces it when one becomes possible"
          : "Measured on this machine at load")
        : "First load on this machine — JustVoice books the real measured footprint as soon as a probe lands; until then nothing is reserved for this engine",
    });
  }
  for (const r of res) {
    if ((r.kind === "tts" || r.kind === "stt") && !claimed.has(r.key)) {
      const est = r.source !== "measured";
      cells.push({
        key: r.key,
        label: r.kind.toUpperCase(),
        value: est ? `~${fmtDisk(r.vram_mb)}` : fmtDisk(r.vram_mb),
        sub: r.label || r.key.split(":").slice(1).join(":"),
        title: est ? "Approximate (device-delta)" : `Measured (${r.kind.toUpperCase()})`,
      });
    }
  }
  if (v.other_mb > 256) {
    cells.push({
      key: "other", label: "Other apps", value: fmtDisk(v.other_mb),
      title: "Memory held by processes JustVoice doesn't manage (browser, OS, games)",
    });
  }
  if (v.busy_kinds?.length) {
    cells.push({
      key: "busy", label: "Busy", value: v.busy_kinds.map((k) => k.toUpperCase()).join(" · "),
      title: "Work in flight — this kind's resident model can't be evicted right now",
    });
  }
  return cells;
});

// The LLM cell's idle words (the on-demand claim — Q3's standing line): the
// kit owns the cell; JV supplies only what to say when nothing is resident.
export const llmClaim = computed(() => {
  const v = vram.value;
  if (!v) return null;
  const c = v.claim;
  if (c) {
    return {
      text: `~${fmtDisk(c.vram_mb)} on demand`,
      title: `${c.model} — ${c.source}${c.matches ? ` (${c.matches} measured loads)` : ""}`
        + (c.ram_mb ? ` · RAM ~${fmtDisk(c.ram_mb)} (display-only)` : ""),
    };
  }
  if (v.claim_reason === "cloud-routed") {
    return { text: "cloud-routed", title: "Your AI features run on a cloud provider — no local memory needed" };
  }
  return null;
});
