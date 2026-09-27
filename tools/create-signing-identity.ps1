param(
  [string]$OutputDirectory = ".\signing"
)

$ErrorActionPreference = "Stop"

# SECTION: Prerequisite validation
if (-not (Get-Command openssl -ErrorAction SilentlyContinue)) {
  throw "OpenSSL is required and was not found on PATH."
}

$output = [System.IO.Path]::GetFullPath($OutputDirectory)
$privateKey = Join-Path $output "signing-private.pem"
$publicKey = Join-Path $output "signing-public.pem"
$certificate = Join-Path $output "signing-cert.pem"

foreach ($path in @($privateKey, $publicKey, $certificate)) {
  if (Test-Path $path) {
    throw "Refusing to overwrite an existing signing identity: $path"
  }
}

New-Item -ItemType Directory -Path $output -Force | Out-Null

# SECTION: Studio-controlled P-256 signing identity
& openssl genpkey `
  -algorithm EC `
  -pkeyopt ec_paramgen_curve:P-256 `
  -out $privateKey
if ($LASTEXITCODE -ne 0) { throw "Private-key generation failed." }

& openssl pkey `
  -in $privateKey `
  -pubout `
  -out $publicKey
if ($LASTEXITCODE -ne 0) { throw "Public-key generation failed." }

# SECTION: Self-managed C2PA signing certificate
& openssl req `
  -new `
  -x509 `
  -key $privateKey `
  -out $certificate `
  -days 3650 `
  -sha256 `
  -subj "/CN=Pixel Shroom Studio/O=Pixel Shroom Studio/OU=LWVader" `
  -addext "basicConstraints=critical,CA:FALSE" `
  -addext "keyUsage=critical,digitalSignature" `
  -addext "extendedKeyUsage=codeSigning"
if ($LASTEXITCODE -ne 0) { throw "Certificate generation failed." }

Write-Host "Signing identity created in $output"
Write-Host "Keep signing-private.pem secret and out of Git."
Write-Host "Use signing-public.pem in the admin form."

