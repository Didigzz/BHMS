// TEMPORARY visual-review driver (delete after use).
// Drives headless Chrome over CDP: seeds the preview DB via window.__shim,
// then screenshots every route at phone and desktop widths.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "http://127.0.0.1:1420";
const OUT = ".screenshots";
// Unique per run so a stale headless Chrome from an earlier run can't shadow it.
const PORT = 9300 + (Date.now() % 500);

mkdirSync(OUT, { recursive: true });

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    // Outside the project on purpose: Vite watches the repo, and a locked
    // Chrome profile inside it crashes the watcher with EBUSY.
    `--user-data-dir=${join(tmpdir(), "rentease-shot-profile")}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    "--force-color-profile=srgb",
    "about:blank",
  ],
  { stdio: "ignore" }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevtools() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error("devtools never came up");
}

let nextId = 1;
const pending = new Map();

function send(ws, method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout: ${method}`));
      }
    }, 30000);
  });
}

async function main() {
  await waitForDevtools();
  const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  };

  await send(ws, "Page.enable");
  await send(ws, "Runtime.enable");

  const evaluate = async (expression) => {
    const res = await send(ws, "Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? "eval failed");
    return res.result.value;
  };

  const goto = async (path) => {
    await send(ws, "Page.navigate", { url: BASE + path });
    await sleep(400);
    for (let i = 0; i < 60; i++) {
      try {
        const ready = await evaluate(
          "!!document.querySelector('main') && !/Loading (dashboard|rooms|tenants|reservations|bills|report)/.test(document.body.innerText)"
        );
        if (ready) break;
      } catch {}
      await sleep(250);
    }
    await sleep(700);
  };

  const viewport = async (width, height, mobile) => {
    await send(ws, "Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 2,
      mobile,
    });
    await send(ws, "Emulation.setTouchEmulationEnabled", {
      enabled: mobile,
      ...(mobile ? { maxTouchPoints: 5 } : {}),
    });
  };

  const shot = async (name) => {
    const { data } = await send(ws, "Page.captureScreenshot", { format: "png" });
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, "base64"));
    console.log("shot:", name);
  };

  // ---- seed ----
  await viewport(414, 896, true);
  await goto("/");

  const seed = `
    DELETE FROM payments; DELETE FROM tenants; DELETE FROM reservations; DELETE FROM rooms;
    INSERT INTO rooms (room_number, capacity, monthly_rate) VALUES ('101', 4, 3500), ('102', 2, 2800), ('103', 6, 4200), ('104', 1, 2000);
  `;
  try {
    await evaluate(`window.__shim.exec(${JSON.stringify(seed)}).then(() => 'ok')`);
    const rooms = await evaluate(
      `window.__shim.query("SELECT id, room_number FROM rooms ORDER BY id").then(r => JSON.stringify(r))`
    );
    console.log("rooms:", rooms);
    const ids = JSON.parse(rooms);
    const tenants = ids
      .slice(0, 3)
      .map((r, i) =>
        `INSERT INTO tenants (name, contact, room_id, move_in_date, due_date) VALUES ('${
          ["Maria Santos", "Juan Dela Cruz", "Ana Reyes"][i]
        }', '0917000${i}000', ${r.id}, '2026-01-05', '${
          ["2026-11-01", "2026-11-15", "2026-12-01"][i]
        }');`
      )
      .join("\n");
    await evaluate(`window.__shim.exec(${JSON.stringify(tenants)}).then(() => 'ok')`);
    console.log("seed ok");
  } catch (e) {
    console.log("SEED FAILED:", e.message);
  }

  // ---- light mode, phone width ----
  const routes = [
    ["dashboard", "/"],
    ["tenants", "/tenants"],
    ["rooms", "/rooms"],
    ["reservations", "/reservations"],
    ["amenities", "/amenities/billing"],
    ["settings", "/settings"],
    ["sales-report", "/settings/sales-report"],
  ];
  for (const [name, path] of routes) {
    await goto(path);
    await shot(`${name}-phone`);
  }

  // ---- desktop width ----
  await viewport(1100, 900, false);
  for (const [name, path] of [
    ["dashboard", "/"],
    ["rooms", "/rooms"],
  ]) {
    await goto(path);
    await shot(`${name}-desktop`);
  }

  // ---- dark mode, phone width ----
  await viewport(414, 896, true);
  await goto("/");
  try {
    await evaluate(`localStorage.setItem('theme','dark')`);
  } catch (e) {
    console.log("theme pref write failed:", e.message);
  }
  for (const [name, path] of [
    ["dashboard", "/"],
    ["tenants", "/tenants"],
  ]) {
    await goto(path);
    try {
      await evaluate(`document.documentElement.dataset.theme='dark'`);
    } catch {}
    await sleep(200);
    await shot(`${name}-dark`);
  }

  ws.close();
  chrome.kill();
  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  chrome.kill();
  process.exit(1);
});
