import fs from "node:fs";

const data = JSON.parse(fs.readFileSync("scripts/_empty-rooms.json", "utf8"));
const rowsLit = JSON.stringify(data.rows);
const venuesLit = JSON.stringify(Object.entries(data.venues).map(([venue, v]) => ({ venue, rooms: v.rooms, beds: v.beds })));

const src = `import { BarChart, Callout, Grid, H1, H2, Row, Select, Stack, Stat, Table, Text, TextInput, useCanvasState, useMemo } from "cursor/canvas";

type EmptyRoom = {
  venue: string;
  room: string;
  floor: string;
  cap: number;
  type: string;
  pothi: number | null;
  note: string;
};

const EMPTY_ROOMS: EmptyRoom[] = ${rowsLit};

const VENUE_COUNTS = ${venuesLit};

export default function EmptyRoomInventory() {
  const [venue, setVenue] = useCanvasState("venue", "All");
  const [query, setQuery] = useCanvasState("query", "");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return EMPTY_ROOMS.filter((row) => {
      if (venue !== "All" && row.venue !== venue) return false;
      if (!q) return true;
      return [row.room, row.venue, row.note, row.type, row.pothi == null ? "" : String(row.pothi)].join(" ").toLowerCase().includes(q);
    });
  }, [venue, query]);

  const beds = filtered.reduce((sum, row) => sum + (row.cap || 0), 0);
  const tableRows = filtered.map((row) => [
    row.room,
    row.venue,
    row.floor || "-",
    String(row.cap),
    row.type,
    row.pothi == null ? "-" : String(row.pothi),
    row.note || "-"
  ]);

  return (
    <Stack gap={20}>
      <Stack gap={6}>
        <H1>Empty room inventory</H1>
        <Text tone="secondary">Vacant rooms only — pothi-held rooms with a registered family are excluded · 1 Nov 2026</Text>
      </Stack>
      <Callout tone="info" title="Recounted">
        Earlier count treated pothi-tagged hotel/complex rooms as empty even when that pothi family is already registered. Those 18 rooms are no longer listed.
      </Callout>
      <Grid columns={4} gap={12}>
        <Stat value="${data.empty}" label="Empty rooms" />
        <Stat value="${data.emptyBeds}" label="Empty bed capacity" />
        <Stat value="${data.occupied}" label="Rooms with guests" />
        <Stat value={String(filtered.length)} label="Showing now" />
      </Grid>
      <Stack gap={8}>
        <H2>Empty rooms by venue</H2>
        <BarChart
          categories={VENUE_COUNTS.map((row) => row.venue)}
          series={[{ name: "Empty rooms", data: VENUE_COUNTS.map((row) => row.rooms) }]}
          height={280}
          horizontal
          valueSuffix=" rooms"
        />
        <Text size="small" tone="secondary">Source: live room_allocations vs rooms · 1 Nov 2026</Text>
      </Stack>
      <Row gap={12} wrap>
        <Select
          value={venue}
          onChange={setVenue}
          options={[{ value: "All", label: "All venues" }, ...VENUE_COUNTS.map((row) => ({ value: row.venue, label: row.venue + " · " + row.rooms }))]}
        />
        <TextInput value={query} onChange={setQuery} placeholder="Search room, note, pothi…" />
      </Row>
      <Text>
        {filtered.length} rooms · {beds} beds{venue !== "All" ? " in " + venue : ""}
      </Text>
      <Table
        headers={["Room", "Venue", "Floor", "Capacity", "Type", "Pothi", "Note"]}
        rows={tableRows}
        columnAlign={["left", "left", "left", "right", "left", "right", "left"]}
        striped
        stickyHeader
      />
    </Stack>
  );
}
`;

fs.writeFileSync("C:/Users/DELL/.cursor/projects/c-Users-DELL-Documents-New-project/canvases/empty-room-inventory.canvas.tsx", src);
console.log("wrote canvas");
