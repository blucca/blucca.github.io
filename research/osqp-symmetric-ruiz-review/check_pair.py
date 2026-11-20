#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Check the two recorded native runs; no third-party Python dependencies."""
import json
import math
import sys
from pathlib import Path


def read(path):
    rows = [json.loads(line) for line in Path(path).read_text().splitlines()]
    assert len(rows) == 11 and rows[-1]["kind"] == "summary"
    return rows[:-1], rows[-1]["failed_checks"]


def close(a, b):
    return math.isclose(a, b, rel_tol=1e-12, abs_tol=1e-12)


def main():
    stock, stock_failed = read(sys.argv[1])
    fixed, fixed_failed = read(sys.argv[2])
    assert stock_failed == 2
    assert [r.get("case") for r in stock if r["kind"] == "norm" and not r["pass"]] == ["issue798_original"]
    assert [(r["scaling"], r["swapped"]) for r in stock if r["kind"] == "solve" and not r["pass"]] == [(1, False)]
    assert fixed_failed == 0 and all(r["pass"] for r in fixed)
    for scaling in (0, 1, 10):
        pair = [r for r in fixed if r["kind"] == "solve" and r["scaling"] == scaling]
        assert len(pair) == 2 and [r["swapped"] for r in pair] == [False, True]
        a, b = pair
        assert all(close(x, y) for x, y in zip(a["D"], reversed(b["D"])))
        assert close(a["c"], b["c"]) and a["iter"] == b["iter"] == 25
        assert all(close(x, y) for x, y in zip(a["x_original_order"], b["x_original_order"]))
        if scaling == 0:
            old = [r for r in stock if r["kind"] == "solve" and r["scaling"] == scaling]
            assert pair == old
    print(json.dumps({"pass": True, "stock_failed_checks": stock_failed,
                      "fixed_failed_checks": fixed_failed,
                      "fixed_permutation_checks": 3}))


if __name__ == "__main__":
    main()
