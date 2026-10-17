param([int]$RequestCount, [string]$ReadyPath, [string]$OutputRoot)
$ErrorActionPreference = 'Stop'
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
[System.IO.File]::WriteAllText($ReadyPath, [string]$port, [System.Text.UTF8Encoding]::new($false))
try {
    for ($index = 0; $index -lt $RequestCount; $index++) {
        $client = $listener.AcceptTcpClient()
        $stream = $null
        try {
            $stream = $client.GetStream()
            $headerBytes = [System.Collections.Generic.List[byte]]::new()
            while ($true) {
                $next = $stream.ReadByte()
                if ($next -lt 0) { throw 'Request headers ended unexpectedly.' }
                $headerBytes.Add([byte]$next)
                $count = $headerBytes.Count
                if ($count -ge 4 -and $headerBytes[$count-4] -eq 13 -and $headerBytes[$count-3] -eq 10 -and $headerBytes[$count-2] -eq 13 -and $headerBytes[$count-1] -eq 10) { break }
                if ($count -gt 65536) { throw 'Request headers exceeded the test limit.' }
            }
            $headerText = [System.Text.Encoding]::ASCII.GetString($headerBytes.ToArray())
            $match = [regex]::Match($headerText, '(?im)^Content-Length:\s*(\d+)')
            $length = if ($match.Success) { [int]$match.Groups[1].Value } else { 0 }
            $bodyBytes = [byte[]]::new($length)
            $offset = 0
            while ($offset -lt $length) {
                $read = $stream.Read($bodyBytes, $offset, $length - $offset)
                if ($read -le 0) { throw 'Request body ended unexpectedly.' }
                $offset += $read
            }
            $bodyText = [System.Text.Encoding]::UTF8.GetString($bodyBytes)
            $captured = $headerText + 'BODY' + [Environment]::NewLine + $bodyText
            [System.IO.File]::WriteAllText((Join-Path $OutputRoot ('oauth-request-' + $index + '.txt')), $captured, [System.Text.UTF8Encoding]::new($false))
            $responseBody = [System.Text.Encoding]::UTF8.GetBytes('{"access_token":"oauth-access-canary-012345","token_type":"Bearer","expires_in":3600}')
            $crlf = [char]13 + [char]10
            $response = 'HTTP/1.1 200 OK' + $crlf + 'Content-Type: application/json' + $crlf + 'Cache-Control: no-store' + $crlf + 'Content-Length: ' + $responseBody.Length + $crlf + 'Connection: close' + $crlf + $crlf
            $head = [System.Text.Encoding]::ASCII.GetBytes($response)
            $stream.Write($head, 0, $head.Length)
            $stream.Write($responseBody, 0, $responseBody.Length)
            $stream.Flush()
        } finally {
            if ($stream) { $stream.Dispose() }
            $client.Close()
        }
    }
} finally {
    $listener.Stop()
}