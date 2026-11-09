import { getCurrentWindow } from "@tauri-apps/api/window";
import { getSetting, setSetting } from "../db/settings";
import { isTauri } from "../db/db";

/**
 * Manual theme override (Settings → Appearance).
 *
 * The app's palettes live in app.css as CSS variables keyed off the device
 * theme via `prefers-color-scheme`. This module lets the user force Light or
 * Dark (or keep following the device) by setting `data-theme` on <html>; the
 * CSS guards (`:root[data-theme="dark"]` / `:root:not([data-theme="light"])`)
 * make the override win over the media query. On desktop the native window
 * chrome follows along via `Window.setTheme`.
 */

export type ThemePreference = "light" | "dark" | "system";

const THEME_KEY = "theme";

/**
 * Load the persisted preference. A fresh install has no saved row and starts in
 * Light (dashboard-mobile-polish-spec §5); a stored "system" row from an older
 * build still follows the device.
 */
export async function getThemePreference(): Promise<ThemePreference> {
  const value = await getSetting(THEME_KEY, "light");
  return value === "light" || value === "dark" || value === "system" ? value : "light";
}

/**
 * Mirror the choice into localStorage under the same "theme" key the inline
 * script in src/app.html reads before first paint. Without it, a saved Dark
 * install would flash light (the new markup default) until the database read
 * completes. "system" is removed rather than cached so it keeps falling
 * through to prefers-color-scheme.
 */
function cacheThemeHint(pref: ThemePreference): void {
  try {
    if (pref === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    // Storage unavailable — the pre-paint hint is optional.
  }
}

/** Apply a preference to the DOM and the native window (never throws). */
export function applyTheme(pref: ThemePreference): void {
  document.documentElement.dataset.theme = pref;
  cacheThemeHint(pref);
  if (isTauri()) {
    try {
      // null = follow the OS. Browser-preview mode never reaches this call
      // (isTauri() is false there), so no shim is needed.
      void getCurrentWindow().setTheme(pref === "system" ? null : pref);
    } catch {
      // Non-fatal: web content still themes correctly.
    }
  }
}

/**
 * Apply the persisted preference once at startup. The inline script in
 * src/app.html has already applied the cached choice, so this only reconciles
 * the DOM with the database (the source of truth) — no flash either way.
 */
export async function initTheme(): Promise<void> {
  try {
    applyTheme(await getThemePreference());
  } catch {
    // Never let a theme read break app startup.
  }
}

/**
 * Switch themes with the fade + diagonal-wipe transition (top-left corner
 * sweeping to bottom-right; see the `::view-transition-*` styles in app.css),
 * then persist the choice. Falls back to an instant apply when View
 * Transitions aren't available or the user prefers reduced motion.
 */
export async function setThemePreference(pref: ThemePreference): Promise<void> {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (typeof document.startViewTransition === "function" && !reduceMotion) {
    const root = document.documentElement;
    // Suppress the 0.3s background fade while the wipe runs, so the reveal is
    // the only motion (the fade remains the fallback path below).
    root.classList.add("theme-switching");
    const transition = document.startViewTransition(() => applyTheme(pref));
    transition.finished
      .finally(() => root.classList.remove("theme-switching"))
      .catch(() => {});
  } else {
    applyTheme(pref);
  }
  await setSetting(THEME_KEY, pref);
}