<script lang="ts">
  import { effectiveOccupancy, pct } from "$lib/rooms/rooms";
  import type { Room } from "$lib/rooms/types";

  /** Bed count line + occupancy bar for a room card. */
  let { room }: { room: Room } = $props();

  const occupied = $derived(effectiveOccupancy(room.occupied_beds, room.held_beds));
  const full = $derived(occupied >= room.capacity);
  const partial = $derived(room.occupied_beds > 0 && occupied < room.capacity);
</script>

<p class="room-meta" class:full class:partial>
  {room.occupied_beds}/{room.capacity} bed{room.occupied_beds === 1 ? "" : "s"} occupied
</p>
<div class="progress-track" aria-label="occupancy">
  <div class="progress-fill" style:transform={`scaleX(${pct(occupied, room.capacity) / 100})`}></div>
</div>

<style>
  /* ---- occupancy ---- */
  .room-meta {
    margin: var(--space-3) 0 0;
    color: var(--label-2);
    font-size: 0.9rem;
  }

  .room-meta.full {
    color: var(--label-2);
    font-weight: 700;
  }
  .room-meta.partial {
    color: var(--amber-deep);
    font-weight: 600;
  }

  .progress-track {
    height: 6px;
    border-radius: var(--radius-pill);
    background: var(--fill);
    overflow: hidden;
    margin-top: 8px;
  }

  .progress-fill {
    height: 100%;
    width: 100%;
    border-radius: 999px;
    background: var(--accent);
    transform-origin: left;
    transition: transform 0.2s cubic-bezier(0.23, 1, 0.32, 1);
  }

  @media (prefers-reduced-motion: reduce) {
    .progress-fill {
      transition: none;
    }
  }
</style>
