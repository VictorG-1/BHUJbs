import { useEffect, useMemo, useState } from "react";
import JSZip from "jszip";
import QRCode from "qrcode";
import type { Session } from "@supabase/supabase-js";
import fallbackPothisData from "../data/pothis.json";
import fallbackRoomsData from "../data/rooms.json";
import { PothiGrid } from "../components/PothiGrid";
import { qrPayload } from "../components/MemberQrCode";
import { StatusPill } from "../components/StatusPill";
import { downloadAdminWorkbook, downloadExportData } from "../lib/api";
import { supabase } from "../lib/supabase";
import type { AdminMemberRow, Pothi, RoomInventory } from "../lib/types";

type Language = "en" | "gu";

function normalizeRoom(room: Partial<RoomInventory> & { capacity?: number | null }): RoomInventory {
  return {
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
  return room.venue_name.toUpperCase() === "HOTEL" && room.section_name ? room.section_name : room.venue_name;
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
    yajmanRoom: "Pothi Yajman room",
    privateRoomGuests: "Private room guests",
    generalRoomGuests: "General room guests",
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
    yajmanRoom: "પોથી યજમાન રૂમ",
    privateRoomGuests: "પ્રાઇવેટ રૂમ મહેમાન",
    generalRoomGuests: "જનરલ રૂમ મહેમાન",
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
  }
} as const;

type AdminPageProps = {
  language?: Language;
};

