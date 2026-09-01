$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$runtimeDir = Join-Path $projectRoot ".runtime"
$perUserDockerBin = Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\resources\bin"
if (-not (Get-Command docker -ErrorAction SilentlyContinue) -and (Test-Path (Join-Path $perUserDockerBin "docker.exe"))) {
    $env:Path = "$perUserDockerBin;$env:Path"
}

foreach ($service in @("backend", "agent", "prioritiser")) {
    $pidPath = Join-Path $runtimeDir "$service.pid"
    $running = $false
    if (Test-Path $pidPath) {
        $processId = [int](Get-Content -Raw $pidPath)
        $running = $null -ne (Get-Process -Id $processId -ErrorAction SilentlyContinue)
    }
    Write-Host ("{0}: {1}" -f $service, $(if ($running) { "running" } else { "stopped" }))
}

if (Get-Command docker -ErrorAction SilentlyContinue) {
    docker compose -f (Join-Path $projectRoot "compose.yaml") ps
} else {
    Write-Host "docker: not installed"
}
