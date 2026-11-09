<script lang="ts">
  import { paymentLabel } from "$lib/tenants/payment-status";
  import type { RoomTenantChip } from "$lib/rooms/types";

  /** Boarder chips (payment-status tinted) for a room card, collapsed at 3. */
  let { tenants }: { tenants: RoomTenantChip[] } = $props();

  // Collapse the tenant chips at 3 (room-card-redesign-spec §4.4).
  const MAX_CHIPS = 3;
  const visibleChips = $derived(tenants.slice(0, MAX_CHIPS));
  const hiddenCount = $derived(tenants.length - visibleChips.length);
</script>

{#if tenants.length > 0}
  <ul class="room-chips" aria-label="Boarders">
    {#each visibleChips as t (t.id)}
      <li
        class="tenant-chip chip-{t.status}"
        title={paymentLabel(t.status, t.dueDate, new Date(), t.lastPaidDate)}
      >
        {t.name}
      </li>
    {/each}
    {#if hiddenCount > 0}
      <li class="more-chip">+{hiddenCount} more</li>
    {/if}
  </ul>
{:else}
  <p class="no-tenants">No tenants yet</p>
{/if}

<style>
  /* ---- boarder chips (payment-status tinted, like the dashboard) ---- */
  .room-chips {
    list-style: none;
    margin: var(--space-3) 0 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .tenant-chip {
    background: var(--accent-soft);
    color: var(--accent-deep);
    border-radius: 999px;
    padding: 3px 12px;
    font-size: 0.8rem;
    font-weight: 600;
    white-space: nowrap;
  }
  .chip-green {
    background: var(--green-soft);
    color: var(--green-deep);
  }
  .chip-yellow {
    background: var(--amber-soft);
    color: var(--amber-deep);
  }
  .chip-red {
    background: var(--red-soft);
    color: var(--red-deep);
  }

  /* static "N more" count pill (not interactive — room-card-redesign-spec §4.4) */
  .more-chip {
    background: var(--gray-soft);
    color: var(--gray-deep);
    border-radius: 999px;
    padding: 3px 12px;
    font-size: 0.8rem;
    font-weight: 600;
    white-space: nowrap;
  }

  .no-tenants {
    margin: var(--space-3) 0 0;
    color: var(--label-3);
    font-size: 0.85rem;
    font-style: italic;
  }
</style>
