[CmdletBinding()]
param([Parameter(Mandatory)][ValidateSet('business-analyst','business-analyst-experimental','meeting-analyzer','backlog-assistant','value-priority-assessor')][string]$Agent, [string]$Instance = 'local')
. (Join-Path $PSScriptRoot 'agent-common.ps1')
$definition = Get-AgentDefinition $Agent $Instance
if (-not (Test-Path -LiteralPath $definition.record)) { Write-Host "$Agent unavailable (no independent ownership record)"; exit 0 }
$record = Get-Content -Raw -LiteralPath $definition.record | ConvertFrom-Json
$recordPort = Get-AgentRecordField $record 'port'
if ($recordPort) { $definition.port = [int]$recordPort }
$owned = Test-AgentOwnedProcess $record.api
$health = 'unreachable'
if ($owned -and $Agent -eq 'backlog-assistant') {
    Push-Location $definition.directory
    $priorPorts=@{}
    $ports=@{BACKLOG_ASSISTANT_PORT=$definition.port;ASSISTANT_PORT=$definition.port;BACKLOG_ASSISTANT_DATA_API_PORT=(Get-AgentRecordField $record 'dataPort');ASSISTANT_DATA_API_PORT=(Get-AgentRecordField $record 'dataPort')}
    foreach ($name in $ports.Keys) {
        $priorPorts[$name]=[Environment]::GetEnvironmentVariable($name,'Process')
        if ($ports[$name]) { [Environment]::SetEnvironmentVariable($name,[string]$ports[$name],'Process') }
    }
    try {
        $probeOutput = & $definition.python -m backlog_assistant.health
        if ($LASTEXITCODE -eq 0) { $health = 'ready' } else { $health = 'unavailable' }
    } finally {
        foreach ($name in $priorPorts.Keys) {
            if ($null -eq $priorPorts[$name]) { Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue }
            else { [Environment]::SetEnvironmentVariable($name,$priorPorts[$name],'Process') }
        }
        Pop-Location
    }
}
elseif ($owned) {
    try {
        $response = Invoke-RestMethod -Uri "http://127.0.0.1:$($definition.port)$($definition.health)" -TimeoutSec 3
        if (Test-AgentReadyResponse $response) { $health = 'ready' }
        else { $health = 'not-ready' }
    } catch { }
}
Write-Host "$Agent api=$owned, health=$health"
if ($record.worker) { Write-Host "$Agent worker=$(Test-AgentOwnedProcess $record.worker)" }

$limiter = Get-AgentRecordField $record 'limiter'
if ($limiter) { Write-Host "$Agent limiter=$($limiter.mode), operation_limit=$($limiter.limit)" }
else { Write-Host "$Agent limiter=unconfigured (existing process has no verified operation profile)" }
