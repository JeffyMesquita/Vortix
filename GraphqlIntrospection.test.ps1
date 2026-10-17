$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path $PSScriptRoot).Path
$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$tempRoot = Join-Path $tempBase ('vortix-graphql-introspection-' + [guid]::NewGuid().ToString('N'))
$databasePath = Join-Path $tempRoot 'graphql.sqlite'
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
$listener.Stop()
$baseUrl = 'http://127.0.0.1:' + $port
$oldPort = $env:ApiStudio__Port
$oldDatabasePath = $env:ApiStudio__DatabasePath
$server = $null
$mock = $null
$passed = $false
New-Item -ItemType Directory -Path $tempRoot | Out-Null
try {
    $mockReady = Join-Path $tempRoot 'graphql-mock.port'
    $capturePath = Join-Path $tempRoot 'graphql-request.json'
    $mockScript = Join-Path $projectRoot 'GraphqlSchemaCaptureServer.test.ps1'
    $mock = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $mockScript, '-ReadyPath', $mockReady, '-CapturePath', $capturePath) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $tempRoot 'mock.out') -RedirectStandardError (Join-Path $tempRoot 'mock.err')
    for ($attempt = 0; $attempt -lt 50; $attempt++) { if ($mock.HasExited) { throw 'GraphQL mock exited before becoming ready.' }; if (Test-Path -LiteralPath $mockReady) { break }; Start-Sleep -Milliseconds 100 }
    if (-not (Test-Path -LiteralPath $mockReady)) { throw 'GraphQL mock did not become ready.' }
    $mockBaseUrl = 'http://127.0.0.1:' + [int](Get-Content -Raw $mockReady)
    $env:ApiStudio__Port = [string]$port
    $env:ApiStudio__DatabasePath = $databasePath
    $dll = Join-Path $projectRoot 'bin\Release\net8.0\VortixApiClient.dll'
    if (-not (Test-Path -LiteralPath $dll)) { throw 'Release DLL is missing; build VortixApiClient first.' }
    $server = Start-Process -FilePath 'dotnet' -ArgumentList @($dll) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $tempRoot 'server.out') -RedirectStandardError (Join-Path $tempRoot 'server.err')
    $ready = $false
    for ($attempt = 0; $attempt -lt 50; $attempt++) { if ($server.HasExited) { throw 'Temporary API process exited before becoming ready.' }; try { $health = Invoke-RestMethod -Uri ($baseUrl + '/health') -TimeoutSec 1; if ($health.status -eq 'ok') { $ready = $true; break } } catch { Start-Sleep -Milliseconds 150 } }
    if (-not $ready) { throw 'Temporary API did not become ready.' }
    $headers = @{ 'X-Api-Studio' = '1'; Origin = $baseUrl }
    $fakeToken = 'graphql-introspection-test-token'
    $payload = @{ baseUrl = $mockBaseUrl; route = '/graphql'; method = 'DELETE'; headers = 'Accept: application/json'; authType = 'bearer'; bearerToken = $fakeToken; bodyMode = 'json'; body = 'mutation { deleteEverything }'; confirmTestData = $false; testDataPhrase = ''; allowInsecureHttp = $false; environmentId = 'introspection-test' } | ConvertTo-Json -Compress
    $result = Invoke-RestMethod -Uri ($baseUrl + '/api/graphql/introspection') -Method Post -Headers $headers -ContentType 'application/json' -Body $payload -TimeoutSec 10
    if ($result.status -ne 200) { throw ('Introspection proxy expected HTTP 200, got ' + $result.status) }
    $schema = $result.body | ConvertFrom-Json
    if ($schema.data.__schema.queryType.name -ne 'Query' -or $schema.data.__schema.types[0].fields[0].name -ne 'ping') { throw 'GraphQL schema response did not round-trip.' }
    for ($attempt = 0; $attempt -lt 20; $attempt++) { if (Test-Path -LiteralPath $capturePath) { break }; Start-Sleep -Milliseconds 100 }
    if (-not (Test-Path -LiteralPath $capturePath)) { throw 'GraphQL mock did not capture an upstream request.' }
    $captured = Get-Content -Raw $capturePath | ConvertFrom-Json
    $capturedBody = $captured.body | ConvertFrom-Json
    if ($captured.method -ne 'POST' -or $captured.authorization -ne ('Bearer ' + $fakeToken)) { throw 'Introspection method or Auth was not forwarded.' }
    if ($capturedBody.operationName -ne 'VortixSchemaIntrospection' -or $capturedBody.query -notlike '*__schema*' -or $capturedBody.query -like '*deleteEverything*') { throw 'Server did not enforce its fixed, read-only introspection query.' }
    $history = Invoke-RestMethod -Uri ($baseUrl + '/api/storage/history') -Headers $headers -TimeoutSec 3
    $historyIds = @($history | ForEach-Object { $_.id })
    if ($historyIds.Count -ne 0) { throw ('Schema introspection must not enter request history. IDs=' + ($historyIds -join ',')) }
    $passed = $true
    Write-Output 'GraphqlIntrospection.test.ps1 passed.'
}
finally {
    if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue; Wait-Process -Id $server.Id -Timeout 5 -ErrorAction SilentlyContinue }
    if ($mock -and -not $mock.HasExited) { Stop-Process -Id $mock.Id -Force -ErrorAction SilentlyContinue; Wait-Process -Id $mock.Id -Timeout 5 -ErrorAction SilentlyContinue }
    if ($null -eq $oldPort) { Remove-Item Env:\ApiStudio__Port -ErrorAction SilentlyContinue } else { $env:ApiStudio__Port = $oldPort }
    if ($null -eq $oldDatabasePath) { Remove-Item Env:\ApiStudio__DatabasePath -ErrorAction SilentlyContinue } else { $env:ApiStudio__DatabasePath = $oldDatabasePath }
    if (Test-Path -LiteralPath $tempRoot) {
        $fullTempRoot = [IO.Path]::GetFullPath($tempRoot)
        if (-not $fullTempRoot.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing to clean a path outside the system temp directory.' }
        Remove-Item -LiteralPath $fullTempRoot -Recurse -Force
    }
}
