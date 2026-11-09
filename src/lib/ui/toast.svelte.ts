/**
 * App-wide toast notifications (billing-features-spec.md §8).
 *
 * Module-scoped Svelte 5 runes: any component can push a toast and the single
 * ToastHost mounted in +layout.svelte renders it. Toasts auto-dismiss after a
 * few seconds and are tappable to dismiss early.
 *
 * Note: `export const toasts = $state(...)` is the documented shared-state
 * pattern for .svelte.ts modules — the reactive proxy is mutated in place
 * (push/splice), and any component that reads it re-renders.
 */

export type ToastVariant = "success" | "error" | "info";

export interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
}

/** How long a toast stays on screen before auto-dismissing. */
export const TOAST_DURATION_MS = 3000;

/** Safety cap so a burst of toasts can't stack off-screen. */
const MAX_TOASTS = 5;

export const toasts = $state<Toast[]>([]);

let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

/** Push a toast; returns the id (handy for tests / advanced flows). */
export function pushToast(message: string, variant: ToastVariant = "info"): number {
  const id = nextId++;
  toasts.push({ id, message, variant });

  // Drop the oldest toasts beyond the cap (their timers are cleaned up below).
  while (toasts.length > MAX_TOASTS) {
    dismissToast(toasts[0].id);
  }

  const timer = setTimeout(() => dismissToast(id), TOAST_DURATION_MS);
  timers.set(id, timer);
  return id;
}

/** Dismiss a toast immediately (tap-to-dismiss or auto-dismiss timer). */
export function dismissToast(id: number): void {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  const index = toasts.findIndex((t) => t.id === id);
  if (index !== -1) toasts.splice(index, 1);
}
