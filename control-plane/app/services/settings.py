import json
import os
import threading


PROVISIONING_DEFAULTS_PATH = os.getenv(
    "PROVISIONING_DEFAULTS_PATH",
    "/opt/aegis/provisioning_defaults.json",
)

DEFAULT_PROVISIONING = {
    "label_prefix": "",
    "dns_enabled": True,
    "persistent_keepalive": 25,
    "mtu": None,
}

_lock = threading.Lock()


def _read_json(path: str) -> dict:
    try:
        with open(path) as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def get_provisioning_defaults() -> dict:
    data = {**DEFAULT_PROVISIONING, **_read_json(PROVISIONING_DEFAULTS_PATH)}
    data["label_prefix"] = str(data.get("label_prefix") or "")[:32]
    data["dns_enabled"] = bool(data.get("dns_enabled", True))
    keepalive = data.get("persistent_keepalive")
    data["persistent_keepalive"] = int(keepalive) if keepalive is not None else None
    mtu = data.get("mtu")
    data["mtu"] = int(mtu) if mtu not in (None, "") else None
    return data


def set_provisioning_defaults(
    label_prefix: str,
    dns_enabled: bool,
    persistent_keepalive: int | None,
    mtu: int | None,
) -> dict:
    with _lock:
        data = {
            "label_prefix": label_prefix.strip()[:32],
            "dns_enabled": bool(dns_enabled),
            "persistent_keepalive": persistent_keepalive,
            "mtu": mtu,
        }
        with open(PROVISIONING_DEFAULTS_PATH, "w") as f:
            json.dump(data, f, indent=2)
        return get_provisioning_defaults()
