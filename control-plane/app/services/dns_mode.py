import json
import subprocess


HELPER = "/usr/local/sbin/aegis-dns-mode"


def _run_helper(action: str) -> dict:
    try:
        result = subprocess.run(
            ["sudo", HELPER, action],
            capture_output=True,
            text=True,
            timeout=20,
            check=True,
        )
    except subprocess.CalledProcessError as e:
        message = (e.stderr or e.stdout or str(e)).strip()
        return {"status": "error", "message": message}
    except Exception as e:
        return {"status": "error", "message": str(e)}

    try:
        return json.loads(result.stdout.strip() or "{}")
    except json.JSONDecodeError:
        return {"status": "ok", "message": result.stdout.strip()}


def get_dns_mode_status() -> dict:
    return _run_helper("status")


def set_dns_mode(preset: str, dot_enabled: bool) -> dict:
    mode = "dot" if dot_enabled else "plain"
    return _run_helper(f"set-{preset}-{mode}")
