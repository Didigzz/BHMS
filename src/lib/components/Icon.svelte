<script lang="ts">
  import type { Component } from "svelte";

  /**
   * The app's single icon primitive: a Lucide icon component plus the app's
   * fixed size scale and stroke weight.
   *
   * Icons are always decorative (`aria-hidden`): meaning comes from adjacent
   * text or the interactive element's own `aria-label`. The wrapper is layout
   * neutral — it adds no margins and inherits `currentColor` — so call sites
   * keep controlling color through their existing classes.
   */
  let {
    icon: Glyph,
    size = 20,
    strokeWidth = 2,
    class: className = "",
    ...rest
  }: {
    icon: Component<any>;
    size?: 16 | 20 | 24;
    strokeWidth?: number;
    class?: string;
  } = $props();
</script>

<span class="icon {className}" aria-hidden="true">
  <Glyph {size} {strokeWidth} focusable="false" {...rest} />
</span>

<style>
  .icon {
    display: inline-flex;
    flex: 0 0 auto;
    line-height: 0;
    vertical-align: -0.125em;
  }
</style>
