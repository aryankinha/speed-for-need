// Generates build/icon.png (1024x1024): ink rounded square, amber chevrons, red base bar.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
const N = 1024, px = Buffer.alloc(N * N * 4);
const inRound = (x, y, r) => { const cx = Math.min(Math.max(x, r), N - 1 - r), cy = Math.min(Math.max(y, r), N - 1 - r); return (x - cx) ** 2 + (y - cy) ** 2 <= r * r; };
const chevron = (x, y, top) => { const d = Math.abs(x - N / 2); const yy = top + d * 0.62; return y >= yy && y < yy + 120 && d < 330; };
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  let c = [0, 0, 0, 0];
  if (inRound(x, y, 200)) {
    c = [14, 16, 19, 255];
    if (chevron(x, y, 230)) c = [252, 175, 23, 255];
    else if (chevron(x, y, 400)) c = [252, 175, 23, 255];
    else if (y > 800 && y < 860 && x > 230 && x < 794) c = [228, 0, 43, 255];
  }
  px.set(c, (y * N + x) * 4);
}
const raw = Buffer.alloc((N * 4 + 1) * N);
for (let y = 0; y < N; y++) { raw[y * (N * 4 + 1)] = 0; px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4); }
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
mkdirSync('build', { recursive: true });
writeFileSync('build/icon.png', Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log('build/icon.png written');
