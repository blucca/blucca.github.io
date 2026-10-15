import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { reserveBudget } from './credit-budget.mjs';
import { partnerLabels, partnerAnchors } from './planner/programme.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, '../..');
const privateDir = path.resolve(process.env.BRIDGEBILL_PRIVATE_DIR || 'temp/bridgebill-private');
const idFile = process.env.QLOO_ENTITY_IDS || path.join(privateDir, 'entity-ids.json');
const catalogue = JSON.parse(fs.readFileSync(path.join(here, 'coverage-input.json'), 'utf8'));
const filmMap = new Map(catalogue.films.map(f => [f.slug, f]));
const groups = { regular_cinema: ['amelie', 'cinema-paradiso', 'the-grand-budapest-hotel'], book_club: ['white-teeth', 'norwegian-wood'], record_shop: ['talking-heads', 'david-bowie', 'nina-simone'] };
fs.mkdirSync(privateDir, { recursive: true, mode: 0o700 });
const pending = new Map();
const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const save = (file, data) => {
  const runtime = path.resolve(process.env.BRIDGEBILL_RUNTIME_DIR || 'temp/bridgebill-runtime');
  fs.mkdirSync(runtime, { recursive: true, mode: 0o700 });
  const staging = path.join(runtime, createHash('sha256').update(file).digest('hex') + '.json');
  fs.writeFileSync(staging, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(staging, file);
};
const fail = (message, status = 502) => Object.assign(new Error(message), { status });
const digest = data => createHash('sha256').update(JSON.stringify(data)).digest('hex');
const oneAtATime = (key, fn) => {
  if (!pending.has(key)) pending.set(key, fn().finally(() => pending.delete(key)));
  return pending.get(key);
};

function normalized(raw, ids, group) {
  if (raw?.success !== true || raw.warnings?.length) throw fail('Qloo returned an incomplete audience signal. The current plan is retained.');
  const rows = raw.results?.entities;
  if (!Array.isArray(rows) || rows.length !== 12) throw fail('Qloo did not return the complete 12-film shelf.');
  const byId = new Map(catalogue.films.map(f => [ids[f.slug], f]));
  const seen = new Set();
  const result = rows.map(row => {
    const film = byId.get(row.entity_id), affinity = row.query?.affinity;
    if (!film || seen.has(row.entity_id) || !Number.isFinite(affinity) || affinity < 0 || affinity > 1) throw fail('Qloo shelf validation failed.');
    seen.add(row.entity_id);
    return { slug: film.slug, title: film.name, entityId: row.entity_id, affinity };
  }).sort((a, b) => b.affinity - a.affinity || a.slug.localeCompare(b.slug));
  return { group, rows: result.map((row, index) => ({ ...row, rank: 1 + result.filter(other => other.affinity > row.affinity).length })) };
}

async function ranking(group) {
  if (!Object.hasOwn(groups, group)) throw fail('Select Book club or Record shop.', 400);
  return oneAtATime(`qloo:${group}`, async () => {
    const ids = read(idFile);
    if (!ids || [...catalogue.films.map(f => f.slug), ...groups[group]].some(slug => !ids[slug])) throw fail('The host needs its reviewed Qloo entity IDs.', 503);
    const file = path.join(privateDir, `qloo-${group}.json`), cached = read(file);
    const project = (record, stale = false) => ({ ...normalized(record.response, ids, group), fetchedAt: record.at, cached: record !== fresh, stale, source: 'Qloo Insights API', anchorNames: group === 'regular_cinema' ? ['Amélie', 'Cinema Paradiso', 'The Grand Budapest Hotel'] : partnerAnchors[group] });
    let fresh;
    if (cached && Date.now() - Date.parse(cached.at) < 86400000) return project(cached);
    const key = process.env.QLOO_API_KEY || (process.env.QLOO_API_KEY_FILE ? fs.readFileSync(process.env.QLOO_API_KEY_FILE, 'utf8').trim() : '');
    if (!key) { if (cached) return project(cached, true); throw fail('The host needs a Qloo API key.', 503); }
    const params = { 'filter.type': 'urn:entity:movie', 'filter.results.entities': catalogue.films.map(f => ids[f.slug]).join(','), 'signal.interests.entities': groups[group].map(slug => ids[slug]).join(','), 'bias.trends': 'off', take: '12' };
    try {
      const response = await fetch(`https://hackathon.api.qloo.com/v2/insights?${new URLSearchParams(params)}`, { headers: { 'X-Api-Key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(25000) });
      if (!response.ok) throw fail(`Qloo request returned HTTP ${response.status}. Retry later.`);
      const data = await response.json();
      normalized(data, ids, group);
      fresh = { at: new Date().toISOString(), path: '/v2/insights', params, response: data };
      save(file, fresh);
      return project(fresh);
    } catch (error) {
      if (cached) return project(cached, true);
      throw fail(error.status ? error.message : 'Qloo is taking longer than expected. Retry later.');
    }
  });
}

async function rankings(partner) {
  if (!Object.hasOwn(partnerLabels, partner)) throw fail('Select Book club or Record shop.', 400);
  return { regular: await ranking('regular_cinema'), partner: await ranking(partner), coverage: '12 reviewed films; 3 cinema anchors; 2 books or 3 artists. Mrs Dalloway was omitted because Qloo Insights ignored both reviewed editions.' };
}

async function brief(input) {
  if (!input || !Object.hasOwn(partnerLabels, input.partner) || !Array.isArray(input.films) || input.films.length !== 2 || input.films[0] === input.films[1] || input.films.some(slug => !filmMap.has(slug))) throw fail('Choose two different shelf films and a partner preset before drafting.', 400);
  if (!Array.isArray(input.flags) || input.flags.length !== 2 || input.flags.some(flag => typeof flag?.capacityIssue !== 'boolean' || !['estimate', 'quoted', 'confirmed'].includes(flag?.quoteStatus))) throw fail('Supply the two screening planning states.', 400);
  const data = await rankings(input.partner);
  const context = { briefVersion: 3, partner: partnerLabels[input.partner], interests: partnerAnchors[input.partner], films: input.films.map((slug, i) => {
    const film = filmMap.get(slug);
    return { title: film.name, year: film.year, director: film.creator, planningMinutes: film.runtime_minutes, sourcedEditorialContext: film.curatorial_rationale, regularRank: data.regular.rows.find(row => row.slug === slug).rank, partnerRank: data.partner.rows.find(row => row.slug === slug).rank, bookingRoute: film.booking_destination, ...input.flags[i] };
  }), evidenceScope: 'Ranks describe these declared taste anchors inside a fixed 12-film shelf. Attendance, rights, prices and community participation need separate evidence.' };
  const hash = digest(context), file = path.join(privateDir, `brief-${hash}.json`);
  const previous = read(file);
  if (previous?.brief) return { ...previous.public, brief: previous.brief, cached: true };
  return oneAtATime(`brief:${hash}`, async () => {
    const apiKey = process.env.NEBIUS_API_KEY, model = process.env.NEBIUS_MODEL || 'nvidia/nemotron-3-super-120b-a12b';
    if (!apiKey || !process.env.BRIDGEBILL_BUDGET_FILE) throw fail('The writing service is offline. The full budget and distributor enquiry export remain available.', 503);
    const schema = { type: 'object', additionalProperties: false, properties: { programme_title: { type: 'string', minLength: 5 }, opening_note: { type: 'string', minLength: 25 }, partner_note: { type: 'string', minLength: 25 }, invitation_draft: { type: 'string', minLength: 25 }, questions: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'string', minLength: 15 } } }, required: ['programme_title', 'opening_note', 'partner_note', 'invitation_draft', 'questions'] };
    const request = { model, messages: [
      { role: 'system', content: 'Write a useful film-programme brief for a small arts venue from the supplied tool results. Return JSON matching the schema. opening_note: name the FIRST film, report its cinema and partner ranks out of 12, and connect its sourced editorial context to the partner interests. partner_note: do the same for the SECOND film. Each note has at most two sentences. invitation_draft: ask the community partner whether these two films would interest them; use [venue] and [dates] placeholders. Bridgebill is software, not a venue. questions: exactly four nonempty practical questions; first ask the distributor about rights/date/format availability, second ask for written minimum/share/tax/charge terms, then ask the partner about interest and discussion/access needs. Keep titles and order. Treat cultural fit as a hypothesis. Attendance and licence approvals need separate evidence; omit sales forecasts and invented confirmations.' },
      { role: 'user', content: JSON.stringify(context) },
    ], max_tokens: 1800, temperature: 0.3, reasoning_effort: 'low', response_format: { type: 'json_schema', json_schema: { name: 'booking_brief', strict: true, schema } } };
    reserveBudget({ model, request, file: process.env.BRIDGEBILL_BUDGET_FILE });
    const reservation = reserveBudget({ model, request });
    const response = await fetch(`${(process.env.NEBIUS_BASE_URL || 'https://api.tokenfactory.us-central1.nebius.com/v1').replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(65000) });
    if (!response.ok) throw fail(`The writing service returned HTTP ${response.status}. Your budget and enquiry pack are ready to use.`);
    const raw = await response.json();
    save(path.join(privateDir, `model-receipt-${reservation.reservationId}.json`), { at: new Date().toISOString(), raw, reservation });
    let content;
    try { content = JSON.parse(raw.choices?.[0]?.message?.content); } catch { throw fail('The writing service returned an incomplete brief. Retry drafting; your plan is retained.'); }
    if (!content || ['programme_title', 'opening_note', 'partner_note', 'invitation_draft'].some(k => typeof content[k] !== 'string' || content[k].trim().length < 5 || content[k].length > 1600) || !Array.isArray(content.questions) || content.questions.length < 3 || content.questions.length > 5 || content.questions.some(q => typeof q !== 'string' || q.length > 500)) throw fail('The writing service returned an incomplete brief. Your plan is retained.');
    const publicMeta = { generatedAt: new Date().toISOString(), model, cached: false, films: input.films, partner: input.partner };
    save(file, { context, brief: content, public: publicMeta });
    return { ...publicMeta, brief: content };
  });
}

async function body(req) {
  let text = '';
  for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 8192) throw fail('Use the small programme request from the worksheet.', 413); }
  try { return JSON.parse(text); } catch { throw fail('Send a JSON programme request.', 400); }
}
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff': 'font/woff', '.txt': 'text/plain', '.csv': 'text/csv', '.webp': 'image/webp', '.png': 'image/png' };
http.createServer(async (req, res) => {
  const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  try {
    const url = new URL(req.url, 'http://localhost');
    const origin = req.headers.origin;
    const originAllowed = !origin || origin === 'https://blucca.github.io' || new URL(origin).host === req.headers.host;
    if (origin && originAllowed) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (url.pathname.startsWith('/api/')) {
      if (!originAllowed) throw fail('Open Bridgebill to use this service.', 403);
      if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type' }); return res.end(); }
      if (req.method === 'GET' && url.pathname === '/api/status') return json(200, { name: 'Bridgebill', version: '1.0', qloo: 'fixed 12-film shelf', model: 'NVIDIA Nemotron', mode: 'live with labelled server cache' });
      if (req.method === 'GET' && url.pathname === '/api/rankings') return json(200, await rankings(url.searchParams.get('partner') || 'book_club'));
      if (req.method === 'POST' && url.pathname === '/api/brief') {
        if (!req.headers['content-type']?.startsWith('application/json')) throw fail('Send application/json.', 415);
        return json(200, await brief(await body(req)));
      }
      return json(404, { message: 'API route not found.' });
    }
    if (!['GET', 'HEAD'].includes(req.method)) return json(405, { message: 'Use GET.' });
    if (url.pathname === '/') { res.writeHead(302, { Location: '/research/bridgebill/planner/' }); return res.end(); }
    let relative = decodeURIComponent(url.pathname).replace(/^\//, '');
    if (relative.endsWith('/')) relative += 'index.html';
    const file = path.resolve(site, relative);
    const allowed = relative.startsWith('research/bridgebill/planner/') || ['research/bridgebill/coverage-input.json', 'research/bridgebill/screening-budget.csv', 'favicon.svg', 'assets/studio/fonts/instrument-sans-latin.woff'].includes(relative);
    if (!file.startsWith(site + path.sep) || !allowed || relative.includes('/.') || !fs.existsSync(file) || !fs.statSync(file).isFile()) return json(404, { message: 'Page not found.' });
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  } catch (error) {
    console.error(new Date().toISOString(), error.status || 500, error.message);
    json(error.status || 503, { message: error.status ? error.message : 'The service is temporarily unavailable. Your worksheet stays in your browser.' });
  }
}).listen(Number(process.env.PORT || 4327), '127.0.0.1', () => console.log('Bridgebill ready on loopback.'));
