import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import type { AdminMemberRow, Gender, RegistrationType, RoomInventory } from "../lib/types";
import { shortRoom, shortVenue } from "../lib/venueLabels";

type Language = "en" | "gu";

type GuestDraft = {
  memberId: string | null;
  familyId: string | null;
  name: string;
  age: string;
  gender: Gender;
  mobile: string;
  arrivalDate: string;
  departureDate: string;
  isHead: boolean;
  headName: string;
  headMobile: string;
  city: string;
  registrationType: RegistrationType;
  wantsStay: boolean;
  stayFrom: string;
  stayTo: string;
  privateRoomNumber: string;
  pothiId: string;
  roomId: string;
};

const EVENT_START = "2026-11-13";
const EVENT_END = "2026-11-20";

const emptyDraft = (): GuestDraft => ({
  memberId: null,
  familyId: null,
  name: "",
  age: "18",
  gender: "male",
  mobile: "",
  arrivalDate: EVENT_START,
  departureDate: EVENT_END,
  isHead: true,
  headName: "",
  headMobile: "",
  city: "",
  registrationType: "general_room",
  wantsStay: false,
  stayFrom: EVENT_START,
  stayTo: EVENT_END,
  privateRoomNumber: "",
  pothiId: "",
  roomId: ""
});

function draftFromMember(member: AdminMemberRow, rooms: RoomInventory[]): GuestDraft {
  const family = member.families;
  const allocatedId = member.room_allocations?.find((row) => row.room_id)?.room_id ?? "";
  const allocatedNumber = member.room_allocations?.find((row) => row.rooms?.room_number)?.rooms?.room_number ?? "";
  const roomId = allocatedId || rooms.find((room) => room.room_number === allocatedNumber)?.id || "";
  return {
    memberId: member.id,
    familyId: family?.id ?? null,
    name: member.name ?? "",
    age: String(member.age ?? 18),
    gender: member.gender ?? "male",
    mobile: member.mobile ?? "",
    arrivalDate: member.arrival_date?.slice(0, 10) || family?.stay_from?.slice(0, 10) || EVENT_START,
    departureDate: member.departure_date?.slice(0, 10) || family?.stay_to?.slice(0, 10) || EVENT_END,
    isHead: Boolean(member.is_head),
    headName: family?.head_name ?? member.name ?? "",
    headMobile: family?.head_mobile ?? member.mobile ?? "",
    city: family?.city ?? "",
    registrationType: family?.registration_type ?? "general_room",
    wantsStay: Boolean(family?.wants_stay),
    stayFrom: family?.stay_from?.slice(0, 10) || EVENT_START,
    stayTo: family?.stay_to?.slice(0, 10) || EVENT_END,
    privateRoomNumber: family?.private_room_number ?? "",
    pothiId: family?.pothi_id ? String(family.pothi_id) : family?.reference_pothi_id ? String(family.reference_pothi_id) : "",
    roomId
  };
}

type GuestEditorPanelProps = {
  language: Language;
  members: AdminMemberRow[];
  rooms: RoomInventory[];
  onSaved: () => Promise<void> | void;
  onStatus: (message: string) => void;
  onCancelGuest: (member: AdminMemberRow) => Promise<void> | void;
};

