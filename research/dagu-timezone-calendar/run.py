#!/usr/bin/env python3
"""Native Dagu calendar contract. Linux/GNU date, Python stdlib, no server."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys


HERE = Path(__file__).resolve().parent
DATE_FORMAT = '+{"year":%Y,"month":%-m,"day":%-d,"hour":%-H,"minute":%-M,"offset":"%z"}'


def workflow(case, result_file, expected):
    # JSON strings/objects are a YAML subset; no YAML parser is needed here.
    env = ["INSTANT=" + case["instant"], "RESULT_FILE=" + str(result_file)]
    if case["dagTZ"] is not None:
        env.append("TZ=" + case["dagTZ"])
    step_env = ""
    if case["stepTZ"] is not None:
        step_env = "    env:\n      - " + json.dumps("TZ=" + case["stepTZ"]) + "\n"
    return "env:\n" + "".join("  - " + json.dumps(x) + "\n" for x in env) + """steps:
  - id: original
""" + step_env + """    action: js.run
    with:
      input: """ + json.dumps(case["instant"]) + """
      script: |
        const d = new Date(input);
        return JSON.stringify({year:d.getFullYear(), month:d.getMonth()+1,
          day:d.getDate(), hour:d.getHours(), minute:d.getMinutes(),
          offset:d.getTimezoneOffset()});
    output: ORIGINAL
  - id: clock
""" + step_env + """    run: |
      date --date "$INSTANT" '""" + DATE_FORMAT + """'
    output: CLOCK
  - id: compare
    depends: [original, clock]
    action: js.run
    with:
      input:
        original: ${ORIGINAL}
        clock: ${CLOCK}
        expected: """ + json.dumps(expected) + """
      script: |
        const original = JSON.parse(input.original);
        const c = JSON.parse(input.clock);
        const sign = c.offset[0] === "-" ? -1 : 1;
        const offset = -sign * (Number(c.offset.slice(1,3))*60 + Number(c.offset.slice(3,5)));
        const explicit = {year:c.year, month:c.month, day:c.day,
          hour:c.hour, minute:c.minute, offset};
        const matches = value => Object.keys(input.expected).every(k => value[k] === input.expected[k]);
        if (!matches(explicit)) {
          throw new Error("calendar mismatch: " + JSON.stringify({expected:input.expected, actual:explicit}));
        }
        return JSON.stringify({original, explicit, expected:input.expected,
          originalMatches:matches(original), explicitMatches:true});
    output: REPORT
  - id: save
    depends: compare
    run: printf '%s\\n' "$REPORT" > "$RESULT_FILE"
"""


def execute(dagu, case, target, expected):
    target.mkdir(parents=True, exist_ok=False)
    result_file = target / "result.json"
    yaml_file = target / "workflow.yaml"
    yaml_file.write_text(workflow(case, result_file, expected))
    env = {**os.environ, "TZ": case["processTZ"], "DAGU_HOME": str(target / "home")}
    for command in ("validate", "start"):
        args = [dagu, command, "--dagu-home", str(target / "home"), str(yaml_file)]
        completed = subprocess.run(args, env=env, cwd=target, capture_output=True, text=True, timeout=45)
        (target / (command + ".stdout.txt")).write_text(completed.stdout)
        (target / (command + ".stderr.txt")).write_text(completed.stderr)
        if command == "validate":
            assert completed.returncode == 0, "Dagu validation failed: " + completed.stdout + completed.stderr
    result = json.loads(result_file.read_text()) if result_file.exists() else None
    return completed.returncode, result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dagu", help="installed dagu executable")
    parser.add_argument("--out", required=True, type=Path, help="new directory for native workflows, logs and results")
    args = parser.parse_args()
    dagu = str(Path(args.dagu).resolve())
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=False)
    version = subprocess.check_output([dagu, "version"], text=True).strip()
    cases = json.loads((HERE / "cases.json").read_text())
    rows = []
    for case in cases:
        rc, result = execute(dagu, case, out / case["name"], case["expected"])
        assert rc == 0 and result and result["explicitMatches"], case["name"] + " failed"
        assert result["explicit"] == case["expected"], case["name"] + " changed output"
        rows.append({**case, "returncode": rc, **result})
    wrong = {**cases[0]["expected"], "hour": 3}
    rc, result = execute(dagu, cases[0], out / "controlled-wrong-hour", wrong)
    assert rc != 0 and result is None, "controlled wrong expectation did not fail the native workflow"
    failure = out / "controlled-wrong-hour"
    logs = (failure / "start.stdout.txt").read_text() + (failure / "start.stderr.txt").read_text()
    assert "calendar mismatch:" in logs, "negative control failed outside the calendar oracle"
    summary = {"daguVersion": version, "platform": sys.platform,
               "cases": rows, "negativeControl": {"expectedHour": 3, "actualHour": 2,
                   "returncode": rc, "resultWritten": result is not None},
               "contractPassed": True}
    (out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
