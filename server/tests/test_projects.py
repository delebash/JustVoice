# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for the multi-adapter import pipeline + /v1/projects surface.

The TestImportAdapters class covers every shipping adapter end-to-end
through the FastAPI client, plus the registry endpoint, dry-run, and
JustWrite backwards-compat query-string mode (the route JustWrite has
been hitting and must keep working).
"""

from __future__ import annotations

import json

import pytest


JUSTWRITE_SAMPLE = {
    "schema": "justwrite/v1",
    "book": {
        "title": "The Quiet Frontier",
        "author": "Jane Doe",
        "language": "en-US",
        "description": "Test book.",
    },
    "characters": [
        {"id": "narr", "name": "Narrator", "voice_hint": "warm baritone"},
        {"id": "alice", "name": "Alice"},
    ],
    "chapters": [
        {
            "id": "ch1",
            "title": "Departure",
            "lines": [
                {"character_id": "narr", "text": "It began at dawn.", "pause_after_ms": 400},
                {"character_id": "alice", "text": "Are we ready?",
                 "delivery": {"emotion": "fearful"}},
            ],
        }
    ],
    "lexicon": [
        {"grapheme": "Caoimhe", "phoneme_ipa": "ˈkiːvə"},
    ],
}

CSV_SAMPLE = """scene,character,text,delivery,pause_after_ms
village,Guard,Halt! Who goes there?,{"emotion":"angry"},250
village,Hero,A traveller.,,500
forest,Hero,The trees are thick here.,,
"""

SRT_SAMPLE = """1
00:00:01,000 --> 00:00:04,000
NARRATOR: The story begins.

2
00:00:05,500 --> 00:00:08,000
ALICE: Hello? Anyone there?

