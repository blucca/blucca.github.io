const form = document.querySelector('form');
const fields = Object.fromEntries(['profile','endpoint','model','effort','platform'].map(x=>[x,document.getElementById(x)]));
const quote = x => "'" + x.replaceAll("'", "'\\''") + "'";
const psQuote = x => "'" + x.replaceAll("'", "''") + "'";
function build() {
  const name=fields.profile.value.trim(), model=fields.model.value.trim();
  if(!/^[a-z][a-z0-9-]{0,31}$/.test(name)) throw Error('Use a profile name starting with a lowercase letter, followed by letters, numbers or hyphens.');
  const u=new URL(fields.endpoint.value.trim());
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash) throw Error('Enter the API base URL, such as https://api.example.com/v1.');
  if(!model || /[\x00-\x1f]/.test(model)) throw Error('Enter the exact model ID enabled for your API key.');
  const base=u.href.replace(/\/$/,'');
  const profile=`model = ${JSON.stringify(model)}\nmodel_provider = "onramp"\nmodel_reasoning_effort = "${fields.effort.value}"\n\n[model_providers.onramp]\nname = "Provider trial"\nbase_url = ${JSON.stringify(base)}\nwire_api = "responses"\nenv_key = "ONRAMP_API_KEY"\nrequires_openai_auth = false\nsupports_websockets = false\n`;
  const powershell=fields.platform.value==='powershell';
  // A sidecar profile is deliberately the only file we create. Existing main settings are inherited.
  const setup=powershell ? `$codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME '.codex' }\nNew-Item -ItemType Directory -Force $codexHome | Out-Null\n$profilePath = Join-Path $codexHome '${name}.config.toml'\nif (Test-Path $profilePath) { throw 'Choose a new profile name: this file already exists.' }\n[System.IO.File]::WriteAllText($profilePath, @'\n${profile}'@, [System.Text.UTF8Encoding]::new($false))\n$secret = Read-Host 'Provider API key' -AsSecureString\n$env:ONRAMP_API_KEY = [System.Net.NetworkCredential]::new('', $secret).Password` : `codex_home="\${CODEX_HOME:-$HOME/.codex}"\nmkdir -p "$codex_home"\n( set -C; cat > "$codex_home/${name}.config.toml" <<'PROFILE'\n${profile}PROFILE\n) && {\n  printf 'Provider API key: '\n  read -rs ONRAMP_API_KEY\n  printf '\\n'\n  export ONRAMP_API_KEY\n}`;
  const check=powershell ? `curl.exe -sS --fail -H "Authorization: Bearer $env:ONRAMP_API_KEY" ${psQuote(base+'/models')}` : `curl -sS --fail -H "Authorization: Bearer $ONRAMP_API_KEY" ${quote(base+'/models')}`;
  const task='Inspect this project, explain how its tests run, then run the smallest relevant existing test command. Do not edit files.';
  const run=`codex exec -p ${name} -s read-only --json ${powershell?psQuote(task):quote(task)}`;
  document.getElementById('profile-code').textContent=profile;
  document.getElementById('setup-code').textContent=setup;
  document.getElementById('check-code').textContent=check;
  document.getElementById('run-code').textContent=run;
  document.getElementById('reuse-code').textContent=`codex -p ${name}`;
  document.getElementById('clear-code').textContent=powershell?'Remove-Item Env:ONRAMP_API_KEY':'unset ONRAMP_API_KEY';
  document.getElementById('error').textContent='';
  return {name,profile};
}
form.addEventListener('submit',e=>{e.preventDefault();try{build();document.getElementById('commands').scrollIntoView({behavior:'smooth'});}catch(err){document.getElementById('error').textContent=err.message;}});
document.getElementById('example').addEventListener('click',()=>{fields.endpoint.value='https://api.88api.ai/v1';fields.model.value='gpt-6.1-sol';build();});
document.getElementById('download').addEventListener('click',()=>{try{const {name,profile}=build();const u=URL.createObjectURL(new Blob([profile],{type:'text/plain'}));const a=document.createElement('a');a.href=u;a.download=name+'.config.toml';a.click();URL.revokeObjectURL(u);}catch(e){document.getElementById('error').textContent=e.message;}});
for(const b of document.querySelectorAll('[data-copy]')) b.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(document.getElementById(b.dataset.copy).textContent);b.textContent='Copied';setTimeout(()=>b.textContent='Copy',1500);}catch{b.textContent='Select and copy below';}});
build();
