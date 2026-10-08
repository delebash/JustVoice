#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// The development build of audio.cpp that `npm run dev` runs (docs/dev/TASKS.md, "`npm run
// dev` always runs the latest audio.cpp"). Our fork's checkout sits beside this one at
// ../audio.cpp, the way the kit sits at ../just-llm-runner, and the dev app always runs its
// current source: this builds it into ../audio.cpp/build/jv-dev before the app starts,
// recompiling only what changed. A failed build stops `npm run dev` — starting on the
// previous binary would not be "the latest" (decided D1).
//
// The first run configures the folder: CUDA when this machine has an NVIDIA GPU and the CUDA
// 12.4 toolkit the release's cuda12 build uses, otherwise the CPU build (decided D2). The
// flags are the release workflow's own Windows CUDA job (fork plan §6). The CUDA runtime
// DLLs are copied beside the exe, as the release's cudart archive ships them; jieba and
// libmecab come from the fork's own build (cmake/text_dictionaries.cmake, decided D3).
//
//   node scripts/audiocpp-dev.js         build it alone and print the folder
//
// The server finds the build through JUSTVOICE_AUDIOCPP_BUILD (the bin folder) —
// server/src/engines/audiocpp/dev_build.js reads it; a packaged app ignores it.
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WIN = process.platform === "win32";
export const CHECKOUT = resolve(ROOT, "..", "audio.cpp");
export const BUILD = join(CHECKOUT, "build", "jv-dev");
export const BIN = join(BUILD, "bin");
export const ENV = "JUSTVOICE_AUDIOCPP_BUILD";
const EXE = join(BIN, WIN ? "audiocpp_server.exe" : "audiocpp_server");
const CUDA_VERSION = "12.4"; // the release's cuda12 build (release.yml windows-cuda matrix)
const MSVC_TOOLSET = "14.44"; // the VS 2022 toolset CI builds with; CUDA 12.4 needs it

class BuildError extends Error {}

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], ...opts }).trim();
}

/** The Visual Studio install with the C++ tools, and whether it has the toolset CUDA needs. */
function visualStudio() {
  const vswhere = join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
    "Microsoft Visual Studio", "Installer", "vswhere.exe");
  if (!existsSync(vswhere)) throw new BuildError("Visual Studio's C++ tools are not installed (no vswhere.exe).");
  const vs = sh(vswhere, ["-latest", "-products", "*", "-requires",
    "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"]);
  if (!vs) throw new BuildError("Visual Studio's C++ tools are not installed.");
  const tools = join(vs, "VC", "Tools", "MSVC");
  const toolset = existsSync(tools) && readdirSync(tools).some((d) => d.startsWith(`${MSVC_TOOLSET}.`));
  return { vcvars: join(vs, "VC", "Auxiliary", "Build", "vcvarsall.bat"), toolset, installer: dirname(vswhere) };
}

/** The CUDA 12.4 toolkit folder, or null. */
function cudaToolkit() {
  const dir = process.env.CUDA_PATH_V12_4
    || join(process.env.ProgramFiles || "C:\\Program Files", "NVIDIA GPU Computing Toolkit", "CUDA", `v${CUDA_VERSION}`);
  return existsSync(join(dir, "bin", WIN ? "nvcc.exe" : "nvcc")) ? dir : null;
}

/** This machine's GPU compute capability as CMake wants it ("75"), or null without one. */
function computeCapability() {
  try {
    const cap = sh("nvidia-smi", ["--query-gpu=compute_cap", "--format=csv,noheader"]).split(/\r?\n/)[0];
    return /^\d+\.\d+$/.test(cap) ? cap.replace(".", "") : null;
  } catch {
    return null;
  }
}

