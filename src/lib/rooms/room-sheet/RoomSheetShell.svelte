<script lang="ts">
  import type { Snippet } from "svelte";
  import { badgeClass } from "$lib/rooms/room-status";
  import { phpPeso, roomLabel } from "$lib/ui/format";
  import type { BoarderSheetRoom } from "$lib/rooms/rooms";

  /**
   * The room sheet's chrome: backdrop, slide-up panel, grabber, sticky header
   * and scroll body. The component supplies the content and the handlers; the
   * shell keeps the safe-area and reduced-motion styling in one place.
   */
  let {
    room,
    selectedName,
    closing,
    dragging,
    dragOffset,
    onBack,
    onClose,
    onBackdropClick,
    onKeydown,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    sheetEl = $bindable(),
    bodyEl = $bindable(),
    children,
  }: {
    room: BoarderSheetRoom;
    selectedName: string | null;
    closing: boolean;
    dragging: boolean;
    dragOffset: number;
    onBack: () => void;
    onClose: () => void;
    onBackdropClick: (event: MouseEvent) => void;
    onKeydown: (event: KeyboardEvent) => void;
    onPointerDown: (event: PointerEvent) => void;
    onPointerMove: (event: PointerEvent) => void;
    onPointerUp: (event: PointerEvent) => void;
    sheetEl?: HTMLElement | undefined;
    bodyEl?: HTMLElement | undefined;
    children: Snippet;
  } = $props();
</script>

<div class="sheet-backdrop" class:closing role="presentation" onclick={onBackdropClick}>
  <div
    bind:this={sheetEl}
    class="sheet"
    class:closing
    class:dragging
    role="dialog"
    aria-modal="true"
    aria-label={`${roomLabel(room.room_number)} details`}
    tabindex="-1"
    style:transform={dragging ? `translateY(${dragOffset}px)` : ""}
    onclick={(e) => e.stopPropagation()}
    onkeydown={onKeydown}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
  >
    <div class="grabber" aria-hidden="true"></div>

    <header class="sheet-header">
      {#if selectedName}
        <button type="button" class="btn sheet-back" onclick={onBack} aria-label="Back to beds">‹</button>
      {/if}
      <div class="sheet-title">
        <h2>{selectedName ?? room.room_number}</h2>
        <p class="sheet-subtitle">
          {#if selectedName}
            {roomLabel(room.room_number)} · {phpPeso(room.monthly_rate)}/month
          {:else}
            {room.occupied_beds}/{room.capacity} bed{room.occupied_beds === 1 ? "" : "s"} occupied
            {#if room.held_beds > 0}
              · +{room.held_beds} held
            {/if}
            · {phpPeso(room.monthly_rate)}/month
          {/if}
        </p>
      </div>
      <span class="badge {badgeClass(room.status)}">{room.status}</span>
      <button type="button" class="btn sheet-close" onclick={onClose} aria-label="Close">✕</button>
    </header>

    <div class="sheet-body" bind:this={bodyEl}>
      {@render children()}
    </div>
  </div>
</div>

<style>
  /* ---- overlay ---- */
  .sheet-backdrop {
    position: fixed;
    inset: 0;
    z-index: 300;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    /* The sheet is bottom-anchored, so the bottom padding is what keeps it out
       of the gesture bar / home indicator — at a flat 14px the sheet's last
       rows sat inside it. The top inset keeps the sheet's rounded top below the
       status bar. `max()` preserves the designed 14px where there is no inset. */
    padding: max(14px, env(safe-area-inset-top, 0px)) 14px max(14px, env(safe-area-inset-bottom, 0px));
    background: rgba(0, 0, 0, 0.35);
    transition: background-color 0.25s ease;
  }
  .sheet-backdrop.closing {
    background: rgba(0, 0, 0, 0);
  }
  @starting-style {
    .sheet-backdrop {
      background: rgba(0, 0, 0, 0);
    }
  }
  /* Guarded by the :root data-theme override (src/lib/theme.ts) in addition
     to the OS setting. */
  :global(:root[data-theme="dark"]) .sheet-backdrop {
    background: rgba(0, 0, 0, 0.5);
  }
  :global(:root[data-theme="dark"]) .sheet-backdrop.closing {
    background: rgba(0, 0, 0, 0);
  }
  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .sheet-backdrop {
      background: rgba(0, 0, 0, 0.5);
    }
    :global(:root:not([data-theme="light"])) .sheet-backdrop.closing {
      background: rgba(0, 0, 0, 0);
    }
  }

  /* ---- sheet: near-fullscreen panel sliding up from the bottom ---- */
  .sheet {
    width: 100%;
    max-width: 760px;
    /* Fills the backdrop's content box instead of subtracting a fixed 28px from
       the viewport, so the sheet shrinks by exactly what the system bars take
       rather than overflowing under them. Identical to the old
       calc(100vh - 28px) when the device reports no insets. */
    height: 100%;
    max-height: 900px;
    background: var(--card);
    border: 1px solid var(--separator);
    border-radius: var(--radius-sheet);
    box-shadow: var(--shadow-modal);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    outline: none;
    transform: translateY(0);
    transition: transform 0.26s cubic-bezier(0.32, 0.72, 0, 1);
    will-change: transform;
  }
  .sheet.dragging {
    transition: none;
  }
  .sheet.closing {
    transform: translateY(110%);
  }
  @starting-style {
    .sheet {
      transform: translateY(110%);
    }
  }

  .grabber {
    flex-shrink: 0;
    width: 44px;
    height: 5px;
    border-radius: var(--radius-pill);
    background: var(--separator-strong);
    margin: 10px auto 0;
  }

  /* ---- header (sticky) ---- */
  .sheet-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 4px 18px 14px;
    border-bottom: 1px solid var(--separator);
    flex-shrink: 0;
  }
  .sheet-title {
    flex: 1;
    min-width: 0;
  }
  .sheet-title h2 {
    margin: 0;
    font-size: 1.25rem;
    letter-spacing: -0.02em;
  }
  .sheet-subtitle {
    margin: 2px 0 0;
    color: var(--label-2);
    font-size: 0.85rem;
  }
  .sheet-close {
    border-radius: var(--radius-pill);
    padding: 8px 13px;
    flex-shrink: 0;
  }

  /* ---- scrollable body ---- */
  .sheet-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 16px;
  }

  /* Phone: the detail sheet joins the same bottom-sheet language as the
     dialogs — full-bleed sides and a 24px top radius — instead of floating as
     a rounded card with a margin all around. */
  @media (max-width: 640px), (pointer: coarse) {
    .sheet-backdrop {
      padding: max(10px, env(safe-area-inset-top, 0px)) 0 0;
    }
    .sheet {
      max-width: none;
      max-height: none;
      border-left: none;
      border-right: none;
      border-bottom: none;
      border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
    }
    .sheet-body {
      padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px));
    }
  }

  /* ---- level-1 back button (level 2 header) ---- */
  .sheet-back {
    border-radius: 999px;
    padding: 8px 14px;
    font-size: 1.15rem;
    line-height: 1;
    flex-shrink: 0;
  }

  /* ---- reduced motion: keep state changes, drop movement ---- */
  @media (prefers-reduced-motion: reduce) {
    .sheet-backdrop,
    .sheet {
      transition: none;
    }
    @starting-style {
      .sheet-backdrop {
        background: rgba(0, 0, 0, 0.35);
      }
      .sheet {
        transform: translateY(0);
      }
    }
  }
</style>
