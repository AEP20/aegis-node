# aegis-node/control-plane/app/main.py

from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from app.auth import verify_token
from app.services.health import get_health
from app.services.wg import get_peers, add_peer, remove_peer, provision_peer, ADMIN_PEER_IP
from app.services.monitor import (
    get_system_stats, get_services, get_wg_traffic, get_ssh_events, get_ssh_timeline,
    get_performance_metrics, get_fail2ban_status
)
from app.services.dns_privacy import (
    get_dns_privacy_status, set_dns_privacy_enabled, flush_dns_cache
)
from app.services.dns_mode import get_dns_mode_status, set_dns_mode
from app.services.access_control import get_access_control_status, rotate_access_token
from app.services.node_ops import (
    get_operations_status, run_operations_action, set_logging_profile,
    fail2ban_unban, fail2ban_restart, fail2ban_policy_set
)
from app.services.labels import get_labels, set_label, set_peer_metadata
from app.services.settings import get_provisioning_defaults, set_provisioning_defaults
from pydantic import BaseModel, validator
import os
import subprocess
import time
import re
import ipaddress
from typing import List

app = FastAPI(title="Aegis Control Plane")

# --- Static frontend ---
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
if os.path.isdir(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    @app.get("/", include_in_schema=False)
    def root():
        return FileResponse(os.path.join(STATIC_DIR, "index.html"))


# --- Request models ---

def _validate_pubkey(v: str) -> str:
    if len(v) != 44 or not re.match(r"^[A-Za-z0-9+/]{43}=$", v):
        raise ValueError("Invalid VPN public key format")
    return v

def _validate_cidr(v: str) -> str:
    try:
        ipaddress.ip_network(v, strict=False)
    except ValueError:
        raise ValueError("Invalid CIDR format")
    return v

class AddPeerRequest(BaseModel):
    public_key: str
    allowed_ip: str

    @validator("public_key")
    def validate_pk(cls, v): return _validate_pubkey(v)

    @validator("allowed_ip")
    def validate_ip(cls, v): return _validate_cidr(v)

class RemovePeerRequest(BaseModel):
    public_key: str

    @validator("public_key")
    def validate_pk(cls, v): return _validate_pubkey(v)

class SetLabelRequest(BaseModel):
    public_key: str
    label: str

    @validator("public_key")
    def validate_pk(cls, v): return _validate_pubkey(v)


class DnsPrivacyRequest(BaseModel):
    enabled: bool


class OperationsActionRequest(BaseModel):
    action: str

    @validator("action")
    def validate_action(cls, v):
        allowed = {"restart-vpn", "restart-api", "restart-dns", "dkms-check", "save-iptables"}
        if v not in allowed:
            raise ValueError("Invalid operations action")
        return v


class LoggingProfileRequest(BaseModel):
    profile: str

    @validator("profile")
    def validate_profile(cls, v):
        allowed = {"standard", "minimal"}
        if v not in allowed:
            raise ValueError("Invalid logging profile")
        return v


class Fail2banUnbanRequest(BaseModel):
    ip: str

    @validator("ip")
    def validate_ip_address(cls, v):
        try:
            ipaddress.ip_address(v)
        except ValueError:
            raise ValueError("Invalid IP address")
        return v


class Fail2banPolicyRequest(BaseModel):
    sshd_maxretry: int
    sshd_findtime: int
    sshd_bantime: int
    recidive_bantime: int

    @validator("sshd_maxretry")
    def validate_maxretry(cls, v):
        if v < 1 or v > 50:
            raise ValueError("sshd_maxretry must be between 1 and 50")
        return v

    @validator("sshd_findtime")
    def validate_findtime(cls, v):
        if v < 60 or v > 86400:
            raise ValueError("sshd_findtime must be between 60 and 86400 seconds")
        return v

    @validator("sshd_bantime")
    def validate_bantime(cls, v):
        if v < 60 or v > 2592000:
            raise ValueError("sshd_bantime must be between 60 and 2592000 seconds")
        return v

    @validator("recidive_bantime")
    def validate_recidive_bantime(cls, v):
        if v < 3600 or v > 7776000:
            raise ValueError("recidive_bantime must be between 3600 and 7776000 seconds")
        return v


class DnsModeRequest(BaseModel):
    preset: str
    dot_enabled: bool

    @validator("preset")
    def validate_preset(cls, v):
        allowed = {"cloudflare", "quad9", "google"}
        if v not in allowed:
            raise ValueError("Invalid DNS preset")
        return v


class ProvisioningDefaultsRequest(BaseModel):
    label_prefix: str = ""
    dns_enabled: bool = True
    persistent_keepalive: int | None = 25
    mtu: int | None = None

    @validator("label_prefix")
    def validate_prefix(cls, v):
        return (v or "").strip()[:32]

    @validator("persistent_keepalive")
    def validate_keepalive(cls, v):
        if v is None:
            return v
        if v < 0 or v > 3600:
            raise ValueError("Persistent keepalive must be between 0 and 3600")
        return v

    @validator("mtu")
    def validate_mtu(cls, v):
        if v is None:
            return v
        if v < 576 or v > 1500:
            raise ValueError("MTU must be between 576 and 1500")
        return v


class PeerCleanupRequest(BaseModel):
    public_keys: List[str]
    days: int = 90

    @validator("public_keys")
    def validate_keys(cls, values):
        if len(values) > 50:
            raise ValueError("Too many peers selected")
        for v in values:
            _validate_pubkey(v)
        return values

    @validator("days")
    def validate_days(cls, v):
        if v < 1 or v > 365:
            raise ValueError("Days must be between 1 and 365")
        return v


# --- Helper: peer + metadata merge ---

def _enrich_peers(peers: list) -> list:
    labels = get_labels()
    admin_base = ADMIN_PEER_IP.split("/")[0]  # "10.66.66.2"

    for p in peers:
        meta     = labels.get(p["public_key"], {})
        peer_ip  = p.get("allowed_ips", p.get("allowed_ip", "")).split("/")[0]
        label    = meta.get("label", "") if isinstance(meta, dict) else str(meta)

        # Admin peer: auto-assign label if none exists
        if not label and peer_ip == admin_base:
            label = "admin-bootstrap"

        p["label"]      = label
        p["created_at"] = meta.get("created_at") if isinstance(meta, dict) else None
        p["is_admin"]   = (peer_ip == admin_base)

    return peers


# --- API routes ---

@app.get("/api/health", dependencies=[Depends(verify_token)])
def health():
    return get_health()


@app.get("/api/peers", dependencies=[Depends(verify_token)])
def peers():
    data = get_peers()
    data["peers"] = _enrich_peers(data.get("peers", []))
    return data


@app.post("/api/wg/add", dependencies=[Depends(verify_token)])
@app.post("/api/vpn/add", dependencies=[Depends(verify_token)])
def add_peer_endpoint(data: AddPeerRequest):
    result = add_peer(data.public_key, data.allowed_ip)
    if result.get("status") == "error":
        raise HTTPException(status_code=500, detail=result.get("message", "Error adding peer"))
    set_peer_metadata(data.public_key, created_at=int(time.time()))
    return result


@app.post("/api/wg/remove", dependencies=[Depends(verify_token)])
@app.post("/api/vpn/remove", dependencies=[Depends(verify_token)])
def remove_peer_endpoint(data: RemovePeerRequest):
    result = remove_peer(data.public_key)
    if result.get("status") == "error":
        raise HTTPException(status_code=500, detail=result.get("message", "Error removing peer"))
    return result


@app.post("/api/wg/provision", dependencies=[Depends(verify_token)])
@app.post("/api/vpn/provision", dependencies=[Depends(verify_token)])
def provision():
    data = provision_peer()
    if "public_key" in data:
        defaults = data.get("provisioning_defaults") or get_provisioning_defaults()
        label = ""
        prefix = (defaults.get("label_prefix") or "").strip()
        if prefix:
            peer_ip = data.get("allowed_ip", "").split("/")[0]
            suffix = peer_ip.rsplit(".", 1)[-1] if peer_ip else "peer"
            label = f"{prefix}-{suffix}"
        set_peer_metadata(data["public_key"], label=label, created_at=int(time.time()))
    return data


# --- Label routes ---

@app.get("/api/peers/labels", dependencies=[Depends(verify_token)])
def peer_labels():
    return get_labels()


@app.post("/api/peers/label", dependencies=[Depends(verify_token)])
def peer_label(data: SetLabelRequest):
    set_label(data.public_key, data.label)
    return {"status": "ok"}


# --- Monitor routes ---

@app.get("/api/monitor/system", dependencies=[Depends(verify_token)])
def monitor_system():
    return get_system_stats()


@app.get("/api/monitor/services", dependencies=[Depends(verify_token)])
def monitor_services():
    return {"services": get_services()}


@app.get("/api/monitor/traffic", dependencies=[Depends(verify_token)])
def monitor_traffic():
    peers  = _enrich_peers(get_wg_traffic())
    return {"peers": peers}


@app.get("/api/monitor/ssh", dependencies=[Depends(verify_token)])
def monitor_ssh():
    return {"events": get_ssh_events()}


@app.get("/api/monitor/ssh/timeline", dependencies=[Depends(verify_token)])
def monitor_ssh_timeline(tz_offset: int = Query(0, ge=-720, le=840)):
    """
    tz_offset: comes from client (-new Date().getTimezoneOffset()).
    Default is 0 (UTC).
    """
    return {"timeline": get_ssh_timeline(tz_offset)}


@app.get("/api/monitor/fail2ban", dependencies=[Depends(verify_token)])
def monitor_fail2ban():
    return get_fail2ban_status()


@app.get("/api/monitor/performance", dependencies=[Depends(verify_token)])
def api_monitor_performance():
    metrics = get_performance_metrics()
    
    # Calculate active vs total users
    peers_data = get_peers()
    active_count = sum(1 for p in peers_data.get("peers", []) if p.get("is_active"))
    total_count = len(peers_data.get("peers", []))
    
    metrics["active_peers"] = active_count
    metrics["total_peers"] = total_count
    
    return metrics


@app.get("/api/system/dns-privacy", dependencies=[Depends(verify_token)])
def dns_privacy_status():
    return get_dns_privacy_status()


@app.post("/api/system/dns-privacy", dependencies=[Depends(verify_token)])
def dns_privacy_set(data: DnsPrivacyRequest):
    result = set_dns_privacy_enabled(data.enabled)
    if result.get("status") == "error":
        raise HTTPException(status_code=500, detail=result.get("message", "dns privacy update failed"))
    return result


@app.post("/api/system/dns-privacy/flush", dependencies=[Depends(verify_token)])
def dns_privacy_flush():
    result = flush_dns_cache()
    if result.get("status") == "error":
        raise HTTPException(status_code=500, detail=result.get("message", "dns cache flush failed"))
    return result


@app.get("/api/system/dns-mode", dependencies=[Depends(verify_token)])
def dns_mode_status():
    result = get_dns_mode_status()
    if result.get("status") == "error":
        raise HTTPException(status_code=500, detail=result.get("message", "dns mode status failed"))
    return result


@app.post("/api/system/dns-mode", dependencies=[Depends(verify_token)])
def dns_mode_set(data: DnsModeRequest):
    result = set_dns_mode(data.preset, data.dot_enabled)
    if result.get("status") == "error":
        raise HTTPException(status_code=500, detail=result.get("message", "dns mode update failed"))
    return result


@app.get("/api/system/provisioning-defaults", dependencies=[Depends(verify_token)])
def provisioning_defaults_status():
    return {"status": "ok", "defaults": get_provisioning_defaults()}


@app.post("/api/system/provisioning-defaults", dependencies=[Depends(verify_token)])
def provisioning_defaults_set(data: ProvisioningDefaultsRequest):
    defaults = set_provisioning_defaults(
        label_prefix=data.label_prefix,
        dns_enabled=data.dns_enabled,
        persistent_keepalive=data.persistent_keepalive,
        mtu=data.mtu,
    )
    return {"status": "ok", "defaults": defaults}


def _stale_peers(days: int) -> list:
    days = max(1, min(days, 365))
    now = int(time.time())
    cutoff = days * 86400
    peers_data = get_peers()
    peers_data["peers"] = _enrich_peers(peers_data.get("peers", []))
    stale = []
    for peer in peers_data["peers"]:
        if peer.get("is_admin"):
            continue
        last = peer.get("last_handshake_epoch") or 0
        created = peer.get("created_at") or 0
        age = None
        reason = "never connected"
        if last > 0:
            age = now - last
            reason = "last handshake"
        elif created > 0:
            age = now - created
            reason = "created"
        if age is not None and age > cutoff:
            stale.append({**peer, "stale_reason": reason, "stale_age_seconds": age})
    return stale


@app.get("/api/peers/stale", dependencies=[Depends(verify_token)])
def stale_peers(days: int = Query(90, ge=1, le=365)):
    return {"status": "ok", "days": days, "peers": _stale_peers(days)}


@app.post("/api/peers/stale/remove", dependencies=[Depends(verify_token)])
def stale_peers_remove(data: PeerCleanupRequest):
    stale_by_key = {p["public_key"]: p for p in _stale_peers(data.days)}
    removed, skipped = [], []
    for key in data.public_keys:
        if key not in stale_by_key:
            skipped.append(key)
            continue
        result = remove_peer(key)
        if result.get("status") == "ok":
            removed.append(key)
        else:
            skipped.append(key)
    return {"status": "ok", "removed": removed, "skipped": skipped}


@app.get("/api/system/operations", dependencies=[Depends(verify_token)])
def operations_status():
    result = get_operations_status()
    if result.get("status") == "error":
        raise HTTPException(status_code=500, detail=result.get("message", "operations status failed"))
    return result


@app.post("/api/system/operations/action", dependencies=[Depends(verify_token)])
def operations_action(data: OperationsActionRequest):
    result = run_operations_action(data.action)
    if result.get("status") == "error":
        raise HTTPException(status_code=500, detail=result.get("message", "operations action failed"))
    return result


@app.get("/api/system/access-control", dependencies=[Depends(verify_token)])
def access_control_status():
    return get_access_control_status()


@app.post("/api/system/access-control/rotate-token", dependencies=[Depends(verify_token)])
def access_control_rotate_token():
    result = rotate_access_token()
    if result.get("status") == "error":
        raise HTTPException(status_code=500, detail=result.get("message", "token rotation failed"))
    return result


@app.post("/api/system/logging-profile", dependencies=[Depends(verify_token)])
def logging_profile_set(data: LoggingProfileRequest):
    result = set_logging_profile(data.profile)
    if result.get("status") == "error":
        raise HTTPException(status_code=500, detail=result.get("message", "logging profile update failed"))
    return result


@app.post("/api/system/fail2ban/unban", dependencies=[Depends(verify_token)])
def fail2ban_unban_endpoint(data: Fail2banUnbanRequest):
    result = fail2ban_unban(data.ip)
    if result.get("status") == "error":
        raise HTTPException(status_code=500, detail=result.get("message", "fail2ban unban failed"))
    return result


@app.post("/api/system/fail2ban/restart", dependencies=[Depends(verify_token)])
def fail2ban_restart_endpoint():
    result = fail2ban_restart()
    if result.get("status") == "error":
        raise HTTPException(status_code=500, detail=result.get("message", "fail2ban restart failed"))
    return result


@app.post("/api/system/fail2ban/policy", dependencies=[Depends(verify_token)])
def fail2ban_policy_endpoint(data: Fail2banPolicyRequest):
    result = fail2ban_policy_set(
        data.sshd_maxretry,
        data.sshd_findtime,
        data.sshd_bantime,
        data.recidive_bantime,
    )
    if result.get("status") == "error":
        raise HTTPException(status_code=500, detail=result.get("message", "fail2ban policy update failed"))
    return result



# --- System actions ---

@app.post("/api/system/reboot", dependencies=[Depends(verify_token)])
def system_reboot():
    """
    Restarts the server in 5 minutes.
    Triggered from the dashboard banner when reboot is required.
    """
    try:
        subprocess.run(["sudo", "shutdown", "-r", "+5"], check=True)
        return {"status": "ok", "message": "Server will reboot in 5 minutes."}
    except subprocess.CalledProcessError as e:
        raise HTTPException(status_code=500, detail=f"shutdown failed: {e}")


@app.delete("/api/system/reboot", dependencies=[Depends(verify_token)])
def system_reboot_cancel():
    """Cancels a scheduled reboot."""
    try:
        subprocess.run(["sudo", "shutdown", "-c"], check=True)
        return {"status": "ok", "message": "Scheduled reboot cancelled."}
    except subprocess.CalledProcessError as e:
        raise HTTPException(status_code=500, detail=f"shutdown -c failed: {e}")
