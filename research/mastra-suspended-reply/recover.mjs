// Issue #30190: cancel the queued input, then invoke auto-resume on the same thread.
// Tested with Core 1.82.0 / CLI 1.38.0, single pending workflow approval.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const c = JSON.parse(readFileSync(process.argv[2], 'utf8'));
for (const key of ['api', 'agentId', 'threadId', 'resourceId', 'pendingSignalId', 'message', 'expectedText']) {
  assert.equal(typeof c[key], 'string', `Missing string: ${key}`);
  assert.ok(c[key].trim(), `Empty value: ${key}`);
}
const agentPath = `/agents/${encodeURIComponent(c.agentId)}`;
async function post(path, body) {
  const response = await fetch(c.api.replace(/\/$/, '') + agentPath + path, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  assert.equal(response.status, 200, `HTTP ${response.status}: ${text}`);
  return text;
}

const cancelled = JSON.parse(await post('/threads/signals/cancel', {
  resourceId: c.resourceId, threadId: c.threadId, signalIds: [c.pendingSignalId],
}));
// A stale/already-consumed ID stops here, before replaying the approval.
assert.deepEqual(cancelled.cancelledSignalIds, [c.pendingSignalId], 'The specified pending signal was not cancelled; stopped before /stream');
const stream = await post('/stream', {
  messages: c.message, memory: { thread: c.threadId, resource: c.resourceId },
});
// The tested Mastra transport emits one JSON data line per event.
const events = stream.split(/\r?\n/).filter(line => line.startsWith('data: ') && line !== 'data: [DONE]')
  .map(line => JSON.parse(line.slice(6)));
assert.ok(!events.some(event => event.type === 'error'), 'The stream emitted an error');
const resumed = events.filter(event => event.type === 'tool-call-resumed');
const finalText = events.filter(event => event.type === 'text-delta').map(event => event.payload.text).join('');
assert.ok(resumed.length, 'Expected a suspended tool to resume');
assert.ok(finalText.includes(c.expectedText), `Expected final text: ${c.expectedText}`);
console.log(JSON.stringify({
  status: 'passed', threadId: c.threadId,
  cancelledSignalId: c.pendingSignalId,
  resumedToolCallIds: resumed.map(event => event.payload.toolCallId),
  finalText,
}, null, 2));
