[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$EnvFile,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [string]$VolumePrefix = "dmb-platform",
    [switch]$QuiesceApplications
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
$resolvedEnvFile = (Resolve-Path -LiteralPath $EnvFile).Path
$composeArgs = @("compose", "--env-file", $resolvedEnvFile, "-f", $composeFile)
$target = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $target | Out-Null
$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")

if (-not $QuiesceApplications) {
    throw "Use -QuiesceApplications to create a cross-database/uploads consistent backup. Online storage snapshots require a platform-specific runbook."
}

function Export-Database {
    param([string]$Database, [string]$Destination)
    $arguments = @($composeArgs + @("exec", "-T", "postgres", "pg_dump", "-U", "dmb", "-d", $Database, "-Fc", "--no-owner", "--no-acl"))
    $process = Start-Process -FilePath "docker" -ArgumentList $arguments -NoNewWindow -Wait -PassThru -RedirectStandardOutput $Destination
    if ($process.ExitCode -ne 0) { throw "pg_dump failed for $Database" }
    if ((Get-Item -LiteralPath $Destination).Length -eq 0) { throw "Empty dump created for $Database" }
}

docker @composeArgs ps postgres *> $null
if ($LASTEXITCODE -ne 0) { throw "Production PostgreSQL service is not available" }

$backlogDump = Join-Path $target "dmb_backlog_$stamp.dump"
$agentDump = Join-Path $target "agent_sessions_$stamp.dump"
$attachmentsArchive = Join-Path $target "attachments_$stamp.tgz"
try {
    docker @composeArgs stop nginx backend agent scheduler
    if ($LASTEXITCODE -ne 0) { throw "Could not quiesce application writers" }

    Export-Database "dmb_backlog" $backlogDump
    Export-Database "agent_sessions" $agentDump

    $targetForDocker = $target -replace '\\', '/'
    docker run --rm -v "${VolumePrefix}-attachments:/source:ro" -v "${targetForDocker}:/backup" alpine:3.22 tar -czf "/backup/$(Split-Path -Leaf $attachmentsArchive)" -C /source .
    if ($LASTEXITCODE -ne 0) { throw "Attachment archive failed" }
} finally {
    docker @composeArgs up -d agent backend scheduler nginx
    if ($LASTEXITCODE -ne 0) { Write-Error "Backup finished with an application restart failure" }
}

$files = @($backlogDump, $agentDump, $attachmentsArchive)
$manifest = [pscustomobject]@{
    created_at = (Get-Date).ToUniversalTime().ToString("o")
    format = 1
    files = @($files | ForEach-Object {
        $item = Get-Item -LiteralPath $_
        [pscustomobject]@{ name = $item.Name; bytes = $item.Length; sha256 = (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant() }
    })
}
$manifestPath = Join-Path $target "manifest_$stamp.json"
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding utf8
Write-Host "[ok] Backup created in $target"
Write-Warning "Backup contains application data. Move it to encrypted storage with restricted access."
