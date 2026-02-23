# control-plane/app/services/monitor.py

import subprocess
import os
import re
import time
from datetime import datetime, timedelta, date
from pathlib import Path

try:
    import maxminddb
except ImportError:
    maxminddb = None

_GEO_DB_PATH = os.getenv("GEO_DB_PATH", "/opt/aegis/GeoLite2-City.mmdb")
_geo_reader = None

def get_geo_info(ip: str) -> str:
    global _geo_reader
    if maxminddb is None or not Path(_GEO_DB_PATH).exists():
        return ""
    
    if _geo_reader is None:
        try:
            _geo_reader = maxminddb.open_database(_GEO_DB_PATH)
        except Exception:
            return ""

    try:
        match = _geo_reader.get(ip)
        if not match:
            return ""
        
        iso = match.get("country", {}).get("iso_code")
        city = match.get("city", {}).get("names", {}).get("en")
        
        if iso:
            flag = chr(ord(iso[0]) + 127397) + chr(ord(iso[1]) + 127397)
            if city:
                return f"{flag} {iso} · {city}"
            return f"{flag} {iso}"
    except Exception:
        pass
    return ""

# ── CPU: delta between two readings (simple cache) ──────────────
_cpu_last = {"total": 0, "idle": 0, "ts": 0}

def _read_cpu_stat():
    with open("/proc/stat") as f:
        parts = f.readline().split()
    user, nice, system, idle = int(parts[1]), int(parts[2]), int(parts[3]), int(parts[4])
    iowait = int(parts[5]) if len(parts) > 5 else 0
    total = user + nice + system + idle + iowait
    return total, idle

def _get_cpu_percent() -> float:
    global _cpu_last
    try:
        total, idle = _read_cpu_stat()
        prev_total = _cpu_last["total"]
        prev_idle  = _cpu_last["idle"]

        _cpu_last = {"total": total, "idle": idle, "ts": time.time()}

        d_total = total - prev_total
        d_idle  = idle  - prev_idle

        if d_total == 0:
            return 0.0
        return round((1 - d_idle / d_total) * 100, 1)
    except Exception:
        return 0.0

# ── Memory ───────────────────────────────────────────────────

def _get_memory():
    info = {}
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                key, val = line.split(":")
                info[key.strip()] = int(val.split()[0])  # kB

        total = info.get("MemTotal", 0)
        free  = info.get("MemFree", 0)
        buffers   = info.get("Buffers", 0)
        cached    = info.get("Cached", 0)
        s_reclaimable = info.get("SReclaimable", 0)

        used = total - free - buffers - cached - s_reclaimable
        used = max(used, 0)

        return {
            "total_mb":  round(total / 1024, 1),
            "used_mb":   round(used  / 1024, 1),
            "free_mb":   round((total - used) / 1024, 1),
            "percent":   round(used / total * 100, 1) if total else 0,
        }
    except Exception:
        return {"total_mb": 0, "used_mb": 0, "free_mb": 0, "percent": 0}

# ── Disk ─────────────────────────────────────────────────────

def _get_disk():
    try:
        result = subprocess.check_output(
            ["df", "-B1", "--output=size,used,avail", "/"],
            text=True
        ).strip().split("\n")
        # --output=size,used,avail → header + 1 data line (3 columns, no Filesystem col)
        size, used, avail = result[1].split()
        total = int(size)
        used  = int(used)
        return {
            "total_gb":  round(total / 1_073_741_824, 1),
            "used_gb":   round(used  / 1_073_741_824, 1),
            "percent":   round(used / total * 100, 1) if total else 0,
        }
    except Exception as e:
        return {"total_gb": 0, "used_gb": 0, "percent": 0, "_error": str(e)}

# ── Uptime ───────────────────────────────────────────────────

def _get_uptime():
    try:
        with open("/proc/uptime") as f:
            seconds = float(f.read().split()[0])
        return _format_uptime(int(seconds))
    except Exception:
        return "unknown"

def _format_uptime(seconds: int) -> str:
    d = seconds // 86400
    h = (seconds % 86400) // 3600
    m = (seconds % 3600)  // 60
    parts = []
    if d: parts.append(f"{d}d")
    if h: parts.append(f"{h}h")
    parts.append(f"{m}m")
    return " ".join(parts)

# ── Services ─────────────────────────────────────────────────

WG_INTERFACE = os.getenv("WG_INTERFACE", "wg0")

