# control-plane/app/services/wg.py

import subprocess
import time
import base64
import re
import qrcode
from io import BytesIO
import os


from app.services.constants import HANDSHAKE_ACTIVE_THRESHOLD

VPN_TRANSPORT = os.getenv("VPN_TRANSPORT", "wireguard").strip().lower()
VPN_TRANSPORT_LABEL = os.getenv(
    "VPN_TRANSPORT_LABEL",
    "AmneziaWG" if VPN_TRANSPORT == "amneziawg" else "WireGuard",
)
VPN_CLI = os.getenv("VPN_CLI", "awg" if VPN_TRANSPORT == "amneziawg" else "wg")
VPN_INTERFACE = os.getenv("VPN_INTERFACE") or os.getenv("WG_INTERFACE", "wg0")
VPN_SUBNET_BASE = os.getenv("VPN_SUBNET_BASE") or os.getenv("WG_SUBNET_BASE")
VPN_ENDPOINT = os.getenv("VPN_ENDPOINT") or os.getenv("WG_ENDPOINT")
VPN_SERVER_IP = os.getenv("VPN_SERVER_IP") or (
    f"{VPN_SUBNET_BASE}1" if VPN_SUBNET_BASE else "10.66.66.1"
)
VPN_SERVICE_NAME = os.getenv(
    "VPN_SERVICE_NAME",
    f"awg-quick@{VPN_INTERFACE}" if VPN_TRANSPORT == "amneziawg" else f"wg-quick@{VPN_INTERFACE}",
)

VPN_SERVER_PUBLIC_KEY_PATH = os.getenv("VPN_SERVER_PUBLIC_KEY_PATH") or os.getenv(
    "WG_SERVER_PUBLIC_KEY_PATH",
    "/etc/amnezia/amneziawg/server_public.key"
    if VPN_TRANSPORT == "amneziawg"
    else "/etc/wireguard/server_public.key",
)
VPN_CONFIG_PATH = os.getenv("VPN_CONFIG_PATH") or os.getenv(
    "WG_CONFIG_PATH",
    f"/etc/amnezia/amneziawg/{VPN_INTERFACE}.conf"
    if VPN_TRANSPORT == "amneziawg"
    else f"/etc/wireguard/{VPN_INTERFACE}.conf",
)

# Admin peer IP: subnet base + .2 (static IP assigned during bootstrap)
ADMIN_PEER_IP = os.getenv("ADMIN_PEER_IP") or (
    (VPN_SUBNET_BASE + "2") if VPN_SUBNET_BASE else "10.66.66.2"
)

# Backward-compatible names imported by older modules/tests.
WG_INTERFACE = VPN_INTERFACE
WG_SUBNET_BASE = VPN_SUBNET_BASE
WG_ENDPOINT = VPN_ENDPOINT
WG_SERVER_PUBLIC_KEY_PATH = VPN_SERVER_PUBLIC_KEY_PATH
WG_CONFIG_PATH = VPN_CONFIG_PATH

AMNEZIAWG_KEYS = ("Jc", "Jmin", "Jmax", "S1", "S2", "H1", "H2", "H3", "H4")


# ── Helpers ────────────────────────────────────────────────

_dump_cache = {"output": None, "timestamp": 0}

def get_wg_dump_cached(ttl=2) -> str:
    global _dump_cache
    now = time.time()
    if _dump_cache["output"] and (now - _dump_cache["timestamp"]) < ttl:
        return _dump_cache["output"]

    try:
        output = subprocess.check_output(
            ["sudo", VPN_CLI, "show", "all", "dump"],
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
    """Appends a [Peer] block to the active VPN backend config."""
    entry = f"\n[Peer]\nPublicKey = {public_key}\nAllowedIPs = {allowed_ip}\n"

    subprocess.run(
        ["sudo", "tee", "-a", VPN_CONFIG_PATH],
        input=entry,
        text=True,
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

def _remove_from_config(public_key: str):
    """
    Removes the matching [Peer] block from the active backend config.
    Deletes from the [Peer] section header to the next section header
    or EOF if the public_key matches.
    """
    try:
        with open(VPN_CONFIG_PATH, "r") as f:
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
        ["sudo", "tee", VPN_CONFIG_PATH],
        input=new_content,
        text=True,
        stdout=subprocess.DEVNULL,
    )


# ── Public API ─────────────────────────────────────────────

def get_transport_info():
    return {
        "transport": VPN_TRANSPORT,
        "transport_label": VPN_TRANSPORT_LABEL,
        "interface": VPN_INTERFACE,
        "cli": VPN_CLI,
        "endpoint": VPN_ENDPOINT,
        "config_path": VPN_CONFIG_PATH,
        "service_name": VPN_SERVICE_NAME,
        "server_ip": VPN_SERVER_IP,
    }

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
            "sudo", VPN_CLI, "set", VPN_INTERFACE,
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
            "sudo", VPN_CLI, "set", VPN_INTERFACE,
            "peer", public_key,
            "remove",
        ])
        _remove_from_config(public_key)
        return {"status": "ok", "message": "peer removed"}
    except subprocess.CalledProcessError as e:
        return {"status": "error", "message": str(e)}


