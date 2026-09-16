<script lang="ts">
  import { onMount } from "svelte";
  import { getDb } from "$lib/db";
  import { pushToast } from "$lib/toast.svelte";
  import {
    AMENITY_TYPES,
    calcSharedSplit,
    calcPerRoomSplit,
    calcConnectedSplit,
    calculateMeterTotal,
    validateBill,
    validateExclusionReason,
    round2,
  } from "$lib/amenity-billing";
  import {
    createAmenityBill,
    updateAmenityBill,
    checkDuplicateAmenity,
    type AmenityBillRow,
  } from "$lib/amenity-actions";
  import { phpPesoPrecise } from "$lib/format";
  import { modalMaterial } from "$lib/motion";

  let {
    editing,
    onSaveDone,
    onClose,
  }: {
    editing: AmenityBillRow | null;
    onSaveDone: () => void;
    onClose: () => void;
  } = $props();

  let rooms: { id: number; room_number: string }[] = $state([]);
  let activeTenants: { id: number; name: string; room_number: string; room_id: number }[] = $state([]);
  let roomTenants: { id: number; name: string; room_number: string }[] = $state([]);

  let amenity_type = $state<string>(editing?.amenity_type ?? "Electricity");
  let amenity_name = $state(editing?.amenity_name ?? "");
  let billing_method = $state<string>(editing?.billing_method ?? "shared");
  let total_amount = $state<string>(editing ? String(editing.total_amount) : "");
  let billing_date = $state(editing?.billing_date ?? new Date().toISOString().slice(0, 10));
  let billing_period = $state(editing?.billing_period ?? "");
  let notes = $state(editing?.notes ?? "");
  let division_mode = $state<string>(editing?.division_mode ?? "auto");

  let meter_start = $state<string>(editing?.meter_start != null ? String(editing.meter_start) : "");
  let meter_end = $state<string>(editing?.meter_end != null ? String(editing.meter_end) : "");
  let price_per_unit = $state<string>(editing?.price_per_unit != null ? String(editing.price_per_unit) : "");

  let selectedRoomId = $state<string>("");
  let selectedConnectedRoomIds: number[] = $state([]);
  let selectedTenantIds: number[] = $state([]);
  let excludedMap: Map<number, string> = $state(new Map());
  let manualAmounts: Map<number, number> = $state(new Map());

  let duplicateWarning: string | null = $state(null);
  let saving = $state(false);
  let error: string | null = $state(null);

  let editInitialLoaded = false;

  async function loadData() {
    const db = await getDb();
    rooms = await db.select<{ id: number; room_number: string }[]>("SELECT id, room_number FROM rooms ORDER BY room_number");
    activeTenants = await db.select<{ id: number; name: string; room_number: string; room_id: number }[]>(
      "SELECT t.id, t.name, r.room_number, t.room_id FROM tenants t JOIN rooms r ON r.id=t.room_id WHERE t.moved_out_date IS NULL ORDER BY t.name",
    );
  }

  async function loadRoomTenants(roomId: number) {
    const db = await getDb();
    roomTenants = await db.select<{ id: number; name: string; room_number: string }[]>(
      "SELECT t.id, t.name, r.room_number FROM tenants t JOIN rooms r ON r.id=t.room_id WHERE t.room_id=$1 AND t.moved_out_date IS NULL ORDER BY t.name",
      [roomId],
    );
  }

  async function loadEditing() {
    if (!editing || editInitialLoaded) return;
    const db = await getDb();
    const trows = await db.select<{ tenant_id: number; amount: number; is_excluded: number; exclusion_reason: string | null }[]>(
      "SELECT tenant_id, amount, is_excluded, exclusion_reason FROM amenity_bill_tenants WHERE bill_id=$1",
      [editing.id],
    );
    const rrows = await db.select<{ room_id: number }[]>("SELECT room_id FROM amenity_bill_rooms WHERE bill_id=$1", [editing.id]);
    selectedConnectedRoomIds = rrows.map((r) => r.room_id);
    if (editing.billing_method === "per_room" && rrows.length > 0) selectedRoomId = String(rrows[0].room_id);

    const shares = new Map<number, number>();
    const excl = new Map<number, string>();
    const sel: number[] = [];
    for (const r of trows) {
      if (r.is_excluded) excl.set(r.tenant_id, r.exclusion_reason ?? "");
      else {
        shares.set(r.tenant_id, r.amount);
        sel.push(r.tenant_id);
      }
    }
    excludedMap = excl;
    manualAmounts = shares;
    selectedTenantIds = sel;
    if (editing.billing_method === "per_room" && selectedRoomId) {
      await loadRoomTenants(Number(selectedRoomId));
    }
    editInitialLoaded = true;
  }

  onMount(async () => {
    await loadData();
    await loadEditing();
  });

  $effect(() => {
    if (selectedRoomId) {
      loadRoomTenants(Number(selectedRoomId));
    }
  });

  let pooledTenants: typeof activeTenants = $derived.by(() => {
    if (billing_method !== "connected") return [];
    const pooled: typeof activeTenants = [];
    for (const rid of selectedConnectedRoomIds) {
      for (const t of activeTenants) if (t.room_id === rid) pooled.push(t);
    }
    return pooled.sort((a, b) => a.name.localeCompare(b.name));
  });

  let perRoomTenantIds: number[] = $derived(roomTenants.map((t) => t.id));

  let computedShares: Map<number, number> = $derived.by(() => {
    const total = Number(total_amount) || 0;
    if (!total || total <= 0) return new Map();
    try {
      if (billing_method === "shared") {
        const ids = selectedTenantIds.length > 0 ? selectedTenantIds : [];
        const allIds = [...ids, ...[...excludedMap.keys()]];
        if (division_mode === "auto") {
          return calcSharedSplit({ total, tenantIds: allIds, excluded: excludedMap, manualOverrides: new Map() }).shares;
        } else {
          return calcSharedSplit({ total, tenantIds: allIds, excluded: excludedMap, manualOverrides: manualAmounts }).shares;
        }
      } else if (billing_method === "per_room") {
        if (division_mode === "auto") return calcPerRoomSplit(perRoomTenantIds, total, new Map(), "auto").shares;
        return calcPerRoomSplit(perRoomTenantIds, total, manualAmounts, "manual").shares;
      } else if (billing_method === "connected") {
        const ids = pooledTenants.map((t) => t.id);
        if (division_mode === "auto") return calcConnectedSplit(ids, total, new Map(), "auto").shares;
        return calcConnectedSplit(ids, total, manualAmounts, "manual").shares;
      }
    } catch {}
    return new Map();
  });

  let manualSum = $derived.by(() => {
    let s = 0;
    for (const v of manualAmounts.values()) s = round2(s + v);
    return s;
  });

  let meterInfo = $derived.by(() => {
    const s = meter_start.trim() === "" ? null : Number(meter_start);
    const e = meter_end.trim() === "" ? null : Number(meter_end);
    const p = price_per_unit.trim() === "" ? null : Number(price_per_unit);
    return calculateMeterTotal(s, e, p);
  });

  function toggleTenant(id: number) {
    if (selectedTenantIds.includes(id)) {
      selectedTenantIds = selectedTenantIds.filter((x) => x !== id);
      const m = new Map(manualAmounts);
      m.delete(id);
      manualAmounts = m;
      const e = new Map(excludedMap);
      e.delete(id);
      excludedMap = e;
    } else {
      selectedTenantIds = [...selectedTenantIds, id];
    }
  }

  function toggleExclude(id: number) {
    const e = new Map(excludedMap);
    if (e.has(id)) e.delete(id);
    else e.set(id, "");
    excludedMap = e;
  }

  function toggleConnectedRoom(id: number) {
    if (selectedConnectedRoomIds.includes(id)) {
      selectedConnectedRoomIds = selectedConnectedRoomIds.filter((x) => x !== id);
    } else {
      selectedConnectedRoomIds = [...selectedConnectedRoomIds, id];
    }
  }

  async function handleSave() {
    error = null;
    duplicateWarning = null;
    const total = Number(total_amount);
    if (!amenity_name.trim()) {
      error = "Amenity name is required.";
      return;
    }
    if (!total || isNaN(total) || total <= 0) {
      error = "Bill amount cannot be empty or negative.";
      return;
    }
    if (billing_method === "connected" && selectedConnectedRoomIds.length < 2) {
      error = "Connected-room groups must contain at least two rooms.";
      return;
    }
    if (billing_method === "shared" && selectedTenantIds.length === 0 && excludedMap.size === 0) {
      error = "At least one tenant or room must be selected.";
      return;
    }
    if (billing_method === "per_room" && !selectedRoomId) {
      error = "At least one tenant or room must be selected.";
      return;
    }
    for (const [tid, reason] of excludedMap) {
      const err = validateExclusionReason(true, reason);
      if (err) {
        error = err;
        return;
      }
    }

    const shares = computedShares;
    if (division_mode === "manual") {
      let sum = 0;
      for (const v of shares.values()) sum = round2(sum + v);
      if (Math.abs(sum - total) > 0.01) {
        error = `Manual tenant amounts must equal the total bill (currently ${sum} vs ${total}).`;
        return;
      }
    }

    const db = await getDb();
    if (billing_period.trim()) {
      const dup = await checkDuplicateAmenity(db, amenity_name.trim(), billing_period.trim(), editing?.id);
      if (dup && !duplicateWarning) {
        duplicateWarning = `A ${amenity_name.trim()} bill for ${billing_period.trim()} already exists — create another anyway?`;
        return;
      }
    }

    saving = true;
    try {
      let tenantShares: Map<number, number>;
      let excl = excludedMap;
      let roomIds: number[] = [];
      if (billing_method === "shared") {
        tenantShares = shares;
      } else if (billing_method === "per_room") {
        tenantShares = shares;
        roomIds = selectedRoomId ? [Number(selectedRoomId)] : [];
      } else {
        tenantShares = shares;
        roomIds = [...selectedConnectedRoomIds];
      }

      const input = {
        amenity_name: amenity_name.trim(),
        amenity_type,
        billing_method,
        total_amount: total,
        billing_date,
        billing_period: billing_period.trim() || null,
        notes: notes.trim() || null,
        division_mode,
        tenantShares,
        excluded: excl,
        roomIds,
        meter_start: meter_start.trim() === "" ? null : Number(meter_start),
        meter_end: meter_end.trim() === "" ? null : Number(meter_end),
        price_per_unit: price_per_unit.trim() === "" ? null : Number(price_per_unit),
      };

      let res;
      if (editing) res = await updateAmenityBill(db, editing.id, input);
      else res = await createAmenityBill(db, input as any);

      if (res.error) {
        error = res.error;
        saving = false;
        return;
      }
      pushToast(editing ? `Amenity bill updated — ${amenity_name.trim()}` : `Amenity bill created — ${amenity_name.trim()} ${phpPesoPrecise(total)}`, "success");
      onSaveDone();
    } catch (e) {
      error = String(e);
    } finally {
      saving = false;
    }
  }

  function close() {
    if (saving) return;
    onClose();
  }