/** Run a build step; on Windows inside the Visual Studio environment (cl, cmake, ninja). */
function run(argv, { vs, cuda } = {}) {
  let r;
  if (WIN) {
    const quote = (a) => (/[\s"&^|<>()]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
    // cmd expands %PATH% once, when it reads the line — so PATH is set once, first (vcvarsall
    // runs vswhere from the installer folder; nvcc comes from CUDA's bin), and vcvarsall's own
    // additions land on top of it.
    const path = [vs.installer, ...(cuda ? [`${cuda}\\bin`] : []), "%PATH%"].join(";");
    const setup = [...(cuda ? [`set "CUDA_PATH=${cuda}"`] : []), `set "PATH=${path}"`];
    setup.push(`call "${vs.vcvars}" x64${vs.toolset ? ` -vcvars_ver=${MSVC_TOOLSET}` : ""} >nul`);
    const line = [...setup, argv.map(quote).join(" ")].join(" && ");
    r = spawnSync("cmd.exe", ["/d", "/s", "/c", `"${line}"`],
      { cwd: CHECKOUT, stdio: "inherit", windowsVerbatimArguments: true });
  } else {
    r = spawnSync(argv[0], argv.slice(1), { cwd: CHECKOUT, stdio: "inherit" });
  }
  if (r.status !== 0) throw new BuildError(`audio.cpp did not build (${argv.slice(0, 2).join(" ")} exited ${r.status}).`);
}

function configure(vs) {
  const common = ["-DCMAKE_BUILD_TYPE=Release", "-DENGINE_ENABLE_OPENMP=OFF", "-DGGML_OPENMP=OFF",
    "-DENGINE_ENABLE_VULKAN=OFF", "-DENGINE_ENABLE_LLAMAFILE=ON", "-DENGINE_ENABLE_NATIVE_CPU=ON",
    "-DENGINE_BUILD_TESTS=OFF", "-DENGINE_ENABLE_CPU_ALL_VARIANTS=OFF",
    "-DAUDIOCPP_BUILD_NATIVE_MODEL_MANAGER=ON"];
  if (!WIN) {
    // macOS gets Metal and Linux the CPU build from the defaults (not yet checked here).
    run(["cmake", "-S", ".", "-B", BUILD, "-DCMAKE_BUILD_TYPE=Release", "-DENGINE_BUILD_TESTS=OFF",
      "-DAUDIOCPP_BUILD_NATIVE_MODEL_MANAGER=ON"]);
    return null;
  }
  const cuda = cudaToolkit();
  const cap = cuda && vs.toolset ? computeCapability() : null;
  if (cap) {
    console.log(`[audio.cpp] setting up build/jv-dev: CUDA ${CUDA_VERSION}, compute ${cap} — the first build takes about 30 minutes`);
    run(["cmake", "-S", ".", "-B", BUILD, "-G", "Ninja", ...common, "-DENGINE_ENABLE_CUDA=ON",
      "-DENGINE_ENABLE_CUDA_GRAPHS=ON", "-DENGINE_ENABLE_METAL=OFF", `-DCMAKE_CUDA_ARCHITECTURES=${cap}`,
      `-DCUDAToolkit_ROOT=${cuda}`], { vs, cuda });
    return cuda;
  }
  console.log("[audio.cpp] setting up build/jv-dev: CPU (no NVIDIA GPU with the CUDA 12.4 toolkit and "
    + `MSVC ${MSVC_TOOLSET} here) — the first build takes a while`);
  run(["cmake", "-S", ".", "-B", BUILD, "-G", "Ninja", ...common, "-DENGINE_ENABLE_CUDA=OFF",
    "-DENGINE_ENABLE_CUDA_GRAPHS=OFF", "-DENGINE_ENABLE_METAL=OFF"], { vs });
  return null;
}

/** The CUDA toolkit a configured build uses, from its own CMake cache — null for a CPU build. */
function configuredCuda() {
  const cache = readFileSync(join(BUILD, "CMakeCache.txt"), "utf8");
  if (!/^ENGINE_ENABLE_CUDA:BOOL=ON$/m.test(cache)) return null;
  const m = cache.match(/^CUDAToolkit_ROOT:[A-Z]+=(.+)$/m);
  return m ? m[1].trim() : cudaToolkit();
}

/** cudart, cuBLAS and cuFFT beside the exe — the release's cudart archive (release.yml). */
function copyCudaRuntime(cuda) {
  const src = join(cuda, "bin");
  for (const name of readdirSync(src)) {
    if (!/^(cudart64|cublas64|cublasLt64|cufft64)_.*\.dll$/i.test(name)) continue;
    const from = join(src, name);
    const to = join(BIN, name);
    if (existsSync(to) && statSync(to).size === statSync(from).size) continue;
    copyFileSync(from, to);
  }
}

/** Stop a dev server a crashed session left behind — it holds the exe, so the build could not
 *  replace it. Only one whose JustVoice server is gone (the app's own leftover rule); one still
 *  served means the app is running (decided D5). */
function stopLeftovers() {
  const r = spawnSync(process.execPath, [join(ROOT, "scripts", "node24.js"),
    join(ROOT, "server", "src", "engines", "audiocpp", "dev_build.js"), "--stop-leftovers"],
    { cwd: ROOT, stdio: "inherit", env: { ...process.env, [ENV]: BIN } });
  if (r.status === 3) throw new BuildError("Close the running JustVoice first.");
  if (r.status !== 0) throw new BuildError("could not check for a running audio.cpp server.");
}

function describe() {
  const git = (...a) => sh("git", ["-C", CHECKOUT, ...a]);
  let commit = "";
  let dirty = false;
  try {
    commit = git("rev-parse", "--short=8", "HEAD");
    dirty = git("status", "--porcelain", "--untracked-files=no") !== "";
  } catch {}
  writeFileSync(join(BIN, "jv-dev-build.json"), `${JSON.stringify({
    commit, dirty, source: relative(ROOT, CHECKOUT), built: new Date().toISOString(),
  }, null, 1)}\n`);
}

/** Build ../audio.cpp; the bin folder, or null when there is no checkout. Throws BuildError. */
export function prepareAudioCppDevBuild() {
  if (!existsSync(join(CHECKOUT, "CMakeLists.txt"))) return null;
  const vs = WIN ? visualStudio() : null;
  if (existsSync(EXE)) stopLeftovers();
  const cuda = existsSync(join(BUILD, "CMakeCache.txt")) ? configuredCuda() : configure(vs);
  if (!cuda && WIN && cudaToolkit() && vs?.toolset) {
    // Configured once as a CPU build (no CUDA toolkit or MSVC toolset then) — it never
    // reconfigures, so every model would run on the CPU (audit 2026-10-04 §5 E7).
    console.warn(`[audio.cpp] build/jv-dev is a CPU build, but CUDA ${CUDA_VERSION} is installed now — `
      + `delete ${BUILD} to rebuild it for the graphics card (about 30 minutes).`);
  }
  const t0 = Date.now();
  // The speech runtime, and the DSP program the server sends its audio math to (2026-10-07).
  run(["cmake", "--build", BUILD, "--target", "audiocpp_server", "audiocpp_dsp"], { vs, cuda });
  if (cuda && WIN) copyCudaRuntime(cuda);
  describe();
  console.log(`[audio.cpp] dev build ready in ${Math.round((Date.now() - t0) / 1000)} s: ${BIN}`);
  return BIN;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const bin = prepareAudioCppDevBuild();
    if (!bin) console.log(`[audio.cpp] no checkout at ${CHECKOUT}`);
  } catch (e) {
    console.error(`[audio.cpp] ${e.message}`);
    process.exit(1);
  }
}