export function GuestEditorPanel({ language, members, rooms, onSaved, onStatus, onCancelGuest }: GuestEditorPanelProps) {
  const isGu = language === "gu";
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<GuestDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<"edit" | "new-member" | "new-guest">("edit");

  const selected = members.find((member) => member.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedId && !members.some((member) => member.id === selectedId) && mode === "edit") {
      setSelectedId(null);
      setDraft(emptyDraft());
    }
  }, [members, mode, selectedId]);
  const roomOptions = useMemo(
    () =>
      rooms
        .filter((room) => room.id)
        .slice()
        .sort((left, right) => {
          const venue = shortVenue(left).localeCompare(shortVenue(right));
          if (venue !== 0) return venue;
          return shortRoom(left).localeCompare(shortRoom(right));
        }),
    [rooms]
  );

  function selectMember(member: AdminMemberRow) {
    setSelectedId(member.id);
    setMode("edit");
    setDraft(draftFromMember(member, rooms));
  }

  function startNewGuest() {
    setSelectedId(null);
    setMode("new-guest");
    setDraft(emptyDraft());
  }

  function startFamilyMember() {
    if (!selected?.families?.id) {
      onStatus(isGu ? "પહેલાં એક મહેમાન પસંદ કરો." : "Select a guest first to add a family member.");
      return;
    }
    const family = selected.families;
    setMode("new-member");
    setDraft({
      ...emptyDraft(),
      familyId: family.id,
      isHead: false,
      headName: family.head_name,
      headMobile: family.head_mobile,
      city: family.city ?? "",
      registrationType: family.registration_type,
      wantsStay: family.wants_stay,
      stayFrom: family.stay_from?.slice(0, 10) || EVENT_START,
      stayTo: family.stay_to?.slice(0, 10) || EVENT_END,
      privateRoomNumber: family.private_room_number ?? "",
      pothiId: family.pothi_id ? String(family.pothi_id) : "",
      arrivalDate: family.stay_from?.slice(0, 10) || EVENT_START,
      departureDate: family.stay_to?.slice(0, 10) || EVENT_END
    });
  }

  async function saveGuest(event: React.FormEvent) {
    event.preventDefault();
    const name = draft.name.trim();
    const age = Number(draft.age);
    if (!name) {
      onStatus(isGu ? "નામ જરૂરી છે." : "Name is required.");
      return;
    }
    if (!Number.isFinite(age) || age < 0 || age > 120) {
      onStatus(isGu ? "ઉંમર 0 થી 120 વચ્ચે રાખો." : "Age must be between 0 and 120.");
      return;
    }
    if (draft.arrivalDate < EVENT_START || draft.departureDate > EVENT_END || draft.departureDate < draft.arrivalDate) {
      onStatus(isGu ? "તારીખ 13 થી 20 નવેમ્બર 2026 વચ્ચે રાખો." : "Dates must be between 13 and 20 November 2026.");
      return;
    }

    const room = roomOptions.find((item) => item.id === draft.roomId);
    if (draft.roomId && !room) {
      onStatus(isGu ? "પસંદ કરેલો રૂમ મળ્યો નથી." : "The selected room was not found.");
      return;
    }

    setSaving(true);
    onStatus(isGu ? "સાચવી રહ્યા છીએ..." : "Saving guest...");
    try {
      let familyId = draft.familyId;
      if (!familyId) {
        const headName = draft.headName.trim() || name;
        const headMobile = draft.headMobile.trim() || draft.mobile.trim() || "0000000000";
        const { data: family, error: familyError } = await supabase
          .from("families")
          .insert({
            head_name: headName,
            head_mobile: headMobile,
            city: draft.city.trim() || null,
            wants_stay: draft.wantsStay || Boolean(draft.roomId),
            registration_type: draft.registrationType,
            stay_from: draft.stayFrom,
            stay_to: draft.stayTo,
            private_room_number: draft.privateRoomNumber.trim() || null
          })
          .select("id")
          .single();
        if (familyError) throw familyError;
        familyId = family.id;
      } else {
        const familyPatch: Record<string, unknown> = {
          city: draft.city.trim() || null,
          wants_stay: draft.wantsStay || Boolean(draft.roomId),
          registration_type: draft.registrationType,
          stay_from: draft.stayFrom,
          stay_to: draft.stayTo,
          private_room_number: draft.privateRoomNumber.trim() || null
        };
        if (draft.isHead || mode === "edit") {
          familyPatch.head_name = draft.headName.trim() || name;
          familyPatch.head_mobile = draft.headMobile.trim() || draft.mobile.trim() || "0000000000";
        }
        const { error: familyError } = await supabase.from("families").update(familyPatch).eq("id", familyId);
        if (familyError) throw familyError;
      }

      let memberId = draft.memberId;
      const memberPayload = {
        family_id: familyId,
        name,
        age,
        gender: draft.gender,
        mobile: draft.mobile.trim() || null,
        arrival_date: draft.arrivalDate,
        departure_date: draft.departureDate,
        is_head: draft.isHead || mode === "new-guest"
      };

      if (!memberId) {
        const { data: member, error: memberError } = await supabase.from("members").insert(memberPayload).select("id").single();
        if (memberError) throw memberError;
        memberId = member.id;
      } else {
        const { error: memberError } = await supabase.from("members").update(memberPayload).eq("id", memberId);
        if (memberError) throw memberError;
      }

      const { data: existingAllocations, error: allocationLoadError } = await supabase
        .from("room_allocations")
        .select("id, room_id")
        .eq("member_id", memberId);
      if (allocationLoadError) throw allocationLoadError;
      const allocations = existingAllocations ?? [];

      if (!draft.roomId) {
        if (allocations.length) {
          const { error } = await supabase.from("room_allocations").delete().eq("member_id", memberId);
          if (error) throw error;
        }
      } else {
        const keep = allocations.find((row) => row.room_id === draft.roomId) ?? allocations[0];
        if (keep) {
          if (keep.room_id !== draft.roomId) {
            const { error } = await supabase.from("room_allocations").update({ room_id: draft.roomId, family_id: familyId }).eq("id", keep.id);
            if (error) throw error;
          }
          const extraIds = allocations.filter((row) => row.id !== keep.id).map((row) => row.id);
          if (extraIds.length) {
            const { error } = await supabase.from("room_allocations").delete().in("id", extraIds);
            if (error) throw error;
          }
        } else {
          const { error } = await supabase.from("room_allocations").insert({
            room_id: draft.roomId,
            member_id: memberId,
            family_id: familyId
          });
          if (error) throw error;
        }
      }

      setSelectedId(memberId);
      setMode("edit");
      await onSaved();
      onStatus(isGu ? "મહેમાન સાચવાયો." : "Guest saved.");
    } catch (error) {
      onStatus(error instanceof Error ? error.message : isGu ? "મહેમાન સાચવી શકાયો નથી." : "Guest could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dashboard-panel dashboard-panel-surface guest-editor-panel">
      <div className="panel-header panel-header-inline">
        <div>
          <h2>{isGu ? "બધા મહેમાનો સંપાદિત કરો" : "Edit all guests"}</h2>
          <p>{isGu ? "નામ, મોબાઇલ, શહેર, તારીખ, રૂમ અને રહેવાની વિગત સીધી અહીં બદલો." : "Update name, mobile, city, dates, room and stay details from this panel."}</p>
        </div>
        <div className="button-row">
          <button type="button" className="secondary" onClick={startNewGuest}>{isGu ? "નવો મહેમાન" : "Add new guest"}</button>
          <button type="button" className="secondary" onClick={startFamilyMember} disabled={!selected?.families?.id}>{isGu ? "આ પરિવારમાં ઉમેરો" : "Add family member"}</button>
        </div>
      </div>

      <div className="guest-editor-layout">
        <div className="table-wrap guest-editor-list">
          <table>
            <thead>
              <tr>
                <th>{isGu ? "નામ" : "Name"}</th>
                <th>{isGu ? "શહેર" : "City"}</th>
                <th>{isGu ? "પોથી" : "Pothi"}</th>
                <th>{isGu ? "કોડ" : "Code"}</th>
                <th>{isGu ? "વેન્યુ" : "Venue"}</th>
                <th>{isGu ? "રૂમ" : "Room"}</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const room = member.room_allocations?.find((row) => row.rooms?.room_number)?.rooms;
                const pothi = member.families?.pothi_id ?? member.families?.reference_pothi_id;
                return (
                  <tr key={member.id} className={member.id === selectedId ? "is-selected" : undefined} onClick={() => selectMember(member)}>
                    <td>{member.name}</td>
                    <td>{member.families?.city || "-"}</td>
                    <td>{pothi || "-"}</td>
                    <td>{member.families?.registration_code || "-"}</td>
                    <td>{room ? shortVenue(room) : "-"}</td>
                    <td>{room ? shortRoom(room) : "-"}</td>
                  </tr>
                );
              })}
              {!members.length ? (
                <tr><td colSpan={6}>{isGu ? "કોઈ મહેમાન મળ્યા નથી." : "No guests match the current filters."}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <form className="guest-editor-form" onSubmit={(event) => void saveGuest(event)}>
          <h3>
            {mode === "new-guest" ? (isGu ? "નવો મહેમાન" : "New guest") : mode === "new-member" ? (isGu ? "પરિવારમાં નવો સભ્ય" : "New family member") : (isGu ? "પસંદ કરેલ મહેમાન" : "Selected guest")}
          </h3>
          <label>
            {isGu ? "નામ" : "Name"}
            <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} required />
          </label>
          <div className="guest-editor-inline">
            <label>
              {isGu ? "ઉંમર" : "Age"}
              <input type="number" min="0" max="120" value={draft.age} onChange={(event) => setDraft((current) => ({ ...current, age: event.target.value }))} />
            </label>
            <label>
              {isGu ? "લિંગ" : "Gender"}
              <select value={draft.gender} onChange={(event) => setDraft((current) => ({ ...current, gender: event.target.value as Gender }))}>
                <option value="male">{isGu ? "પુરુષ" : "Male"}</option>
                <option value="female">{isGu ? "સ્ત્રી" : "Female"}</option>
                <option value="other">{isGu ? "અન્ય" : "Other"}</option>
              </select>
            </label>
          </div>
          <label>
            {isGu ? "મોબાઇલ" : "Mobile"}
            <input inputMode="numeric" value={draft.mobile} onChange={(event) => setDraft((current) => ({ ...current, mobile: event.target.value }))} />
          </label>
          <label>
            {isGu ? "શહેર" : "City"}
            <input value={draft.city} onChange={(event) => setDraft((current) => ({ ...current, city: event.target.value }))} />
          </label>
          <div className="guest-editor-inline">
            <label>
              {isGu ? "આગમન" : "Arrival"}
              <input type="date" min={EVENT_START} max={EVENT_END} value={draft.arrivalDate} onChange={(event) => setDraft((current) => ({ ...current, arrivalDate: event.target.value }))} />
            </label>
            <label>
              {isGu ? "પ્રસ્થાન" : "Departure"}
              <input type="date" min={EVENT_START} max={EVENT_END} value={draft.departureDate} onChange={(event) => setDraft((current) => ({ ...current, departureDate: event.target.value }))} />
            </label>
          </div>
          <label>
            {isGu ? "પ્રકાર" : "Registration type"}
            <select value={draft.registrationType} onChange={(event) => setDraft((current) => ({ ...current, registrationType: event.target.value as RegistrationType }))}>
              <option value="general_room">{isGu ? "જનરલ" : "General"}</option>
              <option value="pothi_room">{isGu ? "પોથી" : "Pothi"}</option>
              <option value="private_room">{isGu ? "પ્રાઇવેટ" : "Private"}</option>
            </select>
          </label>
          <label>
            {isGu ? "કુટુંબ મુખ્ય" : "Family head"}
            <input value={draft.headName} onChange={(event) => setDraft((current) => ({ ...current, headName: event.target.value }))} />
          </label>
          <label>
            {isGu ? "કુટુંબ મોબાઇલ" : "Family mobile"}
            <input inputMode="numeric" value={draft.headMobile} onChange={(event) => setDraft((current) => ({ ...current, headMobile: event.target.value }))} />
          </label>
          <label>
            {isGu ? "રૂમ" : "Room allotment"}
            <select value={draft.roomId} onChange={(event) => setDraft((current) => ({ ...current, roomId: event.target.value, wantsStay: Boolean(event.target.value) || current.wantsStay }))}>
              <option value="">{isGu ? "રૂમ નહીં / ખાલી" : "No room / blank"}</option>
              {roomOptions.map((room) => (
                <option key={room.id} value={room.id}>
                  {shortRoom(room)}
                </option>
              ))}
            </select>
          </label>
          <label className="guest-editor-check">
            <input type="checkbox" checked={draft.wantsStay} onChange={(event) => setDraft((current) => ({ ...current, wantsStay: event.target.checked }))} />
            <span>{isGu ? "રૂમ જોઈએ છે" : "Wants stay / room"}</span>
          </label>
          <label>
            {isGu ? "પ્રાઇવેટ રૂમ નંબર" : "Private room number"}
            <input value={draft.privateRoomNumber} onChange={(event) => setDraft((current) => ({ ...current, privateRoomNumber: event.target.value }))} />
          </label>
          {draft.pothiId ? <p className="inline-note">{isGu ? `પોથી ${draft.pothiId} લૉક છે.` : `Pothi ${draft.pothiId} is locked on this registration.`}</p> : null}
          <div className="button-row">
            <button type="submit" className="primary" disabled={saving}>{saving ? (isGu ? "સાચવી રહ્યા છીએ..." : "Saving...") : (isGu ? "સાચવો" : "Save guest")}</button>
            {selected && mode === "edit" ? (
              <button type="button" className="table-action" onClick={() => void onCancelGuest(selected)}>
                {selected.is_head ? (isGu ? "રિઝર્વેશન રદ કરો" : "Cancel reservation") : (isGu ? "મહેમાન રદ કરો" : "Cancel guest")}
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}
