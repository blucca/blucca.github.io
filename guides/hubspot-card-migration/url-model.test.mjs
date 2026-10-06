import test from 'node:test';
import assert from 'node:assert/strict';
import {converterUrlBefore as before, converterUrlAfter as after, inspectUrl} from './url-model.mjs';
test('reproduces tenant corruption and missing first context key', () => {
  const u = new URL(before('https://api.example.com/card?tenant=alpha', {userId:'7',portalId:'42'}));
  assert.equal(u.searchParams.get('tenant'),'alpha?userId=7');
  assert.equal(u.searchParams.get('userId'),null);
  assert.equal(u.searchParams.get('portalId'),'42');
});
for (const suffix of ['', '?tenant=alpha', '?', '?tenant=alpha#details', '#details']) {
  test(`appends context for ${suffix || 'plain URL'}`, () => {
    const u = new URL(after(`https://api.example.com/card${suffix}`, {userId:'7',userEmail:'a+b@example.com'}));
    assert.equal(u.searchParams.get('userId'),'7');
    assert.equal(u.searchParams.get('userEmail'),'a+b@example.com');
    if (suffix.includes('tenant')) assert.equal(u.searchParams.get('tenant'),'alpha');
    if (suffix.includes('#')) assert.equal(u.hash,'#details');
  });
}
test('duplicate keys and prototype-shaped names remain data', () => {
  const result=inspectUrl(after('https://api.example.com/card?tag=one&tag=two&__proto__=value',{tag:'three'}));
  assert.deepEqual(result.parameters.tag,['one','two','three']);
  assert.deepEqual(result.parameters.__proto__,['value']);
});
