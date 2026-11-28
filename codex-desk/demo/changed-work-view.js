/* Saved-work navigation uses compact metadata, never original-body polling. */
(function(root) {
  'use strict';
  let env,model=null,projection=null,offset=0,unsubscribe=null,origin=null,returnRow=null,version=0;
  const dots=new Map(),nodes=new Map(),groupKeys=new Map();
  const same=(a,b)=>a && b && a.native_home===b.native_home && a.session===b.session && a.thread_id===b.thread_id;
  function inputs() {
    const state=env.state(),native=state.native_material;
    if(!native || typeof native.native_home!=='string' || !Array.isArray(native.summaries))return null;
    const grouped=new Map(),names=new Map(),tasks=[],matching=[],seen=new Set(),savedTasks=new Map(state.sessions.map(task=>[task.id,task]));
    const query=env.$('session-filter').value.trim().normalize('NFC').toLocaleLowerCase();
    for(const group of env.groups()) {
      if(grouped.has(group.cwd))continue;
      if(!groupKeys.has(group.cwd))groupKeys.set(group.cwd,String(groupKeys.size+1));
      const group_id=groupKeys.get(group.cwd);grouped.set(group.cwd,group_id);names.set(group_id,group);
      for(const saved of [...group.active,...group.recent,...group.archived]) {
        const task=savedTasks.get(saved.id);if(!task || seen.has(task.id))continue;seen.add(task.id);
        tasks.push({session:task.id,group_id,active:env.active(task),archived:!!task.archived,thread_id:task.thread_id || null});
        if(!query || `${task.name || ''} ${group.name} ${group.cwd}`.normalize('NFC').toLocaleLowerCase().includes(query))matching.push(task.id);
      }
    }
    const metadata=env.reviews?.() || {native_home:null,reviews:[]};
    return {value:{native_home:native.native_home,tasks,summaries:native.summaries,reviews:metadata.reviews || []},names,
      tasks:new Map(state.sessions.map(task=>[task.id,task])),matching};
  }
  function capture() {
    model=inputs();dots.clear();projection=null;
    if(!model)return;
    const all=root.DeskChangedWork.project(model.value,{mode:'all',show_archived:true,limit:100});
    for(const group of all.groups)for(const row of group.rows)dots.set(row.session,row);
    // Sidebar can exceed one bounded page. Project subsequent metadata pages,
    // without fetching any native source or session body.
    for(let page=all.limit;page<all.total_tasks;page+=100) {
      const next=root.DeskChangedWork.project(model.value,{mode:'all',show_archived:true,offset:page,limit:100});
      for(const group of next.groups)for(const row of group.rows)dots.set(row.session,row);
    }
    projection=root.DeskChangedWork.project(model.value,{mode:env.$('changed-work-mode').value || 'changed',
      group_id:env.$('changed-work-project').value || null,query_sessions:model.matching,
      show_archived:env.$('show-archived').checked,offset,limit:30});
    const pinned=returnRow && returnRow.scope===scope() && same(dots.get(returnRow.session)?.owner,returnRow.owner) && liveOwner(dots.get(returnRow.session));
    if(offset>=projection.total_tasks && offset && !pinned){offset=Math.max(0,Math.floor((projection.total_tasks-1)/30)*30);capture();}
  }
  function badge(session,button) {
    if(!env)return;const row=dots.get(session);button.dataset.nativeActivity=row?.activity_status || 'summary_unavailable';
    if(!row?.changed)return;
    const dot=env.make('span','●','native-material-dot');dot.setAttribute('aria-label','New native activity since review');
    button.append(dot);
  }
  const labels={new_activity:'New native activity',up_to_date:'No new recorded material',baseline_missing:'Review baseline unavailable',
    summary_unavailable:'Material summary unavailable',binding_unavailable:'Native binding unavailable'};
  function setText(node,value){if(node.textContent!==value)node.textContent=value;}
  function liveOwner(row) {
    const task=env.state().sessions.find(task=>task.id===row.session),native=env.state().native_material;
    return task && native && same(row.owner,{native_home:native.native_home,session:task.id,thread_id:task.thread_id});
  }
  function scope(){return JSON.stringify([env.$('changed-work-project').value,env.$('changed-work-mode').value,env.$('session-filter').value,env.$('show-archived').checked,offset]);}
  async function navigate(row) {
    if(!row.owner || !liveOwner(row) || env.opening())return false;
    const ticket=++version;returnRow={key:row.key,session:row.session,owner:{...row.owner},scope:scope()};
    env.$('changed-work').close();env.$('changed-work-back').hidden=false;
    try {await env.open(row.session);}
    catch(error){if(ticket===version){env.$('changed-work-error').textContent=error.message;show(false);}return false;}
    if(ticket!==version)return false;return true;
  }
  function rowNode(row) {
    let node=nodes.get(row.key);
    if(!node) {
      const box=env.make('div','','changed-work-row'),button=env.make('button','','changed-work-open'),title=env.make('strong'),status=env.make('small');
      button.type='button';button.append(title,status);box.append(button);node={box,button,title,status};nodes.set(row.key,node);
    }
    node.row=row;node.box.dataset.session=row.session;node.button.onclick=()=>navigate(node.row);
    const task=model.tasks.get(row.session),group=model.names.get(row.group_id);
    setText(node.title,task?.name || group?.name || row.session);
    setText(node.status,(task?.status || 'unreported')+' · '+labels[row.activity_status]+(row.archived?' · archived locally':''));
    node.button.disabled=!row.owner || !liveOwner(row) || env.opening();
    node.button.dataset.nativeActivity=row.activity_status;return node;
  }
  function render() {
    if(!env.$('changed-work').open)return;
    const list=env.$('changed-work-list'),focus=root.document?.activeElement,scroll=list.scrollTop;
    const focused=[...nodes.values()].find(node=>node.button===focus),keep=new Set();list.replaceChildren();
    if(!projection) {setText(env.$('changed-work-status'),'Compact native material metadata is unavailable.');return;}
    const counts=projection.counts;
    setText(env.$('changed-work-status'),`${counts.new_activity} changed · ${counts.review_baseline_missing} without a review baseline · ${counts.summary_unavailable+counts.binding_unavailable} unavailable`);
    const projects=env.$('changed-work-project'),chosen=projects.value;projects.replaceChildren();
    const all=env.make('option','All saved projects');all.value='';projects.append(all);
    for(const [id,group] of model.names){const option=env.make('option',group.name+' · '+group.cwd);option.value=id;projects.append(option);}projects.value=chosen;
    for(const group of projection.groups) {
      const section=env.make('section','','changed-work-group'),name=model.names.get(group.group_id);section.append(env.make('h3',name?.name || group.group_id),env.make('p',name?.cwd || '','muted'));
      for(const row of group.rows){const node=rowNode(row);section.append(node.box);keep.add(row.key);}list.append(section);
    }
    // Keep the exact navigation row available on return even after an explicit
    // task review removes it from Changed. No review occurs on this surface.
    if(returnRow && returnRow.scope===scope() && !keep.has(returnRow.key)) {
      const row=dots.get(returnRow.session);
      if(row && same(row.owner,returnRow.owner)) {
        const section=env.make('section','','changed-work-group');section.append(env.make('h3','Opened from this overview'));
        section.append(rowNode(row).box);list.append(section);keep.add(row.key);
      }
    }
    if(!list.children.length)list.append(env.make('p','No changed saved work in this view. Choose All saved work to review unknown baselines.','muted'));
    env.$('changed-work-previous').disabled=offset===0;env.$('changed-work-next').disabled=!projection.has_more;
    for(const [key,node] of nodes)if(!keep.has(key))nodes.delete(key);
    if(focused && keep.has(focused.row.key))focused.button.focus({preventScroll:true});list.scrollTop=scroll;
  }
  function sync() {
    if(!env)return;
    try{capture();render();}catch{model=null;projection=null;dots.clear();render();}
    env.$('show-changed-work').hidden=!env.state().sessions.length;
  }
  function show(reset=true) {
    if(reset){origin=root.document?.activeElement;returnRow=null;offset=0;env.$('changed-work-error').textContent='';}
    sync();env.$('changed-work').showModal();render();
    const focus=returnRow && nodes.get(returnRow.key)?.button;
    if(focus)focus.focus({preventScroll:true});
  }
  function close() {++version;env.$('changed-work').close();origin?.focus({preventScroll:true});}
  function configure(options) {
    unsubscribe?.();env=options;
    env.$('show-changed-work').onclick=()=>show();env.$('changed-work-close').onclick=close;
    env.$('changed-work-back').onclick=()=>show(false);
    for(const id of ['changed-work-mode','changed-work-project'])env.$(id).onchange=()=>{offset=0;sync();};
    env.$('changed-work-previous').onclick=()=>{offset=Math.max(0,offset-30);sync();};
    env.$('changed-work-next').onclick=()=>{offset+=30;sync();};
    env.$('changed-work').addEventListener('cancel',event=>{event.preventDefault();close();});
    unsubscribe=env.subscribe?.(()=>{sync();env.sidebar();});sync();
  }
  root.DeskChangedWorkView={configure,sync,badge};
})(typeof globalThis==='undefined'?this:globalThis);
