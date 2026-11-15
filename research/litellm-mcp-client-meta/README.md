# Keep client metadata in an MCP tool call

[Download the complete free lab](https://blucca.github.io/research/litellm-mcp-client-meta/litellm-mcp-client-meta.zip) · [Recorded HTTP results](observed-results.json) · [Source proposal](fix.patch)

A tool can receive the right arguments and still lose the caller's routing context. This lab sends one ordinary `tools/call` through a real LiteLLM MCP gateway to a local MCP tool provider. The tool returns the metadata it actually receives.

The fixed contract preserves custom strings, Unicode, a top-level JSON `null`, nested `null`, duplicate IDs, arrays, booleans and numbers. It uses no LLM endpoint or paid model API. All invoice labels are synthetic.

## Native controls

| Path | Custom fields at the tool |
|---|---|
| Direct HTTP to the MCP provider | Preserved |
| Stock gateway, `forward_client_meta: true` in YAML | Dropped |
| Source proposal, `forward_client_meta: true` | Preserved |
| Source proposal, flag omitted | Dropped |

Each result contains the real HTTP initialize, initialized notification, tool listing and tool-call exchange. The gateway's `progressToken` is hop-local: the existing MCP dispatcher supplies the token for its upstream request. The check compares custom metadata, including JSON value types; tracing and progress fields retain their existing gateway ownership.

## Run the provider and inspect your own request

The full lab is pinned to LiteLLM source `eba880e108109fec9a9a131c6e26c71b9c2b5828` and MCP SDK `2.3.0`. The source proposal is local to your isolated checkout. It is derived from thinhnx128's closed, unmerged draft #51189 and also connects the YAML loader and preserves top-level nulls through the SDK serializer.

The recorded runs use Python **3.12.3 / Linux x86-64**, LiteLLM **1.110.0** built from the exact source parent, and MCP **2.3.0**. `requirements.lock.txt` records the actual dependency snapshot (including Pydantic 2.14.3 and httpx2 2.16.0); this lab builds the matching Rust extension from that source. `runtime-manifest.json` records the measured versions. The install uses this single-HTTP-lab dependency set; additional proxy services use their corresponding project extras.

Extract the package into a fresh directory. Install Git, Python 3.12 and a working Rust/C toolchain. The editable build compiles the native extension; our one-job development build took about 11 minutes.

```sh
python3.12 -m venv venv
git init repo
git -C repo remote add origin https://github.com/BerriAI/litellm.git
git -C repo fetch --filter=blob:none --depth=1 origin eba880e108109fec9a9a131c6e26c71b9c2b5828
git -C repo sparse-checkout init --cone
git -C repo sparse-checkout set litellm litellm_cli litellm-rust tests/unit/mcp_client tests/_support
git -C repo checkout --detach FETCH_HEAD
CARGO_BUILD_JOBS=1 venv/bin/python -m pip install -r requirements.txt
venv/bin/python run_native.py
```

Completion: command exit **0**, all four `results/*.json` controls passed, and `results/summary.json` has `status: "passed"` / `mapped_test_exit: 0`. The harness generates a fresh local master key, starts the anonymous provider and three sequential, authenticated gateway processes, applies `fix.patch` after the stock control, and cleans up the child processes.

The source patch is applied **once**, inside this lab's checkout. Use a fresh directory for the next whole run, or reverse the patch in this isolated clone first: `git -C repo apply -R ../fix.patch`. Keep the recorded dependency snapshot when comparing the same contract.

### A quick provider/direct check

For this step, the only dependencies are MCP 2.3.0 and httpx. In one terminal:

```sh
venv/bin/python tool_server.py
```

In another:

```sh
venv/bin/python drive.py http://127.0.0.1:8765/mcp direct.json preserved
```

For an authenticated gateway already registered with this echo provider:

```sh
MCP_BEARER_TOKEN="$YOUR_GATEWAY_KEY" venv/bin/python drive.py \
  http://127.0.0.1:4000/mcp gateway.json preserved
```

The driver discovers the registered `capture_meta` tool. Configure the real upstream URL reachable from your gateway; the included YAML uses loopback because both services run on one lab host. On the patched gateway, `forward_client_meta: true` is a property of that MCP server's YAML entry. With the flag omitted, `dropped` is the expected custom-field result.

```yaml
mcp_servers:
  echo:
    url: http://127.0.0.1:8765/mcp
    transport: http
    protocol_version: "2025-11-25"
    auth_type: none
    allow_all_keys: true
    forward_client_meta: true
```

`drive.py` uses the same editable synthetic JSON for every call and saves the actual HTTP bodies, returned metadata, host progress notifications and provider-visible hop token. Edit `CUSTOM` to check your own routing contract. The tool only echoes its input; it performs no external write.

## How the proposal works

`GatewayOperations` extracts `params._meta` for ordinary tools/call requests and passes it through the common authorized-call path to the MCP manager. A per-server default-false flag gates the forwarding. Both YAML-created and database-created server objects load the flag.

The MCP client's request wrapper retains the SDK's normal request serialization and restores the complete metadata object after `exclude_none` serialization. The client continues to use `send_request`, progress callbacks, tool-result validation and the existing interaction loop. The extra native SDK regression checks a real in-process client/server exchange: **1 passed in 2.06 seconds**. The four live controls were complete before missing test-collection dependencies were supplied; only that SDK target was resumed.

Measured application scope: the public `/mcp` endpoint, one real streamable-HTTP upstream provider, one ordinary tool, and synthetic JSON metadata. Named/server/toolset routes share the source path; this lab runs `/mcp`. REST `/mcp/tools/call`, virtual/OpenAPI tools, model providers and other runtimes have their own acceptance cases.

## Attribution

- Original deployment request: yanir75, [LiteLLM #51171](https://github.com/BerriAI/litellm/issues/51171).
- Starting draft: thinhnx128, [PR #51189](https://github.com/BerriAI/litellm/pull/51189), commit `9812191dc0b0f44bcbd0a77a134d8f783f786e6d`. The draft is closed and unmerged. LiteLLM's MIT notice is included.
- The serializer/loader completion, native harness and synthetic fixture were built by Blucca with OpenAI Codex. A separate Codex review checks the scoped implementation.

Have a metadata-dependent tool in your registry? Send your LiteLLM/MCP versions, the exact custom JSON and the direct-versus-gateway observation. We can agree a complete acceptance case, scope, budget and date for your own deployment.
