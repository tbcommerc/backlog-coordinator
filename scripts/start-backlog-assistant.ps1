[CmdletBinding()]
param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$assistantRoot = Join-Path $projectRoot 'agents/backlog-assistant'
$assistantPython = Join-Path $assistantRoot '.venv\Scripts\python.exe'
$backendPython = Join-Path $projectRoot '.venv\Scripts\python.exe'
$configPath = Join-Path $assistantRoot '.env'
if (-not (Test-Path -LiteralPath $assistantPython)) { throw 'Install agents/backlog-assistant/.venv using agents/backlog-assistant/README.md first.' }
if (-not (Test-Path -LiteralPath $configPath)) { throw 'Configure agents/backlog-assistant/.env from .env.example: dedicated PostgreSQL, mTLS, secrets and pinned runtime image are required.' }
foreach ($line in Get-Content -LiteralPath $configPath -Encoding UTF8) {
    if ($line -match '^\s*([A-Z][A-Z0-9_]*)\s*=(.*)$') {
        [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim().Trim('"').Trim("'"), 'Process')
    }
}
Push-Location $assistantRoot
try {
    & $assistantPython -m backlog_assistant.preflight
    if ($LASTEXITCODE -ne 0) { throw 'Backlog Assistant prerequisites failed.' }
    if ($CheckOnly) { return }
    & $assistantPython -m backlog_assistant.migrate
    if ($LASTEXITCODE -ne 0) { throw 'Backlog Assistant dedicated database migration failed.' }
} finally { Pop-Location }
$runtime = Join-Path $projectRoot '.runtime'
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
$services = @(
    @{ Name='backlog-assistant-data'; Port=9450; Python=$backendPython; Directory=(Join-Path $projectRoot 'dmb-backlog\backend'); Module='services.backlog_assistant_integration.server' },
    @{ Name='backlog-assistant'; Port=9400; Python=$assistantPython; Directory=$assistantRoot; Module='backlog_assistant.bootstrap' }
)
function Get-AssistantListener($entry) {
    $listeners = @(Get-NetTCPConnection -LocalPort $entry.Port -State Listen -ErrorAction SilentlyContinue)
    foreach ($listener in $listeners) {
        $owner = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $listener.OwningProcess)
        if (-not $owner -or $owner.Name -notlike 'python*.exe' -or
            $owner.CommandLine -notmatch ('(?:^|\s)-m\s+' + [regex]::Escape($entry.Module) + '(?:\s|$)')) {
            throw ("Port {0} belongs to another process; refusing to replace it." -f $entry.Port)
        }
        $owner
    }
}
# A venv launcher may have exited while its Python child still owns the port.
# Resolve and verify the actual listener instead of trusting a stale PID file.
foreach ($entry in $services) {
    foreach ($owner in @(Get-AssistantListener $entry)) {
        Stop-Process -Id $owner.ProcessId -Force -ErrorAction Stop
    }
    $deadline = (Get-Date).AddSeconds(10)
    while (Get-NetTCPConnection -LocalPort $entry.Port -State Listen -ErrorAction SilentlyContinue) {
        if ((Get-Date) -gt $deadline) { throw ("Port {0} did not stop." -f $entry.Port) }
        Start-Sleep -Milliseconds 200
    }
}
foreach ($entry in $services) {
    $process = Start-Process -FilePath $entry.Python -ArgumentList @('-m', $entry.Module) -WorkingDirectory $entry.Directory `
        -RedirectStandardOutput (Join-Path $runtime ($entry.Name+'.out.log')) -RedirectStandardError (Join-Path $runtime ($entry.Name+'.err.log')) `
        -WindowStyle Hidden -PassThru
    $entry.LauncherId = $process.Id
}
Push-Location $assistantRoot
try {
    & $assistantPython -m backlog_assistant.preflight --health
    if ($LASTEXITCODE -ne 0) { throw 'Backlog Assistant mTLS health check failed; inspect .runtime/backlog-assistant*.err.log.' }
} finally { Pop-Location }
foreach ($entry in $services) {
    $owners = @(Get-AssistantListener $entry)
    if ($owners.Count -ne 1 -or ($owners[0].ProcessId -ne $entry.LauncherId -and $owners[0].ParentProcessId -ne $entry.LauncherId)) {
        throw ("New server ownership was not confirmed for {0}." -f $entry.Name)
    }
    Set-Content -LiteralPath (Join-Path $runtime ($entry.Name+'.pid')) -Value $owners[0].ProcessId -Encoding ascii
}
Write-Host '[ok] Backlog Assistant: https://127.0.0.1:9400 (mTLS); Data API: https://127.0.0.1:9450 (mTLS)'