</script>

<div class="modal" role="dialog" aria-label="Amenity Bill Form" onclick={close}>
  <div class="modal-card" onclick={(e) => e.stopPropagation()} transition:modalMaterial>
    <h2>{editing ? "Edit Amenity Bill" : "New Amenity Bill"}</h2>

    {#if error}
      <div class="alert">{error}</div>
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
    {#if meterInfo.error}
      <div class="alert">{meterInfo.error}</div>
    {/if}

    <label>
      Amenity Type
      <select bind:value={amenity_type}>
        {#each AMENITY_TYPES as t}
          <option value={t}>{t}</option>
        {/each}
      </select>
    </label>

    <label>
      Amenity Name
      <input type="text" placeholder="e.g. Electricity — Main Meter" bind:value={amenity_name} />
    </label>

    <label>
      Billing Method
      <select bind:value={billing_method}>
        <option value="shared">Shared Billing</option>
        <option value="per_room">Per-Room Billing — Room-Specific Amenity</option>
        <option value="connected">Connected Rooms — Joint Room Billing</option>
      </select>
    </label>

    <label>
      Total Bill Amount (₱)
      <input type="number" min="0" step="0.01" placeholder="1000" bind:value={total_amount} />
    </label>

    <div class="grid2">
      <label>
        Billing Date
        <input type="date" bind:value={billing_date} />
      </label>
      <label>
        Billing Period
        <input type="text" placeholder="2026-09 or Sep 1-30, 2026" bind:value={billing_period} />
      </label>
    </div>

    <label>
      Notes
      <textarea rows="2" placeholder="Optional notes" bind:value={notes}></textarea>
    </label>

    <label>
      Division Mode
      <select bind:value={division_mode}>
        <option value="auto">Automatic equal division</option>
        <option value="manual">Manual per-tenant amounts</option>
      </select>
    </label>

    {#if billing_method === "per_room"}
      <div class="meter-block">
        <p class="section-title">Meter (optional)</p>
        <div class="grid3">
          <label>Start <input type="number" step="0.01" bind:value={meter_start} /></label>
          <label>End <input type="number" step="0.01" bind:value={meter_end} /></label>
          <label>Price/unit <input type="number" step="0.01" bind:value={price_per_unit} /></label>
        </div>
        {#if meterInfo.units != null}
          <p class="muted">{meterInfo.units} units × {price_per_unit} = {phpPesoPrecise(meterInfo.total ?? 0)} — total is still the bill amount</p>
        {/if}
        <label>
          Room / Pad
          <select bind:value={selectedRoomId}>
            <option value="">Select room</option>
            {#each rooms as r}
              <option value={String(r.id)}>{r.room_number}</option>
            {/each}
          </select>
        </label>
        {#if roomTenants.length > 0}
          <div class="tenant-pick">
            {#each roomTenants as t}
              <div class="pick-row">
                <span>{t.name} — {t.room_number}</span>
                <span class="amount-chip">{phpPesoPrecise(computedShares.get(t.id) ?? 0)}</span>
                {#if division_mode === "manual"}
                  <input type="number" step="0.01" placeholder="0" value={manualAmounts.get(t.id) ?? ""} oninput={(e) => { const v = Number((e.target as HTMLInputElement).value); const m = new Map(manualAmounts); if (isNaN(v) || (e.target as HTMLInputElement).value === "") m.delete(t.id); else m.set(t.id, v); manualAmounts = m; }} />
                {/if}
              </div>
            {/each}
          </div>
        {:else if selectedRoomId}
          <p class="muted">No active tenants in this room — cannot bill an empty room.</p>
        {/if}
      </div>
    {/if}

    {#if billing_method === "shared"}
      <div class="tenant-pick">
        <p class="section-title">Select Tenants</p>
        {#each activeTenants as t}
          <div class="pick-row" class:excluded={excludedMap.has(t.id)}>
            <label class="pick-label">
              <input type="checkbox" checked={selectedTenantIds.includes(t.id) || excludedMap.has(t.id)} onchange={() => toggleTenant(t.id)} />
              <span>{t.name} — {t.room_number}</span>
              {#if excludedMap.has(t.id)}
                <span class="badge badge-inactive">Inactive/Excluded</span>
              {/if}
            </label>
            {#if selectedTenantIds.includes(t.id) || excludedMap.has(t.id)}
              <div class="pick-actions">
                <label class="exclude-check"><input type="checkbox" checked={excludedMap.has(t.id)} onchange={() => toggleExclude(t.id)} /> Exclude</label>
                {#if excludedMap.has(t.id)}
                  <input type="text" placeholder="Reason" value={excludedMap.get(t.id) ?? ""} oninput={(e) => { const e2 = new Map(excludedMap); e2.set(t.id, (e.target as HTMLInputElement).value); excludedMap = e2; }} />
                  <span class="amount-chip">₱0.00</span>
                {:else}
                  <span class="amount-chip">{phpPesoPrecise(computedShares.get(t.id) ?? 0)}</span>
                  {#if division_mode === "manual"}
                    <input type="number" step="0.01" placeholder="0" value={manualAmounts.get(t.id) ?? ""} oninput={(e) => { const v = Number((e.target as HTMLInputElement).value); const m = new Map(manualAmounts); if (isNaN(v) || (e.target as HTMLInputElement).value === "") m.delete(t.id); else m.set(t.id, v); manualAmounts = m; }} />
                  {/if}
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if billing_method === "connected"}
      <div class="tenant-pick">
        <p class="section-title">Connected Rooms — select ≥2 rooms</p>
        {#each rooms as r}
          <label class="pick-label">
            <input type="checkbox" checked={selectedConnectedRoomIds.includes(r.id)} onchange={() => toggleConnectedRoom(r.id)} />
            <span>{r.room_number}</span>
          </label>
        {/each}
        {#if pooledTenants.length > 0}
          <p class="muted">Pooled tenants: {pooledTenants.length} — {phpPesoPrecise(Number(total_amount) || 0)} ÷ {pooledTenants.length} equally when Auto</p>
          {#each pooledTenants as t}
            <div class="pick-row">
              <span>{t.name} — {t.room_number}</span>
              <span class="amount-chip">{phpPesoPrecise(computedShares.get(t.id) ?? 0)}</span>
              {#if division_mode === "manual"}
                <input type="number" step="0.01" value={manualAmounts.get(t.id) ?? ""} oninput={(e) => { const v = Number((e.target as HTMLInputElement).value); const m = new Map(manualAmounts); if (isNaN(v) || (e.target as HTMLInputElement).value === "") m.delete(t.id); else m.set(t.id, v); manualAmounts = m; }} />
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    {/if}

    <div class="form-actions">
      <button class="btn" onclick={close} disabled={saving}>Cancel</button>
      <button class="btn btn-primary" onclick={handleSave} disabled={saving}>{saving ? "Saving…" : editing ? "Save Changes" : "Create Bill"}</button>
    </div>
  </div>
</div>

<style>
  .modal-card {
    background: var(--card);
    border-radius: 16px;
    padding: 20px;
    max-width: 560px;
    width: 100%;
    max-height: 90vh;
    overflow-y: auto;
  }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
  .meter-block { background: var(--fill); border-radius: 10px; padding: 12px; margin: 8px 0; }
  .tenant-pick { display: flex; flex-direction: column; gap: 8px; margin: 8px 0; }
  .pick-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px; border: 1px solid var(--separator); border-radius: 8px; flex-wrap: wrap; }
  .pick-row.excluded { background: var(--gray-soft); opacity: 0.7; }
  .pick-label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
  .pick-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .amount-chip { font-weight: 700; color: var(--label); }
  .badge-inactive { background: var(--gray-soft); color: var(--gray-deep); padding: 2px 8px; border-radius: 999px; font-size: 0.7rem; font-weight: 700; }
  .exclude-check { font-size: 0.85rem; display: flex; align-items: center; gap: 4px; }
  label { display: flex; flex-direction: column; gap: 4px; font-size: 0.9rem; font-weight: 600; }
  select, input[type="text"], input[type="number"], input[type="date"], textarea { padding: 8px 10px; border: 1px solid var(--separator); border-radius: 8px; font-size: 0.95rem; font-family: inherit; }
  textarea { resize: vertical; }
</style>
