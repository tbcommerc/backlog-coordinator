$ErrorActionPreference = 'Stop'
$script:agentRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Get-AgentDefinition([string]$Agent, [string]$Instance = 'local') {
    if ($Instance -notmatch '^[a-z0-9-]{1,40}$') { throw 'Invalid instance name.' }
    $definitions = @{
        'business-analyst' = @{ directory='business-analyst'; module='business_analyst.main:app'; port=9000; health='/api/agent/ready'; python='.venv'; prefix=''; database='SESSION_DATABASE_URL'; key='OPENAI_API_KEY'; secret='AGENT_SECRET' }
        'business-analyst-experimental' = @{ directory='business-analyst-experimental'; module='business_analyst_experimental.main:app'; port=9300; health='/api/agent-v2/ready'; python='.venv-agent-v2'; prefix='AGENT_V2_'; database='AGENT_V2_SESSION_DATABASE_URL'; key='AGENT_V2_OPENAI_API_KEY'; secret='AGENT_V2_SECRET' }
        'meeting-analyzer' = @{ directory='meeting-analyzer'; module='meeting_analyzer.api:app'; port=9500; health='/health/ready'; python='.venv'; prefix='MEETING_ANALYZER_'; database='MEETING_ANALYZER_DATABASE_URL'; key='MEETING_ANALYZER_MODEL_API_KEY'; secret='MEETING_ANALYZER_SERVICE_SECRET'; worker='meeting_analyzer.worker' }
        'backlog-assistant' = @{ directory='backlog-assistant'; module=''; port=9400; health='/health'; python='agents/backlog-assistant/.venv'; prefix='BACKLOG_ASSISTANT_'; database=''; key=''; secret='' }
        'value-priority-assessor' = @{ directory='value-priority-assessor'; module='value_priority_assessor.api.main:app'; port=9100; health='/ready'; python='.venv-prioritiser'; prefix='PRIORITISER_'; database='PRIORITISER_DB_URL'; key='PRIORITISER_OPENAI_API_KEY'; secret='PRIORITISER_SERVICE_SECRET' }
    }
    if (-not $definitions.ContainsKey($Agent)) { throw 'Unknown agent service ID.' }
    $definition = $definitions[$Agent].Clone()
    if (-not $definition.ContainsKey("worker")) { $definition.worker = $null }
    $definition.readyTimeout = if ($Agent -eq 'value-priority-assessor') { 900 } else { 60 }
    $definition.directory = Join-Path $script:agentRoot ('agents/' + $definition.directory)
    $definition.python = Join-Path $script:agentRoot ($definition.python + '/Scripts/python.exe')
    $definition.serviceId = $Agent
    $definition.instance = $Instance
    $definition.logPrefix = if ($Instance -eq 'local') { $Agent } else { $Agent+'-'+$Instance }
    $definition.record = Join-Path $script:agentRoot ('.runtime/' + $definition.logPrefix + '.process.json')
    return $definition
}

function Read-AgentFileEnvironment([string]$Path) {
    $values = @{}
    if (Test-Path -LiteralPath $Path) {
        foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
            if ($line -match '^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$') {
                $name = $Matches[1]
                $raw = $Matches[2].Trim()
                if ($raw -match '^(["''])(.*?)\1\s*(?:#.*)?$') { $values[$name] = $Matches[2] }
                else { $values[$name] = ([regex]::Replace($raw, '\s+#.*$', '')).TrimEnd() }
            }
        }
    }
    return $values
}

function Get-AgentAliasGroups([string]$ServiceId) {
    $manifest = Get-Content -Raw -LiteralPath (Join-Path $script:agentRoot 'packages/dmb-agent-contracts/dmb_agent_contracts/profiles.json') | ConvertFrom-Json
    $property = $manifest.PSObject.Properties[$ServiceId]
    if (-not $property) { return @() }
    return @($property.Value.PSObject.Properties)
}

function Set-AgentV2InheritedModelEnvironment([hashtable]$Values) {
    # Called only by the root launcher's explicit inheritance opt-in. No files.
    $fields = @('LLM_PROVIDER','OPENAI_API_KEY','OPENAI_BASE_URL','OPENAI_MODEL')
    if ($Values.Count -ne $fields.Count -or @($fields | Where-Object { -not $Values.ContainsKey($_) }).Count) {
        throw 'Explicit V2 inheritance requires the complete model profile.'
    }
    foreach ($group in @(Get-AgentAliasGroups 'business-analyst-experimental')) {
        if ($group.Name -in $fields) {
            foreach ($name in @($group.Value)) {
                [Environment]::SetEnvironmentVariable($name,[string]$Values[$group.Name],'Process')
            }
        }
    }
    $env:AGENT_V2_EXPLICIT_INHERITANCE = 'true'
}

