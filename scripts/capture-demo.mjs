import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import gifenc from 'gifenc';
const { GIFEncoder, quantize, applyPalette } = gifenc;

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const executablePath = fs.existsSync(EDGE) ? EDGE : CHROME;

const IMG_DIR = path.resolve('docs/img');
fs.mkdirSync(IMG_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });

const shots = [
  { url: 'http://localhost:3000/#/live',     wait: 6000, file: 'live.png' },
  { url: 'http://localhost:3000/#/explorer', wait: 5000, file: 'explorer.png' },
  { url: 'http://localhost:3000/#/lab',      wait: 4000, file: 'lab.png' },
  { url: 'http://localhost:3000/#/engine',  wait: 4000, file: 'engine.png' },
];

const buffers = [];
for (const s of shots) {
  await page.goto(s.url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, s.wait));
  const buf = await page.screenshot({ type: 'png', encoding: 'binary', fullPage: false });
  fs.writeFileSync(path.join(IMG_DIR, s.file), buf);
  buffers.push(buf);
  console.log(`captured ${s.file} (${buf.length} bytes)`);
}

await browser.close();

// Assemble animated GIF: scale each 1280x800 frame to 640x400, ~2.5s per frame.
function scaleRgba(png, targetW) {
  const targetH = Math.round((png.height * targetW) / png.width);
  const out = Buffer.alloc(targetW * targetH * 4);
  for (let y = 0; y < targetH; y++) {
    const sy = Math.min(png.height - 1, Math.floor((y * png.height) / targetH));
    for (let x = 0; x < targetW; x++) {
      const sx = Math.min(png.width - 1, Math.floor((x * png.width) / targetW));
      const si = (sy * png.width + sx) * 4;
      const di = (y * targetW + x) * 4;
      out[di] = png.data[si];
      out[di + 1] = png.data[si + 1];
      out[di + 2] = png.data[si + 2];
      out[di + 3] = 255;
    }
  }
  return { data: out, width: targetW, height: targetH };
}

try {
  const W = 640;
  const frames = buffers.map((b) => scaleRgba(PNG.sync.read(b), W));
  const gif = GIFEncoder();
  for (const f of frames) {
    const palette = quantize(f.data, 256, { format: 'rgb565' });
    const index = applyPalette(f.data, palette, 'rgb565');
    gif.writeFrame(index, f.width, f.height, { palette, delay: 2500 });
  }
  gif.finish();
  const gifBuf = gif.bytes();
  fs.writeFileSync(path.join(IMG_DIR, 'demo.gif'), gifBuf);
  console.log(`demo.gif written (${gifBuf.length} bytes, ${frames.length} frames)`);
} catch (err) {
  console.error('GIF assembly failed:', err);
  process.exitCode = 1;
}

