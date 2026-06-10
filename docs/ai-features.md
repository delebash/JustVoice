# AI features — routing Compose / Rewrite / Speaker attribution / Smart-assign / Suggest

JustVoice has five LLM-driven features. Each one can route through a different provider, model, and tier independently. The routing surface is **Settings → AI features**.

## The five features

| Feature | What it does | When you use it |
|---|---|---|
| **Compose** | LLM writes a fresh in-character line from a persona's personality prompt | Generate view → 🎲 Compose button. Useful for prototyping a character voice or filling in dialogue |
| **Persona rewrite** | Rewrites the current text in a character's voice (preview-then-accept) | Generate view → ✏️ Rewrite button. Studio Script tab → right-click a dialogue block → preview the rewrite, accept or discard |
| **Speaker attribution** | Tags each paragraph with its speaker (narrator vs character) | Studio Script tab → Analyze. Drives the audiobook attribution pass |
| **Smart-assign** | Matches each character in your cast to a TTS voice based on age / gender / tone | Studio Cast tab → Smart-assign. One-click cast assignment with LLM judgment |
| **Render preset suggest** | Classifies a chapter's tone and picks the best matching render preset | Studio Render tab → 💡 Suggest button per scene |

## How routing works

Each feature has a **pin**: a tuple of `(provider, model, tier)`. When you trigger the feature, JustVoice:

1. Looks up the pin for that feature in your settings.
2. If found, sends the request through the pinned provider at the pinned model.
3. If not found ("Inherit default"), falls back to the **first registered LLM provider** in your Engines tab.

This means you can mix: pin Speaker attribution to Claude Reasoned for accuracy, Compose to Ollama Direct for speed, and let everything else inherit the default. Or pin nothing — everything routes through the same provider.

## Setting a pin

1. **Settings → AI features**. Each feature shows as a row.
2. **Provider column** — pick from a dropdown. The first option is "Inherit default · <provider name>" showing which provider the feature falls back to when unpinned.
3. **Model column** — type the model id (e.g. `claude-haiku-4-5`) or click the **↻** button to fetch the provider's model list, which populates the input's autocomplete.
4. **Tier column** — pick Guided / Direct / Reasoned. A "rec: X" hint appears below if your pick differs from the recommended tier for that feature.
5. **Lab link** — speaker_attribution rows have a `Lab` link that jumps to Speaker Lab (Tools → Speaker Lab) where you can A/B different prompts and tier combinations.

Changes apply immediately. No save button — every column change PUTs to `/v1/feature-pins`.

## Recommended tiers per feature

| Feature | Recommended tier | Why |
|---|---|---|
| Compose | Direct | One-shot generative task; fast turnaround matters |
| Persona rewrite | Direct | Edit-in-place needs to feel responsive |
| Speaker attribution | Reasoned | Accuracy matters more than speed; reasoning models substantially outperform Direct on hard books |
| Smart-assign | Direct | One-time per book; Direct is good enough |
| Render preset suggest | Direct | Quick classifier; Direct handles it |

The QuickSetup wizard (post-onboarding) pre-configures these pins based on your hardware tier — see `quick-setup.md`.

## Clearing a pin

Click the **✕** button at the end of the row. The feature falls back to the inherit-default provider.

## Speaker corrections panel

Below the AI Features table, the **Speaker corrections** panel shows a per-project count of speaker corrections you've made on the Studio Script tab. The top-12 most recent corrections per project inject into the next Analyze run as worked examples — the system learns your specific character voicing from your manual fixes.

**Clear all** wipes a project's correction history. Use when you change your mind about a character's identity (e.g. you split one character into two) and don't want the old corrections poisoning the next Analyze.

## Troubleshooting

- **501 "LLM service not configured"** — no LLM provider is registered. Add one in Engines → LLM tab (see `providers.md`).
- **Pin saved but the feature still uses the wrong provider** — verify the provider's `live` pill is green in the Engines tab. Unregistered providers (red `unregistered` pill) get skipped at dispatch time.
- **Model field shows "default" placeholder** — the pin was set but no model id was specified; dispatch uses the provider's saved default. Open the row, click ↻ to fetch the model list, pick one explicitly.
