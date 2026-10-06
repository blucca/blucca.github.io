// MIT License — Copyright (c) 2026 blucca
import { converterUrlBefore, converterUrlAfter, inspectUrl } from './url-model.mjs';
const form = document.querySelector('#url-check');
const input = document.querySelector('#target-url');
const context = { userId: '7', portalId: '42', associatedObjectId: '123' };
function render() {
  const error = document.querySelector('#url-error');
  try {
    const target = input.value.trim();
    const url = new URL(target);
    if (url.protocol !== 'https:') throw new Error('Use an absolute HTTPS URL.');
    for (const [id, build] of [['before-url', converterUrlBefore], ['after-url', converterUrlAfter]]) {
      const result = inspectUrl(build(target, context));
      document.getElementById(id).textContent = `${result.url}\n\nDecoded query parameters:\n${JSON.stringify(result.parameters, null, 2)}`;
    }
    error.textContent = '';
  } catch (e) {
    error.textContent = e.message;
    for (const id of ['before-url', 'after-url']) document.getElementById(id).textContent = 'Enter a valid HTTPS target URL above.';
  }
}
form.addEventListener('submit', e => { e.preventDefault(); render(); });
render();
