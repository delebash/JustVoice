// SPDX-License-Identifier: MIT
// system_info.detect() delegates hardware primitives to the shared runner (the port of
// tests/test_system_info.py) — guards the single-hardware-authority contract: GPU/VRAM/RAM/
// cores come from the kit's runner/hardware.detect(), not a second in-tree probe.
import { expect, test, vi } from "vitest";
import * as systemInfo from "../src/system_info.js";

test("detect_maps_runner_hardware", async () => {
  const fake = {
    os: "Linux",
    platform: "linux",
    cpuCores: 8,
    ramMb: 32000,
    gpus: [{ vendor: "NVIDIA", name: "RTX 4090", vramMb: 24564, driver: "555.1", computeCap: null }],
    runtimes: { cuda: true },
  };
  vi.spyOn(systemInfo, "_detectHardware").mockResolvedValue(fake);

  const info = await systemInfo.detect();

  // Hardware primitives come straight from the runner (single authority).
  expect(info.cpu_cores).toBe(8);
  expect(info.ram_total_mb).toBe(32000);
  expect(info.gpus.length).toBe(1);
  const gpu = info.gpus[0];
  expect([gpu.vendor, gpu.name, gpu.vram_mb, gpu.driver]).toEqual(["NVIDIA", "RTX 4090", 24564, "555.1"]);
  // JustVoice-specific extras are still populated locally.
  expect(info.os).toBeTruthy();
  expect(info.runtimes.cpu).toBe(true);
  expect("cuda" in info.runtimes).toBe(true);
});

test("detect_handles_no_gpu", async () => {
  vi.spyOn(systemInfo, "_detectHardware").mockResolvedValue({
    os: "Linux",
    platform: "linux",
    cpuCores: 4,
    ramMb: 16000,
    gpus: [],
    runtimes: {},
  });

  const info = await systemInfo.detect();

  expect(info.gpus).toEqual([]);
  expect(info.ram_total_mb).toBe(16000);
  expect(info.cpu_cores).toBe(4);
});
