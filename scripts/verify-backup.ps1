[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ManifestPath
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$perUserDockerBin = Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\resources\bin"
if (-not (Get-Command docker -ErrorAction SilentlyContinue) -and (Test-Path (Join-Path $perUserDockerBin "docker.exe"))) {
    $env:Path = "$perUserDockerBin;$env:Path"
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "Docker CLI is not installed" }

$manifestFile = Get-Item -LiteralPath $ManifestPath
$baseDir = $manifestFile.DirectoryName
$manifest = Get-Content -Raw -LiteralPath $manifestFile.FullName | ConvertFrom-Json

foreach ($entry in $manifest.files) {
    $path = Join-Path $baseDir $entry.name
    if (-not (Test-Path -LiteralPath $path)) { throw "Missing backup artifact: $($entry.name)" }
    $item = Get-Item -LiteralPath $path
    if ($item.Length -ne [long]$entry.bytes) { throw "Size mismatch: $($entry.name)" }
    $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hash -ne $entry.sha256) { throw "Checksum mismatch: $($entry.name)" }
    if ($entry.name -like "*.dump") {
        docker run --rm -v "${baseDir}:/backup:ro" postgres:16-alpine@sha256:075f7ba66bc9b3ce7d6b8b635208ff61cd7cf1a67d71ec530eec5d7ae0cbe571 pg_restore --list "/backup/$($entry.name)" *> $null
        if ($LASTEXITCODE -ne 0) { throw "pg_restore could not read $($entry.name)" }
    } elseif ($entry.name -like "*.tgz") {
        docker run --rm -v "${baseDir}:/backup:ro" alpine:3.22@sha256:7c8cb692ae09657cbc4a3f3cbd0e8d5a2690ba38386aaaf252dbb060bf5eb2e6 tar -tzf "/backup/$($entry.name)" *> $null
        if ($LASTEXITCODE -ne 0) { throw "tar could not read $($entry.name)" }
    }
    Write-Host "[ok] $($entry.name)"
}

Write-Host "[ok] Backup integrity verified. A separate isolated restore drill is still required to prove RTO/RPO."
