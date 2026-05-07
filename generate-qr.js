const fs = require("fs");
const path = require("path");

const targetUrl = "https://sbstr.github.io/oshacademy/";
const version = 5;
const size = version * 4 + 17;
const dataCodewords = 108;
const eccCodewords = 26;
const mask = 0;

const modules = Array.from({ length: size }, () => Array(size).fill(false));
const reserved = Array.from({ length: size }, () => Array(size).fill(false));

function setFunctionModule(x, y, isBlack) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  modules[y][x] = Boolean(isBlack);
  reserved[y][x] = true;
}

function drawFinderPattern(x, y) {
  for (let dy = -1; dy <= 7; dy++) {
    for (let dx = -1; dx <= 7; dx++) {
      const xx = x + dx;
      const yy = y + dy;
      const inPattern = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
      const black =
        inPattern &&
        (dx === 0 ||
          dx === 6 ||
          dy === 0 ||
          dy === 6 ||
          (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
      setFunctionModule(xx, yy, black);
    }
  }
}

function drawAlignmentPattern(cx, cy) {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      setFunctionModule(cx + dx, cy + dy, distance !== 1);
    }
  }
}

function getBit(value, bit) {
  return ((value >>> bit) & 1) !== 0;
}

function drawFormatBits() {
  const ecLevelBits = 1; // L
  const data = (ecLevelBits << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) {
    rem = (rem << 1) ^ (((rem >>> 9) & 1) * 0x537);
  }
  const bits = ((data << 10) | rem) ^ 0x5412;

  for (let i = 0; i <= 5; i++) setFunctionModule(8, i, getBit(bits, i));
  setFunctionModule(8, 7, getBit(bits, 6));
  setFunctionModule(8, 8, getBit(bits, 7));
  setFunctionModule(7, 8, getBit(bits, 8));
  for (let i = 9; i < 15; i++) setFunctionModule(14 - i, 8, getBit(bits, i));

  for (let i = 0; i < 8; i++) setFunctionModule(size - 1 - i, 8, getBit(bits, i));
  for (let i = 8; i < 15; i++) setFunctionModule(8, size - 15 + i, getBit(bits, i));
  setFunctionModule(8, size - 8, true);
}

function drawFunctionPatterns() {
  drawFinderPattern(0, 0);
  drawFinderPattern(size - 7, 0);
  drawFinderPattern(0, size - 7);

  for (let i = 8; i <= size - 9; i++) {
    setFunctionModule(6, i, i % 2 === 0);
    setFunctionModule(i, 6, i % 2 === 0);
  }

  drawAlignmentPattern(30, 30);
  drawFormatBits();
}

function createDataCodewords(text) {
  const bytes = Array.from(Buffer.from(text, "utf8"));
  const bits = [];

  function append(value, length) {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  }

  append(0x4, 4);
  append(bytes.length, 8);
  for (const byte of bytes) append(byte, 8);

  const capacityBits = dataCodewords * 8;
  const terminator = Math.min(4, capacityBits - bits.length);
  append(0, terminator);
  while (bits.length % 8 !== 0) bits.push(0);

  const result = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    result.push(byte);
  }

  for (let pad = 0xec; result.length < dataCodewords; pad ^= 0xfd) {
    result.push(pad);
  }
  return result;
}

const exp = Array(512);
const log = Array(256);
let value = 1;
for (let i = 0; i < 255; i++) {
  exp[i] = value;
  log[value] = i;
  value <<= 1;
  if (value & 0x100) value ^= 0x11d;
}
for (let i = 255; i < 512; i++) exp[i] = exp[i - 255];

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return exp[log[a] + log[b]];
}

function polyMultiply(a, b) {
  const result = Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      result[i + j] ^= gfMul(a[i], b[j]);
    }
  }
  return result;
}

function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    poly = polyMultiply(poly, [1, exp[i]]);
  }
  return poly;
}

function rsRemainder(data, degree) {
  const generator = rsGenerator(degree);
  const message = data.concat(Array(degree).fill(0));

  for (let i = 0; i < data.length; i++) {
    const coef = message[i];
    if (coef === 0) continue;
    for (let j = 0; j < generator.length; j++) {
      message[i + j] ^= gfMul(generator[j], coef);
    }
  }
  return message.slice(data.length);
}

function addData(codewords) {
  const bits = [];
  for (const byte of codewords) {
    for (let i = 7; i >= 0; i--) bits.push((byte >>> i) & 1);
  }

  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;

    for (let vert = 0; vert < size; vert++) {
      const y = upward ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        if (reserved[y][x]) continue;
        modules[y][x] = bitIndex < bits.length ? bits[bitIndex] === 1 : false;
        bitIndex++;
      }
    }
  }
}

function maskPattern(x, y) {
  return (x + y) % 2 === 0;
}

function applyMask() {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!reserved[y][x] && maskPattern(x, y)) modules[y][x] = !modules[y][x];
    }
  }
}

function toSvg() {
  const quiet = 4;
  const total = size + quiet * 2;
  const rects = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules[y][x]) rects.push(`<rect x="${x + quiet}" y="${y + quiet}" width="1" height="1"/>`);
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="900" height="900" shape-rendering="crispEdges" role="img" aria-label="QR code for certificate verification page">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <g fill="#000000">
    ${rects.join("\n    ")}
  </g>
</svg>
`;
}

function toHtml() {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>باركود الموقع</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: Tahoma, Arial, sans-serif;
      background: #f6f7f4;
      color: #17211c;
    }
    main {
      width: min(520px, calc(100% - 32px));
      text-align: center;
      padding: 28px;
      background: #ffffff;
      border: 1px solid #d8ddd5;
      border-radius: 8px;
    }
    img {
      width: min(100%, 360px);
      height: auto;
      image-rendering: pixelated;
    }
    a {
      color: #0f766e;
      overflow-wrap: anywhere;
    }
    p {
      color: #5c665f;
    }
  </style>
</head>
<body>
  <main>
    <h1>باركود الموقع</h1>
    <img src="site-qr.svg" alt="QR code">
    <p><a href="${targetUrl}">${targetUrl}</a></p>
  </main>
</body>
</html>
`;
}

drawFunctionPatterns();
const data = createDataCodewords(targetUrl);
if (data.length !== dataCodewords) {
  throw new Error(`Unexpected data length: ${data.length}`);
}
const ecc = rsRemainder(data, eccCodewords);
addData(data.concat(ecc));
applyMask();
drawFormatBits();

fs.writeFileSync(path.join(__dirname, "site-qr.svg"), toSvg(), "utf8");
fs.writeFileSync(path.join(__dirname, "qr.html"), toHtml(), "utf8");
console.log(`Created QR code for ${targetUrl}`);
