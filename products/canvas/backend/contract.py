"""The canvas platform contract, loaded from the builder package's manifest.

manifest.json is the single source of truth shared by the Node builder
(build.mjs), this Python validator/build service, and the artifact origin's
CSP. The desktop app asserts its own copy against the same file in a contract
test, so a drift in pinned dependencies or limits fails loudly instead of
diverging silently.
"""

import json
from functools import lru_cache
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from django.conf import settings

CANVAS_BUILDER_DIR = Path(settings.CANVAS_BUILDER_DIR)


@lru_cache(maxsize=1)
def platform_contract() -> dict[str, Any]:
    return json.loads((CANVAS_BUILDER_DIR / "manifest.json").read_text())


def platform_dependencies() -> dict[str, str]:
    """Pinned name → exact version of every platform-supported dependency."""
    return {name: entry["version"] for name, entry in platform_contract()["dependencies"].items()}


def allowed_import_specifiers() -> frozenset[str]:
    return frozenset(platform_contract()["allowedImportSpecifiers"])


def canonical_network_origin(origin: Any) -> str | None:
    if not isinstance(origin, str):
        return None
    try:
        parsed = urlsplit(origin)
        port = parsed.port
    except ValueError:
        return None
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
        or "*" in parsed.hostname
    ):
        return None
    hostname = f"[{parsed.hostname.lower()}]" if ":" in parsed.hostname else parsed.hostname.lower()
    return f"https://{hostname}" + (f":{port}" if port is not None else "")


def artifact_csp(network_origins: list[str] | None = None) -> str:
    csp = platform_contract()["csp"]
    safe_origins = [canonical for origin in network_origins or [] if (canonical := canonical_network_origin(origin))]
    connect_sources = " ".join(safe_origins) or "'none'"
    return csp.replace("connect-src 'none'", f"connect-src {connect_sources}")


def contract_limits() -> dict[str, int]:
    return platform_contract()["limits"]


def canvas_sdk_version() -> str:
    return platform_contract()["canvasSdkVersion"]
