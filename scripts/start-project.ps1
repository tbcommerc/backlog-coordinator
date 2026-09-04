[CmdletBinding()]
param(
    [switch]$SkipDependencyInstall
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$composeFile = Join-Path $projectRoot "compose.yaml"
$runtimeDir = Join-Path $projectRoot ".runtime"
$venvDir = Join-Path $projectRoot ".venv"
$pythonExe = Join-Path $venvDir "Scripts\python.exe"
$prioritiserVenvDir = Join-Path $projectRoot ".venv-prioritiser"
$prioritiserPythonExe = Join-Path $prioritiserVenvDir "Scripts\python.exe"
$dmbEnv = Join-Path $projectRoot "dmb-backlog\.env"
$agentEnv = Join-Path $projectRoot "agent\.env"
$prioritiserEnv = Join-Path $projectRoot "prioritiser-agent\.env"

New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

$perUserDockerBin = Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\resources\bin"
if (-not (Get-Command docker -ErrorAction SilentlyContinue) -and (Test-Path (Join-Path $perUserDockerBin "docker.exe"))) {
    $env:Path = "$perUserDockerBin;$env:Path"
}

function Set-EnvValue {
    param([string]$Path, [string]$Name, [string]$Value)
    $line = "$Name=$Value"
    $content = if (Test-Path $Path) { @(Get-Content -LiteralPath $Path) } else { @() }
    $pattern = "^$([regex]::Escape($Name))="
    $found = $false
    $updated = foreach ($entry in $content) {
        if (-not $found -and $entry -match $pattern) {
            $found = $true
            $line
        } else {
            $entry
        }
    }
    if (-not $found) { $updated += $line }
    Set-Content -LiteralPath $Path -Value $updated -Encoding utf8
}

function Get-EnvValue {
    param([string]$Path, [string]$Name)
    if (-not (Test-Path $Path)) { return "" }
    $pattern = "^$([regex]::Escape($Name))=(.*)$"
    foreach ($entry in Get-Content -LiteralPath $Path) {
        if ($entry -match $pattern) { return $Matches[1].Trim() }
    }
    return ""
}

function Wait-HttpHealth {
    param([string]$Url, [string]$Name, [int]$TimeoutSeconds = 60)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try {
            $response = Invoke-RestMethod -Uri $Url -TimeoutSec 3
            $statusProperty = $response.PSObject.Properties["status"]
            $okProperty = $response.PSObject.Properties["ok"]
            if (($statusProperty -and $statusProperty.Value -eq "ok") -or
                ($okProperty -and $okProperty.Value -eq $true)) {
                Write-Host "[ok] $Name"
                return
            }
        } catch {
            Start-Sleep -Seconds 1
        }
    } while ((Get-Date) -lt $deadline)
    throw "$Name health check failed: $Url"
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker is not installed. Install Docker Desktop and run this script again."
}

