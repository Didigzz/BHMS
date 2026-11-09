<script lang="ts">
  import { onMount } from "svelte";

  /**
   * macOS overlays its traffic lights on a title bar with no draggable strip of
   * its own (`titleBarStyle: "Overlay"`, `hiddenTitle: true` in
   * tauri.conf.json). The sidebar head used to be the window's drag handle;
   * with the sidebar gone a slim transparent strip near the top takes over, so
   * the window can still be moved.
   *
   * Rendered only on macOS, where it is needed: every other platform has a real
   * title bar, and on a phone the strip would only swallow taps near the status
   * bar. Read from the user agent rather than the `os` plugin on purpose — this
   * is presentation only, and a single string check is cheaper than another
   * Tauri plugin in the dependency graph.
   */
  let isMac = $state(false);
  onMount(() => {
    isMac = navigator.userAgent.includes("Macintosh");
  });
</script>

{#if isMac}
  <!-- The window's drag handle. It used to stop short of the Settings gear;
       with Settings in the + menu the top-right corner is free again, so the
       strip runs edge to edge. -->
  <div class="titlebar-drag" data-tauri-drag-region aria-hidden="true"></div>
{/if}

<style>
  /* ---- the macOS window drag strip ------------------------------------- */
  /* The sidebar head used to be the window's only drag handle. With the sidebar
     gone, this transparent strip near the top keeps the window movable where the
     title bar is overlaid. It is rendered only on macOS and now spans the full
     width: the Settings gear that used to pin the top-right corner (and outrank
     the strip in the stacking order) is gone, and the dock stays above the
     strip. The content column starts below the strip's 24px, so nothing
     tappable is covered. */
  .titlebar-drag {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 24px;
    z-index: 80;
  }
</style>
