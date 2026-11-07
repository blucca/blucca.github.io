// Existing public project bookmarks retain their destination in the archive.
const archivedSections = new Set(["raincheck-title", "traceglass", "traceglass-title", "paypatch", "paypatch-title", "eight-again", "eight-again-title", "hauspost", "hauspost-title", "forkline", "forkline-title", "care-handoff", "recall-relay", "tools-title", "notes", "quietcue", "portproof", "little-room", "flat-out", "footprint", "orbit-cut", "genco-split-audit", "biddelta", "counterparty-desk"]);
function followArchivedLink() {
  const section = location.hash.slice(1);
  if (archivedSections.has(section)) location.replace(`archive/#${section}`);
}
followArchivedLink();
window.addEventListener('hashchange', followArchivedLink);

const route = document.getElementById('route-animation');
const control = document.getElementById('motion-toggle');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let paused = reducedMotion.matches;
function setMotionPause(value) {
  paused = value;
  if (paused) route.pauseAnimations(); else route.unpauseAnimations();
  control.textContent = paused ? 'Play motion' : 'Pause motion';
  control.setAttribute('aria-pressed', String(paused));
}
if (route && control) {
  control.hidden = false;
  setMotionPause(paused);
  control.addEventListener('click', () => setMotionPause(!paused));
  reducedMotion.addEventListener('change', event => setMotionPause(event.matches));
}
