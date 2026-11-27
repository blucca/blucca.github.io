/* Pure captured-request presentation, shared with the selected Run widget. */
(function(root){
  function bindingText(binding){
    if(!binding)return 'Target unavailable';
    return `Native home: ${binding.native_home}
Project: ${binding.cwd}
Profile: ${binding.profile}
Native conversation: ${binding.thread_id || '(not attached)'}`;
  }
  function sameBinding(a,b){return !!a && !!b && ['session','native_home','cwd','profile','thread_id'].every(key=>a[key]===b[key]);}
  function captured(request){
    const body=request?.result?.request?.payload || request?.body;
    return body?{session:request.session,token:request.token,text:body.text,mode:body.mode,
      title:`Captured ${body.mode==='plan'?'Plan':'Work'} task`}:null;
  }
  root.DeskTurnReview={bindingText,sameBinding,captured};
})(typeof globalThis==='undefined'?this:globalThis);

/* Local preparation review; native work starts only through an explicit Open callback. */
(function(root){
  const el=id=>document.getElementById('preparation'+(id?'-'+id:''));
  const editors=new Map(), projects=new Set(), writer=crypto.randomUUID();
  let lookup=null,lookupSavedAt=0,modalVersion=0,savedMatch=null;
  let options,rows=new Map(),selected=null,displayed=null,listVersion=0,selectionVersion=0,saveVersion=0,reading=false,returnOrigin=null,evidenceView=null;
  const scope=()=>({cwd:el('project').value,archived:el('archived').checked});
  const sameScope=(a,b)=>a.cwd===b.cwd && a.archived===b.archived;
  const make=(tag,text,cls)=>options.make(tag,text,cls);
  const visible=id=>el('').open && selected===id;
  const modeLabel=mode=>mode==='plan'?'Plan':'Work';
  const name=row=>row.name || row.cwd || row.id;
  function draft(value){
    if(!value || typeof value.text!=='string' || !['native','plan'].includes(value.mode) ||
       !Number.isInteger(value.revision) || value.revision<0)throw new Error('The saved draft could not be read. Choose Review draft to retry.');
    return {text:value.text,mode:value.mode,revision:value.revision};
  }
  function changed(editor){return !editor.saved || editor.text!==editor.saved.text || editor.mode!==editor.saved.mode;}
  function error(message,id=null){
    if(id && !visible(id))return;
    el('error').textContent=message;el('error').hidden=false;
  }
  function button(label,action,disabled=false){
    const node=make('button',label);node.type='button';node.disabled=disabled;node.onclick=action;return node;
  }
  function focusEditor(){
    if(el('').open)el(editors.get(selected)?.ready?'text':'editor-title').focus({preventScroll:true});
  }
  function remember(){
    if(!el('').open)return;
    rememberQueueViews();
    const editor=editors.get(selected);if(!editor?.ready)return;
    const text=el('text').value,mode=el('mode').value;
    if(editor.text!==text || editor.mode!==mode){editor.text=text;editor.mode=mode;++editor.sequence;}
    const node=el('text');editor.view={text,start:node.selectionStart,end:node.selectionEnd,
      direction:node.selectionDirection,scroll:node.scrollTop};
  }
  function edit(){
    remember();const editor=editors.get(selected);if(!editor)return;
    editor.message='Unsaved edits kept for this page. Choose Save draft or Save draft and open.';controls();
  }
  function controls(){
    el('refresh').disabled=false;el('list').setAttribute('aria-busy',String(reading));
    const editor=editors.get(selected),ready=!!editor?.ready;
    el('editor').hidden=!editor;
    for(const id of ['text','mode'])el(id).disabled=!ready;
    el('save').disabled=!ready || editor.saving || !!editor.conflict;
    el('copy').disabled=!ready || !editor.text;
    el('open').hidden=!options?.openConversation;
    el('open').disabled=!editor || editor.saving || !!editor.opening;
    el('open').textContent=ready && changed(editor)?'Open without these edits':'Open conversation';
    el('save-open').hidden=!options?.openConversation;
    el('save-open').disabled=!ready || editor.saving || !!editor.conflict || !!editor.opening;
    el('conflict').hidden=!editor?.conflict;
    el('keep').disabled=el('load').disabled=!editor?.conflict || editor.saving;
    el('draft-status').textContent=editor?.conflict?'This draft changed elsewhere. Your edits are kept; choose Keep mine or Load saved.':
      (editor?.message || 'Review preparation. Nothing has been sent.');
    drawEvidence(editor);options?.onEvidenceChange?.();
    const reuse=editor?.reuse;el('reuse').hidden=!reuse;
    el('reuse-text').textContent=reuse?modeLabel(reuse.mode)+' instruction to reuse:\n'+reuse.text:'';
    el('append').disabled=el('replace').disabled=!ready || editor.saving || !!editor.conflict;
  }
  function evidenceDestination(){
    if(!el('').open)return null;
    remember();const editor=editors.get(selected);
    if(!editor?.ready)return null;
    return {session:selected,generation:'prepared:'+selectionVersion+':'+(options.navigationIdentity?.() || ''),
      revision:editor.revision,sequence:editor.sequence,writer,text:editor.text,mode:editor.mode,
      name:name(editor.row),cwd:editor.row.cwd,kind:'prepared',
      busy:reading || !!editor.loading || editor.saving || !!editor.opening || !!editor.conflict};
  }
  function sameEvidenceOwner(owner){
    const current=evidenceDestination();return !!current && current.session===owner.session && current.generation===owner.generation && current.writer===owner.writer;
  }
  async function saveReviewedEvidence(payload,capture){
    if(!root.DeskEvidencePreparation.sameDestination(capture,evidenceDestination()) ||
       payload.session!==capture.session || payload.writer!==capture.writer || payload.revision!==capture.revision ||
       payload.mode!==capture.mode || payload.sequence!==capture.sequence+1)throw Error('The Prepared destination changed. Review its current draft.');
    const editor=editors.get(selected);
    // Reserve before invoking the ordinary revisioned write. Later typing starts
    // from this appended text and gets a later sequence, even during the reply.
    editor.sequence=payload.sequence;editor.text=payload.text;editor.mode=payload.mode;drawEditor();
    let receipt=null;const saved=await save(next=>{receipt=next;});
    if(!saved){const failure=Error(editor.message || 'The reviewed Prepared draft was not saved.');if(editor.conflict){failure.status=409;failure.current={...editor.conflict};}throw failure;}
    if(!receipt || receipt.text!==payload.text || receipt.mode!==payload.mode)throw Error('The local save did not confirm this reviewed Prepared draft.');
    return receipt;
  }
  function readEvidence(reference,source){
    const owner=evidenceDestination();if(!owner || !options.readEvidenceReference)return false;
    remember();const editor=editors.get(selected),view={...editor.view},scroll=el('').scrollTop;
    source.disabled=true;
    return Promise.resolve(options.readEvidenceReference(reference,{owner,ownerCurrent:sameEvidenceOwner,
      backLabel:'Return to Prepared work',onReturn:()=>{
        if(!sameEvidenceOwner(owner))return;
        // Keep queue/request review controls in their original row. Only restore
        // an editor range if its text still equals the captured unsent draft.
        el('').scrollTop=scroll;
        const current=editors.get(owner.session);
        if(source.isConnected!==false && !source.disabled){source.focus({preventScroll:true});}
        else focusEditor();
        if(current.text===view.text){el('text').setSelectionRange?.(view.start,view.end,view.direction);el('text').scrollTop=view.scroll;}
      },onError:failure=>error(failure.message,owner.session)})).finally(()=>{if(source.isConnected!==false)source.disabled=false;});
  }
  function evidenceButtons(text,container){
    if(!options.readEvidenceReference || !root.DeskEvidencePreparation)return;
    for(const {reference} of root.DeskEvidencePreparation.parse(text)){
      const read=button('Read referenced original · '+(reference.title || reference.item_id),()=>readEvidence(reference,read));
      read.dataset.control='read-evidence';container.append(read);
    }
  }
  function drawEvidence(editor){
    if(!evidenceView)return;
    evidenceView.browse.disabled=!editor?.ready || reading || !!editor?.loading || editor.saving || !!editor.opening || !!editor.conflict;
    const signature=JSON.stringify([selected,selectionVersion,editor?.text]);
    if(evidenceView.signature===signature)return;
    evidenceView.signature=signature;evidenceView.list.replaceChildren();
    if(editor?.ready)evidenceButtons(editor.text,evidenceView.list);
  }
  function drawProjects(){
    const choice=el('project').value;
    if(choice)projects.add(choice);
    const all=make('option','All prepared projects');all.value='';
    el('project').replaceChildren(all,...[...projects].sort().map(cwd=>{
      const row=make('option',cwd);row.value=cwd;return row;
    }));el('project').value=choice;
  }
  function updateRow(row){
    const editor=editors.get(row.id);if(!editor)return;
    editor.row=row;
    reconcileQueueEdits(editor);
    if(row.draft){
      const latest=draft(row.draft);
      if(!editor.ready){Object.assign(editor,latest,{saved:latest,ready:true});editor.message='Saved draft loaded. Nothing has been sent.';}
      else if(latest.revision>editor.revision && (!editor.conflict || latest.revision>editor.conflict.revision))editor.conflict=latest;
    }
    if(editor.reuse && !reuseEntry(editor)){
      editor.reuse=null;editor.message='The prepared instruction changed. Review it again before reusing.';
    }
  }
  function drawList(){
    const focus=document.activeElement,focusId=focus?.dataset?.session,focusControl=focus?.dataset?.control;
    const groups=new Map();
    for(const row of rows.values()){
      if(!groups.has(row.cwd))groups.set(row.cwd,[]);groups.get(row.cwd).push(row);
    }
    const list=el('list');list.replaceChildren();
    let restore=null;
    for(const [cwd,sessions] of groups){
      const group=make('section','','preparation-group');group.append(make('h3',cwd || 'Project folder unreported'));
      for(const row of sessions){
        const entries=row.followups?.entries || [],queued=entries.filter(entry=>entry.state==='queued').length;
        const item=make('article','','preparation-session');item.dataset.session=row.id;
        item.append(make('h4',name(row)),make('p',options.profileLabel(row.profile)+' · '+row.status+(row.archived?' · Archived locally':''),'muted'));
        const summary=[row.draft?.text?modeLabel(row.draft.mode)+' draft':'No saved draft',queued+' prepared follow-up'+(queued===1?'':'s'),
          row.followups?.reservation || entries.some(entry=>entry.state!=='queued')?'Start review pending':'',
          row.turn_request?modeLabel(row.turn_request.mode)+' task request · '+(row.turn_request.status==='pending'?'Receipt pending':'Needs review'):''].filter(Boolean).join(' · ');
        item.append(make('p',summary,'muted'));
        if(row.draft || entries.length || row.followups?.reservation){
          const review=button('Review draft and follow-ups',()=>select(row.id));
          review.dataset.session=row.id;review.dataset.control='review';
          review.setAttribute('aria-label','Review preparation in '+name(row));
          if(row.id===selected)review.setAttribute('aria-current','true');
          if(row.id===focusId && focusControl==='review')restore=review;
          item.append(review);
        }
        if(row.turn_request){
          const request=button('Review task request',()=>reviewRequest(row));
          request.dataset.session=row.id;request.dataset.control='request';request.dataset.token=row.turn_request.token;
          request.setAttribute('aria-label','Review task request in '+name(row));
          if(row.id===focusId && focusControl==='request' && focus.dataset.token===row.turn_request.token)restore=request;
          item.append(request);
        }
        group.append(item);
      }
      list.append(group);
    }
    if(restore && !el('request').open)restore.focus({preventScroll:true});
  }
  async function copy(id,text,label){
    const editor=editors.get(id);if(editor){editor.message='Copying…';if(visible(id))controls();}
    try{
      await navigator.clipboard.writeText(text);
      if(editor)editor.message=label+' copied.';
    }catch{
      if(editor)editor.message='Copy failed — select the text to copy.';
    }finally{if(visible(id))controls();}
  }
  function queueEntry(editor,id){return editor.row.followups?.entries?.find(e=>e.id===id);}
  function rememberQueueViews(){
    const editor=editors.get(selected);if(!editor?.queueEdits)return;
    for(const node of el('followups').querySelectorAll('textarea')){
      const edit=editor.queueEdits.get(node.dataset.followup);if(!edit || node.dataset.session!==editor.row.id)continue;
      edit.view={start:node.selectionStart,end:node.selectionEnd,direction:node.selectionDirection,scroll:node.scrollTop};
    }
  }
  function reconcileQueueEdits(editor){
    for(const edit of editor.queueEdits?.values() || []){
      const entry=queueEntry(editor,edit.id);
      edit.unavailable=!entry || entry.state!=='queued';
      if(entry && entry.revision>edit.revision)edit.conflict={...entry};
    }
  }
  function beginQueueEdit(editor,entry){
    if(!visible(editor.row.id) || entry.state!=='queued')return;
    remember();editor.queueEdits??=new Map();
    if(!editor.queueEdits.has(entry.id))editor.queueEdits.set(entry.id,
      {id:entry.id,text:entry.text,mode:entry.mode,revision:entry.revision,sequence:0,busy:false,conflict:null,view:null});
    drawFollowups(editor);
    const node=[...el('followups').querySelectorAll('textarea')].find(n=>n.dataset.followup===entry.id);
    node?.focus({preventScroll:true});
  }
  function cancelQueueEdit(editor,id){
    remember();editor.queueEdits?.delete(id);
    if(visible(editor.row.id))drawFollowups(editor);
  }
  async function queueConflict(editor,snapshot,current,id){
    if(editor.row.followups!==snapshot)return;
    let latest=current;
    // Edit/remove 409s carry one entry, not a complete queue. Read its
    // exact session before offering a revision choice or changing order.
    if(!Array.isArray(latest?.entries)){
      if(!id || latest?.entry?.id!==id)return;
      const version=saveVersion;
      latest=await options.api('/api/followups?session='+encodeURIComponent(editor.row.id));
      if(version!==saveVersion || editor.row.followups!==snapshot)return;
    }
    if(Array.isArray(latest?.entries))editor.row.followups=latest;
  }
  async function saveQueueEdit(editor,id){
    const edit=editor.queueEdits?.get(id),entry=queueEntry(editor,id);
    if(!visible(editor.row.id) || editor.queueBusy || !edit || edit.busy || edit.conflict || !entry || entry.state!=='queued')return false;
    const sequence=edit.sequence,snapshot=editor.row.followups;
    const payload={session:editor.row.id,id,text:edit.text,mode:edit.mode,revision:edit.revision};
    edit.busy=true;edit.message='Saving this queued instruction locally…';++saveVersion;
    drawFollowups(editor);
    try{
      const result=await options.api('/api/followups/edit',payload);
      const saved=result?.entries?.find(e=>e.id===id);
      if(!saved || saved.text!==payload.text || saved.mode!==payload.mode || !Number.isInteger(saved.revision) || saved.revision<=payload.revision)
        throw Error('Queue save receipt did not match this instruction. Refresh preparation to check it.');
      ++saveVersion;
      if(editor.row.followups===snapshot)editor.row.followups=result;
      if(editor.queueEdits?.get(id)!==edit)return true;
      edit.revision=saved.revision;edit.conflict=null;
      edit.message=sequence===edit.sequence?'Queued instruction saved locally.':'Earlier edit saved. Your newer edits are kept; choose Save instruction.';
      reconcileQueueEdits(editor);return true;
    }catch(e){
      if(editor.queueEdits?.get(id)===edit){
        try{await queueConflict(editor,snapshot,e.current,id);}catch(readError){e.message+=' Choose Refresh to read the current queue.';}
        reconcileQueueEdits(editor);
        edit.message=e.message;
      }
      return false;
    }finally{
      edit.busy=false;
      if(visible(editor.row.id) && editor.queueEdits?.get(id)===edit){rememberQueueViews();drawFollowups(editor);}
    }
  }
  async function changeQueue(editor,path,payload){
    if(!visible(editor.row.id) || editor.queueBusy)return false;
    remember();const snapshot=editor.row.followups;
    editor.queueBusy=true;editor.queueMessage='Updating saved queued instructions locally…';++saveVersion;
    drawFollowups(editor);
    try{
      const result=await options.api(path,{session:editor.row.id,...payload});
      if(!Array.isArray(result?.entries))throw Error('Queue receipt unavailable. Refresh saved preparation to check it.');
      ++saveVersion;
      if(editor.row.followups===snapshot){editor.row.followups=result;reconcileQueueEdits(editor);editor.queueMessage='Saved queue updated locally. Nothing has been sent.';}
      else editor.queueMessage='Saved queue updated. Choose Refresh to read the latest order; your local edits are kept.';
      return true;
    }catch(e){
      try{await queueConflict(editor,snapshot,e.current,payload.id);}catch(readError){e.message+=' Choose Refresh to read the current queue.';}
      reconcileQueueEdits(editor);
      editor.queueMessage=e.message;return false;
    }finally{editor.queueBusy=false;if(visible(editor.row.id))drawFollowups(editor);}
  }
  function moveQueueEntry(editor,entry,direction){
    const entries=editor.row.followups?.entries || [],index=entries.findIndex(e=>e.id===entry.id),next=index+direction;
    if(index<0 || next<0 || next>=entries.length || entries.some(e=>e.state!=='queued') || editor.row.followups?.reservation)return false;
    const order=entries.map(e=>e.id),ids=[...order];[ids[index],ids[next]]=[ids[next],ids[index]];
    return changeQueue(editor,'/api/followups/reorder',{ids,order});
  }
  function drawQueueEdit(editor,entry,box,action){
    const edit=editor.queueEdits?.get(entry.id);if(!edit)return;
    const text=make('textarea','','preparation-queue-text');text.value=edit.text;text.rows=5;
    text.dataset.session=editor.row.id;text.dataset.followup=entry.id;text.dataset.control='queue-text';
    text.setAttribute('aria-label','Queued instruction in '+name(editor.row));
    const mode=make('select');mode.dataset.session=editor.row.id;mode.dataset.followup=entry.id;mode.dataset.control='queue-mode';
    for(const value of ['native','plan']){const option=make('option',modeLabel(value));option.value=value;mode.append(option);}mode.value=edit.mode;
    mode.setAttribute('aria-label','Queued instruction mode');
    text.oninput=()=>{edit.text=text.value;++edit.sequence;};mode.onchange=()=>{edit.mode=mode.value;++edit.sequence;};
    text.disabled=mode.disabled=!!edit.unavailable;
    const status=make('p',edit.unavailable?'Instruction is no longer queued. Your local edit is kept.':
      edit.conflict?'This instruction changed elsewhere. Your edits are kept.':edit.message || 'Unsaved queue edit. Nothing has been sent.','muted');status.setAttribute('role','status');
    box.append(text,mode,status);
    if(edit.conflict){
      box.append(make('pre',edit.conflict.text));
      box.append(action('Load current instruction',()=>{
        if(edit.busy || edit.conflict.state!=='queued')return;
        Object.assign(edit,{text:edit.conflict.text,mode:edit.conflict.mode,revision:edit.conflict.revision,conflict:null,view:null});
        ++edit.sequence;drawFollowups(editor);
      },'queue-load',entry,edit.busy || edit.unavailable));
      box.append(action('Keep my instruction edit',()=>{
        if(edit.busy || edit.conflict.state!=='queued')return;
        edit.revision=edit.conflict.revision;edit.conflict=null;edit.message='Your edit is kept. Choose Save instruction to replace the current revision.';drawFollowups(editor);
      },'queue-keep',entry,edit.busy || edit.unavailable));
    }
    box.append(action('Save instruction',()=>saveQueueEdit(editor,entry.id),'queue-save',entry,editor.queueBusy || edit.busy || !!edit.conflict || edit.unavailable),
      action('Cancel instruction edit',()=>cancelQueueEdit(editor,entry.id),'queue-cancel',entry));
    if(edit.view){text.setSelectionRange?.(edit.view.start,edit.view.end,edit.view.direction);text.scrollTop=edit.view.scroll;}
  }
  function drawFollowups(editor){
    rememberQueueViews();
    const container=el('followups'),focus=document.activeElement;
    const owned=container.contains(focus) && focus?.dataset?.session===editor.row.id;
    let restore=null;
    function action(label,callback,control,entry=null,disabled=false){
      const node=button(label,callback,disabled);node.dataset.session=editor.row.id;node.dataset.control=control;
      if(entry)node.dataset.followup=entry.id;
      if(owned && focus.dataset.control===control && focus.dataset.followup===node.dataset.followup)restore=node;
      return node;
    }
    container.replaceChildren();
    const reservation=editor.row.followups?.reservation;
    if(reservation){
      const box=make('section','','preparation-reservation');box.dataset.session=editor.row.id;box.dataset.token=reservation.token;box.dataset.control='reservation';box.tabIndex=-1;
      box.append(make('h4',reservation.state==='unknown'?'Start unconfirmed':'Start receipt pending'),
        make('p','Captured instruction. Open this conversation to review its activity and start receipt.','muted'),make('pre',reservation.text));evidenceButtons(reservation.text,box);
      box.append(action('Copy captured instruction',()=>copy(editor.row.id,reservation.text,'Captured instruction'),'copy-captured'));container.append(box);
    }
    if(editor.queueMessage)container.append(make('p',editor.queueMessage,'muted'));
    const savedEntries=editor.row.followups?.entries || [],blocked=!!reservation || savedEntries.some(e=>e.state!=='queued');
    if(savedEntries.length)container.append(action('Clear saved queued instructions',()=>changeQueue(editor,'/api/followups/clear',{order:savedEntries.map(e=>e.id)}),'queue-clear',null,blocked || editor.queueBusy));
    const entries=[...savedEntries];
    for(const edit of editor.queueEdits?.values() || [])if(!entries.some(e=>e.id===edit.id))entries.push({id:edit.id,text:edit.text,mode:edit.mode,revision:edit.revision,order:'Removed',state:'unavailable'});
    for(const entry of entries){
      const box=make('article','','preparation-followup');box.dataset.followup=entry.id;box.dataset.session=editor.row.id;box.dataset.control='followup';box.tabIndex=-1;
      const state={queued:'Prepared',reserved:'Awaiting start receipt',needs_review:'Needs start review',unavailable:'No longer queued'}[entry.state] || 'State unreported';
      box.append(make('h4',entry.order+'. '+modeLabel(entry.mode)+' · '+state),make('pre',entry.text));evidenceButtons(entry.text,box);
      const actions=make('div','','actions');
      actions.append(action('Copy instruction',()=>copy(editor.row.id,entry.text,'Instruction'),'copy-followup',entry));
      if(entry.state==='queued'){
        const index=savedEntries.findIndex(e=>e.id===entry.id),edit=editor.queueEdits?.get(entry.id);
        actions.append(action('Edit instruction',()=>beginQueueEdit(editor,entry),'queue-edit',entry,editor.queueBusy));
        actions.append(action('Remove saved instruction',()=>changeQueue(editor,'/api/followups/remove',{id:entry.id,revision:entry.revision}),'queue-remove',entry,editor.queueBusy || edit?.busy));
        actions.append(action('Move instruction up',()=>moveQueueEntry(editor,entry,-1),'queue-up',entry,blocked || editor.queueBusy || index===0));
        actions.append(action('Move instruction down',()=>moveQueueEntry(editor,entry,1),'queue-down',entry,blocked || editor.queueBusy || index===savedEntries.length-1));
      }
      if(entry.state==='queued')actions.append(action('Use in this session draft',()=>{
        if(!visible(editor.row.id))return;
        remember();editor.reuse={id:entry.id,revision:entry.revision,text:entry.text,mode:entry.mode};
        editor.message='Review this destination draft, then choose Append or Replace. The follow-up stays prepared.';controls();
        el('reuse').scrollIntoView({block:'nearest'});
        el('reuse-text').focus({preventScroll:true});
      },'reuse-followup',entry,!editor.ready));
      box.append(actions);drawQueueEdit(editor,entry,box,action);container.append(box);
    }
    if(!entries.length && !reservation)container.append(make('p','No prepared follow-ups for this conversation.','muted'));
    // Refresh and a save receipt replace these controls. Restore the exact
    // session/instruction/action, never another row with the same text or ID.
    if(owned && el('').open){
      if(['queue-text','queue-mode'].includes(focus.dataset.control)){
        restore=[...container.querySelectorAll(focus.dataset.control==='queue-text'?'textarea':'select')].find(n=>n.dataset.followup===focus.dataset.followup);
      }
      if(restore && !restore.disabled)restore.focus({preventScroll:true});else focusEditor();
    }
    // Apply a textarea's view only after its row is attached and focus restored.
    for(const text of container.querySelectorAll('textarea')){
      const view=editor.queueEdits?.get(text.dataset.followup)?.view;
      if(view){text.setSelectionRange?.(view.start,view.end,view.direction);text.scrollTop=view.scroll;}
    }
  }
  function drawEditor(restore=false){
    const editor=editors.get(selected);
    const reuseEnded=!editor?.reuse && ['reuse-text','append','replace','reuse-cancel'].some(id=>document.activeElement===el(id));
    controls();if(!editor)return;
    const row=editor.row;
    el('editor-title').textContent='Preparation in '+name(row);
    el('editor-binding').textContent=row.cwd+'\n'+options.profileLabel(row.profile)+
      (row.archived?' · Archived locally':'')+(!rows.has(row.id)?'\nNot listed in the current scope; your local editor is retained.':'');
    const switching=displayed!==selected,replaced=el('text').value!==editor.text;displayed=selected;
    if(replaced)el('text').value=editor.text;
    if(el('mode').value!==editor.mode)el('mode').value=editor.mode;
    drawFollowups(editor);
    if(reuseEnded)focusEditor();
    if((switching || replaced || restore) && editor.view?.text===editor.text){
      el('text').setSelectionRange?.(editor.view.start,editor.view.end,editor.view.direction);
      el('text').scrollTop=editor.view.scroll;
    }
  }
  async function loadEditor(editor){
    if(editor.loading)return editor.loading;
    const id=editor.row.id;
    const task=(async()=>{
      try{
        const saved=draft(await options.api('/api/draft?session='+encodeURIComponent(id)));
        // An aggregate refresh can initialize this editor while its first read waits.
        if(!editor.ready){
          Object.assign(editor,saved,{saved,ready:true});editor.message=saved.text?'Saved draft loaded. Nothing has been sent.':'No saved draft. Prepare text and choose Save draft.';
        }else if(saved.revision>editor.revision && (!editor.conflict || saved.revision>editor.conflict.revision))editor.conflict=saved;
      }catch(e){editor.message=e.message;error(e.message,id);}
      finally{editor.loading=null;if(visible(id))drawEditor();}
    })();editor.loading=task;return task;
  }
  async function select(id){
    const row=rows.get(id);if(!row)return false;
    remember();if(savedMatch)savedMatch.panel.hidden=true;const ticket=++selectionVersion;selected=id;el('error').hidden=true;
    let editor=editors.get(id);
    if(!editor){
      editor={row,text:'',mode:'native',revision:0,saved:null,ready:false,sequence:0,saving:false,conflict:null,reuse:null,message:'Reading saved local draft…'};
      if(row.draft){const saved=draft(row.draft);Object.assign(editor,saved,{saved,ready:true,message:'Saved draft loaded. Nothing has been sent.'});}
      editors.set(id,editor);
    }else updateRow(row);
    drawList();drawEditor();
    const focus=document.activeElement;
    if(!editor.ready)await loadEditor(editor);
    if(ticket===selectionVersion && visible(id) && editor.ready && document.activeElement===focus)focusEditor();
    return editor.ready;
  }
  function snapshotRows(data){
    if(!Array.isArray(data?.sessions))throw Error('Prepared work could not be read. Choose Refresh.');
    const incoming=new Map();
    for(const row of data.sessions){
      if(!row || typeof row.id!=='string' || !row.id || incoming.has(row.id) || typeof row.cwd!=='string' ||
        (row.turn_request && !root.DeskPreparedRequest.validIdentity(row.id,row.turn_request.token)))throw Error('Prepared conversation identity is unavailable. Choose Refresh.');
      if(row.draft)draft(row.draft);
      incoming.set(row.id,row);
    }
    return incoming;
  }
  async function acceptLookup(data,valid){
    const savedAt=lookupSavedAt,query=scope(),incoming=snapshotRows(data);
    const current=()=>valid() && savedAt===saveVersion;
    if(!current())throw Error('Saved preparation changed during Search. Choose Search again.');
    remember();
    const reviewed=editors.get(selected);
    if(reviewed && !incoming.get(selected)?.draft){
      await loadEditor(reviewed);if(!current())return false;
    }
    if(reviewed?.queueEdits?.size && !incoming.has(reviewed.row.id) &&
      (!query.cwd || query.cwd===reviewed.row.cwd) && (query.archived || !reviewed.row.archived)){
      const latest=await options.api('/api/followups?session='+encodeURIComponent(reviewed.row.id));
      if(!current())return false;
      reviewed.row={...reviewed.row,followups:latest};reconcileQueueEdits(reviewed);
    }
    if(!current())return false;
    remember();for(const row of incoming.values()){projects.add(row.cwd);updateRow(row);}
    rows=incoming;drawProjects();drawList();drawEditor();
    el('status').textContent=rows.size+' saved-work owner'+(rows.size===1?'':'s')+' in this scope. Local editors are retained.';
    return true;
  }
  function lookupReturn(index,scroll){
    if(!el('').open)return;
    const source=[...el('find-results').querySelectorAll('button')].find(node=>node.dataset.match===String(index));
    el('').scrollTop=scroll;(source || el('find-search')).focus({preventScroll:true});
  }
  async function reviewLookupMatch(match,context){
    const before=selectionVersion,savedAt=saveVersion,query=scope(),scroll=el('').scrollTop;
    const current=()=>context.valid() && before===selectionVersion && savedAt===saveVersion;
    try{
      // Re-read the scoped owner's existing local sources before switching or
      // exposing controls. No native Open, queue write or draft save occurs.
      const params=new URLSearchParams({archived:String(query.archived)});if(query.cwd)params.set('cwd',query.cwd);
      const data=await options.api('/api/preparation?'+params);
      if(!current())return false;
      const row=snapshotRows(data).get(match.session_id);
      if(!root.DeskPreparationFind.matches(row,match))throw Error('This saved match changed. Your local edits are kept; choose Search again.');
      rows.set(row.id,row);const selectedReady=await select(row.id);
      const owned=()=>context.valid() && selectionVersion===before+1 && visible(row.id);
      if(!owned())return false;
      if(match.kind==='turn_request')return reviewRequest(row,{...context,valid:owned,scroll,
        // The persisted pending intent becomes needs_review on a cold read
        // when no admission gate is live; its exact captured body is unchanged.
        verifyReceipt:result=>(result.request?.status===match.state ||
          (match.state==='pending' && result.request?.status==='needs_review')) && result.request?.payload?.mode===match.mode &&
          typeof result.request?.payload?.text==='string' && result.request.payload.text.includes(match.match_text)});
      if(!selectedReady)return false;
      if(match.kind==='draft'){
        savedMatch.title.textContent='Saved '+modeLabel(row.draft.mode)+' draft · revision '+row.draft.revision;
        savedMatch.text.textContent=row.draft.text;savedMatch.panel.hidden=false;
        savedMatch.panel.scrollIntoView({block:'nearest'});savedMatch.text.focus({preventScroll:true});
      }else if(match.kind==='followup' || match.kind==='reservation'){
        const source=[...el('followups').querySelectorAll(match.kind==='followup'?'article':'section')].find(node=>
          node.dataset.session===row.id && node.dataset.control===match.kind &&
          (match.kind==='followup'?node.dataset.followup===match.followup_id:node.dataset.token===match.token));
        if(!source)throw Error('The exact saved instruction is unavailable. Choose Search again.');
        source.scrollIntoView({block:'nearest'});source.focus({preventScroll:true});
      }else focusEditor();
      return true;
    }catch(failure){if(context.valid() && (selectionVersion===before || selectionVersion===before+1))error(failure.message);return false;}
  }
  function drawLookup(state){
    if(!lookup)return;
    reading=!!state?.pending;controls();el('find').hidden=!state;
    el('find-search').disabled=!!state?.pending;
    el('find-previous').disabled=!state?.data || state.pending || state.offset===0;
    el('find-next').disabled=!state?.data?.lookup.has_more || state.pending;
    const list=el('find-results');list.replaceChildren();list.setAttribute('aria-busy',String(!!state?.pending));
    if(!state)return;
    el('find-status').textContent=state.pending?'Searching saved preparation…':state.error || (state.data?
      (state.data.lookup.total?`${state.offset+1}–${state.offset+state.data.lookup.results.length} of ${state.data.lookup.total} matches for “${state.data.lookup.q}”.`:
        `No saved preparation matches for “${state.data.lookup.q}”.`):'Choose Search again.');
    const labels={session:'Conversation title',draft:'Saved draft',followup:'Saved follow-up',reservation:'Captured instruction',turn_request:'Retained Run request'};
    for(const [index,match] of (state.data?.lookup.results || []).entries()){
      const item=make('article','','preparation-find-match');item.dataset.session=match.session_id;
      item.append(make('h3',labels[match.kind]+' · '+(match.name || match.session_id)),
        make('p',match.cwd+' · '+options.profileLabel(match.profile)+(match.archived?' · Archived locally':''),'muted'));
      const snippet=make('pre');snippet.textContent=match.snippet;item.append(snippet);
      const review=button('Review '+labels[match.kind].toLowerCase(),()=>lookup.select(index));
      review.dataset.match=String(index);review.dataset.session=match.session_id;review.dataset.control=match.control;
      review.setAttribute('aria-label','Review '+labels[match.kind].toLowerCase()+' in '+(match.name || match.session_id));item.append(review);list.append(item);
    }
  }
  function invalidateLookup(){lookup?.invalidate();if(savedMatch)savedMatch.panel.hidden=true;}
  function searchLookup(offset=0){
    remember();++listVersion;lookupSavedAt=saveVersion;return lookup.search(offset);
  }
  function configureLookup(){
    if(!root.DeskPreparationFind)return;
    const panel=make('section'),title=make('h4'),text=make('pre');panel.id='preparation-saved-match';panel.hidden=true;text.tabIndex=-1;
    panel.append(title,make('p','Saved original only. Any unsaved draft below stays unchanged.','muted'),text);el('editor').append(panel);savedMatch={panel,title,text};
    lookup=root.DeskPreparationFind.create({api:options.api,
      current:()=>({...scope(),open:el('').open,q:el('find-query').value,owner:modalVersion+':'+(options.navigationIdentity?.() || '')}),
      onState:drawLookup,onResults:acceptLookup,onReturn:(data,index)=>lookupReturn(index,el('').scrollTop),onError:failure=>error(failure.message),reviewMatch:reviewLookupMatch});
    el('find-form').onsubmit=event=>{event.preventDefault();return searchLookup();};
    el('find-query').oninput=()=>{++listVersion;invalidateLookup();};
    el('find-previous').onclick=()=>searchLookup(Math.max(0,lookup.state().offset-30));
    el('find-next').onclick=()=>searchLookup(lookup.state().offset+30);
  }
  async function refresh(){
    if(!options || !el('').open)return false;
    remember();const ticket=++listVersion,query=scope(),savedAt=saveVersion;reading=true;el('error').hidden=true;
    el('status').textContent='Reading saved local preparation…';controls();
    const params=new URLSearchParams({archived:String(query.archived)});if(query.cwd)params.set('cwd',query.cwd);
    try{
      const data=await options.api('/api/preparation?'+params);
      if(ticket!==listVersion || !el('').open || !sameScope(query,scope()))return false;
      if(savedAt!==saveVersion){el('status').textContent='A draft was saved while Refresh was reading. Choose Refresh for the latest list; your edits are kept.';return false;}
      if(!Array.isArray(data.sessions))throw new Error('Prepared work could not be read. Choose Refresh.');
      const incoming=snapshotRows(data);for(const row of incoming.values()){projects.add(row.cwd);updateRow(row);}
      // Empty saved drafts are intentionally absent from the overview. Read
      // the retained editor's exact revision before interpreting that absence:
      // it can mean a cleared draft or simply a different project/archive scope.
      const reviewed=editors.get(selected);
      if(reviewed && !incoming.get(selected)?.draft){
        await loadEditor(reviewed);
        if(ticket!==listVersion || !el('').open || !sameScope(query,scope()))return false;
        if(savedAt!==saveVersion){el('status').textContent='A draft was saved while Refresh was reading. Choose Refresh for the latest list; your edits are kept.';return false;}
      }
      if(reviewed?.queueEdits?.size && !incoming.has(reviewed.row.id) &&
         (!query.cwd || query.cwd===reviewed.row.cwd) && (query.archived || !reviewed.row.archived)){
        const latest=await options.api('/api/followups?session='+encodeURIComponent(reviewed.row.id));
        if(ticket!==listVersion || !el('').open || !sameScope(query,scope()) || savedAt!==saveVersion)return false;
        reviewed.row={...reviewed.row,followups:latest};reconcileQueueEdits(reviewed);
      }
      rows=incoming;drawProjects();drawList();drawEditor();
      el('status').textContent=rows.size?rows.size+' conversation'+(rows.size===1?'':'s')+' with saved preparation or task requests. Review locally.':'No saved drafts, prepared follow-ups or task requests in this scope.';
      return true;
    }catch(e){if(ticket===listVersion && el('').open){error(e.message);el('status').textContent='Prepared work could not be refreshed. Existing local edits are kept.';}return false;}
    finally{if(ticket===listVersion){reading=false;controls();}}
  }
  async function save(onSaved=null){
    remember();const editor=editors.get(selected);if(!editor?.ready || editor.saving || editor.conflict)return false;
    const id=editor.row.id,captured={text:editor.text,mode:editor.mode,revision:editor.revision,sequence:editor.sequence};
    if(captured.text.length>200000){editor.message='Draft exceeds 200,000 characters. Shorten it before saving.';controls();return false;}
    const unchanged=captured.text===editor.saved.text && captured.mode===editor.saved.mode && captured.revision===editor.saved.revision;
    editor.saving=true;editor.openReady=true;editor.message='Saving draft…';el('error').hidden=true;controls();
    try{
      const next=draft(await options.api('/api/draft',{session:id,...captured,writer}));
      if(next.text!==captured.text || next.mode!==captured.mode || (next.revision<captured.revision || (next.revision===captured.revision && !unchanged)))throw Error('The local save receipt did not confirm this draft. Refresh preparation to check it.');
      ++saveVersion;if(typeof onSaved==='function')onSaved({...next});
      editor.saved=next;editor.revision=next.revision;
      if(!editor.conflict || editor.conflict.revision<=next.revision)editor.conflict=null;
      editor.message=changed(editor)?'Saved the reviewed draft. Newer edits are kept; choose Save draft again.':'Draft saved locally. Nothing has been sent.';
      editor.row={...editor.row,draft:next.text?next:null};if(rows.has(id))rows.set(id,editor.row);
      if(options.onSaved){
        try{
          if(await options.onSaved(id,next)===false){
            editor.openReady=false;
            editor.message='Draft saved locally. The conversation has other unsaved edits; open it to review the draft conflict.';
          }
        }catch(e){editor.openReady=false;editor.message='Draft saved locally. Workbench refresh failed: '+e.message;}
      }
      if(visible(id))drawList();return true;
    }catch(e){
      if(e.status===409 && e.current){try{const current=draft(e.current);if(!editor.conflict || current.revision>editor.conflict.revision)editor.conflict=current;editor.message='Draft changed elsewhere. Your edits are kept.';}catch(invalid){editor.message=invalid.message;}}
      else editor.message='Draft not saved: '+e.message;
      error(editor.message,id);return false;
    }finally{editor.saving=false;if(visible(id))drawEditor();}
  }
  function reuseEntry(editor){
    const reuse=editor.reuse;if(!reuse)return null;
    return (editor.row.followups?.entries || []).find(entry=>entry.id===reuse.id && entry.state==='queued' &&
      entry.revision===reuse.revision && entry.text===reuse.text && entry.mode===reuse.mode);
  }
  function reuse(replace){
    remember();const editor=editors.get(selected);if(!editor?.ready || editor.saving || editor.conflict || !editor.reuse)return;
    if(!reuseEntry(editor)){editor.reuse=null;editor.message='The prepared instruction changed. Review it again before reusing.';controls();return;}
    const instruction=editor.reuse,previous=editor.text;
    editor.text=replace?instruction.text:previous+(previous?'\n\n':'')+instruction.text;
    // Appending keeps the reviewed destination's mode. Replacing explicitly adopts the instruction's mode.
    if(replace || !previous)editor.mode=instruction.mode;
    ++editor.sequence;editor.reuse=null;
    editor.message=(replace?'Replaced':'Appended to')+' this local draft editor. Choose Save draft to keep it; the follow-up is unchanged.';
    drawEditor();el('text').focus({preventScroll:true});
  }
  function keepMine(){
    remember();const editor=editors.get(selected);if(!editor?.conflict || editor.saving)return;
    const returnFocus=document.activeElement===el('keep');
    editor.saved=editor.conflict;editor.revision=editor.conflict.revision;editor.conflict=null;++editor.sequence;
    if(returnFocus)focusEditor();return save();
  }
  function loadSaved(){
    const editor=editors.get(selected);if(!editor?.conflict || editor.saving)return;
    const returnFocus=document.activeElement===el('load');
    const current=editor.conflict;Object.assign(editor,current,{saved:current,conflict:null});++editor.sequence;
    editor.message='Saved draft loaded by your choice. Nothing has been sent.';drawEditor();
    if(returnFocus)focusEditor();
  }
  function cancelReuse(){
    const editor=editors.get(selected);if(!editor)return;
    const reuse=editor.reuse,returnFocus=document.activeElement===el('reuse-cancel');editor.reuse=null;controls();
    if(returnFocus){
      const source=[...el('followups').querySelectorAll('button')].find(node=>node.dataset.session===editor.row.id &&
        node.dataset.followup===reuse?.id && node.dataset.control==='reuse-followup' && !node.disabled);
      if(source)source.focus({preventScroll:true});else focusEditor();
    }
  }
  async function openConversation(){
    remember();const editor=editors.get(selected);if(!editor || editor.saving || editor.opening || !options.openConversation)return;
    const id=editor.row.id,sequence=editor.sequence,reviewVersion=selectionVersion;editor.opening=true;controls();
    try{
      const result=await options.openConversation(id);
      if(result===false || result?.error)throw result?.error || new Error('The conversation could not be opened. Local preparation is kept.');
      if(visible(id)){
        if(selectionVersion===reviewVersion && editor.sequence===sequence){remember();el('').close();}
        else editor.message=editor.sequence!==sequence?
          'Conversation opened with the saved draft. Newer edits are kept here; choose Save draft to keep them.':
          'Conversation opened. Your current preparation review is kept.';
      }
    }catch(e){error(e.message,id);}
    finally{editor.opening=false;if(visible(id))controls();}
  }
  async function saveAndOpen(){
    remember();const editor=editors.get(selected);
    if(!editor?.ready || editor.saving || editor.opening || editor.conflict || !options.openConversation)return false;
    const id=editor.row.id,sequence=editor.sequence,reviewVersion=selectionVersion;
    if(!await save() || !editor.openReady)return false;
    // Saving is local; a late reply is never permission to leave another
    // review or to open a draft that has gained newer edits in the meantime.
    if(!visible(id) || selectionVersion!==reviewVersion || editor.sequence!==sequence || editor.conflict || changed(editor)){
      if(editor.sequence===sequence && !editor.conflict && !changed(editor))
        editor.message='Draft saved locally. Return to this preparation to open it when ready.';
      if(visible(id))controls();return false;
    }
    return openConversation();
  }
  function reviewRequest(row,context=null){
    remember();
    const origin={session:row.id,token:row.turn_request.token,scroll:context?.scroll ?? el('').scrollTop};
    return root.DeskPreparedRequest.show(row,{origin:'prepared',valid:()=>el('').open && (!context || context.valid()),verifyReceipt:context?.verifyReceipt,
      onResolved:()=>{++saveVersion;return refresh();},onReturn:()=>{
      if(!el('').open)return;
      if(context){el('').scrollTop=origin.scroll;context.onReturn();return;}
      const source=[...el('list').querySelectorAll('button')].find(node=>node.dataset.session===origin.session &&
        node.dataset.control==='request' && node.dataset.token===origin.token);
      el('').scrollTop=origin.scroll;
      (source || el('refresh')).focus({preventScroll:true});
      if(!source)el('refresh').scrollIntoView({block:'nearest'});
    }});
  }
  function restoreOrigin(){
    const origin=returnOrigin;returnOrigin=null;
    if(!origin || origin.identity!==options.navigationIdentity?.() || origin.node?.isConnected===false || origin.node?.disabled)return;
    const node=origin.node;
    if(!node || (origin.value!==undefined && node.value!==origin.value))return;
    node.focus({preventScroll:true});
    if(Number.isInteger(origin.start) && Number.isInteger(origin.end))node.setSelectionRange?.(origin.start,origin.end,origin.direction);
    if(typeof origin.scroll==='number')node.scrollTop=origin.scroll;
  }
  function show(){
    if(!options)throw new Error('Prepared work is not configured.');
    if(!el('').open){
      const node=document.activeElement;
      returnOrigin={node,identity:options.navigationIdentity?.(),value:node?.value,start:node?.selectionStart,
        end:node?.selectionEnd,direction:node?.selectionDirection,scroll:node?.scrollTop};
      ++modalVersion;el('').showModal();
    }
    invalidateLookup();drawEditor(true);return refresh();
  }
  function configure(value){
    options=value;el('mode').value='native';
    root.DeskPreparedRequest.configure({api:options.api,make:options.make,readEvidenceReference:options.readEvidenceReference});
    if(options.onBrowseEvidence && !evidenceView){
      const panel=make('section'),browse=button('Browse originals for this draft',()=>{const capture=evidenceDestination();if(capture && !capture.busy)return options.onBrowseEvidence(capture);}),list=make('div');
      panel.id='preparation-evidence';browse.id='preparation-browse-evidence';list.id='preparation-evidence-list';
      panel.append(browse,list);el('editor').append(panel);evidenceView={panel,browse,list,signature:null};
    }
    configureLookup();
    el('refresh').onclick=()=>{invalidateLookup();return refresh();};el('close').onclick=()=>{remember();el('').close();restoreOrigin();};
    el('project').onchange=el('archived').onchange=()=>{invalidateLookup();return refresh();};
    el('text').oninput=edit;el('mode').onchange=edit;
    el('save').onclick=save;el('copy').onclick=()=>{remember();const editor=editors.get(selected);if(editor?.ready)return copy(selected,editor.text,'Draft text');};
    el('keep').onclick=keepMine;el('load').onclick=loadSaved;
    el('append').onclick=()=>reuse(false);el('replace').onclick=()=>reuse(true);
    el('reuse-cancel').onclick=cancelReuse;
    el('open').onclick=openConversation;
    el('save-open').onclick=saveAndOpen;
    el('').addEventListener('cancel',()=>remember());
    el('').addEventListener('close',()=>{
      if(el('').open)return;
      remember();invalidateLookup();++modalVersion;++listVersion;++selectionVersion;reading=false;root.DeskPreparedRequest.close('prepared');options.onEvidenceChange?.();
      // Native dialog refocus can reset a textarea's range. Restore only the
      // unchanged origin, after close, never an editor loaded by Open.
      restoreOrigin();
    });
    controls();
  }
  root.DeskPreparation={configure,show,evidenceDestination,saveReviewedEvidence,sameEvidenceOwner};
})(typeof globalThis==='undefined'?this:globalThis);

