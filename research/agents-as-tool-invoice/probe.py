"""Run three complete, provider-free agent-as-tool invoice checks."""

import argparse
import asyncio
import csv
import importlib.metadata
import json
import platform
from pathlib import Path

from agents import Agent, AgentHooks, Runner, set_tracing_disabled
from agents.testing import ModelStep, ScriptedModel, assistant_message, function_call
from pydantic import BaseModel


class Purchase(BaseModel):
    quantity: int
    unit_price: int


async def run_case(directory, name, purchases, save_with_extractor):
    csv_path = directory / f"{name}.csv"
    with csv_path.open("w", newline="") as file:
        csv.writer(file).writerow(["call_id", "quantity", "unit_price", "total"])

    observed = []
    parent_observed_outputs = {}
    started = []
    finished = []
    both_started = asyncio.Event()
    expected_outputs = {call_id: str(qty * price) for call_id, qty, price in purchases}

    def append_row(row):
        # This local demo appends one complete row without an intervening await.
        with csv_path.open("a", newline="") as file:
            csv.writer(file).writerow(row)

    class SaveFromHook(AgentHooks):
        async def on_end(self, context, agent, output):
            purchase = context.tool_input or {}
            append_row(["", purchase.get("quantity", ""), purchase.get("unit_price", ""), output])

    async def calculate(call):
        # A public input_builder supplies JSON to this deterministic test model.
        purchase = Purchase.model_validate_json(call.input[-1]["content"])
        started.append(purchase.model_dump())
        if len(purchases) == 2:
            if len(started) == 2:
                both_started.set()
            await asyncio.wait_for(both_started.wait(), timeout=5)
            if purchase.quantity == 2:
                # Force the second invoice to complete before the first.
                await asyncio.sleep(0)
        finished.append(purchase.model_dump())
        return [assistant_message(str(purchase.quantity * purchase.unit_price))]

    async def extract(result):
        purchase = Purchase.model_validate(result.context_wrapper.tool_input)
        invocation = result.agent_tool_invocation
        assert invocation is not None
        call_id = invocation.tool_call_id
        assert result.final_output == expected_outputs[call_id]
        row = [call_id, purchase.quantity, purchase.unit_price, result.final_output]
        observed.append(row)
        if save_with_extractor:
            append_row(row)
        return result.final_output

    async def parent_finishes(call):
        actual = {
            item["call_id"]: item["output"]
            for item in call.input
            if isinstance(item, dict) and item.get("type") == "function_call_output"
        }
        assert actual == expected_outputs, actual
        parent_observed_outputs.update(actual)
        return [assistant_message("invoices complete")]

    calculator_model = ScriptedModel([ModelStep.respond(calculate) for _ in purchases])
    calculator = Agent(
        name="Invoice calculator",
        model=calculator_model,
        hooks=None if save_with_extractor else SaveFromHook(),
    )
    calculate_purchase = calculator.as_tool(
        tool_name="calculate_purchase",
        tool_description="Calculate a purchase and save its local demo invoice.",
        parameters=Purchase,
        input_builder=lambda options: json.dumps(options["params"]),
        custom_output_extractor=extract,
        failure_error_function=None,
    )
    parent_model = ScriptedModel(
        [
            [
                function_call(
                    "calculate_purchase",
                    {"quantity": qty, "unit_price": price},
                    call_id=call_id,
                )
                for call_id, qty, price in purchases
            ],
            ModelStep.respond(parent_finishes),
        ]
    )
    answer = await Runner.run(
        Agent(name="Purchasing assistant", model=parent_model, tools=[calculate_purchase]),
        "Calculate and save the supplied synthetic purchases.",
    )
    assert answer.final_output == "invoices complete"
    assert len(calculator_model.calls) == len(purchases)
    assert len(parent_model.calls) == 2
    with csv_path.open(newline="") as file:
        table = list(csv.reader(file))
    assert table[0] == ["call_id", "quantity", "unit_price", "total"]
    rows = table[1:]
    expected_rows = [[call_id, str(qty), str(price), str(qty * price)] for call_id, qty, price in purchases]
    if save_with_extractor:
        assert sorted(rows) == sorted(expected_rows), rows
    else:
        assert rows == [["", "", "", "50"]], rows
    assert sorted(observed) == sorted([[call_id, qty, price, str(qty * price)] for call_id, qty, price in purchases])
    if len(purchases) == 2:
        assert finished[0] == {"quantity": 3, "unit_price": 7}, finished
    return {
        "case": name,
        "csv_rows": rows,
        "nested_results": observed,
        "model_start_inputs": started,
        "model_finish_inputs": finished,
        "parent_tool_outputs": parent_observed_outputs,
        "parent_final_output": answer.final_output,
        "scripted_model_requests": len(calculator_model.calls) + len(parent_model.calls),
    }


async def main(directory):
    directory.mkdir(parents=True, exist_ok=True)
    set_tracing_disabled(True)
    results = []
    for name, purchases, use_extractor in [
        ("stock_hook", [("call_invoice_A", 2, 25)], False),
        ("extractor_single", [("call_invoice_A", 2, 25)], True),
        ("extractor_two_calls", [("call_invoice_A", 2, 25), ("call_invoice_B", 3, 7)], True),
    ]:
        results.append(await run_case(directory, name, purchases, use_extractor))
    report = {
        "sdk": importlib.metadata.version("openai-agents"),
        "python": platform.python_version(),
        "platform": platform.system(),
        "model": "official ScriptedModel",
        "live_provider_requests": 0,
        "all_checks_passed": True,
        "cases": results,
    }
    (directory / "observed-results.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=Path("results"))
    asyncio.run(main(parser.parse_args().out))
