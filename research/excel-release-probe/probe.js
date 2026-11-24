'use strict';
let baseline, review;
const keyPrefix='ReleaseReviewProbe:';
const namedBaselines=document.getElementById('saved');
const display = value => document.getElementById('result').textContent = JSON.stringify(value, null, 2);
function a1(row, col) {
  let letters = ''; for (let n=col+1;n;n=Math.floor((n-1)/26)) letters=String.fromCharCode(65+(n-1)%26)+letters;
  return letters+(row+1);
}
async function capture(outputs) {
  return Excel.run(async context => {
    const sheet=context.workbook.worksheets.getActiveWorksheet(), used=sheet.getUsedRangeOrNullObject(), names=context.workbook.names;
    names.load('items/name,type,value');
    sheet.load('name');used.load('address,rowIndex,columnIndex,rowCount,columnCount,values,formulas,text,valueTypes');
    const selected=outputs ? null : context.workbook.getSelectedRange();
    if(selected) selected.load('address,rowIndex,columnIndex,rowCount,columnCount');
    await context.sync();
    const cells={};
    if(!used.isNullObject) for(let r=0;r<used.rowCount;r++) for(let c=0;c<used.columnCount;c++) {
      const formula=used.formulas[r][c], address=a1(used.rowIndex+r,used.columnIndex+c);
      cells[address]={value:used.values[r][c],text:used.text[r][c],valueType:used.valueTypes[r][c],formula:typeof formula==='string'&&formula.startsWith('=')?formula:null};
    }
    const selectedOutputs=outputs || [];
    if(selected) for(let r=0;r<selected.rowCount;r++) for(let c=0;c<selected.columnCount;c++) selectedOutputs.push(a1(selected.rowIndex+r,selected.columnIndex+c));
    return {schema:1,capturedAt:new Date().toISOString(),sheet:sheet.name,range:used.isNullObject?null:used.address,outputs:selectedOutputs,names:names.items.map(n=>({name:n.name,type:n.type,value:n.value})),cells};
  });
}
async function fixture() {
  await Excel.run(async context=>{
    const sheet=context.workbook.worksheets.add('ReleaseProbe');sheet.activate();
    sheet.getRange('A1:C4').values=[['Product','UnitPrice','Quantity'],['A',10,5],['A',20,5],['B',30,2]];
    sheet.getRange('E1:F5').values=[['Metric','Value'],['Revenue',0],['EBITDA',0],['Review',null],['Active SKUs',null]];
    sheet.getRange('F2').formulas=[['=XLOOKUP("A",A2:A4,B2:B4)*5+XLOOKUP("B",A2:A4,B2:B4)*2']];
    sheet.getRange('F3').formulas=[['=F2*0.2']];sheet.getRange('F4').formulas=[['=IF(F3>=30,"Pass","Review")']];
    sheet.getRange('H2').formulas=[['=FILTER(A2:A4,B2:B4>=20)']];sheet.getRange('F5').formulas=[['=COUNTA(H2#)']];
    for(const [name,cell] of Object.entries({ProbeRevenue:'F2',ProbeEBITDA:'F3',ProbeDecision:'F4'})) context.workbook.names.add(name,sheet.getRange(cell));
    sheet.getRange('F2:F4').select();await context.sync();
  });
  display({fixture:'ReleaseProbe',action:'Select output cells then capture baseline'});
}
async function revision() {
  await Excel.run(async context=>{
    const sheet=context.workbook.worksheets.getItem('ReleaseProbe');
    sheet.getRange('F2').formulas=[['=XLOOKUP("A",A2:A4,B2:B4,0,0,-1)*5+XLOOKUP("B",A2:A4,B2:B4)*2']];
    await context.sync();
  });display({revision:'last-match lookup',action:'Compare release'});
}
async function compare() {
  if(!baseline) throw new Error('Capture baseline first');
  const now=await capture(baseline.outputs);
  if(now.sheet!==baseline.sheet) throw new Error('Select the baseline worksheet');
  const changed=[];
  for(const address of new Set([...Object.keys(baseline.cells),...Object.keys(now.cells)])){
    const before=baseline.cells[address]||null,after=now.cells[address]||null;
    if(JSON.stringify(before)!==JSON.stringify(after))changed.push({address,before,after});
  }
  review={schema:1,name:baseline.name,baselineAt:baseline.capturedAt,currentAt:now.capturedAt,sheet:now.sheet,changedCells:changed,
    outputs:baseline.outputs.map(address=>{
      const before=baseline.cells[address]||null,after=now.cells[address]||null;
      return {address,before,after,delta:typeof before?.value==='number'&&typeof after?.value==='number'?after.value-before.value:null};
    })};display(review);
}
async function saveBaseline() {
  const name=document.getElementById('name').value.trim();
  if(!name) throw new Error('Give this approved baseline a name');
  baseline={...await capture(),name};review=null;
  await Excel.run(async context=>{
    context.workbook.settings.add(keyPrefix+name,JSON.stringify(baseline));
    context.workbook.settings.add('ReleaseReviewProbeLatest',name);await context.sync();
  });
  await listBaselines();display(baseline);
}
async function listBaselines() {
  await Excel.run(async context=>{
    const settings=context.workbook.settings;settings.load('items/key,value');await context.sync();
    const latest=settings.items.find(x=>x.key==='ReleaseReviewProbeLatest');
    namedBaselines.replaceChildren();
    for(const s of settings.items.filter(x=>x.key.startsWith(keyPrefix))) {
      const o=document.createElement('option');o.value=s.key;o.textContent=s.key.slice(keyPrefix.length);namedBaselines.append(o);
    }
    if(latest) namedBaselines.value=keyPrefix+latest.value;
  });
}
async function loadBaseline() {
  const key=namedBaselines.value;if(!key) throw new Error('No saved baseline in this workbook');
  await Excel.run(async context=>{
    const setting=context.workbook.settings.getItem(key);setting.load('value');await context.sync();baseline=JSON.parse(setting.value);review=null;
  });
  document.getElementById('name').value=baseline.name;display({restored:true,baseline});
}
function downloadJSON() {
  if(!baseline) throw new Error('Capture or restore a baseline first');
  download(JSON.stringify(review||baseline,null,2),'application/json','excel-release-review.json');
}
function download(text,type,name) {
  const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function downloadReport() {
  if(!review) throw new Error('Compare the release first');
  const rows=review.outputs.map(o=>`<tr><td>${esc(o.address)}</td><td>${esc(o.before?.value)}</td><td>${esc(o.after?.value)}</td><td>${esc(o.delta)}</td></tr>`).join('');
  const changes=review.changedCells.map(o=>`<tr><td>${esc(o.address)}</td><td>${esc(o.before?.formula||o.before?.value)}</td><td>${esc(o.after?.formula||o.after?.value)}</td></tr>`).join('');
  download(`<!doctype html><meta charset="utf-8"><title>Release review</title><style>body{font:15px system-ui;margin:32px}td,th{padding:8px;border:1px solid #ccc}table{border-collapse:collapse}code{white-space:pre-wrap}</style><h1>${esc(review.name)}</h1><p>${esc(review.sheet)}: ${esc(review.baselineAt)} → ${esc(review.currentAt)}</p><h2>Selected financial outputs</h2><table><tr><th>Cell</th><th>Approved value</th><th>Current value</th><th>Delta</th></tr>${rows}</table><h2>Changed formulas and cell results</h2><table><tr><th>Cell</th><th>Before</th><th>After</th></tr>${changes}</table>`,'text/html','excel-release-review.html');
}
Office.onReady(async info=>{
  display({host:info.host,platform:info.platform,ready:true});
  for(const [id,action] of Object.entries({fixture,revision,compare,baseline:saveBaseline,restore:loadBaseline,download:downloadJSON,report:downloadReport})) document.getElementById(id).onclick=()=>Promise.resolve(action()).catch(error=>display({error:error.message}));
  try {await listBaselines();if(namedBaselines.value) await loadBaseline();} catch(error) {display({host:info.host,error:error.message});}
});