def _allocate_ip() -> str:
    if not VPN_SUBNET_BASE:
        raise RuntimeError("VPN_SUBNET_BASE environment variable not set")

    peers = get_peers()["peers"]
    used  = {p["allowed_ips"].split("/")[0] for p in peers}

    for i in range(10, 200):
        candidate = f"{VPN_SUBNET_BASE}{i}"
        if candidate not in used:
            return f"{candidate}/32"

    raise RuntimeError("No available IP in subnet range (.10–.199)")


def _read_amneziawg_params_from_config() -> dict:
    params = {}
    try:
        with open(VPN_CONFIG_PATH, "r") as f:
            for line in f:
                key, _, value = line.partition("=")
                key = key.strip()
                if key in AMNEZIAWG_KEYS:
                    params[key] = value.strip()
    except OSError:
        pass
    return params


def _amneziawg_params() -> dict:
    params = {}
    for key in AMNEZIAWG_KEYS:
        env_key = f"AMNEZIAWG_{key.upper()}"
        value = os.getenv(env_key)
        if value not in (None, ""):
            params[key] = value

    if len(params) < len(AMNEZIAWG_KEYS):
        params.update({k: v for k, v in _read_amneziawg_params_from_config().items() if k not in params})

    return params


def _client_config(private_key: str, allowed_ip: str, server_pub: str) -> str:
    dns_ip = VPN_SERVER_IP
    interface_lines = [
        "[Interface]",
        f"PrivateKey = {private_key}",
        f"Address = {allowed_ip}",
        f"DNS = {dns_ip}",
    ]

    if VPN_TRANSPORT == "amneziawg":
        params = _amneziawg_params()
        for key in AMNEZIAWG_KEYS:
            if key in params:
                interface_lines.append(f"{key} = {params[key]}")

    peer_lines = [
        "",
        "[Peer]",
        f"PublicKey = {server_pub}",
        f"Endpoint = {VPN_ENDPOINT}",
        "AllowedIPs = 0.0.0.0/0",
        "PersistentKeepalive = 25",
    ]

    return "\n".join(interface_lines + peer_lines)


def _linux_install_command(config: str) -> str:
    if VPN_TRANSPORT == "amneziawg":
        config_path = f"/etc/amnezia/amneziawg/{VPN_INTERFACE}.conf"
        return (
            "sudo apt update && sudo apt install -y software-properties-common && \\\n"
            "sudo add-apt-repository -y ppa:amnezia/ppa && \\\n"
            "sudo apt update && sudo apt install -y amneziawg && \\\n"
            "sudo mkdir -p /etc/amnezia/amneziawg && \\\n"
            f"sudo sh -c \"cat > {config_path} <<'EOF'\n"
            f"{config}\n"
            "EOF\" && \\\n"
            f"sudo systemctl enable --now awg-quick@{VPN_INTERFACE}"
        )

    config_path = f"/etc/wireguard/{VPN_INTERFACE}.conf"
    return (
        "sudo apt update && sudo apt install -y wireguard resolvconf && \\\n"
        f"sudo sh -c \"cat > {config_path} <<'EOF'\n"
        f"{config}\n"
        "EOF\" && \\\n"
        f"sudo systemctl enable --now wg-quick@{VPN_INTERFACE}"
    )


def provision_peer():
    # 1. Generate keypair
    private_key = subprocess.check_output([VPN_CLI, "genkey"], text=True).strip()
    public_key  = subprocess.check_output(
        [VPN_CLI, "pubkey"], input=private_key, text=True
    ).strip()

    # 2. Allocate IP
    allowed_ip = _allocate_ip()

    # 3. Add to live interface
    subprocess.check_call([
        "sudo", VPN_CLI, "set", VPN_INTERFACE,
        "peer", public_key,
        "allowed-ips", allowed_ip,
    ])

    # 4. Persist to config
    _persist_peer(public_key, allowed_ip)

    # 5. Read server public key
    with open(VPN_SERVER_PUBLIC_KEY_PATH) as f:
        server_pub = f.read().strip()

    # 6. Build client config
    config = _client_config(private_key, allowed_ip, server_pub)

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
        "transport":  VPN_TRANSPORT,
        "transport_label": VPN_TRANSPORT_LABEL,
        "interface":  VPN_INTERFACE,
        "endpoint":   VPN_ENDPOINT,
        "client_app": "AmneziaWG / Amnezia VPN" if VPN_TRANSPORT == "amneziawg" else "WireGuard",
        "install_command": _linux_install_command(config),
    }
