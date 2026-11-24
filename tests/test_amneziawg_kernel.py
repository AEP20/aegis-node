"""Exercise the real Ansible tasks locally with isolated DKMS/modinfo stubs.

Run: python3 -m unittest discover -s tests -p 'test_amneziawg_kernel.py'
Requires ansible-playbook; never installs packages or touches the host kernel.
"""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
ROLE = ROOT / "ansible/roles/amneziawg"


@unittest.skipUnless(shutil.which("ansible-playbook"), "Ansible is required")
class AmneziaWGKernelTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="aegis-kernel-test-")
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        (self.directory / "ansible.cfg").write_text("[defaults]\n")

    def run_tasks(self, task_file, *, facts=None, variables=None):
        play = [{
            "hosts": "localhost",
            "connection": "local",
            "gather_facts": False,
            "vars_files": [str(ROLE / "defaults/main.yml")],
            "vars": {
                "ansible_python_interpreter": sys.executable,
                "ansible_facts": facts or {
                    "distribution": "Ubuntu",
                    "distribution_version": "22.04",
                    "kernel": "5.15.0-198-generic",
                },
            },
            "environment": {
                "PATH": str(self.directory) + os.pathsep + os.environ["PATH"],
            },
            "tasks": [{"include_tasks": str(ROLE / "tasks" / task_file)}],
        }]
        playbook = self.directory / "playbook.json"
        playbook.write_text(json.dumps(play))
        result = subprocess.run(
            ["ansible-playbook", "-v", "-i", "localhost,", str(playbook),
             "-e", json.dumps(variables or {})],
            cwd=self.directory,
            env={
                **os.environ,
                "ANSIBLE_CONFIG": str(self.directory / "ansible.cfg"),
                "ANSIBLE_LOCAL_TEMP": str(self.directory / "local"),
                "ANSIBLE_REMOTE_TEMP": str(self.directory / "remote"),
                "ANSIBLE_NOCOLOR": "1",
            },
            text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            timeout=60,
        )
        return result

    def stub_kernel_commands(self, *, status=None, mode="success"):
        status = status or (
            "amneziawg/1.0.0, 5.15.0-190-generic, x86_64: installed\n"
        )
        script = f"""#!{sys.executable}
import pathlib
import sys
directory = pathlib.Path(__file__).resolve().parent
tool = pathlib.Path(__file__).name
args = sys.argv[1:]
with (directory / 'calls').open('a') as calls:
    calls.write(tool + ' ' + ' '.join(args) + '\\n')
if tool == 'modinfo':
    assert args == ['-k', '5.15.0-198-generic', '-F', 'filename', 'amneziawg']
    if not (directory / 'installed').exists():
        sys.exit(1)
    print('/lib/modules/5.15.0-198-generic/updates/dkms/amneziawg.ko')
elif args == ['status', '-m', 'amneziawg']:
    print({status!r}, end='')
else:
    assert args == ['install', '-m', 'amneziawg', '-v', '1.0.0', '-k', '5.15.0-198-generic']
    if {mode!r} == 'failure':
        print('simulated kernel build failure', file=sys.stderr)
        sys.exit(10)
    if {mode!r} != 'no_module':
        (directory / 'installed').touch()
"""
        for tool in ("dkms", "modinfo"):
            path = self.directory / tool
            path.write_text(script)
            path.chmod(0o755)

    def test_ga_header_selection(self):
        for release, kernel in (("22.04", "5.15.0-198-generic"),
                                ("24.04", "6.8.0-90-generic")):
            with self.subTest(release=release):
                result = self.run_tasks("kernel-headers.yml", facts={
                    "distribution": "Ubuntu", "distribution_version": release,
                    "kernel": kernel,
                })
                self.assertEqual(result.returncode, 0, result.stdout)

    def test_unknown_and_hwe_kernels_require_explicit_selection(self):
        for kernel in ("6.8.0-90-generic", "5.15.0-198-aws"):
            with self.subTest(kernel=kernel):
                result = self.run_tasks("kernel-headers.yml", facts={
                    "distribution": "Ubuntu", "distribution_version": "22.04",
                    "kernel": kernel,
                })
                self.assertNotEqual(result.returncode, 0, result.stdout)
                self.assertIn("Set amneziawg_kernel_headers_metapackage", result.stdout)

    def test_explicit_hwe_tracking_package(self):
        result = self.run_tasks("kernel-headers.yml", variables={
            "amneziawg_kernel_headers_metapackage": "linux-headers-generic-hwe-22.04",
        }, facts={
            "distribution": "Ubuntu", "distribution_version": "22.04",
            "kernel": "6.8.0-90-generic",
        })
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_versioned_headers_do_not_satisfy_future_update_policy(self):
        result = self.run_tasks("kernel-headers.yml", variables={
            "amneziawg_kernel_headers_metapackage": "linux-headers-5.15.0-198-generic",
        })
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn("Do not use a versioned header package", result.stdout)

    def test_missing_current_kernel_module_is_repaired_once(self):
        self.stub_kernel_commands()
        first = self.run_tasks("kernel-module.yml")
        self.assertEqual(first.returncode, 0, first.stdout)
        self.assertIn("changed=1", first.stdout)
        second = self.run_tasks("kernel-module.yml")
        self.assertEqual(second.returncode, 0, second.stdout)
        self.assertIn("changed=0", second.stdout)
        calls = (self.directory / "calls").read_text()
        self.assertEqual(calls.count("dkms install "), 1, calls)

    def test_dkms_two_x_status_format(self):
        self.stub_kernel_commands(
            status="amneziawg, 1.0.0, 5.15.0-190-generic, x86_64: installed\n",
        )
        result = self.run_tasks("kernel-module.yml")
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_build_failure_reports_kernel_and_build_log(self):
        self.stub_kernel_commands(mode="failure")
        result = self.run_tasks("kernel-module.yml")
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn("5.15.0-198-generic", result.stdout)
        self.assertIn("simulated kernel build failure", result.stdout)
        self.assertIn("/var/lib/dkms/amneziawg/<version>/build/make.log", result.stdout)

    def test_successful_dkms_exit_without_module_is_rejected(self):
        self.stub_kernel_commands(mode="no_module")
        result = self.run_tasks("kernel-module.yml")
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn("Verify AmneziaWG module", result.stdout)

    def test_multiple_source_versions_are_not_selected_arbitrarily(self):
        self.stub_kernel_commands(status=(
            "amneziawg/1.0.0, 5.15.0-190-generic, x86_64: installed\n"
            "amneziawg/2.0.0: added\n"
        ))
        result = self.run_tasks("kernel-module.yml")
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn("Expected one registered AmneziaWG source version", result.stdout)
        self.assertNotIn("dkms install ", (self.directory / "calls").read_text())


if __name__ == "__main__":
    unittest.main()
