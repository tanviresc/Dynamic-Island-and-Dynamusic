<#
.SYNOPSIS
    Antigravity Lifecycle Hook for Island Dynamic Island
.DESCRIPTION
    Receives Antigravity hook events via stdin, formats them according to the Island event contract,
    and sends them to Island's local HTTP server (http://127.0.0.1:47821/v1/events).
    Exits in < 150ms and always outputs valid JSON {} to stdout.
#>

function Get-IslandToken {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $rootDir = Split-Path -Parent $scriptDir
    $candidates = @(
        (Join-Path $rootDir ".island\pairing-token.txt"),
        "$env:LOCALAPPDATA\Island\pairing-token.txt",
        "$env:LOCALAPPDATA\local.island.app\pairing-token.txt",
        "$env:APPDATA\local.island.app\pairing-token.txt"
    )
    foreach ($path in $candidates) {
        if (Test-Path $path) {
            $t = (Get-Content -Path $path -Raw -ErrorAction SilentlyContinue)
            if ($t) { return $t.Trim() }
        }
    }
    return $null
}

try {
    $rawInput = [Console]::In.ReadToEnd()
    if ($rawInput) {
        $payload = $rawInput | ConvertFrom-Json -ErrorAction SilentlyContinue
        if ($payload) {
            $hookName = $payload.hookEventName
            $convId = if ($payload.conversationId) { $payload.conversationId } else { [Guid]::NewGuid().ToString() }
            
            # Extract workspace path and display name
            $wsPath = ""
            if ($payload.workspacePaths -and $payload.workspacePaths.Count -gt 0) {
                $wsPath = $payload.workspacePaths[0]
            } elseif ($payload.cwd) {
                $wsPath = $payload.cwd
            } else {
                $wsPath = (Get-Location).Path
            }
            $wsName = Split-Path $wsPath -Leaf
            if (-not $wsName) { $wsName = "Antigravity" }

            $eventKind = $null
            $title = ""
            $text = ""
            $category = $null

            if ($hookName -eq "Stop") {
                # Stop hook: check if fully idle and not continuation
                $isIdle = if ($null -ne $payload.fullyIdle) { [bool]$payload.fullyIdle } else { $true }
                $isCont = if ($null -ne $payload.continuationActive) { [bool]$payload.continuationActive } else { $false }
                $reason = $payload.terminationReason

                if ($isIdle -and -not $isCont) {
                    if ($reason -eq "ERROR") {
                        $eventKind = "error"
                        $title = "$wsName · Failed"
                        $errStr = if ($payload.error) { [string]$payload.error } else { "Task failed with error" }
                        $text = $errStr.Substring(0, [Math]::Min(120, $errStr.Length))
                        $category = "Failed"
                    } else {
                        $eventKind = "done"
                        $title = "$wsName · Task completed"
                        $text = "Antigravity finished task"
                        $category = $null
                    }
                }
            } elseif ($hookName -eq "PreToolUse") {
                # Tool use hook: check for ask_question or user approval
                $toolName = if ($payload.toolCall) { $payload.toolCall.name } else { "" }
                if ($toolName -eq "ask_question") {
                    $eventKind = "needs_input"
                    $title = "$wsName · Question"
                    $text = "Antigravity has a question for you"
                    $category = "Needs input"
                }
            }

            if ($eventKind) {
                $token = Get-IslandToken
                if ($token) {
                    $nowIso = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
                    $epochMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
                    $eventId = [Guid]::NewGuid().ToString()

                    $islandEvent = [ordered]@{
                        id = $eventId
                        source = "antigravity"
                        surface = "ide"
                        kind = $eventKind
                        title = $title
                        text = $text
                        category = $category
                        account = $null
                        target = [ordered]@{
                            type = "ide"
                            workspacePath = $wsPath
                            deepLink = "antigravity-ide://conversation/$convId"
                            windowTitleContains = $wsName
                        }
                        createdAt = $nowIso
                        dedupeKey = "antigravity:$convId`:$eventKind`:$epochMs"
                    }

                    $bodyJson = $islandEvent | ConvertTo-Json -Depth 5 -Compress
                    $headers = @{
                        "Authorization" = "Bearer $token"
                        "Content-Type" = "application/json"
                    }

                    # Post to Island local server
                    $null = Invoke-RestMethod -Uri "http://127.0.0.1:47821/v1/events" -Method Post -Headers $headers -Body $bodyJson -TimeoutSec 1 -ErrorAction SilentlyContinue
                }
            }
        }
    }
} catch {
    # Fail completely open without disrupting agent execution
} finally {
    # Antigravity hooks expect valid JSON on stdout
    [Console]::Out.Write("{}")
}

