import { calculateBudget } from './budget.mjs';

const STORAGE = 'bridgebill-worksheet-v1';
const money = pence => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pence / 100);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const $ = id => document.getElementById(id);
const quoteLabels = { estimate: 'Planning estimate', quoted: 'Written quote received', confirmed: 'Screening rights confirmed' };
const venueFields = ['name', 'partner', 'address', 'contact', 'format', 'basis'];
const numericFields = ['capacity', 'attendance', 'ticketPrice', 'fixedCosts', 'minimumFee', 'sharePercent'];
let films = [], plan, results = [];

function examplePlan() {
  const screening = { customTitle: '', customRuntime: '', time: '19:30', capacity: '100', ticketPrice: '10.00', minimumFee: '93.00', sharePercent: '35', quoteStatus: 'estimate', quoteReference: '', notes: '' };
  return {
    kind: 'bridgebill-worksheet', version: 1,
    venue: { name: 'Example Arts Centre', partner: 'A season with our local book club', address: '', contact: '', format: 'DCP', basis: 'VAT-exclusive' },
    screenings: [
      { ...screening, filmId: 'before-sunrise-1995', date: '2026-11-20', fixedCosts: '250.00', attendance: '40' },
      { ...screening, filmId: 'the-last-waltz-1978', date: '2026-11-27', fixedCosts: '180.00', attendance: '30' },
    ],
  };
}

function filmFor(screening) { return films.find(film => film.slug === screening.filmId); }
function titleFor(screening) { return filmFor(screening)?.name || screening.customTitle || 'Your film'; }
function dateFor(screening) { return [screening.date || '[Proposed date]', screening.time || '[Start time]'].join(' at '); }
function message(text) { if ($('status').textContent !== text) $('status').textContent = text; }

function validatedPlan(raw) {
  if (raw?.kind !== 'bridgebill-worksheet' || raw.version !== 1 || !raw.venue || !Array.isArray(raw.screenings) || raw.screenings.length !== 2) throw new Error('Open a Bridgebill v1 plan containing two screenings.');
  const text = (value, name, limit = 500) => {
    if (typeof value !== 'string' || value.length > limit) throw new Error(`${name}: use text of up to ${limit} characters.`);
    return value;
  };
  const venue = Object.fromEntries(venueFields.map(key => [key, text(raw.venue[key], `Venue ${key}`)]));
  const screenings = raw.screenings.map((s, i) => {
    if (!s || (!films.some(f => f.slug === s.filmId) && s.filmId !== 'custom')) throw new Error(`Screening ${i + 1}: select a film from the shelf or your own title.`);
    if (!Object.hasOwn(quoteLabels, s.quoteStatus)) throw new Error(`Screening ${i + 1}: select a quotation status.`);
    const out = { filmId: s.filmId, quoteStatus: s.quoteStatus };
    for (const key of ['customTitle', 'customRuntime', 'date', 'time', 'quoteReference', 'notes']) out[key] = text(s[key], `Screening ${i + 1} ${key}`, key === 'notes' ? 2000 : 350);
    if (out.date && (!/^\d{4}-\d{2}-\d{2}$/.test(out.date) || !Number.isFinite(Date.parse(out.date)) || new Date(out.date).toISOString().slice(0, 10) !== out.date)) throw new Error(`Screening ${i + 1}: enter a calendar date as YYYY-MM-DD.`);
    if (out.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(out.time)) throw new Error(`Screening ${i + 1}: enter a start time as HH:MM.`);
    if (out.customRuntime && (!/^\d+$/.test(out.customRuntime) || Number(out.customRuntime) < 1 || Number(out.customRuntime) > 600)) throw new Error(`Screening ${i + 1}: use a planning runtime from 1 to 600 minutes.`);
    for (const key of numericFields) {
      if (!['string', 'number'].includes(typeof s[key])) throw new Error(`Screening ${i + 1}: enter ${key}.`);
      out[key] = String(s[key]);
    }
    calculateBudget(out);
    return out;
  });
  return { kind: 'bridgebill-worksheet', version: 1, venue, screenings };
}

