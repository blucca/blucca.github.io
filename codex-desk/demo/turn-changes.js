/* Latest native turn-level diff, projected from the selected task's event log. */
const DeskTurnChanges = (() => {
  const terminalLabels={completed:'Task completed',interrupted:'Task interrupted',failed:'Task failed'};
  let context=null,turn=null,terminal=null,diff=null,retired=new Set(),view=null,copySequence=0;
  function same(value){return !!context && value?.session===context.session && value?.thread===context.thread && value?.generation===context.generation;}
  function valid(value){return same(value) && !!context.session && !!context.thread;}
  function text(node,value){if(node.textContent!==value)node.textContent=value;}
  function state(){return {context:context && {...context},turn,terminal,diff};}
  function paint(){
    if(!view)return;
    const visible=typeof diff==='string' && diff.length>0;
    view.disclosure.hidden=!visible;view.copy.disabled=!visible;
    text(view.summary,visible?(terminalLabels[terminal] || 'Latest reported diff'):'');
    text(view.status,visible?(terminalLabels[terminal] || 'Task in progress'):'');
    const top=view.body.scrollTop,left=view.body.scrollLeft;
    text(view.body,diff || '');view.body.scrollTop=top;view.body.scrollLeft=left;
  }
  function configure({$,writeText}){
    view={disclosure:$('turn-changes'),summary:$('turn-changes-summary'),status:$('turn-changes-status'),
      body:$('turn-changes-body'),copy:$('turn-changes-copy'),message:$('turn-changes-message'),writeText};
    view.copy.onclick=async()=>{
      if(!diff)return;
      const captured=diff,owner=context && {...context},nativeTurn=turn,sequence=++copySequence;
      text(view.message,'Copying diff…');
      try{
        await view.writeText(captured);
        if(same(owner) && turn===nativeTurn && diff===captured && sequence===copySequence)text(view.message,'Complete diff copied.');
      }catch(error){
        if(same(owner) && turn===nativeTurn && diff===captured && sequence===copySequence)text(view.message,'Copy failed: '+error.message);
      }
    };
    paint();
  }
  function changed(){++copySequence;if(view)text(view.message,'');}
  function select(value){
    if(same(value))return;
    context={session:value.session,thread:value.thread,generation:value.generation};
    turn=null;terminal=null;diff=null;retired=new Set();changed();
    if(view){view.disclosure.open=false;view.body.scrollTop=0;view.body.scrollLeft=0;}
    paint();
  }
  function start(id){
    if(typeof id!=='string' || !id || id===turn || retired.has(id))return false;
    const visible=!!diff;if(turn)retired.add(turn);
    turn=id;terminal=null;diff=null;changed();paint();return visible;
  }
  function finish(status){
    if(!Object.hasOwn(terminalLabels,status) || terminal)return false;
    terminal=status;retired.add(turn);paint();return !!diff;
  }
  function consume(message,value){
    if(!valid(value) || !message || message.id!==undefined)return false;
    const p=message.params || {},thread=p.threadId || p.thread?.id || p.turn?.threadId;
    if(thread && thread!==context.thread)return false;
    const id=typeof p.turnId==='string'?p.turnId:p.turn?.id;
    if(message.method==='turn/started')return start(id);
    if(!id || id!==turn)return false;
    if(message.method==='turn/completed')return finish(p.turn?.status);
    if(message.method!=='turn/diff/updated' || terminal || retired.has(id) || typeof p.diff!=='string')return false;
    if(p.diff===diff)return false;
    const visible=!!diff || !!p.diff;diff=p.diff;changed();paint();return visible;
  }
  function sync(session,value){
    if(!valid(value) || session?.id!==context.session || (session.thread_id && session.thread_id!==context.thread) || !turn)return false;
    return finish(session.status);
  }
  function restoreThread(thread,value){
    if(!valid(value) || thread?.id!==context.thread)return;
    const turns=Array.isArray(thread.turns)?thread.turns:[],latest=turns.at(-1);
    if(!latest?.id)return;
    if(latest.id!==turn && (!turn || turns.some(entry=>entry.id===turn)) && !retired.has(latest.id))start(latest.id);
    if(latest.id===turn && !terminal)finish(latest.status);
  }
  return {configure,select,consume,sync,restoreThread,state};
})();
