# SPDX-License-Identifier: MIT
"""The project archive — Studio → Overview → 📦 Export .justvoice.zip.

What these pin (2026-10-05):
  * a persona saved with no delivery settings (Cast's batch makes them so)
    exports `{}` — it used to crash the whole export with a 500
  * the archive is named `<slug>-<time>.justvoice.zip`, as the button says
"""

from __future__ import annotations

import io
import json
import zipfile

import pytest
from fastapi.testclient import TestClient

from justvoice.app import create_app
from justvoice.database.seed import seed_workspace
from tests.jw_fixtures import book_json, scene

pytest_plugins = ["tests.conftest_db"]


@pytest.fixture()
def client(tmp_path):
    app = create_app(data_dir=tmp_path)
    seed_workspace()
    return TestClient(app, raise_server_exceptions=False)


def test_a_persona_with_no_delivery_exports_and_the_archive_is_named_for_the_button(client):
    r = client.post(
        "/v1/projects/import?source=justwrite",
        json=book_json(chapters=[("ch1", "One", [scene("scn1", "“We leave at dawn,” said Mara Vance.")])]),
    )
    assert r.status_code == 200, r.text
    pid = r.json()["project_id"]
    speaker = client.get(f"/v1/projects/{pid}/speakers").json()["speakers"][0]
    persona = client.post("/v1/personas", json={"name": "Mara"}).json()
    assert client.patch(f"/v1/speakers/{speaker['id']}", json={"persona_id": persona["id"]}).status_code == 200

    r = client.get(f"/v1/projects/{pid}/export")
    assert r.status_code == 200, r.text
    assert r.headers["content-disposition"].endswith('.justvoice.zip"')
    z = zipfile.ZipFile(io.BytesIO(r.content))
    saved = json.loads(z.read(f"personas/{persona['id']}.json"))
    assert saved["name"] == "Mara"
    assert isinstance(saved["default_delivery"], dict)
