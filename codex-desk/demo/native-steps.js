/* Selected-task progress is a projection of retained native events, not a draft. */
const DeskNativeSteps = (() => {
  const labels={pending:'Pending',inProgress:'In progress',completed:'Completed'};
  const terminalLabels={completed:'Task completed',interrupted:'Task interrupted',failed:'Task failed'};
  let context=null,turn=null,terminal=null,reported=null,retired=new Set(),view=null,rows=[];
  function same(value){return !!context && value?.session===context.session && value?.thread===context.thread && value?.generation===context.generation;}
  function valid(value){return same(value) && !!context.session && !!context.thread;}
  function text(node,value){if(node.textContent!==value)node.textContent=value;}
  function state(){return {context:context && {...context},turn,terminal,reported:reported && {explanation:reported.explanation,plan:reported.plan.map(entry=>({...entry}))}};}
  function paint(){
    if(!view)return;
    const visible=!!reported?.plan.length;
    view.disclosure.hidden=!visible;
    if(!visible){
      text(view.current,'');text(view.status,'');text(view.explanation,'');
      view.explanation.hidden=true;
      while(rows.length)rows.pop().node.remove();
      return;
    }
    const current=reported.plan.find(entry=>entry.status==='inProgress');
    const completed=reported.plan.filter(entry=>entry.status==='completed').length;
    text(view.current,terminal
      ? `${terminalLabels[terminal]} · Last reported steps`
      : current?`Current · ${current.step}`:`${completed} of ${reported.plan.length} steps completed`);
    text(view.status,terminalLabels[terminal] || 'Task in progress');
    view.explanation.hidden=!reported.explanation;
    text(view.explanation,reported.explanation || '');
    // Keep the disclosure, summary and scroll container mounted. No focus or
    // output scrolling is initiated by a native progress update.
    const top=view.body.scrollTop,left=view.body.scrollLeft;
    for(const [index,entry] of reported.plan.entries()){
      if(!rows[index]){
        const node=view.make('li'),step=view.make('span','','native-step-text'),status=view.make('span','','native-step-status');
        node.append(step,status);view.list.append(node);rows.push({node,step,status});
      }
      const row=rows[index];row.node.dataset.status=entry.status;
      text(row.step,entry.step);text(row.status,labels[entry.status]);
    }
    while(rows.length>reported.plan.length)rows.pop().node.remove();
    view.body.scrollTop=top;view.body.scrollLeft=left;
  }
  function configure({$,make}){
    view={disclosure:$('native-steps'),current:$('native-steps-current'),body:$('native-steps-body'),
      status:$('native-steps-status'),explanation:$('native-steps-explanation'),list:$('native-steps-list'),make};
    paint();
  }
  function select(value){
    if(same(value))return;
    context={session:value.session,thread:value.thread,generation:value.generation};
    turn=null;terminal=null;reported=null;retired=new Set();
    if(view){view.disclosure.open=false;view.body.scrollTop=0;view.body.scrollLeft=0;}
    paint();
  }
  function start(id){
    if(!id || id===turn || retired.has(id))return false;
    const visible=!!reported?.plan.length;
    if(turn)retired.add(turn);
    turn=id;terminal=null;reported=null;paint();return visible;
  }
  function finish(status){
    if(!terminalLabels[status] || terminal)return false;
    terminal=status;retired.add(turn);paint();return !!reported?.plan.length;
  }
  function consume(message,value){
    if(!valid(value) || !message || message.id!==undefined)return false;
    const p=message.params || {},thread=p.threadId || p.thread?.id || p.turn?.threadId;
    if(thread && thread!==context.thread)return false;
    const id=typeof p.turnId==='string'?p.turnId:p.turn?.id;
    if(message.method==='turn/started')return typeof id==='string'?start(id):false;
    if(!id || id!==turn)return false;
    if(message.method==='turn/completed')return finish(p.turn?.status);
    if(message.method!=='turn/plan/updated' || terminal || retired.has(id) || !Array.isArray(p.plan))return false;
    if(p.plan.some(entry=>!entry || typeof entry.step!=='string' || !Object.hasOwn(labels,entry.status)))return false;
    const next={explanation:typeof p.explanation==='string'?p.explanation:null,plan:p.plan.map(({step,status})=>({step,status}))};
    if(JSON.stringify(next)===JSON.stringify(reported))return false;
    const visible=!!reported?.plan.length || !!next.plan.length;
    reported=next;paint();return visible;
  }
  function sync(session,value){
    if(!valid(value) || session?.id!==context.session || (session.thread_id && session.thread_id!==context.thread) || !turn)return false;
    // A process exit can make the task terminal without a turn/completed event.
    // Keep every step exactly as it was last reported in either case.
    return finish(session.status);
  }
  function restoreThread(thread,value){
    if(!valid(value) || thread?.id!==context.thread)return;
    const turns=Array.isArray(thread.turns)?thread.turns:[],latest=turns.at(-1);
    if(!latest?.id)return;
    // An event fetched after /api/open may be newer than its native snapshot.
    if(latest.id!==turn && (!turn || turns.some(entry=>entry.id===turn)) && !retired.has(latest.id))start(latest.id);
    if(latest.id===turn && !terminal)finish(latest.status);
  }
  return {configure,select,consume,sync,restoreThread,state};
})();
