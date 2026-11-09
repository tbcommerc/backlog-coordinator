[CmdletBinding()]
param([string]$Python = (Join-Path $PSScriptRoot '../.venv/Scripts/python.exe'))
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'agent-common.ps1')
$Python = (Resolve-Path -LiteralPath $Python).Path
$id = [guid]::NewGuid().ToString('N')
$scratch = Join-Path $script:agentRoot ('.runtime/graceful-test-'+$id)
$control = Join-Path $script:agentRoot ('.runtime/graceful-test-'+$id+'.stop')
$marker = Join-Path $scratch 'shutdown.marker'
$record = $null
$previousControl = $env:DMB_AGENT_CONTROL_FILE
$previousBytecode = $env:PYTHONDONTWRITEBYTECODE
try {
    New-Item -ItemType Directory -Path $scratch | Out-Null
    $app = @'
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI
@asynccontextmanager
async def lifespan(app):
    yield
    Path('shutdown.marker').write_text('graceful',encoding='utf-8')
app=FastAPI(lifespan=lifespan)
@app.get('/health')
def health(): return {'status':'ok'}
'@
    Set-Content -LiteralPath (Join-Path $scratch 'synthetic_app.py') -Value $app -Encoding UTF8
    $probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
    $probe.Start(); $port = $probe.LocalEndpoint.Port; $probe.Stop()
    $env:DMB_AGENT_CONTROL_FILE = $control
    $env:PYTHONDONTWRITEBYTECODE = '1'
    $process = Start-Process -FilePath $Python -ArgumentList @('-m','dmb_agent_contracts.serve','--app','synthetic_app:app','--port',[string]$port) `
        -WorkingDirectory $scratch -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $scratch 'out.log') -RedirectStandardError (Join-Path $scratch 'err.log')
    $record = Get-AgentProcessRecord $process.Id 'synthetic_app:app'
    $record.control = $control
    $record.graceSeconds = 15
    $deadline = (Get-Date).AddSeconds(15)
    $ready = $false
    do {
        try {
            $response = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 1
            $ready = Test-AgentReadyResponse $response
        } catch { }
        if (-not $ready) { Start-Sleep -Milliseconds 100 }
    } while (-not $ready -and (Get-Date) -lt $deadline)
    if (-not $ready) { throw 'Synthetic server did not become ready.' }
    $record = Confirm-AgentListenerOwnership $record $port
    if (-not (Stop-AgentOwnedProcess $record)) { throw 'Graceful owned stop failed.' }
    if (-not (Test-Path -LiteralPath $marker)) { throw 'Lifespan shutdown was not completed; force stop is insufficient.' }
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw 'Listener survived graceful shutdown.' }
    Write-Output 'Graceful lifecycle: PASS (server drain, lifespan shutdown, listener closed)'
} finally {
    if ($record) { $null = Stop-AgentOwnedProcess $record }
    foreach ($name in @('synthetic_app.py','out.log','err.log','shutdown.marker')) {
        $path = Join-Path $scratch $name
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path }
    }
    if (Test-Path -LiteralPath $control) { Remove-Item -LiteralPath $control }
    if (Test-Path -LiteralPath $scratch) { Remove-Item -LiteralPath $scratch }
    if ($null -eq $previousControl) { Remove-Item Env:DMB_AGENT_CONTROL_FILE -ErrorAction SilentlyContinue } else { $env:DMB_AGENT_CONTROL_FILE=$previousControl }
    if ($null -eq $previousBytecode) { Remove-Item Env:PYTHONDONTWRITEBYTECODE -ErrorAction SilentlyContinue } else { $env:PYTHONDONTWRITEBYTECODE=$previousBytecode }
}
