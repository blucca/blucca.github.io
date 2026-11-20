// SPDX-License-Identifier: MIT
// Independent non-production control. The externally loaded QoreDB module is BUSL-1.1.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
assert(process.argv[2], 'Usage: node --experimental-strip-types replay.mjs /path/to/diffUtils.ts');
const { compareResults, exportDiffAsJSON } = await import(pathToFileURL(resolve(process.argv[2])).href);
const { sqlite, fixtures } = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url)));
const result = {};
for (const [name, { left, right }] of Object.entries(fixtures)) {
  const diff = compareResults(left, right, ['id']);
  const exported = JSON.parse(exportDiffAsJSON(diff));
  assert.equal(diff.incomplete, false);
  result[name] = { stats:diff.stats, sourceRow:diff.rows[0], exportedRow:exported.rows[0],
    statusPreserved:exported.rows[0]._status === diff.rows[0].status,
    keyPreserved:exported.rows[0]._key === diff.rows[0].rowKey };
}
assert.equal(result.ordinary.statusPreserved, true);
assert.equal(result.ordinary.keyPreserved, true);
assert.equal(result.status_name.sourceRow.status, 'modified');
assert.deepEqual(result.status_name.exportedRow._status, { old:'paid', new:'unpaid' });
assert.equal(result.status_name.statusPreserved, false);
assert.equal(result.key_name.sourceRow.status, 'unchanged');
assert.equal(result.key_name.exportedRow._key, 'customer-A');
assert.equal(result.key_name.keyPreserved, false);
writeFileSync(new URL('./result.json',import.meta.url), JSON.stringify({node:process.version,sqlite,scope:'untouched TypeScript source module; synthetic native SQLite input; no desktop/IPC run',result},null,2));
console.log(JSON.stringify({node:process.version,sqlite,observed:Object.fromEntries(Object.entries(result).map(([k,v])=>[k,{stats:v.stats,statusPreserved:v.statusPreserved,keyPreserved:v.keyPreserved,exportedRow:v.exportedRow}]))},null,2));
