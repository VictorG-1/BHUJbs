$envFile = Get-Content .env.local
foreach ($line in $envFile) {
  if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
    $name = $matches[1]; $value = $matches[2].Trim().Trim('"').Trim("'")
    if ($name -eq 'SUPABASE_URL' -or $name -eq 'SUPABASE_SERVICE_ROLE_KEY') { Set-Item -Path "Env:$name" -Value $value }
  }
}
$headers = @{ apikey = $env:SUPABASE_SERVICE_ROLE_KEY; Authorization = "Bearer $env:SUPABASE_SERVICE_ROLE_KEY"; 'Content-Type' = 'application/json'; Prefer = 'return=representation' }
$base = "${env:SUPABASE_URL}/rest/v1"
function Api($method, $uri, $body = $null) {
  try {
    if ($null -eq $body) { return Invoke-RestMethod -Uri $uri -Headers $headers -Method $method -TimeoutSec 45 }
    return Invoke-RestMethod -Uri $uri -Headers $headers -Method $method -Body ($body | ConvertTo-Json -Depth 8 -Compress) -TimeoutSec 45
  } catch {
    $response = $_.Exception.Response
    if ($response) { $reader = New-Object System.IO.StreamReader($response.GetResponseStream()); $detail=$reader.ReadToEnd(); throw "Supabase request failed ($method $uri): $detail" }
    throw
  }
}
$groups = @(
  @{ pothi = 51; head = 'Hemlata Murji Navdhare'; mobile = '9724157525'; room = '903'; guests = @(
    @{name='Parshotam Mudji Bhedakiya'; age=75; gender='male'; mobile='8779577075'},
    @{name='Vasanta Parshotam Bhedakiya'; age=73; gender='female'; mobile='8779577075'},
    @{name='Pradeep Mudji Bhedakiya'; age=65; gender='male'; mobile='9664234184'},
    @{name='Surekha Pradeep Bhedakiya'; age=63; gender='female'; mobile='9664234184'},
    @{name='Naresh Lalji Gilda'; age=51; gender='male'; mobile='8080554545'}) },
  @{ pothi = 52; head = 'Niki Rohit Navdhare'; mobile = '8849675425'; room = '904'; guests = @(
    @{name='Bhupendra Kantilal Mandan'; age=68; gender='male'; mobile='9773243827'},
    @{name='Gunjan Bhupendra Mandan'; age=40; gender='female'; mobile='9825448052'},
    @{name='Hetal Gunjan Mandan'; age=40; gender='female'; mobile='9773158132'},
    @{name='Bhavna Mehul Mundada'; age=45; gender='female'; mobile='7984878843'},
    @{name='Mehul Mundada'; age=45; gender='male'; mobile='9374695952'}) }
)
foreach ($group in $groups) {
  $pothi = Api Get "$base/pothis?select=id%2Cfamily_id&id=eq.$($group.pothi)" | Select-Object -First 1
  if (!$pothi) { throw "Pothi $($group.pothi) was not found." }
  if ($pothi.family_id) { throw "Pothi $($group.pothi) already has a registration; no data was changed." }
  $room = Api Get "$base/rooms?select=id%2Ccapacity%2Croom_number&linked_pothi_id=eq.$($group.pothi)&source_room_number=eq.$($group.room)&room_type=eq.pothi_room" | Select-Object -First 1
  if (!$room) { throw "Pothi $($group.pothi) room $($group.room) was not found." }
  if ([int]$room.capacity -lt $group.guests.Count) { throw "Room $($group.room) capacity is insufficient." }
  $roomId = [string]$room.id
  $family = Api Post "$base/families" @{head_name=$group.head; head_mobile=$group.mobile; city='Bhuj'; address="Imported Pothi $($group.pothi) guest details"; wants_stay=$true; pothi_id=$group.pothi; registration_type='pothi_room'; stay_from='2026-11-13'; stay_to='2026-11-20'} | Select-Object -First 1
  [void](Api Patch "$base/pothis?id=eq.$($group.pothi)&family_id=is.null" @{family_id=$family.id})
  $payload = @(); for ($i = 0; $i -lt $group.guests.Count; $i++) { $g=$group.guests[$i]; $payload += @{family_id=$family.id; name=$g.name; age=$g.age; gender=$g.gender; mobile=$g.mobile; is_head=($i -eq 0)} }
  $members = @(Api Post "$base/members" $payload)
  $allocations = @(); foreach ($member in $members) { $allocations += @{room_id=$roomId; member_id=$member.id; family_id=$family.id} }
  [void](Api Post "$base/room_allocations" $allocations)
  Write-Output "Pothi $($group.pothi) updated: $($members.Count) members -> room $($group.room); family $($family.id)"
}
