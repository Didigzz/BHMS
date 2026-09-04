<script lang="ts">
  import { onMount } from "svelte";
  import { daysUntilDue, getPaymentStatus } from "$lib/payment-status";
  import { getDb } from "$lib/db";
  import { ROOM_STATUS_SQL, type RoomStatus } from "$lib/room-status";
  import type { BoarderSheetRoom } from "$lib/rooms";
  import StatCards from "./StatCards.svelte";
  import DashboardRoomCard from "./DashboardRoomCard.svelte";
  import RoomDetailSheet from "$lib/components/RoomDetailSheet.svelte";
  import EarningsCard from "./EarningsCard.svelte";
  import { currentMonthKey, type EarningsPayment, type EarningsTenant } from "$lib/earnings";
  import type { DashboardRoom, TenantChip } from "./types";

  let rooms: DashboardRoom[] = $state([]);
  let loading = $state(true);
  let error: string | null = $state(null);
  let earningsTenants: EarningsTenant[] = $state([]);
  let earningsPayments: EarningsPayment[] = $state([]);
  let earningsMonth = $state(currentMonthKey());

  // Boarder detail sheet — which room's boarders are on display (read-only).
  let detailRoom: BoarderSheetRoom | null = $state(null);

  /** Map a dashboard room onto the shape the boarder sheet needs. */
  function openDetail(room: DashboardRoom) {
    detailRoom = {
      id: room.id,
      room_number: room.room_number,
      capacity: room.capacity,
      monthly_rate: room.monthly_rate,
      status: room.status,
      occupied_beds: room.occupied_beds,
      held_beds: room.held_beds,
    };
  }

  async function loadDashboard() {
    try {
      const db = await getDb();
      const roomRows = await db.select<
        {
          id: number;
          room_number: string;
          capacity: number;
          monthly_rate: number;
          status: RoomStatus;
          occupied_beds: number;
        }[]
      >(`SELECT r.id, r.room_number, r.capacity, r.monthly_rate, ${ROOM_STATUS_SQL} AS status,
                COALESCE((SELECT SUM(t.beds_occupied) FROM tenants t WHERE t.room_id = r.id AND t.moved_out_date IS NULL), 0) AS occupied_beds
         FROM rooms r ORDER BY r.id`);
      const tenantRows = await db.select<
        { id: number; room_id: number; name: string; due_date: string; last_paid_date: string | null }[]
      >("SELECT id, room_id, name, due_date, last_paid_date FROM tenants WHERE moved_out_date IS NULL ORDER BY name");
      const reservationRows = await db.select<
        { room_id: number; name: string; hold_type: string; bed_count: number | null }[]
      >("SELECT room_id, name, hold_type, bed_count FROM reservations WHERE status = 'active'");
      // Monthly earnings data: every tenant (incl. archived, for mid-month
      // move-outs) with their rate, plus all payment coverage.
      earningsTenants = await db.select<EarningsTenant[]>(
        `SELECT t.id, t.name, r.room_number, t.move_in_date, t.moved_out_date,
                COALESCE(t.monthly_rate, r.monthly_rate) AS rate
         FROM tenants t JOIN rooms r ON r.id = t.room_id`
      );
      earningsPayments = await db.select<EarningsPayment[]>(
        "SELECT tenant_id, amount, covers_month, due_date FROM payments"
      );

      const byRoom = new Map<number, TenantChip[]>();
      for (const t of tenantRows) {
        const chip: TenantChip = {
          id: t.id,
          name: t.name,
          dueDate: t.due_date,
          lastPaidDate: t.last_paid_date,
          status: getPaymentStatus(t.due_date, new Date(), t.last_paid_date),
          daysUntil: daysUntilDue(t.due_date, new Date(), t.last_paid_date),
        };
        const list = byRoom.get(t.room_id) ?? [];
        list.push(chip);
        byRoom.set(t.room_id, list);
      }

      // A room may now hold several active reservations: track the whole-room
      // hold's name separately from the summed partial bed counts.
      const byReservation = new Map<number, { whole_name: string | null; held_beds: number }>();
      for (const r of reservationRows) {
        const entry = byReservation.get(r.room_id) ?? { whole_name: null, held_beds: 0 };
        if (r.hold_type === "whole") entry.whole_name = entry.whole_name ?? r.name;
        else entry.held_beds += r.bed_count ?? 0;
        byReservation.set(r.room_id, entry);
      }

      rooms = roomRows.map((r) => {
        const tenants = byRoom.get(r.id) ?? [];
        const holds = byReservation.get(r.id);
        return {
          ...r,
          whole_hold_name: holds?.whole_name ?? null,
          held_beds: holds?.held_beds ?? 0,
          tenants,
        };
      });
    } catch (e) {
      error = `Failed to load dashboard: ${String(e)}`;
    } finally {
      loading = false;
    }
  }

  onMount(loadDashboard);

  /**
   * Re-run exactly the two earnings queries after a payment mutation from the
   * boarder sheet, so the Monthly Earnings card (and an open View Breakdown)
   * update immediately — no tab switch or reload needed (payment-due-date-spec
   * §5). `summary` in EarningsCard is $derived from these arrays, so both the
   * headline numbers and the open breakdown refresh in place.
   */
  async function refreshEarnings() {
    try {
      const db = await getDb();
      earningsTenants = await db.select<EarningsTenant[]>(
        `SELECT t.id, t.name, r.room_number, t.move_in_date, t.moved_out_date,
                COALESCE(t.monthly_rate, r.monthly_rate) AS rate
         FROM tenants t JOIN rooms r ON r.id = t.room_id`
      );
      earningsPayments = await db.select<EarningsPayment[]>(
        "SELECT tenant_id, amount, covers_month, due_date FROM payments"
      );
    } catch {
      // Keep the current numbers — the sheet already surfaced any error.
    }
  }

  // Stat cards count people (chips), not beds — a multi-bed tenant is still
  // one tenant.
  const totalTenants = $derived(rooms.reduce((acc, r) => acc + r.tenants.length, 0));
  const occupiedRooms = $derived(rooms.filter((r) => r.tenants.length > 0).length);
  const overdueCount = $derived(
    rooms.reduce((acc, r) => acc + r.tenants.filter((t) => t.status === "red").length, 0)
  );
  const dueSoonCount = $derived(
    rooms.reduce((acc, r) => acc + r.tenants.filter((t) => t.status !== "red" && t.daysUntil <= 7).length, 0)
  );
