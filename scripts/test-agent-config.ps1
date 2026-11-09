$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'agent-common.ps1')
$scratch = Join-Path $script:agentRoot ('.runtime/config-unit-' + [guid]::NewGuid().ToString('N'))
$serviceDir = Join-Path $scratch 'business-analyst'
$file = Join-Path $serviceDir '.env'
$saved = @{}
foreach ($name in @('OPENAI_API_KEY','AGENT_MODEL_API_KEY')) { $saved[$name] = [Environment]::GetEnvironmentVariable($name,'Process') }
foreach ($group in @(Get-AgentAliasGroups 'business-analyst-experimental')) {
    if ($group.Name -in @('LLM_PROVIDER','OPENAI_API_KEY','OPENAI_BASE_URL','OPENAI_MODEL')) {
        foreach ($name in @($group.Value)) { $saved[$name] = [Environment]::GetEnvironmentVariable($name,'Process') }
    }
}
$saved['AGENT_V2_EXPLICIT_INHERITANCE'] = $env:AGENT_V2_EXPLICIT_INHERITANCE
try {
    New-Item -ItemType Directory -Path $serviceDir -Force | Out-Null
    foreach ($name in $saved.Keys) { Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue }
    Set-Content -LiteralPath $file -Encoding UTF8 -Value 'OPENAI_API_KEY="file # synthetic" # comment'
    if ((Get-AgentEnvValue $file 'OPENAI_API_KEY') -cne 'file # synthetic') { throw 'Quoted dotenv field failed.' }
    $env:AGENT_MODEL_API_KEY = 'process-synthetic'
    if ((Get-AgentEnvValue $file 'OPENAI_API_KEY') -cne 'process-synthetic') { throw 'Process precedence failed.' }
    $env:OPENAI_API_KEY = 'different-synthetic'
    $refused = $false
    try { $null = Get-AgentEnvValue $file 'OPENAI_API_KEY' }
    catch {
        if ($_.Exception.Message -notmatch 'Conflicting settings:' -or $_.Exception.Message -match 'different-synthetic') { throw }
        $refused = $true
    }
    if (-not $refused) { throw 'Alias conflict was accepted.' }
    Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
    $env:AGENT_MODEL_API_KEY = ''
    # Windows removes an empty process variable; an explicit file clear must still be retained.
    Remove-Item Env:AGENT_MODEL_API_KEY -ErrorAction SilentlyContinue
    Set-Content -LiteralPath $file -Encoding UTF8 -Value 'AGENT_MODEL_API_KEY='
    if (-not (Test-AgentEnvSetting $file 'OPENAI_API_KEY')) { throw 'Explicit blank setting lost.' }
    if ((Get-AgentEnvValue $file 'OPENAI_API_KEY') -cne '') { throw 'Empty key fallback detected.' }
    foreach ($service in @('business-analyst','business-analyst-experimental','meeting-analyzer','backlog-assistant','value-priority-assessor')) {
        if (-not @(Get-AgentAliasGroups $service).Count) { throw 'Service alias manifest missing.' }
    }
    if (-not (Test-AgentReadyResponse ('{"ok":true}' | ConvertFrom-Json))) { throw 'Boolean readiness contract failed.' }
    if (-not (Test-AgentReadyResponse ('{"status":"ready"}' | ConvertFrom-Json))) { throw 'Status readiness contract failed.' }
    if (Test-AgentReadyResponse ('{"status":"failed"}' | ConvertFrom-Json)) { throw 'Failed readiness accepted.' }
    $beforeInheritance = Get-FileHash -LiteralPath $file -Algorithm SHA256
    Set-AgentV2InheritedModelEnvironment @{
        LLM_PROVIDER='openai_compat'; OPENAI_API_KEY='synthetic-inherited-key'
        OPENAI_BASE_URL='https://synthetic.invalid/v1'; OPENAI_MODEL='synthetic-model'
    }
    foreach ($group in @(Get-AgentAliasGroups 'business-analyst-experimental')) {
        if ($group.Name -eq 'OPENAI_API_KEY') {
            foreach ($name in @($group.Value)) {
                if ([Environment]::GetEnvironmentVariable($name,'Process') -ne 'synthetic-inherited-key') { throw 'Explicit inheritance alias mismatch.' }
            }
        }
    }
    if ($env:AGENT_V2_EXPLICIT_INHERITANCE -ne 'true') { throw 'Explicit inheritance provenance missing.' }
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $beforeInheritance.Hash) { throw 'Inheritance wrote a service file.' }
    Write-Output 'PowerShell aliases: PASS (precedence, safe conflict, empty key, five services)'
} finally {
    foreach ($name in $saved.Keys) { if ($null -eq $saved[$name]) { Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue } else { [Environment]::SetEnvironmentVariable($name,$saved[$name],'Process') } }
    if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file }
    if (Test-Path -LiteralPath $serviceDir) { Remove-Item -LiteralPath $serviceDir }
    if (Test-Path -LiteralPath $scratch) { Remove-Item -LiteralPath $scratch }
}
