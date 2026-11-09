<script lang="ts">
  import type { Room } from "$lib/rooms/types";

  /** The ⋮ actions dropdown for one room card (Edit / beds / tenants / delete). */
  let {
    room,
    onEdit,
    onView,
    onManageTenants,
    onDelete,
  }: {
    room: Room;
    onEdit: (r: Room) => void;
    onView: (r: Room) => void;
    onManageTenants: (r: Room) => void;
    onDelete: (r: Room) => void;
  } = $props();

  let menuOpen = $state(false);
  let triggerEl = $state<HTMLButtonElement | null>(null);
  let menuEl = $state<HTMLDivElement | null>(null);

  function toggleMenu(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    menuOpen = !menuOpen;
  }

  function closeMenu() {
    menuOpen = false;
  }

  function onDocClick(e: MouseEvent) {
    if (!menuOpen) return;
    const t = e.target as Node;
    if (triggerEl && !triggerEl.contains(t) && menuEl && !menuEl.contains(t)) {
      menuOpen = false;
    }
  }

  function onDocKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") menuOpen = false;
  }

  $effect(() => {
    if (menuOpen) {
      // Focus the first item so keyboard users land inside the menu.
      menuEl?.querySelector<HTMLButtonElement>("button")?.focus();
      document.addEventListener("click", onDocClick, true);
      document.addEventListener("keydown", onDocKeydown);
      return () => {
        document.removeEventListener("click", onDocClick, true);
        document.removeEventListener("keydown", onDocKeydown);
      };
    }
  });
</script>

<div class="menu-wrap">
  <button
    type="button"
    class="menu-trigger"
    aria-label={`Actions for ${room.room_number}`}
    aria-haspopup="menu"
    aria-expanded={menuOpen}
    bind:this={triggerEl}
    onclick={toggleMenu}
  >
    ⋮
  </button>
  {#if menuOpen}
    <div
      class="room-menu"
      role="menu"
      aria-label={`Actions for ${room.room_number}`}
      bind:this={menuEl}
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <button type="button" role="menuitem" onclick={() => { closeMenu(); onEdit(room); }}>Edit</button>
      <button type="button" role="menuitem" onclick={() => { closeMenu(); onView(room); }}>Manage beds</button>
      <button type="button" role="menuitem" onclick={() => { closeMenu(); onManageTenants(room); }}>Manage tenants</button>
      <button type="button" role="menuitem" class="menu-danger" onclick={() => { closeMenu(); onDelete(room); }}>Delete</button>
    </div>
  {/if}
</div>

<style>
  .menu-wrap {
    position: relative;
    margin-left: auto;
    flex-shrink: 0;
    z-index: 30;
  }

  .menu-trigger {
    border: none;
    background: none;
    width: 32px;
    height: 32px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 1.2rem;
    line-height: 1;
    color: var(--label-2);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition:
      background 0.15s ease,
      color 0.15s ease;
  }
  .menu-trigger:active {
    background: var(--fill);
    color: var(--label);
  }
  .menu-trigger:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* Touch: the count is the only route to Edit / Manage beds / Manage tenants /
     Delete, so the 32px circle has to grow to a full-size target. */
  @media (pointer: coarse) {
    .menu-trigger {
      width: 44px;
      height: 44px;
    }
  }

  /* ---- anchored dropdown ---- */
  .room-menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    min-width: 180px;
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    background: var(--card);
    border: 1px solid var(--separator);
    border-radius: 12px;
    box-shadow: var(--shadow-modal);
    z-index: 50;
  }
  .room-menu button {
    display: flex;
    align-items: center;
    width: 100%;
    border: none;
    background: none;
    padding: 9px 12px;
    border-radius: 8px;
    font-family: inherit;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--label);
    text-align: left;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .room-menu button:active {
    background: var(--fill);
  }
  .room-menu button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .room-menu .menu-danger {
    color: var(--red-deep);
  }

  /* Pointer-only states: on touch, :hover would remain after the finger lifts. */
  @media (hover: hover) {
    .menu-trigger:hover {
      background: var(--fill);
      color: var(--label);
    }
    .room-menu button:hover {
      background: var(--fill);
    }
  }
</style>
