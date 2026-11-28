/* Original native history, read independently of the active task and workspace. */
(function(root) {
  const PAGE_ENTRIES=40, TEXT_CHARS=20000;
  const visibleTypes=new Set(['userMessage','agentMessage','plan','commandExecution','fileChange',
    'mcpToolCall','dynamicToolCall','collabAgentToolCall','subAgentActivity']);
  const labels={userMessage:'Your message',agentMessage:'Codex reply',plan:'Proposed plan',commandExecution:'Command',
    fileChange:'File changes',mcpToolCall:'MCP tool',dynamicToolCall:'Tool',
    collabAgentToolCall:'Sub-agent tool',subAgentActivity:'Sub-agent activity'};
  const el=id=>document.getElementById('history-reader'+(id?'-'+id:''));
  const str=value=>typeof value==='string'?value:'';
  const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  let api,evidenceReview=null,version=0,source=null,rows=[],page=0,requested=null,options=null,targetIndex=-1;
  let refreshing=false,refreshVersion=0,unavailableThread=null;
  let loading=false,originalItems=0,unsupportedItems=0,turnOnlyRows=0;
  let findVersion=0,finding=false,findSubmitted=false,findQuery='',findGroups=[],findTotal=0,findCursor=-1;
  let taskReview=null;

  let nativeIdCopy=null;
  function nativeIdCopyControls() {
    const button=el('copy-native-id');if(!button)return;
    button.disabled=!!nativeIdCopy || !source || loading || source.id!==requested?.thread_id || !current(version);
  }
  function resetNativeIdCopy() {
    nativeIdCopy=null;const status=el('native-id-status');if(status)status.textContent='';nativeIdCopyControls();
  }
  async function copyNativeId() {
    if(nativeIdCopy || !source || loading || source.id!==requested?.thread_id || !available())return false;
    const request={ticket:version,id:source.id};nativeIdCopy=request;nativeIdCopyControls();
    const valid=()=>nativeIdCopy===request && current(request.ticket) && source?.id===request.id;
    const notice=text=>{if(valid())preserveChrome(()=>{el('native-id-status').textContent=text;},request.ticket);};
    notice('Copying native conversation ID…');
    try{
      if(!root.navigator?.clipboard?.writeText)throw Error('Clipboard unavailable');
      await root.navigator.clipboard.writeText(request.id);
      notice('Native conversation ID copied.');return valid();
    }catch{notice('Could not copy the native ID. Try again.');return false;}
    finally{if(valid()){nativeIdCopy=null;nativeIdCopyControls();}}
  }
  function current(ticket) {
    return ticket===version && el('').open && (!options?.valid || options.valid());
  }
  function invalidate() {
    ++version;++refreshVersion;refreshing=false;const callback=options?.onReturn;
    options=null;source=null;requested=null;rows=[];loading=false;targetIndex=-1;unavailableThread=null;taskReview=null;taskControls();resetNativeIdCopy();
    el('response').hidden=true;el('response').textContent='';el('original').hidden=true;el('saved-evidence').hidden=true;el('saved-evidence-quote').textContent='';
    resetFind();
    el('body').replaceChildren();if(callback)callback();
  }
  function close(expected=null) {
    if(expected && options!==expected){
      let owner=options?.returnOwner;while(owner && owner!==expected)owner=owner.returnOwner;
      if(owner!==expected)return false;
      options.dismissOwner=true;
    }
    if(el('').open)el('').close();invalidate();return true;
  }
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
        case 'plan':return 'Proposed plan\n'+str(item.text);
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
    const ready=!!source && !loading && el('').open && (!taskReview || taskReview.mode==='item');
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
    if(finding){++findVersion;finding=false;findSubmitted=false;findGroups=[];findTotal=0;
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
    actions.append(copyText,copySource,status);
    if(root.DeskHistoryTasks && str(row.turn.id) && str(row.item.id)) {
      const task=node('button','Read containing task','history-reader-task-open');task.type='button';
      task.onmousedown=event=>{if(event.button===0 && selectedText())event.preventDefault();};
      task.onclick=()=>{try{openTaskContext({thread_id:source.id,turn_id:row.turn.id,item_id:row.item.id});}
        catch(error){if(current(ticket))status.textContent=error.message;}};
      actions.append(task);
    }
    if(typeof evidenceReview==='function'){
      const review=node('button','Review evidence for task','history-reader-review-evidence');review.type='button';
      review.onmousedown=event=>{if(event.button===0 && selectedText()?.key===rowKey(row))event.preventDefault();};
      review.onclick=async()=>{
        if(!available(ticket) || !detail.isConnected)return;
        const selection=selectedText(),key=rowKey(row);
        const range=selection?.key===key?{start:selection.start,end:selection.end}:null;
        const view=captureView();review.disabled=true;
        try{
          await evidenceReview({thread:source,turn_id:row.turn.id,item_id:row.item.id,
            text_for_item:textFor,selection_utf16:range,valid:()=>current(ticket)&&detail.isConnected,
            onReturn:()=>{if(current(ticket)&&detail.isConnected)restoreView(view,ticket);}});
        }catch(error){if(current(ticket)&&detail.isConnected)status.textContent=error.message;}
        finally{if(current(ticket)&&detail.isConnected)review.disabled=false;}
      };
      actions.append(review);
    }
    const references=root.DeskEvidencePreparation?.parse(text) || [];
    for(const {reference:saved} of references){
      const read=node('button','Read referenced original · '+(saved.title || saved.item_id),'history-reader-read-reference');read.type='button';
      read.onclick=async()=>{
        if(!available(ticket) || !detail.isConnected)return;
        read.disabled=true;status.textContent='Reading the captured evidence source…';
        try{await readEmbeddedReference(saved,ticket);}
        catch(error){if(current(ticket) && detail.isConnected)status.textContent=error.message;}
        finally{if(current(ticket) && detail.isConnected)read.disabled=false;}
      };
      actions.append(read);
    }
    detail.append(actions);
  }
  async function readEmbeddedReference(reference,ticket){
    const parentSource=source,parentRequested={...requested},parentOptions=options,view=captureView(),parentTask=taskReview;
    const search={query:el('find-query').value,submitted:findSubmitted,findQuery,groups:findGroups,total:findTotal,cursor:findCursor,page};
    const result=await api('/api/native/evidence-source?home='+encodeURIComponent(reference.native_home)+'&thread='+encodeURIComponent(reference.thread_id));
    if(!current(ticket))return false;
    if(result?.home_namespace!==reference.native_home)throw Error('This evidence belongs to a different native home. The saved excerpt is kept.');
    if(result.thread?.id!==reference.thread_id || !Array.isArray(result.thread.turns))throw Error('The captured evidence source could not be read. The saved instruction is kept.');
    const resolution=root.DeskEvidencePreparation.resolve(reference,result.home_namespace,result.thread,textFor);
    const child={returnOwner:parentOptions,preloadedThread:result.thread,savedReference:reference,resolution,
      valid:()=>!parentOptions?.valid || parentOptions.valid(),backLabel:'Return to source instruction',onReturn:()=>{
        if(child.dismissOwner || (parentOptions?.valid && !parentOptions.valid())){parentOptions?.onReturn?.();return;}
        const restored=parentOptions;restored.preloadedThread=parentSource;
        show(parentRequested,restored).then(ok=>{
          if(!ok || options!==restored)return;
          taskReview=parentTask;taskControls();
          el('find-query').value=search.query;findSubmitted=search.submitted;findQuery=search.findQuery;
          findGroups=search.groups;findTotal=search.total;findCursor=search.cursor;page=search.page;
          findControls();render(false,view);
        });
      }};
    return show({thread_id:reference.thread_id,turn_id:reference.turn_id,item_id:reference.item_id,
      ...(resolution.available?{match_text:reference.quote,match_start:resolution.start_utf16}:{})},child);
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
        // A long text window can be taller than the transcript viewport.
        const visible=mark.getBoundingClientRect();
        body.scrollTop+=visible.top-body.getBoundingClientRect().top-body.clientHeight/2;
      }
      const reader=el(''),outer=reader.getBoundingClientRect(),inner=body.getBoundingClientRect();
      if(inner.bottom>outer.bottom-16 || inner.top<outer.top+16)reader.scrollTop+=inner.top-outer.top-24;
    });
  }
  function rowKey(row){return row?.item && str(row.turn.id) && str(row.item.id)?JSON.stringify([row.turn.id,row.item.id]):null;}
  function itemNode(row,index,ticket,view=null) {
    const {item,turn}=row,text=textFor(item),occurrence=findMatch();
    const matched=occurrence?index===occurrence.index:!findSubmitted && index===targetIndex;
    const phrase=matched && !occurrence?str(requested.match_text):'';
    const exactStart=Number.isInteger(requested.match_start)?requested.match_start:null;
    const at=matched && occurrence?occurrence.start:phrase?(exactStart!==null
      ? (exactStart>=0 && text.slice(exactStart,exactStart+phrase.length)===phrase?exactStart:-1)
      : text.indexOf(phrase)):-1;
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
    const saved=view?.items.get(rowKey(row));
    let start=saved?.start ?? (matched && at>=0?Math.max(0,at-Math.floor(TEXT_CHARS/2)):0);
    function windowText(next) {
      const window=bounds(text,next);start=window.start;detail.dataset.windowStart=String(start);
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
    detail.open=saved?.open ?? (matched || ['userMessage','agentMessage','plan'].includes(item.type));
    if(saved)pre.scrollTop=saved.scroll;
    copyControls(detail,row,text,ticket);
    if(matched && (occurrence || !phrase || at>=0) && visibleTypes.has(item.type)) {
      detail.classList.add('history-reader-target');detail.tabIndex=-1;
    }
    return detail;
  }
  function render(scroll=true,view=null) {
    if(!source || !available())return;
    taskControls();
    if(taskReview?.mode==='instructions')return renderInstructionSearch(scroll,view);
    if(taskReview?.mode==='context')return renderTaskContext(scroll,view);
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
        if(root.DeskHistoryTasks && str(row.turn.id)) {
          const task=node('button','Read task context','history-reader-turn-task');task.type='button';
          task.dataset.taskAction='turn:'+row.turn.id;
          task.onmousedown=event=>{if(event.button===0 && selectedText())event.preventDefault();};
          task.onclick=()=>{try{openTaskContext({thread_id:source.id,turn_id:row.turn.id});}
            catch(error){if(current(ticket)){el('error').textContent=error.message;el('error').hidden=false;}}};
          section.append(task);
        }
        body.append(section);
      }
      if(row.item)section.append(itemNode(row,index,ticket,view));
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
    if(view)restoreView(view,ticket);
  }
  function movePage(direction) {
    const next=page+direction;
    if(!source || !available() || next<0 || next*PAGE_ENTRIES>=rows.length)return;
    page=next;manualFindNavigation();render();
    // A page without a match still needs a keyboard destination. In
    // particular, the final page disables the footer's Next items button.
    if(!el('body').querySelector('.history-reader-target'))el('body').focus({preventScroll:true});
  }
  function viewItems(){return Array.from(el('body').querySelectorAll('.history-reader-item'));}
  function elementKey(item){return JSON.stringify([item.dataset.turnId,item.dataset.itemId]);}
  function selectedText(){
    const selection=root.getSelection?.();if(!selection || selection.isCollapsed || !selection.rangeCount)return null;
    const range=selection.getRangeAt(0),parent=n=>n.nodeType===1?n:n.parentElement;
    const pre=parent(range.startContainer)?.closest('.history-reader-text');
    if(!pre || !el('body').contains(pre) || !pre.contains(range.endContainer))return null;
    const item=pre.closest('.history-reader-item');
    if(!item?.dataset.turnId || !item.dataset.itemId)return null;
    const prefix=document.createRange();prefix.selectNodeContents(pre);prefix.setEnd(range.startContainer,range.startOffset);
    const start=prefix.toString().length;prefix.setEnd(range.endContainer,range.endOffset);
    const end=prefix.toString().length,windowStart=Number(item.dataset.windowStart)||0;
    return {key:elementKey(item),start:windowStart+start,end:windowStart+end,text:range.toString(),
      backward:selection.anchorNode===range.endContainer && selection.anchorOffset===range.endOffset};
  }
  function textPoint(pre,offset,right=false){
    if(offset<0)return null;
    const walker=document.createTreeWalker(pre,NodeFilter.SHOW_TEXT);let node,last=null;
    while((node=walker.nextNode())){
      last=node;
      if(offset<node.data.length || (!right && offset===node.data.length))return {node,offset};
      offset-=node.data.length;
    }
    return offset===0 && last?{node:last,offset:last.data.length}:null;
  }
  function restoreSelectedText(saved){
    if(!saved)return;
    const row=rows.find(row=>rowKey(row)===saved.key),item=viewItems().find(item=>elementKey(item)===saved.key);
    const pre=item?.querySelector('.history-reader-text'),start=saved.start-(Number(item?.dataset.windowStart)||0);
    const end=saved.end-(Number(item?.dataset.windowStart)||0);
    const first=pre?textPoint(pre,start,true):null,last=pre?textPoint(pre,end):null;
    if(!row || !first || !last || textFor(row.item).slice(saved.start,saved.end)!==saved.text){
      el('status').textContent='Original refreshed. The selected original text changed or is no longer at its original location; its selection was not moved to another source.';
      return;
    }
    const selection=root.getSelection?.();if(!selection)return;
    const anchor=saved.backward?last:first,focus=saved.backward?first:last;
    selection.setBaseAndExtent(anchor.node,anchor.offset,focus.node,focus.offset);
  }
  function captureView(){
    const body=el('body'),items=new Map(),active=document.activeElement;
    const box=body.getBoundingClientRect();let anchor=null,focus=null;
    for(const item of viewItems()){
      const key=elementKey(item),pre=item.querySelector('.history-reader-text'),rect=item.getBoundingClientRect();
      items.set(key,{start:Number(item.dataset.windowStart)||0,open:item.open,scroll:pre?.scrollTop || 0});
      if(!anchor && rect.bottom>box.top)anchor={key,offset:rect.top-box.top,screenTop:rect.top};
      if(item===active || item.contains(active)){
        const controls=Array.from(item.querySelectorAll('button,summary,pre'));
        focus={key,index:controls.indexOf(active),item:item===active};
      }
    }
    return {items,anchor,focus,taskFocus:active?.dataset?.taskAction && body.contains(active)?active.dataset.taskAction:null,
      selection:selectedText(),scroll:body.scrollTop,outer:el('').scrollTop,page,first:rowKey(rows[page*PAGE_ENTRIES])};
  }
  function restoreView(view,ticket){
    if(!current(ticket))return;
    const body=el('body'),items=viewItems();
    for(const item of items){const saved=view.items.get(elementKey(item));if(saved)item.querySelector('.history-reader-text').scrollTop=saved.scroll;}
    body.scrollTop=view.scroll;
    if(view.anchor){const item=items.find(item=>elementKey(item)===view.anchor.key);
      if(item)body.scrollTop+=item.getBoundingClientRect().top-body.getBoundingClientRect().top-view.anchor.offset;}
    if(view.focus){
      const item=items.find(item=>elementKey(item)===view.focus.key);
      const target=view.focus.item?item:item?.querySelectorAll('button,summary,pre')[view.focus.index];
      if(target){if(view.focus.item)target.tabIndex=-1;target.focus({preventScroll:true});}
      else body.focus({preventScroll:true});
    }
    if(view.taskFocus){const target=Array.from(body.querySelectorAll('[data-task-action]')).find(control=>control.dataset.taskAction===view.taskFocus);
      if(target && !target.disabled)target.focus({preventScroll:true});}
    restoreSelectedText(view.selection);
    if(Number.isFinite(view.outer))el('').scrollTop=view.outer;
    if(Number.isFinite(view.anchor?.screenTop)){
      const item=items.find(item=>elementKey(item)===view.anchor.key);
      if(item)el('').scrollTop+=item.getBoundingClientRect().top-view.anchor.screenTop;
    }
  }
  function refreshControls(){
    const button=el('refresh');if(!button)return;
    button.hidden=!source;button.disabled=refreshing || loading;
    button.textContent=refreshing?'Refreshing original…':'Refresh original';
  }
  function preserveChrome(change,ticket){
    const view=source && rows.length?captureView():null;
    change();
    if(view && current(ticket))restoreView(view,ticket);
  }
  async function refreshFind(query,anchor,ticket){
    const search=++findVersion,valid=()=>search===findVersion && current(ticket);
    preserveChrome(()=>{finding=true;findGroups=[];findTotal=0;findCursor=-1;findControls();},ticket);
    const groups=[];let total=0;
    try{
      for(let index=0;index<rows.length;index++){
        if(!valid())return;
        const item=rows[index].item;if(!item || !visibleTypes.has(item.type))continue;
        const spans=await root.DeskHistoryFind.spansAsync(textFor(item),query,valid);
        if(!valid() || spans===null)return;
        if(spans.length){groups.push({index,spans,first:total});total+=spans.length;}
        if(index%40===39){await new Promise(resolve=>setTimeout(resolve,0));if(!valid())return;}
      }
      if(!valid())return;
      const view=captureView();findGroups=groups;findTotal=total;finding=false;
      if(anchor?.key){const group=groups.find(group=>rowKey(rows[group.index])===anchor.key);
        let index=-1;if(group)for(let i=0;i<group.spans.length;i++){const span=group.spans.at(i);if(span.start===anchor.start && span.end===anchor.end){index=i;break;}}
        if(index>=0)findCursor=group.first+index;}
      findControls(anchor && findCursor<0?'The previous occurrence is no longer at its original location. Choose Previous/Next match or Find to navigate the refreshed original.':undefined);
      render(false,view);
    }catch{
      if(valid()){finding=false;findControls('The refreshed original could not be searched. Choose Find to retry.');}
    }
  }
  async function refresh(){
    if(!source || loading || refreshing || !available())return false;
    const ticket=version,request=++refreshVersion;
    preserveChrome(()=>{refreshing=true;refreshControls();el('error').hidden=true;
      el('status').textContent='Refreshing original native conversation. The current snapshot stays readable.';
    },ticket);
    try{
      const savedReference=options?.savedReference;
      const scoped=typeof options?.loadOriginal==='function';
      const result=scoped?await options.loadOriginal():savedReference?await api('/api/native/evidence-source?home='+encodeURIComponent(savedReference.native_home)+'&thread='+encodeURIComponent(requested.thread_id)):
        await api('/api/native/thread?id='+encodeURIComponent(requested.thread_id));
      if(!scoped && savedReference && result.home_namespace!==savedReference.native_home)throw Error('The original native home does not match this saved evidence.');
      const thread=!scoped && savedReference?result.thread:result;
      if(request!==refreshVersion)return false;
      if(!current(ticket)){if(ticket===version && el('').open)close();return false;}
      if(!thread || thread.id!==requested.thread_id || !Array.isArray(thread.turns))throw Error('The original native read did not return this conversation.');
      // Commit the latest reader intent, not the page/query captured on click.
      const view=captureView(),oldMatch=findMatch();
      const anchorKey=oldMatch?rowKey(rows[oldMatch.index]):null;
      const anchor=anchorKey?{key:anchorKey,start:oldMatch.start,end:oldMatch.end}:null;
      const query=el('find-query').value.trim(),submitted=findSubmitted && findQuery===query;
      ++findVersion;finding=false;findGroups=[];findTotal=0;findCursor=-1;
      if(savedReference){
        const resolved=root.DeskEvidencePreparation.resolve(savedReference,result.home_namespace,thread,textFor);
        el('response').textContent=resolved.available?'The saved reviewed excerpt is still at this exact native item and span.':
          `Saved reviewed excerpt retained. Fresh original: ${resolved.status}. No other item or occurrence is used as its replacement.`;
      }
      source=thread;rows=flatten(thread);
      const first=view.anchor?.key || view.first,index=first?rows.findIndex(row=>rowKey(row)===first):-1;
      page=index>=0?Math.floor(index/PAGE_ENTRIES):Math.min(view.page,Math.max(0,Math.ceil(rows.length/PAGE_ENTRIES)-1));
      targetIndex=typeof requested.turn_id==='string' && typeof requested.item_id==='string'
        ? rows.findIndex(row=>row.item && row.turn.id===requested.turn_id && row.item.id===requested.item_id):-1;
      el('title').textContent=(str(thread.name)||str(thread.title)||str(thread.preview)||'Original Codex conversation').slice(0,240);
      el('binding').textContent='Thread '+thread.id+'\n'+(str(thread.cwd)||'Working directory unreported')+
        (str(thread.modelProvider)?'\nProvider: '+thread.modelProvider:'');
      el('status').textContent=index<0 && first?'Original refreshed. The previously visible item is no longer present; a readable page is shown.':'Original refreshed. Your selected task and draft stay unchanged.';
      if(targetIndex<0 && requested.item_id)el('match').textContent='The requested native turn/item is not present in this refreshed original. You can still read the conversation.';
      else if(targetIndex>=0){const row=rows[targetIndex],phrase=str(requested.match_text);
        el('match').textContent=!visibleTypes.has(row.item.type)?'The requested item has no supported readable text. You can still read the conversation.':
          phrase && (Number.isInteger(requested.match_start)?textFor(row.item).slice(requested.match_start,requested.match_start+phrase.length)!==phrase:!textFor(row.item).includes(phrase))?'The saved phrase is no longer at its captured location in this original native item. You can still read the conversation.':'Showing the matching original native turn and item.';}
      el('error').hidden=el('retry').hidden=true;render(false,view);preserveChrome(()=>findControls(),ticket);
      if(submitted && query)await refreshFind(query,anchor,ticket);
      return true;
    }catch(error){
      if(request===refreshVersion && current(ticket)){
        preserveChrome(()=>{
          const outer=el('').scrollTop;
          el('status').textContent='Refresh failed. The last successfully read original stays available.';
          el('error').textContent=error.message;el('error').hidden=false;el('retry').hidden=false;
          el('').scrollTop=outer;
        },ticket);
      }
      return false;
    }finally{if(request===refreshVersion)preserveChrome(()=>{refreshing=false;el('retry').disabled=false;refreshControls();},ticket);}
  }
  async function read() {
    const preloaded=options?.preloadedThread || null;
    if(loading || !requested || !available())return false;
    const ticket=++version;loading=true;source=null;rows=[];
    resetFind();refreshControls();resetNativeIdCopy();el('find-query').value=str(requested.match_text);
    el('body').replaceChildren();el('body').setAttribute('aria-busy','true');
    el('status').textContent='Reading original native conversation…';
    el('error').hidden=true;el('retry').hidden=true;el('match').textContent='';el('coverage').textContent='';
    el('previous').hidden=el('next').hidden=true;el('original').hidden=true;unavailableThread=null;
    try {
      let thread=preloaded;
      if(!thread && options?.taskResponse){
        const result=await api('/api/native/task-response?thread='+encodeURIComponent(requested.thread_id)+'&turn='+encodeURIComponent(requested.turn_id));
        if(!current(ticket)){if(ticket===version && el('').open)close();return false;}
        const response=result?.response;thread=result?.thread;
        if(!thread || thread.id!==requested.thread_id || !Array.isArray(thread.turns) || !response || response.thread_id!==requested.thread_id || response.turn_id!==requested.turn_id)throw Error('The task response read did not match the captured native turn.');
        el('response').hidden=false;
        el('response').textContent=`Task response · ${str(response.label)||'Unavailable'} · Phase: ${str(response.phase)||'unreported'}\nThread ${requested.thread_id} · Turn ${requested.turn_id}\nNative turn status at read: ${str(response.turn_status)||'unreported'} · Source: ${str(response.source)||'native history read'}`;
        if(response.available!==true){
          if(!['turn_unavailable','response_unavailable'].includes(response.status))throw Error('The task response read returned an unknown selection.');
          unavailableThread=thread;delete requested.item_id;
          el('status').textContent=response.status==='turn_unavailable'?'The captured native turn is not present in this original read.':'No readable assistant response was supplied for this captured native turn.';
          el('match').textContent='No other turn is used as a replacement. You can choose to read the original conversation.';
          el('original').hidden=false;return false;
        }
        if(typeof response.item_id!=='string' || !response.item_id.trim())throw Error('The native response item identity is unavailable.');
        const turn=thread.turns.find(turn=>turn?.id===requested.turn_id),item=turn?.items?.find(item=>item?.id===response.item_id);
        if(item?.type!=='agentMessage' || typeof item.text!=='string' || !item.text.trim())throw Error('The selected response is not present in the captured native turn.');
        requested.item_id=response.item_id;
      }else if(!thread)thread=typeof options?.loadOriginal==='function'?await options.loadOriginal():await api('/api/native/thread?id='+encodeURIComponent(requested.thread_id));
      if(!current(ticket)){if(ticket===version && el('').open)close();return false;}
      if(!thread || thread.id!==requested.thread_id || !Array.isArray(thread.turns))throw new Error('The original native read did not return this conversation.');
      source=thread;rows=flatten(thread);
      el('title').textContent=(str(thread.name)||str(thread.title)||str(thread.preview)||'Original Codex conversation').slice(0,240);
      el('binding').textContent='Thread '+thread.id+'\n'+(str(thread.cwd)||'Working directory unreported')+
        (str(thread.modelProvider)?'\nProvider: '+thread.modelProvider:'');
      el('status').textContent='Read-only original conversation. Your selected task and draft stay unchanged.';
      const hasIdentity=typeof requested.turn_id==='string' && typeof requested.item_id==='string';
      targetIndex=hasIdentity?rows.findIndex(row=>row.item && row.turn.id===requested.turn_id && row.item.id===requested.item_id):-1;
      page=targetIndex>=0?Math.floor(targetIndex/PAGE_ENTRIES):options?.startAtEnd?Math.max(0,Math.ceil(rows.length/PAGE_ENTRIES)-1):0;
      if(hasIdentity && targetIndex<0)el('match').textContent='The requested native turn/item is not present in this original read. You can still read the conversation.';
      else if(targetIndex>=0) {
        const row=rows[targetIndex],phrase=str(requested.match_text);
        el('match').textContent=!visibleTypes.has(row.item.type)?'The requested item has no supported readable text. You can still read the conversation.':
          phrase && (Number.isInteger(requested.match_start)?textFor(row.item).slice(requested.match_start,requested.match_start+phrase.length)!==phrase:!textFor(row.item).includes(phrase))?'The saved phrase is no longer at its captured location in this original native item. You can still read the conversation.':
          'Showing the matching original native turn and item.';
      } else el('match').textContent='Original native history, without opening or resuming a task.';
      render();return true;
    } catch(error) {
      if(!current(ticket)){if(ticket===version && el('').open)close();return false;}
      el('status').textContent=options?.taskResponse?'The captured task response could not be read. Retry keeps this same native thread and turn.':'The original conversation could not be read.';
      el('error').textContent=error.message;el('error').hidden=false;el('retry').hidden=false;
      return false;
    } finally {
      if(ticket===version){loading=false;el('body').setAttribute('aria-busy','false');el('retry').disabled=false;findControls();refreshControls();nativeIdCopyControls();}
    }
  }
  async function show(result,callbacks={}) {
    if(!api)throw new Error('Native history reader is not configured.');
    if(callbacks.valid && !callbacks.valid())return false;
    ++version;++refreshVersion;refreshing=false;loading=false;source=null;rows=[];targetIndex=-1;taskReview=null;taskControls();refreshControls();resetNativeIdCopy();
    resetFind();
    requested={...result};options=callbacks;unavailableThread=null;el('response').hidden=true;el('response').textContent='';el('original').hidden=true;el('saved-evidence').hidden=true;el('saved-evidence-quote').textContent='';
    if(callbacks.savedReference){
      const saved=callbacks.savedReference,resolution=callbacks.resolution;
      el('saved-evidence').hidden=false;el('saved-evidence').open=false;
      el('saved-evidence-quote').textContent=str(saved.quote);
      el('saved-evidence-identity').textContent=`Thread ${str(saved.thread_id)} · Turn ${str(saved.turn_id)} · Item ${str(saved.item_id)}\nCaptured ${str(saved.source_kind)} · Phase ${str(saved.phase)||'unreported'} · Native turn ${str(saved.turn_status)||'unreported'}`;
      el('response').hidden=false;
      el('response').textContent=resolution?.available?'The saved reviewed excerpt is still at this exact native item and span.':
        `Saved reviewed excerpt retained. Fresh original: ${str(resolution?.status)||'unavailable'}. No other item or occurrence is used as its replacement.`;
    }
    el('back').textContent=callbacks.backLabel || 'Back to search';
    el('title').textContent='Original Codex conversation';
    el('binding').textContent='Thread '+str(result.thread_id)+(callbacks.taskResponse?'\nTurn '+str(result.turn_id):'')+(str(result.cwd)?'\n'+result.cwd:'');
    if(!el('').open)el('').showModal();
    if(typeof result.thread_id!=='string' || !result.thread_id.trim() || result.thread_id.length>200) {
      el('body').replaceChildren();el('body').setAttribute('aria-busy','false');
      el('status').textContent='An original native thread is required.';
      el('match').textContent='';el('coverage').textContent='';
      el('error').hidden=el('retry').hidden=el('previous').hidden=el('next').hidden=true;return false;
    }
    return read();
  }
  function taskControls() {
    const active=!!taskReview && !!source;
    if(el('task-return'))el('task-return').hidden=!active || taskReview.mode!=='item';
    if(el('task-instructions-return'))el('task-instructions-return').hidden=!active || taskReview.mode==='instructions' || taskReview.instructionSearch?.submitted==null;
    if(el('task-passage'))el('task-passage').hidden=!active;
    if(el('task-status')){
      el('task-status').hidden=!active;
      el('task-status').textContent=active?(taskReview.mode==='instructions'?'Supplied user instructions in this loaded original':taskReview.itemLabel || 'Native task context · Turn '+str(taskReview.capture.turn_id)):'';
    }
  }
  function taskSnapshot() {
    const occurrence=findMatch(),key=occurrence?rowKey(rows[occurrence.index]):null;
    const chrome={};for(const id of ['status','match','response','error','retry']){
      const element=el(id);chrome[id]={text:element.textContent,hidden:element.hidden};
    }
    return {source,refreshVersion,requested:{...requested},view:captureView(),page,targetIndex,chrome,
      find:{query:el('find-query').value,submitted:findSubmitted && !finding,queryAtSubmit:findQuery,
        groups:findGroups,total:findTotal,cursor:findCursor,message:finding?'Find canceled by task navigation. Choose Find to search this original.':el('find-status').textContent,
        anchor:key?{key,start:occurrence.start,end:occurrence.end}:null}};
  }
  function openTaskContext(capture,{instructionMatch=null}={}) {
    if(!root.DeskHistoryTasks || !source || !available())return false;
    const task=capture.item_id?root.DeskHistoryTasks.containing(source,capture):
      root.DeskHistoryTasks.list(source,capture.thread_id).find(task=>task.turn_id===capture.turn_id && task.available);
    if(!task?.available)throw Error('The captured native task or item is not supplied by this original read.');
    if(!taskReview)taskReview={passage:taskSnapshot(),capture:null,mode:'context',contextView:null};
    ++findVersion;finding=false;findSubmitted=false;findGroups=[];findTotal=0;findCursor=-1;
    taskReview.capture={thread_id:task.thread_id,turn_id:task.turn_id};taskReview.mode='context';
    taskReview.contextView=null;taskReview.message='';taskReview.itemLabel='';taskReview.instructionTarget=instructionMatch;
    findControls();render();return true;
  }
  function taskButton(label,action,callback,disabled=false) {
    const button=node('button',label);button.type='button';button.dataset.taskAction=action;
    button.disabled=disabled;button.onclick=callback;return button;
  }
  function instructionSearchState() {
    if(!taskReview)return null;
    return taskReview.instructionSearch ||= {query:'',submitted:null,offset:0,result:null,source:null,view:null,chosen:null,notice:''};
  }
  function suppliedInstructionText(item) {return textFor(item).slice('User\n'.length);}
  function instructionMatchKey(item) {return JSON.stringify([item.thread_id,item.turn_id,item.item_id]);}
  function instructionSearchResult(search) {
    if(search.submitted===null)return null;
    if(search.source!==source){
      search.result=root.DeskHistoryTasks.search(source,source.id,search.submitted,suppliedInstructionText);search.source=source;
      search.offset=Math.min(search.offset,Math.max(0,Math.floor((search.result.matches.length-1)/20)*20));
      search.notice='The last submitted phrase was searched in the refreshed original. Entered text is unchanged.';
    }
    return search.result;
  }
  function instructionSearchForm(search,ticket) {
    const review=taskReview,form=node('form',undefined,'history-reader-instruction-search');form.setAttribute('role','search');
    const label=node('label','Jump to supplied user instruction');label.htmlFor='history-reader-instruction-query';
    const field=node('input');field.id='history-reader-instruction-query';field.type='search';field.maxLength=200;field.value=search.query;
    field.placeholder='A literal phrase from your supplied instruction';field.dataset.taskAction='instruction-query';
    field.setAttribute('aria-describedby','history-reader-instruction-search-info');
    const info=node('p','Search only supplied user-message text in this loaded original. Case and Unicode forms are normalized; punctuation is literal.','muted');
    info.id='history-reader-instruction-search-info';
    const submit=node('button','Find instructions');submit.type='submit';submit.dataset.taskAction='instruction-search';
    const inputs=node('div',undefined,'history-reader-find-input');inputs.append(field,submit);form.append(label,inputs,info);
    field.oninput=()=>{if(taskReview===review && current(ticket)){search.query=field.value;search.notice='Query changed. Choose Find instructions to search this original.';}};
    form.onsubmit=event=>{event.preventDefault();if(taskReview===review && current(ticket))submitInstructionSearch();};
    return form;
  }
  function submitInstructionSearch() {
    if(!taskReview || !source || !available())return false;
    const search=instructionSearchState(),query=search.query.trim(),view=captureView();
    if(!query || query.length>200 || !root.DeskHistoryFind.normalize(query)){
      search.notice='Enter 1–200 characters from a supplied user instruction.';
      taskReview.message=search.notice;render(false,view);el('instruction-query')?.focus();return false;
    }
    try{
      const result=root.DeskHistoryTasks.search(source,source.id,query,suppliedInstructionText);
      Object.assign(search,{submitted:query,result,source,offset:0,view:null,chosen:null,notice:''});
      taskReview.mode='instructions';taskReview.itemLabel='';taskReview.message='';
      ++findVersion;finding=false;findSubmitted=false;findGroups=[];findTotal=0;findCursor=-1;
      findControls();render();return true;
    }catch(error){taskReview.message=error.message;render(false,view);return false;}
  }
  function renderInstructionSearch(focus=true,view=null) {
    const review=taskReview,ticket=version,search=instructionSearchState(),body=el('body');
    if(!search || !current(ticket))return;
    body.replaceChildren();body.scrollTop=0;
    const panel=node('section',undefined,'history-reader-instruction-matches');
    panel.append(node('h3','Supplied user instruction matches'),instructionSearchForm(search,ticket));
    let result;
    try{result=instructionSearchResult(search);}catch(error){search.notice=error.message;}
    const matches=result?.matches || [],limit=20;
    const status=node('p',result?`${matches.length} supplied instruction${matches.length===1?'':'s'} · ${result.total} phrase occurrence${result.total===1?'':'s'} for “${search.submitted}”.`:'Enter a phrase, then choose Find instructions.','history-reader-instruction-match-status');
    status.setAttribute('role','status');status.tabIndex=-1;status.dataset.taskAction='instruction-results-status';panel.append(status);
    if(search.notice){const notice=node('p',search.notice,'muted');notice.setAttribute('role','status');panel.append(notice);}
    if(result && !matches.length)panel.append(node('p','No supplied user instruction matches this literal phrase in the loaded original.','muted'));
    for(const match of matches.slice(search.offset,search.offset+limit)){
      const article=node('article',undefined,'history-reader-instruction-match');article.dataset.instructionMatch=instructionMatchKey(match);
      article.append(node('p',`Task ${match.turn_index+1} · Turn ${match.turn_id}\nItem ${match.item_id}`,'history-reader-identity'));
      const span=match.spans.at(0);let start=Math.max(0,span.start-60),end=Math.min(match.text.length,span.end+100);
      if(start && /[\uDC00-\uDFFF]/.test(match.text[start]) && /[\uD800-\uDBFF]/.test(match.text[start-1]))--start;
      if(end<match.text.length && /[\uD800-\uDBFF]/.test(match.text[end-1]) && /[\uDC00-\uDFFF]/.test(match.text[end]))--end;
      const preview=node('pre',undefined,'history-reader-task-match-preview');
      markText(preview,match.text.slice(start,end),span.start-start,span.end-start);article.append(preview);
      const key=instructionMatchKey(match);
      article.append(taskButton('Read task for this instruction','instruction-match:'+key,()=>{
        if(taskReview===review && current(ticket))chooseInstructionMatch(match);
      }));panel.append(article);
    }
    const navigation=node('div',undefined,'actions history-reader-task-navigation');
    for(const [direction,label] of [[-1,'Previous instruction matches'],[1,'Next instruction matches']]){
      const next=search.offset+direction*limit;
      navigation.append(taskButton(label,direction<0?'instruction-matches-previous':'instruction-matches-next',()=>{
        if(taskReview!==review || !current(ticket))return;
        search.offset=next;search.view=null;renderInstructionSearch();
      },next<0 || next>=matches.length));
    }
    panel.append(navigation);body.append(panel);
    el('coverage').textContent=`Showing supplied instructions ${matches.length?search.offset+1:0}–${Math.min(matches.length,search.offset+limit)} of ${matches.length}. Up to ${limit} matching user-message items per page; this original only.`;
    el('previous').hidden=el('next').hidden=true;taskControls();
    if(view)restoreView(view,ticket);else if(focus){status.focus({preventScroll:true});el('').scrollTop=0;}
  }
  function chooseInstructionMatch(capture) {
    const review=taskReview;if(!review || !source || !available())return false;
    const search=instructionSearchState(),view=captureView();
    try{
      const result=instructionSearchResult(search),match=result?.matches.find(item=>instructionMatchKey(item)===instructionMatchKey(capture));
      if(!match)throw Error('This exact supplied instruction no longer matches the submitted phrase in this original.');
      const span=match.spans.at(0);
      search.view=view;search.chosen=instructionMatchKey(match);
      return openTaskContext(match,{instructionMatch:{item_id:match.item_id,start:span.start+'User\n'.length,end:span.end+'User\n'.length,text:match.text.slice(span.start,span.end)}});
    }catch(error){search.notice=error.message;review.mode='instructions';render(false,view);return false;}
  }
  function returnInstructionMatches() {
    if(!taskReview || !source || !available())return false;
    const search=instructionSearchState();if(search.submitted===null)return false;
    taskReview.mode='instructions';taskReview.itemLabel='';taskReview.message='';
    ++findVersion;finding=false;findSubmitted=false;findGroups=[];findTotal=0;findCursor=-1;
    findControls();render(false,search.view);return true;
  }
  function renderTaskContext(focus=true,view=null) {
    const review=taskReview,ticket=version,body=el('body');if(!review || !current(ticket))return;
    body.replaceChildren();body.scrollTop=0;
    const panel=node('section',undefined,'history-reader-task-context');panel.tabIndex=-1;
    panel.append(node('h3','Native task context'),node('p','Thread '+str(review.capture.thread_id)+'\nTurn '+str(review.capture.turn_id),'history-reader-identity'));
    panel.append(instructionSearchForm(instructionSearchState(),ticket));
    let instruction,matchedInstruction=null;
    try{instruction=root.DeskHistoryTasks.instructions(source,review.capture,textFor);}
    catch(error){instruction={available:false,status:'task_unavailable',items:[]};review.message=error.message;}
    panel.append(node('p','Native turn status: '+(str(instruction.turn_status)||'unreported')+' · Source: native history read','history-reader-task-outcome'));
    const turnError=typeof instruction.turn_error==='string'?instruction.turn_error:str(instruction.turn_error?.message);
    if(turnError)panel.append(node('p',turnError,'history-reader-turn-error'));
    if(!instruction.available)panel.append(node('p',instruction.status==='turn_unavailable' || instruction.status==='task_unavailable'
      ?'This captured native task is not available in the current original read.':
      instruction.user_message_count?'No readable, addressable user instruction was supplied for this task.':'No user instruction was supplied for this task.','muted'));
    for(const [index,item] of instruction.items.entries()) {
      const article=node('article',undefined,'history-reader-task-instruction');
      if(item.available && item.item_id===review.instructionTarget?.item_id){article.className+=' history-reader-target';article.tabIndex=-1;article.dataset.taskAction='matched-instruction:'+item.item_id;matchedInstruction=article;}
      article.append(node('h4','Supplied user instruction '+(index+1)),node('p','Item '+(str(item.item_id)||'unreported'),'history-reader-identity'));
      if(item.text){const preview=Array.from(item.text.slice(0,640)).slice(0,320).join('');
        article.append(node('pre',preview+(preview.length<item.text.length?'…':''),'history-reader-task-preview'));}
      if(!item.available)article.append(node('p',item.reason==='instruction_unavailable'?'No readable user text was supplied.':'This instruction has no unambiguous native item identity.','muted'));
      article.append(taskButton('Read full instruction','instruction:'+item.item_id,()=>readTaskItem('instruction',item.item_id),!item.available));panel.append(article);
    }
    const addressable=root.DeskHistoryTasks.list(source,review.capture.thread_id).some(task=>task.turn_id===review.capture.turn_id && task.available);
    panel.append(taskButton('Read this task response','response',()=>readTaskItem('response'),!addressable));
    const navigation=node('div',undefined,'actions history-reader-task-navigation');
    for(const [direction,label] of [[-1,'Previous task'],[1,'Next task']]) {
      const adjacent=addressable?root.DeskHistoryTasks.adjacent(source,review.capture,direction):null;
      navigation.append(taskButton(label,direction<0?'previous':'next',()=>openTaskContext(adjacent),!adjacent?.available));
      if(!adjacent)navigation.append(node('span',direction<0?'Start of supplied tasks.':'End of supplied tasks.','muted'));
      else if(!adjacent.available)navigation.append(node('span','Adjacent task has no unambiguous native identity.','muted'));
    }
    panel.append(navigation);
    if(review.message){const message=node('p',review.message,'history-reader-task-message');message.setAttribute('role','status');panel.append(message);}
    body.append(panel);el('coverage').textContent='Task context uses only this original read’s supplied turn and user-message items.';
    el('previous').hidden=el('next').hidden=true;taskControls();
    if(view)restoreView(view,ticket);
    else if(focus){el('').scrollTop=0;(matchedInstruction || panel).focus({preventScroll:true});matchedInstruction?.scrollIntoView?.({block:'center',behavior:'instant'});}
  }
  function readTaskItem(kind,itemId=null) {
    const review=taskReview;if(!review || !source || !available())return false;
    const view=captureView();let selection;
    try{
      if(kind==='response'){
        selection=root.DeskHistoryTasks.response(source,review.capture);
        if(!selection.available){review.message=selection.status==='turn_unavailable'?'The selected native task is not supplied in this original read.':'No readable assistant response was supplied for this task.';renderTaskContext(false,view);return false;}
      }else{
        const instruction=root.DeskHistoryTasks.instructions(source,review.capture,textFor);
        selection=instruction.items.find(item=>item.item_id===itemId && item.available);
        if(!selection)throw Error('The selected user instruction is not available in this task.');
      }
      const index=rows.findIndex(row=>row.item && row.turn.id===review.capture.turn_id && row.item.id===selection.item_id);
      if(index<0)throw Error('The captured native item is not available in this original read.');
      review.contextView=view;review.mode='item';review.message='';
      review.itemLabel=kind==='response'?`Selected task response · ${str(selection.label)} · Phase: ${str(selection.phase)||'unreported'}\nTurn ${review.capture.turn_id} · Native status at selection: ${str(selection.turn_status)||'unreported'} · Source: native history read`:
        'Supplied user instruction · Turn '+review.capture.turn_id;
      requested={thread_id:source.id,turn_id:review.capture.turn_id,item_id:selection.item_id};
      const match=kind==='instruction'?review.instructionTarget:null;
      if(match?.item_id===selection.item_id && textFor(rows[index].item).slice(match.start,match.end)===match.text){requested.match_text=match.text;requested.match_start=match.start;}
      targetIndex=index;page=Math.floor(index/PAGE_ENTRIES);
      ++findVersion;finding=false;findSubmitted=false;findGroups=[];findTotal=0;findCursor=-1;
      findControls();render();return true;
    }catch(error){review.message=error.message;renderTaskContext(false,view);return false;}
  }
  function returnTaskContext() {
    if(!taskReview || !source || !available())return false;
    ++findVersion;finding=false;findSubmitted=false;findGroups=[];findTotal=0;findCursor=-1;
    taskReview.mode='context';taskReview.itemLabel='';findControls();render(false,taskReview.contextView);return true;
  }
  async function returnTaskPassage() {
    if(!taskReview || !source || !available())return false;
    const snapshot=taskReview.passage,ticket=version,unchanged=source===snapshot.source;taskReview=null;taskControls();
    requested={...snapshot.requested};++findVersion;finding=false;
    targetIndex=rows.findIndex(row=>row.item && row.turn.id===requested.turn_id && row.item.id===requested.item_id);
    const anchor=snapshot.view.anchor?.key || snapshot.view.first,index=anchor?rows.findIndex(row=>rowKey(row)===anchor):-1;
    page=index>=0?Math.floor(index/PAGE_ENTRIES):Math.min(snapshot.page,Math.max(0,Math.ceil(rows.length/PAGE_ENTRIES)-1));
    el('find-query').value=snapshot.find.query;findSubmitted=snapshot.find.submitted;findQuery=snapshot.find.queryAtSubmit;
    findGroups=unchanged?snapshot.find.groups:[];findTotal=unchanged?snapshot.find.total:0;findCursor=unchanged?snapshot.find.cursor:-1;
    if(unchanged && refreshVersion===snapshot.refreshVersion){for(const [id,value] of Object.entries(snapshot.chrome)){el(id).textContent=value.text;el(id).hidden=value.hidden;}}
    else if(!unchanged){
      el('status').textContent=index<0 && anchor?'The original passage item is no longer supplied. Its captured source identity is retained.':'Returned to the original passage in the refreshed native read.';
      el('match').textContent=targetIndex<0 && requested.item_id?'The captured native turn/item is not present in this original read.':'';
    }
    findControls(unchanged?snapshot.find.message:undefined);render(false,snapshot.view);
    if(!unchanged && findSubmitted && findQuery===snapshot.find.query.trim() && findQuery)await refreshFind(findQuery,snapshot.find.anchor,ticket);
    return true;
  }
  function configure(value) {
    api=value.api;evidenceReview=value.onEvidence || null;
    if(el('copy-native-id')){el('copy-native-id').onclick=()=>copyNativeId();el('copy-native-id').onmousedown=event=>{if(event.button===0 && selectedText())event.preventDefault();};}
    el('back').onclick=el('close').onclick=()=>close();
    el('retry').onclick=()=>{el('retry').disabled=true;source?refresh():read();};
    el('original').onclick=()=>{if(!unavailableThread || !available())return;const thread=unavailableThread;options={...options,taskResponse:false,preloadedThread:thread};return read();};
    if(el('refresh'))el('refresh').onclick=refresh;
    if(el('task-return'))el('task-return').onclick=returnTaskContext;
    if(el('task-passage'))el('task-passage').onclick=returnTaskPassage;
    if(el('task-instructions-return'))el('task-instructions-return').onclick=returnInstructionMatches;
    el('previous').onclick=()=>movePage(-1);
    el('next').onclick=()=>movePage(1);
    el('find-form').onsubmit=event=>{event.preventDefault();submitFind();};
    el('find-previous').onclick=()=>jumpFind(-1);el('find-next').onclick=()=>jumpFind(1);
    el('find-query').oninput=()=>{
      ++findVersion;finding=false;findSubmitted=false;findGroups=[];findTotal=0;findCursor=-1;
      findControls('Query changed. Choose Find to search this original.');if(source && available())render(false,captureView());
    };
    el('').addEventListener('keydown',event=>{
      if(event.key!=='F3' || !el('').open || !source || loading || !el('').contains(event.target))return;
      event.preventDefault();
      if(taskReview && taskReview.mode!=='item')return;
      if(finding)return;
      if(findSubmitted && findQuery===el('find-query').value.trim() && findTotal)jumpFind(event.shiftKey?-1:1);
      else if(el('find-query').value.trim())submitFind(event.shiftKey?-1:1);
      else el('find-query').focus();
    });
    el('').addEventListener('close',()=>{if(!el('').open)invalidate();});
  }
  root.DeskHistoryReader={configure,show,close,textForItem:textFor};
})(typeof globalThis==='undefined'?this:globalThis);
