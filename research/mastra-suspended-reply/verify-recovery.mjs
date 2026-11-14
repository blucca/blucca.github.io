// Run against the linked author's deterministic fixture, not a production agent.
// Real HTTP, saved history, original workflow ID, and a legitimate next turn.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const api = (process.argv[2] ?? 'http://127.0.0.1:4111/api').replace(/\/$/, '');
const agentId = 'approval-fixture', resourceId = 'recovery-contract';
const threadId = `recovery-${crypto.randomUUID()}`;
const agentPath = `/agents/${agentId}`;
async function jsonRequest(path, body) {
  const response = await fetch(api + path, {
    ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, 200, `HTTP ${response.status}: ${await response.clone().text()}`);
  return response.json();
}
const send = message => jsonRequest(agentPath + '/send-message', { message, resourceId, threadId });
const history = () => jsonRequest(`/memory/threads/${threadId}/messages?agentId=${agentId}`);
function textCount(h, role, text) {
  return h.messages.filter(message => message.role === role && message.content.parts?.some(part => part.type === 'text' && part.text === text)).length;
}
function pendingTools(h) {
  return h.messages.flatMap(message => Object.entries(message.content.metadata?.suspendedTools ?? {}));
}
async function waitForHistory(predicate) {
  for (let i = 0; i < 30; i++) {
    const h = await history();
    if (predicate(h)) return h;
    await delay(100);
  }
  throw new Error('Expected persisted history within 3 seconds');
}

const first = await send('Start fixture workflow');
const suspended = await waitForHistory(h => pendingTools(h).length === 1);
const [originalToolCallId, tool] = pendingTools(suspended)[0];
assert.ok(tool.delegatedRunId, 'Missing original delegated workflow ID');
const approval = await send('I approve the fixture');
assert.equal(approval.accepted, true);
assert.equal(approval.runId, first.runId);
await delay(300);
const before = await history();
assert.equal(textCount(before, 'user', 'I approve the fixture') + textCount(before, 'signal', 'I approve the fixture'), 0, 'Expected the reported unsaved approval');
assert.equal(textCount(before, 'assistant', 'FIXTURE_FINAL_REPLY'), 0);

// Store the case outside either source repository. The command consumes its own pending ID once.
const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'mastra-recovery-'));
const casePath = join(dir, 'case.json');
writeFileSync(casePath, JSON.stringify({ api, agentId, threadId, resourceId,
  pendingSignalId: approval.signal.id, message: 'I approve the fixture', expectedText: 'FIXTURE_FINAL_REPLY' }));
const command = fileURLToPath(new URL('./recover.mjs', import.meta.url));
const recovered = spawnSync(process.execPath, [command, casePath], { encoding: 'utf8', timeout: 25000 });
assert.equal(recovered.status, 0, recovered.stderr);
const outcome = JSON.parse(recovered.stdout);
assert.deepEqual(outcome.resumedToolCallIds, [originalToolCallId]);
const after = await waitForHistory(h => textCount(h, 'assistant', 'FIXTURE_FINAL_REPLY') === 1);
assert.equal(textCount(after, 'user', 'I approve the fixture'), 1);
assert.equal(textCount(after, 'signal', 'I approve the fixture'), 0);
const result = after.messages.flatMap(message => message.content.parts ?? [])
  .map(part => part.toolInvocation?.result).find(value => value?.result?.approved === true);
assert.equal(result?.runId, tool.delegatedRunId, 'Recovery must complete the original workflow');

const nextSend = await send('Next ordinary turn');
assert.notEqual(nextSend.runId, first.runId, 'The next ordinary turn must start a fresh agent run');
const next = await waitForHistory(h => textCount(h, 'assistant', 'Fixture ready') === 1);
assert.equal(textCount(next, 'signal', 'Next ordinary turn'), 1);
const repeated = spawnSync(process.execPath, [command, casePath], { encoding: 'utf8', timeout: 25000 });
assert.notEqual(repeated.status, 0);
assert.match(repeated.stderr, /stopped before \/stream/);
assert.equal((await history()).messages.length, next.messages.length);
console.log(JSON.stringify({
  status: 'passed', threadId, originalAgentRunId: first.runId,
  originalWorkflowRunId: tool.delegatedRunId, originalToolCallId,
  before: { savedApproval: 0, finalReply: 0 },
  after: { savedApproval: 1, finalReply: 1, originalWorkflowCompleted: true },
  nextOrdinaryTurn: 'passed', repeatedPendingId: 'stopped before /stream',
  rawHistory: { before, after, next },
}, null, 2));
