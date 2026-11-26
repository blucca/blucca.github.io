/* Read-only discovery on first use; only an explicit Resume imports work. */
const DeskHome=(()=>{
  const $=id=>document.getElementById(id);
  let env,loaded=false,version=0,resuming=false;
  function current(v,g){return v===version && g===env.generation() && !env.selected();}
  function busy(value){
    resuming=value;
    for(const button of $('home-list').querySelectorAll('button'))button.disabled=value;
    $('home-retry').disabled=value;
  }
  async function resume(thread,v,g){
    if(resuming || !current(v,g))return;
    busy(true);$('home-error').hidden=true;
    try{
      const result=await env.api('/api/import',{thread:thread.id,profile:'default'});
      if(current(v,g))await env.open(result.id);
    }catch(error){
      if(current(v,g)){$('home-error').textContent=error.message;$('home-error').hidden=false;}
    }finally{busy(false);}
  }
  async function load(retry=false){
    if(!env || env.selected() || resuming || (loaded && !retry))return;
    loaded=true;const v=++version,g=env.generation();
    $('home-list').replaceChildren();$('home-list').setAttribute('aria-busy','true');
    $('home-error').hidden=true;$('home-retry').hidden=true;
    $('home-status').textContent='Loading recent conversations from your Codex home…';
    try{
      const result=await env.api('/api/native?recent=1');
      if(!current(v,g))return;
      const all=result.data || [], unavailable=all.filter(t=>t.cwdExists===false).length;
      const rows=all.filter(t=>t.cwdExists!==false).slice(0,6);
      for(const thread of rows){
        const title=String(thread.name || thread.preview || thread.id).replace(/\s+/g,' ').trim();
        const preview={...thread,name:title.length>160?title.slice(0,157)+'…':title};
        $('home-list').append(env.row(preview,()=>resume(thread,v,g),null,'Resume conversation'));
      }
      $('home-status').textContent=rows.length?'Recently updated conversations. Choose one to review its saved work.':(unavailable?'Recent history points to unavailable project folders. Browse all to read the original conversations. Restore a folder only to resume work.':'No saved conversations in this Codex home yet. Open a project to start your first task. Use --codex-home if your CLI history is stored elsewhere.');
      if(rows.length && unavailable)$('home-status').textContent+=` ${unavailable} recent project folder(s) unavailable; Browse all to read their original conversations.`;
    }catch(error){
      if(current(v,g)){
        $('home-status').textContent='Recent conversations could not be loaded. Retry, or open a project.';
        $('home-error').textContent=error.message;$('home-error').hidden=false;$('home-retry').hidden=false;
      }
    }finally{if(current(v,g))$('home-list').setAttribute('aria-busy','false');}
  }
  function configure(options){
    env=options;$('home-retry').onclick=()=>load(true);
    $('home-browse').onclick=()=>env.browse();$('home-project').onclick=()=>env.project();
  }
  return {configure,load};
})();