function Resolve-AgentAliasValue($ProcessValues, $FileValues, [string[]]$Names) {
    foreach ($source in @($ProcessValues, $FileValues)) {
        $present = @($Names | Where-Object { $source.ContainsKey($_) })
        if (-not $present.Count) { continue }
        $first = [string]$source[$present[0]]
        foreach ($name in $present) {
            if ([string]$source[$name] -cne $first) { throw ('Conflicting settings: ' + ($present -join ', ')) }
        }
        return $first
    }
    return ''
}

function Read-AgentEnvironment($Definition) {
    $fileValues = Read-AgentFileEnvironment (Join-Path $Definition.directory '.env')
    $processValues = @{}
    foreach ($entry in Get-ChildItem Env:) { $processValues[$entry.Name] = $entry.Value }
    $values = @{}
    foreach ($name in $fileValues.Keys) { $values[$name] = $fileValues[$name] }
    foreach ($name in $processValues.Keys) { $values[$name] = $processValues[$name] }
    foreach ($group in @(Get-AgentAliasGroups (Split-Path $Definition.directory -Leaf))) {
        $names = @($group.Value)
        if (@($names | Where-Object { $processValues.ContainsKey($_) -or $fileValues.ContainsKey($_) }).Count) {
            $resolved = Resolve-AgentAliasValue $processValues $fileValues $names
            foreach ($name in $names) { $values[$name] = $resolved }
        }
    }
    return $values
}

function Test-AgentEnvSetting([string]$Path, [string]$Name) {
    $fileValues = Read-AgentFileEnvironment $Path
    $names = @($Name)
    foreach ($group in @(Get-AgentAliasGroups (Split-Path (Split-Path $Path -Parent) -Leaf))) {
        if (@($group.Value) -contains $Name) { $names = @($group.Value); break }
    }
    foreach ($candidate in $names) {
        if ($fileValues.ContainsKey($candidate) -or (Test-Path -LiteralPath "Env:$candidate")) { return $true }
    }
    return $false
}

function Get-AgentEnvValue([string]$Path, [string]$Name) {
    $fileValues = Read-AgentFileEnvironment $Path
    $processValues = @{}
    foreach ($entry in Get-ChildItem Env:) { $processValues[$entry.Name] = $entry.Value }
    $names = @($Name)
    foreach ($group in @(Get-AgentAliasGroups (Split-Path (Split-Path $Path -Parent) -Leaf))) {
        if (@($group.Value) -contains $Name) { $names = @($group.Value); break }
    }
    return Resolve-AgentAliasValue $processValues $fileValues $names
}


function Get-AgentProcessRecord([int]$ProcessId, [string]$Marker) {
    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $process) { throw 'New managed process exited before ownership was recorded.' }
    $details = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -OperationTimeoutSec 5
    if (-not $details -or -not $details.ExecutablePath -or -not $details.CommandLine -or -not $details.CommandLine.Contains($Marker)) {
        throw 'New managed process identity could not be verified.'
    }
    return @{pid=$ProcessId; startedUtcTicks=$process.StartTime.ToUniversalTime().Ticks.ToString(); executable=$details.ExecutablePath; marker=$Marker}
}

function Test-AgentOwnedProcess($Record) {
    if (-not $Record -or -not $Record.pid -or -not $Record.marker -or -not $Record.executable) { return $false }
    try {
        $process = Get-Process -Id ([int]$Record.pid) -ErrorAction SilentlyContinue
        if (-not $process) { return $false }
        if ($process.StartTime.ToUniversalTime().Ticks.ToString() -ne [string]$Record.startedUtcTicks) { return $false }
        $details = Get-CimInstance Win32_Process -Filter "ProcessId=$($Record.pid)" -OperationTimeoutSec 5
        return $details -and $details.ExecutablePath -eq $Record.executable -and $details.CommandLine -and $details.CommandLine.Contains($Record.marker)
    } catch { return $false }
}

function Get-AgentRecordField($Record, [string]$Name) {
    if ($Record -is [System.Collections.IDictionary]) { return $Record[$Name] }
    if ($Record -and $Record.PSObject.Properties[$Name]) { return $Record.PSObject.Properties[$Name].Value }
    return $null
}