3
00:00:10,000 --> 00:00:12,000
Just an unattributed line.
"""

AUDACITY_SAMPLE = (
    "0.000000\t1.500000\tIntro music fades\n"
    "2.000000\t4.250000\tNarrator opens the scene\n"
    "5.000000\t7.000000\tCharacter speaks\n"
)


class TestImportAdapters:
    def test_adapter_list_includes_all_shipping_sources(self, client):
        r = client.get("/v1/projects/import/adapters")
        assert r.status_code == 200
        body = r.json()
        ids = {a["id"] for a in body["adapters"]}
        assert {
            "justwrite",
            "csv_lines",
            "srt",
            "audacity_labels",
            "justvoice_standard",
            "elevenlabs",
        } <= ids
        # ElevenLabs is the only one marked unimplemented at this stage.
        impl = {a["id"]: a["implemented"] for a in body["adapters"]}
        assert impl["justwrite"] is True
        assert impl["elevenlabs"] is False

    # ----- justwrite — must preserve JustWrite's existing import shape

    def test_justwrite_multipart(self, client):
        payload = json.dumps(JUSTWRITE_SAMPLE).encode("utf-8")
        r = client.post(
            "/v1/projects/import",
            data={"source": "justwrite", "dry_run": "true"},
            files={"file": ("book.json", payload, "application/json")},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["committed"] is False
        std = body["standard"]
        assert std["source"] == "justwrite"
        assert std["project"]["name"] == "The Quiet Frontier"
        assert std["project"]["kind"] == "audiobook"
        assert len(std["characters"]) == 2
        assert len(std["scenes"]) == 1
        assert len(std["scenes"][0]["lines"]) == 2
        assert std["lexicon_entries"][0]["grapheme"] == "Caoimhe"

    def test_justwrite_backwards_compat_query_string(self, client):
        """JustWrite hits this route with ?source=justwrite and the raw
        body — must keep working unchanged."""
        payload = json.dumps(JUSTWRITE_SAMPLE).encode("utf-8")
        r = client.post(
            "/v1/projects/import?source=justwrite&dry_run=true",
            content=payload,
            headers={"Content-Type": "application/json"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["standard"]["project"]["name"] == "The Quiet Frontier"

    def test_justwrite_commit_creates_project(self, client):
        payload = json.dumps(JUSTWRITE_SAMPLE).encode("utf-8")
        r = client.post(
            "/v1/projects/import",
            data={"source": "justwrite"},
            files={"file": ("book.json", payload, "application/json")},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["committed"] is True
        pid = body["project_id"]
        assert pid and pid.startswith("proj_")

        # And the project is visible via the list + get endpoints.
        listed = client.get("/v1/projects").json()["projects"]
        assert any(p["id"] == pid for p in listed)
        got = client.get(f"/v1/projects/{pid}").json()
        assert got["name"] == "The Quiet Frontier"

    # ----- csv_lines

    def test_csv_lines(self, client):
        r = client.post(
            "/v1/projects/import",
            data={"source": "csv_lines", "dry_run": "true"},
            files={"file": ("lines.csv", CSV_SAMPLE.encode("utf-8"), "text/csv")},
        )
        assert r.status_code == 200, r.text
        std = r.json()["standard"]
        assert std["source"] == "csv_lines"
        # Two scenes (village + forest), two characters (Guard + Hero).
        assert len(std["scenes"]) == 2
        scene_ids = {s["id"] for s in std["scenes"]}
        assert "village" in scene_ids
        assert "forest" in scene_ids
        chars = {c["name"] for c in std["characters"]}
        assert "Guard" in chars and "Hero" in chars
        # First village line carries the parsed delivery JSON.
        village = next(s for s in std["scenes"] if s["id"] == "village")
        assert village["lines"][0]["delivery"] == {"emotion": "angry"}
        assert village["lines"][0]["pause_after_ms"] == 250

    # ----- srt

    def test_srt(self, client):
        r = client.post(
            "/v1/projects/import",
            data={"source": "srt", "dry_run": "true"},
            files={"file": ("cues.srt", SRT_SAMPLE.encode("utf-8"), "application/x-subrip")},
        )
        assert r.status_code == 200, r.text
        std = r.json()["standard"]
        assert std["source"] == "srt"
        assert len(std["scenes"]) == 1
        lines = std["scenes"][0]["lines"]
        assert len(lines) == 3
        assert lines[0]["text"] == "The story begins."
        # Speaker lifted from "NARRATOR:" prefix into a character.
        names = {c["name"] for c in std["characters"]}
        assert "Narrator" in names and "Alice" in names
        # Gap between cue 1 (ends 4.0s) and cue 2 (starts 5.5s) = 1500ms.
        assert lines[0]["pause_after_ms"] == 1500

    # ----- audacity_labels

    def test_audacity_labels(self, client):
        r = client.post(
            "/v1/projects/import",
            data={"source": "audacity_labels", "dry_run": "true"},
            files={"file": ("labels.txt", AUDACITY_SAMPLE.encode("utf-8"), "text/plain")},
        )
        assert r.status_code == 200, r.text
        std = r.json()["standard"]
        assert std["source"] == "audacity_labels"
        lines = std["scenes"][0]["lines"]
        assert [line["text"] for line in lines] == [
            "Intro music fades",
            "Narrator opens the scene",
            "Character speaks",
        ]
        # Gap between label 1 (ends 1.5s) and label 2 (starts 2.0s) = 500ms.
        assert lines[0]["pause_after_ms"] == 500

    # ----- justvoice_standard (pass-through)

    def test_justvoice_standard_passthrough(self, client):
        # Round-trip: import via JustWrite to produce a standard payload,
        # then re-import that payload via justvoice_standard.
        payload = json.dumps(JUSTWRITE_SAMPLE).encode("utf-8")
        first = client.post(
            "/v1/projects/import",
            data={"source": "justwrite", "dry_run": "true"},
            files={"file": ("book.json", payload, "application/json")},
        ).json()
        standard_blob = json.dumps(first["standard"]).encode("utf-8")
        second = client.post(
            "/v1/projects/import",
            data={"source": "justvoice_standard", "dry_run": "true"},
            files={"file": ("std.json", standard_blob, "application/json")},
        )
        assert second.status_code == 200, second.text
        assert second.json()["standard"]["project"]["name"] == "The Quiet Frontier"

    # ----- elevenlabs (stub)

    def test_elevenlabs_returns_501(self, client):
        r = client.post(
            "/v1/projects/import",
            data={"source": "elevenlabs", "dry_run": "true"},
            files={"file": ("project.json", b"{}", "application/json")},
        )
        assert r.status_code == 501
        body = r.json()
        assert "not implemented" in body["detail"].lower()

    # ----- error paths

    def test_unknown_source(self, client):
        r = client.post(
            "/v1/projects/import",
            data={"source": "bogus", "dry_run": "true"},
            files={"file": ("x.json", b"{}", "application/json")},
        )
        assert r.status_code == 400

    def test_missing_file_and_body(self, client):
        r = client.post("/v1/projects/import", data={"source": "justwrite"})
        assert r.status_code == 400

    def test_justwrite_bad_json(self, client):
        r = client.post(
            "/v1/projects/import",
            data={"source": "justwrite", "dry_run": "true"},
            files={"file": ("book.json", b"not json", "application/json")},
        )
        assert r.status_code == 400


@pytest.fixture()
def client_alt(client):
    """Alias so the file reads naturally if extended later."""
    return client
