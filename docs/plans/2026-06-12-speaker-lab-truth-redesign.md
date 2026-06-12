# Speaker Lab truth redesign — 2026-06-12 (user redlines, "go for it")

<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

User finding: the ported Lab hid the pipeline it exists to inspect —
empty prompt box ("tier default" placeholder), no user prompt, no
provider/model dropdowns, "pin default" jargon, raw checkboxes,
full-width selects. Verified: the BACKEND was correct all along
(pipeline.py:133 resolves the tier-tuned body server-side); the UI
just didn't show it.

Shipped:
- `GET /v1/extraction/config` — tier registry + REAL prompt bodies +
  user template + resolved route. UI displays server truth, never
  duplicates prompt text.
- AnalyzeRequest/analyze-text gain `provider_id` / `user_prompt` /
  `confidence_floor` overrides; dispatch.chat gains
  `provider_override`. Production config's user_prompt now reaches the
  scene endpoint too.
- SpeakerLabView rebuilt: one-line preset row w/ PRODUCTION badge +
  promote/save right; pipeline explainer banner; provider dropdown
  ("Route default — <name>") + model combobox w/ "(provider default —
  X)" + datalist from /v1/llm-providers/{id}/models; tier segmented
  pills (Auto → <classified>) that RESOLVE the real prompt into the
  textarea + floor; JvToggles + editable floor value; system AND user
  prompt boxes populated, "edited" chip + per-box reset; Input/Cast
  panes carded with eyebrows + hints. Prompts ship as overrides only
  when edited — what you see is what runs.
- CLAUDE.md RULE #1 gains the design-conformance checklist.

Remaining conformance queue (from the audit): Render tab (cards +
width tokens + toggles), Generate/Studio/Books/Captures/ImportReview
checkbox→JvToggle sweep, full per-view conformance audit doc.
