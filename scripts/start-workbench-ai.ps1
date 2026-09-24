param(
  [string]$MainModel = "gpt-6-luna",
  [string]$FastModel = "gpt-6-luna",
  [string]$ApiBaseUrl = "https://api.openai.com/v1"
)

$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repo

$envFile = Join-Path $repo ".env.local"

function Set-EnvFileValue {
  param(
    [string]$Name,
    [string]$Value
  )

  $lines = @()
  if (Test-Path $envFile) {
    $lines = @(Get-Content $envFile)
  }

  $updated = $false
  $nextLines = @(
    foreach ($existingLine in $lines) {
      if ($existingLine -match ("^\s*" + [Regex]::Escape($Name) + "\s*=")) {
        "$Name=$Value"
        $updated = $true
      } else {
        $existingLine
      }
    }
  )

  if (-not $updated) {
    $nextLines += "$Name=$Value"
  }

  [System.IO.File]::WriteAllLines(
    $envFile,
    [string[]]$nextLines,
    [System.Text.UTF8Encoding]::new($false)
  )
}

if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) {
      return
    }

    $parts = $line -split "=", 2
    if ($parts.Count -ne 2) {
      return
    }

    $name = $parts[0].Trim()
    $value = $parts[1].Trim()

    if (
      ($value.StartsWith('"') -and $value.EndsWith('"')) -or
      ($value.StartsWith("'") -and $value.EndsWith("'"))
    ) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }

  Write-Host "Loaded local Workbench settings from .env.local" -ForegroundColor DarkGray
}

if ($env:WORKBENCH_AI_BASE_URL) {
  $ApiBaseUrl = $env:WORKBENCH_AI_BASE_URL.Trim()
}
if ($env:VITE_WORKBENCH_AI_MODEL) {
  $MainModel = $env:VITE_WORKBENCH_AI_MODEL.Trim()
}
if ($env:VITE_WORKBENCH_AI_FAST_MODEL) {
  $FastModel = $env:VITE_WORKBENCH_AI_FAST_MODEL.Trim()
}

if (-not (Test-Path "$repo\packages\forge-wasm\forgeharness.js") -or
    -not (Test-Path "$repo\packages\forge-wasm\forgeharness.js.wasm")) {
  Write-Host "Forge browser assets are missing. Installing the latest successful build..." -ForegroundColor Yellow
  & "$repo\scripts\install-forge-wasm-assets.ps1"
}

Write-Host "Main model: $MainModel" -ForegroundColor DarkGray
Write-Host "Fast model: $FastModel" -ForegroundColor DarkGray

if ($env:WORKBENCH_AI_BASE_URL) {
  Write-Host "API base URL loaded from .env.local" -ForegroundColor DarkGray
} else {
  $enteredBase = Read-Host "OpenAI-compatible API base URL [$ApiBaseUrl]"
  if ($enteredBase.Trim()) {
    $ApiBaseUrl = $enteredBase.Trim()
  }
}

$plainKey = $env:WORKBENCH_AI_API_KEY
$apiKeyLoadedFromFile = [bool]$plainKey
$secureKey = $null
$bstr = [IntPtr]::Zero
try {
  if ($plainKey) {
    Write-Host "API key loaded from .env.local" -ForegroundColor DarkGray
  } else {
    $secureKey = Read-Host "Provider API key (optional for local endpoints)" -AsSecureString
    if ($secureKey.Length -gt 0) {
      $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
      $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
      Set-EnvFileValue -Name "WORKBENCH_AI_API_KEY" -Value $plainKey
      Write-Host "Saved API key to the Git-ignored .env.local file for future launches." -ForegroundColor DarkGray
    }
  }

  $env:WORKBENCH_AI_BASE_URL = $ApiBaseUrl.TrimEnd("/")
  $env:WORKBENCH_AI_API_KEY = $plainKey
  $env:VITE_WORKBENCH_AI_MODEL = $MainModel.Trim()
  $env:VITE_WORKBENCH_AI_FAST_MODEL = $FastModel.Trim()
  if (-not $env:WORKBENCH_AI_STRATEGIC_EFFORT) {
    $env:WORKBENCH_AI_STRATEGIC_EFFORT = "high"
  }

  Write-Host ""
  Write-Host "Starting Magic Workbench AI mode..." -ForegroundColor Green
  Write-Host "Provider: $env:WORKBENCH_AI_BASE_URL"
  Write-Host "Main model: $env:VITE_WORKBENCH_AI_MODEL"
  if ($env:VITE_WORKBENCH_AI_FAST_MODEL) {
    Write-Host "Fast model: $env:VITE_WORKBENCH_AI_FAST_MODEL"
  } else {
    Write-Host "Fast model: main model fallback"
  }
  if ($apiKeyLoadedFromFile) {
    Write-Host "API key was loaded from the Git-ignored .env.local file into this PowerShell process." -ForegroundColor DarkGray
  } elseif ($plainKey) {
    Write-Host "API key was saved to the Git-ignored .env.local file and loaded into this PowerShell process." -ForegroundColor DarkGray
  } else {
    Write-Host "No provider API key is configured." -ForegroundColor DarkGray
  }
  Write-Host ""

  Write-Host "Workbench URL: http://localhost:1420" -ForegroundColor Cyan
  Write-Host "Deck backup: $env:USERPROFILE\.magic-workbench\deck-storage.json" -ForegroundColor DarkGray
  Write-Host "Open that URL in the same browser profile you normally use for Workbench." -ForegroundColor DarkGray
  yarn web --host localhost
} finally {
  $env:WORKBENCH_AI_API_KEY = ""
  $plainKey = ""
  if ($bstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}
