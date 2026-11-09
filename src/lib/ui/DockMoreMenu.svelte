<script lang="ts">
  import type { TransitionConfig } from "svelte/transition";
  import Icon from "$lib/ui/Icon.svelte";

  /**
   * The + button's popover: the sections that don't fit in the three-tab pill.
   * Extracted from AppDock so the dock owns the tabs/thumb/FAB and the menu
   * owns its scrim, tail and transition.
   */
  let {
    open,
    items,
    pathname,
    onClose,
  }: {
    open: boolean;
    items: { href: string; label: string; icon: typeof Icon extends never ? never : any }[];
    pathname: string;
    onClose: () => void;
  } = $props();

  /** The popover grows out of the + button it is attached to, and shrinks back. */
  function popoverMaterial(node: Element): TransitionConfig {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return { duration: 100, css: (t) => `opacity: ${t}` };
    }
    return {
      duration: 200,
      easing: (t) => 1 - Math.pow(1 - t, 3),
      css: (t, u) => `opacity: ${t}; transform: scale(${0.92 + 0.08 * t}) translateY(${6 * u}px);`,
    };
  }
</script>

{#if open}
  <!-- Transparent catcher: no dimming (the popover is not modal), but a tap
       anywhere outside closes it. Sits under the pill, which stays usable. -->
  <button
    type="button"
    class="scrim"
    tabindex="-1"
    aria-label="Close section menu"
    onclick={onClose}
  ></button>
  <div class="popover" role="menu" transition:popoverMaterial>
    {#each items as item}
      <a
        href={item.href}
        role="menuitem"
        class="pop-item"
        class:active={pathname.startsWith(item.href)}
        onclick={(event) => {
          // Settings tapped while already in Settings would re-enter the
          // route and jump the page to the top. Dismiss the menu and stay
          // exactly where the user is.
          if (item.href === "/settings" && pathname.startsWith("/settings")) {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <span class="pop-icon" aria-hidden="true"><Icon icon={item.icon} size={16} /></span>
        <span class="pop-label">{item.label}</span>
      </a>
    {/each}
    <span class="pop-tail" aria-hidden="true"></span>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 1;
    border: none;
    padding: 0;
    background: transparent;
    cursor: default;
    -webkit-tap-highlight-color: transparent;
  }

  /* ---- the popover ----------------------------------------------------- */
  .popover {
    position: absolute;
    z-index: 3;
    bottom: calc(100% + 12px);
    right: 0;
    min-width: 196px;
    padding: 5px 0;
    border-radius: var(--radius-card);
    background: var(--nav-surface);
    -webkit-backdrop-filter: saturate(150%) blur(22px);
    backdrop-filter: saturate(150%) blur(22px);
    border: 1px solid var(--separator);
    box-shadow:
      0 24px 50px -24px rgba(16, 22, 20, 0.6),
      0 2px 6px rgba(16, 22, 20, 0.08);
    transform-origin: calc(100% - 29px) 100%;
    overflow: visible;
  }

  /* The tail points at the + button's center (29px in from the right edge). */
  .pop-tail {
    position: absolute;
    right: 22px;
    bottom: -6px;
    width: 14px;
    height: 14px;
    border-radius: 2px;
    background: inherit;
    transform: rotate(45deg);
    pointer-events: none;
  }

  .pop-item {
    position: relative;
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 11px 14px;
    text-decoration: none;
    color: var(--label);
    -webkit-tap-highlight-color: transparent;
    transition: background 0.12s ease;
  }

  .pop-item + .pop-item {
    border-top: 1px solid var(--separator);
  }

  .pop-item:active {
    background: var(--fill);
  }

  .pop-item.active {
    color: var(--accent-deep);
  }

  /* The current page tints the label only. The glyph stays monochrome, like the
     dock's tabs — a chip behind it read as a white block on the popover. */
  .pop-item.active .pop-icon {
    color: var(--label);
  }

  /* A bare slot, not a chip: the 30px box exists only to hold the label's 55px
     origin and the row's 52px height. The glyph sits directly on the popover
     surface — no plate, no hairline. */
  .pop-icon {
    flex-shrink: 0;
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
  }

  .pop-label {
    font-size: 0.95rem;
    font-weight: 500;
  }

  /* The dock's surfaces come from theme tokens, so the manual data-theme
     override (src/lib/theme.ts) and the OS setting both flow through here. */
  @media (prefers-reduced-transparency: reduce) {
    .popover {
      background: var(--card);
      -webkit-backdrop-filter: none;
      backdrop-filter: none;
    }
  }

  /* Reduced motion keeps every state change and drops the movement. */
  @media (prefers-reduced-motion: reduce) {
    .pop-item {
      transition: none;
    }
  }

  /* High contrast: give the floating chrome a defined edge. */
  @media (prefers-contrast: more) {
    .popover {
      border: 1px solid var(--label-3);
    }
  }
</style>
