<script lang="ts">
  import { formatDate, phpPesoPrecise } from "$lib/ui/format";
  import { effectiveOccupancy, isRoomFull, roomUnavailable } from "$lib/rooms/rooms";
  import Icon from "$lib/ui/Icon.svelte";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import BedDouble from "@lucide/svelte/icons/bed-double";
  import HandCoins from "@lucide/svelte/icons/hand-coins";
  import type { Room, TenantFormState } from "$lib/tenants/types";

  /**
   * The editable tenant fields plus their live hints. `form` is the page's
   * `$state` object, so bindings here stay reactive in the parent's validation
   * and save.
   */
  let {
    form,
    rooms,
    rateTouched = false,
    onRateTouched = () => {},
  }: {
    form: TenantFormState;
    rooms: Room[];
    rateTouched?: boolean;
    onRateTouched?: () => void;
  } = $props();

  // ----- due date auto-suggest -----
  // Suggests the FIRST due date = the move-in day, so the first payment
  // records the move-in month (first-payment-month-spec.md). The landlord can
  // edit it (e.g. set next month for a late-month move-in) — the payment
  // covers whichever month the due date lands in. Disabled in boarding mode.
  function suggestDue(): string {
    if (!form.move_in_date) return "";
    return form.move_in_date;
  }

  function moveInChanged() {
    if (form.dueAuto) form.due_date = suggestDue();
  }

  function roomChanged() {
    // Prefill the rate from the newly selected room when adding a tenant and
    // the landlord hasn't typed their own rate yet.
    if (form.id === null && !rateTouched) {
      const room = selectedRoom();
      if (room) form.monthly_rate = String(room.monthly_rate);
    }
  }

  function dueEdited() {
    form.dueAuto = false;
  }

  function selectedRoom(): Room | undefined {
    // form.room_id may be a string (edit mode / initial "" state) or a number
    // (Svelte's select binding returns the raw option value) — normalize both
    // sides so the comparison is type-safe.
    return rooms.find((r) => String(r.id) === String(form.room_id));
  }

  function roomLabel(r: Room): string {
    if (r.maintenance === 1) return `${r.room_number} (${r.occupied_beds}/${r.capacity}) — under maintenance`;
    if (r.whole_reservations > 0) return `${r.room_number} (${r.occupied_beds}/${r.capacity}) — held (whole room)`;
    const beds = r.capacity - effectiveOccupancy(r.occupied_beds, r.held_beds);
    const suffix = beds > 0 ? `— ${beds} bed${beds === 1 ? "" : "s"} left` : "— FULL";
    return `${r.room_number} (${r.occupied_beds}/${r.capacity}) ${suffix}`;
  }

  /** "₱600 = 1 month at ₱600/mo" — shown once both the advance amount and the
   *  monthly rate are known, so the landlord can relate the money to months
   *  without a months input (advance-money-field-spec.md §4.1). */
  const advanceMonthsHint = $derived.by(() => {
    const raw = String(form.advance_amount ?? "").trim();
    const amount = Number(form.advance_amount);
    const rate = Number(form.monthly_rate);
    if (!raw || Number.isNaN(amount) || amount <= 0 || Number.isNaN(rate) || rate <= 0) return null;
    const months = amount / rate;
    const monthsLabel =
      months < 0.05 ? "less than 1" : months < 1 ? String(Number(months.toFixed(2))) : String(Number(months.toFixed(1)));
    const noun = monthsLabel === "less than 1" ? "month" : `month${months === 1 ? "" : "s"}`;
    return `${phpPesoPrecise(amount)} = ${monthsLabel} ${noun} at ${phpPesoPrecise(rate)}/mo`;
  });
</script>

<label>
  Tenant name
  <input type="text" placeholder="e.g. Juan Dela Cruz" bind:value={form.name} />
</label>

<label>
  Contact number
  <input type="tel" placeholder="e.g. 0917 123 4567" bind:value={form.contact} />
</label>

