// Generates config/presenter/reference.png: a neutral 768x768 placeholder
// (gradient + silhouette). Replace with a real portrait of your presenter.
import fs from "node:fs";
import zlib from "node:zlib";
const W = 768, H = 768;
const rows = [];
for (let y = 0; y < H; y++) {
  const row = Buffer.alloc(1 + W * 3);
  row[0] = 0;
  for (let x = 0; x < W; x++) {
    let r = 28 + Math.floor(20 * (y / H)), g = 32 + Math.floor(24 * (y / H)), b = 44 + Math.floor(36 * (y / H));
    const dx = x - W / 2, dy = y - H * 0.42;
    const head = dx * dx / (150 * 150) + dy * dy / (190 * 190) < 1;
    const bodyY = y - H * 0.66;
    const body = bodyY > 0 && Math.abs(dx) < 260 + bodyY * 0.35 && bodyY < H;
    if (head) { r = 196; g = 164; b = 136; }
    else if (body) { r = 40; g = 42; b = 48; }
    row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b;
  }
  rows.push(row);
}
const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (buf) => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
fs.writeFileSync("config/presenter/reference.png", png);
console.log("wrote config/presenter/reference.png", png.length, "bytes");
