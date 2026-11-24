/* Native JSONL → local completion receipt; pure parser also runnable with Node. */
(function (root) {
  function summarizeEvents(text) {
    const commands = new Map(), errors = [];
    let usage = {};
    let lines = 0, malformed = 0, completed = 0, failed = false, finalAnswer = '';
    for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
      if (!line.trim()) continue;
      let event;
      try { event = JSON.parse(line); } catch { malformed++; continue; }
      if (!event || typeof event !== 'object') { malformed++; continue; }
      lines++;
      if (event.type === 'turn.completed') {
        completed++;
        // Native exec reports the thread's cumulative snapshot, not a turn delta.
        usage = Object.fromEntries(Object.entries(event.usage || {}).filter(([, value]) => typeof value === 'number' && Number.isFinite(value)));
      }
      if (event.type === 'turn.failed') failed = true;
      if (event.type === 'turn.failed' || event.type === 'error') {
        const message = event.error?.message || event.message;
        if (typeof message === 'string') errors.push(message);
      }
      const item = event.item;
      if (!item || !['item.started', 'item.updated', 'item.completed'].includes(event.type)) continue;
      if (item.type === 'error' && event.type === 'item.completed' && typeof item.message === 'string') errors.push(item.message);
      if (item.type === 'command_execution') {
        const id = item.id || 'anonymous-' + lines;
        const prior = commands.get(id) || {};
        commands.set(id, {...prior, ...item, event_type: event.type});
      }
      if (item.type === 'agent_message' && event.type === 'item.completed' && typeof item.text === 'string') finalAnswer = item.text;
    }
    const list = [...commands.values()];
    const exits = list.filter(c => Number.isInteger(c.exit_code));
    return {
      schema_version: 2,
      usage_basis: 'latest_reported_thread_total',
      status: failed ? 'failed' : completed ? 'completed' : 'incomplete',
      completed_turns: completed,
      parsed_events: lines,
      malformed_lines: malformed,
      commands: {total: list.length, exit_zero: exits.filter(c => c.exit_code === 0).length, exit_nonzero: exits.filter(c => c.exit_code !== 0).length, unfinished: list.length - exits.length},
      usage,
      details: {commands: list, final_answer: finalAnswer, errors}
    };
  }
  function shareReceipt(summary, run = null) {
    const {details, ...receipt} = summary;
    if (run) {
      receipt.run = {};
      for (const key of ['started_utc', 'finished_utc', 'profile', 'model', 'codex_version']) {
        if (typeof run[key] === 'string') receipt.run[key] = run[key];
      }
      if (Number.isInteger(run.codex_exit)) receipt.run.codex_exit = run.codex_exit;
    }
    return receipt;
  }
  const api = {summarizeEvents, shareReceipt};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CodexTrialReceipt = api;
})(typeof globalThis === 'object' ? globalThis : this);
