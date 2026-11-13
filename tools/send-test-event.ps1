param(
    [string]$Source = "claude",
    [string]$Kind = "done",
    [string]$Title = "Test Notification",
    [string]$Text = "This is a test notification injected via script",
    [string]$Category = "",
    [string]$Account = "",
    [int]$Port = 47821,
    [string]$Token = ""
)

# 1. Obtain token from parameter, clipboard, or interactive prompt
if ([string]::IsNullOrWhiteSpace($Token)) {
    try {
        $clipboard = Get-Clipboard -Raw -ErrorAction SilentlyContinue
        if (![string]::IsNullOrWhiteSpace($clipboard) -and $clipboard.Trim().Length -eq 43) {
            $Token = $clipboard.Trim()
            Write-Host "Using pairing token from clipboard." -ForegroundColor Green
        }
    } catch {}
}

if ([string]::IsNullOrWhiteSpace($Token)) {
    $Token = Read-Host "Enter Island pairing token"
}

if ([string]::IsNullOrWhiteSpace($Token)) {
    Write-Error "A valid pairing token is required."
    exit 1
}

# 2. Map surface from source
$surface = "web"
$target = @{
    type = "browserTab"
    tabId = 1
    windowId = 1
    url = "https://claude.ai"
}

if ($Source -eq "antigravity") {
    $surface = "ide"
    $target = @{
        type = "ide"
        workspacePath = "E:\dynamic island"
        deepLink = "antigravity-ide://file/E:/dynamic%20island"
    }
} elseif ($Source -eq "gmail") {
    $surface = "background"
    $target = @{
        type = "url"
        url = "https://mail.google.com/mail/u/?authuser=me@example.com"
    }
    if ([string]::IsNullOrWhiteSpace($Account)) {
        $Account = "personal"
    }
}

$id = [guid]::NewGuid().ToString()
$createdAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$dedupeKey = "$Source`:$surface`:$id`:$Kind"

$payload = @{
    id = $id
    source = $Source
    surface = $surface
    kind = $Kind
    title = $Title
    text = $Text
    target = $target
    createdAt = $createdAt
    dedupeKey = $dedupeKey
}

if (![string]::IsNullOrWhiteSpace($Category)) {
    $payload.category = $Category
}
if (![string]::IsNullOrWhiteSpace($Account)) {
    $payload.account = $Account
}

$jsonBody = $payload | ConvertTo-Json -Depth 5 -Compress

Write-Host "Sending event to http://127.0.0.1:$Port/v1/events ..." -ForegroundColor Cyan

try {
    $headers = @{
        "Authorization" = "Bearer $Token"
        "Content-Type" = "application/json"
    }
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/v1/events" -Method Post -Headers $headers -Body $jsonBody
    Write-Host "Success! Server Response:" -ForegroundColor Green
    $response | Format-List
} catch {
    Write-Error "Failed to send event: $_"
    if ($_.Exception.Response) {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        Write-Host "Details: " ($reader.ReadToEnd()) -ForegroundColor Red
    }
    exit 1
}
