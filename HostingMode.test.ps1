$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path $PSScriptRoot).Path
Add-Type -AssemblyName System.Net.Http
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('vortix-hosting-' + [guid]::NewGuid().ToString('N'))
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
$listener.Stop()
$publicOrigin = 'https://vortix.example.test'
$publicHost = 'vortix.example.test'
$renderOrigin = 'https://vortix-render.example.test'
$renderHost = 'vortix-render.example.test'
$dll = Join-Path $projectRoot 'bin\Release\net10.0\VortixApiClient.dll'
$server = $null
$handler = [System.Net.Http.HttpClientHandler]::new()
$handler.UseCookies = $false
$client = [System.Net.Http.HttpClient]::new($handler)
$oldPort = $env:PORT
$oldHostingMode = $env:ApiStudio__HostingMode
$oldPublicOrigin = $env:ApiStudio__PublicOrigin
$oldRenderExternalUrl = $env:RENDER_EXTERNAL_URL
$oldAccessPassword = $env:ApiStudio__AccessPassword
$oldDatabasePath = $env:ApiStudio__DatabasePath

function Send-HostedRequest([string]$method, [string]$path, [string]$origin = $publicOrigin, [string]$body = '', [string]$cookie = '', [string]$forwardedFor = '', [string]$hostValue = '') {
    $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::new($method), "http://127.0.0.1:$port$path")
    if ($hostValue) { $request.Headers.Host = $hostValue } else { $request.Headers.Host = $publicHost }
    if ($origin) { $null = $request.Headers.TryAddWithoutValidation('Origin', $origin) }
    $null = $request.Headers.TryAddWithoutValidation('X-Api-Studio', '1')
    if ($cookie) { $null = $request.Headers.TryAddWithoutValidation('Cookie', $cookie) }
    if ($forwardedFor) { $null = $request.Headers.TryAddWithoutValidation('X-Forwarded-For', $forwardedFor) }
    if ($body) { $request.Content = [System.Net.Http.StringContent]::new($body, [System.Text.Encoding]::UTF8, 'application/json') }
    $response = $client.SendAsync($request).GetAwaiter().GetResult()
    $content = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    return [pscustomobject]@{ Response = $response; Content = $content }
}

