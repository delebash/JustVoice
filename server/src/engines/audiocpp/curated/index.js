// SPDX-License-Identifier: MIT
// JustVoice's own file per audio.cpp family (docs/plans/2026-10-11-audiocpp-engine-catalog.md
// §1, §4, §7): every speech engine's licence in plain words (TASKS "Every speech engine's licence
// in plain words"), and where we know it, how a line's direction reaches the model, what we found
// by testing, what it is best for. A family without DIRECTION is offered, marked "can't be
// directed yet"; without TESTED, "Not tested by JustVoice yet". A family whose file has an ENGINE
// runs in an engine of ours, with our ids, names and request (generated.js `ownEngine`): Kokoro,
// KittenTTS, Pocket TTS, Qwen3-TTS, Chatterbox (with Turbo and Nano), VoxCPM2, Qwen3-ASR. Adding a
// family is one file here and one line below.

import * as audio8_tts from "./audio8_tts.js";
import * as auk from "./auk.js";
import * as breeze_tts from "./breeze_tts.js";
import * as canary_asr from "./canary_asr.js";
import * as chatterbox from "./chatterbox.js";
import * as chatterbox_turbo from "./chatterbox_turbo.js";
import * as citrinet_asr from "./citrinet_asr.js";
import * as cohere_asr from "./cohere_asr.js";
import * as confucius4_r2t2 from "./confucius4_r2t2.js";
import * as confucius4_tts from "./confucius4_tts.js";
import * as cosyvoice3 from "./cosyvoice3.js";
import * as crisperwhisper from "./crisperwhisper.js";
import * as dots_tts from "./dots_tts.js";
import * as dramabox from "./dramabox.js";
import * as echo_tts from "./echo_tts.js";
import * as f5_tts from "./f5_tts.js";
import * as firered_audio from "./firered_audio.js";
import * as fireredtts3 from "./fireredtts3.js";
import * as fish_audio from "./fish_audio.js";
import * as fish_drama3 from "./fish_drama3.js";
import * as gigaam_asr from "./gigaam_asr.js";
import * as glm_tts from "./glm_tts.js";
import * as gradium_phonon from "./gradium_phonon.js";
import * as granite5asr from "./granite5asr.js";
import * as higgs_audio_stt from "./higgs_audio_stt.js";
import * as higgs_audio_tts from "./higgs_audio_tts.js";
import * as hviske_asr from "./hviske_asr.js";
import * as hviske_asr_v6 from "./hviske_asr_v6.js";
import * as index_echo from "./index_echo.js";
import * as index_tts2 from "./index_tts2.js";
import * as inflect_v2 from "./inflect_v2.js";
import * as irodori_tts from "./irodori_tts.js";
import * as kitten_tts from "./kitten_tts.js";
import * as kitten_tts2 from "./kitten_tts2.js";
import * as kokoro_tts from "./kokoro_tts.js";
import * as kroko_asr from "./kroko_asr.js";
import * as kugelaudio from "./kugelaudio.js";
import * as lfm2_audio from "./lfm2_audio.js";
import * as lfm3_audio from "./lfm3_audio.js";
import * as magpie_tts from "./magpie_tts.js";
import * as maya1 from "./maya1.js";
import * as ming3_audio from "./ming3_audio.js";
import * as ming3_tts from "./ming3_tts.js";
import * as miotts from "./miotts.js";
import * as moonshine_asr from "./moonshine_asr.js";
import * as moss_transcribe_diarize from "./moss_transcribe_diarize.js";
import * as moss_tts_local from "./moss_tts_local.js";
import * as moss_tts_nano from "./moss_tts_nano.js";
import * as moss_tts_v15 from "./moss_tts_v15.js";
import * as moss_ttsd from "./moss_ttsd.js";
import * as moss_voicegen from "./moss_voicegen.js";
import * as nemotron_asr from "./nemotron_asr.js";
import * as neutts from "./neutts.js";
import * as niagara_asr from "./niagara_asr.js";
import * as omnivoice from "./omnivoice.js";
import * as outetts from "./outetts.js";
import * as owsm from "./owsm.js";
import * as owsm_ctc from "./owsm_ctc.js";
import * as parakeet_tdt from "./parakeet_tdt.js";
import * as piper_tts from "./piper_tts.js";
import * as plapre from "./plapre.js";
import * as pocket_tts from "./pocket_tts.js";
import * as qwen3_asr from "./qwen3_asr.js";
import * as qwen3_tts from "./qwen3_tts.js";
import * as sanotts from "./sanotts.js";
import * as sense_asr from "./sense_asr.js";
import * as soprano_tts from "./soprano_tts.js";
import * as sopro_tts from "./sopro_tts.js";
import * as supertonic from "./supertonic.js";
import * as vibevoice from "./vibevoice.js";
import * as vibevoice_asr from "./vibevoice_asr.js";
import * as vibevoice_asr_streaming from "./vibevoice_asr_streaming.js";
import * as vieneu_v3_turbo from "./vieneu_v3_turbo.js";
import * as voxcpm1 from "./voxcpm1.js";
import * as voxcpm2 from "./voxcpm2.js";
import * as voxtral_realtime from "./voxtral_realtime.js";
import * as voxtral_tts from "./voxtral_tts.js";
import * as whistle_asr from "./whistle_asr.js";
import * as xtts_v2 from "./xtts_v2.js";
import * as zipvoice from "./zipvoice.js";

export const CURATED = {
  audio8_tts,
  auk,
  breeze_tts,
  canary_asr,
  chatterbox,
  chatterbox_turbo,
  citrinet_asr,
  cohere_asr,
  confucius4_r2t2,
  confucius4_tts,
  cosyvoice3,
  crisperwhisper,
  dots_tts,
  dramabox,
  echo_tts,
  f5_tts,
  firered_audio,
  fireredtts3,
  fish_audio,
  fish_drama3,
  gigaam_asr,
  glm_tts,
  gradium_phonon,
  granite5asr,
  higgs_audio_stt,
  higgs_audio_tts,
  hviske_asr,
  hviske_asr_v6,
  index_echo,
  index_tts2,
  inflect_v2,
  irodori_tts,
  kitten_tts,
  kitten_tts2,
  kokoro_tts,
  kroko_asr,
  kugelaudio,
  lfm2_audio,
  lfm3_audio,
  magpie_tts,
  maya1,
  ming3_audio,
  ming3_tts,
  miotts,
  moonshine_asr,
  moss_transcribe_diarize,
  moss_tts_local,
  moss_tts_nano,
  moss_tts_v15,
  moss_ttsd,
  moss_voicegen,
  nemotron_asr,
  neutts,
  niagara_asr,
  omnivoice,
  outetts,
  owsm,
  owsm_ctc,
  parakeet_tdt,
  piper_tts,
  plapre,
  pocket_tts,
  qwen3_asr,
  qwen3_tts,
  sanotts,
  sense_asr,
  soprano_tts,
  sopro_tts,
  supertonic,
  vibevoice,
  vibevoice_asr,
  vibevoice_asr_streaming,
  vieneu_v3_turbo,
  voxcpm1,
  voxcpm2,
  voxtral_realtime,
  voxtral_tts,
  whistle_asr,
  xtts_v2,
  zipvoice,
};
