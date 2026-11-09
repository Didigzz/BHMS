// Regenerates every app icon from src-tauri/icons-src/app-icon.json.
//
// The Tauri CLI writes the desktop, macOS, iOS and Android sets. The favicon is
// not one of its outputs, so it is copied from the 128px PNG to keep the two
// byte-identical (src/app.html points at it).

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = join(root, "src-tauri", "icons-src", "app-icon.json");
const iconsDir = join(root, "src-tauri", "icons");
const resDir = join(root, "src-tauri", "gen", "android", "app", "src", "main", "res");

const result = spawnSync("npx", ["tauri", "icon", relative(root, manifest)], {
  cwd: root,
  stdio: "inherit",
  shell: true,
});

if (result.status !== 0) {
  console.error("tauri icon failed — icons were not regenerated.");
  process.exit(result.status ?? 1);
}

const faviconSource = join(iconsDir, "128x128.png");
const favicon = join(root, "static", "favicon.png");
copyFileSync(faviconSource, favicon);
console.log(`favicon: ${relative(root, faviconSource)} -> ${relative(root, favicon)}`);

const outputs = [
  join(iconsDir, "32x32.png"),
  join(iconsDir, "64x64.png"),
  join(iconsDir, "128x128.png"),
  join(iconsDir, "128x128@2x.png"),
  join(iconsDir, "icon.png"),
  join(iconsDir, "icon.ico"),
  join(iconsDir, "icon.icns"),
  join(iconsDir, "StoreLogo.png"),
  join(iconsDir, "ios", "AppIcon-512@2x.png"),
];

if (existsSync(resDir)) {
  outputs.push(
    join(resDir, "mipmap-xxxhdpi", "ic_launcher_foreground.png"),
    join(resDir, "mipmap-xxxhdpi", "ic_launcher_monochrome.png"),
    join(resDir, "mipmap-anydpi-v26", "ic_launcher.xml"),
  );
} else {
  console.warn(
    "Android project not found — desktop/iOS icons only. Run `tauri android init`, then rerun.",
  );
}

const missing = outputs.filter((path) => !existsSync(path) || statSync(path).size === 0);
if (missing.length > 0) {
  console.error("Missing icon output(s):");
  for (const path of missing) console.error(`  ${relative(root, path)}`);
  process.exit(1);
}

console.log(`icons: ${outputs.length} outputs present`);
