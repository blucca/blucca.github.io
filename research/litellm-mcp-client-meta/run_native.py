"""Four live HTTP controls, then one existing SDK regression. No LLM model."""
import json
import importlib.metadata
import platform
import secrets
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import httpx
from drive import run

ROOT = Path(__file__).resolve().parent
REPO = ROOT / "repo"
OUT = ROOT / "results"
OUT.mkdir(exist_ok=True)
ENV = {**os.environ, "PYTHONPATH": str(REPO), "PYTHONDONTWRITEBYTECODE": "1", "OPENBLAS_NUM_THREADS": "1",
       "LITELLM_MASTER_KEY": "sk-" + secrets.token_hex(32)}
children = []


def budget_timeout(*_):
    raise TimeoutError("native execution budget elapsed")


signal.signal(signal.SIGTERM, budget_timeout)


def stage(name, **extra):
    (ROOT / "native-state.json").write_text(json.dumps({"stage": name, **extra}, indent=2))
    print(name, flush=True)


def start(command, log):
    handle = (OUT / log).open("w")
    process = subprocess.Popen(command, cwd=REPO, env=ENV, stdout=handle, stderr=subprocess.STDOUT, start_new_session=True)
    handle.close()
    children.append(process)
    return process


def stop(process):
    if process.poll() is None:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
    children.remove(process)


def ready(process, port):
    # Startup wait covers the CLI's reloader/child initialization; no network retry after readiness.
    for _ in range(120):
        if process.poll() is not None:
            raise RuntimeError(f"process {process.pid} exited {process.returncode} before readiness")
        try:
            with httpx.Client(timeout=1) as c:
                c.get(f"http://127.0.0.1:{port}/")
            return
        except httpx.TransportError:
            time.sleep(0.5)
    raise TimeoutError(f"port {port} startup")


def config(name, enabled):
    path = ROOT / name
    line = "" if enabled is None else f"    forward_client_meta: {str(enabled).lower()}\n"
    path.write_text('''model_list: []
mcp_servers:
  echo:
    server_id: meta-echo
    url: http://127.0.0.1:8765/mcp
    transport: http
    protocol_version: "2025-11-25"
    auth_type: none
    allow_all_keys: true
''' + line + '''general_settings:
  mcp_advertised_versions:
    - "2025-11-25"
''')
    return path


def gateway(label, cfg, expected):
    command = [sys.executable, str(REPO / "litellm/proxy/proxy_cli.py"), "--config", str(cfg),
               "--host", "127.0.0.1", "--port", "4000", "--num_workers", "1", "--detailed_debug",
               "--use_v2_migration_resolver"]
    (OUT / f"{label}-command.json").write_text(json.dumps(command, indent=2))
    p = start(command, f"{label}-proxy.log")
    try:
        ready(p, 4000)
        run("http://127.0.0.1:4000/mcp", OUT / f"{label}.json", expected, ENV["LITELLM_MASTER_KEY"])
    finally:
        stop(p)


SOURCE_PARENT = "eba880e108109fec9a9a131c6e26c71b9c2b5828"
summary = {"cases": []}
try:
    summary.update({"source_parent": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip(),
                    "python": platform.python_version(), "platform": platform.platform(),
                    "litellm": importlib.metadata.version("litellm"), "mcp": importlib.metadata.version("mcp")})
    assert summary["source_parent"] == SOURCE_PARENT, "checkout must match this lab source parent"
    assert summary["litellm"] == "1.110.0" and summary["mcp"] == "2.3.0", "install the recorded SDK versions"
    stage("provider-start")
    provider = start([sys.executable, str(ROOT / "tool_server.py")], "provider.log")
    ready(provider, 8765)
    run("http://127.0.0.1:8765/mcp", OUT / "direct.json", "preserved")
    summary["cases"].append("direct")
    stage("stock-gateway")
    cfg = config("enabled.yaml", True)
    gateway("stock-enabled", cfg, "dropped")
    summary["cases"].append("stock-enabled")
    stage("apply-source-patch")
    subprocess.run(["git", "apply", "--check", str(ROOT / "fix.patch")], cwd=REPO, check=True)
    subprocess.run(["git", "apply", str(ROOT / "fix.patch")], cwd=REPO, check=True)
    stage("fixed-gateway")
    gateway("fixed-enabled", cfg, "preserved")
    summary["cases"].append("fixed-enabled")
    stage("default-off-gateway")
    gateway("fixed-default", config("default.yaml", None), "dropped")
    summary["cases"].append("fixed-default")
    stop(provider)
    stage("mapped-sdk-regression")
    target = "tests/unit/mcp_client/test_mcp_client.py::test_call_tool_preserves_custom_meta_values_in_upstream_request"
    command = [sys.executable, "-m", "pytest", target, "-q", "--no-header"]
    with (OUT / "sdk-fixed.log").open("w") as log:
        test = subprocess.run(command, cwd=REPO, env=ENV, stdout=log, stderr=subprocess.STDOUT)
    summary["mapped_test_exit"] = test.returncode
    assert test.returncode == 0, "mapped SDK regression failed; read sdk-fixed.log"
    summary["status"] = "passed"
    stage("complete", status="passed")
except Exception as exc:
    summary["status"] = "failed"
    summary["error"] = f"{type(exc).__name__}: {exc}"
    stage("failed", error=summary["error"])
finally:
    for process in list(children):
        stop(process)
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary), flush=True)

# Failed native assertions must fail the advertised command, after child cleanup.
raise SystemExit(0 if summary["status"] == "passed" else 1)
