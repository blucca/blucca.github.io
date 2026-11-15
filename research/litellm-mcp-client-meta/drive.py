"""Raw HTTP avoids the host SDK's own exclude_none metadata serialization."""
import argparse
import json
import os
from pathlib import Path
import httpx

CUSTOM = {
    "route_note": "synthetic/客户-A",
    "nullable": None,
    "batch": {"invoice_ids": ["INV-41", "INV-42", "INV-42"], "nil": None},
    "sequence": [None, False, 7],
    "active": False,
    "scale": 1.25,
}
FIXTURE = {"progressToken": "fixture-progress", **CUSTOM}


def run(endpoint, output, expected, bearer_token=None):
    wire = []
    progress = []
    provider_visible_token = None
    headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
    if bearer_token:
        headers["Authorization"] = f"Bearer {bearer_token}"
    with httpx.Client(follow_redirects=True, timeout=40, headers=headers) as client:
        def rpc(method, params=None, request_id=None):
            body = {"jsonrpc": "2.0", "method": method}
            if params is not None:
                body["params"] = params
            if request_id is not None:
                body["id"] = request_id
            response = client.post(endpoint, json=body)
            wire.append({"body": body, "status": response.status_code, "response": response.text,
                         "content_type": response.headers.get("content-type"),
                         "session_id": response.headers.get("mcp-session-id")})
            response.raise_for_status()
            if session_id := response.headers.get("mcp-session-id"):
                client.headers["Mcp-Session-Id"] = session_id
            if request_id is None:
                return None
            if "application/json" in response.headers.get("content-type", ""):
                messages = [response.json()]
            else:
                messages = [json.loads(line[5:].strip()) for line in response.text.splitlines()
                            if line.startswith("data:")]
            if method == "tools/call":
                progress.extend(m["params"] for m in messages
                                if m.get("method") == "notifications/progress")
            message = next(m for m in messages if m.get("id") == request_id)
            if "error" in message:
                raise RuntimeError(message["error"])
            return message["result"]

        try:
            init = rpc("initialize", {"protocolVersion": "2025-11-25", "capabilities": {},
                                      "clientInfo": {"name": "metadata-contract-lab", "version": "1"}}, 1)
            client.headers["MCP-Protocol-Version"] = init["protocolVersion"]
            rpc("notifications/initialized")
            tools = rpc("tools/list", {}, 2)["tools"]
            name = next(t["name"] for t in tools if t["name"].endswith("capture_meta"))
            result = rpc("tools/call", {"name": name, "arguments": {"record": "INV-42"}, "_meta": FIXTURE}, 3)
            assert not result.get("isError", False), result
            text = next(c["text"] for c in result["content"] if c["type"] == "text")
            observed = json.loads(text)
            assert observed["record"] == "INV-42", observed
            meta = observed["meta"]
            provider_visible_token = meta.get("progress_token", meta.get("progressToken"))
            if expected == "preserved":
                projection = {k: meta[k] for k in CUSTOM}
                # JSON text comparison also distinguishes boolean, number and null types.
                assert json.dumps(projection, sort_keys=True, ensure_ascii=False) == json.dumps(CUSTOM, sort_keys=True, ensure_ascii=False), projection
            else:
                assert not set(CUSTOM).intersection(meta), meta
            assert any(p.get("progressToken") == FIXTURE["progressToken"]
                       and p.get("progress") == 0.5 and p.get("total") == 1.0
                       for p in progress), progress
            report = {"status": "passed", "endpoint": endpoint, "expectation": expected,
                      "tool_name": name, "observed": observed, "custom_fields": sorted(CUSTOM)}
        except Exception as exc:
            report = {"status": "failed", "endpoint": endpoint, "expectation": expected,
                      "error": f"{type(exc).__name__}: {exc}"}
        finally:
            report["wire"] = wire
            report["progress"] = progress
            report["provider_visible_token"] = provider_visible_token
            Path(output).write_text(json.dumps(report, ensure_ascii=False, indent=2))
        assert report["status"] == "passed", report.get("error")
        return report

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("endpoint")
    parser.add_argument("output")
    parser.add_argument("expected", choices=["preserved", "dropped"])
    args = parser.parse_args()
    result = run(args.endpoint, args.output, args.expected, os.environ.get("MCP_BEARER_TOKEN"))
    print(json.dumps({k: v for k, v in result.items() if k != "wire"}, ensure_ascii=False))
