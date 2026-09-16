$envFile = Get-Content .env.local
foreach ($line in $envFile) { if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') { $n=$matches[1];$v=$matches[2].Trim().Trim('"').Trim("'");if($n -eq 'SUPABASE_URL' -or $n -eq 'SUPABASE_SERVICE_ROLE_KEY'){Set-Item "Env:$n" $v} } }
$h=@{apikey=$env:SUPABASE_SERVICE_ROLE_KEY;Authorization="Bearer $env:SUPABASE_SERVICE_ROLE_KEY";'Content-Type'='application/json';Prefer='return=representation'};$b="$env:SUPABASE_URL/rest/v1"
function Get-Api($uri){Invoke-RestMethod $uri -Headers $h}
function Post-Api($uri,$body){Invoke-RestMethod $uri -Headers $h -Method Post -Body ($body|ConvertTo-Json -Depth 8 -Compress)}
foreach($spec in @(
  @{p=51;head='Hemlata Murji Navdhare';mobile='9724157525';room='48818511-64b6-49b1-8775-fea6b90f4a7e';names=@('Parshotam Mudji Bhedakiya','Vasanta Parshotam Bhedakiya','Pradeep Mudji Bhedakiya','Surekha Pradeep Bhedakiya','Naresh Lalji Gilda')},
  @{p=52;head='Niki Rohit Navdhare';mobile='8849675425';room='43668f7b-9190-4d85-adee-c0f920b68049';names=@('Bhupendra Kantilal Mandan','Gunjan Bhupendra Mandan','Hetal Gunjan Mandan','Bhavna Mehul Mundada','Mehul Mundada')}
)) {
  $f=Get-Api "$b/families?select=id%2Chead_mobile%2Cstay_from%2Cstay_to&pothi_id=eq.$($spec.p)"|Select-Object -First 1
  if(!$f){throw "Pothi $($spec.p) family is missing."}
  $members=@(Get-Api "$b/members?select=id%2Cname&family_id=eq.$($f.id)&order=created_at.asc")
  foreach($member in $members){
    $exists=Get-Api "$b/room_allocations?select=id&member_id=eq.$($member.id)"|Select-Object -First 1
    if(!$exists){[void](Post-Api "$b/room_allocations" @{room_id=$spec.room;member_id=$member.id;family_id=$f.id})}
  }
  Write-Output "Pothi $($spec.p): $($members.Count) members assigned to room $($spec.room)."
}
