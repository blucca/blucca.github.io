/* One deliberate linked-agent original read, with its exact parent return owner. */
(function(root){
  'use strict';
  function create(env){
    let active=null,epoch=0;
    const same=(a,b)=>a && b && ['native_home','session','thread_id','turn_id','item_id'].every(key=>a[key]===b[key]);
    function valid(request){return active===request && request.epoch===epoch && env.generation()===request.generation &&
      same(env.owner(),request.target.owner) && (request.showing || env.readingIntent()===request.intent);}
    function state(){return {pending:!!active?.pending,failed:!!active?.failed,target:active?.target || null};}
    function sync(){env.sync?.(state());}
    function returnParent(request){
      if(!valid(request))return false;
      ++epoch;active=null;sync();env.returnParent(request.parent,{target:request.target,generation:request.generation});return true;
    }
    async function load(request){
      if(!valid(request))throw Error('The captured parent reading intent changed.');
      const before=root.DeskLinkedAgent.resolveParent(env.owner(),request.target,env.parentSource());
      if(!before.available)throw Error('Linked agent source unavailable · '+before.status);
      const source=await env.api('/api/native/evidence-source?home='+encodeURIComponent(request.target.owner.native_home)+'&thread='+encodeURIComponent(request.target.child_thread_id));
      if(!valid(request))throw Error('The captured parent reading intent changed.');
      const after=root.DeskLinkedAgent.resolveParent(env.owner(),request.target,env.parentSource());
      if(!after.available)throw Error('Linked agent source unavailable · '+after.status);
      const resolved=root.DeskLinkedAgent.resolveOriginal(request.target,{native_home:source?.home_namespace,thread:source?.thread});
      if(!resolved.available)throw Error('Linked agent source unavailable · '+resolved.status);
      return source;
    }
    async function read(request){
      if(!valid(request))return false;
      const relationship=root.DeskLinkedAgent.resolveParent(env.owner(),request.target,env.parentSource());
      if(!relationship.available){request.failed=true;request.pending=false;env.notice('Linked agent source unavailable · '+relationship.status);sync();return false;}
      request.pending=true;request.failed=false;env.notice('Reading the linked agent original…');sync();
      try{
        const source=await load(request);
        if(!valid(request))return false;
        request.pending=false;request.showing=true;sync();
        return await env.reader.show({thread_id:source.thread.id,cwd:source.thread.cwd},
          {preloadedThread:source.thread,loadOriginal:async()=>{const fresh=await load(request);return fresh.thread;},valid:()=>valid(request),backLabel:'Return to parent activity',onReturn:()=>returnParent(request)});
      }catch(error){
        if(valid(request)){request.pending=false;request.failed=true;request.showing=false;env.notice(error.message);sync();}
        return false;
      }
    }
    async function open(target){
      const resolved=root.DeskLinkedAgent.resolveParent(env.owner(),target,env.parentSource());
      if(!resolved.available){env.notice('Linked agent source unavailable · '+resolved.status);return false;}
      const parent=env.captureParent();if(!parent){env.notice('The parent reading place is unavailable.');return false;}
      env.beginRead?.();
      const request={target:resolved.target,parent,generation:env.generation(),intent:env.readingIntent(),epoch:++epoch,pending:false,failed:false};
      active=request;return read(request);
    }
    async function retry(){
      const request=active;
      if(!request?.failed || env.generation()!==request.generation || !same(env.owner(),request.target.owner))return false;
      env.beginRead?.();request.intent=env.readingIntent();request.epoch=++epoch;
      return read(request);
    }
    function close(){++epoch;active=null;sync();}
    return {open,retry,close,state};
  }
  const api={create};root.DeskLinkedAgentRead=api;
  if(typeof module!=='undefined' && module.exports)module.exports=api;
})(typeof globalThis==='undefined'?this:globalThis);
