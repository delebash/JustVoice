# SPDX-License-Identifier: GPL-3.0-or-later
"""JustVoice MCP server — `justvoice.speak` and friends for local AI agents.

Mounted at ``/mcp`` (Streamable HTTP). See server.py for the wiring and
tools.py for the tool surface.
"""

from .server import mount_into

__all__ = ["mount_into"]
