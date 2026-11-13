<#
.SYNOPSIS
    Antigravity IDE Structure-Only Inspector (Read-Only)
.DESCRIPTION
    Monitors %USERPROFILE%\.gemini for file changes during agent test scenarios.
    Logs ONLY metadata and schema/field structure. Never logs conversation or prompt content.
#>

[CmdletBinding()]
param(
    [string]$WatchDir = "$env:USERPROFILE\.gemini",
    [string]$OutDir = "$PSScriptRoot\out",
    [switch]$IncludeAppData,
    [switch]$SelfTest
)

function Sanitize-JsonToken {
    param($Token)

    if ($null -eq $Token) {
        return $null
    }

    if ($Token -is [System.Collections.IDictionary] -or $Token -is [PSCustomObject]) {
        $cleanObj = [ordered]@{}
        $properties = if ($Token -is [PSCustomObject]) { $Token.psobject.Properties } else { $Token.GetEnumerator() }
        foreach ($prop in $properties) {
            $name = if ($Token -is [PSCustomObject]) { $prop.Name } else { $prop.Key }
            $val = if ($Token -is [PSCustomObject]) { $prop.Value } else { $prop.Value }
            $cleanObj[$name] = Sanitize-JsonToken -Token $val
        }
        return $cleanObj
    }
    elseif ($Token -is [System.Collections.IEnumerable] -and -not ($Token -is [string])) {
        $cleanArr = @()
        foreach ($item in $Token) {
            $cleanArr += ,(Sanitize-JsonToken -Token $item)
        }
        return $cleanArr
    }
    elseif ($Token -is [string]) {
        # Preserve enum-like strings: uppercase alphanumeric + underscore, max 40 chars
        if ($Token -match '^[A-Z][A-Z0-9_]{1,40}$') {
            return $Token
        }
        return "<str len=$($Token.Length)>"
    }
    elseif ($Token -is [bool] -or $Token -is [int] -or $Token -is [long] -or $Token -is [double]) {
        return $Token
    }
    else {
        return "<value type=$($Token.GetType().Name)>"
    }
}

