"""Typer-based CLI matching the Rust binary's surface.

Subcommands:
  - serve              start the server
  - default-settings   print the seed settings.json
  - self-test          run smoke tests against a booted server
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import typer
import uvicorn

from .app import create_app
from .models import Settings
from .paths import default_data_dir
from .version import VERSION

app = typer.Typer(name="justtts", no_args_is_help=True, help="JustTTS server CLI")


@app.command()
def serve(
    host: str | None = typer.Option(None, "--host", envvar="JUSTTTS_HOST"),
    port: int | None = typer.Option(None, "--port", envvar="JUSTTTS_PORT"),
    data_dir: Path | None = typer.Option(None, "--data-dir", envvar="JUSTTTS_DATA_DIR"),
    log_level: str = typer.Option("info", "--log-level", envvar="JUSTTTS_LOG_LEVEL"),
    no_docs: bool = typer.Option(False, "--no-docs", help="Disable Swagger/Redoc UIs"),
):
    """Boot the JustTTS server."""
    logging.basicConfig(
        level=log_level.upper(),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    dd = data_dir or default_data_dir()
    fastapi_app = create_app(dd)

    # Apply CLI overrides over the settings-derived host/port
    from .app_state import get_state

    settings = get_state().settings.get()
    bind_host = host or settings.server.host
    bind_port = port or settings.server.port

    typer.secho(
        f"JustTTS {VERSION} — http://{bind_host}:{bind_port}/  (data: {dd})",
        fg=typer.colors.GREEN,
    )
    uvicorn.run(fastapi_app, host=bind_host, port=bind_port, log_level=log_level.lower())


@app.command(name="default-settings")
def default_settings():
    """Print the seed settings.json."""
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
