"""Typer-based domain CLI — dev utilities, reachable as `python -m justvoice.cli`.

The SERVER entry moved to serve.py (target-tree P3, 2026-08-08): the
`justvoice-server` console script targets `justvoice.serve:main`, one door per
purpose. (The old `--no-docs` serve flag died with the move — it was accepted
and never read; docs visibility comes from settings.server.docs_enabled.)

Subcommands:
  - default-settings   print the seed settings.json
  - open-api           print the OpenAPI spec
  - self-test          run smoke tests against a booted server
"""

from __future__ import annotations

import json

import typer

from .app import create_app
from .models import Settings

app = typer.Typer(name="justvoice", no_args_is_help=True, help="JustVoice domain CLI")


@app.command(name="default-settings")
def default_settings():
    """Print the seed settings (defaults)."""
    typer.echo(json.dumps(Settings().model_dump(), indent=2, default=str))


@app.command(name="open-api")
def open_api():
    """Generate the OpenAPI spec (writes to stdout)."""
    app_ = create_app()
    typer.echo(json.dumps(app_.openapi(), indent=2))


@app.command(name="self-test")
def self_test():
    """Run smoke tests against a booted server."""
    import httpx

    settings = Settings()
    url = f"http://{settings.server.host}:{settings.server.port}"
    try:
        r = httpx.get(f"{url}/v1/health", timeout=5)
        typer.secho(f"GET {url}/v1/health → {r.status_code}", fg=typer.colors.GREEN)
        r.raise_for_status()
        typer.echo(json.dumps(r.json(), indent=2))
    except Exception as e:
        typer.secho(f"FAILED: {e}", fg=typer.colors.RED)
        raise typer.Exit(code=1)


if __name__ == "__main__":
    app()
