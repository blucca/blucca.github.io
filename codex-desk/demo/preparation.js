/* Local preparation review; native work starts only through an explicit Open callback. */
(function(root){
  const el=id=>document.getElementById('preparation'+(id?'-'+id:''));
  const editors=new Map(), projects=new Set(), writer=crypto.randomUUID();
  let options,rows=new Map(),selected=null,listVersion=0,selectionVersion=0,saveVersion=0,reading=false;
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
    const editor=editors.get(selected);if(!editor?.ready)return;
    const text=el('text').value,mode=el('mode').value;
    if(editor.text!==text || editor.mode!==mode){editor.text=text;editor.mode=mode;++editor.sequence;}
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
    const reuse=editor?.reuse;el('reuse').hidden=!reuse;
    el('reuse-text').textContent=reuse?modeLabel(reuse.mode)+' instruction to reuse:\n'+reuse.text:'';
    el('append').disabled=el('replace').disabled=!ready || editor.saving || !!editor.conflict;
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
          row.followups?.reservation || entries.some(entry=>entry.state!=='queued')?'Start review pending':''].filter(Boolean).join(' · ');
        item.append(make('p',summary,'muted'));
        const review=button('Review draft and follow-ups',()=>select(row.id));
        review.dataset.session=row.id;review.dataset.control='review';
        review.setAttribute('aria-label','Review preparation in '+name(row));
        if(row.id===selected)review.setAttribute('aria-current','true');
        if(row.id===focusId && focusControl==='review')restore=review;
        item.append(review);group.append(item);
      }
      list.append(group);
    }
    if(restore)restore.focus({preventScroll:true});
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
  function drawFollowups(editor){
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
      const box=make('section','','preparation-reservation');
      box.append(make('h4',reservation.state==='unknown'?'Start unconfirmed':'Start receipt pending'),
        make('p','Captured instruction. Open this conversation to review its activity and start receipt.','muted'),make('pre',reservation.text));
      box.append(action('Copy captured instruction',()=>copy(editor.row.id,reservation.text,'Captured instruction'),'copy-captured'));container.append(box);
    }
    const entries=editor.row.followups?.entries || [];
    for(const entry of entries){
      const box=make('article','','preparation-followup');box.dataset.followup=entry.id;
      const state={queued:'Prepared',reserved:'Awaiting start receipt',needs_review:'Needs start review'}[entry.state] || 'State unreported';
      box.append(make('h4',entry.order+'. '+modeLabel(entry.mode)+' · '+state),make('pre',entry.text));
      const actions=make('div','','actions');
      actions.append(action('Copy instruction',()=>copy(editor.row.id,entry.text,'Instruction'),'copy-followup',entry));
      if(entry.state==='queued')actions.append(action('Use in this session draft',()=>{
        if(!visible(editor.row.id))return;
        remember();editor.reuse={id:entry.id,revision:entry.revision,text:entry.text,mode:entry.mode};
        editor.message='Review this destination draft, then choose Append or Replace. The follow-up stays prepared.';controls();
        el('reuse').scrollIntoView({block:'nearest'});
        el('reuse-text').focus({preventScroll:true});
      },'reuse-followup',entry,!editor.ready));
      box.append(actions);container.append(box);
    }
    if(!entries.length && !reservation)container.append(make('p','No prepared follow-ups for this conversation.','muted'));
    // Refresh and a save receipt replace these controls. Restore the exact
    // session/instruction/action, never another row with the same text or ID.
    if(owned && el('').open){if(restore && !restore.disabled)restore.focus({preventScroll:true});else focusEditor();}
  }
  function drawEditor(){
    const editor=editors.get(selected);
    const reuseEnded=!editor?.reuse && ['reuse-text','append','replace','reuse-cancel'].some(id=>document.activeElement===el(id));
    controls();if(!editor)return;
    const row=editor.row;
    el('editor-title').textContent='Preparation in '+name(row);
    el('editor-binding').textContent=row.cwd+'\n'+options.profileLabel(row.profile)+
      (row.archived?' · Archived locally':'')+(!rows.has(row.id)?'\nNot listed in the current scope; your local editor is retained.':'');
    if(el('text').value!==editor.text)el('text').value=editor.text;
    if(el('mode').value!==editor.mode)el('mode').value=editor.mode;
    drawFollowups(editor);
    if(reuseEnded)focusEditor();
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
    remember();const ticket=++selectionVersion;selected=id;el('error').hidden=true;
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
      const incoming=new Map();
      for(const row of data.sessions){
        if(!row || typeof row.id!=='string' || typeof row.cwd!=='string')throw new Error('Prepared conversation identity is unavailable. Choose Refresh.');
        if(row.draft)draft(row.draft);
        incoming.set(row.id,row);projects.add(row.cwd);updateRow(row);
      }
      // Empty saved drafts are intentionally absent from the overview. Read
      // the retained editor's exact revision before interpreting that absence:
      // it can mean a cleared draft or simply a different project/archive scope.
      const reviewed=editors.get(selected);
      if(reviewed && !incoming.get(selected)?.draft){
        await loadEditor(reviewed);
        if(ticket!==listVersion || !el('').open || !sameScope(query,scope()))return false;
        if(savedAt!==saveVersion){el('status').textContent='A draft was saved while Refresh was reading. Choose Refresh for the latest list; your edits are kept.';return false;}
      }
      rows=incoming;drawProjects();drawList();drawEditor();
      el('status').textContent=rows.size?rows.size+' conversation'+(rows.size===1?'':'s')+' with saved preparation. Review locally; nothing has been sent.':'No saved drafts or prepared follow-ups in this scope.';
      return true;
    }catch(e){if(ticket===listVersion && el('').open){error(e.message);el('status').textContent='Prepared work could not be refreshed. Existing local edits are kept.';}return false;}
    finally{if(ticket===listVersion){reading=false;controls();}}
  }
  async function save(){
    remember();const editor=editors.get(selected);if(!editor?.ready || editor.saving || editor.conflict)return false;
    const id=editor.row.id,captured={text:editor.text,mode:editor.mode,revision:editor.revision,sequence:editor.sequence};
    if(captured.text.length>200000){editor.message='Draft exceeds 200,000 characters. Shorten it before saving.';controls();return false;}
    editor.saving=true;editor.openReady=true;editor.message='Saving draft…';el('error').hidden=true;controls();
    try{
      const next=draft(await options.api('/api/draft',{session:id,...captured,writer}));
      ++saveVersion;
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
      if(e.status===409 && e.current){try{editor.conflict=draft(e.current);editor.message='Draft changed elsewhere. Your edits are kept.';}catch(invalid){editor.message=invalid.message;}}
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
        if(selectionVersion===reviewVersion && editor.sequence===sequence)el('').close();
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
  function show(){
    if(!options)throw new Error('Prepared work is not configured.');
    if(!el('').open)el('').showModal();drawEditor();return refresh();
  }
  function configure(value){
    options=value;el('mode').value='native';
    el('refresh').onclick=refresh;el('close').onclick=()=>el('').close();
    el('project').onchange=el('archived').onchange=refresh;
    el('text').oninput=edit;el('mode').onchange=edit;
    el('save').onclick=save;el('copy').onclick=()=>{remember();const editor=editors.get(selected);if(editor?.ready)return copy(selected,editor.text,'Draft text');};
    el('keep').onclick=keepMine;el('load').onclick=loadSaved;
    el('append').onclick=()=>reuse(false);el('replace').onclick=()=>reuse(true);
    el('reuse-cancel').onclick=cancelReuse;
    el('open').onclick=openConversation;
    el('save-open').onclick=saveAndOpen;
    el('').addEventListener('close',()=>{remember();++listVersion;++selectionVersion;reading=false;});
    controls();
  }
  root.DeskPreparation={configure,show};
})(typeof globalThis==='undefined'?this:globalThis);
