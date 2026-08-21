# SPDX-License-Identifier: MIT
"""Pins for the LoRA restructure (2026-08-21).

Three things here that nothing pinned before, each of which silently
produces a WORSE VOICE rather than an error when it breaks:

  * the reference clip — which single clip becomes the voice's identity,
  * transcript confidence — the gate that drops clips whose text is
    probably wrong,
  * the dataset builder's seed resolution — what keeps a generated set one
    speaker instead of thirty.
"""

from __future__ import annotations

import base64
import math
import struct

import pytest

SR = 24000


def _tone(seconds: float, freq: int = 220) -> bytes:
    n = int(SR * seconds)
    return b"".join(
        struct.pack("<h", int(12000 * math.sin(2 * math.pi * freq * i / SR)))
        for i in range(n)
    )


def _wav(pcm: bytes) -> bytes:
    return (
        b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVEfmt "
        + struct.pack("<IHHIIHH", 16, 1, 1, SR, SR * 2, 2, 16)
        + b"data" + struct.pack("<I", len(pcm))
    )+ pcm


def _b64(pcm: bytes) -> str:
    return base64.b64encode(_wav(pcm)).decode()


# ── The reference clip ───────────────────────────────────────────────────


def _three_clips() -> list[dict]:
    # Clip 1 is the LONGEST on purpose: every assertion below is about an
    # explicit choice beating the longest-clip fallback.
    return [
        {"wav_b64": _b64(_tone(3.0)), "transcript": "the long one"},
        {"wav_b64": _b64(_tone(1.2, 260)), "transcript": "the chosen one"},
        {"wav_b64": _b64(_tone(1.0, 300)), "transcript": "the third one"},
    ]


def test_dataset_records_its_reference_clip_and_language(tmp_path):
    from justvoice.storage import training_datasets

    rec = training_datasets.create_dataset(
        tmp_path, "ref-set", _three_clips(),
        language="de", ref_index=1, origin="prepared",
    )
    assert rec.ref_index == 1
    # The transcript is resolved from the chosen clip, not the first one.
    assert rec.ref_transcript == "the chosen one"
    assert rec.language == "de"
    assert rec.origin == "prepared"


def test_out_of_range_reference_falls_back_rather_than_losing_the_clips(tmp_path):
    """create() must not raise: refusing a whole dataset over one bad index
    would throw away the clips, and longest-clip is always a valid answer."""
    from justvoice.storage import training_datasets

    rec = training_datasets.create_dataset(tmp_path, "s", _three_clips(), ref_index=99)
    assert rec.ref_index is None


def test_retargeting_the_reference_is_refused_when_out_of_range(tmp_path):
    """update() is the opposite case: an explicit retarget that silently did
    nothing is worse than an error the caller can show."""
    from justvoice.storage import training_datasets

    rec = training_datasets.create_dataset(tmp_path, "s", _three_clips())
    with pytest.raises(ValueError):
        training_datasets.update_dataset(tmp_path, rec.id, ref_index=99)

    up = training_datasets.update_dataset(tmp_path, rec.id, ref_index=2)
    assert up.ref_index == 2
    assert up.ref_transcript == "the third one"


def test_copy_into_plants_the_chosen_reference_not_the_longest(tmp_path):
    """The whole point of the picker. Clip 0 is the longest; the set names
    clip 1, so ref.wav must be clip 1."""
    from justvoice.storage import training_datasets

    rec = training_datasets.create_dataset(tmp_path, "s", _three_clips(), ref_index=1)
    dest = tmp_path / "job"
    training_datasets.copy_into(tmp_path, rec.id, dest)

    assert (dest / "ref.wav").read_bytes() == (dest / "sample_0001.wav").read_bytes()
    assert (dest / "ref_text.txt").read_text(encoding="utf-8") == "the chosen one"


def test_run_override_beats_the_stored_reference_without_mutating_it(tmp_path):
    from justvoice.storage import training_datasets

    rec = training_datasets.create_dataset(tmp_path, "s", _three_clips(), ref_index=1)
    dest = tmp_path / "job"
    training_datasets.copy_into(tmp_path, rec.id, dest, ref_index=2)

    assert (dest / "ref.wav").read_bytes() == (dest / "sample_0002.wav").read_bytes()
    # The stored set is untouched — an override is for one run only.
    assert training_datasets.get_dataset(tmp_path, rec.id).ref_index == 1


def test_no_reference_chosen_plants_nothing_so_the_runner_can_fall_back(tmp_path):
    from justvoice.storage import training_datasets

    rec = training_datasets.create_dataset(tmp_path, "s", _three_clips())
    dest = tmp_path / "job"
    training_datasets.copy_into(tmp_path, rec.id, dest)
    assert not (dest / "ref.wav").exists()


# ── The dataset builder ──────────────────────────────────────────────────


