# Pydantic AI: keep the first tool result unchanged

A tool can finish successfully while its recorded result changes later. This
small native lab checks a JSON dict containing a shared, mutable order-ID list.
All three agents finish with `done`; the application adds its second order in
all three runs.

| Native run | First result seen by the next two model requests | First result in saved history |
|---|---|---|
| Released 2.68.0, shared return | `[invoice-42]` → `[invoice-42, invoice-43]` | Both IDs |
| Content-only helper snapshot control | `[invoice-42]` → `[invoice-42]` | First ID |
| Fresh snapshot returned by the application tool | `[invoice-42]` → `[invoice-42]` | First ID |

The deployable JSON workaround is to return a fresh value from the tool:

```python
from copy import deepcopy

@agent.tool_plain
def read_orders() -> dict[str, list[str]]:
    return deepcopy(state)
```

## Run the complete lab

[Download the complete lab](https://blucca.github.io/research/pydantic-ai-json-history/pydantic-ai-json-history.zip).
In a fresh Python virtual environment (the package requires Python 3.11+):

```sh
python -m pip install -r requirements.txt
python probe.py > my-result.json
```

The expected exit code is **0**: the program asserts the changing stock history
and the two stable snapshot controls. It uses `FunctionModel`, a local Python
callback, with no LLM provider credentials or calls.

The model callback reads the actual `ToolReturnPart` afresh on each request.
After each agent completes, a separate oracle decodes `all_messages_json()`.
The helper control records its two real tool-call IDs. An additional direct
`ToolReturn` envelope check verifies that the content snapshot keeps nonempty
metadata, extra user content and the `tools` list as the original objects.

Tested on **pydantic-ai-slim 2.68.0 / Pydantic 2.13.5 / Python 3.14.8 / Linux
x86_64**. See [the complete observed results](observed-results.json).

The helper interception is a temporary lab control for this pinned release.
The application workaround uses the ordinary tool API. The measured scope is
one JSON mapping with a nested list and sequential tool calls; library-wide
snapshot semantics for other content types remain part of the upstream design.

Related live report: [pydantic/pydantic-ai #13412](https://github.com/pydantic/pydantic-ai/issues/13412).
The synthetic orders and this executable lab are our own example.

[Source and more correctness tools](https://blucca.github.io/) · MIT
