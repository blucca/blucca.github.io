/* Explicit instructions for one native active turn; independent of task drafts. */
const DeskSteering = (() => {
  const key='codex-desk-steer-requests',tokens=new Map(),receipts=new Map(),editors=new Map();
  const known=new Set(['pending','accepted','rejected','needs_review']);
  const probes=new Map();
  let context=null,turn=null,latest=null,retired=new Set(),view=null,options=null;
  try{const saved=JSON.parse(sessionStorage.getItem(key) || '[]');if(Array.isArray(saved))for(const row of saved)
    if(typeof row?.session==='string' && uuid(row.token))tokens.set(row.session,row.token);}catch{}
  function uuid(value){return typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);}
  function save(){sessionStorage.setItem(key,JSON.stringify([...tokens].map(([session,token])=>({session,token}))));}
  function editor(id=context?.session){if(!editors.has(id))editors.set(id,{text:'',version:0});return editors.get(id);}
  function request(id=context?.session){
    if(!receipts.has(id) && tokens.has(id))receipts.set(id,{session:id,token:tokens.get(id),body:null,capture:null,status:null,version:0});
    return receipts.get(id);
  }
  function same(value){return !!context && value?.session===context.session && value?.thread===context.thread && value?.generation===context.generation;}
  function active(){const owner=options?.selection();return same(owner) && owner.connected!==false && !owner.opening && !!context.session && !!context.thread && !!turn && ['running','approval'].includes(owner.status);}
  function current(req){return !!req?.body && req.body.threadId===context?.thread && req.body.expectedTurnId===turn && req.result?.request?.target_current!==false && !req.result?.request?.binding_mismatch;}
  function prepared(req){return req?.prepared && same(req.prepared) && req.prepared.turn===turn;}
  function blocked(req){return !!req && (!req.status || ['pending','needs_review'].includes(req.status)) && !(req.body && !current(req) && prepared(req));}
  function text(node,value){if(node.textContent!==value)node.textContent=value;}
  function render(){
    if(!view || !context?.session)return;
    const req=request(),draft=editor(),eligible=active(),probe=probes.get(context.session),busy=!!req?.writing || !!req?.reading || !!probe?.busy;
    view.section.hidden=!(eligible || req || draft.text);
    view.send.disabled=!eligible || busy || !draft.text.trim() || blocked(req) || !!req?.conflict || !!probe?.error;
    view.check.hidden=!req && !probe?.error;view.check.disabled=busy;
    view.prepare.hidden=!req || !req.body || current(req) || !['pending','needs_review'].includes(req.status) || !eligible;
    view.prepare.disabled=busy || !!prepared(req);
    view.input.disabled=!context.thread || !!options.selection().opening;
    text(view.target,eligible?'Current native task · '+context.thread+' / '+turn:'No active native task is available for an instruction.');
    let message=busy?(req?.writing?'Sending the captured instruction…':'Checking the retained instruction…'):
      !req?'Write a correction for the current task.':
      req.status==='accepted'?'Instruction accepted by native task '+req.body?.expectedTurnId+'.':
      req.status==='rejected'?'Native Codex rejected this instruction. The correction remains available to edit.':
      req.status==='needs_review'?'Instruction unconfirmed. Check its retained receipt before another instruction to this task.':
      'Instruction response unconfirmed. Check its retained receipt.';
    if(req?.body && !current(req))message+=' This retained instruction belongs to an earlier task target.';
    if(prepared(req))message+=' A fresh instruction is prepared for the current task; choose Send explicitly.';
    if(req?.status==='accepted' && draft.text)message+=' Your newer correction remains unsent.';
    text(view.status,message);
    const failure=req?.error?.message || req?.result?.request?.error || probe?.error?.message || '';
    view.error.hidden=!failure;text(view.error,failure);
    view.captured.hidden=!req?.body;
    if(req?.body){text(view.captureText,req.body.text);text(view.captureTarget,'Captured native task · '+req.body.threadId+' / '+req.body.expectedTurnId);}
  }
  function configure(value){
    options=value;const $=value.$;
    view={section:$('steering'),input:$('steering-input'),send:$('steering-send'),check:$('steering-check'),prepare:$('steering-prepare'),
      target:$('steering-target'),status:$('steering-status'),error:$('steering-error'),captured:$('steering-captured'),captureText:$('steering-captured-text'),captureTarget:$('steering-captured-target')};
    view.input.oninput=()=>{const draft=editor();draft.text=view.input.value;++draft.version;render();};
    view.send.onclick=send;view.check.onclick=()=>request()?read(request()):opened();
    view.prepare.onclick=()=>{const req=request();if(!active() || !req?.body || current(req) || req.writing || req.reading)return;req.prepared={...context,turn};render();view.input.focus({preventScroll:true});};
  }
  function select(value){
    if(same(value))return;
    const changed=context?.session!==value.session;context={...value};turn=null;latest=null;retired=new Set();
    if(view && changed){view.input.value=editor().text;view.captured.open=false;}
    render();
  }
  function start(id){if(typeof id!=='string' || !id || id===turn || retired.has(id))return;if(latest && latest!==id)retired.add(latest);turn=id;latest=id;render();}
  function finish(id){if(id!==turn)return;retired.add(id);turn=null;render();}
  function consume(message,value){
    if(!same(value) || !context.thread || !message || message.id!==undefined)return;
    const p=message.params || {},thread=p.threadId || p.thread?.id || p.turn?.threadId;
    if(thread && thread!==context.thread)return;
    const id=p.turnId || p.turn?.id;
    if(message.method==='turn/started')start(id);
    else if(message.method==='turn/completed')finish(id);
    else if(message.method==='desk/steerReceipt' && request()?.token===p.token)read(request());
  }
  function sync(session,value){if(!same(value) || session?.id!==context.session)return;if(!options.selection().opening && !['running','approval','starting'].includes(session.status) && turn)finish(turn);render();}
  function restoreThread(thread,value){
    if(!same(value) || thread?.id!==context.thread)return;
    const turns=Array.isArray(thread.turns)?thread.turns:[],last=turns.at(-1);
    if(!last?.id || retired.has(last.id))return;
    if(!latest || turns.some(t=>t.id===latest)){if(last.status==='inProgress')start(last.id);else if(['completed','interrupted','failed'].includes(last.status)){start(last.id);finish(last.id);}}
  }
  function apply(req,result){
    if(receipts.get(req.session)!==req)return;
    if(result?.session!==req.session || result?.token!==req.token || !known.has(result.request?.status))throw Error('The instruction receipt did not match its captured request');
    const receipt=result.request,body=receipt.payload;
    if(!body || body.session!==req.session || body.token!==req.token || typeof body.text!=='string' || !body.threadId || !body.expectedTurnId)throw Error('The captured instruction could not be read');
    if(req.body && ['session','token','threadId','expectedTurnId','text'].some(k=>req.body[k]!==body[k])){req.conflict=true;throw Error('This instruction identity belongs to different captured work');}
    if(receipt.status==='accepted' && receipt.result?.turnId!==body.expectedTurnId)throw Error('Native acceptance did not confirm the captured task');
    req.body=Object.freeze({...body});req.status=receipt.status;req.result=result;req.error=null;++req.version;
    const draft=editor(req.session);
    if(!req.capture && !draft.version && !draft.text && receipt.status!=='accepted'){
      draft.text=body.text;req.capture={version:0};if(context?.session===req.session)view.input.value=draft.text;
    }
    if(receipt.status==='accepted' && !receipt.binding_mismatch && req.capture && draft.version===req.capture.version && draft.text===body.text){
      draft.text='';++draft.version;if(context?.session===req.session)view.input.value='';
    }
  }
  async function read(req){
    if(!req || receipts.get(req.session)?.token!==req.token)return;
    req=receipts.get(req.session);
    if(req.reading || req.writing)return;
    const version=req.version;req.reading=true;render();
    try{const result=await options.api('/api/steer/request?session='+encodeURIComponent(req.session)+'&token='+encodeURIComponent(req.token));if(version===req.version)apply(req,result);}
    catch(error){if(version===req.version)req.error=error;}
    finally{req.reading=false;render();}
  }
  async function opened(){
    const owner={...context},existing=request();if(existing){await read(existing);return true;}
    const probe={busy:true,error:null};probes.set(owner.session,probe);render();
    try{
      const result=await options.api('/api/steer/request?session='+encodeURIComponent(owner.session));
      if(!result)return false;
      if(receipts.has(owner.session))return true;
      if(result.session!==owner.session || !uuid(result.token))throw Error('The retained instruction identity could not be read');
      const req={session:owner.session,token:result.token,body:null,capture:null,status:null,version:0};
      tokens.set(req.session,req.token);save();receipts.set(req.session,req);apply(req,result);return true;
    }catch(error){if(error.status!==404){probe.error=error;return true;}return false;}
    finally{probe.busy=false;if(same(owner))render();}
  }
  async function send(){
    const previous=request(),draft=editor();
    if(!active() || !draft.text.trim() || previous?.writing || previous?.reading || blocked(previous) || previous?.conflict || probes.get(context.session)?.busy || probes.get(context.session)?.error)return;
    const owner={...context},token=crypto.randomUUID(),body=Object.freeze({session:owner.session,token,threadId:owner.thread,expectedTurnId:turn,text:draft.text});
    const req={session:owner.session,token,body,capture:{version:draft.version,generation:owner.generation},status:'pending',version:0,writing:true};
    tokens.set(req.session,token);
    try{save();}catch(error){tokens.delete(req.session);if(previous)tokens.set(req.session,previous.token);text(view.error,error.message);view.error.hidden=false;return;}
    receipts.set(req.session,req);view.captured.open=true;render();
    try{apply(req,await options.api('/api/steer',body));}
    catch(error){
      req.error=error;
      if(error.status===409 && error.current?.session===req.session && uuid(error.current.token)){
        try{
          if(error.current.token===req.token)apply(req,error.current);
          else{const retained={session:req.session,token:error.current.token,body:null,capture:null,status:null,version:0};tokens.set(retained.session,retained.token);save();receipts.set(retained.session,retained);apply(retained,error.current);}
        }catch(failure){req.error=failure;}
      }
    }
    finally{req.writing=false;render();}
  }
  function reading(){return !!view && !view.section.hidden && (document.activeElement===view.input || (!view.captured.hidden && view.captured.open));}
  function state(){const req=request();return {context:context && {...context},turn,editor:{...editor()},request:req && {...req},active:active()};}
  return {configure,select,consume,sync,restoreThread,opened,read,send,reading,state};
})();
