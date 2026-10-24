$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$files = @(
    'EBAY-BUILD-INSTALL.txt',
    'docs\EBAY-LISTINGS.md',
    'docs\EBAY-LIVE-LISTINGS.md',
    'ebay-feed.mjs',
    'public\ebay-core.js',
    'public\ebay-listings.json',
    'public\ebay-store.css',
    'public\ebay-store.js',
    'tests\e2e\ebay.spec.js',
    'tests\ebay-fixture.mjs',
    'tests\unit\ebay-feed.test.js',
    'tests\unit\ebay.test.js',
    'tools\build-ebay-pages.mjs',
    'tools\ebay-catalog.mjs'
)
foreach ($relativePath in $files) {
    $targetPath = Join-Path $projectRoot $relativePath
    if (Test-Path -LiteralPath $targetPath -PathType Leaf) {
        Remove-Item -LiteralPath $targetPath -Force
        Write-Host ('Removed: ' + $relativePath)
    }
}
Write-Host 'Cleanup complete. Run npm.cmd ci, then npm.cmd run build and deploy.'
