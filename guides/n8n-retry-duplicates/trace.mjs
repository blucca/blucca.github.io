const buttons = [...document.querySelectorAll('[data-mode]')];
const metadata = {
  direct: { boundary: 'HTTP node input: two items', explanation: 'The node retries its two-item input. Item 43 succeeds on both attempts.', footer: 'Final outputs: render-42, render-43. Both items reached the HTTP server twice.' },
  'http-batching': { boundary: 'HTTP node input: two items · internal batch: one', explanation: 'HTTP batching serializes the requests inside the node. Its retry still receives both items.', footer: 'Final outputs: render-42, render-43. Internal HTTP batching keeps the two-item retry boundary.' },
  loop: { boundary: 'HTTP node input: one item per loop iteration', explanation: 'Item 42 retries in its own iteration. Item 43 is sent once, after 42 succeeds.', footer: 'Done outputs: render-42, render-43. Item 42 has two attempts; item 43 has one.' },
};
try {
  const data = await fetch('./recorded-runs.json').then(r => { if (!r.ok) throw new Error('Record unavailable'); return r.json(); });
  function render(mode) {
    const run = data.runs[mode];
    const info = metadata[mode];
    if (!run || !info) return;
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    document.querySelector('#boundary-label').textContent = info.boundary;
    document.querySelector('#trace-explainer').textContent = info.explanation;
    document.querySelector('#trace-footer').textContent = info.footer;
    document.querySelector('#request-count').textContent = String(run.requests.length);
    const successful = new Set();
    const rows = run.requests.map((r, index) => {
      const row = document.createElement('li');
      const number = document.createElement('span'); number.className = 'request-number'; number.textContent = String(index + 1).padStart(2, '0');
      const label = document.createElement('strong'); label.textContent = `${r.method} ${r.path}`;
      const identity = `${r.method} ${r.path}`;
      if (successful.has(identity)) {
        row.className = 'replayed';
        const note = document.createElement('small'); note.textContent = 'successful item replayed'; label.append(note);
      }
      if (r.status >= 200 && r.status < 300) successful.add(identity);
      const status = document.createElement('span'); status.className = `response${r.status >= 400 ? ' failed' : ''}`; status.textContent = String(r.status);
      row.append(number, label, status); return row;
    });
    document.querySelector('#request-trace').replaceChildren(...rows);
  }
  for (const button of buttons) button.addEventListener('click', () => render(button.dataset.mode));
  render('direct');
} catch {
  for (const button of buttons) button.disabled = true;
  document.querySelector('.lab-caption').textContent = 'The initial recorded trace and comparison table remain available. Open the source + fixtures link for all captured requests.';
}
