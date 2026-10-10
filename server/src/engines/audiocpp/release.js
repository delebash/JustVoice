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
import { BinaryAsset } from "@delebash/llm-runner/runner/schema";
import { model } from "@delebash/llm-runner/platform/models";
import * as devBuild from "./dev_build.js";
import * as self from "./release.js";

export const cfg = {
  // Our build 5 on audio.cpp v0.9.0 (github.com/delebash/audio.cpp, published 2026-10-10 by
  // the fork's release workflow, from 55b150f4): jv.4 plus `audiocpp_dsp`, the audio program
  // the server runs (effects, speed, gain, pitch, joins, trim, the analyzer — our `dsp/`), in
  // every build — the installer carries the CPU build's copy beside the app
  // (scripts/audiocpp-dsp-package.js). jv.4 (2026-10-04) brought Kokoro blends and inline IPA,
  // Chatterbox Turbo / Nano cloning, Chatterbox in Hebrew, Russian, Chinese and Japanese,
  // Kokoro's Japanese voices, models registered at run time (`model_management`), Qwen3's memory
  // fixes and libmecab beside the executable. jv.2 and jv.3 were tagged on commits whose macOS
  // build failed and were never published; their names are not reused (decided 2026-10-04).
  // Upstream's v0.9.0 was released 2026-09-30 (795c45fb).
  TAG: "v0.9.0-jv.5",
  // Older pinned releases an install may still hold, newest first. One of them keeps working
  // until the runtime row's "Update to <TAG>" installs the pinned build (decided 2026-10-03).
  PREVIOUS_TAGS: ["v0.9.0-jv.4", "v0.9.0-jv.1", "v0.9.0"],
};

const dl = () => `https://github.com/delebash/audio.cpp/releases/download/${cfg.TAG}`;

// Every build the app has pinned or will, oldest first — upstream's, then ours. A feature
// names the first build that has it, so an older installed build refuses that feature by
// name instead of failing inside.
export const BUILDS_IN_ORDER = ["v0.9.0", "v0.9.0-jv.1", "v0.9.0-jv.4", "v0.9.0-jv.5"];
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

// The model files: audio.cpp's own GGUF packages. Commit pinned 2026-10-01.
export const MODEL_REPO = "audio-cpp/audio.cpp-gguf";
export const MODEL_REVISION = "7bf52723f5a95b6cec53ea905fd10eca1c8b942e";

export const SERVER_EXE = process.platform === "win32" ? "audiocpp_server.exe" : "audiocpp_server";

// The pinned release's archives, by their published sha256 (GitHub's asset digests for
// v0.9.0-jv.5, read 2026-10-10 from the published release). The kit refuses a download that
// doesn't match, before anything is unpacked (audit §5 E6). A new TAG brings its own; an
// archive missing here is launch-verified only.
export const SHA256 = {
  "audio-v0.9.0-jv.5-bin-windows-x64-cuda12.4.zip": "268b9d5aaafc21014d0fd98ffc3013883333fcf861c48644e34072bfcb690093",
  "audio-v0.9.0-jv.5-cudart-windows-x64-cuda12.4.zip": "ab356389477e11e48d74920d609e6599d3e3a61d44e515e8d332ac930b8342c3",
  "audio-v0.9.0-jv.5-bin-windows-x64-cuda13.3.zip": "2c23d8178d3386c20e9b8069538bc5953e88e60bd612adb849d02cc7690368e5",
  "audio-v0.9.0-jv.5-cudart-windows-x64-cuda13.3.zip": "6f6746b99d7943d8fd6c654c05944c1abaa56e3603f0551c579c187c4b3db5df",
  "audio-v0.9.0-jv.5-bin-windows-x64-vulkan.zip": "1a296190c7bb61307b5f43962bd717806c5863efa2bd2a2144cfc8d869c46261",
  "audio-v0.9.0-jv.5-bin-windows-x64-cpu-portable.zip": "5f816b4301d6e4c58c5f6175a0215829aeea59f49fe521cf78f33d0793540842",
  "audio-v0.9.0-jv.5-bin-ubuntu-x64-vulkan.tar.gz": "916ab78bf7717b9fd890c2e18a992fc82c0cd2c25210e5e018c537cf06fda017",
  "audio-v0.9.0-jv.5-bin-ubuntu-x64-cpu-portable.tar.gz": "a66718ecbf0b8ff8bb8547feeeadd7d706fd2aa0cad8d9d45b98467588ab68f1",
  "audio-v0.9.0-jv.5-bin-macos-arm64-metal.tar.gz": "9c9f2296e4b2ee02a9959fe19eb7d78c06906e5d083a51bd9a63ba69364bd023",
  "audio-v0.9.0-jv.5-bin-macos-x64-metal.tar.gz": "8d8a02efd820f6e8e851b6d1b15568c780528fd4db72821ae738548f12b45b2c",
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

/** A manifest variant's `sources` row for one GGUF file in the pinned model repo — the shape
 * `speech_cache.fetchHfVariant` downloads. `repo` / `revision` name another pinned repo for a
 * model audio.cpp does not publish (our own conversions). */
export function modelSource(filePath, sizeBytes, { repo = MODEL_REPO, revision = MODEL_REVISION } = {}) {
  return { hf_repo: repo, revision, size_bytes: sizeBytes, files: [filePath] };
}

/**
 * The 16-bit sibling of an 8-bit variant row (switch plan §5, gap 9): same model, same
 * capabilities, the original precision. Its id swaps the `-q8` tail for `-<dtype>`, its name
 * says "16-bit", its description says so, and it has no reference CPU speed of its own (the
 * 8-bit row's would be wrong — a render measures this one). `source` replaces the default
 * one-file source (a multi-file source, another repo); `companions` replaces the companion
 * files (speech recognition's aligner). Key order is Python's dict-update order.
 */
export function sixteenBit(r, filePath, sizeBytes, { dtype = "bf16", source = null, companions = null } = {}) {
  let name = r.name;
  name = name.endsWith(")") ? `${name.slice(0, -1)}, 16-bit)` : `${name} (16-bit)`;
  const desc = r.description.replaceAll(" 8-bit weights.", "").replace(/\s+$/u, "");
  const { cpu_realtime: _drop, ...rest } = r;
  const id = r.id.endsWith("-q8") ? r.id.slice(0, -3) : r.id;
  const out = {
    ...rest,
    id: `${id}-${dtype}`,
    name,
    description: `${desc} 16-bit weights — a larger download that needs more memory.`,
    sources: [source || self.modelSource(filePath, sizeBytes)],
    audiocpp: { ...r.audiocpp, file: filePath },
  };
  if (companions !== null) out.audiocpp.companions = companions;
  return out;
}
