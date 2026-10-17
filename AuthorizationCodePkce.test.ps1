$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path $PSScriptRoot).Path
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('vortix-pkce-' + [guid]::NewGuid().ToString('N'))
$databasePath = Join-Path $temporaryRoot 'pkce.sqlite'
$portProbe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$portProbe.Start()
$port = ([System.Net.IPEndPoint]$portProbe.LocalEndpoint).Port
$portProbe.Stop()
$baseUrl = 'http://127.0.0.1:' + $port
$oldPort = $env:ApiStudio__Port
$oldDatabasePath = $env:ApiStudio__DatabasePath
$oldFlowTimeout = $env:ApiStudio__OAuthPkceFlowTimeoutSeconds
$oldPortForTimeout = $env:ApiStudio__Port
$oldDbForTimeout = $env:ApiStudio__DatabasePath
$server = $null
$oauthMockServer = $null
$timeoutServer = $null
function Invoke-NoRedirect([string]$uri, [string]$method = 'GET', [string]$origin = '') {
    $request = [System.Net.HttpWebRequest]::Create($uri)
    $request.Method = $method
    if ($origin) {
        $request.Headers.Add('X-Api-Studio', '1')
        $request.Headers.Add('Origin', $origin)
    }
    $request.AllowAutoRedirect = $false
    $request.Timeout = 10000
    $response = $null
    try { $response = $request.GetResponse() }
    catch [System.Net.WebException] { $response = $_.Exception.Response; if ($null -eq $response) { throw } }
    try {
        $body = ''
        $stream = $response.GetResponseStream()
        if ($stream) { $reader = [System.IO.StreamReader]::new($stream); try { $body = $reader.ReadToEnd() } finally { $reader.Dispose() } }
        return [pscustomobject]@{ Status = [int]$response.StatusCode; Location = [string]$response.Headers['Location']; Body = $body }
    } finally { if ($response) { $response.Close() } }
}
$passed = $false
New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
try {
    $env:ApiStudio__Port = [string]$port
    $env:ApiStudio__DatabasePath = $databasePath
    $dll = Join-Path $projectRoot 'bin\Release\net8.0\VortixApiClient.dll'
    $server = Start-Process -FilePath 'dotnet' -ArgumentList @($dll) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $temporaryRoot 'api.out') -RedirectStandardError (Join-Path $temporaryRoot 'api.err')
    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if ($server.HasExited) { throw 'Temporary API process exited before becoming ready.' }
        try { $health = Invoke-RestMethod -Uri ($baseUrl + '/health') -TimeoutSec 1; if ($health.status -eq 'ok') { $ready = $true; break } } catch { Start-Sleep -Milliseconds 200 }
    }
    if (-not $ready) { throw 'Temporary API did not become ready.' }

    $mockReadyPath = Join-Path $temporaryRoot 'oauth-mock.port'
    $oauthMockServer = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $projectRoot 'OAuthAuthorizationServer.test.ps1'), '-ReadyPath', $mockReadyPath, '-OutputRoot', $temporaryRoot, '-AccessToken', 'vortix-ui-access-canary-2026', '-RefreshToken', 'vortix-ui-refresh-canary-2026') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $temporaryRoot 'oauth-mock.out') -RedirectStandardError (Join-Path $temporaryRoot 'oauth-mock.err')
    for ($attempt = 0; $attempt -lt 50; $attempt++) {
        if ($oauthMockServer.HasExited) { throw 'OAuth mock exited before becoming ready.' }
        if (Test-Path $mockReadyPath) { break }
        Start-Sleep -Milliseconds 100
    }
    if (-not (Test-Path $mockReadyPath)) { throw 'OAuth mock did not become ready.' }
    $mockPort = [int](Get-Content -Raw $mockReadyPath)
    $tokenUrl = 'http://127.0.0.1:' + $mockPort + '/token'
    $authorizationUrl = 'http://127.0.0.1:' + $mockPort + '/authorize?tenant=pkce-test'
    $headers = @{ 'X-Api-Studio' = '1'; Origin = $baseUrl }
    $previewRequest = @{ authorizationUrl = $authorizationUrl } | ConvertTo-Json -Compress
    $redirectPreview = Invoke-RestMethod -Uri ($baseUrl + '/api/oauth/pkce/redirect-uri') -Method Post -Headers $headers -ContentType 'application/json' -Body $previewRequest -TimeoutSec 5
    $badRemoteHttp = @{
        authorizationUrl = 'http://identity.example.test/authorize'
        tokenUrl = 'https://identity.example.test/token'
        clientId = 'pkce-client-test'
        scope = ''
    } | ConvertTo-Json -Compress
    $badRemoteStatus = 0
    try {
        $null = Invoke-RestMethod -Uri ($baseUrl + '/api/oauth/pkce/start') -Method Post -Headers $headers -ContentType 'application/json' -Body $badRemoteHttp -TimeoutSec 5
        $badRemoteStatus = 200
    } catch {
        if ($_.Exception.Response) { $badRemoteStatus = [int]$_.Exception.Response.StatusCode } else { throw }
    }
    if ($badRemoteStatus -ne 400) { throw 'Remote HTTP authorization endpoint was accepted.' }
    $badCredentialQuery = @{
        authorizationUrl = 'https://identity.example.test/authorize?client_secret=do-not-send'
        tokenUrl = 'https://identity.example.test/token'
        clientId = 'pkce-client-test'
        scope = ''
    } | ConvertTo-Json -Compress
    $badCredentialStatus = 0
    try {
        $null = Invoke-RestMethod -Uri ($baseUrl + '/api/oauth/pkce/start') -Method Post -Headers $headers -ContentType 'application/json' -Body $badCredentialQuery -TimeoutSec 5
        $badCredentialStatus = 200
    } catch {
        if ($_.Exception.Response) { $badCredentialStatus = [int]$_.Exception.Response.StatusCode } else { throw }
    }
    if ($badCredentialStatus -ne 400) { throw 'Credential query was accepted in the authorization URL.' }
    $badApiKeyQuery = @{
        authorizationUrl = 'https://identity.example.test/authorize?api_key=synthetic-canary'
        tokenUrl = 'https://identity.example.test/token'
        clientId = 'pkce-client-test'
        scope = ''
    } | ConvertTo-Json -Compress
    $badApiKeyStatus = 0
    try {
        $null = Invoke-RestMethod -Uri ($baseUrl + '/api/oauth/pkce/start') -Method Post -Headers $headers -ContentType 'application/json' -Body $badApiKeyQuery -TimeoutSec 5
        $badApiKeyStatus = 200
    } catch {
        if ($_.Exception.Response) { $badApiKeyStatus = [int]$_.Exception.Response.StatusCode } else { throw }
    }
    if ($badApiKeyStatus -ne 400) { throw 'Credential-like API key query was accepted in the authorization URL.' }
    $start = @{
        authorizationUrl = $authorizationUrl
        tokenUrl = $tokenUrl
        clientId = 'pkce-client-test'
        scope = 'read items'
    } | ConvertTo-Json -Compress
    $response = $null
    $status = 0
    try {
        $response = Invoke-RestMethod -Uri ($baseUrl + '/api/oauth/pkce/start') -Method Post -Headers $headers -ContentType 'application/json' -Body $start -TimeoutSec 5
        $status = 200
    } catch {
        if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode } else { throw }
    }
    if ($status -ne 200) { throw ('PKCE start endpoint expected HTTP 200, got ' + $status) }

    $authorizeUri = [uri]$response.authorizationUrl
    $parameters = [System.Web.HttpUtility]::ParseQueryString($authorizeUri.Query)
    if ($parameters['response_type'] -ne 'code' -or $parameters['client_id'] -ne 'pkce-client-test' -or $parameters['scope'] -ne 'read items') { throw 'Authorization URL is missing standard OAuth parameters.' }
    if ($parameters['code_challenge_method'] -ne 'S256' -or $parameters['code_challenge'].Length -ne 43) { throw 'Authorization URL does not use a 32-byte S256 PKCE challenge.' }
    if ([string]::IsNullOrWhiteSpace($parameters['state']) -or $parameters['state'].Length -lt 43) { throw 'Authorization state is missing or has insufficient entropy.' }
    $otherStart = @{
        authorizationUrl = 'http://127.0.0.1:43210/authorize?tenant=other-provider'
        tokenUrl = $tokenUrl
        clientId = 'pkce-client-test'
        scope = 'read items'
    } | ConvertTo-Json -Compress
    $otherResponse = Invoke-RestMethod -Uri ($baseUrl + '/api/oauth/pkce/start') -Method Post -Headers $headers -ContentType 'application/json' -Body $otherStart -TimeoutSec 5
    if ($response.redirectUri -notmatch '^http://127\.0\.0\.1:\d+/oauth/callback/[A-Za-z0-9_-]{22}$') { throw 'Callback URI must use a provider-specific loopback path.' }
    if ($response.redirectUri -eq $otherResponse.redirectUri) { throw 'Different authorization servers must use distinct callback URIs.' }
    if ($response.redirectUri -ne $redirectPreview.redirectUri) { throw 'Redirect preview does not match the flow callback URI.' }
    $wrongProvider = Invoke-NoRedirect ($otherResponse.redirectUri + '?code=wrong-provider-code&state=' + $parameters['state'])
    if ($wrongProvider.Status -ne 302 -or $wrongProvider.Location -ne '/oauth/pkce/invalid') { throw 'Callback from another authorization server was not rejected with a clean redirect.' }
    if ($response.authorizationUrl -match 'code_verifier|client_secret') { throw 'Authorization URL leaked a PKCE verifier or client secret.' }
    if ($authorizeUri.Query -notmatch 'tenant=pkce-test') { throw 'Authorization endpoint query parameters were not preserved.' }

    $wrongState = Invoke-NoRedirect ($response.redirectUri + '?code=wrong-code&state=wrong-state')
    if ($wrongState.Status -ne 302 -or $wrongState.Location -ne '/oauth/pkce/invalid') { throw 'Invalid state callback did not redirect to a clean local page.' }
    $pending = Invoke-RestMethod -Uri ($baseUrl + '/api/oauth/pkce/status/' + $parameters['state']) -Headers $headers -TimeoutSec 5
    if ($pending.status -ne 'pending') { throw 'Invalid callback state changed the pending flow.' }

    $authorizationStep = Invoke-NoRedirect $response.authorizationUrl
    if ($authorizationStep.Status -ne 302 -or $authorizationStep.Location -notmatch '^http://127\.0\.0\.1:\d+/oauth/callback/') { throw 'Authorization mock did not return to the registered loopback URI.' }
    $callback = Invoke-NoRedirect $authorizationStep.Location
    if ($callback.Status -ne 302 -or $callback.Location -ne '/oauth/pkce/complete' -or $callback.Location -match '\?') { throw 'Callback did not remove the code and state from the final URL.' }
    if ($callback.Body -match 'oauth-ui-code-canary|vortix-ui-access-canary-2026') { throw 'Callback page exposed authorization code or token.' }
    $completed = $null
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        $completed = Invoke-RestMethod -Uri ($baseUrl + '/api/oauth/pkce/status/' + $parameters['state']) -Headers $headers -TimeoutSec 5
        if ($completed.status -ne 'pending') { break }
        Start-Sleep -Milliseconds 100
    }
    if ($completed.status -ne 'complete' -or $completed.accessToken -ne 'vortix-ui-access-canary-2026' -or $completed.refreshToken -ne 'vortix-ui-refresh-canary-2026') { throw 'Authorization code was not exchanged for the mock access token.' }
    $capture = Get-Content -Raw (Join-Path $temporaryRoot 'oauth-token-request.txt')
    $bodyMarker = $capture.IndexOf('BODY', [System.StringComparison]::Ordinal)
    if ($bodyMarker -lt 0) { throw 'OAuth mock did not capture a form body.' }
    $form = [System.Web.HttpUtility]::ParseQueryString($capture.Substring($bodyMarker + 4).Trim())
    if ($form['grant_type'] -ne 'authorization_code' -or $form['code'] -ne 'oauth-ui-code-canary' -or $form['client_id'] -ne 'pkce-client-test' -or $form['redirect_uri'] -ne $response.redirectUri) { throw 'Token exchange omitted required OAuth parameters.' }
    $verifier = $form['code_verifier']
    if ($verifier.Length -lt 43 -or $verifier.Length -gt 128) { throw 'Token exchange omitted a valid PKCE verifier.' }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $challenge = [Convert]::ToBase64String($sha.ComputeHash([System.Text.Encoding]::ASCII.GetBytes($verifier))).TrimEnd('=').Replace('+', '-').Replace('/', '_') } finally { $sha.Dispose() }
    if ($challenge -ne $parameters['code_challenge']) { throw 'Token endpoint verifier did not match the S256 challenge.' }

    $cancelStart = @{
        authorizationUrl = 'http://127.0.0.1:43210/authorize?tenant=cancel-test'
        tokenUrl = $tokenUrl
        clientId = 'pkce-client-test'
        scope = ''
    } | ConvertTo-Json -Compress
    $cancelFlow = Invoke-RestMethod -Uri ($baseUrl + '/api/oauth/pkce/start') -Method Post -Headers $headers -ContentType 'application/json' -Body $cancelStart -TimeoutSec 5
    $cancelCallback = Invoke-NoRedirect ($cancelFlow.redirectUri + '?error=access_denied&state=' + $cancelFlow.state)
    if ($cancelCallback.Status -ne 302 -or $cancelCallback.Location -ne '/oauth/pkce/complete') { throw 'Denied OAuth callback did not redirect to a clean local page.' }
    $cancelStatus = Invoke-RestMethod -Uri ($baseUrl + '/api/oauth/pkce/status/' + $cancelFlow.state) -Headers $headers -TimeoutSec 5
    if ($cancelStatus.status -ne 'cancelled') { throw 'Authorization denial was not reported as cancellation.' }
    $clientCancelStart = @{
        authorizationUrl = 'http://127.0.0.1:' + $mockPort + '/authorize?tenant=client-cancel'
        tokenUrl = $tokenUrl
        clientId = 'pkce-client-test'
        scope = ''
    } | ConvertTo-Json -Compress
    $clientCancelFlow = Invoke-RestMethod -Uri ($baseUrl + '/api/oauth/pkce/start') -Method Post -Headers $headers -ContentType 'application/json' -Body $clientCancelStart -TimeoutSec 5
    $deleteResponse = Invoke-NoRedirect ($baseUrl + '/api/oauth/pkce/status/' + $clientCancelFlow.state) 'DELETE' $baseUrl
    if ($deleteResponse.Status -ne 204) { throw 'Explicit PKCE cancellation did not clear the pending flow.' }
    $cancelledStateStatus = 0
    try {
        $null = Invoke-RestMethod -Uri ($baseUrl + '/api/oauth/pkce/status/' + $clientCancelFlow.state) -Headers $headers -TimeoutSec 5
        $cancelledStateStatus = 200
    } catch {
        if ($_.Exception.Response) { $cancelledStateStatus = [int]$_.Exception.Response.StatusCode } else { throw }
    }
    if ($cancelledStateStatus -ne 404) { throw 'Explicit PKCE cancellation left the flow retrievable.' }
    $cancelledCallback = Invoke-NoRedirect ($clientCancelFlow.redirectUri + '?code=late-code&state=' + $clientCancelFlow.state)
    if ($cancelledCallback.Status -ne 302 -or $cancelledCallback.Location -ne '/oauth/pkce/invalid') { throw 'Callback after explicit cancellation was accepted.' }

    $timeoutProbe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $timeoutProbe.Start()
    $timeoutPort = ([System.Net.IPEndPoint]$timeoutProbe.LocalEndpoint).Port
    $timeoutProbe.Stop()
    $timeoutBaseUrl = 'http://127.0.0.1:' + $timeoutPort
    $env:ApiStudio__Port = [string]$timeoutPort
    $env:ApiStudio__DatabasePath = Join-Path $temporaryRoot 'timeout.sqlite'
    $env:ApiStudio__OAuthPkceFlowTimeoutSeconds = '1'
    $timeoutServer = Start-Process -FilePath 'dotnet' -ArgumentList @($dll) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $temporaryRoot 'timeout.out') -RedirectStandardError (Join-Path $temporaryRoot 'timeout.err')
    $timeoutReady = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if ($timeoutServer.HasExited) { throw 'Timeout API process exited before becoming ready.' }
        try { $health = Invoke-RestMethod -Uri ($timeoutBaseUrl + '/health') -TimeoutSec 1; if ($health.status -eq 'ok') { $timeoutReady = $true; break } } catch { Start-Sleep -Milliseconds 200 }
    }
    if (-not $timeoutReady) { throw 'Timeout API did not become ready.' }
    $timeoutHeaders = @{ 'X-Api-Studio' = '1'; Origin = $timeoutBaseUrl }
    $timeoutStart = @{
        authorizationUrl = 'http://127.0.0.1:43210/authorize?tenant=timeout'
        tokenUrl = 'http://127.0.0.1:43210/token'
        clientId = 'pkce-timeout-test'
        scope = ''
    } | ConvertTo-Json -Compress
    $timeoutFlow = Invoke-RestMethod -Uri ($timeoutBaseUrl + '/api/oauth/pkce/start') -Method Post -Headers $timeoutHeaders -ContentType 'application/json' -Body $timeoutStart -TimeoutSec 5
    Start-Sleep -Milliseconds 1300
    $expired = Invoke-RestMethod -Uri ($timeoutBaseUrl + '/api/oauth/pkce/status/' + $timeoutFlow.state) -Headers $timeoutHeaders -TimeoutSec 5
    if ($expired.status -ne 'expired') { throw 'Pending PKCE flow did not expire.' }

    'PASS: PKCE validates state and provider binding, handles denial, explicit cancellation and timeout, and exchanges code with the matching verifier.'
    $passed = $true
}
finally {
    if ($server) {
        Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
        Wait-Process -Id $server.Id -Timeout 3 -ErrorAction SilentlyContinue
    }
    if ($timeoutServer) {
        Stop-Process -Id $timeoutServer.Id -Force -ErrorAction SilentlyContinue
        Wait-Process -Id $timeoutServer.Id -Timeout 3 -ErrorAction SilentlyContinue
    }
    if ($oauthMockServer) {
        Stop-Process -Id $oauthMockServer.Id -Force -ErrorAction SilentlyContinue
        Wait-Process -Id $oauthMockServer.Id -Timeout 3 -ErrorAction SilentlyContinue
    }
    if ($null -eq $oldPort) { Remove-Item Env:\ApiStudio__Port -ErrorAction SilentlyContinue } else { $env:ApiStudio__Port = $oldPort }
    if ($null -eq $oldDatabasePath) { Remove-Item Env:\ApiStudio__DatabasePath -ErrorAction SilentlyContinue } else { $env:ApiStudio__DatabasePath = $oldDatabasePath }
    if ($null -eq $oldFlowTimeout) { Remove-Item Env:\ApiStudio__OAuthPkceFlowTimeoutSeconds -ErrorAction SilentlyContinue } else { $env:ApiStudio__OAuthPkceFlowTimeoutSeconds = $oldFlowTimeout }
    if ($null -eq $oldPortForTimeout) { Remove-Item Env:\ApiStudio__Port -ErrorAction SilentlyContinue } else { $env:ApiStudio__Port = $oldPortForTimeout }
    if ($null -eq $oldDbForTimeout) { Remove-Item Env:\ApiStudio__DatabasePath -ErrorAction SilentlyContinue } else { $env:ApiStudio__DatabasePath = $oldDbForTimeout }
    if ($temporaryRoot.StartsWith([System.IO.Path]::GetTempPath(), [System.StringComparison]::OrdinalIgnoreCase)) { Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
if (-not $passed) { exit 1 }
exit 0