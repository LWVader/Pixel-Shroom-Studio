param(
  [string]$OutputDirectory = ".\signing",
  [switch]$ReplaceInvalidIdentity
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
$rootPrivateKey = Join-Path $output "signing-root-private.pem"
$rootCertificate = Join-Path $output "signing-root-cert.pem"
$certificateRequest = Join-Path $output "signing-leaf.csr"
$extensionFile = Join-Path $output "signing-leaf.ext"
$rootSerialFile = Join-Path $output "signing-root-cert.srl"
$identityFiles = @(
  $privateKey,
  $publicKey,
  $certificate,
  $rootPrivateKey,
  $rootCertificate,
  $certificateRequest,
  $extensionFile,
  $rootSerialFile
)

# SECTION: Preserve an invalid earlier identity instead of deleting it
$existingFiles = $identityFiles | Where-Object { Test-Path -LiteralPath $_ }
if ($existingFiles.Count -gt 0) {
  if (-not $ReplaceInvalidIdentity) {
    throw "A signing identity already exists. Re-run with -ReplaceInvalidIdentity to move it into a timestamped backup and create a C2PA-compliant identity."
  }

  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backupDirectory = "${output}-invalid-backup-${timestamp}"
  New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
  foreach ($path in $existingFiles) {
    Move-Item -LiteralPath $path -Destination $backupDirectory
  }
  Write-Host "Previous identity moved to $backupDirectory"
}

New-Item -ItemType Directory -Path $output -Force | Out-Null

try {
  # SECTION: Private studio root CA used only to issue the leaf certificate
  & openssl genpkey `
    -algorithm EC `
    -pkeyopt ec_paramgen_curve:P-256 `
    -out $rootPrivateKey
  if ($LASTEXITCODE -ne 0) { throw "Root-key generation failed." }

  & openssl req `
    -new `
    -x509 `
    -key $rootPrivateKey `
    -out $rootCertificate `
    -days 3650 `
    -sha256 `
    -subj "/CN=Pixel Shroom Studio Private Root/O=Pixel Shroom Studio/OU=LWVader" `
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" `
    -addext "keyUsage=critical,keyCertSign,cRLSign" `
    -addext "subjectKeyIdentifier=hash"
  if ($LASTEXITCODE -ne 0) { throw "Root-certificate generation failed." }

  # SECTION: P-256 end-entity signing key and request
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

  & openssl req `
    -new `
    -key $privateKey `
    -out $certificateRequest `
    -sha256 `
    -subj "/CN=Pixel Shroom Studio C2PA Signer/O=Pixel Shroom Studio/OU=LWVader"
  if ($LASTEXITCODE -ne 0) { throw "Certificate-request generation failed." }

  # SECTION: C2PA certificate profile
  @"
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=critical,emailProtection
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid,issuer
"@ | Set-Content -LiteralPath $extensionFile -Encoding ascii

  & openssl x509 `
    -req `
    -in $certificateRequest `
    -CA $rootCertificate `
    -CAkey $rootPrivateKey `
    -CAcreateserial `
    -out $certificate `
    -days 825 `
    -sha256 `
    -extfile $extensionFile
  if ($LASTEXITCODE -ne 0) { throw "C2PA leaf-certificate generation failed." }

  # SECTION: Verify the issued certificate and matching private key
  & openssl verify -CAfile $rootCertificate $certificate
  if ($LASTEXITCODE -ne 0) { throw "The generated certificate chain is invalid." }

  $certificatePublicKey = & openssl x509 -in $certificate -pubkey -noout
  $privatePublicKey = & openssl pkey -in $privateKey -pubout
  if (($certificatePublicKey -join "`n") -ne ($privatePublicKey -join "`n")) {
    throw "The generated signing certificate does not match the private key."
  }
} finally {
  Remove-Item -LiteralPath $certificateRequest -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $extensionFile -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $rootSerialFile -Force -ErrorAction SilentlyContinue
}

Write-Host "C2PA signing identity created in $output"
Write-Host "The helper uses signing-private.pem and signing-cert.pem."
Write-Host "Keep signing-private.pem and signing-root-private.pem secret and offline-backed-up."
Write-Host "The private studio root is not on the public C2PA trust list; verification will identify it as self-managed."
