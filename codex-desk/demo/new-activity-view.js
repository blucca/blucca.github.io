/* Selected-task review controls; rendering, fetching and review have distinct owners. */
(function(root) {
  'use strict';
  let env,store,home=null,catalog=null,notice='',namespaceState='pending';
  const batches=new Map(),accepted=new WeakSet(),listeners=new Set();
  const identity=value=>JSON.stringify([value.native_home,value.session,value.thread_id]);
  const same=(a,b)=>a && b && a.session===b.session && a.thread_id===b.thread_id && a.generation===b.generation;
  function selection(){return env.selection();}
  function current(context){return same(selection(),context) && selection().ready;}
  function owner(){const value=selection();return home && value.session && value.thread_id?{native_home:home,session:value.session,thread_id:value.thread_id}:null;}
  function pending(){const value=owner();return value && batches.has(identity(value))?store.pending(value,batches.get(identity(value))):null;}
  function sync() {
    if(!env)return;const value=selection(),result=pending();
    env.$('native-activity-review').hidden=!value.session;
    const fresh=!!catalog && same(catalog.context,value);
    env.$('native-activity-first').disabled=env.$('native-activity-mark').disabled=!value.ready || !fresh || !result?.first;
    env.$('native-activity-status').textContent=notice || (!value.ready?'Load this saved task to review native activity.':
      namespaceState==='unavailable'?'Native home unavailable; activity review is not available.':
      !result || result.status==='baseline_missing'?'Native activity review baseline is not available yet.':
      !fresh?'Fresh native source unavailable; activity review is not available.':
      result.first?'New native activity since review.':'No new recorded native activity since review.');
  }
  function leave(){catalog=null;notice='';sync();}
  function source(thread,context) {
    if(!same(selection(),context) || thread?.id!==context.thread_id || !Array.isArray(thread.turns))return;
    catalog={context:{...context},turn_ids:[],items:[]};
    for(const turn of thread.turns)if(typeof turn?.id==='string') {
      catalog.turn_ids.push(turn.id);
      for(const item of turn.items || [])if(typeof item?.id==='string')catalog.items.push({turn_id:turn.id,item_id:item.id,item_type:item.type});
    }
  }
  function accept(event){if(env && (event.method!=='item/plan/delta' || env.planDeltaAccepted(event)))accepted.add(event);}
  async function observe(rows,{replay=false}={}) {
    const context={...selection()};if(!context.session || !context.thread_id)return;
    const namespace=home || await env.home();if(!current(context))return;
    if(!namespace){namespaceState='unavailable';sync();return;}
    home=namespace;namespaceState='available';const value=owner(),batch=root.DeskNewActivity.capture(value,rows,row=>accepted.has(row.event));
    const seeded=store.seed(value,batch);
    const key=identity(value),reviewed=store.get(value).reviewed_seq;
    batches.set(key,root.DeskNewActivity.merge(value,reviewed,batches.get(key),batch));
    if(batches.size>root.DeskNewActivity.LIMITS.owners)batches.delete(batches.keys().next().value);
    if(!replay && catalog && same(catalog.context,context))for(const update of batch.updates) {
      if(!catalog.turn_ids.includes(update.turn_id))catalog.turn_ids.push(update.turn_id);
      if(!catalog.items.some(item=>item.turn_id===update.turn_id && item.item_id===update.item_id))
        catalog.items.push({turn_id:update.turn_id,item_id:update.item_id,item_type:update.item_type});
    }
    notice='';sync();if(seeded.status!=='baseline_exists')notifyReview();
  }
  function resolve(target) {
    const value=owner();if(!catalog || !same(catalog.context,selection()))return {available:false,status:'source_unavailable'};
    const result=root.DeskNewActivity.resolveTarget(value,target,{...value,...catalog});
    if(result.available && !env.targetRendered(target))return {available:false,status:'item_not_rendered'};
    return result;
  }
  function readFirst() {
    const context=selection(),target=pending()?.first;if(!context.ready || !target)return false;
    const result=resolve(target);
    if(!result.available){notice='First new native activity unavailable in this source · '+result.status;sync();return false;}
    env.reveal(target);notice='Showing the first new native activity. It is not marked reviewed.';sync();return true;
  }
  function snapshot() {
    const context={...selection()},value=owner(),result=pending();
    if(!context.ready || !value || !result?.first)return null;
    if(result.targets.some(target=>!resolve(target).available)){notice='New native activity is unavailable in this source.';sync();return null;}
    return Object.freeze({context:Object.freeze(context),owner:Object.freeze(value),batch:batches.get(identity(value))});
  }
  function review(capture) {
    if(!capture || !current(capture.context) || identity(owner())!==identity(capture.owner))return false;
    const result=store.pending(capture.owner,capture.batch);
    if(result.targets.some(target=>!resolve(target).available))return false;
    const before=store.get(capture.owner)?.reviewed_seq;store.mark(capture.owner,capture.batch);
    const key=identity(capture.owner),reviewed=store.get(capture.owner).reviewed_seq;
    batches.set(key,root.DeskNewActivity.merge(capture.owner,reviewed,batches.get(key)));
    notice='';sync();if(reviewed!==before)notifyReview();return true;
  }
  function reviewLatest(capture) {
    const intent=env.readingIntent();
    env.frame(()=>{if(current(capture?.context) && intent===env.readingIntent() && env.latestVisible())review(capture);});
  }
  function configure(options) {
    env=options;let storage;try{storage=typeof env.storage==='function'?env.storage():env.storage;}catch{}
    store=root.DeskNewActivity.create(storage);
    env.$('native-activity-first').onclick=readFirst;
    env.$('native-activity-mark').onclick=()=>review(snapshot());sync();
  }
  function reviewMetadata() {
    return {native_home:home,reviews:(store?.read().reviews || []).map(row=>({owner:{...row.owner},reviewed_seq:row.reviewed_seq}))};
  }
  function subscribe(listener) {
    if(typeof listener!=='function')throw Error('Use a review metadata listener.');
    listeners.add(listener);return ()=>listeners.delete(listener);
  }
  function notifyReview() {for(const listener of listeners)listener(reviewMetadata());}
  function state() {
    const value=owner(),result=pending(),batch=value && batches.get(identity(value));
    return {owner:value,generation:selection().generation,reviewed_seq:value?store.get(value)?.reviewed_seq ?? null:null,
      status:result?.status || 'baseline_missing',first:result?.first || null,frontier:batch?.frontier || 0,
      received_seq:batch?.received_seq || 0,source:result?.first?resolve(result.first).status:catalog?'available':'source_unavailable'};
  }
  root.DeskNewActivityView={configure,sync,leave,source,accept,observe,readFirst,snapshot,reviewLatest,reviewMetadata,subscribe,state};
})(typeof globalThis==='undefined'?this:globalThis);
