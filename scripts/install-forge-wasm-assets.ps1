param(
  [string]$Repo = "davidpm1021/magic-workbench",
  [string]$Branch = "workbench-v0.1"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw "GitHub CLI (gh) is required."
}

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$dest = Join-Path $root "packages\forge-wasm"
$temp = Join-Path $env:TEMP "magic-workbench-forge-wasm"

Write-Host "Finding latest successful Forge WASM build..." -ForegroundColor Cyan
$runsJson = gh run list `
  --repo $Repo `
  --workflow "Build Forge WASM assets" `
  --branch $Branch `
  --status success `
  --limit 1 `
  --json databaseId,headSha,conclusion

$runs = $runsJson | ConvertFrom-Json
if (-not $runs -or $runs.Count -eq 0) {
  throw "No successful Forge WASM build exists yet. Check GitHub Actions and try again when it finishes."
}

$runId = $runs[0].databaseId
Write-Host "Using GitHub Actions run $runId" -ForegroundColor Green

Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $temp | Out-Null

gh run download $runId `
  --repo $Repo `
  --name "forge-wasm-assets" `
  --dir $temp

$launcher = Get-ChildItem $temp -Recurse -File -Filter "forgeharness.js" | Select-Object -First 1
$wasm = Get-ChildItem $temp -Recurse -File -Filter "forgeharness.js.wasm" | Select-Object -First 1

if (-not $launcher) {
  throw "Artifact did not contain forgeharness.js"
}
if (-not $wasm) {
  throw "Artifact did not contain forgeharness.js.wasm"
}

Copy-Item $launcher.FullName (Join-Path $dest "forgeharness.js") -Force
Copy-Item $wasm.FullName (Join-Path $dest "forgeharness.js.wasm") -Force

$launcherSize = (Get-Item (Join-Path $dest "forgeharness.js")).Length
$wasmSize = (Get-Item (Join-Path $dest "forgeharness.js.wasm")).Length

if ($launcherSize -le 0 -or $wasmSize -le 0) {
  throw "Downloaded Forge WASM files are empty."
}

Write-Host ""
Write-Host "Forge browser engine installed." -ForegroundColor Green
Write-Host ("Launcher: {0:N1} MB" -f ($launcherSize / 1MB))
Write-Host ("WASM:     {0:N1} MB" -f ($wasmSize / 1MB))
Write-Host ""
Write-Host "Restart the Vite server after installing these files." -ForegroundColor Yellow
