$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path $PSScriptRoot).Path
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('vortix-hosting-' + [guid]::NewGuid().ToString('N'))
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
$listener.Stop()
$publicOrigin = 'https://vortix.example.test'
$publicHost = 'vortix.example.test'
$testPassword = 'correct horse battery staple'
$databasePath = Join-Path $temporaryRoot 'hosted.sqlite'
$dll = Join-Path $projectRoot 'bin\Release\net10.0\VortixApiClient.dll'
$server = $null
$client = [System.Net.Http.HttpClient]::new()
$oldPort = $env:PORT
$oldHostingMode = $env:ApiStudio__HostingMode
$oldPublicOrigin = $env:ApiStudio__PublicOrigin
$oldAccessPassword = $env:ApiStudio__AccessPassword
$oldDatabasePath = $env:ApiStudio__DatabasePath

function Send-HostedRequest([string]$method, [string]$path, [string]$origin = $publicOrigin, [string]$body = '', [string]$cookie = '') {
    $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::new($method), "http://127.0.0.1:$port$path")
    $request.Headers.Host = $publicHost
    if ($origin) { $null = $request.Headers.TryAddWithoutValidation('Origin', $origin) }
    $null = $request.Headers.TryAddWithoutValidation('X-Api-Studio', '1')
    if ($cookie) { $null = $request.Headers.TryAddWithoutValidation('Cookie', $cookie) }
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
    $env:ApiStudio__AccessPassword = $testPassword
    $env:ApiStudio__DatabasePath = $databasePath
    $server = Start-Process -FilePath 'dotnet' -ArgumentList @($dll) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $temporaryRoot 'server.out') -RedirectStandardError (Join-Path $temporaryRoot 'server.err')

    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if ($server.HasExited) { throw 'Hosted-mode API exited before becoming ready.' }
        try {
            $healthRequest = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, "http://127.0.0.1:$port/health")
            $health = $client.SendAsync($healthRequest).GetAwaiter().GetResult()
            if ($health.IsSuccessStatusCode) { $ready = $true; break }
        } catch { Start-Sleep -Milliseconds 200 }
        Start-Sleep -Milliseconds 200
    }
    if (-not $ready) { throw 'Hosted-mode API did not become ready on PORT.' }

    $runtime = Send-HostedRequest 'GET' '/api/runtime' ''
    if ($runtime.Response.StatusCode -ne [System.Net.HttpStatusCode]::OK -or $runtime.Content -notmatch '"hostingMode":"render"') { throw 'Runtime endpoint did not expose hosted mode.' }

    $publicPage = Send-HostedRequest 'GET' '/'
    if ($publicPage.Response.StatusCode -ne [System.Net.HttpStatusCode]::OK -or $publicPage.Content -notmatch 'id="hosted-login-dialog"') { throw 'Hosted login dialog is missing from the app shell.' }

    $locked = Send-HostedRequest 'GET' '/api/storage/workspace'
    if ([int]$locked.Response.StatusCode -ne 401) { throw 'Hosted workspace endpoints must reject anonymous access.' }

    $loginBody = ConvertTo-Json -InputObject @{ password = $testPassword } -Compress
    $wrongLoginBody = ConvertTo-Json -InputObject @{ password = 'incorrect horse battery staple' } -Compress
    $badOrigin = Send-HostedRequest 'POST' '/api/auth/login' 'https://attacker.example' $loginBody
    if ([int]$badOrigin.Response.StatusCode -ne 403) { throw "Hosted login must reject an untrusted Origin; received HTTP $([int]$badOrigin.Response.StatusCode)." }

    $badLogin = Send-HostedRequest 'POST' '/api/auth/login' $publicOrigin $wrongLoginBody
    if ([int]$badLogin.Response.StatusCode -ne 401) { throw 'Hosted login must reject an incorrect password.' }

    $login = Send-HostedRequest 'POST' '/api/auth/login' $publicOrigin $loginBody
    if ([int]$login.Response.StatusCode -ne 204) { throw 'Hosted login did not accept the configured password.' }
    $setCookie = $login.Response.Headers.GetValues('Set-Cookie') | Select-Object -First 1
    if ($setCookie -notmatch 'HttpOnly' -or $setCookie -notmatch 'Secure' -or $setCookie -notmatch 'SameSite=Lax') { throw 'Hosted auth cookie must be HttpOnly, Secure, and Lax.' }
    $cookie = $setCookie.Split(';')[0]

    $workspace = Send-HostedRequest 'GET' '/api/storage/workspace' $publicOrigin '' $cookie
    if ($workspace.Response.StatusCode -ne [System.Net.HttpStatusCode]::OK -or $workspace.Content -notmatch '"collections":\[\]' -or $workspace.Content -notmatch '"environments":\[\]') { throw 'Authenticated hosted workspace endpoint returned an unexpected payload.' }

    $redirect = Send-HostedRequest 'POST' '/api/oauth/pkce/redirect-uri' $publicOrigin '{"authorizationUrl":"https://identity.example.test/authorize"}' $cookie
    if ($redirect.Response.StatusCode -ne [System.Net.HttpStatusCode]::OK -or $redirect.Content -notmatch 'https://vortix.example.test/oauth/callback/') { throw 'Hosted OAuth redirect URI must use the configured public HTTPS origin.' }

    for ($attempt = 0; $attempt -lt 2; $attempt++) {
        $limitedLogin = Send-HostedRequest 'POST' '/api/auth/login' $publicOrigin $wrongLoginBody
        if ([int]$limitedLogin.Response.StatusCode -ne 401) { throw 'Hosted login rate limit rejected attempts too early.' }
    }
    $rateLimited = Send-HostedRequest 'POST' '/api/auth/login' $publicOrigin $wrongLoginBody
    if ([int]$rateLimited.Response.StatusCode -ne 429) { throw 'Hosted login must rate-limit repeated attempts.' }

    $collectionWrite = Send-HostedRequest 'POST' '/api/storage/collections' $publicOrigin '{"id":"size-test-collection","name":"Size test","requests":[],"folders":[]}' $cookie
    if ([int]$collectionWrite.Response.StatusCode -ne 204) { throw 'Hosted size-limit test could not create its collection.' }
    $environmentWrite = Send-HostedRequest 'POST' '/api/storage/environments' $publicOrigin '{"id":"size-test-environment","name":"Size test","variables":{}}' $cookie
    if ([int]$environmentWrite.Response.StatusCode -ne 204) { throw 'Hosted size-limit test could not create its environment.' }

    $largeHistoryBody = 'x' * 900000
    $acceptedHistory = 0
    $rejectedHistoryId = $null
    for ($index = 0; $index -lt 20; $index++) {
        $historyId = "size-test-history-$index"
        $historyBody = ConvertTo-Json -InputObject @{ id = $historyId; savedAt = [DateTime]::UtcNow.ToString('o'); body = $largeHistoryBody } -Compress
        $historyWrite = Send-HostedRequest 'POST' '/api/storage/history' $publicOrigin $historyBody $cookie
        if ([int]$historyWrite.Response.StatusCode -eq 413) {
            if ($historyWrite.Content -notmatch 'limites do backup de recuperação') { throw 'Hosted workspace size rejection did not explain the recovery limit.' }
            $rejectedHistoryId = $historyId
            break
        }
        if ([int]$historyWrite.Response.StatusCode -ne 204) { throw "Hosted history write returned unexpected HTTP $([int]$historyWrite.Response.StatusCode)." }
        $acceptedHistory++
    }
    if (-not $rejectedHistoryId) { throw 'Hosted SQLite accepted workspace data beyond the recoverable browser snapshot limit.' }
    $workspaceAfterLimit = (Send-HostedRequest 'GET' '/api/storage/workspace' $publicOrigin '' $cookie).Content | ConvertFrom-Json
    if (@($workspaceAfterLimit.history).Count -ne $acceptedHistory -or @($workspaceAfterLimit.history | Where-Object id -eq $rejectedHistoryId).Count -ne 0) {
        throw 'Workspace size rejection persisted part of the rejected history write.'
    }

    'Hosted-mode test passed: PORT binding, password gate, secure cookie, rate limit, protected workspace, snapshot size limit, and public OAuth redirect.'
}
finally {
    if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
    $client.Dispose()
    $env:PORT = $oldPort
    $env:ApiStudio__HostingMode = $oldHostingMode
    $env:ApiStudio__PublicOrigin = $oldPublicOrigin
    $env:ApiStudio__AccessPassword = $oldAccessPassword
    $env:ApiStudio__DatabasePath = $oldDatabasePath
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
}

$unicodeTemporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('vortix-password-unicode-' + [guid]::NewGuid().ToString('N'))
$unicodeListener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$unicodeListener.Start()
$unicodePort = ([System.Net.IPEndPoint]$unicodeListener.LocalEndpoint).Port
$unicodeListener.Stop()
$unicodePassword = ([char]::ConvertFromUtf32(0x1F600)) * 6
$oldPort = $env:PORT
$oldHostingMode = $env:ApiStudio__HostingMode
$oldPublicOrigin = $env:ApiStudio__PublicOrigin
$oldAccessPassword = $env:ApiStudio__AccessPassword
$oldDatabasePath = $env:ApiStudio__DatabasePath
$unicodeServer = $null
try {
    New-Item -ItemType Directory -Path $unicodeTemporaryRoot | Out-Null
    $env:PORT = [string]$unicodePort
    $env:ApiStudio__HostingMode = 'render'
    $env:ApiStudio__PublicOrigin = $publicOrigin
    $env:ApiStudio__AccessPassword = $unicodePassword
    $env:ApiStudio__DatabasePath = Join-Path $unicodeTemporaryRoot 'hosted.sqlite'
    $unicodeServer = Start-Process -FilePath 'dotnet' -ArgumentList @($dll) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $unicodeTemporaryRoot 'server.out') -RedirectStandardError (Join-Path $unicodeTemporaryRoot 'server.err')
    for ($attempt = 0; $attempt -lt 30 -and -not $unicodeServer.HasExited; $attempt++) { Start-Sleep -Milliseconds 100 }
    $unicodeServer.Refresh()
    if (-not $unicodeServer.HasExited) {
        $unicodeHttpClient = [System.Net.Http.HttpClient]::new()
        try {
            $runtimeResponse = $unicodeHttpClient.GetStringAsync("http://127.0.0.1:$unicodePort/api/runtime").GetAwaiter().GetResult()
        } finally { $unicodeHttpClient.Dispose() }
        throw "Hosted mode accepted six Unicode code points as a 12-character password (length=$($unicodePassword.Length); runtime=$runtimeResponse)."
    }
    if ($unicodeServer.ExitCode -eq 0) { throw 'Hosted mode accepted a password shorter than 12 Unicode code points.' }
    $unicodeDiagnostics = (Get-Content (Join-Path $unicodeTemporaryRoot 'server.out') -Raw) + (Get-Content (Join-Path $unicodeTemporaryRoot 'server.err') -Raw)
    if ($unicodeDiagnostics -notmatch 'AccessPassword' -or $unicodeDiagnostics -notmatch '12') { throw 'Hosted mode rejected the Unicode password for an unexpected reason.' }
    'Hosted password Unicode test passed: minimum length counts Unicode code points.'
}
finally {
    if ($unicodeServer -and -not $unicodeServer.HasExited) { Stop-Process -Id $unicodeServer.Id -Force -ErrorAction SilentlyContinue }
    $env:PORT = $oldPort
    $env:ApiStudio__HostingMode = $oldHostingMode
    $env:ApiStudio__PublicOrigin = $oldPublicOrigin
    $env:ApiStudio__AccessPassword = $oldAccessPassword
    $env:ApiStudio__DatabasePath = $oldDatabasePath
    Remove-Item -LiteralPath $unicodeTemporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
}
