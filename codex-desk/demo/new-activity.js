/* Parent-native recorded activity since an explicit, separately owned review. */
(function(root) {
  'use strict';
  const VERSION=1,STORAGE_KEY='codex-desk-browser-preview-activity-review-v1';
  const LIMITS=Object.freeze({owners:100,characters:131072});
  const record=value=>value!==null && typeof value==='object' && !Array.isArray(value);
  const types=new Set(['userMessage','agentMessage','plan','commandExecution','fileChange',
    'mcpToolCall','dynamicToolCall','collabAgentToolCall','subAgentActivity']);
  const deltas=new Map([['item/agentMessage/delta',['agentMessage','delta']],
    ['item/commandExecution/outputDelta',['commandExecution','delta']],
    ['item/plan/delta',['plan','delta']],['item/mcpToolCall/progress',['mcpToolCall','message']]]);
  function identifier(value) {
    if(typeof value!=='string' || !value.trim() || Array.from(value).length>200)
      throw Error('Use the actual native activity identity.');
    return value;
  }
  function sequence(value) {
    if(!Number.isSafeInteger(value) || value<0)throw Error('Use the captured local event sequence.');
    return value;
  }
  function owner(value) {
    if(!record(value) || typeof value.native_home!=='string' || !/^[a-f0-9]{64}$/.test(value.native_home))
      throw Error('Use the captured native home namespace.');
    return {native_home:value.native_home,session:identifier(value.session),thread_id:identifier(value.thread_id)};
  }
  const key=value=>JSON.stringify([value.native_home,value.session,value.thread_id]);
  const itemKey=value=>JSON.stringify([value.turn_id,value.item_id]);
  function mismatch(a,b) {
    for(const [field,status] of [['native_home','home_mismatch'],['session','session_mismatch'],['thread_id','thread_mismatch']])
      if(a[field]!==b[field])return status;
    return null;
  }
  function readable(item) {
    if(!record(item) || !types.has(item.type))return false;
    if(item.type==='agentMessage' || item.type==='plan')return typeof item.text==='string' && !!item.text.trim();
    if(item.type==='userMessage')return Array.isArray(item.content) && item.content.some(part=>
      record(part) && part.type==='text' && typeof part.text==='string' && !!part.text.trim());
    return true; // Tool summaries, including their native reported state, are readable.
  }
  function classify(value,row) {
    const current=owner(value);
    if(!record(row) || !Number.isSafeInteger(row.seq) || row.seq<=0 ||
       (row.session_id!==undefined && row.session_id!==current.session))return null;
    const event=row.event,p=event?.params;
    if(!record(event) || Object.hasOwn(event,'id') || !record(p) || p.threadId!==current.thread_id)return null;
    let type,id;
    if(event.method==='item/started' || event.method==='item/completed') {
      if(!readable(p.item))return null;
      type=p.item.type;id=p.item.id;
      if(p.itemId!==undefined && p.itemId!==id)return null;
    } else {
      const delta=deltas.get(event.method);if(!delta || typeof p[delta[1]]!=='string' || !p[delta[1]])return null;
      type=delta[0];id=p.itemId;
    }
    try{return {seq:row.seq,turn_id:identifier(p.turnId),item_id:identifier(id),item_type:type,method:event.method};}
    catch{return null;}
  }
  function capture(value,rows,accept=null) {
    const current=owner(value);
    if(!Array.isArray(rows) || (accept!==null && typeof accept!=='function'))throw Error('Capture the ordered session events.');
    const updates=[];let received_seq=0,frontier=0;
    for(const row of rows) {
      if(!record(row) || sequence(row.seq)<=received_seq ||
         (row.session_id!==undefined && row.session_id!==current.session))throw Error('The captured event batch has mixed or unordered ownership.');
      received_seq=row.seq;
      const update=classify(current,row);if(update && (!accept || accept(row,update))){updates.push(update);frontier=update.seq;}
    }
    return Object.freeze({owner:Object.freeze(current),received_seq,frontier,
      updates:Object.freeze(updates.map(Object.freeze))});
  }
  function captured(value,batch) {
    const current=owner(value);
    if(!record(batch) || mismatch(current,owner(batch.owner)))throw Error('The captured activity belongs to another native owner.');
    sequence(batch.received_seq);sequence(batch.frontier);
    if(batch.frontier>batch.received_seq || !Array.isArray(batch.updates))throw Error('Use the captured rendered activity frontier.');
    let previous=0;
    for(const update of batch.updates) {
      if(!record(update) || sequence(update.seq)<=previous || update.seq>batch.frontier || !types.has(update.item_type))
        throw Error('Use the ordered captured parent activity.');
      identifier(update.turn_id);identifier(update.item_id);previous=update.seq;
    }
    if(previous!==batch.frontier)throw Error('Use the captured parent activity frontier.');
    return batch;
  }
  function pending(value,batch,reviewed_seq=null) {
    const current=owner(value);captured(current,batch);
    if(reviewed_seq===null)return {status:'baseline_missing',owner:current,frontier:batch.frontier,first:null,targets:[]};
    sequence(reviewed_seq);
    const grouped=new Map();
    for(const update of batch.updates)if(update.seq>reviewed_seq) {
      const identity=itemKey(update),prior=grouped.get(identity);
      if(prior){prior.last_seq=update.seq;prior.item_type=update.item_type;}
      else grouped.set(identity,{owner:current,turn_id:update.turn_id,item_id:update.item_id,
        item_type:update.item_type,first_seq:update.seq,last_seq:update.seq});
    }
    const targets=[...grouped.values()];
    return {status:targets.length?'new_activity':'up_to_date',owner:current,reviewed_seq,
      frontier:batch.frontier,first:targets[0] || null,targets};
  }
  function merge(value,reviewed_seq,...batches) {
    sequence(reviewed_seq);
    const current=owner(value),bySeq=new Map();let received_seq=0,frontier=0;
    for(const batch of batches)if(batch) {
      captured(current,batch);received_seq=Math.max(received_seq,batch.received_seq);frontier=Math.max(frontier,batch.frontier);
      for(const update of batch.updates) {
        const previous=bySeq.get(update.seq);
        if(previous && (previous.turn_id!==update.turn_id || previous.item_id!==update.item_id || previous.item_type!==update.item_type))
          throw Error('The same captured event sequence has different native activity.');
        if(update.seq>reviewed_seq)bySeq.set(update.seq,update);
      }
    }
    const retained=[...bySeq.values()].sort((a,b)=>a.seq-b.seq);
    frontier=retained.at(-1)?.seq || 0;
    return Object.freeze({owner:Object.freeze(current),received_seq,frontier,
      updates:Object.freeze(retained.map(update=>Object.freeze({...update})))});
  }
  function resolveTarget(value,target,source) {
    const unavailable=status=>({available:false,status,target:null});
    let current,original,fresh;
    try{current=owner(value);original=owner(target?.owner);fresh=owner(source);}
    catch{return unavailable('owner_unavailable');}
    const changed=mismatch(current,original) || mismatch(current,fresh);if(changed)return unavailable(changed);
    try {
      identifier(target.turn_id);identifier(target.item_id);sequence(target.first_seq);sequence(target.last_seq);
      if(!types.has(target.item_type) || target.first_seq<1 || target.last_seq<target.first_seq)
        return unavailable('invalid_target');
      if(!Array.isArray(source.turn_ids) || !Array.isArray(source.items))return unavailable('source_unavailable');
      const turns=source.turn_ids.filter(id=>id===target.turn_id).length;
      if(turns!==1)return unavailable(turns?'turn_ambiguous':'turn_unavailable');
      const matches=source.items.filter(item=>record(item) && item.turn_id===target.turn_id && item.item_id===target.item_id);
      if(matches.length!==1)return unavailable(matches.length?'item_ambiguous':'item_unavailable');
      if(matches[0].item_type!==target.item_type)return unavailable('item_type_changed');
      return {available:true,status:'available',target:{owner:current,turn_id:target.turn_id,item_id:target.item_id,
        item_type:target.item_type,first_seq:target.first_seq,last_seq:target.last_seq}};
    }catch{return unavailable('invalid_target');}
  }
  function entry(value) {
    if(!record(value))throw Error('Use review boundary metadata.');
    return {owner:owner(value.owner),reviewed_seq:sequence(value.reviewed_seq)};
  }
  function create(storage,options={}) {
    const storageKey=options.key===undefined?STORAGE_KEY:identifier(options.key);let memory=[];
    function read() {
      let raw,status='ok',saved=[];
      try{raw=storage.getItem(storageKey);}catch{status='storage_unavailable';}
      if(raw!==undefined && raw!==null)try {
        if(typeof raw!=='string' || raw.length>LIMITS.characters)throw Error();
        const data=JSON.parse(raw);if(!record(data) || data.version!==VERSION || !Array.isArray(data.reviews))throw Error();
        const seen=new Set();
        for(const value of data.reviews) {
          if(saved.length===LIMITS.owners)break;
          let next;try{next=entry(value);}catch{continue;}
          const identity=key(next.owner);if(seen.has(identity))continue;seen.add(identity);saved.push(next);
        }
      }catch{status='invalid_storage';}
      const entries=new Map();
      for(const value of [...memory,...saved]){const identity=key(value.owner),previous=entries.get(identity);
        if(!previous || value.reviewed_seq>previous.reviewed_seq)entries.set(identity,value);}
      return {status,reviews:[...entries.values()].slice(0,LIMITS.owners)};
    }
    function get(value) {
      const identity=key(owner(value));return read().reviews.find(next=>key(next.owner)===identity) || null;
    }
    function write(value) {
      const next=entry(value),identity=key(next.owner),previous=read().reviews;
      const existing=previous.find(row=>key(row.owner)===identity);
      next.reviewed_seq=Math.max(next.reviewed_seq,existing?.reviewed_seq || 0);
      const reviews=[next,...previous.filter(row=>key(row.owner)!==identity)].slice(0,LIMITS.owners);
      const raw=JSON.stringify({version:VERSION,reviews});let stored=false;
      if(raw.length<=LIMITS.characters)try{storage.setItem(storageKey,raw);stored=true;}catch{}
      memory=stored?[]:reviews;
      return {stored,status:stored?'stored':'storage_unavailable',review:next};
    }
    function seed(value,batch) {
      const current=owner(value);captured(current,batch);const existing=get(current);
      if(existing)return {stored:null,status:'baseline_exists',review:existing};
      return write({owner:current,reviewed_seq:batch.received_seq});
    }
    function mark(value,batch) {
      const current=owner(value);captured(current,batch);
      if(!get(current))return {stored:false,status:'baseline_missing',review:null};
      return write({owner:current,reviewed_seq:batch.frontier});
    }
    return {read,get,seed,mark,pending:(value,batch)=>pending(value,batch,get(value)?.reviewed_seq ?? null)};
  }
  const api={VERSION,STORAGE_KEY,LIMITS,classify,capture,merge,pending,resolveTarget,create};
  root.DeskNewActivity=api;
  if(typeof module!=='undefined' && module.exports)module.exports=api;
})(typeof globalThis==='undefined'?this:globalThis);
