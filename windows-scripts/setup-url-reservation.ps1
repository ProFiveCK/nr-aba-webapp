# Run as Administrator
# This allows the PowerShell script to listen on port 8088 without admin rights

Write-Host "Setting up URL reservation for SFTP Sync Service..."

# Allow Everyone to bind to this port
netsh http add urlacl url=http://+:8088/ user=Everyone

Write-Host "✓ URL reservation created successfully"
Write-Host ""
Write-Host "The service can now run without administrator privileges"
