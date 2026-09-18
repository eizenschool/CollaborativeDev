# Free reconnaissance sweep (Nearby Search only, $0 cost) across the 10
# Malaysian states m6-ingest has never swept: Johor, Kelantan, Pahang, Perak,
# Perlis, Sabah, Sarawak, Terengganu, Labuan, Putrajaya. dryRun:true +
# maxDetails:0 makes no Place Details calls and writes nothing to the
# database - it only reports how many candidates each region's circle holds.
#
# Run from a PowerShell terminal that has GOOGLE_PLACES_SERVER_KEY already
# set on the deployed m6-ingest function, and SUPABASE_SECRET_KEY set locally
# in this terminal (never commit it, never put it in a VITE_ variable):
#
#   $env:SUPABASE_SECRET_KEY = "sb_secret_..."
#   .\scripts\m6-ingest-recon-remaining-states.ps1
#
# This is reconnaissance only. Do NOT raise maxDetails above 0 for all ten
# regions in a single call - maxDetails is one budget shared across every
# region in the request (m6-ingest/index.ts), so the regions later in the
# array would silently get zero Place Details once the earlier ones spent it.
# Real ingestion still has to run one region at a time, per
# docs/MODULE6-API-SETUP.md §8.

$headers = @{
  apikey         = $env:SUPABASE_SECRET_KEY
  'Content-Type' = 'application/json'
}

$body = @{
  regions = @(
    @{ id = 'johor';       state = 'Johor';          latitude = 1.4927; longitude = 103.7414; radiusMeters = 50000 }
    @{ id = 'kelantan';    state = 'Kelantan';        latitude = 6.1254; longitude = 102.2381; radiusMeters = 50000 }
    @{ id = 'pahang';      state = 'Pahang';          latitude = 3.8168; longitude = 103.3260; radiusMeters = 50000 }
    @{ id = 'perak';       state = 'Perak';           latitude = 4.5975; longitude = 101.0901; radiusMeters = 50000 }
    @{ id = 'perlis';      state = 'Perlis';          latitude = 6.4414; longitude = 100.1986; radiusMeters = 50000 }
    @{ id = 'sabah';       state = 'Sabah';           latitude = 5.9749; longitude = 116.0724; radiusMeters = 50000 }
    @{ id = 'sarawak';     state = 'Sarawak';         latitude = 1.5535; longitude = 110.3593; radiusMeters = 50000 }
    @{ id = 'terengganu';  state = 'Terengganu';      latitude = 5.3117; longitude = 103.1324; radiusMeters = 50000 }
    @{ id = 'labuan';      state = 'Labuan';          latitude = 5.2831; longitude = 115.2308; radiusMeters = 50000 }
    @{ id = 'putrajaya';   state = 'Putrajaya';       latitude = 2.9264; longitude = 101.6964; radiusMeters = 50000 }
  )
  maxResultCount = 20
  maxDetails     = 0
  dryRun         = $true
} | ConvertTo-Json -Depth 5

$response = Invoke-RestMethod `
  -Method Post `
  -Uri 'https://pnetstmovctfwqcumodx.supabase.co/functions/v1/m6-ingest' `
  -Headers $headers `
  -Body $body

$response | ConvertTo-Json -Depth 6