function numberField(i, key, label, unit, min, max, step = '0.01') {
  return `<label>${label}<span class="input-unit">${unit ? `<span aria-hidden="true">${unit}</span>` : ''}<input id="s${i}-${key}" data-field="${key}" type="number" min="${min}" max="${max}" step="${step}" required value="${esc(plan.screenings[i][key])}" aria-describedby="s${i}-error"></span></label>`;
}

function render() {
  for (const key of venueFields) $(`venue-${key}`).value = plan.venue[key];
  $('screenings').innerHTML = plan.screenings.map((s, i) => `
    <article class="screening" data-screening="${i}" aria-labelledby="s${i}-heading">
      <div class="night-line"><strong id="s${i}-heading">Screening ${i + 1}</strong><span class="quote-badge" id="s${i}-badge"></span></div>
      <label><span class="visually-hidden">Film for screening ${i + 1}</span><select class="film-choice" id="s${i}-filmId" data-field="filmId">
        ${films.map(f => `<option value="${f.slug}"${f.slug === s.filmId ? ' selected' : ''}>${esc(f.name)}</option>`).join('')}
        <option value="custom"${s.filmId === 'custom' ? ' selected' : ''}>Your own film</option>
      </select></label>
      <p class="film-meta" id="s${i}-film-meta"></p>
      <div id="s${i}-custom" class="custom-film"${s.filmId === 'custom' ? '' : ' hidden'}>
        <label>Film title & year<input id="s${i}-customTitle" data-field="customTitle" maxlength="160" value="${esc(s.customTitle)}" placeholder="Title, original year"></label>
        <label>Minutes<input id="s${i}-customRuntime" data-field="customRuntime" type="number" min="1" max="600" step="1" value="${esc(s.customRuntime)}"></label>
      </div>
      <div class="date-line">
        <label>Proposed date<input id="s${i}-date" data-field="date" type="date" value="${esc(s.date)}"></label>
        <label>Start time<input id="s${i}-time" data-field="time" type="time" value="${esc(s.time)}"></label>
        <label>Seats for sale<input id="s${i}-capacity" data-field="capacity" type="number" min="1" max="10000" step="1" required value="${esc(s.capacity)}" aria-describedby="s${i}-error"></label>
      </div>
      <div class="sales-result">
        <output class="break-even" id="s${i}-break-even">—</output>
        <div class="result-description">tickets to break even<strong id="s${i}-feasibility"></strong></div>
      </div>
      <div class="seat-rule" id="s${i}-seat-rule" role="img"><div class="seat-fill" id="s${i}-seat-fill"></div><div class="seat-target" id="s${i}-seat-target"></div></div>
      <div class="seat-caption"><span id="s${i}-seat-count"></span><span id="s${i}-seat-key"></span></div>
      <div class="attendance-row">
        <label>Your attendance scenario<input id="s${i}-attendance" data-field="attendance" type="number" min="0" max="${esc(s.capacity)}" step="1" required value="${esc(s.attendance)}" aria-describedby="s${i}-error"></label>
        <div class="scenario-result"><strong id="s${i}-surplus">—</strong><span id="s${i}-surplus-label">Scenario surplus / loss</span></div>
      </div>
      <div class="budget-grid">
        ${numberField(i, 'ticketPrice', 'Ticket price (£)', '£', '.01', '10000')}
        ${numberField(i, 'fixedCosts', 'Other fixed costs (£)', '£', '0', '1000000')}
        ${numberField(i, 'minimumFee', 'Minimum licence (£)', '£', '0', '1000000')}
        ${numberField(i, 'sharePercent', 'Box-office share (%)', '%', '0', '99.99')}
      </div>
      <p class="error" id="s${i}-error" role="alert"></p>
      <p class="licence-line" id="s${i}-licence-line"></p>
      <details class="quote-details">
        <summary>Quotation & booking notes</summary>
        <div class="quote-fields">
          <label>Evidence you hold<select id="s${i}-quoteStatus" data-field="quoteStatus">${Object.entries(quoteLabels).map(([key, label]) => `<option value="${key}"${key === s.quoteStatus ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
          <label>Quote or licence reference<input id="s${i}-quoteReference" data-field="quoteReference" maxlength="350" value="${esc(s.quoteReference)}" placeholder="Distributor, reference, reply date and expiry"></label>
          <label>Edition, access needs & remaining questions<textarea id="s${i}-notes" data-field="notes" maxlength="2000" placeholder="Supplied copy, captions, marketing permission, reporting deadline…">${esc(s.notes)}</textarea></label>
          <p class="field-note" id="s${i}-booking-next"></p>
          <p id="s${i}-booking-source"></p>
        </div>
      </details>
    </article>`).join('');
  update(false);
}

function update(persist = true) {
  results = [];
  for (const [i, s] of plan.screenings.entries()) {
    const film = filmFor(s);
    $(`s${i}-custom`).hidden = s.filmId !== 'custom';
    $(`s${i}-film-meta`).innerHTML = film
      ? `${film.year} / ${esc(film.creator)} / ${film.runtime_minutes} min<br><a href="${esc(film.source_url)}" target="_blank" rel="noopener">Edition source</a>`
      : 'Add the title, original year and planning runtime for your film.';
    $(`s${i}-badge`).textContent = quoteLabels[s.quoteStatus];
    $(`s${i}-booking-next`).textContent = s.quoteStatus === 'estimate'
      ? 'Next: request this film’s written quotation for your venue, date and screening format.'
      : !s.quoteReference.trim() ? 'Next: add the distributor’s quote or licence reference.'
      : s.quoteStatus === 'quoted' ? 'Next: confirm screening rights, quote validity and marketing permission with the distributor.'
      : 'Recorded by you: screening rights confirmed. Keep the licence, expiry and reporting deadline with this plan.';
    $(`s${i}-booking-source`).innerHTML = film
      ? `Enquiry route: <a href="${esc(film.booking_enquiry_url)}" target="_blank" rel="noopener">${esc(film.booking_destination)}</a>. ${esc(film.booking_notes)}`
      : 'Use the current public-screening rights holder for your territory. Add their contact and reference above.';
    $(`s${i}-attendance`).max = s.capacity || '10000';
    for (const key of numericFields) $(`s${i}-${key}`).setAttribute('aria-invalid', String(!$(`s${i}-${key}`).validity.valid));
    try {
      const result = calculateBudget(s);
      results.push(result);
      $(`s${i}-error`).textContent = '';
      $(`s${i}-break-even`).textContent = result.breakEvenTickets.toLocaleString('en-GB');
      $(`s${i}-break-even`).classList.toggle('long-number', result.breakEvenTickets > 9999);
      $(`s${i}-feasibility`).textContent = result.feasible
        ? result.neededTickets > 0 ? `${result.neededTickets.toLocaleString('en-GB')} more than your scenario` : `Within ${result.capacity.toLocaleString('en-GB')} seats`
        : `${(result.breakEvenTickets - result.capacity).toLocaleString('en-GB')} above room capacity`;
      $(`s${i}-feasibility`).className = result.feasible ? 'feasible' : 'over-capacity';
      $(`s${i}-seat-rule`).setAttribute('aria-label', `Your scenario: ${result.attendance} tickets. Break-even: ${result.breakEvenTickets}. Capacity: ${result.capacity}.`);
      $(`s${i}-seat-fill`).style.width = `${100 * result.attendance / result.capacity}%`;
      $(`s${i}-seat-target`).hidden = false;
      $(`s${i}-seat-target`).style.left = `${Math.min(100, 100 * result.breakEvenTickets / result.capacity)}%`;
      $(`s${i}-seat-count`).textContent = `Scenario: ${result.attendance} of ${result.capacity} seats`;
      $(`s${i}-seat-key`).textContent = result.feasible ? 'Line = break-even' : 'Break-even exceeds room';
      $(`s${i}-surplus`).textContent = money(Math.abs(result.surplusPence));
      $(`s${i}-surplus`).className = result.surplusPence >= 0 ? 'feasible' : 'over-capacity';
      $(`s${i}-surplus-label`).textContent = result.surplusPence >= 0 ? 'Scenario surplus' : 'Scenario loss';
      $(`s${i}-licence-line`).textContent = `At this attendance: ${money(result.receiptsPence)} receipts, ${money(result.licencePence)} licence.`;
    } catch (error) {
      results.push(null);
      $(`s${i}-error`).textContent = error.message;
      for (const key of ['break-even', 'surplus']) $(`s${i}-${key}`).textContent = '—';
      for (const key of ['feasibility', 'seat-count', 'seat-key', 'licence-line']) $(`s${i}-${key}`).textContent = '';
      $(`s${i}-surplus-label`).textContent = 'Complete the budget above';
      $(`s${i}-seat-fill`).style.width = '0%';
      $(`s${i}-seat-target`).hidden = true;
      $(`s${i}-seat-rule`).setAttribute('aria-label', 'Complete the budget fields to calculate ticket requirements.');
    }
  }
  let detailError = '';
  try { validatedPlan(plan); } catch (error) { detailError = error.message; }
  const valid = results.every(Boolean) && !detailError;
  $('download-pack').disabled = !valid;
  $('save-plan').disabled = !valid;
  if (valid) {
    const total = results.reduce((sum, r) => sum + r.surplusPence, 0);
    const quoteCount = plan.screenings.filter(s => s.quoteStatus === 'estimate' || !s.quoteReference.trim()).length;
    const capacityIssues = results.filter(r => !r.feasible).length;
    $('total-value').textContent = money(Math.abs(total));
    $('total-value').className = total >= 0 ? 'feasible' : 'over-capacity';
    $('total-label').textContent = total >= 0 ? 'Combined scenario surplus' : 'Combined scenario loss';
    $('total-detail').textContent = [
      capacityIssues ? `${capacityIssues} ${capacityIssues === 1 ? 'screening needs' : 'screenings need'} revised costs, price or room capacity.` : 'Both break-even targets fit the room.',
      quoteCount ? `${quoteCount} ${quoteCount === 1 ? 'screening needs' : 'screenings need'} a written quote or reference.` : 'Quote references are included. Review the recorded licensing status for each night.',
    ].join(' ');
    if (persist) {
      try { localStorage.setItem(STORAGE, JSON.stringify(plan)); message('Saved in this browser. Save a plan file for a portable copy.'); }
      catch { message('Browser storage is unavailable. Use Save plan to keep your work.'); }
    }
  } else {
    $('total-value').textContent = '—';
    $('total-label').textContent = 'Complete both budgets';
    $('total-detail').textContent = detailError || 'Correct the highlighted screening fields, then export the updated plan.';
    if (persist) message(`${detailError || 'Complete both budgets.'} Your last valid saved plan is retained.`);
  }
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function enquiryText(s, i) {
  const film = filmFor(s), v = plan.venue, r = results[i];
  return `Subject: Screening enquiry — ${titleFor(s)} — ${v.name || '[Venue]'}, ${s.date || '[Date]'}

Hello ${film?.booking_destination || '[Bookings team]'},

${film?.booking_route_status === 'rights_referral_enquiry' ? 'Could you identify the current UK public-screening rights holder and direct this enquiry to them?' : 'Could you confirm availability and provide a written quotation for this public screening?'}

Film: ${titleFor(s)}${film ? ` (${film.year}), ${film.creator}` : ''}
Planning runtime: ${film?.runtime_minutes || s.customRuntime || '[Confirm supplied runtime]'}${film?.runtime_minutes || s.customRuntime ? ' minutes' : ''}
Venue: ${v.name || '[Venue name]'}
UK address: ${v.address || '[Add screening address]'}
Contact: ${v.contact || '[Add name, role, email and phone]'}
Date and start time: ${dateFor(s)}
Performances: one independently ticketed public screening
Seats available for sale: ${r.capacity}
Single ticket price: ${money(r.ticketPricePence)}
Accounting basis: ${v.basis || '[Confirm VAT and box-office receipt basis]'}
Supported formats: ${v.format || '[Add supported formats]'}
Event / partner: ${v.partner || '[Add event context]'}
Quote status recorded by venue: ${quoteLabels[s.quoteStatus]}
Existing reference: ${s.quoteReference || '[Request written quotation]'}
Edition, access needs and remaining questions: ${s.notes || '[Add captions, access version or other requirements]'}

Please confirm the UK public-screening rights for this venue, date and format; the supplied edition and runtime; minimum guarantee, box-office share and receipt basis; VAT, delivery/copy/KDM and compulsory charges; quote expiry; cancellation, payment and box-office reporting terms; and permission to advertise with supplied marketing assets.

The worksheet currently uses ${money(r.minimumFeePence)} or ${s.sharePercent}% of receipts, whichever is greater. ${s.quoteStatus === 'estimate' ? 'These are planning estimates for you to replace with the film’s actual terms.' : `Please confirm the terms against reference ${s.quoteReference || '[Add reference]'}.`}

Please send invoice requirements to the contact above.

Thank you,
${v.contact || '[Name / role]'}
${v.name || '[Venue]'}`;
}

function bookingPack() {
  const created = new Date().toISOString();
  const v = plan.venue;
  const total = results.reduce((sum, r) => sum + r.surplusPence, 0);
  const cards = plan.screenings.map((s, i) => {
    const r = results[i], film = filmFor(s);
    return `<section><h2>Screening ${i + 1}: ${esc(titleFor(s))}</h2><p>${esc(dateFor(s))} / ${esc(quoteLabels[s.quoteStatus])}</p>
      <table><tbody>${[
        ['Seats for sale / attendance scenario', `${r.capacity} / ${r.attendance}`],
        ['Break-even tickets', `${r.breakEvenTickets}${r.feasible ? ' — within capacity' : ' — exceeds room capacity'}`],
        ['Ticket price', money(r.ticketPricePence)], ['Other fixed costs', money(r.fixedCostsPence)],
        ['Licence calculation', `Greater of ${money(r.minimumFeePence)} or ${s.sharePercent}% of receipts`],
        ['Scenario receipts / licence', `${money(r.receiptsPence)} / ${money(r.licencePence)}`],
        ['Scenario surplus / loss', money(r.surplusPence)], ['Sold-out surplus / loss', money(r.capacitySurplusPence)],
        ['Quote or licence reference', s.quoteReference || 'Request a written quotation'],
        ['Remaining questions', s.notes || 'Confirm supplied edition, access version and terms'],
      ].map(([label, value]) => `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`).join('')}</tbody></table>
      ${film ? `<p class="small">Planning edition: ${esc(film.runtime_edition)} <a href="${esc(film.source_url)}">Film source</a>. <a href="${esc(film.booking_enquiry_url)}">${esc(film.booking_destination)}</a> — ${esc(film.booking_notes)}</p>` : ''}
      <h3>Draft enquiry to review and send</h3><pre>${esc(enquiryText(s, i))}</pre></section>`;
  }).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(v.name || 'Venue')} — Bridgebill enquiry pack</title>
    <style>body{font:15px/1.55 system-ui,sans-serif;color:#302640;max-width:880px;margin:35px auto;padding:0 24px}h1{font-size:29px;line-height:1.2}h2{font-size:22px;margin:30px 0 7px}h3{font-size:16px;margin-top:25px}p{max-width:80ch}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #ddd;padding:8px 10px}th{width:42%;font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.65 system-ui,sans-serif;background:#f5f2f8;padding:20px}.small,footer{font-size:12px;color:#5d5367}a{color:inherit}section{border-top:2px solid #795fa5;margin-top:28px}footer{margin-top:30px;border-top:1px solid #ddd;padding-top:15px}@media print{body{margin:0;max-width:none;font-size:11px}pre,table{font-size:10px}h2,h3{break-after:avoid}tr{break-inside:avoid}section+section{break-before:page}a{text-decoration:none}}</style>
    <header><p>Bridgebill / two independent screenings</p><h1>${esc(v.name || '[Add venue]')}<br>Draft booking enquiries</h1><p>${esc(v.partner || 'Two-screening programme')}</p><p>Created ${esc(created)}. Accounting basis: ${esc(v.basis || '[Confirm basis]')}.</p><p><strong>Combined attendance-scenario surplus / loss: ${money(total)}.</strong> Each screening uses its own ticket sales, minimum licence fee and fixed costs. Review each night’s break-even and licensing status below.</p></header>
    ${cards}<footer><p>Attendance is supplied by the venue. The licence model is minimum-or-percentage, rounded half-up to the nearest penny. Match the distributor’s actual receipt, tax and rounding terms. Booking follows written distributor approval for the venue, date, format and terms. The starting venue and fees are fictional/illustrative inputs.</p><p>Generated locally with <a href="https://blucca.github.io/research/bridgebill/planner/">Bridgebill</a> by Blucca. Save the separate JSON plan to reopen and revise the same figures.</p></footer></html>`;
}

async function start() {
  const response = await fetch('../coverage-input.json');
  if (!response.ok) throw new Error('Film shelf loading failed. Reload the page, or use the spreadsheet version linked below.');
  films = (await response.json()).films;
  let savedMessage = 'Example loaded. Edit a figure to begin your working plan.';
  plan = examplePlan();
  try {
    const saved = localStorage.getItem(STORAGE);
    if (saved) { plan = validatedPlan(JSON.parse(saved)); savedMessage = 'Your saved plan is open. All inputs remain in this browser.'; }
  } catch { savedMessage = 'The saved plan needs review. The example is open; use a saved JSON file to restore your work.'; }
  render(); message(savedMessage);

  function resetQuote(i, clearReference = false) {
    plan.screenings[i].quoteStatus = 'estimate';
    $(`s${i}-quoteStatus`).value = 'estimate';
    if (clearReference) { plan.screenings[i].quoteReference = ''; $(`s${i}-quoteReference`).value = ''; }
  }
  $('screenings').addEventListener('input', event => {
    const field = event.target.dataset.field;
    if (!field) return;
    const i = Number(event.target.closest('[data-screening]').dataset.screening);
    plan.screenings[i][field] = event.target.value;
    if (['filmId', 'customTitle', 'customRuntime', 'date', 'time', 'capacity', 'ticketPrice'].includes(field)) resetQuote(i, ['filmId', 'customTitle'].includes(field));
    update();
    if (field === 'filmId') message('Film changed. The fee figures are planning estimates; request this film’s quotation and review the notes.');
  });
  for (const key of venueFields) $(`venue-${key}`).addEventListener('input', event => {
    plan.venue[key] = event.target.value;
    if (['name', 'address', 'format', 'basis'].includes(key)) for (let i = 0; i < 2; i++) resetQuote(i);
    update();
  });
  $('save-plan').addEventListener('click', () => {
    try { const checked = validatedPlan(plan); download('bridgebill-plan.json', JSON.stringify(checked, null, 2) + '\n', 'application/json'); message('Plan downloaded. Open this JSON file here to continue later.'); }
    catch (error) { message(error.message); }
  });
  $('download-pack').addEventListener('click', () => {
    try { validatedPlan(plan); download('bridgebill-enquiry-pack.html', bookingPack(), 'text/html;charset=utf-8'); message('Enquiry pack downloaded. Open the HTML file to review, copy or print the two enquiries.'); }
    catch (error) { message(error.message); }
  });
  $('open-plan').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > 150000) throw new Error('Open a Bridgebill plan smaller than 150 KB.');
      const next = validatedPlan(JSON.parse(await file.text()));
      if (!confirm('Replace the current worksheet with this saved plan? Save your current plan first to keep a separate copy.')) return;
      plan = next; render(); update(); message(`Opened ${file.name}. Both screening budgets have been recalculated.`);
    } catch (error) { message(`Plan opening failed: ${error.message} Your current worksheet is retained.`); }
    finally { event.target.value = ''; }
  });
  $('reset-plan').addEventListener('click', () => {
    if (!confirm('Replace this worksheet with the fictional example? Save your current plan first to keep a copy.')) return;
    plan = examplePlan(); render(); update(); message('Fictional example loaded. Edit each film’s actual quotation before a booking.');
  });
  $('clear-plan').addEventListener('click', () => {
    if (!confirm('Clear the saved browser plan and reset this worksheet? Save a JSON copy first if you want to keep it.')) return;
    try { localStorage.removeItem(STORAGE); plan = examplePlan(); render(); message('Saved browser plan cleared. The example is open; new edits start a new saved plan.'); }
    catch { message('Browser storage is unavailable. Clear this site’s saved data through your browser settings.'); }
  });
}

start().catch(error => {
  $('screenings').innerHTML = `<p class="loading" role="alert">${esc(error.message)} <a href="../screening-budget.csv">Download the spreadsheet</a>.</p>`;
  $('save-plan').disabled = true;
  $('open-plan').disabled = true;
  $('reset-plan').disabled = true;
  $('clear-plan').disabled = true;
});
