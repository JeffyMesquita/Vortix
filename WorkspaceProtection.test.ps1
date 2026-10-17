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
$authMockServer = $null
$oauthMockServer = $null
$cookieMockServer = $null
$bodyMockServer = $null
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
function Start-AuthCaptureServer([int]$requestCount) {
    $readyPath = Join-Path $temporaryRoot 'auth-mock.port'
    $scriptPath = Join-Path $projectRoot 'AuthCaptureServer.test.ps1'
    $process = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $scriptPath, '-RequestCount', [string]$requestCount, '-ReadyPath', $readyPath, '-OutputRoot', $temporaryRoot) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $temporaryRoot 'auth-mock.out') -RedirectStandardError (Join-Path $temporaryRoot 'auth-mock.err')
    for ($attempt = 0; $attempt -lt 50; $attempt++) {
        if ($process.HasExited) { throw 'Auth capture server exited before becoming ready.' }
        if (Test-Path $readyPath) { break }
        Start-Sleep -Milliseconds 100
    }
    if (-not (Test-Path $readyPath)) { throw 'Auth capture server did not become ready.' }
    return [pscustomobject]@{ Process = $process; Port = [int](Get-Content -Raw $readyPath) }
}


function Start-OAuthCaptureServer([int]$requestCount) {
    $readyPath = Join-Path $temporaryRoot 'oauth-mock.port'
    $scriptPath = Join-Path $projectRoot 'OAuthCaptureServer.test.ps1'
    $process = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $scriptPath, '-RequestCount', [string]$requestCount, '-ReadyPath', $readyPath, '-OutputRoot', $temporaryRoot) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $temporaryRoot 'oauth-mock.out') -RedirectStandardError (Join-Path $temporaryRoot 'oauth-mock.err')
    for ($attempt = 0; $attempt -lt 50; $attempt++) {
        if ($process.HasExited) { throw 'OAuth capture server exited before becoming ready.' }
        if (Test-Path $readyPath) { break }
        Start-Sleep -Milliseconds 100
    }
    if (-not (Test-Path $readyPath)) { throw 'OAuth capture server did not become ready.' }
    return [pscustomobject]@{ Process = $process; Port = [int](Get-Content -Raw $readyPath) }
}
function Start-CookieCaptureServer([int]$requestCount) {
    $readyPath = Join-Path $temporaryRoot 'cookie-mock.port'
    $scriptPath = Join-Path $projectRoot 'CookieCaptureServer.test.ps1'
    $process = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $scriptPath, '-RequestCount', [string]$requestCount, '-ReadyPath', $readyPath, '-OutputRoot', $temporaryRoot) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $temporaryRoot 'cookie-mock.out') -RedirectStandardError (Join-Path $temporaryRoot 'cookie-mock.err')
    for ($attempt = 0; $attempt -lt 50; $attempt++) {
        if ($process.HasExited) { throw 'Cookie capture server exited before becoming ready.' }
        if (Test-Path $readyPath) { break }
        Start-Sleep -Milliseconds 100
    }
    if (-not (Test-Path $readyPath)) { throw 'Cookie capture server did not become ready.' }
    return [pscustomobject]@{ Process = $process; Port = [int](Get-Content -Raw $readyPath) }
}

