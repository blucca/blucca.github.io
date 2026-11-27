const $ = id => document.getElementById(id);
function consumeDeskAccessFragment(){
  const accessFragment = new URLSearchParams(window.location.hash.slice(1));
  if(!accessFragment.has('access'))return false;
  sessionStorage.setItem('codex-desk-access',accessFragment.get('access'));
  window.history.replaceState(null,'',window.location.pathname+window.location.search);
  return true;
}
consumeDeskAccessFragment();
window.addEventListener('hashchange',()=>{if(consumeDeskAccessFragment())window.location.reload();});
function deskAccessHeaders(headers={}){
  const token=sessionStorage.getItem('codex-desk-access');
  if(token)headers['X-Codex-Desk-Access']=token;
  return headers;
}
let state = {profiles: [], sessions: []}, selected = null, after = 0, items = new Map(), requests = new Map();
const nodes = new Map(), itemTurns = new Map(), collaborationGroups = new Map();
const collaborationTypes = new Set(['collabAgentToolCall', 'subAgentActivity']);
let nativeThreadId = null, currentTurn = null;
let modeSelected=null, generation=0, opening=false, refreshVersion=0, nativeFailureSignature='';
const drafts=new Map(), submitting=new Set();
let projectVersion=0, projectCursor=null, projectQuery=null, projectOpening=false;
let latestUpdates=0, statePollAt=0;
const draftWriter=crypto.randomUUID();
const draftEdits=new Map(), draftRevisions=new Map(), draftModes=new Map(), draftSaved=new Map(), draftLoads=new Map(), draftSaves=new Map(), draftTimers=new Map(), draftConflicts=new Map(), draftMessages=new Map();
function draftStatus(id=selected){
  if(id!==selected)return;
  $('draft-status').textContent=draftMessages.get(id) || 'Unsent task drafts stay private in your local Desk database.';
  $('draft-conflict').hidden=!draftConflicts.has(id);
}
function rememberDraft(id){if(!id || (opening && !draftRevisions.has(id)))return;const text=$('prompt').value,mode=$('turn-mode').value;if(drafts.get(id)!==text || draftModes.get(id)!==mode)draftEdits.set(id,(draftEdits.get(id) || 0)+1);drafts.set(id,text);draftModes.set(id,mode);}
async function loadDraft(id,current=generation){
  if(draftRevisions.has(id)){if(current===generation && selected===id){$('prompt').value=drafts.get(id) || '';if(draftModes.has(id)){$('turn-mode').value=draftModes.get(id);modeSelected=id;}draftStatus(id);}return;}
  if(!draftLoads.has(id))draftLoads.set(id,(async()=>{
    try{
      const saved=await api('/api/draft?session='+encodeURIComponent(id));
      if((draftRevisions.get(id) ?? -1)>saved.revision)return;
      draftRevisions.set(id,saved.revision);draftSaved.set(id,saved);
      if(!drafts.has(id)){drafts.set(id,saved.text);draftModes.set(id,saved.mode);}
      draftMessages.set(id,saved.text?'Saved draft restored. Nothing has been sent.':'Unsent task drafts stay private in your local Desk database.');
    }catch(e){draftMessages.set(id,'Draft not saved: '+e.message);}
    finally{draftLoads.delete(id);}
  })());
  await draftLoads.get(id);
  if(current===generation && selected===id){$('prompt').value=drafts.get(id) || '';if(draftModes.has(id)){$('turn-mode').value=draftModes.get(id);modeSelected=id;}draftStatus(id);}
}
function persistDraft(id){
  clearTimeout(draftTimers.get(id));draftTimers.delete(id);
  const previous=draftSaves.get(id) || Promise.resolve();
  const pending=previous.then(async()=>{
    await loadDraft(id,-1);
    if(draftConflicts.has(id))return false;
    if(!draftRevisions.has(id))return false;
    const text=drafts.get(id) || '', mode=draftModes.get(id) || 'native', saved=draftSaved.get(id);
    if(saved && saved.text===text && saved.mode===mode){draftMessages.set(id,'Draft saved locally. Nothing has been sent.');draftStatus(id);return true;}
    draftMessages.set(id,'Saving draft…');draftStatus(id);
    try{
      const next=await api('/api/draft',{session:id,text,mode,revision:draftRevisions.get(id),writer:draftWriter,sequence:draftEdits.get(id) || 0});
      draftRevisions.set(id,next.revision);draftSaved.set(id,next);
      draftMessages.set(id,'Draft saved locally. Nothing has been sent.');draftStatus(id);return true;
    }catch(e){
      if(e.status===409 && e.current){draftConflicts.set(id,e.current);draftMessages.set(id,'This session’s draft changed in another tab. Choose which preparation to keep.');}
      else draftMessages.set(id,'Draft not saved: '+e.message);
      draftStatus(id);return false;
    }
  });
  const tracked=pending.finally(()=>{if(draftSaves.get(id)===tracked)draftSaves.delete(id);});
  draftSaves.set(id,tracked);return tracked;
}
function scheduleDraft(id){
  clearTimeout(draftTimers.get(id));draftMessages.set(id,'Unsaved draft…');draftStatus(id);
  draftTimers.set(id,setTimeout(()=>persistDraft(id),350));
}
$('draft-keep').onclick=()=>{const id=selected,current=draftConflicts.get(id);if(!current)return;draftRevisions.set(id,current.revision);draftSaved.set(id,current);draftConflicts.delete(id);draftEdits.set(id,(draftEdits.get(id) || 0)+1);persistDraft(id);};
$('draft-load').onclick=()=>{const id=selected,current=draftConflicts.get(id);if(!current)return;draftRevisions.set(id,current.revision);draftSaved.set(id,current);drafts.set(id,current.text);draftModes.set(id,current.mode);draftConflicts.delete(id);draftEdits.set(id,(draftEdits.get(id) || 0)+1);$('prompt').value=current.text;$('turn-mode').value=current.mode;modeSelected=id;draftMessages.set(id,'Saved draft loaded. Nothing has been sent.');draftStatus(id);};
window.addEventListener('pagehide',()=>{
  if(selected)rememberDraft(selected);
  // A debounced save can already be waiting behind an in-flight response.
  for(const id of new Set([...draftTimers.keys(),...draftSaves.keys()])){clearTimeout(draftTimers.get(id));if(draftRevisions.has(id) && !draftConflicts.has(id))fetch('/api/draft',{method:'POST',headers:deskAccessHeaders({'Content-Type':'application/json'}),body:JSON.stringify({session:id,text:drafts.get(id) || '',mode:draftModes.get(id) || 'native',revision:draftRevisions.get(id),writer:draftWriter,sequence:draftEdits.get(id) || 0}),keepalive:true}).catch(()=>{});}
});
function nearLatest(){return window.scrollY+window.innerHeight >= document.documentElement.scrollHeight-140;}
function latestLabel(){
  $('latest-output').textContent=latestUpdates?`${latestUpdates} new update${latestUpdates===1?'':'s'} · Latest output ↓`:'Latest output ↓';
}
function goLatest(){
  latestUpdates=0;latestLabel();
  window.scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'});
}
$('latest-output').onclick=goLatest;
async function api(path, data) {
  const headers=deskAccessHeaders(data ? {'Content-Type':'application/json'} : {});
  const r = await fetch(path, data ? {method:'POST', headers, body:JSON.stringify(data)} : {headers});
  const v = await r.json(); if (!r.ok) {const e=new Error(v.error || 'Request failed');e.status=r.status;e.current=v.current;throw e;} return v;
}
function error(e) { $('error').textContent = e.message; $('error').hidden = false; }
function make(tag, text, cls) { const node = document.createElement(tag); if(text) node.textContent=text; if(cls) node.className=cls; return node; }
function profileLabel(id){return state.profiles.find(p=>p.id===id || p.legacy_id===id)?.name || id;}
const archiving=new Set();
function activeSession(s){return ['starting','running','approval'].includes(s.status);}
function sidebarGroups(){
  if(Array.isArray(state.organized))return state.organized;
  const groups=new Map();
  for(const s of state.sessions){
    if(!groups.has(s.cwd))groups.set(s.cwd,{cwd:s.cwd,name:s.cwd.split(/[\\/]/).filter(Boolean).at(-1) || s.cwd,active:[],recent:[],archived:[]});
    groups.get(s.cwd)[activeSession(s)?'active':s.archived?'archived':'recent'].push(s);
  }
  return [...groups.values()].sort((a,b)=>Number(!!b.active.length)-Number(!!a.active.length));
}
function drawSidebar(){
  $('session-tools').hidden=state.sessions.length===0;
  const list=$('sessions'), left=list.scrollLeft, top=list.scrollTop;
  const focused=document.activeElement, focusedRow=list.contains(focused)?focused.closest('.session-row'):null;
  const focusedControl=focusedRow && (focused.classList.contains('session-archive')?'archive':focused.classList.contains('session')?'session':null);
  const focusedSession=focusedControl?focusedRow.dataset.session:null;let restoreFocus=null;
  list.replaceChildren();
  const query=$('session-filter').value.trim().normalize('NFC').toLocaleLowerCase(), showArchived=$('show-archived').checked;
  const current=new Map(state.sessions.map(s=>[s.id,s]));let visible=0;
  for(const group of sidebarGroups()){
    const sections={active:[],recent:[],archived:[]}, seen=new Set();
    for(const saved of [...group.active,...group.recent,...group.archived]){
      const s=current.get(saved.id);if(!s || seen.has(s.id))continue;seen.add(s.id);
      const active=activeSession(s);
      const matches=!query || `${s.name || ''} ${group.name} ${group.cwd}`.normalize('NFC').toLocaleLowerCase().includes(query);
      if(!active && (!matches || (s.archived && !showArchived)))continue;
      sections[active?'active':s.archived?'archived':'recent'].push(s);
    }
    if(!Object.values(sections).some(rows=>rows.length))continue;
    const section=make('section','','project-group');section.dataset.cwd=group.cwd;
    section.append(make('h3',group.name,'project-name'),make('p',group.cwd,'project-path'));
    for(const [kind,rows] of Object.entries(sections)){
      if(!rows.length)continue;
      section.append(make('h4',`${kind[0].toUpperCase()+kind.slice(1)} · ${rows.length}`,'session-category'));
      for(const s of rows){
        const row=make('div','','session-row');row.dataset.session=s.id;
        const b=make('button','','session'+(s.id===selected?' selected':''));b.title=s.cwd;
        b.type='button';if(s.id===selected)b.setAttribute('aria-current','page');
        b.append(make('strong',s.name || group.name),make('small',`${profileLabel(s.profile)} · ${s.status}${s.archived?' · archived locally':''}`));
        b.onclick=()=>open(s.id);
        const archive=make('button',s.archived?'Restore':'Archive','session-archive');archive.type='button';
        archive.setAttribute('aria-label',`${s.archived?'Restore':'Archive'} saved session ${s.name || group.name}`);
        archive.disabled=archiving.has(s.id);archive.onclick=()=>setArchived(s.id,!s.archived);
        if(s.id===focusedSession)restoreFocus=focusedControl==='archive'?archive:b;
        row.append(b,archive);section.append(row);++visible;
      }
    }
    list.append(section);
  }
  if(!visible && state.sessions.length)list.append(make('p',query?'No saved titles or project folders match.':'No recent saved sessions. Open a project or show archived sessions.','muted'));
  $('session-count').textContent=`${visible} shown · ${state.sessions.length} saved${state.sessions.some(s=>activeSession(s))?' · active tasks stay visible':''}`;
  if(restoreFocus && !restoreFocus.disabled)restoreFocus.focus({preventScroll:true});
  list.scrollLeft=left;list.scrollTop=top;
}
async function setArchived(id,archived){
  if(archiving.has(id))return;
  archiving.add(id);$('organization-error').hidden=true;draw();
  try{await api('/api/archive',{session:id,archived});await refresh();}
  catch(e){$('organization-error').textContent=e.message;$('organization-error').hidden=false;}
  finally{archiving.delete(id);draw();}
}
$('session-filter').oninput=()=>drawSidebar();
$('show-archived').onchange=()=>drawSidebar();
$('archive-session').onclick=()=>{const s=state.sessions.find(s=>s.id===selected);if(s)setArchived(s.id,!s.archived);};
function draw() {
  drawSidebar();
  const running=state.sessions.filter(s=>['running','approval','starting'].includes(s.status)).length;
  document.title=(running?`(${running} active) `:'')+'Codex Desk';
  $('activity-controls').hidden=!selected;
  const s = state.sessions.find(s=>s.id===selected); if(!s) return;
  $('archive-session').hidden=false;$('archive-session').textContent=s.archived?'Restore session':'Archive session';
  $('archive-session').disabled=archiving.has(s.id);
  $('archive-status').hidden=!s.archived;
  $('archive-status').textContent=activeSession(s)?'Archived locally. This active task stays visible.':'Archived locally. Restore it to show in Recent.';
  $('title').textContent=s.name || s.cwd.split(/[\\/]/).filter(Boolean).at(-1);$('rename').hidden=false;
  $('binding').textContent=`${s.cwd}\n${profileLabel(s.profile)} → ${s.provider || 'loading'} / ${s.model || 'native default'}`;
  if(modeSelected!==selected){$('turn-mode').value=s.mode || 'native';modeSelected=selected;}
  const busy=opening || submitting.has(selected) || ['running','approval','starting'].includes(s.status);
  DeskFollowups.status(selected,busy);$('prepare-followup').disabled=opening || submitting.has(selected);
  $('turn-mode').disabled=opening;
  $('status').textContent=opening?'Opening session…':s.status; $('send').disabled=busy || DeskFollowups.blocked(selected);
  $('stop').disabled=opening || !['running','approval'].includes(s.status);
  $('rename').disabled=opening;$('handoff').disabled=opening;
  $('usage').textContent=DeskNativeState.usage(s.usage);
  $('native-failure').hidden=!s.error || s.status!=='failed' || opening;
  const failureKey=$('native-failure').hidden?'':JSON.stringify([selected,s.error]);
  if(failureKey!==nativeFailureSignature){nativeFailureSignature=failureKey;$('native-failure').replaceChildren(...(failureKey?[DeskNativeState.card(s.error,false,make)]:[]));}
}
function itemText(i) {
  switch(i.type) {
    case 'userMessage':return (i.content || []).map(c=>c.text || '').join('\n');
    case 'agentMessage':return i.text || '';
    case 'commandExecution':return `$ ${i.command || ''}\n${i.aggregatedOutput || ''}${i.exitCode == null ? '' : '\nExit '+i.exitCode}`;
    case 'fileChange':return (i.changes || []).map(c=>`${c.kind?.type || 'change'} ${c.path}\n${c.diff || ''}`).join('\n');
    case 'reasoning':return (i.summary || []).join('\n');
    case 'mcpToolCall':case 'dynamicToolCall':return DeskEvidence.tool(i);
    case 'collabAgentToolCall':case 'subAgentActivity':return DeskEvidence.collaboration(i);
    default:return i.text || JSON.stringify(i, null, 2);
  }
}
function updateCollaboration(group) {
  const agents=new Set();let errors=false;
  for(const id of group.ids) {
    const item=items.get(id);
    if(!item)continue;
    if(typeof item.agentThreadId==='string' && item.agentThreadId)agents.add(item.agentThreadId);
    for(const id of Array.isArray(item.receiverThreadIds)?item.receiverThreadIds:[])if(typeof id==='string' && id)agents.add(id);
    if(item.status==='failed')errors=true;
    const states=item.agentsStates && typeof item.agentsStates==='object' && !Array.isArray(item.agentsStates)?item.agentsStates:{};
    for(const [id,value] of Object.entries(states)) {
      if(id==='_meta' || !value || typeof value!=='object' || Array.isArray(value))continue;
      if(id)agents.add(id);
      if(value?.status==='errored' || value?.status==='notFound')errors=true;
    }
  }
  group.summary.textContent='Sub-agents' + (agents.size?' · '+agents.size+' '+(agents.size===1?'agent':'agents'):'') +
    ' · '+group.ids.size+' '+(group.ids.size===1?'activity':'activities')+(errors?' · Errors reported':'');
}
function collaborationGroup(turn) {
  let group=collaborationGroups.get(turn);
  if(!group) {
    const node=make('details','','activity-collaboration'), summary=make('summary'), body=make('div','','activity-collaboration-items');
    node.dataset.collaborationTurn=turn;
    node.append(summary,body);$('activity').append(node);
    group={node,summary,body,ids:new Set()};collaborationGroups.set(turn,group);
    // The outer disclosure stays quiet during live work and completion. Native
    // details state preserves the reader's deliberate open/closed choice.
  }
  return group;
}
function renderItem(i,turnId) {
  const prior=items.get(i.id);if(prior?.progress && !i.progress)i.progress=prior.progress;
  const turn=turnId || itemTurns.get(i.id) || currentTurn || 'unscoped';
  itemTurns.set(i.id,turn);items.set(i.id,i);
  let node=nodes.get(i.id);const text=itemText(i);
  if(!node) {node=make('div','','item '+i.type);nodes.set(i.id,node);}
  if(collaborationTypes.has(i.type)) {
    const group=collaborationGroup(turn);
    if(node.parentNode!==group.body)group.body.append(node);
    group.ids.add(i.id);updateCollaboration(group);
  } else if(!node.parentNode)$('activity').append(node);
  DeskActivity.render(node,i,text);
}
let approvalsSignature='';
function approvals() {
  const signature=JSON.stringify([selected,[...requests]]);
  if(signature===approvalsSignature)return;
  approvalsSignature=signature;
  $('approvals').replaceChildren();
  for(const [id,m] of requests) {
    const session=selected, current=generation;
    const p=m.params || {}, box=make('div',`${m.method}\n${p.command || p.reason || 'Native Codex needs your input.'}`, 'approval');
    if(['item/commandExecution/requestApproval','item/fileChange/requestApproval'].includes(m.method)) {
      const buttons=make('div','','actions');
      for(const [label,decision] of [['Allow once','accept'],['Decline','decline']]) {
        const b=make('button',label); b.onclick=async()=>{try{await api('/api/approval',{session,request:id,decision});if(current===generation){requests.delete(id);approvals();}}catch(e){if(current===generation)error(e)}};buttons.append(b);
      } box.append(buttons);
    } else if(m.method==='item/tool/requestUserInput') {
      const form=make('form'), fields=new Map();
      for(const q of p.questions || []) {
        const label=make('label',q.header+' — '+q.question);
        const input=make(q.options?.length && !q.isOther?'select':'input');
        if(input.tagName==='SELECT') for(const o of q.options) {const option=make('option',o.label+' — '+o.description);option.value=o.label;input.append(option);}
        else {input.type=q.isSecret?'password':'text';input.required=true;input.autocomplete='off';if(q.options?.length)input.placeholder=q.options.map(o=>o.label).join(' / ');}
        label.append(input);form.append(label);fields.set(q.id,input);
      }
      const submit=make('button','Send answers');form.append(submit);
      form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;try{const answers=Object.fromEntries([...fields].map(([id,input])=>[id,[input.value]]));await api('/api/answer',{session,request:id,answers});if(current===generation){requests.delete(id);approvals();await refresh();}}catch(e){if(current===generation){error(e);submit.disabled=false;}}};
      box.append(form);
    } else box.append(make('p','Use Stop turn for this interaction; a dedicated UI is not implemented yet.'));
    $('approvals').append(box);
  }
}
function consume(m) {
  const p=m.params || {};
  // Old cached streams may contain owned child notifications. Keep native
  // requests/resolutions, but never display a child as the selected parent.
  if(p.threadId && nativeThreadId && p.threadId!==nativeThreadId && m.id===undefined && m.method!=='serverRequest/resolved')return;
  if(m.method==='turn/started')currentTurn=p.turn?.id || p.turnId || currentTurn;
  if(m.id !== undefined && m.method) {requests.set(String(m.id),m);approvals();}
  if(m.method==='serverRequest/resolved') {requests.delete(String(p.requestId));approvals();}
  if(m.method==='item/started' || m.method==='item/completed') renderItem(p.item,p.turnId);
  if(m.method==='item/agentMessage/delta') {
    const i=items.get(p.itemId) || {id:p.itemId,type:'agentMessage',text:''};i.text+=p.delta || '';renderItem(i,p.turnId);
  }
  if(m.method==='item/commandExecution/outputDelta') {
    const i=items.get(p.itemId) || {id:p.itemId,type:'commandExecution',aggregatedOutput:''};i.aggregatedOutput=(i.aggregatedOutput || '')+(p.delta || '');renderItem(i,p.turnId);
  }
  if(m.method==='item/mcpToolCall/progress') {
    const i=items.get(p.itemId) || {id:p.itemId,type:'mcpToolCall',status:'inProgress'};
    i.progress=[...(i.progress || []),p.message].slice(-50);renderItem(i,p.turnId);
  }
  if(m.method==='error')$('activity').append(DeskNativeState.card(p.error || p,!!p.willRetry,make));
}
async function refresh() {
  const current=generation, version=++refreshVersion, next=await api('/api/state');
  if(current!==generation || version!==refreshVersion)return;
  state=next;DeskFollowups.refresh(selected);requests=new Map((state.pending?.[selected] || []).map(m=>[String(m.id),m]));approvals();draw();DeskRecall.stateChanged();if($('profiles-dialog').open)drawProfiles();
}
async function open(id,{revealLatest=true,keepError=false}={}) {
  if(selected){rememberDraft(selected);persistDraft(selected);}
  const current=++generation;
  latestUpdates=0;latestLabel();
  selected=id;$('welcome').hidden=true;DeskRecall.selectionChanged();DeskFollowups.select(id);$('prompt').value=drafts.get(id) || '';opening=true;modeSelected=null;after=0;items.clear();nodes.clear();itemTurns.clear();collaborationGroups.clear();nativeThreadId=null;currentTurn=null;requests.clear();
  if(!keepError)$('error').hidden=true;
  $('native-failure').hidden=true;$('task').hidden=true;$('handoff').hidden=true;
  $('activity').replaceChildren();approvals();draw();draftStatus();
  const preparation=loadDraft(id,current);
  try {
    const opened=await api('/api/open',{session:id});
    if(current!==generation)return;
    localStorage.setItem('codex-desk-browser-preview-session-v1',id);
    nativeThreadId=opened.thread.id;
    for(const [index,t] of (opened.thread.turns || []).entries())for(const i of t.items || [])renderItem(i,t.id || 'snapshot:'+index);
    $('prompt').value=drafts.get(id) || '';$('welcome').hidden=true;
    await refresh();
    if(current!==generation)return;
    await preparation;if(current!==generation)return;
    opening=false;draw();$('task').hidden=false;$('handoff').hidden=false;
    if(revealLatest)requestAnimationFrame(()=>{if(current===generation)goLatest();});
    return true;
  } catch(e) {
    if(current===generation){opening=false;draw();error(e);}
    return {error:e};
  }
}
function profileInfo() {
  const p=state.profiles.find(p=>p.id===$('profile').value);
  $('profile-info').textContent=p?`${p.provider || 'Current default'} / ${p.model || 'Configured model'}${p.endpoint?' · '+p.endpoint:''}`:'';
}
function resetProject() {
  ++projectVersion;projectCursor=null;projectQuery=null;projectOpening=false;
  $('project-list').replaceChildren();$('project-results').hidden=true;$('project-more').hidden=true;
  $('project-error').hidden=true;projectBusy(false);
}
function projectBusy(busy) {
  for(const id of ['cwd','profile','project-search','session-name','project-find','project-more','project-new'])$(id).disabled=busy;
  for(const b of $('project-list').querySelectorAll('button'))b.disabled=busy;
}
function projectFilter() {return {cwd:$('cwd').value,search:$('project-search').value.trim()};}
function projectCurrent(version, query) {
  const current=projectFilter();
  return version===projectVersion && $('project').open && query.cwd===current.cwd && query.search===current.search;
}
function historyPath(search, cwd=null, cursor=null) {
  const params=new URLSearchParams();
  if(search)params.set('search',search);
  if(cwd!==null)params.set('cwd',cwd);
  if(cursor)params.set('cursor',cursor);
  const query=params.toString();return '/api/native'+(query?'?'+query:'');
}
function projectSummary(query) {
  const count=$('project-list').children.length;
  $('project-summary').textContent=count
    ? (query.search?`Saved conversations with titles matching “${query.search}”. `:'')+'Choose a saved conversation to keep its context, or start a new one.'
    : (query.search?`No saved conversation titles match “${query.search}” in this project.`:'No saved conversations in this project.')+' Start a new conversation below.';
}
function projectError(e) {$('project-error').textContent=e.message;$('project-error').hidden=false;}
async function findProject(cursor=null) {
  if(projectOpening)return;
  if(cursor && (cursor!==projectCursor || !projectQuery || !projectCurrent(projectVersion,projectQuery) || $('project-more').disabled))return;
  if(!cursor)resetProject();
  const current=projectVersion, query=projectFilter();projectQuery=query;
  $('project-error').hidden=true;$('project-find').disabled=true;$('project-more').disabled=true;
  $('project-results').hidden=false;$('project-summary').textContent=query.search?`Searching conversation titles for “${query.search}”…`:'Looking for saved conversations…';
  try {
    const data=await api(historyPath(query.search,query.cwd,cursor));
    if(!projectCurrent(current,query))return;
    for(const t of data.data || []) {
      const valid=()=>projectCurrent(current,query) && !projectOpening && row.isConnected && row.parentElement===$('project-list');
      const row=nativeRow(t,
        ()=>openProjectChoice(()=>api('/api/import',{thread:t.id,profile:$('profile').value}),current,query),null,'Resume this conversation',
        ()=>{if(valid())return DeskHistoryReader.show({thread_id:t.id,cwd:t.cwd},
          {valid,backLabel:'Back to project results',onReturn:()=>{
            const read=row.querySelector('.native-read');if(valid() && read && !read.disabled)read.focus({preventScroll:true});
          }});});
      row.dataset.cursor=cursor || '';row.dataset.thread=t.id;$('project-list').append(row);
    }
    projectCursor=data.nextCursor;$('project-more').hidden=!projectCursor;
    projectSummary(query);
    if(projectOpening)projectBusy(true);
  } catch(e) {
    if(projectCurrent(current,query)){if(!cursor)$('project-results').hidden=true;else projectSummary(query);projectError(e);}
  } finally {
    if(projectCurrent(current,query)){$('project-find').disabled=projectOpening;$('project-more').disabled=projectOpening;}
  }
}
async function openProjectChoice(action, current=projectVersion, query=projectFilter()) {
  if(projectOpening || !projectCurrent(current,query))return;
  projectOpening=true;projectBusy(true);$('project-error').hidden=true;
  try {
    const r=await action();if(!projectCurrent(current,query))return;
    $('project').close();await open(r.id);
  } catch(e) {if(projectCurrent(current,query))projectError(e);}
  finally {if(current===projectVersion){projectOpening=false;projectBusy(false);}}
}
$('new').onclick=()=>{resetProject();fillProfiles($('profile'));profileInfo();$('project').showModal();};
$('profile').onchange=profileInfo;$('cancel').onclick=()=>$('project').close();
$('cwd').oninput=resetProject;$('project-search').oninput=resetProject;
$('project').addEventListener('close',()=>{if(!$('project').open)resetProject();});
$('create').onsubmit=async e=>{e.preventDefault();await findProject();};
$('project-more').onclick=()=>findProject(projectCursor);
$('project-new').onclick=()=>{if($('create').reportValidity())return openProjectChoice(()=>api('/api/sessions',{cwd:$('cwd').value,profile:$('profile').value,name:$('session-name').value.trim() || null}));};
$('prompt').oninput=()=>{if(selected){rememberDraft(selected);scheduleDraft(selected);}};
$('turn-mode').onchange=()=>{if(selected){rememberDraft(selected);scheduleDraft(selected);}};
DeskFollowups.configure({api,make,selected:()=>selected,refresh});
DeskHistoryReader.configure({api});
DeskRecall.configure({api,make,state:()=>state,selected:()=>selected,generation:()=>generation,
  loaded:()=>!opening && !!nativeThreadId && !$('task').hidden,open,refresh,profileLabel,
  itemNode:id=>nodes.get(id),itemTurn:id=>itemTurns.get(id),refreshFollowups:id=>DeskFollowups.refresh(id)});
