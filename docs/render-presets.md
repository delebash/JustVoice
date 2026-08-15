# Render presets

A render preset is a **named bundle of everything that shapes a render**: voice +
delivery + effects chain + mastering target + lexicons + seed + cache scope.
Studio's Render tab binds one per scene, which is how a whole chapter or quest
keeps one locked, reproducible sound.

## Copy, not reference

Applying a preset **copies** its values onto the render — it is not a live link.
Editing a preset later changes future renders that use it, never the audio you
already made. That's deliberate: a finished chapter's sound must not drift
because someone tweaked a preset.

## Where a preset sits in the precedence

Delivery settings merge in three tiers, lowest to highest: the engine's own
defaults → the voice profile's default delivery → **the render preset's overlay
or the request's explicit delivery** (those two share the top tier). So a preset
beats the voice's defaults, and an explicit per-generation tweak stands beside
the preset rather than under it.

## The preset's master target

A render preset can name a mastering target, and **binding it to a scene is how
one chapter gets a different target from the rest of the book**. It beats the
project's setting and the project kind's default; only an explicit API request
outranks it, and `none` on the preset means that scene renders raw. Leave the
preset's target unset and the project decides — see
[mastering.md](mastering.md#which-preset-a-render-uses).

(This field was saved and ignored until 2026-08-15: presets carried a master
target that no render ever read.)

## The preset's effects chain

The chain layers **on top of** the persona's, in that order — the character's
own sound first, the scene's colour after. It runs on chapter renders, not just
single-line previews. Leave the preset's chain empty and the persona's runs
alone.

## Three things called "preset" — the map

- **Render presets** (this page) — the full per-scene bundle.
- **Effect presets** — a saved effects *chain* only (Effects tab); a render
  preset can include one.
- **Mastering presets** — the loudness/peak target (ACX, podcast, YouTube…);
  set per project, overridable per render preset.
