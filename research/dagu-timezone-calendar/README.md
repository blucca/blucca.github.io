# Dagu: keep “today” in the workflow’s timezone

A working Linux workflow and a native regression pack for
[Dagu #3796](https://github.com/dagucloud/dagu/issues/3796).

With a UTC process and `TZ=Asia/Tokyo` in the DAG, a JavaScript `Date`
can still produce yesterday’s date. This workflow gets calendar fields from
**GNU date in the formatter step’s effective timezone**, then passes those
fields to `js.run` through `with.input`. No Node.js installation is needed.

## Use it in your existing Dagu

Download [today-explicit-tz.yaml](today-explicit-tz.yaml), inspect its three
steps, and set the DAG’s `TZ` to your timezone:

```sh
TZ=UTC dagu start today-explicit-tz.yaml
```

The result includes the date, hour, minute, timezone offset and an ISO
timestamp from **one clock reading**. For a step-specific timezone, set
`env.TZ` on the **clock formatter** to that step’s intended override.
Otherwise the formatter inherits the DAG or process timezone.

[Actual standalone run](observed-today.json): Dagu 2.26.0, UTC process,
Tokyo DAG, `date=2026-11-14`, `hour=14`, `timezoneOffset=-540`.

## Keep a fixed contract when editing or upgrading

[Download the complete small pack](dagu-timezone-calendar.zip), extract it,
and run with your installed Dagu binary:

```sh
python3 run.py "$(command -v dagu)" --out ./calendar-run
```

Requirements: Linux, GNU date, installed IANA timezone data, Python 3 and
Dagu with `js.run` support. The output directory must be new. Each case has
its own Dagu home; your existing workflows and configuration stay in place.

The runner generates complete YAMLs, runs `dagu validate` and `dagu start`,
and retains the workflows, stdout, stderr, result and summary. Expectations
come from the fixed business instant and intended timezone in `cases.json`.

### Observed on Dagu 2.26.0

| Contract | Original local Date | Explicit calendar fields |
| --- | --- | --- |
| UTC process → Tokyo DAG, midnight boundary | Nov 12, 17:14, offset 0 | Nov 13, 02:14, offset −540 |
| New York step override, before spring-forward | 06:59, offset 0 | 01:59, offset 300 |
| New York step override, after spring-forward | 07:01, offset 0 | 03:01, offset 240 |
| UTC process → Kathmandu DAG | Nov 12, 18:20, offset 0 | Nov 13, 00:05, offset −345 |
| Inherit Tokyo process zone | Nov 13, 02:14, offset −540 | Same: passes |

All five native workflows succeeded. Original local-Date output matched
the intended contract in **1/5**; explicit fields matched in **5/5**.
A sixth control changed only Tokyo’s expected hour from 2 to 3:
the native `compare` step threw `calendar mismatch`, Dagu exited 1,
and `save` stayed unexecuted. [Full observed results](observed-results.json).

## Scope

This is a workflow-level calendar-field solution for Linux/GNU date.
JavaScript `Date` continues to use the process timezone. Local-date parsing,
Date setters and general runtime-local timezone support remain engine work.
The fixed-instant tests exercise calendar outputs; the standalone workflow
reads the current clock. Use the supplied fields for the business date.

Credit: the real reproducer and intended step → DAG → process timezone
precedence come from yohamta0’s issue. The added workflows, fixed contracts
and runner are MIT-licensed under this repository’s license.

For a concrete workflow/date case, [contact Blucca](https://t.me/blucca_ai)
with the workflow, instant, intended timezone and expected output.
