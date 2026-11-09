$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$runtimeDir = Join-Path $projectRoot ".runtime"
. (Join-Path $PSScriptRoot 'agent-common.ps1')
foreach ($agent in @('business-analyst','business-analyst-experimental','meeting-analyzer','backlog-assistant','value-priority-assessor')) {
    & (Join-Path $PSScriptRoot 'agent-status.ps1') -Agent $agent
}
$backendPath = Join-Path $runtimeDir 'backend.process.json'
$backendOwned = $false
if (Test-Path -LiteralPath $backendPath) {
    $record = Get-Content -Raw -LiteralPath $backendPath | ConvertFrom-Json
    $backendOwned = Test-AgentOwnedProcess $record.api
}
$health = 'unreachable'
if ($backendOwned) {
    try {
        $response = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/api/v1/health/ready' -TimeoutSec 3
        if (Test-AgentReadyResponse $response) { $health = 'ready' }
        else { $health = 'not-ready' }
    } catch { }
}
Write-Host "backend: owned=$backendOwned, health=$health"
$perUserDockerBin = Join-Path $env:LOCALAPPDATA 'Programs/DockerDesktop/resources/bin'
if (-not (Get-Command docker -ErrorAction SilentlyContinue) -and (Test-Path (Join-Path $perUserDockerBin 'docker.exe'))) {
    $env:Path = "$perUserDockerBin;$env:Path"
}

if (Get-Command docker -ErrorAction SilentlyContinue) {
    docker compose -f (Join-Path $projectRoot "compose.yaml") ps
} else {
    Write-Host "docker: not installed"
}
