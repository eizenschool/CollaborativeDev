# Kelantan, one region only - same discipline as m6-ingest-johor.ps1
# (docs/MODULE6-API-SETUP.md §8):
#   1. Run -Step recon first. Free (maxDetails:0, dryRun:true) - no billing,
#      writes nothing.
#   2. Run -Step main with -MaxDetails set to the recon 'discovered' number.
#      This is the real, billed pass and writes to the database.
#   3. After -Step main, spot-check a few Kelantan rows' category in the
#      Table Editor against what the place actually is.
#   4. Do not run -Step main a second time just to see it work.
#
# Usage:
#   $env:SUPABASE_SECRET_KEY = "sb_secret_..."
#   .\scripts\m6-ingest-kelantan.ps1 -Step recon
#   .\scripts\m6-ingest-kelantan.ps1 -Step main -MaxDetails 20

param(
  [ValidateSet('recon', 'main')]
  [string]$Step = 'recon',
  [int]$MaxDetails = 20
)

$headers = @{
  apikey         = $env:SUPABASE_SECRET_KEY
  'Content-Type' = 'application/json'
}

$region = @{ id = 'kelantan'; state = 'Kelantan'; latitude = 6.1254; longitude = 102.2381; radiusMeters = 50000 }

$body = @{
  regions        = @($region)
  maxResultCount = 20
  maxDetails     = if ($Step -eq 'recon') { 0 } else { $MaxDetails }
  dryRun         = ($Step -eq 'recon')
} | ConvertTo-Json -Depth 5

Write-Host "Step: $Step  (maxDetails=$(if ($Step -eq 'recon') { 0 } else { $MaxDetails }), dryRun=$($Step -eq 'recon'))"

$response = Invoke-RestMethod `
  -Method Post `
  -Uri 'https://pnetstmovctfwqcumodx.supabase.co/functions/v1/m6-ingest' `
  -Headers $headers `
  -Body $body

$response | ConvertTo-Json -Depth 6

if ($Step -eq 'recon') {
  Write-Host ""
  Write-Host "Review the 'discovered' count above, then run:"
  Write-Host "  .\scripts\m6-ingest-kelantan.ps1 -Step main -MaxDetails <discovered, capped at 50>"
}
