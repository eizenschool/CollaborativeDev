# Sabah, one region only - same discipline as m6-ingest-johor.ps1
# (docs/MODULE6-API-SETUP.md §8). Usage:
#   $env:SUPABASE_SECRET_KEY = "sb_secret_..."
#   .\scripts\m6-ingest-sabah.ps1 -Step recon
#   .\scripts\m6-ingest-sabah.ps1 -Step main -MaxDetails 20

param(
  [ValidateSet('recon', 'main')]
  [string]$Step = 'recon',
  [int]$MaxDetails = 20
)

$headers = @{
  apikey         = $env:SUPABASE_SECRET_KEY
  'Content-Type' = 'application/json'
}

$region = @{ id = 'sabah'; state = 'Sabah'; latitude = 5.9749; longitude = 116.0724; radiusMeters = 50000 }

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
  Write-Host "  .\scripts\m6-ingest-sabah.ps1 -Step main -MaxDetails <discovered, capped at 50>"
}
