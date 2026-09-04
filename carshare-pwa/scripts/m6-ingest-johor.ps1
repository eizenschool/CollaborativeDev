# Johor, one region only - following the same discipline
# docs/MODULE6-API-SETUP.md §8 and §6's Penang/Melaka/Selangor log used:
#   1. Record Nearby Search / Place Details usage in Google Cloud console
#      before running anything (so you can see exactly what this run cost).
#   2. Run -Step recon first. Free (maxDetails:0, dryRun:true) - no billing,
#      writes nothing. Read the discovered/category numbers it prints before
#      spending anything on Place Details.
#   3. Run -Step main. This is the real, billed pass: Nearby Search + up to
#      $MaxDetails Place Details calls, and it writes to the database.
#   4. After -Step main, open the Table Editor and spot-check a few Johor
#      rows' category against what the place actually is - Penang's run
#      found "nature" at zero because the default includedTypes let
#      restaurants take most of the slots; Johor's real type mix is unknown
#      until this runs.
#   5. Do not run -Step main a second time just to see it work. Automated
#      tests already cover this function with mocks; repeating a real run
#      spends real Details calls for nothing.
#
# Usage:
#   $env:SUPABASE_SECRET_KEY = "sb_secret_..."
#   .\scripts\m6-ingest-johor.ps1 -Step recon
#   .\scripts\m6-ingest-johor.ps1 -Step main -MaxDetails 20

param(
  [ValidateSet('recon', 'main')]
  [string]$Step = 'recon',
  [int]$MaxDetails = 20
)

$headers = @{
  apikey         = $env:SUPABASE_SECRET_KEY
  'Content-Type' = 'application/json'
}

$region = @{ id = 'johor'; state = 'Johor'; latitude = 1.4927; longitude = 103.7414; radiusMeters = 50000 }

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
  Write-Host "  .\scripts\m6-ingest-johor.ps1 -Step main -MaxDetails <discovered, capped at 50>"
}