export function AdminPage({ language = "en" }: AdminPageProps) {
  const t = copy[language];
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [members, setMembers] = useState<AdminMemberRow[]>([]);
  const [scanLogs, setScanLogs] = useState<Array<{ id: string; scan_type: string; scanned_at: string; members?: { name?: string } | null }>>([]);
  const [pothis, setPothis] = useState<Pothi[]>(fallbackPothis);
  const [roomsInventory, setRoomsInventory] = useState<RoomInventory[]>(fallbackRooms);
  const [masterSearch, setMasterSearch] = useState("");
  const [searchVenue, setSearchVenue] = useState("all");
  const [searchType, setSearchType] = useState("all");
  const [searchPothi, setSearchPothi] = useState("all");
  const [selectedVenue, setSelectedVenue] = useState("all");
  const [status, setStatus] = useState("");

  async function load() {
    const [{ data: memberData, error: memberError }, { data: pothiData, error: pothiError }, { data: roomData, error: roomError }, { data: scanData, error: scanError }] = await Promise.all([
      supabase
        .from("members")
        .select("id, name, age, gender, mobile, is_head, qr_token, qr_revoked_at, families(id, head_name, head_mobile, city, wants_stay, pothi_id, reference_pothi_id, registration_type, private_room_number), room_allocations(rooms(room_number, venue_name, section_name))")
        .order("name"),
      supabase.from("pothis").select("id, family_id").order("id"),
      supabase
        .from("rooms")
        .select("room_number, venue_name, section_name, source_room_number, floor, ac_type, bed_count, extra_count, capacity, owner_type, linked_pothi_id, allotment_note, room_type, sort_order")
        .order("sort_order"),
      supabase.from("qr_scans").select("id, scan_type, scanned_at, members(name)").order("scanned_at", { ascending: false }).limit(100)
    ]);

    const queryError = memberError ?? pothiError ?? roomError ?? scanError;
    if (queryError) {
      setStatus(queryError.message);
      return;
    }

    setMembers((memberData ?? []) as unknown as AdminMemberRow[]);
    setPothis((pothiData ?? []) as Pothi[]);
    setRoomsInventory(((roomData ?? []) as Array<RoomInventory & { capacity?: number | null }>).map(normalizeRoom));
    setScanLogs((scanData ?? []) as typeof scanLogs);
    setStatus("");
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) {
      void load();
    }
  }, [session]);

  const filtered = useMemo(() => {
    const query = masterSearch.trim().toLowerCase();
    return members.filter((member) => {
      const family = member.families;
      const roomDetails = member.room_allocations?.[0]?.rooms;
      const room = roomDetails?.room_number ?? "";
      const pothi = family?.pothi_id ?? family?.reference_pothi_id ?? "";
      const memberVenue = roomDetails?.venue_name?.toUpperCase() === "HOTEL" && roomDetails?.section_name
        ? roomDetails.section_name
        : roomDetails?.venue_name ?? "";
      if (searchVenue !== "all" && memberVenue !== searchVenue) return false;
      if (searchType !== "all" && family?.registration_type !== searchType) return false;
      if (searchPothi !== "all" && String(pothi) !== searchPothi) return false;
      const haystack = [member.name, member.mobile, family?.head_name, family?.head_mobile, family?.city, room, pothi, family?.registration_type]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return !query || haystack.includes(query);
    });
  }, [masterSearch, members, searchPothi, searchType, searchVenue]);

  const occupiedRooms = useMemo(() => {
    const map = new Map<string, AdminMemberRow[]>();
    for (const member of members) {
      const room = member.room_allocations?.[0]?.rooms?.room_number;
      if (!room) continue;
      map.set(room, [...(map.get(room) ?? []), member]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [members]);

  const roomAllocationBoard = useMemo(() => {
    const occupancy = new Map<string, AdminMemberRow[]>();
    for (const member of members) {
      const room = member.room_allocations?.[0]?.rooms?.room_number;
      if (!room) continue;
      occupancy.set(room, [...(occupancy.get(room) ?? []), member]);
    }

    return roomsInventory
      .filter((room) => selectedVenue === "all" || venueTabName(room) === selectedVenue)
      .filter((room) => searchVenue === "all" || venueTabName(room) === searchVenue)
      .filter((room) => searchType === "all" || room.room_type === searchType)
      .filter((room) => searchPothi === "all" || String(room.linked_pothi_id ?? "") === searchPothi)
      .filter((room) => {
        const query = masterSearch.trim().toLowerCase();
        if (!query) return true;
        return [room.room_number, room.venue_name, room.section_name, room.room_type, room.owner_type, room.linked_pothi_id]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
      .map((room) => ({
        room,
        occupants: occupancy.get(room.room_number) ?? []
      }))
      .sort((left, right) => {
        const venueCompare = left.room.venue_name.localeCompare(right.room.venue_name);
        if (venueCompare !== 0) return venueCompare;
        const orderCompare = (left.room.sort_order ?? 9999) - (right.room.sort_order ?? 9999);
        if (orderCompare !== 0) return orderCompare;
        return left.room.room_number.localeCompare(right.room.room_number);
      });
  }, [masterSearch, members, roomsInventory, searchPothi, searchType, searchVenue, selectedVenue]);

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

  const exportMembers = useMemo(
    () =>
      members.map((member) => {
        const family = member.families;
        const roomDetails = member.room_allocations?.[0]?.rooms;
        const registrationType = family?.registration_type ?? "";
        return {
          name: member.name,
          age: member.age,
          gender: member.gender,
          mobile: member.mobile ?? "",
          family_id: family?.id ?? "",
          family_name: family?.head_name ?? "",
          family_mobile: family?.head_mobile ?? "",
          city: family?.city ?? "",
          registration_type: registrationType,
          pothi: registrationType === "general_room"
            ? "General"
            : family?.pothi_id ?? family?.reference_pothi_id ?? "",
          venue: roomDetails?.venue_name ?? "",
          room: roomDetails?.room_number ?? ""
        };
      }),
    [members]
  );

  const exportPothis = useMemo(
    () =>
      pothis.map((pothi) => ({
        id: pothi.id,
        primary_holder_name: pothi.primary_holder_name ?? "",
        city: pothi.city ?? "",
        contact_name: pothi.contact_name ?? "",
        contact_mobile: pothi.contact_mobile ?? "",
        family_id: pothi.family_id ?? "",
        status: pothi.family_id ? (language === "gu" ? "ભરાયેલ" : "Occupied") : language === "gu" ? "ખાલી" : "Open"
      })),
    [language, pothis]
  );

  const exportRooms = useMemo(
    () =>
      roomsInventory.map((room) => ({
        room_number: room.room_number,
        venue_name: room.venue_name,
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
        pothis: exportPothis,
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
      for (const member of members) {
        if (!member.qr_token) continue;
        const roomDetails = member.room_allocations?.[0]?.rooms;
        const dataUrl = await QRCode.toDataURL(qrPayload({
          ...member,
          family_code: member.families?.id ?? "",
          venue: roomDetails?.venue_name ?? "",
          room: roomDetails?.room_number ?? ""
        }), { width: 500, margin: 2 });
        zip.file(`${member.name.replace(/[^a-z0-9]+/gi, "-") || member.id}-qr.png`, dataUrl.split(",")[1], { base64: true });
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = "bhagwat-saptah-member-qr-codes.zip"; anchor.click(); URL.revokeObjectURL(url);
      setStatus(language === "gu" ? "બધા QR કોડ ડાઉનલોડ થયા." : "All QR codes downloaded.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "QR download failed."); }
  }

  function downloadScanLog() {
    const rows = [["guest_name", "scan_type", "scanned_at"], ...scanLogs.map((scan) => [scan.members?.name ?? "", scan.scan_type, scan.scanned_at])];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "bhagwat-saptah-qr-scan-log.csv"; anchor.click(); URL.revokeObjectURL(url);
  }

  async function revokeQr(member: AdminMemberRow) {
    if (member.qr_revoked_at || !window.confirm(`Revoke QR for ${member.name}?`)) return;
    const { error } = await supabase.from("members").update({ qr_revoked_at: new Date().toISOString() }).eq("id", member.id);
    if (error) { setStatus(error.message); return; }
    setMembers((current) => current.map((item) => item.id === member.id ? { ...item, qr_revoked_at: new Date().toISOString() } : item));
    setStatus(`QR revoked for ${member.name}.`);
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
    <section className="page-section">
      <div className="admin-shell">
        <div className="admin-hero">
          <div className="dashboard-hero dashboard-hero-wide">
            <p className="eyebrow">{t.eyebrow}</p>
            <h1>{t.title}</h1>
            <p>{t.subtitle}</p>
          </div>
          <div className="admin-hero-meta">
            <div>
              <span>{language === "gu" ? "મોડ" : "Mode"}</span>
              <strong>{language === "gu" ? "લાઇવ" : "Live"}</strong>
            </div>
            <div>
              <span>{language === "gu" ? "પોથી" : "Pothis"}</span>
              <strong>{stats.occupiedPothis}/75</strong>
            </div>
            <div>
              <span>{language === "gu" ? "રૂમ" : "Rooms"}</span>
              <strong>{roomsInventory.length}</strong>
            </div>
          </div>
          <div className="admin-actions admin-actions-bar">
            <button className="secondary" onClick={handleWorkbookExport}>{language === "gu" ? "એક્સેલ વર્કબુક" : "Excel workbook"}</button>
            <button className="secondary" onClick={handleExport}>{t.exportCsv}</button>
            <button className="secondary" onClick={handleQrBulkDownload}>{language === "gu" ? "બધા QR ડાઉનલોડ" : "Download all QR codes"}</button>
            <button className="secondary" onClick={downloadScanLog}>{language === "gu" ? "સ્કેન લોગ" : "Export scan log"}</button>
            <a className="secondary button-link" href="/scanner">QR scanner</a>
            <button className="secondary" onClick={() => supabase.auth.signOut()}>{t.signOut}</button>
          </div>
        </div>
      </div>

      <div className="dashboard-panel dashboard-panel-hero">
        <div className="panel-header panel-header-inline">
          <div>
            <h2>{language === "gu" ? "ઝાંખી" : "Overview"}</h2>
            <p>{language === "gu" ? "એક નજરમાં નોંધણી, રૂમ અને પોથી સ્થિતિ." : "A quick read on registrations, rooms and pothis."}</p>
          </div>
          <div className="summary-note">
            <span>{language === "gu" ? "તૈયાર" : "Ready"}</span>
            <strong>{language === "gu" ? "લાઇવ ડેશબોર્ડ" : "Live dashboard"}</strong>
          </div>
        </div>
        <div className="metric-row admin-metric-row">
          <div><strong>{stats.families}</strong><span>{t.families}</span></div>
          <div><strong>{stats.members}</strong><span>{t.members}</span></div>
          <div><strong>{stats.pothiRooms}</strong><span>{t.pothiRooms}</span></div>
          <div><strong>{stats.privateRooms}</strong><span>{t.privateRooms}</span></div>
          <div><strong>{stats.generalRooms}</strong><span>{t.generalRooms}</span></div>
          <div><strong>{stats.occupiedPothis}/75</strong><span>{t.pothis}</span></div>
        </div>
      </div>

      {status ? <p className="form-message">{status}</p> : null}

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
          {masterSearch ? <button type="button" className="secondary" onClick={() => setMasterSearch("")}>{language === "gu" ? "સાફ કરો" : "Clear"}</button> : null}
        </div>
      </div>

      <div className="dashboard-panel dashboard-panel-surface">
        <div className="panel-header panel-header-inline">
          <div><h2>{language === "gu" ? "QR સ્કેન રેકોર્ડ" : "QR scan record"}</h2><p>{language === "gu" ? "તાજેતરના માન્ય પ્રવેશ સ્કેન." : "Recent QR validations recorded during the event."}</p></div>
        </div>
        <div className="table-wrap">
          <table><thead><tr><th>{t.name}</th><th>{language === "gu" ? "પ્રકાર" : "Scan type"}</th><th>{language === "gu" ? "સમય" : "Scanned at"}</th></tr></thead>
            <tbody>{scanLogs.map((scan) => <tr key={scan.id}><td>{scan.members?.name ?? "-"}</td><td>{scan.scan_type}</td><td>{new Date(scan.scanned_at).toLocaleString()}</td></tr>)}{!scanLogs.length ? <tr><td colSpan={3}>{language === "gu" ? "હજી કોઈ સ્કેન નથી." : "No QR scans recorded yet."}</td></tr> : null}</tbody>
          </table>
        </div>
      </div>

      <div className="admin-grid">
        <div className="dashboard-panel dashboard-panel-surface">
          <div className="panel-header panel-header-inline">
            <div>
              <h2>{t.guestList}</h2>
              <p>{language === "gu" ? "તમામ મહેમાનો અને તેમના રૂમ સ્ટેટસ." : "All guests and their room status."}</p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t.name}</th>
                  <th>{t.family}</th>
                  <th>{t.pothis}</th>
                  <th>{t.type}</th>
                  <th>{language === "gu" ? "વેન્યુ" : "Venue"}</th>
                  <th>{t.room}</th>
                  <th>QR</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((member) => (
                  <tr key={member.id}>
                    <td>{member.name}</td>
                    <td>{member.families?.head_name}</td>
                    <td>{member.families?.registration_type === "general_room"
                      ? "General"
                      : member.families?.pothi_id ?? member.families?.reference_pothi_id ?? "-"}</td>
                    <td>
                      {member.families?.registration_type === "pothi_room" ? (
                        <StatusPill tone="amber">{t.yajmanRoom}</StatusPill>
                      ) : member.families?.registration_type === "general_room" ? (
                        <StatusPill tone="green">{t.generalRoomGuests}</StatusPill>
                      ) : (
                        <StatusPill tone="blue">{t.privateRoomGuests}</StatusPill>
                      )}
                    </td>
                    <td>{member.room_allocations?.[0]?.rooms?.venue_name ?? "-"}</td>
                    <td>{member.room_allocations?.[0]?.rooms?.room_number ?? "-"}</td>
                    <td><button type="button" className="table-action" disabled={Boolean(member.qr_revoked_at)} onClick={() => void revokeQr(member)}>{member.qr_revoked_at ? "Revoked" : "Revoke"}</button></td>
                  </tr>
                ))}
                {!filtered.length ? (
                  <tr>
                    <td colSpan={7}>{t.noRows}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="dashboard-panel sticky-panel dashboard-panel-surface">
          <div className="panel-header panel-header-inline">
            <div>
              <h2>{t.pothiOccupancy}</h2>
              <p>{language === "gu" ? "ખાલી અને ભરાયેલ પોથીઓનું દૃશ્ય." : "Open and occupied pothis at a glance."}</p>
            </div>
          </div>
          <PothiGrid pothis={pothis} />
        </aside>
      </div>

      <div className="dashboard-panel dashboard-panel-surface">
        <div className="panel-header panel-header-inline">
          <div>
            <h2>{t.registeredView}</h2>
            <p>{language === "gu" ? "વેન્યુ પ્રમાણે જુદું પાડેલ રૂમ અને ઓક્યુપન્સી વિહંગાવલોકન." : "Venue-segregated room and occupancy view."}</p>
          </div>
        </div>
        <div className="venue-tabs" role="tablist" aria-label={language === "gu" ? "વેન્યુ પસંદ કરો" : "Select venue"}>
          <button type="button" className={selectedVenue === "all" ? "active" : "secondary"} onClick={() => setSelectedVenue("all")}>
            {language === "gu" ? "બધા વેન્યુ" : "All venues"}
          </button>
          {venueNames.map((venue) => (
            <button type="button" key={venue} className={selectedVenue === venue ? "active" : "secondary"} onClick={() => setSelectedVenue(venue)}>
              {venue}
            </button>
          ))}
        </div>
        <div className="room-allocation-board">
          {roomAllocationBoard.map(({ room, occupants }) => (
            <article className="room-allocation-card" key={room.room_number}>
              <div className="room-allocation-head">
                <div>
                  <strong>{room.room_number}</strong>
                  <small>{room.total_capacity} {language === "gu" ? "ક્ષમતા" : "capacity"}</small>
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
      </div>
    </section>
  );
}
