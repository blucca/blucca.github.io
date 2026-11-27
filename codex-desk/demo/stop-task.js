/* One captured native Stop request; acknowledgements never retire interactions. */
const DeskStopTask = (() => {
  const storageKey = 'codex-desk-stop-requests';
  const receipts = new Map(), probes = new Map(), previousNodes = new Map();
  const statuses = new Set(['pending', 'accepted', 'rejected', 'needs_review']);
  const terminalStatuses = new Set(['completed', 'interrupted', 'failed']);
  let context = null, turn = null, latest = null, retired = new Set(), revision = 0, view = null, options = null;
  function uuid(value) { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value); }
  function record(session, token) { return {session, token, body:null, status:null, version:0}; }
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) || '[]');
    if (Array.isArray(saved)) for (const row of saved) {
      if (typeof row?.session === 'string' && uuid(row.token)) receipts.set(row.token, record(row.session, row.token));
    }
  } catch {}
  function ownRequests(session = context?.session) { return [...receipts.values()].filter(req => req.session === session); }
  function request(session = context?.session) { return ownRequests(session).at(-1); }
  function save(next) {
    const rows = [...receipts.values()].filter(req => req.token !== next?.token).map(({session, token}) => ({session, token}));
    if (next) rows.push({session:next.session, token:next.token});
    sessionStorage.setItem(storageKey, JSON.stringify(rows));
  }
  function same(value) { return !!context && value?.session === context.session && value?.thread === context.thread && value?.generation === context.generation; }
  function active() {
    const owner = options?.selection();
    return same(owner) && owner.connected !== false && !owner.opening && !!context.session && !!context.thread && !!turn && ['running', 'approval', 'starting'].includes(owner.status);
  }
  function target(req) { return !!req?.body && req.body.threadId === context?.thread && req.body.expectedTurnId === turn && !req.result?.request?.binding_mismatch; }
  function terminal(req) { return req?.nativeTerminal || req?.result?.request?.terminal_status || null; }
  function captured(req) { return req?.body ? req.body.threadId + ' / ' + req.body.expectedTurnId : 'Identity ' + req?.token; }
  function text(node, value) { if (node.textContent !== value) node.textContent = value; }
  function message(req) {
    const outcome = terminal(req);
    if (outcome) return 'Captured native task ' + outcome + (req.status === 'accepted' ? '.' : '; Stop acknowledgement ' + (req.status === 'rejected' ? 'was rejected.' : 'is unconfirmed.'));
    if (req.writing) return 'Requesting Stop for the captured native task…';
    if (req.status === 'accepted') return 'Stop requested. Waiting for the captured native task’s terminal outcome.';
    if (req.status === 'rejected') return 'Stop was rejected. Check the retained receipt and native activity.';
    return 'Stop response unconfirmed. Check the retained receipt; this request will not be resent.';
  }
  function render() {
    if (!view) return;
    const req = request(), eligible = active(), probe = probes.get(context?.session);
    const matching = ownRequests().find(item => target(item) && (item.status !== 'rejected' || item.writing || item.reading));
    const unknown = ownRequests().some(item => !item.body);
    view.section.hidden = !context?.session || !(eligible || req || probe?.error);
    view.stop.disabled = !eligible || !!matching || unknown || !!probe?.busy || !!probe?.error;
    text(view.stop, matching?.status === 'accepted' && !terminal(matching) ? 'Stop requested' : 'Stop current task');
    view.stop.title = eligible ? 'Stop only native task ' + context.thread + ' / ' + turn : 'Wait for an established, connected native task.';
    text(view.currentTarget, eligible ? 'Current native task · ' + context.thread + ' / ' + turn : 'No connected active native task is available to stop.');
    text(view.status, req ? message(req) : probe?.busy ? 'Checking for a retained Stop request…' : 'Stop captures this native task once. Its terminal outcome remains native-reported.');
    view.check.hidden = !req && !probe?.error;
    view.check.disabled = !!req?.reading || !!req?.writing || !!probe?.busy;
    view.captured.hidden = !req;
    text(view.target, req ? 'Captured native task · ' + captured(req) : '');
    const failure = req?.error?.message || req?.result?.request?.error || probe?.error?.message || '';
    view.error.hidden = !failure;
    text(view.error, failure);
    const binding = req?.result?.request;
    view.binding.hidden = !binding?.binding;
    if (binding?.binding) {
      text(view.originalBinding, JSON.stringify(binding.binding, null, 2));
      text(view.currentBinding, JSON.stringify(binding.current_binding || {}, null, 2));
      text(view.bindingStatus, binding.binding_mismatch ? 'The saved native binding has changed. This receipt still belongs to the original target.' : binding.target_current === false ? 'This captured task is no longer the current active task.' : 'The retained native binding matches.');
    }
    const older = ownRequests().filter(item => item !== req);
    view.previous.hidden = !older.length;
    for (const old of older) {
      let nodes = previousNodes.get(old.token);
      if (!nodes) {
        const card = options.make('section', '', 'stop-previous-item');
        const label = options.make('p'), status = options.make('p', '', 'muted'), check = options.make('button', 'Check earlier stop receipt');
        check.type = 'button'; check.onclick = () => read(old);
        card.append(label, status, check); view.previousList.append(card);
        previousNodes.set(old.token, nodes = {card, label, status, check});
      }
      text(nodes.label, 'Captured native task · ' + captured(old));
      text(nodes.status, message(old) + (old.error ? ' ' + old.error.message : ''));
      nodes.check.disabled = !!old.reading || !!old.writing;
    }
  }
  function configure(value) {
    options = value; const $ = value.$;
    view = {section:$('stop-request'), stop:$('stop'), currentTarget:$('stop-current-target'), status:$('stop-request-status'),
      check:$('stop-request-check'), error:$('stop-request-error'), captured:$('stop-request-captured'), target:$('stop-request-target'),
      binding:$('stop-request-binding'), originalBinding:$('stop-request-original-binding'), currentBinding:$('stop-request-current-binding'), bindingStatus:$('stop-request-binding-status'),
      previous:$('stop-request-previous'), previousList:$('stop-request-previous-list')};
    view.stop.onclick = send;
    view.check.onclick = () => request() ? read(request()) : opened();
  }
  function select(value) {
    if (same(value)) return;
    context = {...value}; turn = null; latest = null; retired = new Set(); ++revision;
    if (view) { view.captured.open = false; view.previous.open = false; view.previousList.replaceChildren(); previousNodes.clear(); }
    render();
  }
  function start(id) {
    if (typeof id !== 'string' || !id || retired.has(id) || id === turn) return;
    if (latest && latest !== id) retired.add(latest);
    turn = id; latest = id; ++revision; render();
  }
  function finish(id) {
    if (!id || id !== turn) return;
    retired.add(id); turn = null; ++revision; render();
  }
  function consume(event, owner) {
    if (!same(owner) || !context.thread || !event || event.id !== undefined) return;
    const params = event.params || {}, thread = params.threadId || params.thread?.id || params.turn?.threadId;
    if (thread && thread !== context.thread) return;
    const id = params.turnId || params.turn?.id;
    if (event.method === 'turn/started') start(id);
    else if (event.method === 'turn/completed') {
      const status = params.turn?.status;
      if (terminalStatuses.has(status)) for (const req of ownRequests()) {
        if (req.body?.threadId === context.thread && req.body.expectedTurnId === id) req.nativeTerminal = status;
      }
      finish(id); render();
    }
  }
  function snapshot() { return context && {...context, revision}; }
  function sync(session, owner) {
    if (!same(owner) || session?.id !== context.session) return;
    const captured = owner.snapshot;
    if (!options.selection().opening && (!captured || (same(captured) && captured.revision === revision)) && !['running', 'approval', 'starting'].includes(session.status)) finish(turn);
    render();
  }
  function restoreThread(thread, owner) {
    if (!same(owner) || thread?.id !== context.thread) return;
    const turns = Array.isArray(thread.turns) ? thread.turns : [], last = turns.at(-1);
    if (!last?.id || retired.has(last.id) || (latest && !turns.some(item => item.id === latest))) return;
    if (last.status === 'inProgress') start(last.id);
    else if (terminalStatuses.has(last.status)) {
      start(last.id);
      for (const req of ownRequests()) if (req.body?.threadId === context.thread && req.body.expectedTurnId === last.id) req.nativeTerminal = last.status;
      finish(last.id); render();
    }
  }
  function apply(req, result) {
    if (receipts.get(req.token) !== req) return;
    if (result?.session !== req.session || result?.token !== req.token || !statuses.has(result.request?.status)) throw Error('The Stop receipt did not match its captured request.');
    const receipt = result.request, body = receipt.payload;
    if (!body || body.session !== req.session || body.token !== req.token || typeof body.threadId !== 'string' || !body.threadId || typeof body.expectedTurnId !== 'string' || !body.expectedTurnId) throw Error('The captured Stop target could not be read.');
    if (req.body && ['session', 'token', 'threadId', 'expectedTurnId'].some(key => req.body[key] !== body[key])) throw Error('This Stop identity belongs to a different captured target.');
    if (receipt.terminal_status != null && !terminalStatuses.has(receipt.terminal_status)) throw Error('The native terminal outcome could not be read.');
    req.body = Object.freeze({...body}); req.status = receipt.status; req.result = result; req.error = null; ++req.version;
    if (terminal(req) && target(req)) finish(req.body.expectedTurnId);
  }
  async function read(req) {
    if (!req || receipts.get(req.token) !== req || req.reading || req.writing) return;
    const version = req.version; req.reading = true; render();
    try {
      const result = await options.api('/api/stop?session=' + encodeURIComponent(req.session) + '&token=' + encodeURIComponent(req.token));
      if (version === req.version) apply(req, result);
    } catch (error) { if (version === req.version) req.error = error; }
    finally { req.reading = false; render(); }
  }
  async function opened() {
    const owner = {...context}, existing = request();
    if (existing) {
      await read(existing);
      for (const req of ownRequests(owner.session)) if (req !== existing && !req.body) await read(req);
      return true;
    }
    const previous = probes.get(owner.session);
    if (previous?.busy && same(previous.owner)) return previous.promise;
    const probe = {busy:true, error:null, owner}; probes.set(owner.session, probe); render();
    probe.promise = (async () => {
      try {
        const result = await options.api('/api/stop?session=' + encodeURIComponent(owner.session));
        if (!result) return false;
        if (request(owner.session)) return true;
        if (result.session !== owner.session || !uuid(result.token)) throw Error('The retained Stop identity could not be read.');
        const req = record(owner.session, result.token); save(req); receipts.set(req.token, req); apply(req, result); return true;
      } catch (error) {
        if (error.status !== 404) { probe.error = error; return true; }
        return false;
      } finally { probe.busy = false; if (same(owner)) render(); }
    })();
    return probe.promise;
  }
  async function send() {
    if (!active() || ownRequests().some(req => !req.body || (target(req) && (req.status !== 'rejected' || req.writing || req.reading))) || probes.get(context.session)?.busy || probes.get(context.session)?.error) return;
    const owner = {...context}, token = crypto.randomUUID();
    const body = Object.freeze({session:owner.session, token, threadId:owner.thread, expectedTurnId:turn});
    const req = {...record(owner.session, token), body, status:'pending', writing:true};
    try { save(req); } catch (error) { probes.set(owner.session, {error}); render(); return; }
    receipts.set(token, req); view.captured.open = true; render();
    try { apply(req, await options.api('/api/stop', body)); }
    catch (error) {
      req.error = error;
      if (error.status === 409 && error.current?.session === req.session && uuid(error.current.token)) {
        try {
          const token = error.current.token, retained = receipts.get(token) || record(req.session, token);
          save(retained); receipts.set(token, retained); apply(retained, error.current);
          // The rejected attempted identity is not the retained original request.
          if (token !== req.token) receipts.delete(req.token);
          save();
        } catch (failure) { req.error = failure; }
      }
    } finally { req.writing = false; render(); }
  }
  function reading() { return !!view && !view.section.hidden && ((!view.captured.hidden && view.captured.open) || (!view.previous.hidden && view.previous.open)); }
  function state() { return {context:context && {...context}, turn, active:active(), revision, request:request() && {...request()}, requests:ownRequests().map(req => ({...req}))}; }
  return {configure, select, consume, sync, restoreThread, snapshot, opened, read, send, reading, state};
})();
