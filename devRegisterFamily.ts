import type { SupabaseClient } from "@supabase/supabase-js";

type MemberInput = {
  name: string;
  age: number;
  gender: "male" | "female" | "other";
  mobile?: string;
  isHead?: boolean;
};

export type RegisterInput = {
  headName: string;
  headMobile: string;
  city?: string;
  address?: string;
  verificationToken?: string;
  registrationType: "pothi_room" | "private_room" | "general_room";
  pothiId?: number;
  relatedPothiId?: number;
  privateRoomNumber?: string;
  stayFrom: string;
  stayTo: string;
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

type RegisterSuccess = {
  family: Record<string, unknown>;
  members: Array<{ id: string; name: string }>;
  allocations: Array<Record<string, unknown>>;
};

const EVENT_START_DATE = "2026-11-13";
const EVENT_END_DATE = "2026-11-20";

function describeError(error: unknown, fallback = "Registration failed.") {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (error && typeof error === "object") {
    const value = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const message = typeof value.message === "string" ? value.message.trim() : "";
    const details = typeof value.details === "string" ? value.details.trim() : "";
    const hint = typeof value.hint === "string" ? value.hint.trim() : "";
    const parts = [message, details, hint].filter(Boolean);
    if (parts.length) return parts.join(" ");
    if (typeof value.code === "string" && value.code.trim()) return `Database error ${value.code.trim()}.`;
  }
  return fallback;
}

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

async function planGeneralRoomAllocations(supabase: SupabaseClient, familyMembers: MemberInput[]) {
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

export async function registerFamilyDev(
  body: RegisterInput,
  supabase: SupabaseClient
): Promise<{ ok: true; data: RegisterSuccess } | { ok: false; status: number; error: string }> {
  try {
    if (!body.headName || !body.headMobile || !body.registrationType || !body.members?.length || !body.stayFrom || !body.stayTo) {
      return { ok: false, status: 400, error: "Name, mobile, stay dates, registration type and members are required." };
    }
    if (body.stayFrom < EVENT_START_DATE || body.stayTo > EVENT_END_DATE || body.stayTo < body.stayFrom) {
      return { ok: false, status: 400, error: "Stay dates must be between 13 November 2026 and 20 November 2026." };
    }

    const filledMembers = body.members.filter((member) => member.name.trim());
    if (!filledMembers.length) {
      return { ok: false, status: 400, error: "Please add at least one member before submitting." };
    }
    if (body.registrationType === "pothi_room" && filledMembers.length < 4) {
      return { ok: false, status: 400, error: "Pothi Yajman registration needs 4 members for the allotted pothi room." };
    }

    const normalizedMobile = normalizeMobile(body.headMobile);

    if (body.registrationType === "pothi_room" || body.registrationType === "general_room") {
      if (!body.verificationToken) {
        return { ok: false, status: 403, error: "Please verify your mobile number with OTP before registering." };
      }

      const { data: otpVerification, error: otpError } = await supabase
        .from("sms_otp_verifications")
        .select("id, mobile, verified_at, consumed_at, verification_token")
        .eq("mobile", normalizedMobile)
        .eq("verification_token", body.verificationToken)
        .maybeSingle();

      if (otpError) throw otpError;
      if (!otpVerification || !otpVerification.verified_at || otpVerification.consumed_at) {
        return { ok: false, status: 403, error: "Please verify your mobile number with OTP before registering." };
      }
    }

    const { data: mobileMatchedFamily, error: mobileMatchError } = await supabase
      .from("families")
      .select("id, registration_code, head_mobile")
      .or(`head_mobile.eq.${body.headMobile},head_mobile.eq.${normalizedMobile}`)
      .maybeSingle();

    if (mobileMatchError) throw mobileMatchError;
    if (mobileMatchedFamily) {
      return {
        ok: false,
        status: 409,
        error: `This registration is already done. Family code: ${mobileMatchedFamily.registration_code}.`
      };
    }

    let pothiId: number | null = null;
    let referencePothiId: number | null = null;
    let privateRoomNumber: string | null = null;
    let roomId: string | null = null;
    let roomPayload: Record<string, unknown> | null = null;
    let primaryRoomNumber: string | null = null;
    let plannedAllocations: PendingAllocation[] = [];

    if (body.registrationType === "pothi_room") {
      if (!body.pothiId) {
        return { ok: false, status: 400, error: "No Pothi Yajman mapping was found for this mobile number." };
      }

      const { data: pothi, error: pothiError } = await supabase
        .from("pothis")
        .select("id, family_id, primary_holder_name, contact_mobile")
        .eq("id", body.pothiId)
        .maybeSingle();

      if (pothiError) throw pothiError;
      if (!pothi || pothi.family_id) {
        return { ok: false, status: 409, error: "Selected pothi is no longer available." };
      }
      if (normalizeMobile(pothi.contact_mobile ?? "") !== normalizedMobile) {
        return { ok: false, status: 403, error: "This mobile number does not match the mapped Pothi Yajman contact." };
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
            return {
              ok: false,
              status: 400,
              error: "This pothi holder does not have linked private rooms for additional guests."
            };
          }

          plannedAllocations.push(
            ...planPrivateRoomAllocations(privateRooms as RoomRow[], extraPrivateMembers, 4)
          );
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
    } else if (body.registrationType === "private_room") {
      if (!body.relatedPothiId) {
        return { ok: false, status: 400, error: "Please select the related pothi holder." };
      }

      referencePothiId = body.relatedPothiId;
      if (!body.privateRoomNumber?.trim()) {
        return { ok: false, status: 400, error: "Please select the booked private room." };
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
          return {
            ok: false,
            status: 409,
            error: `Room ${primaryRoomNumber} is not available for this pothi holder.`
          };
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

    const { data: family, error: familyError } = await supabase
      .from("families")
      .insert({
        auth_user_id: null,
        head_name: body.headName,
        head_mobile: body.headMobile,
        city: body.city ?? null,
        address: body.address ?? null,
        wants_stay: true,
        pothi_id: pothiId,
        reference_pothi_id: referencePothiId,
        private_room_number: privateRoomNumber,
        registration_type: body.registrationType,
        stay_from: body.stayFrom,
        stay_to: body.stayTo
      })
      .select("id, registration_code, registration_type, stay_from, stay_to")
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
      return { ok: false, status: 500, error: "Room allocation could not be prepared for this registration." };
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

    return {
      ok: true,
      data: {
        family: {
          ...family,
          room_number: primaryRoomNumber
        },
        members,
        allocations: responseAllocations
      }
    };
  } catch (error) {
    return {
      ok: false,
      status: 500,
      error: describeError(error)
    };
  }
}