$('prepare-followup').onclick=async()=>{
  if(!selected || opening || submitting.has(selected) || !$('prompt').value.trim())return;
  const id=selected,current=generation,text=$('prompt').value,mode=$('turn-mode').value;
  rememberDraft(id);const sentEdit=draftEdits.get(id) || 0;submitting.add(id);draw();
  try{
    if(!await persistDraft(id))return;
    const sentRevision=draftRevisions.get(id);
    await DeskFollowups.add(id,text,mode);
    if((draftEdits.get(id) || 0)===sentEdit && draftRevisions.get(id)===sentRevision && drafts.get(id)===text && draftModes.get(id)===mode){draftEdits.set(id,(draftEdits.get(id) || 0)+1);drafts.set(id,'');if(selected===id && $('prompt').value===text)$('prompt').value='';await persistDraft(id);}
    if(current===generation)$('followups').open=true;
  }catch(err){if(current===generation)error(err);}
  finally{submitting.delete(id);draw();}
};
$('task').onsubmit=async e=>{
  e.preventDefault();if(!selected || opening || submitting.has(selected) || $('send').disabled)return;
  const id=selected, current=generation, text=$('prompt').value, mode=$('turn-mode').value;
  rememberDraft(id);const sentEdit=draftEdits.get(id) || 0;submitting.add(id);$('error').hidden=true;draw();
  try {
    if(!await persistDraft(id))return;
    const sentRevision=draftRevisions.get(id);
    await api('/api/turn',{session:id,text,mode});
    if((draftEdits.get(id) || 0)===sentEdit && draftRevisions.get(id)===sentRevision && drafts.get(id)===text && draftModes.get(id)===mode){draftEdits.set(id,(draftEdits.get(id) || 0)+1);drafts.set(id,'');if(selected===id && $('prompt').value===text)$('prompt').value='';await persistDraft(id);}
    if(current===generation)await refresh();
  } catch(err) {if(current===generation)error(err);}
  finally {submitting.delete(id);draw();}
};
$('stop').onclick=async()=>{if(opening)return;const session=selected,current=generation;try{await api('/api/stop',{session});if(current===generation){requests.clear();approvals();await refresh();}}catch(e){if(current===generation)error(e);}};
let failures=0;
const connectionError='Connection lost. Retrying… If Desk stopped, relaunch it and reopen this URL.';
let starting=true, restoreChosen=false, restoreSession=null, restoreGeneration=0, startupError='';
async function startup(){
  const current=generation;
  await refresh();
  if(!restoreChosen){
    restoreChosen=true;restoreGeneration=current;
    const last=localStorage.getItem('codex-desk-browser-preview-session-v1');
    if(current===generation && !selected && state.sessions.some(s=>s.id===last && (!s.archived || activeSession(s))))restoreSession=last;
  }
  // A deliberate selection supersedes this return, including a late open reply.
  if(restoreSession && restoreGeneration===generation){
    const attempt=generation+1;
    const restored=await open(restoreSession,{keepError:true});
    if(generation===attempt){
      restoreGeneration=attempt;
      if(restored!==true){
        // Native rejections (missing history/profile, etc.) need explicit repair,
        // not a fresh owned backend every time the connection retry timer fires.
        if(restored?.error?.status>=400 && restored.error.status<500){starting=false;startupError='';return true;}
        startupError=$('error').textContent;return false;
      }
    }
  }
  starting=false;
  if(!selected)DeskHome.load();
  if(startupError && $('error').textContent===startupError)$('error').hidden=true;
  startupError='';return true;
}
async function pollActivity(){
  const current=generation;
  if(selected && !opening){
    const rows=await api(`/api/events?session=${selected}&after=${after}`);
    if(current!==generation)return;
    const follow=nearLatest();let changed=0;
    for(const r of rows){
      after=r.seq;consume(r.event);
      if(['item/started','item/completed','item/agentMessage/delta','item/commandExecution/outputDelta','item/mcpToolCall/progress','error'].includes(r.event.method))++changed;
    }
    if(changed){
      if(follow)requestAnimationFrame(()=>{if(current===generation)goLatest();});
      else{latestUpdates+=changed;latestLabel();}
    }
    if(rows.length){await refresh();statePollAt=Date.now();}
  }
  // Other projects can finish or request approval while this conversation is quiet.
  if(Date.now()-statePollAt>=4000){await refresh();statePollAt=Date.now();}
}
async function tick(){
  try{
    if(starting){if(!await startup()){++failures;return;}failures=0;}
    await pollActivity();failures=0;if($('error').textContent===connectionError)$('error').hidden=true;
  }
  catch(e){if(++failures===1 || e.status===403){const message=e.status===403?e.message:connectionError;error(new Error(message));if(starting)startupError=message;}}
  finally{setTimeout(tick,failures?3000:800);}
}
function preparationSaved(id,saved){
  const previous=draftSaved.get(id);
  const dirty=draftTimers.has(id) || draftSaves.has(id) ||
    (drafts.has(id) && (!previous || drafts.get(id)!==previous.text || (draftModes.get(id)||'native')!==previous.mode));
  if(dirty){draftConflicts.set(id,saved);draftMessages.set(id,'Saved preparation changed in Prepared work. Choose which draft to keep.');draftStatus(id);return;}
  draftRevisions.set(id,saved.revision);draftSaved.set(id,saved);
  drafts.set(id,saved.text);draftModes.set(id,saved.mode);
  draftMessages.set(id,'Draft saved locally. Nothing has been sent.');
  if(selected===id){$('prompt').value=saved.text;$('turn-mode').value=saved.mode;modeSelected=id;draftStatus(id);}
}
DeskPreparation.configure({api,make,profileLabel,onSaved:preparationSaved,
  openConversation:async id=>{await open(id);return selected===id && !opening && !$('task').hidden;}});
