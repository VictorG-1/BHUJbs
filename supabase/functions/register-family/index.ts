import { handleOptions, json } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { sendWhatsApp } from "../_shared/whatsapp.ts";

type MemberInput = {
  name: string;
  age: number;
  gender: "male" | "female" | "other";
  mobile?: string;
  isHead?: boolean;
};

type RegisterInput = {
  headName: string;
  headMobile: string;
  city?: string;
  address?: string;
  verificationToken?: string;
  registrationType: "pothi_room" | "private_room" | "general_room";
  pothiId?: number;
  relatedPothiId?: number;
  privateRoomNumber?: string;
  members: MemberInput[];
};

type RoomRow = {
  id: string;
  room_number: string;
  venue_name: string | null;
  section_name: string | null;
  floor: string | null;
  capacity: number | null;
  sort_order: number | null;
};

type PendingAllocation = {
  memberIndex: number;
  roomId: string;
  roomNumber: string;
  venueName: string | null;
  sectionName: string | null;
  floor: string | null;
};

function normalizeFloor(floor: string | null) {
  const value = (floor ?? "").trim().toUpperCase();
  if (value === "G.F.") return "ground";
  if (value === "F.F.") return "first";
  if (value === "S.F.") return "second";
  return "other";
}

function floorRank(floor: string | null, preferGround: boolean) {
  const normalized = normalizeFloor(floor);
  if (preferGround) {
    if (normalized === "ground") return 0;
    if (normalized === "first") return 1;
    if (normalized === "second") return 2;
    return 3;
  }

  if (normalized === "first") return 0;
  if (normalized === "ground") return 1;
  if (normalized === "second") return 2;
  return 3;
}

function roomCapacity(room: Pick<RoomRow, "capacity">) {
  const value = Number(room.capacity ?? 4);
  if (!Number.isFinite(value) || value <= 0) return 4;
  return Math.max(1, Math.min(value, 4));
}

function normalizeMobile(mobile: string) {
  return mobile.replace(/\D/g, "");
}

function fullRoomCapacity(room: Pick<RoomRow, "capacity">) {
  const value = Number(room.capacity ?? 4);
  if (!Number.isFinite(value) || value <= 0) return 4;
  return Math.max(1, value);
}

function planPrivateRoomAllocations(
  privateRooms: RoomRow[],
  members: MemberInput[],
  startingMemberIndex: number
) {
  const plan: PendingAllocation[] = [];
  let cursor = 0;

  for (const room of privateRooms) {
    const roomSlots = fullRoomCapacity(room);
    for (let count = 0; count < roomSlots && cursor < members.length; count += 1) {
      plan.push({
        memberIndex: startingMemberIndex + cursor,
        roomId: room.id,
        roomNumber: room.room_number,
        venueName: room.venue_name,
        sectionName: room.section_name,
        floor: room.floor
      });
      cursor += 1;
    }
  }

  if (cursor < members.length) {
    const totalCapacity = privateRooms.reduce((sum, room) => sum + fullRoomCapacity(room), 0);
    throw new Error(
      `Only ${totalCapacity} private-room seats are available for this pothi holder, but ${members.length} additional guests were entered.`
    );
  }

  return plan;
}

