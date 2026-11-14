# Keep the answers across process restarts

**Save two parallel questionnaires, restart the process twice, and keep all four answers in the right branch.** This free LlamaIndex Workflows lab uses real `Workflow`, `BasicRuntime` journals and JSON files. One branch deliberately sends its next event with `ctx.send_event` and returns `None`.

[Download the complete lab](https://blucca.github.io/research/llama-workflows-journal-restarts/llama-workflows-journal-restarts.zip) · [Recorded results](observed-results.json) · [Application fixture](restart_case.py)

The engine fix is **taruki11’s [PR #893](https://github.com/run-llama/llama-agents/pull/893)**, pinned to `25bc8734927c561c624397e128d63493fd28457b`. This is an independent cold-start application check for **yifanxiong272’s [journal-recovery report #23795](https://github.com/run-llama/llama_index/issues/23795)**. The install below uses that exact PR source build.

## Recorded native result

Python **3.12.3**, Linux x86-64, Pydantic **2.14.3**, instrumentation **0.6.0**. All three complete packages report metadata version `2.26.1`; the source commits identify the different builds.

| Runtime | Original two-restore report | Four-answer application |
|---|---|---|
| PyPI `2.26.1` | Second restore fails: `invocation_7` missing | First restore routes `a0` to `b0` |
| Current main `cb953fd9510ae88682a67058860b0e1b0ef96478` | Same second-restore failure | Cold process receives vendor reply in invoice branch |
| PR #893 `25bc873` | Completes with `done` | Three fresh processes complete; all four values preserved |

The cold-start fixture’s expected result is:

```json
{"vendor:0":"FR","invoice:0":"1,234.50","vendor:1":"FR12345678901","invoice:1":"EUR"}
```

These are synthetic input strings. The amount stays text; this check measures answer identity and persistence. Each runtime creates and replays its own journals. [Main failure](recorded-main-failure.txt) and [PR success](recorded-pr-success.txt) include the recorded process outputs.

## Run it

Use a fresh Python 3.12 virtual environment and extract the complete ZIP:

```sh
python -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.lock.txt
python run_case.py temp/my-restart-case
```

On Windows, use `.venv\Scripts\python.exe` for the pip and run commands. The native result recorded here is the Linux configuration above.

`run_case.py` requires a new output directory, launches three separate Python interpreters, and asserts distinct process IDs and final completion. Expected: exit **0**, `completed: true` and all four values above. Each child prints its phase and writes `phase-0.json`, `phase-1.json` or `phase-2.json`.

## What survives the restart

1. **Process 0** starts both branches, waits for their first answers, saves the state checkpoint and full session journal, then cancels the idle run and exits.
2. **Process 1** reads JSON, replays the original journal into a fresh workflow, supplies both first answers, then saves the second pair of pending questions and exits.
3. **Process 2** reads the next checkpoint, replays that session’s journal, supplies the second answers and returns the four stored values.

Each saved file carries the **context the session started from**, its complete journal, and its latest **separate state checkpoint**. `JournalRecord.seq` and its encoded `data` string are stored unchanged; `BasicRuntime.restore` performs tick deserialization. The replayed context uses `include_state=False`, then receives the saved state. Each response is checked against its expected key before an independent `ctx.store` key is written.

Scope: two filtered parallel branches, two questions per branch, journals created by the same pinned runtime, JSON-compatible string state and normal idle cancellation. The fixture exercises the actual `ctx.send_event` path.

## Reuse and your own case

The two application files are original **Blucca** MIT sources; the runtime’s notice is retained in `LICENSE.workflows`. The upstream fix remains attributed to taruki11, and the original failure report to yifanxiong272. Built, run and independently reviewed by Blucca’s Codex AI agents.

Have a workflow that loses a reply after restart? [Send your package version, expected/actual result and a small redacted case](mailto:belgialucca@gmail.com?subject=LlamaIndex%20journal%20recovery%20case). Include your three phase files or result report when appropriate. Repairs start with an agreed scope, acceptance case, budget and date.
