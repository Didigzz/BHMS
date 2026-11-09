import type { TransitionConfig } from "svelte/transition";

/**
 * Modal materialization for every dialog in the app: the overlay fades in
 * while the panel settles from a slight scale + rise (the panel's scale
 * entrance lives in app.css via @starting-style), and on close everything
 * fades and settles back down so dismissal mirrors entry.
 *
 * Honors prefers-reduced-motion with a short opacity-only cross-fade —
 * the state change is kept, the movement is dropped.
 */
export function modalMaterial(node: Element): TransitionConfig {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) {
    return {
      duration: 120,
      css: (t) => `opacity: ${t}`,
    };
  }
  return {
    duration: 240,
    easing: (t) => 1 - Math.pow(1 - t, 3),
    css: (t, u) => `opacity: ${t}; transform: scale(${1 - 0.02 * u}) translateY(${6 * u}px);`,
  };
}
