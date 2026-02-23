# control-plane/app/services/health.py

import subprocess
import time

from app.services.constants import HANDSHAKE_ACTIVE_THRESHOLD
from app.services.wg import get_wg_dump_cached


def get_health():
    dump = get_wg_dump_cached()

    if not dump:
        return {
            "vpn_up": False,
            "peers_total": 0,
            "peers_active": 0,
            "timestamp": int(time.time())
        }

    lines = dump.strip().split("\n")

    # First line is interface info
    if len(lines) <= 1:
        return {
            "vpn_up": True,
            "peers_total": 0,
            "peers_active": 0,
            "timestamp": int(time.time())
        }

    peers_total = 0
    peers_active = 0
    now = int(time.time())

    for line in lines[1:]:
        parts = line.split()
        if len(parts) < 6:
            continue

        peers_total += 1

        try:
            last_handshake = int(parts[5])
        except (ValueError, IndexError):
            last_handshake = 0

        if last_handshake != 0 and (now - last_handshake) < HANDSHAKE_ACTIVE_THRESHOLD:
            peers_active += 1
        
    return {
        "vpn_up": True,
        "peers_total": peers_total,
        "peers_active": peers_active,
        "timestamp": now
    }