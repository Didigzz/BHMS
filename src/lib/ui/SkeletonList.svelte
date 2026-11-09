<script lang="ts">
  /**
   * Loading placeholder for a list of cards.
   *
   * A skeleton is only honest when it matches the shape of what is coming, so
   * each block carries a title bar plus two or three body lines. The wrapper is
   * decorative: screen readers get the page's own "Loading…" announcement or
   * the live region around the data, not a pile of empty boxes.
   */
  let {
    count = 3,
    lines = 2,
    hero = false,
  }: {
    count?: number;
    lines?: number;
    /** Adds a taller first block, for screens that open with a summary card. */
    hero?: boolean;
  } = $props();

  const lineWidths = ["72%", "88%", "54%"];
</script>

<div class="skeleton-stack" aria-hidden="true">
  {#each Array(count) as _, i (i)}
    <div class="skeleton-card" class:hero={hero && i === 0}>
      <span class="skeleton skeleton-head"></span>
      {#each Array(hero && i === 0 ? lines + 2 : lines) as _, j (j)}
        <span class="skeleton skeleton-line" style:width={lineWidths[j % lineWidths.length]}></span>
      {/each}
    </div>
  {/each}
</div>

<style>
  .skeleton-stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .skeleton-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 18px;
    background: var(--card);
    border: 1px solid var(--separator);
    border-radius: var(--radius-card);
    box-shadow: var(--shadow-1);
  }

  .skeleton-card.hero {
    padding: 22px 18px;
  }

  .skeleton {
    display: block;
    border-radius: 6px;
    background: linear-gradient(
      90deg,
      var(--fill) 25%,
      color-mix(in srgb, var(--fill) 45%, var(--card)) 37%,
      var(--fill) 63%
    );
    background-size: 400% 100%;
    animation: shimmer 1.5s ease infinite;
  }

  .skeleton-head {
    height: 18px;
    width: 44%;
  }

  .skeleton-line {
    height: 12px;
  }

  .skeleton-card.hero .skeleton-head {
    height: 26px;
    width: 54%;
  }

  @keyframes shimmer {
    0% {
      background-position: 100% 0;
    }
    100% {
      background-position: -100% 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .skeleton {
      animation: none;
    }
  }
</style>
