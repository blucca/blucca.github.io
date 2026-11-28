/* Bounded reading-place metadata; native content is always read afresh. */
(function(root) {
  'use strict';
  const VERSION=1,STORAGE_KEY='codex-desk-browser-preview-reading-checkpoints-v1';
  const LIMITS=Object.freeze({owners:100,item_views:40,turn_views:40,characters:524288,coordinate:1000000000});
  const kinds=new Set(['collaboration','native_steps','turn_changes']);
  const record=value=>value!==null && typeof value==='object' && !Array.isArray(value);
  function identifier(value) {
    if(typeof value!=='string' || !value.trim() || Array.from(value).length>200)throw Error('Use the actual native reading identity.');
    return value;
  }
  function owner(value) {
    if(!record(value) || typeof value.native_home!=='string' || !/^[a-f0-9]{64}$/.test(value.native_home))throw Error('Use the captured native home namespace.');
    return {native_home:value.native_home,session:identifier(value.session),thread_id:identifier(value.thread_id)};
  }
  const ownerKey=value=>JSON.stringify([value.native_home,value.session,value.thread_id]);
  const itemKey=value=>JSON.stringify([value.turn_id,value.item_id]);
  function number(value,fallback=0,signed=false,integer=false) {
    if(value===undefined)return fallback;
    if(typeof value!=='number' || !Number.isFinite(value) || Math.abs(value)>LIMITS.coordinate || (!signed && value<0) || (integer && !Number.isSafeInteger(value)))throw Error('Use finite reading-window and scroll metadata.');
    return value;
  }
  function anchor(value) {
    if(value===null || value===undefined)return null;
    if(!record(value))throw Error('Use the native item reading anchor.');
    return {turn_id:identifier(value.turn_id),item_id:identifier(value.item_id),
      offset:number(value.offset,0,true),screen_top:number(value.screen_top,0,true)};
  }
  function itemView(value) {
    if(!record(value))throw Error('Use native item view metadata.');
    const open=value.open===undefined?null:value.open;
    if(open!==null && typeof open!=='boolean')throw Error('Use a deliberate disclosure state.');
    return {turn_id:identifier(value.turn_id),item_id:identifier(value.item_id),open,
      window_start:number(value.window_start,0,false,true),scroll_top:number(value.scroll_top),scroll_left:number(value.scroll_left)};
  }
  function turnView(value) {
    if(!record(value) || !kinds.has(value.kind) || typeof value.open!=='boolean')throw Error('Use a source-bound native turn disclosure.');
    return {turn_id:identifier(value.turn_id),kind:value.kind,open:value.open,
      scroll_top:number(value.scroll_top),scroll_left:number(value.scroll_left)};
  }
  function bounded(values,limit,normalize,key,priority) {
    if(!Array.isArray(values))throw Error('Use a list of native reading metadata.');
    const ordered=priority?[...values.filter(priority),...values.filter(value=>!priority(value))]:values;
    const result=[],seen=new Set();
    for(const value of ordered) {
      if(result.length===limit)break;
      const next=normalize(value),identity=key(next);
      if(seen.has(identity))throw Error('Reading view identity is ambiguous.');
      seen.add(identity);result.push(next);
    }
    return result;
  }
  function normalizeView(value) {
    if(!record(value) || typeof value.latest!=='boolean')throw Error('Capture the deliberate Latest output intent.');
    const at=anchor(value.anchor),scroll=value.window_scroll===undefined?{}:value.window_scroll;
    if(!record(scroll))throw Error('Use window reading scroll metadata.');
    // Keep the exact anchor's own tool state when a large activity needs clipping.
    const item_views=bounded(value.item_views===undefined?[]:value.item_views,LIMITS.item_views,itemView,itemKey,
      at?row=>row?.turn_id===at.turn_id && row?.item_id===at.item_id:null);
    const turn_views=bounded(value.turn_views===undefined?[]:value.turn_views,LIMITS.turn_views,turnView,row=>JSON.stringify([row.turn_id,row.kind]),
      row=>row?.kind==='native_steps' || row?.kind==='turn_changes' || (!!at && row?.turn_id===at.turn_id));
    return {latest:value.latest,anchor:at,window_scroll:{top:number(scroll.top),left:number(scroll.left)},item_views,turn_views};
  }
  function checkpoint(value) {
    if(!record(value) || value.version!==VERSION || !Number.isSafeInteger(value.saved_at) || value.saved_at<0)throw Error('The reading checkpoint could not be read.');
    return {version:VERSION,owner:owner(value.owner),saved_at:value.saved_at,view:normalizeView(value.view)};
  }
  function explicit(options) {
    const value=options?.explicitTarget;
    return value===true || record(value);
  }
  function result(status,view=null,unavailable=[]) {
    return {available:status==='restored' || status==='latest',status,view,unavailable};
  }
  function sourceCatalog(value) {
    if(!record(value) || !Array.isArray(value.items) || !Array.isArray(value.turn_ids))throw Error('Read fresh native identities before restoring a reading place.');
    const thread_id=identifier(value.thread_id),turns=new Map(),items=new Map();
    for(const id of value.turn_ids){identifier(id);turns.set(id,(turns.get(id) || 0)+1);}
    for(const row of value.items) {
      if(!record(row))throw Error('Use actual supplied native item identities.');
      const next={turn_id:identifier(row.turn_id),item_id:identifier(row.item_id)},key=itemKey(next);
      items.set(key,(items.get(key) || 0)+1);
    }
    const slot=field=>value[field]===undefined || value[field]===null?null:identifier(value[field]);
    return {thread_id,turns,items,native_steps_turn:slot('native_steps_turn'),turn_changes_turn:slot('turn_changes_turn')};
  }
  function itemAvailability(catalog,value) {
    if(!catalog.turns.has(value.turn_id))return 'turn_unavailable';
    if(catalog.turns.get(value.turn_id)!==1)return 'turn_ambiguous';
    const count=catalog.items.get(itemKey(value)) || 0;
    return count===1?null:count?'item_ambiguous':'item_unavailable';
  }
  function resolveView(value,source,options={}) {
    // Even an unavailable explicit source/response remains the user's destination.
    if(explicit(options))return result('explicit_target');
    let view,catalog;
    try{view=normalizeView(value);}catch{return result('invalid_checkpoint');}
    try{catalog=sourceCatalog(source);}catch{return result('source_unavailable');}
    if(!view.latest) {
      if(!view.anchor)return result('anchor_unavailable');
      const reason=itemAvailability(catalog,view.anchor);
      if(reason)return result(reason.includes('ambiguous')?'anchor_ambiguous':'anchor_unavailable',null,
        [{kind:'anchor',turn_id:view.anchor.turn_id,item_id:view.anchor.item_id,reason}]);
    }
    const unavailable=[];
    view.item_views=view.item_views.filter(row=>{
      const reason=itemAvailability(catalog,row);
      if(reason)unavailable.push({kind:'item_view',turn_id:row.turn_id,item_id:row.item_id,reason});
      return !reason;
    });
    view.turn_views=view.turn_views.filter(row=>{
      const count=catalog.turns.get(row.turn_id) || 0;
      const slot=row.kind==='native_steps'?catalog.native_steps_turn:row.kind==='turn_changes'?catalog.turn_changes_turn:row.turn_id;
      const reason=count!==1?(count?'turn_ambiguous':'turn_unavailable'):slot!==row.turn_id?'turn_changed':null;
      if(reason)unavailable.push({kind:row.kind,turn_id:row.turn_id,reason});
      return !reason;
    });
    // Latest never follows an old anchor after fresh native output was supplied.
    if(view.latest)view.anchor=null;
    return result(view.latest?'latest':'restored',view,unavailable);
  }
  function mismatch(a,b) {
    for(const [field,status] of [['native_home','home_mismatch'],['session','session_mismatch'],['thread_id','thread_mismatch']])if(a[field]!==b[field])return status;
    return null;
  }
  function resolve(value,saved,source,options={}) {
    if(explicit(options))return result('explicit_target');
    let current,entry,fresh;
    try{current=owner(value);}catch{return result('owner_unavailable');}
    if(saved===null || saved===undefined)return result('checkpoint_missing');
    try{entry=checkpoint(saved);}catch{return result('invalid_checkpoint');}
    const changed=mismatch(current,entry.owner);if(changed)return result(changed);
    try{fresh=owner(source);}catch{return result('source_unavailable');}
    const sourceChanged=mismatch(current,fresh);if(sourceChanged)return result(sourceChanged);
    return resolveView(entry.view,source,options);
  }
  function create(storage,options={}) {
    const key=options.key===undefined?STORAGE_KEY:identifier(options.key),now=options.now || Date.now;
    function read() {
      let raw;
      try{raw=storage.getItem(key);}catch{return {status:'storage_unavailable',checkpoints:[]};}
      if(raw===null || raw===undefined)return {status:'ok',checkpoints:[]};
      if(typeof raw!=='string' || raw.length>LIMITS.characters)return {status:'invalid_storage',checkpoints:[]};
      let data;
      try{data=JSON.parse(raw);}catch{return {status:'invalid_storage',checkpoints:[]};}
      if(!record(data) || data.version!==VERSION || !Array.isArray(data.checkpoints))return {status:'invalid_storage',checkpoints:[]};
      const entries=[],seen=new Set();
      for(const row of data.checkpoints) {
        if(entries.length===LIMITS.owners)break;
        let entry;try{entry=checkpoint(row);}catch{continue;}
        const identity=ownerKey(entry.owner);if(seen.has(identity))continue;
        seen.add(identity);entries.push(entry);
      }
      return {status:'ok',checkpoints:entries};
    }
    function get(value) {
      const current=owner(value),identity=ownerKey(current);
      return read().checkpoints.find(row=>ownerKey(row.owner)===identity) || null;
    }
    function write(entries) {
      let raw=JSON.stringify({version:VERSION,checkpoints:entries});
      while(raw.length>LIMITS.characters && entries.length>1){entries.pop();raw=JSON.stringify({version:VERSION,checkpoints:entries});}
      if(raw.length>LIMITS.characters)return false;
      try{storage.setItem(key,raw);return true;}catch{return false;}
    }
    function put(value,metadata) {
      const current=owner(value),view=normalizeView(metadata),saved_at=now();
      if(!Number.isSafeInteger(saved_at) || saved_at<0)throw Error('Use the current reading checkpoint time.');
      const entry={version:VERSION,owner:current,saved_at,view},identity=ownerKey(current);
      const previous=read();
      if(previous.status==='storage_unavailable')return {stored:false,status:'storage_unavailable',checkpoint:entry};
      const entries=[entry,...previous.checkpoints.filter(row=>ownerKey(row.owner)!==identity)].slice(0,LIMITS.owners);
      const stored=write(entries);
      return {stored,status:stored?'stored':'storage_unavailable',checkpoint:entry};
    }
    function remove(value) {
      const current=owner(value),identity=ownerKey(current),previous=read();
      if(previous.status==='storage_unavailable')return {removed:false,status:previous.status};
      const entries=previous.checkpoints.filter(row=>ownerKey(row.owner)!==identity);
      if(entries.length===previous.checkpoints.length)return {removed:false,status:'not_found'};
      const removed=write(entries);return {removed,status:removed?'removed':'storage_unavailable'};
    }
    function restore(value,source,resolveOptions={}) {
      if(explicit(resolveOptions))return result('explicit_target');
      const previous=read();
      if(previous.status!=='ok')return result(previous.status);
      let current;try{current=owner(value);}catch{return result('owner_unavailable');}
      const saved=previous.checkpoints.find(row=>ownerKey(row.owner)===ownerKey(current)) || null;
      return resolve(current,saved,source,resolveOptions);
    }
    return {read,get,put,remove,restore};
  }
  const api={VERSION,STORAGE_KEY,LIMITS,normalizeView,resolveView,resolve,create};
  root.DeskReadingCheckpoint=api;
  if(typeof module!=='undefined' && module.exports)module.exports=api;
})(typeof globalThis==='undefined'?this:globalThis);