$('show-preparation').onclick=()=>DeskPreparation.show();
DeskHome.configure({api,row:nativeRow,selected:()=>selected,generation:()=>generation,open,
  browse:()=>$('browse').click(),project:()=>$('new').click()});
tick();

let nativeVersion=0,nativeCursor=null,nativeQuery=null,nativeLoading=false;
function nativeRow(t, resume, handoff, label='Resume with current settings', read=null) {
  const box=make('div','','native-row');box.append(make('strong',t.name || t.preview || t.id),make('small',`${t.cwd} · ${t.modelProvider}`));
  const actions=make('div','','actions');
  if(resume){const view=make('button',label);view.type='button';
  view.onclick=async()=>{
    if(view.disabled)return;
    view.disabled=true;
    try {await resume();} finally {view.disabled=false;}
  };actions.append(view);}
  if(handoff){const review=make('button','Review handoff');review.type='button';review.onclick=handoff;actions.append(review);}
  if(read){const original=make('button','Read original conversation','native-read');original.type='button';original.onclick=read;actions.append(original);}
  box.append(actions);return box;
}
function resetNative() {
  ++nativeVersion;nativeCursor=null;nativeQuery=null;nativeLoading=false;
  $('native-list').replaceChildren();$('more').hidden=true;$('more').disabled=false;
  $('history-search-submit').disabled=false;$('history-error').hidden=true;
  $('history-summary').textContent='Choose Search titles to find saved conversations. Leave the search blank to list them without a title filter.';
}
function nativeCurrent(version, query) {return version===nativeVersion && $('history').open && query===$('history-search').value.trim();}
function nativeSummary(query) {
  const count=$('native-list').children.length;
  $('history-summary').textContent=count
    ? (query?`Saved conversations with titles matching “${query}”. `:'')+'Read the original conversation, resume with current settings, or review a handoff.'
    : query?`No saved conversation titles match “${query}”.`:'No saved conversations found.';
}
async function nativeList(cursor=null) {
  const query=$('history-search').value.trim();
  if(cursor && (nativeLoading || nativeQuery!==query || !nativeCursor))return;
  if(!cursor)resetNative();
  const current=nativeVersion;nativeQuery=query;nativeLoading=true;
  $('history-error').hidden=true;$('history-search-submit').disabled=true;$('more').disabled=true;
  $('history-summary').textContent=query?`Searching conversation titles for “${query}”…`:'Looking for saved conversations…';
  try {
    const data=await api(historyPath(query,null,cursor));
    if(!nativeCurrent(current,query))return;
    for(const t of data.data || []) {
      const row=nativeRow(t,async()=>{
        if(!nativeCurrent(current,query))return;
        try {const r=await api('/api/import',{thread:t.id,profile:'default'});if(!nativeCurrent(current,query))return;$('history').close();await open(r.id);}
        catch(e){if(nativeCurrent(current,query)){$('history-error').textContent=e.message;$('history-error').hidden=false;}}
      },()=>{if(nativeCurrent(current,query))showHandoff(t.id,t.cwd,()=>nativeCurrent(current,query));},
      'Resume with current settings',()=>DeskHistoryReader.show({thread_id:t.id,cwd:t.cwd},
        {valid:()=>nativeCurrent(current,query)&&row.isConnected}));
      $('native-list').append(row);
    }
    nativeCursor=data.nextCursor;$('more').hidden=!nativeCursor;nativeSummary(query);
  } catch(e) {
    if(nativeCurrent(current,query)) {
      if(cursor)nativeSummary(query);else $('history-summary').textContent='Could not load saved conversations. Retry Search titles.';
      $('history-error').textContent=e.message;$('history-error').hidden=false;
    }
  } finally {
    if(nativeCurrent(current,query)){nativeLoading=false;$('history-search-submit').disabled=false;$('more').disabled=false;}
  }
}
function fillProfiles(select) {select.replaceChildren(...state.profiles.map(p=>{const n=make('option',p.name);n.value=p.id;return n;}));}
let handoffSource=null;
// Canceled next-task preparation belongs to its source, not the shared dialog.
const handoffGoals=new Map(), handoffEvidence=new Map();
$('handoff-goal').oninput=()=>{if(handoffSource)handoffGoals.set(handoffSource,$('handoff-goal').value);};
$('handoff-text').oninput=()=>{if(handoffSource)handoffEvidence.set(handoffSource,$('handoff-text').value);};
async function showHandoff(thread,cwd,valid=()=>true) {
  const current=generation;
  try {const r=await api('/api/handoff',{thread});if(current!==generation || !valid())return;handoffSource=thread;$('handoff-goal').value=handoffGoals.get(thread) || '';$('handoff-error').hidden=true;$('handoff-cwd').value=cwd;fillProfiles($('handoff-profile'));$('handoff-text').value=handoffEvidence.has(thread)?handoffEvidence.get(thread):r.text;$('history').close();$('preview').showModal();}catch(e){if(current===generation && valid())error(e);}
}
$('browse').onclick=()=>{$('history').showModal();nativeList();};
$('history-search').oninput=resetNative;
$('history-search-form').onsubmit=e=>{e.preventDefault();nativeList();};
$('history').addEventListener('close',()=>{if(!$('history').open)resetNative();});
$('more').onclick=()=>nativeList(nativeCursor);
$('history-close').onclick=()=>$('history').close();$('preview-close').onclick=()=>$('preview').close();
$('handoff').onclick=()=>{const s=state.sessions.find(s=>s.id===selected);if(s)showHandoff(s.thread_id,s.cwd);};
$('handoff-start').onclick=async()=>{const b=$('handoff-start'),source=handoffSource,goal=$('handoff-goal').value,text=$('handoff-text').value;b.disabled=true;$('handoff-error').hidden=true;try{const r=await api('/api/handoff/start',{cwd:$('handoff-cwd').value,profile:$('handoff-profile').value,text,goal});if(handoffGoals.get(source)===goal)handoffGoals.delete(source);if(handoffEvidence.get(source)===text)handoffEvidence.delete(source);$('preview').close();await open(r.id);}catch(e){$('handoff-error').textContent=e.message;$('handoff-error').hidden=false;}finally{b.disabled=false;}};

