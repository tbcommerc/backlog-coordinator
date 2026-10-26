[CmdletBinding()]
param(
    [switch]$KeepInfrastructure,
    [switch]$Quiet
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$runtimeDir = Join-Path $projectRoot ".runtime"
$perUserDockerBin = Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\resources\bin"
if (-not (Get-Command docker -ErrorAction SilentlyContinue) -and (Test-Path (Join-Path $perUserDockerBin "docker.exe"))) {
    $env:Path = "$perUserDockerBin;$env:Path"
}

foreach ($service in @("backend", "agent", "prioritiser", "assistant-v2", "agent-v2", "backlog-assistant", "backlog-assistant-data")) {
    $pidPath = Join-Path $runtimeDir "$service.pid"
    if (-not (Test-Path $pidPath)) { continue }
    $processId = [int](Get-Content -Raw $pidPath)
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($process) {
        Stop-Process -Id $processId -Force
        if (-not $Quiet) { Write-Host "Stopped process: $service" }
    }
    Remove-Item -LiteralPath $pidPath -Force
}

if (-not $KeepInfrastructure -and (Get-Command docker -ErrorAction SilentlyContinue)) {
    docker compose -f (Join-Path $projectRoot "compose.yaml") down
}

if (-not $Quiet) { Write-Host "Project stopped." }
