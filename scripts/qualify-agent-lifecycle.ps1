[CmdletBinding()]
param([switch]$IncludeValuePriorityAssessor, [string]$PostgresContainer='dmb-agent-qualification', [ValidatePattern('^[0-9a-f]{64}$')][string]$PostgresContainerId='35cb9090e1eef1e274c7b520a7e7628a6fa5f42b9d1a038730fb54154470fed7', [int]$PostgresPort=51600, [ValidateSet('business-analyst','business-analyst-experimental','meeting-analyzer','backlog-assistant','value-priority-assessor')][string[]]$Agent, [string]$EncoderCachePath, [string]$RagIndexPath)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'agent-common.ps1')
$root=$script:agentRoot
$instance='qualification-'+[guid]::NewGuid().ToString('N').Substring(0,8)
$evidence=Join-Path $root ('.runtime/agent-services-evidence/'+$instance)
New-Item -ItemType Directory -Path $evidence -Force | Out-Null
$containerId=(& docker inspect --format '{{.Id}}' $PostgresContainer).Trim()
if ($LASTEXITCODE -ne 0 -or $containerId -ne $PostgresContainerId) {
    throw 'Disposable PostgreSQL identity mismatch; no database was changed.'
}
$savedEnvironment=@{}
foreach ($item in Get-ChildItem Env:) { $savedEnvironment[$item.Name]=$item.Value }
$report=@{scope='isolated_native_lifecycle';instance=$instance;model_calls=0;protected_writes=0;services=@()}
$services=@('business-analyst','business-analyst-experimental','meeting-analyzer','backlog-assistant','value-priority-assessor')
if ($Agent) { $services=@($services | Where-Object { $_ -in $Agent }) }
$usedPorts=New-Object 'System.Collections.Generic.HashSet[int]'
function New-FreePort {
    do {
        # Stay outside Windows' verified dynamic client range 49152..65535.
        # Otherwise a probe's outgoing socket can occupy the API port between cycles.
        $number=Get-Random -Minimum 20000 -Maximum 40000
        $available=$false
        $probe=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$number)
        try { $probe.Start(); $available=$true } catch [Net.Sockets.SocketException] { }
        finally { $probe.Stop() }
    } while (-not $available -or -not $usedPorts.Add($number))
    return $number
}
function Invoke-OwnPython($definition,[string]$Script,[string[]]$Arguments) {
    Push-Location $definition.directory
    try {
        & $definition.python -c "import runpy,sys; runpy.run_path(sys.argv.pop(1),run_name='__main__')" (Join-Path $PSScriptRoot $Script) @Arguments
        if ($LASTEXITCODE -ne 0) { throw "Service-local helper failed: $Script" }
    } finally { Pop-Location }
}
try {
    $env:RUN_STARTUP_SEED='false'
    $env:RUN_STARTUP_MAINTENANCE='false'
    foreach ($service in $services) {
        $entry=@{service=$service;status='NOT_RUN';cycles=@();reason=$null}
        $report.services+=,$entry
        if ($service -eq 'value-priority-assessor' -and -not $IncludeValuePriorityAssessor) {
            $entry.reason='explicit_assessor_flag_required'
            continue
        }
        $definition=Get-AgentDefinition $service $instance
        $port=New-FreePort
        $dataPort=if ($service -eq 'backlog-assistant') { New-FreePort } else { 0 }
        try {
            if ($true) {
                $database=$service.Replace('-','_')+'_lifecycle_'+[guid]::NewGuid().ToString('N').Substring(0,8)
                if ($database -notmatch '^[a-z0-9_]+$') { throw 'Invalid disposable database name.' }
                & docker exec $PostgresContainer psql -U postgres -c "CREATE DATABASE $database" | Out-Null
                if ($LASTEXITCODE -ne 0) { throw 'Disposable database creation failed.' }
                $url="postgresql+psycopg://postgres@127.0.0.1:$PostgresPort/$database"
                $name=switch ($service) {
                    'business-analyst' { 'AGENT_DATABASE_URL' }
                    'business-analyst-experimental' { 'AGENT_V2_DATABASE_URL' }
                    'meeting-analyzer' { 'MEETING_ANALYZER_DATABASE_URL' }
                    'backlog-assistant' { 'BACKLOG_ASSISTANT_DATABASE_URL' }
                    'value-priority-assessor' { 'PRIORITISER_DATABASE_URL' }
                }
                [Environment]::SetEnvironmentVariable($name,$url,'Process')
                Invoke-OwnPython $definition 'prepare-agent-lifecycle.py' @('--service',$service,'--database',$database)
                $entry.database=$database
            }
            if ($service -eq 'value-priority-assessor') {
                # A fresh service-owned schema avoids touching existing assessor history.
                $entry.stage='offline_encoder_cache'
                if ($EncoderCachePath) {
                    $cache=[IO.Path]::GetFullPath($EncoderCachePath)
                    $runtimePrefix=[IO.Path]::GetFullPath((Join-Path $root '.runtime'))+[IO.Path]::DirectorySeparatorChar
                    if (-not $cache.StartsWith($runtimePrefix,[StringComparison]::OrdinalIgnoreCase) -or
                        -not (Test-Path -LiteralPath (Join-Path $cache 'models--intfloat--multilingual-e5-base/snapshots/d13f1b27baf31030b7fd040960d60d909913633f/modules.json'))) { throw 'Invalid verified workspace encoder cache.' }
                } else {
                    $cache=Join-Path $root ('.runtime/'+$instance+'-encoder-cache')
                    & (Join-Path $root '.venv/Scripts/python.exe') (Join-Path $PSScriptRoot 'export-assessor-encoder-cache.py') --target $cache
                    if ($LASTEXITCODE -ne 0) { throw 'Offline encoder cache prerequisite failed.' }
                }
                $env:PRIORITISER_RAG_MODEL_CACHE_DIR=$cache
                $env:PRIORITISER_RAG_LOCAL_FILES_ONLY='true'
                $env:PRIORITISER_RAG_ALLOW_K3='false'
                $env:CUDA_VISIBLE_DEVICES='-1'
                $env:OMP_NUM_THREADS='2'
                $env:MKL_NUM_THREADS='2'
                if ($RagIndexPath) {
                    $index=[IO.Path]::GetFullPath($RagIndexPath)
                    $runtimePrefix=[IO.Path]::GetFullPath((Join-Path $root '.runtime'))+[IO.Path]::DirectorySeparatorChar
                    if (-not $index.StartsWith($runtimePrefix,[StringComparison]::OrdinalIgnoreCase) -or
                        -not (Test-Path -LiteralPath (Join-Path $index 'vector-meta.json')) -or
                        -not (Test-Path -LiteralPath (Join-Path $index 'vector.faiss'))) { throw 'Invalid prepared workspace RAG index.' }
                    $ownIndex=Join-Path $evidence 'rag-index'
                    New-Item -ItemType Directory -Path $ownIndex | Out-Null
                    Copy-Item -LiteralPath (Join-Path $index 'vector-meta.json'),(Join-Path $index 'vector.faiss') -Destination $ownIndex
                    Get-ChildItem -LiteralPath $index -File | Where-Object { $_.Name -match '^analogy-[0-9a-f]{16}\.faiss$' } | Copy-Item -Destination $ownIndex
                    $env:PRIORITISER_RAG_INDEX_DIR=$ownIndex
                    $entry.rag_index='prepared_workspace_index'
                } else {
                    $env:PRIORITISER_RAG_INDEX_DIR=Join-Path $evidence 'rag-index'
                    $entry.rag_index='cold_isolated_index'
                }
                $entry.storage_scope='disposable_own_technical_history'
                $entry.encoder='pinned_prepacked_cpu_cache'
            }
            if ($service -eq 'backlog-assistant') {
                $env:DMB_DATA_API_URL="https://127.0.0.1:$dataPort"
            }
            $entry.stage='storage_before'
            $before=Join-Path $evidence ($service+'.before.json')
            Invoke-OwnPython $definition 'agent-storage-manifest.py' @('--service',$service,'--output',$before)
            for ($cycle=1;$cycle -le 2;$cycle++) {
                $entry.stage='start_'+$cycle
                & (Join-Path $PSScriptRoot 'start-agent.ps1') -Agent $service -Instance $instance -Port $port -DataPort $dataPort
                $first=Get-Content -Raw -LiteralPath $definition.record | ConvertFrom-Json
                & (Join-Path $PSScriptRoot 'start-agent.ps1') -Agent $service -Instance $instance -Port $port -DataPort $dataPort
                $second=Get-Content -Raw -LiteralPath $definition.record | ConvertFrom-Json
                if ($first.api.pid -ne $second.api.pid -or -not (Test-AgentOwnedProcess $second.api)) { throw 'Duplicate or unverified API process.' }
                if ($first.worker -and ($first.worker.pid -ne $second.worker.pid -or -not (Test-AgentOwnedProcess $second.worker))) { throw 'Duplicate or unverified worker.' }
                & (Join-Path $PSScriptRoot 'agent-status.ps1') -Agent $service -Instance $instance
                & (Join-Path $PSScriptRoot 'stop-agent.ps1') -Agent $service -Instance $instance
                & (Join-Path $PSScriptRoot 'stop-agent.ps1') -Agent $service -Instance $instance
                if ((Test-AgentOwnedProcess $first.api) -or ($first.worker -and (Test-AgentOwnedProcess $first.worker))) { throw 'Owned process survived stop.' }
                if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw 'API listener survived stop.' }
                if ($dataPort -and (Get-NetTCPConnection -LocalPort $dataPort -State Listen -ErrorAction SilentlyContinue)) { throw 'Data API listener survived stop.' }
                $entry.cycles+=,@{cycle=$cycle;status='PASS';api_pid=$first.api.pid;port=$port}
            }
            $after=Join-Path $evidence ($service+'.after.json')
            Invoke-OwnPython $definition 'agent-storage-manifest.py' @('--service',$service,'--output',$after)
            $firstManifest=Get-Content -Raw -LiteralPath $before | ConvertFrom-Json
            $lastManifest=Get-Content -Raw -LiteralPath $after | ConvertFrom-Json
            if (($firstManifest.tables | ConvertTo-Json -Depth 30 -Compress) -cne ($lastManifest.tables | ConvertTo-Json -Depth 30 -Compress) -or
                $firstManifest.own_config_sha256 -ne $lastManifest.own_config_sha256) { throw 'History or service file changed during lifecycle drill.' }
            $entry.status='PASS'
        } catch {
            $entry.status='BLOCKED'
            $entry.reason='lifecycle_prerequisite_or_assertion_failed'
            $entry.failure_type=$_.Exception.GetType().Name
            $entry.failure_line=$_.InvocationInfo.ScriptLineNumber
            Write-Warning "$service lifecycle failed; safe diagnostic and logs are retained."
        } finally {
            try { & (Join-Path $PSScriptRoot 'stop-agent.ps1') -Agent $service -Instance $instance } catch { $entry.cleanup='pending' }
            $report | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath (Join-Path $evidence 'manifest.json') -Encoding UTF8
        }
    }
} finally {
    foreach ($item in Get-ChildItem Env:) {
        if (-not $savedEnvironment.ContainsKey($item.Name)) { Remove-Item -LiteralPath ('Env:'+$item.Name) -ErrorAction SilentlyContinue }
    }
    foreach ($name in $savedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name,$savedEnvironment[$name],'Process') }
}
$report | ConvertTo-Json -Depth 30
if (@($report.services | Where-Object { $_.status -ne 'PASS' }).Count) { exit 1 }
