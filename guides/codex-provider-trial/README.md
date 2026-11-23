# Native Codex provider trial

A zero-install profile builder and complete project-trial recipe. Use `$CODEX_HOME/NAME.config.toml` with `codex -p NAME`; retain base MCP/trust and normal login/defaults.

- Live entry: https://blucca.github.io/guides/codex-provider-trial/
- Requires native sidecar profile loading, observed on Codex CLI 0.163.0.
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

## Existing workflows

CC Switch already preserves unrelated configuration; All API Hub exports to it. This recipe uses Codex's built-in profile mechanism for one new CLI task, without another installed manager or changed defaults. Source comparison links are on the page.