_SERVICES = [
    {"name": f"wg-quick@{WG_INTERFACE}", "label": f"wireguard ({WG_INTERFACE})"},
    {"name": "aegis-api",                 "label": "aegis api"},
    {"name": "unbound",                   "label": "unbound dns"},
    {"name": "ssh",                        "label": "openssh"},
    {"name": "netfilter-persistent",       "label": "iptables persist"},
]

def _service_status(name: str) -> str:
    try:
        rc = subprocess.run(
            ["systemctl", "is-active", name],
            capture_output=True, text=True
        ).returncode
        return "active" if rc == 0 else "inactive"
    except Exception:
        return "unknown"

def get_services():
    return [
        {
            "name":   s["name"],
            "label":  s["label"],
            "status": _service_status(s["name"]),
        }
        for s in _SERVICES
    ]

# ── WireGuard Traffic ────────────────────────────────────────

def get_wg_traffic():
    """
    Output format of `sudo wg show all transfer`:
    <interface> <pubkey> <rx_bytes> <tx_bytes>
    """
    try:
        output = subprocess.check_output(
            ["sudo", "wg", "show", "all", "transfer"],
            text=True
        ).strip()
    except Exception:
        return []

    peers = []
    for line in output.splitlines():
        parts = line.split()
        if len(parts) < 4:
            continue
        _, pubkey, rx_bytes, tx_bytes = parts[0], parts[1], int(parts[2]), int(parts[3])
        peers.append({
            "public_key":    pubkey,
            "public_key_short": pubkey[:16] + "…",
            "rx_bytes":      rx_bytes,
            "tx_bytes":      tx_bytes,
            "rx_human":      _bytes_human(rx_bytes),
            "tx_human":      _bytes_human(tx_bytes),
        })
    return peers

def _bytes_human(b: int) -> str:
    for unit in ["B", "KB", "MB", "GB"]:
        if b < 1024:
            return f"{b:.1f} {unit}"
        b /= 1024
    return f"{b:.1f} TB"

# ── SSH Activity ─────────────────────────────────────────────

_SSH_PATTERNS = [
    (re.compile(r"Accepted (?:publickey|password) for (\S+) from ([\d.]+) port (\d+)"),
     "success", "login"),
    (re.compile(r"Failed (?:password|publickey) for(?: invalid user)? (\S+) from ([\d.]+) port (\d+)"),
     "fail", "failed auth"),
    (re.compile(r"Invalid user (\S+) from ([\d.]+) port (\d+)"),
     "fail", "invalid user"),
    (re.compile(r"Disconnected from (?:authenticating |invalid )?user (\S+) ([\d.]+) port (\d+)"),
     "info", "disconnected"),
    (re.compile(r"Connection closed by authenticating user (\S+) ([\d.]+) port (\d+)"),
     "info", "conn closed"),
]

# syslog timestamp: e.g. "Feb 21 20:01:49"
_TS_PATTERN = re.compile(r"^(\w{3}\s+\d+\s+\d+:\d+:\d+)")

def get_ssh_events(limit: int = 60):
    log_files = ["/var/log/auth.log", "/var/log/auth.log.1"]
    events = []

    for path in log_files:
        if not Path(path).exists():
            continue
        try:
            # tail -n 2000 — for performance on large files
            lines = subprocess.check_output(
                ["sudo", "tail", "-n", "2000", path],
                text=True, stderr=subprocess.DEVNULL
            ).splitlines()
        except Exception:
            continue

        for line in lines:
            if "sshd" not in line:
                continue
            for pattern, level, label in _SSH_PATTERNS:
                m = pattern.search(line)
                if m:
                    ts_m = _TS_PATTERN.match(line)
                    ip = m.group(2)
                    events.append({
                        "timestamp": ts_m.group(1) if ts_m else "",
                        "level":     level,
                        "label":     label,
                        "user":      m.group(1),
                        "ip":        ip,
                        "port":      m.group(3),
                        "geo":       get_geo_info(ip),
                        "raw":       line.strip(),
                    })
                    break

    # Newest events first; get the last N
    events.reverse()
    return events[:limit]

# ── Reboot required ──────────────────────────────────────────

def _check_reboot_required() -> bool:
    return Path("/var/run/reboot-required").exists()


# ── Aggregate ────────────────────────────────────────────────

def get_system_stats():
    return {
        "cpu_percent":     _get_cpu_percent(),
        "memory":          _get_memory(),
        "disk":            _get_disk(),
        "uptime":          _get_uptime(),
        "reboot_required": _check_reboot_required(),
        "timestamp":       int(time.time()),
    }

