<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { getDb } from "$lib/db";
  import { ROOM_STATUS_SQL } from "$lib/room-status";
  import { getPaymentStatus } from "$lib/payment-status";
  import { pushToast } from "$lib/toast.svelte";
  import { insertReservation } from "$lib/reservations";
  import RoomFormModal from "./RoomFormModal.svelte";
  import RoomCard from "./RoomCard.svelte";
  import RoomDetailSheet from "$lib/components/RoomDetailSheet.svelte";
  import ConfirmModal from "$lib/components/ConfirmModal.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import Plus from "@lucide/svelte/icons/plus";
  import ReservationFormModal from "../reservations/ReservationFormModal.svelte";
  import type { ReservationFormState } from "../reservations/types";
  import type { Room, RoomFilter, RoomFormState, RoomTenant, RoomTenantChip } from "./types";

  const FILTERS: { key: RoomFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "Vacant", label: "Vacant" },
    { key: "Reserved", label: "Reserved" },
    { key: "Occupied", label: "Occupied" },
    { key: "Overdue", label: "Has overdue tenant" },
  ];

  let rooms: Room[] = $state([]);
  let roomTenants: RoomTenant[] = $state([]);
  let loading = $state(true);
  let error: string | null = $state(null);
  let statusFilter = $state<RoomFilter>("all");

  // Boarder detail sheet — which room's boarders are on display (read-only).
  let detailRoom: Room | null = $state(null);

  // Room-card Reserve flow: the room whose reservation form is open. The form
  // mounts as a modal ON this page (no navigation) with the room locked.
  let reserveRoom: Room | null = $state(null);

  // Rooms with at least one active tenant whose payment status is red.
  const overdueRoomIds = $derived(
    new Set(
      roomTenants
        .filter((t) => getPaymentStatus(t.due_date, new Date(), t.last_paid_date) === "red")
        .map((t) => t.room_id)
    )
  );

  const filteredRooms = $derived(
    rooms.filter((r) => {
      if (statusFilter === "all") return true;
      if (statusFilter === "Overdue") return overdueRoomIds.has(r.id);
      return r.status === statusFilter;
    })
  );

  // Payment-tinted boarder chips per room, shown on each room card.
  const chipsByRoom = $derived(
    roomTenants.reduce<Map<number, RoomTenantChip[]>>((map, t) => {
      const chips = map.get(t.room_id) ?? [];
      chips.push({
        id: t.id,
        name: t.name,
        dueDate: t.due_date,
        lastPaidDate: t.last_paid_date,
        status: getPaymentStatus(t.due_date, new Date(), t.last_paid_date),
      });
      map.set(t.room_id, chips);
      return map;
    }, new Map())
  );

  // ----- form state -----
  let editingRoom: Room | null = $state(null);
  let formOpen = $state(false);
  let pendingDelete: Room | null = $state(null);

  /** Set the inline alert AND surface an error toast (kept in one place). */
  function reportError(msg: string) {
    error = msg;
    pushToast(msg, "error");
  }

  async function loadRooms() {
    try {
      const db = await getDb();
      rooms = await db.select<Room[]>(
        `SELECT r.id, r.room_number, r.capacity, r.monthly_rate, r.maintenance, ${ROOM_STATUS_SQL} AS status,
                COALESCE((SELECT SUM(t.beds_occupied) FROM tenants t WHERE t.room_id = r.id AND t.moved_out_date IS NULL), 0) AS occupied_beds,
                (SELECT COUNT(*) FROM reservations x WHERE x.room_id = r.id AND x.status = 'active') AS reservation_count,
                COALESCE((SELECT SUM(x.bed_count) FROM reservations x WHERE x.room_id = r.id
                          AND x.status = 'active' AND x.hold_type IN ('bed','custom')), 0) AS held_beds,
                EXISTS(SELECT 1 FROM reservations x WHERE x.room_id = r.id
                       AND x.status = 'active' AND x.hold_type = 'whole') AS has_whole_hold,
                (SELECT x.name FROM reservations x WHERE x.room_id = r.id
                 AND x.status = 'active' AND x.hold_type = 'whole' LIMIT 1) AS whole_hold_name
         FROM rooms r ORDER BY r.id`
      );
      roomTenants = await db.select<RoomTenant[]>(
        "SELECT id, name, room_id, due_date, last_paid_date FROM tenants WHERE moved_out_date IS NULL"
      );
      // If the room being inspected vanished (deleted elsewhere), drop the sheet.
      const inspected = detailRoom;
      if (inspected && !rooms.some((r) => r.id === inspected.id)) {
        detailRoom = null;
      }
    } catch (e) {
      error = `Failed to load rooms: ${String(e)}`;
    } finally {
      loading = false;
    }
  }

  onMount(loadRooms);

  function openAdd() {
    editingRoom = null;
    formOpen = true;
  }

  function openEdit(room: Room) {
    editingRoom = room;
    formOpen = true;
  }

  function closeForm() {
    formOpen = false;
  }

  /** Persist the room form; returns an error message or null on success. */
  async function saveRoom(form: RoomFormState): Promise<string | null> {
    try {
      const db = await getDb();
      const roomNumber = form.room_number.trim();
      const capacity = Number(form.capacity);
      const rate = Number(form.monthly_rate);

      if (form.id === null) {
        await db.execute(
          "INSERT INTO rooms (room_number, capacity, monthly_rate, maintenance) VALUES ($1,$2,$3,$4)",
          [roomNumber, capacity, rate, form.maintenance ? 1 : 0]
        );
      } else {
        await db.execute(
          "UPDATE rooms SET room_number=$1, capacity=$2, monthly_rate=$3, maintenance=$4 WHERE id=$5",
          [roomNumber, capacity, rate, form.maintenance ? 1 : 0, form.id]
        );
      }
      await loadRooms();
      pushToast(form.id === null ? `Room added — ${roomNumber}` : `Room updated — ${roomNumber}`, "success");
      return null;
    } catch (e) {
      const msg = String(e);
      const friendly = msg.toLowerCase().includes("unique") ? "That room number already exists." : `Failed to save room: ${msg}`;
      pushToast(friendly, "error");
      return friendly;
    }
  }

  /** Persist a reservation from the room-card Reserve flow (room locked). */
  async function saveReservation(form: ReservationFormState): Promise<string | null> {
    try {
      const db = await getDb();
      const err = await insertReservation(db, form);
      if (err) {
        pushToast(err, "error");
        return err;
      }
      // Refresh the cards so the room's held beds / status update immediately.
      await loadRooms();
      pushToast(`Reservation added — ${form.name.trim()}`, "success");
      return null;
    } catch (e) {
      const msg = `Failed to save reservation: ${String(e)}`;
      pushToast(msg, "error");
      return msg;
    }
  }

  async function remove(room: Room) {
    if (room.occupied_beds > 0) {
      reportError(`Cannot delete ${room.room_number}: it has ${room.occupied_beds} bed${room.occupied_beds === 1 ? "" : "s"} occupied. Move them out first.`);
      return;
    }
    if (room.reservation_count > 0) {
      reportError(`Cannot delete ${room.room_number}: it has an active reservation. Cancel or convert it first.`);
      return;
    }
    // The tenants/reservations FKs are ON DELETE RESTRICT for ALL rows, so
    // archived tenants or converted/cancelled reservation history also block
    // deletion — surface them with a clear message instead of a raw DB error.
    try {
      const db = await getDb();
      const row = await db.select<{ archived: number; history: number }[]>(
        `SELECT (SELECT COUNT(*) FROM tenants t WHERE t.room_id = $1 AND t.moved_out_date IS NOT NULL) AS archived,
                (SELECT COUNT(*) FROM reservations x WHERE x.room_id = $1 AND x.status != 'active') AS history`
      );
      const counts = row[0];
      if (counts && counts.archived > 0) {
        reportError(`Cannot delete ${room.room_number}: it has ${counts.archived} archived tenant record${counts.archived === 1 ? "" : "s"}. Permanently delete ${counts.archived === 1 ? "it" : "them"} from the Archived view first.`);
        return;
      }
      if (counts && counts.history > 0) {
        reportError(`Cannot delete ${room.room_number}: it has reservation history, which is kept for audit.`);
        return;
      }
    } catch (e) {
      reportError(`Failed to delete room: ${String(e)}`);
      return;
    }
    // All guards passed — ask for explicit confirmation in-app.
    pendingDelete = room;
  }

  /** Actually delete the room after the user confirms. */
  async function deleteRoom(room: Room): Promise<void> {
    try {
      const db = await getDb();
      await db.execute("DELETE FROM rooms WHERE id=$1", [room.id]);
      pendingDelete = null;
      await loadRooms();
      pushToast(`Room deleted — ${room.room_number}`, "success");
    } catch (e) {
      // Keep the modal open so the landlord can retry or cancel.
      reportError(`Failed to delete room: ${String(e)}`);
    }
  }
