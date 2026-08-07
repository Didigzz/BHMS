<script lang="ts">
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

<div class="stats">
  <div class="stat-card">
    <span class="stat-num">{roomCount}</span>
    <span class="stat-label">Rooms</span>
  </div>
  <div class="stat-card">
    <span class="stat-num">{tenantCount}</span>
    <span class="stat-label">Tenants</span>
  </div>
  <div class="stat-card">
    <span class="stat-num">{occupiedCount}</span>
    <span class="stat-label">Occupied</span>
  </div>
</div>

<style>
  .stats {
    display: flex;
    gap: 12px;
    margin-bottom: 20px;
  }

  .stat-card {
    flex: 1;
    background: var(--card);
    border-radius: 12px;
    padding: 14px 8px;
    text-align: center;
    box-shadow: var(--shadow-1);
    animation: stat-in 0.45s cubic-bezier(0.23, 1, 0.32, 1) both;
  }
  .stat-card:nth-child(1) {
    animation-delay: 0ms;
  }
  .stat-card:nth-child(2) {
    animation-delay: 40ms;
  }
  .stat-card:nth-child(3) {
    animation-delay: 80ms;
  }

  @keyframes stat-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .stat-num {
    display: block;
    font-size: 1.7rem;
    font-weight: 800;
    line-height: 1.1;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
    color: var(--accent);
  }

  .stat-label {
    font-size: 0.75rem;
    color: var(--label-2);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  @media (prefers-reduced-motion: reduce) {
    .stat-card {
      animation: none;
    }
  }
</style>
