/**
 * Android back-button overlay stack.
 *
 * Every overlay (the room-details bottom sheet and every modal dialog)
 * registers its close handler here while it is mounted. The native Android
 * layer (`MainActivity.kt`) asks us on every back press whether an overlay is
 * open; if so, we close the *topmost* overlay instead of letting the WebView
 * navigate its history (which is what caused the "back navigates to another
 * page" bug).
 *
 * Registration is LIFO, so nested overlays (e.g. the PayModal opened from the
 * room sheet) close one level at a time: PayModal → sheet → exit app.
 *
 * The depth is mirrored to the native side through the `AndroidBridge`
 * JavaScript interface (added by `MainActivity.kt`). The bridge is guarded, so
 * desktop / plain-browser dev runs are unaffected.
 */

type CloseHandler = () => void;

const stack: CloseHandler[] = [];

/** Mirror the current overlay depth to the native Android bridge. */
function syncNative() {
  const bridge = (window as unknown as { AndroidBridge?: { setOverlayDepth?: (n: number) => void } }).AndroidBridge;
  bridge?.setOverlayDepth?.(stack.length);
}

/**
 * Register an overlay's close handler. Returns an unregister function the
 * overlay must call when it unmounts.
 */
export function pushOverlay(close: CloseHandler): () => void {
  stack.push(close);
  syncNative();
  return () => {
    const index = stack.indexOf(close);
    if (index !== -1) {
      stack.splice(index, 1);
      syncNative();
    }
  };
}

/**
 * Close the topmost overlay (its registered close handler). Returns true if
 * an overlay was closed.
 *
 * Note: the handler stays registered until the overlay unmounts, so a back
 * press during a closing animation still lands on the (guarded) close
 * handler rather than falling through to navigation.
 */
export function closeTopOverlay(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top();
  return true;
}

// Entry point evaluated by MainActivity.kt on back press while an overlay is
// open (via WebView.evaluateJavascript).
declare global {
  interface Window {
    __renteaseCloseTopOverlay?: () => boolean;
  }
}
window.__renteaseCloseTopOverlay = () => closeTopOverlay();
