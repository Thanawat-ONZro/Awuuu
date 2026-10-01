// Draws Awuuu the Dog into the PNG/ICO set Tauri needs. No dependencies: the icons are
// rasterised here and encoded with node:zlib, so the app icon stays "drawn in
// code" like the character itself.
//
//   node scripts/gen-icons.mjs

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "icons");

// ── Awuuu the Dog ─────────────────────────────────────────────────────────────

const BASE_TOP = [255, 250, 245]; // #FFFAF5
const BASE_BOTTOM = [221, 204, 191]; // #DDCCBF
const INK = [26, 20, 18]; // #1A1412
const INNER_EAR = [255, 175, 188]; // Soft puppy pink
const BROW_COLOR = [215, 185, 155]; // Tan shiba brow
const TONGUE_COLOR = [255, 112, 143]; // Playful pink
const RIM = [0, 0, 0];

const SS = 4; // supersampling factor

/** Superellipse (exponent 2.7) test in body-local coordinates. */
function insideBody(x, y, rx, ry) {
  const n = 2.7;
  return Math.pow(Math.abs(x / rx), n) + Math.pow(Math.abs(y / ry), n) <= 1;
}

function insidePill(x, y, w, h) {
  const hw = w / 2;
  const hh = h / 2;
  const r = Math.min(hw, hh);
  const cx = Math.max(-hw + r, Math.min(hw - r, x));
  const cy = Math.max(-hh + r, Math.min(hh - r, y));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function insideTriangle(px, py, x1, y1, x2, y2, x3, y3) {
  const d1 = (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2);
  const d2 = (px - x3) * (y2 - y3) - (x2 - x3) * (py - y3);
  const d3 = (px - x1) * (y3 - y1) - (x3 - x1) * (py - y1);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function renderAwuuu(size) {
  const px = new Uint8Array(size * size * 4);
  const R = size * 0.32;
  const rx = R * 1.14;
  const ry = R * 0.88;
  const cx = size / 2;
  const cy = size / 2 + R * 0.12; // shifted slightly down to fit ears
  const rim = R * 0.055;

  // Eyes geometry
  const eyeYaw = 0.37;
  const eyePitch = -0.12;
  const cp = Math.cos(eyePitch);
  const ex = Math.sin(eyeYaw) * cp * rx;
  const ey = -Math.sin(eyePitch) * ry;
  const fx = Math.max(0.18, Math.cos(eyeYaw));
  const fy = Math.max(0.18, cp);
  const ew = R * 0.25 * fx;
  const eh = R * 0.27 * fy;

  // Ears geometry
  const earW = rx * 0.44;
  const earH = ry * 0.72;

  // Snout & nose geometry
  const noseY = ry * 0.24;
  const noseW = R * 0.20;
  const noseH = R * 0.12;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bodyHits = 0;
      let rimHits = 0;
      let earHits = 0;
      let earRimHits = 0;
      let innerEarHits = 0;
      let eyeHits = 0;
      let browHits = 0;
      let noseHits = 0;
      let tongueHits = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px0 = x + (sx + 0.5) / SS - cx;
          const py0 = y + (sy + 0.5) / SS - cy;

          // Dog ears: left and right
          for (const sd of [-1, 1]) {
            const bx = sd * rx * 0.58;
            const by = -ry * 0.70;
            const tx = sd * rx * 0.72;
            const ty = -ry * 0.70 - earH;
            const mx = sd * rx * 0.28;
            const my = -ry * 0.72;

            if (insideTriangle(px0, py0, bx - sd * rim, by, tx, ty - rim, mx, my)) {
              earRimHits++;
              if (insideTriangle(px0, py0, bx, by, tx, ty, mx, my)) {
                earHits++;
                // Inner ear (smaller triangle inside)
                const inTx = tx - sd * (tx - bx) * 0.15;
                const inTy = ty + earH * 0.2;
                const inBx = bx - sd * (bx - mx) * 0.15;
                const inBy = by - earH * 0.05;
                const inMx = mx + sd * (bx - mx) * 0.15;
                const inMy = my - earH * 0.05;
                if (insideTriangle(px0, py0, inBx, inBy, inTx, inTy, inMx, inMy)) {
                  innerEarHits++;
                }
              }
            }
          }

          // Body
          const inBodyRim = insideBody(px0, py0, rx + rim, ry + rim);
          if (inBodyRim) {
            rimHits++;
            if (insideBody(px0, py0, rx, ry)) {
              bodyHits++;

              // Eyes
              if (
                insidePill(px0 + ex, py0 - ey, ew, eh) ||
                insidePill(px0 - ex, py0 - ey, ew, eh)
              ) {
                eyeHits++;
              }

              // Shiba eyebrow spots above eyes
              const browDistL = Math.hypot(px0 + ex * 1.05, py0 - ey - eh * 0.95);
              const browDistR = Math.hypot(px0 - ex * 1.05, py0 - ey - eh * 0.95);
              if (browDistL < ew * 0.42 || browDistR < ew * 0.42) {
                browHits++;
              }

              // Dog Nose (inverted triangle)
              if (
                insideTriangle(
                  px0, py0,
                  -noseW / 2, noseY - noseH / 2,
                  noseW / 2, noseY - noseH / 2,
                  0, noseY + noseH / 2
                )
              ) {
                noseHits++;
              }

              // Cute panting tongue (blep)
              const tongueX = px0 - R * 0.04;
              const tongueY = py0 - (noseY + noseH * 0.9);
              if (insidePill(tongueX, tongueY, R * 0.11, R * 0.16) && tongueY > 0) {
                tongueHits++;
              }
            }
          }
        }
      }

      const total = SS * SS;
      const totalRimHits = Math.max(rimHits, earRimHits);
      if (totalRimHits === 0) continue;

      const rimA = totalRimHits / total;
      const bodyA = Math.max(bodyHits, earHits) / total;
      const earA = earHits / total;
      const innerEarA = innerEarHits / total;
      const eyeA = eyeHits / total;
      const browA = browHits / total;
      const noseA = noseHits / total;
      const tongueA = tongueHits / total;

      const t = Math.min(1, Math.max(0, ((x - cx) * -0.6 + (y - cy) * 0.8) / (2 * ry) + 0.5));
      const body = [0, 1, 2].map((i) => BASE_TOP[i] + (BASE_BOTTOM[i] - BASE_TOP[i]) * t);

      let col = RIM.slice();
      let alpha = rimA;

      if (bodyA > 0) {
        col = col.map((c, i) => c * (1 - bodyA / rimA) + body[i] * (bodyA / rimA));
        alpha = rimA;
      }
      if (innerEarA > 0) {
        col = col.map((c, i) => c * (1 - innerEarA) + INNER_EAR[i] * innerEarA);
      }
      if (browA > 0) {
        col = col.map((c, i) => c * (1 - browA) + BROW_COLOR[i] * browA);
      }
      if (tongueA > 0) {
        col = col.map((c, i) => c * (1 - tongueA) + TONGUE_COLOR[i] * tongueA);
      }
      if (eyeA > 0 || noseA > 0) {
        const darkA = Math.max(eyeA, noseA);
        col = col.map((c, i) => c * (1 - darkA) + INK[i] * darkA);
      }

      const o = (y * size + x) * 4;
      px[o] = Math.round(col[0]);
      px[o + 1] = Math.round(col[1]);
      px[o + 2] = Math.round(col[2]);
      px[o + 3] = Math.round(Math.min(1, alpha) * 255);
    }
  }
  return px;
}

// ── PNG ───────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── ICO (PNG-in-ICO, Vista and later) ─────────────────────────────────────────

function encodeICO(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = header.length + dir.length;
  entries.forEach((e, i) => {
    const o = i * 16;
    dir[o] = e.size >= 256 ? 0 : e.size;
    dir[o + 1] = e.size >= 256 ? 0 : e.size;
    dir[o + 2] = 0;
    dir[o + 3] = 0;
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(e.png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

// ── Go ────────────────────────────────────────────────────────────────────────

mkdirSync(OUT, { recursive: true });

const png = (size) => encodePNG(size, renderAwuuu(size));

const files = {
  "32x32.png": png(32),
  "128x128.png": png(128),
  "128x128@2x.png": png(256),
  "icon.png": png(512),
};
for (const [name, data] of Object.entries(files)) {
  writeFileSync(join(OUT, name), data);
  console.log(`${name} — ${data.length} bytes`);
}

const ico = encodeICO([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: png(size) })));
writeFileSync(join(OUT, "icon.ico"), ico);
console.log(`icon.ico — ${ico.length} bytes`);
