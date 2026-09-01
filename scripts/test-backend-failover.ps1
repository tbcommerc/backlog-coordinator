[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$EnvFile,
    [string]$BaseUrl = "http://127.0.0.1:8080",
    [ValidateRange(2, 10)][int]$BackendReplicas = 2,
    [ValidateRange(3, 100)][int]$ChecksWhileDegraded = 20
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$perUserDockerBin = Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\resources\bin"
if (-not (Get-Command docker -ErrorAction SilentlyContinue) -and (Test-Path (Join-Path $perUserDockerBin "docker.exe"))) {
    $env:Path = "$perUserDockerBin;$env:Path"
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "Docker CLI is not installed" }

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$composeFile = Join-Path $projectRoot "compose.production.yaml"
$base = $BaseUrl.TrimEnd('/')
$resolvedEnvFile = (Resolve-Path -LiteralPath $EnvFile).Path
$composeArgs = @("compose", "--env-file", $resolvedEnvFile, "-f", $composeFile)

docker @composeArgs up -d --scale "backend=$BackendReplicas" backend nginx
if ($LASTEXITCODE -ne 0) { throw "Could not scale backend" }

$containers = @(docker @composeArgs ps -q backend | Where-Object { $_ })
if ($containers.Count -lt 2) { throw "Expected at least two backend containers, found $($containers.Count)" }
$victim = $containers[0]

try {
    docker stop $victim | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not stop one backend replica" }
    $failed = 0
    for ($index = 1; $index -le $ChecksWhileDegraded; $index++) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri "$base/api/v1/health/ready" -TimeoutSec 10
            if ($response.StatusCode -ne 200) { $failed++ }
        } catch {
            $failed++
        }
    }
    if ($failed -gt 0) { throw "$failed requests failed while one replica was stopped" }
    Write-Host "[ok] Load balancer served $ChecksWhileDegraded readiness requests with one backend replica stopped"
} finally {
    docker start $victim | Out-Null
}

$deadline = (Get-Date).AddMinutes(2)
do {
    $health = docker inspect --format "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}" $victim 2>$null
    if ($health -eq "healthy") { break }
    Start-Sleep -Seconds 2
} while ((Get-Date) -lt $deadline)
if ($health -ne "healthy") { throw "Stopped backend replica did not recover to healthy" }
Write-Host "[ok] Backend replica recovered after restart"
