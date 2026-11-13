import { Component, type ErrorInfo, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import QRCode from "qrcode";
import type { Session } from "@supabase/supabase-js";
import fallbackPothisData from "../data/pothis.json";
import fallbackRoomsData from "../data/rooms.json";
import { GuestEditorPanel } from "../components/GuestEditorPanel";
import { PothiGrid } from "../components/PothiGrid";
import { qrPayload } from "../components/MemberQrCode";
import { StatusPill } from "../components/StatusPill";
import {
  cancelRegistration,
  downloadAdminWorkbook,
  downloadExportData,
  downloadMealScanWorkbook,
  fetchMealScanLogs,
  formatIstDisplayDate,
  formatIstTime,
  registerFamily,
  todayIstDate,
  type MealScanLogRow,
} from "../lib/api";
import { supabase } from "../lib/supabase";
import type { AdminMemberRow, FamilyMemberInput, Pothi, RoomInventory } from "../lib/types";
import { shortRoom, shortVenue } from "../lib/venueLabels";

type Language = "en" | "gu";

const ADMIN_PAGE_SIZE = 400;

async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
) {
  const rows: T[] = [];
  for (let from = 0; from < 20000; from += ADMIN_PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + ADMIN_PAGE_SIZE - 1);
    if (error) return { data: null, error };
    const page = data ?? [];
    if (!page.length) break;
    const first = page[0] as { id?: string | number };
    const already = first?.id != null && rows.some((row) => (row as { id?: string | number }).id === first.id);
    if (already) break;
    rows.push(...page);
    if (page.length < ADMIN_PAGE_SIZE) break;
  }
  return { data: rows, error: null };
}

function normalizeRoom(room: Partial<RoomInventory> & { capacity?: number | null }): RoomInventory {
  return {
    id: room.id,
    room_number: room.room_number ?? "",
    venue_name: room.venue_name ?? "",
    section_name: room.section_name ?? "",
    source_room_number: room.source_room_number ?? "",
    floor: room.floor ?? null,
    ac_type: room.ac_type ?? null,
    bed_count: room.bed_count ?? null,
    extra_count: room.extra_count ?? null,
    total_capacity: room.total_capacity ?? room.capacity ?? 4,
    owner_type: room.owner_type ?? "",
    linked_pothi_id: room.linked_pothi_id ?? null,
    allotment_note: room.allotment_note ?? null,
    room_type: room.room_type ?? "general_room",
    sort_order: room.sort_order ?? 9999
  };
}

function venueTabName(room: RoomInventory) {
  return shortVenue(room);
}

function unwrapRecord<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function roomIdentity(room: { id?: string | null; room_number?: string | null; venue_name?: string | null; section_name?: string | null; source_room_number?: string | null; floor?: string | null }) {
  if (room.id) return `id:${room.id}`;
  const number = String(room.room_number ?? "").trim();
  if (number) return `no:${number}`;
  return `${shortVenue(room)}::${room.source_room_number || ""}::${room.floor ?? ""}`;
}

function attachRoomsToMembers(members: AdminMemberRow[], rooms: RoomInventory[]): AdminMemberRow[] {
  const roomById = new Map(rooms.filter((room) => room.id).map((room) => [room.id as string, room]));
  const roomByNumber = new Map(rooms.map((room) => [room.room_number.trim(), room]));
  return members.map((member) => ({
    ...member,
    room_allocations: (member.room_allocations ?? []).map((allocation) => {
      const fromEmbed = unwrapRecord(allocation.rooms);
      const fromInventory = (allocation.room_id && roomById.get(allocation.room_id))
        || (fromEmbed?.room_number ? roomByNumber.get(fromEmbed.room_number.trim()) : undefined);
      const room = fromInventory || fromEmbed;
      return {
        ...allocation,
        rooms: room
          ? {
              id: "id" in room ? room.id : undefined,
              room_number: room.room_number,
              venue_name: room.venue_name,
              section_name: room.section_name,
              source_room_number: room.source_room_number,
              floor: room.floor
            }
          : null
      };
    })
  }));
}

function normalizeAdminMembers(value: unknown): AdminMemberRow[] {
  if (!Array.isArray(value)) return [];
  return value.map((member) => {
    const row = member as AdminMemberRow & { room_allocations?: unknown; families?: unknown };
    const family = unwrapRecord(row.families as AdminMemberRow["families"] | AdminMemberRow["families"][] | null);
    const allocations = Array.isArray(row.room_allocations)
      ? row.room_allocations
      : row.room_allocations
        ? [row.room_allocations]
        : [];
    return {
      ...row,
      families: family,
      room_allocations: allocations.map((allocation) => {
        const item = allocation as AdminMemberRow["room_allocations"][number] & { rooms?: unknown };
        return { ...item, rooms: unwrapRecord(item.rooms as AdminMemberRow["room_allocations"][number]["rooms"] | AdminMemberRow["room_allocations"][number]["rooms"][] | null) };
      })
    };
  });
}

const fallbackPothis = fallbackPothisData as Pothi[];
const fallbackRooms = (fallbackRoomsData as Array<RoomInventory & { capacity?: number | null }>).map(normalizeRoom);

