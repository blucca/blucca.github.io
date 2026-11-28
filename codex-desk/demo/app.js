const $ = id => document.getElementById(id);
DeskNativeSteps.configure({$,make});
DeskTurnChanges.configure({$,writeText:text=>navigator.clipboard.writeText(text)});
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
let nativeThreadId = null, currentTurn = null, stopStateSnapshot = null;
let modeSelected=null, generation=0, opening=false, refreshVersion=0, nativeOutcomeSignature='',nativeFailureSignature='';
const drafts=new Map(), submitting=new Set();
let projectVersion=0, projectCursor=null, projectQuery=null, projectScope=null, projectOpening=false;
let latestUpdates=0, statePollAt=0;
const draftWriter=crypto.randomUUID();
const draftEdits=new Map(), draftRevisions=new Map(), draftModes=new Map(), draftSaved=new Map(), draftLoads=new Map(), draftSaves=new Map(), draftTimers=new Map(), draftConflicts=new Map(), draftMessages=new Map(), draftIdentities=new Map();
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
function persistDraft(id,{identify=false,onSaved=null}={}){
  clearTimeout(draftTimers.get(id));draftTimers.delete(id);
  const previous=draftSaves.get(id) || Promise.resolve();
  const pending=previous.then(async()=>{
    await loadDraft(id,-1);
    if(draftConflicts.has(id))return false;
    if(!draftRevisions.has(id))return false;
    const text=drafts.get(id) || '', mode=draftModes.get(id) || 'native', saved=draftSaved.get(id);
    const sequence=draftEdits.get(id) || 0, identity=draftIdentities.get(id);
    if(saved && saved.text===text && saved.mode===mode && (!identity || identity.sequence===sequence) && (!identify || (identity?.revision===saved.revision && identity.sequence===sequence))){draftMessages.set(id,'Draft saved locally. Nothing has been sent.');draftStatus(id);return true;}
    draftMessages.set(id,'Saving draft…');draftStatus(id);
    try{
      const next=await api('/api/draft',{session:id,text,mode,revision:draftRevisions.get(id),writer:draftWriter,sequence});
      draftRevisions.set(id,next.revision);draftSaved.set(id,next);draftIdentities.set(id,{revision:next.revision,sequence});
      draftMessages.set(id,'Draft saved locally. Nothing has been sent.');draftStatus(id);if(onSaved)onSaved({...next});return true;
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
$('draft-load').onclick=()=>{const id=selected,current=draftConflicts.get(id);if(!current)return;draftRevisions.set(id,current.revision);draftSaved.set(id,current);drafts.set(id,current.text);draftModes.set(id,current.mode);draftConflicts.delete(id);draftEdits.set(id,(draftEdits.get(id) || 0)+1);$('prompt').value=current.text;$('turn-mode').value=current.mode;modeSelected=id;draftMessages.set(id,'Saved draft loaded. Nothing has been sent.');draftStatus(id);syncDraftEvidence();DeskEvidencePreparation.sync();};
window.addEventListener('pagehide',()=>{
  if(selected)rememberDraft(selected);
  // A debounced save can already be waiting behind an in-flight response.
  for(const id of new Set([...draftTimers.keys(),...draftSaves.keys()])){clearTimeout(draftTimers.get(id));if(draftRevisions.has(id) && !draftConflicts.has(id))fetch('/api/draft',{method:'POST',headers:deskAccessHeaders({'Content-Type':'application/json'}),body:JSON.stringify({session:id,text:drafts.get(id) || '',mode:draftModes.get(id) || 'native',revision:draftRevisions.get(id),writer:draftWriter,sequence:draftEdits.get(id) || 0}),keepalive:true}).catch(()=>{});}
});
// Browser retention is opaque. Captured work stays in memory or the private receipt.
const turnRequestKey='codex-desk-turn-requests', turnTokens=new Map(), turnRequests=new Map();
let turnCapturedView=null;
try{
  const retained=JSON.parse(sessionStorage.getItem(turnRequestKey) || '[]');
  if(Array.isArray(retained))for(const entry of retained){
    if(typeof entry?.session==='string' && entry.session && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry.token))turnTokens.set(entry.session,entry.token);
  }
}catch(e){}
function saveTurnTokens(){sessionStorage.setItem(turnRequestKey,JSON.stringify([...turnTokens].map(([session,token])=>({session,token}))));}
function turnRequest(id=selected){
  if(!turnRequests.has(id) && turnTokens.has(id))turnRequests.set(id,{session:id,token:turnTokens.get(id),body:null,capture:null,status:null,receiptVersion:0});
  return turnRequests.get(id);
}
function turnRequestBlocked(id=selected){const request=turnRequest(id);return !!request && !['accepted','rejected'].includes(request.status);}
function retireTurnRequest(request){
  if(turnRequests.get(request.session)!==request)return false;
  turnTokens.delete(request.session);
  try{saveTurnTokens();}catch(e){turnTokens.set(request.session,request.token);request.error=e;return false;}
  turnRequests.delete(request.session);return true;
}
function reconcileTurnDraft(request,saved){
  const id=request.session,body=request.body,previous=draftSaved.get(id),revision=draftRevisions.get(id);
  if(!body || !saved || !Number.isInteger(saved.revision) || (revision ?? -1)>saved.revision)return false;
  const clean=previous && drafts.get(id)===previous.text && draftModes.get(id)===previous.mode && !draftTimers.has(id) && !draftSaves.has(id) && !draftConflicts.has(id);
  const exact=drafts.get(id)===body.text && draftModes.get(id)===body.mode &&
    (request.capture?(draftEdits.get(id) || 0)===request.capture.edit && revision===body.revision && (!request.capture.cold || request.capture.clean):
      clean && revision===body.revision);
  // Only the backend's exact conditional clear is proof to clear this editor.
  const cleared=saved.text==='' && saved.mode===body.mode && saved.revision===body.revision+1;
  if(exact && cleared){
    clearTimeout(draftTimers.get(id));draftTimers.delete(id);
    draftEdits.set(id,(draftEdits.get(id) || 0)+1);drafts.set(id,'');
    if(selected===id && $('prompt').value===body.text && $('turn-mode').value===body.mode)$('prompt').value='';
    draftMessages.set(id,'Task accepted. Draft cleared.');
  }
  // A different saved preparation still uses the existing explicit conflict UI.
  if(!cleared && previous && saved.revision>(revision ?? -1) && (drafts.get(id)!==saved.text || draftModes.get(id)!==saved.mode)){
    draftConflicts.set(id,saved);draftMessages.set(id,'Task accepted. The saved draft changed in another tab; your local preparation remains unsent.');draftStatus(id);return false;
  }
  // A receipt can advance the saved revision while newer local edits remain unsent.
  draftRevisions.set(id,saved.revision);draftSaved.set(id,saved);
  if(draftConflicts.get(id)?.revision<=saved.revision && exact && cleared)draftConflicts.delete(id);
  if(!(exact && cleared) && drafts.get(id)!==saved.text)draftMessages.set(id,'Task accepted. Your newer draft remains unsent.');
  draftStatus(id);
  return (exact && cleared) || (clean && drafts.get(id)==='' && saved.text==='');
}
function applyTurnReceipt(request,result){
  if(turnRequests.get(request.session)!==request)return;
  if(result?.session!==request.session || result?.token!==request.token || !['pending','accepted','rejected','needs_review'].includes(result.request?.status))throw Error('The Run receipt did not match this request');
  const receipt=result.request;
  if(receipt.payload){
    const body=receipt.payload;
    if(body.session!==request.session || body.token!==request.token)throw Error('The captured Run request did not match its receipt');
    if(!request.body)request.body=Object.freeze({...body});
    else if(['session','token','text','mode','revision','writer','sequence'].some(key=>body[key]!==request.body[key]))request.conflict=true;
  }
  request.status=receipt.status;request.result=result;request.notFound=false;request.error=null;++request.receiptVersion;
  if(receipt.status==='accepted' && !request.conflict && !receipt.binding_mismatch && reconcileTurnDraft(request,receipt.draft))retireTurnRequest(request);
}
function turnBindingText(binding){return DeskTurnReview.bindingText(binding);}
function sameTurnBinding(a,b){return DeskTurnReview.sameBinding(a,b);}
let ordinaryTurnSource=null,ordinaryTurnSourcePanel=null;
function stopOrdinaryTurnSource(){const previous=ordinaryTurnSource;ordinaryTurnSource=null;if(previous?.callbacks)DeskHistoryReader.close(previous.callbacks);}
function drawOrdinaryRequestSources(request){
  if(ordinaryTurnSource && !ordinaryTurnSource.valid())stopOrdinaryTurnSource();
  if(!ordinaryTurnSourcePanel){ordinaryTurnSourcePanel=make('div','','ordinary-request-evidence');$('turn-request-captured').append(ordinaryTurnSourcePanel);}
  const body=request && DeskTurnReview.captured(request),references=DeskEvidencePreparation.parse(body?.text || '');
  const signature=JSON.stringify([request?.session,request?.token,body?.text,body?.mode]);
  if(ordinaryTurnSourcePanel.dataset.signature===signature)return;
  ordinaryTurnSourcePanel.dataset.signature=signature;ordinaryTurnSourcePanel.replaceChildren();
  for(const {reference} of references){
    const read=make('button','Read referenced original · '+(reference.title || reference.item_id));read.type='button';
    read.onclick=async()=>{
      const owner=request,context=generation,text=body.text,mode=body.mode;
      const current=()=>selected===owner.session && generation===context && turnRequest()===owner && !opening && !owner.conflict && !owner.writing &&
        DeskTurnReview.captured(owner)?.text===text && DeskTurnReview.captured(owner)?.mode===mode;
      if(!current() || owner.reading || $('history-reader').open)return false;
      stopOrdinaryTurnSource();const ticket={callbacks:null,valid:()=>ordinaryTurnSource===ticket && current()};ordinaryTurnSource=ticket;
      const pre=$('turn-request-captured-text'),disclosure=$('turn-request-captured'),prompt=$('prompt');
      const capture=()=>({preScroll:pre.scrollTop,open:disclosure.open,window:window.scrollY,prompt:prompt.value,
        start:prompt.selectionStart,end:prompt.selectionEnd,direction:prompt.selectionDirection,promptScroll:prompt.scrollTop,
        range:(()=>{const selection=globalThis.getSelection?.();return selection?.rangeCount && pre.contains(selection.anchorNode)?selection.getRangeAt(0).cloneRange():null;})()});
      let view=capture();read.disabled=true;
      try{
        await readTurnRequest(owner);if(!ticket.valid())return false;
        const opened=await DeskEvidencePreparation.readReference(reference,{owner:{session:owner.session,token:owner.token,generation:context},valid:ticket.valid,ownerCurrent:ticket.valid,
          backLabel:'Return to retained Run request',onReader:callbacks=>{if(ticket.valid()){ticket.callbacks=callbacks;view=capture();}},
          onReturn:()=>{if(!ticket.valid())return;ordinaryTurnSource=null;disclosure.open=view.open;pre.scrollTop=view.preScroll;
            if(read.isConnected)read.focus({preventScroll:true});
            if(prompt.value===view.prompt){prompt.setSelectionRange(view.start,view.end,view.direction);prompt.scrollTop=view.promptScroll;}
            const selection=globalThis.getSelection?.();if(view.range && selection){selection.removeAllRanges();selection.addRange(view.range);}
            window.scrollTo({top:view.window,behavior:'instant'});
          },onError:e=>{if(ticket.valid()){owner.error=e;drawTurnRequest();}}});
        if(!opened && ticket.valid())ordinaryTurnSource=null;return opened;
      }catch(e){if(ticket.valid()){owner.error=e;ordinaryTurnSource=null;drawTurnRequest();}return false;}
      finally{if(read.isConnected)read.disabled=false;}
    };
    ordinaryTurnSourcePanel.append(read);
  }
}
function drawCapturedTurn(request){
  const body=DeskTurnReview.captured(request),disclosure=$('turn-request-captured');
  disclosure.hidden=!body;
  if(!body)return;
  if(turnCapturedView?.session===request.session && turnCapturedView.token===request.token && turnCapturedView.text===body.text && turnCapturedView.mode===body.mode)return;
  const identityChanged=turnCapturedView?.session!==request.session || turnCapturedView?.token!==request.token;
  $('turn-request-captured-title').textContent=body.title;
  $('turn-request-captured-text').textContent=body.text;
  $('turn-request-captured-text').scrollTop=0;
  if(identityChanged)disclosure.open=['pending','needs_review','rejected'].includes(request.status);
  turnCapturedView={session:request.session,token:request.token,text:body.text,mode:body.mode};
}
function drawTurnRequest(){
  const request=turnRequest(),busy=opening || submitting.has(selected) || !!request?.reading || !!request?.writing;
  $('turn-request').hidden=!request;
  drawCapturedTurn(request);drawOrdinaryRequestSources(request);
  $('prompt').required=!request;
  $('send').textContent=request?'Check Run request':'Run task';
  if(request)$('send').disabled=busy;
  $('turn-request-recover').disabled=busy;
  $('turn-request-retry').hidden=request?.status!=='rejected' || request.conflict;
  const mismatch=!!request?.result?.request?.binding_mismatch;
  $('turn-request-retry').disabled=busy || !request?.body || mismatch;
  for(const name of ['accepted','rejected']){
    $('turn-request-'+name).hidden=request?.status!=='needs_review' || mismatch;
    $('turn-request-'+name).disabled=busy || mismatch;
  }
  $('turn-request-new').hidden=!request || !['accepted','rejected'].includes(request.status);
  $('turn-request-new').disabled=busy;
  $('turn-request-new').textContent=mismatch?'Use current target for a new task':'Prepare a new task';
  $('turn-request-binding').hidden=!mismatch;
  if(mismatch){
    $('turn-request-original-binding').textContent=turnBindingText(request.result.request.binding);
    $('turn-request-current-binding').textContent=turnBindingText(request.result.request.current_binding);
  }
  const failure=request?.error?.message || request?.result?.request?.error || '';
  $('turn-request-error').hidden=!failure;
  $('turn-request-error').textContent=failure;
  if(!request)return;
  let message=request.writing?'Sending the captured Run request…':request.reading?'Checking the retained Run request. Nothing is being sent.':
    request.status==='accepted'?'Run accepted. Your current draft remains unsent. Prepare a new task before another Run.':
    request.status==='rejected'?'Run rejected. Retry the original captured task, or prepare a new task.':
    request.status==='needs_review'?'Run unconfirmed. Review this conversation’s activity, then record whether it started.':
    request.status==='pending'?'Run receipt pending. Check this request before sending another task.':
    request.notFound?'No retained receipt found yet. Check this request again; the visible draft will not be resent.':
    'Run response unconfirmed. Check the retained request before another task.';
  if(request.body && (drafts.get(selected)!==request.body.text || draftModes.get(selected)!==request.body.mode) && request.status!=='accepted')message+=' Your current draft has not been sent.';
  if(mismatch)message+=' The retained original target differs from the current target. Original retry and admission review are blocked. '+(['accepted','rejected'].includes(request.status)?'Review both targets before choosing a new task on the current target.':'Restore the original target, then Check request.');
  if(request.reviewMessage)message+=' '+request.reviewMessage;
  if(request.conflict)message+=' This token belongs to different captured work; its original receipt is retained.';
  $('turn-request-status').textContent=message;
}
async function readTurnRequest(request){
  if(request.reading)return request.reading;
  const receiptVersion=request.receiptVersion;
  if(!request.capture && draftRevisions.has(request.session)){
    const id=request.session,saved=draftSaved.get(id);
    request.capture={edit:draftEdits.get(id) || 0,cold:true,clean:!!saved && drafts.get(id)===saved.text && draftModes.get(id)===saved.mode && !draftTimers.has(id) && !draftSaves.has(id) && !draftConflicts.has(id)};
  }
  const pending=(async()=>{
    try{
      const result=await api('/api/turn/request?session='+encodeURIComponent(request.session)+'&token='+encodeURIComponent(request.token));
      if(receiptVersion===request.receiptVersion)applyTurnReceipt(request,result);
    }catch(e){if(receiptVersion===request.receiptVersion){request.error=e;if(e.status===404)request.notFound=true;}}
    finally{request.reading=null;if(selected===request.session)draw();}
  })();
  request.reading=pending;if(selected===request.session)draw();return pending;
}
async function discoverTurnRequest(id){
  try{
    const result=await api('/api/turn/request?session='+encodeURIComponent(id));
    if(result?.session!==id || !['pending','needs_review'].includes(result.request?.status))return null;
    const request={session:id,token:result.token,body:null,capture:null,status:null,receiptVersion:0};
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.token))throw Error('The retained Run request identity could not be read');
    turnTokens.set(id,request.token);
    try{saveTurnTokens();}catch(e){turnTokens.delete(id);throw e;}
    turnRequests.set(id,request);applyTurnReceipt(request,result);return request;
  }catch(e){if(e.status===404)return null;throw e;}
}
function adoptTurnConflict(request,result){
  if(result?.session!==request.session || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result?.token) || !result.request)return null;
  if(result.token===request.token){applyTurnReceipt(request,result);return request;}
  // The server rejected this fresh Run because earlier captured work still owns
  // this session. Recover that identity, never replay the newer visible draft.
  const retained={session:request.session,token:result.token,body:null,capture:null,status:null,receiptVersion:0};
  turnTokens.set(request.session,retained.token);
  try{saveTurnTokens();}catch(e){turnTokens.set(request.session,request.token);throw e;}
  turnRequests.set(request.session,retained);applyTurnReceipt(retained,result);return retained;
}
async function sendTurnRequest(request,{retry=false}={}){
  const id=request.session;
  if(!request.body || request.writing || request.reading || (retry && (request.status!=='rejected' || request.conflict || request.result?.request?.binding_mismatch)))return;
  request.writing=true;request.error=null;if(selected===id)draw();
  try{
    const result=await api('/api/turn',retry?{...request.body,retry:true}:request.body);
    applyTurnReceipt(request,result);
    if(selected===id)await refresh();
  }catch(e){
    request.error=e;
    if(e.status===409){
      try{const retained=adoptTurnConflict(request,e.current);if(retained && retained!==request)await readTurnRequest(retained);else if(retained)retained.error=e;}
      catch(failure){request.error=failure;}
    }
  }finally{request.writing=false;if(selected===id)draw();}
}
$('turn-request-recover').onclick=()=>{const request=turnRequest();if(request && !opening)return readTurnRequest(request);};
$('turn-request-retry').onclick=()=>{const request=turnRequest();if(request && !opening && !submitting.has(selected))return sendTurnRequest(request,{retry:true});};
for(const outcome of ['accepted','rejected'])$('turn-request-'+outcome).onclick=async()=>{
  const request=turnRequest();if(!request || opening || submitting.has(selected) || request.status!=='needs_review' || request.result?.request?.binding_mismatch || request.reading || request.writing)return;
  request.writing=true;request.error=null;draw();
  try{applyTurnReceipt(request,await api('/api/turn/resolve',{session:request.session,token:request.token,outcome}));if(selected===request.session)await refresh();}
  catch(e){request.error=e;}
  finally{request.writing=false;if(selected===request.session)draw();}
};
$('turn-request-new').onclick=async()=>{
  const request=turnRequest();if(!request || opening || request.reading || request.writing || submitting.has(selected) || !['accepted','rejected'].includes(request.status))return;
  if(request.result?.request?.binding_mismatch){
    const intent={session:selected,generation,edit:draftEdits.get(selected) || 0,text:$('prompt').value,mode:$('turn-mode').value,binding:request.result.request.current_binding};
    request.reviewMessage=null;
    await readTurnRequest(request);
    if(turnRequest(intent.session)!==request || selected!==intent.session || generation!==intent.generation)return;
    if(request.error || !['accepted','rejected'].includes(request.status))return;
    if((draftEdits.get(selected) || 0)!==intent.edit || $('prompt').value!==intent.text || $('turn-mode').value!==intent.mode || !sameTurnBinding(intent.binding,request.result?.request?.current_binding)){
      request.reviewMessage='The draft or current target changed during review. Review the current details and choose again.';draw();return;
    }
  }
  if(retireTurnRequest(request)){draftMessages.set(request.session,'New task prepared. Review the draft, then choose Run task.');draftStatus(request.session);}
  draw();
};

