[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# Execute only the actual launcher's environment helpers and V2 config block.
# All paths point to temporary dummy files; no services or database code run.
$launcherPath = Join-Path $PSScriptRoot "start-project.ps1"
$parserTokens = $null
$parserErrors = $null
$launcherAst = [System.Management.Automation.Language.Parser]::ParseFile(
    $launcherPath, [ref]$parserTokens, [ref]$parserErrors
)
if ($parserErrors.Count -gt 0) { throw "Launcher PowerShell syntax is invalid." }
foreach ($helperName in @("Get-EnvValue", "Set-EnvValue")) {
    $helperAst = $launcherAst.FindAll({
        param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $helperName
    }, $false)
    if ($helperAst.Count -ne 1) { throw "Expected exactly one environment helper: $helperName" }
    . ([scriptblock]::Create($helperAst[0].Extent.Text))
}
$configAst = $launcherAst.EndBlock.Statements | Where-Object {
    $_ -is [System.Management.Automation.Language.IfStatementAst] -and
    $_.Extent.Text.Contains('Set-EnvValue $dmbEnv "AGENT_V2_BASE_URL"')
}
if (@($configAst).Count -ne 1) { throw "Expected exactly one V2 environment configuration block." }
$configBlock = [scriptblock]::Create($configAst.Extent.Text)
$configCommands = $configAst.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] }, $true)
foreach ($command in $configCommands) {
    if ($command.GetCommandName() -notin @("Get-EnvValue", "Set-EnvValue")) {
        throw "The V2 config block contains an unexpected command; review before running the isolated test."
    }
}

$testTempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$testDirectory = Join-Path $testTempRoot ("business-analyst-experimental-llm-config-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $testDirectory | Out-Null
$agentEnv = Join-Path $testDirectory "v1.env"
$agentV2Env = Join-Path $testDirectory "v2.env"
$dmbEnv = Join-Path $testDirectory "dmb.env"
$IncludeBusinessAnalystExperimental = $true
$agentV2Secret = "dummy-service-secret"
$sharedLlmProvider = "openai_compat"
$sharedOpenAiBaseUrl = "https://shared.example.test/v1"
$sharedOpenAiModel = "dummy-shared-model"
$ownSettings = [ordered]@{
    AGENT_V2_LLM_PROVIDER = "openai_compat"
    AGENT_V2_OPENAI_API_KEY = "dummy-v2-key"
    AGENT_V2_OPENAI_BASE_URL = "https://separate.example.test/v1"
    AGENT_V2_OPENAI_MODEL = "dummy-v2-model"
}
$caseCount = 0

function Set-DummyConfig {
    param([string]$Flag, [switch]$OmitFlag, [string]$BlankSetting = "", [string]$Provider = "openai_compat")
    $lines = @("UNRELATED_SETTING=preserve-me")
    if (-not $OmitFlag) { $lines += "AGENT_V2_INHERIT_V1_LLM=$Flag" }
    foreach ($setting in $ownSettings.Keys) {
        $value = $ownSettings[$setting]
        if ($setting -eq "AGENT_V2_LLM_PROVIDER") { $value = $Provider }
        if ($setting -eq $BlankSetting) { $value = "  " }
        $lines += "$setting=$value"
    }
    Set-Content -LiteralPath $agentV2Env -Value $lines -Encoding utf8
    Set-Content -LiteralPath $dmbEnv -Value "UNRELATED_DMB_SETTING=preserve-me" -Encoding utf8
}

function Assert-ConfigError {
    param([string]$ExpectedSetting)
    $caught = $false
    try { & $configBlock } catch {
        $caught = $true
        if ($_.Exception.Message -notlike "*$ExpectedSetting*") { throw "Unexpected config validation error." }
        if ($_.Exception.Message -match "dummy-.*key") { throw "Config validation exposed a key." }
    }
    if (-not $caught) { throw "Expected a config validation error for $ExpectedSetting." }
}

try {
    Set-Content -LiteralPath $agentEnv -Value "OPENAI_API_KEY=dummy-shared-key" -Encoding utf8
    $originalV1 = Get-Content -LiteralPath $agentEnv -Raw
    foreach ($flag in @("missing", "", "true", " TRUE ")) {
        Set-DummyConfig -Flag $flag -OmitFlag:($flag -eq "missing")
        & $configBlock
        $expected = @{
            AGENT_V2_LLM_PROVIDER = $sharedLlmProvider
            AGENT_V2_OPENAI_API_KEY = "dummy-shared-key"
            AGENT_V2_OPENAI_BASE_URL = $sharedOpenAiBaseUrl
            AGENT_V2_OPENAI_MODEL = $sharedOpenAiModel
        }
        foreach ($setting in $expected.Keys) {
            if ((Get-EnvValue $agentV2Env $setting) -ne $expected[$setting]) { throw "V1 inheritance failed for $setting." }
        }
        $caseCount++
    }
    foreach ($flag in @("false", " FALSE ")) {
        Set-DummyConfig -Flag $flag
        & $configBlock
        foreach ($setting in $ownSettings.Keys) {
            if ((Get-EnvValue $agentV2Env $setting) -ne $ownSettings[$setting]) { throw "Independent V2 config changed: $setting." }
        }
        if ((Get-EnvValue $agentV2Env "UNRELATED_SETTING") -ne "preserve-me") { throw "Unrelated V2 config changed." }
        $caseCount++
    }
    Set-DummyConfig -Flag "invalid"
    Assert-ConfigError "AGENT_V2_INHERIT_V1_LLM"
    $caseCount++
    foreach ($setting in $ownSettings.Keys) {
        Set-DummyConfig -Flag "false" -BlankSetting $setting
        Assert-ConfigError $setting
        $caseCount++
    }
    Set-DummyConfig -Flag "false" -Provider "mock"
    Assert-ConfigError "AGENT_V2_LLM_PROVIDER"
    $caseCount++
    if ((Get-Content -LiteralPath $agentEnv -Raw) -cne $originalV1) { throw "V1 config was changed." }
    Write-Host "$caseCount isolated V2 LLM launcher checks passed."
} finally {
    # No recursive deletion: only the three known temporary files and empty folder.
    $resolvedTestDirectory = [System.IO.Path]::GetFullPath($testDirectory)
    if (-not $resolvedTestDirectory.StartsWith($testTempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Temporary directory is outside the expected root."
    }
    foreach ($testFile in @($agentEnv, $agentV2Env, $dmbEnv)) {
        if (Test-Path -LiteralPath $testFile) { Remove-Item -LiteralPath $testFile -Force }
    }
    Remove-Item -LiteralPath $resolvedTestDirectory
}
