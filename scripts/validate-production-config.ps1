[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$perUserDockerBin = Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\resources\bin"
if (-not (Get-Command docker -ErrorAction SilentlyContinue) -and (Test-Path (Join-Path $perUserDockerBin "docker.exe"))) {
    $env:Path = "$perUserDockerBin;$env:Path"
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "Docker CLI is not installed" }

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$composeFile = Join-Path $projectRoot "compose.production.yaml"
$nginxConfig = Join-Path $projectRoot "infrastructure\nginx\dmb.container.conf"
$otelConfig = Join-Path $projectRoot "infrastructure\observability\otel-collector.yaml"

$temporaryValues = @{
    DMB_POSTGRES_PASSWORD = "validation-only-postgres"
    DMB_REDIS_PASSWORD = "validation-only-redis"
    DMB_DATABASE_URL = "postgresql+psycopg://dmb:validation-only-postgres@postgres:5432/dmb_backlog"
    DMB_AGENT_SESSION_DATABASE_URL = "postgresql+psycopg://dmb:validation-only-postgres@postgres:5432/agent_sessions"
    DMB_PRIORITISER_DATABASE_URL = "postgresql+psycopg://dmb:validation-only-postgres@postgres:5432/prioritiser"
    DMB_REDIS_URL = "redis://:validation-only-redis@redis:6379/0"
    DMB_SECRET_KEY = "validation-only-secret-key-32-characters"
    DMB_AGENT_SECRET = "validation-only-agent-secret"
    DMB_PRIORITISER_SECRET = "validation-only-prioritiser-secret"
    DMB_PRIORITISER_METHODOLOGIST_SECRET = "validation-only-methodologist-secret"
    DMB_CORS_ORIGINS = '["https://validation.invalid"]'
    DMB_LLM_PROVIDER = "openai_compat"
    DMB_OPENAI_API_KEY = "validation-only-provider-key"
}
$previous = @{}
foreach ($name in $temporaryValues.Keys) {
    $previous[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
    [Environment]::SetEnvironmentVariable($name, $temporaryValues[$name], "Process")
}

try {
    docker compose -f $composeFile config --quiet
    if ($LASTEXITCODE -ne 0) { throw "Docker Compose configuration is invalid" }

    $nginxConfigForDocker = $nginxConfig -replace '\\', '/'
    docker run --rm -v "${nginxConfigForDocker}:/etc/nginx/conf.d/default.conf:ro" nginx:1.27-alpine@sha256:62223d644fa234c3a1cc785ee14242ec47a77364226f1c811d2f669f96dc2ac8 nginx -t
    if ($LASTEXITCODE -ne 0) { throw "Nginx configuration is invalid" }

    $otelDir = (Split-Path -Parent $otelConfig) -replace '\\', '/'
    docker run --rm -v "${otelDir}:/config:ro" otel/opentelemetry-collector-contrib:0.132.0@sha256:0b3b73f3d10af5f08c04b6ef3958f272d0866b2437033c31a4952773dfa178b7 validate --config=/config/otel-collector.yaml
    if ($LASTEXITCODE -ne 0) { throw "OpenTelemetry Collector configuration is invalid" }

    Write-Host "[ok] Production Compose, Nginx and OpenTelemetry Collector configurations are valid"
} finally {
    foreach ($name in $temporaryValues.Keys) {
        [Environment]::SetEnvironmentVariable($name, $previous[$name], "Process")
    }
}
