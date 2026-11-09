import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/svelte";
import Page from "./+page.svelte";

// ---------------------------------------------------------------------------
// Environment: the page talks to SvelteKit navigation and the SQL layer only;
// both are stubbed so the tests pin the list/filter behaviour.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  goto: vi.fn(),
  url: new URL("http://localhost/tenants"),
  tenants: [] as Record<string, unknown>[],
  rooms: [] as Record<string, unknown>[],
}));

vi.mock("$app/navigation", () => ({ goto: h.goto }));
vi.mock("$app/state", () => ({
  page: {
    get url() {
      return h.url;
    },
  },
}));
vi.mock("$lib/db/db", () => ({
  getDb: async () => ({
    select: async (sql: string) =>
      sql.includes("JOIN rooms r ON r.id = t.room_id") ? h.tenants : h.rooms,
    execute: async () => {},
  }),
}));
vi.mock("$lib/db/settings", () => ({ getSetting: async () => "1" }));
vi.mock("$lib/ui/toast.svelte", () => ({ pushToast: vi.fn() }));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** ISO date `days` from today, so bucket membership never depends on the clock. */
function iso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function tenant(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: "Maria",
    contact: "0917",
    room_id: 1,
    room_number: "Room A",
    move_in_date: "2026-01-01",
    due_date: iso(40),
    last_paid_date: null,
    monthly_rate: 2500,
    beds_occupied: 1,
    moved_out_date: null,
    deposit_held: 0,
    deposit_refunded: 0,
    advance_held: 0,
    advance_months: 0,
    deposit_amount: null,
    amenity_balance: 0,
    backfilled: 0,
    ...over,
  };
}

const PAID = tenant({ id: 1, name: "Maria", last_paid_date: iso(-2) });
const DUE_SOON = tenant({ id: 2, name: "Jose", due_date: iso(3) });
const OVERDUE = tenant({ id: 3, name: "Ana", due_date: iso(-5) });
const ARCHIVED = tenant({ id: 4, name: "Old Boarder", moved_out_date: "2026-08-01" });

beforeEach(() => {
  h.goto.mockReset();
  h.url = new URL("http://localhost/tenants");
  h.tenants = [PAID, DUE_SOON, OVERDUE, ARCHIVED];
  h.rooms = [{ id: 1, room_number: "Room A", capacity: 2, monthly_rate: 2500, maintenance: 0, occupied_beds: 2, whole_reservations: 0, held_beds: 0 }];
});

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

describe("tenants page — list", () => {
  it("lists active tenants with their room and hides archived ones", async () => {
    render(Page);

    expect(await screen.findByText("Maria")).toBeTruthy();
    expect(screen.getByText("Jose")).toBeTruthy();
    expect(screen.getByText("Ana")).toBeTruthy();
    expect(screen.queryByText("Old Boarder")).toBeNull();
    // Header count is the active total, not the loaded row count.
    expect(screen.getByText("3 tenants in total")).toBeTruthy();
  });

  it("switches to the Archived tab", async () => {
    render(Page);
    await screen.findByText("Maria");

    await fireEvent.click(screen.getByRole("button", { name: "Archived" }));

    expect(await screen.findByText("Old Boarder")).toBeTruthy();
    expect(screen.queryByText("Maria")).toBeNull();
  });

  it("searches by name and shows a no-match message", async () => {
    render(Page);
    await screen.findByText("Maria");

    const search = screen.getByLabelText("Search tenants");
    await fireEvent.input(search, { target: { value: "jose" } });

    await waitFor(() => expect(screen.queryByText("Maria")).toBeNull());
    expect(screen.getByText("Jose")).toBeTruthy();

    await fireEvent.input(search, { target: { value: "zzz" } });
    expect(await screen.findByText("No tenants match “zzz”.")).toBeTruthy();
  });

  it("shows the empty state when there are no tenants at all", async () => {
    h.tenants = [];
    render(Page);

    expect(await screen.findByText("No tenants yet. Add one to link a room.")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Payment-status filter (URL is the source of truth)
// ---------------------------------------------------------------------------

describe("tenants page — status filter", () => {
  it("pushes ?status= when a chip is tapped", async () => {
    render(Page);
    await screen.findByText("Maria");

    await fireEvent.click(screen.getByRole("button", { name: "Due soon" }));

    expect(h.goto).toHaveBeenCalledWith("/tenants?status=due-soon", { keepFocus: true, noScroll: true });
  });

  it("clears the status when the active chip is tapped again", async () => {
    h.url = new URL("http://localhost/tenants?status=paid");
    render(Page);
    await screen.findByText("Maria");

    await fireEvent.click(screen.getByRole("button", { name: "Paid" }));

    expect(h.goto).toHaveBeenCalledWith("/tenants", { keepFocus: true, noScroll: true });
  });

  it("filters to the bucket in a deep link", async () => {
    h.url = new URL("http://localhost/tenants?status=due-soon");
    render(Page);

    expect(await screen.findByText("Jose")).toBeTruthy();
    expect(screen.queryByText("Maria")).toBeNull();
    expect(screen.queryByText("Ana")).toBeNull();
  });

  it("freezes bucket membership after a reload, so a recorded payment does not drop a card", async () => {
    h.url = new URL("http://localhost/tenants?status=due");
    render(Page);
    expect(await screen.findByText("Ana")).toBeTruthy();

    // Simulate the optimistic reload the page does after a mutation: Ana now
    // has a payment, so a live bucket query would move her to "paid".
    h.tenants = [tenant({ ...OVERDUE, last_paid_date: iso(0) })];

    await fireEvent.input(screen.getByLabelText("Search tenants"), { target: { value: "a" } });
    await fireEvent.input(screen.getByLabelText("Search tenants"), { target: { value: "" } });

    expect(screen.getByText("Ana")).toBeTruthy();
  });
});
