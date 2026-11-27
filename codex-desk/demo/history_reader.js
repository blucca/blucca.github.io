/* Original native history, read independently of the active task and workspace. */
(function(root) {
  const PAGE_ENTRIES=40, TEXT_CHARS=20000;
  const visibleTypes=new Set(['userMessage','agentMessage','commandExecution','fileChange',
    'mcpToolCall','dynamicToolCall','collabAgentToolCall','subAgentActivity']);
  const labels={userMessage:'Your message',agentMessage:'Codex reply',commandExecution:'Command',
    fileChange:'File changes',mcpToolCall:'MCP tool',dynamicToolCall:'Tool',
    collabAgentToolCall:'Sub-agent tool',subAgentActivity:'Sub-agent activity'};
  const el=id=>document.getElementById('history-reader'+(id?'-'+id:''));
  const str=value=>typeof value==='string'?value:'';
  const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  let api,version=0,source=null,rows=[],page=0,requested=null,options=null,targetIndex=-1;
  let loading=false,originalItems=0,unsupportedItems=0,turnOnlyRows=0;
  let findVersion=0,finding=false,findSubmitted=false,findQuery='',findGroups=[],findTotal=0,findCursor=-1;

  function current(ticket) {
    return ticket===version && el('').open && (!options?.valid || options.valid());
  }
  function invalidate() {
    ++version;const callback=options?.onReturn;
    options=null;source=null;requested=null;rows=[];loading=false;targetIndex=-1;
    resetFind();
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
    const result=[];originalItems=0;unsupportedItems=0;turnOnlyRows=0;
    for(const turn of thread.turns) {
      if(!turn || typeof turn!=='object' || !Array.isArray(turn.items))continue;
      const first=result.length;
      for(const item of turn.items) {
        ++originalItems;
        if(!item || typeof item!=='object' || Array.isArray(item)) {++unsupportedItems;continue;}
        if(!visibleTypes.has(item.type))++unsupportedItems;
        result.push({turn,item});
      }
      // A failed or interrupted turn can finish without any native items.
      // Retain its outcome as a separate entry, not a made-up readable item.
      if(result.length===first){result.push({turn,item:null});++turnOnlyRows;}
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
  function findControls(message) {
    const ready=!!source && !loading && el('').open;
    el('find-form').hidden=!ready;el('find-query').disabled=!ready;
    el('find-submit').disabled=!ready || finding;
    el('find-previous').disabled=el('find-next').disabled=!ready || finding || findTotal===0;
    el('find-form').setAttribute('aria-busy',String(finding));
    if(message!==undefined)el('find-status').textContent=message;
    else if(finding)el('find-status').textContent='Finding matches in the complete original text…';
    else if(findTotal)el('find-status').textContent=findCursor>=0
      ? `Match ${findCursor+1} of ${findTotal}. Previous/Next match or Shift+F3/F3 moves through this original.`
      : `${findTotal} matches. Choose Previous/Next match to jump to an occurrence.`;
    else el('find-status').textContent=findSubmitted
      ? 'No matches in the readable original text for this phrase.'
      : 'Search the complete readable text in this original, including other item pages and text windows.';
  }
  function resetFind() {
    ++findVersion;finding=false;findSubmitted=false;findQuery='';findGroups=[];findTotal=0;findCursor=-1;
    el('find-query').value='';findControls();
  }
  function manualFindNavigation() {
    findCursor=-1;
    if(finding){++findVersion;finding=false;findGroups=[];findTotal=0;
      findControls('Find canceled by navigation. Choose Find to search this original.');}
    else findControls();
  }
  function findMatch() {
    if(findCursor<0)return null;
    let left=0,right=findGroups.length;
    while(left<right){const mid=(left+right)>>>1;if(findGroups[mid].first<=findCursor)left=mid+1;else right=mid;}
    const group=findGroups[left-1],span=group?.spans.at(findCursor-group.first);
    return span?{index:group.index,...span}:null;
  }
  function jumpFind(direction=1) {
    if(!source || !available() || finding || !findTotal)return;
    if(findCursor<0){
      const group=direction>0?findGroups.find(group=>group.index>=page*PAGE_ENTRIES)
        :findGroups.findLast(group=>group.index<(page+1)*PAGE_ENTRIES);
      findCursor=group?group.first+(direction>0?0:group.spans.length-1):(direction>0?0:findTotal-1);
    } else findCursor=(findCursor+direction+findTotal)%findTotal;
    page=Math.floor(findMatch().index/PAGE_ENTRIES);findControls();render();
  }
  async function submitFind(direction=1) {
    if(!source || loading || !available())return;
    const query=el('find-query').value.trim();
    if(query.length<1 || query.length>200){findControls('Enter 1–200 characters to find in this original.');el('find-query').focus();return;}
    const ticket=version,search=++findVersion;
    const valid=()=>search===findVersion && current(ticket);
    finding=true;findSubmitted=true;findQuery=query;findGroups=[];findTotal=0;findCursor=-1;findControls();render(false);
    if(el('match').textContent==='Showing the matching original native turn and item.')
      el('match').textContent='The saved search result identifies its original native turn and item. Find navigation is independent.';
    // Let the busy status paint before scanning a long loaded conversation.
    await new Promise(resolve=>setTimeout(resolve,0));
    const groups=[];let total=0;
    try {
      for(let index=0;index<rows.length;index++) {
        if(!valid())return;
        const item=rows[index].item;
        if(!item || !visibleTypes.has(item.type))continue;
        const spans=await root.DeskHistoryFind.spansAsync(textFor(item),query,valid);
        if(!valid() || spans===null)return;
        if(spans.length){groups.push({index,spans,first:total});total+=spans.length;}
        if(index%40===39){await new Promise(resolve=>setTimeout(resolve,0));if(!valid())return;}
      }
      if(!valid())return;
      findGroups=groups;findTotal=total;finding=false;findControls();
      if(total){findCursor=direction>0?total-1:0;jumpFind(direction);}
    } catch {
      if(valid()){finding=false;findControls('The original text could not be searched. Choose Find to retry.');}
    }
  }
  function markText(container,text,start,end) {
    container.replaceChildren();
    if(start>=0 && end>start)container.append(document.createTextNode(text.slice(0,start)),node('mark',text.slice(start,end)),document.createTextNode(text.slice(end)));
    else container.textContent=text;
  }
  function copyControls(detail,row,text,ticket) {
    if(!visibleTypes.has(row.item.type))return;
    const actions=node('div',undefined,'history-reader-evidence-controls');
    const copyText=node('button','Copy full item text','history-reader-copy-text');
    const copySource=node('button','Copy source reference','history-reader-copy-source');
    const status=node('p','','history-reader-copy-status');status.setAttribute('role','status');
    copyText.type=copySource.type='button';
    const title=(str(source.name)||str(source.title)||str(source.preview)||'Original Codex conversation').slice(0,240);
    const reference=`Conversation: ${title}\nThread: ${str(source.id)}\nTurn: ${str(row.turn.id)||'unreported'}\nItem: ${str(row.item.id)||'unreported'}\nProject folder: ${str(source.cwd)||'unreported'}`;
    async function copy(value,label) {
      if(!available(ticket) || !detail.isConnected)return;
      copyText.disabled=copySource.disabled=true;status.textContent='Copying…';
      try {
        if(!root.navigator?.clipboard?.writeText)throw new Error('Clipboard access is unavailable.');
        await root.navigator.clipboard.writeText(value);
        if(current(ticket) && detail.isConnected)status.textContent=label+' copied.';
      } catch {
        if(current(ticket) && detail.isConnected)status.textContent='Could not copy. Allow clipboard access and try again, or select the original text.';
      } finally {if(current(ticket) && detail.isConnected)copyText.disabled=copySource.disabled=false;}
    }
    copyText.onclick=()=>copy(text,'Full item text');copySource.onclick=()=>copy(reference,'Source reference');
    actions.append(copyText,copySource,status);detail.append(actions);
  }
  function scrollMatch(item,ticket) {
    // Rendering replaces the old focused target. Keep the next immediate F3
    // key inside this dialog; defer only geometry, not keyboard ownership.
    if(!current(ticket) || !item.isConnected)return;
    item.focus({preventScroll:true});
    requestAnimationFrame(()=>{
      if(!current(ticket) || !item.isConnected || document.activeElement!==item)return;
      const body=el('body'),mark=item.querySelector('mark');
      const box=body.getBoundingClientRect(),rect=item.getBoundingClientRect();
      body.scrollTop+=rect.top-box.top-24;
      if(mark) {
        const pre=mark.closest('pre'),line=mark.getBoundingClientRect(),frame=pre.getBoundingClientRect();
        pre.scrollTop+=line.top-frame.top-pre.clientHeight/2;
      }
    });
  }
  function itemNode(row,index,ticket) {
    const {item,turn}=row,text=textFor(item),occurrence=findMatch();
    const matched=occurrence?index===occurrence.index:!findSubmitted && index===targetIndex;
    const phrase=matched && !occurrence?str(requested.match_text):'';
    const at=matched && occurrence?occurrence.start:phrase?text.indexOf(phrase):-1;
    const matchEnd=matched && occurrence?occurrence.end:at+phrase.length;
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
      const value=text.slice(window.start,window.end);
      markText(pre,value,matched && at>=window.start && matchEnd<=window.end?at-window.start:-1,matchEnd-window.start);
      range.hidden=controls.hidden=text.length<=TEXT_CHARS;
      range.textContent=`Text characters ${window.start+1}–${window.end} of ${text.length}.`;
      earlier.disabled=window.start===0;later.disabled=window.end===text.length;
    }
    function moveText(next) {
      if(!available(ticket))return;
      if(finding)manualFindNavigation();
      windowText(next);pre.scrollTop=0;
      if(matched && occurrence && !(at>=start && matchEnd<=Math.min(text.length,start+TEXT_CHARS)))
        findControls(`Match ${findCursor+1} of ${findTotal} is outside this text window. Previous/Next match jumps to an occurrence.`);
      else findControls();
    }
    earlier.onclick=()=>moveText(start-TEXT_CHARS);later.onclick=()=>moveText(start+TEXT_CHARS);
    windowText(start);detail.append(summary,identity,range,pre,controls);
    detail.open=matched || ['userMessage','agentMessage'].includes(item.type);
    copyControls(detail,row,text,ticket);
    if(matched && (occurrence || !phrase || at>=0) && visibleTypes.has(item.type)) {
      detail.classList.add('history-reader-target');detail.tabIndex=-1;
    }
    return detail;
  }
  function render(scroll=true) {
    if(!source || !available())return;
    const ticket=version,first=page*PAGE_ENTRIES,last=Math.min(rows.length,first+PAGE_ENTRIES);
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
      if(row.item)section.append(itemNode(row,index,ticket));
      else {
        section.classList.add('history-reader-turn-only');
        section.append(node('p',row.turn.items.length?'No readable native items were returned for this turn.':
          'No native items were returned for this turn.','muted'));
      }
    }
    if(!rows.length)body.append(node('p','The original native read contains no readable items.','muted'));
    const pages=Math.max(1,Math.ceil(rows.length/PAGE_ENTRIES)),unit=turnOnlyRows?'entries':'items';
    el('coverage').textContent=`Showing ${unit} ${rows.length?first+1:0}–${last} of ${rows.length}. Page ${page+1} of ${pages}. `+
      `${originalItems} original native items; ${unsupportedItems} unsupported or unreadable. `+
      (turnOnlyRows?`${turnOnlyRows} turn-only outcomes. `:'')+
      `Up to ${PAGE_ENTRIES} ${unit}${turnOnlyRows?' (native items or turn-only outcomes)':''} per page and ${TEXT_CHARS.toLocaleString()} text characters per item window.`;
    el('previous').textContent='Previous '+unit;el('next').textContent='Next '+unit;
    el('previous').disabled=page===0;el('next').disabled=last>=rows.length;
    el('previous').hidden=el('next').hidden=pages===1;
    const target=body.querySelector('.history-reader-target');if(target && scroll)scrollMatch(target,ticket);
  }
  function movePage(direction) {
    const next=page+direction;
    if(!source || !available() || next<0 || next*PAGE_ENTRIES>=rows.length)return;
    page=next;manualFindNavigation();render();
    // A page without a match still needs a keyboard destination. In
    // particular, the final page disables the footer's Next items button.
    if(!el('body').querySelector('.history-reader-target'))el('body').focus({preventScroll:true});
  }
  async function read() {
    if(loading || !requested || !available())return false;
    const ticket=++version;loading=true;source=null;rows=[];
    resetFind();el('find-query').value=str(requested.match_text);
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
      targetIndex=hasIdentity?rows.findIndex(row=>row.item && row.turn.id===requested.turn_id && row.item.id===requested.item_id):-1;
      page=targetIndex>=0?Math.floor(targetIndex/PAGE_ENTRIES):0;
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
      if(ticket===version){loading=false;el('body').setAttribute('aria-busy','false');el('retry').disabled=false;findControls();}
    }
  }
  async function show(result,callbacks={}) {
    if(!api)throw new Error('Native history reader is not configured.');
    if(callbacks.valid && !callbacks.valid())return false;
    ++version;loading=false;source=null;rows=[];targetIndex=-1;
    resetFind();
    requested={...result};options=callbacks;
    el('back').textContent=callbacks.backLabel || 'Back to search';
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
    el('previous').onclick=()=>movePage(-1);
    el('next').onclick=()=>movePage(1);
    el('find-form').onsubmit=event=>{event.preventDefault();submitFind();};
    el('find-previous').onclick=()=>jumpFind(-1);el('find-next').onclick=()=>jumpFind(1);
    el('find-query').oninput=()=>{
      ++findVersion;finding=false;findGroups=[];findTotal=0;findCursor=-1;
      findControls('Query changed. Choose Find to search this original.');if(source && available())render(false);
    };
    el('').addEventListener('keydown',event=>{
      if(event.key!=='F3' || !el('').open || !source || loading || !el('').contains(event.target))return;
      event.preventDefault();
      if(finding)return;
      if(findSubmitted && findQuery===el('find-query').value.trim() && findTotal)jumpFind(event.shiftKey?-1:1);
      else if(el('find-query').value.trim())submitFind(event.shiftKey?-1:1);
      else el('find-query').focus();
    });
    el('').addEventListener('close',()=>{if(!el('').open)invalidate();});
  }
  root.DeskHistoryReader={configure,show,close};
})(typeof globalThis==='undefined'?this:globalThis);
