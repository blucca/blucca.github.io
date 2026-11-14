"""Bounded real-process A/B checks; each child leaves full results on disk."""
import json
import os
import resource
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
os.environ.update(PYTHONDONTWRITEBYTECODE="1", OMP_NUM_THREADS="1", OPENBLAS_NUM_THREADS="1")
resource.setrlimit(resource.RLIMIT_AS, (3 * 1024**3, 3 * 1024**3))
state = {"pid": os.getpid(), "started_at": time.time(), "completed": []}


def run(arguments, name):
    state.update(phase=name)
    (ROOT / "native-state.json").write_text(json.dumps(state, indent=2))
    with (ROOT / (name + ".log")).open("w") as log:
        result = subprocess.run([sys.executable, *arguments], cwd=ROOT, stdout=log,
                                stderr=subprocess.STDOUT, timeout=45)
    state.update(last_exit=result.returncode)
    if result.returncode:
        state.update(phase="failed", failed_step=name, completed_at=time.time())
        (ROOT / "native-state.json").write_text(json.dumps(state, indent=2))
        raise RuntimeError(name + " failed; see its log")
    state["completed"].append(name)
    (ROOT / "native-state.json").write_text(json.dumps(state, indent=2))


# A clean isolated SDK/environment and an empty lab directory are the starting state.
run(["probe.py", "--root", "cases/plain", "--phase", "A", "--mode", "plain"], "plain-A")
run(["probe.py", "--root", "cases/plain", "--phase", "B", "--mode", "plain"], "plain-B")
for mode in ("private", "active-close"):
    for phase in ("A", "B"):
        run(["probe.py", "--root", "cases/" + mode, "--phase", phase, "--mode", mode], mode + "-" + phase)
run(["patch_runtime.py"], "apply-proposal")
for mode in ("plain", "detach"):
    for phase in ("A", "B"):
        run(["probe.py", "--root", "cases/patched-" + mode, "--phase", phase, "--mode", mode],
            "patched-" + mode + "-" + phase)
state.update(phase="completed", completed_at=time.time(),
             max_child_rss_kib=resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss)
(ROOT / "native-state.json").write_text(json.dumps(state, indent=2))
print(json.dumps(state))
