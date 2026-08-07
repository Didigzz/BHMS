<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { checkAndNotify } from "$lib/reminders";
  import ToastHost from "$lib/components/ToastHost.svelte";
  // App-wide design system (buttons, cards, badges, modal overlay, theme).
  import "../app.css";

  // Check-on-open reminders: fires any due/overdue pings that happened while
  // the app was closed (de-duped in notifications_log). Safe to run even in a
  // plain browser dev server — the plugin is guarded inside reminders.ts.
  onMount(() => {
    checkAndNotify();
  });
</script>

<nav class="tabbar" aria-label="Main navigation">
  <a href="/" class="tab" class:active={page.url.pathname === "/"}>
    <span class="tab-icon">📊</span>
    <span>Dashboard</span>
  </a>
  <a href="/rooms" class="tab" class:active={page.url.pathname.startsWith("/rooms")}>
    <span class="tab-icon">🛏️</span>
    <span>Rooms</span>
  </a>
  <a href="/tenants" class="tab" class:active={page.url.pathname.startsWith("/tenants")}>
    <span class="tab-icon">👤</span>
    <span>Tenants</span>
  </a>
  <a href="/reservations" class="tab" class:active={page.url.pathname.startsWith("/reservations")}>
    <span class="tab-icon">📅</span>
    <span>Reservations</span>
  </a>
</nav>

<a href="/settings" class="gear" aria-label="Settings" class:active={page.url.pathname === "/settings"}>
  <span class="gear-icon">⚙</span>
</a>

<slot />

<ToastHost />

<style>
  /* Frosted chrome: the tab bar is a translucent material floating over
     scrolling content, not an opaque strip. */
  .tabbar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    display: flex;
    background: rgba(250, 250, 252, 0.78);
    -webkit-backdrop-filter: saturate(180%) blur(20px);
    backdrop-filter: saturate(180%) blur(20px);
    border-top: 1px solid rgba(60, 60, 67, 0.29);
    z-index: 100;
    padding-bottom: env(safe-area-inset-bottom);
  }

  .tab {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 10px 0 8px;
    text-decoration: none;
    color: var(--label-2);
    font-size: 0.72rem;
    font-weight: 600;
    transition:
      color 0.15s ease,
      transform 0.12s cubic-bezier(0.23, 1, 0.32, 1);
    -webkit-tap-highlight-color: transparent;
  }

  .tab:active {
    transform: scale(0.96);
  }

  .tab-icon {
    font-size: 1.3rem;
    line-height: 1;
  }

  .tab.active {
    color: var(--accent);
  }

  .gear {
    position: fixed;
    top: 10px;
    right: 10px;
    z-index: 90;
    width: 38px;
    height: 38px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.72);
    -webkit-backdrop-filter: saturate(180%) blur(20px);
    backdrop-filter: saturate(180%) blur(20px);
    box-shadow:
      0 2px 10px rgba(0, 0, 0, 0.1),
      inset 0 0 0 0.5px rgba(255, 255, 255, 0.5);
    text-decoration: none;
    color: var(--label-2);
    transition:
      transform 0.15s cubic-bezier(0.23, 1, 0.32, 1),
      color 0.15s ease,
      background 0.15s ease;
    -webkit-tap-highlight-color: transparent;
  }

  .gear:active {
    transform: scale(0.92);
  }

  .gear-icon {
    font-size: 1.2rem;
    line-height: 1;
  }

  @media (hover: hover) and (pointer: fine) {
    .gear:hover {
      transform: rotate(30deg);
    }
  }

  .gear.active {
    color: var(--accent);
  }

  @media (prefers-color-scheme: dark) {
    .tabbar {
      background: rgba(18, 18, 20, 0.78);
      border-top-color: rgba(84, 84, 88, 0.65);
    }
    .gear {
      background: rgba(44, 44, 46, 0.8);
      box-shadow:
        0 2px 10px rgba(0, 0, 0, 0.35),
        inset 0 0 0 0.5px rgba(255, 255, 255, 0.12);
    }
  }

  @media (prefers-reduced-transparency: reduce) {
    .tabbar {
      background: #ffffff;
      -webkit-backdrop-filter: none;
      backdrop-filter: none;
    }
    .gear {
      background: #ffffff;
      -webkit-backdrop-filter: none;
      backdrop-filter: none;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
    }
  }
  @media (prefers-reduced-transparency: reduce) and (prefers-color-scheme: dark) {
    .tabbar {
      background: #1c1c1e;
      border-top-color: #3a3a3e;
    }
    .gear {
      background: #2a2a2d;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .tab,
    .gear {
      transition: color 0.15s ease;
    }
    .tab:active,
    .gear:active {
      transform: none;
    }
    .gear:hover {
      transform: none;
    }
  }
</style>
