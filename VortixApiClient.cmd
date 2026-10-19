@echo off
setlocal
where dotnet >nul 2>nul
if errorlevel 1 (
  echo .NET 10 nao encontrado. Instale/valide o runtime antes de abrir esta ferramenta.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0VortixApiClient.ps1"
if errorlevel 1 pause
