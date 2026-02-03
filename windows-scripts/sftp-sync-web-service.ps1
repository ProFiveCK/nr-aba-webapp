# SFTP Sync Web Service
# This creates a simple HTTP server that listens for sync trigger requests
# Install: Run this as a Windows Service using NSSM or Task Scheduler

# Configuration
$ListenPort = 8088
$ListenPrefix = "http://+:$ListenPort/"
$SyncScriptPath = "C:\Scripts\your-existing-sftp-sync.ps1"  # UPDATE THIS PATH

# Database connection for logging (optional)
$DbHost = "your-postgres-host"  # UPDATE THIS
$DbPort = "5432"
$DbName = "aba"
$DbUser = "postgres"
$DbPassword = "your-password"  # UPDATE THIS

Write-Host "============================================"
Write-Host "SFTP Sync Web Service Starting"
Write-Host "Listening on: http://localhost:$ListenPort/"
Write-Host "Sync Script: $SyncScriptPath"
Write-Host "============================================"

# Create HTTP listener
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($ListenPrefix)

try {
    $listener.Start()
    Write-Host "✓ Web service started successfully"
    Write-Host ""
    Write-Host "Endpoints:"
    Write-Host "  POST /sync-trigger - Trigger immediate sync"
    Write-Host "  GET /health - Health check"
    Write-Host ""
}
catch {
    Write-Host "ERROR: Failed to start listener. Make sure:"
    Write-Host "  1. Port $ListenPort is not in use"
    Write-Host "  2. You have admin rights or run: netsh http add urlacl url=$ListenPrefix user=Everyone"
    Write-Host ""
    Write-Host "Error details: $($_.Exception.Message)"
    exit 1
}

# Main request loop
while ($listener.IsListening) {
    try {
        # Wait for incoming request
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response
        
        $method = $request.HttpMethod
        $path = $request.Url.LocalPath
        $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        
        Write-Host "[$timestamp] $method $path from $($request.RemoteEndPoint)"
        
        # Handle different endpoints
        if ($method -eq "GET" -and $path -eq "/health") {
            # Health check endpoint
            $responseData = @{
                status = "healthy"
                service = "SFTP Sync Service"
                timestamp = $timestamp
                syncScript = $SyncScriptPath
            } | ConvertTo-Json
            
            $response.StatusCode = 200
            $response.ContentType = "application/json"
        }
        elseif ($method -eq "POST" -and $path -eq "/sync-trigger") {
            # Trigger sync endpoint
            try {
                Write-Host "  → Triggering SFTP sync..."
                
                # Read request body for logging
                $reader = New-Object System.IO.StreamReader($request.InputStream)
                $requestBody = $reader.ReadToEnd()
                $reader.Close()
                
                $requestData = $null
                if ($requestBody) {
                    try {
                        $requestData = $requestBody | ConvertFrom-Json
                    } catch {
                        Write-Host "  ⚠ Could not parse request body"
                    }
                }
                
                # Execute the sync script
                $syncStartTime = Get-Date
                $syncOutput = & $SyncScriptPath 2>&1
                $syncEndTime = Get-Date
                $syncDuration = ($syncEndTime - $syncStartTime).TotalSeconds
                
                # Count transferred files (adjust based on your script output)
                $filesCount = 0
                if ($syncOutput) {
                    $syncOutput | ForEach-Object {
                        if ($_ -match "transferred|copied|uploaded") {
                            $filesCount++
                        }
                    }
                }
                
                Write-Host "  ✓ Sync completed in $syncDuration seconds"
                
                $responseData = @{
                    success = $true
                    message = "SFTP sync completed successfully"
                    timestamp = $timestamp
                    duration = $syncDuration
                    filesCount = $filesCount
                    requestedBy = $requestData.requestedBy
                } | ConvertTo-Json
                
                $response.StatusCode = 200
                $response.ContentType = "application/json"
            }
            catch {
                Write-Host "  ✗ Sync failed: $($_.Exception.Message)"
                
                $responseData = @{
                    success = $false
                    error = $_.Exception.Message
                    timestamp = $timestamp
                } | ConvertTo-Json
                
                $response.StatusCode = 500
                $response.ContentType = "application/json"
            }
        }
        else {
            # 404 Not Found
            $responseData = @{
                error = "Not Found"
                path = $path
                method = $method
            } | ConvertTo-Json
            
            $response.StatusCode = 404
            $response.ContentType = "application/json"
        }
        
        # Send response
        $buffer = [System.Text.Encoding]::UTF8.GetBytes($responseData)
        $response.ContentLength64 = $buffer.Length
        $response.OutputStream.Write($buffer, 0, $buffer.Length)
        $response.Close()
    }
    catch {
        Write-Host "ERROR handling request: $($_.Exception.Message)"
        try {
            $response.Close()
        } catch {}
    }
}

# Cleanup
$listener.Stop()
$listener.Close()
Write-Host "Web service stopped."
