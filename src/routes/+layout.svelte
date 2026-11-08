<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import type { TransitionConfig } from "svelte/transition";
  import { checkAndNotify } from "$lib/reminders";
  import { initTheme } from "$lib/theme";
  import {
    needsRecovery,
    readDatabaseState,
    restoreSafetyCopy,
    type DatabaseState,
  } from "$lib/db-health";
  import ToastHost from "$lib/components/ToastHost.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import LayoutDashboard from "@lucide/svelte/icons/layout-dashboard";
  import Users from "@lucide/svelte/icons/users";
  import BedDouble from "@lucide/svelte/icons/bed-double";
  import CalendarDays from "@lucide/svelte/icons/calendar-days";
  import ReceiptText from "@lucide/svelte/icons/receipt-text";
  import Settings from "@lucide/svelte/icons/settings";
  // App-wide design system (buttons, cards, badges, modal overlay, theme).
  import "../app.css";

  /**
   * Every destination, in dock order.
   *
   * The dock shows the first three — the ones reached constantly — in a
   * floating pill, so the bar stays three items wide however many sections the
   * app grows, and the selected pill slides between items instead of blinking.
   * The remaining three sit behind the + button: Settings first, then
   * Reservations and Amenities. Configuration is a rarer trip than either
   * section, but it is still a destination rather than a floating control.
   */
  const NAV = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard, isActive: (p: string) => p === "/" },
    { href: "/tenants", label: "Tenants", icon: Users, isActive: (p: string) => p.startsWith("/tenants") },
    { href: "/rooms", label: "Rooms", icon: BedDouble, isActive: (p: string) => p.startsWith("/rooms") },
    { href: "/settings", label: "Settings", icon: Settings, isActive: (p: string) => p.startsWith("/settings") },
    { href: "/reservations", label: "Reservations", icon: CalendarDays, isActive: (p: string) => p.startsWith("/reservations") },
    { href: "/amenities", label: "Amenities", icon: ReceiptText, isActive: (p: string) => p.startsWith("/amenities") },
  ];

  /** The dock: three constant tabs, unchanged from the approved design. */
  const TABS = NAV.slice(0, 3);

  /** Hosted behind the + button, in popover order. */
  const MORE = NAV.slice(3);

  const pathname = $derived(page.url.pathname);
  const activeIndex = $derived(Math.max(0, TABS.findIndex((t) => t.isActive(pathname))));
  const moreActive = $derived(MORE.some((m) => pathname.startsWith(m.href)));

  let menuOpen = $state(false);

  /** Navigating always dismisses the popover — the tap already did its job. */
  $effect(() => {
    pathname;
    menuOpen = false;
  });

  /** Escape dismissal for the popover (Android back is the OS's job). */
  $effect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") menuOpen = false;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

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

  /**
   * Set when this install has lost its database file. The app is never shown in
   * that state: an empty RentEase is indistinguishable from a landlord's data
   * having vanished, so the recovery screen takes its place until the safety
   * copy is back.
   */
  let recovery = $state<DatabaseState | null>(null);
  let recovering = $state(false);
  let recoveryError = $state<string | null>(null);

  async function recover() {
    recovering = true;
    recoveryError = null;
    try {
      await restoreSafetyCopy();
      window.location.reload();
    } catch (error) {
      recoveryError = String(error instanceof Error ? error.message : error);
    } finally {
      recovering = false;
    }
  }

  // Startup: apply the saved theme (Settings → Appearance, brief flash of the
  // device theme is expected while it loads) and fire any due/overdue pings
  // that happened while the app was closed (de-duped in notifications_log).
  // Both are safe in a plain browser dev server — the Tauri plugin calls are
  // guarded inside theme.ts / reminders.ts.
  onMount(async () => {
    initTheme();

    const state = await readDatabaseState();
    if (needsRecovery(state)) {
      // Deliberately does not call checkAndNotify(): nothing may touch the
      // database here, or the plugin would create an empty one in its place.
      recovery = state;
      return;
    }

    checkAndNotify();
  });

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

