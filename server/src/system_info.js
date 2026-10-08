// SPDX-License-Identifier: MIT
// Cross-platform system detection — CPU / RAM / GPU + runtime availability (the port of
// justvoice/system_info.py).
//
// Hardware primitives (GPU name/VRAM/driver, RAM, CPU cores) come from the shared runner's
// single hardware authority — the kit's `runner/hardware.detect()` — so JustVoice and the LLM
// runner never run two divergent `nvidia-smi` probes. This module adds only the
// JustVoice-specific extras: the full OS string, CPU name, ffmpeg availability, and the
// runtime matrix. Every program it starts goes through the kit's procs door (no console).

import { readFileSync } from "node:fs";
import os from "node:os";
import * as hardware from "@delebash/llm-runner/runner/hardware";
import * as procs from "@delebash/llm-runner/platform/procs";
import { construct, SystemInfo } from "./models.js";
import * as self from "./system_info.js";

/** The runner's HardwareInfo (`detect()` of the kit) — the seam a test replaces. */
export const _detectHardware = () => hardware.detect();

/** `platform.system()`: "Windows" | "Linux" | "Darwin". */
export function platformSystem() {
  const t = os.type();
  return t === "Windows_NT" ? "Windows" : t;
}

// Python's platform.release() on Windows names the release, not the kernel version: Windows
// 11 reports "11" from build 22000 on (measured on this box: "11" for 10.0.26300).
const WIN_RELEASES = { "10.0": "10", "6.3": "8.1", "6.2": "8", "6.1": "7", "6.0": "Vista", "5.2": "2003Server", "5.1": "XP" };

/** `platform.release()`. */
export function platformRelease() {
  const rel = os.release();
  if (process.platform !== "win32") return rel;
  const [maj, min, build] = rel.split(".").map(Number);
  const name = WIN_RELEASES[`${maj}.${min}`];
  if (name === "10" && build >= 22000) return "11";
  return name ?? `${maj}`;
}

/** `platform.processor()` — on Windows the processor identifier ("AMD64 Family 25 …, AuthenticAMD"). */
function platformProcessor() {
  if (process.platform === "win32") return process.env.PROCESSOR_IDENTIFIER || "";
  if (process.platform === "darwin") return os.arch() === "arm64" ? "arm" : "i386";
  return "";
}

export async function detect() {
  // Hardware primitives from the shared single authority (no second probe).
  const hw = await self._detectHardware();
  return construct(SystemInfo, {
    os: `${platformSystem()} ${platformRelease()}`,
    cpu_name: await _cpuName(),
    cpu_cores: hw.cpuCores,
    ram_total_mb: hw.ramMb,
    gpus: (hw.gpus || []).map((g) => ({ vendor: g.vendor, name: g.name, vram_mb: g.vramMb ?? null, driver: g.driver ?? null })),
    runtimes: _detectRuntimes(hw.runtimes),
    ffmpeg: await _detectFfmpeg(),
  });
}

/** Best-effort across platforms. */
export async function _cpuName() {
  if (process.platform === "win32") {
    try {
      const out = await procs.checkOutput(["wmic", "cpu", "get", "name"], { timeout: 5 });
      const lines = out
        .split(/\r\n|\r|\n/)
        .map((ln) => ln.trim())
        .filter((ln) => ln && !ln.includes("Name"));
      if (lines.length) return lines[0];
    } catch {
      /* wmic is gone on current Windows 11 builds */
    }
    return platformProcessor() || "unknown";
  }
  if (process.platform === "darwin") {
    try {
      return (await procs.checkOutput(["sysctl", "-n", "machdep.cpu.brand_string"], { timeout: 5 })).trim();
    } catch {
      return platformProcessor() || "unknown";
    }
  }
  // Linux: /proc/cpuinfo
  try {
    for (const line of readFileSync("/proc/cpuinfo", "utf8").split("\n")) {
      if (line.startsWith("model name")) return line.split(":").slice(1).join(":").trim();
    }
  } catch {
    /* not there */
  }
  return platformProcessor() || "unknown";
}

/**
 * The compute runtimes this machine has — the kit's detection (`cuda`, `vulkan`, `rocm`,
 * `metal`) plus `cpu`. (The torch, DirectML, Core ML and MLX probes went with the Python
 * engines: "directml" showed as the backend on every AMD and Intel Windows machine — audit
 * 2026-10-04 §5 F.)
 */
export function _detectRuntimes(base = null) {
  return { cpu: true, ...(base || {}) };
}

export async function _detectFfmpeg() {
  const bin = hardware.which("ffmpeg");
  if (!bin) return null;
  try {
    const out = await procs.checkOutput([bin, "-version"], { timeout: 5 });
    const firstLine = out ? (out.split(/\r\n|\r|\n/)[0] ?? "") : "";
    return { bundled: false, path: bin, version: firstLine };
  } catch {
    return { bundled: false, path: bin, version: "unknown" };
  }
}
