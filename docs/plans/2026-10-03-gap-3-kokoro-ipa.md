# Gap 3 — a lexicon's IPA reaches Kokoro: inline pronunciations in our audio.cpp

## 1. What this is

Gap 3 of the audio.cpp switch (switch plan §5: "Single-word IPA from lexicons — fork: a text+IPA
splice (eSpeak stays out of our MIT server)"), under "you have a go for all gaps". Since the
2026-10-01 switch a lexicon entry's IPA has done nothing on Kokoro — the respelling is used when
there is one, an IPA-only entry changes nothing (lexicons.md). This brings the IPA back.

## 2. Facts (2026-10-03)

- audio.cpp's Kokoro phonemizes the whole text through its multilingual G2P
  (`frontend.cpp: phonemize_text`); a `phonemes` option replaces the WHOLE text's phonemes — no
  per-word splice.
- Kokoro's symbols are not canonical IPA (vocab.tsv embedded in the GGUF): one symbol each for
  ʧ ʤ and the diphthongs A (eɪ) I (aɪ) W (aʊ) Y (ɔɪ) O (oʊ) Q (əʊ); no ASCII g (ɡ). The engine's
  own comment: two-symbol IPA silently turns "like" into "lack".
- The host already decides which IPA entries a line carries (`render_core._apply_lexicons` →
  `ipa_map`, matched by `_ipa_words`: whole words, any case, longest first, every split piece
  that is an entry) and sends them in `delivery.ipa_map` when `_supports_phoneme_input`.

## 3. The plan

1. **Our audio.cpp**: inline pronunciations "[word](/phonemes/)" — misaki's markup — in
   `phonemize_text`: marked words take the given phonemes (each symbol checked against Kokoro's
   vocabulary, a wrong one refused naming the word); the rest goes through the G2P; text without
   the markup takes the old path unchanged. Ships in v0.9.0-jv.2 with gap 2.
2. **The app**: `engines/kokoro/ipa.py` — `to_kokoro` (canonical IPA → Kokoro's symbols) and
   `splice` (marks a line's words by the host's own rule); the Kokoro mapping splices
   `delivery.ipa_map`.
3. **Gating**: `release.FEATURES["inline_ipa"]`; the capability (`supports_phoneme_input`, the
   manifest's `phoneme_override`) follows the PIN; `render_core._supports_phoneme_input` also
   needs the INSTALLED runtime, so an older one keeps using the respelling.
4. **Docs** with the pin move to jv.2: lexicons.md "IPA entries reach the audio", engines.md.

## 4. Blast radius (greps 2026-10-03)

| Change | What it touches | Grep |
|---|---|---|
| `_supports_phoneme_input` needs the installed runtime | the chapter render, the cache probe, Generate's lexicon pass | `render_core.py` (`_apply_lexicons(…, ipa_capable=_supports_phoneme_input(engine_id))` in `render_line` and `probe_line_cached`) · `generate_api.py:92 ipa_capable=_supports_phoneme_input(engine_id)` |
| The slot splices `ipa_map` | Kokoro requests from both paths | `generate_api.py:314-315 / 435-436 delivery["ipa_map"] = ipa_map` · `slot.py:458-463` |
| Capability on with the pin | Generate's "✓ IPA phoneme input" chip, the lexicon preview | `capability_details.py` kokoro `supports_phoneme_input` · `kokoro/manifest.py` `phoneme_override` |

## 5. Build record (2026-10-03)

- **audio.cpp `42db68d9`** (on `jv`): `split_inline_pronunciations`, `require_kokoro_symbols`,
  `phonemize_text` splicing. **Checked through our CPU server build**, af_heart, seed 7:
  "Beauchamp came home late." → read back "Bochamp came home late."; with
  "[Beauchamp](/bˈiʧəm/)" → "Beecham came home late."; the plain line byte-identical to v0.9.0
  (sha 93100c0c45 both); "[Beauchamp](/bˈiːʍəm/)" → refused, "the pronunciation of "Beauchamp"
  uses ʍ, which is not one of Kokoro's phoneme symbols".
- **App** (uncommitted): `kokoro/ipa.py`; the slot's splice; the feature gate; capability on
  with the pin. Tests `tests/test_kokoro_ipa.py` — the conversion table, the splice marking
  exactly the words of test_project_lexicon's recorded pre-switch table, the mapping, the
  installed-runtime gate, the pin — and the lexicon and blend suites pass unchanged.
