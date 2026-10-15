// SPDX-License-Identifier: MIT
// JustVoice's own file per audio.cpp family (docs/plans/2026-10-11-audiocpp-engine-catalog.md
// §1, §4, §7): every speech engine's licence in plain words (TASKS "Every speech engine's licence
// in plain words"), and where we know it, how a line's direction reaches the model, what we found
// by testing, what it is best for. A family without DIRECTION is offered, marked "can't be
// directed yet"; without TESTED, "Not tested by JustVoice yet". Adding a family is one file here
// and one line below.

import * as audio8_tts from "./audio8_tts.js";
import * as auk from "./auk.js";
import * as breeze_tts from "./breeze_tts.js";
import * as chatterbox from "./chatterbox.js";
import * as confucius4_tts from "./confucius4_tts.js";
import * as cosyvoice3 from "./cosyvoice3.js";
import * as dots_tts from "./dots_tts.js";
import * as dramabox from "./dramabox.js";
import * as echo_tts from "./echo_tts.js";
import * as f5_tts from "./f5_tts.js";
import * as firered_audio from "./firered_audio.js";
import * as fireredtts3 from "./fireredtts3.js";
import * as fish_audio from "./fish_audio.js";
import * as glm_tts from "./glm_tts.js";
import * as higgs_audio_tts from "./higgs_audio_tts.js";
import * as index_tts2 from "./index_tts2.js";
import * as irodori_tts from "./irodori_tts.js";
import * as kitten_tts from "./kitten_tts.js";
import * as kitten_tts2 from "./kitten_tts2.js";
import * as kokoro_tts from "./kokoro_tts.js";
import * as kugelaudio from "./kugelaudio.js";
import * as lfm2_audio from "./lfm2_audio.js";
import * as miotts from "./miotts.js";
import * as moss_tts_local from "./moss_tts_local.js";
import * as moss_tts_nano from "./moss_tts_nano.js";
import * as moss_tts_v15 from "./moss_tts_v15.js";
import * as moss_ttsd from "./moss_ttsd.js";
import * as omnivoice from "./omnivoice.js";
import * as outetts from "./outetts.js";
import * as pocket_tts from "./pocket_tts.js";
import * as qwen3_asr from "./qwen3_asr.js";
import * as qwen3_tts from "./qwen3_tts.js";
import * as sopro_tts from "./sopro_tts.js";
import * as vieneu_v3_turbo from "./vieneu_v3_turbo.js";
import * as voxcpm1 from "./voxcpm1.js";
import * as voxcpm2 from "./voxcpm2.js";
import * as zipvoice from "./zipvoice.js";

export const CURATED = {
  audio8_tts,
  auk,
  breeze_tts,
  chatterbox,
  confucius4_tts,
  cosyvoice3,
  dots_tts,
  dramabox,
  echo_tts,
  f5_tts,
  firered_audio,
  fireredtts3,
  fish_audio,
  glm_tts,
  higgs_audio_tts,
  index_tts2,
  irodori_tts,
  kitten_tts,
  kitten_tts2,
  kokoro_tts,
  kugelaudio,
  lfm2_audio,
  miotts,
  moss_tts_local,
  moss_tts_nano,
  moss_tts_v15,
  moss_ttsd,
  omnivoice,
  outetts,
  pocket_tts,
  qwen3_asr,
  qwen3_tts,
  sopro_tts,
  vieneu_v3_turbo,
  voxcpm1,
  voxcpm2,
  zipvoice,
};
