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
        $reader = $null
        try {
            $stream = $client.GetStream()
            $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 4096, $true)
            $lines = [System.Collections.Generic.List[string]]::new()
            $line = $reader.ReadLine()
            while ($null -ne $line -and $line.Length -gt 0) { $lines.Add($line); $line = $reader.ReadLine() }
            [System.IO.File]::WriteAllText((Join-Path $OutputRoot ('request-' + $index + '.txt')), ($lines -join [Environment]::NewLine), [System.Text.UTF8Encoding]::new($false))
            $body = [System.Text.Encoding]::UTF8.GetBytes('{"status":"ok"}')
            $crlf = [char]13 + [char]10
            $response = 'HTTP/1.1 200 OK' + $crlf + 'Content-Type: application/json' + $crlf + 'Content-Length: ' + $body.Length + $crlf + 'Connection: close' + $crlf + $crlf
            $head = [System.Text.Encoding]::ASCII.GetBytes($response)
            $stream.Write($head, 0, $head.Length)
            $stream.Write($body, 0, $body.Length)
            $stream.Flush()
        } finally {
            if ($reader) { $reader.Dispose() }
            if ($stream) { $stream.Dispose() }
            $client.Close()
        }
    }
} finally {
    $listener.Stop()
}