const sessionReadingViews=new Map();
let sessionReadingKey=null,sessionReadingLatest=true,sessionReadingEpoch=0,sessionReadingRestoring=false,sessionReadingPending=false,sessionReadingNotice='';
let sessionReadingSourceTurns=null,sessionReadingSourceItems=new Map();
let sessionReadingHomeValue=null,sessionReadingHomeRequest=null,sessionReadingStorage=null;
const sessionReadingHomes=new Map();
function sessionReadingStore(){
  if(!sessionReadingStorage && globalThis.DeskReadingCheckpoint)try{sessionReadingStorage=DeskReadingCheckpoint.create(localStorage);}catch{return null;}
  return sessionReadingStorage;
}
function sessionReadingHome(){
  if(sessionReadingHomeValue)return Promise.resolve(sessionReadingHomeValue);
  if(!sessionReadingHomeRequest)sessionReadingHomeRequest=(async()=>{
    try{const result=await api('/api/native/home'),home=result?.home_namespace;
      if(typeof home==='string' && /^[a-f0-9]{64}$/.test(home)){sessionReadingHomeValue=home;return home;}
    }catch{}
    return null;
  })().finally(()=>{sessionReadingHomeRequest=null;});
  return sessionReadingHomeRequest;
}
function saveSessionReading(){
  const binding=sessionReadingBinding(),view=captureSessionReading();if(!binding || !view)return;
  const key=sessionReadingIdentity(binding);sessionReadingViews.set(key,view);
  const save=home=>{if(!home || sessionReadingViews.get(key)!==view)return;
    sessionReadingHomes.set(key,home);sessionReadingStore()?.put({native_home:home,...binding},view);};
  if(sessionReadingHomeValue)save(sessionReadingHomeValue);
  else if(sessionReadingHomeRequest)sessionReadingHomeRequest.then(save);
}
function sessionReadingBinding(){
  const row=state.sessions.find(row=>row.id===selected);
  return selected && nativeThreadId && row?.thread_id===nativeThreadId?{session:selected,thread_id:nativeThreadId}:null;
}
function sessionReadingIdentity(binding){return JSON.stringify([binding.session,binding.thread_id]);}
function sessionReadingCatalog(){
  const steps=DeskNativeSteps.state?.(),changes=DeskTurnChanges.state?.();
  const turn_ids=sessionReadingSourceTurns?[...sessionReadingSourceTurns]:[];
  for(const turn of [steps?.turn,changes?.turn].filter(Boolean))if(!turn_ids.includes(turn))turn_ids.push(turn);
  const identities=[];for(const [id] of nodes){const turn=itemTurns.get(id);if(turn && turn_ids.includes(turn) && items.has(id)){
    const count=sessionReadingSourceItems.get(JSON.stringify([turn,id])) || 1;
    for(let index=0;index<count;index++)identities.push({turn_id:turn,item_id:id});
  }}
  return {thread_id:nativeThreadId,items:identities,
    turn_ids,
    native_steps_turn:steps?.turn || null,turn_changes_turn:changes?.turn || null};
}
function captureSessionReading(){
  const binding=sessionReadingBinding(),helper=globalThis.DeskReadingCheckpoint;
  if(!binding || opening || sessionReadingPending || !helper || $('task').hidden)return null;
  const key=sessionReadingIdentity(binding),item_views=[],turn_views=[];let anchor=null,last=null;
  const suppliedTurns=new Set(sessionReadingCatalog().turn_ids);
  for(const [id,node] of nodes){
    const turn=itemTurns.get(id);if(!turn || !suppliedTurns.has(turn) || !items.has(id) || !node.isConnected || node.hidden)continue;
    const view=DeskActivity.capture?.(node);if(view)item_views.push({turn_id:turn,item_id:id,...view});
    const rect=node.getBoundingClientRect();if(rect.height<=0)continue;
    last={turn_id:turn,item_id:id,offset:rect.top,screen_top:rect.top};
    if(!anchor && rect.bottom>0)anchor=last;
  }
  for(const [turn,group] of collaborationGroups)if(suppliedTurns.has(turn))turn_views.push({turn_id:turn,kind:'collaboration',open:group.node.open,
    scroll_top:group.body.scrollTop || 0,scroll_left:group.body.scrollLeft || 0});
  for(const [kind,controller,disclosure,body] of [['native_steps',DeskNativeSteps,'native-steps','native-steps-body'],
    ['turn_changes',DeskTurnChanges,'turn-changes','turn-changes-body']]){
    const turn=controller.state?.()?.turn;if(turn)turn_views.push({turn_id:turn,kind,open:$(disclosure).open,
      scroll_top:$(body).scrollTop || 0,scroll_left:$(body).scrollLeft || 0});
  }
  try{return helper.normalizeView({latest:(sessionReadingKey!==key || sessionReadingLatest) && nearLatest(),anchor:anchor || last,
    window_scroll:{top:window.scrollY,left:window.scrollX || 0},item_views,turn_views});}catch{return null;}
}
function leaveSessionReading(){
  saveSessionReading();
  ++sessionReadingEpoch;sessionReadingRestoring=false;sessionReadingPending=false;sessionReadingNotice='';sessionReadingSourceTurns=null;sessionReadingSourceItems.clear();
}
function sessionReadingSource(current,thread){
  if(current!==generation || thread?.id!==nativeThreadId)return;
  sessionReadingSourceTurns=[];sessionReadingSourceItems.clear();
  for(const turn of thread.turns || []){
    if(typeof turn?.id!=='string')continue;sessionReadingSourceTurns.push(turn.id);
    for(const item of turn.items || [])if(typeof item?.id==='string'){
      const key=JSON.stringify([turn.id,item.id]);sessionReadingSourceItems.set(key,(sessionReadingSourceItems.get(key) || 0)+1);
    }
  }
}
function sessionReadingEventTurn(turn){
  if(typeof turn!=='string' || !turn)return;
  if(!sessionReadingSourceTurns)sessionReadingSourceTurns=[];
  if(!sessionReadingSourceTurns.includes(turn))sessionReadingSourceTurns.push(turn);
}
function restoreSessionReading(current,options={}){
  const {explicitTarget=null}=options;
  const binding=sessionReadingBinding(),helper=globalThis.DeskReadingCheckpoint;
  if(!binding || opening || current!==generation || !helper)return false;
  const key=sessionReadingIdentity(binding),saved=Object.hasOwn(options,'savedView')?options.savedView:sessionReadingViews.get(key),epoch=++sessionReadingEpoch;
  sessionReadingKey=key;sessionReadingLatest=!explicitTarget;sessionReadingNotice='';sessionReadingPending=false;
  if(explicitTarget || !saved)return false;
  const resolved=helper.resolveView(saved,sessionReadingCatalog());
  if(!resolved.available){sessionReadingLatest=false;sessionReadingNotice='Previous reading place unavailable';latestLabel();return true;}
  const view=resolved.view,valid=()=>current===generation && !opening && sessionReadingEpoch===epoch &&
    sessionReadingIdentity(sessionReadingBinding() || {})===key && !document.querySelector('dialog[open]');
  sessionReadingLatest=view.latest;
  sessionReadingPending=true;
  requestAnimationFrame(()=>{
    if(!valid()){if(sessionReadingEpoch===epoch)sessionReadingPending=false;return;}sessionReadingRestoring=true;
    for(const row of view.item_views){const node=nodes.get(row.item_id);
      if(node && itemTurns.get(row.item_id)===row.turn_id)DeskActivity.restore?.(node,row);}
    for(const row of view.turn_views){
      if(row.kind==='collaboration'){
        const group=collaborationGroups.get(row.turn_id);if(group){group.node.open=row.open;group.body.scrollTop=row.scroll_top;group.body.scrollLeft=row.scroll_left;}
      }else{
        const steps=row.kind==='native_steps',controller=steps?DeskNativeSteps:DeskTurnChanges;
        if(controller.state?.()?.turn!==row.turn_id)continue;
        const disclosure=$(steps?'native-steps':'turn-changes'),body=$(steps?'native-steps-body':'turn-changes-body');
        disclosure.open=row.open;body.scrollTop=row.scroll_top;body.scrollLeft=row.scroll_left;
      }
    }
    if(view.latest){latestUpdates=0;latestLabel();window.scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'});}
    else window.scrollTo({top:view.window_scroll.top,left:view.window_scroll.left,behavior:'instant'});
    requestAnimationFrame(()=>{
      if(valid() && !view.latest){const node=nodes.get(view.anchor.item_id);
        if(node && itemTurns.get(view.anchor.item_id)===view.anchor.turn_id)window.scrollTo({
          top:window.scrollY+node.getBoundingClientRect().top-view.anchor.screen_top,left:view.window_scroll.left,behavior:'instant'});}
      if(sessionReadingEpoch===epoch){sessionReadingRestoring=false;sessionReadingPending=false;}
    });
  });
  return true;
}
async function restoreStoredSessionReading(current,options={}){
  if(options.explicitTarget)return restoreSessionReading(current,options);
  const binding=sessionReadingBinding();if(!binding || opening || current!==generation || !globalThis.DeskReadingCheckpoint)return false;
  const key=sessionReadingIdentity(binding),epoch=sessionReadingEpoch;sessionReadingPending=true;
  const home=await sessionReadingHome();
  if(current!==generation || opening || epoch!==sessionReadingEpoch || sessionReadingIdentity(sessionReadingBinding() || {})!==key)return true;
  sessionReadingPending=false;
  let savedView=sessionReadingViews.get(key);
  if(home){
    if(savedView && sessionReadingHomes.has(key) && sessionReadingHomes.get(key)!==home)savedView=null;
    if(!savedView)savedView=sessionReadingStore()?.get({native_home:home,...binding})?.view || null;
  }
  return restoreSessionReading(current,{...options,savedView});
}
globalThis.DeskSessionReading={capture:captureSessionReading,save:saveSessionReading,leave:leaveSessionReading,restore:restoreStoredSessionReading,
  prepare:sessionReadingHome,
  source:sessionReadingSource,eventTurn:sessionReadingEventTurn,
  target:()=>{++sessionReadingEpoch;sessionReadingLatest=false;sessionReadingPending=false;sessionReadingRestoring=false;},
  latest:()=>{++sessionReadingEpoch;const binding=sessionReadingBinding();sessionReadingKey=binding?sessionReadingIdentity(binding):null;sessionReadingLatest=true;sessionReadingNotice='';sessionReadingPending=false;sessionReadingRestoring=false;},
  follow:()=>{const binding=sessionReadingBinding();return !binding || sessionReadingKey!==sessionReadingIdentity(binding) || sessionReadingLatest;},
  intent:()=>sessionReadingEpoch,canLatest:epoch=>epoch===sessionReadingEpoch && globalThis.DeskSessionReading.follow(),
  notice:()=>sessionReadingNotice};
window.addEventListener('pagehide',saveSessionReading);
window.addEventListener('scroll',()=>{
  if(opening || sessionReadingRestoring || sessionReadingPending)return;
  if(!nearLatest())sessionReadingLatest=false;
},{passive:true});
function sessionReadingInput(){
  if(opening || !sessionReadingBinding())return;
  ++sessionReadingEpoch;
  if(sessionReadingPending){sessionReadingPending=false;sessionReadingRestoring=false;sessionReadingLatest=false;}
}
window.addEventListener('wheel',sessionReadingInput,{passive:true});
window.addEventListener('pointerdown',sessionReadingInput,{passive:true});
window.addEventListener('keydown',event=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key))sessionReadingInput();});
function nearLatest(){return window.scrollY+window.innerHeight >= document.documentElement.scrollHeight-140;}
function latestLabel(){
  const reading=globalThis.DeskSessionReading?.notice?.();
  $('latest-output').textContent=reading?reading+' · Latest output ↓':latestUpdates?`${latestUpdates} new update${latestUpdates===1?'':'s'} · Latest output ↓`:'Latest output ↓';
}
function goLatest(){
  globalThis.DeskSessionReading?.latest?.();
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
  const focusedWasActive=focusedRow?.dataset.active==='true';
  const focusedIndex=focusedRow?[...list.querySelectorAll('.session-row')].indexOf(focusedRow):-1;
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
        const row=make('div','','session-row');row.dataset.session=s.id;row.dataset.active=String(activeSession(s));
        const b=make('button','','session'+(s.id===selected?' selected':''));b.title=s.cwd;
        b.type='button';if(s.id===selected)b.setAttribute('aria-current','page');
        b.append(make('strong',s.name || group.name),make('small',`${profileLabel(s.profile)} · ${s.status}${s.archived?' · archived locally':''}`));
        b.onclick=()=>open(s.id);
        const archive=make('button',s.archived?'Restore':'Archive','session-archive');archive.type='button';
        archive.setAttribute('aria-label',`${s.archived?'Restore':'Archive'} saved session ${s.name || group.name}`);
        // Keep the pending action focusable; setArchived rejects repeats.
        archive.setAttribute('aria-disabled',String(archiving.has(s.id)));archive.onclick=()=>setArchived(s.id,!s.archived);
        if(s.id===focusedSession)restoreFocus=focusedControl==='archive'?archive:b;
        row.append(b,archive);section.append(row);++visible;
      }
    }
    list.append(section);
  }
  if(!visible && state.sessions.length)list.append(make('p',query?'No saved titles or project folders match.':'No recent saved sessions. Open a project or show archived sessions.','muted'));
  $('session-count').textContent=`${visible} shown · ${state.sessions.length} saved${state.sessions.some(s=>activeSession(s))?' · active tasks stay visible':''}`;
  if(restoreFocus && !restoreFocus.disabled)restoreFocus.focus({preventScroll:true});
  else if((focusedControl==='archive' && archiving.has(focusedSession)) ||
          (focusedControl && focusedWasActive && current.has(focusedSession) && !activeSession(current.get(focusedSession)))){
    // A formerly Active row can disappear under the unchanged title/archive scope.
    const remaining=[...list.querySelectorAll('.session-row')];
    const nearby=remaining[Math.min(focusedIndex,remaining.length-1)];
    (nearby?.querySelector(focusedControl==='archive'?'.session-archive':'.session') || $('session-filter')).focus({preventScroll:true});
  }
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
let selectedOriginalReview=null;
function selectedOriginalBinding(){
  const session=state.sessions.find(s=>s.id===selected),thread=session?.thread_id;
  // Store/open responses own the parent binding. Stream notifications may
  // describe children or arrive before native attach has committed its ID.
  if(opening || typeof thread!=='string' || !thread.trim() || thread.length>200)return null;
  return {session:selected,generation,thread_id:thread,cwd:session.cwd};
}
function selectedOriginalCurrent(intent){
  const binding=selectedOriginalBinding();
  return selectedOriginalReview===intent && !!binding && binding.session===intent.session && binding.generation===intent.generation && binding.thread_id===intent.thread_id;
}
function syncSelectedOriginal(){
  if(selectedOriginalReview && !selectedOriginalCurrent(selectedOriginalReview)){
    selectedOriginalReview=null;
    if($('history-reader').open)DeskHistoryReader.close();
  }
  const button=$('read-original'),session=state.sessions.find(s=>s.id===selected),binding=selectedOriginalBinding();
  button.hidden=!session;button.disabled=!binding || !!selectedOriginalReview?.pending;
  if($('read-task-response'))$('read-task-response').disabled=!binding || !!selectedOriginalReview?.pending || $('history-reader').open;
  button.title=opening?'Wait for the native conversation binding.':!binding?'Native conversation not available yet.':'Read this conversation without opening or sending a task.';
}
async function readSelectedOriginal({find=false,taskResponse=false,returnFocus=$('read-original')}={}){
  const binding=selectedOriginalBinding();if(!binding || selectedOriginalReview?.pending || $('history-reader').open)return false;
  const outcome=state.native_outcomes?.[binding.session];
  if(taskResponse && (!outcome || outcome.thread_id!==binding.thread_id || typeof outcome.turn_id!=='string' || !outcome.turn_id.trim() || outcome.turn_id.length>200))return false;
  globalThis.DeskSessionReading?.target?.();
  const intent={...binding,turn_id:taskResponse?outcome.turn_id:undefined,pending:true,returnFocus};selectedOriginalReview=intent;syncSelectedOriginal();
  const valid=()=>selectedOriginalCurrent(intent);
  try{
    const read=await DeskHistoryReader.show({thread_id:binding.thread_id,cwd:binding.cwd,...(taskResponse?{turn_id:intent.turn_id}:{})},{valid,taskResponse,startAtEnd:true,backLabel:'Return to selected task',onReturn:()=>{
      const current=valid();if(selectedOriginalReview===intent)selectedOriginalReview=null;
      syncSelectedOriginal();
      if(current){const target=intent.returnFocus;
        (target?.isConnected && !target.disabled && !target.hidden?target:$('read-original')).focus({preventScroll:true});
      }
    }});
    if(read && find && valid() && $('history-reader').open && !$('history-reader-find-query').disabled)$('history-reader-find-query').focus({preventScroll:true});
    return read;
  }finally{intent.pending=false;if(selectedOriginalReview===intent)syncSelectedOriginal();}
}
function draw() {
  drawSidebar();
  $('approvals').hidden=opening;
  DeskHome.sync();
  syncSelectedOriginal();
  syncDraftEvidence();DeskEvidencePreparation.sync();
  const running=state.sessions.filter(s=>['running','approval','starting'].includes(s.status)).length;
  document.title=(running?`(${running} active) `:'')+'Codex Desk';
  $('activity-controls').hidden=!selected;
  const s = state.sessions.find(s=>s.id===selected); if(!s){$('native-outcome').hidden=true;return;}
  const outcome=state.native_outcomes?.[selected];
  const visibleOutcome=outcome && outcome.thread_id===s.thread_id;
  $('native-outcome').hidden=!visibleOutcome;
  const responseButton=$('read-task-response');
  responseButton.disabled=!visibleOutcome || !selectedOriginalBinding() || !!selectedOriginalReview?.pending || $('history-reader').open;
  responseButton.title='Read the response supplied for this displayed native parent turn. No task is sent.';
  const outcomeKey=visibleOutcome?JSON.stringify([selected,outcome]):'';
  if(outcomeKey!==nativeOutcomeSignature){
    nativeOutcomeSignature=outcomeKey;
    $('native-outcome-summary').textContent=visibleOutcome?'— '+outcome.status:'';
    $('native-outcome-identity').textContent=visibleOutcome?`Thread ${outcome.thread_id}\nTurn ${outcome.turn_id}\nSource: ${outcome.source}`:'';
    $('native-outcome-body').replaceChildren(...(visibleOutcome?[DeskNativeState.outcome(outcome,make)]:[]));
  }
  if(!opening){
    const progressChanged=DeskNativeSteps.sync(s,{session:selected,thread:nativeThreadId,generation});
    const diffChanged=DeskTurnChanges.sync(s,{session:selected,thread:nativeThreadId,generation});
    if(progressChanged || diffChanged){++latestUpdates;latestLabel();}
  }
  DeskSteering.sync(s,{session:selected,thread:nativeThreadId,generation});
  DeskStopTask.sync(s,{session:selected,thread:nativeThreadId,generation,snapshot:stopStateSnapshot});
  $('archive-session').hidden=false;$('archive-session').textContent=s.archived?'Restore session':'Archive session';
  $('archive-session').disabled=archiving.has(s.id);
  $('archive-status').hidden=!s.archived;
  $('archive-status').textContent=activeSession(s)?'Archived locally. This active task stays visible.':'Archived locally. Restore it to show in Recent.';
  $('title').textContent=s.name || s.cwd.split(/[\\/]/).filter(Boolean).at(-1);$('rename').hidden=false;
  $('binding').textContent=`${s.cwd}\n${profileLabel(s.profile)} → ${s.provider || 'loading'} / ${s.model || 'native default'}`;
  if(modeSelected!==selected){$('turn-mode').value=s.mode || 'native';modeSelected=selected;}
  const busy=opening || submitting.has(selected) || ['running','approval','starting'].includes(s.status);
  DeskFollowups.status(selected,busy || turnRequestBlocked(selected));$('prepare-followup').disabled=opening || submitting.has(selected);
  $('turn-mode').disabled=opening;
  $('status').textContent=opening?'Opening session…':s.status; $('send').disabled=busy || DeskFollowups.blocked(selected);
  drawTurnRequest();
  $('rename').disabled=opening;$('handoff').disabled=opening;
  $('usage').textContent=DeskNativeState.usage(s.usage);
  $('native-failure').hidden=!s.error || s.status!=='failed' || opening;
  const failureKey=$('native-failure').hidden?'':JSON.stringify([selected,s.error]);
  if(failureKey!==nativeFailureSignature){nativeFailureSignature=failureKey;$('native-failure').replaceChildren(...(failureKey?[DeskNativeState.card(s.error,false,make)]:[]));}
}
function itemText(i) {
  switch(i.type) {
    case 'userMessage':return (i.content || []).map(c=>c.text || '').join('\n');
    case 'agentMessage':case 'plan':return i.text || '';
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
  node.dataset.turnId=turn;
  if(collaborationTypes.has(i.type)) {
    const group=collaborationGroup(turn);
    if(node.parentNode!==group.body)group.body.append(node);
    group.ids.add(i.id);updateCollaboration(group);
  } else if(!node.parentNode)$('activity').append(node);
  DeskActivity.render(node,i,text);
}
let approvalsSignature='';
const interactionCards=new Map();
function approvals() {
  const parentThread=state.sessions.find(s=>s.id===selected)?.thread_id || null;
  const signature=JSON.stringify([selected,generation,parentThread,[...requests]]);
  if(signature===approvalsSignature)return;
  approvalsSignature=signature;
  const host=$('approvals'), session=selected;
  if(!interactionCards.has(session))interactionCards.set(session,new Map());
  const cards=interactionCards.get(session), desired=[];
  const active=document.activeElement;
  let retiredFocus=false;
  function retire(card){
    if(card.box.contains(active))retiredFocus=true;
    for(const input of card.fields.values())input.value='';
    card.retired=true;
    if(card.readerCallbacks){retiredFocus=true;DeskHistoryReader.close(card.readerCallbacks);}
    card.box.remove();
  }
  for(const [id,card] of cards){
    const message=requests.get(id);
    if(!message || JSON.stringify(message)!==card.signature){retire(card);cards.delete(id);}
  }
  for(const [id,m] of requests) {
    let card=cards.get(id);
    if(!card){
      const p=m.params || {}, title=m.method==='item/tool/requestUserInput'?'Questions for this task':m.method==='item/commandExecution/requestApproval'?'Command approval':m.method==='item/fileChange/requestApproval'?'File change approval':'Native input required';
      const box=make('section','','approval');box.append(make('strong',title));
      for(const [key,label] of [['command','Command'],['cwd','Native working directory'],['reason','Native reason']]) {
        const value=p[key];
        if(typeof value==='string' && value.length)box.append(make('pre',label+'\n'+value,'approval-context-field'));
      }
      const status=make('p','','muted');status.setAttribute('role','status');
      card={box,signature:JSON.stringify(m),fields:new Map(),controls:[],pending:false,retired:false,status};cards.set(id,card);
      const owned=card;owned.contextGeneration=generation;
      const reportedId=value=>typeof value==='string' && value.trim() && value.length<=200;
      const context=make('details','','approval-context'),summary=make('summary',
        reportedId(p.threadId) && p.threadId!==parentThread?'Original request context · related thread':'Original request context');
      const identity=make('pre','Native request '+id+'\nMethod '+m.method+
        '\nSelected parent thread '+(parentThread || 'unreported')+
        '\nRequest thread '+(reportedId(p.threadId)?p.threadId:'unreported')+
        '\nRequest turn '+(reportedId(p.turnId)?p.turnId:'unreported')+
        '\nRequest item '+(reportedId(p.itemId)?p.itemId:'unreported'),'approval-context-identity');
      context.append(summary,identity);box.append(context);card.contextIdentity=identity;card.contextSummary=summary;
      if(reportedId(p.threadId)) {
        const read=make('button','Read related native activity','approval-context-read');read.type='button';
        const readStatus=make('p','','muted');readStatus.setAttribute('role','status');context.append(read,readStatus);
        const valid=()=>selected===session && generation===owned.contextGeneration && !owned.retired &&
          cards.get(id)===owned && requests.get(id) && JSON.stringify(requests.get(id))===owned.signature;
        read.onclick=async()=>{
          if(!valid() || read.disabled || $('history-reader').open)return false;
          read.disabled=true;readStatus.textContent='';
          const readGeneration=generation;
          const callbacks={valid:()=>valid() && generation===readGeneration,backLabel:'Return to native request',onReturn:()=>{
            if(owned.readerCallbacks===callbacks)owned.readerCallbacks=null;
            read.disabled=false;if(valid() && read.isConnected)read.focus({preventScroll:true});
          }};owned.readerCallbacks=callbacks;
          try {
            return await DeskHistoryReader.show({thread_id:p.threadId,
              ...(reportedId(p.turnId) && reportedId(p.itemId)?{turn_id:p.turnId,item_id:p.itemId}:{})},callbacks);
          }catch(error){if(valid())readStatus.textContent='Original activity could not be read: '+error.message;return false;}
          finally{read.disabled=false;}
        };
      }
      async function send(path,body){
        if(owned.pending || owned.retired)return;
        owned.pending=true;for(const control of owned.controls)control.disabled=true;
        status.textContent='Sending this response…';
        try{
          await api(path,{session,request:id,...body});
          if(cards.get(id)!==owned || owned.retired)return;
          if(selected===session && requests.get(id) && JSON.stringify(requests.get(id))===owned.signature){
            requests.delete(id);approvals();
          }else{for(const input of owned.fields.values())input.value='';owned.retired=true;cards.delete(id);owned.box.remove();}
          await refresh();
        }catch(e){
          if(cards.get(id)===owned && !owned.retired){
            status.textContent='Response not confirmed: '+e.message;
            owned.pending=false;for(const control of owned.controls)control.disabled=false;
          }
        }
      }
      if(['item/commandExecution/requestApproval','item/fileChange/requestApproval'].includes(m.method)) {
        const buttons=make('div','','actions');
        for(const [label,decision] of [['Allow once','accept'],['Decline','decline']]) {
          const b=make('button',label);b.type='button';b.onclick=()=>send('/api/approval',{decision});buttons.append(b);card.controls.push(b);
        }box.append(buttons);
      }else if(m.method==='item/tool/requestUserInput') {
        const form=make('form');
        for(const q of p.questions || []) {
          const label=make('label',(q.header || '')+' — '+q.question);
          const input=make(q.options?.length && !q.isOther?'select':'input');
          if(input.tagName==='SELECT')for(const o of q.options){const option=make('option',o.label+' — '+o.description);option.value=o.label;input.append(option);}
          else{input.type=q.isSecret?'password':'text';input.required=true;input.autocomplete='off';if(q.options?.length)input.placeholder=q.options.map(o=>o.label).join(' / ');}
          label.append(input);form.append(label);card.fields.set(q.id,input);card.controls.push(input);
        }
        const submit=make('button','Send answers');submit.type='submit';form.append(submit);card.controls.push(submit);
        form.onsubmit=e=>{e.preventDefault();return send('/api/answer',{answers:Object.fromEntries([...owned.fields].map(([id,input])=>[id,[input.value]]))});};
        box.append(form);
      }else box.append(make('p','Use Stop current task to end this native interaction.'));
      box.append(status);
    }
    card.contextGeneration=generation;
    if(card.contextIdentity){
      const p=m.params || {},reported=value=>typeof value==='string' && value.trim() && value.length<=200;
      card.contextSummary.textContent=reported(p.threadId) && p.threadId!==parentThread?'Original request context · related thread':'Original request context';
      const identity='Native request '+id+'\nMethod '+m.method+
        '\nSelected parent thread '+(parentThread || 'unreported')+
        '\nRequest thread '+(reported(p.threadId)?p.threadId:'unreported')+
        '\nRequest turn '+(reported(p.turnId)?p.turnId:'unreported')+
        '\nRequest item '+(reported(p.itemId)?p.itemId:'unreported');
      if(card.contextIdentity.textContent!==identity)card.contextIdentity.textContent=identity;
    }
    desired.push(card.box);
  }
  // Keep unchanged nodes in place: sibling requests must not reset answers,
  // caret, selection, disclosure or a pending response's disabled controls.
  let cursor=host.firstChild;
  for(const box of desired){if(box===cursor)cursor=cursor.nextSibling;else host.insertBefore(box,cursor);}
  const keep=new Set(desired);for(const box of [...host.children])if(!keep.has(box))box.remove();
  if(retiredFocus && document.activeElement!==active){
    const next=host.querySelector('button:not(:disabled), input:not(:disabled), select:not(:disabled)');
    if(next)next.focus();else if(!$('stop').disabled)$('stop').focus();else $('prompt').focus();
  }
}
function syncInteractionCards(pending){
  // Retire resolved inputs in tasks being read in the background, too.
  for(const [session,cards] of interactionCards){
    if(session===selected)continue;
    for(const card of cards.values())if(card.readerCallbacks)DeskHistoryReader.close(card.readerCallbacks);
    const current=new Map((pending?.[session] || []).map(m=>[String(m.id),JSON.stringify(m)]));
    for(const [id,card] of cards)if(current.get(id)!==card.signature){
      for(const input of card.fields.values())input.value='';
      card.retired=true;if(card.readerCallbacks)DeskHistoryReader.close(card.readerCallbacks);card.box.remove();cards.delete(id);
    }
    if(!cards.size)interactionCards.delete(session);
  }
}
function consume(m) {
  const p=m.params || {};
  let planChanged=false;
  // Old cached streams may contain owned child notifications. Keep native
  // requests/resolutions, but never display a child as the selected parent.
  if(p.threadId && nativeThreadId && p.threadId!==nativeThreadId && m.id===undefined && m.method!=='serverRequest/resolved')return;
  const readingThread=p.threadId || p.thread?.id || p.turn?.threadId;
  if(m.id===undefined && (!readingThread || readingThread===nativeThreadId))globalThis.DeskSessionReading?.eventTurn?.(p.turn?.id || p.turnId);
  DeskSteering.consume(m,{session:selected,thread:nativeThreadId,generation});
  DeskStopTask.consume(m,{session:selected,thread:nativeThreadId,generation});
  const progressChanged=DeskNativeSteps.consume(m,{session:selected,thread:nativeThreadId,generation});
  const diffChanged=DeskTurnChanges.consume(m,{session:selected,thread:nativeThreadId,generation});
  if(m.method==='turn/started') {
    const nextTurn=p.turn?.id || p.turnId || currentTurn;
    if(currentTurn && nextTurn!==currentTurn)for(const i of items.values()) {
      if(i.type==='plan' && i._deskPlan==='streaming' && itemTurns.get(i.id)===currentTurn)
        renderItem({...i,_deskPlan:'retired'},currentTurn);
    }
    currentTurn=nextTurn;
  }
  if(m.id !== undefined && m.method) {requests.set(String(m.id),m);approvals();}
  if(m.method==='serverRequest/resolved') {requests.delete(String(p.requestId));approvals();}
  if(m.method==='item/started' || m.method==='item/completed') {
    const i=p.item;
    renderItem(i?.type==='plan'?{...i,_deskPlan:m.method==='item/completed'?'complete':'streaming'}:i,p.turnId);
  }
  if(m.method==='item/plan/delta') {
    const i=items.get(p.itemId);
    if(i?.type==='plan' && i._deskPlan==='streaming' && p.turnId===currentTurn && itemTurns.get(p.itemId)===p.turnId && typeof p.delta==='string') {
      if(p.delta){renderItem({...i,text:(i.text || '')+p.delta},p.turnId);planChanged=true;}
    }
  }
  if(m.method==='turn/completed') {
    const turn=p.turn?.id || p.turnId;
    // Native final items replace provisional text, never append to it.
    for(const i of p.turn?.items || [])if(i?.type==='plan')renderItem({...i,_deskPlan:'complete'},turn);
    for(const i of items.values())if(i.type==='plan' && i._deskPlan==='streaming' && itemTurns.get(i.id)===turn)
      renderItem({...i,_deskPlan:p.turn?.status || 'completed'},turn);
  }
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
  return progressChanged || diffChanged || planChanged;
}
async function refresh() {
  const current=generation, version=++refreshVersion, stopSnapshot=DeskStopTask.snapshot(), next=await api('/api/state');
  if(current!==generation || version!==refreshVersion)return;
  state=next;syncInteractionCards(state.pending);stopStateSnapshot=stopSnapshot;DeskFollowups.refresh(selected);requests=new Map((state.pending?.[selected] || []).map(m=>[String(m.id),m]));approvals();draw();DeskRecall.stateChanged();if($('profiles-dialog').open)drawProfiles();
}
async function open(id,{revealLatest=true,keepError=false,steerReceiptOnly=false,readingTarget=null}={}) {
  globalThis.DeskSessionReading?.leave?.();
  stopOrdinaryTurnSource();
  if(selected){rememberDraft(selected);persistDraft(selected);}
  const current=++generation;
  latestUpdates=0;latestLabel();
  selected=id;DeskHome.selectionChanged();DeskRecall.selectionChanged();DeskFollowups.select(id);$('prompt').value=drafts.get(id) || '';opening=true;modeSelected=null;after=0;items.clear();nodes.clear();itemTurns.clear();collaborationGroups.clear();nativeThreadId=null;currentTurn=null;requests.clear();
  // A deliberate return starts with the latest known native pending snapshot.
  // An initial empty reset is not a resolution of this task's retained editor.
  const initialPending=state.pending ? state.pending[id] || [] :
    [...(typeof interactionCards==='undefined'?[]:interactionCards.get(id)?.values() || [])]
      .filter(card=>!card.retired).map(card=>JSON.parse(card.signature));
  for(const message of initialPending)requests.set(String(message.id),message);
  DeskNativeSteps.select({session:id,thread:null,generation:current});
  DeskTurnChanges.select({session:id,thread:null,generation:current});
  DeskSteering.select({session:id,thread:null,generation:current});
  DeskStopTask.select({session:id,thread:null,generation:current});
  if(!keepError)$('error').hidden=true;
  $('native-failure').hidden=true;$('task').hidden=true;$('handoff').hidden=true;
  $('activity').replaceChildren();approvals();draw();draftStatus();
  const preparation=loadDraft(id,current);
  try {
    await preparation;if(current!==generation)return;
    const retained=turnRequest(id) || await discoverTurnRequest(id);
    if(current!==generation)return;
    if(retained){
      // Cold receipt recovery does not attach or resume a native runtime.
      await preparation;await readTurnRequest(retained);if(current!==generation)return;
      nativeThreadId=state.sessions.find(s=>s.id===id)?.thread_id || null;
      DeskNativeSteps.select({session:id,thread:nativeThreadId,generation:current});
      DeskTurnChanges.select({session:id,thread:nativeThreadId,generation:current});
      DeskSteering.select({session:id,thread:nativeThreadId,generation:current});
      DeskStopTask.select({session:id,thread:nativeThreadId,generation:current});
      const rows=await api('/api/events?session='+encodeURIComponent(id)+'&after=0');
      if(current!==generation)return;
      for(const row of rows){after=row.seq;consume(row.event);}
      await refresh();if(current!==generation)return;
      try{localStorage.setItem('codex-desk-browser-preview-session-v1',id);}catch{}
      opening=false;$('welcome').hidden=true;$('task').hidden=false;syncDraftEvidence();$('handoff').hidden=false;draw();DeskSteering.opened();DeskStopTask.opened();
      await globalThis.DeskSessionReading?.restore?.(current,{explicitTarget:readingTarget || !revealLatest});
      if(current!==generation)return;
      return true;
    }
    const stopRetained=await DeskStopTask.opened();if(current!==generation)return;
    let steeringRetained=false;
    if(steerReceiptOnly && !stopRetained){steeringRetained=await DeskSteering.opened();if(current!==generation)return;}
    if(steeringRetained || stopRetained){
      nativeThreadId=state.sessions.find(s=>s.id===id)?.thread_id || null;
      DeskNativeSteps.select({session:id,thread:nativeThreadId,generation:current});
      DeskTurnChanges.select({session:id,thread:nativeThreadId,generation:current});
      DeskSteering.select({session:id,thread:nativeThreadId,generation:current});
      DeskStopTask.select({session:id,thread:nativeThreadId,generation:current});
      const rows=await api('/api/events?session='+encodeURIComponent(id)+'&after=0');
      if(current!==generation)return;
      for(const row of rows){after=row.seq;consume(row.event);}
      await refresh();if(current!==generation)return;
      try{localStorage.setItem('codex-desk-browser-preview-session-v1',id);}catch{}
      opening=false;$('welcome').hidden=true;$('task').hidden=false;syncDraftEvidence();$('handoff').hidden=false;draw();
      await globalThis.DeskSessionReading?.restore?.(current,{explicitTarget:readingTarget || !revealLatest});
      if(current!==generation)return;
      return true;
    }
    const opened=await api('/api/open',{session:id});
    if(current!==generation)return;
    try{localStorage.setItem('codex-desk-browser-preview-session-v1',id);}catch{}
    nativeThreadId=opened.thread.id;
    globalThis.DeskSessionReading?.source?.(current,opened.thread);
    DeskNativeSteps.select({session:id,thread:nativeThreadId,generation:current});
    DeskTurnChanges.select({session:id,thread:nativeThreadId,generation:current});
      DeskSteering.select({session:id,thread:nativeThreadId,generation:current});
      DeskStopTask.select({session:id,thread:nativeThreadId,generation:current});
    for(const [index,t] of (opened.thread.turns || []).entries())for(const i of t.items || [])renderItem(i,t.id || 'snapshot:'+index);
    const rows=await api('/api/events?session='+encodeURIComponent(id)+'&after=0');
    if(current!==generation)return;
    for(const row of rows){after=row.seq;consume(row.event);}
    DeskNativeSteps.restoreThread(opened.thread,{session:id,thread:nativeThreadId,generation:current});
    DeskTurnChanges.restoreThread(opened.thread,{session:id,thread:nativeThreadId,generation:current});
    DeskSteering.restoreThread(opened.thread,{session:id,thread:nativeThreadId,generation:current});
    DeskStopTask.restoreThread(opened.thread,{session:id,thread:nativeThreadId,generation:current});
    $('prompt').value=drafts.get(id) || '';$('welcome').hidden=true;
    await refresh();
    if(current!==generation)return;
    await preparation;if(current!==generation)return;
    opening=false;draw();$('task').hidden=false;syncDraftEvidence();$('handoff').hidden=false;DeskSteering.opened();DeskStopTask.opened();
    const readingRestored=await globalThis.DeskSessionReading?.restore?.(current,{explicitTarget:readingTarget || !revealLatest});
    if(current!==generation)return;
    const readingIntent=globalThis.DeskSessionReading?.intent?.();
    if(revealLatest && !readingTarget && !readingRestored)requestAnimationFrame(()=>{if(current===generation && (globalThis.DeskSessionReading?.canLatest?.(readingIntent) ?? true) && ($('native-steps').hidden || !$('native-steps').open) && ($('turn-changes').hidden || !$('turn-changes').open) && ($('native-outcome').hidden || !$('native-outcome').open) && !DeskSteering.reading() && !DeskStopTask.reading() && !$('history-reader').open && !$('preparation').open && !$('preparation-request').open)goLatest();});
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
  ++projectVersion;projectCursor=null;projectQuery=null;projectScope=null;projectOpening=false;
  $('project-list').replaceChildren();$('project-results').hidden=true;$('project-more').hidden=true;
  $('project-error').hidden=true;projectBusy(false);
}
function projectBusy(busy) {
  for(const id of ['cwd','profile','project-search','session-name','project-find','project-more','project-new'])$(id).disabled=busy;
  for(const b of $('project-list').querySelectorAll('button'))b.disabled=busy;
  $('project-new').disabled=busy || projectScope?.cwdExists===false;
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
  if(projectScope?.cwdExists===false){
    $('project-summary').textContent=(query.search
      ? (count?`Saved conversation titles matching “${query.search}”. `:`No saved conversation titles match “${query.search}” in this project. `)
      : (count?'Saved conversations in this project. ':'No saved conversations in this project. '))
      +'Project folder unavailable. Read original conversations here; restore the folder to resume or start a new conversation.';
    return;
  }
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
    projectScope=data.projectScope || null;
    $('project-new').disabled=projectOpening || projectScope?.cwdExists===false;
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
$('prompt').oninput=()=>{if(selected){rememberDraft(selected);scheduleDraft(selected);syncDraftEvidence();DeskEvidencePreparation.sync();}};
$('turn-mode').onchange=()=>{if(selected){rememberDraft(selected);scheduleDraft(selected);DeskEvidencePreparation.sync();}};
DeskStopTask.configure({$,api,make,selection:()=>({session:selected,thread:nativeThreadId,generation,opening,connected:Object.hasOwn(state.pending || {},selected),status:state.sessions.find(s=>s.id===selected)?.status})});
DeskSteering.configure({$,api,selection:()=>({session:selected,thread:nativeThreadId,generation,opening,connected:Object.hasOwn(state.pending || {},selected),status:state.sessions.find(s=>s.id===selected)?.status})});
DeskFollowups.configure({api,make,selected:()=>selected,refresh,afterDraw:drawTurnRequest,   navigationIdentity:()=>selected+':'+generation,readEvidenceReference:(reference,callbacks)=>DeskEvidencePreparation.readReference(reference,callbacks),   closeReader:callbacks=>DeskHistoryReader.close(callbacks)});
let preparedEvidenceOwner=null;
function evidenceDestination(){
  if(preparedEvidenceOwner){
    const current=DeskPreparation.evidenceDestination();
    return current && current.session===preparedEvidenceOwner.session && current.generation===preparedEvidenceOwner.generation && current.writer===preparedEvidenceOwner.writer?current:null;
  }
  return taskEvidenceDestination();
}
function taskEvidenceDestination(){
  const session=state.sessions.find(s=>s.id===selected),id=selected;
  if(!session || opening || !draftRevisions.has(id) || $('task').hidden)return null;
  return {session:id,generation,revision:draftRevisions.get(id),sequence:draftEdits.get(id)||0,
    writer:draftWriter,text:$('prompt').value,mode:$('turn-mode').value,name:session.name,cwd:session.cwd,
    busy:opening || submitting.has(id) || draftSaves.has(id) || draftTimers.has(id) || draftConflicts.has(id)};
}
async function saveReviewedEvidence(payload,capture){
  if(!DeskEvidencePreparation.sameDestination(capture,evidenceDestination()))throw Error('The destination changed. Review its current draft.');
  if(capture.kind==='prepared')return DeskPreparation.saveReviewedEvidence(payload,capture);
  const id=capture.session;
  // Reserve this page's next sequence before later typing can autosave.
  draftEdits.set(id,payload.sequence);drafts.set(id,payload.text);draftModes.set(id,payload.mode);
  $('prompt').value=payload.text;syncDraftEvidence();
  let receipt=null;
  const pending=persistDraft(id,{identify:true,onSaved:next=>{receipt=next;}});
  const saved=await pending;
  if(!saved){const conflict=draftConflicts.get(id),e=Error(draftMessages.get(id)||'The reviewed draft was not saved.');if(conflict){e.status=409;e.current=conflict;}throw e;}
  // Confirm this accepted write, not whatever later draft save is now current.
  if(!receipt || receipt.text!==payload.text || receipt.mode!==payload.mode)throw Error('Newer local edits remain saved. Review the draft before another append.');
  return receipt;
}
function syncDraftEvidence(){
  const panel=$('draft-evidence');if(!panel)return;
  const destination=taskEvidenceDestination();
  if(!destination){panel.hidden=true;panel.dataset.signature='';$('draft-evidence-list').replaceChildren();return;}
  const references=DeskEvidencePreparation.parse(destination.text);
  const signature=JSON.stringify([selected,generation,references.map(x=>x.reference)]);
  if(panel.dataset.signature===signature)return;
  panel.dataset.signature=signature;panel.hidden=!references.length;$('draft-evidence-list').replaceChildren();
  for(const {reference} of references){
    const button=make('button','Read referenced original · '+(reference.title||reference.item_id));button.type='button';
    button.onclick=async()=>{
      preparedEvidenceOwner=null;const owner=evidenceDestination();if(!owner || $('history-reader').open)return;
      const editor=$('prompt'),view={start:editor.selectionStart,end:editor.selectionEnd,direction:editor.selectionDirection,scroll:editor.scrollTop,window:window.scrollY};
      button.disabled=true;$('draft-evidence-status').textContent='Reading the captured original source…';
      await DeskEvidencePreparation.readReference(reference,{owner,ownerCurrent:capture=>{
        const current=evidenceDestination();return !!current && current.session===capture.session && current.generation===capture.generation;
      },onReturn:()=>{if(evidenceDestination()?.session===owner.session && generation===owner.generation){editor.focus({preventScroll:true});if(editor.value===owner.text){editor.setSelectionRange(view.start,view.end,view.direction);editor.scrollTop=view.scroll;}window.scrollTo({top:view.window,behavior:'instant'});}},
      onError:error=>{$('draft-evidence-status').textContent=error.message;}});
      if(button.isConnected)button.disabled=false;
    };
    $('draft-evidence-list').append(button);
  }
}
DeskEvidencePreparation.configure({api,destination:evidenceDestination,save:saveReviewedEvidence,
  textForItem:DeskHistoryReader.textForItem,
  apply:(receipt,capture,payload)=>{if(capture.kind==='prepared')return true;if(selected===capture.session && generation===capture.generation){syncDraftEvidence();draftStatus();}return drafts.get(capture.session)===payload.text;},
  onConflict:(capture,current)=>{if(capture.kind==='prepared')return;if(current){draftConflicts.set(capture.session,current);draftStatus(capture.session);}},
  onError:e=>{$('draft-evidence-status').textContent=e.message;error(e);},
  showOriginal:(target,callbacks)=>DeskHistoryReader.show({thread_id:target.thread_id,turn_id:target.turn_id,item_id:target.item_id,
    ...(callbacks.resolution.available?{match_text:callbacks.savedReference.quote,match_start:callbacks.resolution.start_utf16}:{})},callbacks)
});
DeskHistoryReader.configure({api,onEvidence:payload=>{
  const destination=evidenceDestination();
  if(!destination)throw Error('Select an existing task to prepare with this original evidence.');
  if(destination.busy)throw Error('Wait for this task draft to finish saving before reviewing evidence.');
  if(!payload.selection_utf16){
    const turn=payload.thread.turns.find(turn=>turn.id===payload.turn_id),item=turn?.items?.find(item=>item.id===payload.item_id);
    if(Array.from(DeskHistoryReader.textForItem(item)).length>DeskEvidencePreparation.MAX_QUOTE)throw Error('Select up to 8,000 characters from this original item first.');
  }
  return DeskEvidencePreparation.reviewLoaded({thread:payload.thread,thread_id:payload.thread.id,
    turn_id:payload.turn_id,item_id:payload.item_id,start_utf16:payload.selection_utf16?.start,
    end_utf16:payload.selection_utf16?.end},{valid:payload.valid,onReturn:payload.onReturn});
}});
$('read-original').onclick=()=>{preparedEvidenceOwner=null;return readSelectedOriginal();};
$('read-task-response').onclick=()=>{preparedEvidenceOwner=null;return readSelectedOriginal({taskResponse:true,returnFocus:$('read-task-response')});};
document.addEventListener('keydown',event=>{
  if(event.key!=='F3' || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey)return;
  const target=event.target;
  if(document.querySelector('dialog[open]') || target?.isContentEditable || target?.closest?.('input, textarea, select, [contenteditable]') || !(target===document.body || target?.closest?.('main')) || !selectedOriginalBinding())return;
  event.preventDefault();preparedEvidenceOwner=null;readSelectedOriginal({find:true,returnFocus:target===document.body?$('read-original'):target});
});
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
  e.preventDefault();if(!selected || opening)return;
  const retained=turnRequest();
  if(retained){if(!retained.writing && !submitting.has(selected))return readTurnRequest(retained);return;}
  if(submitting.has(selected) || $('send').disabled || !$('prompt').value.trim())return;
  const id=selected,current=generation,text=$('prompt').value,mode=$('turn-mode').value;
  rememberDraft(id);const sentEdit=draftEdits.get(id) || 0;submitting.add(id);$('error').hidden=true;draw();
  try{
    if(!await persistDraft(id,{identify:true}))return;
    if((draftEdits.get(id) || 0)!==sentEdit || drafts.get(id)!==text || draftModes.get(id)!==mode){draftMessages.set(id,'Newer edits remain unsent. Review the draft, then Run again.');draftStatus(id);return;}
    if(current!==generation)return;
    const body=Object.freeze({session:id,token:crypto.randomUUID(),text,mode,revision:draftRevisions.get(id),writer:draftWriter,sequence:sentEdit});
    turnTokens.set(id,body.token);
    try{saveTurnTokens();}catch(e){turnTokens.delete(id);throw e;}
    const request={session:id,token:body.token,body,capture:{edit:sentEdit},status:'pending',receiptVersion:0};
    turnRequests.set(id,request);await sendTurnRequest(request);
  }catch(err){if(current===generation)error(err);}
  finally{submitting.delete(id);draw();}
};
let failures=0;
const connectionError='Connection lost. Retrying… If Desk stopped, relaunch it and reopen this URL.';
let starting=true, restoreChosen=false, restoreSession=null, restoreGeneration=0, startupError='';
async function startup(){
  const current=generation;
  await refresh();
  globalThis.DeskSessionReading?.prepare?.();
  if(!restoreChosen){
    restoreChosen=true;restoreGeneration=current;
    let last=null;try{last=localStorage.getItem('codex-desk-browser-preview-session-v1');}catch{}
    if(current===generation && !selected && state.sessions.some(s=>s.id===last && (!s.archived || activeSession(s))))restoreSession=last;
  }
  // A deliberate selection supersedes this return, including a late open reply.
  if(restoreSession && restoreGeneration===generation){
    const attempt=generation+1;
    const restored=await open(restoreSession,{keepError:true,steerReceiptOnly:true});
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
    const editor=document.activeElement;
    const editorAnchor=editor?.isConnected && editor.closest?.('.approval')
      ? {node:editor,top:editor.getBoundingClientRect().top}:null;
    const follow=nearLatest() && (globalThis.DeskSessionReading?.follow?.() ?? true) && !globalThis.DeskActivity?.reading?.() && !document.activeElement?.closest?.('.approval') && ($('native-steps').hidden || !$('native-steps').open) && ($('turn-changes').hidden || !$('turn-changes').open) && ($('native-outcome').hidden || !$('native-outcome').open) && !$('recent-work').open && !DeskSteering.reading() && !DeskStopTask.reading() && !$('history-reader').open && !$('preparation').open && !$('preparation-request').open;let changed=0;
    for(const r of rows){
      after=r.seq;const progressChanged=consume(r.event);
      if(progressChanged || ['item/started','item/completed','item/agentMessage/delta','item/commandExecution/outputDelta','item/mcpToolCall/progress','error'].includes(r.event.method))++changed;
    }
    // Output inserted above a focused answer must not move its viewport.
    if(editorAnchor && editorAnchor.node.isConnected && document.activeElement===editorAnchor.node) {
      const delta=editorAnchor.node.getBoundingClientRect().top-editorAnchor.top;
      if(delta)window.scrollBy({top:delta,behavior:'instant'});
    }
    if(changed){
      if(follow)requestAnimationFrame(()=>{
        if(current!==generation)return;
        if((globalThis.DeskSessionReading?.follow?.() ?? true) && !globalThis.DeskActivity?.reading?.() && !document.activeElement?.closest?.('.approval') && ($('native-steps').hidden || !$('native-steps').open) && ($('turn-changes').hidden || !$('turn-changes').open) && ($('native-outcome').hidden || !$('native-outcome').open) && !$('recent-work').open && !DeskSteering.reading() && !DeskStopTask.reading() && !$('history-reader').open && !$('preparation').open && !$('preparation-request').open)goLatest();
        else{latestUpdates+=changed;latestLabel();}
      });
      else{latestUpdates+=changed;latestLabel();}
    }
    if(rows.length){await refresh();statePollAt=Date.now();}
  }
  const retained=turnRequest();
  if(selected && !opening && retained && !['accepted','rejected'].includes(retained.status) && !retained.writing && !retained.reading)await readTurnRequest(retained);
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
  if(dirty){draftConflicts.set(id,saved);draftMessages.set(id,'Saved preparation changed in Prepared work. Choose which draft to keep.');draftStatus(id);return false;}
  draftRevisions.set(id,saved.revision);draftSaved.set(id,saved);
  drafts.set(id,saved.text);draftModes.set(id,saved.mode);
  draftMessages.set(id,'Draft saved locally. Nothing has been sent.');
  if(selected===id){$('prompt').value=saved.text;$('turn-mode').value=saved.mode;modeSelected=id;draftStatus(id);syncDraftEvidence();}
  return true;
}
DeskPreparation.configure({api,make,profileLabel,onSaved:preparationSaved,
  onBrowseEvidence:capture=>{preparedEvidenceOwner=capture;$('history').showModal();return nativeList();},
  onEvidenceChange:()=>DeskEvidencePreparation.sync(),
  readEvidenceReference:(reference,callbacks)=>DeskEvidencePreparation.readReference(reference,callbacks),
  navigationIdentity:()=>JSON.stringify([selected,generation]),
  openConversation:async id=>{await open(id);return selected===id && !opening && !$('task').hidden;}});
$('show-preparation').onclick=()=>DeskPreparation.show();
DeskHome.configure({api,row:nativeRow,selected:()=>selected,generation:()=>generation,open,
  state:()=>state,opening:()=>opening,
  browse:()=>$('browse').click(),project:()=>$('new').click()});
tick();

let nativeVersion=0,nativeCursor=null,nativeQuery=null,nativeLoading=false;
function nativeRow(t, resume, handoff, label='Resume with current settings', read=null) {
  const box=make('div','','native-row');box.append(make('strong',t.name || t.preview || t.id),make('small',`${t.cwd} · ${t.modelProvider}`));
  const actions=make('div','','actions');
  if(resume && t.cwdExists!==false){const view=make('button',label);view.type='button';
  view.onclick=async()=>{
    if(view.disabled)return;
    view.disabled=true;
    try {await resume();} finally {view.disabled=false;}
  };actions.append(view);}
  if(handoff){const review=make('button','Review handoff');review.type='button';review.onclick=handoff;actions.append(review);}
  if(read){const original=make('button','Read original conversation','native-read');original.type='button';original.onclick=read;actions.append(original);}
  box.append(actions);
  if(t.cwdExists===false)box.append(make('p','Project folder unavailable. Original evidence is still readable; restore the folder to resume.','muted'));
  return box;
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
let handoffSource=null,handoffVersion=0,handoffVisible=false;
const handoffStarts=new Set(),handoffRequests=new Map();
const handoffTokenKey='codex-desk-handoff-requests';
// Only opaque request IDs survive a reload. Reviewed work stays in page memory
// and the private server receipt, never in browser storage.
const handoffTokens=new Map();
try{for(const [source,token] of Object.entries(JSON.parse(sessionStorage.getItem(handoffTokenKey) || '{}'))){
  if(source && typeof token==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(token))handoffTokens.set(source,token);
}}catch(e){}
function saveHandoffTokens(){sessionStorage.setItem(handoffTokenKey,JSON.stringify(Object.fromEntries(handoffTokens)));}
function handoffRequest(source){
  if(!handoffRequests.has(source) && handoffTokens.has(source))handoffRequests.set(source,{source,token:handoffTokens.get(source),body:null,result:null,receiptVersion:0});
  return handoffRequests.get(source);
}
// Canceled preparation belongs to its source, not the shared dialog.
const handoffGoals=new Map(),handoffEvidence=new Map(),handoffScopes=new Map(),handoffEdits=new Map();
function rememberHandoff(){
  if(!handoffSource)return;
  handoffGoals.set(handoffSource,$('handoff-goal').value);handoffEvidence.set(handoffSource,$('handoff-text').value);
  handoffScopes.set(handoffSource,{cwd:$('handoff-cwd').value,profile:$('handoff-profile').value});
  handoffEdits.set(handoffSource,(handoffEdits.get(handoffSource) || 0)+1);
}
$('handoff-goal').oninput=rememberHandoff;$('handoff-text').oninput=rememberHandoff;
$('handoff-cwd').oninput=rememberHandoff;$('handoff-profile').onchange=rememberHandoff;
function handoffBodyMatches(body){return !!body && handoffSource===body.source && ['goal','text','cwd','profile'].every(key=>$('handoff-'+key).value===body[key]);}
function handoffAccepted(result){return result?.handoff?.status==='accepted' && result.handoff.admission?.outcome==='accepted';}
function handoffCanReplace(request){
  if(!request || request.reading || handoffStarts.has(request.source))return false;
  if(request.notFound)return true;
  const result=request.result;
  return !!result && !result.preparation?.reservation && (handoffAccepted(result) || (result.handoff?.status==='needs_review' && result.handoff.admission?.outcome==='rejected'));
}
function drawHandoff(){
  const request=handoffRequest(handoffSource),busy=handoffStarts.has(handoffSource),result=request?.result;
  $('handoff-start').disabled=busy || !!request;$('handoff-start').hidden=!!request;
  $('handoff-recover').hidden=!request;$('handoff-recover').disabled=!!request?.reading;
  $('handoff-retry').hidden=!request?.body || !!result || !!request?.conflict;
  $('handoff-retry').disabled=busy || !!request?.reading;
  $('handoff-open').hidden=!result?.id;$('handoff-open').disabled=!!request?.reading;
  $('handoff-open').textContent=handoffAccepted(result)?'Open retained conversation':'Review retained target';
  $('handoff-new').hidden=!request;$('handoff-new').disabled=!handoffCanReplace(request);
  $('handoff-status').hidden=!request;
  if(!request)return;
  let message;
  if(busy)message='Starting the captured reviewed request…';
  else if(request.reading)message='Checking the retained request. Nothing is being sent.';
  else if(result){
    if(handoffAccepted(result))message='Start accepted. The exact conversation is retained in saved sessions.';
    else if(result.handoff?.admission?.outcome==='unknown' || result.preparation?.reservation?.state==='unknown')message='Start unconfirmed. Review the retained reservation and activity before sending another task.';
    else if(result.handoff?.status==='pending')message='Start receipt pending. Review the retained target before another send.';
    else if(result.handoff?.admission?.outcome==='rejected')message='Start rejected. The original task remains prepared in the retained target. Review and retry it there.';
    else message='No completed start receipt. Review the retained target and preparation before another send.';
  }else if(request.notFound)message='No saved target for this request. Explicitly retry the original request or prepare a different task.';
  else message='No local start receipt. The request token is retained. Check the saved request'+(request.body?' or explicitly retry the original reviewed request.':'. Recover the saved target rather than sending the visible editor.');
  if(request.conflict)message+=' This token belongs to different reviewed work; review its original target.';
  if(request.body && !handoffBodyMatches(request.body))message+=' Your later edits have not been sent.';
  $('handoff-status').textContent=message;
}
async function readHandoffRequest(request){
  if(request.reading)return request.reading;
  const receiptVersion=request.receiptVersion;
  const pending=(async()=>{
    try{
      const result=await api('/api/handoff/request?token='+encodeURIComponent(request.token));
      if(result.token!==request.token || !result.id)throw Error('The retained request receipt did not match this token');
      if(receiptVersion===request.receiptVersion){request.result=result;request.notFound=false;request.error=null;++request.receiptVersion;}
    }catch(e){if(receiptVersion===request.receiptVersion){request.error=e;if(e.status===404){request.notFound=true;request.result=null;}}}
    finally{request.reading=null;}
  })();
  request.reading=pending;return pending;
}
async function showHandoff(thread,cwd,valid=()=>true) {
  if(!$('preview').open)handoffVisible=false;
  const current=generation,version=++handoffVersion,request=handoffRequest(thread);
  try{
    let reviewError=null;
    const original=api('/api/handoff',{thread}).catch(e=>{if(!request)throw e;reviewError=e;return {text:''};});
    const [review]=await Promise.all([original,request?readHandoffRequest(request):Promise.resolve()]);
    if(current!==generation || version!==handoffVersion || !valid())return;
    handoffSource=thread;$('handoff-goal').value=handoffGoals.get(thread) || '';$('handoff-error').hidden=true;
    const scope=handoffScopes.get(thread);$('handoff-cwd').value=scope?.cwd ?? cwd;fillProfiles($('handoff-profile'));
    if(scope)$('handoff-profile').value=scope.profile;
    $('handoff-text').value=handoffEvidence.has(thread)?handoffEvidence.get(thread):review.text;
    drawHandoff();const failure=request?.error || reviewError;if(failure){$('handoff-error').textContent=failure.message;$('handoff-error').hidden=false;}
    $('history').close();$('preview').showModal();handoffVisible=true;
  }catch(e){if(current===generation && version===handoffVersion && valid())error(e);}
}
$('browse').onclick=()=>{preparedEvidenceOwner=null;$('history').showModal();nativeList();};
$('history-search').oninput=resetNative;
$('history-search-form').onsubmit=e=>{e.preventDefault();nativeList();};
$('history').addEventListener('close',()=>{if(!$('history').open)resetNative();});
$('more').onclick=()=>nativeList(nativeCursor);
$('history-close').onclick=()=>$('history').close();$('preview-close').onclick=()=>$('preview').close();
$('handoff').onclick=()=>{const s=state.sessions.find(s=>s.id===selected);if(s)showHandoff(s.thread_id,s.cwd);};
$('preview').addEventListener('close',()=>{if(handoffVisible && !$('preview').open){handoffVisible=false;++handoffVersion;}});
function handoffIntent(source){
  const version=handoffVersion,startedGeneration=generation,startedSelection=selected;
  return ()=>version===handoffVersion && generation===startedGeneration && selected===startedSelection && handoffSource===source && $('preview').open;
}
async function sendHandoffRequest(request){
  const source=request.source,current=handoffIntent(source),edit=handoffEdits.get(source) || 0;
  if(!request.body || handoffStarts.has(source) || request.reading || !$('preview').open)return;
  handoffStarts.add(source);request.error=null;$('handoff-error').hidden=true;drawHandoff();
  try{
    // Retention must precede native work; an explicit retry reuses this body.
    handoffTokens.set(source,request.token);saveHandoffTokens();
    const result=await api('/api/handoff/start',request.body);
    if(result.token!==request.token || !result.id)throw Error('The start receipt did not match this request token');
    request.result=result;request.notFound=false;++request.receiptVersion;
    if(handoffAccepted(result) && (handoffEdits.get(source) || 0)===edit){
      if(handoffGoals.get(source)===request.body.goal)handoffGoals.delete(source);
      if(handoffEvidence.get(source)===request.body.text)handoffEvidence.delete(source);
    }
    await refresh();
    if(current() && handoffAccepted(result) && handoffBodyMatches(request.body) && (handoffEdits.get(source) || 0)===edit){
      $('preview').close();await open(result.id);
    }else if(current())drawHandoff();
  }catch(e){
    request.error=e;
    if(e.status===409 && e.current?.token===request.token){request.result=e.current;request.conflict=true;request.notFound=false;++request.receiptVersion;await refresh();}
    if(current()){$('handoff-error').textContent=e.message;$('handoff-error').hidden=false;drawHandoff();}
  }finally{
    handoffStarts.delete(source);
    // Old replies can unlock their source, but cannot repaint a newer editor.
    if(handoffSource===source && $('preview').open)drawHandoff();
  }
}
$('handoff-start').onclick=async()=>{
  const source=handoffSource;if(!source || handoffRequest(source) || handoffStarts.has(source) || !$('preview').open)return;
  const body=Object.freeze({token:crypto.randomUUID(),source,cwd:$('handoff-cwd').value,profile:$('handoff-profile').value,goal:$('handoff-goal').value,text:$('handoff-text').value});
  const request={source,token:body.token,body,result:null,receiptVersion:0};handoffRequests.set(source,request);
  await sendHandoffRequest(request);
};
$('handoff-retry').onclick=()=>{
  const request=handoffRequest(handoffSource);
  if(request?.body && !request.result && !request.conflict)return sendHandoffRequest(request);
};
$('handoff-recover').onclick=async()=>{
  const request=handoffRequest(handoffSource);if(!request || request.reading || !$('preview').open)return;
  const current=handoffIntent(request.source),pending=readHandoffRequest(request);$('handoff-error').hidden=true;drawHandoff();await pending;
  if(current()){drawHandoff();if(request.error){$('handoff-error').textContent=request.error.message;$('handoff-error').hidden=false;}}
};
$('handoff-open').onclick=async()=>{
  const request=handoffRequest(handoffSource);if(!request?.result?.id || request.reading || !$('preview').open)return;
  $('preview').close();await open(request.result.id,{revealLatest:false});
};
$('handoff-new').onclick=()=>{
  const source=handoffSource,request=handoffRequest(source);if(!handoffCanReplace(request) || !$('preview').open)return;
  handoffTokens.delete(source);
  try{saveHandoffTokens();}catch(e){handoffTokens.set(source,request.token);$('handoff-error').textContent=e.message;$('handoff-error').hidden=false;return;}
  handoffRequests.delete(source);++handoffVersion;drawHandoff();$('handoff-error').hidden=true;
  $('handoff-status').textContent='Different task prepared. Review the current editor, then explicitly Start a new request.';$('handoff-status').hidden=false;
};

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

let renameSession=null,renameVersion=0;
const renaming=new Set();
function renameControls(){$('rename-save').disabled=renaming.has(renameSession);}
$('rename').onclick=()=>{
  const s=state.sessions.find(s=>s.id===selected);if(!s)return;
  ++renameVersion;renameSession=s.id;$('rename-name').value=s.name || '';$('rename-error').hidden=true;
  renameControls();$('rename-dialog').showModal();$('rename-name').focus();$('rename-name').select();
};
$('rename-cancel').onclick=()=>$('rename-dialog').close();
$('rename-dialog').addEventListener('close',()=>{if(!$('rename-dialog').open)++renameVersion;});
$('rename-form').onsubmit=async e=>{
  e.preventDefault();const id=renameSession,version=renameVersion,name=$('rename-name').value;
  if(!id || renaming.has(id))return;
  renaming.add(id);renameControls();$('rename-error').hidden=true;
  const current=()=>version===renameVersion && renameSession===id && $('rename-dialog').open;
  try{
    await api('/api/rename',{session:id,name});
    // Only the submitted editor may close; later edits remain available to save.
    if(current() && $('rename-name').value===name)$('rename-dialog').close();
    await refresh();
  }catch(e){
    if(current()){$('rename-error').textContent=e.message;$('rename-error').hidden=false;}
    await refresh();
  }finally{renaming.delete(id);renameControls();}
};