function Start-BodyCaptureServer([int]$requestCount) {
    $readyPath = Join-Path $temporaryRoot 'body-mock.port'
    $scriptPath = Join-Path $projectRoot 'BodyCaptureServer.test.ps1'
    $process = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $scriptPath, '-RequestCount', [string]$requestCount, '-ReadyPath', $readyPath, '-OutputRoot', $temporaryRoot) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $temporaryRoot 'body-mock.out') -RedirectStandardError (Join-Path $temporaryRoot 'body-mock.err')
    for ($attempt = 0; $attempt -lt 50; $attempt++) {
        if ($process.HasExited) { throw 'Body capture server exited before becoming ready.' }
        if (Test-Path $readyPath) { break }
        Start-Sleep -Milliseconds 100
    }
    if (-not (Test-Path $readyPath)) { throw 'Body capture server did not become ready.' }
    return [pscustomobject]@{ Process = $process; Port = [int](Get-Content -Raw $readyPath) }
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
    $dll = Join-Path $projectRoot 'bin\Release\net8.0\VortixApiClient.dll'
    $server = Start-TestApi 'first'
    & (Join-Path $projectRoot 'Test-VortixApiClient.ps1') -BaseUrl $baseUrl
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
    $basicUsername = 'username-canary-' + [guid]::NewGuid().ToString('N')
    $basicPassword = 'basic-password-canary-' + [guid]::NewGuid().ToString('N')
    $apiKey = 'api-key-value-canary-' + [guid]::NewGuid().ToString('N')
    $collectionAuth = 'collection-auth-canary-' + [guid]::NewGuid().ToString('N')
    $folderAuth = 'folder-auth-canary-' + [guid]::NewGuid().ToString('N')
    $responseExampleBody = 'response-example-body-canary-' + [guid]::NewGuid().ToString('N')
    $record = @{ key = 'protection-test'; value = @{ bearerToken = $bearer; headers = "Authorization: Bearer $headerSecret`r`nX-Api-Key: api-key-canary"; body = ('Body texto livre ' + $bodySecret); route = '/auth?client_secret=' + $querySecret; params = @(@('client_secret', $paramSecret), @('tenant', 'safe-tenant')); basicUsername = $basicUsername; basicPassword = $basicPassword; authType = 'apiKey'; apiKeyName = 'X-API-Key'; apiKeyValue = $apiKey; collection = @{ auth = @{ authType = 'bearer'; bearerToken = $collectionAuth }; folders = @(@{ auth = @{ authType = 'apiKey'; apiKeyName = 'X-API-Key'; apiKeyValue = $folderAuth } }); requests = @(@{ responseExamples = @(@{ id = 'response-example-test'; name = 'Sucesso'; status = 200; headers = @{ 'Content-Type' = @('application/json') }; body = ('Response example body ' + $responseExampleBody); savedAt = '2026-10-15T12:00:00.000Z' }) }) } } }
    $json = $record | ConvertTo-Json -Depth 20 -Compress
    Invoke-RestMethod -Uri ($baseUrl + '/api/storage/settings') -Method Post -Headers $headers -ContentType 'application/json' -Body $json -TimeoutSec 3 | Out-Null
    $saved = Invoke-RestMethod -Uri ($baseUrl + '/api/storage/settings?key=protection-test') -Headers $headers -TimeoutSec 3
    if ($saved.value.bearerToken -ne $bearer -or $saved.value.headers -notlike "*${headerSecret}*" -or $saved.value.body -notlike "*${bodySecret}*" -or $saved.value.route -notlike "*${querySecret}*" -or $saved.value.params[0][1] -ne $paramSecret -or $saved.value.params[1][1] -ne 'safe-tenant' -or $saved.value.basicUsername -ne $basicUsername -or $saved.value.basicPassword -ne $basicPassword -or $saved.value.apiKeyValue -ne $apiKey -or $saved.value.collection.auth.bearerToken -ne $collectionAuth -or $saved.value.collection.folders[0].auth.apiKeyValue -ne $folderAuth -or $saved.value.collection.requests[0].responseExamples[0].body -ne ('Response example body ' + $responseExampleBody)) { throw 'Storage API did not return original sensitive values.' }

    $missingKeyBytes = [byte[]]@(9, 240, 201, 240)
    $missingKeyBytes += [guid]::NewGuid().ToByteArray()
    $missingKeyBytes += [byte[]]@(1, 2, 3, 4)
    $unavailableModeMarker = 'APISTUDIO:DATA-PROTECTION:v1:' + [Convert]::ToBase64String($missingKeyBytes)
    $workspaceTabsFixture = @{
        key = 'workspaceTabs'
        value = @{ activeId = 'recovery-tab'; tabs = @(@{ id = 'recovery-tab'; title = 'Recovery'; request = @{ method = 'GET'; route = '/health'; tokenCredentialMode = $unavailableModeMarker } }) }
    } | ConvertTo-Json -Depth 12 -Compress
    $null = Invoke-RestMethod -Uri ($baseUrl + '/api/storage/settings') -Method Post -Headers $headers -ContentType 'application/json' -Body $workspaceTabsFixture -TimeoutSec 3
    $recoveredTabsResponse = $null; $recoveredTabsStatus = 0
    try { $recoveredTabsResponse = Invoke-WebRequest -Uri ($baseUrl + '/api/storage/settings?key=workspaceTabs') -Headers $headers -TimeoutSec 3 -UseBasicParsing; $recoveredTabsStatus = [int]$recoveredTabsResponse.StatusCode } catch { if ($_.Exception.Response) { $recoveredTabsStatus = [int]$_.Exception.Response.StatusCode } else { throw } }
    if ($recoveredTabsStatus -ne 200) { throw ('Unreadable non-secret tokenCredentialMode must recover as body; expected HTTP 200, got ' + $recoveredTabsStatus) }
    $recoveredTabs = $recoveredTabsResponse.Content | ConvertFrom-Json
    if ($recoveredTabs.value.tabs[0].request.tokenCredentialMode -ne 'body' -or @($recoveredTabsResponse.Headers['X-Api-Studio-Data-Recovery']) -notcontains 'tokenCredentialMode') { throw 'Workspace recovery did not return the safe body default and warning header.' }
    $recoveredWorkspace = Invoke-WebRequest -Uri ($baseUrl + '/api/storage/workspace') -Headers $headers -TimeoutSec 3 -UseBasicParsing
    if ([int]$recoveredWorkspace.StatusCode -ne 200) { throw 'Unreadable tokenCredentialMode still prevents a full workspace snapshot.' }
    $recoveredWorkspaceJson = $recoveredWorkspace.Content | ConvertFrom-Json
    $workspaceTabsRecord = @($recoveredWorkspaceJson.settings | Where-Object { $_.key -eq 'workspaceTabs' })[0]
    if ($workspaceTabsRecord.value.tabs[0].request.tokenCredentialMode -ne 'body') { throw 'Full workspace snapshot did not apply the safe body default.' }
    $markerCheckPath = Join-Path $temporaryRoot 'check-workspace-marker.py'
    $markerCheckCode = @(
        'import json, sqlite3, sys',
        'connection = sqlite3.connect(sys.argv[1])',
        'raw = connection.execute("SELECT json FROM api_studio_data WHERE store = ? AND record_key = ?", ("settings", "workspaceTabs")).fetchone()[0]',
        'stored = json.loads(raw)["value"]["tabs"][0]["request"]["tokenCredentialMode"]',
        'print("PRESERVED" if stored == sys.argv[2] else "CHANGED")'
    ) -join "`n"
    [System.IO.File]::WriteAllText($markerCheckPath, $markerCheckCode, [System.Text.UTF8Encoding]::new($false))
    $markerCheck = & python $markerCheckPath $databasePath $unavailableModeMarker
    if ($LASTEXITCODE -ne 0 -or $markerCheck.Trim() -ne 'PRESERVED') { throw 'The unreadable protected value was modified while returning its safe fallback.' }
    $scanPath = Join-Path $temporaryRoot 'scan.sqlite.py'
    $scanCode = @(
        'import json, os, sqlite3, sys',
        'connection = sqlite3.connect(sys.argv[1])',
        'text = "".join(row[0] for row in connection.execute("SELECT json FROM api_studio_data"))',
        'secrets = json.loads(os.environ["API_STUDIO_TEST_SECRETS"])',
        'print("FOUND" if any(secret in text for secret in secrets) else "CLEAR")'
    ) -join "`n"
    [System.IO.File]::WriteAllText($scanPath, $scanCode, [System.Text.UTF8Encoding]::new($false))
    $secrets = @($bearer, $headerSecret, 'api-key-canary', $bodySecret, $querySecret, $paramSecret, $basicUsername, $basicPassword, $apiKey, $collectionAuth, $folderAuth, $responseExampleBody, 'local-session-canary', 'local-domain-canary', 'local-secure-canary')
    $pkceAccessToken = 'pkce-access-canary-' + [guid]::NewGuid().ToString('N')
    $pkceRefreshToken = 'pkce-refresh-canary-' + [guid]::NewGuid().ToString('N')
    $pkceEnvironment = @{ id = 'pkce-protection-test'; name = 'PKCE protection test'; group = 'OAuth'; variables = @{ token = $pkceAccessToken; refresh_token = $pkceRefreshToken } } | ConvertTo-Json -Depth 10 -Compress
    $null = Invoke-RestMethod -Uri ($baseUrl + '/api/storage/environments') -Method Post -Headers $headers -ContentType 'application/json' -Body $pkceEnvironment -TimeoutSec 3
    $pkceRoundTrip = Invoke-RestMethod -Uri ($baseUrl + '/api/storage/environments?key=pkce-protection-test') -Headers $headers -TimeoutSec 3
    if ($pkceRoundTrip.variables.token -ne $pkceAccessToken -or $pkceRoundTrip.variables.refresh_token -ne $pkceRefreshToken) { throw 'PKCE environment tokens did not round-trip through protected storage.' }
    $secrets += @($pkceAccessToken, $pkceRefreshToken)
    if ((Get-PlaintextScan $secrets $scanPath) -ne 'CLEAR') { throw 'A sensitive sentinel remains in SQLite plaintext.' }
    $authMockServer = Start-AuthCaptureServer 3
    $mockBaseUrl = 'http://127.0.0.1:' + $authMockServer.Port
    $wireUsername = 'basic-user-' + [guid]::NewGuid().ToString('N')
    $wirePassword = 'basic-pass-' + [guid]::NewGuid().ToString('N')
    $wireBasic = @{ baseUrl = $mockBaseUrl; route = '/auth'; method = 'GET'; authType = 'basic'; basicUsername = $wireUsername; basicPassword = $wirePassword } | ConvertTo-Json -Compress
    $basicResponse = Invoke-RestMethod -Uri ($baseUrl + '/api/request') -Method Post -Headers $headers -ContentType 'application/json' -Body $wireBasic -TimeoutSec 5
    if ($basicResponse.status -ne 200) { throw 'Basic authentication request did not reach the local capture server.' }
    $basicCapture = Get-Content -Raw (Join-Path $temporaryRoot 'request-0.txt')
    $expectedBasic = 'Authorization: Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($wireUsername + ':' + $wirePassword))
    if ($basicCapture -notmatch [regex]::Escape($expectedBasic)) { throw 'Basic authentication header was not generated correctly.' }
    $wireHeaderKey = 'header-key-' + [guid]::NewGuid().ToString('N')
    $wireHeaderCall = @{ baseUrl = $mockBaseUrl; route = '/auth'; method = 'GET'; authType = 'apiKey'; apiKeyName = 'X-API-Key'; apiKeyLocation = 'header'; apiKeyValue = $wireHeaderKey } | ConvertTo-Json -Compress
    $headerResponse = Invoke-RestMethod -Uri ($baseUrl + '/api/request') -Method Post -Headers $headers -ContentType 'application/json' -Body $wireHeaderCall -TimeoutSec 5
    if ($headerResponse.status -ne 200) { throw 'API key header request did not reach the local capture server.' }
    $headerCapture = Get-Content -Raw (Join-Path $temporaryRoot 'request-1.txt')
    if ($headerCapture -notmatch [regex]::Escape('X-API-Key: ' + $wireHeaderKey)) { throw 'API key header was not applied.' }
    $wireQueryKey = 'query-key-' + [guid]::NewGuid().ToString('N')
    $wireQueryCall = @{ baseUrl = $mockBaseUrl; route = '/auth'; method = 'GET'; authType = 'apiKey'; apiKeyName = 'access_key'; apiKeyLocation = 'query'; apiKeyValue = $wireQueryKey } | ConvertTo-Json -Compress
    $queryResponse = Invoke-RestMethod -Uri ($baseUrl + '/api/request') -Method Post -Headers $headers -ContentType 'application/json' -Body $wireQueryCall -TimeoutSec 5
    if ($queryResponse.status -ne 200) { throw 'API key query request did not reach the local capture server.' }
    $queryCapture = Get-Content -Raw (Join-Path $temporaryRoot 'request-2.txt')
    if ($queryCapture -notmatch [regex]::Escape('access_key=' + $wireQueryKey)) { throw 'API key query parameter was not applied.' }

    $oauthMockServer = Start-OAuthCaptureServer 2
    $oauthBaseUrl = 'http://127.0.0.1:' + $oauthMockServer.Port
    $oauthClientId = 'oauth client:id'
    $oauthClientSecret = 'oauth-secret&value-' + [guid]::NewGuid().ToString('N')
    $encodedClientId = [System.Net.WebUtility]::UrlEncode($oauthClientId)
    $encodedClientSecret = [System.Net.WebUtility]::UrlEncode($oauthClientSecret)
    $oauthBasicCall = @{
        baseUrl = $oauthBaseUrl; route = '/oauth/token?tenant=demo'; method = 'POST'; bodyMode = 'urlencoded'
        body = 'grant_type=client_credentials&scope=read+write'; headers = 'Accept: application/json'
        authType = 'basic'; basicUsername = $encodedClientId; basicPassword = $encodedClientSecret
        confirmTokenRequest = $true; tokenFlow = 'oauth2-client-credentials'; environmentId = 'oauth-client-credentials-basic'
    } | ConvertTo-Json -Compress
    $oauthBasicResult = Invoke-RestMethod -Uri ($baseUrl + '/api/request') -Method Post -Headers $headers -ContentType 'application/json' -Body $oauthBasicCall -TimeoutSec 5
    if ($oauthBasicResult.status -ne 200 -or $oauthBasicResult.body -notlike '*oauth-access-canary-012345*') { throw 'OAuth client_secret_basic token request did not complete.' }
    $oauthBasicCapture = Get-Content -Raw (Join-Path $temporaryRoot 'oauth-request-0.txt')
    $expectedOAuthBasic = 'Authorization: Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($encodedClientId + ':' + $encodedClientSecret))
    if ($oauthBasicCapture -notmatch [regex]::Escape($expectedOAuthBasic) -or $oauthBasicCapture -notmatch '(?im)^Content-Type:\s*application/x-www-form-urlencoded' -or -not $oauthBasicCapture.Contains('grant_type=client_credentials&scope=read+write') -or $oauthBasicCapture -notmatch '(?m)^POST /oauth/token\?tenant=demo ') { throw 'OAuth Basic authentication, form body, or endpoint query was not preserved.' }
    if ($oauthBasicCapture.Contains($oauthClientSecret) -or $oauthBasicCapture.Contains('client_secret=')) { throw 'client_secret_basic leaked the secret to the body or URL.' }

    $oauthPostCall = @{
        baseUrl = $oauthBaseUrl; route = '/oauth/token'; method = 'POST'; bodyMode = 'urlencoded'
        body = 'grant_type=client_credentials&client_id=' + $encodedClientId + '&client_secret=' + $encodedClientSecret
        headers = 'Accept: application/json'; authType = 'none'; confirmTokenRequest = $true
        tokenFlow = 'oauth2-client-credentials'; environmentId = 'oauth-client-credentials-post'
    } | ConvertTo-Json -Compress
    $oauthPostResult = Invoke-RestMethod -Uri ($baseUrl + '/api/request') -Method Post -Headers $headers -ContentType 'application/json' -Body $oauthPostCall -TimeoutSec 5
    if ($oauthPostResult.status -ne 200 -or $oauthPostResult.body -notlike '*oauth-access-canary-012345*') { throw 'OAuth client_secret_post token request did not complete.' }
    $oauthPostCapture = Get-Content -Raw (Join-Path $temporaryRoot 'oauth-request-1.txt')
    if ($oauthPostCapture -match '(?im)^Authorization:' -or -not $oauthPostCapture.Contains('grant_type=client_credentials&client_id=' + $encodedClientId + '&client_secret=' + $encodedClientSecret) -or $oauthPostCapture -match '(?m)^POST /oauth/token[?]') { throw 'OAuth client_secret_post form credentials were not sent only in the body.' }
    $assertOAuthRejected = {
        param([string]$callJson, [string]$label)
        $status = 0
        try {
            $null = Invoke-RestMethod -Uri ($baseUrl + '/api/request') -Method Post -Headers $headers -ContentType 'application/json' -Body $callJson -TimeoutSec 5
            $status = 200
        } catch {
            if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode } else { throw }
        }
        if ($status -ne 400) { throw ('Invalid OAuth token request expected HTTP 400: ' + $label) }
    }
    $oauthBadQuery = @{ baseUrl = $oauthBaseUrl; route = '/oauth/token?client_secret=query-leak'; method = 'POST'; bodyMode = 'urlencoded'; body = 'grant_type=client_credentials'; headers = 'Accept: application/json'; authType = 'basic'; basicUsername = $encodedClientId; basicPassword = $encodedClientSecret; confirmTokenRequest = $true; tokenFlow = 'oauth2-client-credentials' } | ConvertTo-Json -Compress
    & $assertOAuthRejected $oauthBadQuery 'secret in URL'
    $oauthDuplicateGrant = @{ baseUrl = $oauthBaseUrl; route = '/oauth/token'; method = 'POST'; bodyMode = 'urlencoded'; body = 'grant_type=client_credentials&grant_type=client_credentials&client_id=id&client_secret=' + $oauthClientSecret; headers = 'Accept: application/json'; authType = 'none'; confirmTokenRequest = $true; tokenFlow = 'oauth2-client-credentials' } | ConvertTo-Json -Compress
    & $assertOAuthRejected $oauthDuplicateGrant 'duplicate grant_type'
    $oauthMixedAuth = @{ baseUrl = $oauthBaseUrl; route = '/oauth/token'; method = 'POST'; bodyMode = 'urlencoded'; body = 'grant_type=client_credentials&client_secret=duplicate-one&client_secret=duplicate-two'; headers = 'Accept: application/json'; authType = 'basic'; basicUsername = $encodedClientId; basicPassword = $encodedClientSecret; confirmTokenRequest = $true; tokenFlow = 'oauth2-client-credentials' } | ConvertTo-Json -Compress
    & $assertOAuthRejected $oauthMixedAuth 'client_secret in both Basic and body'
    $oauthWrongContentType = @{ baseUrl = $oauthBaseUrl; route = '/oauth/token'; method = 'POST'; bodyMode = 'urlencoded'; body = 'grant_type=client_credentials'; headers = 'Accept: application/json' + [Environment]::NewLine + 'Content-Type: application/json'; authType = 'basic'; basicUsername = $encodedClientId; basicPassword = $encodedClientSecret; confirmTokenRequest = $true; tokenFlow = 'oauth2-client-credentials' } | ConvertTo-Json -Compress
    & $assertOAuthRejected $oauthWrongContentType 'wrong content type'
    $secrets += $oauthClientSecret
    if ((Get-PlaintextScan $secrets $scanPath) -ne 'CLEAR') { throw 'OAuth client_secret was persisted in SQLite plaintext.' }
    $cookieMockServer = Start-CookieCaptureServer 5
    $cookieBaseUrl = 'http://localhost:' + $cookieMockServer.Port
    $cookieSetCall = @{ baseUrl = $cookieBaseUrl; route = '/scope/set'; method = 'GET'; environmentId = 'cookie-env-a' } | ConvertTo-Json -Compress
    $cookieSetResponse = Invoke-RestMethod -Uri ($baseUrl + '/api/request') -Method Post -Headers $headers -ContentType 'application/json' -Body $cookieSetCall -TimeoutSec 5
    if ($cookieSetResponse.status -ne 200) { throw 'Cookie setup request did not reach the local capture server.' }
    $cookieRecord = Invoke-RestMethod -Uri ($baseUrl + '/api/storage/settings?key=cookiejar%3Acookie-env-a') -Headers $headers -TimeoutSec 3
    $sessionCookie = @($cookieRecord.value.cookies | Where-Object { $_.cookieName -eq 'session' })[0]
    if (-not $sessionCookie -or $sessionCookie.cookiePath -ne '/scope' -or $sessionCookie.sameSite -ne 'Lax' -or $sessionCookie.httpOnly -ne $true) { throw 'Cookie metadata was not stored for its environment.' }
    $domainCookie = @($cookieRecord.value.cookies | Where-Object { $_.cookieName -eq 'domain-session' })[0]
    if (-not $domainCookie -or $domainCookie.cookieDomain -ne 'localhost' -or $domainCookie.hostOnly -ne $false) { throw 'Cookie domain metadata was not preserved.' }
    $cookieOtherEnvironment = @{ baseUrl = $cookieBaseUrl; route = '/scope/read'; method = 'GET'; environmentId = 'cookie-env-b' } | ConvertTo-Json -Compress
    $cookieOtherResponse = Invoke-RestMethod -Uri ($baseUrl + '/api/request') -Method Post -Headers $headers -ContentType 'application/json' -Body $cookieOtherEnvironment -TimeoutSec 5
    if ($cookieOtherResponse.status -ne 200) { throw 'Second-environment cookie request did not reach the local capture server.' }
    $otherEnvironmentCapture = Get-Content -Raw (Join-Path $temporaryRoot 'cookie-request-1.txt')
    if ($otherEnvironmentCapture -match '(?im)^Cookie:') { throw 'Cookie jar leaked between environments.' }
    $cookieWrongPath = @{ baseUrl = $cookieBaseUrl; route = '/elsewhere'; method = 'GET'; environmentId = 'cookie-env-a' } | ConvertTo-Json -Compress
    $cookiePathResponse = Invoke-RestMethod -Uri ($baseUrl + '/api/request') -Method Post -Headers $headers -ContentType 'application/json' -Body $cookieWrongPath -TimeoutSec 5
    if ($cookiePathResponse.status -ne 200) { throw 'Cookie path-scope request did not reach the local capture server.' }
    $wrongPathCapture = Get-Content -Raw (Join-Path $temporaryRoot 'cookie-request-2.txt')
    if ($wrongPathCapture -match '(?im)^Cookie:' -or $wrongPathCapture -match 'expired=') { throw 'Cookie path or expiry rules were not applied.' }
    $cookieWrongHost = @{ baseUrl = ('http://127.0.0.1:' + $cookieMockServer.Port); route = '/scope/read'; method = 'GET'; environmentId = 'cookie-env-a' } | ConvertTo-Json -Compress
    $cookieHostResponse = Invoke-RestMethod -Uri ($baseUrl + '/api/request') -Method Post -Headers $headers -ContentType 'application/json' -Body $cookieWrongHost -TimeoutSec 5
    if ($cookieHostResponse.status -ne 200) { throw 'Cookie host-scope request did not reach the local capture server.' }
    $wrongHostCapture = Get-Content -Raw (Join-Path $temporaryRoot 'cookie-request-3.txt')
    if ($wrongHostCapture -match '(?im)^Cookie:') { throw 'Host-only or domain cookie leaked to another host.' }
    if ((Get-PlaintextScan $secrets $scanPath) -ne 'CLEAR') { throw 'A cookie value remains in SQLite plaintext.' }


    $bodyMockServer = Start-BodyCaptureServer 7
    $bodyMockBaseUrl = 'http://127.0.0.1:' + $bodyMockServer.Port
    $bodyCases = @(
        [pscustomobject]@{ mode = 'json'; body = '{"ok":true}'; contentType = 'application/json'; headers = '' },
        [pscustomobject]@{ mode = 'text'; body = 'plain-text-body'; contentType = 'text/plain'; headers = '' },
        [pscustomobject]@{ mode = 'xml'; body = '<note>ok</note>'; contentType = 'application/xml'; headers = '' },
        [pscustomobject]@{ mode = 'urlencoded'; body = 'name=Ana&tag=one&tag=two'; contentType = 'application/x-www-form-urlencoded'; headers = '' },
        [pscustomobject]@{ mode = 'graphql'; body = '{"query":"query Example { ping }","variables":{"id":7},"operationName":"Example"}'; contentType = 'application/json'; headers = '' },
        [pscustomobject]@{ mode = 'text'; body = '{"override":true}'; contentType = 'application/vnd.example+json'; headers = 'Content-Type: application/vnd.example+json' }
    )
    for ($bodyIndex = 0; $bodyIndex -lt $bodyCases.Count; $bodyIndex++) {
        $bodyCase = $bodyCases[$bodyIndex]
        $bodyCall = @{ baseUrl = $bodyMockBaseUrl; route = '/body'; method = 'POST'; bodyMode = $bodyCase.mode; body = $bodyCase.body; headers = $bodyCase.headers; confirmTestData = $true; testDataPhrase = 'TESTE'; environmentId = 'body-mode-test' } | ConvertTo-Json -Compress
        $bodyResult = Invoke-RestMethod -Uri ($baseUrl + '/api/request') -Method Post -Headers $headers -ContentType 'application/json' -Body $bodyCall -TimeoutSec 5
        if ($bodyResult.status -ne 200) { throw ('Body mode request failed: ' + $bodyCase.mode) }
        $bodyCapture = Get-Content -Raw (Join-Path $temporaryRoot ('body-request-' + $bodyIndex + '.txt'))
        if ($bodyCapture -notmatch ('(?im)^Content-Type:\s*' + [regex]::Escape($bodyCase.contentType))) { throw ('Wrong Content-Type for body mode: ' + $bodyCase.mode) }
        if (-not $bodyCapture.Contains($bodyCase.body)) { throw ('Request body was altered for mode: ' + $bodyCase.mode) }
    }

    $invalidGraphql = @{ baseUrl = $bodyMockBaseUrl; route = '/graphql'; method = 'POST'; bodyMode = 'graphql'; body = '{"query":"{ ping }","variables":[]}'; confirmTestData = $true; testDataPhrase = 'TESTE' } | ConvertTo-Json -Compress
    $invalidGraphqlStatus = 0
    try { $null = Invoke-RestMethod -Uri ($baseUrl + '/api/request') -Method Post -Headers $headers -ContentType 'application/json' -Body $invalidGraphql -TimeoutSec 5; throw 'GraphQL array variables were accepted.' } catch { if ($_.Exception.Response) { $invalidGraphqlStatus = [int]$_.Exception.Response.StatusCode } else { throw } }
    if ($invalidGraphqlStatus -ne 400) { throw ('Invalid GraphQL variables expected HTTP 400, got ' + $invalidGraphqlStatus) }

    $fileBytes = [byte[]](86, 79, 82, 84, 73, 88, 0, 255)
    $fileBase64 = [Convert]::ToBase64String($fileBytes)
    $multipartCall = @{
        baseUrl = $bodyMockBaseUrl; route = '/multipart'; method = 'POST'; bodyMode = 'multipart'
        multipartFields = @(
            @{ name = 'tag'; type = 'text'; value = 'one' },
            @{ name = 'tag'; type = 'text'; value = 'two' },
            @{ name = 'empty'; type = 'text'; value = '' },
            @{ name = 'file'; type = 'file'; fileName = 'sample.bin'; contentType = 'application/octet-stream'; fileBase64 = $fileBase64 }
        )
        confirmTestData = $true; testDataPhrase = 'TESTE'; environmentId = 'multipart-test'
    } | ConvertTo-Json -Compress -Depth 8
    $multipartResult = Invoke-RestMethod -Uri ($baseUrl + '/api/request') -Method Post -Headers $headers -ContentType 'application/json' -Body $multipartCall -TimeoutSec 5
    if ($multipartResult.status -ne 200) { throw 'Multipart request did not reach the local capture server.' }
    $multipartHeaders = Get-Content -Raw (Join-Path $temporaryRoot 'body-request-6.headers.txt')
    if ($multipartHeaders -notmatch '(?im)^Content-Type:\s*multipart/form-data;\s*boundary=') { throw 'Multipart Content-Type did not include an automatic boundary.' }
    $multipartBytes = [System.IO.File]::ReadAllBytes((Join-Path $temporaryRoot 'body-request-6.bin'))
    if ((Get-Item -LiteralPath (Join-Path $temporaryRoot 'body-request-6.bin')).Length -eq 0) {
        $transferEncoding = [regex]::Match($multipartHeaders, '(?im)^Transfer-Encoding:\s*([^\r\n]+)').Groups[1].Value
        $contentLength = [regex]::Match($multipartHeaders, '(?im)^Content-Length:\s*(\d+)').Groups[1].Value
        throw ('Multipart body capture was empty; Transfer-Encoding=' + $transferEncoding + '; Content-Length=' + $contentLength)
    }
    $multipartText = [System.Text.Encoding]::GetEncoding(28591).GetString($multipartBytes)
    if ([regex]::Matches($multipartText, 'name="?tag"?').Count -ne 2 -or -not $multipartText.Contains('one') -or -not $multipartText.Contains('two')) { throw 'Repeated multipart text fields were not preserved.' }
    if ($multipartText -notmatch 'name="?empty"?\r\n\r\n\r\n--') { throw 'Empty multipart field was not preserved.' }
    if ($multipartText -notmatch 'filename="?sample.bin"?' -or $multipartText -notmatch 'Content-Type: application/octet-stream') { throw 'Multipart file metadata was not preserved.' }
    $fileHex = [System.BitConverter]::ToString($fileBytes) -replace '-', ''
    $requestHex = [System.BitConverter]::ToString($multipartBytes) -replace '-', ''
    if (-not $requestHex.Contains($fileHex)) { throw 'Multipart binary file bytes were changed.' }
    $manualContentTypeCall = @{ baseUrl = $bodyMockBaseUrl; route = '/multipart'; method = 'POST'; bodyMode = 'multipart'; headers = 'Content-Type: multipart/form-data'; confirmTestData = $true; testDataPhrase = 'TESTE' } | ConvertTo-Json -Compress
    $manualContentTypeStatus = 0
    try { $null = Invoke-RestMethod -Uri ($baseUrl + '/api/request') -Method Post -Headers $headers -ContentType 'application/json' -Body $manualContentTypeCall -TimeoutSec 5; throw 'Manual multipart Content-Type was accepted.' } catch { if ($_.Exception.Response) { $manualContentTypeStatus = [int]$_.Exception.Response.StatusCode } else { throw } }
    if ($manualContentTypeStatus -ne 400) { throw ('Manual multipart Content-Type expected HTTP 400, got ' + $manualContentTypeStatus) }
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
    if ((Get-PlaintextScan @($legacySecret, $bearer, $headerSecret, 'api-key-canary', $bodySecret, $querySecret, $paramSecret, 'local-session-canary', 'local-domain-canary', 'local-secure-canary') $scanPath) -ne 'CLEAR') { throw 'A migrated or new secret remains in SQLite plaintext.' }
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
$authMockServer = $null
$oauthMockServer = $null
    Start-Sleep -Milliseconds 300
    $server = Start-TestApi 'restart'
    $afterRestart = Invoke-RestMethod -Uri ($baseUrl + '/api/storage/settings?key=protection-test') -Headers $headers -TimeoutSec 3
    $afterMigration = Invoke-RestMethod -Uri ($baseUrl + '/api/storage/settings?key=legacy-protection-test') -Headers $headers -TimeoutSec 3
    $pkceAfterRestart = Invoke-RestMethod -Uri ($baseUrl + '/api/storage/environments?key=pkce-protection-test') -Headers $headers -TimeoutSec 3
    if ($afterRestart.value.bearerToken -ne $bearer -or $afterMigration.value.access_token -ne $legacySecret -or $pkceAfterRestart.variables.token -ne $pkceAccessToken -or $pkceAfterRestart.variables.refresh_token -ne $pkceRefreshToken -or $afterRestart.value.collection.requests[0].responseExamples[0].body -ne ('Response example body ' + $responseExampleBody)) { throw 'Protected values did not decrypt after process restart.' }
    $cookieAfterRestartCall = @{ baseUrl = $cookieBaseUrl; route = '/scope/read'; method = 'GET'; environmentId = 'cookie-env-a' } | ConvertTo-Json -Compress
    $cookieAfterRestart = Invoke-RestMethod -Uri ($baseUrl + '/api/request') -Method Post -Headers $headers -ContentType 'application/json' -Body $cookieAfterRestartCall -TimeoutSec 5
    if ($cookieAfterRestart.status -ne 200) { throw 'Cookie request did not reach the local capture server after restart.' }
    $restoredCookieCapture = Get-Content -Raw (Join-Path $temporaryRoot 'cookie-request-4.txt')
    if ($restoredCookieCapture -notmatch '(?im)^Cookie:.*session=local-session-canary' -or $restoredCookieCapture -notmatch '(?im)^Cookie:.*domain-session=local-domain-canary' -or $restoredCookieCapture -match 'expired=' -or $restoredCookieCapture -match 'secure-session=local-secure-canary') { throw 'Cookie was not persisted per environment or an expired cookie was sent after restart.' }
    if ((Get-PlaintextScan $secrets $scanPath) -ne 'CLEAR') { throw 'A persisted cookie remains in SQLite plaintext.' }

    'PASS: new secrets encrypted, legacy migration confirmed and idempotent, values survive process restart.'
    $passed = $true
}
finally {
    if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force }
    if ($authMockServer -and -not $authMockServer.Process.HasExited) { Stop-Process -Id $authMockServer.Process.Id -Force }
    if ($oauthMockServer -and -not $oauthMockServer.Process.HasExited) { Stop-Process -Id $oauthMockServer.Process.Id -Force }
    if ($cookieMockServer -and -not $cookieMockServer.Process.HasExited) { Stop-Process -Id $cookieMockServer.Process.Id -Force }
    if ($bodyMockServer -and -not $bodyMockServer.Process.HasExited) { Stop-Process -Id $bodyMockServer.Process.Id -Force }
    if ($null -eq $oldPort) { Remove-Item Env:\ApiStudio__Port -ErrorAction SilentlyContinue } else { $env:ApiStudio__Port = $oldPort }
    if ($null -eq $oldDatabasePath) { Remove-Item Env:\ApiStudio__DatabasePath -ErrorAction SilentlyContinue } else { $env:ApiStudio__DatabasePath = $oldDatabasePath }
    if ($null -eq $oldTestSecrets) { Remove-Item Env:\API_STUDIO_TEST_SECRETS -ErrorAction SilentlyContinue } else { $env:API_STUDIO_TEST_SECRETS = $oldTestSecrets }
    if ($null -eq $oldTestRecord) { Remove-Item Env:\API_STUDIO_TEST_RECORD -ErrorAction SilentlyContinue } else { $env:API_STUDIO_TEST_RECORD = $oldTestRecord }
    if ($temporaryRoot.StartsWith([System.IO.Path]::GetTempPath(), [System.StringComparison]::OrdinalIgnoreCase)) { Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
if (-not $passed) { exit 1 }
exit 0
