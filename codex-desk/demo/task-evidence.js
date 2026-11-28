/* A bounded index of one exact supplied task's original items. */
(function(root){
  'use strict';
  const record=value=>value!==null && typeof value==='object' && !Array.isArray(value);
  const id=value=>typeof value==='string' && !!value.trim() && Array.from(value).length<=200;
  const PAGE_ITEMS=20,PREVIEW_CHARS=180;
  function unavailable(base,reason){return {...base,available:false,status:reason,reason};}
  function list(thread,capture,project,readable){
    if(typeof project!=='function' || typeof readable!=='function')throw new TypeError('Use the original reader projection and readable item predicate');
    const tasks=root.DeskHistoryTasks;
    if(!tasks?.list)throw Error('Task evidence requires the supplied task selector');
    if(!id(capture?.turn_id))throw Error('Use the captured native task identity');
    const taskRows=tasks.list(thread,capture.thread_id),task=taskRows.find(row=>row.turn_id===capture.turn_id);
    const base={thread_id:capture.thread_id,turn_id:capture.turn_id,items:[],total:0,readable_count:0,
      turn_status:task?.turn_status??null,turn_error:task?.turn_error??null,source:'native history read'};
    if(!task)return unavailable(base,'turn_unavailable');
    if(!task.available)return unavailable(base,task.reason);
    const turn=thread.turns[task.index];
    if(!Array.isArray(turn.items))return unavailable(base,'items_unavailable');
    const counts=new Map();
    for(const item of turn.items)if(record(item) && id(item.id))counts.set(item.id,(counts.get(item.id)||0)+1);
    base.total=turn.items.length;
    for(let index=0;index<turn.items.length;index++){
      const item=turn.items[index],isItem=record(item),itemId=isItem && typeof item.id==='string'?item.id:null;
      let reason=!isItem?'item_unavailable':!id(itemId)?'invalid_item_id':counts.get(itemId)!==1?'ambiguous_item':!readable(item)?'unsupported_item':null;
      let text='';
      if(!reason){const value=project(item);text=typeof value==='string'?value:'';if(!text.trim())reason='text_unavailable';}
      if(!reason)++base.readable_count;
      let end=Math.min(text.length,PREVIEW_CHARS);
      if(end<text.length && /[\uD800-\uDBFF]/.test(text[end-1]) && /[\uDC00-\uDFFF]/.test(text[end]))--end;
      base.items.push({thread_id:base.thread_id,turn_id:base.turn_id,item_id:itemId,index,
        item_type:isItem && typeof item.type==='string'?item.type:null,available:!reason,reason,
        text_length:text.length,preview_start:0,preview_end:end,preview:text.slice(0,end)});
    }
    return {...base,available:true,status:'available',reason:null};
  }
  function page(result,index=0){
    if(!Number.isSafeInteger(index) || index<0)throw new TypeError('Task evidence page must be a nonnegative integer');
    const items=Array.isArray(result?.items)?result.items:[],pages=Math.max(1,Math.ceil(items.length/PAGE_ITEMS));
    const selected=Math.min(index,pages-1),first=selected*PAGE_ITEMS;
    return {index:selected,pages,total:items.length,first,items:items.slice(first,first+PAGE_ITEMS)};
  }
  const api={list,page,PAGE_ITEMS,PREVIEW_CHARS};
  root.DeskTaskEvidence=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis==='undefined'?this:globalThis);
