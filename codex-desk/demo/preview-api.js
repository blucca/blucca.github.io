/* Sample-only API for the maintained Desk UI. Nothing leaves this static preview. */
(()=>{
  'use strict';
  // Capture before the maintained app defines its same-session open() helper.
  const openExternal=window.open.bind(window);
  const install=()=>{
    const url='https://github.com/blucca/codex-desk#install-the-preview';
    if(document.documentElement.dataset.previewEmbedded==='true')openExternal(url,'_blank','noopener');
    else location.assign(url);
  };
  const storageKey='codex-desk-browser-preview-v1',sessionKey='codex-desk-browser-preview-session-v1',readingKey='codex-desk-browser-preview-reading-checkpoints-v1',reviewKey='codex-desk-browser-preview-activity-review-v1',resetKey='codex-desk-browser-preview-reset-v1';
  const readingFixture=window.DeskPreviewReadingFixture || null;
  const threads=window.DeskPreviewThreads, copy=v=>JSON.parse(JSON.stringify(v));
  const blank=()=>({sessions:[],indexed:false,drafts:{},followups:{},nextId:1});
  let state=blank(),resetting=false;
  // The ordinary app's pagehide save can run after Reset removes the old keys.
  // Consume the reset marker before this new document loads any preparation.
  try{if(localStorage.getItem(resetKey)==='1')for(const key of [storageKey,sessionKey,readingKey,reviewKey,resetKey])localStorage.removeItem(key);}catch(_){}
  try{const saved=JSON.parse(localStorage.getItem(storageKey));if(saved && Array.isArray(saved.sessions) && saved.drafts && saved.followups)state=saved;}catch(_){}
  const requests=[];
  const notice=text=>{const el=document.getElementById('preview-notice');if(el)el.textContent=text;};
  const save=()=>{try{localStorage.setItem(storageKey,JSON.stringify(state));}catch(_){throw new Error('Browser storage is unavailable. Enable site storage to keep sample preparation.');}};
  const lookup=id=>{const row=state.sessions.find(s=>s.id===id);if(!row)throw new Error('Choose a sample conversation first.');return row;};
  const thread=id=>{const row=threads.find(t=>t.id===id);if(!row)throw new Error('Choose one of the sample histories listed in this preview.');return row;};
  const queue=id=>{lookup(id);return state.followups[id] || (state.followups[id]={entries:[],reservation:null});};
  const draftView=d=>({text:d.text,mode:d.mode,revision:d.revision});
  const conflict=current=>{const error=new Error('Sample draft changed elsewhere. Choose Keep mine or Load saved.');error.status=409;error.current=draftView(current);throw error;};
  const coverage=()=>({indexed_threads:state.indexed?threads.length:0,indexed_items:state.indexed?threads.reduce((n,t)=>n+t.turns.reduce((m,turn)=>m+(turn.items?.length || 0),0),0):0,truncated_threads:0,omitted_items:0,unsupported_items:0,invalid_items:0,max_thread_items:5000,max_thread_chars:2000000,max_item_chars:200000});
  const job=()=>({id:'sample-index-1',status:state.indexed?'completed':'idle',mode:'recent',seen:state.indexed?threads.length:0,indexed:state.indexed?threads.length:0,skipped:0,failed:0,limit:200,has_more:false,older_available:false,resumable:false,retryable_failures:0});
  const fold=text=>String(text).normalize('NFKC').toLowerCase();
  const preparationFold=text=>Array.from(String(text).normalize('NFKC'), c=>window.DeskPreviewCasefold?.[c] ?? c.toLowerCase()).join('').normalize('NFKC');
  function preparationPage(sessions,params){
    for(const key of params.keys())if(!['q','archived','cwd','limit','offset'].includes(key) || params.getAll(key).length!==1)throw Error('Use each saved-work query option once.');
    if(!params.has('q')){if(params.has('limit') || params.has('offset'))throw Error('Submit a phrase before paging saved work.');return {sessions};}
    const raw=params.get('q'),q=raw.trim(),size=Array.from(raw).length;
    if(size>200 || (q && Array.from(q).length<2))throw Error('Use a remembered phrase from 2 to 200 characters.');
    const number=(key,fallback)=>{if(!params.has(key))return fallback;const value=params.get(key);if(!/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value)))throw Error('Choose a saved-work page number.');return Number(value);};
    const limit=number('limit',30),offset=number('offset',0);if(limit<1 || limit>50)throw Error('Choose a lookup page from 1 to 50.');
    const needle=preparationFold(q),results=[];
    function add(row,kind,text,identity){
      if(!needle || typeof text!=='string')return;
      const chunks=Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text), x=>({text:x.segment,start:x.index,end:x.index+x.segment.length,folded:preparationFold(x.segment)}));
      const at=chunks.map(x=>x.folded).join('').indexOf(needle);if(at<0)return;
      let n=0,left=null,right=null;
      for(const x of chunks){const end=n+x.folded.length;if(left===null && at<end)left=x.start;if(at+needle.length<=end){right=x.end;break;}n=end;}
      let begin=Math.max(0,left-80),end=Math.min(text.length,Math.max(right,begin+420));if(end-begin>420){begin=left;end=Math.min(text.length,left+420);}
      results.push({session_id:row.id,kind,name:row.name,cwd:row.cwd,profile:row.profile,archived:row.archived,owner_status:row.status,updated:row.updated,snippet:(begin?'…':'')+text.slice(begin,end)+(end<text.length?'…':''),match_text:text.slice(left,Math.min(right,end)),...identity});
    }
    for(const row of sessions){
      add(row,'session',row.name,{control:'review'});
      if(row.draft)add(row,'draft',row.draft.text,{control:'draft',mode:row.draft.mode,revision:row.draft.revision});
      for(const entry of row.followups.entries)add(row,'followup',entry.text,{control:'followup',followup_id:entry.id,mode:entry.mode,revision:entry.revision,state:entry.state,order:entry.order});
      const r=row.followups.reservation;if(r)add(row,'reservation',r.text,{control:'reservation',token:r.token,followup_id:r.entry_id,revision:r.revision,mode:r.mode,state:r.state});
    }
    return {sessions,lookup:{q,limit,offset,total:results.length,results:results.slice(offset,offset+limit),has_more:offset+limit<results.length}};
  }
  function search(params){
    const q=(params.get('q') || '').trim(),needle=fold(q),cwd=params.get('cwd');const results=[];
    if(state.indexed && needle.length>=2)for(const t of threads){
      if(cwd && cwd!==t.cwd)continue;
      for(const turn of t.turns)for(const item of turn.items){
        const text=item.type==='agentMessage'?item.text:item.type==='commandExecution'?[item.command,item.aggregatedOutput].filter(x=>typeof x==='string').join('\n'):(item.content || []).map(c=>c.text || '').join('\n');
        const at=fold(text).indexOf(needle);if(at<0)continue;
        const binding=state.sessions.find(s=>s.thread_id===t.id);
        results.push({kind:binding?'activity':'native-activity',session_id:binding?.id,thread_id:t.id,turn_id:turn.id,item_id:item.id,item_type:item.type,cwd:t.cwd,title:t.name,profile:'default',provider:'sample',updated:t.updatedAt,snippet:text,match_text:text.slice(at,at+q.length)});
      }
    }
    return {results,total:results.length,truncated:false,coverage:{sessions:state.sessions.length,activity_items:state.sessions.reduce((n,s)=>n+(threads.find(t=>t.id===s.thread_id)?.turns || []).reduce((m,t)=>m+(t.items?.length || 0),0),0),drafts:Object.keys(state.drafts).length,followups:Object.values(state.followups).reduce((n,x)=>n+x.entries.length,0),native:coverage()}};
  }
  const sampleHome='4a5fd9a01846eac1b6f7d6505ceebf6f0b9460aee12e6ea1241397e607581986';
  function nativeMaterialState(){
    const summaries=[];
    for(const saved of state.sessions){
      if(typeof saved.thread_id!=='string' || !saved.thread_id.trim())continue;
      const owner={native_home:sampleHome,session:saved.id,thread_id:saved.thread_id};
      const rows=readingFixture?.events?.[saved.id] || [];
      try{
        if(!window.DeskNewActivity || !Array.isArray(rows) || rows.length>5000)throw Error();
        let currentTurn=null;const plans=new Map(),accepted=new WeakSet();
        for(const row of rows){
          const event=row.event,p=event?.params || {};
          if(!event || (p.threadId && p.threadId!==saved.thread_id && event.id===undefined))continue;
          if(event.method!=='item/plan/delta' || (p.turnId===currentTurn && plans.get(p.itemId)?.turn===p.turnId && plans.get(p.itemId)?.streaming))accepted.add(event);
          if(event.method==='turn/started'){
            const next=p.turn?.id || p.turnId || currentTurn;
            if(currentTurn && next!==currentTurn)for(const plan of plans.values())if(plan.turn===currentTurn)plan.streaming=false;
            currentTurn=next;
          }else if(['item/started','item/completed'].includes(event.method) && p.item?.id){
            if(p.item.type==='plan')plans.set(p.item.id,{turn:p.turnId,streaming:event.method==='item/started'});
            else plans.delete(p.item.id);
          }else if(event.method==='turn/completed'){
            const turn=p.turn?.id || p.turnId;
            for(const item of p.turn?.items || [])if(item?.type==='plan')plans.set(item.id,{turn,streaming:false});
            for(const plan of plans.values())if(plan.turn===turn)plan.streaming=false;
          }
        }
        const batch=window.DeskNewActivity.capture(owner,rows,row=>accepted.has(row.event));
        summaries.push({owner,status:'available',received_seq:batch.received_seq,material_seq:batch.frontier});
      }catch{summaries.push({owner,status:'unavailable'});}
    }
    return {native_home:sampleHome,summaries};
  }
  function exactQuery(params,required,optional=[]){
    for(const key of params.keys())if(!required.includes(key) && !optional.includes(key) || params.getAll(key).length!==1)throw Error('Use the exact sample native query.');
    for(const key of required)if(!params.has(key))throw Error('Supply the captured native source IDs.');
  }
  function identifier(value){if(typeof value!=='string' || !value.trim() || Array.from(value).length>200)throw Error('Use the captured native thread and turn IDs.');return value;}
  function taskResponse(original,threadId,turnId){
    const result={thread_id:threadId,turn_id:turnId,available:false,turn_status:null,turn_error:null,source:'native history read'};
    const matching=original.turns.filter(turn=>turn?.id===turnId);
    if(!matching.length)return {...result,status:'turn_unavailable',reason:'turn_unavailable'};
    if(matching.length!==1)throw Error('Native original supplied an ambiguous captured turn');
    const turn=matching[0];result.turn_status=typeof turn.status==='string'?turn.status:null;result.turn_error=turn.error ?? null;
    const items=Array.isArray(turn.items)?turn.items:[],messages=items.filter(item=>item?.type==='agentMessage' && typeof item.id==='string' && item.id.trim() && Array.from(item.id).length<=200 && typeof item.text==='string' && item.text.trim());
    if(!messages.length)return {...result,status:'response_unavailable',reason:'response_unavailable'};
    const final=messages.filter(item=>item.phase==='final_answer'),chosen=(final.length?final:messages).at(-1);
    if(items.filter(item=>item?.id===chosen.id).length!==1)throw Error('Native original supplied an ambiguous response item');
    const phase=typeof chosen.phase==='string'?chosen.phase:null;
    return {...result,status:'available',available:true,reason:null,item_id:chosen.id,phase,
      selection:final.length?'final_answer':'last_assistant_message',label:({final_answer:'Final answer',commentary:'Commentary',partial_answer:'Partial answer'})[phase] || 'Last assistant message'};
  }
  function handle(path,method,data,params){
    const post=method==='POST';
    if(path==='/api/native' || path.startsWith('/api/native/')){
      if(method!=='GET')throw Error('Native sample sources are read-only.');
      if(!Array.isArray(threads))throw Error('Sample histories did not load. Reload this page to try again.');
      if(path==='/api/native')exactQuery(params,[],['search','cwd','cursor','recent']);
      else if(path==='/api/native/thread')exactQuery(params,['id']);
      else if(path==='/api/native/home')exactQuery(params,[]);
      else if(path==='/api/native/task-response')exactQuery(params,['thread','turn']);
      else if(path==='/api/native/evidence-source')exactQuery(params,['home','thread']);
    }
    if(path==='/api/native/home')return {home_namespace:sampleHome};
    if(path==='/api/native/task-response'){
      const id=identifier(params.get('thread')),turn=identifier(params.get('turn')),original=thread(id);
      return {thread:original,response:taskResponse(original,id,turn)};
    }
    if(path==='/api/native/evidence-source'){
      const id=identifier(params.get('thread'));
      if(params.get('home')!==sampleHome)throw Error('This evidence belongs to another native home. Use its original sample source.');
      return {thread:thread(id),home_namespace:sampleHome,source:'native history read'};
    }
    if(['/api/native','/api/native/thread','/api/history/index','/api/recall','/api/import','/api/open'].includes(path) && !Array.isArray(threads))
      throw new Error('Sample histories did not load. Reload this page to try again.');
    if(path==='/api/state')return {sessions:state.sessions,native_material:nativeMaterialState(),native_outcomes:Object.fromEntries(state.sessions.flatMap(s=>{const t=Array.isArray(threads)?threads.find(t=>t.id===s.thread_id):null,last=t?.turns?.at(-1);return last?[[s.id,{thread_id:t.id,turn_id:last.id,status:last.status,error:last.error ?? null,source:'native history read'}]]:[];})),profiles:[{id:'default',name:'Sample settings',provider:'sample',model:'preparation-only'}],pending:readingFixture?.pending || {},projects:[]};
    if(path==='/api/native'){
      let rows=threads.map(({turns,...metadata})=>metadata);const term=params.get('search'),cwd=params.get('cwd');
      if(term)rows=rows.filter(t=>fold(t.name).includes(fold(term)));if(cwd)rows=rows.filter(t=>t.cwd===cwd);return {data:rows,nextCursor:null};
    }
    if(path==='/api/native/thread')return thread(identifier(params.get('id')));
    if(path==='/api/history/index'){
      if(post){
        const op=data.op===undefined?'recent':data.op;
        if(!['recent','older','retry'].includes(op))throw new Error('Choose recent refresh, older continuation or explicit retry.');
        if(op==='older')throw new Error('All sample histories fit the recent window. No older sample conversations remain.');
        if(op==='retry')throw new Error('No sample indexing pass or failed history read remains to retry.');
        state.indexed=true;save();
      }
      return {job:job(),coverage:coverage(),projects:state.indexed?threads.map(t=>t.cwd).sort():[]};
    }
    if(path==='/api/recall')return search(params);
    if(path==='/api/preparation'){
      if(post)throw new Error('Prepared work is read-only until you explicitly save a draft.');
      const archived=params.get('archived') || 'false',cwd=params.get('cwd');
      if(!['false','true','0','1'].includes(archived))throw new Error('Choose whether to include archived sessions.');
      const sessions=[];
      for(const row of state.sessions){
        if((row.archived && !['true','1'].includes(archived)) || (cwd && cwd!==row.cwd))continue;
        const saved=state.drafts[row.id],draft=saved?.revision>0 && saved.text?.trim()?draftView(saved):null;
        // Overview reads do not create an empty queue or alter browser storage.
        const followups=state.followups[row.id] || {entries:[],reservation:null};
        if(!draft && !followups.entries.length && !followups.reservation)continue;
        sessions.push({id:row.id,name:row.name,cwd:row.cwd,profile:row.profile,archived:!!row.archived,status:row.status,
          updated:row.updated || threads?.find(t=>t.id===row.thread_id)?.updatedAt || 0,draft,followups});
      }
      sessions.sort((a,b)=>b.updated-a.updated || a.id.localeCompare(b.id));return preparationPage(sessions,params);
    }
    if(path==='/api/import' && post){
      const t=thread(data.thread),id='desk-'+t.id;
      if(!state.sessions.some(s=>s.id===id))state.sessions.push({id,thread_id:t.id,name:t.name,cwd:t.cwd,profile:'default',status:'saved',provider:'sample',model:'preparation-only',mode:'native',archived:false,updated:t.updatedAt});
      save();return {id};
    }
    if(path==='/api/open' && post)return {thread:thread(lookup(data.session).thread_id)};
    if(path==='/api/events')return (readingFixture?.events?.[params.get('session')] || []).filter(event=>event.seq>Number(params.get('after') || 0));
    if((path==='/api/stop' || path==='/api/steer/request') && !post){
      lookup(params.get('session'));
      const error=new Error('No saved native task-control request in this browser sample.');error.status=404;throw error;
    }
    if(path==='/api/turn/request' && !post){
      lookup(params.get('session'));
      const error=new Error('No saved ordinary task request in this preparation-only sample.');error.status=404;throw error;
    }
    if(path==='/api/draft'){
      const id=post?data.session:params.get('session');lookup(id);
      const current=state.drafts[id] || {text:'',mode:'native',revision:0};
      if(post){
        if(typeof data.text!=='string' || data.text.length>200000)throw new Error('Use a sample draft of at most 200,000 characters.');
        if(!['native','plan'].includes(data.mode) || !Number.isInteger(data.revision) || data.revision<0)throw new Error('Choose Work or Plan and the reviewed draft revision.');
        const identified=data.writer!==undefined || data.sequence!==undefined;
        if(identified && (typeof data.writer!=='string' || !data.writer || data.writer.length>128 || !Number.isSafeInteger(data.sequence) || data.sequence<0))throw new Error('Use the current page writer and edit sequence.');
        const sameWriter=identified && current.writer===data.writer;
        if(sameWriter && data.sequence<=current.edit_sequence){
          if(data.sequence===current.edit_sequence && current.text===data.text && current.mode===data.mode)return draftView(current);
          conflict(current);
        }
        const samePageRecovery=sameWriter && data.sequence>current.edit_sequence && data.revision<current.revision;
        if(data.revision!==current.revision && !samePageRecovery)conflict(current);
        state.drafts[id]={text:data.text,mode:data.mode,revision:current.revision+1,...(identified?{writer:data.writer,edit_sequence:data.sequence}:{})};save();
      }
      return draftView(state.drafts[id] || current);
    }
    if(path.startsWith('/api/followups')){
      const id=post?data.session:params.get('session'),q=queue(id),action=path.slice('/api/followups'.length);
      if(post){
        if(action==='/send'){notice('Your preparation is saved. Install Desk to send tasks using your own Codex CLI.');throw new Error('Sample preparation only. Install Desk to send native tasks.');}
        if(!action){
          if(typeof data.text!=='string' || !data.text.trim() || data.text.length>200000)throw new Error('Write a sample next task before saving it.');
          q.entries.push({id:'sample-followup-'+state.nextId++,text:data.text,mode:data.mode==='plan'?'plan':'native',order:q.entries.length+1,revision:1,state:'queued'});
        }else if(action==='/reorder'){
          if(JSON.stringify(data.order)!==JSON.stringify(q.entries.map(e=>e.id)))throw new Error('Preparation changed. Refresh before reordering.');
          if(data.ids.length!==q.entries.length || new Set(data.ids).size!==q.entries.length || data.ids.some(id=>!q.entries.some(e=>e.id===id)))throw new Error('Choose the current prepared entries.');
          q.entries=data.ids.map(id=>q.entries.find(e=>e.id===id));
        }else if(action==='/clear'){q.entries=[];
        }else if(['/edit','/remove'].includes(action)){
          const entry=q.entries.find(e=>e.id===data.id);if(!entry || entry.revision!==data.revision)throw new Error('Refresh the current preparation before editing.');
          if(action==='/remove')q.entries=q.entries.filter(e=>e.id!==data.id);
          else{entry.text=data.text;entry.mode=data.mode;entry.revision++;}
        }else throw new Error('The browser sample supports saved preparation only.');
        q.entries.forEach((e,i)=>e.order=i+1);save();
      }
      return q;
    }
    if(path==='/api/archive' && post){lookup(data.session).archived=!!data.archived;save();return {};}
    if(path==='/api/rename' && post){lookup(data.session).name=String(data.name).slice(0,120);save();return {};}
    notice('Install Desk to work with your own projects and run native tasks.');
    throw new Error('This interactive sample supports reading and preparation. Install Desk for native tasks and settings.');
  }
  const nativeFetch=window.fetch.bind(window);
  window.fetch=async(input,options={})=>{
    const address=new URL(typeof input==='string'?input:input.url,location.href);
    if(address.origin!==location.origin)throw new Error('Sample requests stay in this browser.');
    if(!address.pathname.startsWith('/api/'))return nativeFetch(input,options);
    if(resetting)return new Response(JSON.stringify({error:'Sample reset in progress.'}),{status:410,headers:{'Content-Type':'application/json'}});
    const method=(options.method || 'GET').toUpperCase();let data={};
    try{data=options.body?JSON.parse(options.body):{};requests.push({path:address.pathname+address.search,method,data:copy(data)});
      if(readingFixture)await readingFixture.controls.before(address.pathname);
      const result=copy(handle(address.pathname,method,data,address.searchParams));
      if(readingFixture)await readingFixture.controls.after?.(address.pathname);
      return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}});
    }catch(error){return new Response(JSON.stringify({error:error.message,...(error.current?{current:error.current}:{})}),{status:error.status || 400,headers:{'Content-Type':'application/json'}});}
  };
  window.DeskBrowserPreview={storageKey,sessionKey,readingKey,reviewKey,requests,...(readingFixture?{fixture:readingFixture.controls}:{}),snapshot:()=>copy(state),reset:()=>{resetting=true;localStorage.setItem(resetKey,'1');for(const key of [storageKey,sessionKey,readingKey,reviewKey])localStorage.removeItem(key);location.reload();}};
  document.addEventListener('DOMContentLoaded',()=>{
    document.getElementById('preview-start').onclick=()=>{
      const home=document.getElementById('welcome');
      document.getElementById(home.hidden?'search-saved-content':'home-content').click();
      const input=document.getElementById('recall-query');input.value='retry budget';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();
    };
    document.getElementById('preview-reset').onclick=window.DeskBrowserPreview.reset;
    for(const id of ['home-project'])document.getElementById(id).hidden=true;
    document.getElementById('send').addEventListener('click',e=>{e.preventDefault();install();});
    document.getElementById('followup-send').addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();install();},true);
  });
})();
