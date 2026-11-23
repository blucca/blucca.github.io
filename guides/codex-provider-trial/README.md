# Native Codex provider trial

A zero-install profile builder and complete project-trial recipe. Use `$CODEX_HOME/NAME.config.toml` with `codex -p NAME`; retain base MCP/trust and normal login/defaults.

- Live entry: https://blucca.github.io/guides/codex-provider-trial/
- 简体中文： https://blucca.github.io/guides/codex-provider-trial/zh.html — shared builder, local receipt and next-session reuse.
- Narrated walkthrough (2:23): https://youtu.be/2qY_z7d5Z50 — builder, own-project test, local receipt and retained-profile reuse.
- Requires native sidecar profile loading, observed on Codex CLI 0.163.0 and 0.171.0 (Linux).
- API must implement Responses. Key is supplied through `ONRAMP_API_KEY` in the local terminal.
- Site source is dependency-free static HTML/CSS/JS. It handles no keys or provider requests.
- Bash and PowerShell commands create one sidecar, keeping an existing same-name file.
- Return to normal defaults with `codex`; reuse trial with `codex -p NAME`.

## Fixture from the recorded native task

Create a fresh directory and these files, then run Codex with your selected profile:

`dedupe.py`:
```python
def dedupe(values):
    return list(set(values))
```
`test_dedupe.py`:
```python
from dedupe import dedupe
assert dedupe(["b", "a", "b", "c", "a"]) == ["b", "a", "c"]
assert dedupe([]) == []
assert dedupe([2, 1, 2]) == [2, 1]
print("PASS: stable-order dedupe, empty list, numeric list")
```
Task:
```sh
codex exec -p trial -s workspace-write --json 'Fix dedupe.py so dedupe returns each distinct value in its first-seen order. Run python3 test_dedupe.py and finish once it passes. Keep the function signature and do not edit the tests.'
```
Check actual local tests, native command exit, base config/auth comparisons, and inherited MCP/trust. `observed-result.json` records the run scope and result. Provider cost is read from the provider's usage console after your task, not inferred from an HTTP status.

## Current stable CLI check

On 2026-11-23, the complete official CLI 0.171.0 Linux package inspected this maintained receipt parser and ran `node guides/codex-provider-trial/receipt.test.cjs` without edits: 92.75s, native and test exits 0. The prior 0.163.0 provider sidecar, verification base config and auth stayed byte-equal; the disabled stdio MCP entry was inherited. `observed-current-result.json` records the exact scope and task result.

## Existing workflows

CC Switch already preserves unrelated configuration; All API Hub exports to it. This recipe uses Codex's built-in profile mechanism for one new CLI task, without another installed manager or changed defaults. Source comparison links are on the page.

## Local task and usage receipt

The generated native task saves `NAME-UTC-TIME.events.jsonl` plus `NAME-UTC-TIME.run.json` (UTC time, model, profile and native process exit). Each run keeps a timestamped pair. Select the events, then the matching timing file on the page to read the native turn state, command exits/output, final answer, native messages and usage. Parsing uses the browser File API; there are no file POSTs or analytics.

`receipt.js` also works without a browser:
```js
const {summarizeEvents, shareReceipt} = require('./receipt.js');
const fs = require('node:fs');
const result = summarizeEvents(fs.readFileSync('trial.events.jsonl', 'utf8'));
console.log(JSON.stringify(shareReceipt(result), null, 2));
```
The downloadable summary omits command text, outputs and final answer. A native turn can complete with a nonzero test command; inspect the task output. Match run time and model in the provider console for the charged amount. Native input includes cached input. The generated PowerShell command uses UTF-8 for Windows PowerShell and PowerShell 7.

## Next-session reuse

The sidecar remains on disk; the terminal environment key ends with the terminal. The page supplies a separate next-session key prompt and `codex -p NAME` launch so you can reuse the existing profile without recreating it. Use the same `CODEX_HOME`.