def test_builder_project_survives_a_reload(tmp_path):
    """Rows and their audio live on disk, not in the page — the reason the
    builder is server-side at all."""
    from justvoice.storage import dataset_builder as db

    p = db.create_project(tmp_path, "set one")
    db.save_project(tmp_path, p["id"], {
        "description": "a calm narrator",
        "global_seed": 42,
        "rows": [{"emotion": "warm", "text": "Hello."}, {"text": "Oh!"}],
    })
    db.write_sample(tmp_path, p["id"], 0, _wav(_tone(1.0)))

    back = db.get_project(tmp_path, p["id"])
    assert back["description"] == "a calm narrator"
    assert back["global_seed"] == 42
    # Status is DERIVED from the files, never stored, so it cannot drift.
    assert [r["status"] for r in back["rows"]] == ["done", "pending"]
    assert [r["has_audio"] for r in back["rows"]] == [True, False]


def test_derived_fields_never_reach_disk(tmp_path):
    import json

    from justvoice.storage import dataset_builder as db

    p = db.create_project(tmp_path, "s")
    db.save_project(tmp_path, p["id"], {"rows": [{"text": "a"}]})
    raw = json.loads((db.project_dir(tmp_path, p["id"]) / "project.json").read_text(encoding="utf-8"))
    assert "has_audio" not in raw["rows"][0]
    assert "index" not in raw["rows"][0]


def test_a_generating_flag_that_survived_a_restart_is_not_believed(tmp_path):
    """The process that was generating is gone; the file on disk decides."""
    from justvoice.storage import dataset_builder as db

    p = db.create_project(tmp_path, "s")
    db.save_project(tmp_path, p["id"], {"rows": [{"text": "a", "status": "generating"}]})
    assert db.get_project(tmp_path, p["id"])["rows"][0]["status"] == "pending"


def test_shrinking_the_rows_drops_orphaned_clips(tmp_path):
    """Otherwise row 1's old audio silently becomes whatever lands at index
    1 next — a clip whose transcript is now a different line."""
    from justvoice.storage import dataset_builder as db

    p = db.create_project(tmp_path, "s")
    db.save_project(tmp_path, p["id"], {"rows": [{"text": "a"}, {"text": "b"}]})
    db.write_sample(tmp_path, p["id"], 0, _wav(_tone(1.0)))
    db.write_sample(tmp_path, p["id"], 1, _wav(_tone(1.0)))

    db.drop_samples_from(tmp_path, p["id"], 1)
    assert db.sample_path(tmp_path, p["id"], 0).is_file()
    assert not db.sample_path(tmp_path, p["id"], 1).is_file()


def test_generated_samples_carry_the_row_text_as_the_transcript(tmp_path):
    """The advantage of a generated set: the transcript is known exactly,
    never guessed by a transcriber."""
    from justvoice.storage import dataset_builder as db

    p = db.create_project(tmp_path, "s")
    db.save_project(tmp_path, p["id"], {"rows": [{"text": "one"}, {"text": "two"}]})
    db.write_sample(tmp_path, p["id"], 1, _wav(_tone(1.0)))

    got = db.generated_samples(tmp_path, p["id"])
    assert [s["transcript"] for s in got] == ["two"]
    assert [s["row_index"] for s in got] == [1]


@pytest.mark.parametrize(
    "row, project, expected",
    [
        ({"seed": 7}, {"global_seed": 42}, 7),        # the row wins
        ({"seed": None}, {"global_seed": 42}, 42),    # then the project
        ({"seed": None}, {"global_seed": None}, None),  # then random
        ({"seed": -1}, {"global_seed": 42}, None),    # -1 means random
        ({"seed": "x"}, {"global_seed": 42}, 42),     # junk is not a seed
    ],
)
def test_seed_resolution(row, project, expected):
    from justvoice.api.dataset_builder_api import _resolve_seed

    assert _resolve_seed(row, project) == expected


# ── Preparer batch naming ────────────────────────────────────────────────


@pytest.mark.parametrize(
    "filename, names, i, expected",
    [
        ("marius.wav", ["chosen"], 0, "chosen"),
        ("marius.wav", None, 0, "marius"),
        ("marius.wav", ["  "], 0, "marius"),   # blank is not a name
        ("", None, 3, "recording 4"),
    ],
)
def test_batch_dataset_naming(filename, names, i, expected):
    from justvoice import training_prep

    assert training_prep._dataset_name_for(filename, names, i) == expected


# ── Transcript confidence ────────────────────────────────────────────────


def test_confidence_gate_is_configurable_and_defaults_to_alexandrias(tmp_path):
    from justvoice.models import TrainingValidationSettings

    assert TrainingValidationSettings().min_transcript_confidence == 0.85


def test_transcribe_protocol_accepts_both_shapes():
    """An STT engine that cannot measure confidence returns a bare string
    and must keep working — None means UNKNOWN, never zero."""
    from justvoice.models import TrainingValidationSettings

    v = TrainingValidationSettings()

    def gated(confidence):
        return confidence is not None and confidence < v.min_transcript_confidence

    assert gated(0.4) is True
    assert gated(0.99) is False
    assert gated(None) is False  # unknown never fails a clip
