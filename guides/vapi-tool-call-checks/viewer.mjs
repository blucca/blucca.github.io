const explanations = {
  'wrong-id': 'The second result repeats call-order-A. The output assertion catches the mismatch while both backend requests remain correct.',
  success: 'Each result keeps its source tool-call ID and customer-specific order. Both requests and the complete response envelope pass.',
  'backend-503': 'Customer A keeps its successful order result. Customer B receives an explicit tool error carrying call-order-B.',
  'empty-orders': 'Customer B receives a successful result containing an empty orders array. The call ID stays attached to that valid empty result.',
};
const buttons = [...document.querySelectorAll('[data-mode]')];
function element(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}
function render(run) {
  const status = document.querySelector('#contract-status');
  status.textContent = `Contract: ${run.checksPassed} / ${run.checksTotal} passed · exit ${run.exitCode}`;
  status.classList.toggle('failed', run.status === 'failed');
  document.querySelector('#run-explainer').textContent = explanations[run.scenario];
  const cards = run.actualResponse.results.map((result, index) => {
    const request = run.requests[index];
    const matches = request.body.toolCallId === result.toolCallId;
    const card = element('article', undefined, `pair-card${matches ? '' : ' mismatched'}`);
    card.append(element('p', `${request.body.customerId.replace('customer-', 'Customer ')} · backend ${request.status}`, 'eyebrow'));
    let title = result.error;
    if (result.result !== undefined) {
      const orders = JSON.parse(result.result).orders;
      title = orders.length ? orders.map(order => `${order.id.replace('order-', 'Order ')} · ${order.status}`).join('; ') : 'No orders · successful empty result';
    }
    card.append(element('h3', title));
    const dl = element('dl');
    dl.append(element('dt', 'Requested tool call'), element('dd', request.body.toolCallId), element('dt', 'Emitted toolCallId'), element('dd', result.toolCallId));
    card.append(dl, element('p', matches ? 'ID preserved' : `ID mismatch — expected ${request.body.toolCallId}`, 'pair-outcome'));
    return card;
  });
  document.querySelector('#pair-grid').replaceChildren(...cards);
  document.querySelector('#response-json').textContent = JSON.stringify(run.actualResponse, null, 2);
  for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.mode === run.scenario));
}
try {
  const response = await fetch(new URL('recorded-runs.json', import.meta.url));
  if (!response.ok) throw new Error('record unavailable');
  const data = await response.json();
  const runs = new Map(data.runs.map(run => [run.scenario, run]));
  for (const button of buttons) button.addEventListener('click', () => render(runs.get(button.dataset.mode)));
  render(runs.get('wrong-id'));
} catch {
  document.querySelector('#viewer-status').textContent = 'The selector is offline. The initial wrong-ID example and outcome table remain available below.';
  for (const button of buttons) button.disabled = true;
}
