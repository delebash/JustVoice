# SPDX-License-Identifier: MIT
"""POST /v1/scenes/{id}/analyze/stream — lane 2A of the AI-call convention.

The streaming analyze must be the SAME pipeline as /analyze with the reply
travelling as family SSE frames: `data:{"delta"}` per chunk, a final
`data:{"done":true,...}` carrying the usage names top-level PLUS the
AnalyzeSceneResponse fields, then `data:[DONE]`; a no-LLM state arrives as
`data:{"error"}` inside the stream (it has already started — no HTTP status).
"""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from llm_runner.llm import LLMNotConfiguredError

from justvoice.app import create_app
from justvoice.database.seed import seed_workspace
from tests.jw_fixtures import book_json

pytest_plugins = ["tests.conftest_db"]


@pytest.fixture()
def client(tmp_path):
    app = create_app(data_dir=tmp_path)
    seed_workspace()
    return TestClient(app, raise_server_exceptions=False)


def _scene_id(client) -> str:
    r = client.post("/v1/projects/import?source=justwrite", json=book_json())
    assert r.status_code == 200, r.text
    pid = r.json()["project_id"]
    return client.get(f"/v1/projects/{pid}/scenes").json()[0]["id"]


def _frames(body: str) -> list:
    out = []
    for line in body.split("\n"):
        if not line.startswith("data:"):
            continue
        payload = line[5:].strip()
        out.append("[DONE]" if payload == "[DONE]" else json.loads(payload))
    return out


def test_stream_emits_deltas_then_a_done_frame_with_rows_and_usage(client, monkeypatch):
    def fake_stream(action, variables, **overrides):
        assert action.startswith("speaker_attribution.")
        yield SimpleNamespace(done=False, text='[{"speaker": ', progress=None)
        yield SimpleNamespace(done=False, text='"mara", "confidence": 0.9}]', progress=None)
        yield SimpleNamespace(
            done=True, text="", progress=None,
            prompt_tokens=321, completion_tokens=45, model="stub-model",
        )

    monkeypatch.setattr("justvoice.extraction.pipeline.stream_feature", fake_stream)

    scene_id = _scene_id(client)
    r = client.post(
        f"/v1/scenes/{scene_id}/analyze/stream",
        json={"text": '"Hi," said Mara.'},
    )
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("text/event-stream")

    frames = _frames(r.text)
    deltas = [f for f in frames if isinstance(f, dict) and "delta" in f]
    assert "".join(f["delta"] for f in deltas) == '[{"speaker": "mara", "confidence": 0.9}]'

    (done,) = [f for f in frames if isinstance(f, dict) and f.get("done")]
    # The family usage names, top level — what the kit client normalizes.
    assert done["promptTokens"] == 321
    assert done["completionTokens"] == 45
    assert done["model"] == "stub-model"
    # The domain payload — same names as AnalyzeSceneResponse.
    assert done["scene_id"] == scene_id
    assert done["route_used"] in ("guided", "direct")
    assert isinstance(done["rows"], list) and done["rows"]
    assert any(row["speaker"] == "mara" for row in done["rows"])
    assert done["usage"]["prompt_tokens"] == 321

    assert frames[-1] == "[DONE]"


def test_stream_surfaces_no_llm_as_an_error_frame(client, monkeypatch):
    def refuse(action, variables, **overrides):
        raise LLMNotConfiguredError("no LLM provider registered")

    monkeypatch.setattr("justvoice.extraction.pipeline.stream_feature", refuse)

    scene_id = _scene_id(client)
    r = client.post(
        f"/v1/scenes/{scene_id}/analyze/stream",
        json={"text": '"Hi," said Mara.'},
    )
    assert r.status_code == 200  # the stream started; the error is a frame
    frames = _frames(r.text)
    (err,) = [f for f in frames if isinstance(f, dict) and "error" in f]
    assert "provider" in err["error"]
    assert frames[-1] == "[DONE]"


def test_stream_404s_an_unknown_scene_before_streaming(client):
    r = client.post("/v1/scenes/nope/analyze/stream", json={"text": "x"})
    assert r.status_code == 404
