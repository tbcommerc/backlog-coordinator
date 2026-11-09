[CmdletBinding()]
param([Parameter(Mandatory)][ValidateSet('business-analyst','business-analyst-experimental','meeting-analyzer','backlog-assistant','value-priority-assessor')][string]$Agent, [string]$Instance = 'local', [ValidateRange(0,65535)][int]$Port = 0, [ValidateRange(0,65535)][int]$DataPort = 0, [ValidateRange(0,1800)][int]$ReadyTimeoutSeconds = 0)
. (Join-Path $PSScriptRoot 'agent-common.ps1')
$definition = Get-AgentDefinition $Agent $Instance
if ($ReadyTimeoutSeconds) { $definition.readyTimeout=$ReadyTimeoutSeconds }
if ($Agent -eq 'backlog-assistant') {
    if ($ReadyTimeoutSeconds) { throw 'ReadyTimeoutSeconds applies to direct services; backlog uses its mTLS preflight.' }
    & (Join-Path $PSScriptRoot 'start-backlog-assistant.ps1') -Instance $Instance -ApiPort $Port -DataPort $DataPort
    exit $LASTEXITCODE
}
if ($Port) { $definition.port = $Port }
& (Join-Path $PSScriptRoot 'agent-doctor.ps1') -Agent $Agent
$limiterProfile = Initialize-AgentLimiter $definition
if (Test-Path -LiteralPath $definition.record) {
    $record = Get-Content -Raw -LiteralPath $definition.record | ConvertFrom-Json
    Assert-AgentLimiterCompatible $record $limiterProfile
    $recordPort = Get-AgentRecordField $record 'port'
    if ($recordPort) {
        if ($Port -and $Port -ne [int]$recordPort) { throw 'Existing instance uses another port; no process was stopped.' }
        $definition.port=[int]$recordPort
    }
    Assert-AgentRecordReusable $record.api
    Assert-AgentRecordReusable $record.worker
    if (Test-AgentOwnedProcess $record.api) {
        if (-not $record.worker -or (Test-AgentOwnedProcess $record.worker)) {
            try {
                $existing = Invoke-RestMethod -Uri "http://127.0.0.1:$($definition.port)$($definition.health)" -TimeoutSec 3
                if (-not (Test-AgentReadyResponse $existing)) { throw 'not_ready' }
            } catch { throw "$Agent is owned but not ready; no duplicate process was started." }
            Write-Host "$Agent already running and ready."
            exit 0
        }
        throw "$Agent worker unavailable. Stop the owned service before restarting."
    }
    if ($record.worker -and (Test-AgentOwnedProcess $record.worker)) { throw 'An owned worker is still running; stop it before restart.' }
}
Assert-AgentPortAvailable $definition.port
$runtime = Join-Path $script:agentRoot '.runtime'
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
function Start-Owned([string]$Name, [string[]]$Arguments, [string]$Marker) {
    $control = Join-Path $runtime ($Agent+'-'+[guid]::NewGuid().ToString('N')+'.stop')
    $previousControl = $env:DMB_AGENT_CONTROL_FILE
    try {
        $env:DMB_AGENT_CONTROL_FILE = $control
        $process = Start-Process -FilePath $definition.python -ArgumentList $Arguments -WorkingDirectory $definition.directory `
            -RedirectStandardOutput (Join-Path $runtime "$($definition.logPrefix).$Name.out.log") `
            -RedirectStandardError (Join-Path $runtime "$($definition.logPrefix).$Name.err.log") -WindowStyle Hidden -PassThru
    } finally {
        if ($null -eq $previousControl) { Remove-Item Env:DMB_AGENT_CONTROL_FILE -ErrorAction SilentlyContinue }
        else { $env:DMB_AGENT_CONTROL_FILE = $previousControl }
    }
    $identity = Get-AgentProcessRecord $process.Id $Marker
    $identity.control = $control
    $identity.graceSeconds = 15
    return $identity
}
$record = @{api=$null; worker=$null; port=$definition.port; instance=$Instance; limiter=$limiterProfile}
try {
    $record.api = Start-Owned 'api' @('-m','dmb_agent_contracts.serve','--app',$definition.module,'--host','127.0.0.1','--port',[string]$definition.port) $definition.module
    # Persist ownership immediately, including if worker creation fails.
    $record | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $definition.record -Encoding UTF8
    if ($definition.worker) {
        $record.worker = Start-Owned 'worker' @('-m',$definition.worker) $definition.worker
        $record | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $definition.record -Encoding UTF8
    }
    $deadline = (Get-Date).AddSeconds($definition.readyTimeout)
    do {
        if (-not (Test-AgentOwnedProcess $record.api)) { throw "$Agent process exited. See .runtime/ logs." }
        if ($record.worker -and -not (Test-AgentOwnedProcess $record.worker)) { throw "$Agent worker exited. See .runtime/ logs." }
        try {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:$($definition.port)$($definition.health)" -TimeoutSec 2
            if (Test-AgentReadyResponse $health) {
                $record.api = Confirm-AgentListenerOwnership $record.api $definition.port
                $record | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $definition.record -Encoding UTF8
                Write-Host "$Agent ready at http://127.0.0.1:$($definition.port)"
                exit 0
            }
        } catch { }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    throw "$Agent readiness failed. See .runtime/ logs."
} catch {
    & (Join-Path $PSScriptRoot 'stop-agent.ps1') -Agent $Agent -Instance $Instance
    throw
}
