# aegis-node/control-plane/app/auth.py

import os
from fastapi import Header, HTTPException, Depends

DASHBOARD_AUTH_ENABLED = os.getenv("AEGIS_AUTH_ENABLED", "true").lower() == "true"
DASHBOARD_AUTH_TOKEN = os.getenv("AEGIS_AUTH_TOKEN", "")


def verify_token(x_aegis_token: str = Header(default=None)):
    if not DASHBOARD_AUTH_ENABLED:
        return

    if not x_aegis_token:
        raise HTTPException(status_code=401, detail="Missing auth token")

    if x_aegis_token != DASHBOARD_AUTH_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid auth token")