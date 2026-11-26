/* Native tool evidence stays local. Binary payloads and application-private _meta
   are not task text and are never expanded or fetched by this renderer. */
(function(root) {
  function inlineDescription(value, label='Inline media') {
    if(typeof value!=='string')return `[${label}: unavailable payload]`;
    if(value.toLowerCase().startsWith('data:')) {
      const comma=value.indexOf(','), header=comma<0?value:value.slice(0,comma), body=comma<0?'':value.slice(comma+1);
      const mime=Array.from(header.slice(5).split(';')[0]).slice(0,80).join('') || 'unspecified MIME type';
      return `[${label}: ${mime}; inline payload ${Array.from(body).length} characters]`;
    }
    return `[${label}: inline payload ${Array.from(value).length} characters]`;
  }
  function reviewLocation(value) {
    if(typeof value!=='string')return '[Unavailable URI]';
    if(value.toLowerCase().startsWith('data:'))return inlineDescription(value,'Media');
    const clean=value.replace(/[\t\r\n]/g,'').replace(/^[\x00-\x20]+/,'');
    const parts=/^([a-z][a-z0-9+.-]*:)?(\/\/([^/?#]*))?([^?#]*)/i.exec(clean);
    const scheme=(parts[1] || '').toLowerCase(), host=(parts[3] || '').split('@').pop(), path=parts[4] || '';
    if(host.includes('[') || host.includes(']')) {
      try {new URL((scheme || 'https:')+'//'+host);}catch {return '[Invalid URI]';}
    }
    const network=host || (scheme && ['file:','http:','https:','ftp:','ws:','wss:'].includes(scheme));
    return scheme+(network?'//'+host+(path && !path.startsWith('/')?'/':''):'')+path;
  }
  function review(value) {
    if(typeof value==='string' && value.toLowerCase().startsWith('data:'))return inlineDescription(value);
    if(Array.isArray(value))return value.map(review);
    if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='_meta').map(([key,v])=>[key,
      key==='blob' && typeof v==='string'?inlineDescription(v,'Resource blob'):
      key==='data' && ['image','audio'].includes(value.type)?inlineDescription(v,value.type==='image'?'Image':'Audio'):
      ['uri','url','imageUrl','audioUrl'].includes(key) && typeof v==='string'?reviewLocation(v):review(v)]));
    return value;
  }
  function json(value) {return JSON.stringify(review(value), null, 2) ?? 'null';}
  function location(value) {
    if(typeof value!=='string')return '';
    if(value.toLowerCase().startsWith('data:'))return value.split(';')[0]+' (embedded)';
    try {const u=new URL(value);u.username='';u.password='';u.search='';u.hash='';return u.toString();}catch {return value.split(/[?#]/)[0];}
  }
  function content(block) {
    if(block===null || typeof block!=='object')return json(block);
    if(block.type==='text' || block.type==='inputText')return typeof block.text==='string'?block.text:'[Unavailable text content]';
    if(['image','audio','inputImage','inputAudio'].includes(block.type)) {
      const kind=block.type.toLowerCase().includes('image')?'Image':'Audio';
      return `[${kind}${block.mimeType?' · '+block.mimeType:''}${block.imageUrl || block.audioUrl?' · '+location(block.imageUrl || block.audioUrl):''} · binary omitted]`;
    }
    if(['resource_link','resourceLink'].includes(block.type))return `Resource: ${block.name || block.title || ''}\n${location(block.uri)}${block.description?'\n'+block.description:''}`;
    if(block.type==='resource') {
      const r=block.resource || {};return `Resource: ${location(r.uri)}${r.mimeType?' · '+r.mimeType:''}\n${typeof r.text==='string'?r.text:'[Binary resource omitted]'}`;
    }
    return `[Unsupported content block: ${block.type || 'unknown'}]`;
  }
  function tool(item) {
    const mcp=item.type==='mcpToolCall';
    const title=mcp?`MCP · ${item.server || ''} / ${item.tool || ''}`:`Tool · ${item.namespace?item.namespace+' / ':''}${item.tool || ''}`;
    const lines=[title,`Status: ${item.status || 'unknown'}${item.success===undefined?'':' · success: '+item.success}${item.durationMs==null?'':' · '+item.durationMs+' ms'}`];
    if(item.arguments!==undefined)lines.push('Arguments\n'+json(item.arguments));
    const r=item.result;
    if(mcp && r) {
      if(Array.isArray(r.content))lines.push(...r.content.map(content));
      if(r.structuredContent!=null)lines.push('Structured result\n'+json(r.structuredContent));
      if(r.isError)lines.push('Tool reported an error');
    }
    if(!mcp && Array.isArray(item.contentItems))lines.push(...item.contentItems.map(content));
    if(item.error)lines.push('Error: '+(item.error.message || 'Tool failed'));
    if(Array.isArray(item.progress) && item.progress.length)lines.push('Progress\n'+item.progress.join('\n'));
    return lines.filter(Boolean).join('\n');
  }
  function reported(value, fallback='unknown') {return typeof value==='string' && value?value:fallback;}
  function collaborationOutput(value) {
    if(typeof value==='string')return value;
    if(value && typeof value==='object')return json(value);
    return '[Unavailable output]';
  }
  function collaboration(item) {
    if(!item || typeof item!=='object' || Array.isArray(item))return '[Unsupported collaboration item]';
    if(item.type==='subAgentActivity') {
      const lines=['Subagent activity','Kind: '+reported(item.kind),
        'Agent path: '+reported(item.agentPath,'unavailable'),'Agent thread: '+reported(item.agentThreadId,'unavailable')];
      for(const [key,label] of [['model','Resolved model'],['reasoningEffort','Resolved effort']]) {
        if(typeof item[key]==='string' && item[key])lines.push(label+': '+item[key]);
      }
      return lines.join('\n');
    }
    if(item.type!=='collabAgentToolCall')return '[Unsupported collaboration item]';
    const lines=['Collaboration tool: '+reported(item.tool),'Status: '+reported(item.status),
      'Source thread: '+reported(item.senderThreadId,'unavailable')];
    for(const [key,label] of [['model','Requested model'],['reasoningEffort','Requested effort']]) {
      if(typeof item[key]==='string' && item[key])lines.push(label+': '+item[key]);
    }
    if(item.prompt!=null)lines.push('Prompt sent:',typeof item.prompt==='string'?item.prompt:'[Unavailable text content]');
    const states=item.agentsStates && typeof item.agentsStates==='object' && !Array.isArray(item.agentsStates)?Object.fromEntries(Object.entries(item.agentsStates).filter(([key])=>key!=='_meta')):{};
    const receivers=Array.isArray(item.receiverThreadIds)?item.receiverThreadIds.filter(v=>typeof v==='string' && v):[];
    receivers.push(...Object.keys(states).filter(v=>v && !receivers.includes(v)));
    if(!receivers.length)lines.push('Receiver threads: none reported');
    for(const receiver of receivers) {
      const state=Object.hasOwn(states,receiver)?states[receiver]:null;
      const object=state && typeof state==='object' && !Array.isArray(state);
      lines.push('Receiver thread: '+receiver,'Last known status: '+reported(object?state.status:null,'unavailable'));
      if(object && state.message!=null)lines.push('Output:',collaborationOutput(state.message));
    }
    return lines.join('\n');
  }
  root.DeskEvidence={tool,content,collaboration};
  if(typeof module!=='undefined')module.exports=root.DeskEvidence;
})(typeof globalThis==='undefined'?this:globalThis);
