const isChinese = document.documentElement.lang === 'zh-CN';
const localText = (en, zh) => isChinese ? zh : en;
const form = document.querySelector('form');
const fields = Object.fromEntries(['profile','endpoint','model','effort','platform'].map(x=>[x,document.getElementById(x)]));
const quote = x => "'" + x.replaceAll("'", "'\\''") + "'";
const psQuote = x => "'" + x.replaceAll("'", "''") + "'";
function build() {
  const name=fields.profile.value.trim(), model=fields.model.value.trim();
  if(!/^[a-z][a-z0-9-]{0,31}$/.test(name)) throw Error(localText('Use a profile name starting with a lowercase letter, followed by letters, numbers or hyphens.', '配置名称以小写字母开头，后面使用小写字母、数字或连字符，最长 32 个字符。'));
  const u=new URL(fields.endpoint.value.trim());
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash) throw Error(localText('Enter the API base URL, such as https://api.example.com/v1.', '输入 API 基础地址，例如 https://api.example.com/v1。'));
  if(!model || /[\x00-\x1f]/.test(model)) throw Error(localText('Enter the exact model ID enabled for your API key.', '输入该密钥可用的准确模型 ID。'));
  const base=u.href.replace(/\/$/,'');
  const profile=`model = ${JSON.stringify(model)}\nmodel_provider = "onramp"\nmodel_reasoning_effort = "${fields.effort.value}"\n\n[model_providers.onramp]\nname = "Provider trial"\nbase_url = ${JSON.stringify(base)}\nwire_api = "responses"\nenv_key = "ONRAMP_API_KEY"\nrequires_openai_auth = false\nsupports_websockets = false\n`;
  const powershell=fields.platform.value==='powershell';
  // A sidecar profile is deliberately the only file we create. Existing main settings are inherited.
  const setup=powershell ? `$codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME '.codex' }\nNew-Item -ItemType Directory -Force $codexHome | Out-Null\n$profilePath = Join-Path $codexHome '${name}.config.toml'\nif (Test-Path $profilePath) { throw 'Choose a new profile name: this file already exists.' }\n[System.IO.File]::WriteAllText($profilePath, @'\n${profile}'@, [System.Text.UTF8Encoding]::new($false))\n$secret = Read-Host 'Provider API key' -AsSecureString\n$env:ONRAMP_API_KEY = [System.Net.NetworkCredential]::new('', $secret).Password` : `codex_home="\${CODEX_HOME:-$HOME/.codex}"\nmkdir -p "$codex_home"\n( set -C; cat > "$codex_home/${name}.config.toml" <<'PROFILE'\n${profile}PROFILE\n) && {\n  printf 'Provider API key: '\n  read -rs ONRAMP_API_KEY\n  printf '\\n'\n  export ONRAMP_API_KEY\n}`;
  const check=powershell ? `curl.exe -sS --fail -H "Authorization: Bearer $env:ONRAMP_API_KEY" ${psQuote(base+'/models')}` : `curl -sS --fail -H "Authorization: Bearer $ONRAMP_API_KEY" ${quote(base+'/models')}`;
  const task=localText('Inspect this project, explain how its tests run, then run the smallest relevant existing test command. Do not edit files.', '检查这个项目，说明测试的运行方式，再运行最小的相关现有测试命令。保持文件原样。');
  const native=`codex exec -p ${name} -s read-only --json ${powershell?psQuote(task):quote(task)}`;
  const run=powershell ? `$started = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
$receiptBase = '${name}-' + (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$version = (codex --version | Out-String).Trim()
${native} | Out-File -FilePath ($receiptBase + '.events.jsonl') -Encoding utf8
$codexExit = $LASTEXITCODE
@{ started_utc=$started; finished_utc=(Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'); codex_exit=$codexExit; profile='${name}'; model=${psQuote(model)}; codex_version=$version } | ConvertTo-Json | Set-Content ($receiptBase + '.run.json') -Encoding utf8
Get-Content ($receiptBase + '.run.json')` : `started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
receipt_base="${name}-$(date -u +%Y%m%dT%H%M%SZ)"
${native} > "$receipt_base.events.jsonl"
codex_exit=$?
printf '{"started_utc":"%s","finished_utc":"%s","codex_exit":%s,"profile":%s,"model":%s}\\n' "$started" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$codex_exit" ${quote(JSON.stringify(name))} ${quote(JSON.stringify(model))} > "$receipt_base.run.json"
cat "$receipt_base.run.json"`;
  document.getElementById('profile-code').textContent=profile;
  document.getElementById('setup-code').textContent=setup;
  document.getElementById('check-code').textContent=check;
  document.getElementById('run-code').textContent=run;
  document.getElementById('reuse-code').textContent=`codex -p ${name}`;
  document.getElementById('return-code').textContent=powershell ? `$secret = Read-Host 'Provider API key' -AsSecureString
$env:ONRAMP_API_KEY = [System.Net.NetworkCredential]::new('', $secret).Password
codex -p ${name}` : `printf 'Provider API key: '
read -rs ONRAMP_API_KEY
printf '\\n'
export ONRAMP_API_KEY
codex -p ${name}`;
  document.getElementById('clear-code').textContent=powershell?'Remove-Item Env:ONRAMP_API_KEY':'unset ONRAMP_API_KEY';
  document.getElementById('error').textContent='';
  return {name,profile};
}
form.addEventListener('submit',e=>{e.preventDefault();try{build();document.getElementById('commands').scrollIntoView({behavior:'smooth'});}catch(err){document.getElementById('error').textContent=err.message;}});
document.getElementById('example').addEventListener('click',()=>{fields.endpoint.value='https://api.88api.ai/v1';fields.model.value='gpt-6.1-sol';build();});
document.getElementById('download').addEventListener('click',()=>{try{const {name,profile}=build();const u=URL.createObjectURL(new Blob([profile],{type:'text/plain'}));const a=document.createElement('a');a.href=u;a.download=name+'.config.toml';a.click();URL.revokeObjectURL(u);}catch(e){document.getElementById('error').textContent=e.message;}});
for(const b of document.querySelectorAll('[data-copy]')) b.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(document.getElementById(b.dataset.copy).textContent);b.textContent=localText('Copied','已复制');setTimeout(()=>b.textContent=localText('Copy','复制'),1500);}catch{b.textContent=localText('Select and copy below','请选中下方文本复制');}});
build();