docker info *> $null
if ($LASTEXITCODE -ne 0) {
    $dockerDesktopCandidates = @(
        (Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\Docker Desktop.exe"),
        (Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe")
    )
    $dockerDesktop = $dockerDesktopCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if ($dockerDesktop) {
        Write-Host "Starting Docker Desktop..."
        Start-Process -FilePath $dockerDesktop -WindowStyle Hidden | Out-Null
        $deadline = (Get-Date).AddSeconds(120)
        do {
            Start-Sleep -Seconds 2
            docker info *> $null
        } while ($LASTEXITCODE -ne 0 -and (Get-Date) -lt $deadline)
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Engine is unavailable. Start Docker Desktop and try again."
    }
}

if (-not (Test-Path $dmbEnv)) {
    Copy-Item -LiteralPath (Join-Path $projectRoot "dmb-backlog\.env.example") -Destination $dmbEnv
}
if (-not (Test-Path $agentEnv)) {
    Copy-Item -LiteralPath (Join-Path $projectRoot "agent\.env.example") -Destination $agentEnv
}
if (-not (Test-Path $prioritiserEnv)) {
    Copy-Item -LiteralPath (Join-Path $projectRoot "prioritiser-agent\.env.example") -Destination $prioritiserEnv
}

$sharedSecret = Get-EnvValue -Path $agentEnv -Name "AGENT_SECRET"
if (-not $sharedSecret) { $sharedSecret = Get-EnvValue -Path $dmbEnv -Name "AGENT_SECRET" }
if (-not $sharedSecret) { $sharedSecret = "dmb-agent-local-secret-2026" }

Set-EnvValue $dmbEnv "DEBUG" "true"
Set-EnvValue $dmbEnv "DATABASE_URL" "postgresql+psycopg://dmb:dmb_local_dev@127.0.0.1:5432/dmb_backlog"
Set-EnvValue $dmbEnv "REDIS_URL" "redis://127.0.0.1:6379/0"
Set-EnvValue $dmbEnv "RUN_STARTUP_SEED" "false"
Set-EnvValue $dmbEnv "RUN_STARTUP_MAINTENANCE" "false"
Set-EnvValue $dmbEnv "RUN_NOTIFICATION_SCHEDULER" "true"
Set-EnvValue $dmbEnv "AGENT_BASE_URL" "http://127.0.0.1:9000"
Set-EnvValue $dmbEnv "AGENT_SECRET" $sharedSecret
Set-EnvValue $dmbEnv "PRIORITISER_BASE_URL" "http://127.0.0.1:9100"
Set-EnvValue $dmbEnv "PRIORITISER_TIMEOUT_SECONDS" "180"
Set-EnvValue $agentEnv "DEBUG" "true"
Set-EnvValue $agentEnv "AGENT_PORT" "9000"
Set-EnvValue $agentEnv "SESSION_DATABASE_URL" "postgresql+psycopg://dmb:dmb_local_dev@127.0.0.1:5432/agent_sessions"
Set-EnvValue $agentEnv "AGENT_SECRET" $sharedSecret
Set-EnvValue $prioritiserEnv "PRIORITISER_DB_URL" "sqlite:///var/prioritiser.db"
$sharedLlmProvider = Get-EnvValue -Path $agentEnv -Name "LLM_PROVIDER"
if (-not $sharedLlmProvider) {
    throw "LLM_PROVIDER is not configured in agent/.env. Configure a real provider before starting the project."
}
if ($sharedLlmProvider.Trim().ToLowerInvariant() -eq "mock") {
    throw "LLM_PROVIDER=mock is test-only and is not allowed by the full project launcher."
}
$sharedOpenAiBaseUrl = Get-EnvValue -Path $agentEnv -Name "OPENAI_BASE_URL"
if (-not $sharedOpenAiBaseUrl) { $sharedOpenAiBaseUrl = "https://api.openai.com/v1" }
$sharedOpenAiModel = Get-EnvValue -Path $agentEnv -Name "OPENAI_MODEL"
if (-not $sharedOpenAiModel) { $sharedOpenAiModel = "gpt-4o-mini" }
Set-EnvValue $prioritiserEnv "PRIORITISER_LLM_PROVIDER" $sharedLlmProvider
Set-EnvValue $prioritiserEnv "PRIORITISER_OPENAI_API_KEY" (Get-EnvValue -Path $agentEnv -Name "OPENAI_API_KEY")
Set-EnvValue $prioritiserEnv "PRIORITISER_OPENAI_BASE_URL" $sharedOpenAiBaseUrl
Set-EnvValue $prioritiserEnv "PRIORITISER_OPENAI_MODEL" $sharedOpenAiModel

Write-Host "Starting PostgreSQL and Redis..."
docker compose -f $composeFile up -d
if ($LASTEXITCODE -ne 0) { throw "Docker Compose failed to start." }

$deadline = (Get-Date).AddSeconds(90)
do {
    $postgresStatus = docker compose -f $composeFile ps --format json postgres 2>$null | Out-String
    $redisStatus = docker compose -f $composeFile ps --format json redis 2>$null | Out-String
    if ($postgresStatus -match 'healthy' -and $redisStatus -match 'healthy') { break }
    Start-Sleep -Seconds 2
} while ((Get-Date) -lt $deadline)
if ($postgresStatus -notmatch 'healthy' -or $redisStatus -notmatch 'healthy') {
    throw "PostgreSQL or Redis did not become healthy. Run: docker compose logs"
}

if (-not (Test-Path $pythonExe)) {
    Write-Host "Creating Python environment .venv..."
    python -m venv $venvDir
}
if (-not (Test-Path $prioritiserPythonExe)) {
    Write-Host "Creating isolated prioritiser environment .venv-prioritiser..."
    python -m venv $prioritiserVenvDir
}

$requirements = @(
    (Join-Path $projectRoot "dmb-backlog\backend\requirements.txt"),
    (Join-Path $projectRoot "agent\requirements.txt")
)
$requirementsHash = ($requirements | ForEach-Object { (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash }) -join ""
$stampPath = Join-Path $venvDir ".requirements.sha256"
$installedHash = if (Test-Path $stampPath) { (Get-Content -Raw $stampPath).Trim() } else { "" }
if (-not $SkipDependencyInstall -and $installedHash -ne $requirementsHash) {
    Write-Host "Installing Python dependencies..."
    & $pythonExe -m pip install --upgrade pip
    & $pythonExe -m pip install -r $requirements[0] -r $requirements[1]
    if ($LASTEXITCODE -ne 0) { throw "Python dependency installation failed." }
    Set-Content -LiteralPath $stampPath -Value $requirementsHash -Encoding ascii
}

$prioritiserRequirements = Join-Path $projectRoot "prioritiser-agent\requirements.txt"
$prioritiserRequirementsHash = (Get-FileHash -LiteralPath $prioritiserRequirements -Algorithm SHA256).Hash
$prioritiserStampPath = Join-Path $prioritiserVenvDir ".requirements.sha256"
$installedPrioritiserHash = if (Test-Path $prioritiserStampPath) { (Get-Content -Raw $prioritiserStampPath).Trim() } else { "" }
if (-not $SkipDependencyInstall -and $installedPrioritiserHash -ne $prioritiserRequirementsHash) {
    Write-Host "Installing prioritiser dependencies in its isolated environment..."
    & $prioritiserPythonExe -m pip install --upgrade pip
    & $prioritiserPythonExe -m pip install -r $prioritiserRequirements
    if ($LASTEXITCODE -ne 0) { throw "Prioritiser dependency installation failed." }
    Set-Content -LiteralPath $prioritiserStampPath -Value $prioritiserRequirementsHash -Encoding ascii
}

Write-Host "Applying PostgreSQL migrations..."
Push-Location (Join-Path $projectRoot "dmb-backlog\backend")
try {
    & $pythonExe -m alembic -c alembic.ini upgrade head
    if ($LASTEXITCODE -ne 0) { throw "Alembic migration failed." }
} finally {
    Pop-Location
}

& (Join-Path $PSScriptRoot "stop-project.ps1") -KeepInfrastructure -Quiet

$agentOut = Join-Path $runtimeDir "agent.out.log"
$agentErr = Join-Path $runtimeDir "agent.err.log"
$prioritiserOut = Join-Path $runtimeDir "prioritiser.out.log"
$prioritiserErr = Join-Path $runtimeDir "prioritiser.err.log"
$backendOut = Join-Path $runtimeDir "backend.out.log"
$backendErr = Join-Path $runtimeDir "backend.err.log"

Write-Host "Starting AI agent..."
$agentProcess = Start-Process -FilePath $pythonExe `
    -ArgumentList @("-m", "uvicorn", "agent.main:app", "--host", "127.0.0.1", "--port", "9000") `
    -WorkingDirectory (Join-Path $projectRoot "agent") `
    -RedirectStandardOutput $agentOut -RedirectStandardError $agentErr `
    -WindowStyle Hidden -PassThru
Set-Content -LiteralPath (Join-Path $runtimeDir "agent.pid") -Value $agentProcess.Id -Encoding ascii
Wait-HttpHealth "http://127.0.0.1:9000/api/agent/health" "AI agent"

Write-Host "Starting task prioritiser..."
$prioritiserProcess = Start-Process -FilePath $prioritiserPythonExe `
    -ArgumentList @("-m", "uvicorn", "app.api.main:app", "--host", "127.0.0.1", "--port", "9100") `
    -WorkingDirectory (Join-Path $projectRoot "prioritiser-agent") `
    -RedirectStandardOutput $prioritiserOut -RedirectStandardError $prioritiserErr `
    -WindowStyle Hidden -PassThru
Set-Content -LiteralPath (Join-Path $runtimeDir "prioritiser.pid") -Value $prioritiserProcess.Id -Encoding ascii
Wait-HttpHealth "http://127.0.0.1:9100/health" "Task prioritiser"

Write-Host "Starting DMB Backlog..."
$backendProcess = Start-Process -FilePath $pythonExe `
    -ArgumentList @("-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000") `
    -WorkingDirectory (Join-Path $projectRoot "dmb-backlog\backend") `
    -RedirectStandardOutput $backendOut -RedirectStandardError $backendErr `
    -WindowStyle Hidden -PassThru
Set-Content -LiteralPath (Join-Path $runtimeDir "backend.pid") -Value $backendProcess.Id -Encoding ascii
Wait-HttpHealth "http://127.0.0.1:8000/api/v1/health" "DMB Backlog"

Write-Host ""
Write-Host "Project is fully running."
Write-Host "Application: http://127.0.0.1:8000"
Write-Host "Backend API: http://127.0.0.1:8000/docs"
Write-Host "AI agent API: http://127.0.0.1:9000/docs"
Write-Host "Prioritiser API: http://127.0.0.1:9100/docs"
Write-Host "Logs: $runtimeDir"
