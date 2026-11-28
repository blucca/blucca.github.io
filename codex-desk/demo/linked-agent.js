/* Captured parent-item to explicitly reported native agent-original relationship. */
(function(root){
  'use strict';
  const record=value=>value!==null && typeof value==='object' && !Array.isArray(value);
  const fields=new Set(['agentThreadId','receiverThreadIds','agentsStates']);
  const supported=new Set(['subAgentActivity','collabAgentToolCall']);
  function id(value){
    if(typeof value!=='string' || !value.trim() || Array.from(value).length>200)throw Error('Use the captured native source identity.');
    return value;
  }
  function owner(value){
    if(!record(value) || typeof value.native_home!=='string' || !/^[a-f0-9]{64}$/.test(value.native_home))throw Error('Use the captured native home namespace.');
    return {native_home:value.native_home,session:id(value.session),thread_id:id(value.thread_id),turn_id:id(value.turn_id),item_id:id(value.item_id)};
  }
  function mismatch(current,captured){
    for(const [field,status] of [['native_home','home_mismatch'],['session','session_mismatch'],['thread_id','parent_thread_mismatch'],['turn_id','parent_turn_mismatch'],['item_id','parent_item_mismatch']])
      if(current[field]!==captured[field])return status;
    return null;
  }
  function capture(value,item){
    const parent=owner(value),result={owner:parent,status:'relationship_unavailable',targets:[]};
    if(!record(item) || item.id!==parent.item_id)return {...result,status:'parent_item_mismatch'};
    if(!supported.has(item.type))return {...result,status:'unsupported_item'};
    const linked=new Map();
    function add(value,field){let native;try{native=id(value);}catch{return;}
      if(native===parent.thread_id)return;
      if(!linked.has(native))linked.set(native,new Set());linked.get(native).add(field);}
    if(item.type==='subAgentActivity')add(item.agentThreadId,'agentThreadId');
    else {
      for(const receiver of Array.isArray(item.receiverThreadIds)?item.receiverThreadIds:[])add(receiver,'receiverThreadIds');
      if(record(item.agentsStates))for(const receiver of Object.keys(item.agentsStates))if(receiver!=='_meta')add(receiver,'agentsStates');
    }
    const targets=[...linked].map(([child_thread_id,relationships])=>Object.freeze({owner:Object.freeze({...parent}),item_type:item.type,child_thread_id,
      relationships:Object.freeze([...relationships])}));
    return Object.freeze({owner:Object.freeze(parent),status:targets.length?'available':'relationship_unavailable',targets:Object.freeze(targets)});
  }
  function target(value){
    if(!record(value) || !supported.has(value.item_type) || !Array.isArray(value.relationships) || !value.relationships.length ||
      value.relationships.some(field=>!fields.has(field)))throw Error('Use the captured explicit native agent relationship.');
    const parent=owner(value.owner),child=id(value.child_thread_id);
    if(child===parent.thread_id)throw Error('The native relationship points to its parent.');
    return Object.freeze({owner:Object.freeze(parent),item_type:value.item_type,child_thread_id:child,relationships:Object.freeze([...new Set(value.relationships)])});
  }
  function resolveParent(value,captured,thread){
    const unavailable=status=>({available:false,status,target:null});let current,requested;
    try{current=owner(value);requested=target(captured);}catch{return unavailable('owner_unavailable');}
    const changed=mismatch(current,requested.owner);if(changed)return unavailable(changed);
    if(!record(thread) || thread.id!==current.thread_id || !Array.isArray(thread.turns))return unavailable('parent_source_unavailable');
    const turns=thread.turns.filter(turn=>record(turn) && turn.id===current.turn_id);
    if(turns.length!==1)return unavailable(turns.length?'parent_turn_ambiguous':'parent_turn_unavailable');
    const items=(Array.isArray(turns[0].items)?turns[0].items:[]).filter(item=>record(item) && item.id===current.item_id);
    if(items.length!==1)return unavailable(items.length?'parent_item_ambiguous':'parent_item_unavailable');
    if(items[0].type!==requested.item_type)return unavailable('parent_item_type_changed');
    const fresh=capture(current,items[0]);
    if(!fresh.targets.some(next=>next.child_thread_id===requested.child_thread_id))return unavailable('relationship_unavailable');
    return {available:true,status:'available',target:requested};
  }
  function resolveOriginal(captured,source){
    const unavailable=status=>({available:false,status,target:null});let requested;
    try{requested=target(captured);}catch{return unavailable('owner_unavailable');}
    if(!record(source) || typeof source.native_home!=='string')return unavailable('home_unavailable');
    if(source.native_home!==requested.owner.native_home)return unavailable('home_mismatch');
    const thread=source.thread;
    if(!record(thread) || thread.id!==requested.child_thread_id)return unavailable('child_thread_mismatch');
    if(!Array.isArray(thread.turns))return unavailable('child_source_unavailable');
    return {available:true,status:'available',target:requested,thread_id:thread.id};
  }
  const api={capture,resolveParent,resolveOriginal};root.DeskLinkedAgent=api;
  if(typeof module!=='undefined' && module.exports)module.exports=api;
})(typeof globalThis==='undefined'?this:globalThis);
