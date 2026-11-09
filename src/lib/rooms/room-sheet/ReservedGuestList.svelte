<script lang="ts">
  import { formatDate, phpPesoPrecise } from "$lib/ui/format";
  import Icon from "$lib/ui/Icon.svelte";
  import Phone from "@lucide/svelte/icons/phone";
  import type { ReservedGuest } from "./boarders";

  /** Reserved guests held on the room — cards below the bed grid. */
  let { reservations }: { reservations: ReservedGuest[] } = $props();
</script>

{#if reservations.length > 0}
  <h3 class="section-heading">Reserved guests</h3>
  {#each reservations as r (r.id)}
    <article class="boarder-card reserved-card">
      <div class="boarder-head">
        <h3>{r.name}</h3>
        <span class="reserved-badge">{r.hold_type === "whole" ? "Whole room" : r.hold_type === "bed" ? "1 bed" : `${r.bed_count ?? 0} beds`}</span>
      </div>

      {#if r.contact}
        <p class="boarder-contact"><Icon icon={Phone} size={16} /><span>{r.contact}</span></p>
      {/if}

      <dl class="boarder-facts">
        <div>
          <dt>Holding deposit</dt>
          <dd>{r.deposit != null ? phpPesoPrecise(r.deposit) : "—"}</dd>
        </div>
        <div>
          <dt>Target move-in</dt>
          <dd>{formatDate(r.target_move_in_date)}</dd>
        </div>
        <div>
          <dt>Reserved on</dt>
          <dd>{formatDate(r.reservation_date)}</dd>
        </div>
      </dl>
    </article>
  {/each}
{/if}

<style>
  /* ---- section headings (reserved guests vs boarders) ---- */
  .section-heading {
    margin: 0 0 8px;
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--label-3);
  }

  /* ---- reserved-guest cards (amber accent, mirrors the Reserved badge) ---- */
  .reserved-card {
    background: var(--card-2);
    border-color: color-mix(in srgb, var(--amber) 38%, transparent);
  }
  .reserved-badge {
    background: var(--amber-soft);
    color: var(--amber-deep);
    border-radius: 999px;
    padding: 3px 10px;
    font-size: 0.75rem;
    font-weight: 700;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .boarder-card {
    border: 1px solid var(--separator);
    border-radius: var(--radius-card);
    background: var(--card-2);
    padding: 14px;
    margin-bottom: 12px;
  }
  .boarder-card:last-child {
    margin-bottom: 0;
  }
  .boarder-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .boarder-head h3 {
    margin: 0;
    font-size: 1.05rem;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .boarder-contact {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 6px 0 0;
    color: var(--label-2);
    font-size: 0.9rem;
  }

  .boarder-facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 10px 16px;
    margin: 12px 0 0;
  }
  .boarder-facts div {
    min-width: 0;
  }
  .boarder-facts dt {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--label-3);
  }
  .boarder-facts dd {
    margin: 2px 0 0;
    font-size: 0.92rem;
    font-weight: 600;
  }
</style>
