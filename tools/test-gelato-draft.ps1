# Creates ONE Gelato draft in USD. Never converts it to production; never retries.
param(
  [Parameter(Mandatory=$true)][string]$PrintFileUrl,
  [Parameter(Mandatory=$true)][string]$RecipientJsonFile,
  [string]$ProductUid = 'canvas_400x400-mm-16x16-inch_canvas_wood-fsc-thick_4-0_ver'
)
$ErrorActionPreference = 'Stop'
$uri = [uri]$PrintFileUrl
if ($uri.Scheme -ne 'https') { throw 'Use an HTTPS print-ready file URL accessible to Gelato.' }
$recipient = Get-Content -LiteralPath $RecipientJsonFile -Raw | ConvertFrom-Json
foreach ($field in @('firstName','lastName','addressLine1','city','state','postCode','country','email')) {
  if ([string]::IsNullOrWhiteSpace($recipient.$field) -or $recipient.$field -like '*REPLACE*') { throw "Fill in $field in the recipient file." }
}
if ($recipient.country -ne 'US') { throw 'This test supports US delivery addresses only.' }
$reference = 'PSS-DRAFT-' + [guid]::NewGuid().ToString()
$secret = Read-Host 'Gelato API key (hidden; used only for this test)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
  $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  $headers = @{ 'X-API-KEY' = $key }
  $item = @{itemReferenceId=$reference;productUid=$ProductUid;quantity=1;files=@(@{type='default';url=$PrintFileUrl})}
  $quoteBody = @{orderReferenceId=$reference;customerReferenceId='pixel-shroom-studio-admin-test';currency='USD';allowMultipleQuotes=$false;recipient=$recipient;products=@($item)}
  $quote = Invoke-RestMethod -Method Post -Uri 'https://order.gelatoapis.com/v4/orders:quote' -Headers $headers -ContentType 'application/json' -Body ($quoteBody | ConvertTo-Json -Depth 12)
  if (@($quote.quotes).Count -ne 1) { throw 'Expected one quote. No draft was created.' }
  $method = $quote.quotes[0].shipmentMethods | Where-Object { $_.currency -eq 'USD' -and $_.shipmentMethodUid } | Sort-Object { [decimal]$_.price } | Select-Object -First 1
  if (-not $method) { throw 'No USD shipping method returned. No draft was created.' }
  $body = @{orderType='draft';orderReferenceId=$reference;customerReferenceId='pixel-shroom-studio-admin-test';currency='USD';shippingAddress=$recipient;shipmentMethodUid=$method.shipmentMethodUid;items=@($item)}
  Write-Host "Creating DRAFT only. Reference: $reference"
  # Do not retry this request if it times out: check Gelato using the reference first.
  try {
    $order = Invoke-RestMethod -Method Post -Uri 'https://order.gelatoapis.com/v4/orders' -Headers $headers -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 12)
    $order | Select-Object id,orderReferenceId,orderType,currency,fulfillmentStatus | Format-List
    Write-Host 'Check this draft in Gelato Orders. Do not convert it to a production order during this test.'
  } catch {
    Write-Warning "Submission outcome may be uncertain. Check Gelato for $reference before trying again."
    throw
  }
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  $key = $null
  $headers = $null
  $secret = $null
}