let loadedSummary = null, loadedRun = null;
const receiptStatus = document.getElementById('receipt-status');
const number = n => Number.isFinite(n) ? n.toLocaleString(isChinese ? 'zh-CN' : 'en-US') : '—';
function renderReceipt() {
  if (!loadedSummary) return;
  const s=loadedSummary, run=loadedRun;
  const label=s.status==='failed' ? localText('Native turn failed','原生任务失败') : s.status==='completed' ? localText('Native turn completed','原生任务已完成') : localText('No completed turn in this file','文件中没有已完成的任务');
  receiptStatus.textContent=label + (run && Number.isInteger(run.codex_exit) ? localText(` · CLI exit ${run.codex_exit}`, ` · CLI 退出码 ${run.codex_exit}`) : '');
  receiptStatus.dataset.state=s.status;
  document.getElementById('receipt-output').hidden=false;
  document.getElementById('receipt-command-count').textContent=localText(`${s.commands.exit_zero} exit 0 · ${s.commands.exit_nonzero} nonzero · ${s.commands.unfinished} unfinished`, `${s.commands.exit_zero} 个退出码 0 · ${s.commands.exit_nonzero} 个非零 · ${s.commands.unfinished} 个未结束`);
  const tokens=s.usage;
  document.getElementById('receipt-token-count').textContent=localText(`${number(tokens.input_tokens)} input · ${number(tokens.cached_input_tokens)} cached input · ${number(tokens.output_tokens)} output`, `${number(tokens.input_tokens)} 输入 · ${number(tokens.cached_input_tokens)} 缓存输入 · ${number(tokens.output_tokens)} 输出`);
  document.getElementById('receipt-time').textContent=run ? `${run.started_utc || localText('Start time not captured','未记录开始时间')} → ${run.finished_utc || localText('End time not captured','未记录结束时间')} · ${run.model || localText('Model not captured','未记录模型')}` : localText('Load the optional .run.json for task time, model and CLI exit.', '选择配套的 .run.json，查看任务时间、模型与 CLI 退出码。');
  document.getElementById('receipt-parse').textContent=localText(`${s.parsed_events} events · ${s.completed_turns} completed turns · ${s.malformed_lines} unreadable lines`, `${s.parsed_events} 个事件 · ${s.completed_turns} 个已完成任务 · ${s.malformed_lines} 行无法解析`);
  const commands=document.getElementById('receipt-commands'); commands.replaceChildren();
  for (const c of s.details.commands) {
    const item=document.createElement('li'), code=document.createElement('code'), status=document.createElement('strong');
    status.textContent=Number.isInteger(c.exit_code) ? localText(`Exit ${c.exit_code}: `, `退出码 ${c.exit_code}：`) : localText('Unfinished: ','未结束：');
    code.textContent=c.command || localText('(command text unavailable)','（未记录命令正文）');
    item.append(status, code);
    if(c.aggregated_output) { const output=document.createElement('pre'); output.textContent=c.aggregated_output; item.append(output); }
    commands.append(item);
  }
  document.getElementById('receipt-answer').textContent=[s.details.final_answer, s.details.errors.length ? localText('Native messages:\n','原生消息：\n') + s.details.errors.join('\n') : ''].filter(Boolean).join('\n\n') || localText('No final answer recorded.','未记录最终答复。');
  document.getElementById('receipt-download').disabled=false;
}
document.getElementById('events-file').addEventListener('change',async e=>{
  loadedSummary=null; loadedRun=null;
  document.getElementById('run-file').value='';
  document.getElementById('receipt-output').hidden=true;
  document.getElementById('receipt-download').disabled=true;
  const f=e.target.files[0]; if(!f) return;
  try {
    const bytes=new Uint8Array(await f.arrayBuffer());
    const encoding=bytes[0]===255 && bytes[1]===254 ? 'utf-16le' : 'utf-8';
    loadedSummary=CodexTrialReceipt.summarizeEvents(new TextDecoder(encoding).decode(bytes));
    renderReceipt();
  } catch(error) { receiptStatus.textContent=error.message; }
});
document.getElementById('run-file').addEventListener('change',async e=>{
  loadedRun=null;
  const f=e.target.files[0]; if(!f) {renderReceipt();return;}
  try { loadedRun=JSON.parse((await f.text()).replace(/^\uFEFF/,'')); renderReceipt(); }
  catch { document.getElementById('receipt-time').textContent=localText('Could not read .run.json. Select the file created beside your events.', '无法读取 .run.json。请选择与事件文件同时生成的时间记录。'); }
});
document.getElementById('receipt-download').addEventListener('click',()=>{
  if (!loadedSummary) return;
  const result=CodexTrialReceipt.shareReceipt(loadedSummary,loadedRun);
  const u=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)+'\n'],{type:'application/json'}));
  const a=document.createElement('a'); a.href=u; a.download='codex-trial-receipt.json'; a.click(); URL.revokeObjectURL(u);
});
