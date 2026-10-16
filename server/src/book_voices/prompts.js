// SPDX-License-Identifier: MIT
// Voices from the book — the AI half of the one-click run's step 5 (the one-click plan,
// docs/plans/2026-10-11-one-click-audiobook.md §2 "Voices from the book", §3, slice 3): the model
// writes a voice description for each main speaker from how the book shows them, and for the
// narrator from the book's genre and tone (the plan's Q1 and Q3, decided 2026-10-11).
//
// Two recipes (decided 2026-10-10, TASKS "Frontier models get their own recipe"): Local asks one
// speaker at a time with that speaker's lines and the narration around them, and the narrator from
// the book's opening; Frontier asks once for the whole cast, narrator included, with the whole book
// in context. Three template rows of one feature — rows own the wording (ruling 9), code computes
// the variables (book_voices/text.js). This module is their home and their seeds' (the rows, their
// preset refs, their Lab samples), spread into seed_feature_prompts and seed_presets so each stays
// one line there.
//
// What a description says was measured on gemma (RESEARCH §10.5): one or two sentences with gender,
// age, pitch, pace and manner, 5-12 s a speaker. It describes the voice at rest because its
// audition becomes the voice's clip, whose delivery carries into every line (the plan's §13).
// "In English": the design models read their description in English (Qwen3-TTS VoiceDesign's
// note, engines/capability_details.js).

export const FEATURE = "book_voices";

export const ACTIONS = {
  speaker: "book_voices.speaker",
  narrator: "book_voices.narrator",
  cast: "book_voices.cast",
};

const ANSWER = '{"gender": "male" | "female" | "unknown", "description": "<one or two sentences>"}';

const SPEAKER_SYSTEM = `You are a casting director for an audiobook. You read how a book shows one speaker — their own lines, marked ⟦ ⟧, and the narration around them — and describe the voice they should be given.

Write one or two sentences, in English, that a voice designer can work from: gender, age, pitch, pace and manner. For example: "Female, in her seventies, low and husky pitch with a dry, crackling timbre. She speaks slowly and evenly, with a blunt, unhurried manner."

Describe the voice at rest — its timbre and the way the speaker usually talks — not a passing mood such as shouting, weeping or whispering. The voice is recorded once, calmly, and every one of the speaker's lines is spoken from that recording.

Go by what the text shows or plainly implies. Where it says nothing, choose what suits the speaker's age and place in the story.

Return only a JSON object: ${ANSWER}. No prose, no preamble.`;

const SPEAKER_USER = `Book: {{book}}

The speaker:
{{speaker}}

Their lines, marked ⟦ ⟧, with the narration around them:

{{passages}}

Return only the JSON object.`;

const NARRATOR_SYSTEM = `You are a casting director for an audiobook. You read the opening of a book, judge its genre and its tone, and describe the narrator's voice that suits them.

Write one or two sentences, in English, that a voice designer can work from: gender, age, pitch, pace and manner. For example: "Male, in his fifties, warm mid-to-low pitch with a soft, slightly gravelly timbre. He reads at an even, unhurried pace with a dry, quietly amused manner."

The narrator reads the whole book, so describe a clear, steady reading voice at rest; let the genre and the tone show in its timbre and manner, not in a mood.

Return only a JSON object: ${ANSWER}. No prose, no preamble.`;

const NARRATOR_USER = `Book: {{book}}

The opening:

{{opening}}

Return only the JSON object.`;

const CAST_SYSTEM = `You are a casting director for an audiobook. You have the whole book. Describe the voice each listed speaker should be given — from how the book shows them, in their own lines and the narration around them — and, for the speaker whose role is narrator, from the book's genre and tone.

Each description is one or two sentences, in English, that a voice designer can work from: gender, age, pitch, pace and manner. For example: "Female, in her seventies, low and husky pitch with a dry, crackling timbre. She speaks slowly and evenly, with a blunt, unhurried manner."

Describe each voice at rest — its timbre and the way the speaker usually talks — not a passing mood such as shouting, weeping or whispering: each voice is recorded once, calmly, and all its lines are spoken from that recording. The narrator reads the whole book: a clear, steady reading voice whose timbre and manner suit the genre and the tone.

Go by what the text shows or plainly implies. Where it says nothing, choose what suits the speaker's age and place in the story.

Return only a JSON object mapping each listed speaker's id to ${ANSWER}. Use only the ids given. No prose, no preamble.`;

