[CmdletBinding()]
param(
    [string]$BaseUrl = "http://127.0.0.1:8080",
    [string[]]$AccessTokens = @(),
    [ValidateRange(1, 500)][int]$ConcurrentRequests = 40,
    [string]$ReportPath = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Net.Http

$base = $BaseUrl.TrimEnd('/')
$client = [System.Net.Http.HttpClient]::new()
$client.Timeout = [TimeSpan]::FromSeconds(20)
$results = [System.Collections.Generic.List[object]]::new()

function Invoke-ReadOnlyCheck {
    param(
        [string]$Name,
        [string]$Path,
        [string]$Token = "",
        [int[]]$ExpectedStatus = @(200)
    )
    $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, "$base$Path")
    if ($Token) { $request.Headers.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new("Bearer", $Token) }
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $response = $client.SendAsync($request).GetAwaiter().GetResult()
        $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        $watch.Stop()
        $status = [int]$response.StatusCode
        if ($ExpectedStatus -notcontains $status) {
            throw "$Name returned HTTP $status (expected $($ExpectedStatus -join ',')): $($body.Substring(0, [Math]::Min(300, $body.Length)))"
        }
        $requestId = if ($response.Headers.Contains("X-Request-ID")) { ($response.Headers.GetValues("X-Request-ID") | Select-Object -First 1) } else { $null }
        $traceId = if ($response.Headers.Contains("X-Trace-ID")) { ($response.Headers.GetValues("X-Trace-ID") | Select-Object -First 1) } else { $null }
        $item = [pscustomobject]@{ name = $Name; status = $status; elapsed_ms = $watch.ElapsedMilliseconds; request_id = $requestId; trace_id = $traceId }
        $results.Add($item)
        Write-Host "[ok] $Name HTTP $status ($($watch.ElapsedMilliseconds) ms)"
        return $body
    } finally {
        $request.Dispose()
    }
}

try {
    $healthBody = Invoke-ReadOnlyCheck "liveness" "/api/v1/health"
    $health = $healthBody | ConvertFrom-Json
    if ($health.status -ne "ok") { throw "Unexpected liveness payload" }

    $readyBody = Invoke-ReadOnlyCheck "readiness" "/api/v1/health/ready"
    $ready = $readyBody | ConvertFrom-Json
    if ($ready.status -ne "ready") { throw "Stand is not ready" }

    Invoke-ReadOnlyCheck "frontend" "/" | Out-Null
    Invoke-ReadOnlyCheck "unknown API route" "/api/v1/__smoke_missing__" "" @(404) | Out-Null

    for ($index = 0; $index -lt $AccessTokens.Count; $index++) {
        $token = $AccessTokens[$index]
        if (-not $token) { continue }
        Invoke-ReadOnlyCheck "user-$($index + 1) profile" "/api/v1/auth/me" $token | Out-Null
        Invoke-ReadOnlyCheck "user-$($index + 1) task scope" "/api/v1/tasks?page=1&per_page=1" $token | Out-Null
    }

    $pending = [System.Collections.Generic.List[object]]::new()
    for ($index = 1; $index -le $ConcurrentRequests; $index++) {
        $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, "$base/api/v1/health")
        $pending.Add([pscustomobject]@{ request = $request; task = $client.SendAsync($request); index = $index })
    }
    $failed = 0
    foreach ($entry in $pending) {
        try {
            $response = $entry.task.GetAwaiter().GetResult()
            if ([int]$response.StatusCode -ne 200) { $failed++ }
            $response.Dispose()
        } catch {
            $failed++
        } finally {
            $entry.request.Dispose()
        }
    }
    if ($failed -gt 0) { throw "$failed of $ConcurrentRequests concurrent read-only requests failed" }
    Write-Host "[ok] concurrent read-only burst: $ConcurrentRequests/$ConcurrentRequests"

    $report = [pscustomobject]@{
        generated_at = (Get-Date).ToUniversalTime().ToString("o")
        base_url = $base
        concurrent_requests = $ConcurrentRequests
        authenticated_profiles_checked = ($AccessTokens | Where-Object { $_ }).Count
        checks = $results
        status = "PASS"
    }
    if ($ReportPath) {
        $parent = Split-Path -Parent $ReportPath
        if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
        $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $ReportPath -Encoding utf8
        Write-Host "Report: $((Resolve-Path -LiteralPath $ReportPath).Path)"
    }
    $report | ConvertTo-Json -Depth 6
} finally {
    $client.Dispose()
}