const copy = {
  en: {
    eyebrow: "Admin dashboard",
    title: "Guests, rooms and pothis",
    subtitle:
      "Use Supabase Auth and add admin users to admin_profiles before going live. Offline mode shows the imported pothi and room inventory without live registrations.",
    loginEyebrow: "Admin login",
    loginTitle: "Sign in to manage guests",
    loginText:
      "Use a Supabase Auth account that exists in admin_profiles to access the dashboard.",
    email: "Email",
    password: "Password",
    signIn: "Sign in",
    signOut: "Sign out",
    exportCsv: "Export CSV",
    families: "Families",
    members: "Members",
    pothiRooms: "Pothi rooms",
    privateRooms: "Private rooms",
    generalRooms: "General rooms",
    pothis: "Pothis",
    filtersTitle: "Master search",
    masterSearch: "Search guests, mobile, family, pothi, venue, room or type",
    addedFrom: "Added from",
    addedTo: "Added to",
    yajmanRoom: "Pothi Yajman room",
    privateRoomGuests: "Private room guests",
    generalRoomGuests: "General room guests",
    cancelReservation: "Cancel reservation",
    cancelGuest: "Cancel guest",
    guestList: "Guest list",
    name: "Name",
    family: "Family",
    type: "Type",
    room: "Room",
    noRows: "No registrations found for the current filters.",
    noOffline: "No live registrations in offline mode yet.",
    pothiOccupancy: "Pothi occupancy",
    importedInventory: "Imported room inventory",
    registeredView: "Registered room view",
    generalInventory: "General inventory"
    ,adminRegisterTitle: "Admin Pothi registration"
    ,adminRegisterText: "Register a Pothi directly from the admin dashboard. OTP is not required for an authenticated admin.",
    adminRegister: "Register Pothi",
    selectPothi: "Select open Pothi",
    addPerson: "Add member",
    removePerson: "Remove",
    saveRegistration: "Save Pothi registration",
    savingRegistration: "Saving registration..."
  },
  gu: {
    eyebrow: "એડમિન ડેશબોર્ડ",
    title: "મહેમાનો, રૂમ અને પોથી",
    subtitle:
      "લાઇવ પર જતાં પહેલાં Supabase Auth નો ઉપયોગ કરો અને admin_profiles માં એડમિન ઉમેરો. ઓફલાઇન મોડમાં ફક્ત આયાત કરેલી પોથી અને રૂમ સૂચિ દેખાય છે.",
    loginEyebrow: "એડમિન લોગિન",
    loginTitle: "મહેમાનો સંભાળવા સાઇન ઇન કરો",
    loginText:
      "ડેશબોર્ડ જોવા માટે admin_profiles માં હાજર Supabase Auth એકાઉન્ટનો ઉપયોગ કરો.",
    email: "ઈમેઇલ",
    password: "પાસવર્ડ",
    signIn: "સાઇન ઇન",
    signOut: "સાઇન આઉટ",
    exportCsv: "CSV એક્સપોર્ટ",
    families: "પરિવારો",
    members: "સભ્યો",
    pothiRooms: "પોથી રૂમ",
    privateRooms: "પ્રાઇવેટ રૂમ",
    generalRooms: "જનરલ રૂમ",
    pothis: "પોથીઓ",
    filtersTitle: "માસ્ટર સર્ચ",
    masterSearch: "મહેમાન, મોબાઇલ, પરિવાર, પોથી, વેન્યુ, રૂમ અથવા પ્રકાર શોધો",
    addedFrom: "ઉમેર્યાની તારીખથી",
    addedTo: "ઉમેર્યાની તારીખ સુધી",
    yajmanRoom: "પોથી યજમાન રૂમ",
    privateRoomGuests: "પ્રાઇવેટ રૂમ મહેમાન",
    generalRoomGuests: "જનરલ રૂમ મહેમાન",
    cancelReservation: "રિઝર્વેશન રદ કરો",
    cancelGuest: "મહેમાન રદ કરો",
    guestList: "મહેમાન સૂચિ",
    name: "નામ",
    family: "પરિવાર",
    type: "પ્રકાર",
    room: "રૂમ",
    noRows: "આ ફિલ્ટર માટે કોઈ નોંધણી મળી નથી.",
    noOffline: "ઓફલાઇન મોડમાં હજી કોઈ લાઇવ નોંધણી નથી.",
    pothiOccupancy: "પોથી ઓક્યુપન્સી",
    importedInventory: "આયાત કરેલ રૂમ સૂચિ",
    registeredView: "નોંધાયેલ રૂમ દૃશ્ય",
    generalInventory: "જનરલ સૂચિ"
    ,adminRegisterTitle: "એડમિન પોથી નોંધણી"
    ,adminRegisterText: "ઓથેન્ટિકેટેડ એડમિન ડેશબોર્ડથી સીધી પોથી નોંધણી કરો. OTP જરૂરી નથી.",
    adminRegister: "પોથી નોંધણી",
    selectPothi: "ખાલી પોથી પસંદ કરો",
    addPerson: "સભ્ય ઉમેરો",
    removePerson: "દૂર કરો",
    saveRegistration: "પોથી નોંધણી સાચવો",
    savingRegistration: "નોંધણી સાચવી રહ્યા છીએ..."
  }
} as const;

type AdminPageProps = {
  language?: Language;
};

class AdminErrorBoundary extends Component<{ language: Language; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Admin dashboard render error", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      const isGujarati = this.props.language === "gu";
      return (
        <section className="page-section compact">
          <div className="dashboard-hero">
            <p className="eyebrow">{isGujarati ? "એડમિન ડેશબોર્ડ" : "Admin dashboard"}</p>
            <h1>{isGujarati ? "ડેશબોર્ડ ફરી લોડ કરવાની જરૂર છે" : "The dashboard needs to reload"}</h1>
            <p>{isGujarati ? "લાઇવ ડેટા લોડ કરતી વખતે અસ્થાયી સમસ્યા આવી. ફરી પ્રયાસ કરો." : "A temporary problem occurred while rendering live data. Try loading the dashboard again."}</p>
          </div>
          <div className="auth-card">
            <p className="form-message">{this.state.error.message || (isGujarati ? "ડેટા લોડ થઈ શક્યો નથી." : "The live data could not be displayed.")}</p>
            <div className="button-row">
              <button className="primary" type="button" onClick={() => window.location.reload()}>{isGujarati ? "ફરી લોડ કરો" : "Reload dashboard"}</button>
            </div>
          </div>
        </section>
      );
    }
    return this.props.children;
  }
}

export function AdminPage({ language = "en" }: AdminPageProps) {
  return <AdminErrorBoundary language={language}><AdminPageContent language={language} /></AdminErrorBoundary>;
}

