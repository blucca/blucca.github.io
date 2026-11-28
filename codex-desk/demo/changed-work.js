/* Quiet saved-owner material projection; no fetch, DOM, storage or review writes. */
(function(root) {
  'use strict';
  const VERSION=1,LIMITS=Object.freeze({tasks:5000,summaries:5000,reviews:100,page:100});
  const activityStatuses=new Set(['new_activity','up_to_date','baseline_missing','summary_unavailable','binding_unavailable']);
  const summaryStatuses=new Set(['available','read_failed','summary_ambiguous','thread_mismatch','home_mismatch','not_reported','binding_unavailable']);
  const itemTypes=new Set(['userMessage','agentMessage','plan','commandExecution','fileChange','mcpToolCall','dynamicToolCall','collabAgentToolCall','subAgentActivity']);
  const record=value=>value!==null && typeof value==='object' && !Array.isArray(value);
  const id=value=>{if(typeof value!=='string' || !value.trim() || Array.from(value).length>200)throw Error('Use the saved source identity.');return value;};
  const seq=value=>{if(!Number.isSafeInteger(value) || value<0)throw Error('Use the recorded material sequence.');return value;};
  const home=value=>{if(typeof value!=='string' || !/^[a-f0-9]{64}$/.test(value))throw Error('Use the cached native home namespace.');return value;};
  const owner=value=>{if(!record(value))throw Error('Use the exact saved native owner.');return {native_home:home(value.native_home),session:id(value.session),thread_id:id(value.thread_id)};};
  const ownerKey=value=>JSON.stringify([value.native_home,value.session,value.thread_id]);
  const compare=(a,b)=>a<b?-1:a>b?1:0;
  function mismatch(a,b) {
    for(const [field,status] of [['native_home','home_mismatch'],['session','session_mismatch'],['thread_id','thread_mismatch']])if(a[field]!==b[field])return status;
    return null;
  }
  function freeze(value) {
    if(value && typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}
    return value;
  }
  function list(value,limit,label) {
    if(!Array.isArray(value) || value.length>limit)throw Error('Use the bounded '+label+' metadata.');return value;
  }
  function summary(value) {
    if(!record(value))throw Error('Use compact recorded material metadata.');
    const identity=owner(value.owner);
    if(value.status==='unavailable')return {owner:identity,status:'read_failed',received_seq:null,material_seq:null};
    if(value.status!=='available')throw Error('Report material summary availability explicitly.');
    const received=seq(value.received_seq),material=seq(value.material_seq);
    if(material>received)throw Error('Material cannot exceed the recorded transport frontier.');
    return {owner:identity,status:'available',received_seq:received,material_seq:material};
  }
  function options(value={}) {
    if(!record(value))throw Error('Use the changed-work view options.');
    const mode=value.mode ?? 'changed',limit=value.limit ?? 30,offset=value.offset ?? 0;
    if(!['changed','all'].includes(mode) || !Number.isSafeInteger(limit) || limit<1 || limit>LIMITS.page || !Number.isSafeInteger(offset) || offset<0)throw Error('Choose a bounded changed-work page.');
    const group_id=value.group_id===undefined || value.group_id===null?null:id(value.group_id);
    const query=value.query_sessions===undefined || value.query_sessions===null?null:new Set(list(value.query_sessions,LIMITS.tasks,'title-filter source IDs').map(id));
    if(value.show_archived!==undefined && typeof value.show_archived!=='boolean')throw Error('Choose the existing archive visibility.');
    return {mode,limit,offset,group_id,query,show_archived:value.show_archived ?? false};
  }
  function rowCompare(a,b) {
    const section=row=>row.active?0:row.archived?2:1;
    const rank={new_activity:0,baseline_missing:1,summary_unavailable:2,binding_unavailable:3,up_to_date:4};
    return section(a)-section(b) || rank[a.activity_status]-rank[b.activity_status] ||
      (b.material_seq ?? -1)-(a.material_seq ?? -1) || compare(a.session,b.session);
  }
  function project(value,settings={}) {
    if(!record(value))throw Error('Use the saved-work projection inputs.');
    const native_home=home(value.native_home),view=options(settings),byOwner=new Map(),bySession=new Map(),reviews=new Map();
    for(const raw of list(value.summaries,LIMITS.summaries,'recorded material summaries')) {
      const current=summary(raw),key=ownerKey(current.owner);
      if(byOwner.has(key))byOwner.set(key,{owner:current.owner,status:'summary_ambiguous',received_seq:null,material_seq:null});
      else byOwner.set(key,current);
      if(!bySession.has(current.owner.session))bySession.set(current.owner.session,[]);
      bySession.get(current.owner.session).push(current);
    }
    for(const raw of list(value.reviews,LIMITS.reviews,'review boundaries')) {
      const current=owner(raw?.owner),reviewed=seq(raw.reviewed_seq),key=ownerKey(current);
      reviews.set(key,Math.max(reviewed,reviews.get(key) ?? 0));
    }
    const rows=[],seen=new Set();
    for(const task of list(value.tasks,LIMITS.tasks,'saved tasks')) {
      if(!record(task) || typeof task.active!=='boolean' || typeof task.archived!=='boolean')throw Error('Supply the saved task visibility separately.');
      const session=id(task.session),group_id=id(task.group_id),thread_id=task.thread_id===null?null:id(task.thread_id);
      if(seen.has(session))throw Error('The saved session binding is ambiguous.');seen.add(session);
      const current=thread_id===null?null:{native_home,session,thread_id},key=current?ownerKey(current):JSON.stringify([native_home,session,null]);
      let material= current?byOwner.get(key):null;
      if(!material && current) {
        const related=bySession.get(session) || [];
        const changed=related.some(other=>other.owner.native_home===native_home)?'thread_mismatch':related.length?'home_mismatch':'not_reported';
        material={owner:current,status:changed,received_seq:null,material_seq:null};
      }
      const reviewed=current?reviews.get(key) ?? null:null;
      const activity_status=!current?'binding_unavailable':material.status!=='available'?'summary_unavailable':reviewed===null?'baseline_missing':material.material_seq>reviewed?'new_activity':'up_to_date';
      const row={key,session,group_id,owner:current,active:task.active,archived:task.archived,
        section:task.active?'active':task.archived?'archived':'recent',
        summary_status:current?material.status:'binding_unavailable',review_status:reviewed===null?'missing':'available',
        reviewed_seq:reviewed,received_seq:material?.received_seq ?? null,material_seq:material?.material_seq ?? null,
        activity_status,changed:activity_status==='new_activity'?true:activity_status==='up_to_date'?false:null,
        fresh_source_status:'not_read',first_new_status:'not_requested'};
      // An explicit project scope applies to all rows. Existing sidebar title/
      // archive filtering never hides active work, including archived active work.
      if(view.group_id!==null && group_id!==view.group_id)continue;
      if(!row.active && ((!view.show_archived && row.archived) || (view.query!==null && !view.query.has(session))))continue;
      rows.push(row);
    }
    const counts={new_activity:0,up_to_date:0,baseline_missing:0,summary_unavailable:0,binding_unavailable:0,review_baseline_missing:0};
    for(const row of rows){++counts[row.activity_status];if(row.review_status==='missing')++counts.review_baseline_missing;}
    const visible=rows.filter(row=>view.mode==='all' || row.active || row.activity_status==='new_activity');
    const groups=new Map();
    for(const row of visible) {
      if(!groups.has(row.group_id))groups.set(row.group_id,{group_id:row.group_id,active:false,new_material_seq:0,rows:[]});
      const group=groups.get(row.group_id);group.active ||= row.active;
      if(row.changed)group.new_material_seq=Math.max(group.new_material_seq,row.material_seq);
      group.rows.push(row);
    }
    const ordered=[...groups.values()].sort((a,b)=>Number(b.active)-Number(a.active) || b.new_material_seq-a.new_material_seq || compare(a.group_id,b.group_id));
    let total=0;const page=[];
    for(const group of ordered) {
      group.rows.sort(rowCompare);const begin=total,end=begin+group.rows.length;total=end;
      const start=Math.max(0,view.offset-begin),stop=Math.min(group.rows.length,view.offset+view.limit-begin);
      if(stop>start)page.push({group_id:group.group_id,active:group.active,new_material_seq:group.new_material_seq,
        continued_before:start>0,continued_after:stop<group.rows.length,rows:group.rows.slice(start,stop)});
    }
    return freeze({version:VERSION,native_home,mode:view.mode,offset:view.offset,limit:view.limit,scope_tasks:rows.length,
      total_tasks:total,total_groups:ordered.length,has_more:view.offset+view.limit<total,counts,groups:page});
  }
  function target(value) {
    if(!record(value))throw Error('Use the captured first-new source identity.');
    const first=seq(value.first_seq),last=seq(value.last_seq);
    if(first<1 || last<first || !itemTypes.has(value.item_type))throw Error('Use the exact captured first-new sequence and item type.');
    return {owner:owner(value.owner),turn_id:id(value.turn_id),item_id:id(value.item_id),item_type:id(value.item_type),first_seq:first,last_seq:last};
  }
  function resolveFresh(row,batch,source,activity=root.DeskNewActivity) {
    if(!record(row) || !row.owner)throw Error('Choose an exact saved native row.');
    const current=owner(row.owner),reviewed=row.reviewed_seq===null?null:seq(row.reviewed_seq);
    const material=row.material_seq===null?null:seq(row.material_seq);
    if(!activityStatuses.has(row.activity_status) || !summaryStatuses.has(row.summary_status) ||
       (row.summary_status==='available' && material===null) ||
       row.changed!==(row.activity_status==='new_activity'?true:row.activity_status==='up_to_date'?false:null))throw Error('Use the captured overview row metadata.');
    const result={owner:current,reviewed_seq:reviewed,observed_material_seq:material,
      received_seq:null,rendered_frontier:null,activity_status:row.activity_status,
      fresh_source_status:'not_read',source_owner:null,
      first_new:{available:false,status:'not_requested',pending_target:null,target:null}};
    const finish=status=>{result.first_new.status=status;return freeze(result);};
    if(row.summary_status!=='available')return finish('summary_unavailable');
    if(reviewed===null)return finish('baseline_missing');
    if(!activity || typeof activity.pending!=='function' || typeof activity.resolveTarget!=='function')throw Error('Supply the pure parent-native activity helper.');
    const pending=activity.pending(current,batch,reviewed);
    result.received_seq=seq(batch.received_seq);result.rendered_frontier=seq(batch.frontier);
    if(result.received_seq<seq(row.material_seq))return finish('events_stale');
    if(!pending.first)return finish(row.changed?'material_not_located':'up_to_date');
    const captured=target(pending.first);result.activity_status='new_activity';result.first_new.pending_target=captured;
    if(source===null || source===undefined)return finish('source_not_read');
    let supplied;try{supplied=owner(source);}catch{result.fresh_source_status='owner_unavailable';return finish('owner_unavailable');}
    result.source_owner=supplied;const changed=mismatch(current,supplied);
    if(changed){result.fresh_source_status=changed;return finish(changed);}
    const kinds={not_read:'not_read',receipt_only:'receipt_only',read_failed:'read_failed',fresh_native:'fresh'};
    if(!Object.hasOwn(kinds,source.kind))throw Error('Distinguish a fresh native source from recorded event replay.');
    result.fresh_source_status=kinds[source.kind];
    if(source.kind!=='fresh_native')return finish(({not_read:'source_not_read',receipt_only:'source_not_fresh',read_failed:'source_read_failed'})[source.kind]);
    const resolution=activity.resolveTarget(current,captured,source);
    const statuses=new Set(['available','owner_unavailable','home_mismatch','session_mismatch','thread_mismatch','invalid_target','source_unavailable',
      'turn_ambiguous','turn_unavailable','item_ambiguous','item_unavailable','item_type_changed']);
    if(!record(resolution) || typeof resolution.available!=='boolean' || !statuses.has(resolution.status) || (resolution.available!==(resolution.status==='available')))throw Error('Use the exact fresh-source resolution result.');
    if(resolution.status==='source_unavailable')result.fresh_source_status='catalog_unavailable';
    if(resolution.available) {
      const resolved=target(resolution.target);
      if(ownerKey(resolved.owner)!==ownerKey(captured.owner) || ['turn_id','item_id','item_type','first_seq','last_seq'].some(key=>resolved[key]!==captured[key]))throw Error('A resolved source cannot replace the captured target.');
      result.first_new.available=true;result.first_new.target=resolved;
    }
    return finish(resolution.status);
  }
  const api={VERSION,LIMITS,project,resolveFresh};root.DeskChangedWork=api;
  if(typeof module!=='undefined' && module.exports)module.exports=api;
})(typeof globalThis==='undefined'?this:globalThis);
