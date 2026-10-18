// Rasterize the launcher's geometric layer mark without external build dependencies.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const width = 256,
  scale = 4;
function distance(x, y, a, b) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
}
function pixel(x, y) {
  const cornerX = Math.max(26 - x, x - 230, 0),
    cornerY = Math.max(26 - y, y - 230, 0);
  if (Math.hypot(cornerX, cornerY) > 26) return [0, 0, 0, 0];
  const t = (x + y) / 512;
  const color = [Math.round(87 - 41 * t), Math.round(139 - 61 * t), Math.round(255 - 55 * t), 255];
  const shapes = [
    [
      [62, 147],
      [128, 182],
      [194, 147],
    ],
    [
      [62, 121],
      [128, 156],
      [194, 121],
    ],
    [
      [62, 95],
      [128, 60],
      [194, 95],
      [128, 130],
      [62, 95],
    ],
  ];
  for (const points of shapes)
    for (let i = 1; i < points.length; i++)
      if (distance(x, y, points[i - 1], points[i]) < 5) return [235, 243, 255, 255];
  return color;
}
const rgba = Buffer.alloc((width * 4 + 1) * width);
for (let y = 0; y < width; y++)
  for (let x = 0; x < width; x++) {
    const sums = [0, 0, 0, 0];
    for (let sy = 0; sy < scale; sy++)
      for (let sx = 0; sx < scale; sx++)
        pixel(x + (sx + 0.5) / scale, y + (sy + 0.5) / scale).forEach((v, c) => (sums[c] += v));
    sums.forEach((v, c) => (rgba[y * (width * 4 + 1) + 1 + x * 4 + c] = Math.round(v / scale ** 2)));
  }
function crc(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const label = Buffer.from(type),
    size = Buffer.alloc(4),
    checksum = Buffer.alloc(4);
  size.writeUInt32BE(bytes.length);
  checksum.writeUInt32BE(crc(Buffer.concat([label, bytes])));
  return Buffer.concat([size, label, bytes, checksum]);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(width, 0);
header.writeUInt32BE(width, 4);
header[8] = 8;
header[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header),
  chunk('IDAT', zlib.deflateSync(rgba)),
  chunk('IEND', Buffer.alloc(0)),
]);
const icoHeader = Buffer.alloc(22);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(1, 4);
icoHeader.writeUInt16LE(1, 10);
icoHeader.writeUInt16LE(32, 12);
icoHeader.writeUInt32LE(png.length, 14);
icoHeader.writeUInt32LE(22, 18);
fs.mkdirSync(path.resolve('assets'), { recursive: true });
fs.writeFileSync(path.resolve('assets/icon.png'), png);
fs.writeFileSync(path.resolve('assets/icon.ico'), Buffer.concat([icoHeader, png]));
