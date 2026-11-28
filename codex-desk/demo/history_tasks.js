/* Exact task context within one already supplied native original. */
(function(root) {
  'use strict';
  const record=value=>value!==null && typeof value==='object' && !Array.isArray(value);
  const validId=value=>typeof value==='string' && !!value.trim() && Array.from(value).length<=200;
  const source='native history read';
  function fail(code,message) {const error=new Error(message);error.code=code;throw error;}
  function identifier(value) {
    if(!validId(value))fail('invalid_capture','Use the captured native thread, turn and item IDs');
    return value;
  }
  function supplied(thread,threadId) {
    identifier(threadId);
    if(!record(thread) || thread.id!==threadId)fail('thread_mismatch','Native original does not match the captured parent thread');
    if(!Array.isArray(thread.turns))fail('turns_unavailable','Native original did not supply its turns');
    return thread.turns;
  }
  function metadata(threadId,turnId,turn=null) {
    return {thread_id:threadId,turn_id:turnId,available:false,
      turn_status:typeof turn?.status==='string'?turn.status:null,
      turn_error:turn?.error===undefined?null:turn.error,source};
  }
  function unavailable(result,reason) {return {...result,available:false,status:reason,reason};}
  function resolve(thread,capture) {
    const threadId=identifier(capture?.thread_id),turnId=identifier(capture?.turn_id);
    const turns=supplied(thread,threadId),matches=[];
    for(let index=0;index<turns.length;index++)if(record(turns[index]) && turns[index].id===turnId)matches.push({turn:turns[index],index});
    if(matches.length>1)fail('ambiguous_turn','Native original supplied an ambiguous captured turn');
    return {threadId,turnId,turns,...(matches[0] || {}),result:metadata(threadId,turnId,matches[0]?.turn)};
  }
  function countItems(items,id) {return items.filter(item=>record(item) && item.id===id).length;}
  function list(thread,threadId) {
    const turns=supplied(thread,threadId),counts=new Map();
    for(const turn of turns)if(record(turn) && validId(turn.id))counts.set(turn.id,(counts.get(turn.id) || 0)+1);
    const rows=[];
    for(let index=0;index<turns.length;index++) {
      const turn=turns[index];if(!record(turn))continue;
      const turnId=typeof turn.id==='string'?turn.id:null;
      const reason=!validId(turn.id)?'invalid_turn_id':counts.get(turn.id)!==1?'ambiguous_turn':null;
      rows.push({...metadata(threadId,turnId,turn),index,available:!reason,reason});
    }
    return rows;
  }
  function containing(thread,capture) {
    const itemId=identifier(capture?.item_id),context=resolve(thread,capture);
    const result={...context.result,item_id:itemId};
    if(!context.turn)return unavailable(result,'turn_unavailable');
    const items=Array.isArray(context.turn.items)?context.turn.items:[];
    const matches=[];
    for(let index=0;index<items.length;index++)if(record(items[index]) && items[index].id===itemId)matches.push(index);
    if(matches.length>1)fail('ambiguous_item','Native original supplied an ambiguous captured item');
    if(!matches.length)return unavailable(result,'item_unavailable');
    return {...result,index:context.index,item_index:matches[0],available:true,status:'available',reason:null};
  }
  function userText(item) {
    return (Array.isArray(item.content)?item.content:[])
      .filter(part=>record(part) && part.type==='text')
      .map(part=>typeof part.text==='string'?part.text:'').join('\n');
  }
  function textForItem(item) {return 'User\n'+userText(item);}
  function instructions(thread,capture,project=textForItem) {
    if(typeof project!=='function')throw new TypeError('Instruction text projection must be a function');
    const context=resolve(thread,capture),result={...context.result,items:[],user_message_count:0};
    if(!context.turn)return unavailable(result,'turn_unavailable');
    const items=Array.isArray(context.turn.items)?context.turn.items:[],counts=new Map();
    for(const item of items)if(record(item) && validId(item.id))counts.set(item.id,(counts.get(item.id) || 0)+1);
    for(let index=0;index<items.length;index++) {
      const item=items[index];if(!record(item) || item.type!=='userMessage')continue;
      ++result.user_message_count;
      const projected=project(item),text=typeof projected==='string'?projected:'';
      const reason=!validId(item.id)?'invalid_item_id':counts.get(item.id)!==1?'ambiguous_item':
        !userText(item).trim() || !text.trim()?'instruction_unavailable':null;
      result.items.push({thread_id:context.threadId,turn_id:context.turnId,
        item_id:typeof item.id==='string'?item.id:null,index,text,available:!reason,reason});
    }
    return result.items.some(item=>item.available)?{...result,available:true,status:'available',reason:null}:
      unavailable(result,'instruction_unavailable');
  }
  function adjacent(thread,capture,direction) {
    if(direction!==-1 && direction!==1)throw new TypeError('Task direction must be -1 or 1');
    const context=resolve(thread,capture);if(!context.turn)return null;
    const rows=list(thread,context.threadId),at=rows.findIndex(row=>row.index===context.index);
    return rows[at+direction] || null;
  }
  function response(thread,capture) {
    const context=resolve(thread,capture),result=context.result;
    if(!context.turn)return unavailable(result,'turn_unavailable');
    const items=context.turn.items;
    if(!Array.isArray(items))return unavailable(result,'response_unavailable');
    const messages=items.filter(item=>record(item) && item.type==='agentMessage' && validId(item.id) &&
      typeof item.text==='string' && !!item.text.trim());
    if(!messages.length)return unavailable(result,'response_unavailable');
    const final=messages.filter(item=>item.phase==='final_answer'),chosen=(final.length?final:messages).at(-1);
    if(countItems(items,chosen.id)!==1)fail('ambiguous_item','Native original supplied an ambiguous response item');
    const phase=typeof chosen.phase==='string'?chosen.phase:null;
    const labels=new Map([['final_answer','Final answer'],['commentary','Commentary'],['partial_answer','Partial answer']]);
    return {...result,status:'available',available:true,reason:null,item_id:chosen.id,phase,
      selection:final.length?'final_answer':'last_assistant_message',label:labels.get(phase) || 'Last assistant message'};
  }
  function search(thread,threadId,query,project=textForItem) {
    if(typeof query!=='string')throw new TypeError('Submitted instruction query must be a string');
    const rows=list(thread,threadId),find=root.DeskHistoryFind;
    if(!find?.normalize || !find?.spans)throw new Error('Instruction search requires DeskHistoryFind');
    const result={query,matches:[],total:0};if(!find.normalize(query))return result;
    for(const task of rows) {
      if(!task.available)continue;
      for(const item of instructions(thread,task,project).items) {
        if(!item.available)continue;
        const spans=find.spans(item.text,query);if(!spans.length)continue;
        result.matches.push({...item,turn_index:task.index,spans});result.total+=spans.length;
      }
    }
    return result;
  }
  const api={list,containing,instructions,adjacent,response,search,textForItem};
  root.DeskHistoryTasks=api;
  if(typeof module!=='undefined' && module.exports)module.exports=api;
})(typeof globalThis==='undefined'?this:globalThis);
