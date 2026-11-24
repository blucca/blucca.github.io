param([string]$Case)
$ErrorActionPreference = 'Stop'
$base = (Get-Location).Path
$work = Join-Path $base ('temp/windows-contract/' + $Case)
New-Item -ItemType Directory -Force $work | Out-Null
node temp/windows-contract/generate.cjs $work
if ($LASTEXITCODE -ne 0) { throw 'Generation failed' }
$env:CODEX_HOME = Join-Path $work 'codex-home'
New-Item -ItemType Directory -Force $env:CODEX_HOME | Out-Null
$configPath = Join-Path $env:CODEX_HOME 'config.toml'
$authPath = Join-Path $env:CODEX_HOME 'auth.json'
[IO.File]::WriteAllText($configPath, "model = `"base-model-must-not-be-requested`"`napproval_policy = `"never`"`ndeveloper_instructions = `"BASE_CONFIG_SENTINEL_R43`"`n[mcp_servers.disabled_fixture]`ncommand = `"this-command-must-not-start`"`nenabled = false`n", [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText($authPath, '{"OPENAI_API_KEY":"base-dummy-key-not-used"}', [Text.UTF8Encoding]::new($false))
$beforeConfig = (Get-FileHash $configPath).Hash
$beforeAuth = (Get-FileHash $authPath).Hash
function Read-Host { param([string]$Prompt,[switch]$AsSecureString); ConvertTo-SecureString 'deterministic-fixture-key' -AsPlainText -Force }
$server = Start-Process -FilePath python -ArgumentList @('temp/windows-contract/server.py', $work) -PassThru -RedirectStandardOutput (Join-Path $work 'server.stdout') -RedirectStandardError (Join-Path $work 'server.stderr')
try {
  $ready = $false
  for ($i=0; $i -lt 20; $i++) {
    try { Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:18743/v1/models' | Out-Null; $ready=$true; break } catch { Start-Sleep -Milliseconds 250 }
  }
  if (!$ready) { throw 'Fixture server not ready' }
  . (Join-Path $work 'setup.ps1')
  $sidecar = Join-Path $env:CODEX_HOME 'windows-trial.config.toml'
  $beforeSidecar = (Get-FileHash $sidecar).Hash
  $refused = $false
  try { . (Join-Path $work 'setup.ps1') } catch { if ($_.Exception.Message -like '*Choose a new profile name*') { $refused=$true } else { throw } }
  if (!$refused -or $beforeSidecar -ne (Get-FileHash $sidecar).Hash) { throw 'Existing sidecar retention failed' }
  . (Join-Path $work 'models.ps1')
  if ($LASTEXITCODE -ne 0) { throw 'Models command failed' }
  Push-Location $work
  try { . ./run.ps1 } finally { Pop-Location }
  if ($beforeConfig -ne (Get-FileHash $configPath).Hash -or $beforeAuth -ne (Get-FileHash $authPath).Hash) { throw 'Base config/auth changed' }
  if ($beforeSidecar -ne (Get-FileHash $sidecar).Hash) { throw 'Sidecar changed' }
  @{case=$Case; powershell=$PSVersionTable.PSVersion.ToString(); output_encoding=[Console]::OutputEncoding.WebName; existing_profile_refused=$refused; base_config_unchanged=$true; base_auth_unchanged=$true; sidecar_unchanged=$true} | ConvertTo-Json | Set-Content (Join-Path $work 'checks.json') -Encoding utf8
  node temp/windows-contract/validate.cjs $work
  if ($LASTEXITCODE -ne 0) { throw 'Receipt/transport checks failed' }
} finally { Stop-Process -Id $server.Id -ErrorAction SilentlyContinue }
