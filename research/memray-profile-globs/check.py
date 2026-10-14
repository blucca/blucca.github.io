"""Exercise a profile-rendering shell script with two file-selection cases.

Usage: python3 check.py /path/to/render-memory-profiles.sh
The Docker and memray commands are replaced with local recording shims.
"""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile


DOCKER_SHIM = '''import os, subprocess, sys
args = sys.argv[1:]
i = args.index("-c")
script = args[i + 1].replace("/var/profiles", os.environ["PROFILE_CHECK_DIR"])
raise SystemExit(subprocess.call(["/bin/sh", "-c", script, *args[i + 2:]]))
'''

MEMRAY_SHIM = '''import json, os, pathlib, sys
with open(os.environ["PROFILE_CHECK_TRACE"], "a") as out:
    out.write(json.dumps(sys.argv[1:]) + "\\n")
pathlib.Path(sys.argv[sys.argv.index("-o") + 1]).write_text("synthetic report")
'''

CASES = (
    (
        "pattern from project root",
        ["gunicorn-demo.bin"],
        ["gunicorn-*.bin*"],
        ["gunicorn-demo.bin"],
    ),
    (
        "existing fork report",
        ["gunicorn-demo.bin.41", "gunicorn-demo.bin.41.html", "gunicorn-demo.bin.42"],
        [],
        ["gunicorn-demo.bin.42"],
    ),
)


def main():
    source = Path(sys.argv[1]).read_text()
    scratch = Path.cwd() / "temp"
    scratch.mkdir(exist_ok=True)
    failed = 0
    for label, files, arguments, expected in CASES:
        with tempfile.TemporaryDirectory(prefix="profile-globs-", dir=scratch) as tmp:
            root = Path(tmp).resolve()
            for name in ("bin", "profiles", "shims"):
                (root / name).mkdir()
            script = root / "bin/render-memory-profiles.sh"
            script.write_text(source)
            for name in files:
                (root / "profiles" / name).write_text("synthetic fixture")
            for name, code in (("docker", DOCKER_SHIM), ("memray", MEMRAY_SHIM)):
                shim = root / "shims" / name
                shim.write_text(f"#!{sys.executable}\n{code}")
                shim.chmod(0o755)
            trace = root / "calls.jsonl"
            result = subprocess.run(
                ["/bin/sh", str(script), *arguments],
                cwd=root,
                env={
                    **os.environ,
                    "PATH": f"{root / 'shims'}{os.pathsep}{os.environ['PATH']}",
                    "PROFILE_CHECK_DIR": str(root / "profiles"),
                    "PROFILE_CHECK_TRACE": str(trace),
                },
                capture_output=True,
                text=True,
                timeout=10,
            )
            calls = [json.loads(line) for line in trace.read_text().splitlines()] if trace.exists() else []
            actual = sorted(Path(call[-1]).name for call in calls)
            passed = result.returncode == 0 and actual == sorted(expected)
            failed += not passed
            print(f"{'PASS' if passed else 'FAIL'} {label}: expected {expected}, rendered {actual}")
            if result.returncode:
                print(f"exit {result.returncode}: {result.stderr.strip()}")
    return int(failed > 0)


if __name__ == "__main__":
    raise SystemExit(main())
