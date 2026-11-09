<script lang="ts">
  import { AMENITY_MESSAGES, AMENITY_PRESETS } from "$lib/amenities/amenity-billing";
  import { phpPesoPrecise } from "$lib/ui/format";
  import ConnectedRoomPicker from "./ConnectedRoomPicker.svelte";
  import type { BillFields } from "./bill-form.svelte";

  /**
   * The form's scalar fields (type, name, method, amounts, dates, notes,
   * division) plus their shared field styling. The sheet passes its reactive
   * `fields` object straight through, so `bind:value` writes back to the form.
   */
  let {
    fields,
    absorbed,
    netTotal,
    liveManualError,
    takesAllWarning,
    rooms,
    roomPickable,
    meterInfo,
    onMethodChange,
    onDivisionChange,
    onToggleConnected,
  }: {
    fields: BillFields;
    absorbed: number;
    netTotal: number;
    liveManualError: string | null;
    takesAllWarning: string | null;
    rooms: { id: number; room_number: string }[];
    roomPickable: { id: number }[];
    meterInfo: { units: number | null; total: number | null; error: string | null };
    onMethodChange: (method: string) => void;
    onDivisionChange: (event: Event) => void;
    onToggleConnected: (id: number) => void;
  } = $props();

  /**
   * The Amenity Type picker (spec #20): there is no `amenity_type` column —
   * the nine names are quick picks that fill the free-text name. "Custom"
   * clears the field and hands the landlord the keyboard.
   */
  const CUSTOM_TYPE = "__custom";

  let selectedType = $derived(
    (AMENITY_PRESETS as readonly string[]).includes(fields.amenity_name)
      ? fields.amenity_name
      : CUSTOM_TYPE,
  );

  let nameInput: HTMLInputElement | undefined = $state();

  function onTypeChange(event: Event) {
    const value = (event.target as HTMLSelectElement).value;
    if (value === CUSTOM_TYPE) {
      fields.amenity_name = "";
      nameInput?.focus();
    } else {
      fields.amenity_name = value;
    }
  }
</script>

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
  <input type="text" bind:this={nameInput} placeholder="e.g. Electricity — Main Meter" bind:value={fields.amenity_name} />
</label>

<label class="field">
  <span class="field-label">Billing Method</span>
  <select class="select-field" value={fields.billing_method} onchange={(e) => onMethodChange((e.target as HTMLSelectElement).value)}>
    <option value="shared">Shared Billing</option>
    <option value="per_room">Per-Room Billing — Room-Specific Amenity</option>
    <option value="connected">Connected Rooms — Joint Room Billing</option>
  </select>
</label>

<label class="field">
  <span class="field-label">Total Bill Amount (₱)</span>
  <input type="number" min="0" step="0.01" placeholder="1000" bind:value={fields.total_amount} />
</label>
{#if absorbed > 0}
  <p class="muted absorbed">Landlord absorbs {phpPesoPrecise(absorbed)} (tenants pay {phpPesoPrecise(netTotal)} of {phpPesoPrecise(Number(fields.total_amount) || 0)}).</p>
{/if}
{#if liveManualError}
  <p class="form-error">{liveManualError}</p>
{/if}
{#if takesAllWarning}
  <p class="muted warning">{takesAllWarning}</p>
{/if}

<label class="field">
  <span class="field-label">Billing Date</span>
  <input type="date" bind:value={fields.billing_date} />
</label>

<label class="field">
  <span class="field-label">Billing Period</span>
  <input type="month" bind:value={fields.billing_period} />
</label>

<label class="field">
  <span class="field-label">Notes</span>
  <textarea rows="2" placeholder="Optional notes" bind:value={fields.notes}></textarea>
</label>

<label class="field">
  <span class="field-label">Division Mode</span>
  <select class="select-field" value={fields.division_mode} onchange={onDivisionChange}>
    <option value="auto">Automatic equal division</option>
    <option value="manual">Manual per-tenant amounts</option>
  </select>
</label>

{#if fields.billing_method === "per_room" || fields.billing_method === "connected"}
  <div class="meter-block">
    {#if fields.billing_method === "per_room"}
      <p class="block-title">Meter (optional)</p>
      <div class="grid3">
        <label class="field tight"><span class="field-label">Start</span><input type="number" step="0.01" bind:value={fields.meter_start} /></label>
        <label class="field tight"><span class="field-label">End</span><input type="number" step="0.01" bind:value={fields.meter_end} /></label>
        <label class="field tight"><span class="field-label">Price/unit</span><input type="number" step="0.01" bind:value={fields.price_per_unit} /></label>
      </div>
      {#if meterInfo.units != null}
        <p class="muted">{meterInfo.units} units × {fields.price_per_unit} = {phpPesoPrecise(meterInfo.total ?? 0)} — the bill total above stays authoritative.</p>
      {/if}
      <label class="field tight">
        <span class="field-label">Room / Pad</span>
        <select class="select-field" bind:value={fields.selectedRoomId}>
          <option value="">Select room</option>
          {#each rooms as room}
            <option value={String(room.id)}>{room.room_number}</option>
          {/each}
        </select>
      </label>
      {#if fields.selectedRoomId && roomPickable.length === 0}
        <p class="muted">{AMENITY_MESSAGES.roomEmpty} — cannot bill an empty room.</p>
      {/if}
    {:else}
      <p class="block-title">Connected Rooms — select at least 2</p>
      <ConnectedRoomPicker {rooms} selectedIds={fields.selectedConnectedRoomIds} onToggle={onToggleConnected} />
    {/if}
  </div>
{/if}


<style>
  /* ---- fields ----------------------------------------------------------- */
  .field {
    display: flex;
    flex-direction: column;
    gap: 7px;
    margin-bottom: 16px;
  }
  .field.tight {
    margin-bottom: var(--space-3);
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
  .warning {
    margin: -8px 0 16px;
    font-size: 0.82rem;
    color: var(--amber-deep);
  }

  /* ---- method-specific block ------------------------------------------- */
  .meter-block {
    border: 1px solid var(--separator);
    border-radius: 12px;
    padding: 13px;
    margin-bottom: 16px;
  }
  .block-title {
    margin: 0 0 var(--space-3);
    font-size: 0.82rem;
    font-weight: 600;
  }
  .grid3 {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 8px;
  }
</style>
