/* Native-reported capacity and errors, separate from cumulative billing usage. */
const DeskNativeState=(()=>{
  const actions={
    contextWindowExceeded:'Review the useful evidence and continue in a new conversation.',
    sessionBudgetExceeded:'Check the native session budget before continuing.',
    usageLimitExceeded:'Check the selected account’s usage limit before continuing.',
    rateLimitExceeded:'Wait for the selected provider’s rate limit to reset before continuing.',
    serverOverloaded:'Retry the task when the selected provider is available.',
    flexUnavailable:'Check model availability in the selected provider profile.',
    policyCapacityUnavailable:'Check capacity for the selected account and model.',
    modelNotFound:'Check the model name in the selected provider profile.',
    unauthorized:'Check the selected profile’s key or current Codex login.',
    badRequest:'Review the task and selected provider’s model settings.',
    sandboxError:'Review native permissions and the project’s command output.',
    threadRollbackFailed:'Preserve the original conversation and review a new-thread handoff.'
  };
  function failure(value,willRetry=false){
    let e=value;if(typeof e==='string'){try{e=JSON.parse(e);}catch{e={message:e};}}
    if(!e || typeof e!=='object')e={message:String(e || 'Native task failed')};
    const info=e.codexErrorInfo,code=typeof info==='string'?info:info && typeof info==='object'?Object.keys(info)[0]:null;
    const detail=code && typeof info==='object'?info[code]:null;
    const http=detail?.httpStatusCode;
    const message=typeof e.message==='string'?e.message:'Native task failed';
    const action=willRetry?'Native Codex is retrying this turn. Its approval and completion state stays authoritative.':actions[code] || (/ConnectionFailed|StreamDisconnected/.test(code || '')?'Check the selected provider connection and retained activity before retrying.':'Review the retained activity and native error before continuing.');
    return {label:willRetry?'Native retry in progress':'Native task failed',message,code,http:Number.isInteger(http)?http:null,action,additional:typeof e.additionalDetails==='string'?e.additionalDetails:null};
  }
  function usage(value){
    let u=value;if(typeof u==='string'){try{u=JSON.parse(u);}catch{return 'Native usage is unavailable.';}}
    if(!u || typeof u!=='object')return 'Usage appears after native Codex reports it.';
    const t=u.total || u,n=v=>Number.isFinite(v) && v>=0?v.toLocaleString():'not reported';
    let result=`Thread usage · input ${n(t.inputTokens)} (cached ${n(t.cachedInputTokens)}) · output ${n(t.outputTokens)} · latest native cumulative total`;
    if(u.last && Number.isFinite(u.last.inputTokens))result+=`\nLatest request input · ${n(u.last.inputTokens)} tokens`;
    if(Number.isFinite(u.modelContextWindow) && u.modelContextWindow>0)result+=` · reported model context window ${n(u.modelContextWindow)}`;
    return result;
  }
  function card(value,willRetry,make){
    const f=failure(value,willRetry),card=make('section','','native-error-card');card.setAttribute('role','status');
    card.append(make('strong',f.label),make('p',f.message));
    if(f.code)card.append(make('small',f.code+(f.http!==null?' · HTTP '+f.http:'')));
    card.append(make('p',f.action,'muted'));
    if(f.additional){const details=make('details'),summary=make('summary','Native error details');details.append(summary,make('pre',f.additional));card.append(details);}
    return card;
  }
  return {failure,usage,card};
})();
