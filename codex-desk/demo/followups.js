/* Explicit session-bound preparation; no background submission. */
const DeskFollowups=(()=>{
  const el=id=>document.getElementById(id), snapshots=new Map(), editors=new Map(), mutations=new Set(), loads=new Map(), versions=new Map(), messages=new Map();
  let options, session=null, busy=true, signature='';
  const visible=id=>id===session && id===options?.selected();
  const button=(label,action,disabled=false)=>{const b=options.make('button',label);b.type='button';b.disabled=disabled;b.onclick=action;return b;};
  function showError(id,error){if(visible(id)){el('followup-error').textContent=error.message;el('followup-error').hidden=false;}}
  function draw(force=false){
    el('followups').hidden=!session;if(!session || !options)return;
    const data=snapshots.get(session), editing=editors.get(session), pending=mutations.has(session);
    const key=JSON.stringify([session,data,editing?.id,pending]);
    el('send').disabled=busy || !!data?.reservation;
    el('followup-send').disabled=busy || pending || !data?.entries.some(e=>e.state==='queued') || !!data?.reservation;
    el('followup-clear').disabled=pending || !data?.entries.some(e=>e.state==='queued');
    el('followup-count').textContent=String(data?.entries.length || 0);
    el('followup-status').textContent=data?.reservation?(data.reservation.state==='unknown'?'Start unconfirmed. Review its activity before sending more.':'Start receipt pending. Review before sending more.'):(messages.get(session) || (data?.entries.length?'Prepared locally. Send next targets this conversation only.':'Write a task below, then choose Save as follow-up.'));
    const reservation=data?.reservation;
    el('followup-review').hidden=!reservation;
    if(reservation){el('followup-pending-text').textContent=reservation.text;for(const id of ['followup-confirm-started','followup-confirm-not-started'])el(id).disabled=pending;}
    if(!force && signature===key)return;signature=key;
    const list=el('followup-list');list.replaceChildren();
    for(const entry of data?.entries || []){
      const id=session,row=options.make('div','','followup-entry');row.dataset.followup=entry.id;row.dataset.revision=entry.revision;
      row.append(options.make('h3',`${entry.order}. ${entry.mode==='plan'?'Plan':'Work'} · ${entry.state==='queued'?'prepared':entry.state==='reserved'?'awaiting start receipt':'needs review'}`));
      if(editing?.id===entry.id){
        const text=options.make('textarea');text.value=editing.text;text.setAttribute('aria-label','Follow-up task');text.oninput=()=>{editing.text=text.value;};
        const mode=options.make('select');mode.setAttribute('aria-label','Follow-up mode');for(const [value,label] of [['native','Work'],['plan','Plan']]){const o=options.make('option',label);o.value=value;mode.append(o);}mode.value=editing.mode;mode.onchange=()=>{editing.mode=mode.value;};
        row.append(text,mode);const actions=options.make('div','','actions');
        actions.append(button('Save changes',async()=>{const captured={...editing};try{const saved=await mutate(id,'edit',{id:entry.id,text:captured.text,mode:captured.mode,revision:captured.revision});if(editors.get(id)===editing){if(editing.text===captured.text && editing.mode===captured.mode)editors.delete(id);else editing.revision=saved.entries.find(e=>e.id===entry.id)?.revision || editing.revision;}draw(true);}catch(e){showError(id,e);}},pending),button('Cancel edit',()=>{editors.delete(id);draw(true);}));row.append(actions);
        if(editing.revision!==entry.revision){const notice=options.make('p','This entry changed in another tab. Your edit is kept here. Cancel edit to load the latest saved version.','muted');row.append(notice);}
      }else{
        row.append(options.make('pre',entry.text));const actions=options.make('div','','actions');
        actions.append(button('Edit',()=>{editors.set(id,{id:entry.id,text:entry.text,mode:entry.mode,revision:entry.revision});draw(true);},pending || data.entries.some(e=>e.id===editing?.id)));
        actions.append(button('Remove',()=>mutate(id,'remove',{id:entry.id,revision:entry.revision}).catch(e=>showError(id,e)),pending || entry.state!=='queued'));
        const entries=data.entries;
        for(const [label,delta] of [['Move up',-1],['Move down',1]]){
          const index=entries.findIndex(e=>e.id===entry.id),other=entries[index+delta];
          actions.append(button(label,()=>{const ids=entries.map(e=>e.id),order=[...ids];[ids[index],ids[index+delta]]=[ids[index+delta],ids[index]];mutate(id,'reorder',{ids,order}).catch(e=>showError(id,e));},pending || entry.state!=='queued' || !other || other.state!=='queued'));
        }
        row.append(actions);
      }
      list.append(row);
    }
  }
  async function refresh(id=session){
    if(!id || !options)return;
    if(loads.has(id))return loads.get(id);
    const version=versions.get(id) || 0;
    const p=(async()=>{try{const data=await options.api('/api/followups?session='+encodeURIComponent(id));if(version===(versions.get(id) || 0)){snapshots.set(id,data);if(visible(id))draw();}}catch(e){showError(id,e);}finally{loads.delete(id);}})();loads.set(id,p);return p;
  }
  async function mutate(id,action,data){
    if(mutations.has(id))throw new Error('Wait for this preparation change to finish');
    mutations.add(id);versions.set(id,(versions.get(id) || 0)+1);if(visible(id)){el('followup-error').hidden=true;draw();}
    try{const result=await options.api('/api/followups'+(action?'/'+action:''),{session:id,...data});versions.set(id,(versions.get(id) || 0)+1);snapshots.set(id,result);messages.set(id,result.receipt?.outcome==='unknown'?'Start unconfirmed. Check activity and review the receipt.':action==='send'?'Start accepted. Remaining follow-ups stay prepared.':'Preparation saved locally.');return result;}
    catch(e){await loads.get(id);loads.delete(id);await refresh(id);throw e;}
    finally{mutations.delete(id);if(visible(id))draw();}
  }
  function configure(value){options=value;
    el('followup-refresh').onclick=()=>refresh();
    el('followup-send').onclick=async()=>{const id=session,data=snapshots.get(id),entry=data?.entries.find(e=>e.state==='queued');if(!entry || el('followup-send').disabled)return;try{await mutate(id,'send',{id:entry.id,revision:entry.revision});await options.refresh();}catch(e){showError(id,e);await options.refresh();}};
    el('followup-clear').onclick=()=>{const id=session,data=snapshots.get(id);if(data)mutate(id,'clear',{order:data.entries.map(e=>e.id)}).catch(e=>showError(id,e));};
    for(const [control,outcome] of [['followup-confirm-started','accepted'],['followup-confirm-not-started','rejected']])el(control).onclick=()=>{const id=session,r=snapshots.get(id)?.reservation;if(r)mutate(id,'resolve',{token:r.token,id:r.entry_id,revision:r.revision,outcome}).catch(e=>showError(id,e));};
  }
  return {configure,blocked(id){return !!snapshots.get(id)?.reservation;},select(id){session=id;busy=true;signature='';el('followup-error').hidden=true;draw(true);refresh(id);},status(id,value){if(id!==session)return;busy=value;draw();},refresh,async add(id,text,mode){const result=await mutate(id,'',{text,mode});if(visible(id))el('followups').open=true;return result;}};
})();
