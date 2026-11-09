[CmdletBinding()]
param([switch]$CheckOnly, [string]$Instance = 'local', [ValidateRange(0,65535)][int]$ApiPort = 0, [ValidateRange(0,65535)][int]$DataPort = 0)
$ErrorActionPreference = 'Stop'
$requestedApiPort,$requestedDataPort=$ApiPort,$DataPort
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$assistantRoot = Join-Path $projectRoot 'agents/backlog-assistant'
$assistantPython = Join-Path $assistantRoot '.venv\Scripts\python.exe'
$backendPython = Join-Path $projectRoot '.venv\Scripts\python.exe'
$configPath = Join-Path $assistantRoot '.env'
if (-not (Test-Path -LiteralPath $assistantPython)) { throw 'Install agents/backlog-assistant/.venv using agents/backlog-assistant/README.md first.' }
if (-not (Test-Path -LiteralPath $configPath)) { throw 'Configure agents/backlog-assistant/.env from .env.example: dedicated PostgreSQL, mTLS, secrets and pinned runtime image are required.' }
. (Join-Path $PSScriptRoot 'agent-common.ps1')
$beforeFile = @{}
$previousImported = @()
if ($env:BACKLOG_ASSISTANT_FILE_IMPORTED_KEYS) { $previousImported = @($env:BACKLOG_ASSISTANT_FILE_IMPORTED_KEYS | ConvertFrom-Json) }
foreach ($entry in Get-ChildItem Env:) {
    if ($entry.Name -notin $previousImported) { $beforeFile[$entry.Name] = $entry.Value }
}
$fileValues = Read-AgentFileEnvironment $configPath
$imported = New-Object 'System.Collections.Generic.List[string]'
foreach ($name in $fileValues.Keys) {
    if (-not $beforeFile.ContainsKey($name)) {
        [Environment]::SetEnvironmentVariable($name, $fileValues[$name], 'Process')
        $imported.Add($name)
    }
}
foreach ($group in @(Get-AgentAliasGroups 'backlog-assistant')) {
    $names = @($group.Value)
    if (@($names | Where-Object { $beforeFile.ContainsKey($_) -or $fileValues.ContainsKey($_) }).Count) {
        $selected = Resolve-AgentAliasValue $beforeFile $fileValues $names
        $target = $group.Name
        [Environment]::SetEnvironmentVariable($target, $selected, 'Process')
        if (@($names | Where-Object { $beforeFile.ContainsKey($_) }).Count) { [void]$imported.Remove($target) }
        elseif (-not $imported.Contains($target)) { $imported.Add($target) }
    }
}
if (-not $ApiPort) { $ApiPort = if ($env:BACKLOG_ASSISTANT_PORT) { [int]$env:BACKLOG_ASSISTANT_PORT } else { 9400 } }
if (-not $DataPort) { $DataPort = if ($env:BACKLOG_ASSISTANT_DATA_API_PORT) { [int]$env:BACKLOG_ASSISTANT_DATA_API_PORT } else { 9450 } }
$env:ASSISTANT_PORT = [string]$ApiPort
$env:BACKLOG_ASSISTANT_PORT = [string]$ApiPort
$env:ASSISTANT_DATA_API_PORT = [string]$DataPort
$env:BACKLOG_ASSISTANT_DATA_API_PORT = [string]$DataPort
$env:BACKLOG_ASSISTANT_FILE_IMPORTED_KEYS = ConvertTo-Json -InputObject @($imported.ToArray()) -Compress