function AdminPageContent({ language = "en" }: AdminPageProps) {
  const t = copy[language];
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [members, setMembers] = useState<AdminMemberRow[]>([]);
  const [mealScanDate, setMealScanDate] = useState(todayIstDate);
  const [mealScanLogs, setMealScanLogs] = useState<MealScanLogRow[]>([]);
  const [mealScansLoading, setMealScansLoading] = useState(false);
  const [mealScanFilter, setMealScanFilter] = useState<"all" | "breakfast" | "lunch" | "dinner">("all");
  const [pothis, setPothis] = useState<Pothi[]>(fallbackPothis);
  const [roomsInventory, setRoomsInventory] = useState<RoomInventory[]>(fallbackRooms);
  const [masterSearch, setMasterSearch] = useState("");
  const [searchVenue, setSearchVenue] = useState("all");
  const [searchType, setSearchType] = useState("all");
  const [searchPothi, setSearchPothi] = useState("all");
  const [addedFrom, setAddedFrom] = useState("");
  const [addedTo, setAddedTo] = useState("");
  const [selectedVenue, setSelectedVenue] = useState("occupied");
  const [status, setStatus] = useState("");
  const [adminPothiId, setAdminPothiId] = useState("");
  const [adminMembers, setAdminMembers] = useState<FamilyMemberInput[]>([{ name: "", age: 18, gender: "male", mobile: "", isHead: true }]);
  const [adminStayFrom, setAdminStayFrom] = useState("2026-11-13");
  const [adminStayTo, setAdminStayTo] = useState("2026-11-20");
  const [adminSaving, setAdminSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const loadRequestId = useRef(0);

  async function load() {
    const requestId = ++loadRequestId.current;
    setLoading(true);
    try {
      const results = await Promise.race([
        Promise.all([
        fetchAllPages((from, to) =>
          supabase
            .from("members")
            .select("id, name, age, gender, mobile, arrival_date, departure_date, is_head, created_at, qr_token, qr_revoked_at, families(id, registration_code, head_name, head_mobile, city, wants_stay, stay_from, stay_to, pothi_id, reference_pothi_id, registration_type, private_room_number), room_allocations(id, room_id)")
            .order("name")
            .order("id")
            .range(from, to)
        ),
        supabase.from("pothis").select("id, family_id").order("id"),
        fetchAllPages((from, to) =>
          supabase
            .from("rooms")
            .select("id, room_number, venue_name, section_name, source_room_number, floor, ac_type, bed_count, extra_count, capacity, owner_type, linked_pothi_id, allotment_note, room_type, sort_order")
            .order("sort_order")
            .order("room_number")
            .range(from, to)
        ),
        ]),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => reject(new Error("Dashboard load timed out. Refresh to try again.")), 25000);
        })
      ]);
      const [{ data: memberData, error: memberError }, { data: pothiData, error: pothiError }, { data: roomData, error: roomError }] = results;

      const liveRooms = !roomError
        ? ((roomData ?? []) as Array<RoomInventory & { capacity?: number | null }>).map(normalizeRoom)
        : fallbackRooms;
      if (loadRequestId.current !== requestId) return;
      setRoomsInventory(liveRooms);
      if (!pothiError) setPothis(((pothiData ?? []) as Pothi[]).filter((pothi) => pothi.id >= 1 && pothi.id <= 74));
      if (!memberError) setMembers(attachRoomsToMembers(normalizeAdminMembers(memberData), liveRooms));
      const errors = [memberError, pothiError, roomError].filter(Boolean).map((error) => error!.message);
      setStatus(errors.length ? `Dashboard loaded with warnings. ${errors.join(" ")}` : "");
      void loadMealScans(mealScanDate);
    } catch (error) {
      if (loadRequestId.current !== requestId) return;
      setStatus(error instanceof Error ? `Dashboard refresh failed: ${error.message}` : "Dashboard refresh failed. Existing data is still shown.");
    } finally {
      if (loadRequestId.current === requestId) setLoading(false);
    }
  }

  async function loadMealScans(date: string) {
    setMealScansLoading(true);
    try {
      const rows = await fetchMealScanLogs(date);
      setMealScanLogs(rows);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load scanned QRs.");
    } finally {
      setMealScansLoading(false);
    }
  }

  async function handleAdminPothiRegistration(event: React.FormEvent) {
    event.preventDefault();
    const pothiId = Number(adminPothiId);
    const filledMembers = adminMembers.filter((member) => member.name.trim());
    const head = filledMembers[0];
    if (!pothiId || !head || !head.mobile.trim()) {
      setStatus(language === "gu" ? "પોથી, પ્રથમ સભ્યનું નામ અને મોબાઇલ જરૂરી છે." : "Pothi, first member name and mobile are required.");
      return;
    }
    const roomCapacity = roomsInventory.find((room) => room.linked_pothi_id === pothiId && room.owner_type === "SAMAJ" && room.room_type === "pothi_room")?.total_capacity ?? 4;
    if (filledMembers.length > roomCapacity) {
      setStatus(language === "gu" ? `આ પોથી રૂમની ક્ષમતા ${roomCapacity} સભ્યોની છે.` : `This Pothi room has capacity for ${roomCapacity} members.`);
      return;
    }
    if (adminStayTo < adminStayFrom || adminStayFrom < "2026-11-13" || adminStayTo > "2026-11-20") {
      setStatus(language === "gu" ? "રહેવાની તારીખ 13 થી 20 નવેમ્બર 2026 વચ્ચે રાખો." : "Stay dates must be between 13 and 20 November 2026, with departure on or after arrival.");
      return;
    }
    setAdminSaving(true);
    setStatus("");
    try {
      await registerFamily({
        headName: head.name.trim(),
        headMobile: head.mobile.trim(),
        city: "Admin entry",
        address: "Admin dashboard registration",
        registrationType: "pothi_room",
        pothiId,
        stayFrom: adminStayFrom,
        stayTo: adminStayTo,
        pothiRoomMemberCount: filledMembers.length,
        members: filledMembers.map((member, index) => ({ ...member, name: member.name.trim(), age: Number(member.age) || 18, mobile: member.mobile.trim(), isHead: index === 0 })),
        adminRequest: true
      });
      setStatus(language === "gu" ? `પોથી ${pothiId} ની નોંધણી સાચવાઈ ગઈ.` : `Pothi ${pothiId} registration saved.`);
      setAdminPothiId("");
      setAdminMembers([{ name: "", age: 18, gender: "male", mobile: "", isHead: true }]);
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Admin registration failed.");
    } finally {
      setAdminSaving(false);
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) {
      void load();
      const refreshTimer = window.setInterval(() => {
        if (document.visibilityState === "visible") void load();
      }, 5 * 60 * 1000);
      return () => window.clearInterval(refreshTimer);
    }
  }, [session]);

  useEffect(() => {
    if (!session) return;
    void loadMealScans(mealScanDate);
  }, [session, mealScanDate]);

  function roomDetailsForMember(member: AdminMemberRow) {
    const allocated = member.room_allocations?.find((allocation) => allocation.room_id || allocation.rooms?.room_number);
    const allocatedRoom = allocated?.rooms;
    const inventoryRoom = allocated?.room_id
      ? roomsInventory.find((room) => room.id === allocated.room_id)
      : roomsInventory.find((room) => room.room_number === allocatedRoom?.room_number);
    const resolved = inventoryRoom || allocatedRoom;
    if (resolved?.room_number) {
      return {
        id: inventoryRoom?.id ?? ("id" in resolved ? resolved.id : undefined),
        room_number: resolved.room_number,
        venue_name: resolved.venue_name ?? "",
        section_name: resolved.section_name ?? "",
        source_room_number: resolved.source_room_number ?? "",
        floor: resolved.floor ?? ""
      };
    }

    const family = member.families;
    const requestedPrivateRoom = family?.private_room_number?.trim();
    const exactPrivateRoom = requestedPrivateRoom
      ? roomsInventory.find((room) => room.room_number === requestedPrivateRoom)
      : undefined;
    const sourcePrivateRooms = requestedPrivateRoom
      ? roomsInventory.filter((room) => room.source_room_number === requestedPrivateRoom && room.owner_type === "PRIVATE")
      : [];
    const privateRoom = exactPrivateRoom?.owner_type === "PRIVATE"
      ? exactPrivateRoom
      : sourcePrivateRooms.length === 1
        ? sourcePrivateRooms[0]
        : undefined;
    const fallbackRoom = family?.registration_type === "private_room"
      ? privateRoom
      : undefined;

    return fallbackRoom
      ? {
        id: fallbackRoom.id,
        room_number: fallbackRoom.room_number,
        venue_name: fallbackRoom.venue_name,
        section_name: fallbackRoom.section_name,
        source_room_number: fallbackRoom.source_room_number,
        floor: fallbackRoom.floor ?? ""
      }
      : null;
  }

  const filtered = useMemo(() => {
    const query = masterSearch.trim().toLowerCase();
    return members.filter((member) => {
      const family = member.families;
      const roomDetails = roomDetailsForMember(member);
      const room = roomDetails?.room_number ?? "";
      const pothi = family?.pothi_id ?? family?.reference_pothi_id ?? "";
      const memberVenue = roomDetails ? shortVenue(roomDetails) : "";
      if (searchVenue !== "all" && memberVenue !== searchVenue) return false;
      if (searchType !== "all" && family?.registration_type !== searchType) return false;
      if (searchPothi !== "all" && String(pothi) !== searchPothi) return false;
      const addedDate = member.created_at?.slice(0, 10) ?? "";
      if (addedFrom && (!addedDate || addedDate < addedFrom)) return false;
      if (addedTo && (!addedDate || addedDate > addedTo)) return false;
      const haystack = [member.name, member.mobile, family?.head_name, family?.head_mobile, family?.city, room, roomDetails ? shortRoom(roomDetails) : "", roomDetails ? shortVenue(roomDetails) : "", pothi, family?.registration_type]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return !query || haystack.includes(query);
    });
  }, [addedFrom, addedTo, masterSearch, members, roomsInventory, searchPothi, searchType, searchVenue]);

  const roomAllocationBoard = useMemo(() => {
    const occupancy = new Map<string, AdminMemberRow[]>();
    for (const member of members) {
      const room = roomDetailsForMember(member);
      if (!room?.room_number) continue;
      const key = roomIdentity(room);
      const numberKey = `no:${room.room_number.trim()}`;
      const list = [...(occupancy.get(key) ?? occupancy.get(numberKey) ?? []), member];
      occupancy.set(key, list);
      occupancy.set(numberKey, list);
    }

    const pothiHasFamily = new Set(pothis.filter((pothi) => pothi.family_id).map((pothi) => pothi.id));

    return roomsInventory
      .filter((room) => selectedVenue === "all" || selectedVenue === "occupied" || selectedVenue === "vacant" || venueTabName(room) === selectedVenue)
      .filter((room) => searchVenue === "all" || venueTabName(room) === searchVenue)
      .filter((room) => searchType === "all" || room.room_type === searchType)
      .filter((room) => searchPothi === "all" || String(room.linked_pothi_id ?? "") === searchPothi)
      .filter((room) => {
        const query = masterSearch.trim().toLowerCase();
        if (!query) return true;
        const occupants = occupancy.get(roomIdentity(room)) ?? occupancy.get(`no:${room.room_number.trim()}`) ?? [];
        return [shortRoom(room), shortVenue(room), room.room_number, room.venue_name, room.section_name, room.room_type, room.owner_type, room.linked_pothi_id, ...occupants.flatMap((member) => [member.name, member.mobile, member.families?.head_name, member.families?.head_mobile])]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
      .map((room) => ({
        room,
        occupants: occupancy.get(roomIdentity(room)) ?? occupancy.get(`no:${room.room_number.trim()}`) ?? [],
        pothiHeld: Boolean(room.linked_pothi_id && pothiHasFamily.has(room.linked_pothi_id))
      }))
      .sort((left, right) => {
        const venueCompare = left.room.venue_name.localeCompare(right.room.venue_name);
        if (venueCompare !== 0) return venueCompare;
        const orderCompare = (left.room.sort_order ?? 9999) - (right.room.sort_order ?? 9999);
        if (orderCompare !== 0) return orderCompare;
        return left.room.room_number.localeCompare(right.room.room_number);
      });
  }, [masterSearch, members, pothis, roomsInventory, searchPothi, searchType, searchVenue, selectedVenue]);

  const visibleRoomCards = useMemo(
    () =>
      roomAllocationBoard.filter((item) => {
        if (selectedVenue === "occupied") return item.occupants.length > 0;
        if (selectedVenue === "vacant") return item.occupants.length === 0 && !item.pothiHeld && !/store room/i.test(item.room.allotment_note ?? "");
        return true;
      }),
    [roomAllocationBoard, selectedVenue]
  );

  const venueNames = useMemo(
    () => [...new Set(roomsInventory.map(venueTabName).filter(Boolean))].sort(),
    [roomsInventory]
  );

  const stats = {
    members: members.length,
    families: new Set(members.map((member) => member.families?.id).filter(Boolean)).size,
    pothiRooms: new Set(members.filter((member) => member.families?.registration_type === "pothi_room").map((member) => member.families?.id).filter(Boolean)).size,
    privateRooms: new Set(members.filter((member) => member.families?.registration_type === "private_room").map((member) => member.families?.id).filter(Boolean)).size,
    generalRooms: new Set(members.filter((member) => member.families?.registration_type === "general_room").map((member) => member.families?.id).filter(Boolean)).size,
    occupiedPothis: pothis.filter((pothi) => pothi.family_id).length
  };

  const mealScanCounts = useMemo(() => {
    const counts = { breakfast: 0, lunch: 0, dinner: 0 };
    for (const row of mealScanLogs) {
      if (row.meal_type in counts) counts[row.meal_type] += 1;
    }
    return counts;
  }, [mealScanLogs]);

  const visibleMealScans = useMemo(() => {
    if (mealScanFilter === "all") return mealScanLogs;
    return mealScanLogs.filter((row) => row.meal_type === mealScanFilter);
  }, [mealScanLogs, mealScanFilter]);

  const exportMembers = useMemo(
    () =>
      members.map((member) => {
        const family = member.families;
        const roomDetails = roomDetailsForMember(member);
        const registrationType = family?.registration_type ?? "";
        const pothiId = family?.pothi_id ?? family?.reference_pothi_id ?? null;
        const pothiNumber = Number(pothiId);
        const hasPothi = Number.isInteger(pothiNumber) && pothiNumber >= 1 && pothiNumber <= 74;
        return {
          name: member.name,
          age: member.age,
          gender: member.gender,
          mobile: member.mobile ?? "",
          created_at: member.created_at ?? "",
          arrival_date: member.arrival_date ?? family?.stay_from ?? "",
          departure_date: member.departure_date ?? family?.stay_to ?? "",
          family_id: family?.id ?? "",
          registration_code: family?.registration_code ?? "",
          family_name: family?.head_name ?? "",
          family_mobile: family?.head_mobile ?? "",
          city: family?.city ?? "",
          registration_type: hasPothi ? "pothi_room" : registrationType,
          pothi: hasPothi ? pothiNumber : registrationType === "general_room" ? "General" : pothiId ?? "",
          venue: roomDetails ? shortVenue(roomDetails) : "",
          room: roomDetails ? shortRoom(roomDetails) : ""
        };
      }),
    [members, roomsInventory]
  );

  const exportRooms = useMemo(
    () =>
      roomsInventory.map((room) => ({
        room_number: room.room_number,
        venue_name: venueTabName(room),
        section_name: room.section_name,
        floor: room.floor ?? "",
        room_type: room.room_type,
        total_capacity: room.total_capacity,
        owner_type: room.owner_type,
        linked_pothi_id: room.linked_pothi_id ?? "",
        allotment_note: room.allotment_note ?? ""
      })),
    [roomsInventory]
  );

  async function handleExport() {
    setStatus(language === "gu" ? "એક્સપોર્ટ તૈયાર કરી રહ્યા છીએ..." : "Preparing export...");
    try {
      await downloadExportData();
      setStatus(language === "gu" ? "એક્સપોર્ટ ડાઉનલોડ થયું." : "Export downloaded.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : language === "gu" ? "એક્સપોર્ટ નિષ્ફળ થયું." : "Export failed.");
    }
  }

  async function handleWorkbookExport() {
    setStatus(language === "gu" ? "વર્કબુક તૈયાર કરી રહ્યા છીએ..." : "Preparing workbook...");
    try {
      await downloadAdminWorkbook({
        members: exportMembers,
        rooms: exportRooms,
        language
      });
      setStatus(language === "gu" ? "વર્કબુક ડાઉનલોડ થઈ ગઈ." : "Workbook downloaded.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : language === "gu" ? "વર્કબુક નિષ્ફળ થઈ." : "Workbook export failed.");
    }
  }

  async function handleQrBulkDownload() {
    setStatus(language === "gu" ? "QR કોડ તૈયાર કરી રહ્યા છીએ..." : "Preparing QR codes...");
    try {
      const zip = new JSZip();
      let exportedCount = 0;
      for (const member of members) {
        if (!member.qr_token || member.qr_revoked_at) continue;
        const roomDetails = roomDetailsForMember(member);
        const dataUrl = await QRCode.toDataURL(qrPayload({
          ...member,
          family_code: member.families?.id ?? "",
          venue: roomDetails?.venue_name ?? "",
          room: roomDetails?.room_number ?? ""
        }), { width: 500, margin: 2 });
        zip.file(`${member.name.replace(/[^a-z0-9]+/gi, "-") || "member"}-${member.id}-qr.png`, dataUrl.split(",")[1], { base64: true });
        exportedCount += 1;
      }
      if (!exportedCount) throw new Error("No active member QR codes are available to export.");
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = "bhagwat-saptah-member-qr-codes.zip"; anchor.click(); URL.revokeObjectURL(url);
      setStatus(language === "gu" ? "બધા QR કોડ ડાઉનલોડ થયા." : "All QR codes downloaded.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "QR download failed."); }
  }

  async function downloadScanLog() {
    setStatus(language === "gu" ? "સ્કેન લોગ તૈયાર કરી રહ્યા છીએ..." : "Preparing meal scan log...");
    try {
      await downloadMealScanWorkbook(mealScanDate, mealScanLogs);
      setStatus(
        language === "gu"
          ? `સ્કેન લોગ ડાઉનલોડ થયો · ${mealScanLogs.length} સ્કેન`
          : `Scan log downloaded · ${mealScanLogs.length} scans`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Scan log download failed.");
    }
  }

  async function cancelReservation(member: AdminMemberRow) {
    const familyId = member.families?.id;
    if (!familyId) return;
    const isIndividualGuest = !member.is_head;
    const prompt = isIndividualGuest
      ? `Cancel registration for ${member.name}? Other family members will remain registered.`
      : `Cancel the complete reservation for ${member.families?.head_name ?? member.name}?`;
    if (!window.confirm(prompt)) return;

    setStatus(language === "gu" ? (isIndividualGuest ? "મહેમાન રદ કરી રહ્યા છીએ..." : "રિઝર્વેશન રદ કરી રહ્યા છીએ...") : (isIndividualGuest ? "Cancelling guest..." : "Cancelling reservation..."));
    try {
      await cancelRegistration({ familyId, memberId: isIndividualGuest ? member.id : undefined });
      if (isIndividualGuest) {
        setMembers((current) => current.filter((item) => item.id !== member.id));
        setStatus(language === "gu" ? "મહેમાન સફળતાપૂર્વક રદ થયો." : "Guest cancelled successfully.");
      } else {
        setMembers((current) => current.filter((item) => item.families?.id !== familyId));
        setPothis((current) => current.map((pothi) => pothi.family_id === familyId ? { ...pothi, family_id: null } : pothi));
        setStatus(language === "gu" ? "રિઝર્વેશન સફળતાપૂર્વક રદ થયું." : "Reservation cancelled successfully.");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : language === "gu" ? "રિઝર્વેશન રદ થઈ શક્યું નથી." : "Reservation could not be cancelled.");
    }
  }

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    setStatus(language === "gu" ? "સાઇન ઇન કરી રહ્યા છીએ..." : "Signing in...");

    try {
      const login = supabase.auth.signInWithPassword({ email, password });
      const timeout = new Promise<{ error: { message: string } }>((resolve) => {
        window.setTimeout(
          () => resolve({ error: { message: language === "gu" ? "લોગિન સમય સમાપ્ત થયો. તમારા ઇન્ટરનેટ અને Supabase project URL તપાસો." : "Login timed out. Check your internet connection and Supabase project URL." } }),
          15000
        );
      });
      const { error } = await Promise.race([login, timeout]);

      if (error) {
        setStatus(error.message);
        return;
      }

      const { data: adminProfile, error: adminError } = await supabase.from("admin_profiles").select("user_id, role").eq("user_id", (await supabase.auth.getUser()).data.user?.id ?? "").maybeSingle();

      if (adminError) {
        setStatus(adminError.message);
        await supabase.auth.signOut();
        return;
      }

      if (!adminProfile || adminProfile.role !== "admin") {
        setStatus(language === "gu" ? "આ એકાઉન્ટ એડમિન નથી. owner ને admin_profiles માં ઉમેરવા કહો." : "This account is not an admin. Ask an owner to add your user to admin_profiles.");
        await supabase.auth.signOut();
        return;
      }

      setStatus(language === "gu" ? "એડમિન સાઇન ઇન થયા." : "Admin signed in.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : language === "gu" ? "સાઇન ઇન નિષ્ફળ થયું." : "Sign in failed.");
    }
  }

  if (!session) {
    return (
      <section className="page-section compact">
        <div className="dashboard-hero">
          <p className="eyebrow">{t.loginEyebrow}</p>
          <h1>{t.loginTitle}</h1>
          <p>{t.loginText}</p>
        </div>
        <form className="auth-card auth-form" onSubmit={handleLogin}>
          <label>
            {t.email}
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label>
            {t.password}
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </label>
          <div className="button-row">
            <button className="primary">{t.signIn}</button>
          </div>
          {status ? <p className="form-message">{status}</p> : null}
        </form>
      </section>
    );
  }

  return (
    <section className="page-section admin-simple">
      <div className="dashboard-panel dashboard-panel-surface">
        <div className="panel-header panel-header-inline">
          <div>
            <p className="eyebrow">{t.eyebrow}</p>
            <h1>{language === "gu" ? "મહેમાન અને રૂમ" : "Guests and rooms"}</h1>
          </div>
          <div className="admin-actions admin-actions-bar">
            <button className="secondary" type="button" onClick={() => void load()} disabled={loading}>{loading ? (language === "gu" ? "લોડ..." : "Loading...") : (language === "gu" ? "રિફ્રેશ" : "Refresh")}</button>
            <button className="secondary" type="button" onClick={handleWorkbookExport}>{language === "gu" ? "એક્સેલ" : "Excel"}</button>
            <button className="secondary" type="button" onClick={() => void handleExport()}>{t.exportCsv}</button>
            <button className="secondary" type="button" onClick={() => void handleQrBulkDownload()}>{language === "gu" ? "QR" : "QR codes"}</button>
            <button className="secondary" type="button" onClick={() => void downloadScanLog()}>{language === "gu" ? "સ્કેન લોગ" : "Scan log"}</button>
            <button className="secondary" onClick={() => supabase.auth.signOut()}>{t.signOut}</button>
          </div>
        </div>
        <div className="metric-row admin-metric-row">
          <div><strong>{stats.members}</strong><span>{t.members}</span></div>
          <div><strong>{stats.families}</strong><span>{t.families}</span></div>
          <div><strong>{stats.generalRooms}</strong><span>{t.generalRooms}</span></div>
          <div><strong>{stats.occupiedPothis}/{pothis.length}</strong><span>{t.pothis}</span></div>
          <div><strong>{mealScanLogs.length}</strong><span>{language === "gu" ? "આજના સ્કેન" : "Scans (date)"}</span></div>
        </div>
      </div>

      {status ? <p className="form-message">{status}</p> : null}

      <div className="dashboard-panel dashboard-panel-surface">
        <div className="panel-header panel-header-inline">
          <div>
            <h2>{language === "gu" ? "સ્કેન થયેલા QR" : "Scanned QRs"}</h2>
            <p>
              {language === "gu"
                ? `મીલ સ્કેન લોગ · ${formatIstDisplayDate(mealScanDate)} · કુલ ${mealScanLogs.length}`
                : `Meal scan log · ${formatIstDisplayDate(mealScanDate)} · total ${mealScanLogs.length}`}
            </p>
          </div>
          <div className="scan-logs-actions">
            <label className="scanner-date-field">
              {language === "gu" ? "તારીખ" : "Date"}
              <input
                type="date"
                value={mealScanDate}
                max={todayIstDate()}
                onChange={(event) => setMealScanDate(event.target.value || todayIstDate())}
              />
            </label>
            <button
              className="secondary"
              type="button"
              disabled={mealScansLoading || mealScanDate === todayIstDate()}
              onClick={() => setMealScanDate(todayIstDate())}
            >
              {language === "gu" ? "આજે" : "Today"}
            </button>
            <button
              className="secondary"
              type="button"
              disabled={mealScansLoading}
              onClick={() => void loadMealScans(mealScanDate)}
            >
              {mealScansLoading ? (language === "gu" ? "લોડ..." : "Loading...") : language === "gu" ? "રિફ્રેશ" : "Refresh"}
            </button>
            <button className="primary" type="button" disabled={mealScansLoading} onClick={() => void downloadScanLog()}>
              {language === "gu" ? "એક્સપોર્ટ" : "Export EOD"}
            </button>
          </div>
        </div>

        <div className="scan-log-filters" role="group" aria-label="Filter scanned QRs">
          {(
            [
              { id: "all" as const, label: language === "gu" ? "બધા" : "All", count: mealScanLogs.length },
              { id: "breakfast" as const, label: language === "gu" ? "નાસ્તો" : "Breakfast", count: mealScanCounts.breakfast },
              { id: "lunch" as const, label: language === "gu" ? "બપોરનું" : "Lunch", count: mealScanCounts.lunch },
              { id: "dinner" as const, label: language === "gu" ? "રાત્રિ" : "Dinner", count: mealScanCounts.dinner },
            ] as const
          ).map((option) => (
            <button
              key={option.id}
              type="button"
              className={mealScanFilter === option.id ? "scan-log-filter scan-log-filter--active" : "scan-log-filter"}
              onClick={() => setMealScanFilter(option.id)}
            >
              {option.label}
              <span>{option.count}</span>
            </button>
          ))}
        </div>

        {mealScansLoading && !mealScanLogs.length ? (
          <p className="form-message">{language === "gu" ? "સ્કેન લોડ થઈ રહ્યા છે..." : "Loading scanned QRs…"}</p>
        ) : mealScanLogs.length === 0 ? (
          <p className="form-message">{language === "gu" ? "આ તારીખે કોઈ સ્કેન નથી." : "No scans for this date yet."}</p>
        ) : visibleMealScans.length === 0 ? (
          <p className="form-message">{language === "gu" ? "આ ફિલ્ટરમાં સ્કેન નથી." : "No scans for this meal filter."}</p>
        ) : (
          <ul className="scan-logs-list admin-scan-logs-list">
            {visibleMealScans.map((row) => {
              const card = row.meal_qr_codes;
              const mealLabel = row.meal_type.charAt(0).toUpperCase() + row.meal_type.slice(1);
              return (
                <li key={row.id} className={`scan-log-row scan-log-row--${row.meal_type}`}>
                  <span className="scan-log-meal">{mealLabel}</span>
                  <div className="scan-log-copy">
                    <strong>{card?.member_name || "Guest"}</strong>
                    <span>
                      {[
                        card?.category,
                        card?.pothi ? `Pothi ${card.pothi}` : "",
                        card?.room ? `Room ${card.room}` : "",
                        card?.city,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </span>
                  </div>
                  <time className="scan-log-time" dateTime={row.scanned_at}>
                    {formatIstTime(row.scanned_at)}
                  </time>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="dashboard-panel dashboard-panel-surface pothi-occupancy-panel">
        <div className="panel-header panel-header-inline">
          <div>
            <h2>{t.pothiOccupancy}</h2>
            <p>{language === "gu" ? "ચેકબોક્સ ટિક થયેલ હોય તો પોથી ભરાયેલી છે. ક્લિક કરીને ફિલ્ટર કરો." : "Checked boxes are occupied pothis. Click a number to filter the dashboard."}</p>
          </div>
          <div className="pothi-occupancy-legend">
            <span className="pothi-legend-item occupied"><input type="checkbox" checked readOnly tabIndex={-1} aria-hidden="true" /> {language === "gu" ? "ભરાયેલી" : "Occupied"}</span>
            <span className="pothi-legend-item"><input type="checkbox" readOnly tabIndex={-1} aria-hidden="true" /> {language === "gu" ? "ખાલી" : "Open"}</span>
            <strong>{stats.occupiedPothis}/{pothis.length}</strong>
          </div>
        </div>
        <PothiGrid
          pothis={pothis}
          selected={searchPothi === "all" ? undefined : Number(searchPothi)}
          onSelect={(id) => setSearchPothi((current) => current === String(id) ? "all" : String(id))}
        />
      </div>

      <div className="dashboard-panel dashboard-panel-surface">
        <div className="panel-header panel-header-inline">
          <div>
            <h2>{t.filtersTitle}</h2>
            <p>{language === "gu" ? "સમગ્ર ડેશબોર્ડમાં એક જ શોધથી મહેમાન અને રૂમ શોધો." : "Search the entire dashboard from one place."}</p>
          </div>
        </div>
        <div className="master-search-row">
          <input aria-label={t.filtersTitle} placeholder={t.masterSearch} value={masterSearch} onChange={(event) => setMasterSearch(event.target.value)} />
          <select aria-label="Venue" value={searchVenue} onChange={(event) => setSearchVenue(event.target.value)}>
            <option value="all">{language === "gu" ? "બધા વેન્યુ" : "All venues"}</option>
            {venueNames.map((venue) => <option key={venue} value={venue}>{venue}</option>)}
          </select>
          <select aria-label="Room type" value={searchType} onChange={(event) => setSearchType(event.target.value)}>
            <option value="all">{language === "gu" ? "બધા પ્રકાર" : "All room types"}</option>
            <option value="pothi_room">{t.yajmanRoom}</option>
            <option value="private_room">{t.privateRoomGuests}</option>
            <option value="general_room">{t.generalRoomGuests}</option>
          </select>
          <select aria-label="Pothi" value={searchPothi} onChange={(event) => setSearchPothi(event.target.value)}>
            <option value="all">{language === "gu" ? "બધી પોથી" : "All pothis"}</option>
            {pothis.map((pothi) => <option key={pothi.id} value={String(pothi.id)}>Pothi {pothi.id}</option>)}
          </select>
          <label className="date-filter-field"><span>{t.addedFrom}</span><input type="date" value={addedFrom} onChange={(event) => setAddedFrom(event.target.value)} /></label>
          <label className="date-filter-field"><span>{t.addedTo}</span><input type="date" value={addedTo} onChange={(event) => setAddedTo(event.target.value)} /></label>
          {masterSearch || addedFrom || addedTo || searchVenue !== "all" || searchType !== "all" || searchPothi !== "all" ? <button type="button" className="secondary" onClick={() => { setMasterSearch(""); setAddedFrom(""); setAddedTo(""); setSearchVenue("all"); setSearchType("all"); setSearchPothi("all"); }}>{language === "gu" ? "સાફ કરો" : "Clear"}</button> : null}
        </div>
      </div>

      <GuestEditorPanel
        language={language}
        members={filtered}
        rooms={roomsInventory}
        onSaved={load}
        onStatus={setStatus}
        onCancelGuest={cancelReservation}
      />

      <div className="dashboard-panel dashboard-panel-surface">
        <div className="panel-header panel-header-inline">
          <div>
            <h2>{language === "gu" ? "રૂમ" : "Rooms"}</h2>
            <p>{language === "gu" ? "ટૂંકા વેન્યુ નામ સાથે ઓક્યુપન્સી." : "Occupancy with short venue names."}</p>
          </div>
        </div>
        <div className="venue-tabs" role="tablist" aria-label={language === "gu" ? "વેન્યુ પસંદ કરો" : "Select venue"}>
          <button type="button" className={selectedVenue === "occupied" ? "active" : "secondary"} onClick={() => setSelectedVenue("occupied")}>
            {language === "gu" ? "ભરાયેલા" : "Occupied"}
          </button>
          <button type="button" className={selectedVenue === "vacant" ? "active" : "secondary"} onClick={() => setSelectedVenue("vacant")}>
            {language === "gu" ? "ખાલી" : "Vacant"}
          </button>
          <button type="button" className={selectedVenue === "all" ? "active" : "secondary"} onClick={() => setSelectedVenue("all")}>
            {language === "gu" ? "બધા" : "All"}
          </button>
          {venueNames.map((venue) => (
            <button type="button" key={venue} className={selectedVenue === venue ? "active" : "secondary"} onClick={() => setSelectedVenue(venue)}>
              {venue}
            </button>
          ))}
        </div>
        <div className="room-allocation-board">
          {visibleRoomCards.map(({ room, occupants }) => (
            <article className="room-allocation-card" key={room.id || room.room_number}>
              <div className="room-allocation-head">
                <div>
                  <strong>{shortRoom(room)}</strong>
                  <small>{shortVenue(room)}{room.floor ? ` ${room.floor}` : ""} · {room.total_capacity}</small>
                </div>
                <StatusPill tone={occupants.length >= room.total_capacity ? "red" : occupants.length > 0 ? "amber" : "gray"}>
                  {occupants.length}/{room.total_capacity}
                </StatusPill>
              </div>
              <div className="allocation-occupants">
                {occupants.length ? occupants.map((member) => <span key={member.id}>{member.name}</span>) : <span>{language === "gu" ? "ખાલી" : "Vacant"}</span>}
              </div>
            </article>
          ))}
        </div>
        {!visibleRoomCards.length ? <p className="empty-note">{language === "gu" ? "આ વેન્યુમાં કોઈ રૂમ મળ્યા નથી." : "No rooms match this view."}</p> : null}
      </div>

      <details className="dashboard-panel dashboard-panel-surface">
        <summary>{language === "gu" ? "વધુ ટૂલ્સ" : "More tools"}</summary>
        <form className="admin-pothi-form" onSubmit={handleAdminPothiRegistration}>
          <div className="admin-pothi-form-top">
            <select value={adminPothiId} onChange={(event) => setAdminPothiId(event.target.value)} required>
              <option value="">{t.selectPothi}</option>
              {pothis.filter((pothi) => !pothi.family_id).map((pothi) => <option key={pothi.id} value={pothi.id}>Pothi {pothi.id}</option>)}
            </select>
            <label><span>{language === "gu" ? "થી" : "Stay from"}</span><input type="date" value={adminStayFrom} onChange={(event) => setAdminStayFrom(event.target.value)} required /></label>
            <label><span>{language === "gu" ? "સુધી" : "Stay to"}</span><input type="date" value={adminStayTo} onChange={(event) => setAdminStayTo(event.target.value)} required /></label>
          </div>
          <div className="admin-member-editor">
            {adminMembers.map((member, index) => (
              <div className="admin-member-row" key={`${index}-${member.name}`}>
                <input placeholder={`${language === "gu" ? "સભ્ય" : "Member"} ${index + 1} name`} value={member.name} onChange={(event) => setAdminMembers((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} required={index === 0} />
                <input type="number" min="1" max="120" placeholder="Age" value={member.age || ""} onChange={(event) => setAdminMembers((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, age: Number(event.target.value) } : item))} />
                <select value={member.gender} onChange={(event) => setAdminMembers((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, gender: event.target.value as FamilyMemberInput["gender"] } : item))}>
                  <option value="male">{language === "gu" ? "પુરુષ" : "Male"}</option><option value="female">{language === "gu" ? "સ્ત્રી" : "Female"}</option><option value="other">{language === "gu" ? "અન્ય" : "Other"}</option>
                </select>
                <input inputMode="numeric" placeholder="Mobile" value={member.mobile} onChange={(event) => setAdminMembers((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, mobile: event.target.value } : item))} required={index === 0} />
                {index > 0 ? <button type="button" className="table-action" onClick={() => setAdminMembers((current) => current.filter((_item, itemIndex) => itemIndex !== index))}>{t.removePerson}</button> : <span className="admin-member-spacer" />}
              </div>
            ))}
          </div>
          <div className="button-row">
            <button type="button" className="secondary" onClick={() => setAdminMembers((current) => [...current, { name: "", age: 18, gender: "male", mobile: "" }])}>{t.addPerson}</button>
            <button type="submit" className="primary" disabled={adminSaving}>{adminSaving ? t.savingRegistration : t.saveRegistration}</button>
          </div>
        </form>
        <PothiGrid
          pothis={pothis}
          selected={adminPothiId ? Number(adminPothiId) : undefined}
          onSelect={(id) => {
            const pothi = pothis.find((item) => item.id === id);
            if (!pothi?.family_id) setAdminPothiId(String(id));
          }}
        />
      </details>
    </section>
  );
}
