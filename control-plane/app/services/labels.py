# control-plane/app/services/labels.py
# Peer label + metadata store.
# Format: { pubkey: {"label": str, "created_at": int|None} }
# Legacy format (str value) is auto-migrated.

import json
import os
import threading
import time

LABELS_PATH = os.getenv("PEER_LABELS_PATH", "/opt/aegis/peer_labels.json")
_lock = threading.Lock()


def _read_raw() -> dict:
    try:
        with open(LABELS_PATH) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _migrate(raw: dict) -> dict:
    """Converts legacy str-value format to {"label": ..., "created_at": ...}."""
    result = {}
    for k, v in raw.items():
        if isinstance(v, str):
            result[k] = {"label": v, "created_at": None}
        elif isinstance(v, dict):
            result[k] = {"label": v.get("label", ""), "created_at": v.get("created_at")}
    return result


def get_labels() -> dict:
    """Returns all metadata: {pubkey: {"label": str, "created_at": int|None}}"""
    return _migrate(_read_raw())


def get_label_names() -> dict:
    """Returns only names (for backwards compatibility): {pubkey: label_str}"""
    return {k: v["label"] for k, v in get_labels().items()}


def set_label(public_key: str, label: str) -> None:
    with _lock:
        data = _migrate(_read_raw())
        label = label.strip()
        existing = data.get(public_key, {})
        if label:
            data[public_key] = {
                "label": label,
                "created_at": existing.get("created_at"),
            }
        else:
            # keep metadata if label is cleared, but empty the label field
            if existing.get("created_at"):
                data[public_key] = {"label": "", "created_at": existing["created_at"]}
            else:
                data.pop(public_key, None)
        _write(data)


def set_peer_metadata(public_key: str, label: str = None, created_at: int = None) -> None:
    """Create metadata for a new peer (called during provision)."""
    with _lock:
        data = _migrate(_read_raw())
        existing = data.get(public_key, {})
        data[public_key] = {
            "label":      label if label is not None else existing.get("label", ""),
            "created_at": created_at if created_at is not None else existing.get("created_at"),
        }
        _write(data)


def _write(data: dict) -> None:
    with open(LABELS_PATH, "w") as f:
        json.dump(data, f, indent=2)
