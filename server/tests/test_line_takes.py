# SPDX-License-Identifier: MIT
"""Studio Slice 4 (decided 2026-10-04; docs/plans/2026-10-04-slice-4-render.md) —
a line's takes and its state, through the app's own endpoints.

Pins: a line's state in §8.16's words; a take keeps its audio and what it was
made from; the line's own numbers make it stale and win over the persona (G7);
↻ New take keeps its own seed (G1); the chapter, its captions and the game export
play the ★ take (D4); deleting a take, a chapter or a book takes the audio with it;
the book's lexicon is made once.
"""

from __future__ import annotations

import io
import json
import zipfile

import pytest
from fastapi.testclient import TestClient

from justvoice.app import create_app


@pytest.fixture()
def client(tmp_path):
    return TestClient(create_app(data_dir=tmp_path), raise_server_exceptions=False)


@pytest.fixture()
def fake_speech(monkeypatch):
    """The speech model, faked: a short silence that records the real inputs
    key, so a take reads "rendered" until something it was made from changes.
    Its length follows the text, so a take's words can be told apart."""
    from justvoice.render_core import RenderedLine, line_inputs_key

    calls = []

    def render_line(st, voice, text, **kw):
        calls.append({"text": text, **kw})
        key = line_inputs_key(st, voice, text, language=kw.get("language"), delivery=kw.get("delivery"),
                              seed=kw.get("seed"), lexicons=kw.get("lexicons"), effects=kw.get("effects"))
        return RenderedLine(pcm=b"\x01\x00" * (100 * len(text)), sample_rate=16000, channels=1,
                            effective_delivery=dict(kw.get("delivery") or {}), inputs_key=key or "",
                            seed=kw.get("seed"))

    monkeypatch.setattr("justvoice.render_core.render_line", render_line)
    monkeypatch.setattr("justvoice.api.render_chapter_api.render_line", render_line)
    return calls


def _book(client, texts, *, cast=True, seed=None):
    """A book with one chapter of `texts`, every line the Narrator's, played by
    a Kokoro persona when `cast`."""
    pid = client.post("/v1/projects", json={"name": "Check", "project_type": "audiobook"}).json()["id"]
    sid = client.post(f"/v1/projects/{pid}/scenes", json={"title": "One", "position": 0}).json()["id"]
    blocks = [client.post(f"/v1/scenes/{sid}/blocks", json={"position": i, "text": t}).json()["id"]
              for i, t in enumerate(texts)]
    persona = None
    if cast:
        body = {"name": "Warm narrator", "voice_id": "af_heart"}
        if seed is not None:
            body["default_delivery"] = {"models": {"kokoro": {"seed": seed}}}
        persona = client.post("/v1/personas", json=body).json()["id"]
    sp = client.post(f"/v1/projects/{pid}/speakers", json={"name": "Narrator", "persona_id": persona}).json()["id"]
    for b in blocks:
        client.patch(f"/v1/blocks/{b}", json={"speaker_id": sp})
    return pid, sid, blocks, persona


def _lines(client, sid):
    r = client.get(f"/v1/scenes/{sid}/render_lines")
    assert r.status_code == 200, r.text
    return r.json()


def _states(client, sid):
    return [line["state"] for line in _lines(client, sid)["lines"]]


def _render(client, block, new_take=False):
    r = client.post(f"/v1/blocks/{block}/render", json={"new_take": new_take})
    assert r.status_code == 200, r.text
    return r.json()


def test_a_line_states_its_state(client, fake_speech):
    pid = client.post("/v1/projects", json={"name": "Check", "project_type": "audiobook"}).json()["id"]
    sid = client.post(f"/v1/projects/{pid}/scenes", json={"title": "One", "position": 0}).json()["id"]
    client.post(f"/v1/scenes/{sid}/blocks", json={"position": 0, "text": "Nobody says this."})
    assert _states(client, sid) == ["needs a speaker"]

    pid2, sid2, blocks, _ = _book(client, ["Uncast."], cast=False)
    assert _states(client, sid2) == ["needs a voice"]

    _, sid3, blocks3, _ = _book(client, ["Cast."])
    assert _states(client, sid3) == ["ready"]
    _render(client, blocks3[0])
    page = _lines(client, sid3)
    assert [line["state"] for line in page["lines"]] == ["rendered"]
    assert page["counts"] == {"lines": 1, "needs_speaker": 0, "needs_voice": 0, "ready": 0, "rendered": 1, "stale": 0}
    live = page["lines"][0]["live"]
    audio = client.get(live["audio_url"])
    assert audio.status_code == 200 and audio.content[:4] == b"RIFF"


