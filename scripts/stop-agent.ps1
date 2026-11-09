[CmdletBinding()]
param([Parameter(Mandatory)][ValidateSet('business-analyst','business-analyst-experimental','meeting-analyzer','backlog-assistant','value-priority-assessor')][string]$Agent, [string]$Instance = 'local')
. (Join-Path $PSScriptRoot 'agent-common.ps1')
$definition = Get-AgentDefinition $Agent $Instance
if (-not (Test-Path -LiteralPath $definition.record)) {
    Write-Host "$Agent has no independent process ownership record."
    exit 0
}
$record = Get-Content -Raw -LiteralPath $definition.record | ConvertFrom-Json
$stopped = $true
$entries = if ($Agent -eq 'backlog-assistant') { @($record.api,$record.worker) } else { @($record.worker,$record.api) }
foreach ($entry in $entries) {
    if (-not (Stop-AgentOwnedProcess $entry)) { $stopped = $false }
}
if ($stopped) {
    Remove-Item -LiteralPath $definition.record
    Write-Host "$Agent stopped; unrelated processes retained."
} else {
    throw "$Agent ownership mismatch; record and unverified processes retained."
}
