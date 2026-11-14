"""Apply the proposed detach contract to a task-local google-adk 2.14.1.

This is an experiment, not a released Google API. It adds one explicit
cancel message and forwards that message when cancelling root node tasks.
"""
import ast
import difflib
from pathlib import Path

import google.adk
import google.adk.runners as runners
import google.adk.workflow._node_runner_utils as node_utils

assert google.adk.__version__ == "2.14.1"
originals = Path(__file__).with_name("runtime-originals")
originals.mkdir(exist_ok=True)
diff = []


def edit(module, replacements):
    path = Path(module.__file__)
    source = path.read_text()
    (originals / path.name).write_text(source)
    changed = source
    for old, new in replacements:
        assert changed.count(old) == 1, (path.name, old, changed.count(old))
        changed = changed.replace(old, new)
    ast.parse(changed)
    relative = "google/adk/" + ("workflow/" if module is node_utils else "") + path.name
    diff.extend(difflib.unified_diff(source.splitlines(True), changed.splitlines(True),
                                     fromfile="a/" + relative, tofile="b/" + relative))
    path.write_text(changed)


edit(runners, [
    ("logger = logging.getLogger('google_adk.' + __name__)",
     "# Proposed public cancellation message: stop this worker, retain resumable calls.\n"
     "DETACH_INVOCATION = _CALLER_CLOSED_EARLY_MSG\n\n"
     "logger = logging.getLogger('google_adk.' + __name__)"),
    ("      node_name: str,\n  ) -> None:\n    \"\"\"Cancel the root task",
     "      node_name: str,\n      cancel_message: Any = None,\n  ) -> None:\n    \"\"\"Cancel the root task"),
    ("      task.cancel()\n      cancelled_by_cleanup = True",
     "      task.cancel(cancel_message)\n      cancelled_by_cleanup = True"),
])
edit(node_utils, [
    ("from ..utils._runner_utils import _run_invocation_lifecycle",
     "from ..utils._runner_utils import _CALLER_CLOSED_EARLY_MSG\n"
     "from ..utils._runner_utils import _run_invocation_lifecycle"),
    ("        # 4. Main loop: consume events, persist, yield\n        try:",
     "        # 4. Main loop: consume events, persist, yield\n        cancel_message = None\n        try:"),
    ("              yield event\n        finally:\n          # _cleanup_root_task",
     "              yield event\n        except asyncio.CancelledError as error:\n"
     "          cancel_message = error.args[0] if error.args else None\n"
     "          raise\n        except GeneratorExit:\n"
     "          cancel_message = _CALLER_CLOSED_EARLY_MSG\n"
     "          raise\n        finally:\n          # _cleanup_root_task"),
    ("              task, runner.agent.name\n          )",
     "              task, runner.agent.name, cancel_message=cancel_message\n          )"),
])
Path(__file__).with_name("detach-proposal.patch").write_text("".join(diff))
print("Proposed detach contract applied to task-local google-adk 2.14.1 (two files).")
