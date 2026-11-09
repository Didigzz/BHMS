<script lang="ts">
  import { AMENITY_MESSAGES } from "$lib/amenities/amenity-billing";
  import { formatDate, phpPesoPrecise } from "$lib/ui/format";
  import type { BillingMethod, PickTenant } from "./bill-form-types";

  let {
    method,
    manualIds,
    pickableTenants,
    roomPickable,
    pooledTenants,
    selectedRoomId,
    selectedTenantIds,
    excludedMap,
    manualAmounts,
    shares,
    showInactive = $bindable(),
    onToggleTenant,
    onToggleExclude,
    onToggleManual,
    onSetReason,
    onSetAmount,
  }: {
    method: BillingMethod;
    /** Tenants the landlord pinned to a manual amount (spec §3.1). */
    manualIds: Set<number>;
    pickableTenants: PickTenant[];
    roomPickable: PickTenant[];
    pooledTenants: PickTenant[];
    selectedRoomId: string;
    selectedTenantIds: number[];
    excludedMap: Map<number, string>;
    manualAmounts: Map<number, number>;
    shares: Map<number, number>;
    /** "Show inactive" survives re-opening the sheet (spec §18.4). */
    showInactive: boolean;
    onToggleTenant: (id: number) => void;
    onToggleExclude: (id: number) => void;
    onToggleManual: (id: number) => void;
    onSetReason: (id: number, reason: string) => void;
    onSetAmount: (id: number, amount: string) => void;
  } = $props();

  /** The heading over the picker, which changes shape with the billing method. */
  const pickerTitle = $derived(
    method === "shared" ? "Select Tenants" : method === "per_room" ? "Room Occupants" : "Pooled Tenants",
  );
</script>

