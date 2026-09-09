$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$runtimeDir = Join-Path $projectRoot ".runtime"
$perUserDockerBin = Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\resources\bin"
if (-not (Get-Command docker -ErrorAction SilentlyContinue) -and (Test-Path (Join-Path $perUserDockerBin "docker.exe"))) {
    $env:Path = "$perUserDockerBin;$env:Path"
}

$serviceHealthUrls = @{
    backend = "http://127.0.0.1:8000/api/v1/health/ready"
    agent = "http://127.0.0.1:9000/api/agent/ready"
    prioritiser = "http://127.0.0.1:9100/ready"
}

foreach ($service in @("backend", "agent", "prioritiser")) {
    $pidPath = Join-Path $runtimeDir "$service.pid"
    $running = $false
    if (Test-Path $pidPath) {
        $processId = [int](Get-Content -Raw $pidPath)
        $running = $null -ne (Get-Process -Id $processId -ErrorAction SilentlyContinue)
    }
    $processState = if ($running) { "running" } else { "stopped" }
    $healthState = "unreachable"
    if ($running) {
        try {
            $response = Invoke-RestMethod -Uri $serviceHealthUrls[$service] -TimeoutSec 3 -ErrorAction Stop
            $healthy = ($response.status -in @("ok", "ready")) -or ($response.ok -eq $true)
            $healthState = if ($healthy) { "ready" } else { "not-ready" }
        } catch {
            $healthState = "unreachable"
        }
    }
    Write-Host ("{0}: process={1}, health={2}" -f $service, $processState, $healthState)
}

if (Get-Command docker -ErrorAction SilentlyContinue) {
    docker compose -f (Join-Path $projectRoot "compose.yaml") ps
} else {
    Write-Host "docker: not installed"
}
