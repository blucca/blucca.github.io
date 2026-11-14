const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(process.argv[2], 'utf8');
const section = (start, end) => {
  const a=source.indexOf(start), b=source.indexOf(end,a+start.length);
  assert(a>=0 && b>a, `Known source section: ${start}`);
  return source.slice(a,b);
};
const handlers = {}, settings = [], catalogs = [], requests = [], calls = [], pluginDone = [];
const ctx = {
  Promise, localStorage:{getItem:()=>null},
  RED:{
    comms:{subscribe:(topic,fn)=>{handlers[topic]=fn;}},
    settings:{refreshSettings:fn=>settings.push(fn)},
    plugins:{addPlugin:()=>{}},
    i18n:{loadNodeCatalog:(_id,fn)=>catalogs.push(fn), detectLanguage:()=> 'en'},
    utils:{sanitize:v=>v}, _:()=>'', notify:()=>{}
  },
  $:{ajax:options=>requests.push(options)},
  appendConfig:(_config,_match,target,done)=>{
    if(target==='#red-ui-editor-plugin-configs') { calls.push('plugin-append');pluginDone.push(done); }
    else { calls.push('node-append'); if(done)done(); }
  }
};
vm.createContext(ctx);
const declaration=source.includes('var pendingPluginLoads = Promise.resolve();')?'var pendingPluginLoads = Promise.resolve();\n':'';
vm.runInContext(declaration+section('    function appendPluginConfig(', '    function loadNodeList()')+section('        RED.comms.subscribe("notification/plugin/#"','        let pendingNodeRemovedNotifications'), ctx);
const turn = () => new Promise(resolve=>setImmediate(resolve));
const send = list=>handlers['notification/plugin/#']('notification/plugin/added',list);
const node = () => vm.runInContext('appendNodeConfig("<!-- --- [red-module:probe/node] --- -->");',ctx);
const flush = () => {while(settings.length)settings.shift()(null,{});while(catalogs.length)catalogs.shift()();};
(async()=>{
  send([{id:'probe/runtime',plugins:[{id:'runtime'}]}, {id:'probe/editor',plugins:[]}]);
  node();await turn();
  assert(!calls.includes('node-append'),'node waits while settings/catalog/HTML are pending');
  flush();assert.equal(requests.length,2);
  requests.shift().success('runtime HTML');requests.shift().success('editor module HTML');
  await turn();assert(!calls.includes('node-append'),'HTML arrival still waits for script completion');
  pluginDone.shift()();await turn();assert(!calls.includes('node-append'),'all plugin sets must complete');
  pluginDone.shift()();await turn();assert.equal(calls.at(-1),'node-append');
  send([{id:'probe/failed',plugins:[]}]);node();await turn();const count=calls.filter(x=>x==='node-append').length;
  flush();requests.shift().error();await turn();assert.equal(calls.filter(x=>x==='node-append').length,count+1,'HTTP error releases this installation barrier');
  send([]);node();await turn();assert.equal(calls.filter(x=>x==='node-append').length,count+2,'empty plugin event completes');
  console.log('PASS: retained script completion, full batch, HTTP error, empty event');
})().catch(err=>{console.error(err);process.exitCode=1;});
