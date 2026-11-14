# Agno SQL fetch-error native lab

A provider-free reproduction of [Agno issue #11557](https://github.com/agno-agi/agno/issues/11557), reported by **JiaxPeaceLove**. It checks the existing fix by **adityav1709** in [PR #11680](https://github.com/agno-agi/agno/pull/11680); that PR disclosed Muse (Aurora) as a co-author.

The lab uses real SQLAlchemy sessions, a file-backed SQLite database, and a SQLite UDF that raises on the third row. SQLAlchemy `Connection.execute()` succeeds, `fetchone()` actually returns `{"value": 1}`, and the subsequent `fetchall()` raises a real `sqlite3.OperationalError`. SQLAlchemy `Result` methods are unchanged. No model or provider is called.

[Download the complete free lab](https://blucca.github.io/research/agno-sql-fetch/agno-sql-fetch-native.zip) · [Actual native results](results.json) · [Runnable source](run_lab.py)

## Reproduce

Tested: **Python 3.14.8, Agno 3.2.0, SQLAlchemy 2.0.57, SQLite 3.54.0, Linux x86_64**.

From this directory:

```sh
python -m venv .venv
.venv/bin/python -m pip install -r requirements.lock
.venv/bin/python run_lab.py --output my-results.json
```

Windows uses `.venv\Scripts\python` for the last two commands. The original reporter's Windows/Python 3.13 result can be recorded by rerunning this package there. `requirements.txt` contains the two core package pins; `requirements.lock` records the complete measured environment.

The **512 MiB ceiling applies to our measured Linux run**. Windows uses ordinary Python: when its `resource` module is unavailable, the lab still runs and reports `resource_available=false`, `resource_limit_bytes=null`, and `peak_rss_kib=null`. On Linux these fields report the process's actual active limit and RSS; an unset limit is also recorded as `null`.

Expected SQL error tracebacks appear before the final `PASS`; they demonstrate the deliberately failing fetch. `my-results.json` contains the actual tool strings and the execute/row/fetch ordering. The script removes its temporary SQLite files after the run.

## Observed result

| SQLTools source | Actual `run_sql_query` result after the real fetch failure |
|---|---|
| Published Agno 3.2.0 | String `"[]"` |
| Frozen current-main SQL module | String `"[]"` |
| Existing PR 11680 SQL module | String starting `"Error running query: "` |

Both `limit=None` and `limit=2` reach the real SQLite fetch error. All three sources retain correct ordinary SELECT results, legitimate empty SELECT results, zero/negative limits, and non-returning CREATE/INSERT results. A separate SQLite DBAPI connection reads the committed inserted value `7`.

The supplied `results.json` records the successful full native run after the optional-resource import fix: six real tool-fetch-error cases, twelve normal SELECT/limit cases, three legitimate empty SELECT cases, and three DDL/DML commit checks. Native peak RSS was **73,528 KiB** under a **512 MiB address-space ceiling**. Model/provider and business-network calls: **0**.

## Frozen sources and scope

- `sql_main.py`: unchanged `libs/agno/agno/tools/sql.py` from main commit [`7c3b729667e66282f0d845adbd507ee07242c5eb`](https://github.com/agno-agi/agno/blob/7c3b729667e66282f0d845adbd507ee07242c5eb/libs/agno/agno/tools/sql.py).
- `sql_pr11680.py`: unchanged same file from existing PR head [`09362777966d1a27b87022838e758341edd5feee`](https://github.com/adityav1709/agno/blob/09362777966d1a27b87022838e758341edd5feee/libs/agno/agno/tools/sql.py).
- Both frozen modules use the installed Agno 3.2.0 Toolkit. The published SQLTools is also tested directly. Published 3.2.0 and frozen main differ in constructor `db_engine` precedence; the runner supplies only `db_engine` and exercises all three sources separately.
- The runner verifies SHA256 hashes before loading frozen sources. `source-provenance.json` records origins and versions.

The tested path is SQLite fetch/materialization → public SQL tool result. Production database drivers, model interpretation, and full repository CI have separate execution requirements.

At discovery on 2026-11-15, issue #11557 was open without `ready`; PR #11680 was closed and unmerged after automatic triage. This package reuses its existing fix and supplies independent native evidence. Upstream contributions follow Agno's ready-issue and AI-disclosure rules. No new upstream fix or PR is created by this lab.

Upstream SQL sources and this lab are provided under Apache-2.0; see `LICENSE`. Please retain the original report and fix attribution when sharing results.