def test_what_makes_a_line_stale(client, fake_speech):
    pid, sid, (b0, b1, b2), persona = _book(client, ["One.", "Two.", "Three."])
    for b in (b0, b1, b2):
        _render(client, b)
    assert _states(client, sid) == ["rendered", "rendered", "rendered"]
    client.patch(f"/v1/blocks/{b0}", json={"line_override": {"speed": 1.2}})      # its own numbers
    client.patch(f"/v1/blocks/{b1}", json={"text": "Two, changed."})               # its words
    assert _states(client, sid) == ["stale", "stale", "rendered"]
    client.patch(f"/v1/personas/{persona}", json={"default_delivery": {"gain_db": 3}})   # its persona
    assert _states(client, sid) == ["stale", "stale", "stale"]
    # Rendering again is the user's choice; it makes a new ★ take and keeps the old one.
    take = _render(client, b2)
    page = _lines(client, sid)
    assert page["lines"][2]["state"] == "rendered" and page["lines"][2]["takes"] == 2
    assert take["is_default"] is True
    assert sum(t["is_default"] for t in client.get(f"/v1/takes/by_block/{b2}").json()["takes"]) == 1


def test_the_line_override_merges_and_is_checked(client, fake_speech):
    pid, sid, (b0,), _ = _book(client, ["One."])
    client.patch(f"/v1/blocks/{b0}", json={"metadata": {"source_ref": "L1"}})
    client.patch(f"/v1/blocks/{b0}", json={"line_override": {"speed": 1.1, "pause_after_ms": 900}})
    client.patch(f"/v1/blocks/{b0}", json={"line_override": {"speed": None, "pitch": -2}})
    line = _lines(client, sid)["lines"][0]
    assert line["override"] == {"pitch": -2.0, "pause_after_ms": 900.0}
    meta = client.get(f"/v1/scenes/{sid}/blocks").json()[0]["metadata"]
    assert meta["source_ref"] == "L1"                    # the rest of the metadata is kept
    for bad in ({"speed": 5}, {"pause_after_ms": -1}, {"volume": 2}):
        r = client.patch(f"/v1/blocks/{b0}", json={"line_override": bad})
        assert r.status_code == 400, bad


def test_the_lines_own_pause_wins_over_the_personas(client, fake_speech):
    """G7 (2026-10-04): a line's pause — the ⚙ hatch's or an import's — wins."""
    from justvoice.api import render_chapter_api
    from justvoice.app_state import get_state

    pid, sid, (b0,), persona = _book(client, ["One."])
    client.patch(f"/v1/personas/{persona}", json={"default_delivery": {"pause_after": 300}})
    assert render_chapter_api._resolve_scene_to_lines(sid, get_state())[0].delivery.pause_after == 300
    client.patch(f"/v1/blocks/{b0}", json={"line_override": {"pause_after_ms": 1200}})
    assert render_chapter_api._resolve_scene_to_lines(sid, get_state())[0].delivery.pause_after == 1200


def test_a_new_take_keeps_its_own_seed(client, fake_speech):
    """G1: ↻ New take rolls a seed and is judged against it; a take made with the
    persona's seed goes stale when that seed changes."""
    pid, sid, (b0, b1), persona = _book(client, ["One.", "Two."], seed=11)
    _render(client, b0)
    rolled = _render(client, b1, new_take=True)
    assert rolled["new_seed"] is True
    assert fake_speech[-1]["seed"] not in (None, 11)
    assert _states(client, sid) == ["rendered", "rendered"]
    client.patch(f"/v1/personas/{persona}", json={"default_delivery": {"models": {"kokoro": {"seed": 12}}}})
    assert _states(client, sid) == ["stale", "rendered"]


