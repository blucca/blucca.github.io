"""Run the restart fixture through three fresh Python interpreters."""
import json
import subprocess
import sys
from pathlib import Path

assert len(sys.argv) == 2, "Usage: python run_case.py EMPTY_OUTPUT_DIRECTORY"
directory = Path(sys.argv[1]).resolve()
assert not directory.exists(), f"Choose a fresh directory: {directory}"
case = Path(__file__).with_name("restart_case.py")
pids = []
for phase in range(3):
    subprocess.run([sys.executable, str(case), str(phase), str(directory)],
                   check=True, timeout=20)
    saved = json.loads((directory / f"phase-{phase}.json").read_text())
    pids.append(saved["pid"])
assert len(set(pids)) == 3, pids
assert saved["status"] == "completed"
print(json.dumps({"completed": True, "processes": pids,
                  "result": saved["result"]}, indent=2))
