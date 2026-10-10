const link = document.getElementById('open-live');
const status = document.getElementById('trial-status');
try {
  const response = await fetch('./endpoint.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Endpoint lookup failed.');
  const endpoint = await response.json(), url = new URL(endpoint.origin);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Endpoint format failed.');
  link.href = url.href;
  const until = new Date(endpoint.endsAt);
  if (!Number.isFinite(until.valueOf())) throw new Error('Trial date format failed.');
  if (until <= new Date()) {
    status.textContent = 'This live field trial has ended. Explore the recorded run or set up the open-source station.';
    link.href = 'https://github.com/blucca/dockproof/tree/research/opencv5-capture-loop/experiments/capture-loop';
    link.replaceChildren(document.createTextNode('Explore the station and recorded run ↗'));
  } else {
    status.textContent = `Free, limited-capacity trial through ${until.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · Your own session · 6 capture attempts`;
  }
} catch {
  status.textContent = 'Open the current live station above. The source and recorded run are linked below.';
}