def test_the_chapter_plays_the_star_take(client, fake_speech):
    """D4: the chapter plays each line's ★ take — a stale one too, with its own
    words in the captions — and renders only the lines with none."""
    from justvoice.api import render_chapter_api
    from justvoice.app_state import get_state

    pid, sid, (b0, b1), _ = _book(client, ["Take me.", "No take."])
    _render(client, b0)
    client.patch(f"/v1/blocks/{b0}", json={"text": "Take me, changed."})
    fake_speech.clear()
    st = get_state()
    lines = render_chapter_api._resolve_scene_to_lines(sid, st)
    kwargs = [render_chapter_api._line_kwargs(line, f"scene:{sid}") for line in lines]
    out = render_chapter_api.render_scene_lines(st, lines, kwargs)
    assert [c["text"] for c in fake_speech] == ["No take."]          # only the line with no take rendered
    assert len(out[0].pcm) == 2 * 100 * len("Take me.")              # the take's audio, its old words
    assert render_chapter_api.played_texts(lines) == ["Take me.", "No take."]
    assert _states(client, sid) == ["stale", "ready"]                 # playing it rendered nothing new


def test_render_lines_job_gives_the_ready_lines_takes(client, fake_speech):
    import time

    pid, sid, blocks, _ = _book(client, ["One.", "Two."])
    job = client.post(f"/v1/scenes/{sid}/render_lines", json={"which": "ready"}).json()
    assert job["total_blocks"] == 2
    for _ in range(200):
        if job["status"] in ("completed", "failed", "cancelled"):
            break
        time.sleep(0.05)
        job = client.get(f"/v1/render_jobs/{job['id']}").json()
    assert job["status"] == "completed" and job["completed_blocks"] == 2
    assert _states(client, sid) == ["rendered", "rendered"]
    again = client.post(f"/v1/scenes/{sid}/render_lines", json={"which": "ready"}).json()
    assert again["total_blocks"] == 0 and again["status"] == "completed"
    state = client.get(f"/v1/projects/{pid}/render_state").json()
    assert state["totals"]["rendered"] == 2 and state["chapters"][0]["scene_id"] == sid


def test_a_takes_audio_goes_with_it(client, fake_speech, tmp_path):
    pid, sid, (b0, b1), _ = _book(client, ["One.", "Two."])
    first = _render(client, b0)
    _render(client, b0)
    _render(client, b1)
    gens = tmp_path / "generations"
    assert len(list(gens.glob("*.wav"))) == 3
    assert client.delete(f"/v1/takes/{first['id']}").status_code == 200
    assert len(list(gens.glob("*.wav"))) == 2
    client.delete(f"/v1/scenes/{sid}")
    assert list(gens.glob("*.wav")) == []


def test_deleting_a_chapter_closes_the_gap(client, fake_speech):
    pid = client.post("/v1/projects", json={"name": "Check", "project_type": "audiobook"}).json()["id"]
    ids = [client.post(f"/v1/projects/{pid}/scenes", json={"title": t, "position": i}).json()["id"]
           for i, t in enumerate(["A", "B", "C"])]
    client.delete(f"/v1/scenes/{ids[0]}")
    scenes = client.get(f"/v1/projects/{pid}/scenes").json()
    assert [(s["title"], s["position"]) for s in sorted(scenes, key=lambda s: s["position"])] == [("B", 0), ("C", 1)]


def test_the_books_lexicon_is_made_once(client):
    pid = client.post("/v1/projects", json={"name": "Stillness", "project_type": "audiobook"}).json()["id"]
    first = client.post(f"/v1/projects/{pid}/lexicon").json()
    again = client.post(f"/v1/projects/{pid}/lexicon").json()
    assert first["created"] is True and first["name"] == "Stillness names"
    assert again == {**first, "created": False}
    assert client.get(f"/v1/projects/{pid}").json()["default_lexicon_id"] == first["lexicon_id"]


def test_the_game_export_ships_the_star_take(client, fake_speech):
    from justvoice.app_state import get_state
    from justvoice.export_voicelines import export_voicelines

    pid, sid, (b0, b1), _ = _book(client, ["Halt.", "Pass."])
    _render(client, b0)
    client.patch(f"/v1/blocks/{b0}", json={"text": "Halt, changed."})
    fake_speech.clear()
    z = zipfile.ZipFile(io.BytesIO(export_voicelines(get_state(), pid)))
    manifest = json.loads(z.read("manifest.json"))
    assert [m["text"] for m in manifest] == ["Halt.", "Pass."]   # the take's words ship
    assert [c["text"] for c in fake_speech] == ["Pass."]          # only the line with no take rendered
