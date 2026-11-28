/* Reviewed loaded originals into existing unsent preparation, then back to source. */
(function(root){
  'use strict';
  const VERSION=1,MAX_QUOTE=8000,MAX_DRAFT=200000,PROJECTION='history-reader-text/v1',COMMAND_OUTPUT_PROJECTION='history-reader-command-output/v1',TOOL_RESULT_PROJECTION='history-reader-tool-result/v1';
  const OPEN='<!-- codex-desk-evidence:v1 ',CLOSE='<!-- /codex-desk-evidence:v1 -->';
  const FIELDS=['version','native_home','thread_id','turn_id','item_id','source_kind','phase','status',
    'turn_status','quote_start','quote_end','offset_unit','projection','quote','title','cwd'];
  const KINDS=new Set(['userMessage','agentMessage','plan','commandExecution','fileChange',
    'mcpToolCall','dynamicToolCall','collabAgentToolCall','subAgentActivity']);
  const SPACE=/[\u0009-\u000d\u001c-\u001f\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/u;
  const str=v=>typeof v==='string'?v:'';
  const copy=v=>v==null?v:JSON.parse(JSON.stringify(v));
  const count=text=>Array.from(text).length;
  function scalar(value,limit,field,empty=false){
    if(typeof value!=='string' || count(value)>limit || (!empty && !value) ||
       Array.from(value).some(c=>c.length===1 && /[\uD800-\uDFFF]/.test(c)))throw Error('Use readable '+field+'.');
    return value;
  }
  function identifier(value,field){
    scalar(value,200,field);
    if(Array.from(value).some(c=>SPACE.test(c) || /\p{C}/u.test(c)))throw Error('Use the exact native '+field+'.');
    return value;
  }
  function home(value){if(typeof value!=='string' || !/^[a-f0-9]{64}$/.test(value))throw Error('Use the captured native home namespace.');return value;}
  function label(value,limit){
    if(typeof value!=='string')return '';
    const readable=Array.from(value).filter(c=>!(/\p{C}/u.test(c)) || SPACE.test(c)).map(c=>SPACE.test(c)?' ':c).join('');
    return Array.from(readable.split(/ +/).filter(Boolean).join(' ')).slice(0,limit).join('').trim();
  }
  function reported(value){
    if(typeof value!=='string' || !value)return null;
    scalar(value,120,'native phase/status');
    if(/\p{C}/u.test(value))throw Error('Use the reported native phase/status.');
    return value;
  }
  function validate(reference){
    if(!reference || typeof reference!=='object' || Array.isArray(reference) ||
       Object.keys(reference).sort().join('|')!==FIELDS.slice().sort().join('|'))throw Error('Use a complete Codex Desk evidence reference.');
    if(reference.version!==VERSION || ![PROJECTION,COMMAND_OUTPUT_PROJECTION,TOOL_RESULT_PROJECTION].includes(reference.projection) || reference.offset_unit!=='unicode_codepoints')throw Error('Use the supported original evidence projection.');
    home(reference.native_home);
    for(const key of ['thread_id','turn_id','item_id'])identifier(reference[key],key);
    if(reference.projection===COMMAND_OUTPUT_PROJECTION && reference.source_kind!=='commandExecution')throw Error('Use the command output projection only for a native command.');
    if(reference.projection===TOOL_RESULT_PROJECTION && !['mcpToolCall','dynamicToolCall'].includes(reference.source_kind))throw Error('Use the tool result projection only for supplied native tool results.');
    if(!KINDS.has(reference.source_kind))throw Error('Use a readable native source kind.');
    for(const key of ['phase','status','turn_status'])if(reference[key]!==null && reported(reference[key])!==reference[key])throw Error('Use the reported native phase/status.');
    for(const [key,limit] of [['title',240],['cwd',4096]]){
      scalar(reference[key],limit,key,true);
      if(label(reference[key],limit)!==reference[key])throw Error('Use stripped readable source labels.');
    }
    scalar(reference.quote,MAX_QUOTE,'original quote');
    if(!Number.isSafeInteger(reference.quote_start) || !Number.isSafeInteger(reference.quote_end) ||
       reference.quote_start<0 || reference.quote_end<=reference.quote_start ||
       reference.quote_end-reference.quote_start!==count(reference.quote))throw Error('Use the exact original quote span.');
    return reference;
  }
  function asciiJSON(value){
    const sorted={};for(const key of Object.keys(value).sort())sorted[key]=value[key];
    return JSON.stringify(sorted).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
  }
  function format(reference){
    validate(reference);
    const metadata=asciiJSON(reference).replace(/</g,'\\u003c').replace(/>/g,'\\u003e');
    const report=value=>value===null?'unreported':value;
    const quote=reference.quote.replace(/\r\n/g,'\n').replace(/\r/g,'\n');
    const block=[OPEN+metadata+' -->','Codex source: '+(reference.title || 'Original Codex conversation'),
      'Native home: '+reference.native_home,'Thread: '+reference.thread_id,'Turn: '+reference.turn_id,
      'Item: '+reference.item_id,'Kind: '+reference.source_kind,'Phase: '+report(reference.phase),
      'Item status: '+report(reference.status),'Turn status: '+report(reference.turn_status),
      'Project folder: '+(reference.cwd || 'unreported'),'Projection: '+reference.projection,
      'Quote span: '+reference.quote_start+'..'+reference.quote_end+' ('+reference.offset_unit+')',
      'Original excerpt:',...quote.split('\n').map(line=>'> '+line),CLOSE].join('\n');
    if(count(block)>MAX_DRAFT)throw Error('The evidence block exceeds the local draft text limit.');
    return block;
  }
  function fencedRanges(text){
    const ranges=[];let fence=null,opened=0,offset=0;
    for(const line of text.match(/[^\n]*\n|[^\n]+$/g) || []){
      const match=/^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.replace(/[\r\n]+$/,''));
      if(match){const [_,delimiter,tail]=match;
        if(!fence){if(delimiter[0]!=='`' || !tail.includes('`')){fence=delimiter;opened=offset;}}
        else if(delimiter[0]===fence[0] && delimiter.length>=fence.length && !tail.trim()){
          ranges.push([opened,offset+line.length]);fence=null;
        }
      }offset+=line.length;
    }
    if(fence)ranges.push([opened,text.length]);return ranges;
  }
  function parse(text){
    if(typeof text!=='string' || count(text)>MAX_DRAFT)return [];
    const found=[],fences=fencedRanges(text);
    const pattern=/^<!-- codex-desk-evidence:v1 ([^\r\n]*) -->\r?\n[\s\S]*?^<!-- \/codex-desk-evidence:v1 -->(?=\r?\n|$)/gm;
    for(const match of text.matchAll(pattern)){
      if(fences.some(([first,last])=>first<=match.index && match.index<last))continue;
      try{
        const reference=JSON.parse(match[1]);validate(reference);
        // Canonical metadata and readable body must agree. Duplicate/unknown
        // JSON fields, edited labels/quotes and quoted examples are inert text.
        if(match[0].replace(/\r\n/g,'\n')!==format(reference))continue;
        found.push({reference,start:match.index,end:match.index+match[0].length});
      }catch{}
    }
    return found;
  }
  function appendBlock(draft,block,note=''){
    if(typeof draft!=='string' || typeof block!=='string' || typeof note!=='string')throw Error('Use local draft and reviewed evidence text.');
    const parsed=parse(block);
    if(parsed.length!==1 || parsed[0].start!==0 || parsed[0].end!==block.length)throw Error('Review a complete unchanged evidence block before appending.');
    const addition=(note?'Next-step note:\n'+note+'\n\n':'')+block;
    const next=draft+(draft?'\n\n':'')+addition;
    if(count(next)>MAX_DRAFT)throw Error('Choose a smaller excerpt or note. The existing draft is kept.');
    return next;
  }
  function itemFor(thread,threadId,turnId,itemId){
    if(!thread || thread.id!==threadId || !Array.isArray(thread.turns))throw Error('The original does not match the captured native thread.');
    const turns=thread.turns.filter(turn=>turn && turn.id===turnId);
    if(turns.length!==1 || !Array.isArray(turns[0].items))throw Error('The captured original turn is unavailable or ambiguous.');
    const items=turns[0].items.filter(item=>item && item.id===itemId);
    if(items.length!==1)throw Error('The captured original item is unavailable or ambiguous.');
    return {turn:turns[0],item:items[0]};
  }
  function textForItem(item){
    switch(item.type){
      case 'userMessage':return 'User\n'+(Array.isArray(item.content)?item.content:[]).filter(c=>c && c.type==='text').map(c=>str(c.text)).join('\n');
      case 'agentMessage':return 'Codex\n'+str(item.text);
      case 'plan':return 'Proposed plan\n'+str(item.text);
      case 'commandExecution':return 'Command\n'+str(item.command)+'\nStatus: '+(str(item.status)||'unknown')+
        '\nExit: '+(typeof item.exitCode==='number'?item.exitCode:'not reported')+'\n'+
        (typeof item.aggregatedOutput==='string'?item.aggregatedOutput:'[No command output reported.]');
      case 'fileChange':return 'File changes\n'+(Array.isArray(item.changes)?item.changes:[]).filter(c=>c && typeof c==='object').map(c=>str(c.path)+'\n'+str(c.diff)).join('\n');
      case 'mcpToolCall':case 'dynamicToolCall':if(root.DeskEvidence)return root.DeskEvidence.tool(item);break;
      case 'collabAgentToolCall':case 'subAgentActivity':if(root.DeskEvidence)return root.DeskEvidence.collaboration(item);break;
    }
    throw Error('Choose the agreed readable native item projection.');
  }
  function sourceFacts(item){
    const facts=[];
    const actual=(key,label)=>{const value=item[key];if(typeof value==='string')facts.push(label+': '+value);
      else if(typeof value==='number' && Number.isFinite(value))facts.push(label+': '+value);};
    if(item.type==='commandExecution'){
      actual('command','Command');actual('cwd','Reported working directory');actual('workingDirectory','Reported working directory');
      actual('reason','Reported reason');actual('exitCode','Reported exit code');
    }
    if(['mcpToolCall','dynamicToolCall','collabAgentToolCall','subAgentActivity'].includes(item.type)){
      actual('server','Native tool server');actual('tool','Native tool');actual('namespace','Native tool namespace');
    }
    return facts.join('\n');
  }
  function selectionSpan(text,start,end){
    scalar(text,Number.MAX_SAFE_INTEGER,'original projection',true);
    if(!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start<0 || end<=start || end>text.length)throw Error('Choose a nonempty loaded original text span.');
    for(const at of [start,end])if(at>0 && at<text.length && /[\uD800-\uDBFF]/.test(text[at-1]) && /[\uDC00-\uDFFF]/.test(text[at]))throw Error('Keep the original quote on complete Unicode characters.');
    const quote=text.slice(start,end);scalar(quote,MAX_QUOTE,'original quote');
    return {quote,quote_start:count(text.slice(0,start)),quote_end:count(text.slice(0,end))};
  }
  function commandOutputPrefix(item,textFor,text){
    if(item?.type!=='commandExecution' || typeof item.aggregatedOutput!=='string')return null;
    const prefix=textFor({...item,aggregatedOutput:''});
    return typeof prefix==='string' && prefix.startsWith('Command\n') && text===prefix+item.aggregatedOutput?prefix:null;
  }
  function toolResultParts(item,text){
    if(!['mcpToolCall','dynamicToolCall'].includes(item?.type) || !root.DeskEvidence?.toolParts)return null;
    const parts=root.DeskEvidence.toolParts(item);
    return parts.text===text && typeof parts.result==='string' && !!parts.result?parts:null;
  }
  function capture(thread,{native_home,thread_id,turn_id,item_id,start_utf16,end_utf16,expected_quote,textFor=textForItem}){
    const {turn,item}=itemFor(thread,thread_id,turn_id,item_id),text=textFor(item);
    let span=selectionSpan(text,start_utf16,end_utf16),projection=PROJECTION;
    const prefix=commandOutputPrefix(item,textFor,text);
    if(prefix!==null && start_utf16>=prefix.length){
      span=selectionSpan(item.aggregatedOutput,start_utf16-prefix.length,end_utf16-prefix.length);projection=COMMAND_OUTPUT_PROJECTION;
    }else{
      const parts=toolResultParts(item,text);
      if(parts && start_utf16>=parts.start && end_utf16<=parts.end){
        span=selectionSpan(parts.result,start_utf16-parts.start,end_utf16-parts.start);projection=TOOL_RESULT_PROJECTION;
      }
    }
    if(expected_quote!==undefined && span.quote!==expected_quote)throw Error('The selection does not match this exact loaded original span.');
    return validate({version:VERSION,native_home:home(native_home),thread_id,turn_id,item_id,
      source_kind:item.type,phase:reported(item.phase),status:reported(item.status),turn_status:reported(turn.status),
      ...span,offset_unit:'unicode_codepoints',projection,
      title:label(thread.name || thread.title || thread.preview,240),cwd:label(thread.cwd,4096)});
  }
  function resolve(reference,namespace,thread,textFor=textForItem){
    validate(reference);home(namespace);
    const base={available:false,thread_id:reference.thread_id,turn_id:reference.turn_id,item_id:reference.item_id};
    if(namespace!==reference.native_home)return {...base,status:'home_mismatch'};
    let source;try{source=itemFor(thread,reference.thread_id,reference.turn_id,reference.item_id);}catch{return {...base,status:'source_unavailable'};}
    if(source.item.type!==reference.source_kind)return {...base,status:'source_kind_changed'};
    let text,points,prefix='';try{
      text=textFor(source.item);scalar(text,Number.MAX_SAFE_INTEGER,'original projection',true);
      if(reference.projection===COMMAND_OUTPUT_PROJECTION){
        prefix=commandOutputPrefix(source.item,textFor,text);
        if(prefix===null)return {...base,status:'quote_unavailable'};
        text=source.item.aggregatedOutput;scalar(text,Number.MAX_SAFE_INTEGER,'original output',true);
      }else if(reference.projection===TOOL_RESULT_PROJECTION){
        const parts=toolResultParts(source.item,text);if(!parts)return {...base,status:'quote_unavailable'};
        prefix=text.slice(0,parts.start);text=parts.result;scalar(text,Number.MAX_SAFE_INTEGER,'original tool result',true);
      }
      points=Array.from(text);
    }catch{return {...base,status:'quote_unavailable'};}
    if(reference.quote_end>points.length)return {...base,status:'quote_unavailable'};
    if(points.slice(reference.quote_start,reference.quote_end).join('')!==reference.quote)return {...base,status:'quote_changed'};
    const current={phase:reported(source.item.phase),status:reported(source.item.status),turn_status:reported(source.turn.status)};
    const start=prefix.length+points.slice(0,reference.quote_start).join('').length,end=start+reference.quote.length;
    return {...base,available:true,status:'available',current,state_changed:Object.keys(current).some(key=>current[key]!==reference[key]),
      quote_start:reference.quote_start,quote_end:reference.quote_end,offset_unit:reference.offset_unit,projection:reference.projection,start_utf16:start,end_utf16:end};
  }
  function destination(value){
    if(!value || typeof value!=='object' || typeof value.session!=='string' || !value.session || value.session==='native-catalog' ||
       typeof value.text!=='string' || !['native','plan'].includes(value.mode) ||
       !Number.isSafeInteger(value.revision) || value.revision<0 || !Number.isSafeInteger(value.sequence) || value.sequence<0 ||
       typeof value.writer!=='string' || !value.writer || value.writer.length>128 || value.generation===undefined)throw Error('Review an existing unsent destination draft first.');
    if(value.busy || value.conflict)throw Error('Finish the pending draft save or revision review first.');
    return copy(value);
  }
  function sameDestination(a,b){return !!a && !!b && !b.busy && !b.conflict &&
    ['session','generation','revision','sequence','writer','text','mode'].every(key=>a[key]===b[key]);}

  function createController(options){
    if(typeof options?.destination!=='function' || typeof options?.api!=='function' || typeof options?.save!=='function')throw Error('Configure local preparation callbacks.');
    let active=null,version=0,view=null;
    const snapshot=()=>active?{...copy({reference:active.reference,destination:active.destination,note:active.note,status:active.status,message:active.message,sourceFacts:active.sourceFacts || ''}),pending:active.pending,version:active.ticket}:null;
    const valid=intent=>active===intent && intent.ticket===version && (!intent.callbacks.valid || intent.callbacks.valid());
    function paint(){
      const state=snapshot();options.onState?.(state);
      if(!view)return;
      if(!state){if(view.dialog.open)view.dialog.close();return;}
      view.destination.textContent=(state.destination.name || state.destination.session)+'\n'+(state.destination.cwd || 'Project folder unreported')+'\n'+(state.destination.mode==='plan'?'Plan':'Work')+' · existing unsent draft';
      view.draft.textContent=state.destination.text || '[Empty unsent draft]';
      view.quote.textContent=state.reference?.quote || active.loadedQuote || '';
      view.source.textContent=state.reference?format(state.reference).split('\n').slice(1,-1).filter(line=>!line.startsWith('> ')).join('\n')+
        (state.sourceFacts?'\nLoaded native item facts at review:\n'+state.sourceFacts:''):'Loading the original native home namespace…';
      if(view.note.value!==state.note)view.note.value=state.note;
      view.note.disabled=state.pending;view.append.disabled=state.pending || !state.reference || ['saved','conflict','failed'].includes(state.status) || !sameDestination(active.destination,options.destination());
      view.status.textContent=state.message;view.status.setAttribute('role',state.status==='failed' || state.status==='conflict'?'alert':'status');
      if(!view.dialog.open)view.dialog.showModal();
    }
    function finish(reason){
      const previous=active;if(!previous)return false;
      const target=options.destination(),owns=target?.session===previous.destination.session && target?.generation===previous.destination.generation &&
        (!previous.callbacks.valid || previous.callbacks.valid());
      active=null;++version;paint();
      const result={reason,reference:copy(previous.reference),destination:copy(previous.destination)};
      if(owns){previous.callbacks.onReturn?.(result);options.onReturn?.(result);}return true;
    }
    function mount(){
      if(options.render===false || !root.document)return;
      const doc=root.document,make=(tag,text,id)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;if(id!==undefined)node.id='evidence-preparation'+id;return node;};
      const dialog=make('dialog',undefined,'');dialog.setAttribute('aria-labelledby','evidence-preparation-title');
      Object.assign(dialog.style,{width:'min(760px,95vw)',maxHeight:'90vh',overflow:'auto'});
      const heading=make('h2','Review evidence for task','-title'),target=make('pre','','-destination'),draft=make('pre','','-draft'),source=make('pre','','-source'),quote=make('pre','','-quote');
      for(const node of [target,draft,source,quote])Object.assign(node.style,{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:'240px',overflow:'auto'});
      const noteLabel=make('label','Separate next-step note (optional)'),note=make('textarea','','-note');note.rows=3;noteLabel.htmlFor=note.id;
      const status=make('p','','-status'),append=make('button','Append to draft','-append'),cancel=make('button','Return without appending','-cancel');append.type=cancel.type='button';
      const actions=make('div');actions.className='actions';actions.append(append,cancel);
      dialog.append(heading,make('h3','Existing destination'),target,make('h3','Current unsent draft'),draft,
        make('h3','Captured native source'),source,make('h3','Exact reviewed excerpt'),quote,noteLabel,note,status,actions);
      view={dialog,destination:target,draft,source,quote,note,status,append,cancel};doc.body.append(dialog);
      note.oninput=()=>controller.setNote(note.value);append.onclick=()=>controller.append();cancel.onclick=()=>finish('canceled');
      dialog.addEventListener('cancel',event=>{event.preventDefault();finish('canceled');});
      dialog.addEventListener('close',()=>{if(!dialog.open && active)finish('canceled');});
    }
    const controller={
      state:snapshot,
      async reviewLoaded(loaded,callbacks={}){
        let captured;try{captured=destination(options.destination());}catch(error){options.onError?.(error);return false;}
        finish('replaced');const ticket=++version;
        const source=copy(loaded),projection=options.textForItem || textForItem;
        let span,facts;try{const exact=itemFor(source.thread,source.thread_id,source.turn_id,source.item_id),text=projection(exact.item);facts=sourceFacts(exact.item);
          if(source.start_utf16===undefined && source.end_utf16===undefined){source.start_utf16=0;source.end_utf16=text.length;}
          span=selectionSpan(text,source.start_utf16,source.end_utf16);if(source.expected_quote!==undefined && source.expected_quote!==span.quote)throw Error('The selection does not match the loaded original.');}catch(error){options.onError?.(error);return false;}
        const intent={ticket,destination:captured,callbacks,reference:null,loadedQuote:span.quote,sourceFacts:facts,note:'',pending:true,status:'loading',message:'Reading the source namespace. No draft has been changed.'};active=intent;paint();
        try{
          const namespace=await options.api('/api/native/home');
          if(!valid(intent))return false;
          if(!sameDestination(captured,options.destination()))throw Error('The destination changed. Review the current draft before appending.');
          intent.reference=capture(source.thread,{...source,native_home:home(namespace?.home_namespace),textFor:projection});
          intent.status='review';intent.message='Review the exact excerpt and existing destination. Append saves locally; nothing is sent.';return true;
        }catch(error){if(valid(intent)){intent.status='failed';intent.message=error.message;}return false;}
        finally{if(active===intent){intent.pending=false;paint();}}
      },
      reviewReference(reference,callbacks={}){
        validate(reference);const captured=destination(options.destination());finish('replaced');
        active={ticket:++version,destination:captured,callbacks,reference:copy(reference),note:'',pending:false,status:'review',message:'Review the saved excerpt and its original source before appending.'};paint();return true;
      },
      setNote(value){if(!active || active.pending || typeof value!=='string')return false;active.note=value;paint();return true;},
      sync(){if(active && !active.pending && !sameDestination(active.destination,options.destination()))active.message='The destination changed. Return and review its current draft before appending.';paint();},
      async append(){
        const intent=active;if(!intent || intent.pending || !intent.reference || intent.status!=='review' || !valid(intent))return false;
        let payload;try{
          if(!sameDestination(intent.destination,options.destination()))throw Error('The destination changed. Its current draft is kept; review it again.');
          payload={session:intent.destination.session,text:appendBlock(intent.destination.text,format(intent.reference),intent.note),
            mode:intent.destination.mode,revision:intent.destination.revision,writer:intent.destination.writer,sequence:intent.destination.sequence+1};
          if(!Number.isSafeInteger(payload.sequence))throw Error('Review a fresh destination edit sequence.');
        }catch(error){intent.message=error.message;paint();return false;}
        intent.pending=true;intent.status='saving';intent.message='Saving the reviewed excerpt into this captured destination…';paint();
        try{
          const receipt=await options.save(copy(payload),copy(intent.destination));
          if(!receipt || receipt.text!==payload.text || receipt.mode!==payload.mode || !Number.isSafeInteger(receipt.revision) || receipt.revision<=payload.revision)throw Error('The local save did not confirm this reviewed draft.');
          // The host reserves/updates its editor sequence synchronously at save.
          // Its apply callback owns receipt reconciliation and never replaces
          // subsequent typing merely because the old captured save completed.
          await options.apply?.(copy(receipt),copy(intent.destination),copy(payload));
          if(active===intent){intent.status='saved';intent.message='Reviewed evidence saved in the captured draft. Nothing has been sent.';intent.pending=false;paint();finish('saved');}
          return true;
        }catch(error){
          if(error.status===409)options.onConflict?.(copy(intent.destination),copy(error.current),error);
          if(active===intent){intent.status=error.status===409?'conflict':'failed';intent.message=error.status===409?'The draft changed elsewhere. Your unsent edits are kept; use the existing Keep mine or Load saved review.':error.message;}
          return false;
        }finally{if(active===intent){intent.pending=false;paint();}}
      },
      cancel:()=>{if(!active){++version;return false;}return finish('canceled');},
      invalidate:()=>{if(!active){++version;return false;}return finish('owner-changed');},
      references:parse,
      async readReference(reference,callbacks={}){
        validate(reference);if(typeof options.showOriginal!=='function')throw Error('Configure the original reader callback.');
        finish('source-read');
        const ticket=++version,owner=callbacks.owner || copy(options.destination());
        const current=()=>ticket===version && (!callbacks.valid || callbacks.valid()) &&
          (callbacks.ownerCurrent?callbacks.ownerCurrent(owner):callbacks.owner?true:sameDestination(owner,options.destination()));
        try{
          const result=await options.api('/api/native/evidence-source?home='+encodeURIComponent(reference.native_home)+'&thread='+encodeURIComponent(reference.thread_id));
          if(!current())return false;
          if(result?.home_namespace!==reference.native_home)throw Error('This original belongs to a different native home. The saved excerpt is kept.');
          if(!result.thread || result.thread.id!==reference.thread_id || !Array.isArray(result.thread.turns))throw Error('The source read did not return this captured native original. The saved excerpt is kept.');
          const resolved=resolve(reference,result.home_namespace,result.thread,options.textForItem || textForItem);
          const readerCallbacks={preloadedThread:result.thread,savedReference:copy(reference),resolution:resolved,valid:current,
             backLabel:callbacks.backLabel || 'Return to prepared task',onReturn:()=>{if(current())callbacks.onReturn?.(owner);}};
          callbacks.onReader?.(readerCallbacks);
          return await options.showOriginal({...copy(reference),...resolved,thread_id:reference.thread_id,turn_id:reference.turn_id,item_id:reference.item_id},readerCallbacks);
        }catch(error){if(current()){callbacks.onError?.(error,copy(reference));options.onReadError?.(error,copy(reference));}return false;}
      }
    };
    mount();return controller;
  }
  let configured=null;
  root.DeskEvidencePreparation={VERSION,MAX_QUOTE,MAX_DRAFT,PROJECTION,COMMAND_OUTPUT_PROJECTION,TOOL_RESULT_PROJECTION,validate,format,parse,appendBlock,
    capture,resolve,selectionSpan,textForItem,sameDestination,createController,
    configure:options=>(configured=createController(options)),
    reviewLoaded:(...args)=>configured.reviewLoaded(...args),reviewReference:(...args)=>configured.reviewReference(...args),
    append:(...args)=>configured.append(...args),setNote:(...args)=>configured.setNote(...args),
    readReference:(...args)=>configured.readReference(...args),sync:()=>configured?.sync(),
    cancel:()=>configured?.cancel(),invalidate:()=>configured?.invalidate(),state:()=>configured?.state() || null};
})(typeof globalThis==='undefined'?this:globalThis);
