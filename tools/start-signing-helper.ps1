$ErrorActionPreference = "Stop"

# SECTION: Start the localhost-only C2PA signing helper
$helper = Join-Path $PSScriptRoot "local-signing-server.mjs"
if (-not (Test-Path -LiteralPath $helper -PathType Leaf)) {
  throw "The local signing helper was not found: $helper"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js was not found on PATH."
}

if (-not (Get-Command c2patool -ErrorAction SilentlyContinue)) {
  throw "c2patool was not found on PATH."
}

# SECTION: Production administrator origins
if ([string]::IsNullOrWhiteSpace($env:PIXEL_SIGNING_ALLOWED_ORIGINS)) {
  $env:PIXEL_SIGNING_ALLOWED_ORIGINS = "https://www.pixelshroomstudio.com,https://pixelshroomstudio.com"
}

Set-Location (Resolve-Path (Join-Path $PSScriptRoot ".."))
node $helper
