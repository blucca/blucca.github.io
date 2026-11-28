/* Explicit session-bound preparation; no background submission. */
const DeskFollowups=(()=>{
  const el=id=>document.getElementById(id), snapshots=new Map(), editors=new Map(), mutations=new Set(), loads=new Map(), versions=new Map(), messages=new Map();
  let options, session=null, busy=true, signature='', editorView=null, renderedSession=null, sourceRead=null;
  function stopSource(){const previous=sourceRead;sourceRead=null;if(previous?.callbacks)options.closeReader?.(previous.callbacks);}
  const visible=id=>id===session && id===options?.selected();
  const button=(label,action,disabled=false)=>{const b=options.make('button',label);b.type='button';b.disabled=disabled;b.onclick=action;return b;};
  function showError(id,error){if(visible(id)){el('followup-error').textContent=error.message;el('followup-error').hidden=false;}}
  function sourceIdentity(data,kind,identity){
    return kind==='reservation'?data?.reservation:data?.entries.find(entry=>entry.id===identity.id);
  }
  function referenceControls(parent,text,kind,identity){
    if(!options.readEvidenceReference || typeof DeskEvidencePreparation==='undefined')return;
    const references=DeskEvidencePreparation.parse(text),key=JSON.stringify([session,kind,identity,references.map(row=>row.reference)]);
    let panel=parent.referencePanel;
    if(panel?.dataset.signature===key)return;
    if(!panel){panel=options.make('div','','followup-evidence-references');parent.referencePanel=panel;parent.append(panel);}
    panel.dataset.signature=key;panel.replaceChildren();
    for(let referenceIndex=0;referenceIndex<references.length;++referenceIndex){
      const {reference}=references[referenceIndex];
      const read=button('Read referenced original · '+(reference.title || reference.item_id),async()=>{
        const id=session,navigation=options.navigationIdentity?.(),revision=versions.get(id) || 0;
        const same=saved=>!!saved && saved.text===text && saved.mode===identity.mode && saved.revision===identity.revision && saved.state===identity.state &&
          (kind!=='reservation' || saved.token===identity.token && saved.entry_id===identity.entry_id);
        const current=()=>visible(id) && (versions.get(id) || 0)===revision && options.navigationIdentity?.()===navigation &&
          same(sourceIdentity(snapshots.get(id),kind,identity));
        if(!current() || !read.isConnected)return false;
        stopSource();const ticket={id,callbacks:null};sourceRead=ticket;
        const owned=()=>sourceRead===ticket && current();
        const edit=editorView?.session===id?editorView:null,field=edit?.row.querySelector('textarea');
        const view={list:el('followup-list').scrollTop,window:globalThis.scrollY,
          text:field?.value,start:field?.selectionStart,end:field?.selectionEnd,direction:field?.selectionDirection,scroll:field?.scrollTop};
        read.disabled=true;el('followup-error').hidden=true;
        try{
          const latest=await options.api('/api/followups?session='+encodeURIComponent(id));
          if(!owned())return false;
          if(!same(sourceIdentity(latest,kind,identity)))throw Error('This saved instruction changed. Your local edit stays unchanged; refresh the queue.');
          const opened=await options.readEvidenceReference(reference,{owner:{session:id,kind,...identity},ownerCurrent:owned,valid:owned,
            backLabel:kind==='reservation'?'Return to captured instruction':'Return to saved follow-up',
            onReader:callbacks=>{if(owned()){ticket.callbacks=callbacks;
              Object.assign(view,{list:el('followup-list').scrollTop,window:globalThis.scrollY,text:field?.value,start:field?.selectionStart,end:field?.selectionEnd,direction:field?.selectionDirection,scroll:field?.scrollTop});
            }},
            onReturn:()=>{if(!owned())return;sourceRead=null;
              if(field?.isConnected && field.value===view.text){field.focus({preventScroll:true});field.setSelectionRange(view.start,view.end,view.direction);field.scrollTop=view.scroll;}
              else{
                // Another saved entry can redraw this unchanged row behind the
                // reader. Reacquire only its identical panel and exact ordinal.
                const parent=kind==='reservation'?el('followup-review'):
                  [...el('followup-list').children].find(row=>row.dataset.followup===identity.id);
                const panel=parent?.referencePanel;
                const returned=panel?.dataset.signature===key?panel.children[referenceIndex]:null;
                if(returned?.isConnected && !returned.disabled)returned.focus({preventScroll:true});
              }
              el('followup-list').scrollTop=view.list;if(Number.isFinite(view.window))globalThis.scrollTo?.({top:view.window,behavior:'instant'});
            },onError:e=>{if(owned())showError(id,e);}});
          if(!opened && owned())sourceRead=null;return opened;
        }catch(e){if(owned()){showError(id,e);sourceRead=null;}return false;}
        finally{if(read.isConnected)read.disabled=false;}
      });
      panel.append(read);
    }
  }
  function draw(force=false){
    el('followups').hidden=!session;if(!session || !options)return;
    const data=snapshots.get(session), editing=editors.get(session), pending=mutations.has(session);
    const key=JSON.stringify([session,data,editing?.id,pending]);
    el('send').disabled=busy || !!data?.reservation;
    el('followup-send').disabled=busy || pending || !data?.entries.some(e=>e.state==='queued') || !!data?.reservation;
    el('followup-clear').disabled=pending || !data?.entries.some(e=>e.state==='queued');
    options.afterDraw?.();
    el('followup-count').textContent=String(data?.entries.length || 0);
    el('followup-status').textContent=data?.reservation?(data.reservation.state==='unknown'?'Start unconfirmed. Review its activity before sending more.':'Start receipt pending. Review before sending more.'):(messages.get(session) || (data?.entries.length?'Prepared locally. Send next targets this conversation only.':'Write a task below, then choose Save as follow-up.'));
    const reservation=data?.reservation;
    el('followup-review').hidden=!reservation;
    if(reservation){referenceControls(el('followup-review'),reservation.text,'reservation',reservation);el('followup-pending-text').textContent=reservation.text;for(const id of ['followup-confirm-started','followup-confirm-not-started'])el(id).disabled=pending;}
    if(!force && signature===key)return;signature=key;
    const list=el('followup-list'), scroll=renderedSession===session?[list.scrollTop,list.scrollLeft]:null;
    renderedSession=session;
    // Keep the live editor connected. Replacing even an identical textarea
    // loses its caret, IME composition and the next keystroke's focus target.
    const live=editorView?.session===session && editorView.editing===editing
      && list.contains(editorView.row) && data?.entries.some(e=>e.id===editing?.id)?editorView:null;
    if(live){for(const child of [...list.children])if(child!==live.row)child.remove();}
    else{list.replaceChildren();editorView=null;}
    let passedEditor=false;
    for(const entry of data?.entries || []){
      const id=session,retained=live && editing?.id===entry.id,row=retained?live.row:options.make('div','','followup-entry');row.dataset.followup=entry.id;row.dataset.revision=entry.revision;
      const heading=retained?live.heading:options.make('h3');
      heading.textContent=`${entry.order}. ${entry.mode==='plan'?'Plan':'Work'} · ${entry.state==='queued'?'prepared':entry.state==='reserved'?'awaiting start receipt':'needs review'}`;
      if(!retained)row.append(heading);
      if(editing?.id===entry.id){
        if(retained){live.save.disabled=pending;}
        else{
          const text=options.make('textarea');text.value=editing.text;text.setAttribute('aria-label','Follow-up task');text.oninput=()=>{editing.text=text.value;++editing.sequence;};
          const mode=options.make('select');mode.setAttribute('aria-label','Follow-up mode');for(const [value,label] of [['native','Work'],['plan','Plan']]){const o=options.make('option',label);o.value=value;mode.append(o);}mode.value=editing.mode;mode.onchange=()=>{editing.mode=mode.value;++editing.sequence;};
          row.append(text,mode);const actions=options.make('div','','actions');
          const save=button('Save changes',async()=>{const captured={...editing};try{const saved=await mutate(id,'edit',{id:entry.id,text:captured.text,mode:captured.mode,revision:captured.revision});if(editors.get(id)===editing){if(editing.sequence===captured.sequence && editing.text===captured.text && editing.mode===captured.mode)editors.delete(id);else editing.revision=saved.entries.find(e=>e.id===entry.id)?.revision || editing.revision;}if(visible(id))draw(true);}catch(e){showError(id,e);}},pending);
          actions.append(save,button('Cancel edit',()=>{editors.delete(id);draw(true);}));row.append(actions);
          const notice=options.make('p','','muted');row.append(notice);
          editorView={session,editing,row,heading,save,notice};
        }
        editorView.notice.hidden=editing.revision===entry.revision;
        editorView.notice.textContent=editorView.notice.hidden?'':'This entry changed in another tab. Your edit is kept here. Cancel edit to load the latest saved version.';
      }else{
        row.append(options.make('pre',entry.text));const actions=options.make('div','','actions');
        actions.append(button('Edit',()=>{editors.set(id,{id:entry.id,text:entry.text,mode:entry.mode,revision:entry.revision,sequence:0});draw(true);},pending || data.entries.some(e=>e.id===editing?.id)));
        actions.append(button('Remove',()=>mutate(id,'remove',{id:entry.id,revision:entry.revision}).catch(e=>showError(id,e)),pending || entry.state!=='queued'));
        const entries=data.entries;
        for(const [label,delta] of [['Move up',-1],['Move down',1]]){
          const index=entries.findIndex(e=>e.id===entry.id),other=entries[index+delta];
          actions.append(button(label,()=>{const ids=entries.map(e=>e.id),order=[...ids];[ids[index],ids[index+delta]]=[ids[index+delta],ids[index]];mutate(id,'reorder',{ids,order}).catch(e=>showError(id,e));},pending || entry.state!=='queued' || !other || other.state!=='queued'));
        }
        row.append(actions);
      }
      referenceControls(row,entry.text,'followup',entry);
      if(retained)passedEditor=true;
      else if(live && !passedEditor)list.insertBefore(row,live.row);
      else list.append(row);
    }
    if(scroll){list.scrollTop=scroll[0];list.scrollLeft=scroll[1];}
  }
  async function refresh(id=session){
    if(!id || !options)return;
    if(loads.has(id))return loads.get(id);
    const version=versions.get(id) || 0;
    const p=(async()=>{try{const data=await options.api('/api/followups?session='+encodeURIComponent(id));if(version===(versions.get(id) || 0)){snapshots.set(id,data);if(visible(id))draw();}}catch(e){showError(id,e);}finally{loads.delete(id);}})();loads.set(id,p);return p;
  }
  async function mutate(id,action,data){
    if(mutations.has(id))throw new Error('Wait for this preparation change to finish');
    if(sourceRead?.id===id)stopSource();mutations.add(id);versions.set(id,(versions.get(id) || 0)+1);if(visible(id)){el('followup-error').hidden=true;draw();}
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
  return {configure,blocked(id){return !!snapshots.get(id)?.reservation;},select(id){stopSource();session=id;busy=true;signature='';el('followup-error').hidden=true;draw(true);refresh(id);},status(id,value){if(id!==session)return;busy=value;draw();},refresh,async add(id,text,mode){const result=await mutate(id,'',{text,mode});if(visible(id))el('followups').open=true;return result;}};
})();