Push-Location $assistantRoot
try {
    & $assistantPython -m backlog_assistant.preflight
    if ($LASTEXITCODE -ne 0) { throw 'Backlog Assistant prerequisites failed.' }
    if ($CheckOnly) { return }
    $definition = Get-AgentDefinition 'backlog-assistant' $Instance
    $limiterProfile = Initialize-AgentLimiter $definition
    if (Test-Path -LiteralPath $definition.record) {
        $existing = Get-Content -Raw -LiteralPath $definition.record | ConvertFrom-Json
        Assert-AgentLimiterCompatible $existing $limiterProfile
        Assert-AgentRecordReusable $existing.api
        Assert-AgentRecordReusable $existing.worker
        if ((Test-AgentOwnedProcess $existing.api) -and (Test-AgentOwnedProcess $existing.worker)) {
            $existingApiPort=Get-AgentRecordField $existing 'port'
            $existingDataPort=Get-AgentRecordField $existing 'dataPort'
            if (($requestedApiPort -and $existingApiPort -and $requestedApiPort -ne $existingApiPort) -or
                ($requestedDataPort -and $existingDataPort -and $requestedDataPort -ne $existingDataPort)) {
                throw 'Existing assistant instance uses another port; no process was stopped.'
            }
            if ($existingApiPort) { $ApiPort=[int]$existingApiPort }
            if ($existingDataPort) { $DataPort=[int]$existingDataPort }
            $env:ASSISTANT_PORT=$env:BACKLOG_ASSISTANT_PORT=[string]$ApiPort
            $env:ASSISTANT_DATA_API_PORT=$env:BACKLOG_ASSISTANT_DATA_API_PORT=[string]$DataPort
            & $assistantPython -m backlog_assistant.preflight --health
            if ($LASTEXITCODE -ne 0) { throw 'Owned Backlog Assistant is not ready; no duplicate was started.' }
            Write-Host 'Backlog Assistant and Data API are already owned and ready.'
            return
        }
        if ((Test-AgentOwnedProcess $existing.api) -or (Test-AgentOwnedProcess $existing.worker)) {
            throw 'Backlog Assistant has a partial owned launch; stop it before retrying.'
        }
    }
    foreach ($port in @($ApiPort,$DataPort)) {
        if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
            throw "Port $port is occupied without matching ownership; no process was stopped."
        }
    }
    & $assistantPython -m backlog_assistant.migrate
    if ($LASTEXITCODE -ne 0) { throw 'Backlog Assistant dedicated database migration failed.' }
} finally { Pop-Location }
$runtime = Join-Path $projectRoot '.runtime'
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
$services = @(
    @{ Name='backlog-assistant-data'; Port=$DataPort; Python=$backendPython; Directory=(Join-Path $projectRoot 'dmb-backlog\backend'); Module='services.backlog_assistant_integration.server' },
    @{ Name='backlog-assistant'; Port=$ApiPort; Python=$assistantPython; Directory=$assistantRoot; Module='backlog_assistant.bootstrap' }
)
$record = @{api=$null; worker=$null; port=$ApiPort; dataPort=$DataPort; instance=$Instance; limiter=$limiterProfile}
try {
    foreach ($entry in $services) {
        $entry.LogName=if ($Instance -eq 'local') { $entry.Name } else { $entry.Name+'-'+$Instance }
        $control = Join-Path $runtime ($entry.Name+'-'+[guid]::NewGuid().ToString('N')+'.stop')
        $previousControl = $env:DMB_AGENT_CONTROL_FILE
        try {
        $env:DMB_AGENT_CONTROL_FILE = $control
        $process = Start-Process -FilePath $entry.Python -ArgumentList @('-m', $entry.Module) -WorkingDirectory $entry.Directory `
            -RedirectStandardOutput (Join-Path $runtime ($entry.LogName+'.out.log')) -RedirectStandardError (Join-Path $runtime ($entry.LogName+'.err.log')) `
            -WindowStyle Hidden -PassThru
        } finally {
            if ($null -eq $previousControl) { Remove-Item Env:DMB_AGENT_CONTROL_FILE -ErrorAction SilentlyContinue }
            else { $env:DMB_AGENT_CONTROL_FILE = $previousControl }
        }
        $identity = Get-AgentProcessRecord $process.Id $entry.Module
        $identity.control = $control
        $identity.graceSeconds = 15
        if ($entry.Name -eq 'backlog-assistant') { $record.api = $identity }
        else { $record.worker = $identity }
        $record | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $definition.record -Encoding UTF8
    }
    Push-Location $assistantRoot
    try {
        & $assistantPython -m backlog_assistant.preflight --health
        if ($LASTEXITCODE -ne 0) { throw 'Backlog Assistant mTLS health failed; inspect .runtime/ logs.' }
    } finally { Pop-Location }
    $record.api = Confirm-AgentListenerOwnership $record.api $ApiPort
    $record.worker = Confirm-AgentListenerOwnership $record.worker $DataPort
    $record | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $definition.record -Encoding UTF8
} catch {
    foreach ($entry in @($record.api,$record.worker)) { $null = Stop-AgentOwnedProcess $entry }
    throw
}
Write-Host "[ok] Backlog Assistant: https://127.0.0.1:$ApiPort (mTLS); Data API: https://127.0.0.1:$DataPort (mTLS)"
