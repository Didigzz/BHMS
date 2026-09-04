import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { fileURLToPath, URL } from "node:url";

const host = process.env.TAURI_DEV_HOST;

// Plain-browser debug mode (`RENTEASE_PREVIEW=1 npm run dev`): the app is a Tauri
// SPA, so its `@tauri-apps/*` imports throw outside the WebView. Pointing them
// at src/lib/browser/* shims (sql.js database + virtual fs + dialog/notification
// mocks) lets every page and workflow run in a normal browser for debugging.
// The real `tauri dev` / `tauri build` flows never set this flag, so they keep
// the genuine plugins.
const preview = process.env.RENTEASE_PREVIEW === "1";

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [...(await sveltekit())],
  resolve: {
    alias: preview
      ? {
          "@tauri-apps/plugin-sql": fileURLToPath(
            new URL("./src/lib/browser/plugin-sql.ts", import.meta.url)
          ),
          "@tauri-apps/plugin-fs": fileURLToPath(
            new URL("./src/lib/browser/plugin-fs.ts", import.meta.url)
          ),
          "@tauri-apps/plugin-dialog": fileURLToPath(
            new URL("./src/lib/browser/plugin-dialog.ts", import.meta.url)
          ),
          "@tauri-apps/plugin-notification": fileURLToPath(
            new URL("./src/lib/browser/plugin-notification.ts", import.meta.url)
          ),
        }
      : undefined,
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
