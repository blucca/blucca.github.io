/* Parent collaboration source links; fresh relationship metadata owns eligibility. */
(function(root){
  'use strict';
  let env,controller,catalog=null,activeTarget=null,notice='';const panels=new Map();
  const supported=new Set(['collabAgentToolCall','subAgentActivity']);
  const same=context=>context && env.binding()?.session===context.session && env.binding()?.thread_id===context.thread_id && env.generation()===context.generation;
  function strip(item){
    if(!item || typeof item!=='object' || Array.isArray(item))return item;
    const value={id:item.id,type:item.type};
    if(item.type==='subAgentActivity')value.agentThreadId=item.agentThreadId;
    if(item.type==='collabAgentToolCall'){
      value.receiverThreadIds=Array.isArray(item.receiverThreadIds)?item.receiverThreadIds.slice():[];
      value.agentsStates=item.agentsStates && typeof item.agentsStates==='object' && !Array.isArray(item.agentsStates)?
        Object.fromEntries(Object.keys(item.agentsStates).filter(key=>key!=='_meta').map(key=>[key,null])):{};
    }
    return value;
  }
  function parentSource(){return same(catalog?.context)?catalog.thread:null;}
  function owner(target=activeTarget){const binding=env.binding();return target && binding?{native_home:env.nativeHome(),...binding,
    turn_id:target.owner.turn_id,item_id:target.owner.item_id}:null;}
  function source(thread,context){
    if(!same(context) || thread?.id!==context.thread_id || !Array.isArray(thread.turns))return;
    catalog={context:{...context},thread:{id:thread.id,turns:thread.turns.map(turn=>({id:turn?.id,items:Array.isArray(turn?.items)?turn.items.map(strip):[]}))}};sync();
  }
  function event(message,{replay=false}={}){
    const p=message?.params;
    if(replay || !same(catalog?.context) || message.id!==undefined || p?.threadId!==catalog.thread.id ||
      !['item/started','item/completed'].includes(message.method) || typeof p.turnId!=='string' || !p.item || typeof p.item.id!=='string')return;
    let turns=catalog.thread.turns.filter(turn=>turn.id===p.turnId);if(turns.length>1)return;
    if(!turns.length){const turn={id:p.turnId,items:[]};catalog.thread.turns.push(turn);turns=[turn];}
    const entries=turns[0].items.filter(item=>item?.id===p.item.id);if(entries.length>1)return;
    if(entries.length)turns[0].items[turns[0].items.indexOf(entries[0])]=strip(p.item);else turns[0].items.push(strip(p.item));
  }
  function panelFor(node){
    let panel=panels.get(node.dataset.itemId);
    if(!panel || !panel.node.isConnected){
      const box=env.make('div','','activity-linked-agents'),links=env.make('div','','activity-linked-agent-links'),status=env.make('p','','linked-agent-status'),actions=env.make('div','','linked-agent-actions');
      status.setAttribute('role','status');
      const retry=env.make('button','Retry linked original','linked-agent-retry'),cancel=env.make('button','Cancel linked read','linked-agent-cancel');
      for(const button of [retry,cancel])button.type='button';
      retry.onclick=()=>controller.retry();cancel.onclick=()=>cancelRead();actions.append(retry,cancel);box.append(links,status,actions);node.append(box);
      panel={node:box,links,status,retry,cancel,signature:null};panels.set(node.dataset.itemId,panel);
    }
    return panel;
  }
  function cancelRead(){controller.close();activeTarget=null;notice='';sync();}
  function sync(){
    if(!env)return;const reading=controller.state(),fresh=parentSource();
    for(const [id,node] of env.nodes()){
      const item=env.item(id);if(!supported.has(item?.type))continue;
      const panel=panelFor(node),turn=env.itemTurn(id),value={native_home:env.nativeHome(),...env.binding(),turn_id:turn,item_id:id};
      const matches=fresh?.turns.filter(row=>row.id===turn) || [],nativeItems=matches.length===1?matches[0].items.filter(row=>row?.id===id):[];
      let targets=[],availability=!fresh?'Fresh parent native source unavailable.':!value.native_home?'Native home unavailable for linked original.':matches.length!==1?'Parent native turn unavailable in the fresh source.':nativeItems.length!==1?'Parent native item unavailable in the fresh source.':'No linked agent original was reported for this item.';
      if(value.native_home && nativeItems.length===1){try{const captured=root.DeskLinkedAgent.capture(value,nativeItems[0]);targets=captured.targets;
        if(targets.length)availability='';}catch{availability='The parent native item identity is unavailable.';}}
      const signature=JSON.stringify(targets);
      if(panel.signature!==signature){
        const focused=document.activeElement?.closest?.('.linked-agent-original'),child=panel.links.contains(focused)?focused.dataset.childThread:null;
        panel.links.replaceChildren();
        for(const target of targets){const button=env.make('button','Read linked agent original · '+target.child_thread_id,'linked-agent-original');button.type='button';button.dataset.childThread=target.child_thread_id;
          button.onclick=()=>{if(!env.ready() || !same(catalog?.context))return;activeTarget=target;notice='';controller.open(target);};panel.links.append(button);}
        panel.signature=signature;
        if(child)Array.from(panel.links.children).find(button=>button.dataset.childThread===child)?.focus({preventScroll:true});
      }
      const owned=reading.target?.owner.item_id===id && reading.target?.owner.turn_id===turn;
      for(const button of panel.links.children){const target=targets.find(target=>target.child_thread_id===button.dataset.childThread);
        button.disabled=!env.ready() || !target || !root.DeskLinkedAgent.resolveParent(value,target,fresh).available || (owned && reading.pending && reading.target.child_thread_id===target.child_thread_id);}
      panel.status.textContent=owned && notice?notice:availability;panel.status.hidden=!panel.status.textContent;
      panel.retry.hidden=!(owned && reading.failed);panel.cancel.hidden=!(owned && (reading.pending || reading.failed));
    }
  }
  function leave(){const reading=controller?.state();controller?.close();if(reading?.target && env.readerOpen())env.reader.close();catalog=null;activeTarget=null;notice='';panels.clear();}
  function configure(options){
    env=options;controller=root.DeskLinkedAgentRead.create({owner,generation:env.generation,parentSource,
      captureParent:()=>env.captureParent(activeTarget),readingIntent:env.readingIntent,beginRead:env.beginRead,api:env.api,reader:env.reader,
      returnParent:(view,context)=>{activeTarget=null;notice='';env.restoreParent(view,context);sync();},
      notice:text=>{notice=text;},sync:()=>sync()});sync();
  }
  root.DeskLinkedAgentView={configure,source,event,sync,leave,cancel:cancelRead,state:()=>({catalog:catalog?.thread || null,reading:controller?.state() || null})};
})(typeof globalThis==='undefined'?this:globalThis);
