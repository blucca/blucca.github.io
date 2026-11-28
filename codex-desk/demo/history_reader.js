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
  let findMatches=null;
  const FIND_MATCH_PAGE=20;
  let readingHome=null,readingStorage=null,readingRestoreEpoch=0,readingIntentEpoch=0,readingUnavailable=false,readingCharacterNotice=null;
  let originalFrontier=null,frontierStorage=null;

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
  function originalFrontierControls() {
    const panel=el('new-material'),button=el('first-new');if(!panel || !button)return;
    if(!root.DeskOriginalFrontier){panel.hidden=true;button.hidden=true;button.disabled=true;return;}
    const result=originalFrontier?.result;
    panel.hidden=!result || ['first_read','unchanged'].includes(result.status);
    button.hidden=result?.status!=='new_items';
    button.disabled=!result?.target || loading || refreshing || !!taskReview || !current(version);
    const messages={previous_snapshot_unavailable:'Previous fresh original read snapshot unavailable in this browser.',
      previous_boundary_unavailable:'Previous fresh original read boundary unavailable in this source.',
      previous_boundary_ambiguous:'Previous fresh original read boundary ambiguous in this source.',
      previous_boundary_changed:'Previous fresh original read boundary changed position in this source.',
      new_item_unavailable:'The first newly supplied native item identity is unavailable.',
      new_item_ambiguous:'The first newly supplied native item identity is ambiguous.',
      source_unavailable:'New supplied-item boundary unavailable in this source.',
      home_unavailable:'The captured original native home changed.'};
    el('new-status').textContent=result?.status==='new_items'
      ? `New since previous fresh original read · ${result.count} newly supplied native item${result.count===1?'':'s'}.`
      : messages[result?.status] || '';
  }
  function captureOriginalFrontier(ticket) {
    if(!root.DeskOriginalFrontier || !source || !readingHome || !current(ticket))return;
    if(!originalFrontier && explicitReadingTarget())return;
    const owner={native_home:readingHome,thread_id:source.id};
    if(originalFrontier && (originalFrontier.owner.native_home!==owner.native_home || originalFrontier.owner.thread_id!==owner.thread_id)){
      originalFrontier.result={status:'home_unavailable',target:null,count:0};originalFrontierControls();return;
    }
    if(!frontierStorage)try{frontierStorage=root.DeskOriginalFrontier.create(root.localStorage);}catch{return;}
    if(!originalFrontier){let previous;try{previous=frontierStorage.get(owner);}catch{previous={};}
      originalFrontier={owner,previous,result:null,committed:null};}
    originalFrontier.result=root.DeskOriginalFrontier.resolve(originalFrontier.previous,source);
    if(originalFrontier.committed!==source)try{
      frontierStorage.put(owner,root.DeskOriginalFrontier.snapshot(source));originalFrontier.committed=source;
    }catch{}
    originalFrontierControls();
  }
  function resetOriginalFrontier() {originalFrontier=null;originalFrontierControls();}
  function readFirstNewOriginalItem() {
    if(!source || loading || refreshing || taskReview || !available() || originalFrontier?.result?.status!=='new_items')return false;
    const target=originalFrontier.result.target;
    const resolved=root.DeskOriginalFrontier.resolve(originalFrontier.previous,source);
    if(resolved.status!=='new_items' || resolved.target.turn_id!==target.turn_id || resolved.target.item_id!==target.item_id){
      originalFrontier.result=resolved;originalFrontierControls();return false;}
    const index=rows.findIndex(row=>row.item && row.turn.id===target.turn_id && row.item.id===target.item_id);
    if(index<0)return false;
    taskReview={passage:taskSnapshot(),capture:{thread_id:source.id,turn_id:target.turn_id},mode:'item',contextView:null,
      itemLabel:'New since previous fresh original read · Turn '+target.turn_id,message:''};
    requested={thread_id:source.id,turn_id:target.turn_id,item_id:target.item_id};targetIndex=index;page=Math.floor(index/PAGE_ENTRIES);
    ++findVersion;finding=false;findSubmitted=false;findQuery='';findGroups=[];findTotal=0;findCursor=-1;
    el('find-query').value='';findControls();render();return true;
  }
  function originalReadingStore() {
    if(!readingStorage && root.DeskReadingCheckpoint)try{readingStorage=root.DeskReadingCheckpoint.createOriginal(root.localStorage);}catch{return null;}
    return readingStorage;
  }
  function explicitReadingTarget() {
    return !!(requested?.turn_id || requested?.item_id || requested?.match_text || options?.taskResponse || options?.savedReference);
  }
  function commandOutputStart(item) {
    if(item?.type!=='commandExecution' || typeof item.aggregatedOutput!=='string')return null;
    return textFor({...item,aggregatedOutput:''}).length;
  }
  function outputPosition(at,before,after) {
    return Number.isSafeInteger(at) && at>=before?at+after-before:at;
  }
  function outputSpan(span,before,after) {
    if(!span || !Number.isSafeInteger(before) || !Number.isSafeInteger(after) || span.start<before)return span;
    return {...span,start:outputPosition(span.start,before,after),end:outputPosition(span.end,before,after)};
  }
  function resizeOriginalCharacters(before,current) {
    const items=new Map(Array.from(current.items,([key,saved])=>{
      const prior=before.items.get(key);
      return [key,prior?.character && prior.start===saved.start && prior.open===saved.open
        ?{...saved,character:prior.character}:saved];
    }));
    const at=before.anchor?.key,prior=at?before.items.get(at):null;
    return {...current,items,...(prior?.character && items.get(at)?.character===prior.character?{anchor:before.anchor}:{})};
  }
  function mapOutputAnchor(span,view,fresh) {
    if(!span)return span;
    const matches=fresh.filter(row=>rowKey(row)===span.key);
    return matches.length===1?outputSpan(span,view.items.get(span.key)?.commandOutputStart,commandOutputStart(matches[0].item)):span;
  }
  function mapOriginalOutput(view,fresh) {
    // Follow native output positions, not the mutable generated Status/Exit prefix.
    // Existing v1 evidence references retain their literal projection/span rules.
    const supplied=new Map();
    for(const row of fresh){const key=rowKey(row);if(key)supplied.set(key,supplied.has(key)?null:row);}
    let selection=view.selection;
    const items=new Map(Array.from(view.items,([key,saved])=>{
      const after=commandOutputStart(supplied.get(key)?.item),before=saved.commandOutputStart;
      if(after===null || !Number.isSafeInteger(before))return [key,saved];
      if(selection?.key===key)selection=outputSpan(selection,before,after);
      return [key,{...saved,commandOutputStart:after,start:outputPosition(saved.start,before,after),
        ...(saved.character?{character:{...saved.character,offset:outputPosition(saved.character.offset,before,after)}}:{})}];
    }));
    return {...view,items,...(view.selection?{selection}:{})};
  }
  function saveOriginalReading() {
    if(!source || loading || readingUnavailable || (readingCharacterNotice?.intent===readingIntentEpoch) || !readingHome || explicitReadingTarget() || (options?.valid && !options.valid()))return;
    const view=taskReview?.passage?.view || (findMatches?.active?findMatches.passageView:null) || captureView();
    if(!view.anchor)return;
    try{
      const identity=key=>{const [turn_id,item_id]=JSON.parse(key);return {turn_id,item_id};};
      originalReadingStore()?.put({native_home:readingHome,thread_id:source.id},{latest:false,
        anchor:{...identity(view.anchor.key),offset:view.anchor.offset,screen_top:view.anchor.screenTop},
        window_scroll:{top:view.outer,left:view.outerLeft || 0},reader_scroll:{top:view.scroll,left:view.scrollLeft || 0},
        item_views:Array.from(view.items,([key,row])=>({...identity(key),open:row.open,window_start:row.start,scroll_top:row.scroll,scroll_left:row.left || 0,
          ...(row.character?{visible_character:row.character}:{}),
          ...(Number.isSafeInteger(row.commandOutputStart)?{command_output_start:row.commandOutputStart}:{})})),turn_views:[]});
    }catch{}
  }
  function originalReadingView() {
    if(!readingHome || explicitReadingTarget())return null;
    const owner={native_home:readingHome,thread_id:source.id},catalog={...owner,turn_ids:source.turns.map(turn=>turn?.id),
      items:rows.filter(row=>row.item).map(row=>({turn_id:row.turn.id,item_id:row.item.id}))};
    let resolved;try{resolved=originalReadingStore()?.restore(owner,catalog);}catch{return null;}
    if(!resolved || resolved.status==='checkpoint_missing')return null;
    if(!resolved.available){readingUnavailable=true;el('status').textContent='Previous original reading place unavailable in this fresh native read.';return null;}
    const saved=resolved.view,key=JSON.stringify([saved.anchor.turn_id,saved.anchor.item_id]);
    const index=rows.findIndex(row=>rowKey(row)===key);page=Math.floor(index/PAGE_ENTRIES);
    return mapOriginalOutput({items:new Map(saved.item_views.map(row=>[JSON.stringify([row.turn_id,row.item_id]),
      {start:row.window_start,open:row.open,scroll:row.scroll_top,left:row.scroll_left,
        ...(row.visible_character?{character:row.visible_character}:{}),
        ...(Number.isSafeInteger(row.command_output_start)?{commandOutputStart:row.command_output_start}:{})}])),
      anchor:{key,offset:saved.anchor.offset,screenTop:saved.anchor.screen_top},scroll:saved.reader_scroll.top,scrollLeft:saved.reader_scroll.left,
      outer:saved.window_scroll.top,outerLeft:saved.window_scroll.left,page},rows);
  }
  function settleOriginalReading(view,ticket) {
    // Keep source availability independent of metadata lookup, and finish
    // geometry only while the original read and the user's intent still own it.
    const readingEpoch=readingRestoreEpoch,findEpoch=findVersion;
    root.requestAnimationFrame?.(()=>{
      if(current(ticket) && readingEpoch===readingRestoreEpoch && findEpoch===findVersion)restoreView(view,ticket);});
  }
  function invalidate() {
    saveOriginalReading();readingHome=null;readingUnavailable=false;readingCharacterNotice=null;++readingRestoreEpoch;resetOriginalFrontier();
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
    saveOriginalReading();
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
    const ready=!!source && !loading && el('').open && (!taskReview || taskReview.mode==='item' || taskReview.mode==='evidence');
    el('find-form').hidden=!ready;el('find-query').disabled=!ready;
    el('find-submit').disabled=!ready || finding;
    el('find-previous').disabled=el('find-next').disabled=!ready || finding || findTotal===0;
    el('find-form').setAttribute('aria-busy',String(finding));
    if(message!==undefined)el('find-status').textContent=message;
    else if(finding)el('find-status').textContent=taskEvidenceScoped()?'Finding matches in this task’s supplied evidence…':'Finding matches in the complete original text…';
    else if(findTotal)el('find-status').textContent=findCursor>=0
      ? `Match ${findCursor+1} of ${findTotal}. Previous/Next match or Shift+F3/F3 moves through ${taskEvidenceScoped()?'this task’s supplied evidence':'this original'}.`
      : `${findTotal} matches. Choose Previous/Next match to jump to an occurrence.`;
    else el('find-status').textContent=findSubmitted
      ? taskEvidenceScoped()?'No matches in this task’s supplied readable evidence for this phrase.':'No matches in the readable original text for this phrase.'
      : taskEvidenceScoped()?'Search only this exact task’s supplied readable items, including complete text windows.':'Search the complete readable text in this original, including other item pages and text windows.';
    taskEvidenceFindControls();findMatchesControls();
  }
  function resetFind() {
    resetFindMatches();
    ++findVersion;finding=false;findSubmitted=false;findQuery='';findGroups=[];findTotal=0;findCursor=-1;
    el('find-query').value='';findControls();
  }
  function manualFindNavigation() {
    readingUnavailable=false;findCursor=-1;
    if(finding){++findVersion;finding=false;findSubmitted=false;findGroups=[];findTotal=0;
      findControls('Find canceled by navigation. Choose Find to search this original.');}
    else findControls();
  }
  function findMatch() {return root.DeskHistoryFind.occurrence(findGroups,findCursor);}
  function findMatchesValid() {
    return !!findMatches && findMatches.source===source && findMatches.groups===findGroups &&
      findMatches.query===findQuery && findSubmitted && !finding && findTotal>0 &&
      el('find-query').value.trim()===findQuery && current(version) && (!taskReview || taskReview.mode==='item' || taskReview.mode==='evidence');
  }
  function findMatchesControls() {
    const show=el('find-matches-show'),back=el('find-matches-return'),panel=el('find-matches');if(!show || !panel)return;
    const ready=!!source && !loading && current(version) && (!taskReview || taskReview.mode==='item' || taskReview.mode==='evidence');
    show.hidden=!ready || !findSubmitted;show.disabled=!ready || finding || !findTotal || el('find-query').value.trim()!==findQuery;
    const valid=findMatchesValid();panel.hidden=!valid || !findMatches.active;
    if(back){back.hidden=!valid || findMatches.active;back.disabled=!valid;}
  }
  function resetFindMatches() {
    findMatches=null;const panel=el('find-matches');if(panel)panel.hidden=true;
    el('find-match-list')?.replaceChildren();if(el('find-matches-return'))el('find-matches-return').hidden=true;
  }
  function matchListView() {
    const active=document.activeElement;
    return {scroll:el('find-match-list').scrollTop,outer:el('').scrollTop,
      action:active?.dataset.findAction || null};
  }
  function restoreMatchList(view) {
    if(!view)return;el('find-match-list').scrollTop=view.scroll;el('').scrollTop=view.outer;
    const target=Array.from(el('find-matches').querySelectorAll('[data-find-action]')).find(n=>n.dataset.findAction===view.action);
    if(target && !target.disabled)target.focus({preventScroll:true});
  }
  function renewFindMatches(previous,active=false) {
    if(!previous || !findSubmitted || !findTotal || previous.query!==findQuery)return null;
    return {source,groups:findGroups,query:findQuery,offset:Math.min(previous.offset,Math.floor((findTotal-1)/FIND_MATCH_PAGE)*FIND_MATCH_PAGE),
      active,chosen:findCursor,passageView:captureView(),view:null};
  }
  function showFindMatches() {
    if(!source || !available() || finding || !findSubmitted || !findTotal || el('find-query').value.trim()!==findQuery || (taskReview && !['item','evidence'].includes(taskReview.mode)))return false;
    if(!findMatchesValid())findMatches={source,groups:findGroups,query:findQuery,
      offset:Math.floor(Math.max(0,findCursor)/FIND_MATCH_PAGE)*FIND_MATCH_PAGE,active:false,chosen:findCursor,view:null};
    findMatches.passageView=captureView();findMatches.active=true;renderFindMatches();return true;
  }
  function dismissFindMatches() {
    if(!findMatchesValid())return false;
    findMatches.view=matchListView();findMatches.active=false;findMatchesControls();
    restoreView(findMatches.passageView,version);el('find-matches-show').focus({preventScroll:true});return true;
  }
  function renderFindMatches() {
    if(!findMatchesValid() || !findMatches.active)return;
    const state=findMatches,ticket=version,epoch=findVersion,list=el('find-match-list');list.replaceChildren();
    const valid=()=>findMatches===state && findMatchesValid() && current(ticket) && epoch===findVersion;
    const last=Math.min(findTotal,state.offset+FIND_MATCH_PAGE);
    el('find-matches-status').textContent=`Showing Find matches ${state.offset+1}–${last} of ${findTotal} for “${findQuery}”. ${taskEvidenceScoped()?'This task’s supplied evidence only.':'This supplied original only.'}`;
    for(let cursor=state.offset;cursor<last;cursor++) {
      const hit=root.DeskHistoryFind.occurrence(findGroups,cursor),row=rows[hit.index],text=textFor(row.item);
      const article=node('article',undefined,'history-reader-find-match');article.dataset.matchIndex=String(cursor);
      article.dataset.turnId=str(row.turn.id);article.dataset.itemId=str(row.item.id);
      article.dataset.matchStart=String(hit.start);article.dataset.matchEnd=String(hit.end);
      article.append(node('p',`Match ${cursor+1} · ${labels[row.item.type] || 'Native item'} · Occurrence ${hit.occurrence} of ${hit.item_total} in this item
Turn ${str(row.turn.id)||'unreported'} · Item ${str(row.item.id)||'unreported'}
Text characters ${hit.start+1}–${hit.end}`,'history-reader-identity'));
      let start=Math.max(0,hit.start-60),end=Math.min(text.length,hit.end+100);
      if(start && /[\uDC00-\uDFFF]/.test(text[start]) && /[\uD800-\uDBFF]/.test(text[start-1]))--start;
      if(end<text.length && /[\uD800-\uDBFF]/.test(text[end-1]) && /[\uDC00-\uDFFF]/.test(text[end]))--end;
      const preview=node('pre',undefined,'history-reader-task-match-preview');markText(preview,text.slice(start,end),hit.start-start,hit.end-start);article.append(preview);
      const button=node('button',`Read match ${cursor+1}`);button.type='button';button.dataset.findAction='match:'+cursor;
      button.onclick=()=>{if(!valid())return;state.view=matchListView();state.chosen=cursor;state.active=false;findMatchesControls();jumpFind(1,cursor);};
      article.append(button);list.append(article);
    }
    for(const [direction,id] of [[-1,'find-matches-previous'],[1,'find-matches-next']]){
      const button=el(id),next=state.offset+direction*FIND_MATCH_PAGE;button.disabled=next<0 || next>=findTotal;
      button.onclick=()=>{if(!valid())return;state.offset=next;state.view=null;renderFindMatches();};
    }
    findMatchesControls();
    if(state.view)restoreMatchList(state.view);
    else{list.scrollTop=0;el('find-matches-status').focus({preventScroll:true});el('find-matches').scrollIntoView({block:'start',behavior:'instant'});}
  }
  function jumpFind(direction=1,cursor=null) {
    readingUnavailable=false;
    if(!source || !available() || finding || !findTotal)return;
    if(cursor!==null){if(!Number.isSafeInteger(cursor) || cursor<0 || cursor>=findTotal)return;findCursor=cursor;}
    else if(findCursor<0){
      const group=direction>0?findGroups.find(group=>group.index>=page*PAGE_ENTRIES)
        :findGroups.findLast(group=>group.index<(page+1)*PAGE_ENTRIES);
      findCursor=group?group.first+(direction>0?0:group.spans.length-1):(direction>0?0:findTotal-1);
    } else findCursor=(findCursor+direction+findTotal)%findTotal;
    ++readingIntentEpoch;
    if(findMatches?.active){findMatches.view=matchListView();findMatches.active=false;}
    if(taskReview?.mode==='evidence'){taskReview.evidence.view=captureView();taskReview.mode='item';taskReview.evidenceItem=true;}
    page=Math.floor(findMatch().index/PAGE_ENTRIES);findControls();render();
  }
  async function submitFind(direction=1) {
    if(!source || loading || !available())return;
    const query=el('find-query').value.trim();
    if(query.length<1 || query.length>200){findControls('Enter 1–200 characters to find in this original.');el('find-query').focus();return;}
    resetFindMatches();
    const ticket=version,search=++findVersion;
    const scope=taskEvidenceScoped()?taskReview.evidence:null;
    const valid=()=>search===findVersion && current(ticket) && (!scope || taskReview?.evidence===scope && taskEvidenceScoped());
    const eligible=findRowPredicate(scope);
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
        if(!eligible(rows[index]))continue;
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
  function findRowPredicate(scope) {
    const capture=scope?.capture;
    const items=scope?new Set(root.DeskTaskEvidence.list(source,capture,textFor,item=>visibleTypes.has(item.type))
      .items.filter(item=>item.available).map(item=>item.item_id)):null;
    return row=>!!row.item && visibleTypes.has(row.item.type) && (!scope ||
      row.turn.id===capture.turn_id && items.has(row.item.id));
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
      let keyboardView=null,keyboardOwner=null,keyboardActivation=false;
      const clearKeyboard=()=>{keyboardView=keyboardOwner=null;keyboardActivation=false;};
      const keyboardCurrent=()=>keyboardView && keyboardOwner.source===source && keyboardOwner.find===findVersion &&
        keyboardOwner.refresh===refreshVersion && keyboardOwner.task===taskReview && keyboardOwner.mode===taskReview?.mode &&
        available(ticket) && detail.isConnected && keyboardView.selection?.key===rowKey(row) &&
        textFor(row.item).slice(keyboardView.selection.start,keyboardView.selection.end)===keyboardView.selection.text;
      detail.addEventListener('keydown',event=>{
        if(event.key==='Tab'){
          const selection=selectedText();
          if(selection?.key===rowKey(row)){
            keyboardView=captureView();keyboardOwner={source,find:findVersion,refresh:refreshVersion,task:taskReview,mode:taskReview?.mode};
          }else if(selection || !keyboardCurrent())clearKeyboard();
        }else if(event.target===review && (event.key==='Enter' || event.key===' '))keyboardActivation=!!keyboardCurrent();
        else clearKeyboard();
      });
      detail.addEventListener('pointerdown',clearKeyboard);
      detail.addEventListener('focusout',event=>{if(!detail.contains(event.relatedTarget))clearKeyboard();});
      review.onclick=async()=>{
        if(!available(ticket) || !detail.isConnected){clearKeyboard();return;}
        const live=selectedText(),saved=keyboardActivation && keyboardCurrent()?keyboardView:null,key=rowKey(row);
        const selection=live || saved?.selection,view=captureView();
        if(!live && saved){Object.assign(view,saved,{focus:view.focus});}
        clearKeyboard();
        const range=selection?.key===key?{start:selection.start,end:selection.end}:null;
        review.disabled=true;
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
    const search={query:el('find-query').value,submitted:findSubmitted,findQuery,groups:findGroups,total:findTotal,cursor:findCursor,page,matches:findMatches};
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
          findGroups=search.groups;findTotal=search.total;findCursor=search.cursor;page=search.page;findMatches=search.matches;
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
    const matched=occurrence?index===occurrence.index:(!findSubmitted || taskReview?.evidenceItem) && index===targetIndex;
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
    if(saved){pre.scrollTop=saved.scroll;pre.scrollLeft=saved.left || 0;}
    copyControls(detail,row,text,ticket);
    if(matched && (occurrence || !phrase || at>=0) && visibleTypes.has(item.type)) {
      detail.classList.add('history-reader-target');detail.tabIndex=-1;
    }
    return detail;
  }
  function render(scroll=true,view=null) {
    if(!source || !available())return;
    taskControls();
    if(taskReview?.mode==='overview')return renderTaskOverview(scroll,view);
    if(taskReview?.mode==='instructions')return renderInstructionSearch(scroll,view);
    if(taskReview?.mode==='context')return renderTaskContext(scroll,view);
    if(taskReview?.mode==='evidence')return renderTaskEvidence(scroll,view);
    if(taskReview?.evidenceItem)return renderTaskEvidenceItem(scroll,view);
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
  function visibleTextClip(pre) {
    if(!pre?.getBoundingClientRect)return null;
    const rect=pre.getBoundingClientRect(),body=el('body').getBoundingClientRect(),reader=el('').getBoundingClientRect();
    const clip={top:Math.max(rect.top,body.top,reader.top,0),bottom:Math.min(rect.bottom,body.bottom,reader.bottom,root.innerHeight ?? Infinity),
      left:Math.max(rect.left,body.left,reader.left,0),right:Math.min(rect.right,body.right,reader.right,root.innerWidth ?? Infinity)};
    return clip.bottom>clip.top && clip.right>clip.left?clip:null;
  }
  function characterRect(pre,text,at) {
    if(!Number.isSafeInteger(at) || at<0 || at>=text.length ||
        (/[\uDC00-\uDFFF]/.test(text[at]) && at && /[\uD800-\uDBFF]/.test(text[at-1])))return null;
    const size=text.codePointAt(at)>0xffff?2:1,first=textPoint(pre,at,true),last=textPoint(pre,at+size);
    if(!first || !last)return null;
    const range=document.createRange();range.setStart(first.node,first.offset);range.setEnd(last.node,last.offset);
    const rects=Array.from(range.getClientRects());
    return rects.find(rect=>rect.right>rect.left && rect.bottom>rect.top) || rects[0] || null;
  }
  function captureVisibleCharacter(item,pre) {
    const clip=item.open?visibleTextClip(pre):null;if(!clip)return null;
    const text=pre.textContent,offsets=[];
    // Native text windows use literal UTF16 offsets, including surrogate pairs.
    for(let at=0;at<text.length;at+=text.codePointAt(at)>0xffff?2:1)if(text[at]!=='\n' && text[at]!=='\r')offsets.push(at);
    let low=0,high=offsets.length;
    while(low<high){const middle=(low+high)>>>1,rect=characterRect(pre,text,offsets[middle]);
      if(!rect || rect.bottom<=clip.top)low=middle+1;else high=middle;}
    for(let i=low;i<offsets.length;i++){
      const rect=characterRect(pre,text,offsets[i]);if(!rect)continue;if(rect.top>=clip.bottom)break;
      if(rect.bottom>clip.top && rect.right>clip.left && rect.left<clip.right && rect.right>rect.left)
        return {offset:(Number(item.dataset.windowStart)||0)+offsets[i],top:rect.top-clip.top};
    }
    return null;
  }
  function restoreVisibleCharacter(item,saved) {
    if(!saved.character)return true;
    const pre=item.querySelector('.history-reader-text'),start=Number(item.dataset.windowStart)||0;
    if(!item.open || start!==saved.start)return false;
    const rect=characterRect(pre,pre.textContent,saved.character.offset-start);
    if(!rect || rect.right<=rect.left || rect.bottom<=rect.top)return false;
    // A source glyph can be valid while chrome/reflow temporarily clips its pre.
    // Do not turn pending viewport geometry into a missing-source outcome.
    const clip=visibleTextClip(pre);if(!clip)return null;
    const top=Math.min(Math.max(saved.character.top,1-(rect.bottom-rect.top)),clip.bottom-clip.top-1);
    pre.scrollTop+=rect.top-clip.top-top;return true;
  }
  function captureView(){
    const body=el('body'),items=new Map(),active=document.activeElement;
    const box=body.getBoundingClientRect(),supplied=new Map(rows.map(row=>[rowKey(row),row.item]));let anchor=null,focus=null;
    for(const item of viewItems()){
      const key=elementKey(item),pre=item.querySelector('.history-reader-text'),rect=item.getBoundingClientRect();
      const character=captureVisibleCharacter(item,pre),outputStart=commandOutputStart(supplied.get(key));
      items.set(key,{start:Number(item.dataset.windowStart)||0,open:item.open,scroll:pre?.scrollTop || 0,left:pre?.scrollLeft || 0,
        ...(character?{character}:{}),
        ...(Number.isSafeInteger(outputStart)?{commandOutputStart:outputStart}:{})});
      if(!anchor && rect.bottom>box.top)anchor={key,offset:rect.top-box.top,screenTop:rect.top};
      if(item===active || item.contains(active)){
        const controls=Array.from(item.querySelectorAll('button,summary,pre'));
        focus={key,index:controls.indexOf(active),item:item===active};
      }
    }
    return {items,anchor,focus,taskFocus:active?.dataset?.taskAction && body.contains(active)?active.dataset.taskAction:null,
      selection:selectedText(),scroll:body.scrollTop,scrollLeft:body.scrollLeft,outer:el('').scrollTop,outerLeft:el('').scrollLeft,page,first:rowKey(rows[page*PAGE_ENTRIES])};
  }
  function restoreView(view,ticket){
    if(!current(ticket))return;
    const body=el('body'),items=viewItems();
    for(const item of items){const saved=view.items.get(elementKey(item));if(saved){const pre=item.querySelector('.history-reader-text');pre.scrollTop=saved.scroll;pre.scrollLeft=saved.left || 0;}}
    body.scrollTop=view.scroll;body.scrollLeft=view.scrollLeft || 0;
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
    if(Number.isFinite(view.outerLeft))el('').scrollLeft=view.outerLeft;
    if(Number.isFinite(view.anchor?.screenTop)){
      const item=items.find(item=>elementKey(item)===view.anchor.key);
      if(item)el('').scrollTop+=item.getBoundingClientRect().top-view.anchor.screenTop;
    }
    const status=el('status'),notice='Previous original character unavailable in this fresh text window.';
    if(readingCharacterNotice && readingCharacterNotice.intent!==readingIntentEpoch){
      if(status.textContent===notice)status.textContent=readingCharacterNotice.previous;
      readingCharacterNotice=null;
    }
    const failures=new Map(readingCharacterNotice?.failures || []);
    for(const item of items){const key=elementKey(item),saved=view.items.get(key);
      if(!saved?.character)continue;
      const restored=restoreVisibleCharacter(item,saved),failed=failures.get(key);
      if(restored===false)failures.set(key,saved);
      else if(failed && failed.start===saved.start && failed.character.offset===saved.character.offset)failures.delete(key);
    }
    if(failures.size){
      // Chrome may recapture a surviving neighbour/glyph. Only the same failed
      // target becoming available, or a newer deliberate reading intent, clears it.
      const previous=status.textContent===notice && readingCharacterNotice?readingCharacterNotice.previous:status.textContent;
      readingCharacterNotice={previous,failures,intent:readingIntentEpoch};status.textContent=notice;
    }else if(readingCharacterNotice){
      if(status.textContent===notice)status.textContent=readingCharacterNotice.previous;
      readingCharacterNotice=null;
    }
  }
  function refreshControls(){
    const button=el('refresh');if(!button)return;
    button.hidden=!source;button.disabled=refreshing || loading;
    button.textContent=refreshing?'Refreshing original…':'Refresh original';originalFrontierControls();
  }
  function preserveChrome(change,ticket){
    const view=source && rows.length?captureView():null;
    change();
    if(view && current(ticket))restoreView(view,ticket);
  }
  async function refreshFind(query,anchor,ticket,previousMatches=null){
    const search=++findVersion,scope=taskEvidenceScoped()?taskReview.evidence:null;
    const valid=()=>search===findVersion && current(ticket) && (!scope || taskReview?.evidence===scope && taskEvidenceScoped());
    const eligible=findRowPredicate(scope);
    preserveChrome(()=>{finding=true;findGroups=[];findTotal=0;findCursor=-1;findControls();},ticket);
    const groups=[];let total=0;
    try{
      for(let index=0;index<rows.length;index++){
        if(!valid())return;
        const item=rows[index].item;if(!eligible(rows[index]))continue;
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
      if(previousMatches){findMatches=renewFindMatches(previousMatches,previousMatches.active);if(findMatches?.active)renderFindMatches();else findMatchesControls();}
    }catch{
      if(valid()){finding=false;findControls('The refreshed original could not be searched. Choose Find to retry.');}
    }
  }
  async function refresh(){
    if(!source || loading || refreshing || !available())return false;
    const ticket=version,request=++refreshVersion,readingEpoch=readingIntentEpoch;
    const originalView=findMatchesValid() && findMatches.active?findMatches.passageView:captureView(),viewport={width:root.innerWidth,height:root.innerHeight};
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
      const previousMatches=findMatchesValid()?findMatches:null;
      let view=previousMatches?.active?previousMatches.passageView:captureView();const oldMatch=findMatch();
      if(readingEpoch===readingIntentEpoch && (viewport.width!==root.innerWidth || viewport.height!==root.innerHeight))
        view=resizeOriginalCharacters(originalView,view);
      resetFindMatches();
      const anchorKey=oldMatch?rowKey(rows[oldMatch.index]):null;
      let anchor=anchorKey?{key:anchorKey,start:oldMatch.start,end:oldMatch.end}:null;
      const query=el('find-query').value.trim(),submitted=findSubmitted && findQuery===query;
      ++findVersion;finding=false;findGroups=[];findTotal=0;findCursor=-1;
      if(savedReference){
        const resolved=root.DeskEvidencePreparation.resolve(savedReference,result.home_namespace,thread,textFor);
        el('response').textContent=resolved.available?'The saved reviewed excerpt is still at this exact native item and span.':
          `Saved reviewed excerpt retained. Fresh original: ${resolved.status}. No other item or occurrence is used as its replacement.`;
      }
      source=thread;rows=flatten(thread);captureOriginalFrontier(ticket);
      if(!savedReference){
        anchor=mapOutputAnchor(anchor,view,rows);
        view=mapOriginalOutput(view,rows);
      }
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
      if(submitted && query)await refreshFind(query,anchor,ticket,previousMatches);
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
      if(!explicitReadingTarget() && root.DeskReadingCheckpoint){
        const readingEpoch=readingRestoreEpoch,findEpoch=findVersion;
        const rememberHome=home=>{
          if(!current(ticket))return;
          if(typeof home!=='string' || !/^[a-f0-9]{64}$/.test(home))return;
          readingHome=home;
          if(readingEpoch!==readingRestoreEpoch || findEpoch!==findVersion)return;
          if(source && !loading){preserveChrome(()=>captureOriginalFrontier(ticket),ticket);const view=originalReadingView();if(view){render(false,view);settleOriginalReading(view,ticket);}}
        };
        if(options?.nativeHome)rememberHome(options.nativeHome);
        else Promise.resolve(api('/api/native/home')).then(result=>rememberHome(result?.home_namespace),()=>{});
      }
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
      source=thread;rows=flatten(thread);captureOriginalFrontier(ticket);
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
      const view=originalReadingView();render(!view,view);
      if(view)settleOriginalReading(view,ticket);
      return true;
    } catch(error) {
      if(!current(ticket)){if(ticket===version && el('').open)close();return false;}
      el('status').textContent=options?.taskResponse?'The captured task response could not be read. Retry keeps this same native thread and turn.':'The original conversation could not be read.';
      el('error').textContent=error.message;el('error').hidden=false;el('retry').hidden=false;
      return false;
    } finally {
      if(ticket===version){loading=false;el('body').setAttribute('aria-busy','false');el('retry').disabled=false;findControls();refreshControls();nativeIdCopyControls();taskControls();}
    }
  }
  async function show(result,callbacks={}) {
    if(!api)throw new Error('Native history reader is not configured.');
    if(callbacks.valid && !callbacks.valid())return false;
    saveOriginalReading();readingHome=null;readingUnavailable=false;readingCharacterNotice=null;++readingRestoreEpoch;resetOriginalFrontier();
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
    originalFrontierControls();
    const active=!!taskReview && !!source;
    if(el('task-overview-show')){
      el('task-overview-show').hidden=!source || taskReview?.mode==='overview';
      el('task-overview-show').disabled=!root.DeskHistoryTasks?.overview || loading || !current(version);
    }
    if(el('task-overview-return'))el('task-overview-return').hidden=!active || !taskReview.overview || taskReview.mode==='overview';
    if(el('task-return'))el('task-return').hidden=!active || !['item','evidence'].includes(taskReview.mode);
    if(el('task-evidence-return'))el('task-evidence-return').hidden=!active || !taskReview.evidence || !taskReview.evidenceItem;
    if(el('task-instructions-return'))el('task-instructions-return').hidden=!active || taskReview.mode==='instructions' || taskReview.instructionSearch?.submitted==null;
    if(el('task-passage'))el('task-passage').hidden=!active;
    if(el('task-status')){
      el('task-status').hidden=!active;
      el('task-status').textContent=active?(taskReview.mode==='overview'?'Supplied tasks in this loaded original':taskReview.mode==='instructions'?'Supplied user instructions in this loaded original':taskReview.itemLabel || 'Native task context · Turn '+str(taskReview.capture.turn_id)):'';
    }
  }
  function taskEvidenceScoped() {
    return !!taskReview?.evidence && (taskReview.mode==='evidence' || taskReview.evidenceItem) && taskReview.evidence.scope==='task';
  }
  function taskEvidenceFindControls() {
    const field=el('find-scope'),label=el('find-label');if(!field)return;
    const active=!!taskReview?.evidence && (taskReview.mode==='evidence' || taskReview.evidenceItem);
    field.hidden=!active;field.disabled=!active || loading;
    if(active)field.value=taskReview.evidence.scope;
    if(label)label.textContent=taskEvidenceScoped()?'Find in this task’s supplied evidence':'Find in this original conversation';
  }
  function taskEvidenceResult(state) {
    if(state.source!==source){
      state.result=root.DeskTaskEvidence.list(source,state.capture,textFor,item=>visibleTypes.has(item.type));state.source=source;
      state.page=root.DeskTaskEvidence.page(state.result,state.page).index;
    }
    return state.result;
  }
  function openTaskEvidence() {
    if(!taskReview || !source || !available() || !root.DeskTaskEvidence)return false;
    const review=taskReview;review.contextView=captureView();
    if(!review.evidence)review.evidence={capture:{...review.capture},source:null,result:null,page:0,view:null,chosen:null,itemView:null,scope:'task'};
    taskEvidenceResult(review.evidence);review.mode='evidence';review.evidenceItem=false;review.itemLabel='Task evidence · Turn '+review.capture.turn_id;
    resetFind();render(!review.evidence.view,review.evidence.view);return true;
  }
  function taskEvidenceAction(item,capture=taskReview.evidence.capture) {
    return 'evidence-item:'+encodeURIComponent(JSON.stringify([capture.turn_id,item.item_id]));
  }
  function renderTaskEvidence(focus=true,view=null) {
    const review=taskReview,state=review?.evidence,ticket=version,body=el('body');if(!state || !current(ticket))return;
    const original=source,epoch=findVersion,result=taskEvidenceResult(state);
    const focused=view?.taskFocus?.startsWith('evidence-item:')?result.items.find(item=>item.available && taskEvidenceAction(item,state.capture)===view.taskFocus):null;
    if(focused)state.page=Math.floor(focused.index/root.DeskTaskEvidence.PAGE_ITEMS);
    const slice=root.DeskTaskEvidence.page(result,state.page);
    const valid=()=>taskReview===review && review.mode==='evidence' && review.evidence===state && current(ticket) && source===original && epoch===findVersion;
    body.replaceChildren();body.scrollTop=0;
    const panel=node('section',undefined,'history-reader-task-evidence');panel.tabIndex=-1;panel.dataset.taskAction='evidence-status';
    panel.append(node('h3','This task’s supplied evidence'),node('p',`Thread ${state.capture.thread_id}\nTurn ${state.capture.turn_id}\nNative turn status: ${str(result.turn_status)||'unreported'}`,'history-reader-identity'));
    const error=typeof result.turn_error==='string'?result.turn_error:str(result.turn_error?.message);if(error)panel.append(node('p',error,'history-reader-turn-error'));
    if(!result.available)panel.append(node('p',`Captured task evidence unavailable in this fresh original: ${result.reason}.`,'history-reader-task-evidence-status'));
    else if(!result.total)panel.append(node('p','No native items were supplied for this task.','history-reader-task-evidence-status'));
    const list=node('div',undefined,'history-reader-task-evidence-list');
    for(const item of slice.items){
      const article=node('article',undefined,'history-reader-task-evidence-row');article.dataset.itemIndex=String(item.index);article.dataset.turnId=state.capture.turn_id;article.dataset.itemId=str(item.item_id);
      article.append(node('h4',`Item ${item.index+1} · ${item.item_type || 'Type unreported'}`),node('p',`Item ${str(item.item_id)||'unreported'}\n${item.available?`Readable original · ${item.text_length} UTF16 text units`:item.reason}`,'history-reader-identity'));
      if(item.preview)article.append(node('pre',item.preview+(item.preview_end<item.text_length?'…':''),'history-reader-task-preview'));
      article.append(taskButton('Read full original item',taskEvidenceAction(item,state.capture),()=>{if(valid())readTaskEvidenceItem(item.index);},!item.available));list.append(article);
    }
    panel.append(list);const controls=node('div',undefined,'actions history-reader-task-navigation');
    for(const [direction,label] of [[-1,'Previous task evidence'],[1,'Next task evidence']]){
      const next=slice.index+direction;
      controls.append(taskButton(label,direction<0?'evidence-previous':'evidence-next',()=>{if(!valid())return;state.page=next;state.view=null;renderTaskEvidence();},next<0 || next>=slice.pages));
    }
    panel.append(controls);body.append(panel);
    el('coverage').textContent=`Showing supplied items ${slice.total?slice.first+1:0}–${Math.min(slice.total,slice.first+20)} of ${slice.total}. Page ${slice.index+1} of ${slice.pages}. ${result.readable_count} readable; native order and unsupported rows retained. Up to 20 supplied items per page.`;
    el('previous').hidden=el('next').hidden=true;taskControls();findControls();
    if(view){restoreView(view,ticket);if(view.taskFocus?.startsWith('evidence-item:') && !focused)body.focus({preventScroll:true});}
    else if(focus){panel.focus({preventScroll:true});el('').scrollTop=0;}
  }
  function readTaskEvidenceItem(index) {
    const review=taskReview,state=review?.evidence;if(!state || review.mode!=='evidence' || !available())return false;
    const item=taskEvidenceResult(state).items.find(item=>item.index===index && item.available);if(!item)return false;
    const matches=rows.map((row,index)=>({row,index})).filter(({row})=>row.turn.id===state.capture.turn_id && row.item?.id===item.item_id);
    if(matches.length!==1)return false;
    const prior=state.chosen===item.item_id?state.itemView:null;state.view=captureView();state.chosen=item.item_id;
    review.mode='item';review.evidenceItem=true;review.itemLabel='Task evidence · '+item.item_type+'\nTurn '+state.capture.turn_id+' · Item '+item.item_id;
    requested={thread_id:source.id,turn_id:state.capture.turn_id,item_id:item.item_id};targetIndex=matches[0].index;page=Math.floor(targetIndex/PAGE_ENTRIES);
    ++findVersion;finding=false;findCursor=-1;findControls();render(!prior,prior);return true;
  }
  function renderTaskEvidenceItem(scroll=true,view=null) {
    const review=taskReview,state=review?.evidence,ticket=version,body=el('body');if(!state || !current(ticket))return;
    const occurrence=findMatch(),index=occurrence?.index ?? rows.findIndex(row=>row.turn.id===requested.turn_id && row.item?.id===requested.item_id),row=rows[index];
    let exact=false;
    if(row?.item){
      const result=root.DeskTaskEvidence.list(source,{thread_id:source.id,turn_id:row.turn.id},textFor,item=>visibleTypes.has(item.type));
      exact=result.available && result.items.some(item=>item.available && item.item_id===row.item.id);
    }
    body.replaceChildren();body.scrollTop=0;
    if(exact){
      const section=node('section',undefined,'history-reader-turn');section.dataset.turnId=row.turn.id;section.append(node('h3','Turn '+row.turn.id));section.append(itemNode(row,index,ticket,view));body.append(section);
      el('coverage').textContent='One exact supplied original item · full Copy and existing native text windows. Turn '+row.turn.id+' · Item '+row.item.id;
    }else{body.append(node('p',`The captured native item is unavailable in this fresh original. Turn ${str(requested.turn_id)} · Item ${str(requested.item_id)}`,'history-reader-task-evidence-status'));el('coverage').textContent='Captured source identity retained; no other item is used.';}
    el('previous').hidden=el('next').hidden=true;taskControls();
    const target=body.querySelector('.history-reader-target');if(target && scroll)scrollMatch(target,ticket);if(view)restoreView(view,ticket);
  }
  function returnTaskEvidence() {
    const review=taskReview,state=review?.evidence;if(!state || !available())return false;
    const view=captureView();if(view.items.has(JSON.stringify([state.capture.turn_id,state.chosen])))state.itemView=view;review.mode='evidence';review.evidenceItem=false;findControls();render(false,state.view);return true;
  }
  function taskSnapshot() {
    const occurrence=findMatch(),key=occurrence?rowKey(rows[occurrence.index]):null;
    const chrome={};for(const id of ['status','match','response','error','retry']){
      const element=el(id);chrome[id]={text:element.textContent,hidden:element.hidden};
    }
    return {source,refreshVersion,requested:{...requested},view:captureView(),page,targetIndex,chrome,
      find:{query:el('find-query').value,submitted:findSubmitted && !finding,queryAtSubmit:findQuery,
        groups:findGroups,total:findTotal,cursor:findCursor,matches:findMatches,message:finding?'Find canceled by task navigation. Choose Find to search this original.':el('find-status').textContent,
        anchor:key?{key,start:occurrence.start,end:occurrence.end}:null}};
  }
  function openTaskContext(capture,{instructionMatch=null}={}) {
    if(!root.DeskHistoryTasks || !source || !available())return false;
    const task=capture.item_id?root.DeskHistoryTasks.containing(source,capture):
      root.DeskHistoryTasks.list(source,capture.thread_id).find(task=>task.turn_id===capture.turn_id && task.available);
    if(!task?.available)throw Error('The captured native task or item is not supplied by this original read.');
    if(!taskReview)taskReview={passage:taskSnapshot(),capture:null,mode:'context',contextView:null};
    ++findVersion;finding=false;findSubmitted=false;findGroups=[];findTotal=0;findCursor=-1;
    if(taskReview.capture?.turn_id!==task.turn_id){taskReview.evidence=null;taskReview.evidenceItem=false;}
    if(taskReview.evidence && (taskReview.evidence.capture.thread_id!==task.thread_id || taskReview.evidence.capture.turn_id!==task.turn_id))taskReview.evidence=null;
    taskReview.capture={thread_id:task.thread_id,turn_id:task.turn_id};taskReview.mode='context';taskReview.evidenceItem=false;
    taskReview.contextView=null;taskReview.message='';taskReview.itemLabel='';taskReview.instructionTarget=instructionMatch;
    findControls();render();return true;
  }
  function taskButton(label,action,callback,disabled=false) {
    const button=node('button',label);button.type='button';button.dataset.taskAction=action;
    button.disabled=disabled;button.onclick=callback;return button;
  }
  function taskOverviewState() {
    if(!taskReview)return null;
    return taskReview.overview ||= {source:null,page:0,result:null,view:null,chosen:null,notice:''};
  }
  function taskOverviewResult(state) {
    if(state.source!==source || state.result?.page!==state.page){
      state.result=root.DeskHistoryTasks.overview(source,source.id,state.page);
      if(state.source && state.source!==source && state.chosen){
        const retained=root.DeskHistoryTasks.list(source,source.id).some(task=>task.available && task.turn_id===state.chosen.turn_id);
        state.notice=retained?'':'The task previously selected from this overview is no longer available in this original read.';
      }
      state.source=source;state.page=state.result.page;
    }
    return state.result;
  }
  function showTaskOverview() {
    if(!root.DeskHistoryTasks?.overview || !source || loading || !available())return false;
    if(taskReview?.mode==='overview')return true;
    if(!taskReview)taskReview={passage:taskSnapshot(),capture:null,mode:'overview',contextView:null};
    const state=taskOverviewState();
    taskReview.mode='overview';taskReview.evidenceItem=false;taskReview.itemLabel='';taskReview.message='';
    ++findVersion;finding=false;findSubmitted=false;findGroups=[];findTotal=0;findCursor=-1;
    findControls();render(true,state.view);return true;
  }
  function chooseOverviewTask(capture,kind) {
    if(!taskReview || !source || !available())return false;
    const state=taskOverviewState();
    try{
      const task=taskOverviewResult(state).entries.find(row=>row.available && row.index===capture.index && row.turn_id===capture.turn_id);
      if(!task)throw Error('This exact supplied task is no longer on the current overview page.');
      state.view=captureView();state.chosen={turn_id:task.turn_id};state.notice='';
      openTaskContext(task);
      if(kind==='response')return readTaskItem('response');
      return true;
    }catch(error){state.notice=error.message;taskReview.mode='overview';render(false,state.view);return false;}
  }
  function renderTaskOverview(focus=true,view=null) {
    const review=taskReview,ticket=version,body=el('body');if(!review || !current(ticket))return;
    const state=taskOverviewState(),result=taskOverviewResult(state),snapshot=source;
    const valid=()=>taskReview===review && review.mode==='overview' && source===snapshot && state.result===result && current(ticket);
    body.replaceChildren();body.scrollTop=0;
    const panel=node('section',undefined,'history-reader-task-overview');
    const heading=node('h3','Task overview');heading.tabIndex=-1;
    panel.append(heading,node('p','Supplied task order, your instructions and each task’s own reported response. Open a task to read its complete original.','muted'));
    if(!result.total)panel.append(node('p','No native tasks were supplied in this original read.','muted'));
    for(const task of result.entries){
      const article=node('article',undefined,'history-reader-task-overview-row');article.dataset.turnId=str(task.turn_id);article.dataset.taskIndex=String(task.index);
      article.append(node('h4','Supplied task '+task.ordinal),node('p','Turn '+(str(task.turn_id)||'unreported')+'\nNative turn status: '+(str(task.turn_status)||'unreported'),'history-reader-identity'));
      const error=typeof task.turn_error==='string'?task.turn_error:str(task.turn_error?.message);
      if(error)article.append(node('p',Array.from(error).slice(0,320).join(''),'history-reader-turn-error'));
      if(!task.available)article.append(node('p','This task has no unambiguous native turn identity.','muted'));
      else {
        if(!task.user_message_count)article.append(node('p','No user instruction was supplied for this task.','muted'));
        for(const [index,instruction] of task.instructions.entries()){
          article.append(node('p','Supplied user instruction '+(index+1),'muted'));
          if(instruction.text)article.append(node('pre',instruction.text+(instruction.truncated?'…':''),'history-reader-task-preview'));
          if(!instruction.available)article.append(node('p',instruction.reason==='instruction_unavailable'?'No readable user text was supplied.':'This instruction has no unambiguous native item identity.','muted'));
        }
        if(task.user_message_count>task.instructions.length)article.append(node('p',`Showing ${task.instructions.length} of ${task.user_message_count} supplied user instructions. Read the task for all instructions.`,'muted'));
        const response=task.response;
        if(response.available){
          article.append(node('p',response.label+' · Phase: '+(str(response.phase)||'unreported')+'\nItem '+response.item_id,'history-reader-identity'));
          article.append(node('pre',response.preview.text+(response.preview.truncated?'…':''),'history-reader-task-preview'));
        }else article.append(node('p',response.status==='ambiguous_item'?'This task response has no unambiguous native item identity.':'No readable assistant response was supplied for this task.','muted'));
      }
      const actions=node('div',undefined,'actions');
      for(const [kind,label,disabled] of [['context','Read task',!task.available],['response','Read task response',!task.available || !task.response.available]]){
        actions.append(taskButton(label,'overview-'+kind+':'+(task.available?encodeURIComponent(task.turn_id):'unavailable-'+task.index),()=>{if(valid())chooseOverviewTask(task,kind);},disabled));
      }
      article.append(actions);panel.append(article);
    }
    const navigation=node('div',undefined,'actions history-reader-task-navigation');
    for(const [direction,label] of [[-1,'Previous tasks'],[1,'Next tasks']]){
      const next=result.page+direction;
      navigation.append(taskButton(label,direction<0?'overview-previous':'overview-next',()=>{
        if(!valid())return;state.page=next;state.view=null;state.notice='';renderTaskOverview();
      },next<0 || next>=result.pages));
    }
    panel.append(navigation);
    if(state.notice){const notice=node('p',state.notice);notice.setAttribute('role','status');panel.append(notice);}
    body.append(panel);el('coverage').textContent=`Showing supplied tasks ${result.total?result.first+1:0}–${result.first+result.entries.length} of ${result.total}. Page ${result.page+1} of ${result.pages}. Up to ${result.limit} tasks per page; previews are limited to 320 characters and 3 user instructions per task. This loaded original only.`;
    el('previous').hidden=el('next').hidden=true;taskControls();
    if(view)restoreView(view,ticket);else if(focus){el('').scrollTop=0;heading.focus({preventScroll:true});}
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
    if(root.DeskTaskEvidence){const original=source;panel.append(taskButton('Read this task’s evidence','evidence-open',()=>{if(taskReview===review && current(ticket) && source===original && panel.isConnected)openTaskEvidence();},!addressable));}
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
      review.contextView=view;review.mode='item';review.evidenceItem=false;review.message='';
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
    taskReview.mode='context';taskReview.evidenceItem=false;taskReview.itemLabel='';findControls();render(false,taskReview.contextView);return true;
  }
  async function returnTaskPassage() {
    if(!taskReview || !source || !available())return false;
    const snapshot=taskReview.passage,ticket=version,unchanged=source===snapshot.source;taskReview=null;taskControls();
    const followOutput=!unchanged && !options?.savedReference;
    const view=followOutput?mapOriginalOutput(snapshot.view,rows):snapshot.view;
    const findAnchor=followOutput?mapOutputAnchor(snapshot.find.anchor,snapshot.view,rows):snapshot.find.anchor;
    requested={...snapshot.requested};++findVersion;finding=false;
    targetIndex=rows.findIndex(row=>row.item && row.turn.id===requested.turn_id && row.item.id===requested.item_id);
    const anchor=snapshot.view.anchor?.key || snapshot.view.first,index=anchor?rows.findIndex(row=>rowKey(row)===anchor):-1;
    page=index>=0?Math.floor(index/PAGE_ENTRIES):Math.min(snapshot.page,Math.max(0,Math.ceil(rows.length/PAGE_ENTRIES)-1));
    el('find-query').value=snapshot.find.query;findSubmitted=snapshot.find.submitted;findQuery=snapshot.find.queryAtSubmit;
    findGroups=unchanged?snapshot.find.groups:[];findTotal=unchanged?snapshot.find.total:0;findCursor=unchanged?snapshot.find.cursor:-1;
    findMatches=unchanged?snapshot.find.matches:null;
    if(unchanged && refreshVersion===snapshot.refreshVersion){for(const [id,value] of Object.entries(snapshot.chrome)){el(id).textContent=value.text;el(id).hidden=value.hidden;}}
    else if(!unchanged){
      el('status').textContent=index<0 && anchor?'The original passage item is no longer supplied. Its captured source identity is retained.':'Returned to the original passage in the refreshed native read.';
      el('match').textContent=targetIndex<0 && requested.item_id?'The captured native turn/item is not present in this original read.':'';
    }
    findControls(unchanged?snapshot.find.message:undefined);render(false,view);
    if(!unchanged && findSubmitted && findQuery===snapshot.find.query.trim() && findQuery)await refreshFind(findQuery,findAnchor,ticket,snapshot.find.matches);
    return true;
  }
  function configure(value) {
    api=value.api;evidenceReview=value.onEvidence || null;
    if(el('find-matches-show')){
      el('find-matches-show').onclick=showFindMatches;el('find-matches-return').onclick=showFindMatches;
      el('find-matches-close').onclick=dismissFindMatches;
      for(const id of ['find-matches-show','find-matches-return'])el(id).onmousedown=event=>{if(event.button===0 && selectedText())event.preventDefault();};
    }
    if(el('copy-native-id')){el('copy-native-id').onclick=()=>copyNativeId();el('copy-native-id').onmousedown=event=>{if(event.button===0 && selectedText())event.preventDefault();};}
    el('back').onclick=el('close').onclick=()=>close();
    el('retry').onclick=()=>{el('retry').disabled=true;source?refresh():read();};
    el('original').onclick=()=>{if(!unavailableThread || !available())return;const thread=unavailableThread;options={...options,taskResponse:false,preloadedThread:thread};return read();};
    if(el('refresh'))el('refresh').onclick=refresh;
    if(el('first-new')){el('first-new').onclick=readFirstNewOriginalItem;el('first-new').onmousedown=event=>{if(event.button===0 && selectedText())event.preventDefault();};}
    if(el('task-return'))el('task-return').onclick=returnTaskContext;
    if(el('task-evidence-return'))el('task-evidence-return').onclick=returnTaskEvidence;
    if(el('find-scope'))el('find-scope').onchange=()=>{
      if(!taskReview?.evidence || !available())return;
      const view=captureView();taskReview.evidence.scope=el('find-scope').value==='task'?'task':'original';
      resetFind();render(false,view);
    };
    if(el('task-passage'))el('task-passage').onclick=returnTaskPassage;
    if(el('task-instructions-return'))el('task-instructions-return').onclick=returnInstructionMatches;
    if(el('task-overview-show')){el('task-overview-show').onclick=showTaskOverview;el('task-overview-show').onmousedown=event=>{if(event.button===0 && selectedText())event.preventDefault();};}
    if(el('task-overview-return'))el('task-overview-return').onclick=showTaskOverview;
    el('previous').onclick=()=>movePage(-1);
    el('next').onclick=()=>movePage(1);
    el('find-form').onsubmit=event=>{event.preventDefault();submitFind();};
    el('find-previous').onclick=()=>jumpFind(-1);el('find-next').onclick=()=>jumpFind(1);
    el('find-query').oninput=()=>{
      const previousView=findMatches?.active?findMatches.passageView:captureView();resetFindMatches();
      ++findVersion;finding=false;findSubmitted=false;findGroups=[];findTotal=0;findCursor=-1;
      findControls('Query changed. Choose Find to search this original.');if(source && available())render(false,previousView);
    };
    el('').addEventListener('keydown',event=>{
      if(event.key!=='F3' || !el('').open || !source || loading || !el('').contains(event.target))return;
      event.preventDefault();
      if(taskReview && !['item','evidence'].includes(taskReview.mode))return;
      if(finding)return;
      if(findSubmitted && findQuery===el('find-query').value.trim() && findTotal)jumpFind(event.shiftKey?-1:1);
      else if(el('find-query').value.trim())submitFind(event.shiftKey?-1:1);
      else el('find-query').focus();
    });
    el('body').addEventListener('pointerdown',event=>{if(event.target.closest?.('.history-reader-item'))readingUnavailable=false;});
    el('body').addEventListener('wheel',()=>{readingUnavailable=false;},{passive:true});
    for(const type of ['pointerdown','wheel','keydown'])el('').addEventListener(type,event=>{
      ++readingRestoreEpoch;
      if(type==='wheel' || el('body').contains(event.target) || el('find-form').contains(event.target) ||
        event.target===el('previous') || event.target===el('next')){
        ++readingIntentEpoch;
        if(readingCharacterNotice){
          const status=el('status');
          if(status.textContent==='Previous original character unavailable in this fresh text window.')status.textContent=readingCharacterNotice.previous;
          readingCharacterNotice=null;
        }
      }
    },{passive:true});
    el('').addEventListener('cancel',saveOriginalReading);
    el('').addEventListener('close',()=>{if(!el('').open)invalidate();});
    root.addEventListener?.('pagehide',saveOriginalReading);
  }
  root.DeskHistoryReader={configure,show,close,textForItem:textFor};
})(typeof globalThis==='undefined'?this:globalThis);