{#if recovery}
  <div class="recovery" role="alertdialog" aria-label="Recover your data">
    <div class="recovery-card">
      <h1>RentEase can't find your data</h1>
      <p class="recovery-detail">
        Your data file is missing from this device. RentEase has <strong>not</strong> started empty in
        its place, so nothing has been overwritten or lost.
      </p>
      {#if recovery.latestSafetyCopy}
        <p class="recovery-detail">
          A safety copy is available from just before your last restore:
          <code>{recovery.latestSafetyCopy}</code>
        </p>
        <button class="btn btn-primary" onclick={recover} disabled={recovering}>
          {recovering ? "Restoring…" : "Restore my data"}
        </button>
      {:else}
        <p class="recovery-detail">
          No safety copy was found on this device. Import a <code>.digal</code> backup from
          Settings → Backup &amp; Restore on another device, then copy it here.
        </p>
      {/if}
      {#if recoveryError}
        <p class="recovery-error">{recoveryError}</p>
      {/if}
    </div>
  </div>
{:else}
<!-- One navigation at every width: the floating dock, which was the approved
     phone design first. The wide-screen sidebar that used to replace it is gone,
     so there is no width state to get wrong on resize and no second layout to
     keep in sync — a maximized window renders the phone layout too. -->
{#if isMac}
  <!-- The window's drag handle, now that the sidebar head is gone (see isMac).
       It used to stop short of the Settings gear; with Settings in the + menu
       the top-right corner is free again, so the strip runs edge to edge. -->
  <div class="titlebar-drag" data-tauri-drag-region aria-hidden="true"></div>
{/if}

<slot />

<nav class="dock" aria-label="Main navigation">
  <div class="pill">
    <span class="thumb" style:--i={activeIndex} aria-hidden="true"></span>
    {#each TABS as tab, i}
      <a
        href={tab.href}
        class="tab"
        class:active={i === activeIndex}
        aria-current={i === activeIndex ? "page" : undefined}
      >
        <span class="tab-icon" aria-hidden="true"><Icon icon={tab.icon} size={20} /></span>
        <span class="tab-label">{tab.label}</span>
      </a>
    {/each}
  </div>

  <div class="more">
    {#if menuOpen}
      <!-- Transparent catcher: no dimming (the popover is not modal), but a tap
           anywhere outside closes it. Sits under the pill, which stays usable. -->
      <button
        type="button"
        class="scrim"
        tabindex="-1"
        aria-label="Close section menu"
        onclick={() => (menuOpen = false)}
      ></button>
      <div class="popover" role="menu" transition:popoverMaterial>
        {#each MORE as item}
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
                menuOpen = false;
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
    <button
      type="button"
      class="fab"
      class:open={menuOpen}
      class:route-active={moreActive}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      aria-label="More sections"
      onclick={() => (menuOpen = !menuOpen)}
    >
      <span class="fab-plus" aria-hidden="true"></span>
    </button>
  </div>
</nav>

{/if}

<ToastHost />

<style>
  /* ---- recovery: shown instead of the app when the data file is missing --- */
  .recovery {
    position: fixed;
    inset: 0;
    /* Above the toast host (300) — nothing from the app should show through. */
    z-index: 400;
    display: grid;
    place-items: center;
    padding: 24px;
    background: var(--bg);
    color: var(--label);
  }

  .recovery-card {
    max-width: 460px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: flex-start;
  }

  .recovery-card h1 {
    margin: 0;
    font-size: 1.25rem;
  }

  .recovery-detail {
    margin: 0;
    font-size: 0.9rem;
    line-height: 1.5;
    color: var(--label-2);
    overflow-wrap: anywhere;
  }

  .recovery-detail code {
    font-size: 0.85em;
  }

  .recovery-error {
    margin: 0;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--red-deep);
  }

  /* ---- the macOS window drag strip ------------------------------------- */
  /* The sidebar head used to be the window's only drag handle. With the sidebar
     gone, this transparent strip near the top keeps the window movable where the
     title bar is overlaid (see isMac in the script). It is rendered only on
     macOS and now spans the full width: the Settings gear that used to pin the
     top-right corner (and outrank the strip in the stacking order) is gone, and
     the dock stays above the strip. The content column starts below the strip's
     24px, so nothing tappable is covered. */
  .titlebar-drag {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 24px;
    z-index: 80;
  }

  /* ---- the floating dock ---------------------------------------------- */
  /* A translucent material floating over scrolling content, inset from the
     screen edges, with the pill spanning everything the + button leaves. */
  .dock {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: 560px;
    margin: 0 auto;
    padding: 0 16px calc(env(safe-area-inset-bottom) + 14px);
    box-sizing: border-box;
  }

  .pill,
  .fab {
    background: rgba(250, 250, 252, 0.78);
    -webkit-backdrop-filter: saturate(180%) blur(20px);
    backdrop-filter: saturate(180%) blur(20px);
    border: 1px solid rgba(60, 60, 67, 0.14);
    box-shadow:
      0 10px 30px rgba(0, 0, 0, 0.14),
      0 1px 2px rgba(0, 0, 0, 0.06);
  }

  .pill {
    position: relative;
    z-index: 2;
    flex: 1;
    min-width: 0;
    display: flex;
    height: 58px;
    border-radius: 999px;
    overflow: hidden;
  }

  /* The selected lozenge. It slides on the same curve iOS uses for sheets, and
     its geometry is exact: three equal thirds, inset 4px top and bottom. */
  .thumb {
    position: absolute;
    top: 4px;
    bottom: 4px;
    left: calc(var(--i) * (100% / 3) + 4px);
    width: calc(100% / 3 - 8px);
    border-radius: 999px;
    background: var(--fill);
    transition: left 0.34s cubic-bezier(0.32, 0.72, 0, 1);
    pointer-events: none;
  }

  .tab {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    text-decoration: none;
    color: var(--label-2);
    transition:
      color 0.15s ease,
      transform 0.12s cubic-bezier(0.23, 1, 0.32, 1);
    -webkit-tap-highlight-color: transparent;
  }

  .tab:active {
    transform: scale(0.94);
  }

  .tab.active {
    color: var(--label);
  }

  .tab-icon {
    display: grid;
    place-items: center;
    transition: transform 0.2s cubic-bezier(0.32, 0.72, 0, 1);
  }

  .tab.active .tab-icon {
    transform: scale(1.06);
  }

  .tab-label {
    font-size: 0.68rem;
    font-weight: 600;
    letter-spacing: 0.01em;
    white-space: nowrap;
  }

  /* ---- the + button ---------------------------------------------------- */
  .more {
    position: relative;
    flex: 0 0 auto;
  }

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

  .fab {
    position: relative;
    z-index: 2;
    width: 58px;
    height: 58px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: var(--label);
    cursor: pointer;
    padding: 0;
    -webkit-tap-highlight-color: transparent;
    transition:
      background 0.25s ease,
      color 0.2s ease,
      border-color 0.25s ease,
      box-shadow 0.25s ease,
      transform 0.15s cubic-bezier(0.23, 1, 0.32, 1);
  }

  .fab:active {
    transform: scale(0.93);
  }

  /* Open: the button becomes the gradient "active" state it just revealed. */
  .fab.open {
    background: linear-gradient(135deg, #0a84ff 0%, #7d5cff 52%, #ff2d95 100%);
    border-color: transparent;
    color: #ffffff;
    box-shadow:
      0 12px 30px rgba(110, 88, 255, 0.42),
      0 1px 2px rgba(0, 0, 0, 0.1);
  }

  /* One of the sections behind it is the current page. */
  .fab.route-active:not(.open) {
    color: var(--accent);
  }

  /* Drawn, not typed: a hairline + stays crisp at any density and inherits the
     button's color, including the white of the gradient state. */
  .fab-plus {
    position: relative;
    width: 19px;
    height: 19px;
  }
  .fab-plus::before,
  .fab-plus::after {
    content: "";
    position: absolute;
    inset: 0;
    margin: auto;
    background: currentColor;
    border-radius: 2px;
  }
  .fab-plus::before {
    width: 19px;
    height: 2px;
  }
  .fab-plus::after {
    width: 2px;
    height: 19px;
  }

  /* ---- the popover ----------------------------------------------------- */
  .popover {
    position: absolute;
    z-index: 3;
    bottom: calc(100% + 12px);
    right: 0;
    min-width: 196px;
    padding: 4px 0;
    border-radius: 16px;
    background: rgba(250, 250, 252, 0.9);
    -webkit-backdrop-filter: saturate(180%) blur(24px);
    backdrop-filter: saturate(180%) blur(24px);
    box-shadow:
      0 18px 44px rgba(0, 0, 0, 0.24),
      0 2px 6px rgba(0, 0, 0, 0.08);
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
    color: var(--accent);
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

  /* The :root data-theme guard makes these follow the manual theme override
     (src/lib/theme.ts) in addition to the OS setting. */
  :global(:root[data-theme="dark"]) .pill,
  :global(:root[data-theme="dark"]) .fab:not(.open) {
    background: rgba(28, 28, 30, 0.82);
    border-color: rgba(84, 84, 88, 0.5);
    box-shadow:
      0 10px 30px rgba(0, 0, 0, 0.55),
      0 1px 2px rgba(0, 0, 0, 0.4);
  }
  :global(:root[data-theme="dark"]) .popover {
    background: rgba(30, 30, 32, 0.9);
  }
  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .pill,
    :global(:root:not([data-theme="light"])) .fab:not(.open) {
      background: rgba(28, 28, 30, 0.82);
      border-color: rgba(84, 84, 88, 0.5);
      box-shadow:
        0 10px 30px rgba(0, 0, 0, 0.55),
        0 1px 2px rgba(0, 0, 0, 0.4);
    }
    :global(:root:not([data-theme="light"])) .popover {
      background: rgba(30, 30, 32, 0.9);
    }
  }

  @media (prefers-reduced-transparency: reduce) {
    .pill,
    .fab:not(.open),
    .popover {
      background: #ffffff;
      -webkit-backdrop-filter: none;
      backdrop-filter: none;
    }
    :global(:root[data-theme="dark"]) .pill,
    :global(:root[data-theme="dark"]) .fab:not(.open),
    :global(:root[data-theme="dark"]) .popover {
      background: #1c1c1e;
    }
    @media (prefers-color-scheme: dark) {
      :global(:root:not([data-theme="light"])) .pill,
      :global(:root:not([data-theme="light"])) .fab:not(.open),
      :global(:root:not([data-theme="light"])) .popover {
        background: #1c1c1e;
      }
    }
  }

  /* Reduced motion keeps every state change and drops the movement. */
  @media (prefers-reduced-motion: reduce) {
    .tab,
    .tab:active,
    .tab-icon,
    .fab,
    .fab:active,
    .thumb {
      transition: color 0.15s ease;
      transform: none;
    }
    .pop-item {
      transition: none;
    }
  }

  /* High contrast: give the floating chrome a defined edge. */
  @media (prefers-contrast: more) {
    .pill,
    .fab,
    .popover {
      border: 1px solid var(--label-3);
    }
  }
</style>
