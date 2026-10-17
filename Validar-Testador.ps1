[CmdletBinding()]
param([string]$BaseUrl = 'http://127.0.0.1:51873')
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'Test-VortixApiClient.ps1') -BaseUrl $BaseUrl
