"""Check the author's original free-format MPS with exact decimal coefficients.

This checker deliberately supports only sections/bounds present in this input;
adding another MPS form requires a fixture before broadening the parser.
"""
from decimal import Decimal, localcontext
import json
from pathlib import Path
import sys


def load_mps(path):
    row_types, rows, costs, rhs, bounds, integer = {}, {}, {}, {}, {}, set()
    section, is_integer = None, False
    for line in Path(path).read_text().splitlines():
        fields = line.split()
        if not fields or fields[0].startswith("*"):
            continue
        if fields[0] == "NAME":
            continue
        # The RHS vector itself is named "RHS"; its data lines have 3+ tokens.
        if len(fields) == 1 and fields[0] in ("ROWS", "COLUMNS", "RHS", "BOUNDS", "ENDATA"):
            section = fields[0]
            continue
        if section == "ROWS":
            kind, name = fields
            assert kind in ("N", "L", "G", "E") and name not in row_types
            row_types[name] = kind
            rows[name] = {}
        elif section == "COLUMNS":
            if "'MARKER'" in fields:
                assert fields[-1] in ("'INTORG'", "'INTEND'")
                is_integer = fields[-1] == "'INTORG'"
                continue
            col = fields[0]
            assert len(fields) % 2 == 1
            bounds.setdefault(col, [Decimal(0), Decimal("Infinity")])
            if is_integer:
                integer.add(col)
            for row, token in zip(fields[1::2], fields[2::2], strict=True):
                value = Decimal(token)
                assert value.is_finite() and row in row_types
                rows[row][col] = rows[row].get(col, Decimal(0)) + value
                if row_types[row] == "N":
                    costs[col] = costs.get(col, Decimal(0)) + value
        elif section == "RHS":
            assert len(fields) % 2 == 1
            for row, token in zip(fields[1::2], fields[2::2], strict=True):
                assert row in row_types and row not in rhs
                rhs[row] = Decimal(token)
        elif section == "BOUNDS":
            kind, _, col, *value = fields
            assert col in bounds and kind in ("LO", "UP", "FX", "MI", "PL")
            if kind == "MI":
                assert not value
                bounds[col][0] = Decimal("-Infinity")
            elif kind == "PL":
                assert not value
                bounds[col][1] = Decimal("Infinity")
            else:
                assert len(value) == 1
                number = Decimal(value[0])
                if kind in ("LO", "FX"):
                    bounds[col][0] = number
                if kind in ("UP", "FX"):
                    bounds[col][1] = number
        else:
            raise ValueError(f"Unexpected MPS section/line: {section}: {line}")
    assert section == "ENDATA" and not is_integer
    assert sum(t == "N" for t in row_types.values()) == 1
    return row_types, rows, rhs, bounds, costs, integer


def check(data, primal, reported, tolerance=Decimal("0.000001")):
    row_types, rows, rhs, bounds, costs, integer = data
    assert set(primal) == set(bounds)
    x = {k: Decimal(str(v)) for k, v in primal.items()}
    assert all(v.is_finite() for v in x.values())
    violations, integrality = [], []
    with localcontext() as ctx:
        ctx.prec = 60
        for col, (lower, upper) in bounds.items():
            violations.extend((max(Decimal(0), lower-x[col]), max(Decimal(0), x[col]-upper)))
            if col in integer:
                integrality.append(abs(x[col]-x[col].to_integral_value()))
        activities = {}
        for row, kind in row_types.items():
            if kind == "N":
                continue
            value = sum((coefficient*x[col] for col, coefficient in rows[row].items()), Decimal(0))
            activities[row] = value
            right = rhs.get(row, Decimal(0))
            if kind in ("L", "E"):
                violations.append(max(Decimal(0), value-right))
            if kind in ("G", "E"):
                violations.append(max(Decimal(0), right-value))
        objective = sum((coefficient*x[col] for col, coefficient in costs.items()), Decimal(0))
        objective_delta = abs(objective-Decimal(str(reported)))
    result = {
        "checked_columns": len(bounds), "checked_rows": len(activities),
        "integer_columns": sorted(integer),
        "max_primal_violation": str(max(violations, default=Decimal(0))),
        "max_integrality_violation": str(max(integrality, default=Decimal(0))),
        "independent_objective": str(objective),
        "native_objective_delta": str(objective_delta),
        "expected_exact_objective": "127.1998728",
        "expected_delta": str(abs(objective-Decimal("127.1998728"))),
        "row_activities": {k: str(v) for k,v in activities.items()},
    }
    result["full_primal_pass"] = max(violations, default=Decimal(0)) <= tolerance and max(integrality, default=Decimal(0)) <= tolerance and objective_delta <= tolerance
    return result


def main():
    source, runs, out = map(Path, sys.argv[1:4])
    data = load_mps(source)
    assert len(data[3]) == 364 and len(data[0])-1 == 13 and data[5] == {"x363"}
    assert len(data[2]) == 13 and data[2]["r0"] == Decimal("0.000001") and data[2]["r4"] == Decimal("12.000012")
    results = {}
    for path in sorted(runs.glob("*/result.json")):
        native = json.loads(path.read_text())
        if native["value_valid"]:
            result = check(data, native["primal"], native["objective"])
            assert result["full_primal_pass"], (path, result)
            if path.parent.name in ("fixed-default", "fixed-lp"):
                assert native["model_status"] == "Optimal"
                assert Decimal(result["expected_delta"]) <= Decimal("0.000001"), (path, result)
            # One existing-column negative verifies bounds/integrality stay checked.
            wrong = dict(native["primal"]); wrong["x363"] = 1
            assert not check(data, wrong, native["objective"])["full_primal_pass"]
            results[path.parent.name] = result
        else:
            assert "primal" not in native
            results[path.parent.name] = {"value_valid": False, "full_primal_pass": None, "model_status": native["model_status"]}
    assert results
    out.write_text(json.dumps(results,indent=2)+"\n")
    print(json.dumps(results,indent=2))


if __name__ == "__main__":
    main()
