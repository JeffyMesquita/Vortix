param([string]$ReadyPath, [string]$OutputRoot, [string]$AccessToken, [string]$RefreshToken)
$ErrorActionPreference = 'Stop'
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
[System.IO.File]::WriteAllText($ReadyPath, [string]$port, [System.Text.UTF8Encoding]::new($false))
$authorizationParameters = $null
function Get-FormMap([string]$raw) {
    $values = @{}
    foreach ($part in $raw.TrimStart('?').Split('&')) {
        if ($part.Length -eq 0) { continue }
        $separator = $part.IndexOf('=')
        $rawName = if ($separator -lt 0) { $part } else { $part.Substring(0, $separator) }
        $rawValue = if ($separator -lt 0) { '' } else { $part.Substring($separator + 1) }
        $name = [uri]::UnescapeDataString($rawName.Replace('+', ' '))
        $value = [uri]::UnescapeDataString($rawValue.Replace('+', ' '))
        $values[$name] = $value
    }
    return $values
}

$tokenCaptured = $false
try {
    while (-not $tokenCaptured) {
        $client = $listener.AcceptTcpClient()
        $stream = $null
        try {
            $stream = $client.GetStream()
            $headerBytes = [System.Collections.Generic.List[byte]]::new()
            while ($true) {
                $next = $stream.ReadByte()
                if ($next -lt 0) { throw 'Mock request headers ended unexpectedly.' }
                $headerBytes.Add([byte]$next)
                $count = $headerBytes.Count
                if ($count -ge 4 -and $headerBytes[$count-4] -eq 13 -and $headerBytes[$count-3] -eq 10 -and $headerBytes[$count-2] -eq 13 -and $headerBytes[$count-1] -eq 10) { break }
                if ($count -gt 65536) { throw 'Mock request headers exceeded the test limit.' }
            }
            $headerText = [System.Text.Encoding]::ASCII.GetString($headerBytes.ToArray())
            $lineEnd = $headerText.IndexOf([string][char]13 + [string][char]10)
            if ($lineEnd -lt 0) { throw 'Mock request line is missing.' }
            $requestLine = $headerText.Substring(0, $lineEnd)
            $requestMatch = [regex]::Match($requestLine, '^(GET|POST)\s+(\S+)\s+HTTP/1\.[01]$')
            if (-not $requestMatch.Success) { throw 'Mock received an invalid HTTP request line.' }
            $method = $requestMatch.Groups[1].Value
            $target = $requestMatch.Groups[2].Value
            $bodyLengthMatch = [regex]::Match($headerText, '(?im)^Content-Length:\s*(\d+)')
            $bodyLength = if ($bodyLengthMatch.Success) { [int]$bodyLengthMatch.Groups[1].Value } else { 0 }
            $bodyBytes = [byte[]]::new($bodyLength)
            $offset = 0
            while ($offset -lt $bodyLength) {
                $read = $stream.Read($bodyBytes, $offset, $bodyLength - $offset)
                if ($read -le 0) { throw 'Mock request body ended unexpectedly.' }
                $offset += $read
            }
            $body = [System.Text.Encoding]::UTF8.GetString($bodyBytes)
            $crlf = [char]13 + [char]10

            if ($method -eq 'GET' -and $target.StartsWith('/authorize?', [System.StringComparison]::Ordinal)) {
                $authorizeUri = [uri]('http://127.0.0.1:' + $port + $target)
                $authorizationParameters = (Get-FormMap $authorizeUri.Query)
                if ($authorizationParameters['response_type'] -ne 'code' -or $authorizationParameters['code_challenge_method'] -ne 'S256' -or $authorizationParameters['code_challenge'].Length -ne 43) {
                    $responseBody = [System.Text.Encoding]::UTF8.GetBytes('Invalid PKCE authorization request.')
                    $responseHead = 'HTTP/1.1 400 Bad Request' + $crlf + 'Content-Type: text/plain; charset=utf-8' + $crlf + 'Content-Length: ' + $responseBody.Length + $crlf + 'Connection: close' + $crlf + $crlf
                } else {
                    $capture = $headerText + 'BODY' + [Environment]::NewLine + $body
                    [System.IO.File]::WriteAllText((Join-Path $OutputRoot 'oauth-authorization-request.txt'), $capture, [System.Text.UTF8Encoding]::new($false))
                    $redirect = $authorizationParameters['redirect_uri']
                    $separator = if ($redirect.Contains('?')) { '&' } else { '?' }
                    $location = $redirect + $separator + 'code=' + [uri]::EscapeDataString('oauth-ui-code-canary') + '&state=' + [uri]::EscapeDataString($authorizationParameters['state'])
                    $responseHead = 'HTTP/1.1 302 Found' + $crlf + 'Location: ' + $location + $crlf + 'Cache-Control: no-store' + $crlf + 'Content-Length: 0' + $crlf + 'Connection: close' + $crlf + $crlf
                    $responseBody = [byte[]]::new(0)
                }
            } elseif ($method -eq 'POST' -and $target.StartsWith('/token', [System.StringComparison]::Ordinal)) {
                $capture = $headerText + 'BODY' + [Environment]::NewLine + $body
                [System.IO.File]::WriteAllText((Join-Path $OutputRoot 'oauth-token-request.txt'), $capture, [System.Text.UTF8Encoding]::new($false))
                $form = (Get-FormMap $body)
                $sha = [System.Security.Cryptography.SHA256]::Create()
                try { $challenge = [Convert]::ToBase64String($sha.ComputeHash([System.Text.Encoding]::ASCII.GetBytes($form['code_verifier']))).TrimEnd('=').Replace('+', '-').Replace('/', '_') } finally { $sha.Dispose() }
                if ($form['grant_type'] -ne 'authorization_code' -or $form['code'] -ne 'oauth-ui-code-canary' -or $challenge -ne $authorizationParameters['code_challenge']) {
                    $responseBody = [System.Text.Encoding]::UTF8.GetBytes('{"error":"invalid_grant"}')
                    $responseHead = 'HTTP/1.1 400 Bad Request' + $crlf + 'Content-Type: application/json' + $crlf + 'Content-Length: ' + $responseBody.Length + $crlf + 'Connection: close' + $crlf + $crlf
                } else {
                    $json = '{"access_token":"' + $AccessToken + '","refresh_token":"' + $RefreshToken + '","token_type":"Bearer","expires_in":3600}'
                    $responseBody = [System.Text.Encoding]::UTF8.GetBytes($json)
                    $responseHead = 'HTTP/1.1 200 OK' + $crlf + 'Content-Type: application/json' + $crlf + 'Cache-Control: no-store' + $crlf + 'Content-Length: ' + $responseBody.Length + $crlf + 'Connection: close' + $crlf + $crlf
                    $tokenCaptured = $true
                }
            } else {
                $responseBody = [System.Text.Encoding]::UTF8.GetBytes('Not found.')
                $responseHead = 'HTTP/1.1 404 Not Found' + $crlf + 'Content-Type: text/plain; charset=utf-8' + $crlf + 'Content-Length: ' + $responseBody.Length + $crlf + 'Connection: close' + $crlf + $crlf
            }

            $headBytes = [System.Text.Encoding]::ASCII.GetBytes($responseHead)
            $stream.Write($headBytes, 0, $headBytes.Length)
            if ($responseBody.Length -gt 0) { $stream.Write($responseBody, 0, $responseBody.Length) }
            $stream.Flush()
        } finally {
            if ($stream) { $stream.Dispose() }
            $client.Close()
        }
    }
} finally {
    $listener.Stop()
}