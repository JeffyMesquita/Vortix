$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path $PSScriptRoot).Path
$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$tempRoot = Join-Path $tempBase ('vortix-history-retention-' + [guid]::NewGuid().ToString('N'))
$databasePath = Join-Path $tempRoot 'history.sqlite'
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
$listener.Stop()
$baseUrl = 'http://127.0.0.1:' + $port
$oldPort = $env:ApiStudio__Port
$oldDatabasePath = $env:ApiStudio__DatabasePath
$server = $null
$passed = $false
New-Item -ItemType Directory -Path $tempRoot | Out-Null
try {
    $env:ApiStudio__Port = [string]$port
    $env:ApiStudio__DatabasePath = $databasePath
    $dll = Join-Path $projectRoot 'bin\Release\net10.0\VortixApiClient.dll'
    if (-not (Test-Path -LiteralPath $dll)) { throw 'Release DLL is missing; build VortixApiClient first.' }
    $server = Start-Process -FilePath 'dotnet' -ArgumentList @($dll) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $tempRoot 'server.out') -RedirectStandardError (Join-Path $tempRoot 'server.err')
    $ready = $false
    for ($attempt = 0; $attempt -lt 50; $attempt++) {
        if ($server.HasExited) { throw 'Temporary API process exited before becoming ready.' }
        try { $health = Invoke-RestMethod -Uri ($baseUrl + '/health') -TimeoutSec 1; if ($health.status -eq 'ok') { $ready = $true; break } } catch { Start-Sleep -Milliseconds 150 }
    }
    if (-not $ready) { throw 'Temporary API did not become ready.' }
    $headers = @{ 'X-Api-Studio' = '1'; Origin = $baseUrl }
    $entries = @(
        @{ id = 'old'; savedAt = '2026-01-01T00:00:00Z'; method = 'GET'; route = '/old'; response = @{ status = 200; reason = 'OK'; durationMs = 5; headers = @{ 'Content-Type' = @('application/json') }; body = 'protected-history-body-canary' } },
        @{ id = 'middle'; savedAt = '2026-02-01T00:00:00Z'; method = 'GET'; route = '/middle'; response = @{ status = 201; reason = 'Created'; durationMs = 7; headers = @{ 'Content-Type' = @('application/json') }; body = 'protected-history-body-canary' } },
        @{ id = 'newest'; savedAt = '2026-03-01T00:00:00Z'; method = 'GET'; route = '/newest'; response = @{ status = 204; reason = 'No Content'; durationMs = 9; headers = @{}; body = '' } }
    )
    foreach ($entry in $entries) {
        $json = $entry | ConvertTo-Json -Depth 8 -Compress
        Invoke-RestMethod -Uri ($baseUrl + '/api/storage/history') -Method Post -Headers $headers -ContentType 'application/json' -Body $json -TimeoutSec 3 | Out-Null
    }
    $trimBody = @{ limit = 2 } | ConvertTo-Json -Compress
    $trimResult = Invoke-RestMethod -Uri ($baseUrl + '/api/storage/history/trim') -Method Post -Headers $headers -ContentType 'application/json' -Body $trimBody -TimeoutSec 3
    if ($trimResult.limit -ne 2 -or $trimResult.removed -ne 1) { throw 'History trim must remove only records older than the configured limit.' }
    $remaining = @(Invoke-RestMethod -Uri ($baseUrl + '/api/storage/history') -Headers $headers -TimeoutSec 3)
    $remainingIds = @($remaining | ForEach-Object { $_.id })
    if ($remainingIds.Count -ne 2 -or $remainingIds -notcontains 'middle' -or $remainingIds -notcontains 'newest') { throw ('History trim did not keep the newest records. Count=' + $remaining.Count + '; ids=' + ($remainingIds -join ',')) }
    $saved = Invoke-RestMethod -Uri ($baseUrl + '/api/storage/history?key=middle') -Headers $headers -TimeoutSec 3
    if ($saved.response.body -ne 'protected-history-body-canary') { throw 'Retained response body did not round-trip through SQLite.' }
    $scanPath = Join-Path $tempRoot 'scan-history.py'
    $scanCode = @(
        'import sqlite3, sys',
        'connection = sqlite3.connect(sys.argv[1])',
        'text = "".join(row[0] for row in connection.execute("SELECT json FROM api_studio_data WHERE store = ?", ("history",)))',
        'print("PLAIN" if "protected-history-body-canary" in text else "CLEAR")'
    ) -join "`n"
    [IO.File]::WriteAllText($scanPath, $scanCode, [Text.UTF8Encoding]::new($false))
    $scan = & python $scanPath $databasePath
    if ($LASTEXITCODE -ne 0 -or $scan.Trim() -ne 'CLEAR') { throw 'History response body was stored in SQLite plaintext.' }
    $passed = $true
    Write-Output 'HistoryRetention.test.ps1 passed.'
}
finally {
    if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue; Wait-Process -Id $server.Id -Timeout 5 -ErrorAction SilentlyContinue }
    if ($null -eq $oldPort) { Remove-Item Env:\ApiStudio__Port -ErrorAction SilentlyContinue } else { $env:ApiStudio__Port = $oldPort }
    if ($null -eq $oldDatabasePath) { Remove-Item Env:\ApiStudio__DatabasePath -ErrorAction SilentlyContinue } else { $env:ApiStudio__DatabasePath = $oldDatabasePath }
    if (Test-Path -LiteralPath $tempRoot) {
        $fullTempRoot = [IO.Path]::GetFullPath($tempRoot)
        if (-not $fullTempRoot.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing to clean a path outside the system temp directory.' }
        Remove-Item -LiteralPath $fullTempRoot -Recurse -Force
    }
}
