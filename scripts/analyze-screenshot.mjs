// Analyze Android screencap PNGs: decodes the PNG (RGB/RGBA 8-bit), reports
// content density, top colors, red "error" pixel count, and a per-band row
// profile so we can locate the tab bar and headers.
// Usage: node scripts/analyze-screenshot.mjs --selftest [file.png ...]
import { readFileSync, writeFileSync } from "node:fs";
import { inflateSync, deflateSync } from "node:zlib";

/* ---------- PNG decode ---------- */

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const stride = width * bpp;
  const px = Buffer.alloc(width * height * 4);
  let off = 0;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[off++];
    const line = raw.subarray(off, off + stride);
    const out = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      switch (filter) {
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
      }
      out[x] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const si = x * bpp;
      const di = (y * width + x) * 4;
      if (colorType === 6) {
        px[di] = out[si]; px[di + 1] = out[si + 1]; px[di + 2] = out[si + 2]; px[di + 3] = out[si + 3];
      } else if (colorType === 2) {
        px[di] = out[si]; px[di + 1] = out[si + 1]; px[di + 2] = out[si + 2]; px[di + 3] = 255;
      }
    }
    prev = out;
    off += stride;
  }
  return { width, height, px };
}

/* ---------- Self-test: encode a known image (all 5 filters) and round-trip ---------- */

const TEST_W = 10, TEST_H = 10;
const TEST_ROWS = [
  [255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 255, 255],
  [0, 0, 0, 255], [255, 255, 0, 255], [0, 255, 255, 255], [255, 0, 255, 255],
  [128, 128, 128, 255], [255, 0, 128, 255],
];

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function encodeTestPng() {
  const bpp = 4, stride = TEST_W * bpp;
  const raw = Buffer.alloc(TEST_H * (stride + 1));
  const prev = Buffer.alloc(stride);
  for (let y = 0; y < TEST_H; y++) {
    const filter = y % 5; // 0..4 across rows
    raw[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const b = x >= bpp ? TEST_ROWS[(x / bpp) | 0][x % bpp] : 0; // pixel per column
      // per-pixel color: use column index mod 10 mapping to TEST_ROWS
      const col = (x / bpp) | 0;
      const orig = TEST_ROWS[col][x % bpp];
      const a = x >= bpp ? TEST_ROWS[col - 1][x % bpp] : 0;
      const c = x >= bpp ? prev[x - bpp] : 0;
      const pb = prev[x];
      let v = orig;
      switch (filter) {
        case 1: v = orig - a; break;
        case 2: v = orig - pb; break;
        case 3: v = orig - ((a + pb) >> 1); break;
        case 4: v = orig - paeth(a, pb, c); break;
      }
      raw[y * (stride + 1) + 1 + x] = v & 0xff;
      prev[x] = orig;
    }
  }
  // build PNG chunks (CRCs left zero — our decoder ignores them)
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    data.copy(out, 8);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(TEST_W, 0);
  ihdr.writeUInt32BE(TEST_H, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function selfTest() {
  const png = encodeTestPng();
  writeFileSync("selftest.png", png);
  const { width, height, px } = decodePng(png);
  let ok = true;
  if (width !== TEST_W || height !== TEST_H) { ok = false; console.log("  size mismatch"); }
  for (let y = 0; y < TEST_H; y++) {
    for (let x = 0; x < TEST_W; x++) {
      const exp = TEST_ROWS[x];
      const i = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) {
        if (px[i + c] !== exp[c]) {
          ok = false;
          if (ok === false) { /* keep first few logs small */ }
          if (y * TEST_W + x < 6) console.log(`  MISMATCH at (${x},${y}) c=${c}: got ${px[i + c]} want ${exp[c]}`);
        }
      }
    }
  }
  console.log(ok ? "  ✓ self-test passed (all 5 filters round-trip correctly)" : "  ✗ self-test FAILED");
  return ok;
}

/* ---------- Analysis ---------- */

function analyze(file) {
  const { width, height, px } = decodePng(readFileSync(file));
  const total = width * height;
  let nonWhite = 0, red = 0, sum = 0, black = 0;
  const colorCount = new Map();
  const bandRows = 40;
  const bands = new Array(Math.ceil(height / bandRows)).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const lum = (r * 299 + g * 587 + b * 114) / 1000;
      sum += lum;
      if (r === 0 && g === 0 && b === 0) black++;
      if (!(r > 235 && g > 235 && b > 235)) nonWhite++;
      if (r > 150 && g < 110 && b < 110) red++;
      if (x % 8 === 0 && y % 8 === 0) {
        const key = `${r >> 4},${g >> 4},${b >> 4}`;
        colorCount.set(key, (colorCount.get(key) || 0) + 1);
      }
      bands[Math.floor(y / bandRows)] += lum;
    }
  }
  const top = [...colorCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([k, n]) => `#${k.split(",").map((v) => (+v * 17).toString(16).padStart(2, "0")).join("")}(${n})`);
  const dark = bands.map((s, i) => [i * bandRows, s / (width * bandRows)]).filter(([, a]) => a < 200);
  const darkStr = dark.length ? dark.map(([y, a]) => `${y}-${y + bandRows}px:${Math.round(a)}`).join(", ") : "none";
  console.log(`\n=== ${file.split(/[\\/]/).pop()} ===`);
  console.log(`  ${width}x${height} | meanLum=${Math.round(sum / total)} | black=${(100 * black / total).toFixed(1)}% | nonWhite=${(100 * nonWhite / total).toFixed(1)}% | redPx=${red}`);
  console.log(`  top colors: ${top.join("  ")}`);
  console.log(`  dark bands: ${darkStr}`);
}

if (process.argv.includes("--selftest")) {
  console.log("Self-test:");
  const ok = selfTest();
  if (ok) console.log("Analyzing real screenshots:");
  else console.log("Decoder broken — analysis would be meaningless; skipping.");
  if (!ok) process.exit(1);
}

if (process.argv.length > 2) {
  for (const file of process.argv.slice(2)) {
    try { analyze(file); } catch (e) { console.log(`\n=== ${file} === ERROR: ${e.message}`); }
  }
}
