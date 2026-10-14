$ErrorActionPreference = 'Stop'
$projectDir = $PSScriptRoot
$project = Join-Path $projectDir 'ApiPublicacaoTester.csproj'
$port = if ($env:ApiStudio__Port) { [int]$env:ApiStudio__Port } else { 51873 }
$localUrl = "http://127.0.0.1:$port"

try {
    $health = Invoke-RestMethod -Uri "$localUrl/health" -TimeoutSec 1
    if ($health.status -eq 'ok' -and $health.app -eq 'ApiPublicacaoTester') {
        Start-Process "$localUrl/"
        exit 0
    }
} catch { }

$process = Start-Process -FilePath 'dotnet' -ArgumentList @('run', '--project', $project, '--no-launch-profile') -WorkingDirectory $projectDir -PassThru -WindowStyle Normal
for ($attempt = 0; $attempt -lt 80; $attempt++) {
    if ($process.HasExited) {
        Write-Error 'O servidor local encerrou antes de ficar pronto. Confira o .NET 8 e a porta 51873 na janela aberta.'
        exit 1
    }
    try {
        $health = Invoke-RestMethod -Uri "$localUrl/health" -TimeoutSec 1
        if ($health.status -eq 'ok' -and $health.app -eq 'ApiPublicacaoTester') {
            Start-Process "$localUrl/"
            exit 0
        }
    } catch { }
    Start-Sleep -Milliseconds 250
}
Write-Error 'Servidor local não respondeu em 20 segundos. Confira a janela e a porta 51873.'
exit 1
