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
  const storageKey='codex-desk-browser-preview-v1',sessionKey='codex-desk-browser-preview-session-v1';
  const threads=window.DeskPreviewThreads, copy=v=>JSON.parse(JSON.stringify(v));
  const blank=()=>({sessions:[],indexed:false,drafts:{},followups:{},nextId:1});
  let state=blank(),resetting=false;
  try{const saved=JSON.parse(localStorage.getItem(storageKey));if(saved && Array.isArray(saved.sessions) && saved.drafts && saved.followups)state=saved;}catch(_){}
  const requests=[];
  const notice=text=>{const el=document.getElementById('preview-notice');if(el)el.textContent=text;};
  const save=()=>{try{localStorage.setItem(storageKey,JSON.stringify(state));}catch(_){throw new Error('Browser storage is unavailable. Enable site storage to keep sample preparation.');}};
  const lookup=id=>{const row=state.sessions.find(s=>s.id===id);if(!row)throw new Error('Choose a sample conversation first.');return row;};
  const thread=id=>{const row=threads.find(t=>t.id===id);if(!row)throw new Error('This preview contains three sample conversations.');return row;};
  const queue=id=>{lookup(id);return state.followups[id] || (state.followups[id]={entries:[],reservation:null});};
  const draftView=d=>({text:d.text,mode:d.mode,revision:d.revision});
  const conflict=current=>{const error=new Error('Sample draft changed elsewhere. Choose Keep mine or Load saved.');error.status=409;error.current=draftView(current);throw error;};
  const coverage=()=>({indexed_threads:state.indexed?3:0,indexed_items:state.indexed?6:0,truncated_threads:0,omitted_items:0,unsupported_items:0,invalid_items:0,max_thread_items:5000,max_thread_chars:2000000,max_item_chars:200000});
  const job=()=>({id:'sample-index-1',status:state.indexed?'completed':'idle',seen:state.indexed?3:0,indexed:state.indexed?3:0,skipped:0,failed:0,limit:200,has_more:false});
  const fold=text=>String(text).normalize('NFKC').toLowerCase();
  function search(params){
    const q=(params.get('q') || '').trim(),needle=fold(q),cwd=params.get('cwd');const results=[];
    if(state.indexed && needle.length>=2)for(const t of threads){
      if(cwd && cwd!==t.cwd)continue;
      for(const turn of t.turns)for(const item of turn.items){
        const text=item.type==='agentMessage'?item.text:(item.content || []).map(c=>c.text || '').join('\n');
        const at=fold(text).indexOf(needle);if(at<0)continue;
        const binding=state.sessions.find(s=>s.thread_id===t.id);
        results.push({kind:binding?'activity':'native-activity',session_id:binding?.id,thread_id:t.id,turn_id:turn.id,item_id:item.id,item_type:item.type,cwd:t.cwd,title:t.name,profile:'default',provider:'sample',updated:t.updatedAt,snippet:text,match_text:text.slice(at,at+q.length)});
      }
    }
    return {results,total:results.length,truncated:false,coverage:{sessions:state.sessions.length,activity_items:state.sessions.length*2,drafts:Object.keys(state.drafts).length,followups:Object.values(state.followups).reduce((n,x)=>n+x.entries.length,0),native:coverage()}};
  }
  function handle(path,method,data,params){
    const post=method==='POST';
    if(['/api/native','/api/native/thread','/api/history/index','/api/recall','/api/import','/api/open'].includes(path) && !Array.isArray(threads))
      throw new Error('Sample histories did not load. Reload this page to try again.');
    if(path==='/api/state')return {sessions:state.sessions,profiles:[{id:'default',name:'Sample settings',provider:'sample',model:'preparation-only'}],pending:{},projects:[]};
    if(path==='/api/native'){
      let rows=threads.map(({turns,...metadata})=>metadata);const term=params.get('search'),cwd=params.get('cwd');
      if(term)rows=rows.filter(t=>fold(t.name).includes(fold(term)));if(cwd)rows=rows.filter(t=>t.cwd===cwd);return {data:rows,nextCursor:null};
    }
    if(path==='/api/native/thread')return thread(params.get('id'));
    if(path==='/api/history/index'){
      if(post){state.indexed=true;save();}return {job:job(),coverage:coverage()};
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
      sessions.sort((a,b)=>b.updated-a.updated || a.id.localeCompare(b.id));return {sessions};
    }
    if(path==='/api/import' && post){
      const t=thread(data.thread),id='desk-'+t.id;
      if(!state.sessions.some(s=>s.id===id))state.sessions.push({id,thread_id:t.id,name:t.name,cwd:t.cwd,profile:'default',status:'saved',provider:'sample',model:'preparation-only',mode:'native',archived:false,updated:t.updatedAt});
      save();return {id};
    }
    if(path==='/api/open' && post)return {thread:thread(lookup(data.session).thread_id)};
    if(path==='/api/events')return [];
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
      const result=copy(handle(address.pathname,method,data,address.searchParams));return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}});
    }catch(error){return new Response(JSON.stringify({error:error.message,...(error.current?{current:error.current}:{})}),{status:error.status || 400,headers:{'Content-Type':'application/json'}});}
  };
  window.DeskBrowserPreview={storageKey,sessionKey,requests,snapshot:()=>copy(state),reset:()=>{resetting=true;localStorage.removeItem(storageKey);localStorage.removeItem(sessionKey);location.reload();}};
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
