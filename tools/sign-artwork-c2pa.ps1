param(
  [Parameter(Mandatory = $true)][string]$InputFile,
  [Parameter(Mandatory = $true)][string]$OutputFile,
  [Parameter(Mandatory = $true)][string]$Title,
  [Parameter(Mandatory = $true)][ValidatePattern('^LWV-[A-Za-z0-9-]+$')][string]$SerialNumber,
  [string]$Creator = "LWVader",
  [string]$PrivateKey = ".\signing\signing-private.pem",
  [string]$SigningCertificate = ".\signing\signing-cert.pem",
  [string]$C2paTool = "c2patool"
)

$ErrorActionPreference = "Stop"

# SECTION: Input and tool validation
foreach ($path in @($InputFile, $PrivateKey, $SigningCertificate)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Required file not found: $path"
  }
}

if (-not (Get-Command $C2paTool -ErrorAction SilentlyContinue)) {
  throw "c2patool was not found. Install it and ensure it is on PATH."
}

$inputPath = (Resolve-Path -LiteralPath $InputFile).Path
$privateKeyPath = (Resolve-Path -LiteralPath $PrivateKey).Path
$certificatePath = (Resolve-Path -LiteralPath $SigningCertificate).Path
$outputPath = [System.IO.Path]::GetFullPath($OutputFile)
$outputDirectory = Split-Path -Parent $outputPath
if ($outputDirectory) {
  New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
}

$temporaryManifest = Join-Path ([System.IO.Path]::GetTempPath()) `
  ("pixel-shroom-c2pa-{0}.json" -f [guid]::NewGuid())

# SECTION: C2PA claim with AI source and LWV identity assertion
$manifest = @{
  claim_generator = "Pixel Shroom Studio/1.0"
  title = $Title
  format = "image/png"
  alg = "es256"
  private_key = $privateKeyPath
  sign_cert = $certificatePath
  assertions = @(
    @{
      label = "c2pa.actions.v2"
      data = @{
        actions = @(
          @{
            action = "c2pa.created"
            softwareAgent = "Pixel Shroom Studio"
            digitalSourceType = "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"
          }
        )
      }
    },
    @{
      label = "com.pixelshroom.identity"
      data = @{
        serial_number = $SerialNumber
        creator = $Creator
        studio = "Pixel Shroom Studio"
      }
    }
  )
}

try {
  $manifest | ConvertTo-Json -Depth 12 | Set-Content `
    -LiteralPath $temporaryManifest `
    -Encoding utf8

  # SECTION: Sign and validate the output artifact
  & $C2paTool $inputPath -m $temporaryManifest -o $outputPath
  if ($LASTEXITCODE -ne 0) { throw "c2patool signing failed." }

  & $C2paTool $outputPath
  if ($LASTEXITCODE -ne 0) { throw "C2PA validation failed." }

  $hash = (Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash.ToLowerInvariant()
  Write-Host "Signed artwork: $outputPath"
  Write-Host "LWV serial: $SerialNumber"
  Write-Host "SHA-256: $hash"
} finally {
  Remove-Item -LiteralPath $temporaryManifest -Force -ErrorAction SilentlyContinue
}