function Stop-AgentOwnedProcess($Record) {
    if (-not $Record) { return $true }
    $launcher = $null
    if ($Record -is [System.Collections.IDictionary]) { $launcher = $Record['launcher'] }
    elseif ($Record.PSObject.Properties['launcher']) { $launcher = $Record.launcher }
    if (-not (Test-AgentOwnedProcess $Record)) {
        if (Get-Process -Id ([int]$Record.pid) -ErrorAction SilentlyContinue) {
            Write-Warning 'Unverified process retained; ownership record needs review.'
            return $false
        }
        if ($launcher) { return Stop-AgentOwnedProcess $launcher }
        return $true
    }
    $process = Get-Process -Id ([int]$Record.pid) -ErrorAction SilentlyContinue
    # Hold a process handle: a later PID reuse must never target another process.
    [void]$process.SafeHandle
    if ($process.StartTime.ToUniversalTime().Ticks.ToString() -ne [string]$Record.startedUtcTicks) { return $false }
    $control = Get-AgentRecordField $Record 'control'
    if ($control) {
        $runtime = [IO.Path]::GetFullPath((Join-Path $script:agentRoot '.runtime'))
        $resolved = [IO.Path]::GetFullPath([string]$control)
        if ((Split-Path $resolved -Parent) -ne $runtime -or (Split-Path $resolved -Leaf) -notmatch '^[a-z0-9-]+-[0-9a-f]{32}\.stop$') {
            throw 'Invalid process control record; no file was written.'
        }
        if (-not (Test-Path -LiteralPath $resolved)) {
            $stream = [IO.File]::Open($resolved, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
            try {
                $bytes = [Text.Encoding]::UTF8.GetBytes('{"action":"shutdown"}')
                $stream.Write($bytes,0,$bytes.Length)
            } finally { $stream.Dispose() }
        }
        $grace = Get-AgentRecordField $Record 'graceSeconds'
        $milliseconds = 1000 * [Math]::Min(30,[Math]::Max(1,[int]$grace))
        [void]$process.WaitForExit($milliseconds)
    }
    # Windowed launchers can close normally; console services use the bounded fallback.
    if (-not $process.HasExited -and $process.CloseMainWindow()) { [void]$process.WaitForExit(5000) }
    if (-not $process.HasExited) { $process.Kill(); [void]$process.WaitForExit(5000) }
    if (-not $process.HasExited) { return $false }
    if ($control -and (Test-Path -LiteralPath $control)) { Remove-Item -LiteralPath $control }
    if ($launcher) { return Stop-AgentOwnedProcess $launcher }
    return $true
}

function Confirm-AgentListenerOwnership($Record, [int]$Port) {
    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
    if ($listeners.Count -ne 1) { throw 'Managed listener ownership was not confirmed.' }
    $listenerId = [int]$listeners[0]
    if ($listenerId -eq [int]$Record.pid) {
        if (-not (Test-AgentOwnedProcess $Record)) { throw 'Managed process identity changed.' }
        return $Record
    }
    $details = Get-CimInstance Win32_Process -Filter "ProcessId=$listenerId" -OperationTimeoutSec 5
    if (-not $details -or $details.ParentProcessId -ne [int]$Record.pid -or -not (Test-AgentOwnedProcess $Record)) {
        throw 'Listener is not a verified child of this launch; no process was stopped.'
    }
    $child = Get-AgentProcessRecord $listenerId $Record.marker
    $child.launcher = $Record
    foreach ($field in @('control','graceSeconds')) {
        $value = Get-AgentRecordField $Record $field
        if ($value) { $child[$field] = $value }
    }
    return $child
}

function Assert-AgentPortAvailable([int]$Port) {
    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
        throw "Port $Port is already occupied; no process was stopped."
    }
}

function Assert-AgentRecordReusable($Record) {
    if ($Record -and (Get-Process -Id ([int]$Record.pid) -ErrorAction SilentlyContinue) -and -not (Test-AgentOwnedProcess $Record)) {
        throw 'Ownership record refers to an unverified live process; record and process retained.'
    }
}

function Test-AgentReadyResponse($Response) {
    if (-not $Response) { return $false }
    if ($Response -is [System.Collections.IDictionary]) {
        return $Response['status'] -in @('ok','ready','healthy') -or $Response['ok'] -eq $true
    }
    $statusProperty = $Response.PSObject.Properties['status']
    $okProperty = $Response.PSObject.Properties['ok']
    return ($statusProperty -and $statusProperty.Value -in @('ok','ready','healthy')) -or ($okProperty -and $okProperty.Value -eq $true)
}

