<script lang="ts">
  import { onMount } from "svelte";
  import { getDb } from "$lib/db";
  import { pushToast } from "$lib/toast.svelte";
  import { pushOverlay } from "$lib/back-stack";
  import {
    AMENITY_MESSAGES,
    AMENITY_PRESETS,
    calcSharedSplit,
    calcPerRoomSplit,
    calcConnectedSplit,
    calculateMeterTotal,
    validateBill,
    validateExclusionReason,
    round2,
    type SplitResult,
  } from "$lib/amenity-billing";
  import {
    createAmenityBill,
    updateAmenityBill,
    checkDuplicateAmenity,
    findConnectedRoomOverlap,
    type AmenityBillRow,
  } from "$lib/amenity-actions";
  import { formatDate, phpPesoPrecise } from "$lib/format";

  let {
    editing,
    onSaveDone,
    onClose,
  }: {
    editing: AmenityBillRow | null;
    onSaveDone: () => void;
    onClose: () => void;
  } = $props();

  /** A tenant the landlord can put on a bill, moved out or not. */
  interface PickTenant {
    id: number;
    name: string;
    room_number: string;
    room_id: number;
    moved_out_date: string | null;
  }

  let rooms: { id: number; room_number: string }[] = $state([]);
  let allTenants: PickTenant[] = $state([]);
  let roomTenants: PickTenant[] = $state([]);

  /**
   * Moved-out tenants stay hidden until the landlord asks for them (spec §9.1,
   * decision #6) — they can still be billed for a period they occupied. The
   * choice is remembered (spec §18.4): a landlord who bills across a departure
   * wants the same view next time, and re-toggling every bill is friction.
   */
  const SHOW_INACTIVE_KEY = "amenity-billing:show-inactive";

  function readShowInactive(): boolean {
    try {
      return localStorage.getItem(SHOW_INACTIVE_KEY) === "1";
    } catch {
      return false;
    }
  }

  let showInactive = $state(readShowInactive());

  $effect(() => {
    try {
      localStorage.setItem(SHOW_INACTIVE_KEY, showInactive ? "1" : "0");
    } catch {
      // Storage unavailable (private mode) — the toggle still works per open.
    }
  });

  let amenity_name = $state(editing?.amenity_name ?? "");
  let billing_method = $state<string>(editing?.billing_method ?? "shared");
  let total_amount = $state(editing ? String(editing.total_amount) : "");
  let billing_date = $state(editing?.billing_date ?? new Date().toISOString().slice(0, 10));
  let billing_period = $state(editing?.billing_period ?? "");
  let notes = $state(editing?.notes ?? "");
  let division_mode = $state<string>(editing?.division_mode ?? "auto");

  let meter_start = $state<string>(editing?.meter_start != null ? String(editing.meter_start) : "");
  let meter_end = $state<string>(editing?.meter_end != null ? String(editing.meter_end) : "");
  let price_per_unit = $state<string>(
    editing?.price_per_unit != null ? String(editing.price_per_unit) : "",
  );

  /**
   * The Amenity Type picker (spec #20): there is no `amenity_type` column —
   * the nine names are quick picks that fill the free-text name. "Custom"
   * clears the field and hands the landlord the keyboard.
   */
  const CUSTOM_TYPE = "__custom";

  let selectedType = $derived(
    (AMENITY_PRESETS as readonly string[]).includes(amenity_name) ? amenity_name : CUSTOM_TYPE,
  );

  let nameInput: HTMLInputElement | undefined = $state();

  function onTypeChange(event: Event) {
    const value = (event.target as HTMLSelectElement).value;
    if (value === CUSTOM_TYPE) {
      amenity_name = "";
      nameInput?.focus();
    } else {
      amenity_name = value;
    }
  }

  let selectedRoomId = $state<string>("");
  let selectedConnectedRoomIds: number[] = $state([]);
  let selectedTenantIds: number[] = $state([]);
  let excludedMap: Map<number, string> = $state(new Map());
  let manualAmounts: Map<number, number> = $state(new Map());

  let duplicateWarning: string | null = $state(null);
  let overlapWarning: string[] = $state([]);
  let pendingMethod: string | null = $state(null);
  let saving = $state(false);
  let closing = $state(false);
  let error: string | null = $state(null);

  let editInitialLoaded = false;

  const ALL_TENANTS_SQL =
    "SELECT t.id, t.name, r.room_number, t.room_id, t.moved_out_date FROM tenants t JOIN rooms r ON r.id=t.room_id ORDER BY t.name";

  async function loadData() {
    const db = await getDb();
    rooms = await db.select<{ id: number; room_number: string }[]>(
      "SELECT id, room_number FROM rooms ORDER BY room_number",
    );
    allTenants = await db.select<PickTenant[]>(ALL_TENANTS_SQL);
  }

  let pickableTenants = $derived(
    showInactive ? allTenants : allTenants.filter((t) => t.moved_out_date === null),
  );

  async function loadRoomTenants(roomId: number) {
    const db = await getDb();
    roomTenants = await db.select<PickTenant[]>(
      "SELECT t.id, t.name, r.room_number, t.room_id, t.moved_out_date FROM tenants t JOIN rooms r ON r.id=t.room_id WHERE t.room_id=$1 ORDER BY t.name",
      [roomId],
    );
  }

  async function loadEditing() {
    if (!editing || editInitialLoaded) return;
    const db = await getDb();
    const trows = await db.select<
      { tenant_id: number; amount: number; is_excluded: number; exclusion_reason: string | null }[]
    >("SELECT tenant_id, amount, is_excluded, exclusion_reason FROM amenity_bill_tenants WHERE bill_id=$1", [
      editing.id,
    ]);
    const rrows = await db.select<{ room_id: number }[]>(
      "SELECT room_id FROM amenity_bill_rooms WHERE bill_id=$1",
      [editing.id],
    );
    selectedConnectedRoomIds = rrows.map((r) => r.room_id);
    if (editing.billing_method === "per_room" && rrows.length > 0) {
      selectedRoomId = String(rrows[0].room_id);
    }

    const shares = new Map<number, number>();
    const excl = new Map<number, string>();
    const sel: number[] = [];
    for (const row of trows) {
      if (row.is_excluded) excl.set(row.tenant_id, row.exclusion_reason ?? "");
      else {
        shares.set(row.tenant_id, row.amount);
        sel.push(row.tenant_id);
      }
    }
    excludedMap = excl;
    manualAmounts = shares;
    selectedTenantIds = sel;

    // A bill can outlive a move-out — make sure the rows it already carries are
    // visible and editable instead of silently hidden.
    const billedIds = new Set([...sel, ...excl.keys()]);
    if (allTenants.some((t) => billedIds.has(t.id) && t.moved_out_date !== null)) {
      showInactive = true;
    }

    if (editing.billing_method === "per_room" && selectedRoomId) {
      await loadRoomTenants(Number(selectedRoomId));
    }
    editInitialLoaded = true;
  }

  onMount(async () => {
    await loadData();
    await loadEditing();
  });

  // Android back closes the sheet before it falls through to navigation.
  onMount(() => pushOverlay(close));

  // Escape does the same on desktop, where there is no back button.
  $effect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  $effect(() => {
    if (selectedRoomId) loadRoomTenants(Number(selectedRoomId));
  });

  let roomPickable: PickTenant[] = $derived(
    showInactive ? roomTenants : roomTenants.filter((t) => t.moved_out_date === null),
  );

  let pooledTenants: PickTenant[] = $derived.by(() => {
    if (billing_method !== "connected") return [];
    const pooled: PickTenant[] = [];
    for (const roomId of selectedConnectedRoomIds) {
      for (const tenant of pickableTenants) if (tenant.room_id === roomId) pooled.push(tenant);
    }
    return pooled.sort((a, b) => a.name.localeCompare(b.name));
  });

  let split: SplitResult = $derived.by(() => {
    const empty: SplitResult = { shares: new Map(), errors: [], absorbed: 0 };
    const total = Number(total_amount) || 0;
    if (!total || total <= 0) return empty;
    try {
      if (billing_method === "shared") {
        const allIds = [...selectedTenantIds, ...[...excludedMap.keys()]];
        return calcSharedSplit({
          total,
          tenantIds: allIds,
          excluded: excludedMap,
          manualOverrides: division_mode === "auto" ? new Map() : manualAmounts,
        });
      }
      if (billing_method === "per_room") {
        const ids = roomPickable.map((t) => t.id);
        return calcPerRoomSplit(ids, total, division_mode === "auto" ? new Map() : manualAmounts, division_mode === "auto" ? "auto" : "manual");
      }
      const ids = pooledTenants.map((t) => t.id);
      return calcConnectedSplit(ids, total, division_mode === "auto" ? new Map() : manualAmounts, division_mode === "auto" ? "auto" : "manual");
    } catch {
      return empty;
    }
  });

  let computedShares = $derived(split.shares);

  let netTotal = $derived(
    round2([...computedShares.values()].reduce((sum, value) => round2(sum + value), 0)),
  );

  let meterInfo = $derived.by(() => {
    const s = meter_start.trim() === "" ? null : Number(meter_start);
    const e = meter_end.trim() === "" ? null : Number(meter_end);
    const p = price_per_unit.trim() === "" ? null : Number(price_per_unit);
    return calculateMeterTotal(s, e, p);
  });

  /** The heading over the picker, which changes shape with the billing method. */
  let pickerTitle = $derived(
    billing_method === "shared"
      ? "Select Tenants"
      : billing_method === "per_room"
        ? "Room Occupants"
        : "Pooled Tenants",
  );

  function toggleTenant(id: number) {
    if (selectedTenantIds.includes(id)) {
      selectedTenantIds = selectedTenantIds.filter((x) => x !== id);
      const amounts = new Map(manualAmounts);
      amounts.delete(id);
      manualAmounts = amounts;
      const excluded = new Map(excludedMap);
      excluded.delete(id);
      excludedMap = excluded;
    } else {
      selectedTenantIds = [...selectedTenantIds, id];
    }
  }

  function toggleExclude(id: number) {
    const excluded = new Map(excludedMap);
    if (excluded.has(id)) excluded.delete(id);
    else excluded.set(id, "");
    excludedMap = excluded;
  }

  function toggleConnectedRoom(id: number) {
    if (selectedConnectedRoomIds.includes(id)) {
      selectedConnectedRoomIds = selectedConnectedRoomIds.filter((x) => x !== id);
    } else {
      selectedConnectedRoomIds = [...selectedConnectedRoomIds, id];
    }
  }

  function setManualAmount(id: number, raw: string) {
    const amounts = new Map(manualAmounts);
    const value = Number(raw);
    if (raw === "" || isNaN(value)) amounts.delete(id);
    else amounts.set(id, value);
    manualAmounts = amounts;
  }

  function setExclusionReason(id: number, raw: string) {
    const next = new Map(excludedMap);
    next.set(id, raw);
    excludedMap = next;
  }

  function methodLabel(method: string): string {
    if (method === "shared") return "Shared Billing";
    if (method === "per_room") return "Per-Room Billing — Room-Specific Amenity";
    return "Connected Rooms — Joint Room Billing";
  }

  function requestMethodChange(next: string) {
    if (next === billing_method) return;
    pendingMethod = next;
  }

  /** Switching method recomputes from scratch — old entries belong to the old shape (spec §7). */
  function applyMethodChange() {
    if (!pendingMethod) return;
    billing_method = pendingMethod;
    pendingMethod = null;
    manualAmounts = new Map();
    selectedTenantIds = [];
    selectedConnectedRoomIds = [];
    excludedMap = new Map();
    error = null;
  }

  async function handleSave() {
    error = null;
    duplicateWarning = null;
    overlapWarning = [];
    const total = Number(total_amount);

    for (const [, reason] of excludedMap) {
      const reasonError = validateExclusionReason(true, reason);
      if (reasonError) {
        error = reasonError;
        return;
      }
    }

    const roomIds =
      billing_method === "per_room"
        ? selectedRoomId
          ? [Number(selectedRoomId)]
          : []
        : billing_method === "connected"
          ? [...selectedConnectedRoomIds]
          : [];

    const invalid = validateBill({
      amenityName: amenity_name,
      amount: total,
      tenantIds: [...computedShares.keys()],
      roomIds,
      method: billing_method === "shared" ? "shared" : billing_method === "per_room" ? "per_room" : "connected",
      divisionMode: division_mode === "auto" ? "auto" : "manual",
      shares: computedShares,
      billingPeriod: billing_period.trim() || null,
    });
    if (invalid) {
      error = invalid;
      return;
    }

    const db = await getDb();

    const dup = await checkDuplicateAmenity(db, amenity_name.trim(), billing_period.trim() || null, editing?.id);
    if (dup && !duplicateWarning) {
      duplicateWarning = `A ${amenity_name.trim()} bill for ${billing_period.trim()} already exists — create another anyway?`;
      return;
    }

    if (billing_method === "connected") {
      const overlaps = await findConnectedRoomOverlap(
        db,
        amenity_name,
        billing_period.trim() || null,
        selectedConnectedRoomIds,
        editing?.id,
      );
      if (overlaps.length > 0 && overlapWarning.length === 0) {
        overlapWarning = overlaps.map(
          (room) => `${room.room_number} is already on "${room.amenity_name}" for this period`,
        );
        return;
      }
    }

    saving = true;
    try {
      const input = {
        amenity_name: amenity_name.trim(),
        billing_method,
        total_amount: total,
        billing_date,
        billing_period: billing_period.trim() || null,
        notes: notes.trim() || null,
        division_mode,
        tenantShares: computedShares,
        excluded: excludedMap,
        roomIds,
        meter_start: meter_start.trim() === "" ? null : Number(meter_start),
        meter_end: meter_end.trim() === "" ? null : Number(meter_end),
        price_per_unit: price_per_unit.trim() === "" ? null : Number(price_per_unit),
      };

      const result = editing
        ? await updateAmenityBill(db, editing.id, input)
        : await createAmenityBill(db, input);

      if (result.error) {
        error = result.error;
        saving = false;
        return;
      }
      pushToast(
        editing
          ? `Amenity bill updated — ${amenity_name.trim()}`
          : `Amenity bill created — ${amenity_name.trim()} ${phpPesoPrecise(total)}`,
        "success",
      );
      dismiss(onSaveDone);
    } catch (e) {
      error = String(e);
    } finally {
      saving = false;
    }
  }

  function reduceMotion(): boolean {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /** Play the slide-down first, then unmount through the caller's callback. */
  function dismiss(done: () => void) {
    if (closing) return;
    closing = true;
    window.setTimeout(done, reduceMotion() ? 0 : 250);
  }

  function close() {
    if (saving) return;
    dismiss(onClose);
  }
</script>

<div class="sheet-backdrop" class:closing role="presentation" onclick={close}>
  <div
    class="sheet"
    class:closing
    role="dialog"
    aria-modal="true"
    aria-label={editing ? "Edit Amenity Bill" : "New Amenity Bill"}
    onclick={(e) => e.stopPropagation()}
  >
    <div class="sheet-grabber" aria-hidden="true"></div>

    <header class="sheet-head">
      <h2>{editing ? "Edit Amenity Bill" : "New Amenity Bill"}</h2>
    </header>

    <div class="sheet-body">
      {#if error}
        <p class="form-error">{error}</p>
      {/if}
      {#if duplicateWarning}
        <div class="alert">
          {duplicateWarning}
          <div class="form-actions">
            <button class="btn btn-primary" onclick={() => { duplicateWarning = null; handleSave(); }}>Proceed Anyway</button>
            <button class="btn" onclick={() => duplicateWarning = null}>Cancel</button>
          </div>
        </div>
      {/if}
      {#if overlapWarning.length > 0}
        <div class="alert">
          {overlapWarning.join("; ")}. Add {overlapWarning.length > 1 ? "them" : "it"} to this bill anyway?
          <div class="form-actions">
            <button class="btn btn-primary" onclick={() => { overlapWarning = []; handleSave(); }}>Proceed Anyway</button>
            <button class="btn" onclick={() => overlapWarning = []}>Cancel</button>
          </div>
        </div>
      {/if}
      {#if pendingMethod}
        <div class="alert">
          Switching to {methodLabel(pendingMethod)} will recompute the shares from the selected tenants or rooms.
          <div class="form-actions">
            <button class="btn btn-primary" onclick={applyMethodChange}>Switch Method</button>
            <button class="btn" onclick={() => pendingMethod = null}>Keep {methodLabel(billing_method)}</button>
          </div>
        </div>
      {/if}
      {#if meterInfo.error}
        <p class="form-error">{meterInfo.error}</p>
      {/if}

      <label class="field">
        <span class="field-label">Amenity Type</span>
        <select class="select-field" value={selectedType} onchange={onTypeChange}>
          <option value={CUSTOM_TYPE}>Custom</option>
          {#each AMENITY_PRESETS as preset}
            <option value={preset}>{preset}</option>
          {/each}
        </select>
      </label>

      <label class="field">
        <span class="field-label">Amenity Name</span>
        <input type="text" bind:this={nameInput} placeholder="e.g. Electricity — Main Meter" bind:value={amenity_name} />
      </label>

      <label class="field">
        <span class="field-label">Billing Method</span>
        <select class="select-field" value={billing_method} onchange={(e) => requestMethodChange((e.target as HTMLSelectElement).value)}>
          <option value="shared">Shared Billing</option>
          <option value="per_room">Per-Room Billing — Room-Specific Amenity</option>
          <option value="connected">Connected Rooms — Joint Room Billing</option>
        </select>
      </label>

      <label class="field">
        <span class="field-label">Total Bill Amount (₱)</span>
        <input type="number" min="0" step="0.01" placeholder="1000" bind:value={total_amount} />
      </label>
      {#if split.absorbed > 0 && computedShares.size > 0}
        <p class="muted absorbed">Landlord absorbs {phpPesoPrecise(split.absorbed)} (tenants pay {phpPesoPrecise(netTotal)} of {phpPesoPrecise(Number(total_amount) || 0)}).</p>
      {/if}

      <label class="field">
        <span class="field-label">Billing Date</span>
        <input type="date" bind:value={billing_date} />
      </label>

      <label class="field">
        <span class="field-label">Billing Period</span>
        <input type="month" bind:value={billing_period} />
      </label>

      <label class="field">
        <span class="field-label">Notes</span>
        <textarea rows="2" placeholder="Optional notes" bind:value={notes}></textarea>
      </label>

      <label class="field">
        <span class="field-label">Division Mode</span>
        <select class="select-field" bind:value={division_mode}>
          <option value="auto">Automatic equal division</option>
          <option value="manual">Manual per-tenant amounts</option>
        </select>
      </label>

      {#if billing_method === "per_room" || billing_method === "connected"}
        <div class="meter-block">
          {#if billing_method === "per_room"}
            <p class="block-title">Meter (optional)</p>
            <div class="grid3">
              <label class="field tight"><span class="field-label">Start</span><input type="number" step="0.01" bind:value={meter_start} /></label>
              <label class="field tight"><span class="field-label">End</span><input type="number" step="0.01" bind:value={meter_end} /></label>
              <label class="field tight"><span class="field-label">Price/unit</span><input type="number" step="0.01" bind:value={price_per_unit} /></label>
            </div>
            {#if meterInfo.units != null}
              <p class="muted">{meterInfo.units} units × {price_per_unit} = {phpPesoPrecise(meterInfo.total ?? 0)} — the bill total above stays authoritative.</p>
            {/if}
            <label class="field tight">
              <span class="field-label">Room / Pad</span>
              <select class="select-field" bind:value={selectedRoomId}>
                <option value="">Select room</option>
                {#each rooms as room}
                  <option value={String(room.id)}>{room.room_number}</option>
                {/each}
              </select>
            </label>
            {#if selectedRoomId && roomPickable.length === 0}
              <p class="muted">{AMENITY_MESSAGES.roomEmpty} — cannot bill an empty room.</p>
            {/if}
          {:else}
            <p class="block-title">Connected Rooms — select at least 2</p>
            <div class="pick-list">
              {#each rooms as room}
                <label class="pick-row room-row">
                  <span class="pick-main">
                    <input type="checkbox" checked={selectedConnectedRoomIds.includes(room.id)} onchange={() => toggleConnectedRoom(room.id)} />
                    <span class="pick-name">{room.room_number}</span>
                  </span>
                </label>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      <section class="pick-section">
        <div class="section-head">
          <h3>{pickerTitle}</h3>
          <label class="inactive-toggle">
            <input type="checkbox" bind:checked={showInactive} />
            Show inactive
          </label>
        </div>

        {#if billing_method === "shared"}
          {#if pickableTenants.length === 0}
            <p class="muted">No tenants to bill yet.</p>
          {/if}
          <div class="pick-list">
            {#each pickableTenants as tenant (tenant.id)}
              {@const isExcluded = excludedMap.has(tenant.id)}
              {@const isSelected = selectedTenantIds.includes(tenant.id) || isExcluded}
              <div class="pick-row" class:selected={isSelected} class:excluded={isExcluded}>
                <div class="pick-main">
                  <input
                    type="checkbox"
                    id={`pick-${tenant.id}`}
                    checked={isSelected}
                    onchange={() => toggleTenant(tenant.id)}
                  />
                  <label class="pick-name" for={`pick-${tenant.id}`}>
                    {tenant.name} — {tenant.room_number}
                  </label>
                  {#if tenant.moved_out_date}
                    <span class="badge badge-inactive">Inactive · moved out {formatDate(tenant.moved_out_date)}</span>
                  {/if}
                  {#if isExcluded}
                    <span class="badge badge-inactive">Inactive/Excluded</span>
                  {/if}
                </div>

                {#if isSelected}
                  <div class="pick-extra">
                    <label class="inline-check">
                      <input type="checkbox" checked={isExcluded} onchange={() => toggleExclude(tenant.id)} />
                      Exclude
                    </label>
                    {#if isExcluded}
                      <input
                        type="text"
                        class="small-input"
                        placeholder="Reason"
                        value={excludedMap.get(tenant.id) ?? ""}
                        oninput={(e) => setExclusionReason(tenant.id, (e.target as HTMLInputElement).value)}
                      />
                      <span class="amount-chip">₱0.00</span>
                    {:else}
                      <span class="amount-chip">{phpPesoPrecise(computedShares.get(tenant.id) ?? 0)}</span>
                      {#if division_mode === "manual"}
                        <input
                          type="number"
                          class="small-input"
                          step="0.01"
                          placeholder="0"
                          value={manualAmounts.get(tenant.id) ?? ""}
                          oninput={(e) => setManualAmount(tenant.id, (e.target as HTMLInputElement).value)}
                        />
                      {/if}
                    {/if}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {:else if billing_method === "per_room"}
          {#if selectedRoomId && roomPickable.length > 0}
            <div class="pick-list">
              {#each roomPickable as tenant (tenant.id)}
                <div class="pick-row">
                  <div class="pick-main">
                    <span class="pick-name">{tenant.name} — {tenant.room_number}</span>
                    {#if tenant.moved_out_date}
                      <span class="badge badge-inactive">Inactive · moved out {formatDate(tenant.moved_out_date)}</span>
                    {/if}
                  </div>
                  <div class="pick-extra">
                    <span class="amount-chip">{phpPesoPrecise(computedShares.get(tenant.id) ?? 0)}</span>
                    {#if division_mode === "manual"}
                      <input
                        type="number"
                        class="small-input"
                        step="0.01"
                        placeholder="0"
                        value={manualAmounts.get(tenant.id) ?? ""}
                        oninput={(e) => setManualAmount(tenant.id, (e.target as HTMLInputElement).value)}
                      />
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          {:else if !selectedRoomId}
            <p class="muted">Pick a room above to see its occupants.</p>
          {/if}
        {:else}
          {#if pooledTenants.length === 0}
            <p class="muted">Select at least two rooms above — every pooled tenant shares the bill.</p>
          {:else}
            <p class="muted pooled-note">
              {pooledTenants.length} pooled tenant{pooledTenants.length === 1 ? "" : "s"} — the whole bill is divided across all of them, never per room first.
            </p>
            <div class="pick-list">
              {#each pooledTenants as tenant (tenant.id)}
                <div class="pick-row">
                  <div class="pick-main">
                    <span class="pick-name">{tenant.name} — {tenant.room_number}</span>
                    {#if tenant.moved_out_date}
                      <span class="badge badge-inactive">Inactive · moved out {formatDate(tenant.moved_out_date)}</span>
                    {/if}
                  </div>
                  <div class="pick-extra">
                    <span class="amount-chip">{phpPesoPrecise(computedShares.get(tenant.id) ?? 0)}</span>
                    {#if division_mode === "manual"}
                      <input
                        type="number"
                        class="small-input"
                        step="0.01"
                        placeholder="0"
                        value={manualAmounts.get(tenant.id) ?? ""}
                        oninput={(e) => setManualAmount(tenant.id, (e.target as HTMLInputElement).value)}
                      />
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        {/if}
      </section>
    </div>

    <footer class="sheet-foot">
      <button class="btn sheet-btn btn-cancel" onclick={close} disabled={saving || closing}>Cancel</button>
      <button class="btn btn-primary sheet-btn" onclick={handleSave} disabled={saving || closing}>
        {saving ? "Saving…" : editing ? "Save Changes" : "Create Bill"}
      </button>
    </footer>
  </div>
</div>

<style>
  /* ---- presentation: a form sheet, not a centered dialog ---------------- */
  .sheet-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    background: rgba(0, 0, 0, 0.35);
    transition: background-color 0.25s ease;
  }
  .sheet-backdrop.closing {
    background: rgba(0, 0, 0, 0);
  }
  @starting-style {
    .sheet-backdrop {
      background: rgba(0, 0, 0, 0);
    }
  }
  :global(:root[data-theme="dark"]) .sheet-backdrop {
    background: rgba(0, 0, 0, 0.5);
  }
  :global(:root[data-theme="dark"]) .sheet-backdrop.closing {
    background: rgba(0, 0, 0, 0);
  }
  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .sheet-backdrop {
      background: rgba(0, 0, 0, 0.5);
    }
    :global(:root:not([data-theme="light"])) .sheet-backdrop.closing {
      background: rgba(0, 0, 0, 0);
    }
  }

  .sheet {
    width: 100%;
    max-width: 560px;
    height: 100%;
    /* Leaves the phone's status bar visible above the sheet, exactly as the
       mockup does, while staying full-height on a desktop window. */
    max-height: calc(100% - env(safe-area-inset-top, 0px) - 34px);
    display: flex;
    flex-direction: column;
    background: var(--card);
    border-radius: 22px 22px 0 0;
    box-shadow: var(--shadow-modal);
    overflow: hidden;
    color-scheme: light;
    transform: translateY(0);
    transition: transform 0.26s cubic-bezier(0.32, 0.72, 0, 1);
    will-change: transform;
  }
  .sheet.closing {
    transform: translateY(110%);
  }
  @starting-style {
    .sheet {
      transform: translateY(110%);
    }
  }
  :global(:root[data-theme="dark"]) .sheet {
    color-scheme: dark;
  }
  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .sheet {
      color-scheme: dark;
    }
  }

  .sheet-grabber {
    flex-shrink: 0;
    width: 44px;
    height: 5px;
    border-radius: 999px;
    background: var(--separator);
    margin: 10px auto 0;
  }

  .sheet-head {
    flex-shrink: 0;
    padding: 14px 20px 12px;
  }
  .sheet-head h2 {
    margin: 0;
    font-size: 1.45rem;
    font-weight: 700;
    letter-spacing: -0.022em;
  }

  .sheet-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0 20px 20px;
  }

  .sheet-foot {
    flex-shrink: 0;
    display: flex;
    gap: 10px;
    padding: 12px 20px calc(env(safe-area-inset-bottom, 0px) + 14px);
    border-top: 1px solid var(--separator);
    background: var(--card);
  }
  .sheet-btn {
    flex: 1;
    padding: 13px 14px;
    border-radius: 12px;
    font-size: 0.95rem;
  }
  .btn-cancel {
    background: var(--fill);
    border: none;
    color: var(--accent);
  }

  /* ---- fields ----------------------------------------------------------- */
  .field {
    display: flex;
    flex-direction: column;
    gap: 7px;
    margin-bottom: 16px;
  }
  .field.tight {
    margin-bottom: 10px;
  }
  .field-label {
    font-size: 0.82rem;
    font-weight: 600;
  }

  .field :is(input, select, textarea) {
    width: 100%;
    box-sizing: border-box;
    padding: 12px 13px;
    font-family: inherit;
    /* 1rem (16px) — anything smaller makes iOS zoom the page on focus. */
    font-size: 1rem;
    color: var(--label);
    background: var(--fill);
    border: 1px solid var(--separator);
    border-radius: 11px;
    transition:
      border-color 0.15s ease,
      box-shadow 0.15s ease;
  }
  .field :is(input, textarea)::placeholder {
    color: var(--label-3);
  }
  .field :is(input, select, textarea):focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .field textarea {
    resize: vertical;
    min-height: 3.1rem;
    line-height: 1.45;
  }
  /* Native pickers (date/month) follow color-scheme from .sheet; trim the
     built-in calendar control so it matches the custom selects. */
  .field input[type="date"],
  .field input[type="month"] {
    -webkit-appearance: none;
    appearance: none;
    min-height: 2.9rem;
  }

  /* Higher specificity than the shared field rule above, so the chevron wins. */
  .field select.select-field {
    -webkit-appearance: none;
    appearance: none;
    padding-right: 38px;
    background-image: var(--chevron);
    background-repeat: no-repeat;
    background-position: right 13px center;
    background-size: 13px 13px;
    --chevron: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'><path d='M2.6 4.6 6 8l3.4-3.4' fill='none' stroke='%236c6c70' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'/></svg>");
  }
  :global(:root[data-theme="dark"]) .field select.select-field {
    --chevron: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'><path d='M2.6 4.6 6 8l3.4-3.4' fill='none' stroke='%23b0b0b0' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'/></svg>");
  }
  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .field select.select-field {
      --chevron: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'><path d='M2.6 4.6 6 8l3.4-3.4' fill='none' stroke='%23b0b0b0' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'/></svg>");
    }
  }

  .absorbed {
    margin: -8px 0 16px;
    font-size: 0.82rem;
  }

  /* ---- method-specific block ------------------------------------------- */
  .meter-block {
    border: 1px solid var(--separator);
    border-radius: 12px;
    padding: 13px;
    margin-bottom: 16px;
  }
  .block-title {
    margin: 0 0 10px;
    font-size: 0.82rem;
    font-weight: 600;
  }
  .grid3 {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 8px;
  }

  /* ---- tenant / room picker -------------------------------------------- */
  .pick-section {
    margin-bottom: 8px;
  }
  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 10px;
  }
  .section-head h3 {
    margin: 0;
    font-size: 0.82rem;
    font-weight: 600;
  }
  .inactive-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--label-2);
    white-space: nowrap;
    cursor: pointer;
  }
  .inactive-toggle input {
    width: 16px;
    height: 16px;
    margin: 0;
    accent-color: var(--accent);
  }

  .pick-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .pick-row {
    border: 1px solid var(--separator);
    border-radius: 12px;
    padding: 12px;
    transition:
      background 0.15s ease,
      border-color 0.15s ease;
  }
  .pick-row.selected {
    background: var(--fill);
  }
  .pick-row.excluded {
    opacity: 0.72;
  }
  .room-row {
    cursor: pointer;
  }

  .pick-main {
    display: flex;
    align-items: center;
    gap: 11px;
    flex-wrap: wrap;
  }
  .pick-main input[type="checkbox"] {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    margin: 0;
    accent-color: var(--accent);
  }
  .pick-name {
    font-size: 0.95rem;
  }
  label.pick-name {
    cursor: pointer;
  }

  .pick-extra {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: 11px;
    padding-top: 11px;
    border-top: 1px solid var(--separator);
  }
  .inline-check {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--label-2);
    cursor: pointer;
  }
  .inline-check input {
    width: 15px;
    height: 15px;
    margin: 0;
    accent-color: var(--accent);
  }
  .amount-chip {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    font-size: 0.9rem;
  }
  .small-input {
    width: 6.5rem;
    box-sizing: border-box;
    padding: 8px 10px;
    font-family: inherit;
    /* 1rem (16px) — anything smaller makes iOS zoom the page on focus. */
    font-size: 1rem;
    color: var(--label);
    background: var(--card);
    border: 1px solid var(--separator);
    border-radius: 9px;
  }
  .small-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .badge-inactive {
    background: var(--gray-soft);
    color: var(--gray-deep);
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.01em;
  }
  .pooled-note {
    margin: 0 0 10px;
    font-size: 0.82rem;
  }

  /* ---- reduced transparency / motion ------------------------------------ */
  @media (prefers-reduced-motion: reduce) {
    .sheet-backdrop,
    .sheet,
    .pick-row {
      transition: none;
    }
    @starting-style {
      .sheet-backdrop {
        background: rgba(0, 0, 0, 0.35);
      }
      .sheet {
        transform: translateY(0);
      }
    }
  }
</style>
