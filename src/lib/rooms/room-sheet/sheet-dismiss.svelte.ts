/**
 * Sheet dismissal: the X / backdrop / Esc / swipe-down behaviour shared by the
 * room detail sheet. Extracted from the component so the gesture math and the
 * focus trap are not buried in the middle of payment handlers.
 *
 * Runes require a `.svelte.ts` module; the sheet creates one instance per open.
 */

export interface SheetDismissOptions {
  reduceMotion: boolean;
  /** Never dismiss while a nested action modal is up. */
  isBlocked: () => boolean;
  /** Android back / Esc: step out of level 2 first, then close. */
  onBack: () => void;
  /** Called after the slide-down finishes. */
  onDismissed: () => void;
  sheet: () => HTMLElement | undefined;
  body: () => HTMLElement | undefined;
}

const CLOSE_MS = 300;

export function createSheetDismiss(options: SheetDismissOptions) {
  let closing = $state(false);
  let dragging = $state(false);
  let dragOffset = $state(0);
  let dragStartY = 0;
  let dragPointerId: number | null = null;

  // ----- dismissal: X, backdrop, Esc, swipe-down -----
  function close() {
    if (closing || options.isBlocked()) return;
    closing = true;
    dragging = false;
    window.setTimeout(() => {
      options.onDismissed();
    }, options.reduceMotion ? 0 : CLOSE_MS);
  }

  function onBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) close();
  }

  function onKeydown(e: KeyboardEvent) {
    const sheetEl = options.sheet();
    if (e.key === "Escape") {
      e.preventDefault();
      options.onBack();
      return;
    }
    // Keep Tab cycling within the sheet (focus trap).
    if (e.key === "Tab") {
      const focusables = sheetEl?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  function onPointerDown(e: PointerEvent) {
    const bodyEl = options.body();
    const sheetEl = options.sheet();
    if (closing) return;
    // Never hijack buttons (Close, history toggles) or start mid-scroll.
    if ((e.target as HTMLElement).closest("button")) return;
    if (bodyEl && bodyEl.scrollTop > 0) return;
    dragging = true;
    dragStartY = e.clientY;
    dragOffset = 0;
    dragPointerId = e.pointerId;
    sheetEl?.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging || e.pointerId !== dragPointerId) return;
    const dy = e.clientY - dragStartY;
    dragOffset = Math.max(0, dy * 0.55);
  }

  function onPointerUp(e: PointerEvent) {
    if (!dragging || e.pointerId !== dragPointerId) return;
    dragging = false;
    if (dragOffset > 110) {
      close();
    } else {
      dragOffset = 0;
    }
  }

  return {
    get closing() {
      return closing;
    },
    get dragging() {
      return dragging;
    },
    get dragOffset() {
      return dragOffset;
    },
    close,
    onBackdropClick,
    onKeydown,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}
