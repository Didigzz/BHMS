<script lang="ts">
  import { BUCKETS, type TenantBucket } from "$lib/tenants/tenant-filter";
  import type { Room } from "$lib/tenants/types";
  import Icon from "$lib/ui/Icon.svelte";
  import Search from "@lucide/svelte/icons/search";

  /** Active/Archived switch, ?room= chip, search box, and payment-status chips. */
  let {
    view,
    onView,
    searchQuery = $bindable(""),
    statusFilter,
    onSelectBucket,
    filterRoom,
    onClearRoom,
  }: {
    view: "active" | "archived";
    onView: (next: "active" | "archived") => void;
    searchQuery?: string;
    statusFilter: TenantBucket | null;
    onSelectBucket: (bucket: TenantBucket | null) => void;
    filterRoom: Room | null;
    onClearRoom: () => void;
  } = $props();
</script>

<div class="segmented" role="tablist" aria-label="Tenant view">
  <button class:active={view === "active"} onclick={() => onView("active")}>
    Active
  </button>
  <button class:active={view === "archived"} onclick={() => onView("archived")}>
    Archived
  </button>
</div>

{#if filterRoom && view === "active"}
  <div class="room-filter-row">
    <span class="room-filter-chip">
      Room {filterRoom.room_number}
      <button type="button" class="room-filter-clear" aria-label="Clear room filter" onclick={onClearRoom}>
        ✕
      </button>
    </span>
  </div>
{/if}

<div class="search-wrap">
  <span class="search-icon" aria-hidden="true"><Icon icon={Search} size={16} /></span>
  <input
    type="search"
    class="search-input"
    placeholder="Search name, contact, or room…"
    aria-label="Search tenants"
    bind:value={searchQuery}
  />
</div>

{#if view === "active"}
  <!-- Payment-status filter: tap a chip to narrow the Active list, tap the
       active chip again to clear (no "All" chip). -->
  <div class="chips chips-scroll" role="tablist" aria-label="Payment status filter">
    {#each BUCKETS as bucket (bucket.key)}
      <button
        type="button"
        class:active={statusFilter === bucket.key}
        onclick={() => onSelectBucket(statusFilter === bucket.key ? null : bucket.key)}
      >
        {bucket.label}
      </button>
    {/each}
  </div>
{/if}

<style>
  /* ---- room filter chip (?room= param) ---- */
  .room-filter-row {
    margin-bottom: var(--space-3);
  }

  .room-filter-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--accent);
    color: var(--accent-contrast);
    border-radius: 999px;
    padding: 6px 8px 6px 12px;
    font-size: 0.82rem;
    font-weight: 600;
  }

  .room-filter-clear {
    border: none;
    background: none;
    color: inherit;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.7rem;
    line-height: 1;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .room-filter-clear:active {
    background: color-mix(in srgb, var(--accent-contrast) 18%, transparent);
  }
  @media (hover: hover) {
    .room-filter-clear:hover {
      background: color-mix(in srgb, var(--accent-contrast) 18%, transparent);
    }
  }
  .room-filter-clear:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* Touch: a 20px "x" inside the filter chip. The chip's own text is not
     interactive, so the larger hit area steals nothing from it. */
  @media (pointer: coarse) {
    .room-filter-clear {
      position: relative;
    }
    .room-filter-clear::before {
      content: "";
      position: absolute;
      inset: -12px;
    }
  }

  /* ---- search ---- */
  .search-wrap {
    position: relative;
    margin-bottom: var(--space-3);
  }

  .search-icon {
    position: absolute;
    left: 13px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    color: var(--label-3);
    pointer-events: none;
  }

  .search-input {
    width: 100%;
    box-sizing: border-box;
    border-radius: var(--radius-control);
    border: 1px solid var(--separator-strong);
    padding: 10px 14px 10px 38px;
    /* 1rem (16px) — anything smaller makes iOS zoom the page on focus. */
    font-size: 1rem;
    font-family: inherit;
    color: var(--label);
    background: var(--card-2);
  }

  /* Safari's own search affordances sit on top of the custom padding. */
  .search-input::-webkit-search-decoration,
  .search-input::-webkit-search-cancel-button {
    -webkit-appearance: none;
  }

  .search-input:focus {
    outline: 2px solid var(--accent);
    border-color: transparent;
  }

  /* ---- payment-status filter chips ---- */
  /* Overrides the global wrapping .chips row: one swipeable line on a phone. */
  .chips-scroll {
    flex-wrap: nowrap;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }

  .chips-scroll button {
    flex-shrink: 0;
    white-space: nowrap;
  }

  .chips-scroll::-webkit-scrollbar {
    display: none;
  }
</style>
