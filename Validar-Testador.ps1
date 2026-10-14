param([string]$BaseUrl = 'http://127.0.0.1:51873')
$ErrorActionPreference = 'Stop'
$BaseUrl = $BaseUrl.TrimEnd('/')
$health = Invoke-RestMethod -Uri "$BaseUrl/health" -TimeoutSec 3
if ($health.status -ne 'ok' -or $health.app -ne 'ApiPublicacaoTester') { throw 'Health check did not identify the local API tester.' }
$headers = @{ 'X-Api-Studio' = '1' }
$null = Invoke-RestMethod -Uri "$BaseUrl/api/storage/collections" -Headers $headers -TimeoutSec 3
$workspaceSnapshot = Invoke-RestMethod -Uri "$BaseUrl/api/storage/workspace" -Headers $headers -TimeoutSec 3
foreach ($store in @('history', 'collections', 'environments', 'settings')) {
    if ($workspaceSnapshot.PSObject.Properties.Name -notcontains $store -or $workspaceSnapshot.$store -isnot [System.Array]) { throw "Workspace snapshot is missing store: $store" }
}
$missingSetting = Invoke-WebRequest -Uri "$BaseUrl/api/storage/settings?key=validation-$([guid]::NewGuid())" -Headers $headers -TimeoutSec 3 -UseBasicParsing
if ($missingSetting.Content.Trim() -ne 'null') { throw 'A missing local setting must be returned as JSON null.' }
$page = (Invoke-WebRequest -Uri "$BaseUrl/" -TimeoutSec 3 -UseBasicParsing).Content
foreach ($requiredText in @(
    '<option>GET</option>', '<option>HEAD</option>', '<option>POST</option>', '<option>PUT</option>', '<option>PATCH</option>', '<option>DELETE</option>', '<option>OPTIONS</option>',
    'id="query-params"', 'id="bearer-token"', 'id="token-route"', 'id="token-client-id-field"', 'id="token-client-secret-field"',
    'id="allow-insecure-http"', 'client_secret', 'SQLite local', 'theme-select', 'format-json', 'import-collection', 'export-collection',
    'data-editor-tab="scripts"', 'response-json-path', 'insomnia.environment.set', 'save-token-environment',
    'id="add-response-test"', 'id="response-tests-list"', 'id="response-tests-output"',
    'data-editor-tab="tests"', 'id="settings-dialog"', 'id="settings-environments"',
    'id="run-collection"', 'id="runner-dialog"', 'id="runner-datasets"', 'id="runner-write-phrase"',
    'id="response-view-modes"', 'data-response-view="tree"', 'id="response-search"', 'id="response-tree"',
    'Insomnia JSON (v4)', 'Postman Collection v2.1', 'id="export-workspace"', 'id="restore-workspace"', 'id="restore-workspace-file"', 'id="protect-existing-secrets"'
)) {
    if (-not $page.Contains($requiredText)) { throw "Page is missing required label: $requiredText" }
}
'Local smoke test passed: request methods, Params, Auth, SQLite, response viewer and capture, tests, settings, themes, JSON editor, collection formats, and workspace snapshot, backup, restore, and data-protection migration controls are present.'
