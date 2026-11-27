/* Read-only recent discovery, independent of the mounted selected workbench. */
const DeskHome=(()=>{
  const $=id=>document.getElementById(id);
  let env,host,next,loaded=false,version=0,resuming=false;
  function visible(){return !env.selected() || $('recent-work').open;}
  function current(v,g,s){return v===version && g===env.generation() && s===env.selected() && visible();}
  function sync(){
    $('welcome').hidden=!visible();
    $('show-recent').hidden=!env.selected();$('show-recent').disabled=env.opening();
    const s=env.state().sessions.find(s=>s.id===env.selected());
    $('recent-selected-status').textContent=s?`Selected task: ${s.name || s.cwd} · ${env.opening()?'opening':s.status}. Your task stays selected while you read.`:'';
  }
  function restore(){
    if($('welcome').parentNode!==host)host.insertBefore($('welcome'),next);
    ++version;loaded=false;sync();
  }
  function close(){if($('recent-work').open){$('recent-work').close();restore();}}
  function selectionChanged(){close();++version;loaded=false;sync();}
  function show(){
    if(!env.selected() || env.opening() || $('recent-work').open)return;
    $('recent-work').append($('welcome'));$('welcome').hidden=false;
    $('recent-work').showModal();sync();load(true);
  }
  function busy(value){
    resuming=value;
    for(const button of $('home-list').querySelectorAll('button'))button.disabled=value;
    $('home-retry').disabled=value;
  }
  async function resume(thread,v,g,s){
    if(resuming || !current(v,g,s))return;
    busy(true);$('home-error').hidden=true;
    try{
      const result=await env.api('/api/import',{thread:thread.id,profile:'default'});
      if(current(v,g,s))await env.open(result.id);
    }catch(error){
      if(current(v,g,s)){$('home-error').textContent=error.message;$('home-error').hidden=false;}
    }finally{busy(false);if(visible() && !loaded)load();}
  }
  async function load(retry=false){
    if(!env || !visible() || resuming || (loaded && !retry))return;
    loaded=true;const v=++version,g=env.generation(),s=env.selected();
    $('home-list').replaceChildren();$('home-list').setAttribute('aria-busy','true');
    $('home-error').hidden=true;$('home-retry').hidden=true;
    $('home-status').textContent='Loading recent conversations from your Codex home…';
    try{
      const result=await env.api('/api/native?recent=1');
      if(!current(v,g,s))return;
      const all=result.data || [], unavailable=all.filter(t=>t.cwdExists===false).length;
      const rows=all.slice(0,6);
      for(const thread of rows){
        const title=String(thread.name || thread.preview || thread.id).replace(/\s+/g,' ').trim();
        const preview={...thread,name:title.length>160?title.slice(0,157)+'…':title};
        let row;
        const read=()=>DeskHistoryReader.show({thread_id:thread.id,cwd:thread.cwd},
          {valid:()=>current(v,g,s) && row.isConnected,backLabel:'Back to recent work',onReturn:()=>{
            if(current(v,g,s) && row.isConnected)row.querySelector('.native-read')?.focus({preventScroll:true});
          }});
        row=env.row(preview,thread.cwdExists===false?null:()=>resume(thread,v,g,s),null,'Resume conversation',read);
        row.dataset.thread=thread.id;
        $('home-list').append(row);
      }
      $('home-status').textContent=rows.length?'Recently updated conversations. Read original evidence without opening a task, or Resume when ready to work.':(unavailable?'Recent history points to unavailable project folders. Browse all to read the original conversations. Restore a folder only to resume work.':'No saved conversations in this Codex home yet. Open a project to start your first task. Use --codex-home if your CLI history is stored elsewhere.');
      if(rows.length && unavailable)$('home-status').textContent+=` ${unavailable} recent project folder(s) unavailable; original reading does not require them.`;
    }catch(error){
      if(current(v,g,s)){
        $('home-status').textContent='Recent conversations could not be loaded. Retry, or open a project.';
        $('home-error').textContent=error.message;$('home-error').hidden=false;$('home-retry').hidden=false;
      }
    }finally{if(current(v,g,s))$('home-list').setAttribute('aria-busy','false');}
  }
  function configure(options){
    env=options;host=$('welcome').parentNode;next=$('welcome').nextSibling;
    $('show-recent').onclick=show;$('recent-return').onclick=close;
    $('recent-work').addEventListener('close',()=>{if(!$('recent-work').open && $('welcome').parentNode!==host)restore();});
    $('home-retry').onclick=()=>load(true);
    $('home-browse').onclick=()=>env.browse();$('home-project').onclick=()=>env.project();
    sync();
  }
  return {configure,load,sync,selectionChanged};
})();
