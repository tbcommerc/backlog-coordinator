[CmdletBinding()]
param([string]$Python = (Join-Path $PSScriptRoot '../.venv/Scripts/python.exe'))
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'agent-common.ps1')
$Python = (Resolve-Path -LiteralPath $Python).Path
$prefix = Join-Path $script:agentRoot ('.runtime/lifecycle-test-' + [guid]::NewGuid().ToString('N'))
$probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
$probe.Start()
$port = $probe.LocalEndpoint.Port
$probe.Stop()
$record = $null
$launch = $null
try {
    Assert-AgentPortAvailable $port
    $launch = Start-Process -FilePath $Python -ArgumentList @('-m','http.server',[string]$port,'--bind','127.0.0.1') `
        -WorkingDirectory $script:agentRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput ($prefix+'.out.log') -RedirectStandardError ($prefix+'.err.log')
    $record = Get-AgentProcessRecord $launch.Id 'http.server'
    $deadline = (Get-Date).AddSeconds(15)
    do {
        try { $null = Invoke-WebRequest -Uri "http://127.0.0.1:$port" -TimeoutSec 1 -UseBasicParsing; break }
        catch { Start-Sleep -Milliseconds 100 }
    } while ((Get-Date) -lt $deadline)
    $record = Confirm-AgentListenerOwnership $record $port
    if (-not (Test-AgentOwnedProcess $record)) { throw 'Owned identity was rejected.' }
    $wrong = $record.Clone()
    $wrong.startedUtcTicks = '1'
    if (Test-AgentOwnedProcess $wrong) { throw 'PID reuse protection failed.' }
    if (Stop-AgentOwnedProcess $wrong) { throw 'Unverified process stop was accepted.' }
    if (-not (Test-AgentOwnedProcess $record)) { throw 'Unverified stop changed the owned process.' }
    $wrong = $record.Clone()
    $wrong.marker = 'nonexistent-synthetic-module'
    if (Test-AgentOwnedProcess $wrong) { throw 'Marker verification failed.' }
    $wrong = $record.Clone()
    $wrong.executable = 'C:/synthetic-unrelated/python.exe'
    if (Test-AgentOwnedProcess $wrong) { throw 'Executable verification failed.' }
    $blocked = $false
    try { Assert-AgentPortAvailable $port } catch { $blocked = $true }
    if (-not $blocked -or -not (Test-AgentOwnedProcess $record)) { throw 'Occupied port was not safely refused.' }
    if (-not (Stop-AgentOwnedProcess $record)) { throw 'Owned stop failed.' }
    if (Test-AgentOwnedProcess $record) { throw 'Owned process survived stop.' }
    Write-Output 'Process lifecycle: PASS (identity, PID reuse, marker, executable, occupied port, owned stop)'
} finally {
    if ($record) { $null = Stop-AgentOwnedProcess $record }
    elseif ($launch) {
        # Only the exact process object created in this test is eligible for cleanup.
        if (-not $launch.HasExited) { $launch.Kill() }
    }
    foreach ($path in @(($prefix+'.out.log'),($prefix+'.err.log'))) {
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path }
    }
}
