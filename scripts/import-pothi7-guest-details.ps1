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
  @{name='Deepak Haridas Bhutada'; age=63; gender='male'; head=$true},
  @{name='Damyanti Deepak Bhutada'; age=62; gender='female'},
  @{name='Nikunj Deepak Bhutada'; age=36; gender='male'},
  @{name='Komal Nikunj Bhutada'; age=33; gender='female'},
  @{name='Sonika Kalpesh Ladhad'; age=38; gender='female'},
  @{name='Javerben Ghanshyam Gingal'; age=0; gender='female'},
  @{name='Kishor Dharshi Bhedakiya'; age=65; gender='male'},
  @{name='Nikita Hiral Karva'; age=40; gender='female'},
  @{name='Hiral Nanalal Karwa'; age=40; gender='male'}
)

try {
  $pothi = Api Get "$base/pothis?select=id%2Cfamily_id%2Ccontact_mobile&id=eq.7" | Select-Object -First 1
  if (!$pothi) { throw 'Pothi 7 was not found.' }
  if ($pothi.family_id) { throw 'Pothi 7 already has a registration; no data was changed.' }

  $rooms = @(Api Get "$base/rooms?select=id%2Csource_room_number%2Croom_number%2Ccapacity%2Croom_type%2Clinked_pothi_id&linked_pothi_id=eq.7&order=room_type.desc%2Csource_room_number.asc")
  $pothiRoom = $rooms | Where-Object { $_.source_room_number -eq '406' -and $_.room_type -eq 'pothi_room' } | Select-Object -First 1
  $privateRooms = @($rooms | Where-Object { $_.room_type -eq 'private_room' } | Sort-Object source_room_number)
  if (!$pothiRoom) { throw 'Pothi room 406 was not found for Pothi 7.' }
  if ($privateRooms.Count -eq 0) { throw 'No private rooms are linked to Pothi 7.' }

  $headMobile = if ($pothi.contact_mobile) { $pothi.contact_mobile } else { '8000454549' }
  $family = Api Post "$base/families" @{ head_name='Deepak Haridas Bhutada'; head_mobile=$headMobile; city='Bhuj'; address='Imported Pothi 7 guest details'; wants_stay=$true; pothi_id=7; registration_type='pothi_room'; stay_from='2026-11-13'; stay_to='2026-11-20' } | Select-Object -First 1
  $familyId = $family.id
  [void](Api Patch "$base/pothis?id=eq.7&family_id=is.null" @{family_id=$familyId})

  $memberPayload = @()
  foreach ($g in $guests) {
    $memberPayload += @{family_id=$familyId; name=$g.name; age=$g.age; gender=$g.gender; mobile=$null; is_head=[bool]$g.head}
  }
  $members = @(Api Post "$base/members" $memberPayload)
  $memberIds = @($members | ForEach-Object { $_.id })

  $allocationPayload = @()
  $roomPlan = @()
  for ($i = 0; $i -lt $memberIds.Count; $i++) {
    if ($i -lt [int]$pothiRoom.capacity) {
      $room = $pothiRoom
    } else {
      $remainingIndex = $i - [int]$pothiRoom.capacity
      $running = 0
      $room = $null
      foreach ($candidate in $privateRooms) {
        if ($remainingIndex -lt ($running + [int]$candidate.capacity)) { $room = $candidate; break }
        $running += [int]$candidate.capacity
      }
      if (!$room) { throw 'Pothi 7 linked room capacity is not enough for all guests.' }
    }
    $roomPlan += $room.source_room_number
    $allocationPayload += @{room_id=$room.id; member_id=$memberIds[$i]; family_id=$familyId}
  }

  $allocations = @(Api Post "$base/room_allocations" $allocationPayload)
  $allocationIds = @($allocations | ForEach-Object { $_.id })
  Write-Output ("Pothi 7 imported: 9 members; room plan = " + (($roomPlan | Group-Object | ForEach-Object { "$($_.Name):$($_.Count)" }) -join ', ') + "; family " + $familyId)
} catch {
  if ($allocationIds.Count) { Api Delete "$base/room_allocations?id=in.($($allocationIds -join ','))" | Out-Null }
  if ($memberIds.Count) { Api Delete "$base/members?id=in.($($memberIds -join ','))" | Out-Null }
  if ($familyId) { Api Patch "$base/pothis?id=eq.7&family_id=eq.$familyId" @{family_id=$null} | Out-Null; Api Delete "$base/families?id=eq.$familyId" | Out-Null }
  throw
}
