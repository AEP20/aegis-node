import json
import subprocess


HELPER = "/usr/local/sbin/aegis-node-ops"


def _run_helper(action: str, *args: str) -> dict:
    try:
        result = subprocess.run(
            ["sudo", HELPER, action, *args],
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


def get_operations_status() -> dict:
    return _run_helper("status")


def run_operations_action(action: str) -> dict:
    return _run_helper(action)


def set_logging_profile(profile: str) -> dict:
    action = f"logging-{profile}"
    return _run_helper(action)


def fail2ban_unban(ip: str) -> dict:
    return _run_helper("fail2ban-unban", ip)


def fail2ban_restart() -> dict:
    return _run_helper("restart-fail2ban")


def fail2ban_policy_set(
    sshd_maxretry: int,
    sshd_findtime: int,
    sshd_bantime: int,
    recidive_bantime: int,
) -> dict:
    return _run_helper(
        "fail2ban-policy-set",
        str(sshd_maxretry),
        str(sshd_findtime),
        str(sshd_bantime),
        str(recidive_bantime),
    )
