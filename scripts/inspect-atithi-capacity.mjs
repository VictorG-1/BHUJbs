import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
const env=(k)=>{const l=fs.readFileSync('.env.local','utf8').split(/\r?\n/).find(x=>x.startsWith(`${k}=`));return l.slice(k.length+1).trim().replace(/^['"]|['"]$/g,'')};
const s=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false}});
const {data:rooms,error}=await s.from('rooms').select('id,source_room_number,capacity,linked_pothi_id,room_number').ilike('room_number','%ATITHI%').eq('room_type','private_room').order('source_room_number'); if(error) throw error;
for(const room of rooms){const {data:alloc,error:e}=await s.from('room_allocations').select('id,family_id,member_id').eq('room_id',room.id);if(e)throw e;console.log(JSON.stringify({room:room.source_room_number,capacity:room.capacity,linkedPothi:room.linked_pothi_id,occupied:alloc.length,available:room.capacity-alloc.length}));}
