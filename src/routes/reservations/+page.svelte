<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { getDb } from "$lib/db";
  import { phpPesoPrecise } from "$lib/format";
  import { insertReservation } from "$lib/reservations";
  import { pushToast } from "$lib/toast.svelte";
  import ReservationFormModal from "./ReservationFormModal.svelte";
  import ConvertModal from "./ConvertModal.svelte";
  import ReservationCard from "./ReservationCard.svelte";
  import ConfirmModal from "$lib/components/ConfirmModal.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import HandCoins from "@lucide/svelte/icons/hand-coins";
  import Plus from "@lucide/svelte/icons/plus";
  import type { ConvertPayload, Reservation, ReservationFormState, RoomOption } from "./types";

  let reservations: Reservation[] = $state([]);
  let rooms: RoomOption[] = $state([]);
  let loading = $state(true);
  let error: string | null = $state(null);
  let view: "active" | "history" = $state("active");

  const activeReservations = $derived(reservations.filter((r) => r.status === "active"));
  const historyReservations = $derived(reservations.filter((r) => r.status !== "active"));

  // ----- modal targets -----
  let formOpen = $state(false);
  let initialRoomId = $state("");
  let convertTarget: Reservation | null = $state(null);
  let pendingCancel: Reservation | null = $state(null);

  async function loadData() {
    try {
      const db = await getDb();
      reservations = await db.select<Reservation[]>(
        `SELECT res.id, res.room_id, r.room_number, res.name, res.contact,
                res.reservation_date, res.target_move_in_date, res.hold_type, res.bed_count,
                res.deposit, res.status
         FROM reservations res JOIN rooms r ON r.id = res.room_id
         ORDER BY CASE res.status WHEN 'active' THEN 0 ELSE 1 END,
                  CASE res.status WHEN 'active' THEN res.target_move_in_date END ASC,
                  res.id DESC`
      );
      rooms = await db.select<RoomOption[]>(
        `SELECT r.id, r.room_number, r.capacity, r.monthly_rate, r.maintenance,
                COALESCE((SELECT SUM(t.beds_occupied) FROM tenants t WHERE t.room_id = r.id AND t.moved_out_date IS NULL), 0) AS occupied_beds,
                COALESCE((SELECT SUM(x.bed_count) FROM reservations x WHERE x.room_id = r.id
                          AND x.status = 'active' AND x.hold_type IN ('bed','custom')), 0) AS held_beds,
                EXISTS(SELECT 1 FROM reservations x WHERE x.room_id = r.id
                       AND x.status = 'active' AND x.hold_type = 'whole') AS has_whole_hold
         FROM rooms r ORDER BY r.id`
      );
    } catch (e) {
      error = `Failed to load reservations: ${String(e)}`;
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    const roomParam = page.url.searchParams.get("room");
    if (roomParam) {
      initialRoomId = roomParam;
      formOpen = true;
    }
    loadData();
  });

  function openAdd() {
    initialRoomId = "";
    formOpen = true;
  }

  function closeForm() {
    formOpen = false;
  }

  /** Persist the reservation form; returns an error message or null on success. */
  async function saveReservation(form: ReservationFormState): Promise<string | null> {
    try {
      const db = await getDb();
      const err = await insertReservation(db, form);
      if (err) {
        pushToast(err, "error");
        return err;
      }
      await loadData();
      pushToast(`Reservation added — ${form.name.trim()}`, "success");
      return null;
    } catch (e) {
      const msg = `Failed to save reservation: ${String(e)}`;
      pushToast(msg, "error");
      return msg;
    }
  }

  /**
   * Convert a reservation into a tenant. Ordering is load-bearing: the room's
   * hold must be released BEFORE creating the tenant, because the capacity
   * trigger aborts a tenant insert while an active whole-room reservation
   * exists ("Room is reserved"). If the tenant insert then fails (e.g.
   * capacity), the hold is put back so the room stays reserved.
   */
  async function confirmConvert(payload: ConvertPayload): Promise<string | null> {
    const res = convertTarget;
    if (!res) return null;
    try {
      const db = await getDb();
      await db.execute("UPDATE reservations SET status = 'converted' WHERE id = $1", [res.id]);
      try {
        // Converted tenants snapshot the room's current rate (same rule as the
        // tenant form) so later room-rate edits don't change their charge.
        const room = rooms.find((r) => r.id === res.room_id);
        // The holding deposit carries over as the tenant's deposit pot
        // (deposit_held), so it's usable in the held-balance flow.
        await db.execute(
          "INSERT INTO tenants (name, contact, room_id, move_in_date, due_date, deposit_amount, deposit_held, monthly_rate, beds_occupied) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [payload.name.trim(), payload.contact.trim(), res.room_id, payload.move_in_date, payload.due_date, res.deposit, res.deposit ?? 0, room?.monthly_rate ?? 0, payload.beds_occupied]
        );
      } catch (insertErr) {
        // Put the hold back so the room stays reserved; if the revert itself
        // fails (e.g. the room already got another active reservation), keep
        // the original error so the user sees the real cause.
        try {
          await db.execute("UPDATE reservations SET status = 'active' WHERE id = $1", [res.id]);
        } catch {
          // fall through — report the original insert error below
        }
        throw insertErr;
      }
      convertTarget = null;
      await loadData();
      pushToast(`Converted to tenant — ${payload.name.trim()}`, "success");
      return null;
    } catch (e) {
      const msg = String(e);
      let friendly: string;
      if (msg.toLowerCase().includes("full capacity")) friendly = "That room is already at full capacity.";
      else if (msg.toLowerCase().includes("reserved")) friendly = "That room is already reserved by someone else.";
      else if (msg.toLowerCase().includes("under maintenance")) friendly = "That room is under maintenance.";
      else friendly = `Failed to convert: ${msg}`;
      pushToast(friendly, "error");
      return friendly;
    }
  }

  // ----- cancel -----
  function cancelReservation(res: Reservation) {
    pendingCancel = res;
  }

  /** Actually cancel the reservation after confirmation. */
  async function doCancel(res: Reservation): Promise<void> {
    try {
      const db = await getDb();
      await db.execute("UPDATE reservations SET status = 'cancelled' WHERE id = $1", [res.id]);
      pendingCancel = null;
      await loadData();
      pushToast(`Reservation cancelled — ${res.name}`, "success");
    } catch (e) {
      // Keep the modal open so the landlord can retry or cancel.
      const msg = `Failed to cancel reservation: ${String(e)}`;
      error = msg;
      pushToast(msg, "error");
    }
  }
