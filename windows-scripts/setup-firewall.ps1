# Run as Administrator
# This opens port 8088 for the SFTP Sync Web Service

Write-Host "Setting up Windows Firewall rule for SFTP Sync Service..."

# Remove existing rule if it exists
Remove-NetFirewallRule -DisplayName "SFTP Sync Web Service" -ErrorAction SilentlyContinue

# Create new firewall rule
New-NetFirewallRule -DisplayName "SFTP Sync Web Service" `
    -Direction Inbound `
    -Protocol TCP `
    -LocalPort 8088 `
    -Action Allow `
    -Enabled sTrue `
    -Profile Any

Write-Host "✓ Firewall rule created successfully"
Write-Host ""
Write-Host "Port 8088 is now open for incoming connections"
