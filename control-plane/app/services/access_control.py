import ipaddress
import os
import secrets
import time
from pathlib import Path

from app.auth import DASHBOARD_AUTH_ENABLED, DASHBOARD_AUTH_TOKEN_FILE, current_auth_token


DASHBOARD_BIND_HOST = os.getenv("DASHBOARD_BIND_HOST", "")
DASHBOARD_BIND_PORT = os.getenv("DASHBOARD_BIND_PORT", "")


def _bind_warning(bind_host: str) -> str | None:
    if not bind_host:
        return None
    if bind_host in {"0.0.0.0", "::"}:
        return "dashboard listens on all interfaces"
    try:
        ip = ipaddress.ip_address(bind_host)
    except ValueError:
        return None
    if ip.is_loopback or ip.is_private:
        return None
    return "dashboard bind address is public"


def get_access_control_status() -> dict:
    token_path = Path(DASHBOARD_AUTH_TOKEN_FILE) if DASHBOARD_AUTH_TOKEN_FILE else None
    token_age = None
    token_file_exists = False
    if token_path and token_path.exists():
        token_file_exists = True
        token_age = max(0, int(time.time() - token_path.stat().st_mtime))

    return {
        "status": "ok",
        "auth_enabled": DASHBOARD_AUTH_ENABLED,
        "token_configured": bool(current_auth_token()),
        "token_file_exists": token_file_exists,
        "token_age_seconds": token_age,
        "bind_host": DASHBOARD_BIND_HOST,
        "bind_port": DASHBOARD_BIND_PORT,
        "bind_warning": _bind_warning(DASHBOARD_BIND_HOST),
    }


def rotate_access_token() -> dict:
    if not DASHBOARD_AUTH_TOKEN_FILE:
        return {"status": "error", "message": "AEGIS_AUTH_TOKEN_FILE is not configured"}

    token_path = Path(DASHBOARD_AUTH_TOKEN_FILE)
    token_path.parent.mkdir(parents=True, exist_ok=True)
    new_token = secrets.token_urlsafe(32)
    token_path.write_text(new_token + "\n")
    token_path.chmod(0o600)

    status = get_access_control_status()
    status["new_token"] = new_token
    status["rotated"] = True
    return status
