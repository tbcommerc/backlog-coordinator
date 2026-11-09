[CmdletBinding()]
param([Parameter(Mandatory)][ValidateSet('business-analyst','business-analyst-experimental','meeting-analyzer','backlog-assistant','value-priority-assessor')][string]$Agent, [switch]$LiveModelProbe, [int]$MaxCalls=0, [int]$MaxSeconds=0)
if ($LiveModelProbe -and ($MaxCalls -ne 1 -or $MaxSeconds -lt 1 -or $MaxSeconds -gt 45)) {
    throw 'LiveModelProbe requires explicit -MaxCalls 1 -MaxSeconds 1..45; no inference was performed.'
}
. (Join-Path $PSScriptRoot 'agent-common.ps1')
$definition = Get-AgentDefinition $Agent
if (-not (Test-Path -LiteralPath $definition.python)) { throw "Missing isolated Python environment for $Agent." }
Push-Location $definition.directory
try {
    & $definition.python -c "import runpy,sys; runpy.run_path(sys.argv.pop(1),run_name='__main__')" (Join-Path $PSScriptRoot 'agent-doctor.py') --service $Agent
    if ($LASTEXITCODE -ne 0) { throw "$Agent prerequisites are unavailable; no inference or migration was performed." }
    if ($LiveModelProbe) {
        $output=Join-Path $script:agentRoot ('.runtime/agent-services-evidence/operator-probe-'+$Agent+'-'+[guid]::NewGuid().ToString('N')+'.json')
        & $definition.python -c "import runpy,sys; runpy.run_path(sys.argv.pop(1),run_name='__main__')" (Join-Path $PSScriptRoot 'agent-model-probe.py') --service $Agent --max-calls $MaxCalls --max-seconds $MaxSeconds --output $output
        if ($LASTEXITCODE -ne 0) { throw 'Bounded model probe failed; safe evidence retained.' }
    }
} finally { Pop-Location }
