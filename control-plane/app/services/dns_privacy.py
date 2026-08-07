import json
import subprocess


HELPER = "/usr/local/sbin/aegis-dns-privacy"


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

    output = result.stdout.strip()
    if not output:
        return {"status": "ok"}

    try:
        return json.loads(output)
    except json.JSONDecodeError:
        return {"status": "ok", "message": output}


def get_dns_privacy_status() -> dict:
    return _run_helper("status")


def set_dns_privacy_enabled(enabled: bool) -> dict:
    return _run_helper("enable" if enabled else "disable")


def flush_dns_cache() -> dict:
    return _run_helper("flush")
