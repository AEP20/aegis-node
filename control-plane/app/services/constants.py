# control-plane/app/services/constants.py
# Single source of truth constants.
import os

# Maximum seconds since the last handshake for a peer to be considered "active".
HANDSHAKE_ACTIVE_THRESHOLD: int = int(os.getenv("WG_HANDSHAKE_THRESHOLD", "120"))
