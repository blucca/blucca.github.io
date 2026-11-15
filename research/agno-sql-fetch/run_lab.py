#!/usr/bin/env python3
"""Reproduce Agno #11557 with real SQLite fetch errors and PR #11680."""

import argparse
from contextlib import closing
import hashlib
import importlib.metadata
import importlib.util
import json
from pathlib import Path
import platform
import sqlite3
import sys
import tempfile
import time

try:
    import resource
except ImportError:
    resource = None

import agno.tools.sql as published_sql
from sqlalchemy import create_engine, event, text
from sqlalchemy.exc import OperationalError


BASE = Path(__file__).resolve().parent
QUERY = "SELECT fail_on_third(value) AS value FROM values_table"
MAIN_COMMIT = "7c3b729667e66282f0d845adbd507ee07242c5eb"
PR_COMMIT = "09362777966d1a27b87022838e758341edd5feee"
SOURCE_HASHES = {
    "sql_main.py": "13b24b56154ac21f9e47df2c1c7abd722cfa0ac738e93c89c60d81c0b6ddb6d1",
    "sql_pr11680.py": "88d30ba131b6dea843c084e0e45c7ec9b3bb06598110c64a0e308864be0be704",
}


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def memory_report():
    if resource is None:
        return {"resource_available": False, "resource_limit_bytes": None, "peak_rss_kib": None}
    ceiling = resource.getrlimit(resource.RLIMIT_AS)[0]
    return {
        "resource_available": True,
        "resource_limit_bytes": None if ceiling == resource.RLIM_INFINITY else ceiling,
        "peak_rss_kib": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
    }