def get_performance_metrics():
    # Load Average (1m, 5m, 15m)
    try:
        load = os.getloadavg()
    except Exception:
        load = (0.0, 0.0, 0.0)

    # Ping latency to 1.1.1.1
    ping_ms = None
    try:
        # ping -c 1 -W 1 1.1.1.1
        res = subprocess.check_output(["ping", "-c", "1", "-W", "1", "1.1.1.1"], text=True, stderr=subprocess.DEVNULL)
        m = re.search(r"time=([\d.]+)\s*ms", res)
        if m:
            ping_ms = float(m.group(1))
    except Exception:
        pass

    # WG0 Network Stats (Bytes & Drops)
    wg_rx, wg_tx = 0, 0
    wg_drop_rx, wg_drop_tx = 0, 0
    try:
        with open(f"/sys/class/net/{WG_INTERFACE}/statistics/rx_bytes") as f: wg_rx = int(f.read())
        with open(f"/sys/class/net/{WG_INTERFACE}/statistics/tx_bytes") as f: wg_tx = int(f.read())
        with open(f"/sys/class/net/{WG_INTERFACE}/statistics/rx_dropped") as f: wg_drop_rx = int(f.read())
        with open(f"/sys/class/net/{WG_INTERFACE}/statistics/tx_dropped") as f: wg_drop_tx = int(f.read())
    except Exception:
        pass

    return {
        "load_1m": round(load[0], 2),
        "load_5m": round(load[1], 2),
        "load_15m": round(load[2], 2),
        "cpu_cores": os.cpu_count() or 1,
        "ping_ms": ping_ms,
        "wg_rx_bytes": wg_rx,
        "wg_tx_bytes": wg_tx,
        "wg_rx_dropped": wg_drop_rx,
        "wg_tx_dropped": wg_drop_tx,
        "timestamp": time.time(),
    }


# ── SSH Login Timeline ────────────────────────────────────────

_MONTH_MAP = {
    "Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4,
    "May": 5, "Jun": 6, "Jul": 7, "Aug": 8,
    "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12,
}
_ACCEPT_RE = re.compile(r"Accepted (?:publickey|password) for (\S+) from ([\d.]+)")
_TS_SHORT  = re.compile(r"^(\w{3})\s+(\d+)\s+(\d+:\d+:\d+)")

def get_ssh_timeline(tz_offset_minutes: int = 0):
    """
    Returns successful SSH logins from the last 7 days in {date, count, logins[]} format.

    tz_offset_minutes: client's UTC offset in minutes.
    Resolves auth.log UTC timestamps to local time to correctly calculate day boundaries and dot positions.
    """
    from datetime import timezone as _tz

    tz_delta  = timedelta(minutes=tz_offset_minutes)

    # Server runs in UTC; set "today" and 7-day window relative to local time
    now_local   = datetime.now(_tz.utc) + tz_delta
    today_local = now_local.date()

    days      = [(today_local - timedelta(days=i)) for i in range(6, -1, -1)]
    day_index = {d: {"date": d.strftime("%b %d"), "count": 0, "logins": []} for d in days}

    log_files = ["/var/log/auth.log", "/var/log/auth.log.1"]
    year_utc  = datetime.now(_tz.utc).year  # log year is still UTC-referenced

    for path in log_files:
        if not Path(path).exists():
            continue
        try:
            lines = subprocess.check_output(
                ["sudo", "tail", "-n", "5000", path],
                text=True, stderr=subprocess.DEVNULL
            ).splitlines()
        except Exception:
            continue

        for line in lines:
            if "sshd" not in line or "Accepted" not in line:
                continue
            ts_m = _TS_SHORT.match(line)
            if not ts_m:
                continue
            month_str, day_str, time_str = ts_m.group(1), ts_m.group(2), ts_m.group(3)
            month = _MONTH_MAP.get(month_str)
            if not month:
                continue
            try:
                h, mi, s = [int(x) for x in time_str.split(":")]
                # UTC datetime -> local datetime (add tz_offset)
                log_dt_utc   = datetime(year_utc, month, int(day_str), h, mi, s)
                log_dt_local = log_dt_utc + tz_delta
                log_date     = log_dt_local.date()
                local_time   = log_dt_local.strftime("%H:%M:%S")
            except (ValueError, OverflowError):
                continue

            if log_date not in day_index:
                continue

            m = _ACCEPT_RE.search(line)
            if m:
                ip = m.group(2)
                day_index[log_date]["count"] += 1
                day_index[log_date]["logins"].append({
                    "user": m.group(1),
                    "ip":   ip,
                    "geo":  get_geo_info(ip),
                    "time": local_time,   # local time -> correct position on axis
                })

    return list(day_index.values())