function Run-SelfTest {
    Write-Host "Running Antigravity Inspector Redaction Self-Test..." -ForegroundColor Cyan
    $tempDir = Join-Path $env:TEMP "antigravity_inspect_selftest_$(Get-Random)"
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

    try {
        $secretMarker = "Please refactor the authentication module with SECRET_CANARY_12345"
        $testJson = @"
{
    "conversationId": "conv-1234",
    "prompt": "$secretMarker",
    "status": "RUNNING",
    "executionCount": 5,
    "isComplete": false,
    "nested": {
        "userGoal": "Build a secret feature",
        "state": "STOPPED"
    }
}
"@
        $testFile = Join-Path $tempDir "sample.json"
        Set-Content -Path $testFile -Value $testJson

        $raw = Get-Content -Path $testFile -Raw | ConvertFrom-Json
        $sanitized = Sanitize-JsonToken -Token $raw
        $sanitizedJson = $sanitized | ConvertTo-Json -Depth 10

        # Assertions
        if ($sanitizedJson.Contains($secretMarker)) {
            Write-Error "SELF-TEST FAILED: Secret marker was found in sanitized output!"
            exit 1
        }
        if ($sanitizedJson.Contains("Build a secret feature")) {
            Write-Error "SELF-TEST FAILED: Nested prompt string was found in sanitized output!"
            exit 1
        }
        if (-not $sanitizedJson.Contains("RUNNING") -or -not $sanitizedJson.Contains("STOPPED")) {
            Write-Error "SELF-TEST FAILED: Enum states were not preserved!"
            exit 1
        }
        if (-not ($sanitizedJson -match 'str len=')) {
            Write-Error "SELF-TEST FAILED: String redaction placeholder was missing!"
            exit 1
        }

        Write-Host "Self-Test PASSED: All secret markers properly redacted into length-only tags." -ForegroundColor Green
    }
    finally {
        Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

if ($SelfTest) {
    Run-SelfTest
    exit 0
}

# Ensure Output directory exists and is git-ignored
if (-not (Test-Path $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
}
$gitIgnorePath = Join-Path $PSScriptRoot ".gitignore"
if (-not (Test-Path $gitIgnorePath)) {
    Set-Content -Path $gitIgnorePath -Value "out/`n*.log`n"
}

$logFile = Join-Path $OutDir "inspector-log.jsonl"
Write-Host "=== Antigravity IDE Structure Inspector ===" -ForegroundColor Cyan
Write-Host "Watch Directory : $WatchDir"
Write-Host "Log Output File : $logFile"
Write-Host "Logging Mode    : Structure and metadata only (No conversation content)"
Write-Host "--------------------------------------------------"

$scenarios = @(
    "Scenario 1: Start a task",
    "Scenario 2: The agent pauses for permission / approval",
    "Scenario 3: The agent finishes the main task",
    "Scenario 4: The agent finishes by asking a question"
)

$currentScenario = "Scenario 0: Baseline"

# Set up file watcher
$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path = $WatchDir
$watcher.IncludeSubdirectories = $true
$watcher.EnableRaisingEvents = $true

$onChange = {
    param($source, $event)
    $path = $event.FullPath
    $changeType = $event.ChangeType.ToString()
    $timestamp = (Get-Date).ToUniversalTime().ToString("o")

    # Read-only metadata
    $entry = [ordered]@{
        timestamp = $timestamp
        scenario = $script:currentScenario
        changeType = $changeType
        relPath = $path.Replace($script:WatchDir, "").TrimStart('\')
    }

    if (Test-Path $path -PathType Leaf) {
        try {
            $fileInfo = Get-Item $path -ErrorAction SilentlyContinue
            if ($fileInfo) {
                $entry["sizeBytes"] = $fileInfo.Length
                $entry["extension"] = $fileInfo.Extension

                if ($fileInfo.Extension -eq ".json" -and $fileInfo.Length -lt 2MB) {
                    $content = Get-Content -Path $path -Raw -ErrorAction SilentlyContinue
                    if ($content) {
                        $parsed = $content | ConvertFrom-Json -ErrorAction SilentlyContinue
                        if ($parsed) {
                            $entry["structure"] = Sanitize-JsonToken -Token $parsed
                        }
                    }
                }
            }
        } catch {}
    }

    $jsonLine = $entry | ConvertTo-Json -Compress -Depth 10
    Add-Content -Path $script:logFile -Value $jsonLine
}

Register-ObjectEvent $watcher "Changed" -Action $onChange | Out-Null
Register-ObjectEvent $watcher "Created" -Action $onChange | Out-Null
Register-ObjectEvent $watcher "Deleted" -Action $onChange | Out-Null

Write-Host "Inspector is active and watching." -ForegroundColor Green
Write-Host "Follow each scenario below. Press ENTER when starting each scenario.`n"

for ($i = 0; $i -lt $scenarios.Count; $i++) {
    $script:currentScenario = $scenarios[$i]
    Write-Host "[$($i + 1)/$($scenarios.Count)] Press ENTER to begin: $($scenarios[$i])" -ForegroundColor Yellow
    [void][System.Console]::ReadLine()
    Add-Content -Path $logFile -Value ($([ordered]@{ marker = "START"; scenario = $scenarios[$i]; timestamp = (Get-Date).ToUniversalTime().ToString("o") } | ConvertTo-Json -Compress))
    Write-Host "Scenario active. Perform action in Antigravity IDE, then press ENTER when done..."
    [void][System.Console]::ReadLine()
    Add-Content -Path $logFile -Value ($([ordered]@{ marker = "END"; scenario = $scenarios[$i]; timestamp = (Get-Date).ToUniversalTime().ToString("o") } | ConvertTo-Json -Compress))
    Write-Host "Recorded scenario $($i + 1).`n"
}

$watcher.EnableRaisingEvents = $false
$watcher.Dispose()
Write-Host "Inspection complete! Output saved to: $logFile" -ForegroundColor Green
