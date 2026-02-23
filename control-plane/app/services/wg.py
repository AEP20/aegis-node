# control-plane/app/services/wg.py

import subprocess
import time
import base64
import re
import qrcode
from io import BytesIO
import os


from app.services.constants import HANDSHAKE_ACTIVE_THRESHOLD

WG_INTERFACE              = os.getenv("WG_INTERFACE", "wg0")
WG_SUBNET_BASE            = os.getenv("WG_SUBNET_BASE")          # e.g. "10.66.66."
WG_ENDPOINT               = os.getenv("WG_ENDPOINT")             # e.g. "1.2.3.4:51820"
WG_SERVER_PUBLIC_KEY_PATH = os.getenv(
    "WG_SERVER_PUBLIC_KEY_PATH", "/etc/wireguard/server_public.key"
)
WG_CONFIG_PATH  = f"/etc/wireguard/{WG_INTERFACE}.conf"

# Admin peer IP: subnet base + .2 (static IP assigned during bootstrap)
ADMIN_PEER_IP = os.getenv("ADMIN_PEER_IP") or (
    (WG_SUBNET_BASE + "2") if WG_SUBNET_BASE else "10.66.66.2"
)


# ── Helpers ────────────────────────────────────────────────

_dump_cache = {"output": None, "timestamp": 0}

def get_wg_dump_cached(ttl=2) -> str:
    global _dump_cache
    now = time.time()
    if _dump_cache["output"] and (now - _dump_cache["timestamp"]) < ttl:
        return _dump_cache["output"]

    try:
        output = subprocess.check_output(
            ["sudo", "wg", "show", "all", "dump"],
            text=True
        )
        _dump_cache = {"output": output, "timestamp": now}
        return output
    except Exception:
        return None


def _format_age(seconds):
    if seconds is None:
        return None
    if seconds < 60:
        return f"{seconds}s"
    if seconds < 3600:
        return f"{seconds // 60}m"
    return f"{seconds // 3600}h"


def _persist_peer(public_key: str, allowed_ip: str):
    """Appends a [Peer] block to wg*.conf (via sudo tee -a)."""
    entry = f"\n[Peer]\nPublicKey = {public_key}\nAllowedIPs = {allowed_ip}\n"

    subprocess.run(
        ["sudo", "tee", "-a", WG_CONFIG_PATH],
        input=entry,
        text=True,
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

def _remove_from_config(public_key: str):
    """
    Removes the matching [Peer] block from wg*.conf.
    Deletes from the [Peer] section header to the next section header
    or EOF if the public_key matches.
    """
    try:
        with open(WG_CONFIG_PATH, "r") as f:
            content = f.read()
    except OSError:
        return

    pattern = re.compile(
        r"\n?\[Peer\]\n(?:[^\[]*\n)*",  # Until the next section after the [Peer] start
        re.MULTILINE
    )

    def keep_block(match):
        block = match.group(0)
        if f"PublicKey = {public_key}" in block:
            return ""          # remove this block
        return block           # keep others

    new_content = pattern.sub(keep_block, content)

    # write with sudo tee (file owned by root)
    subprocess.check_call(
        ["sudo", "tee", WG_CONFIG_PATH],
        input=new_content,
        text=True,
        stdout=subprocess.DEVNULL,
    )


# ── Public API ─────────────────────────────────────────────

def get_peers():
    output = get_wg_dump_cached()
    if not output:
        return {"peers": []}

    lines = output.strip().split("\n")
    if len(lines) <= 1:
        return {"peers": []}

    now = int(time.time())
    peers = []

    for line in lines[1:]:
        parts = line.split()
        if len(parts) < 6:
            continue

        public_key  = parts[1]
        allowed_ips = parts[4]

        try:
            last_handshake = int(parts[5])
        except (ValueError, IndexError):
            last_handshake = 0

        if last_handshake == 0:
            handshake_age = None
            is_active     = False
        else:
            handshake_age = now - last_handshake
            is_active     = handshake_age < HANDSHAKE_ACTIVE_THRESHOLD

        peers.append({
            "public_key":            public_key,
            "allowed_ips":           allowed_ips,
            "last_handshake_epoch":  last_handshake,
            "handshake_age_seconds": handshake_age,
            "handshake_age_human":   _format_age(handshake_age),
            "is_active":             is_active,
        })

    return {"peers": peers}


def add_peer(public_key: str, allowed_ip: str):
    try:
        subprocess.check_call([
            "sudo", "wg", "set", WG_INTERFACE,
            "peer", public_key,
            "allowed-ips", allowed_ip,
        ])
        _persist_peer(public_key, allowed_ip)
        return {"status": "ok", "message": "peer added"}
    except subprocess.CalledProcessError as e:
        return {"status": "error", "message": str(e)}


def remove_peer(public_key: str):
    try:
        subprocess.check_call([
            "sudo", "wg", "set", WG_INTERFACE,
            "peer", public_key,
            "remove",
        ])
        _remove_from_config(public_key)
        return {"status": "ok", "message": "peer removed"}
    except subprocess.CalledProcessError as e:
        return {"status": "error", "message": str(e)}


def _allocate_ip() -> str:
    if not WG_SUBNET_BASE:
        raise RuntimeError("WG_SUBNET_BASE environment variable not set")

    peers = get_peers()["peers"]
    used  = {p["allowed_ips"].split("/")[0] for p in peers}

    for i in range(10, 200):
        candidate = f"{WG_SUBNET_BASE}{i}"
        if candidate not in used:
            return f"{candidate}/32"

    raise RuntimeError("No available IP in subnet range (.10–.199)")


def provision_peer():
    # 1. Generate keypair
    private_key = subprocess.check_output(["wg", "genkey"], text=True).strip()
    public_key  = subprocess.check_output(
        ["wg", "pubkey"], input=private_key, text=True
    ).strip()

    # 2. Allocate IP
    allowed_ip = _allocate_ip()

    # 3. Add to live interface
    subprocess.check_call([
        "sudo", "wg", "set", WG_INTERFACE,
        "peer", public_key,
        "allowed-ips", allowed_ip,
    ])

    # 4. Persist to config
    _persist_peer(public_key, allowed_ip)

    # 5. Read server public key
    with open(WG_SERVER_PUBLIC_KEY_PATH) as f:
        server_pub = f.read().strip()

    # 6. Build client config
    # DNS = first host in subnet (WG_SUBNET_BASE + "1")
    dns_ip = f"{WG_SUBNET_BASE}1" if WG_SUBNET_BASE else "10.66.66.1"
    config = (
        f"[Interface]\n"
        f"PrivateKey = {private_key}\n"
        f"Address = {allowed_ip}\n"
        f"DNS = {dns_ip}\n"
        f"\n"
        f"[Peer]\n"
        f"PublicKey = {server_pub}\n"
        f"Endpoint = {WG_ENDPOINT}\n"
        f"AllowedIPs = 0.0.0.0/0\n"
        f"PersistentKeepalive = 25"
    )

    # 7. Generate QR code
    img = qrcode.make(config)
    buffer = BytesIO()
    img.save(buffer, format="PNG")
    qr_base64 = base64.b64encode(buffer.getvalue()).decode()

    return {
        "public_key": public_key,
        "allowed_ip": allowed_ip,
        "config":     config,
        "qr":         qr_base64,
    }