def load_exact_source(filename):
    path = BASE / filename
    actual = digest(path)
    assert actual == SOURCE_HASHES[filename], (filename, actual)
    spec = importlib.util.spec_from_file_location(filename.removesuffix(".py"), path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module.SQLTools


def make_engine(database_file):
    """Use an actual SQLite UDF; SQLAlchemy Result methods stay untouched."""
    trace = []
    engine = create_engine("sqlite:///" + str(database_file))

    def fail_on_third(value):
        if value == 3:
            trace.append({"event": "udf_raise", "value": value})
            raise ValueError("native SQLite UDF failure at value 3")
        trace.append({"event": "udf_return", "value": value})
        return value

    @event.listens_for(engine, "connect")
    def register_udf(dbapi_connection, _connection_record):
        dbapi_connection.create_function("fail_on_third", 1, fail_on_third)

    @event.listens_for(engine, "after_cursor_execute")
    def executed(_connection, _cursor, statement, _parameters, _context, _executemany):
        if "fail_on_third" in statement:
            trace.append({"event": "after_cursor_execute"})

    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE values_table (value INTEGER)"))
        connection.execute(text("INSERT INTO values_table VALUES (1), (2), (3)"))
    trace.clear()
    return engine, trace


def prove_lazy_fetch(database_file):
    engine, trace = make_engine(database_file)
    try:
        with engine.connect() as connection:
            result = connection.execute(text(QUERY))
            assert result.returns_rows
            trace.append({"event": "execute_returned", "returns_rows": True})
            first_row = result.fetchone()
            assert first_row._asdict() == {"value": 1}
            trace.append({"event": "first_row_returned", "row": first_row._asdict()})
            trace.append({"event": "fetchall_started"})
            try:
                result.fetchall()
            except OperationalError as error:
                trace.append({"event": "fetchall_error", "error_type": type(error).__name__})
                assert isinstance(error.orig, sqlite3.OperationalError)
                assert "user-defined function raised exception" in str(error)
                events = [entry["event"] for entry in trace]
                assert events.index("execute_returned") < events.index("first_row_returned")
                assert events.index("first_row_returned") < events.index("fetchall_started")
                assert events.index("fetchall_started") < events.index("udf_raise")
                return {
                    "status": "PASS",
                    "first_row": first_row._asdict(),
                    "error_type": type(error).__name__,
                    "dbapi_error_type": type(error.orig).__name__,
                    "error": str(error),
                    "trace": trace,
                }
            raise AssertionError("SQLite fetchall completed; lazy-fetch gate failed")
    finally:
        engine.dispose()


def exercise_tools(name, tools_class, directory, patched):
    engine, trace = make_engine(directory / (name + ".sqlite"))
    tools = tools_class(db_engine=engine)
    results = {"name": name, "expected_error_surface": patched, "cases": []}
    try:
        for limit in (None, 2):
            trace.clear()
            actual = tools.run_sql_query(QUERY, limit=limit)
            if patched:
                assert actual.startswith("Error running query: "), actual
                assert "user-defined function raised exception" in actual
            else:
                assert actual == "[]", actual
            events = [entry["event"] for entry in trace]
            assert events.index("after_cursor_execute") < events.index("udf_raise")
            results["cases"].append(
                {"case": "real_fetch_error", "limit": limit, "actual": actual, "trace": list(trace)}
            )

        normal_query = "SELECT value FROM values_table ORDER BY value"
        for limit, expected in (
            (None, [{"value": 1}, {"value": 2}, {"value": 3}]),
            (2, [{"value": 1}, {"value": 2}]),
            (0, []),
            (-1, []),
        ):
            actual = tools.run_sql_query(normal_query, limit=limit)
            assert json.loads(actual) == expected, actual
            results["cases"].append({"case": "normal_select", "limit": limit, "actual": actual})

        actual = tools.run_sql_query("SELECT value FROM values_table WHERE value = 99")
        assert actual == "[]", actual
        results["cases"].append({"case": "legitimate_empty_select", "actual": actual})

        ddl = tools.run_sql_query("CREATE TABLE committed_values (value INTEGER)")
        dml = tools.run_sql_query("INSERT INTO committed_values VALUES (7)")
        assert ddl == dml == "[]", (ddl, dml)
        with closing(sqlite3.connect(directory / (name + ".sqlite"))) as independent_connection:
            persisted_rows = independent_connection.execute("SELECT value FROM committed_values").fetchall()
        assert persisted_rows == [(7,)], persisted_rows
        results["cases"].append(
            {
                "case": "successful_non_returning_ddl_and_dml",
                "ddl_actual": ddl,
                "dml_actual": dml,
                "independent_dbapi_connection_rows": persisted_rows,
            }
        )
        results["status"] = "PASS"
        return results
    finally:
        engine.dispose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=BASE / "results.json")
    args = parser.parse_args()
    started = time.monotonic()
    main_sql = load_exact_source("sql_main.py")
    fixed_sql = load_exact_source("sql_pr11680.py")
    scratch = BASE / "tmp"
    scratch.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="agno-sql-native-", dir=scratch) as temp_dir:
        directory = Path(temp_dir)
        lazy_fetch = prove_lazy_fetch(directory / "lazy_fetch.sqlite")
        tool_results = [
            exercise_tools("published_agno_3_2_0", published_sql.SQLTools, directory, patched=False),
            exercise_tools("exact_main_sql", main_sql, directory, patched=False),
            exercise_tools("existing_pr_11680_sql", fixed_sql, directory, patched=True),
        ]
    result = {
        "status": "PASS",
        "scope": "Agno SQLTools -> SQLAlchemy -> SQLite real row fetch -> public run_sql_query result",
        "environment": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "sqlite": sqlite3.sqlite_version,
            "agno": importlib.metadata.version("agno"),
            "sqlalchemy": importlib.metadata.version("sqlalchemy"),
            "published_sql_sha256": digest(published_sql.__file__),
            "exact_source_sha256": SOURCE_HASHES,
            "main_commit": MAIN_COMMIT,
            "existing_pr_commit": PR_COMMIT,
        },
        "lazy_fetch_mechanism": lazy_fetch,
        "tool_results": tool_results,
        "counts": {
            "real_lazy_fetch_gate": 1,
            "real_tool_fetch_error_cases": 6,
            "normal_select_cases": 12,
            "legitimate_empty_select_cases": 3,
            "ddl_and_committed_dml_cases": 3,
            "sqlalchemy_result_monkeypatches": 0,
            "model_or_provider_calls": 0,
            "business_network_calls": 0,
        },
        "runtime_seconds": round(time.monotonic() - started, 3),
        **memory_report(),
        "attribution": {
            "original_report_author": "JiaxPeaceLove",
            "issue": "https://github.com/agno-agi/agno/issues/11557",
            "existing_fix_author": "adityav1709",
            "existing_pr": "https://github.com/agno-agi/agno/pull/11680",
            "pr_disclosed_coauthor": "Muse (Aurora)",
            "new_fix_authored_by_this_lab": False,
        },
    }
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    summary_keys = ("status", "counts", "runtime_seconds", "resource_available", "resource_limit_bytes", "peak_rss_kib")
    print(json.dumps({key: result[key] for key in summary_keys}, indent=2))
    print("Stock public tool: [] after actual SQLite fetch failure.")
    print("Existing PR 11680: explicit Error running query after the same failure.")
    print("Normal SELECT, legitimate empty SELECT, and independently committed DML: PASS.")


if __name__ == "__main__":
    main()
