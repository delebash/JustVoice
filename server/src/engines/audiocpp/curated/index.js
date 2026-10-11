// SPDX-License-Identifier: MIT
// JustVoice's own file per audio.cpp family (docs/plans/2026-10-11-audiocpp-engine-catalog.md
// §1, §4, §7): how a line's direction reaches the model, what we found by testing, what it is best
// for. A family without one is offered, marked "can't be directed yet" and "Not tested by
// JustVoice yet". Adding a family is one file here and one line below.

import * as breeze_tts from "./breeze_tts.js";
import * as cosyvoice3 from "./cosyvoice3.js";
import * as fish_audio from "./fish_audio.js";
import * as higgs_audio_tts from "./higgs_audio_tts.js";
import * as index_tts2 from "./index_tts2.js";

export const CURATED = { breeze_tts, cosyvoice3, fish_audio, higgs_audio_tts, index_tts2 };
