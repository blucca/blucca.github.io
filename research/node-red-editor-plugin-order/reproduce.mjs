import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const root = path.resolve(process.env.NODE_RED_LAB_ROOT || 'temp/node-red-plugin-order');
const { chromium } = createRequire(path.join(root,'runtime/package.json'))('playwright');
const mode = process.argv[2];
const runName = process.argv[3];
if (!['stock','fixed'].includes(mode) || !runName) throw new Error('Use stock|fixed RUN_NAME');
const out = path.join(root, runName);
const userDir = path.join(out, 'user');
const origin = 'http://127.0.0.1:1887';
await fs.mkdir(out); // Each run needs a new user directory: reinstall/reload is a different test.
await fs.mkdir(userDir);
const state = { mode, phase: 'starting', runtime: '5.0.9', node: process.version, events: [], console: [], pageErrors: [], resources: [], socket: [] };
async function checkpoint() { await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(state, null, 2)); }
await fs.writeFile(path.join(userDir, 'settings.cjs'), 'module.exports = {uiHost:"127.0.0.1",uiPort:1887,telemetry:false,editorTheme:{projects:{enabled:false}}};\n');
const log = await fs.open(path.join(out, 'server.log'), 'a');
const server = spawn(process.execPath, [path.join(root,'runtime/node_modules/node-red/red.js'), '--userDir', userDir, '--settings', path.join(userDir,'settings.cjs')], {cwd: root, stdio: ['ignore',log.fd,log.fd], env: {...process.env, NODE_OPTIONS: '--max-old-space-size=512', npm_config_cache:path.join(root,'npm-cache')} });
state.serverPid = server.pid;
await checkpoint();
let browser;
const timer = setTimeout(()=>{ state.phase='deadline'; checkpoint().finally(()=>{server.kill('SIGTERM'); process.exitCode=1;}); },300000);
try {
  for (let i=0;i<90;i++) {
    try { if((await fetch(origin+'/settings')).ok) break; } catch {}
    if (i===89) throw new Error('Node-RED startup deadline');
    await new Promise(r=>setTimeout(r,500));
  }
  browser = await chromium.launch({executablePath:process.env.CHROME_PATH || '/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page = await browser.newPage({ viewport: {width:1280,height:900} });
  if(mode==='fixed') {
    const bundle=await fs.readFile(path.join(root,'red-fixed.js'),'utf8');
    await page.route(/\/red\/red(?:\.min)?\.js(?:\?|$)/,route=>route.fulfill({status:200,contentType:'application/javascript',body:bundle}));
    await page.route('**/resources/node-red-contrib-uibuilder/editor-common.js',async route=>{
      const response=await route.fetch();
      await new Promise(resolve=>setTimeout(resolve,600));
      await route.fulfill({response});
    });
    state.controlledModuleDelayMs=600;
  }
  await page.addInitScript(()=>{
    window.__order=[];
    const create=Document.prototype.createElement;
    Document.prototype.createElement=function(tag,...args){
      const el=create.call(this,tag,...args);
      if(String(tag).toLowerCase()==='script')el.addEventListener('load',()=>{
        if(el.src.includes('/editor-common.js'))window.__order.push({kind:'plugin-script-loaded',id:el.src,at:Date.now()});
      });
      return el;
    };
  });
  page.on('pageerror',e=>state.pageErrors.push({at:Date.now(),message:e.message,stack:e.stack}));
  page.on('console',m=>state.console.push({at:Date.now(),type:m.type(),text:m.text()}));
  page.on('response',async r=>{ const u=r.url(); if(/\/(plugins|nodes)(\/|$|\?)/.test(u)) state.resources.push({at:Date.now(),url:u,status:r.status()}); });
  page.on('websocket',ws=>ws.on('framereceived',f=>{const value=String(f.payload);if(value.includes('notification/plugin/added')||value.includes('notification/node/added'))state.socket.push({at:Date.now(),value});}));
  await page.goto(origin,{waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForFunction(()=>typeof RED!=='undefined' && RED.nodes?.getType('inject') && RED.plugins?.registerPlugin && document.querySelector('#red-ui-header-toolbar')?.classList.contains('hide')===false,undefined,{timeout:45000});
  await page.evaluate(()=>{
    const stamp = (kind,id)=>window.__order.push({kind,id,at:Date.now()});
    const plugin=RED.plugins.registerPlugin;
    RED.plugins.registerPlugin=function(id,...args){stamp('plugin-register-start',id);const v=plugin.call(this,id,...args);stamp('plugin-register-done',id);return v;};
    const node=RED.nodes.registerType;
    RED.nodes.registerType=function(id,...args){stamp('node-register-start',id);const v=node.call(this,id,...args);stamp('node-register-done',id);return v;};
  });
  state.phase='editor-ready';
  state.editorVersion = await page.evaluate(()=>RED.settings.version);
  await checkpoint();
  const response = await page.request.post(origin+'/nodes',{data:{module:'node-red-contrib-uibuilder',version:'7.7.4'},timeout:180000});
  state.install = {status:response.status(),body:await response.json()};
  state.phase='installed';await checkpoint();
  await page.waitForFunction(()=>window.__order.some(v=>v.kind==='plugin-script-loaded'),undefined,{timeout:45000});
  await page.waitForTimeout(1500);
  state.events = await page.evaluate(()=>window.__order);
  state.uibuilderType = await page.evaluate(()=>!!RED.nodes.getType('uibuilder'));
  state.installedPackageVersion = JSON.parse(await fs.readFile(path.join(userDir,'node_modules/node-red-contrib-uibuilder/package.json'),'utf8')).version;
  await page.screenshot({path:path.join(out,'editor.png'),fullPage:true});
  state.phase='complete';
  state.sharedNamespacePresent = await page.evaluate(()=>!!window.uibuilder);
  state.registeredUibuilderTypes=state.install.body.nodes.map(n=>n.types).flat().filter(t=>state.events.some(e=>e.kind==='node-register-done'&&e.id===t));
  state.sharedNamespaceErrors=state.pageErrors.filter(e=>/reading '(log|paletteCategory|editorUibInstances)'/.test(e.message));
  state.otherErrors=state.pageErrors.filter(e=>!state.sharedNamespaceErrors.includes(e));
  const loadedAt=state.events.findIndex(e=>e.kind==='plugin-script-loaded');
  const firstNodeAt=state.events.findIndex(e=>e.kind==='node-register-start');
  state.nodeAfterModuleLoad=firstNodeAt>loadedAt && loadedAt>=0;
  state.originalFailureObserved = state.sharedNamespaceErrors.length>0;
  state.contractPassed=mode==='stock'
    ?state.originalFailureObserved
    :state.sharedNamespaceErrors.length===0 && state.registeredUibuilderTypes.length===11 && state.nodeAfterModuleLoad;
  if(!state.contractPassed)throw new Error('Install-order contract failed');
  await checkpoint();
} catch(e) {
  state.phase='failed';state.failure={message:e.message,stack:e.stack};await checkpoint();process.exitCode=1;
} finally {
  clearTimeout(timer);if(browser)await browser.close();server.kill('SIGTERM');await log.close();await checkpoint();
}
console.log(JSON.stringify({mode:state.mode,contractPassed:state.contractPassed,registeredTypes:state.registeredUibuilderTypes,otherErrors:state.otherErrors?.map(e=>e.message),phase:state.phase,version:state.installedPackageVersion,pageErrors:state.pageErrors.map(e=>e.message),events:state.events,uibuilderType:state.uibuilderType,originalFailureObserved:state.originalFailureObserved}));
