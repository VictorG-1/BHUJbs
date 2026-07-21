import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import fallbackPothisData from "../data/pothis.json";
import fallbackRoomsData from "../data/rooms.json";
import { PothiGrid } from "../components/PothiGrid";
import { StatusPill } from "../components/StatusPill";
import { downloadExportData } from "../lib/api";
import { checkSupabaseConnection, supabase } from "../lib/supabase";
import type { AdminMemberRow, Pothi, RoomInventory } from "../lib/types";

type Filter = {
  pothi: string;
  type: string;
  room: string;
};

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

const fallbackPothis = fallbackPothisData as Pothi[];
const fallbackRooms = (fallbackRoomsData as Array<RoomInventory & { capacity?: number | null }>).map(normalizeRoom);

export function AdminPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [localMode, setLocalMode] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [members, setMembers] = useState<AdminMemberRow[]>([]);
  const [pothis, setPothis] = useState<Pothi[]>(fallbackPothis);
  const [roomsInventory, setRoomsInventory] = useState<RoomInventory[]>(fallbackRooms);
  const [filters, setFilters] = useState<Filter>({ pothi: "", type: "", room: "" });
  const [status, setStatus] = useState("");
  const [connectionError, setConnectionError] = useState("");

  async function load() {
    const [{ data: memberData, error: memberError }, { data: pothiData, error: pothiError }, { data: roomData, error: roomError }] = await Promise.all([
      supabase
        .from("members")
        .select("id, name, age, gender, mobile, is_head, families(id, head_name, head_mobile, city, wants_stay, pothi_id, reference_pothi_id, registration_type, private_room_number), room_allocations(rooms(room_number, venue_name, section_name))")
        .order("name"),
      supabase.from("pothis").select("id, family_id").order("id"),
      supabase
        .from("rooms")
        .select("room_number, venue_name, section_name, source_room_number, floor, ac_type, bed_count, extra_count, capacity, owner_type, linked_pothi_id, allotment_note, room_type, sort_order")
        .order("sort_order")
    ]);

    const queryError = memberError ?? pothiError ?? roomError;
    if (queryError) {
      setStatus(queryError.message);
      return;
    }

    setMembers((memberData ?? []) as unknown as AdminMemberRow[]);
    setPothis((pothiData ?? []) as Pothi[]);
    setRoomsInventory(((roomData ?? []) as Array<RoomInventory & { capacity?: number | null }>).map(normalizeRoom));
    setStatus("");
  }

  useEffect(() => {
    void checkSupabaseConnection().then((result) => {
      setConnectionError(result.ok ? "" : result.message);
    });
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) {
      setLocalMode(false);
      void load();
    }
  }, [session]);

  useEffect(() => {
    if (!localMode) return;
    setMembers([]);
    setPothis(fallbackPothis);
    setRoomsInventory(fallbackRooms);
    setStatus("Offline admin view loaded.");
  }, [localMode]);

  const filtered = useMemo(() => {
    return members.filter((member) => {
      const family = member.families;
      const room = member.room_allocations?.[0]?.rooms?.room_number ?? "";
      const pothi = family?.pothi_id ?? family?.reference_pothi_id ?? "";
      if (filters.pothi && String(pothi) !== filters.pothi) return false;
      if (filters.type && family?.registration_type !== filters.type) return false;
      if (filters.room && room !== filters.room) return false;
      return true;
    });
  }, [filters, members]);

  const occupiedRooms = useMemo(() => {
    const map = new Map<string, AdminMemberRow[]>();
    for (const member of members) {
      const room = member.room_allocations?.[0]?.rooms?.room_number;
      if (!room) continue;
      map.set(room, [...(map.get(room) ?? []), member]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [members]);

  const inventoryRooms = useMemo(() => {
    return roomsInventory.filter((room) => {
      if (filters.type && room.room_type !== filters.type) return false;
      if (filters.room && room.room_number !== filters.room) return false;
      if (filters.pothi) {
        const linked = room.linked_pothi_id ? String(room.linked_pothi_id) : "";
        if (linked !== filters.pothi) return false;
      }
      return true;
    });
  }, [filters, roomsInventory]);

  const stats = {
    members: members.length,
    families: new Set(members.map((member) => member.families?.id).filter(Boolean)).size,
    pothiRooms: new Set(members.filter((member) => member.families?.registration_type === "pothi_room").map((member) => member.families?.id).filter(Boolean)).size,
    privateRooms: new Set(members.filter((member) => member.families?.registration_type === "private_room").map((member) => member.families?.id).filter(Boolean)).size,
    generalRooms: new Set(members.filter((member) => member.families?.registration_type === "general_room").map((member) => member.families?.id).filter(Boolean)).size,
    occupiedPothis: pothis.filter((pothi) => pothi.family_id).length
  };

  async function handleExport() {
    setStatus("Preparing export...");
    try {
      await downloadExportData();
      setStatus("Export downloaded.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Export failed.");
    }
  }

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    setStatus("Signing in...");

    const connection = await checkSupabaseConnection();
    if (!connection.ok) {
      setConnectionError(connection.message);
      setStatus("Cannot sign in until Supabase is reachable.");
      return;
    }

    try {
      const login = supabase.auth.signInWithPassword({ email, password });
      const timeout = new Promise<{ error: { message: string } }>((resolve) => {
        window.setTimeout(() => resolve({ error: { message: "Login timed out. Check your internet connection and Supabase project URL." } }), 15000);
      });
      const { error } = await Promise.race([login, timeout]);

      if (error) {
        setStatus(error.message);
        return;
      }

      const { data: adminProfile, error: adminError } = await supabase
        .from("admin_profiles")
        .select("user_id")
        .maybeSingle();

      if (adminError) {
        setStatus(adminError.message);
        await supabase.auth.signOut();
        return;
      }

      if (!adminProfile) {
        setStatus("This account is not an admin. Ask an owner to add your user to admin_profiles.");
        await supabase.auth.signOut();
        return;
      }

      setStatus("Admin signed in.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Sign in failed.");
    }
  }

  if (!session && !localMode) {
    return (
      <section className="page-section compact">
        <div className="section-heading">
          <p className="eyebrow">Admin login</p>
          <h1>Sign in to manage guests</h1>
          <p>Use a Supabase Auth account that exists in admin_profiles, or open the offline admin view for the imported allotment data.</p>
        </div>
        {connectionError ? <p className="form-message">{connectionError}</p> : null}
        <form className="scan-panel" onSubmit={handleLogin}>
          <label>
            Email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </label>
          <div className="button-row">
            <button className="primary">Sign in</button>
            <button type="button" className="secondary" onClick={() => setLocalMode(true)}>
              Open offline admin view
            </button>
          </div>
          {status ? <p className="form-message">{status}</p> : null}
        </form>
      </section>
    );
  }

  return (
    <section className="page-section">
      <div className="section-heading">
        <p className="eyebrow">Admin dashboard</p>
        <h1>Guests, rooms and pothis</h1>
        <p>{localMode ? "Offline mode shows the imported pothi and room inventory without live registrations." : "Use Supabase Auth and add admin users to admin_profiles before going live."}</p>
      </div>

      <div className="metric-row">
        <div><strong>{stats.families}</strong><span>Families</span></div>
        <div><strong>{stats.members}</strong><span>Members</span></div>
        <div><strong>{stats.pothiRooms}</strong><span>Pothi rooms</span></div>
        <div><strong>{stats.privateRooms}</strong><span>Private rooms</span></div>
        <div><strong>{stats.generalRooms}</strong><span>General rooms</span></div>
        <div><strong>{stats.occupiedPothis}/75</strong><span>Pothis</span></div>
      </div>

      <div className="admin-actions">
        {!localMode ? <button className="secondary" onClick={handleExport}>Export CSV</button> : null}
        {localMode ? (
          <button className="secondary" onClick={() => { setLocalMode(false); setStatus(""); }}>
            Back to admin login
          </button>
        ) : (
          <button className="secondary" onClick={() => supabase.auth.signOut()}>Sign out</button>
        )}
      </div>
      {status ? <p className="form-message">{status}</p> : null}

      <div className="filter-row">
        <input placeholder="Pothi number" value={filters.pothi} onChange={(event) => setFilters({ ...filters, pothi: event.target.value })} />
        <select value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })}>
          <option value="">All room types</option>
          <option value="pothi_room">Pothi Yajman room</option>
          <option value="private_room">Private room guests</option>
          <option value="general_room">General room guests</option>
        </select>
        <input placeholder="Room number" value={filters.room} onChange={(event) => setFilters({ ...filters, room: event.target.value })} />
      </div>

      <div className="admin-grid">
        <div>
          <h2>Guest list</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Family</th>
                  <th>Pothi</th>
                  <th>Type</th>
                  <th>Room</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((member) => (
                  <tr key={member.id}>
                    <td>{member.name}</td>
                    <td>{member.families?.head_name}</td>
                    <td>{member.families?.pothi_id ?? member.families?.reference_pothi_id ?? "-"}</td>
                    <td>
                      {member.families?.registration_type === "pothi_room" ? (
                        <StatusPill tone="amber">Pothi Yajman room</StatusPill>
                      ) : member.families?.registration_type === "general_room" ? (
                        <StatusPill tone="green">General room</StatusPill>
                      ) : (
                        <StatusPill tone="blue">Private room</StatusPill>
                      )}
                    </td>
                    <td>{member.room_allocations?.[0]?.rooms?.room_number ?? "-"}</td>
                  </tr>
                ))}
                {!filtered.length ? (
                  <tr>
                    <td colSpan={5}>{localMode ? "No live registrations in offline mode yet." : "No registrations found for the current filters."}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <aside>
          <h2>Pothi occupancy</h2>
          <PothiGrid pothis={pothis} />
        </aside>
      </div>

      <div>
        <h2>{localMode ? "Imported room inventory" : "Registered room view"}</h2>
        <div className="room-grid">
          {localMode
            ? inventoryRooms.map((room) => (
                <article className="room-card" key={room.room_number}>
                  <strong>{room.room_number}</strong>
                  <span>{`${room.room_type.replace("_", " ")} | ${room.total_capacity} beds`}</span>
                  <small>{[room.venue_name, room.section_name, room.floor].filter(Boolean).join(" | ")}</small>
                  <small>{room.linked_pothi_id ? `Pothi ${room.linked_pothi_id}` : "General inventory"}</small>
                </article>
              ))
            : occupiedRooms.map(([room, occupants]) => (
                <article className="room-card" key={room}>
                  <strong>{room}</strong>
                  <span>{occupants.length}/4</span>
                  {occupants.map((member) => <small key={member.id}>{member.name}</small>)}
                </article>
              ))}
        </div>
      </div>
    </section>
  );
}
