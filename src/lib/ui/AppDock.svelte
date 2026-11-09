<script lang="ts">
  import { page } from "$app/state";
  import Icon from "$lib/ui/Icon.svelte";
  import LayoutDashboard from "@lucide/svelte/icons/layout-dashboard";
  import Users from "@lucide/svelte/icons/users";
  import BedDouble from "@lucide/svelte/icons/bed-double";
  import CalendarDays from "@lucide/svelte/icons/calendar-days";
  import ReceiptText from "@lucide/svelte/icons/receipt-text";
  import Settings from "@lucide/svelte/icons/settings";
  import DockMoreMenu from "./DockMoreMenu.svelte";

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
</script>

<!-- One navigation at every width: the floating dock, which was the approved
     phone design first. The wide-screen sidebar that used to replace it is gone,
     so there is no width state to get wrong on resize and no second layout to
     keep in sync — a maximized window renders the phone layout too. -->
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
    <DockMoreMenu open={menuOpen} items={MORE} {pathname} onClose={() => (menuOpen = false)} />
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

<style>
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
    /* Fades out while a dialog or sheet is open (app.css). */
    transition: opacity 0.18s ease;
  }

  .pill,
  .fab {
    background: var(--nav-surface);
    -webkit-backdrop-filter: saturate(150%) blur(18px);
    backdrop-filter: saturate(150%) blur(18px);
    border: 1px solid var(--separator);
    box-shadow:
      0 18px 40px -22px rgba(16, 22, 20, 0.55),
      0 1px 2px rgba(16, 22, 20, 0.06);
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
    border-radius: var(--radius-pill);
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 16%, transparent);
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
    color: var(--label-3);
    transition:
      color 0.15s ease,
      transform 0.12s cubic-bezier(0.23, 1, 0.32, 1);
    -webkit-tap-highlight-color: transparent;
  }

  .tab:active {
    transform: scale(0.94);
  }

  .tab.active {
    color: var(--accent-deep);
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
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.01em;
    white-space: nowrap;
  }

  /* ---- the + button ---------------------------------------------------- */
  .more {
    position: relative;
    flex: 0 0 auto;
  }

  .fab {
    position: relative;
    z-index: 2;
    width: 58px;
    height: 58px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    /* Ink disc: the one solid, high-contrast object in the dock. It inverts
       with the theme, so it always reads as the primary action. */
    background: var(--label);
    color: var(--card);
    border-color: transparent;
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

  /* Open: the disc becomes the accent, so the state has one meaning. */
  .fab.open {
    background: var(--accent);
    border-color: transparent;
    color: var(--accent-contrast);
    box-shadow:
      0 14px 30px -14px color-mix(in srgb, var(--accent) 70%, black),
      0 1px 2px rgba(0, 0, 0, 0.1);
  }

  /* One of the sections behind it is the current page: a ring, not a second
     accent fill competing with the open state. */
  .fab.route-active:not(.open) {
    box-shadow:
      0 0 0 2px var(--accent),
      0 18px 40px -22px rgba(16, 22, 20, 0.55);
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

  /* The dock's surfaces come from theme tokens, so the manual data-theme
     override (src/lib/theme.ts) and the OS setting both flow through here. */
  @media (prefers-reduced-transparency: reduce) {
    .pill {
      background: var(--card);
      -webkit-backdrop-filter: none;
      backdrop-filter: none;
    }
    .fab:not(.open) {
      background: var(--label);
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
    .dock {
      transition: none;
    }
  }

  /* High contrast: give the floating chrome a defined edge. */
  @media (prefers-contrast: more) {
    .pill,
    .fab {
      border: 1px solid var(--label-3);
    }
  }
</style>
