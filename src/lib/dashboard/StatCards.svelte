<script lang="ts">
  /**
   * The dashboard's portfolio line: three counts in one paper card rather than
   * three floating cards. One surface, hairlines between the numbers, and no
   * entrance animation — this is reference data, not a celebration.
   */
  let {
    roomCount,
    tenantCount,
    occupiedCount,
  }: {
    roomCount: number;
    tenantCount: number;
    occupiedCount: number;
  } = $props();
</script>

<div class="card stats-card" aria-label="Portfolio summary">
  <div class="stat">
    <span class="stat-num">{roomCount}</span>
    <span class="stat-label">Rooms</span>
  </div>
  <div class="stat">
    <span class="stat-num">{tenantCount}</span>
    <span class="stat-label">Tenants</span>
  </div>
  <div class="stat">
    <span class="stat-num accent">{occupiedCount}</span>
    <span class="stat-label">Occupied</span>
  </div>
</div>

<style>
  .stats-card {
    display: flex;
    align-items: stretch;
    padding: 16px 0;
  }

  .stat {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 0 8px;
  }

  .stat + .stat {
    border-left: 1px solid var(--separator);
  }

  .stat-num {
    font-size: 1.65rem;
    font-weight: 700;
    line-height: 1.1;
    letter-spacing: -0.035em;
    font-variant-numeric: tabular-nums;
    color: var(--label);
  }

  .stat-num.accent {
    color: var(--accent-deep);
  }

  .stat-label {
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--label-3);
  }
</style>
