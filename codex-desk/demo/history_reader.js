/* Original native history, read independently of the active task and workspace. */
(function(root) {
  const PAGE_ITEMS=40, TEXT_CHARS=20000;
  const visibleTypes=new Set(['userMessage','agentMessage','commandExecution','fileChange',
    'mcpToolCall','dynamicToolCall','collabAgentToolCall','subAgentActivity']);
  const labels={userMessage:'Your message',agentMessage:'Codex reply',commandExecution:'Command',
    fileChange:'File changes',mcpToolCall:'MCP tool',dynamicToolCall:'Tool',
    collabAgentToolCall:'Sub-agent tool',subAgentActivity:'Sub-agent activity'};
  const el=id=>document.getElementById('history-reader'+(id?'-'+id:''));
  const str=value=>typeof value==='string'?value:'';
  const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  let api,version=0,source=null,rows=[],page=0,requested=null,options=null,targetIndex=-1;
  let loading=false,originalItems=0,unsupportedItems=0;

  function current(ticket) {
    return ticket===version && el('').open && (!options?.valid || options.valid());
  }
  function invalidate() {
    ++version;const callback=options?.onReturn;
    options=null;source=null;requested=null;rows=[];loading=false;targetIndex=-1;
    el('body').replaceChildren();if(callback)callback();
  }
  function close() {if(el('').open)el('').close();invalidate();}
  function available(ticket=version) {
    if(current(ticket))return true;
    if(ticket===version && el('').open)close();
    return false;
  }
  function textFor(item) {
    try {
      switch(item.type) {
        case 'userMessage':return 'User\n'+(Array.isArray(item.content)?item.content:[])
          .filter(c=>c && c.type==='text').map(c=>str(c.text)).join('\n');
        case 'agentMessage':return 'Codex\n'+str(item.text);
        case 'commandExecution':return 'Command\n'+str(item.command)+'\nStatus: '+(str(item.status)||'unknown')+
          '\nExit: '+(typeof item.exitCode==='number'?item.exitCode:'not reported')+'\n'+
          (typeof item.aggregatedOutput==='string'?item.aggregatedOutput:'[No command output reported.]');
        case 'fileChange':return 'File changes\n'+(Array.isArray(item.changes)?item.changes:[])
          .filter(c=>c && typeof c==='object').map(c=>str(c.path)+'\n'+str(c.diff)).join('\n');
        case 'mcpToolCall':case 'dynamicToolCall':return root.DeskEvidence.tool(item);
        case 'collabAgentToolCall':case 'subAgentActivity':return root.DeskEvidence.collaboration(item);
        default:return 'No readable text renderer for native item type: '+(str(item.type).slice(0,80)||'unknown');
      }
    } catch {return '[This native item could not be read.]';}
  }
  function flatten(thread) {
    const result=[];originalItems=0;unsupportedItems=0;
    for(const turn of thread.turns) {
      if(!turn || typeof turn!=='object' || !Array.isArray(turn.items))continue;
      for(const item of turn.items) {
        ++originalItems;
        if(!item || typeof item!=='object' || Array.isArray(item)) {++unsupportedItems;continue;}
        if(!visibleTypes.has(item.type))++unsupportedItems;
        result.push({turn,item});
      }
    }
    return result;
  }
  function bounds(text,start) {
    start=Math.max(0,Math.min(start,Math.max(0,text.length-TEXT_CHARS)));
    if(start && /[\uDC00-\uDFFF]/.test(text[start]) && /[\uD800-\uDBFF]/.test(text[start-1]))--start;
    let end=Math.min(text.length,start+TEXT_CHARS);
    if(end<text.length && /[\uD800-\uDBFF]/.test(text[end-1]) && /[\uDC00-\uDFFF]/.test(text[end]))--end;
    return {start,end};
  }
  function scrollMatch(item,ticket) {
    requestAnimationFrame(()=>{
      if(!current(ticket) || !item.isConnected)return;
      const body=el('body'),mark=item.querySelector('mark');
      const box=body.getBoundingClientRect(),rect=item.getBoundingClientRect();
      body.scrollTop+=rect.top-box.top-24;item.focus({preventScroll:true});
      if(mark) {
        const pre=mark.closest('pre'),line=mark.getBoundingClientRect(),frame=pre.getBoundingClientRect();
        pre.scrollTop+=line.top-frame.top-pre.clientHeight/2;
      }
    });
  }
  function itemNode(row,index,ticket) {
    const {item,turn}=row,text=textFor(item),matched=index===targetIndex;
    const phrase=matched?str(requested.match_text):'',at=phrase?text.indexOf(phrase):-1;
    const detail=node('details',undefined,'history-reader-item');
    detail.dataset.itemId=str(item.id);detail.dataset.turnId=str(turn.id);
    const summary=node('summary',(labels[item.type] || 'Unsupported native item')+
      (str(item.status)?' · '+str(item.status).slice(0,80):'')+
      (item.type==='commandExecution' && typeof item.exitCode==='number'?' · exit '+item.exitCode:''));
    const identity=node('div','Item '+(str(item.id)||'unreported'),'history-reader-identity');
    const pre=node('pre',undefined,'history-reader-text');
    const range=node('p','','history-reader-text-coverage');
    const controls=node('div',undefined,'history-reader-text-controls');
    const earlier=node('button','Earlier text'),later=node('button','Later text');
    earlier.type=later.type='button';controls.append(earlier,later);
    let start=matched && at>=0?Math.max(0,at-Math.floor(TEXT_CHARS/2)):0;
    function windowText(next) {
      const window=bounds(text,next);start=window.start;
      const value=text.slice(window.start,window.end),local=phrase?value.indexOf(phrase):-1;
      pre.replaceChildren();
      if(local>=0)pre.append(document.createTextNode(value.slice(0,local)),node('mark',phrase),document.createTextNode(value.slice(local+phrase.length)));
      else pre.textContent=value;
      range.hidden=controls.hidden=text.length<=TEXT_CHARS;
      range.textContent=`Text characters ${window.start+1}–${window.end} of ${text.length}.`;
      earlier.disabled=window.start===0;later.disabled=window.end===text.length;
    }
    earlier.onclick=()=>{if(available(ticket)){windowText(start-TEXT_CHARS);pre.scrollTop=0;}};
    later.onclick=()=>{if(available(ticket)){windowText(start+TEXT_CHARS);pre.scrollTop=0;}};
    windowText(start);detail.append(summary,identity,range,pre,controls);
    detail.open=matched || ['userMessage','agentMessage'].includes(item.type);
    if(matched && (!phrase || at>=0) && visibleTypes.has(item.type)) {
      detail.classList.add('history-reader-target');detail.tabIndex=-1;
    }
    return detail;
  }
  function render() {
    if(!source || !available())return;
    const ticket=version,first=page*PAGE_ITEMS,last=Math.min(rows.length,first+PAGE_ITEMS);
    const body=el('body');body.replaceChildren();body.scrollTop=0;
    let previousTurn=null,section=null;
    for(let index=first;index<last;index++) {
      const row=rows[index];
      if(row.turn!==previousTurn) {
        previousTurn=row.turn;section=node('section',undefined,'history-reader-turn');
        section.dataset.turnId=str(row.turn.id);
        section.append(node('h3','Turn '+(str(row.turn.id)||'unreported')+
          (str(row.turn.status)?' · '+str(row.turn.status).slice(0,80):'')));
        if(str(row.turn.error?.message))section.append(node('p',str(row.turn.error.message).slice(0,2000),'history-reader-turn-error'));
        body.append(section);
      }
      section.append(itemNode(row,index,ticket));
    }
    if(!rows.length)body.append(node('p','The original native read contains no readable items.','muted'));
    const pages=Math.max(1,Math.ceil(rows.length/PAGE_ITEMS));
    el('coverage').textContent=`Showing items ${rows.length?first+1:0}–${last} of ${rows.length}. Page ${page+1} of ${pages}. `+
      `${originalItems} original native items; ${unsupportedItems} unsupported or unreadable. `+
      `Up to ${PAGE_ITEMS} items per page and ${TEXT_CHARS.toLocaleString()} text characters per item window.`;
    el('previous').disabled=page===0;el('next').disabled=last>=rows.length;
    el('previous').hidden=el('next').hidden=pages===1;
    const target=body.querySelector('.history-reader-target');if(target)scrollMatch(target,ticket);
  }
  async function read() {
    if(loading || !requested || !available())return false;
    const ticket=++version;loading=true;source=null;rows=[];
    el('body').replaceChildren();el('body').setAttribute('aria-busy','true');
    el('status').textContent='Reading original native conversation…';
    el('error').hidden=true;el('retry').hidden=true;el('match').textContent='';el('coverage').textContent='';
    el('previous').hidden=el('next').hidden=true;
    try {
      const thread=await api('/api/native/thread?id='+encodeURIComponent(requested.thread_id));
      if(!current(ticket)){if(ticket===version && el('').open)close();return false;}
      if(!thread || thread.id!==requested.thread_id || !Array.isArray(thread.turns))throw new Error('The original native read did not return this conversation.');
      source=thread;rows=flatten(thread);
      el('title').textContent=(str(thread.name)||str(thread.title)||str(thread.preview)||'Original Codex conversation').slice(0,240);
      el('binding').textContent='Thread '+thread.id+'\n'+(str(thread.cwd)||'Working directory unreported')+
        (str(thread.modelProvider)?'\nProvider: '+thread.modelProvider:'');
      el('status').textContent='Read-only original conversation. Your selected task and draft stay unchanged.';
      const hasIdentity=typeof requested.turn_id==='string' && typeof requested.item_id==='string';
      targetIndex=hasIdentity?rows.findIndex(row=>row.turn.id===requested.turn_id && row.item.id===requested.item_id):-1;
      page=targetIndex>=0?Math.floor(targetIndex/PAGE_ITEMS):0;
      if(hasIdentity && targetIndex<0)el('match').textContent='The requested native turn/item is not present in this original read. You can still read the conversation.';
      else if(targetIndex>=0) {
        const row=rows[targetIndex],phrase=str(requested.match_text);
        el('match').textContent=!visibleTypes.has(row.item.type)?'The requested item has no supported readable text. You can still read the conversation.':
          phrase && !textFor(row.item).includes(phrase)?'The saved phrase is no longer in this original native item. You can still read the conversation.':
          'Showing the matching original native turn and item.';
      } else el('match').textContent='Original native history, without opening or resuming a task.';
      render();return true;
    } catch(error) {
      if(!current(ticket)){if(ticket===version && el('').open)close();return false;}
      el('status').textContent='The original conversation could not be read.';
      el('error').textContent=error.message;el('error').hidden=false;el('retry').hidden=false;
      return false;
    } finally {
      if(ticket===version){loading=false;el('body').setAttribute('aria-busy','false');el('retry').disabled=false;}
    }
  }
  async function show(result,callbacks={}) {
    if(!api)throw new Error('Native history reader is not configured.');
    if(callbacks.valid && !callbacks.valid())return false;
    ++version;loading=false;source=null;rows=[];targetIndex=-1;
    requested={...result};options=callbacks;
    el('title').textContent='Original Codex conversation';
    el('binding').textContent='Thread '+str(result.thread_id)+(str(result.cwd)?'\n'+result.cwd:'');
    if(!el('').open)el('').showModal();
    if(typeof result.thread_id!=='string' || !result.thread_id.trim() || result.thread_id.length>200) {
      el('body').replaceChildren();el('body').setAttribute('aria-busy','false');
      el('status').textContent='An original native thread is required.';
      el('match').textContent='';el('coverage').textContent='';
      el('error').hidden=el('retry').hidden=el('previous').hidden=el('next').hidden=true;return false;
    }
    return read();
  }
  function configure(value) {
    api=value.api;
    el('back').onclick=el('close').onclick=close;
    el('retry').onclick=()=>{el('retry').disabled=true;read();};
    el('previous').onclick=()=>{if(source && available() && page>0){--page;render();}};
    el('next').onclick=()=>{if(source && available() && (page+1)*PAGE_ITEMS<rows.length){++page;render();}};
    el('').addEventListener('close',()=>{if(!el('').open)invalidate();});
  }
  root.DeskHistoryReader={configure,show,close};
})(typeof globalThis==='undefined'?this:globalThis);
