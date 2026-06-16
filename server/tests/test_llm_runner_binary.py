# SPDX-License-Identifier: GPL-3.0-or-later
"""P1.2 — llama.cpp binary acquisition: platform/GPU selection + download +
unpack. Network + OS are mocked so the test runs anywhere.
"""

from __future__ import annotations

import zipfile

import pytest

from justvoice.llm_runner import load_manifest, select_binary
from justvoice.llm_runner import binary as binmod
from justvoice.models import GpuInfo, SystemInfo


def _system(runtimes, gpus=None, os_name="Windows 10"):
    return SystemInfo(
        os=os_name, cpu_name="test", cpu_cores=8, ram_total_mb=32000,
        gpus=gpus or [], runtimes=runtimes,
    )


def _force_platform(monkeypatch, name):
    monkeypatch.setattr(binmod.platform, "system", lambda: name)


def test_select_windows_cuda(monkeypatch):
    _force_platform(monkeypatch, "Windows")
    m = load_manifest(refresh=True)
    sys = _system({"cuda": True}, [GpuInfo(vendor="NVIDIA", name="RTX 2070 SUPER", vram_mb=8192)])
    asset = select_binary(m, sys)
    assert asset is not None
    assert asset.platform == "windows" and asset.gpu == "cuda12"
    assert asset.asset_url and asset.server_exe == "llama-server.exe"


def test_select_windows_cpu_fallback(monkeypatch):
    _force_platform(monkeypatch, "Windows")
    m = load_manifest(refresh=True)
    asset = select_binary(m, _system({}))  # no gpu runtimes
    assert asset is not None and asset.gpu == "cpu"


def test_select_macos_metal(monkeypatch):
    _force_platform(monkeypatch, "Darwin")
    m = load_manifest(refresh=True)
    asset = select_binary(m, _system({"metal": True}, os_name="Darwin 24"))
    assert asset is not None and asset.gpu == "metal"
    assert asset.server_exe == "llama-server"


def test_select_linux_cuda_is_docker(monkeypatch):
    _force_platform(monkeypatch, "Linux")
    m = load_manifest(refresh=True)
    asset = select_binary(m, _system({"cuda": True}, os_name="Linux"))
    assert asset is not None and asset.source == "docker" and asset.image


def test_acquire_github_zip_downloads_and_unpacks(monkeypatch, tmp_path):
    _force_platform(monkeypatch, "Windows")
    m = load_manifest(refresh=True)
    sys = _system({"cuda": True})

    # Fake the streaming download: write a zip containing the server exe.
    def fake_stream(url, dest, on_progress, cancel_check=None):
        with zipfile.ZipFile(dest, "w") as zf:
            zf.writestr("llama-server.exe", b"MZ fake binary")
        on_progress(14)
        return "deadbeef"

    import justvoice.installer as installer
    monkeypatch.setattr(installer, "_stream_download", fake_stream)

    exe = binmod.acquire_binary(tmp_path, m, sys)
    assert exe.is_file() and exe.name == "llama-server.exe"
    assert exe.read_bytes() == b"MZ fake binary"
    # The downloaded archive is cleaned up.
    assert not (binmod.binary_dir(tmp_path, m.llamacpp.pinned_build) / "_download.zip").exists()

    # Idempotent: a second call returns the same path WITHOUT downloading.
    def boom(*a, **k):
        raise AssertionError("should not re-download when already acquired")
    monkeypatch.setattr(installer, "_stream_download", boom)
    again = binmod.acquire_binary(tmp_path, m, sys)
    assert again == exe


def test_acquire_docker_source_raises(monkeypatch, tmp_path):
    _force_platform(monkeypatch, "Linux")
    m = load_manifest(refresh=True)
    sys = _system({"cuda": True}, os_name="Linux")
    with pytest.raises(NotImplementedError):
        binmod.acquire_binary(tmp_path, m, sys)
