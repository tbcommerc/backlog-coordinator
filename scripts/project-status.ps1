$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$runtimeDir = Join-Path $projectRoot ".runtime"
$perUserDockerBin = Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\resources\bin"
if (-not (Get-Command docker -ErrorAction SilentlyContinue) -and (Test-Path (Join-Path $perUserDockerBin "docker.exe"))) {
    $env:Path = "$perUserDockerBin;$env:Path"
}

$serviceDisplayNames = @{ agent = 'business-analyst'; prioritiser = 'value-priority-assessor'; 'agent-v2' = 'business-analyst-experimental' }
$serviceHealthUrls = @{
    backend = "http://127.0.0.1:8000/api/v1/health/ready"
    agent = "http://127.0.0.1:9000/api/agent/ready"
    prioritiser = "http://127.0.0.1:9100/ready"
    "agent-v2" = "http://127.0.0.1:9300/api/agent-v2/ready"
    "backlog-assistant" = "https://127.0.0.1:9400/health"
    "backlog-assistant-data" = "https://127.0.0.1:9450/health"
}

foreach ($service in @("backend", "agent", "prioritiser", "agent-v2", "backlog-assistant", "backlog-assistant-data")) {
    $displayName = if ($serviceDisplayNames.ContainsKey($service)) { $serviceDisplayNames[$service] } else { $service }
    $pidPath = Join-Path $runtimeDir "$service.pid"
    $running = $false
    if (Test-Path $pidPath) {
        $processId = [int](Get-Content -Raw $pidPath)
        $running = $null -ne (Get-Process -Id $processId -ErrorAction SilentlyContinue)
    }
    $processState = if ($running) { "running" } else { "stopped" }
    $healthState = "unreachable"
    if ($running -and $service -like 'backlog-assistant*') {
        Write-Host ("{0}: process=running, health=requires-mTLS (backlog_assistant.preflight --health)" -f $displayName)
        continue
    }
    if ($running) {
        try {
            $response = Invoke-RestMethod -Uri $serviceHealthUrls[$service] -TimeoutSec 3 -ErrorAction Stop
            $healthy = ($response.status -in @("ok", "ready")) -or ($response.ok -eq $true)
            $healthState = if ($healthy) { "ready" } else { "not-ready" }
        } catch {
            $healthState = "unreachable"
        }
    }
    Write-Host ("{0}: process={1}, health={2}" -f $displayName, $processState, $healthState)
}

if (Get-Command docker -ErrorAction SilentlyContinue) {
    docker compose -f (Join-Path $projectRoot "compose.yaml") ps
} else {
    Write-Host "docker: not installed"
}
