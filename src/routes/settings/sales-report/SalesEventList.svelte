<script lang="ts">
  import { formatShortDay, phpPeso, roomLabel } from "$lib/ui/format";

  /** One move-in or move-out row in the sales report. */
  interface SalesEventLine {
    date: string;
    name: string;
    room: string;
    rate: number;
  }

  /** Move-in / move-out list for a sales-report period. */
  let { events, kind }: { events: SalesEventLine[]; kind: "in" | "out" } = $props();

  const tag = $derived(kind === "in" ? "Move-in" : "Move-out");
  const emptyText = $derived(kind === "in" ? "No move-ins this period." : "No move-outs this period.");
</script>

{#if events.length === 0}
  <p class="muted">{emptyText}</p>
{:else}
  <ul class="event-list">
    {#each events as e (e.date + e.name)}
      <li class="event-line">
        <span class="event-tag event-{kind}">{tag}</span>
        <span>{e.name} — {formatShortDay(e.date)} · {roomLabel(e.room)} · {phpPeso(e.rate)}/mo</span>
      </li>
    {/each}
  </ul>
{/if}

<style>
  /* ---- move lists ---- */
  .event-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .event-line {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 0.92rem;
  }

  .event-tag {
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
    border-radius: 999px;
    padding: 2px 8px;
    flex-shrink: 0;
  }

  .event-in {
    color: var(--green-deep);
    background: var(--green-soft);
  }

  .event-out {
    color: var(--red-deep);
    background: var(--red-soft);
  }
</style>
