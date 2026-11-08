<script lang="ts">
  /**
   * The RentEase brand lockup: the house mark plus the wordmark.
   *
   * The mark is the same SVG that produces the favicon and the OS app icons, so
   * the launcher icon and the in-app brand never drift apart. The wordmark is
   * real text rather than the logo SVG's baked-in dark navy, which would vanish
   * on the dark theme; this way it inherits the theme's label color.
   */
  let {
    size = 36,
    tagline = false,
  }: {
    /** Height/width of the square mark, in px. */
    size?: number;
    /** Show "Boarding house manager" under the wordmark. */
    tagline?: boolean;
  } = $props();
</script>

<span class="brand">
  <img class="mark" src="/rentease-icon.svg" alt="" width={size} height={size} />
  <span class="words">
    <span class="name">RentEase</span>
    {#if tagline}
      <span class="tagline">Boarding house manager</span>
    {/if}
  </span>
</span>

<style>
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }

  .mark {
    flex: 0 0 auto;
    display: block;
    /* The SVG carries its own navy tile; matching the OS icon's corner ratio
       keeps the in-app mark identical to the launcher icon. */
    border-radius: 22%;
  }

  .words {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .name {
    font-size: 1.05rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.2;
    color: var(--label);
  }

  .tagline {
    margin-top: 1px;
    font-size: 0.62rem;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--label-2);
  }
</style>
