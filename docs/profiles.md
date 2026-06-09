# Voice profiles

A **voice profile** is a reusable voice configuration. It bundles a voice (cloned / preset / designed) with default delivery knobs, an effects chain, a personality prompt, and a lexicon override into one named object you can pick from a dropdown.

Profiles are managed in the **Profiles** tab.

## What's the difference between a profile and a persona?

| | **Voice profile** | **Persona** |
|---|---|---|
| What it is | A reusable VOICE configuration | A named CHARACTER that uses a voice |
| Scope | Cross-project — a library of voices | Project-scoped — the cast list of one book or game |
| Bundles | voice_type + preset/clone source + default delivery + effects chain + personality + lexicon | name + voice_id (FK → profile) + per-character delivery override |
| Example | "warm-narrative-female-en" — Aria cloned + reverb chain + speed 0.95 | "Mara, protagonist of Book 7" — uses the "warm-narrative-female-en" profile |
| Reuse | One profile used by many personas across many projects | A persona belongs to one project's cast |
| Drives | Generate's "🎭 Profile" chip + Compose button + default render knobs | Audiobook cast list — per-paragraph character attribution → persona → profile → voice |

**Two characters can share a profile** (sibling NPCs voiced by the same actor). The split lets you swap a profile's tuning once and have every persona using it inherit the change. **Profile = the voice. Persona = the character using that voice.**

## When to create a profile vs a stored voice

- **Stored voice** (Voices tab) — a raw voice artifact: cloned WAV, preset selection, blend recipe. Anonymous; just the voice.
- **Profile** — wraps a voice with tuning + personality + effects. Use a profile when you'll reuse this exact voice configuration repeatedly.

A profile always references one voice. Multiple profiles can wrap the same voice with different tuning ("warm Aria" vs "stern Aria").

## Fields

| Field | Used for |
|---|---|
| Name | Display in Generate's profile chip + Personas binding + Profile cards. Unique. |
| Description | Optional short note about this voice's character. |
| Language | Default language for renders using this profile. Some engines (Chatterbox-Multilingual) accept a language switch per-render; others (Kokoro) bake it in. |
| Voice type | `cloned` (reference WAV) / `preset` (engine built-in) / `designed` (text-prompted, Qwen3-style). |
| Default engine | Which TTS engine to use for this profile. If unset, the currently-loaded engine is used. |
| Personality | Free-form prompt describing the character's voice mannerisms. **When set, the Generate tab shows the 🎲 Compose button for this profile** — clicking it asks the LLM to write a fresh in-character line. Examples below. |
| Effects chain | Pedalboard chain applied to output WAV — reverb, EQ, compressor, room sim, etc. Saved as a JSON array. |
| Default delivery | Tier-2 voice tuning JSON (speed / pitch / temperature / exaggeration / etc.). See "3-tier voice tuning" below. |
| Default lexicon | Pronunciation dictionary applied before TTS. Overrides any project default. |

## 3-tier voice tuning

When you render via `/v1/generate` (with `profile_id` set) or `/v1/chapters/render`, delivery overlays merge in this order (highest precedence first):

1. **Tier 3** — RenderPreset (per-chapter, project-scoped, `preset_id` argument)
2. **Tier 3** — the request's own `delivery` field (per-call override)
3. **Tier 2** — `VoiceProfile.default_delivery` (per-voice baseline)
4. **Tier 1** — engine defaults (from the capability manifest)

The merge is dict-deep — engine-specific subdicts (e.g. `delivery.engine.exaggeration`) merge at the inner-key level. Practical effect: lock per-voice defaults once on the profile, then override per-chapter via a preset when a specific scene needs different pacing.

## Personality prompt examples

The personality prompt is fed to the LLM (configured in Settings → External) when the user clicks 🎲 Compose. The LLM writes a fresh line of dialogue in this character's voice. Examples:

```
A weary detective with a gravelly voice. Cynical, dry humor.
Speaks in clipped sentences. Likes to repeat the last word someone said,
slowly, as if tasting it.
```

```
Elaborate Victorian gentleman. Long compound sentences. Frequently
quotes his own correspondence. Address everyone as "my dear fellow."
```

```
Teenage hacker. Quick, dismissive. Heavy use of "literally", "actually",
and trailing-off "...whatever." Will mock formality.
```

Keep prompts under 500 characters — the LLM doesn't need a novel; it needs voice direction.

## Compose action

**Requires:** profile has a non-empty personality prompt + an LLM service is configured.

In Generate, pick a profile → the 🎲 Compose button appears. Click it → JustVoice asks the LLM (per settings.llm config) to write a fresh in-character line based on the personality prompt → the textarea fills with the result.

Until you wire an LLM service, Compose returns 501 with a "LLM not configured" toast and the textarea stays empty.

## Cloning a voice into a profile

1. Voices tab → "+ Clone new voice" (requires Chatterbox loaded). Upload a 10-30s reference WAV. Voice gets stored.
2. Profiles tab → "+ New profile" → set voice_type=cloned, name + personality.
3. Use the profile from Generate → 🎭 Profile chip.

Voice files live under `<data>/voices/`, profiles in SQLite. Deleting a profile keeps the underlying voice file — you can re-bind it to a new profile.

## Profile vs render preset

| | **Profile.default_delivery** | **RenderPreset.delivery_json** |
|---|---|---|
| Scope | Per-voice baseline (cross-project) | Per-chapter or per-project bundle |
| Includes | Just the delivery overlay | Delivery + voice_id + mastering target + lexicons + seed + cache_scope |
| Edit via | Profiles tab → edit modal | (UI TBD — manage via `/v1/presets`) |
| When to use | "Mara always speaks 5% slower" | "Chapter 12 needs to be tense — drop temp + add reverb" |

## API surface

| Endpoint | Purpose |
|---|---|
| `GET /v1/profiles` | List all profiles |
| `GET /v1/profiles/{id}` | One profile |
| `POST /v1/profiles` | Create |
| `PATCH /v1/profiles/{id}` | Update |
| `DELETE /v1/profiles/{id}` | Delete |
| `POST /v1/profiles/{id}/compose` | LLM-fill a line (501 until LLM configured) |

When calling `/v1/generate`, pass `profile_id` to apply the profile's `default_delivery` + use the right voice. See [generate.md](generate.md).

## Troubleshooting

- **Compose button doesn't show** — Profile has no personality prompt, or no profile is selected. Edit the profile to add personality.
- **Compose returns "LLM not configured"** — Wire an OpenAI-compatible endpoint in Settings → External.
- **Profile selector empty** — No profiles exist yet. Use "+ New profile" on the Profiles tab.
- **Profile name conflict** — Profile names must be unique. Edit the conflicting one or pick a different name.
- **Voice not actually changing per profile** — Check that you're passing `profile_id` in the API call. The UI chip does this automatically.
