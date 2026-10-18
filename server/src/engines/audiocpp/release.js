// SPDX-License-Identifier: MIT
// The audio.cpp release JustVoice runs, and the model repo it downloads from (the port of
// justvoice/engines/audiocpp/release.py).
//
// Both pinned: a binary or a model file is a fact about a COMMIT, not a branch. A bump is a
// deliberate change here, re-checked against the release's own asset list and the model
// repo's tree (sizes below are the bytes that commit serves).
//
// audio.cpp is Apache-2.0 (LICENSE ships inside every archive). The app runs our own copy's
// releases (github.com/delebash/audio.cpp, branch `jv`, tags `v0.9.0-jv.N`) since 2026-10-03;
// `npm run dev` runs that checkout's own build instead (`dev_build.js`).
//
// The pin is `cfg.TAG` / `cfg.PREVIOUS_TAGS` (a test assigns them — Python monkeypatched the
// module globals): read them from `cfg`, never copy them out.

import os from "node:os";
import { BinaryAsset } from "@delebash/core/runner/schema";
import { model } from "@delebash/core/platform/models";
import * as devBuild from "./dev_build.js";

export const cfg = {
  // Our build 6 on audio.cpp v0.9.2 (github.com/delebash/audio.cpp, tagged 2026-10-16 at
  // bcc5dfbb, published the same day by the fork's release workflow): upstream's v0.9.2 — its new
  // model families (Kitten TTS 2 among them), renamed settings, Silero VAD in the runtime — with
  // our fork's on top (the DSP program, voice packs, Turbo cloning …) and the day's fixes: F5 frees
  // its memory on Unload, and F5 and KittenTTS give the same take for the same seed.
  TAG: "v0.9.2-jv.6",
  // Older pinned releases an install may still hold, newest first. One of them keeps working
  // until the runtime row's "Update to <TAG>" installs the pinned build (decided 2026-10-03).
  PREVIOUS_TAGS: ["v0.9.0-jv.5", "v0.9.0-jv.4", "v0.9.0-jv.1", "v0.9.0"],
  // (jv.5, the pin from 2026-10-10 to 2026-10-16: our build 5 on audio.cpp v0.9.0
  // (github.com/delebash/audio.cpp, published 2026-10-10 by the fork's release workflow, from
  // 55b150f4): jv.4 plus `audiocpp_dsp`, the audio program
  // the server runs (effects, speed, gain, pitch, joins, trim, the analyzer — our `dsp/`), in
  // every build — the installer carries the CPU build's copy beside the app
  // (scripts/audiocpp-dsp-package.js). jv.4 (2026-10-04) brought Kokoro blends and inline IPA,
  // Chatterbox Turbo / Nano cloning, Chatterbox in Hebrew, Russian, Chinese and Japanese,
  // Kokoro's Japanese voices, models registered at run time (`model_management`), Qwen3's memory
  // fixes and libmecab beside the executable. jv.2 and jv.3 were tagged on commits whose macOS
  // build failed and were never published; their names are not reused (decided 2026-10-04).
  // Upstream's v0.9.0 was released 2026-09-30 (795c45fb).
  // — until 2026-10-16.)
};

const dl = () => `https://github.com/delebash/audio.cpp/releases/download/${cfg.TAG}`;

// Every build the app has pinned or will, oldest first — upstream's, then ours. A feature
// names the first build that has it, so an older installed build refuses that feature by
// name instead of failing inside.
export const BUILDS_IN_ORDER = ["v0.9.0", "v0.9.0-jv.1", "v0.9.0-jv.4", "v0.9.0-jv.5", "v0.9.2-jv.6"];
export const FEATURES = {
  voxcpm2_transcript: "v0.9.0-jv.1", // a VoxCPM2 clone uses the clip's transcript
  voice_pack: "v0.9.0-jv.4", // Kokoro blends (gap 2)
  inline_ipa: "v0.9.0-jv.4", // Kokoro "[word](/phonemes/)" — a lexicon's IPA (gap 3)
  turbo_clone: "v0.9.0-jv.4", // Chatterbox Turbo / Nano clone a voice (gap 1)
  chatterbox_he_ru_zh: "v0.9.0-jv.4", // Chatterbox in Hebrew, Russian, Chinese (gap 7)
  japanese: "v0.9.0-jv.4", // Kokoro's Japanese voices, Chatterbox Japanese (gap 7)
  // Models registered at run time without the WebUI's other endpoints — nothing downloaded or
  // deleted restarts a process (audit 2026-10-04 §13.2). Older builds list their models.
  model_management: "v0.9.0-jv.4",
};

/** Whether the PINNED build has `feature` — what the app offers. The installed build may
 * still be older; `runtime.hasFeature` answers for it. Under `npm run dev` the app runs our
 * checkout's own build (`dev_build.js`), the fork's latest, which has every feature. */
export function pinnedHas(feature) {
  if (devBuild.current() !== null) return Object.hasOwn(FEATURES, feature);
  const first = Object.hasOwn(FEATURES, feature) ? FEATURES[feature] : undefined;
  if (!BUILDS_IN_ORDER.includes(first) || !BUILDS_IN_ORDER.includes(cfg.TAG)) return false;
  return BUILDS_IN_ORDER.indexOf(cfg.TAG) >= BUILDS_IN_ORDER.indexOf(first);
}

