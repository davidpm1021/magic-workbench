param(
  [string]$MainModel = "gpt-6-luna",
  [string]$FastModel = "gpt-6-luna",
  [string]$ApiBaseUrl = "https://api.openai.com/v1"
)

$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repo

if (-not (Test-Path "$repo\packages\forge-wasm\forgeharness.js") -or
    -not (Test-Path "$repo\packages\forge-wasm\forgeharness.js.wasm")) {
  Write-Host "Forge browser assets are missing. Installing the latest successful build..." -ForegroundColor Yellow
  & "$repo\scripts\install-forge-wasm-assets.ps1"
}

Write-Host "Main model: $MainModel" -ForegroundColor DarkGray
Write-Host "Fast model: $FastModel" -ForegroundColor DarkGray

$enteredBase = Read-Host "OpenAI-compatible API base URL [$ApiBaseUrl]"
if ($enteredBase.Trim()) {
  $ApiBaseUrl = $enteredBase.Trim()
}

$secureKey = Read-Host "Provider API key (optional for local endpoints)" -AsSecureString
$plainKey = ""
$bstr = [IntPtr]::Zero
try {
  if ($secureKey.Length -gt 0) {
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
    $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  }

  $env:WORKBENCH_AI_BASE_URL = $ApiBaseUrl.TrimEnd("/")
  $env:WORKBENCH_AI_API_KEY = $plainKey
  $env:VITE_WORKBENCH_AI_MODEL = $MainModel.Trim()
  $env:VITE_WORKBENCH_AI_FAST_MODEL = $FastModel.Trim()
  $env:WORKBENCH_AI_STRATEGIC_EFFORT = "high"

  Write-Host ""
  Write-Host "Starting Magic Workbench AI mode..." -ForegroundColor Green
  Write-Host "Provider: $env:WORKBENCH_AI_BASE_URL"
  Write-Host "Main model: $env:VITE_WORKBENCH_AI_MODEL"
  if ($env:VITE_WORKBENCH_AI_FAST_MODEL) {
    Write-Host "Fast model: $env:VITE_WORKBENCH_AI_FAST_MODEL"
  } else {
    Write-Host "Fast model: main model fallback"
  }
  Write-Host "API key is held only in this PowerShell process." -ForegroundColor DarkGray
  Write-Host ""

  yarn web
} finally {
  $env:WORKBENCH_AI_API_KEY = ""
  $plainKey = ""
  if ($bstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}
