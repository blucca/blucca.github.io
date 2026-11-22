"""Only the declared tiny LP/MIP regression; stock outcomes stay observations."""
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
    assert len(sys.argv) == 5, "candidate-lp.json candidate-mip.json stock-lp.json stock-mip.json"
    for path, model, candidate in zip(sys.argv[1:], ("--tiny-lp", "--tiny-mip") * 2, (True, True, False, False)):
        record = json.loads(Path(path).read_text())
        print(path, json.dumps(check(record, model, candidate), sort_keys=True))


if __name__ == "__main__":
    main()
