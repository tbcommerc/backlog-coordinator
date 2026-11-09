[CmdletBinding()]
param([Parameter(Mandatory)][string]$BuildPython, [Parameter(Mandatory)][string[]]$TargetPython, [switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$source = Join-Path $root 'packages/dmb-agent-contracts'
$version = '1.4.1'
if ($CheckOnly) {
    foreach ($python in $TargetPython) {
        & $python -c "import importlib.metadata,hashlib,pathlib,sys; import httpx,jsonschema,sqlalchemy,fastapi; import dmb_agent_contracts; assert importlib.metadata.version('dmb-agent-contracts') == '$version'; src=pathlib.Path(sys.argv[1])/'dmb_agent_contracts'; dst=pathlib.Path(dmb_agent_contracts.__file__).parent; files=[p.relative_to(src) for p in src.rglob('*') if p.is_file() and p.suffix in ('.py','.json')]; assert all((dst/p).is_file() and hashlib.sha256((src/p).read_bytes()).digest()==hashlib.sha256((dst/p).read_bytes()).digest() for p in files), 'Installed contracts differ from current source'" $source
        if ($LASTEXITCODE -ne 0) { throw "Install dmb-agent-contracts $version in the selected environment before using SkipDependencyInstall." }
    }
    return
}
$wheelDir = Join-Path $root '.runtime/agent-wheels'
New-Item -ItemType Directory -Force -Path $wheelDir | Out-Null
$inputs = @((Get-Item (Join-Path $source 'pyproject.toml')))
$inputs += @(Get-ChildItem (Join-Path $source 'dmb_agent_contracts') -Recurse -File | Where-Object { $_.Extension -in @('.py','.json') })
$fingerprint = ($inputs | Sort-Object FullName | ForEach-Object { $_.FullName.Substring($source.Length) + ':' + (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }) -join "`n"
$hasher = [Security.Cryptography.SHA256]::Create()
try { $sourceHash = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($fingerprint))).Replace('-','') }
finally { $hasher.Dispose() }
$wheel = Join-Path $wheelDir "dmb_agent_contracts-$version-py3-none-any.whl"
$manifestPath = Join-Path $wheelDir 'dmb-agent-contracts.build.json'
$manifest = if (Test-Path $manifestPath) { Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json } else { $null }
if (-not (Test-Path $wheel) -or -not $manifest -or $manifest.source_hash -ne $sourceHash -or
    $manifest.wheel_hash -ne (Get-FileHash -LiteralPath $wheel -Algorithm SHA256).Hash) {
    & $BuildPython -m pip wheel --no-deps --wheel-dir $wheelDir $source
    if ($LASTEXITCODE -ne 0) { throw 'Shared contracts wheel build failed.' }
    $manifest = @{source_hash=$sourceHash; wheel_hash=(Get-FileHash -LiteralPath $wheel -Algorithm SHA256).Hash; version=$version}
    $manifest | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding UTF8
}
foreach ($python in $TargetPython) {
    if (-not (Test-Path -LiteralPath $python)) { throw 'Agent Python environment missing.' }
    $stamp = Join-Path (Split-Path (Split-Path $python -Parent) -Parent) '.dmb-agent-contracts.sha256'
    $installed = if (Test-Path $stamp) { (Get-Content -Raw -LiteralPath $stamp).Trim() } else { '' }
    if ($installed -ne $manifest.wheel_hash) {
        & $python -m pip install --no-index --no-deps --force-reinstall $wheel
        if ($LASTEXITCODE -ne 0) { throw 'Shared contracts wheel installation failed.' }
        Set-Content -LiteralPath $stamp -Value $manifest.wheel_hash -Encoding ascii
    }
    & $python -c "import httpx,jsonschema,sqlalchemy,fastapi; from dmb_agent_contracts.go import GoModel; from dmb_agent_contracts.run_worker import Worker"
    if ($LASTEXITCODE -ne 0) { throw 'Agent runtime dependencies are incomplete. Install its hash-locked requirements before starting.' }
}
