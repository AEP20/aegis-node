# aegis-node/control-plane/app/main.py

from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from app.auth import verify_token
from app.services.health import get_health
from app.services.wg import get_peers, add_peer, remove_peer, provision_peer, ADMIN_PEER_IP
from app.services.monitor import (
    get_system_stats, get_services, get_wg_traffic, get_ssh_events, get_ssh_timeline,
    get_performance_metrics
)
from app.services.labels import get_labels, set_label, set_peer_metadata
from pydantic import BaseModel, validator
import os
import subprocess
import time
import re
import ipaddress

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
        raise ValueError("Invalid WireGuard public key format")
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
def add_peer_endpoint(data: AddPeerRequest):
    result = add_peer(data.public_key, data.allowed_ip)
    if result.get("status") == "error":
        raise HTTPException(status_code=500, detail=result.get("message", "Error adding peer"))
    set_peer_metadata(data.public_key, created_at=int(time.time()))
    return result


@app.post("/api/wg/remove", dependencies=[Depends(verify_token)])
def remove_peer_endpoint(data: RemovePeerRequest):
    result = remove_peer(data.public_key)
    if result.get("status") == "error":
        raise HTTPException(status_code=500, detail=result.get("message", "Error removing peer"))
    return result


@app.post("/api/wg/provision", dependencies=[Depends(verify_token)])
def provision():
    data = provision_peer()
    if "public_key" in data:
        set_peer_metadata(data["public_key"], created_at=int(time.time()))
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