const CAST_USER = `Book: {{book}}

The speakers:
{{speakers}}

The book, each spoken line after its speaker's name in brackets:

{{manuscript}}

Return only the JSON object.`;

/** The template rows (seed_feature_prompts). Object answers → json_mode on, as Smart-assign's. */
export const BOOK_VOICES_PROMPTS = {
  [ACTIONS.speaker]: {
    feature: FEATURE,
    label: "One speaker (Local)",
    description:
      "The Local recipe: one call for each main speaker, with that speaker's lines and the narration around them. Answers a voice description — gender, age, pitch, pace and manner.",
    system: SPEAKER_SYSTEM,
    user_template: SPEAKER_USER,
    json_mode: true,
    position: 1,
  },
  [ACTIONS.narrator]: {
    feature: FEATURE,
    label: "Narrator (Local)",
    description: "The Local recipe's narrator: one call with the book's opening, its voice described from the book's genre and tone.",
    system: NARRATOR_SYSTEM,
    user_template: NARRATOR_USER,
    json_mode: true,
    position: 2,
  },
  [ACTIONS.cast]: {
    feature: FEATURE,
    label: "Whole cast (Frontier)",
    description:
      "The Frontier recipe: one call for every main speaker and the narrator, with the whole book in context. It runs when this card's model is Frontier.",
    system: CAST_SYSTEM,
    user_template: CAST_USER,
    json_mode: true,
    position: 3,
  },
};

/** Each row's engine preset (seed_presets) — Structured extraction, as Discover and Smart-assign. */
export const BOOK_VOICES_PRESETS = {
  [ACTIONS.speaker]: "p_extract",
  [ACTIONS.narrator]: "p_extract",
  [ACTIONS.cast]: "p_extract",
};

// The Lab's samples (seed_presets' SAMPLE LAW: synthesized, never real user data), in each row's
// own variables as book_voices/text.js writes them.
const SAMPLE_BOOK = "Salt and Lantern — by M. Ferris";

export const BOOK_VOICES_SAMPLES = [
  {
    actions: [ACTIONS.speaker],
    label: "The harbor-master's lines",
    variables: {
      book: SAMPLE_BOOK,
      speaker: '- id="s_harbek", name="Old Harbek", aliases="the harbor-master", description="Keeps the harbor light; seventies."',
      passages:
        "⟦“Boats out past the light again,”⟧ the harbor-master said, nailing the notice to the gate. " +
        "His voice was all gravel and tide, and he never hurried a word.\n\n" +
        "Mara read it twice. ⟦“And you'll say nothing,”⟧ she said. ⟦“Nothing worth coin,”⟧ he said.",
    },
  },
  {
    actions: [ACTIONS.narrator],
    label: "A harbor town's opening",
    variables: {
      book: SAMPLE_BOOK,
      opening:
        "The fog came in over the pier before either of them said a word. In Saltmouth the fog " +
        "was a kind of weather and a kind of manners: you waited for it, and you did not speak " +
        "of what it hid.\n\nMara had waited eleven years.",
    },
  },
  {
    actions: [ACTIONS.cast],
    label: "Two speakers and the narrator",
    variables: {
      book: SAMPLE_BOOK,
      speakers:
        '- id="s_mara", name="Mara", description="Archivist, mid-thirties, dry."\n' +
        '- id="s_harbek", name="Old Harbek", aliases="the harbor-master"\n' +
        '- id="s_narrator", name="Narrator", role="narrator"',
      manuscript:
        "## The Notice\n\nThe fog came in over the pier before either of them said a word.\n\n" +
        "[Old Harbek] “Boats out past the light again,” the harbor-master said, nailing the notice to the gate.\n\n" +
        "Mara read it twice. [Mara] “And you'll say nothing,” she said. [Old Harbek] “Nothing worth coin,” he said.",
    },
  },
];
