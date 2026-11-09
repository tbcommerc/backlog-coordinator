[CmdletBinding()]
param(
    [switch]$KeepInfrastructure,
    [switch]$Quiet
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$runtimeDir = Join-Path $projectRoot ".runtime"
. (Join-Path $PSScriptRoot 'agent-common.ps1')
foreach ($independentAgent in @('business-analyst','business-analyst-experimental','meeting-analyzer','value-priority-assessor','backlog-assistant')) {
    & (Join-Path $PSScriptRoot 'stop-agent.ps1') -Agent $independentAgent
}
$perUserDockerBin = Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\resources\bin"
if (-not (Get-Command docker -ErrorAction SilentlyContinue) -and (Test-Path (Join-Path $perUserDockerBin "docker.exe"))) {
    $env:Path = "$perUserDockerBin;$env:Path"
}

$backendPath = Join-Path $runtimeDir 'backend.process.json'
if (Test-Path -LiteralPath $backendPath) {
    $record = Get-Content -Raw -LiteralPath $backendPath | ConvertFrom-Json
    if (Stop-AgentOwnedProcess $record.api) {
        Remove-Item -LiteralPath $backendPath
        if (-not $Quiet) { Write-Host 'Stopped process: backend' }
    } else { throw 'Backend ownership mismatch; process retained.' }
}
foreach ($service in @('backend','agent','prioritiser','agent-v2','backlog-assistant','backlog-assistant-data')) {
    $legacyPath = Join-Path $runtimeDir "$service.pid"
    if (Test-Path -LiteralPath $legacyPath) {
        $legacyId = [int](Get-Content -Raw -LiteralPath $legacyPath)
        if (Get-Process -Id $legacyId -ErrorAction SilentlyContinue) {
            Write-Warning "Legacy PID-only record for $service cannot prove ownership; process retained."
        } else { Remove-Item -LiteralPath $legacyPath }
    }
}

if (-not $KeepInfrastructure -and (Get-Command docker -ErrorAction SilentlyContinue)) {
    docker compose -f (Join-Path $projectRoot "compose.yaml") down
}

if (-not $Quiet) { Write-Host "Project stopped." }
