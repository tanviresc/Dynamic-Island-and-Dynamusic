<#
.SYNOPSIS
    Antigravity Lifecycle Hook Probe (Strictly Redacted)
.DESCRIPTION
    Logs only lifecycle state signals and hashed conversation prefix.
    Never logs prompts, lastUserInput, tool arguments, or file paths.
    Always prints {} to stdout and exits in < 200ms.
#>

$startTime = [System.Diagnostics.Stopwatch]::StartNew()

try {
    $rawInput = [Console]::In.ReadToEnd()
    if ($rawInput) {
        $payload = $rawInput | ConvertFrom-Json -ErrorAction SilentlyContinue
        if ($payload) {
            $convHashPrefix = ""
            if ($payload.conversationId) {
                $sha256 = [System.Security.Cryptography.SHA256]::Create()
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload.conversationId)
                $hash = $sha256.ComputeHash($bytes)
                $convHashPrefix = ([System.BitConverter]::ToString($hash) -replace '-','').Substring(0, 8).ToLower()
            }

            $logEntry = [ordered]@{
                timestamp = (Get-Date).ToUniversalTime().ToString("o")
                hookEventName = $payload.hookEventName
                terminationReason = $payload.terminationReason
                fullyIdle = $payload.fullyIdle
                continuationActive = $payload.continuationActive
                executionNum = $payload.executionNum
                toolName = if ($payload.tool) { $payload.tool.name } else { $null }
                conversationHash = $convHashPrefix
                elapsedMs = $startTime.ElapsedMilliseconds
            }

            $logPath = Join-Path $PSScriptRoot "probe-hook.log"
            $jsonLine = $logEntry | ConvertTo-Json -Compress
            Add-Content -Path $logPath -Value $jsonLine -ErrorAction SilentlyContinue
        }
    }
}
catch {
    # Fail completely open without disrupting IDE agent execution
}
finally {
    # Antigravity hooks expect JSON response
    [Console]::Out.Write("{}")
}
