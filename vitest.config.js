import { defineConfig } from "vitest/config";
import { sveltekit } from "@sveltejs/kit/vite";

// Test config. The SvelteKit plugin is here (unlike the original bare-Node
// setup) so component tests resolve `$lib`, `$app/state` and `$app/navigation`
// the same way the app does. Pure `$lib` module tests keep working unchanged —
// jsdom is a superset of what they need.
export default defineConfig({
  plugins: [sveltekit()],
  resolve: {
    // Svelte components must be resolved with browser conditions, or the
    // server build of Svelte is picked and `mount`/DOM APIs are missing.
    conditions: ["browser"],
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./src/test/setup.ts"],
    // Svelte 5 flushes DOM updates in microtasks; let Testing Library's
    // auto-cleanup run after each test.
    restoreMocks: true,
  },
});
