import { handleOptions, json } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";

type MemberInput = { name?: string; age?: number; gender?: string; mobile?: string; isHead?: boolean };
type AddMemberInput = { familyId?: string; mobile?: string; verificationToken?: string; member?: MemberInput };

function normalizeMobile(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function describeError(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return "Could not add the member.";
}

function validGender(value: unknown) {
  return value === "male" || value === "female" || value === "other" ? value : null;
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  try {
    const body = (await req.json()) as AddMemberInput;
    const familyId = body.familyId?.trim();
    const mobile = normalizeMobile(body.mobile ?? "");
    const member = body.member;
    if (!familyId || !mobile || !body.verificationToken || !member?.name?.trim()) {
      return json({ error: "Verified family and member details are required." }, 400);
    }

    const age = Number(member.age);
    const gender = validGender(member.gender);
    if (!Number.isInteger(age) || age < 0 || age > 120 || !gender) {
      return json({ error: "Enter a valid member age and gender." }, 400);
    }

    const supabase = serviceClient();
    const { data: verification, error: verificationError } = await supabase
      .from("sms_otp_verifications")
      .select("verified_at, verification_token, mobile")
      .eq("mobile", mobile)
      .eq("verification_token", body.verificationToken)
      .maybeSingle();
    if (verificationError) throw verificationError;
    if (!verification?.verified_at) return json({ error: "Please verify the family mobile number with OTP first." }, 403);

    const { data: family, error: familyError } = await supabase
      .from("families")
      .select("id, head_mobile, registration_type, pothi_id, private_room_number")
      .eq("id", familyId)
      .maybeSingle();
    if (familyError) throw familyError;
    if (!family || normalizeMobile(family.head_mobile ?? "") !== mobile) {
      return json({ error: "This verified mobile cannot modify the selected registration." }, 403);
    }
    if (family.registration_type === "general_room") {
      return json({ error: "General guest registration is coming soon." }, 403);
    }

    const { data: existingMembers, error: membersError } = await supabase
      .from("members")
      .select("id, mobile")
      .eq("family_id", family.id);
    if (membersError) throw membersError;
    if ((existingMembers ?? []).some((entry) => normalizeMobile(entry.mobile ?? "") === normalizeMobile(member.mobile ?? ""))) {
      return json({ error: "This mobile number is already registered in this family." }, 409);
    }

    const roomQuery = supabase
      .from("rooms")
      .select("id, room_number, venue_name, section_name, floor, capacity, room_type, linked_pothi_id, owner_type, sort_order");
    let candidateRooms;
    if (family.registration_type === "pothi_room" && family.pothi_id) {
      const { data, error } = await roomQuery.eq("linked_pothi_id", family.pothi_id).order("sort_order", { ascending: true });
      if (error) throw error;
      candidateRooms = data ?? [];
    } else if (family.registration_type === "private_room" && family.private_room_number) {
      const { data, error } = await roomQuery.eq("room_number", family.private_room_number).limit(1);
      if (error) throw error;
      candidateRooms = data ?? [];
    } else {
      return json({ error: "No expandable room is linked to this registration." }, 409);
    }

    const roomIds = candidateRooms.map((room) => room.id);
    const { data: allocations, error: allocationsError } = await supabase
      .from("room_allocations")
      .select("room_id")
      .in("room_id", roomIds.length ? roomIds : ["00000000-0000-0000-0000-000000000000"]);
    if (allocationsError) throw allocationsError;
    const occupied = new Map<string, number>();
    for (const allocation of allocations ?? []) occupied.set(allocation.room_id, (occupied.get(allocation.room_id) ?? 0) + 1);

    const eligibleTypes = family.registration_type === "pothi_room" ? ["pothi_room", "private_room"] : ["private_room"];
    const target = candidateRooms.find((room) => eligibleTypes.includes(room.room_type) && (occupied.get(room.id) ?? 0) < room.capacity);
    if (!target) return json({ error: "All rooms linked to this registration are currently full." }, 409);

    const { data: insertedMember, error: memberError } = await supabase
      .from("members")
      .insert({
        family_id: family.id,
        name: member.name.trim(),
        age,
        gender,
        mobile: member.mobile ? normalizeMobile(member.mobile) : null,
        is_head: false
      })
      .select("id, name, age, gender, mobile, is_head, qr_token")
      .single();
    if (memberError) throw memberError;

    const { error: allocationError } = await supabase.from("room_allocations").insert({
      family_id: family.id,
      member_id: insertedMember.id,
      room_id: target.id
    });
    if (allocationError) {
      await supabase.from("members").delete().eq("id", insertedMember.id);
      throw allocationError;
    }

    return json({
      success: true,
      member: insertedMember,
      allocation: {
        member_id: insertedMember.id,
        member_name: insertedMember.name,
        room_number: target.room_number,
        venue_name: target.venue_name,
        section_name: target.section_name,
        floor: target.floor
      },
      remainingCapacity: target.capacity - (occupied.get(target.id) ?? 0) - 1
    });
  } catch (error) {
    return json({ error: describeError(error) }, 500);
  }
});
