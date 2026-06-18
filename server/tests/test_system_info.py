"""system_info.detect() delegates hardware primitives to the shared runner.

Guards the single-hardware-authority contract: GPU/VRAM/RAM/cores must come
from `llm_runner.hardware.detect()`, not a second in-tree nvidia-smi probe.
"""

from llm_runner.schema import GpuInfo as RunnerGpuInfo
from llm_runner.schema import HardwareInfo

from justvoice import system_info


def test_detect_maps_runner_hardware(monkeypatch):
    fake = HardwareInfo(
        os="Linux",
        platform="linux",
        cpu_cores=8,
        ram_mb=32000,
        gpus=[
            RunnerGpuInfo(vendor="NVIDIA", name="RTX 4090", vram_mb=24564, driver="555.1")
        ],
        runtimes={"cuda": True},
    )
    monkeypatch.setattr(system_info, "_detect_hardware", lambda: fake)

    info = system_info.detect()

    # Hardware primitives come straight from the runner (single authority).
    assert info.cpu_cores == 8
    assert info.ram_total_mb == 32000
    assert len(info.gpus) == 1
    gpu = info.gpus[0]
    assert (gpu.vendor, gpu.name, gpu.vram_mb, gpu.driver) == (
        "NVIDIA",
        "RTX 4090",
        24564,
        "555.1",
    )
    # JustVoice-specific extras are still populated locally.
    assert info.os
    assert info.runtimes.get("cpu") is True
    assert "cuda" in info.runtimes


def test_detect_handles_no_gpu(monkeypatch):
    fake = HardwareInfo(os="Linux", platform="linux", cpu_cores=4, ram_mb=16000)
    monkeypatch.setattr(system_info, "_detect_hardware", lambda: fake)

    info = system_info.detect()

    assert info.gpus == []
    assert info.ram_total_mb == 16000
    assert info.cpu_cores == 4
