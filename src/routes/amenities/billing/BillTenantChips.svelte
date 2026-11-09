<script lang="ts">
  import type { AmenityBillRow, AmenityBillTenantRow } from "$lib/amenities/amenity-actions";
  import { phpPesoPrecise } from "$lib/ui/format";

  /**
   * The bill card's per-tenant rows: share amount, manual/excluded markers and
   * the Paid/Unpaid toggle that opens the payment sheet.
   */
  let {
    bill,
    tenants,
    onRecord,
    onVoid,
  }: {
    bill: AmenityBillRow;
    tenants: AmenityBillTenantRow[];
    onRecord: (row: AmenityBillTenantRow) => void;
    onVoid: (row: AmenityBillTenantRow) => void;
  } = $props();
</script>

<ul class="tenant-chips">
  {#each tenants as t}
    <li class="chip aligned-row" class:excluded={t.is_excluded}>
      <div class="aligned-row__main">
        <span class="aligned-row__title" title={t.tenant_name_snapshot}>{t.tenant_name_snapshot}</span>
        <span class="aligned-row__sub">{t.room_number_snapshot}</span>
        {#if t.is_manual === 1 && !t.is_excluded}
          <span class="badge badge-custom pick-marker">Custom</span>
        {/if}
      </div>
      {#if t.is_excluded}
        <span class="aligned-row__amount muted">—</span>
        <span class="badge badge-inactive aligned-row__status">Excluded</span>
      {:else if t.amount === 0}
        <span class="badge badge-amenity aligned-row__amount">{phpPesoPrecise(t.amount)}</span>
        <span class="muted aligned-row__status">—</span>
      {:else}
        <span class="badge badge-amenity aligned-row__amount">{phpPesoPrecise(t.amount)}</span>
        {#if bill.status === "active"}
          <button
            class="btn btn-small status-toggle aligned-row__status"
            class:paid={t.payment_status === "Paid"}
            title={t.payment_status === "Paid" && t.paid_date ? `Paid ${t.paid_date}` : undefined}
            onclick={() => t.payment_status === "Paid" ? onVoid(t) : onRecord(t)}
          >{t.payment_status}</button>
        {:else}
          <span class="badge badge-inactive aligned-row__status">{t.payment_status}</span>
        {/if}
      {/if}
      {#if t.exclusion_reason}
        <p class="muted aligned-row__note" title={t.exclusion_reason}>Reason: {t.exclusion_reason}</p>
      {/if}
    </li>
  {/each}
</ul>

<style>
  .tenant-chips {
    list-style: none;
    margin: var(--space-2) 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .chip {
    padding: 8px;
    border: 1px solid var(--separator);
    border-radius: 8px;
  }
  .chip.excluded {
    background: var(--gray-soft);
    color: var(--gray-deep);
  }

  .badge-amenity {
    background: var(--fill);
    color: var(--label);
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 0.7rem;
    font-weight: 700;
  }
  .badge-inactive {
    background: var(--gray-soft);
    color: var(--gray-deep);
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.01em;
  }
  .badge-custom {
    align-self: flex-start;
    margin-top: 2px;
    background: var(--accent-soft);
    color: var(--accent-deep);
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.01em;
  }

  /* The amount pill drops a font step before its 96px column would clip digits
     (spec R22). */
  @media (max-width: 380px) {
    .badge-amenity {
      font-size: 0.65rem;
    }
  }

  .status-toggle {
    min-height: 1.75rem;
    padding: 4px 10px;
    font-size: 0.7rem;
    letter-spacing: 0.01em;
    border-radius: 999px;
    background: var(--amber-soft);
    color: var(--amber-deep);
    border: none;
  }
  .status-toggle.paid {
    background: var(--green-soft);
    color: var(--green-deep);
  }

  /* Touch: this pill is the primary action on the page — marking a tenant's
     amenity slice Paid/Unpaid — and it was 28px tall. Height only; the label
     keeps the design's width. */
  @media (pointer: coarse) {
    .status-toggle {
      min-height: 44px;
    }
  }
</style>
