import { defineConfig } from "vitest/config";

// Standalone test config, deliberately separate from `vite.config.js` (which
// loads the SvelteKit plugin and Tauri dev-server settings). Unit tests of the
// pure $lib modules run in a bare Node environment with no browser/SvelteKit
// coupling.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
