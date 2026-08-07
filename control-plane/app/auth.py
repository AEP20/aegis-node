# aegis-node/control-plane/app/auth.py

import os
from fastapi import Header, HTTPException, Depends

DASHBOARD_AUTH_ENABLED = os.getenv("AEGIS_AUTH_ENABLED", "true").lower() == "true"
DASHBOARD_AUTH_TOKEN = os.getenv("AEGIS_AUTH_TOKEN", "")
DASHBOARD_AUTH_TOKEN_FILE = os.getenv("AEGIS_AUTH_TOKEN_FILE", "")


def current_auth_token() -> str:
    if DASHBOARD_AUTH_TOKEN_FILE:
        try:
            with open(DASHBOARD_AUTH_TOKEN_FILE) as f:
                token = f.read().strip()
                if token:
                    return token
        except OSError:
            pass
    return DASHBOARD_AUTH_TOKEN


def verify_token(x_aegis_token: str = Header(default=None)):
    if not DASHBOARD_AUTH_ENABLED:
        return

    if not x_aegis_token:
        raise HTTPException(status_code=401, detail="Missing auth token")

    if x_aegis_token != current_auth_token():
        raise HTTPException(status_code=403, detail="Invalid auth token")
