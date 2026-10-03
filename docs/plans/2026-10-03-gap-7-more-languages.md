# Gap 7 — more languages: Chatterbox in Hebrew, Russian, Chinese and Japanese; Kokoro's Japanese voices

## 1. What this is

Gap 7 of the audio.cpp switch (switch plan §5: "Chatterbox Hebrew, Japanese, Russian, Chinese;
Kokoro Japanese"), started 2026-10-03 under "you have a go for all gaps" and "start gap 7".

- **Chatterbox:** the old PyTorch engine spoke Chatterbox Multilingual's 23 languages.
  audio.cpp's Chatterbox speaks 19, and refuses `he`, `ja`, `ru` and `zh`.
- **Kokoro:** its five Japanese voices refuse to load. engines.md says "Japanese needs a
  dictionary the runtime does not ship yet".

## 2. Facts (2026-10-03)

Research by a sub-agent; the key claims were re-checked in the code (marked ✓).

**What upstream does.** Resemble's tokenizer, `MTLTokenizer.encode`
(resemble-ai/chatterbox master `5de7a54`, `src/chatterbox/models/tokenizers/tokenizer.py`):
- it lowercases and applies NFKD, then runs one step per language, then adds `[lang]`, and spaces
  become `[SPACE]` ✓;
- the steps: `zh` → `ChineseCangjieConverter`; `ja` → `hiragana_normalize` (pykakasi);
  `he` → `add_hebrew_diacritics` (dicta-onnx); `ru` → `add_russian_stress`
  (RussianTextStresser); `ko` → jamo.

**What audio.cpp does.** Our copy, `src/models/chatterbox/text_tokenizer.cpp`:
- a fixed list of 19 languages (`:399-404`) ✓, and anything else throws
  "unsupported Chatterbox language" (`:406-416`) ✓;
- the multilingual path does lowercase, NFKD, Korean jamo, then the tag and `[SPACE]` (`:429-440`) ✓;
- no step for `zh`, `ja`, `he` or `ru`;
- `model_specs/chatterbox.json` declares a `cangjie_mapping` file, but no C++ reads it ✓.

**The GGUF already carries what Chinese needs.** The published Chatterbox GGUF embeds
`Cangjie5_TC.json` (1.9 MB), and its tokenizer has:
- the `[he] [ja] [ru] [zh]` tokens and the 37 `[cj_*]` tokens;
- 88 Hebrew tokens, 208 Cyrillic, the stress mark U+0301, and the kana;
- **no Chinese characters at all.** Chinese reaches the model only as Cangjie codes.

**Hebrew.**
- Upstream calls `Dicta()` with no argument, but every dicta-onnx release requires a model path.
  The TypeError is swallowed and the text passes through, so upstream never adds vowel points.
- Our old engine never installed dicta.
- Plain Hebrew is all in the vocabulary.

**Russian.**
- RussianTextStresser is not in upstream's dependencies, and our old engine never installed it.
  It is AGPL / GPL-3 and needs a Wiktionary SQLite dictionary plus spaCy.
- Upstream passes the text through without it.
- Plain Russian is all in the vocabulary.

**Chinese.**
- `ChineseCangjieConverter` segments the text into words with spacy-pkuseg, then joins the
  words with spaces. Our old engine installed spacy-pkuseg, so its Chinese had spaces between
  words.
- Each character of Unicode category `Lo` becomes `[cj_<code letters>][cj_.]`. When several
  characters share a code, an index digit is added: the character's position in that code's list.
- Two quirks must be copied exactly:
  - when a character appears twice in the table, the last entry wins;
  - the index is the character's first position in that code's list.
- The table also covers simplified characters.
- Licences:
  - spacy-pkuseg is MIT. Its model (`spacy_ontonotes`, 34.6 MB) has no stated licence.
  - The Cangjie table is published with Resemble's MIT repo.
- Reusable code already in our copy: two jieba segmenters
  (`src/models/kokoro_tts/g2p_multilingual.cpp:375-488`,
  `src/community_models/zipvoice/jieba_segmenter.cpp`).

**Japanese on Chatterbox.**
- Upstream converts words with kanji into hiragana with pykakasi, adding a space before は/へ,
  and keeps katakana.
- pykakasi and its 9.75 MB dictionary are GPL-3.0, so neither can go into our MIT / Apache code.
- Kana-only text is already in the vocabulary.

**Japanese on Kokoro.**
- The C++ port of misaki's path (MeCab plus UniDic) already exists in our copy:
  `g2p_multilingual.cpp:261-373` ✓.
- It refuses because the GGUF has no `unidic/` folder (`:270-273`) ✓, and the runtime does not
  ship `libmecab.dll` (`:282`, or `AUDIOCPP_MECAB_LIBRARY`) ✓.
- unidic-lite (UniDic 2.1.2, about 250 MB, BSD) is the dictionary that matches the port's field
  layout and what Kokoro was trained against.
- MeCab is BSD.

## 3. The plan

1. **Hebrew and Russian:** add `he` and `ru` to the list. This matches upstream and our old
   engine (no vowel points, no stress marks). Adding stress later from eSpeak NG's Russian
   dictionary is possible; it is an idea, not part of this gap.
2. **Chinese:** the Cangjie conversion in C++, reading the `cangjie_mapping` file already in the
   GGUF. Upstream's quirks are copied exactly. Word segmentation is decided by Q1.
3. **Japanese (Chatterbox and Kokoro):** decided by Q2.
4. **The app:**
   - Chatterbox's language list grows as each language lands.
   - It is gated on the release that carries it, through the feature table: one release at the
     end, as decided 2026-10-03.
   - engines.md's "Not available yet" lines go as each language returns.
5. **Checks:**
   - Our local CUDA build, a cloned voice on core Chatterbox, renders per language.
   - Qwen3-ASR read-back where it knows the language (Russian, Chinese, Japanese; Hebrew is not
     among its languages, so Hebrew is checked by ear).
   - Unit tests for the Cangjie conversion against upstream's output on known characters.

## 4. Questions

- **Q1 · Chinese word segmentation.**
  - (a) Reuse the jieba segmenter already in our copy. It approximates pkuseg's word breaks, with
    no new files. **Lean.**
  - (b) No segmentation. That is upstream's own fallback when pkuseg is missing; the text then
    has no `[SPACE]` between words, unlike what our old engine sent.
  - (c) Port pkuseg's CRF and its 34.6 MB model. Exact, but the model's licence is unstated.
- **Q2 · Japanese.**
  - (a) One optional "Japanese dictionary" download, unidic-lite (about 250 MB, BSD), shared by
    Kokoro's Japanese voices and Chatterbox's kanji conversion. `libmecab.dll` (BSD) ships in our
    runtime release. Chatterbox's kanji reading would then come from UniDic instead of pykakasi:
    close to upstream, not identical. **Lean.**
  - (b) Chatterbox Japanese for kana-only text now, refusing text with kanji by name; Kokoro
    Japanese later.
  - (c) Leave Japanese out of this gap.

## 5. Blast radius (greps 2026-10-03)

| Change | What it touches | Grep |
|---|---|---|
| The language list grows | the loader's advertised languages, the session's language check, the T3 choice | `loader.cpp:19,65 supported_chatterbox_language_codes()` · `session.cpp:101 normalize_chatterbox_language_code(language)` · `tts.cpp:150` · `text_tokenizer.cpp:412,419,434` |
| The Chinese step in the multilingual encoder | the one encoding path | `text_tokenizer.cpp:429-440 encode_chatterbox_multilingual_text` (the Cangjie table must reach it from the session's assets: `session.cpp` `load_chatterbox_english_tokenizer(…"multilingual_tokenizer")`) |
| The app's language list | the variant rows, the language pickers, the cast's engine choice | `chatterbox/manifest.py:49 _LANGS` · `:55 "Chatterbox Multilingual (19 languages)"` · `:27 DESCRIPTION "19 languages"` |
| Docs | the not-yet list, the use-case line | `engines.md:351-353` · `engines.md:378 "clones in 19 languages"` |

## 6. Build record (2026-10-03)

**Our audio.cpp (uncommitted):**
- `he`, `ru` and `zh` join the list.
- The Cangjie table loads into the multilingual tokenizer from the GGUF's own `cangjie_mapping`.
  Upstream's quirks are copied: the last entry wins, the index is the first position, and it is
  written only when above 0.
- Only characters in upstream's `Lo` set are converted. On this table those are exactly 15
  blocks, checked entry by entry against Python 3.12's unicodedata: 98,095 characters; 1,133
  symbols, numerals and unassigned code points stay as they are.
- `zh` text is converted after lowercase and NFKD, as upstream does. A package without the table
  refuses Chinese by name.
- The first live run found a bug of mine: the table loaded empty, because a range-for walked the
  array of a destroyed temporary (`parse_file(path).as_array()`). The document is now held in a
  variable.

**Live, our local CUDA 12.4 build, RTX 2070 SUPER:**
- Setup: core Chatterbox q8 (the app's GGUF), the UK-male Kokoro reference, seed 5, CFG 0.
  Qwen3-ASR read back the languages it knows.

  | Language | Read back |
  |---|---|
  | Russian | "…разговаривали о Мари" for "…о море" — one word off |
  | Chinese (no segmentation yet) | 今天晚上我们在海边散步，聊了很久。 — exact |
  | Spanish (control) | exact |
  | English (control) | exact |
  | Hebrew | rendered; not checked (Qwen3-ASR has no Hebrew). For your ear: `scratchpad/gap7/cb_he.wav` |

**Waiting:** Q1 (segmentation), Q2 (Japanese), and the app side (the language list, the feature
gate on the one release, docs) once those are answered.

## 7. Decided, and what that turned up (2026-10-03)

"your rec on all go, commit and push":
- Q1: jieba.
- Q2: one optional Japanese dictionary download (unidic-lite) shared by Kokoro and Chatterbox,
  plus `libmecab.dll` shipped in our runtime.
- Committed: our audio.cpp `fc55e1e6` (he, ru, zh). JustVoice `fbf6823`.

**Q1's premise was wrong.** My recommendation said "no new files". But both jieba
implementations in our copy read a dictionary embedded in their own model's package:
- Kokoro's `g2p/zh.json` holds the frequency table and the HMM tables
  (`g2p_multilingual.cpp:375-460`);
- ZipVoice's `JiebaSegmenter(dict_path, …)` reads a jieba dict file from its package
  (`zipvoice/jieba_segmenter.cpp:71-76`).

The Chatterbox GGUF carries no jieba dictionary, so word splitting for Chinese needs one from
somewhere. Asked again, with the options.

**MeCab does not build as-is.** taku910/mecab master (0.996, 2013) fails under today's MSVC with
the VS 2022 toolset:
1. `WPATH_FORCE` is undefined on MSVC (`common.h`); patched.
2. An ambiguous `operator<<` for `size_t` (`feature_index.cpp:356`); patched.
3. `std::binary_function` is missing (`dictionary.cpp:68`), still with `/std:c++14
   /D_HAS_AUTO_PTR_ETC=1`. Stopped there.

Which MeCab we build, or ship prebuilt, is asked: a maintained fork, the prebuilt BSD
`libmecab.dll` from fugashi's Windows wheel, or patching 0.996 through.
