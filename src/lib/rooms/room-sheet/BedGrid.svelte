<script lang="ts">
  import { buildBedBoxes } from "$lib/rooms/bed-boxes";
  import { boxStatus, boxStatusLabel, type Boarder } from "./boarders";

  /** Level 1: one box per bed slot, tinted by the tenant's payment status. */
  let {
    boarders,
    capacity,
    heldBeds,
    onOpenTenant,
  }: {
    boarders: Boarder[];
    capacity: number;
    heldBeds: number;
    onOpenTenant: (tenantId: number) => void;
  } = $props();
</script>

<div class="bed-grid" aria-label="Beds">
  {#each buildBedBoxes(boarders, capacity, heldBeds) as box (box.key)}
    {#if box.kind === "tenant"}
      {@const status = boxStatus(boarders, box)}
      <button
        type="button"
        class="bed-box box-{status}"
        aria-label={`${box.name} — ${boxStatusLabel(boarders, box)}`}
        onclick={() => onOpenTenant(box.tenantId)}
      >
        <span class="bed-name">{box.name}</span>
        {#if box.tag}
          <span class="bed-tag">{box.tag}</span>
        {/if}
      </button>
    {:else if box.kind === "held"}
      <span class="bed-box bed-held">Held</span>
    {:else}
      <span class="bed-box bed-vacant">Vacant</span>
    {/if}
  {/each}
</div>

<style>
  /* ---- level-1 bed grid (one box per slot) ---- */
  .bed-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 10px;
    margin-bottom: 16px;
  }

  .bed-box {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 7px;
    min-height: 74px;
    padding: 12px;
    border: 1px solid var(--separator);
    border-radius: 12px;
    background: var(--fill);
    text-align: left;
    font-family: inherit;
    color: var(--label);
    cursor: pointer;
    transition: border-color 0.15s ease, transform 0.15s ease, background-color 0.15s ease;
    -webkit-tap-highlight-color: transparent;
  }
  /* ---- whole-box payment status (dashboard-mobile-polish-spec §6) ----
     The box itself carries the tint and the name is plain text on it. Custom
     properties keep one rule per concern instead of one per status. */
  .bed-box.box-green {
    --status: var(--green);
    --status-soft: var(--green-soft);
    --status-deep: var(--green-deep);
  }
  .bed-box.box-yellow {
    --status: var(--amber);
    --status-soft: var(--amber-soft);
    --status-deep: var(--amber-deep);
  }
  .bed-box.box-red {
    --status: var(--red);
    --status-soft: var(--red-soft);
    --status-deep: var(--red-deep);
  }
  .bed-box.box-green,
  .bed-box.box-yellow,
  .bed-box.box-red {
    background: var(--status-soft);
    border-color: color-mix(in srgb, var(--status) 35%, transparent);
    color: var(--status-deep);
  }
  @media (hover: hover) {
    .bed-box.box-green:hover,
    .bed-box.box-yellow:hover,
    .bed-box.box-red:hover {
      border-color: color-mix(in srgb, var(--status) 65%, transparent);
    }
  }
  .bed-box:active {
    transform: scale(0.98);
  }
  .bed-box:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* Plain name on the tinted box — no inner pill (see the status rules above). */
  .bed-name {
    color: inherit;
    font-weight: 700;
    font-size: 0.95rem;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }

  /* Tag on every box of a multi-bed tenant: "Occupies N beds" / "Whole Room".
     Neutral translucent so it reads as secondary on any status tint. */
  .bed-tag {
    background: color-mix(in srgb, var(--card) 70%, transparent);
    border: 1px solid color-mix(in srgb, var(--separator) 55%, transparent);
    color: var(--label-2);
    border-radius: 999px;
    padding: 2px 9px;
    font-size: 0.7rem;
    font-weight: 700;
    white-space: nowrap;
  }

  /* inert dashed boxes for held / free slots */
  .bed-held,
  .bed-vacant {
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1.5px dashed var(--separator);
    background: none;
    color: var(--label-3);
    font-size: 0.8rem;
    font-weight: 600;
    cursor: default;
  }
  .bed-held {
    border-color: rgba(255, 149, 0, 0.45);
    color: var(--amber-deep);
  }
  @media (hover: hover) {
    .bed-vacant:hover {
      border-color: var(--separator);
    }
  }
</style>
