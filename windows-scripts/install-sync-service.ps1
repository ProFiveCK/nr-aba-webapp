# Run as Administrator
# This installs the SFTP Sync Web Service to run at startup

$ServiceName = "SFTPSyncWebService"
$ScriptPath = "C:\Scripts\sftp-sync-web-service.ps1"
$LogPath = "C:\Scripts\Logs\sync-web-service.log"

Write-Host "Installing SFTP Sync Web Service..."

# Create log directory if it doesn't exist
$LogDir = Split-Path $LogPath
if (!(Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

# Remove existing task if it exists
Unregister-ScheduledTask -TaskName $ServiceName -Confirm:$false -ErrorAction SilentlyContinue

# Create scheduled task action
$Action = New-ScheduledTaskAction -Execute "PowerShell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ScriptPath`" *>> `"$LogPath`""

# Create trigger (at startup)
$Trigger = New-ScheduledTaskTrigger -AtStartup

# Create principal (run as SYSTEM)
$Principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

# Create settings
$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Days 365)

# Register the task
Register-ScheduledTask -TaskName $ServiceName `
    -Action $Action `
    -Trigger $Trigger `
    -Principal $Principal `
    -Settings $Settings `
    -Description "SFTP Sync Web Service - Listens for immediate sync requests on port 8088"

Write-Host "✓ Service installed successfully as scheduled task: $ServiceName"
Write-Host ""
Write-Host "To manage the service:"
Write-Host "  Start:  Start-ScheduledTask -TaskName '$ServiceName'"
Write-Host "  Stop:   Stop-ScheduledTask -TaskName '$ServiceName'"
Write-Host "  Status: Get-ScheduledTask -TaskName '$ServiceName' | Select State"
Write-Host "  Logs:   Get-Content '$LogPath' -Tail 50"
Write-Host ""
Write-Host "Starting service now..."
Start-ScheduledTask -TaskName $ServiceName

Start-Sleep -Seconds 3

$Task = Get-ScheduledTask -TaskName $ServiceName
Write-Host "Service Status: $($Task.State)"
