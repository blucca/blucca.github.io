/* A local, DOM-only activity reader. Message text never becomes HTML. */
(function(root) {
  const readers = new WeakMap();
  const collaborationTypes = new Set(['collabAgentToolCall', 'subAgentActivity']);
  const toolTypes = new Set(['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', ...collaborationTypes]);
  function element(tag, text, cls) {
    const node = document.createElement(tag);
    if(text !== undefined)node.textContent = text;
    if(cls)node.className = cls;
    return node;
  }
  function linkAt(text, offset) {
    const match = text.slice(offset).match(/^\[([^\]\n]*)\]\(/);
    if(!match)return null;
    let end = offset + match[0].length, depth = 1;
    const start = end;
    for(; end < text.length && text[end] !== '\n'; end++) {
      if(text[end] === '\\') {end++;continue;}
      if(text[end] === '(')depth++;
      if(text[end] === ')' && --depth === 0)break;
    }
    if(depth !== 0)return null;
    return {label:match[1], href:text.slice(start, end).trim(), end:end + 1};
  }
  function safeLink(value) {
    if(!/^https?:\/\/[^\s]+$/i.test(value))return null;
    try {const url = new URL(value);return url.hostname && ['http:', 'https:'].includes(url.protocol) ? url.href : null;} catch {return null;}
  }
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  function tagAt(text, at) {
    const match = text.slice(at).match(/^<\/?([a-z][\w:-]*)(?=[\s/>])/i);
    if(!match)return null;
    let end = at + match[0].length, quote = null;
    for(; end < text.length; end++) {
      const char = text[end];
      if(quote) {if(char === quote)quote = null;}
      else if(char === '"' || char === "'")quote = char;
      else if(char === '>')break;
    }
    return {name:match[1].toLowerCase(), closing:text[at + 1] === '/',
      selfClosing:text[end - 1] === '/', end:Math.min(end + 1, text.length)};
  }
  function htmlAt(text, at) {
    if(text.startsWith('<!--', at)) {
      const end = text.indexOf('-->', at + 4);return {end:end < 0 ? text.length : end + 3};
    }
    if(/^<![a-z]/i.test(text.slice(at))) {
      const end = text.indexOf('>', at + 2);return {end:end < 0 ? text.length : end + 1};
    }
    const tag = tagAt(text, at);
    if(!tag)return null;
    if(tag.closing || tag.selfClosing || voidTags.has(tag.name))return tag;
    // Protect the whole raw element, not just its attributes. Markdown markers
    // inside HTML (including script/style bodies) remain literal text.
    let cursor = tag.end, nesting = 1;
    while(cursor < text.length) {
      const next = text.indexOf('<', cursor);
      if(next < 0)break;
      const candidate = tagAt(text, next);
      if(candidate && candidate.name === tag.name) {
        if(candidate.closing)nesting--;
        else if(!candidate.selfClosing)nesting++;
        if(nesting === 0)return {end:candidate.end};
      }
      cursor = candidate ? candidate.end : next + 1;
    }
    return {end:text.length};
  }
  function inline(parent, text, depth = 0) {
    if(depth > 12) {parent.append(document.createTextNode(text));return;}
    let plain = '', at = 0;
    const flush = () => {if(plain)parent.append(document.createTextNode(plain));plain = '';};
    while(at < text.length) {
      const char = text[at];
      if(char === '<') {
        const raw = htmlAt(text, at);
        if(raw) {plain += text.slice(at, raw.end);at = raw.end;continue;}
      }
      if(char === '\\' && /[\\`*_{}\[\]()#+.!>-]/.test(text[at + 1] || '')) {
        plain += text[at + 1];at += 2;continue;
      }
      if(char === '`') {
        const marker = text.slice(at).match(/^`+/)[0], end = text.indexOf(marker, at + marker.length);
        if(end >= 0) {
          flush();let value = text.slice(at + marker.length, end).replace(/\n/g, ' ');
          if(/^ .* $/.test(value) && value.trim())value = value.slice(1, -1);
          parent.append(element('code', value));at = end + marker.length;continue;
        }
      }
      if(char === '!' && text[at + 1] === '[') {
        const media = linkAt(text, at + 1);
        if(media) {plain += text.slice(at, media.end);at = media.end;continue;}
      }
      if(char === '[') {
        const link = linkAt(text, at);
        if(link) {
          const href = safeLink(link.href);
          if(href) {
            flush();const anchor = element('a');anchor.href = href;
            anchor.target = '_blank';anchor.rel = 'noopener noreferrer';
            inline(anchor, link.label, depth + 1);parent.append(anchor);
          } else plain += text.slice(at, link.end);
          at = link.end;continue;
        }
      }
      if(char === '*' || char === '_') {
        const marker = text.startsWith(char + char, at) ? char + char : char;
        const end = text.indexOf(marker, at + marker.length);
        const value = end < 0 ? '' : text.slice(at + marker.length, end);
        if(value && value.trim() === value && !(char === '_' && /\w/.test(text[at - 1] || ''))) {
          flush();const emphasis = element(marker.length === 2 ? 'strong' : 'em');
          inline(emphasis, value, depth + 1);parent.append(emphasis);at = end + marker.length;continue;
        }
      }
      plain += char;at++;
    }
    flush();
  }
  function codeBlock(parent, source, language) {
    const box = element('div', undefined, 'activity-code');
    const bar = element('div', undefined, 'activity-code-bar');
    const label = element('span', language || 'Code', 'activity-code-language');
    const button = element('button', 'Copy', 'activity-copy');button.type = 'button';
    button.setAttribute('aria-label', 'Copy ' + (language ? language + ' ' : '') + 'code');
    const feedback = element('span', '', 'activity-copy-feedback');feedback.setAttribute('role', 'status');
    button.onclick = async () => {
      button.disabled = true;feedback.textContent = 'Copying…';
      try {
        await navigator.clipboard.writeText(source);
        if(box.isConnected)feedback.textContent = 'Copied';
      } catch {
        if(box.isConnected)feedback.textContent = 'Copy failed — select the code to copy.';
      } finally {button.disabled = false;}
    };
    bar.append(label, feedback, button);
    const pre = element('pre');pre.append(element('code', source));
    box.append(bar, pre);parent.append(box);
  }
  const fenceAt = line => line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  const listAt = line => line.match(/^( *)([-+*]|\d+[.)])\s+(.*)$/);
  const headingAt = line => line.match(/^ {0,3}(#{1,6})\s+(.*)$/);
  function blocks(parent, lines, depth = 0) {
    if(depth > 16) {parent.append(element('p', lines.join('\n')));return;}
    let at = 0;
    while(at < lines.length) {
      if(!lines[at].trim()) {at++;continue;}
      const fence = fenceAt(lines[at]);
      if(fence) {
        const source = [], marker = fence[1], language = fence[2].trim().split(/\s+/)[0];at++;
        while(at < lines.length) {
          const close = lines[at].trim();
          if(close.length >= marker.length && [...close].every(c => c === marker[0])) {at++;break;}
          source.push(lines[at++]);
        }
        codeBlock(parent, source.join('\n'), language);continue;
      }
      const htmlStart = lines[at].match(/^ {0,3}(?=<)/);
      if(htmlStart) {
        const remaining = lines.slice(at).join('\n'), raw = htmlAt(remaining, htmlStart[0].length);
        if(raw) {
          const count = remaining.slice(0, raw.end).split('\n').length;
          parent.append(element('p', lines.slice(at, at + count).join('\n'), 'activity-literal'));
          at += count;continue;
        }
      }
      const heading = headingAt(lines[at]);
      if(heading) {
        const node = element('h' + heading[1].length);
        inline(node, heading[2].replace(/\s+#+\s*$/, ''));parent.append(node);at++;continue;
      }
      const first = listAt(lines[at]);
      if(first) {
        const indent = first[1].length, ordered = /^\d/.test(first[2]), list = element(ordered ? 'ol' : 'ul');
        if(ordered)list.start = parseInt(first[2], 10);
        while(at < lines.length) {
          const entry = listAt(lines[at]);
          if(!entry || entry[1].length !== indent || /^\d/.test(entry[2]) !== ordered)break;
          const body = [entry[3]], width = entry[0].length - entry[3].length;at++;
          while(at < lines.length) {
            const next = listAt(lines[at]);
            if(next && next[1].length <= indent)break;
            const spaces = lines[at].match(/^ */)[0].length;
            if(lines[at].trim() && spaces <= indent)break;
            if(!lines[at].trim() && (!lines[at + 1] || lines[at + 1].match(/^ */)[0].length <= indent))break;
            body.push(lines[at].slice(Math.min(width, spaces)));at++;
          }
          const item = element('li');blocks(item, body, depth + 1);list.append(item);
        }
        parent.append(list);continue;
      }
      const paragraph = [lines[at++]];
      while(at < lines.length && lines[at].trim() && !fenceAt(lines[at]) && !headingAt(lines[at]) && !listAt(lines[at]) && !/^ {0,3}<(?:[a-z/!])/i.test(lines[at]))paragraph.push(lines[at++]);
      const node = element('p');inline(node, paragraph.join('\n'));parent.append(node);
    }
  }
  function status(item) {
    const value = item.status || (item.exitCode == null ? 'unknown' : item.exitCode === 0 ? 'completed' : 'failed');
    return {inProgress:'In progress', completed:'Completed', failed:'Failed', declined:'Declined', interrupted:'Interrupted'}[value] || value;
  }
  const brief = text => String(text || '').replace(/\s+/g, ' ').trim();
  const shorten = text => text.length > 180 ? text.slice(0, 177) + '…' : text;
  const nativeLabel = value => typeof value === 'string' ? shorten(brief(value)) : '';
  const labelFrom = (labels, value, fallback) => typeof value === 'string' && Object.hasOwn(labels, value) ? labels[value] : fallback;
  function collaborationSummary(item) {
    if(item.type === 'subAgentActivity') {
      // Lifecycle events are facts, not the current state of a child thread.
      const label = labelFrom({started:'Started', interacted:'Interacted with', interrupted:'Interrupted', completed:'Completed'}, item.kind, 'Subagent activity');
      return label + ' · ' + (nativeLabel(item.agentPath) || nativeLabel(item.agentThreadId) || 'Agent');
    }
    const label = labelFrom({spawnAgent:'Spawn agent', sendInput:'Send input', resumeAgent:'Resume agent', wait:'Wait for agents', closeAgent:'Close agent', sendMessage:'Send message', followupTask:'Follow-up task', interruptAgent:'Interrupt agent', listAgents:'List agents'}, item.tool, 'Agent tool');
    const current = labelFrom({inProgress:'In progress', completed:'Completed', failed:'Failed', interrupted:'Interrupted'}, item.status, 'Status unknown');
    const targets = Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds.filter(id => typeof id === 'string' && id.trim()) : [];
    const target = targets.length > 1 ? targets.length + ' agents' : nativeLabel(targets[0]);
    const states = item.agentsStates && typeof item.agentsStates === 'object' && !Array.isArray(item.agentsStates) ? Object.entries(item.agentsStates).filter(([key]) => key !== '_meta').map(([,state]) => state) : [];
    const errors = states.filter(state => state?.status === 'errored' || state?.status === 'notFound').length;
    return label + (target ? ' · ' + target : '') + ' · ' + current + (errors ? ' · ' + errors + (errors === 1 ? ' agent error' : ' agent errors') : '');
  }
  function summary(item) {
    if(collaborationTypes.has(item.type))return collaborationSummary(item);
    const current = status(item);
    if(item.type === 'commandExecution')return '$ ' + shorten(brief(item.command) || 'Command') + ' · ' + current + (item.exitCode == null ? '' : ' · exit ' + item.exitCode);
    if(item.type === 'fileChange') {
      const changes = item.changes || [], paths = changes.slice(0, 2).map(c => brief(c.path)).filter(Boolean).join(', ');
      return `Files · ${changes.length} ${changes.length === 1 ? 'change' : 'changes'}${paths ? ' · ' + shorten(paths) : ''}${changes.length > 2 ? ' +' + (changes.length - 2) + ' more' : ''} · ${current}`;
    }
    return (item.type === 'mcpToolCall' ? 'MCP · ' + (brief(item.server) || 'server') : 'Tool' + (item.namespace ? ' · ' + brief(item.namespace) : '')) + ' / ' + (brief(item.tool) || 'tool') + ' · ' + current + (item.success === false ? ' · unsuccessful' : '');
  }
  function render(node, item, value) {
    const collaboration = collaborationTypes.has(item.type);
    const text = String(collaboration ? root.DeskEvidence.collaboration(item) : value ?? '');
    const mode = collaboration ? 'collaboration' : toolTypes.has(item.type) ? 'tool' : item.type === 'agentMessage' ? 'markdown' : 'plain';
    let reader = readers.get(node);
    node.dataset.itemId = item.id;node.classList.add('activity-reader');node.hidden = !toolTypes.has(item.type) && !text.trim();
    if(!reader || reader.mode !== mode) {
      reader = {mode, text:null, preference:null};readers.set(node, reader);node.replaceChildren();
      if(mode === 'tool') {
        reader.details = element('details', undefined, 'activity-tool');
        reader.summary = element('summary');reader.body = element('pre', undefined, 'activity-evidence');
        reader.details.append(reader.summary, reader.body);node.append(reader.details);
        reader.summary.addEventListener('click', () => {reader.preference = !reader.details.open;});
        reader.details.addEventListener('toggle', () => {
          if(reader.details.open !== reader.expectedOpen)reader.preference = reader.details.open;
        });
      } else if(mode === 'collaboration') {
        // The turn-level disclosure is the only control for child activity.
        // Opening it reveals public prompts/results without a second click.
        reader.summary = element('div', undefined, 'activity-collaboration-label');
        reader.body = element('pre', undefined, 'activity-evidence');
        node.append(reader.summary, reader.body);
      } else {
        reader.body = element('div', undefined, 'activity-' + mode);node.append(reader.body);
      }
    }
    if(mode === 'tool') {
      // Retain deliberate expansion/collapse even when the stream completes.
      if(reader.expectedOpen !== undefined && reader.details.open !== reader.expectedOpen)reader.preference = reader.details.open;
      reader.expectedOpen = reader.preference ?? ['inProgress', 'running'].includes(item.status);
      reader.details.open = reader.expectedOpen;
      reader.summary.textContent = summary(item);
    }
    if(mode === 'collaboration')reader.summary.textContent = summary(item);
    if(reader.text === text)return;
    reader.text = text;
    if(mode === 'markdown') {reader.body.replaceChildren();blocks(reader.body, text.replace(/\r\n?/g, '\n').split('\n'));}
    else reader.body.textContent = text;
  }
  root.DeskActivity = {render};
})(typeof globalThis === 'undefined' ? this : globalThis);
