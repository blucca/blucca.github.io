"""Reproduce issue 9284's numeric-call boundary on the stated source snapshot."""
import json
import sys
from pathlib import Path

source = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(source))
import sqlglot

assert Path(sqlglot.__file__).resolve().is_relative_to(source)
rows = []
for dialect, query in [
    ("snowflake", "SELECT top(5) FROM t"),
    ("snowflake", "SELECT TOP 5 x FROM t"),
    ("tsql", "SELECT TOP (5) x FROM t"),
    ("tsql", "SELECT TOP (@n) x FROM t"),
]:
    tree = sqlglot.parse_one(query, read=dialect)
    rows.append({"dialect": dialect, "input": query, "output": tree.sql(dialect),
                 "projections": [e.sql(dialect) for e in tree.expressions],
                 "limit": tree.args["limit"].sql(dialect)})

# These assert the frozen reproducer's observed behaviour, including the bug.
assert rows[0]["output"] == "SELECT FROM t LIMIT 5" and rows[0]["projections"] == []
assert all(row["projections"] == ["x"] for row in rows[1:])
assert [row["limit"] for row in rows] == ["LIMIT 5", "LIMIT 5", "LIMIT 5", "LIMIT @n"]
print(json.dumps(rows, indent=2))