// The model files: audio.cpp's own GGUF packages. Commit pinned 2026-10-15: the repo's newest
// (2026-10-11, "Add Voxtral 4B TTS"), the first to hold every package audio.cpp v0.9.2's specs
// name (Pocket French, Voxtral TTS, Breeze Q4_0 …). From the commit pinned before (7bf52723,
// 2026-10-01) no file changed but README.md and .gitattributes; 81 were added.
export const MODEL_REPO = "audio-cpp/audio.cpp-gguf";
export const MODEL_REVISION = "f861648c0c1f4da9f18e9a0ce5e217b0679bb2f5";

export const SERVER_EXE = process.platform === "win32" ? "audiocpp_server.exe" : "audiocpp_server";

// The pinned release's archives, by their published sha256 (GitHub's asset digests for
// v0.9.2-jv.6, read 2026-10-16 from the published release). The kit refuses a download that
// doesn't match, before anything is unpacked (audit §5 E6). A new TAG brings its own; an
// archive missing here is launch-verified only.
export const SHA256 = {
  "audio-v0.9.2-jv.6-bin-windows-x64-cuda12.4.zip": "e7061704063e2b583714670ddd4479126c23040a1bfed1ac4720d397e0d7a94a",
  "audio-v0.9.2-jv.6-cudart-windows-x64-cuda12.4.zip": "5172d93ab24a378ea9b4877c5a0055836c81d3bf031d46d0e2722d1a1ad313cc",
  "audio-v0.9.2-jv.6-bin-windows-x64-cuda13.3.zip": "caeff2e01879ad619f1275ac3848ed1a527902e4929e502c2bec5e08780f8c9b",
  "audio-v0.9.2-jv.6-cudart-windows-x64-cuda13.3.zip": "8aa9b806a800ab2491ace9aea0910201206e592d17ab7ed445474a6c2e7ab955",
  "audio-v0.9.2-jv.6-bin-windows-x64-vulkan.zip": "04ef95c99dc33c02feb4516c6d03b4c45fdf658675dfc53881ba646c27a76660",
  "audio-v0.9.2-jv.6-bin-windows-x64-cpu-portable.zip": "94847349a42ad052250b29c7cd8b5ede4918c1092207671d47235112d9bd856e",
  "audio-v0.9.2-jv.6-bin-ubuntu-x64-vulkan.tar.gz": "9979081d11214c84ba4302351c7413db45d453f0bb8dc76734c1a0261b3eed93",
  "audio-v0.9.2-jv.6-bin-ubuntu-x64-cpu-portable.tar.gz": "80d7c998cc7911c2e988da44cb16110f505d6b6e5d5f93968f3756ab27cd9ced",
  "audio-v0.9.2-jv.6-bin-macos-arm64-metal.tar.gz": "b97e66f85ecfce7aa597fcbabced9eeba4907e049f520da46826d71d3b94c1ef",
  "audio-v0.9.2-jv.6-bin-macos-x64-metal.tar.gz": "edfda2bce4a719f2307466daf3e25760f5c61f159bbdc3f0cec8246d84f955f5",
};

const sha = (name) => (Object.hasOwn(SHA256, name) ? SHA256[name] : null);

function row(platform, gpu, archive, runtime = null) {
  return model(BinaryAsset, {
    platform,
    gpu,
    serverExe: SERVER_EXE,
    assetUrl: `${dl()}/${archive}`,
    runtimeUrl: runtime ? `${dl()}/${runtime}` : null,
    sha256: sha(archive),
    runtimeSha256: runtime ? sha(runtime) : null,
  });
}

/**
 * Every build of the pinned release, as the kit's acquisition rows (BinaryAsset, camelCase).
 *
 * Windows CUDA builds ship their CUDA runtime DLLs separately (the cudart archive is unpacked
 * beside the exe). CUDA 13.3 is the Blackwell build (the kit's chip rule picks it for compute
 * capability ≥ 10). Linux has no general CUDA archive — NVIDIA boxes run the Vulkan build, as
 * llama.cpp does. macOS ships one Metal build per CPU arch. The CPU builds are the PORTABLE
 * ones: the plain build assumes this CPU's newest instructions and exits at start on an older
 * one (audio.cpp issue #352; audit §5 E7).
 */
export function binaries() {
  const tag = cfg.TAG;
  const macArch = ["arm64", "aarch64"].includes(os.arch().toLowerCase()) ? "arm64" : "x64";
  return [
    row("windows", "cuda12", `audio-${tag}-bin-windows-x64-cuda12.4.zip`, `audio-${tag}-cudart-windows-x64-cuda12.4.zip`),
    row("windows", "cuda13", `audio-${tag}-bin-windows-x64-cuda13.3.zip`, `audio-${tag}-cudart-windows-x64-cuda13.3.zip`),
    row("windows", "vulkan", `audio-${tag}-bin-windows-x64-vulkan.zip`),
    row("windows", "cpu", `audio-${tag}-bin-windows-x64-cpu-portable.zip`),
    row("linux", "vulkan", `audio-${tag}-bin-ubuntu-x64-vulkan.tar.gz`),
    row("linux", "cpu", `audio-${tag}-bin-ubuntu-x64-cpu-portable.tar.gz`),
    row("macos", "metal", `audio-${tag}-bin-macos-${macArch}-metal.tar.gz`),
  ];
}