</script>

<main>
  <header class="page-header with-action">
    <div>
      <h1>Room Management</h1>
      <p class="subtitle">
        {#if statusFilter === "all"}
          {rooms.length} room{rooms.length === 1 ? "" : "s"} in total
        {:else}
          {filteredRooms.length} of {rooms.length} room{rooms.length === 1 ? "" : "s"} shown
        {/if}
      </p>
    </div>
    <button
      class="btn btn-primary btn-icon"
      onclick={openAdd}
      disabled={formOpen}
      aria-label="Add room"
      title="Add room"
    >
      <Icon icon={Plus} size={24} />
    </button>
  </header>

  {#if error}
    <div class="alert">{error}</div>
  {/if}

  {#if formOpen}
    <RoomFormModal editing={editingRoom} rooms={rooms} onSave={saveRoom} onClose={closeForm} />
  {/if}

  {#if pendingDelete}
    {@const target = pendingDelete}
    <ConfirmModal
      title="Delete Room"
      subtitle={target.room_number}
      message={`Delete ${target.room_number}? This cannot be undone.`}
      confirmLabel="Delete Room"
      busyLabel="Deleting…"
      danger
      onConfirm={() => deleteRoom(target)}
      onClose={() => (pendingDelete = null)}
    />
  {/if}

  {#if reserveRoom}
    {@const locked = reserveRoom}
    <ReservationFormModal
      rooms={rooms}
      initialRoomId={String(locked.id)}
      lockedRoomId={String(locked.id)}
      onSave={saveReservation}
      onClose={() => (reserveRoom = null)}
    />
  {/if}

  {#if detailRoom}
    <RoomDetailSheet room={detailRoom} onClose={() => (detailRoom = null)} />
  {/if}

  {#if !loading}
    <div class="chips" role="tablist" aria-label="Room status filter">
      {#each FILTERS as f (f.key)}
        <button class:active={statusFilter === f.key} onclick={() => (statusFilter = f.key)}>{f.label}</button>
      {/each}
    </div>
  {/if}

  {#if loading}
    <p class="muted">Loading rooms…</p>
  {:else if rooms.length === 0}
    <div class="card empty">
      <p class="muted">No rooms yet.</p>
      <button class="btn btn-primary" onclick={openAdd}>+ Add Room</button>
    </div>
  {:else if filteredRooms.length === 0}
    <div class="card empty">
      <p class="muted">No rooms match this filter.</p>
    </div>
  {:else}
    <ul class="list-stack">
      {#each filteredRooms as room (room.id)}
        <RoomCard
          room={room}
          overdue={overdueRoomIds.has(room.id)}
          tenants={chipsByRoom.get(room.id) ?? []}
          onView={(r) => (detailRoom = r)}
          onEdit={openEdit}
          onDelete={remove}
          onReserve={(r) => (reserveRoom = r)}
          onManageTenants={(r) => goto(`/tenants?room=${r.id}`)}
        />
      {/each}
    </ul>
  {/if}
</main>

<style>
  /* Rooms renders its placeholder text slightly dimmer than the global .muted —
     light mode only (explicit or device-driven), so dark mode falls through
     to the global label-2. Guarded by the :root data-theme override. */
  :global(:root[data-theme="light"]) .muted {
    color: var(--label-3);
  }
  @media (prefers-color-scheme: light) {
    :global(:root:not([data-theme="dark"])) .muted {
      color: var(--label-3);
    }
  }

</style>
