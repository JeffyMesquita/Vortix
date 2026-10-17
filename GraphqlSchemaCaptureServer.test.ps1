param([string]$ReadyPath, [string]$CapturePath)
$ErrorActionPreference = 'Stop'
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
[IO.File]::WriteAllText($ReadyPath, [string]$port, [Text.UTF8Encoding]::new($false))
$client = $listener.AcceptTcpClient()
try {
    $stream = $client.GetStream()
    $bytes = [System.Collections.Generic.List[byte]]::new()
    $state = 0
    while ($state -lt 4) {
        $value = $stream.ReadByte()
        if ($value -lt 0) { throw 'Client closed before headers completed.' }
        $bytes.Add([byte]$value)
        $state = switch ($state) {
            0 { if ($value -eq 13) { 1 } else { 0 } }
            1 { if ($value -eq 10) { 2 } elseif ($value -eq 13) { 1 } else { 0 } }
            2 { if ($value -eq 13) { 3 } else { 0 } }
            3 { if ($value -eq 10) { 4 } elseif ($value -eq 13) { 1 } else { 0 } }
        }
    }
    $headerText = [Text.Encoding]::ASCII.GetString($bytes.ToArray())
    $headerLines = $headerText -split "`r`n"
    $contentLengthLine = $headerLines | Where-Object { $_ -match '^Content-Length:' } | Select-Object -First 1
    $contentLength = if ($contentLengthLine) { [int](($contentLengthLine -split ':',2)[1].Trim()) } else { 0 }
    $bodyBytes = [byte[]]::new($contentLength)
    $offset = 0
    while ($offset -lt $contentLength) {
        $read = $stream.Read($bodyBytes, $offset, $contentLength - $offset)
        if ($read -le 0) { throw 'Client closed before request body completed.' }
        $offset += $read
    }
    $authorizationLine = $headerLines | Where-Object { $_ -match '^Authorization:' } | Select-Object -First 1
    $authorization = if ($authorizationLine) { ($authorizationLine -split ':',2)[1].Trim() } else { '' }
    $capture = @{ method = (($headerLines[0] -split ' ')[0]); authorization = $authorization; body = [Text.Encoding]::UTF8.GetString($bodyBytes) } | ConvertTo-Json -Depth 6 -Compress
    [IO.File]::WriteAllText($CapturePath, $capture, [Text.UTF8Encoding]::new($false))
    $responseBody = [Text.Encoding]::UTF8.GetBytes('{"data":{"__schema":{"queryType":{"name":"Query"},"mutationType":null,"subscriptionType":null,"types":[{"kind":"OBJECT","name":"Query","fields":[{"name":"ping","description":null,"args":[],"type":{"kind":"SCALAR","name":"String","ofType":null}}]}]}}}')
    $crlf = "`r`n"
    $head = 'HTTP/1.1 200 OK' + $crlf + 'Content-Type: application/json' + $crlf + 'Content-Length: ' + $responseBody.Length + $crlf + 'Connection: close' + $crlf + $crlf
    $headBytes = [Text.Encoding]::ASCII.GetBytes($head)
    $stream.Write($headBytes, 0, $headBytes.Length)
    $stream.Write($responseBody, 0, $responseBody.Length)
    $stream.Flush()
} finally {
    $client.Close()
    $listener.Stop()
}
