$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path $PSScriptRoot).Path
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('api-studio-protection-' + [guid]::NewGuid().ToString('N'))
$databasePath = Join-Path $temporaryRoot 'protection.sqlite'
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
$listener.Stop()
$baseUrl = 'http://127.0.0.1:' + $port
$oldPort = $env:ApiStudio__Port
$oldDatabasePath = $env:ApiStudio__DatabasePath
$oldTestSecrets = $env:API_STUDIO_TEST_SECRETS
$oldTestRecord = $env:API_STUDIO_TEST_RECORD
$server = $null
$passed = $false
New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
function Start-TestApi([string]$logName) {
    $process = Start-Process -FilePath 'dotnet' -ArgumentList @($dll) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $temporaryRoot ($logName + '.out')) -RedirectStandardError (Join-Path $temporaryRoot ($logName + '.err'))
    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if ($process.HasExited) { throw 'Temporary API process exited before becoming ready.' }
        try { $health = Invoke-RestMethod -Uri ($baseUrl + '/health') -TimeoutSec 1; if ($health.status -eq 'ok') { $ready = $true; break } } catch { Start-Sleep -Milliseconds 200 }
    }
    if (-not $ready) { throw 'Temporary API did not become ready.' }
    return $process
}
function Get-PlaintextScan([string[]]$secrets, [string]$pythonPath) {
    $env:API_STUDIO_TEST_SECRETS = ConvertTo-Json -InputObject $secrets -Compress
    $result = & python $pythonPath $databasePath
    if ($LASTEXITCODE -ne 0) { throw 'SQLite plaintext scan failed.' }
    if ($null -eq $oldTestSecrets) { Remove-Item Env:\API_STUDIO_TEST_SECRETS -ErrorAction SilentlyContinue } else { $env:API_STUDIO_TEST_SECRETS = $oldTestSecrets }
    return $result.Trim()
}
try {
    $env:ApiStudio__Port = [string]$port
    $env:ApiStudio__DatabasePath = $databasePath
    $dll = Join-Path $projectRoot 'bin\Release\net8.0\ApiPublicacaoTester.dll'
    $server = Start-TestApi 'first'
    & (Join-Path $projectRoot 'Validar-Testador.ps1') -BaseUrl $baseUrl
    $headers = @{ 'X-Api-Studio' = '1'; Origin = $baseUrl }
    $blockedHttpCall = @{ baseUrl = 'http://api.example.invalid'; route = '/health'; method = 'GET'; allowInsecureHttp = $false } | ConvertTo-Json -Compress
    $blockedHttpStatus = 0
    try { $null = Invoke-RestMethod -Uri ($baseUrl + '/api/request') -Method Post -Headers $headers -ContentType 'application/json' -Body $blockedHttpCall -TimeoutSec 3; throw 'Remote HTTP without per-request opt-in was accepted.' } catch { if ($_.Exception.Response) { $blockedHttpStatus = [int]$_.Exception.Response.StatusCode } else { throw } }
    if ($blockedHttpStatus -ne 400) { throw ('Remote HTTP without opt-in expected HTTP 400, got ' + $blockedHttpStatus) }
    $tokenProbe = @{ baseUrl = $baseUrl; route = '/api/storage/workspace/restore'; method = 'POST'; headers = "X-Api-Studio: 1`nOrigin: $baseUrl"; confirmTokenRequest = $true; tokenClientId = 'api-studio-workspace'; tokenClientSecret = 'probe-value'; tokenClientIdField = 'format'; tokenClientSecretField = 'probe'; tokenCredentialMode = 'body' } | ConvertTo-Json -Compress
    $tokenProbeResult = Invoke-RestMethod -Uri ($baseUrl + '/api/request') -Method Post -Headers $headers -ContentType 'application/json' -Body $tokenProbe -TimeoutSec 3
    if ($tokenProbeResult.proxyStatus -ge 400 -or $tokenProbeResult.status -ne 400) { throw 'Configurable token helper did not send a generic credential request to the local test endpoint.' }
    $tokenQueryProbe = @{ baseUrl = $baseUrl; route = '/api/storage/settings'; method = 'POST'; headers = "X-Api-Studio: 1`nOrigin: $baseUrl"; confirmTokenRequest = $true; tokenClientId = 'probe-key'; tokenClientSecret = 'probe-value'; tokenClientIdField = 'key'; tokenClientSecretField = 'value'; tokenCredentialMode = 'query' } | ConvertTo-Json -Compress
    $tokenQueryResult = Invoke-RestMethod -Uri ($baseUrl + '/api/request') -Method Post -Headers $headers -ContentType 'application/json' -Body $tokenQueryProbe -TimeoutSec 3
    if ($tokenQueryResult.proxyStatus -ge 400 -or $tokenQueryResult.status -lt 400) { throw 'Configurable token helper did not send custom query credential names to the local test endpoint.' }
    $bearer = 'bearer-canary-' + [guid]::NewGuid().ToString('N')
    $headerSecret = 'header-canary-' + [guid]::NewGuid().ToString('N')
    $bodySecret = 'body-canary-' + [guid]::NewGuid().ToString('N')
    $querySecret = 'query-canary-' + [guid]::NewGuid().ToString('N')
    $paramSecret = 'params-canary-' + [guid]::NewGuid().ToString('N')
    $record = @{ key = 'protection-test'; value = @{ bearerToken = $bearer; headers = "Authorization: Bearer $headerSecret`r`nX-Api-Key: api-key-canary"; body = ('Body texto livre ' + $bodySecret); route = '/auth?client_secret=' + $querySecret; params = @(@('client_secret', $paramSecret), @('tenant', 'safe-tenant')) } }
    $json = $record | ConvertTo-Json -Depth 20 -Compress
    Invoke-RestMethod -Uri ($baseUrl + '/api/storage/settings') -Method Post -Headers $headers -ContentType 'application/json' -Body $json -TimeoutSec 3 | Out-Null
    $saved = Invoke-RestMethod -Uri ($baseUrl + '/api/storage/settings?key=protection-test') -Headers $headers -TimeoutSec 3
    if ($saved.value.bearerToken -ne $bearer -or $saved.value.headers -notlike "*${headerSecret}*" -or $saved.value.body -notlike "*${bodySecret}*" -or $saved.value.route -notlike "*${querySecret}*" -or $saved.value.params[0][1] -ne $paramSecret -or $saved.value.params[1][1] -ne 'safe-tenant') { throw 'Storage API did not return original sensitive values.' }

    $scanPath = Join-Path $temporaryRoot 'scan.sqlite.py'
    $scanCode = @(
        'import json, os, sqlite3, sys',
        'connection = sqlite3.connect(sys.argv[1])',
        'text = "".join(row[0] for row in connection.execute("SELECT json FROM api_studio_data"))',
        'secrets = json.loads(os.environ["API_STUDIO_TEST_SECRETS"])',
        'print("FOUND" if any(secret in text for secret in secrets) else "CLEAR")'
    ) -join "`n"
    [System.IO.File]::WriteAllText($scanPath, $scanCode, [System.Text.UTF8Encoding]::new($false))
    $secrets = @($bearer, $headerSecret, 'api-key-canary', $bodySecret, $querySecret, $paramSecret)
    if ((Get-PlaintextScan $secrets $scanPath) -ne 'CLEAR') { throw 'A sensitive sentinel remains in SQLite plaintext.' }
    $prefixPath = Join-Path $temporaryRoot 'prefix.sqlite.py'
    $prefixCode = @(
        'import sqlite3, sys',
        'connection = sqlite3.connect(sys.argv[1])',
        'text = "".join(row[0] for row in connection.execute("SELECT json FROM api_studio_data"))',
        'print("PRESENT" if "APISTUDIO:DATA-PROTECTION:v1:" in text else "MISSING")'
    ) -join "`n"
    [System.IO.File]::WriteAllText($prefixPath, $prefixCode, [System.Text.UTF8Encoding]::new($false))
    $prefixResult = & python $prefixPath $databasePath
    if ($LASTEXITCODE -ne 0 -or $prefixResult.Trim() -ne 'PRESENT') { throw 'New protected values do not use a platform-neutral marker.' }

    $legacySecret = 'legacy-canary-' + [guid]::NewGuid().ToString('N')
    $legacyRecord = @{ key = 'legacy-protection-test'; value = @{ access_token = $legacySecret } } | ConvertTo-Json -Depth 10 -Compress
    $env:API_STUDIO_TEST_RECORD = $legacyRecord
    $seedPath = Join-Path $temporaryRoot 'seed.sqlite.py'
    $seedCode = @(
        'import json, os, sqlite3, sys',
        'record = json.loads(os.environ["API_STUDIO_TEST_RECORD"])',
        'connection = sqlite3.connect(sys.argv[1])',
        'connection.execute("INSERT INTO api_studio_data(store, record_key, json) VALUES (?, ?, ?)", ("settings", record["key"], json.dumps(record, separators=(",", ":"))))',
        'connection.commit()'
    ) -join "`n"
    [System.IO.File]::WriteAllText($seedPath, $seedCode, [System.Text.UTF8Encoding]::new($false))
    & python $seedPath $databasePath
    if ($LASTEXITCODE -ne 0) { throw 'Could not seed the legacy plaintext row.' }
    if ((Get-PlaintextScan @($legacySecret) $scanPath) -ne 'FOUND') { throw 'Legacy plaintext fixture was not seeded.' }

    try { $response = Invoke-WebRequest -Uri ($baseUrl + '/api/storage/security/protect-existing') -Method Post -Headers $headers -ContentType 'application/json' -Body '{"confirm":false}' -TimeoutSec 3; $status = [int]$response.StatusCode } catch { $status = [int]$_.Exception.Response.StatusCode }
    if ($status -ne 400) { throw ('Unconfirmed migration expected HTTP 400, got ' + $status) }
    $protected = Invoke-RestMethod -Uri ($baseUrl + '/api/storage/security/protect-existing') -Method Post -Headers $headers -ContentType 'application/json' -Body '{"confirm":true}' -TimeoutSec 10
    if ($protected.updatedRecords -ne 1) { throw 'Legacy migration did not protect the one plaintext record.' }
    $legacy = Invoke-RestMethod -Uri ($baseUrl + '/api/storage/settings?key=legacy-protection-test') -Headers $headers -TimeoutSec 3
    if ($legacy.value.access_token -ne $legacySecret) { throw 'Migrated legacy secret did not round-trip.' }
    if ((Get-PlaintextScan @($legacySecret, $bearer, $headerSecret, 'api-key-canary', $bodySecret, $querySecret, $paramSecret) $scanPath) -ne 'CLEAR') { throw 'A migrated or new secret remains in SQLite plaintext.' }
    $repeat = Invoke-RestMethod -Uri ($baseUrl + '/api/storage/security/protect-existing') -Method Post -Headers $headers -ContentType 'application/json' -Body '{"confirm":true}' -TimeoutSec 10
    if ($repeat.updatedRecords -ne 0) { throw 'Repeated secret migration was not idempotent.' }

    $compatPath = Join-Path $temporaryRoot 'compat.sqlite.py'
    $compatCode = @(
        'import sqlite3, sys',
        'connection = sqlite3.connect(sys.argv[1])',
        'cursor = connection.execute("UPDATE api_studio_data SET json = REPLACE(json, ?, ?) WHERE instr(json, ?) > 0", ("APISTUDIO:DATA-PROTECTION:v1:", "APISTUDIO:DPAPI:v1:", "APISTUDIO:DATA-PROTECTION:v1:"))',
        'connection.commit()',
        'print(cursor.rowcount)'
    ) -join "`n"
    [System.IO.File]::WriteAllText($compatPath, $compatCode, [System.Text.UTF8Encoding]::new($false))
    $rewritten = & python $compatPath $databasePath
    if ($LASTEXITCODE -ne 0 -or [int]$rewritten.Trim() -eq 0) { throw 'Could not prepare the legacy protection-marker compatibility check.' }

    Stop-Process -Id $server.Id -Force
    $server = $null
    Start-Sleep -Milliseconds 300
    $server = Start-TestApi 'restart'
    $afterRestart = Invoke-RestMethod -Uri ($baseUrl + '/api/storage/settings?key=protection-test') -Headers $headers -TimeoutSec 3
    $afterMigration = Invoke-RestMethod -Uri ($baseUrl + '/api/storage/settings?key=legacy-protection-test') -Headers $headers -TimeoutSec 3
    if ($afterRestart.value.bearerToken -ne $bearer -or $afterMigration.value.access_token -ne $legacySecret) { throw 'Protected values did not decrypt after process restart.' }
    'PASS: new secrets encrypted, legacy migration confirmed and idempotent, values survive process restart.'
    $passed = $true
}
finally {
    if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force }
    if ($null -eq $oldPort) { Remove-Item Env:\ApiStudio__Port -ErrorAction SilentlyContinue } else { $env:ApiStudio__Port = $oldPort }
    if ($null -eq $oldDatabasePath) { Remove-Item Env:\ApiStudio__DatabasePath -ErrorAction SilentlyContinue } else { $env:ApiStudio__DatabasePath = $oldDatabasePath }
    if ($null -eq $oldTestSecrets) { Remove-Item Env:\API_STUDIO_TEST_SECRETS -ErrorAction SilentlyContinue } else { $env:API_STUDIO_TEST_SECRETS = $oldTestSecrets }
    if ($null -eq $oldTestRecord) { Remove-Item Env:\API_STUDIO_TEST_RECORD -ErrorAction SilentlyContinue } else { $env:API_STUDIO_TEST_RECORD = $oldTestRecord }
    if ($temporaryRoot.StartsWith([System.IO.Path]::GetTempPath(), [System.StringComparison]::OrdinalIgnoreCase)) { Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
if (-not $passed) { exit 1 }
exit 0
