/* Literal recall of retained Desk/native evidence and preparation; navigation never sends. */
const DeskRecall=(()=>{
  const el=id=>document.getElementById(id), rowData=new WeakMap();
  let options, searchVersion=0, openVersion=0, navigationVersion=0;
  let searching=false, resultOpening=false, projectSignature='', target=null, pendingNavigation=null;
  let scanVersion=0, scanTimer=null, scanBusy=false, scanReading=false, scanReady=false, scanIssue=false, scanJob=null;
  let scanRefresh=null, lastSearch=null;
  let nativeIndexedThreads=null, indexPromoted=false, emptySearch=false;
  const nativeProjects=new Set();
  const query=()=>({q:el('recall-query').value.trim(),cwd:el('recall-project').value,archived:el('recall-archived').checked});
  const sameQuery=(a,b)=>a.q===b.q && a.cwd===b.cwd && a.archived===b.archived;
  const current=(version,scope)=>version===searchVersion && el('recall').open && sameQuery(scope,query());
  const make=(tag,text,cls)=>options.make(tag,text,cls);
  function clearTarget(){if(target){target.node.classList.remove('recall-target');if(target.addedTabindex)target.node.removeAttribute('tabindex');target=null;}}
  function selectionChanged(){clearTarget();++navigationVersion;pendingNavigation=null;scanRefresh=null;}
  function projects(){
    if(!options)return;
    const values=[...new Set([...options.state().sessions.map(s=>s.cwd),...nativeProjects].filter(Boolean))].sort();
    const selected=el('recall-project').value, signature=JSON.stringify(values);
    if(signature===projectSignature)return;projectSignature=signature;
    const all=make('option','All indexed projects');all.value='';
    const rows=values.map(cwd=>{const folder=cwd.split(/[\\/]/).filter(Boolean).at(-1) || cwd;
      const row=make('option',folder+' — '+cwd);row.value=cwd;return row;});
    // A background state change must not silently broaden an exact saved scope.
    if(selected && !values.includes(selected)){const row=make('option',selected+' — saved scope');row.value=selected;rows.push(row);}
    el('recall-project').replaceChildren(all,...rows);el('recall-project').value=selected;
  }
  function stateChanged(){projects();if(target && (target.session!==options.selected() || target.generation!==options.generation()))clearTarget();}
  function buttons(){
    el('recall-search').disabled=searching;
    el('recall-results').setAttribute('aria-busy',String(searching || resultOpening));
    for(const b of el('recall-results').querySelectorAll('.recall-open'))b.disabled=resultOpening;
  }
  function invalidate(){
    ++searchVersion;++openVersion;++navigationVersion;searching=false;resultOpening=false;pendingNavigation=null;
    lastSearch=null;emptySearch=false;if(scanRefresh)scanRefresh.search=null;
    el('recall-error').hidden=true;el('recall-results').replaceChildren();
    el('recall-summary').textContent='Query changed. Choose Search to update saved content.';buttons();
  }
  function snippet(text,match){
    const node=make('pre','','recall-snippet'), value=String(text || ''), needle=String(match || '');
    const at=needle?value.indexOf(needle):-1;
    if(at<0){node.textContent=value;return node;}
    node.append(document.createTextNode(value.slice(0,at)),make('mark',value.slice(at,at+needle.length)),document.createTextNode(value.slice(at+needle.length)));
    return node;
  }
  function nativeCoverage(value){
    if(!value)return;
    const counts=[];
    for(const [key,label] of [['indexed_threads','indexed native conversations'],['indexed_items','cached native items'],['truncated_threads','conversations with shortened or omitted text'],['omitted_items','omitted items'],['unsupported_items','unsupported items'],['invalid_items','unreadable items']]){
      if(Number.isFinite(value[key]))counts.push(value[key]+' '+label);
    }
    const limits=[];
    if(Number.isFinite(value.max_thread_items))limits.push(value.max_thread_items.toLocaleString()+' items per conversation');
    if(Number.isFinite(value.max_thread_chars))limits.push(value.max_thread_chars.toLocaleString()+' characters per conversation');
    if(Number.isFinite(value.max_item_chars))limits.push(value.max_item_chars.toLocaleString()+' characters per item');
    el('recall-native-coverage').textContent=['Local native cache: '+counts.join(' · '),limits.length?'Text limits: '+limits.join(' · ')+'. Newest readable items are retained first.':'',
      'Coverage describes supplied native reads. An unchanged active search refreshes once after an explicit scan; choose Search after editing the query or reading existing results.'].filter(Boolean).join('\n');
  }
  function indexContext(){
    // Only the global scan response can identify a fresh cache. A project-scoped
    // search with zero indexed threads must not turn an existing index into first use.
    const fresh=scanReady && !scanIssue && nativeIndexedThreads===0 && scanJob?.status==='idle';
    const promoted=fresh || (indexPromoted && scanReady && !scanIssue && scanJob?.status==='running');
    const button=el('recall-index'),parent=el(promoted?'recall-actions':'recall-index-actions');
    if(button.parentElement!==parent){
      const focused=document.activeElement===button;parent.prepend(button);
      if(focused)button.focus({preventScroll:true});
    }
    indexPromoted=promoted;button.classList.toggle('recall-index-primary',promoted);
    if(!emptySearch || searching || !lastSearch || !current(lastSearch.version,lastSearch.scope))return;
    el('recall-summary').textContent=fresh
      ? 'Native history is not indexed yet. Choose Index existing Codex history to search it.'
      : scanReady && !scanIssue && scanJob?.status==='running'
        ? 'No cached matches yet. Existing Codex history is being indexed.'
        : 'No saved content matches this query in the selected scope.';
  }
  function globalCoverage(value){
    nativeIndexedThreads=Number.isFinite(value?.indexed_threads)?value.indexed_threads:null;
  }
  function scanButtons(){
    const active=scanJob?.status==='running';
    el('recall-index').disabled=scanBusy || scanReading || !scanReady || active;
    el('recall-index').textContent=scanJob?.status==='completed'?'Index existing history again':'Index existing Codex history';
    el('recall-index-cancel').hidden=!active;el('recall-index-cancel').disabled=scanBusy;
    el('recall-index-retry').hidden=!(scanIssue || ['cancelled','failed'].includes(scanJob?.status) || scanJob?.failed>0);
    el('recall-index-retry').disabled=scanBusy || scanReading || (active && !scanIssue);
    el('recall-indexing').setAttribute('aria-busy',String(scanBusy || scanReading || active));
    indexContext();
  }
  function scanStatus(job){
    if(!job || typeof job.status!=='string')return;
    scanJob=job;
    if(scanRefresh){if(job.status==='completed')scanRefresh.completed=true;else if(['cancelled','failed'].includes(job.status))scanRefresh=null;}
    const label={idle:'History has not been indexed.',running:'Indexing existing Codex history…',completed:'Recent history scan completed.',cancelled:'Indexing cancelled. Already cached items are kept.',failed:'History indexing failed. Choose Retry.'}[job.status] || 'History indexing status unavailable.';
    const counts=[['seen','seen'],['indexed','indexed'],['skipped','unchanged'],['failed','failed']]
      .filter(([key])=>Number.isFinite(job[key])).map(([key,text])=>job[key]+' '+text).join(' · ');
    el('recall-index-status').textContent=[label,job.status==='idle'?'':counts,
      job.status!=='idle' && Number.isFinite(job.limit)?'This pass reads at most '+job.limit+' native conversations.':'',
      job.has_more?'More native history exists beyond this pass. This is a bounded recent-history cache.':''].filter(Boolean).join('\n');
    if(job.error){el('recall-index-error').textContent=job.error;el('recall-index-error').hidden=false;}
    scanButtons();
  }
  function refreshAfterScan(){
    if(!scanRefresh?.completed)return;
    const ticket=scanRefresh.search;
    if(!ticket || !current(ticket.version,ticket.scope) || ticket.navigation!==navigationVersion ||
       ticket.selected!==options.selected() || ticket.generation!==options.generation() ||
       resultOpening || el('history-reader').open || el('recall-results').contains(document.activeElement)){
      scanRefresh=null;return;
    }
    if(searching)return; // Its own current request must settle before one fresh lookup.
    scanRefresh=null;search();
  }
  function stopScanPolling(){if(scanTimer!==null)clearTimeout(scanTimer);scanTimer=null;}
  async function readScan(){
    if(!el('recall').open || scanBusy)return;
    stopScanPolling();const version=++scanVersion;scanReading=true;scanButtons();
    try{
      const data=await options.api('/api/history/index');
      if(version!==scanVersion || !el('recall').open)return;
      scanReady=true;scanIssue=false;el('recall-index-error').hidden=true;globalCoverage(data.coverage);scanStatus(data.job);nativeCoverage(data.coverage);refreshAfterScan();
      if(scanJob?.status==='running')scanTimer=setTimeout(readScan,750);
    }catch(error){if(version===scanVersion && el('recall').open){
      scanIssue=true;scanReady=false;el('recall-index-error').textContent=error.message;el('recall-index-error').hidden=false;
      el('recall-index-status').textContent='History status could not be read. Choose Retry to check it again.';
    }}finally{if(version===scanVersion){scanReading=false;scanButtons();}}
  }
  async function controlScan(cancel=false){
    if(scanBusy || !el('recall').open || (!cancel && (!scanReady || scanJob?.status==='running')))return;
    stopScanPolling();const version=++scanVersion;scanBusy=true;scanReading=false;scanIssue=false;
    scanRefresh=cancel?null:{search:lastSearch,completed:false};
    el('recall-index-error').hidden=true;scanButtons();
    el('recall-index-status').textContent=cancel?'Cancelling after the current native read…':'Starting a local history scan…';
    try{
      const data=await options.api('/api/history/index'+(cancel?'/cancel':''),cancel?{}:{limit:200});
      if(version!==scanVersion || !el('recall').open)return;
      if(data.coverage)globalCoverage(data.coverage);scanStatus(data.job || data);refreshAfterScan();
    }catch(error){if(version===scanVersion && el('recall').open){
      scanIssue=true;scanReady=false;el('recall-index-error').textContent=error.message;el('recall-index-error').hidden=false;
    }}finally{
      scanBusy=false;scanButtons();
      // Recheck after a control response, including when its dialog was closed and reopened.
      // A lost start response must be reconciled before another explicit start is enabled.
      if(el('recall').open && !scanIssue)readScan();
    }
  }
  function coverage(value){
    const counts=[];
    for(const [key,label] of [['sessions','Desk sessions'],['activity_items','cached activity items'],['drafts','saved drafts'],['followups','prepared follow-ups']]){
      if(Number.isFinite(value?.[key]))counts.push(value[key]+' '+label);
    }
    nativeCoverage(value?.native);
    el('recall-coverage').textContent=[typeof value==='string'?value:value?.text,counts.join(' · ')].filter(Boolean).join('\n');
  }
  function resultRow(result,version,scope){
    const row=make('article','','recall-result');rowData.set(row,result);if(result.session_id)row.dataset.session=result.session_id;if(result.thread_id)row.dataset.thread=result.thread_id;row.dataset.kind=result.kind;
    if(result.item_id)row.dataset.item=result.item_id;if(result.followup_id)row.dataset.followup=result.followup_id;
    const name=result.session_name || result.title || result.name || result.cwd || 'Saved conversation';
    const kind={activity:'Cached activity','native-activity':'Indexed native activity',draft:'Saved draft',followup:'Prepared follow-up'}[result.kind] || 'Saved content';
    row.append(make('h3',name),make('p',kind+(result.archived?' · Archived locally':''),'recall-kind'),
      make('p',`${result.cwd || ''}\n${options.profileLabel(result.profile)}${result.kind==='native-activity' && result.provider?' · '+result.provider:''}`,'recall-binding'),snippet(result.snippet,result.match_text));
    if(Number.isFinite(result.updated) && result.updated>0){
      const date=new Date(result.updated*1000);
      if(!Number.isNaN(date.getTime())){const time=make('time',date.toLocaleString(),'recall-updated');time.dateTime=date.toISOString();row.append(time);}
    }
    const action=make('button',{activity:'Open matching activity','native-activity':'Continue this conversation',draft:'Go to saved draft',followup:'Go to prepared follow-up'}[result.kind] || 'Open saved content','recall-open');action.type='button';
    action.setAttribute('aria-label',action.textContent+' in '+name);
    const notice=make('p','','recall-result-status');notice.setAttribute('role','status');notice.hidden=true;
    if(['native-activity','activity'].includes(result.kind) && result.thread_id){
      const read=make('button','Read original conversation','recall-read');read.type='button';
      read.setAttribute('aria-label','Read original conversation in '+name);
      read.onclick=()=>DeskHistoryReader.show(result,{valid:()=>current(version,scope) && row.isConnected});
      row.append(read);
    }
    action.onclick=()=>reveal(result,row,notice,version,scope);row.append(action,notice);return row;
  }
  async function search(){
    if(!options)return;
    const scope=query();
    if(scope.q.length<2 || scope.q.length>200){
      el('recall-error').textContent='Enter 2–200 characters from a saved message, tool result or prepared task.';
      el('recall-error').hidden=false;el('recall-query').focus();return;
    }
    const version=++searchVersion;++openVersion;++navigationVersion;pendingNavigation=null;resultOpening=false;searching=true;
    emptySearch=false;
    lastSearch={version,scope,navigation:navigationVersion,selected:options.selected(),generation:options.generation()};
    if(scanRefresh)scanRefresh.search=lastSearch;
    el('recall-error').hidden=true;el('recall-results').replaceChildren();
    el('recall-summary').textContent='Searching saved content…';buttons();
    const params=new URLSearchParams({q:scope.q,archived:String(scope.archived),limit:'30'});
    if(scope.cwd)params.set('cwd',scope.cwd);
    try{
      const data=await options.api('/api/recall?'+params);
      if(!current(version,scope))return;
      const rows=Array.isArray(data.results)?data.results:[];
      for(const result of rows)if(result.kind==='native-activity' && result.cwd)nativeProjects.add(result.cwd);projects();
      el('recall-results').replaceChildren(...rows.map(result=>resultRow(result,version,scope)));
      const total=Number.isFinite(data.total)?data.total:rows.length;
      emptySearch=rows.length===0;
      el('recall-summary').textContent=rows.length
        ? `Showing ${rows.length} of ${total} matching item${total===1?'':'s'}.`+(data.truncated?' More matches exist — narrow the query or project.':'')
        : 'No saved content matches this query in the selected scope.';
      coverage(data.coverage);
    }catch(error){if(current(version,scope)){
      el('recall-summary').textContent='Saved content could not be searched. Choose Search to retry.';
      el('recall-error').textContent=error.message;el('recall-error').hidden=false;
    }}finally{if(current(version,scope)){searching=false;buttons();indexContext();refreshAfterScan();}}
  }
  function targetFor(result){
    const matches=node=>node && typeof result.match_text==='string' && result.match_text &&
      (['INPUT','TEXTAREA'].includes(node.tagName)?node.value:node.textContent).includes(result.match_text);
    if(['activity','native-activity'].includes(result.kind)){
      const node=options.itemNode(result.item_id), turn=options.itemTurn(result.item_id);
      if(!node?.isConnected || node.hidden || !matches(node) || (result.kind==='native-activity'?turn!==result.turn_id:(result.turn_id && turn && turn!==result.turn_id)))return null;
      return node;
    }
    if(result.kind==='draft')return el('task').hidden || !matches(el('prompt'))?null:el('prompt');
    if(result.kind==='followup'){
      // Match IDs as data, not as a selector assembled from untrusted content.
      const row=[...el('followup-list').children].find(node=>node.dataset.followup===result.followup_id);
      const node=row?.querySelector('textarea, pre');return matches(node)?node:null;
    }
    return null;
  }
  function expand(node,result){
    if(result.kind==='followup')el('followups').open=true;
    for(const details of node.querySelectorAll('details'))details.open=true;
    for(let parent=node.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
  }
  function focusMatch(nav){
    if(nav.version!==navigationVersion || el('recall').open || nav.session!==options.selected() || nav.generation!==options.generation() || !nav.node.isConnected)return;
    clearTarget();const node=nav.node, addedTabindex=!node.hasAttribute('tabindex') && !['INPUT','TEXTAREA','BUTTON','SELECT'].includes(node.tagName);
    if(addedTabindex)node.tabIndex=-1;
    node.classList.add('recall-target');target={...nav,addedTabindex};node.focus({preventScroll:true});node.scrollIntoView({block:'center',behavior:'instant'});
    // Long command/MCP evidence can itself scroll. Reveal the matching line
    // without rewriting Markdown, changing selection or inserting source HTML.
    if(['activity','native-activity'].includes(nav.result.kind) && nav.result.match_text){
      const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);
      let textNode;while((textNode=walker.nextNode())){
        const at=textNode.data.indexOf(nav.result.match_text);if(at<0)continue;
        const pre=textNode.parentElement.closest('pre');if(!pre)break;
        const range=document.createRange();range.setStart(textNode,at);range.setEnd(textNode,at+nav.result.match_text.length);
        const rect=range.getBoundingClientRect(), box=pre.getBoundingClientRect();
        pre.scrollTop+=rect.top-box.top-pre.clientHeight/2;break;
      }
    }
  }
  async function reveal(result,row,notice,version,scope){
    if(resultOpening || !current(version,scope))return;
    const ticket=++openVersion;resultOpening=true;notice.hidden=false;notice.textContent='Opening saved work…';buttons();
    const valid=()=>ticket===openVersion && current(version,scope) && row.isConnected;
    let expectedGeneration=options.generation();
    try{
      if(result.kind==='native-activity'){
        notice.textContent='Reading and opening the matching native conversation…';
        const imported=await options.api('/api/import',{thread:result.thread_id,profile:'default'});
        if(!valid())return;
        if(expectedGeneration!==options.generation())throw new Error('The selected conversation changed. Choose this result again to open it.');
        await options.refresh();if(!valid())return;
        if(expectedGeneration!==options.generation())throw new Error('The selected conversation changed. Choose this result again to open it.');
        const binding=options.state().sessions.find(s=>s.id===imported.id);
        if(!binding || binding.thread_id!==result.thread_id || binding.profile!=='default')throw new Error('The matching native conversation could not be bound in Desk. Choose this result again.');
        result={...result,session_id:imported.id};
      }
      let saved=options.state().sessions.find(s=>s.id===result.session_id);
      // An earlier explicit import can finish after its query was replaced. Its
      // binding is real, but the visible state must be reconciled on this click.
      if(!saved){await options.refresh();if(!valid())return;saved=options.state().sessions.find(s=>s.id===result.session_id);}
      if(!saved)throw new Error('This session is no longer in Desk. Its search result is kept here.');
      if(saved.archived){
        await options.api('/api/archive',{session:result.session_id,archived:false});
        if(!valid())return;
        await options.refresh();if(!valid())return;
      }
      if(expectedGeneration!==options.generation())throw new Error('The selected conversation changed. Choose this result again to open it.');
      if(options.selected()!==result.session_id || !options.loaded()){
        const opening=options.open(result.session_id,{revealLatest:false});expectedGeneration=options.generation();await opening;
        if(!valid())return;
      }
      if(expectedGeneration!==options.generation())throw new Error('The selected conversation changed before this result could be shown. Choose it again.');
      if(options.selected()!==result.session_id || !options.loaded())throw new Error('This session could not be opened. Its search result is kept here; check the session error and retry.');
      if(result.kind==='followup'){await options.refreshFollowups(result.session_id);if(!valid())return;}
      if(expectedGeneration!==options.generation() || options.selected()!==result.session_id || !options.loaded())throw new Error('The selected conversation changed before the matching preparation could be shown. Choose this result again.');
      const node=targetFor(result);
      if(!node){
        notice.textContent=['activity','native-activity'].includes(result.kind)
          ? 'The saved match is not in the freshly loaded native activity. This cached result is kept here; no task or handoff was started.'
          : 'The saved phrase is no longer in the current preparation. Your current text and this search result are kept; search again to refresh the match.';
        return;
      }
      expand(node,result);notice.textContent='Opened saved content. Nothing was sent.';
      pendingNavigation={node,result,session:result.session_id,generation:expectedGeneration,version:++navigationVersion};
      el('recall').close();
    }catch(error){if(valid()){notice.textContent=error.message;notice.hidden=false;}}
    finally{if(ticket===openVersion){resultOpening=false;buttons();}}
  }
  function show(){
    ++navigationVersion;pendingNavigation=null;projects();
    const version=searchVersion,scope=query();
    for(const row of el('recall-results').children){const result=rowData.get(row);
      if(result){
        row.querySelector('.recall-open').onclick=()=>reveal(result,row,row.querySelector('.recall-result-status'),version,scope);
        const read=row.querySelector('.recall-read');
        if(read)read.onclick=()=>DeskHistoryReader.show(result,{valid:()=>current(version,scope) && row.isConnected});
      }
    }
    el('recall').showModal();el('recall-query').focus();
    scanReady=false;scanIssue=false;el('recall-index-error').hidden=true;scanButtons();readScan();
  }
  function configure(value){
    options=value;projects();
    el('search-saved-content').onclick=show;el('home-content').onclick=show;
    el('recall-index').onclick=()=>controlScan();el('recall-index-cancel').onclick=()=>controlScan(true);
    el('recall-index-retry').onclick=()=>scanIssue?readScan():controlScan();
    el('recall-form').onsubmit=event=>{event.preventDefault();search();};
    el('recall-query').oninput=invalidate;el('recall-project').onchange=invalidate;el('recall-archived').onchange=invalidate;
    el('recall-close').onclick=()=>el('recall').close();
    el('recall').addEventListener('close',()=>{
      stopScanPolling();++scanVersion;scanReading=false;scanReady=false;scanRefresh=null;
      const nav=pendingNavigation;pendingNavigation=null;++searchVersion;++openVersion;
      if(searching)el('recall-summary').textContent='Search canceled. Choose Search to try again.';
      searching=false;resultOpening=false;buttons();
      // show() rebinds retained results to the next dialog generation.
      if(nav)requestAnimationFrame(()=>focusMatch(nav));
    });
    el('recall').addEventListener('cancel',()=>{pendingNavigation=null;++navigationVersion;});
  }
  return {configure,stateChanged,selectionChanged};
})();
