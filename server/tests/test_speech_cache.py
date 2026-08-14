# SPDX-License-Identifier: MIT
"""The speech-model cache (phase ②a, plan doc §12): plain files + files.json
truth — fetch via the kit resolver/downloader (faked here, offline), the
on-disk verification, multi-repo nesting, the tarball-dir manifest."""

from __future__ import annotations

import justvoice.speech_cache as sc
import pytest


def _fake_resolver(trees):
    """select_repo_files stand-in: trees = {repo: [(path, size, oid), ...]}."""

    def _select(repo, *, revision="main", files=None):
        entries = [
            {"path": p, "size": s, "oid": o} for (p, s, o) in trees[repo]
        ]
        if files is not None:
            by = {e["path"]: e for e in entries}
            missing = [f for f in files if f not in by]
            if missing:
                raise FileNotFoundError(", ".join(missing))
            entries = [by[f] for f in files]
        return f"sha-{repo.split('/')[-1]}", entries

    return _select


def _fake_stream(calls):
    def _stream(url, dest, on_progress=None, cancel_check=None, headers=None,
                **_kw):
        dest.parent.mkdir(parents=True, exist_ok=True)
        # Size rides the URL's filename in these fixtures: name-<size>.bin
        size = int(url.rsplit("-", 1)[-1].split(".")[0])
        dest.write_bytes(b"\0" * size)
        calls.append(url)
        if on_progress:
            on_progress(size, size)

    return _stream


@pytest.fixture
def _offline(monkeypatch):
    import llm_runner.runner.download as dl
    import llm_runner.runner.models as km

    calls: list[str] = []
    trees = {
        "owner/repo": [("model-4.bin", 4, "oid-a"), ("cfg-2.bin", 2, "oid-b")],
        "owner/codec": [("enc-3.bin", 3, "oid-c")],
    }
    monkeypatch.setattr(km, "select_repo_files", _fake_resolver(trees))
    monkeypatch.setattr(dl, "stream_download", _fake_stream(calls))
    monkeypatch.setattr(sc, "_download_kwargs", lambda: {"segments": 1, "retries": 0})
    return calls


def test_fetch_writes_files_and_manifest(tmp_path, _offline):
    progress = []
    man = sc.fetch_hf_variant(
        tmp_path, "eng", "v1", [{"hf_repo": "owner/repo", "files": None}],
        on_progress=lambda d, t: progress.append((d, t)),
    )
    vdir = sc.variant_dir(tmp_path, "eng", "v1")
    assert (vdir / "model-4.bin").stat().st_size == 4
    assert (vdir / "cfg-2.bin").stat().st_size == 2
    assert man["sources"] == [{"hf_repo": "owner/repo", "revision": "main",
                               "commit_sha": "sha-repo"}]
    assert [f["path"] for f in man["files"]] == ["model-4.bin", "cfg-2.bin"]
    # URLs pin the RESOLVED sha, never the symbolic revision.
    assert all("/resolve/sha-repo/" in u for u in _offline)
    # Progress: denominator is the resolved total, final tick is complete.
    assert progress[0] == (0, 6) and progress[-1] == (6, 6)
    assert sc.variant_on_disk(tmp_path, "eng", "v1") is True
    assert sc.variant_disk_bytes(tmp_path, "eng", "v1") == 6


def test_fetch_skips_files_already_at_size(tmp_path, _offline):
    vdir = sc.variant_dir(tmp_path, "eng", "v1")
    vdir.mkdir(parents=True)
    (vdir / "model-4.bin").write_bytes(b"\0" * 4)   # complete → skipped
    sc.fetch_hf_variant(tmp_path, "eng", "v1",
                        [{"hf_repo": "owner/repo", "files": None}])
    assert len(_offline) == 1 and "cfg-2.bin" in _offline[0]


def test_multi_source_nests_per_repo(tmp_path, _offline):
    man = sc.fetch_hf_variant(
        tmp_path, "tada", "v1",
        [{"hf_repo": "owner/repo", "files": ["model-4.bin"]},
         {"hf_repo": "owner/codec", "files": None}],
    )
    vdir = sc.variant_dir(tmp_path, "tada", "v1")
    assert (vdir / "owner--repo" / "model-4.bin").is_file()
    assert (vdir / "owner--codec" / "enc-3.bin").is_file()
    assert {f["path"] for f in man["files"]} == {
        "owner--repo/model-4.bin", "owner--codec/enc-3.bin"}
    assert sc.variant_on_disk(tmp_path, "tada", "v1") is True


def test_on_disk_is_size_exact_never_folder_non_empty(tmp_path, _offline):
    sc.fetch_hf_variant(tmp_path, "eng", "v1",
                        [{"hf_repo": "owner/repo", "files": None}])
    vdir = sc.variant_dir(tmp_path, "eng", "v1")
    (vdir / "model-4.bin").write_bytes(b"\0" * 3)   # truncated
    assert sc.variant_on_disk(tmp_path, "eng", "v1") is False
    (vdir / "model-4.bin").unlink()                 # missing
    assert sc.variant_on_disk(tmp_path, "eng", "v1") is False
    # No manifest at all — a bare non-empty folder is NOT installed.
    vdir2 = sc.variant_dir(tmp_path, "eng", "v2")
    vdir2.mkdir(parents=True)
    (vdir2 / "junk.onnx").write_bytes(b"x")
    assert sc.variant_on_disk(tmp_path, "eng", "v2") is False


def test_missing_pinned_file_fails_before_any_byte(tmp_path, _offline):
    with pytest.raises(FileNotFoundError, match="nope.bin"):
        sc.fetch_hf_variant(tmp_path, "eng", "v1",
                            [{"hf_repo": "owner/repo", "files": ["nope.bin"]}])
    assert _offline == []   # fail-loud resolve — nothing streamed


def test_tarball_dir_manifest(tmp_path):
    vdir = tmp_path / "speech-cache" / "kokoro" / "v1"
    (vdir / "voices").mkdir(parents=True)
    (vdir / "model.onnx").write_bytes(b"\0" * 5)
    (vdir / "voices" / "af.bin").write_bytes(b"\0" * 2)
    man = sc.write_manifest_from_dir(vdir, url="https://x/y.tar.bz2")
    assert man["url"] == "https://x/y.tar.bz2"
    assert {f["path"] for f in man["files"]} == {"model.onnx", "voices/af.bin"}
    assert sc.variant_on_disk(tmp_path, "kokoro", "v1") is True