<label>
  Assigned room
  <select bind:value={form.room_id} onchange={roomChanged}>
    <option value="" disabled>Select room…</option>
    {#each rooms as room (room.id)}
      <!-- In boarding mode every room is selectable — the tenant is already
           physically in it, so full/maintenance/held rooms must be pickable
           (the DB trigger skip is mirrored in validateTenantForm). -->
      <option
        value={String(room.id)}
        disabled={!form.boarding && roomUnavailable(room.maintenance, room.whole_reservations)}
      >{roomLabel(room)}</option>
    {/each}
  </select>
</label>

{#if form.room_id && selectedRoom()}
  {@const sel = selectedRoom()!}
  <p class="room-hint">
    {#if form.boarding}
      <span>Backfilling — room checks are skipped for already-boarding tenants. Available beds in {sel.room_number}: {sel.capacity - effectiveOccupancy(sel.occupied_beds, sel.held_beds)}</span>
    {:else if sel.maintenance === 1}
      <span class="full"><span class="lead-icon"><Icon icon={CircleAlert} size={16} /></span>{sel.room_number} is under maintenance — no tenants can be added.</span>
    {:else if sel.whole_reservations > 0}
      <span class="full"><span class="lead-icon"><Icon icon={CircleAlert} size={16} /></span>{sel.room_number} is held (whole room reserved).</span>
    {:else if isRoomFull(sel.occupied_beds, sel.held_beds, sel.capacity)}
      <span class="full"><span class="lead-icon"><Icon icon={CircleAlert} size={16} /></span>{sel.room_number} is full — no more tenants can be added.</span>
    {:else}
      <span>Available beds in {sel.room_number}: {sel.capacity - effectiveOccupancy(sel.occupied_beds, sel.held_beds)}</span>
    {/if}
  </p>
{/if}

{#if form.boarding}
  <label>
    Beds occupied
    <input type="number" min="1" step="1" placeholder="e.g. 1" bind:value={form.beds_occupied} />
  </label>
  <p class="held-hint"><span class="lead-icon"><Icon icon={BedDouble} size={16} /></span>Set how many beds this tenant occupies (whole number of at least 1).</p>
{/if}

<label>
  Monthly rate (₱)
  <input
    type="number"
    min="0"
    step="0.01"
    placeholder="e.g. 2500"
    bind:value={form.monthly_rate}
    oninput={onRateTouched}
  />
</label>
{#if form.id === null}
  <p class="rate-hint">Prefills from the selected room — this is the amount charged each month.</p>
{/if}

<label>
  Move-in date
  <input type="date" bind:value={form.move_in_date} onchange={moveInChanged} />
</label>

<label>
  Due date (monthly payment)
  <input type="date" bind:value={form.due_date} onchange={dueEdited} />
</label>

{#if form.dueAuto && form.move_in_date}
  <p class="due-hint">
    Suggested due: {formatDate(suggestDue())} — the first payment covers this month. You can
    change it (e.g. to next month for a late-month move-in).
  </p>
{/if}

<label>
  Deposit (₱, optional)
  <input type="number" min="0" step="0.01" placeholder="e.g. 2000" bind:value={form.deposit_amount} />
</label>
<p class="held-hint"><span class="lead-icon"><Icon icon={HandCoins} size={16} /></span>Held as balance — applied to months only when you apply it. Refundable per Settings.</p>

<label>
  Advance payment (₱, held, applied first)
  <input type="number" min="0" step="0.01" placeholder="e.g. 600" bind:value={form.advance_amount} />
</label>
<p class="held-hint">
  <span class="lead-icon"><Icon icon={HandCoins} size={16} /></span>Held as balance — used before the deposit when you apply it.
  {#if advanceMonthsHint} {advanceMonthsHint}. {/if}
  {#if form.id !== null}
    Shows the remaining balance — editing corrects it.
  {:else}
    Nothing is charged until you apply it.
  {/if}
</p>

<style>
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-weight: 600;
    font-size: 0.85rem;
    color: var(--label-2);
  }

  input,
  select {
    border-radius: var(--radius-control);
    border: 1px solid var(--separator);
    padding: 10px 12px;
    font-size: 1rem;
    font-family: inherit;
    color: var(--label);
    background: var(--card);
  }

  input:focus,
  select:focus {
    outline: 2px solid var(--accent);
    border-color: transparent;
  }

  .room-hint {
    margin: 0;
    font-size: 0.85rem;
    color: var(--label-2);
  }
  .room-hint .full {
    color: var(--red-deep);
    font-weight: 700;
  }

  .lead-icon {
    display: inline-flex;
    margin-right: 6px;
    vertical-align: -0.15em;
  }

  .due-hint {
    margin: 0;
    font-size: 0.85rem;
    color: var(--accent-deep);
    background: var(--accent-soft);
    border-radius: 8px;
    padding: 8px 12px;
  }

  .rate-hint {
    margin: -4px 0 0;
    font-size: 0.8rem;
    color: var(--label-3);
  }

  .held-hint {
    margin: -6px 0 0;
    font-size: 0.8rem;
    color: var(--label-3);
  }
</style>
