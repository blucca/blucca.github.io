"""Original all-tiny gate, or explicit MIP scope with LP outcomes retained."""
import json
import math
from pathlib import Path
import sys


def check(record, model, candidate):
    assert record["model"] == model
    names = {"x0", "x1", "x2"} | ({"z"} if model == "--tiny-mip" else set())
    assert record["rows"] == 1 and record["cols"] == len(names)
    tolerance = record["mip_feasibility_tolerance" if model == "--tiny-mip" else "primal_feasibility_tolerance"]
    assert math.isfinite(tolerance) and tolerance > 0
    assert record["tiny_rhs"] == 1.5 * tolerance
    if record["value_valid"]:
        assert set(record["primal"]) == names
        assert all(math.isfinite(float(x)) for x in record["primal"].values())
    else:
        assert "primal" not in record
    if candidate:
        assert record["model_status"] == "Optimal" and record["value_valid"]
        assert all(float(x) == 0 for x in record["primal"].values())
        assert float(record["objective"]) == 0
    return {k: record[k] for k in ("model", "mode", "model_status", "objective", "value_valid", "dual_valid")}


def main():
    mip_scope = sys.argv[1:2] == ["--mip-scope"]
    paths = sys.argv[2:] if mip_scope else sys.argv[1:]
    assert len(paths) == 4, "[--mip-scope] candidate-lp.json candidate-mip.json stock-lp.json stock-mip.json"
    records = []
    for path, model, candidate in zip(paths, ("--tiny-lp", "--tiny-mip") * 2, (True, True, False, False)):
        record = json.loads(Path(path).read_text())
        assert record["mode"] == "default"
        required = candidate and (not mip_scope or model == "--tiny-mip")
        print(path, json.dumps(check(record, model, required), sort_keys=True))
        records.append(record)
    if mip_scope:
        assert records[0]["tiny_rhs"] == records[2]["tiny_rhs"]
        assert records[1]["tiny_rhs"] == records[3]["tiny_rhs"]
        all_tiny = all(r["model_status"] == "Optimal" and r["value_valid"]
                       and float(r["objective"]) == 0
                       and all(float(x) == 0 for x in r["primal"].values())
                       for r in records[:2])
        print(json.dumps({"mip_scope_passed": True,
                          "initial_all_tiny_gate": "PASS" if all_tiny else "FAILED",
                          "lp_observations": [r["model_status"] for r in records[::2]]}))


if __name__ == "__main__":
    main()