function Initialize-AgentLimiter {
    param([Parameter(Mandatory)]$Definition)
    $mode = if ($env:DMB_AGENT_LIMITER_MODE -eq 'global') { 'global' } else { 'standalone' }
    $values = Read-AgentEnvironment $Definition
    $ownName = $(if ($Definition.serviceId -eq 'business-analyst') { 'AGENT_OPERATION_REDIS_URL' } else { $Definition.prefix + 'OPERATION_REDIS_URL' })
    $ownRedis = if ($values.ContainsKey($ownName)) { $values[$ownName] } else { '' }
    if ($mode -eq 'global') {
        if (-not $env:DMB_AGENT_LIMITER_REDIS_URL -or -not $env:DMB_AGENT_LIMITER_NAMESPACE -or -not $env:DMB_AGENT_LIMITER_STATE_DIR) {
            throw 'Global operation limiter configuration is incomplete.'
        }
        if ($ownRedis -and $ownRedis -ne $env:DMB_AGENT_LIMITER_REDIS_URL) { throw 'Own OPERATION_REDIS_URL conflicts with the global coordinator.' }
        $namespace = $env:DMB_AGENT_LIMITER_NAMESPACE
        $stateDir = $env:DMB_AGENT_LIMITER_STATE_DIR
    } else {
        $namespace = $Definition.serviceId + '-' + $Definition.instance
        $stateDir = Join-Path $script:agentRoot ('.runtime/agent-limiter/' + $namespace)
        $env:DMB_AGENT_LIMITER_REDIS_URL = if ($ownRedis) { $ownRedis } else { 'redis://127.0.0.1:6379/0' }
    }
    $values.Clear()
    $output = & $Definition.python -m dmb_agent_contracts.limiter_cli --state-dir $stateDir --namespace $namespace --mode $mode
    if ($LASTEXITCODE -ne 0) { throw 'Operation limiter is unavailable; no agent process was started.' }
    $profile = ($output -join "`n") | ConvertFrom-Json
    $env:DMB_AGENT_LIMITER_MODE = $profile.mode
    $env:DMB_AGENT_LIMITER_NAMESPACE = $profile.namespace
    $env:DMB_AGENT_LIMITER_EPOCH = $profile.epoch
    $env:DMB_AGENT_LIMITER_JOURNAL_DIR = $profile.journal_dir
    $env:DMB_AGENT_SERVICE_ID = $Definition.serviceId
    $env:DMB_AGENT_REQUIRE_LIMITER = 'true'
    return $profile
}

function Assert-AgentLimiterCompatible {
    param($Record, $Profile)
    if ((Test-AgentOwnedProcess $Record.api) -or (Test-AgentOwnedProcess $Record.worker)) {
        $saved = Get-AgentRecordField $Record 'limiter'
        if (-not $saved -or $saved.mode -ne $Profile.mode -or $saved.namespace -ne $Profile.namespace -or $saved.epoch -ne $Profile.epoch) {
            throw 'Owned service uses another limiter profile. Stop the owned service before changing its execution profile.'
        }
    }
}

function Assert-PlatformLimiterCutover {
    param([Parameter(Mandatory)][string]$Namespace,[Parameter(Mandatory)][string]$StateDirectory)
    $epochPath=Join-Path $StateDirectory 'epoch.json'
    $epoch=$null
    if (Test-Path -LiteralPath $epochPath) { $epoch=(Get-Content -Raw -LiteralPath $epochPath | ConvertFrom-Json).epoch }
    foreach ($service in @('business-analyst','business-analyst-experimental','meeting-analyzer','backlog-assistant','value-priority-assessor')) {
        $definition=Get-AgentDefinition $service
        $running=$false
        if (Test-Path -LiteralPath $definition.record) {
            $record=Get-Content -Raw -LiteralPath $definition.record | ConvertFrom-Json
            $running=(Test-AgentOwnedProcess $record.api) -or (Test-AgentOwnedProcess $record.worker)
            if ($running) {
                $profile=Get-AgentRecordField $record 'limiter'
                if (-not $profile -or -not $epoch -or $profile.mode -ne 'global' -or $profile.namespace -ne $Namespace -or $profile.epoch -ne $epoch) {
                    throw "Global limiter cutover requires draining the existing owned $service profile before starting new services."
                }
            }
        }
        if (-not $running) {
            $probe=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$definition.port)
            $probe.ExclusiveAddressUse=$true
            try { $probe.Start() }
            catch { throw "Cannot prove the previous $service listener is stopped; no global profile was bootstrapped." }
            finally { $probe.Stop() }
        }
    }
    foreach ($legacy in @('agent','agent-v2','prioritiser','backlog-assistant')) {
        $path=Join-Path $script:agentRoot ('.runtime/'+$legacy+'.pid')
        if (Test-Path -LiteralPath $path) {
            $oldId=[int](Get-Content -Raw -LiteralPath $path)
            if (Get-Process -Id $oldId -ErrorAction SilentlyContinue) {
                throw "Legacy PID-only $legacy ownership cannot authorize a global limiter cutover; process retained."
            }
        }
    }
}
