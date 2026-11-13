$sh = New-Object -ComObject WScript.Shell
$links = @(
  "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Claude.lnk",
  "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Anthropic\Claude.lnk",
  "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Chrome Apps\Claude.lnk"
)

Write-Host "=== 1. Shortcut Targets ==="
foreach ($lnk in $links) {
  if (Test-Path $lnk) {
    try {
      $sc = $sh.CreateShortcut($lnk)
      Write-Host "Link: $lnk"
      Write-Host "Target: $($sc.TargetPath)"
      Write-Host "Arguments: $($sc.Arguments)"
    } catch {
      Write-Host "Error reading ${lnk}: $_"
    }
  }
}

Write-Host "`n=== 2. UserNotificationListener Spike ==="
try {
  [Windows.UI.Notifications.Management.UserNotificationListener, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
  $listener = [Windows.UI.Notifications.Management.UserNotificationListener]::Current
  Write-Host "UserNotificationListener::Current successfully retrieved."
  $accessStatus = $listener.GetAccessStatus()
  Write-Host "AccessStatus: $accessStatus"
} catch {
  Write-Host "UserNotificationListener failed: $_"
}
