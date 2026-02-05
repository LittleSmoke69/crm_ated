# Cache clean script for Next.js/Turbopack (Windows / PowerShell)
# Note: keep this file ASCII-only to avoid encoding/parser issues in Windows PowerShell.

Write-Host 'Cleaning Next.js cache...' -ForegroundColor Yellow

$pathsToRemove = @(
  '.next',
  'node_modules\.cache'
)

foreach ($p in $pathsToRemove) {
  if (Test-Path $p) {
    Remove-Item -Recurse -Force $p -ErrorAction SilentlyContinue
    Write-Host ("OK removed: {0}" -f $p) -ForegroundColor Green
  } else {
    Write-Host ("OK not found: {0}" -f $p) -ForegroundColor DarkGray
  }
}

# Remove Turbopack temp files
$tempPath = Join-Path $env:LOCALAPPDATA 'Temp'
Get-ChildItem -Path $tempPath -Filter 'next-panic-*.log' -ErrorAction SilentlyContinue |
  ForEach-Object { Remove-Item -Force $_.FullName -ErrorAction SilentlyContinue }

Write-Host ''
Write-Host "Done. Restart with 'npm run dev'." -ForegroundColor Green