</script>

<main>
  <header class="page-header">
    <h1>Dashboard</h1>
    <p class="subtitle">At-a-glance overview of the boarding house</p>
  </header>

  {#if error}
    <div class="alert">{error}</div>
  {/if}

  {#if !loading}
    <EarningsCard tenants={earningsTenants} payments={earningsPayments} bind:month={earningsMonth} />
  {/if}

  {#if !loading && rooms.length > 0}
    <StatCards roomCount={rooms.length} tenantCount={totalTenants} occupiedCount={occupiedRooms} />

    {#if overdueCount + dueSoonCount > 0}
      <div class="summary-strip" aria-label="Payment summary">
        {#if overdueCount > 0}
          <span class="summary-item summary-overdue">🔴 {overdueCount} overdue</span>
        {/if}
        {#if dueSoonCount > 0}
          <span class="summary-item summary-soon">🟡 {dueSoonCount} due this week</span>
        {/if}
      </div>
    {/if}

    <ul class="legend" aria-label="Payment status legend">
      <li><span class="legend-dot green"></span> Paid / Current</li>
      <li><span class="legend-dot yellow"></span> Due soon</li>
      <li><span class="legend-dot red"></span> Overdue</li>
    </ul>
  {/if}

  {#if loading}
    <p class="muted">Loading dashboard…</p>
  {:else if rooms.length === 0}
    <div class="card empty">
      <p class="muted">No rooms yet. Add your first room from the Rooms tab.</p>
    </div>
  {:else}
    <ul class="room-list">
      {#each rooms as room (room.id)}
        <DashboardRoomCard room={room} onView={openDetail} />
      {/each}
    </ul>
  {/if}

  {#if detailRoom}
    <RoomDetailSheet room={detailRoom} onClose={() => (detailRoom = null)} onDataChanged={refreshEarnings} />
  {/if}
</main>

<style>
  /* The dashboard's cards sit in the gap-based .room-list, so they don't
     carry the global .card bottom margin. */
  .card {
    margin-bottom: 0;
  }

  .page-header {
    margin-bottom: 20px;
  }

  .room-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  /* ---- summary strip ---- */
  .summary-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 14px;
  }

  .summary-item {
    border-radius: 999px;
    padding: 4px 12px;
    font-size: 0.8rem;
    font-weight: 700;
  }
  .summary-overdue {
    color: var(--red-deep);
    background: var(--red-soft);
  }
  .summary-soon {
    color: var(--amber-deep);
    background: var(--amber-soft);
  }

  /* ---- legend ---- */
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin: 0 0 20px 2px;
    padding: 0;
    list-style: none;
    font-size: 0.78rem;
    color: var(--label-2);
  }

  .legend li {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .legend-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    display: inline-block;
  }
  .legend-dot.green {
    background: var(--green);
  }
  .legend-dot.yellow {
    background: var(--amber);
  }
  .legend-dot.red {
    background: var(--red);
  }

</style>
