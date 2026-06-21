# Morning Recap — JustVoice

> The in-repo session-pickup doc. Reflects current code state, not history.
> Read this immediately after `CLAUDE.md`. If this file conflicts with a memory file, the memory file wins.

---

## ⮕ ACTIVE WORK — read first (2026-06-21)

**Current thread: the shared AI/LLM stack convergence.** Authoritative plan:
`docs/plans/2026-06-20-shared-ai-stack-plan.md` — 20 settled decisions + a
reconciliation section; **read it before any AI work and do NOT re-litigate it.**
Branch: `claude/admiring-galileo-il3q0o` (all repos). Goal: JustVoice and
JustWrite run the SAME AI stack — `just-llm-runner` (Python) + `@delebash/llm-ui`
(Vue) — differing ONLY in TTS (JV) and each app's feature catalog.

**Shared packages (done + pushed):**
- `just-llm-runner` is now two subpackages: `llm_runner/runner/` (the local
  llama.cpp runner) + `llm_runner/llm/` (cloud-provider + dispatch + prompt layer
  lifted from JV — adapters, registry, tiers, usage, dispatch, and `prompts.py` =
  FeaturePromptRow + PromptStore Protocol + render + `make_prompt_router`/
  `make_feature_router`). Public API (`from llm_runner import router, …`) unchanged.
- `@delebash/llm-ui` (`just-llm-runner/ui/`, repo root) is **plain JS — no TS**:
  own origin-aware `client.js`, token-driven `lu-*` `styles.css`, `Lu*` primitives,
  and the first shared view `PromptLab.vue`. The old `ProviderBackend` adapter is
  deleted (the UI calls the same endpoints both apps mount). Vite alias
  `@delebash/llm-ui → ../just-llm-runner/ui/src` in both apps.
- Feature prompts are **DB-seeded + Lab-editable** (no hardcoded prompt text),
  served by the shared `/v1/ai/prompts` + `/v1/ai/run` + `/v1/ai/stream`. JV and
  JW both adopted it; their per-app duplicates were deleted (the Keystone =
  shared impl behind a host store adapter).

**JustWrite is the current focus app** (build the shared GUI in service of JW
first; JV adopts the identical result after). The A–F plan:
- A ✅ shared prompt subsystem → `llm_runner`. B ✅ JW server adopts it.
- C 🔄 shared `@delebash/llm-ui`: **PromptLab done + screenshot-verified in JW**;
  still to build — provider form (from JW's `SettingsProviderForm`), model picker,
  provider list, Features routing, Usage view.
- D ⬜ shared top-level "AI / Models" menu area (Decision 2). E ⬜ JW streaming
  features → `/v1/ai/stream`, then delete the old `/v1/llm/...` gateway.

**JustVoice's own state:** fully on the shared backend (no shims); it will adopt
the shared `@delebash/llm-ui` views after JW proves them, then layer TTS (the one
JV-only difference) on the same framework. **Still HARDWARE-GATED** (build/verify
on the user's GPU): the built-in runner's P1.5b auto-spawn + P1.6 benchmark +
working-config cache.

**Storage rewrite — DONE, both apps** (2026-06-18/19): JW fully off
kv/IndexedDB/localStorage; JV renderer prefs → `/v1/prefs`, `settings.json` →
SQLite `settings` row. Detail: JW `docs/plans/2026-06-18-unified-storage-no-idb.md`,
JV `docs/plans/2026-06-19-jv-prefs-to-sql.md`.

---

## History

Older dated session logs (2026-06-16 and earlier — the engines / storage / QC /
audit work that predates the shared-AI-stack effort) used to live here as a long
append-log. They are preserved in **git history** (this file's prior revisions);
the live state is the ACTIVE WORK block above + `docs/plans/` (authoritative:
`docs/plans/2026-06-20-shared-ai-stack-plan.md`). This recap is the MAP, not the
archive — keep it that way.
