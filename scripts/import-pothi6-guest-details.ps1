$envFile = Get-Content .env.local
foreach ($line in $envFile) {
  if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
    $name = $matches[1]
    $value = $matches[2].Trim().Trim('"').Trim("'")
    if ($name -eq 'SUPABASE_URL' -or $name -eq 'SUPABASE_SERVICE_ROLE_KEY') { Set-Item -Path "Env:$name" -Value $value }
  }
}
$headers = @{ apikey = $env:SUPABASE_SERVICE_ROLE_KEY; Authorization = "Bearer $env:SUPABASE_SERVICE_ROLE_KEY"; 'Content-Type' = 'application/json'; Prefer = 'return=representation' }
$base = "${env:SUPABASE_URL}/rest/v1"
$familyId = $null
$memberIds = @()
$allocationIds = @()

function Api($method, $uri, $body = $null) {
  if ($null -eq $body) { return Invoke-RestMethod -Uri $uri -Headers $headers -Method $method -TimeoutSec 45 }
  return Invoke-RestMethod -Uri $uri -Headers $headers -Method $method -Body ($body | ConvertTo-Json -Depth 8 -Compress) -TimeoutSec 45
}

$guests = @(
  @{name='Manilal Narayandas Gingal'; age=75; gender='male'; mobile='9974973039'; group='pothi'},
  @{name='Nalini Manilal Gingal'; age=72; gender='female'; mobile=$null; group='pothi'},
  @{name='Shailesh Somchand Ladhad'; age=58; gender='male'; mobile='9341221902'; group='pothi'},
  @{name='Dhirti Shailesh Ladhad'; age=56; gender='female'; mobile=$null; group='pothi'},
  @{name='Virendra Bapalal Seth'; age=54; gender='male'; mobile='9820083185'; group='private'},
  @{name='Heena Virendra Seth'; age=52; gender='female'; mobile=$null; group='private'},
  @{name='Hetal Chetan Mall'; age=48; gender='female'; mobile='9033133411'; group='private'},
  @{name='Sheetal Bhavesh Karwa'; age=45; gender='female'; mobile='9029107371'; group='private'},
  @{name='Shewta Jenish Mall'; age=40; gender='female'; mobile=$null; group='private'},
  @{name='Jenish Javerilal Mall'; age=42; gender='male'; mobile=$null; group='private'},
  @{name='Javerilal Harilal Mall'; age=70; gender='male'; mobile=$null; group='private'},
  @{name='Indira Javerilal Mall'; age=65; gender='female'; mobile=$null; group='private'},
  @{name='Praghji Gopalji Mandan'; age=70; gender='male'; mobile=$null; group='private'},
  @{name='Nanda Rajesh Mandan'; age=53; gender='female'; mobile=$null; group='private'},
  @{name='Bharat Devkaran Savar'; age=69; gender='male'; mobile=$null; group='private'},
  @{name='Ritesh Shivji Mall'; age=41; gender='male'; mobile=$null; group='private'},
  @{name='Chunilal Haridas Bhutada'; age=78; gender='male'; mobile=$null; group='private'; head=$true},
  @{name='Rasilaben Chnilal Bhutada'; age=73; gender='female'; mobile=$null; group='private'},
  @{name='Deepak Haridas Bhutada'; age=63; gender='male'; mobile=$null; group='private'}
)

try {
  $pothi = Api Get "$base/pothis?select=id%2Cfamily_id%2Ccontact_mobile&id=eq.6" | Select-Object -First 1
  if ($pothi.family_id) { throw 'Pothi 6 already has a registration; no data was changed.' }
  $headMobile = if ($pothi.contact_mobile) { $pothi.contact_mobile } else { '9724519204' }
  $family = Api Post "$base/families" @{ head_name='Chunilal Haridas Bhutada'; head_mobile=$headMobile; city='Bhuj'; address='Imported Pothi 6 guest details'; wants_stay=$true; pothi_id=6; registration_type='pothi_room'; stay_from='2026-11-13'; stay_to='2026-11-20' } | Select-Object -First 1
  $familyId = $family.id
  [void](Api Patch "$base/pothis?id=eq.6&family_id=is.null" @{family_id=$familyId})
  $memberPayload = @()
  for ($i = 0; $i -lt $guests.Count; $i++) { $g=$guests[$i]; $memberPayload += @{family_id=$familyId; name=$g.name; age=$g.age; gender=$g.gender; mobile=$g.mobile; is_head=[bool]$g.head} }
  $members = @(Api Post "$base/members" $memberPayload)
  $memberIds = @($members | ForEach-Object { $_.id })
  $roomIds = @{}
  foreach ($source in @('402','403','404','405')) { $room = Api Get "$base/rooms?select=id%2Croom_number%2Ccapacity&linked_pothi_id=eq.6&source_room_number=eq.$source" | Select-Object -First 1; if (!$room) { throw "Room $source was not found." }; $roomIds[$source] = $room.id }
  $allocationPayload = @()
  for ($i = 0; $i -lt $memberIds.Count; $i++) { $source = if ($i -lt 4) { '405' } else { [string](402 + [math]::Floor(($i - 4) / 5)) }; $allocationPayload += @{room_id=$roomIds[$source]; member_id=$memberIds[$i]; family_id=$familyId} }
  $allocations = @(Api Post "$base/room_allocations" $allocationPayload)
  $allocationIds = @($allocations | ForEach-Object { $_.id })
  Write-Output ("Pothi 6 imported: 19 members; room 405 = 4; rooms 402/403/404 = 5 each; family " + $familyId)
} catch {
  if ($allocationIds.Count) { Api Delete "$base/room_allocations?id=in.($($allocationIds -join ','))" | Out-Null }
  if ($memberIds.Count) { Api Delete "$base/members?id=in.($($memberIds -join ','))" | Out-Null }
  if ($familyId) { Api Patch "$base/pothis?id=eq.6&family_id=eq.$familyId" @{family_id=$null} | Out-Null; Api Delete "$base/families?id=eq.$familyId" | Out-Null }
  throw
}