async function planGeneralRoomAllocations(
  supabase: ReturnType<typeof serviceClient>,
  familyMembers: MemberInput[]
) {
  const { data: rooms, error: roomsError } = await supabase
    .from("rooms")
    .select("id, room_number, venue_name, section_name, floor, capacity, sort_order")
    .eq("room_type", "general_room")
    .eq("owner_type", "SAMAJ")
    .order("sort_order", { ascending: true });

  if (roomsError) throw roomsError;
  if (!rooms?.length) {
    throw new Error("General rooms are not available in the imported inventory.");
  }

  const roomRows = rooms as RoomRow[];
  const roomIds = roomRows.map((room) => room.id);
  const occupancy = new Map<string, { count: number; genders: Set<string> }>();

  if (roomIds.length) {
    const { data: allocations, error: allocationsError } = await supabase
      .from("room_allocations")
      .select("room_id, members(gender)")
      .in("room_id", roomIds);

    if (allocationsError) throw allocationsError;

    for (const allocation of allocations ?? []) {
      const roomId = allocation.room_id as string;
      const state = occupancy.get(roomId) ?? { count: 0, genders: new Set<string>() };
      state.count += 1;
      const memberGender =
        allocation.members && !Array.isArray(allocation.members)
          ? (allocation.members.gender as string | undefined)
          : undefined;
      if (memberGender) state.genders.add(memberGender);
      occupancy.set(roomId, state);
    }
  }

  const groups = new Map<string, Array<{ member: MemberInput; memberIndex: number }>>();
  familyMembers.forEach((member, memberIndex) => {
    const key = member.gender;
    const bucket = groups.get(key) ?? [];
    bucket.push({ member, memberIndex });
    groups.set(key, bucket);
  });

  const plan: PendingAllocation[] = [];

  for (const [gender, groupMembers] of groups.entries()) {
    const remaining = [...groupMembers].sort((left, right) => {
      const leftSenior = left.member.age > 70 ? 1 : 0;
      const rightSenior = right.member.age > 70 ? 1 : 0;
      return rightSenior - leftSenior;
    });

    while (remaining.length) {
      const preferGround = remaining[0].member.age > 70;
      const candidates = roomRows
        .map((room) => {
          const state = occupancy.get(room.id) ?? { count: 0, genders: new Set<string>() };
          const remainingSlots = roomCapacity(room) - state.count;
          const canUse =
            remainingSlots > 0 &&
            (state.genders.size === 0 || (state.genders.size === 1 && state.genders.has(gender)));

          return {
            room,
            state,
            remainingSlots,
            canUse,
            canFitWhole: remainingSlots >= remaining.length,
            isEmpty: state.count === 0,
            rank: floorRank(room.floor, preferGround)
          };
        })
        .filter((candidate) => candidate.canUse)
        .sort((left, right) => {
          if (left.canFitWhole !== right.canFitWhole) return left.canFitWhole ? -1 : 1;
          if (left.isEmpty !== right.isEmpty) return left.isEmpty ? -1 : 1;
          if (left.rank !== right.rank) return left.rank - right.rank;
          if (left.remainingSlots !== right.remainingSlots) return left.remainingSlots - right.remainingSlots;
          return (left.room.sort_order ?? 9999) - (right.room.sort_order ?? 9999);
        });

      const selected = candidates[0];
      if (!selected) {
        throw new Error(`No ${gender} general room is available for the remaining guests.`);
      }

      const allocationCount = Math.min(selected.remainingSlots, remaining.length);
      const assignedMembers = remaining.splice(0, allocationCount);
      const nextState = occupancy.get(selected.room.id) ?? { count: 0, genders: new Set<string>() };
      nextState.genders.add(gender);
      nextState.count += assignedMembers.length;
      occupancy.set(selected.room.id, nextState);

      for (const assigned of assignedMembers) {
        plan.push({
          memberIndex: assigned.memberIndex,
          roomId: selected.room.id,
          roomNumber: selected.room.room_number,
          venueName: selected.room.venue_name,
          sectionName: selected.room.section_name,
          floor: selected.room.floor
        });
      }
    }
  }

  return plan;
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  try {
    const body = (await req.json()) as RegisterInput;
    if (!body.headName || !body.headMobile || !body.registrationType || !body.members?.length) {
      return json({ error: "Name, mobile, registration type and members are required." }, 400);
    }

    const filledMembers = body.members.filter((member) => member.name.trim());
    if (!filledMembers.length) {
      return json({ error: "Please add at least one member before submitting." }, 400);
    }
    if (body.registrationType === "pothi_room" && filledMembers.length < 4) {
      return json({ error: "Pothi Yajman registration needs 4 members for the allotted pothi room." }, 400);
    }

    const supabase = serviceClient();
    const normalizedMobile = normalizeMobile(body.headMobile);

    if (body.registrationType === "pothi_room" || body.registrationType === "general_room") {
      if (!body.verificationToken) {
        return json({ error: "Please verify your mobile number with OTP before registering." }, 403);
      }

      const { data: otpVerification, error: otpError } = await supabase
        .from("sms_otp_verifications")
        .select("id, mobile, verified_at, consumed_at, verification_token")
        .eq("mobile", normalizedMobile)
        .eq("verification_token", body.verificationToken)
        .maybeSingle();

      if (otpError) throw otpError;
      if (!otpVerification || !otpVerification.verified_at || otpVerification.consumed_at) {
        return json({ error: "Please verify your mobile number with OTP before registering." }, 403);
      }
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    let authUserId: string | null = null;

    if (token) {
      const { data: authData, error: authError } = await supabase.auth.getUser(token);
      if (!authError && authData.user) {
        if (authData.user.phone && normalizeMobile(authData.user.phone) !== normalizedMobile) {
          return json({ error: "Verified mobile does not match the registration mobile." }, 403);
        }

        authUserId = authData.user.id;

        const { data: existingFamily, error: existingError } = await supabase
          .from("families")
          .select("id, registration_code")
          .eq("auth_user_id", authUserId)
          .maybeSingle();

        if (existingError) throw existingError;
        if (existingFamily) {
          return json({ error: `This mobile number is already registered. Family code: ${existingFamily.registration_code}.` }, 409);
        }
      }
    }

    const { data: mobileMatchedFamily, error: mobileMatchError } = await supabase
      .from("families")
      .select("id, registration_code")
      .eq("head_mobile", body.headMobile)
      .maybeSingle();

    if (mobileMatchError) throw mobileMatchError;
    if (mobileMatchedFamily) {
      return json({ error: `This registration is already done. Family code: ${mobileMatchedFamily.registration_code}.` }, 409);
    }

    let pothiId: number | null = null;
    let referencePothiId: number | null = null;
    let privateRoomNumber: string | null = null;
    let roomId: string | null = null;
    let roomPayload: Record<string, unknown> | null = null;
    let primaryRoomNumber: string | null = null;
    let plannedAllocations: PendingAllocation[] = [];

    if (body.registrationType === "pothi_room") {
      if (!body.pothiId) return json({ error: "No Pothi Yajman mapping was found for this mobile number." }, 400);

      const { data: pothi, error: pothiError } = await supabase
        .from("pothis")
        .select("id, family_id, primary_holder_name, contact_mobile")
        .eq("id", body.pothiId)
        .maybeSingle();

      if (pothiError) throw pothiError;
      if (!pothi || pothi.family_id) return json({ error: "Selected pothi is no longer available." }, 409);
      if (normalizeMobile(pothi.contact_mobile ?? "") !== normalizedMobile) {
        return json({ error: "This mobile number does not match the mapped Pothi Yajman contact." }, 403);
      }

      pothiId = body.pothiId;

      const { data: seededRooms, error: seededRoomError } = await supabase
        .from("rooms")
        .select("id, room_number, venue_name, section_name, floor, capacity, sort_order")
        .eq("linked_pothi_id", body.pothiId)
        .eq("owner_type", "SAMAJ")
        .order("sort_order", { ascending: true })
        .limit(1);

      if (seededRoomError) throw seededRoomError;

      const seededRoom = seededRooms?.[0];
      const pothiRoomMembers = filledMembers.slice(0, 4);
      const extraPrivateMembers = filledMembers.slice(4);

      if (seededRoom) {
        roomId = seededRoom.id;
        primaryRoomNumber = seededRoom.room_number;
        plannedAllocations = pothiRoomMembers.map((_member, memberIndex) => ({
          memberIndex,
          roomId: seededRoom.id,
          roomNumber: seededRoom.room_number,
          venueName: seededRoom.venue_name,
          sectionName: seededRoom.section_name,
          floor: seededRoom.floor
        }));

        if (extraPrivateMembers.length) {
          const { data: privateRooms, error: privateRoomsError } = await supabase
            .from("rooms")
            .select("id, room_number, venue_name, section_name, floor, capacity, sort_order")
            .eq("linked_pothi_id", body.pothiId)
            .eq("owner_type", "PRIVATE")
            .order("sort_order", { ascending: true });

          if (privateRoomsError) throw privateRoomsError;
          if (!privateRooms?.length) {
            return json({ error: "This pothi holder does not have linked private rooms for additional guests." }, 400);
          }

          plannedAllocations.push(...planPrivateRoomAllocations(privateRooms as RoomRow[], extraPrivateMembers, 4));
        }
      } else {
        primaryRoomNumber = `POTHI-${String(body.pothiId).padStart(2, "0")}`;
        roomPayload = {
          room_number: primaryRoomNumber,
          room_type: body.registrationType,
          venue_name: "To Be Assigned",
          section_name: "Pending Allotment",
          source_room_number: String(body.pothiId),
          owner_type: "SAMAJ",
          linked_pothi_id: body.pothiId,
          allotment_note: pothi.primary_holder_name ?? null,
          sort_order: 9999,
          capacity: 4
        };
      }
    } else {
      if (body.registrationType === "private_room" && !body.relatedPothiId) {
        return json({ error: "Please select the related pothi holder." }, 400);
      }

      if (body.relatedPothiId) {
        const { data: linkedPothi, error: linkedPothiError } = await supabase
          .from("pothis")
          .select("id")
          .eq("id", body.relatedPothiId)
          .maybeSingle();

        if (linkedPothiError) throw linkedPothiError;
        if (!linkedPothi) return json({ error: "Linked pothi was not found." }, 404);
        referencePothiId = body.relatedPothiId;
      }

      if (body.registrationType === "private_room") {
        if (!body.privateRoomNumber?.trim()) {
          return json({ error: "Please select the booked private room." }, 400);
        }

        privateRoomNumber = body.privateRoomNumber.trim();
        primaryRoomNumber = privateRoomNumber;

        const { data: bookedRoom, error: bookedRoomError } = await supabase
          .from("rooms")
          .select("id, room_number, venue_name, section_name, floor, linked_pothi_id, owner_type")
          .eq("room_number", primaryRoomNumber)
          .maybeSingle();

        if (bookedRoomError) throw bookedRoomError;

        if (bookedRoom) {
          if (bookedRoom.owner_type !== "PRIVATE" || bookedRoom.linked_pothi_id !== body.relatedPothiId) {
            return json({ error: `Room ${primaryRoomNumber} is not available for this pothi holder.` }, 409);
          }
          roomId = bookedRoom.id;
          plannedAllocations = filledMembers.map((_member, memberIndex) => ({
            memberIndex,
            roomId: bookedRoom.id,
            roomNumber: bookedRoom.room_number,
            venueName: bookedRoom.venue_name,
            sectionName: bookedRoom.section_name,
            floor: bookedRoom.floor
          }));
        } else {
          roomPayload = {
            room_number: primaryRoomNumber,
            room_type: body.registrationType,
            venue_name: "Private Booking",
            section_name: "Imported Later",
            source_room_number: primaryRoomNumber,
            owner_type: "PRIVATE",
            linked_pothi_id: body.relatedPothiId,
            allotment_note: body.headName,
            sort_order: 9999,
            capacity: 4
          };
        }
      } else {
        plannedAllocations = await planGeneralRoomAllocations(supabase, filledMembers);
        const uniqueRooms = [...new Set(plannedAllocations.map((allocation) => allocation.roomNumber))];
        primaryRoomNumber = uniqueRooms.length === 1 ? uniqueRooms[0] : `${uniqueRooms.length} rooms assigned`;
      }
    }

    const { data: family, error: familyError } = await supabase
      .from("families")
      .insert({
        auth_user_id: authUserId,
        head_name: body.headName,
        head_mobile: body.headMobile,
        city: body.city ?? null,
        address: body.address ?? null,
        wants_stay: true,
        pothi_id: pothiId,
        reference_pothi_id: referencePothiId,
        private_room_number: privateRoomNumber,
        registration_type: body.registrationType
      })
      .select("id, registration_code, registration_type")
      .single();

    if (familyError) throw familyError;

    const normalizedMembers = filledMembers.map((member, index) => ({
      family_id: family.id,
      name: member.name,
      age: member.age,
      gender: member.gender,
      mobile: member.mobile || (index === 0 ? normalizedMobile : null),
      is_head: Boolean(member.isHead) || index === 0
    }));

    const { data: members, error: memberError } = await supabase
      .from("members")
      .insert(normalizedMembers)
      .select("id, name");

    if (memberError) throw memberError;

    if (pothiId) {
      const { error: updatePothiError } = await supabase
        .from("pothis")
        .update({ family_id: family.id, locked_at: new Date().toISOString() })
        .eq("id", pothiId)
        .is("family_id", null);

      if (updatePothiError) throw updatePothiError;
    }

    if (!roomId && roomPayload) {
      const { data: room, error: roomError } = await supabase
        .from("rooms")
        .insert(roomPayload)
        .select("id, room_number, venue_name, section_name, floor")
        .single();

      if (roomError) throw roomError;
      roomId = room.id;
      primaryRoomNumber = room.room_number;
      plannedAllocations = filledMembers.map((_member, memberIndex) => ({
        memberIndex,
        roomId: room.id,
        roomNumber: room.room_number,
        venueName: room.venue_name,
        sectionName: room.section_name,
        floor: room.floor
      }));
    }

    if (!plannedAllocations.length) {
      return json({ error: "Room allocation could not be prepared for this registration." }, 500);
    }

    const { error: allocationError } = await supabase.from("room_allocations").insert(
      plannedAllocations.map((allocation) => ({
        room_id: allocation.roomId,
        member_id: members[allocation.memberIndex].id,
        family_id: family.id
      }))
    );

    if (allocationError) throw allocationError;

    if (
      body.verificationToken &&
      (body.registrationType === "pothi_room" || body.registrationType === "general_room")
    ) {
      const { error: consumeOtpError } = await supabase
        .from("sms_otp_verifications")
        .update({ consumed_at: new Date().toISOString() })
        .eq("mobile", normalizedMobile)
        .eq("verification_token", body.verificationToken);

      if (consumeOtpError) throw consumeOtpError;
    }

    const responseAllocations = plannedAllocations.map((allocation) => ({
      member_id: members[allocation.memberIndex].id,
      member_name: members[allocation.memberIndex].name,
      room_number: allocation.roomNumber,
      venue_name: allocation.venueName,
      section_name: allocation.sectionName,
      floor: allocation.floor
    }));

    const uniqueRooms = [...new Set(responseAllocations.map((allocation) => allocation.room_number))];
    const roomMessage =
      uniqueRooms.length === 1 ? uniqueRooms[0] : `${uniqueRooms.length} rooms assigned`;
    const message = `Jai Shree Krishna. Registration confirmed for Bhagwat Saptah. Code: ${family.registration_code}. Room: ${roomMessage}.`;
    const notification = {
      family_id: family.id,
      mobile: body.headMobile,
      template_name: "registration_confirmation",
      payload: { message, pothiId, referencePothiId, roomNumber: roomMessage }
    };

    const { data: queued } = await supabase.from("whatsapp_notifications").insert(notification).select("id").single();

    try {
      const result = await sendWhatsApp({ mobile: body.headMobile, message });
      if (queued?.id) {
        await supabase
          .from("whatsapp_notifications")
          .update({ status: "sent", provider_message_id: result.id, sent_at: new Date().toISOString() })
          .eq("id", queued.id);
      }
    } catch (error) {
      if (queued?.id) {
        await supabase
          .from("whatsapp_notifications")
          .update({ status: "failed", error: error instanceof Error ? error.message : String(error) })
          .eq("id", queued.id);
      }
    }

    return json({
      family: {
        ...family,
        room_number: primaryRoomNumber
      },
      members,
      allocations: responseAllocations
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Registration failed." }, 500);
  }
});
