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

  function current(ticket) {
    return ticket===version && el('').open && (!options?.valid || options.valid());
  }
  function invalidate() {
    ++version;++refreshVersion;refreshing=false;const callback=options?.onReturn;
    options=null;source=null;requested=null;rows=[];loading=false;targetIndex=-1;unavailableThread=null;
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
    const parentSource=source,parentRequested={...requested},parentOptions=options,view=captureView();
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
  function textPoint(pre,offset){
    if(offset<0)return null;
    const walker=document.createTreeWalker(pre,NodeFilter.SHOW_TEXT);let node;
    while((node=walker.nextNode())){if(offset<=node.data.length)return {node,offset};offset-=node.data.length;}
    return null;
  }
  function restoreSelectedText(saved){
    if(!saved)return;
    const row=rows.find(row=>rowKey(row)===saved.key),item=viewItems().find(item=>elementKey(item)===saved.key);
    const pre=item?.querySelector('.history-reader-text'),start=saved.start-(Number(item?.dataset.windowStart)||0);
    const end=saved.end-(Number(item?.dataset.windowStart)||0);
    const first=pre?textPoint(pre,start):null,last=pre?textPoint(pre,end):null;
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
    return {items,anchor,focus,selection:selectedText(),scroll:body.scrollTop,outer:el('').scrollTop,page,first:rowKey(rows[page*PAGE_ENTRIES])};
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
      const result=savedReference?await api('/api/native/evidence-source?home='+encodeURIComponent(savedReference.native_home)+'&thread='+encodeURIComponent(requested.thread_id)):
        await api('/api/native/thread?id='+encodeURIComponent(requested.thread_id));
      if(savedReference && result.home_namespace!==savedReference.native_home)throw Error('The original native home does not match this saved evidence.');
      const thread=savedReference?result.thread:result;
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
    resetFind();refreshControls();el('find-query').value=str(requested.match_text);
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
      }else if(!thread)thread=await api('/api/native/thread?id='+encodeURIComponent(requested.thread_id));
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
      if(ticket===version){loading=false;el('body').setAttribute('aria-busy','false');el('retry').disabled=false;findControls();refreshControls();}
    }
  }
  async function show(result,callbacks={}) {
    if(!api)throw new Error('Native history reader is not configured.');
    if(callbacks.valid && !callbacks.valid())return false;
    ++version;++refreshVersion;refreshing=false;loading=false;source=null;rows=[];targetIndex=-1;refreshControls();
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
  function configure(value) {
    api=value.api;evidenceReview=value.onEvidence || null;
    el('back').onclick=el('close').onclick=()=>close();
    el('retry').onclick=()=>{el('retry').disabled=true;source?refresh():read();};
    el('original').onclick=()=>{if(!unavailableThread || !available())return;const thread=unavailableThread;options={...options,taskResponse:false,preloadedThread:thread};return read();};
    if(el('refresh'))el('refresh').onclick=refresh;
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
      if(finding)return;
      if(findSubmitted && findQuery===el('find-query').value.trim() && findTotal)jumpFind(event.shiftKey?-1:1);
      else if(el('find-query').value.trim())submitFind(event.shiftKey?-1:1);
      else el('find-query').focus();
    });
    el('').addEventListener('close',()=>{if(!el('').open)invalidate();});
  }
  root.DeskHistoryReader={configure,show,close,textForItem:textFor};
})(typeof globalThis==='undefined'?this:globalThis);