<section class="pick-section">
  <div class="section-head">
    <h3>{pickerTitle}</h3>
    <label class="inactive-toggle">
      <input type="checkbox" bind:checked={showInactive} />
      Show inactive
    </label>
  </div>

  {#if method === "shared"}
    {#if pickableTenants.length === 0}
      <p class="muted">No tenants to bill yet.</p>
    {/if}
    <div class="pick-list">
      {#each pickableTenants as tenant (tenant.id)}
        {@const isExcluded = excludedMap.has(tenant.id)}
        {@const isSelected = selectedTenantIds.includes(tenant.id) || isExcluded}
        <div class="pick-row aligned-row aligned-row--pair" class:selected={isSelected} class:excluded={isExcluded}>
          <div class="aligned-row__main">
            <div class="pick-line">
              <input
                type="checkbox"
                id={`pick-${tenant.id}`}
                checked={isSelected}
                onchange={() => onToggleTenant(tenant.id)}
              />
              <label class="pick-name aligned-row__title" for={`pick-${tenant.id}`} title={tenant.name}>
                {tenant.name}
              </label>
            </div>
            <span class="aligned-row__sub">{tenant.room_number}</span>
            {#if tenant.moved_out_date}
              <span class="badge badge-inactive pick-marker">Inactive · moved out {formatDate(tenant.moved_out_date)}</span>
            {/if}
            {#if isExcluded}
              <span class="badge badge-inactive pick-marker">Inactive/Excluded</span>
            {/if}
          </div>

          {#if isSelected}
            <span class="aligned-row__amount amount-chip">{phpPesoPrecise(isExcluded ? 0 : (shares.get(tenant.id) ?? 0))}</span>
          {/if}

          {#if isSelected}
            <div class="pick-extra">
              <label class="inline-check">
                <input type="checkbox" checked={isExcluded} onchange={() => onToggleExclude(tenant.id)} />
                Exclude
              </label>
              {#if isExcluded}
                <input
                  type="text"
                  class="small-input"
                  placeholder="Reason"
                  value={excludedMap.get(tenant.id) ?? ""}
                  oninput={(e) => onSetReason(tenant.id, (e.target as HTMLInputElement).value)}
                />
              {:else}
                <label class="inline-check">
                  <input
                    type="checkbox"
                    checked={manualIds.has(tenant.id)}
                    onchange={() => onToggleManual(tenant.id)}
                  />
                  Manual
                </label>
                {#if manualIds.has(tenant.id)}
                  <input
                    type="number"
                    class="small-input"
                    step="0.01"
                    inputmode="decimal"
                    placeholder="Auto"
                    aria-label={`Manual amount for ${tenant.name}`}
                    value={manualAmounts.get(tenant.id) ?? ""}
                    oninput={(e) => onSetAmount(tenant.id, (e.target as HTMLInputElement).value)}
                  />
                {/if}
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {:else if method === "per_room"}
    {#if selectedRoomId && roomPickable.length > 0}
      <div class="pick-list">
        {#each roomPickable as tenant (tenant.id)}
          <div class="pick-row aligned-row aligned-row--pair">
            <div class="aligned-row__main">
              <span class="pick-name aligned-row__title" title={tenant.name}>{tenant.name}</span>
              <span class="aligned-row__sub">{tenant.room_number}</span>
              {#if tenant.moved_out_date}
                <span class="badge badge-inactive pick-marker">Inactive · moved out {formatDate(tenant.moved_out_date)}</span>
              {/if}
            </div>
            <span class="aligned-row__amount amount-chip">{phpPesoPrecise(shares.get(tenant.id) ?? 0)}</span>
            <div class="pick-extra">
              <label class="inline-check">
                <input
                  type="checkbox"
                  checked={manualIds.has(tenant.id)}
                  onchange={() => onToggleManual(tenant.id)}
                />
                Manual
              </label>
              {#if manualIds.has(tenant.id)}
                <input
                  type="number"
                  class="small-input"
                  step="0.01"
                  inputmode="decimal"
                  placeholder="Auto"
                  aria-label={`Manual amount for ${tenant.name}`}
                  value={manualAmounts.get(tenant.id) ?? ""}
                  oninput={(e) => onSetAmount(tenant.id, (e.target as HTMLInputElement).value)}
                />
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {:else if !selectedRoomId}
      <p class="muted">Pick a room above to see its occupants.</p>
    {:else}
      <p class="muted">{AMENITY_MESSAGES.roomEmpty} — cannot bill an empty room.</p>
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
          <div class="pick-row aligned-row aligned-row--pair">
            <div class="aligned-row__main">
              <span class="pick-name aligned-row__title" title={tenant.name}>{tenant.name}</span>
              <span class="aligned-row__sub">{tenant.room_number}</span>
              {#if tenant.moved_out_date}
                <span class="badge badge-inactive pick-marker">Inactive · moved out {formatDate(tenant.moved_out_date)}</span>
              {/if}
            </div>
            <span class="aligned-row__amount amount-chip">{phpPesoPrecise(shares.get(tenant.id) ?? 0)}</span>
            <div class="pick-extra">
              <label class="inline-check">
                <input
                  type="checkbox"
                  checked={manualIds.has(tenant.id)}
                  onchange={() => onToggleManual(tenant.id)}
                />
                Manual
              </label>
              {#if manualIds.has(tenant.id)}
                <input
                  type="number"
                  class="small-input"
                  step="0.01"
                  inputmode="decimal"
                  placeholder="Auto"
                  aria-label={`Manual amount for ${tenant.name}`}
                  value={manualAmounts.get(tenant.id) ?? ""}
                  oninput={(e) => onSetAmount(tenant.id, (e.target as HTMLInputElement).value)}
                />
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</section>

<style>
  .pick-section {
    margin-bottom: 8px;
  }
  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: var(--space-3);
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

  .pick-line {
    display: flex;
    align-items: center;
    gap: 11px;
    min-width: 0;
  }
  .pick-line input[type="checkbox"] {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    margin: 0;
    accent-color: var(--accent);
  }
  .pick-line :global(.aligned-row__title) {
    flex: 1 1 auto;
  }
  .pick-marker {
    align-self: flex-start;
    margin-top: 2px;
  }
  .pick-name {
    font-size: 0.95rem;
  }
  label.pick-name {
    cursor: pointer;
  }

  .pick-extra {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: var(--space-3);
    padding-top: var(--space-3);
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
    margin: 0 0 var(--space-3);
    font-size: 0.82rem;
  }

  @media (prefers-reduced-motion: reduce) {
    .pick-row {
      transition: none;
    }
  }
</style>
