/* Submitted literal preparation lookup keeps current editors and exact owners. */
(function(root){
  'use strict';
  const copy=value=>JSON.parse(JSON.stringify(value));
  const controls={session:'review',draft:'draft',followup:'followup',reservation:'reservation',turn_request:'turn_request'};
  function matches(row,hit){
    if(!row || row.id!==hit.session_id || controls[hit.kind]!==hit.control ||
      typeof hit.snippet!=='string' || typeof hit.match_text!=='string' || !hit.match_text)return false;
    let source;
    if(hit.kind==='session')return typeof row.name==='string' && row.name.includes(hit.match_text);
    if(hit.kind==='draft')source=row.draft;
    if(hit.kind==='followup')source=row.followups?.entries?.find(entry=>entry.id===hit.followup_id);
    if(hit.kind==='reservation'){
      source=row.followups?.reservation;
      if(source?.token!==hit.token || source?.entry_id!==hit.followup_id)return false;
    }
    if(hit.kind==='turn_request')return row.turn_request?.token===hit.token &&
      row.turn_request.mode===hit.mode && row.turn_request.status===hit.state;
    return !!source && source.revision===hit.revision && source.mode===hit.mode &&
      (hit.kind==='draft' || source.state===hit.state) && typeof source.text==='string' && source.text.includes(hit.match_text);
  }
  function page(data,query,offset){
    if(!data || !Array.isArray(data.sessions) || !data.lookup || data.lookup.q!==query.trim() ||
      data.lookup.offset!==offset || !Number.isSafeInteger(data.lookup.total) || data.lookup.total<0 ||
      data.lookup.limit!==30 || typeof data.lookup.has_more!=='boolean' ||
      !Array.isArray(data.lookup.results) || data.lookup.results.length>30 ||
      data.lookup.results.length>Math.max(0,data.lookup.total-offset) ||
      data.lookup.has_more!==(offset+30<data.lookup.total))throw Error('The saved-work lookup did not confirm this submitted phrase.');
    const owners=new Map(data.sessions.map(row=>[row.id,row]));
    if(owners.size!==data.sessions.length)throw Error('Saved-work owner identity is ambiguous.');
    for(const hit of data.lookup.results){
      if(!matches(owners.get(hit.session_id),hit))throw Error('The saved-work match is no longer current. Choose Search again.');
    }
    return copy(data);
  }
  function create(options){
    let generation=0,active=null;
    const scope=()=>{const value=options.current();return {open:!!value.open,q:value.q ?? '',cwd:value.cwd || '',archived:!!value.archived,owner:value.owner};};
    const same=(a,b)=>a.open && b.open && a.q===b.q && a.cwd===b.cwd && a.archived===b.archived && a.owner===b.owner;
    const valid=task=>active===task && generation===task.generation && same(task.scope,scope());
    const paint=()=>options.onState?.(active?copy({scope:active.scope,pending:active.pending,offset:active.offset,data:active.data,error:active.error}):null);
    function invalidate(){active=null;++generation;paint();}
    async function search(offset=0){
      const submitted=scope();if(!submitted.open)return false;
      if(typeof submitted.q!=='string' || !Number.isSafeInteger(offset) || offset<0)throw Error('Choose the submitted phrase and saved-work page.');
      const task={scope:submitted,generation:++generation,pending:true,offset,data:null,error:null};active=task;paint();
      const params=new URLSearchParams({q:submitted.q,archived:String(submitted.archived),limit:'30',offset:String(offset)});if(submitted.cwd)params.set('cwd',submitted.cwd);
      try{
        const response=await options.api('/api/preparation?'+params);
        if(!valid(task))return false;
        const data=page(response,submitted.q,offset);
        if(await options.onResults?.(copy(data),()=>valid(task))===false || !valid(task))return false;
        task.data=data;return true;
      }catch(error){if(valid(task)){task.error=error.message;options.onError?.(error);}return false;}
      finally{if(valid(task)){task.pending=false;paint();}}
    }
    async function select(index){
      const task=active;if(!task || task.pending || !valid(task) || !task.data)return false;
      if(!Number.isSafeInteger(index) || index<0 || index>=task.data.lookup.results.length)return false;
      const match=copy(task.data.lookup.results[index]);
      // The owner presenter must reread exact revision/token before enabling any
      // mutable control. A late lookup/selection never changes a newer owner.
      return await options.reviewMatch(match,{valid:()=>valid(task),owner:copy(task.scope),onReturn:()=>{if(valid(task))options.onReturn?.(copy(task.data),index);}})!==false && valid(task);
    }
    return {search,select,invalidate,state:()=>active?copy({scope:active.scope,pending:active.pending,offset:active.offset,data:active.data,error:active.error}):null};
  }
  root.DeskPreparationFind={create,page,matches};
  if(typeof module!=='undefined')module.exports=root.DeskPreparationFind;
})(typeof globalThis==='undefined'?this:globalThis);
