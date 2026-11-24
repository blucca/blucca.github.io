const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const out=process.argv[2]; fs.mkdirSync(out,{recursive:true});
const elements={};
const values={profile:'windows-trial',endpoint:'http://127.0.0.1:18743/v1',model:'fixture-model',effort:'low',platform:'powershell'};
function el(id){return elements[id] ||= {value:values[id]||'',textContent:'',dataset:{},addEventListener(){},replaceChildren(){}};}
const document={documentElement:{lang:'en'},querySelector:()=>el('form'),getElementById:el,querySelectorAll:()=>[]};
const src=fs.readFileSync('guides/codex-provider-trial/app.js','utf8');
vm.runInNewContext(src,{document,URL,console});
for (const [file,id] of [['setup.ps1','setup-code'],['models.ps1','check-code'],['run.ps1','run-code']]) fs.writeFileSync(path.join(out,file),el(id).textContent+'\n');
fs.writeFileSync(path.join(out,'source-sha256.txt'),require('node:crypto').createHash('sha256').update(src).digest('hex')+'\n');
