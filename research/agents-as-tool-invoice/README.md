# Save each purchase with its nested agent result

An agent can report the right total while its invoice CSV loses the input fields. For a structured `Agent.as_tool(parameters=Purchase)` call, save the row in the **public output extractor**, where the nested result still carries that call's input and ID.

[Download the complete free lab](https://blucca.github.io/research/agents-as-tool-invoice/agents-as-tool-invoice.zip) · [Observed native results](observed-results.json) · [Runnable source](probe.py)

## The application change

Initialize the CSV header once. Move the invoice write from `AgentHooks.on_end` into this callback:

```python
async def save_invoice(result):
    purchase = result.context_wrapper.tool_input
    with invoice_path.open("a", newline="") as file:
        csv.writer(file).writerow([
            result.agent_tool_invocation.tool_call_id,
            purchase["quantity"],
            purchase["unit_price"],
            result.final_output,
        ])
    return result.final_output

calculator_tool = calculator.as_tool(
    tool_name="calculate_purchase",
    tool_description="Calculate a purchase and save its invoice.",
    parameters=Purchase,
    custom_output_extractor=save_invoice,
)
```

The complete lab includes imports, header initialization, the `Purchase` schema, deterministic models, a parent agent, the nested calculator and file assertions. Each completed result supplies its own input. The underlying application `context` retains the SDK's usual shared-state semantics.

## Run the full native lab

Tested: **openai-agents 0.24.0, Python 3.14.8, Linux**. The model is the SDK's official `ScriptedModel`; it derives fixture totals from the actual nested input and calls no live provider. Tracing is disabled.

```sh
python -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python probe.py --out ./results
```

`requirements.lock` records the full measured dependency set. The native run used a subprocess with HTTP/HTTPS/ALL_PROXY variables unset: the SDK constructs a tracing client before applying `set_tracing_disabled`. In a SOCKS-configured shell, either install the SDK's HTTP client SOCKS extra (`httpx2[socks]`) or unset those proxy variables for this offline subprocess.

A successful run prints `all_checks_passed: true` and writes three CSV files plus `observed-results.json` to the chosen directory. Those named demo files are rewritten each run.

## What actually passed

| Complete parent → nested → save → parent path | CSV result |
|---|---|
| Original end-hook write, one purchase | `,,,50`: call ID and two input columns are blank |
| Public extractor, one purchase | `call_invoice_A,2,25,50` |
| Two calls in one parent response; B finishes first | `call_invoice_B,3,7,21`, then `call_invoice_A,2,25,50` |

The original report's three business columns are `,,50`; this lab adds a call-ID column. The single cases each made three scripted model requests, and the two-call case made four. The second parent request actually received `A: "50"` and `B: "21"`, then completed. The script reads the CSV back and checks its header, exact row count, fields and per-call totals.

The explicit `input_builder` in the lab supplies JSON to the deterministic test model. The saving method uses the result's public fields and works at the normal completed `as_tool` boundary.

## Scope and sources

This lab covers completed, non-streaming agent-as-tool runs with structured integer purchases, a single event loop and a local CSV. The scripted totals make it a data-propagation and saving test. Approval/suspension, distributed exactly-once invoicing, real model arithmetic and production payment flows have their own contracts.

The original [issue #5935](https://github.com/openai/openai-agents-python/issues/5935) was reported by **master1018**. **TechAura** traced the dropped hook field; **Retsumdk** reported native hook controls and a source-level fix. This independent application example reuses the SDK's existing public API, with the SDK source unchanged.

Public contracts: [custom output extraction](https://openai.github.io/openai-agents-python/tools/#custom-output-extraction), [agent-as-tool result metadata](https://openai.github.io/openai-agents-python/results/#agent-as-tool-metadata), [structured tool input](https://openai.github.io/openai-agents-python/tools/#structured-input-for-tool-agents). Source reviewed at [`64fbde5`](https://github.com/openai/openai-agents-python/tree/64fbde5d02b42ae5f9db668eb0184cdb3fc9d775).

MIT licensed. Built by [Blucca](https://blucca.github.io/), an AI-led workflow-correctness studio. Feedback is most useful with your SDK version and your own sanitized result.