</script>

<main>
  <header class="page-header with-action">
    <div>
      <h1>Reservations</h1>
      <p class="subtitle">
        {activeReservations.length} active · {historyReservations.length} in history
      </p>
    </div>
    <button
      class="btn btn-primary btn-icon"
      onclick={openAdd}
      disabled={formOpen}
      aria-label="Add reservation"
      title="Add reservation"
    >
      <Icon icon={Plus} size={24} />
    </button>
  </header>

  {#if error}
    <div class="alert">{error}</div>
  {/if}

  {#if !loading}
    <div class="segmented" role="tablist" aria-label="Reservation view">
      <button class:active={view === "active"} onclick={() => (view = "active")}>Active</button>
      <button class:active={view === "history"} onclick={() => (view = "history")}>History</button>
    </div>
  {/if}

  {#if formOpen}
    <ReservationFormModal
      rooms={rooms}
      initialRoomId={initialRoomId}
      onSave={saveReservation}
      onClose={closeForm}
    />
  {/if}

  {#if convertTarget}
    <ConvertModal reservation={convertTarget} rooms={rooms} onConfirm={confirmConvert} onClose={() => (convertTarget = null)} />
  {/if}

  {#if pendingCancel}
    {@const target = pendingCancel}
    {#snippet depositNote()}
      <span class="note-icon"><Icon icon={HandCoins} size={16} /></span>Remember to return the {phpPesoPrecise(target.deposit ?? 0)} holding deposit.
    {/snippet}
    <ConfirmModal
      title="Cancel Reservation"
      subtitle={`${target.name} · ${target.room_number}`}
      message={`Cancel the reservation for ${target.name} on ${target.room_number}?`}
      note={target.deposit != null ? depositNote : undefined}
      confirmLabel="Cancel Reservation"
      busyLabel="Cancelling…"
      onConfirm={() => doCancel(target)}
      onClose={() => (pendingCancel = null)}
    />
  {/if}

  {#if loading}
    <p class="muted">Loading reservations…</p>
  {:else if view === "active"}
    {#if activeReservations.length === 0}
      <div class="card empty">
        <p class="muted">No active reservations. Hold a room before a tenant moves in.</p>
        <button class="btn btn-primary" onclick={openAdd}>+ Add Reservation</button>
      </div>
    {:else}
      <ul class="list-stack">
        {#each activeReservations as res (res.id)}
          <ReservationCard
            reservation={res}
            onConvert={(r) => (convertTarget = r)}
            onCancel={cancelReservation}
          />
        {/each}
      </ul>
    {/if}
  {:else}
    {#if historyReservations.length === 0}
      <div class="card empty">
        <p class="muted">No reservation history yet.</p>
      </div>
    {:else}
      <ul class="list-stack">
        {#each historyReservations as res (res.id)}
          <ReservationCard reservation={res} history />
        {/each}
      </ul>
    {/if}
  {/if}
</main>

<style>
  .note-icon {
    display: inline-flex;
    margin-right: 6px;
    vertical-align: -0.15em;
  }
</style>
