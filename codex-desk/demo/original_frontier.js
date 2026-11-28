/* Previously supplied original identities, separate from reading/consumption. */
(function(root) {
  'use strict';
  const VERSION=1,STORAGE_KEY='codex-desk-browser-preview-original-frontiers-v1';
  const LIMITS=Object.freeze({owners:100,characters:131072});
  const record=v=>v!==null && typeof v==='object' && !Array.isArray(v);
  function id(v) {
    if(typeof v!=='string' || !v.trim() || Array.from(v).length>200)throw Error('Use the supplied native identity.');
    return v;
  }
  function owner(v) {
    if(!record(v) || typeof v.native_home!=='string' || !/^[a-f0-9]{64}$/.test(v.native_home))throw Error('Use the captured native home.');
    return {native_home:v.native_home,thread_id:id(v.thread_id)};
  }
  const ownerKey=v=>JSON.stringify([v.native_home,v.thread_id]);
  const key=v=>JSON.stringify([v.turn_id,v.item_id]);
  function boundary(v) {
    if(!record(v))throw Error('Use the exact supplied item boundary.');
    return {turn_id:id(v.turn_id),item_id:id(v.item_id)};
  }
  function normalize(v) {
    if(!record(v) || !Number.isSafeInteger(v.item_count) || v.item_count<0)throw Error('Use the supplied snapshot item count.');
    const at=v.item_count?boundary(v.boundary):null;
    if(!v.item_count && v.boundary!==null)throw Error('An empty item snapshot has an empty boundary.');
    return {item_count:v.item_count,boundary:at};
  }
  function catalog(thread) {
    if(!record(thread) || !Array.isArray(thread.turns))throw Error('Use a fresh original native snapshot.');
    id(thread.id);const items=[],turns=new Map(),counts=new Map();
    for(const turn of thread.turns) {
      const turn_id=turn?.id;
      if(typeof turn_id==='string')turns.set(turn_id,(turns.get(turn_id)||0)+1);
      for(const item of Array.isArray(turn?.items)?turn.items:[]) {
        const row={turn_id,item_id:item?.id};items.push(row);
        if(typeof turn_id==='string' && typeof row.item_id==='string')counts.set(key(row),(counts.get(key(row))||0)+1);
      }
    }
    function availability(row) {
      try{boundary(row);}catch{return 'item_identity_unavailable';}
      if(turns.get(row.turn_id)!==1 || counts.get(key(row))!==1)return 'item_identity_ambiguous';
      return null;
    }
    return {items,availability};
  }
  function snapshot(thread) {
    const c=catalog(thread),last=c.items.at(-1);
    if(last && c.availability(last))throw Error('The supplied snapshot boundary is unavailable or ambiguous.');
    return {item_count:c.items.length,boundary:last?boundary(last):null};
  }
  function resolve(previous,thread) {
    let c,old;
    try{c=catalog(thread);}catch{return {status:'source_unavailable',count:0,target:null};}
    if(previous===null)return {status:'first_read',count:0,target:null};
    try{old=normalize(previous);}catch{return {status:'previous_snapshot_unavailable',count:0,target:null};}
    let start=0;
    if(old.boundary) {
      const found=c.items.map((row,i)=>key(row)===key(old.boundary)?i:-1).filter(i=>i>=0);
      if(found.length!==1)return {status:found.length?'previous_boundary_ambiguous':'previous_boundary_unavailable',count:0,target:null};
      if(c.availability(c.items[found[0]]))return {status:'previous_boundary_ambiguous',count:0,target:null};
      start=found[0]+1;
      if(start!==old.item_count)return {status:'previous_boundary_changed',count:0,target:null};
    }
    const count=c.items.length-start;
    if(!count)return {status:'unchanged',count:0,target:null};
    const problem=c.availability(c.items[start]);
    if(problem)return {status:problem==='item_identity_ambiguous'?'new_item_ambiguous':'new_item_unavailable',count,target:null};
    return {status:'new_items',count,target:boundary(c.items[start]),index:start};
  }
  function entry(v) {
    if(!record(v) || v.version!==VERSION || !Number.isSafeInteger(v.saved_at) || v.saved_at<0)throw Error('The previous original snapshot metadata is unavailable.');
    return {version:VERSION,owner:owner(v.owner),saved_at:v.saved_at,snapshot:normalize(v.snapshot)};
  }
  function create(storage,{now=()=>Date.now()}={}) {
    function all() {
      const raw=storage.getItem(STORAGE_KEY);
      if(raw===null)return [];
      if(typeof raw!=='string' || raw.length>LIMITS.characters)throw Error('Previous original snapshots are unavailable.');
      const parsed=JSON.parse(raw);
      if(!record(parsed) || parsed.version!==VERSION || !Array.isArray(parsed.snapshots) || parsed.snapshots.length>LIMITS.owners)throw Error('Previous original snapshots are unavailable.');
      const rows=parsed.snapshots.map(entry),seen=new Set();
      for(const row of rows){const k=ownerKey(row.owner);if(seen.has(k))throw Error('Previous original snapshot owner is ambiguous.');seen.add(k);}
      return rows;
    }
    function get(value) {
      const current=owner(value),saved=all().find(row=>ownerKey(row.owner)===ownerKey(current));
      return saved?saved.snapshot:null;
    }
    function put(value,view) {
      const current=owner(value),next=entry({version:VERSION,owner:current,snapshot:view,saved_at:now()});
      let rows;try{rows=all();}catch{rows=[];}
      rows=[next,...rows.filter(row=>ownerKey(row.owner)!==ownerKey(current))].sort((a,b)=>b.saved_at-a.saved_at).slice(0,LIMITS.owners);
      const body=JSON.stringify({version:VERSION,snapshots:rows});
      if(body.length>LIMITS.characters)throw Error('Previous original snapshot metadata is too large.');
      storage.setItem(STORAGE_KEY,body);return next.snapshot;
    }
    return {get,put};
  }
  const api={VERSION,STORAGE_KEY,LIMITS,owner,snapshot,resolve,create};root.DeskOriginalFrontier=api;
  if(typeof module!=='undefined' && module.exports)module.exports=api;
})(typeof globalThis==='undefined'?this:globalThis);