let providerEditing=null, providerVersion=0, providerReturn=false;
function drawProfiles(){
  const list=$('profiles-list');list.replaceChildren();
  for(const p of state.profiles){
    const row=make('div','','native-row');row.dataset.profile=p.id;
    row.append(make('strong',p.name),make('small',`${p.provider || 'Native settings'} / ${p.model || 'Configured model'}${p.endpoint?' · '+p.endpoint:''}`));
    const count=state.sessions.filter(s=>s.profile===p.id || (p.id!=='default' && p.legacy_id!=='default' && s.profile===p.legacy_id)).length;
    row.append(make('small',`${count} saved session${count===1?'':'s'}`));
    if(p.editable){const edit=make('button','Edit profile');edit.type='button';edit.onclick=()=>showProvider(p);row.append(edit);}
    else row.append(make('small',p.id==='default'?'Managed by your current Codex settings.':'Custom native file — edit in your Codex home.'));
    list.append(row);
  }
}
function showProvider(profile=null){
  ++providerVersion;providerEditing=profile?.id || null;
  providerReturn=$('profiles-dialog').open;
  if(providerReturn)$('profiles-dialog').close();
  $('provider-form').reset();$('provider-error').hidden=true;
  $('provider-heading').textContent=profile?'Edit API profile':'Add your API provider';
  $('provider-edit-info').hidden=!profile;
  $('provider-name').readOnly=!!profile;
  $('provider-name').value=profile?.name || '';
  $('provider-endpoint').value=profile?.endpoint || '';
  $('provider-model').value=profile?.model || '';
  $('provider-key').required=!profile;
  $('provider-key').placeholder=profile?'Leave blank to keep saved key':'';
  for(const id of ['provider-name','provider-endpoint','provider-model','provider-key','provider-save'])$(id).disabled=false;
  $('provider-save').textContent=profile?'Save profile changes':'Save local profile';
  $('provider').showModal();
}
$('manage-profiles').onclick=()=>{$('profiles-error').hidden=true;$('profiles-notice').hidden=true;drawProfiles();$('profiles-dialog').showModal();};
$('profiles-close').onclick=()=>$('profiles-dialog').close();
$('profiles-add').onclick=()=>showProvider();
$('add-provider').onclick=()=>showProvider();
$('provider-close').onclick=()=>$('provider').close();
$('provider').addEventListener('close',()=>{
  ++providerVersion;$('provider-key').value='';
  if(providerReturn){providerReturn=false;drawProfiles();$('profiles-dialog').showModal();}
});
$('provider-form').onsubmit=async e=>{
  e.preventDefault();if($('provider-save').disabled)return;
  const version=providerVersion, editing=providerEditing;
  const data={endpoint:$('provider-endpoint').value,model:$('provider-model').value,key:$('provider-key').value};
  if(editing)data.id=editing;else data.name=$('provider-name').value;
  for(const id of ['provider-name','provider-endpoint','provider-model','provider-key','provider-save'])$(id).disabled=true;
  $('provider-key').value='';$('provider-error').hidden=true;
  try{
    const result=await api(editing?'/api/profiles/update':'/api/profiles',data);
    if(version===providerVersion && $('provider').open){
      $('provider').close();
      if(editing){$('profiles-notice').textContent=result.restartRequired?'Profile saved. A native session already has these settings loaded. Stop Desk and relaunch it to use the updated profile there.':'Profile saved. New native sessions use the updated settings.';$('profiles-notice').hidden=false;}
    }
    await refresh();
  }catch(e){if(version===providerVersion && $('provider').open){$('provider-error').textContent=e.message;$('provider-error').hidden=false;}}
  finally{if(version===providerVersion){$('provider-key').value='';for(const id of ['provider-name','provider-endpoint','provider-model','provider-key','provider-save'])$(id).disabled=false;}}
};

$('rename').onclick=()=>{const s=state.sessions.find(s=>s.id===selected);if(!s)return;$('rename-name').value=s.name || '';$('rename-error').hidden=true;$('rename-dialog').showModal();$('rename-name').focus();$('rename-name').select();};
$('rename-cancel').onclick=()=>$('rename-dialog').close();
$('rename-form').onsubmit=async e=>{e.preventDefault();const b=$('rename-save');b.disabled=true;try{await api('/api/rename',{session:selected,name:$('rename-name').value});$('rename-dialog').close();await refresh();}catch(e){$('rename-error').textContent=e.message;$('rename-error').hidden=false;await refresh();}finally{b.disabled=false;}};
