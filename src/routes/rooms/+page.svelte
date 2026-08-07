<script lang="ts">
  import { onMount } from "svelte";
  import { getDb } from "$lib/db";
  import { ROOM_STATUS_SQL } from "$lib/room-status";
  import { getPaymentStatus } from "$lib/payment-status";
  import { pushToast } from "$lib/toast.svelte";
  import RoomFormModal from "./RoomFormModal.svelte";
  import RoomCard from "./RoomCard.svelte";
  import ConfirmModal from "$lib/components/ConfirmModal.svelte";
  import type { Room, RoomFilter, RoomFormState, RoomTenant } from "./types";

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
                (SELECT COUNT(*) FROM tenants t WHERE t.room_id = r.id AND t.moved_out_date IS NULL) AS tenant_count,
                (SELECT COUNT(*) FROM reservations x WHERE x.room_id = r.id AND x.status = 'active') AS reservation_count,
                (SELECT COUNT(*) FROM reservations x WHERE x.room_id = r.id AND x.status = 'active' AND x.scope = 'slot') AS slot_holds,
                (SELECT x.name FROM reservations x WHERE x.room_id = r.id AND x.status = 'active' LIMIT 1) AS reservation_name,
                (SELECT x.scope FROM reservations x WHERE x.room_id = r.id AND x.status = 'active' LIMIT 1) AS reservation_scope
         FROM rooms r ORDER BY r.id`
      );
      roomTenants = await db.select<RoomTenant[]>(
        "SELECT room_id, due_date, last_paid_date FROM tenants WHERE moved_out_date IS NULL"
      );
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

  async function remove(room: Room) {
    if (room.tenant_count > 0) {
      reportError(`Cannot delete ${room.room_number}: it has ${room.tenant_count} tenant${room.tenant_count === 1 ? "" : "s"} assigned. Move them first.`);
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
  <header class="page-header">
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
    <button class="btn btn-primary" onclick={openAdd} disabled={formOpen}>+ Add Room</button>
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
    <ul class="room-list">
      {#each filteredRooms as room (room.id)}
        <RoomCard
          room={room}
          overdue={overdueRoomIds.has(room.id)}
          onEdit={openEdit}
          onDelete={remove}
        />
      {/each}
    </ul>
  {/if}
</main>

<style>
  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 20px;
    padding-right: 44px;
  }

  /* Rooms renders its placeholder text slightly dimmer than the global .muted —
     light mode only, so dark mode falls through to the global #b0b0b0. */
  @media (prefers-color-scheme: light) {
    .muted {
      color: var(--label-3);
    }
  }

  .room-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
</style>