try {
    New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
    dotnet build (Join-Path $projectRoot 'VortixApiClient.csproj') -c Release --nologo
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $dll)) { throw 'Could not build the Vortix API client for hosted-mode tests.' }

    $env:PORT = [string]$port
    $env:ApiStudio__HostingMode = 'render'
    $env:ApiStudio__PublicOrigin = $publicOrigin
    $env:RENDER_EXTERNAL_URL = $renderOrigin
    Remove-Item Env:ApiStudio__AccessPassword -ErrorAction SilentlyContinue
    $env:ApiStudio__DatabasePath = Join-Path $temporaryRoot 'hosted.sqlite'
    $server = Start-Process -FilePath 'dotnet' -ArgumentList @($dll) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $temporaryRoot 'server.out') -RedirectStandardError (Join-Path $temporaryRoot 'server.err')

    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if ($server.HasExited) { throw 'Public hosted mode exited before becoming ready without an access password.' }
        try {
            $healthRequest = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, "http://127.0.0.1:$port/health")
            $health = $client.SendAsync($healthRequest).GetAwaiter().GetResult()
            if ($health.IsSuccessStatusCode) { $ready = $true; break }
        } catch { Start-Sleep -Milliseconds 200 }
        Start-Sleep -Milliseconds 200
    }
    if (-not $ready) { throw 'Public hosted mode did not become ready on PORT.' }

    $runtime = Send-HostedRequest 'GET' '/api/runtime' ''
    if ($runtime.Response.StatusCode -ne [System.Net.HttpStatusCode]::OK -or $runtime.Content -notmatch '"hostingMode":"render"') { throw 'Runtime endpoint did not expose hosted mode.' }

    $publicPage = Send-HostedRequest 'GET' '/'
    if ($publicPage.Response.StatusCode -ne [System.Net.HttpStatusCode]::OK -or $publicPage.Content -match 'id="hosted-login-dialog"') { throw 'Public app shell must open without a shared workspace password.' }

    $firstSession = Send-HostedRequest 'GET' '/api/session' ''
    if ([int]$firstSession.Response.StatusCode -ne 204) { throw 'Public hosted mode did not initialize an anonymous browser session.' }
    $firstSessionCookie = $firstSession.Response.Headers.GetValues('Set-Cookie') | Select-Object -First 1
    if ($firstSessionCookie -notmatch '__Host-Vortix.Session=' -or $firstSessionCookie -notmatch 'HttpOnly' -or $firstSessionCookie -notmatch 'Secure' -or $firstSessionCookie -notmatch 'SameSite=Lax') { throw 'Anonymous browser session cookie must be isolated, HttpOnly, Secure, and Lax.' }
    $firstSessionId = $firstSessionCookie.Split(';')[0]

    $renderSession = Send-HostedRequest 'GET' '/api/session' $renderOrigin '' '' '' $renderHost
    if ([int]$renderSession.Response.StatusCode -ne 204) { throw 'Render onrender.com origin must work before custom-domain DNS is configured.' }
    $renderRedirect = Send-HostedRequest 'POST' '/api/oauth/pkce/redirect-uri' $renderOrigin '{"authorizationUrl":"https://identity.example.test/authorize"}' '' '' $renderHost
    if ([int]$renderRedirect.Response.StatusCode -ne 200 -or $renderRedirect.Content -notmatch 'https://vortix-render.example.test/oauth/callback/') { throw 'OAuth redirect preview must use the active Render origin.' }

    $secondSession = Send-HostedRequest 'GET' '/api/session' ''
    $secondSessionCookie = $secondSession.Response.Headers.GetValues('Set-Cookie') | Select-Object -First 1
    if ($secondSessionCookie.Split(';')[0] -eq $firstSessionId) { throw 'Anonymous visitors received the same cookie-jar session identifier.' }

    $cookieJarWrite = Send-HostedRequest 'PUT' '/api/cookie-jar/development' $publicOrigin '{"cookies":[{"cookieName":"session","cookieHeader":"sid=private-a","cookieOrigin":"https://api.example.test"}]}' $firstSessionId
    $firstCookieJar = Send-HostedRequest 'GET' '/api/cookie-jar/development' '' '' $firstSessionId
    $secondCookieJar = Send-HostedRequest 'GET' '/api/cookie-jar/development' '' '' ($secondSessionCookie.Split(';')[0])
    if ([int]$cookieJarWrite.Response.StatusCode -ne 204 -or $firstCookieJar.Content -notmatch 'sid=private-a' -or $secondCookieJar.Content -match 'sid=private-a') { throw 'Cookie jars must be private to the anonymous browser session that wrote them.' }

    $oauthStart = Send-HostedRequest 'POST' '/api/oauth/pkce/start' $publicOrigin '{"authorizationUrl":"https://identity.example.test/authorize","tokenUrl":"https://identity.example.test/token","clientId":"public-client","scope":"profile"}' $firstSessionId
    if ([int]$oauthStart.Response.StatusCode -ne 200) { throw 'Anonymous visitor could not start an isolated OAuth PKCE flow.' }
    $oauthState = ($oauthStart.Content | ConvertFrom-Json).state
    $ownedFlow = Send-HostedRequest 'GET' "/api/oauth/pkce/status/$oauthState" '' '' $firstSessionId
    $foreignFlow = Send-HostedRequest 'GET' "/api/oauth/pkce/status/$oauthState" '' '' ($secondSessionCookie.Split(';')[0])
    if ([int]$ownedFlow.Response.StatusCode -ne 200 -or [int]$foreignFlow.Response.StatusCode -ne 404) { throw 'OAuth tokens and flow state must stay isolated to the browser session that started the flow.' }

    $workspace = Send-HostedRequest 'GET' '/api/storage/workspace'
    if ([int]$workspace.Response.StatusCode -ne 404) { throw 'Public hosted mode must not expose the shared SQLite workspace.' }

    $badOrigin = Send-HostedRequest 'POST' '/api/request' 'https://attacker.example' '{"baseUrl":"invalid","route":"/","method":"GET"}'
    if ([int]$badOrigin.Response.StatusCode -ne 403) { throw "Public proxy must reject an untrusted Origin; received HTTP $([int]$badOrigin.Response.StatusCode)." }

    $loopbackTarget = "http://127.0.0.1:$port"
    $blockedTarget = Send-HostedRequest 'POST' '/api/request' $publicOrigin (ConvertTo-Json -InputObject @{baseUrl=$loopbackTarget;route='/health';method='GET'} -Compress) $firstSessionId
    if ([int]$blockedTarget.Response.StatusCode -ne 502 -or $blockedTarget.Content -notmatch 'Falha de rede') { throw 'Public proxy must block loopback destinations before connecting.' }

    $rateLimited = $false
    for ($attempt = 0; $attempt -lt 70; $attempt++) {
        $invalidCall = Send-HostedRequest 'POST' '/api/request' $publicOrigin '{"baseUrl":"invalid","route":"/","method":"GET"}' $firstSessionId
        if ([int]$invalidCall.Response.StatusCode -eq 429) { $rateLimited = $true; break }
        if ([int]$invalidCall.Response.StatusCode -ne 400) { throw "Invalid anonymous proxy call returned unexpected HTTP $([int]$invalidCall.Response.StatusCode)." }
    }
    if (-not $rateLimited) { throw 'Public proxy must rate-limit repeated requests per client IP.' }

    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        $newIpCall = Send-HostedRequest 'POST' '/api/request' $publicOrigin '{"baseUrl":"invalid","route":"/","method":"GET"}' $firstSessionId '198.51.100.10'
        if ([int]$newIpCall.Response.StatusCode -ne 400) { throw 'Forwarded client IP did not receive an independent proxy rate limit.' }
    }
    $forwardedIpRateLimit = Send-HostedRequest 'POST' '/api/request' $publicOrigin '{"baseUrl":"invalid","route":"/","method":"GET"}' $firstSessionId '198.51.100.10'
    $otherForwardedIp = Send-HostedRequest 'POST' '/api/request' $publicOrigin '{"baseUrl":"invalid","route":"/","method":"GET"}' $firstSessionId '198.51.100.11'
    if ([int]$forwardedIpRateLimit.Response.StatusCode -ne 429 -or [int]$otherForwardedIp.Response.StatusCode -ne 400) { throw 'Proxy rate limit did not partition by forwarded client IP.' }

    'Hosted-mode test passed: password-free access, Render and custom origins, browser-isolated sessions and OAuth, no shared workspace API, same-origin enforcement, SSRF block, and forwarded-IP rate limits.'
}
finally {
    if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
    $client.Dispose()
    $env:PORT = $oldPort
    $env:ApiStudio__HostingMode = $oldHostingMode
    $env:ApiStudio__PublicOrigin = $oldPublicOrigin
    if ($null -eq $oldRenderExternalUrl) { Remove-Item Env:RENDER_EXTERNAL_URL -ErrorAction SilentlyContinue } else { $env:RENDER_EXTERNAL_URL = $oldRenderExternalUrl }
    if ($null -eq $oldAccessPassword) { Remove-Item Env:ApiStudio__AccessPassword -ErrorAction SilentlyContinue } else { $env:ApiStudio__AccessPassword = $oldAccessPassword }
    $env:ApiStudio__DatabasePath = $oldDatabasePath
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
}