/* Independent UUID request review; its activation belongs to Prepared or recall. */
(function(root){
  const el=id=>document.getElementById('preparation-request'+(id?'-'+id:''));
  const states=new Map(),statuses=['pending','needs_review','accepted','rejected'];
  let options,active=null,generation=0,capturedView=null,originalReader=null;
  function validIdentity(session,token){return typeof session==='string' && !!session &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token);}
  const valid=ticket=>active===ticket && ticket.generation===generation && el('').open && ticket.owner.valid();
  function binding(value,session){return value?.session===session && ['native_home','cwd','profile'].every(key=>typeof value[key]==='string') &&
    (value.thread_id===null || typeof value.thread_id==='string');}
  function apply(request,result){
    const receipt=result?.request,body=receipt?.payload;
    if(result?.session!==request.session || result?.token!==request.token || !statuses.includes(receipt?.status) ||
       body?.session!==request.session || body?.token!==request.token || typeof body.text!=='string' || !['native','plan'].includes(body.mode) ||
       !Number.isInteger(body.revision) || body.revision<0 || typeof body.writer!=='string' || !Number.isInteger(body.sequence) ||
       !binding(receipt.binding,request.session) || !binding(receipt.current_binding,request.session) || typeof receipt.binding_mismatch!=='boolean')
      throw Error('The task request receipt did not match this review. Choose Refresh request.');
    if(request.body && ['session','token','text','mode','revision','writer','sequence'].some(key=>request.body[key]!==body[key]))
      throw Error('The captured task changed for this request ID. Its earlier exact text is kept; choose Refresh request.');
    request.body=Object.freeze({...body});request.result=result;request.status=receipt.status;request.error=null;++request.revision;
  }
  function mismatched(request){
    const receipt=request.result?.request;
    return !receipt || receipt.binding_mismatch || !root.DeskTurnReview.sameBinding(receipt.binding,receipt.current_binding);
  }
  function draw(){
    if(!active || !valid(active))return;
    const request=active.request,receipt=request.result?.request,busy=request.reading || request.writing || request.originalReading,mismatch=mismatched(request);
    el('title').textContent='Task request in '+active.name;
    el('return').textContent=active.owner.backLabel || 'Return to Prepared work';
    el('identity').textContent='Request ID: '+request.token;
    const capture=root.DeskTurnReview.captured(request),disclosure=el('captured');disclosure.hidden=!capture;
    if(capture && (capturedView?.session!==capture.session || capturedView.token!==capture.token || capturedView.text!==capture.text || capturedView.mode!==capture.mode)){
      const identityChanged=capturedView?.session!==capture.session || capturedView?.token!==capture.token;
      el('captured-title').textContent=capture.title;el('captured-text').textContent=capture.text;el('captured-text').scrollTop=0;
      if(identityChanged)disclosure.open=true;capturedView=capture;
    }
    drawCapturedEvidence(capture,busy);
    // Avoid replacing read-only text on routine checks: disclosure, scroll and
    // the user's selected range remain owned by this captured request.
    const original=root.DeskTurnReview.bindingText(receipt?.binding),current=root.DeskTurnReview.bindingText(receipt?.current_binding);
    if(el('original-binding').textContent!==original)el('original-binding').textContent=original;
    if(el('current-binding').textContent!==current)el('current-binding').textContent=current;
    let message=request.writing?'Recording your review of this original task request…':
      request.reading?'Reading the original task request…':
      request.status==='pending'?'Run receipt pending. Refresh request to check whether admission completed.':
      request.status==='needs_review'?'Run unconfirmed. Review the original conversation’s activity, then record whether this captured task started.':
      request.status==='accepted'?'Run accepted. This request is complete.':
      request.status==='rejected'?'Run rejected. This request is complete.':'Task request unavailable. Choose Refresh request.';
    if(receipt && mismatch)message+=' The original and current targets differ. Restore the original target, then Refresh request before recording a review.';
    if(request.message)message+=' '+request.message;
    el('status').textContent=message;
    const failure=request.error?.message || receipt?.error || '';
    el('error').hidden=!failure;el('error').textContent=failure;
    el('refresh').disabled=!!request.writing;
    const readable=originalBinding(request);
    el('read-original').disabled=!!busy || !readable || !root.DeskHistoryReader;
    el('read-status').textContent=request.originalReading?'Reading the captured original conversation…':
      !receipt?'Refresh this request to read its original conversation.':
      receipt.binding.native_home!==receipt.current_binding.native_home?'Restore the original native home before reading this conversation.':
      !readable?'No original native conversation was captured for this request.':
      'Reads the captured original conversation only. Your selected task stays in place.';
    for(const outcome of ['accepted','rejected']){
      el(outcome).hidden=request.status!=='needs_review';
      el(outcome).disabled=!!busy || !!request.error || mismatch || !request.body;
    }
    // A resolved action may become hidden. Keep keyboard focus in this viewer,
    // never in another editor behind the modal.
    if(['accepted','rejected'].some(id=>document.activeElement===el(id) && el(id).hidden))el('return').focus({preventScroll:true});
  }
  let capturedEvidencePanel=null,capturedEvidenceSignature='';
  function drawCapturedEvidence(capture,busy){
    if(!options.readEvidenceReference || !options.make || !root.DeskEvidencePreparation)return;
    if(!capturedEvidencePanel){capturedEvidencePanel=options.make('div','');capturedEvidencePanel.className='captured-evidence-references';el('captured').append(capturedEvidencePanel);}
    const signature=JSON.stringify([active.generation,capture?.text]);
    if(signature!==capturedEvidenceSignature){
      capturedEvidenceSignature=signature;capturedEvidencePanel.replaceChildren();
      for(const {reference} of root.DeskEvidencePreparation.parse(capture?.text || '')){
        const button=options.make('button','Read referenced original · '+(reference.title || reference.item_id));button.type='button';
        button.onclick=()=>readCapturedEvidence(reference,button);capturedEvidencePanel.append(button);
      }
    }
    for(const button of capturedEvidencePanel.children)button.disabled=!!busy;
  }
  async function readCapturedEvidence(reference,button){
    const ticket=active;if(!ticket || !valid(ticket))return false;
    const request=ticket.request;if(request.reading || request.writing || request.originalReading)return false;
    const text=request.body?.text;if(!root.DeskEvidencePreparation.parse(text).some(row=>JSON.stringify(row.reference)===JSON.stringify(reference)))return false;
    const pre=el('captured-text'),disclosure=el('captured'),view={scroll:el('').scrollTop,textScroll:pre.scrollTop,disclosure:disclosure.open,
      range:(()=>{const selection=root.getSelection?.();return selection?.rangeCount && pre.contains(selection.anchorNode)?selection.getRangeAt(0).cloneRange():null;})()};
    stopOriginal();const reader={ticket,callbacks:null};originalReader=reader;
    const owned=()=>originalReader===reader && valid(ticket) && request.body?.text===text;
    request.originalReading=true;request.error=null;draw();
    try{
      return await options.readEvidenceReference(reference,{owner:{session:request.session,token:request.token,generation:ticket.generation},ownerCurrent:owned,valid:owned,
        backLabel:'Return to task request',onReader:callbacks=>{if(owned())reader.callbacks=callbacks;},onReturn:()=>{
          if(!owned())return;originalReader=null;request.originalReading=false;draw();
          disclosure.open=view.disclosure;el('').scrollTop=view.scroll;pre.scrollTop=view.textScroll;
          if(button.isConnected!==false)button.focus({preventScroll:true});
          const selection=root.getSelection?.();if(view.range && selection){selection.removeAllRanges();selection.addRange(view.range);}
        },onError:failure=>{if(owned()){request.error=failure;draw();}}});
    }finally{if(owned()){request.originalReading=false;draw();}}
  }
  async function read(ticket=active){
    if(!ticket || !valid(ticket) || ticket.request.writing)return false;
    const request=ticket.request,readVersion=++request.readVersion,revision=request.revision;
    request.reading=true;request.error=null;request.message=null;draw();
    try{
      const result=await options.api('/api/turn/request?session='+encodeURIComponent(request.session)+'&token='+encodeURIComponent(request.token));
      if(!valid(ticket) || readVersion!==request.readVersion || revision!==request.revision)return false;
      if(ticket.verifyInitial && ticket.owner.verifyReceipt && !ticket.owner.verifyReceipt(result))throw Error('This saved task request match changed. Return and choose Search again.');
      apply(request,result);ticket.verifyInitial=false;return true;
    }catch(e){
      if(valid(ticket) && readVersion===request.readVersion && revision===request.revision)request.error=e;
      return false;
    }finally{if(valid(ticket) && readVersion===request.readVersion){request.reading=false;draw();}}
  }
  function originalBinding(request){
    const receipt=request.result?.request,origin=receipt?.binding;
    if(!origin || origin.native_home!==receipt.current_binding.native_home ||
      typeof origin.thread_id!=='string' || !origin.thread_id.trim() || origin.thread_id.length>200)return null;
    return {...origin};
  }
  function stopOriginal(){
    const reader=originalReader;originalReader=null;
    if(reader?.callbacks)root.DeskHistoryReader?.close(reader.callbacks);
  }
  async function readOriginal(){
    const ticket=active;if(!ticket || !valid(ticket) || !root.DeskHistoryReader)return false;
    const request=ticket.request;
    if(request.reading || request.writing || request.originalReading || !originalBinding(request))return false;
    const originalVersion=request.originalReadVersion=(request.originalReadVersion || 0)+1;
    request.originalReading=true;draw();
    try{
      // Re-read the UUID before choosing a native home/thread; overview and
      // prior receipts never authorize reading a different retained home.
      if(!await read(ticket) || !valid(ticket))return false;
      const origin=originalBinding(request);if(!origin)return false;
      stopOriginal();
      const pre=el('captured-text'),disclosure=el('captured');
      const view={scroll:el('').scrollTop,textScroll:pre.scrollTop,disclosure:disclosure.open,
        range:(()=>{const selection=root.getSelection?.();return selection?.rangeCount && el('').contains(selection.anchorNode)?selection.getRangeAt(0).cloneRange():null;})()};
      const owned=()=>originalReader===reader && valid(ticket) &&
        root.DeskTurnReview.sameBinding(origin,originalBinding(request));
      const reader={ticket,callbacks:{valid:()=>owned(),startAtEnd:true,backLabel:'Return to task request',onReturn:()=>{
        const current=owned();if(originalReader===reader)originalReader=null;
        if(!current)return;
        ++request.originalReadVersion;request.originalReading=false;draw();
        el('').scrollTop=view.scroll;pre.scrollTop=view.textScroll;disclosure.open=view.disclosure;
        el('read-original').focus({preventScroll:true});
        const selection=root.getSelection?.();if(view.range && selection){selection.removeAllRanges();selection.addRange(view.range);}
      }}};
      originalReader=reader;
      return await root.DeskHistoryReader.show({thread_id:origin.thread_id,cwd:origin.cwd},reader.callbacks);
    }catch(e){if(valid(ticket))request.error=e;return false;}
    finally{if(valid(ticket) && request.originalReadVersion===originalVersion){request.originalReading=false;draw();}}
  }
  async function resolve(outcome){
    const ticket=active;if(!ticket || !valid(ticket))return false;
    const request=ticket.request;
    if(!['accepted','rejected'].includes(outcome) || request.status!=='needs_review' || request.reading || request.writing || request.originalReading || request.error || mismatched(request) || !request.body)return false;
    const writeVersion=++request.writeVersion;
    ++request.readVersion;++request.revision;request.writing=true;request.error=null;request.message=null;draw();
    try{
      const result=await options.api('/api/turn/resolve',{session:request.session,token:request.token,outcome});
      if(!valid(ticket) || writeVersion!==request.writeVersion)return false;
      apply(request,result);
      if(ticket.owner.onResolved){
        const refreshed=await ticket.owner.onResolved({session:request.session,token:request.token});
        if(!valid(ticket) || writeVersion!==request.writeVersion)return false;
        if(refreshed===false)request.message=ticket.owner.refreshMessage || 'Review recorded. Refresh saved work after Return to update the list.';
      }
      return true;
    }catch(e){
      if(valid(ticket) && writeVersion===request.writeVersion){
        if(e.current){try{apply(request,e.current);}catch{}}
        request.error=e;
      }
      return false;
    }finally{if(valid(ticket) && writeVersion===request.writeVersion){request.writing=false;draw();}}
  }
  function finish(){
    const previous=active;if(!previous)return;
    active=null;++generation;stopOriginal();++previous.request.readVersion;++previous.request.writeVersion;
    previous.request.reading=previous.request.writing=previous.request.originalReading=false;
    return previous.owner.valid()?previous.owner.onReturn:null;
  }
  function close(origin=null){
    if(origin && active?.owner.origin!==origin)return false;
    const onReturn=finish();if(el('').open)el('').close();onReturn?.();return true;
  }
  function show(row,owner){
    if(!options || !validIdentity(row.id,row.turn_request?.token))throw Error('The task request identity is unavailable. Choose Refresh saved work.');
    if(!owner || typeof owner.valid!=='function' || !owner.valid())return false;
    // A re-open creates a new activation even for the same UUID; a late GET or
    // resolve from a closed viewer is never allowed to repaint the new one.
    if(active)finish();
    const token=row.turn_request.token,key=JSON.stringify([row.id,token]);
    let request=states.get(key);
    if(!request){request={session:row.id,token,body:null,result:null,status:null,revision:0,readVersion:0,writeVersion:0,reading:false,writing:false};states.set(key,request);}
    active={request,generation:++generation,name:row.name || row.cwd || row.id,owner,verifyInitial:true};
    if(!el('').open)el('').showModal();draw();el('title').focus({preventScroll:true});return read(active);
  }
  function configure(value){
    options=value;
    el('refresh').onclick=()=>read();el('return').onclick=()=>close();el('read-original').onclick=readOriginal;
    for(const outcome of ['accepted','rejected'])el(outcome).onclick=()=>resolve(outcome);
    el('').addEventListener('close',()=>{if(!el('').open)finish()?.();});
  }
  root.DeskPreparedRequest={configure,show,close,validIdentity};
})(typeof globalThis==='undefined'?this:globalThis);
