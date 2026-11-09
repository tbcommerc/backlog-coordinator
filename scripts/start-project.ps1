[CmdletBinding()]
param(
    [switch]$WithoutAgents,
    [switch]$SkipDependencyInstall,
    [Alias('IncludePrioritiser')]
    [switch]$IncludeValuePriorityAssessor,
    [Alias('IncludeAgentV2')]
    [switch]$IncludeBusinessAnalystExperimental,
    [switch]$IncludeBacklogAssistant
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# Agent V2 is included in the standard launch unless all agents are disabled.
$IncludeBusinessAnalystExperimental = [switch](-not $WithoutAgents)

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
. (Join-Path $PSScriptRoot "agent-common.ps1")
if (Test-Path (Join-Path $projectRoot 'agents/backlog-assistant/.env')) { $IncludeBacklogAssistant = [switch]$true }
if ($WithoutAgents) {
    $IncludeValuePriorityAssessor = [switch]$false
    $IncludeBacklogAssistant = [switch]$false
}
$composeFile = Join-Path $projectRoot "compose.yaml"
$runtimeDir = Join-Path $projectRoot ".runtime"
$venvDir = Join-Path $projectRoot ".venv"
$pythonExe = Join-Path $venvDir "Scripts\python.exe"
$prioritiserVenvDir = Join-Path $projectRoot ".venv-prioritiser"
$prioritiserPythonExe = Join-Path $prioritiserVenvDir "Scripts\python.exe"
$agentV2VenvDir = Join-Path $projectRoot ".venv-agent-v2"
$agentV2PythonExe = Join-Path $agentV2VenvDir "Scripts\python.exe"
$dmbEnv = Join-Path $projectRoot "dmb-backlog\.env"
$agentEnv = Join-Path $projectRoot "agents/business-analyst/.env"
$prioritiserEnv = Join-Path $projectRoot "agents/value-priority-assessor/.env"
$agentV2Env = Join-Path $projectRoot "agents/business-analyst-experimental/.env"
$prioritiserModelCache = Join-Path $runtimeDir "hf-cache"

New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

$perUserDockerBin = Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\resources\bin"
if (-not (Get-Command docker -ErrorAction SilentlyContinue) -and (Test-Path (Join-Path $perUserDockerBin "docker.exe"))) {
    $env:Path = "$perUserDockerBin;$env:Path"
}

if ($IncludeBacklogAssistant) { & (Join-Path $PSScriptRoot 'start-backlog-assistant.ps1') -CheckOnly }
$env:MEETING_ANALYSIS_WORKER_ENABLED = $(if ($WithoutAgents) { 'false' } else { 'true' })
$env:MEETING_ANALYZER_ENABLED = $(if ($WithoutAgents) { 'false' } else { 'true' })


function Set-EnvValue {
    param([string]$Path, [string]$Name, [string]$Value, [switch]$InitializeBlank)
    if (Test-AgentEnvSetting -Path $Path -Name $Name) {
        if (-not $InitializeBlank -or (Get-EnvValue -Path $Path -Name $Name)) { return }
    }
    $line = "$Name=$Value"
    $content = if (Test-Path $Path) { @(Get-Content -LiteralPath $Path -Encoding UTF8) } else { @() }
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
    return Get-AgentEnvValue -Path $Path -Name $Name
}

function Wait-HttpHealth {
    param([string]$Url, [string]$Name, [int]$TimeoutSeconds = 60)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try {
            $response = Invoke-RestMethod -Uri $Url -TimeoutSec 3
            $statusProperty = $response.PSObject.Properties["status"]
            $okProperty = $response.PSObject.Properties["ok"]
            if (($statusProperty -and $statusProperty.Value -in @("ok", "ready", "healthy")) -or
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

function Test-DockerEngine {
    try {
        docker info *> $null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker is not installed. Install Docker Desktop and run this script again."
}

$dockerEngineReady = Test-DockerEngine
if (-not $dockerEngineReady) {
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
            $dockerEngineReady = Test-DockerEngine
        } while (-not $dockerEngineReady -and (Get-Date) -lt $deadline)
    }
    if (-not $dockerEngineReady) {
        throw "Docker Engine is unavailable. Start Docker Desktop and try again."
    }
}

if (-not (Test-Path $dmbEnv)) {
    Copy-Item -LiteralPath (Join-Path $projectRoot "dmb-backlog\.env.example") -Destination $dmbEnv
}
if (-not (Test-Path $agentEnv)) {
    Copy-Item -LiteralPath (Join-Path $projectRoot "agents/business-analyst/.env.example") -Destination $agentEnv
}
if ($IncludeValuePriorityAssessor -and -not (Test-Path $prioritiserEnv)) {
    Copy-Item -LiteralPath (Join-Path $projectRoot "agents/value-priority-assessor/.env.example") -Destination $prioritiserEnv
}
if ($IncludeBusinessAnalystExperimental -and -not (Test-Path $agentV2Env)) {
    Copy-Item -LiteralPath (Join-Path $projectRoot "agents/business-analyst-experimental/.env.example") -Destination $agentV2Env
}

$sharedSecret = Get-EnvValue -Path $agentEnv -Name "AGENT_SECRET"
if (-not $sharedSecret) { $sharedSecret = Get-EnvValue -Path $dmbEnv -Name "AGENT_SECRET" }
if (-not $sharedSecret) { $sharedSecret = "dmb-agent-local-secret-2026" }
$prioritiserSecret = Get-EnvValue -Path $dmbEnv -Name "PRIORITISER_SECRET"
if (-not $prioritiserSecret) { $prioritiserSecret = "dmb-prioritiser-local-secret-2026" }
$agentV2Secret = Get-EnvValue -Path $agentV2Env -Name "AGENT_V2_SECRET"
if (-not $agentV2Secret) { $agentV2Secret = Get-EnvValue -Path $dmbEnv -Name "AGENT_V2_SECRET" }
if (-not $agentV2Secret) { $agentV2Secret = "dmb-agent-v2-local-secret-2026" }

Set-EnvValue $dmbEnv "DEBUG" "true"
Set-EnvValue $dmbEnv "DATABASE_URL" "postgresql+psycopg://dmb:dmb_local_dev@127.0.0.1:5432/dmb_backlog"
Set-EnvValue $dmbEnv "REDIS_URL" "redis://127.0.0.1:6379/0"
# Persist an independent limiter key; do not rotate it on every local start.
if (-not (Get-EnvValue -Path $dmbEnv -Name "AUTH_RATE_HMAC_KEY").Trim('"', "'")) {
    $authRateKeyBytes = New-Object byte[] 32
    $authRateKeyGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $authRateKeyGenerator.GetBytes($authRateKeyBytes) }
    finally { $authRateKeyGenerator.Dispose() }
    Set-EnvValue $dmbEnv "AUTH_RATE_HMAC_KEY" ([Convert]::ToBase64String($authRateKeyBytes)) -InitializeBlank
}
$env:RUN_STARTUP_SEED = "false"
$env:RUN_STARTUP_MAINTENANCE = "false"
Set-EnvValue $dmbEnv "RUN_NOTIFICATION_SCHEDULER" "true"
Set-EnvValue $dmbEnv "AGENT_BASE_URL" "http://127.0.0.1:9000"
Set-EnvValue $dmbEnv "AGENT_SECRET" $sharedSecret
Set-EnvValue $dmbEnv "PRIORITISER_BASE_URL" "http://127.0.0.1:9100"
Set-EnvValue $dmbEnv "PRIORITISER_SECRET" $prioritiserSecret
Set-EnvValue $dmbEnv "PRIORITISER_TIMEOUT_SECONDS" "180"
$env:PRIORITISER_ENABLED = $(if ($IncludeValuePriorityAssessor) { "true" } else { "false" })
$env:AGENT_V2_ENABLED = $(if ($IncludeBusinessAnalystExperimental) { "true" } else { "false" })
Set-EnvValue $agentEnv "DEBUG" "true"
Set-EnvValue $agentEnv "AGENT_PORT" "9000"
Set-EnvValue $agentEnv "SESSION_DATABASE_URL" "postgresql+psycopg://dmb:dmb_local_dev@127.0.0.1:5432/agent_sessions"
Set-EnvValue $agentEnv "AGENT_SECRET" $sharedSecret
$sharedLlmProvider = Get-EnvValue -Path $agentEnv -Name "LLM_PROVIDER"
if (-not $WithoutAgents -and -not $sharedLlmProvider) {
    throw "LLM_PROVIDER is not configured in agents/business-analyst/.env. Configure a real provider before starting the project."
}
if (-not $WithoutAgents -and $sharedLlmProvider.Trim().ToLowerInvariant() -eq "mock") {
    throw "LLM_PROVIDER=mock is test-only and is not allowed by the full project launcher."
}
$sharedOpenAiBaseUrl = Get-EnvValue -Path $agentEnv -Name "OPENAI_BASE_URL"
if (-not $sharedOpenAiBaseUrl) { $sharedOpenAiBaseUrl = "https://api.openai.com/v1" }
$sharedOpenAiModel = Get-EnvValue -Path $agentEnv -Name "OPENAI_MODEL"
if (-not $sharedOpenAiModel) { $sharedOpenAiModel = "gpt-4o-mini" }
if ($IncludeValuePriorityAssessor) {
    $methodologistSecret = Get-EnvValue -Path $prioritiserEnv -Name "PRIORITISER_METHODOLOGIST_SECRET"
    if (-not $methodologistSecret) { $methodologistSecret = "dmb-prioritiser-methodologist-local-secret-2026" }
    foreach ($required in @("PRIORITISER_DB_URL", "PRIORITISER_SERVICE_SECRET", "PRIORITISER_OPENAI_API_KEY", "PRIORITISER_OPENAI_BASE_URL", "PRIORITISER_OPENAI_MODEL")) {
        if (-not (Get-EnvValue -Path $prioritiserEnv -Name $required)) { throw "$required must be configured independently." }
    }
    if ((Get-EnvValue -Path $prioritiserEnv -Name "PRIORITISER_DB_URL") -notlike 'postgresql*') {
        throw "PRIORITISER_DB_URL must use PostgreSQL; SQLite is test-only."
    }
}
if ($IncludeBusinessAnalystExperimental) {
    Set-EnvValue $dmbEnv "AGENT_V2_BASE_URL" "http://127.0.0.1:9300"
    Set-EnvValue $dmbEnv "AGENT_V2_SECRET" $agentV2Secret
    Set-EnvValue $agentV2Env "AGENT_V2_ENABLED" "true"
    Set-EnvValue $agentV2Env "AGENT_V2_PORT" "9300"
    Set-EnvValue $agentV2Env "AGENT_V2_SECRET" $agentV2Secret
    Set-EnvValue $agentV2Env "AGENT_V2_SESSION_DATABASE_URL" "postgresql+psycopg://agent_v2:agent_v2_local_dev@127.0.0.1:5432/agent_v2_sessions"
    $agentV2InheritV1Llm = (Get-EnvValue -Path $agentV2Env -Name "AGENT_V2_INHERIT_V1_LLM").Trim().ToLowerInvariant()
    if ($agentV2InheritV1Llm -notin @("", "true", "false")) {
        throw "AGENT_V2_INHERIT_V1_LLM must be true or false (empty defaults to false)."
    }
    if ($agentV2InheritV1Llm -eq "true") {
        # Explicit inheritance is process-local, never copied to .env.
        Set-AgentV2InheritedModelEnvironment @{
            LLM_PROVIDER=$sharedLlmProvider
            OPENAI_API_KEY=(Get-EnvValue -Path $agentEnv -Name 'OPENAI_API_KEY')
            OPENAI_BASE_URL=$sharedOpenAiBaseUrl
            OPENAI_MODEL=$sharedOpenAiModel
        }
    } else {
        Remove-Item Env:AGENT_V2_EXPLICIT_INHERITANCE -ErrorAction SilentlyContinue
        foreach ($required in @("AGENT_V2_LLM_PROVIDER", "AGENT_V2_OPENAI_API_KEY", "AGENT_V2_OPENAI_BASE_URL", "AGENT_V2_OPENAI_MODEL")) {
            if (-not (Get-EnvValue -Path $agentV2Env -Name $required)) { throw "$required must be configured independently." }
        }
        if ((Get-EnvValue -Path $agentV2Env -Name 'AGENT_V2_LLM_PROVIDER') -ne 'openai_compat') {
            throw 'AGENT_V2_LLM_PROVIDER must be openai_compat.'
        }
    }
}

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

if ($IncludeBusinessAnalystExperimental) {
    Write-Host "Ensuring the isolated fork-based Assistant V2 database and role exist..."
    $agentV2RoleExists = docker compose -f $composeFile exec -T postgres psql -U dmb -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='agent_v2'" | Out-String
    if ($LASTEXITCODE -ne 0) { throw "Agent V2 role check failed." }
    if ($agentV2RoleExists.Trim() -ne "1") {
        docker compose -f $composeFile exec -T postgres psql -U dmb -d postgres -v ON_ERROR_STOP=1 -c "CREATE ROLE agent_v2 LOGIN PASSWORD 'agent_v2_local_dev'"
        if ($LASTEXITCODE -ne 0) { throw "Agent V2 role creation failed." }
    }
    docker compose -f $composeFile exec -T postgres psql -U dmb -d postgres -v ON_ERROR_STOP=1 -c "ALTER ROLE agent_v2 WITH LOGIN PASSWORD 'agent_v2_local_dev'"
    if ($LASTEXITCODE -ne 0) { throw "Agent V2 role configuration failed." }
    $agentV2DatabaseExists = docker compose -f $composeFile exec -T postgres psql -U dmb -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='agent_v2_sessions'" | Out-String
    if ($LASTEXITCODE -ne 0) { throw "Agent V2 database check failed." }
    if ($agentV2DatabaseExists.Trim() -ne "1") {
        docker compose -f $composeFile exec -T postgres psql -U dmb -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE agent_v2_sessions OWNER agent_v2"
        if ($LASTEXITCODE -ne 0) { throw "Agent V2 database creation failed." }
    }
}

if (-not (Test-Path $pythonExe)) {
    Write-Host "Creating Python environment .venv..."
    python -m venv $venvDir
}
if ($IncludeValuePriorityAssessor -and -not (Test-Path $prioritiserPythonExe)) {
    Write-Host "Creating isolated prioritiser environment .venv-prioritiser..."
    python -m venv $prioritiserVenvDir
}
if ($IncludeBusinessAnalystExperimental -and -not (Test-Path $agentV2PythonExe)) {
    Write-Host "Creating isolated fork-based Assistant V2 environment .venv-agent-v2..."
    python -m venv $agentV2VenvDir
}

$requirements = @(
    (Join-Path $projectRoot "dmb-backlog\backend\requirements.txt"),
    (Join-Path $projectRoot "agents/business-analyst/requirements.txt")
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

if ($IncludeValuePriorityAssessor) {
    $prioritiserRequirements = Join-Path $projectRoot "agents/value-priority-assessor/requirements.txt"
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
}

if ($IncludeBusinessAnalystExperimental) {
    $agentV2Requirements = Join-Path $projectRoot "agents/business-analyst-experimental/requirements.txt"
    $agentV2RequirementsHash = (Get-FileHash -LiteralPath $agentV2Requirements -Algorithm SHA256).Hash
    $agentV2StampPath = Join-Path $agentV2VenvDir ".requirements.sha256"
    $installedAgentV2Hash = if (Test-Path $agentV2StampPath) { (Get-Content -Raw $agentV2StampPath).Trim() } else { "" }
    if (-not $SkipDependencyInstall -and $installedAgentV2Hash -ne $agentV2RequirementsHash) {
        Write-Host "Installing fork-based Assistant V2 dependencies in its isolated environment..."
        & $agentV2PythonExe -m pip install --upgrade pip
        & $agentV2PythonExe -m pip install -r $agentV2Requirements
        if ($LASTEXITCODE -ne 0) { throw "Agent V2 dependency installation failed." }
        Set-Content -LiteralPath $agentV2StampPath -Value $agentV2RequirementsHash -Encoding ascii
    }
}

if (-not $WithoutAgents) {
    $sdkTargets = @($pythonExe, $agentV2PythonExe)
    if ($IncludeValuePriorityAssessor) { $sdkTargets += $prioritiserPythonExe }
    if ($IncludeBacklogAssistant) { $sdkTargets += (Join-Path $projectRoot 'agents/backlog-assistant/.venv/Scripts/python.exe') }
    & (Join-Path $PSScriptRoot 'install-agent-contracts.ps1') -BuildPython $pythonExe -TargetPython $sdkTargets -CheckOnly:$SkipDependencyInstall
    if (-not $SkipDependencyInstall) {
        & $pythonExe -m pip install --no-deps --no-build-isolation (Join-Path $projectRoot './agents/meeting-analyzer')
        if ($LASTEXITCODE -ne 0) { throw 'Meeting service package installation failed.' }
    }
}

if (-not $WithoutAgents) {
    $env:DMB_AGENT_LIMITER_MODE = 'global'
    $env:DMB_AGENT_LIMITER_NAMESPACE = 'platform-local'
    $env:DMB_AGENT_LIMITER_STATE_DIR = Join-Path $runtimeDir 'agent-limiter/platform-local'
    Assert-PlatformLimiterCutover -Namespace $env:DMB_AGENT_LIMITER_NAMESPACE -StateDirectory $env:DMB_AGENT_LIMITER_STATE_DIR
    $env:DMB_AGENT_LIMITER_REDIS_URL = Get-EnvValue $dmbEnv 'REDIS_URL'
    if (-not $env:DMB_AGENT_LIMITER_REDIS_URL) { throw 'REDIS_URL is required for the global operation limit.' }
}

Write-Host "Applying PostgreSQL migrations..."
Push-Location (Join-Path $projectRoot "dmb-backlog\backend")
try {
    & $pythonExe -m alembic -c alembic.ini upgrade head
    if ($LASTEXITCODE -ne 0) { throw "Alembic migration failed." }
} finally {
    Pop-Location
}


# Existing owned services are reused; occupied unowned ports are never reclaimed.
if (-not $WithoutAgents) {
    Push-Location (Join-Path $projectRoot 'agents/business-analyst')
    try {
        & $pythonExe -m business_analyst.migrate
        if ($LASTEXITCODE -ne 0) { throw 'Business Analyst schema migration failed.' }
    } finally { Pop-Location }
    Push-Location (Join-Path $projectRoot 'agents/business-analyst-experimental')
    try {
        & $agentV2PythonExe -m business_analyst_experimental.migrate
        if ($LASTEXITCODE -ne 0) { throw 'Experimental Business Analyst schema migration failed.' }
    } finally { Pop-Location }
    Push-Location (Join-Path $projectRoot 'agents/meeting-analyzer')
    try {
        & $pythonExe -m meeting_analyzer.migrate
        if ($LASTEXITCODE -ne 0) { throw 'Meeting Analyzer schema migration failed.' }
    } finally { Pop-Location }
    & (Join-Path $PSScriptRoot 'start-agent.ps1') -Agent 'meeting-analyzer'
    . (Join-Path $PSScriptRoot 'agent-common.ps1')
    $meetingValues = Read-AgentEnvironment (Get-AgentDefinition 'meeting-analyzer')
    $env:MEETING_ANALYZER_SECRET = $meetingValues['MEETING_ANALYZER_SERVICE_SECRET']
    $meetingValues.Clear()
}


$backendOut = Join-Path $runtimeDir "backend.out.log"
$backendErr = Join-Path $runtimeDir "backend.err.log"
if (-not $WithoutAgents) {
    & (Join-Path $PSScriptRoot 'start-agent.ps1') -Agent 'business-analyst'
}
if ($IncludeValuePriorityAssessor) {
    Push-Location (Join-Path $projectRoot 'agents/value-priority-assessor')
    try {
        & $prioritiserPythonExe -m alembic upgrade head
        if ($LASTEXITCODE -ne 0) { throw 'Value/Priority schema migration failed.' }
    } finally { Pop-Location }
    & (Join-Path $PSScriptRoot 'start-agent.ps1') -Agent 'value-priority-assessor'
} else {
    Write-Host "Skipping task prioritiser (use -IncludeValuePriorityAssessor to enable it)."
}
if ($IncludeBusinessAnalystExperimental) {
    & (Join-Path $PSScriptRoot 'start-agent.ps1') -Agent 'business-analyst-experimental'
}

Write-Host "Starting DMB Backlog..."
if ($IncludeBacklogAssistant) {
    & (Join-Path $PSScriptRoot 'start-backlog-assistant.ps1')
}
$backendRecordPath = Join-Path $runtimeDir 'backend.process.json'
$backendRecord = if (Test-Path -LiteralPath $backendRecordPath) { Get-Content -Raw -LiteralPath $backendRecordPath | ConvertFrom-Json } else { $null }
if ($backendRecord) { Assert-AgentRecordReusable $backendRecord.api }
if ($backendRecord -and (Test-AgentOwnedProcess $backendRecord.api)) {
    Write-Host 'DMB Backlog is already owned; checking readiness.'
} else {
    if (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue) {
        throw 'Backend port 8000 is occupied without matching ownership; no process was stopped.'
    }
    $backendProcess = Start-Process -FilePath $pythonExe `
        -ArgumentList @('-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8000') `
        -WorkingDirectory (Join-Path $projectRoot 'dmb-backlog/backend') `
        -RedirectStandardOutput $backendOut -RedirectStandardError $backendErr `
        -WindowStyle Hidden -PassThru
    $backendRecord = @{api=(Get-AgentProcessRecord $backendProcess.Id 'main:app'); worker=$null}
    $backendRecord | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $backendRecordPath -Encoding UTF8
}
Wait-HttpHealth 'http://127.0.0.1:8000/api/v1/health' 'DMB Backlog'
$backendRecord.api = Confirm-AgentListenerOwnership $backendRecord.api 8000
$backendRecord | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $backendRecordPath -Encoding UTF8

Write-Host ""
Write-Host "Project is fully running."
Write-Host "Application: http://127.0.0.1:8000"
Write-Host "Backend API: http://127.0.0.1:8000/docs"
if (-not $WithoutAgents) { Write-Host "Business Analyst API: http://127.0.0.1:9000/docs" }
else { Write-Host "All AI agents: disabled for this run" }
if ($IncludeValuePriorityAssessor) {
    Write-Host "Prioritiser API: http://127.0.0.1:9100/docs"
} else {
    Write-Host "Prioritiser API: disabled for this run"
}
if ($IncludeBusinessAnalystExperimental) {
    Write-Host "Experimental Business Analyst API: http://127.0.0.1:9300/docs"
} else {
    Write-Host "Experimental Business Analyst API: disabled for this run"
}
Write-Host "Logs: $runtimeDir"
