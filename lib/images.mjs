// Billedoptimering: skalering + WebP med JPEG-fallback. Resultater caches i .cache/images.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

export async function processImage(srcFile, { outDir, cacheDir, widths, quality }) {
  const buf = fs.readFileSync(srcFile);
  const hash = crypto.createHash('sha1').update(buf).update(JSON.stringify({ widths, quality })).digest('hex').slice(0, 10);
  const base = path.basename(srcFile).replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const stem = `${base}-${hash}`;
  const metaFile = path.join(cacheDir, `${stem}.json`);

  let meta;
  if (fs.existsSync(metaFile)) {
    meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    if (!meta.variants.every((v) => fs.existsSync(path.join(cacheDir, v.webp)) && fs.existsSync(path.join(cacheDir, v.jpg)))) meta = null;
  }
  if (!meta) {
    fs.mkdirSync(cacheDir, { recursive: true });
    const img = sharp(buf, { failOn: 'none' }).rotate();
    const info = await img.metadata();
    // EXIF-rotation kan bytte om på bredde/højde.
    const swap = info.orientation && info.orientation >= 5;
    const srcW = swap ? info.height : info.width;
    const srcH = swap ? info.width : info.height;
    const targets = [...new Set(widths.map((w) => Math.min(w, srcW)))].sort((a, b) => a - b);
    const variants = [];
    for (const w of targets) {
      const h = Math.round((srcH * w) / srcW);
      const webp = `${stem}-${w}.webp`;
      const jpg = `${stem}-${w}.jpg`;
      const pipeline = sharp(buf, { failOn: 'none' }).rotate().resize({ width: w, withoutEnlargement: true });
      await pipeline.clone().webp({ quality }).toFile(path.join(cacheDir, webp));
      await pipeline.clone().flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toFile(path.join(cacheDir, jpg));
      variants.push({ w, h, webp, jpg });
    }
    meta = { variants };
    fs.writeFileSync(metaFile, JSON.stringify(meta));
  }
  fs.mkdirSync(outDir, { recursive: true });
  for (const v of meta.variants) {
    for (const f of [v.webp, v.jpg]) fs.copyFileSync(path.join(cacheDir, f), path.join(outDir, f));
  }
  return meta;
}

// Ikoner til manifest, iOS og favicon.
export async function buildIcons(iconSrc, outDir, bg) {
  fs.mkdirSync(outDir, { recursive: true });
  const src = fs.readFileSync(iconSrc);
  const isSvg = /\.svg$/i.test(iconSrc);
  const input = () => sharp(src, isSvg ? { density: 384 } : {});
  await input().resize(192, 192).png().toFile(path.join(outDir, 'icon-192.png'));
  await input().resize(512, 512).png().toFile(path.join(outDir, 'icon-512.png'));
  // Maskable: motivet skal ligge i den sikre zone (80 %), så vi lægger 10 % margin på hver side.
  const inner = await input().resize(410, 410).png().toBuffer();
  await sharp({ create: { width: 512, height: 512, channels: 4, background: bg } })
    .composite([{ input: inner, gravity: 'center' }]).png().toFile(path.join(outDir, 'icon-maskable-512.png'));
  // iOS ignorerer gennemsigtighed – flad baggrund.
  await input().resize(180, 180).flatten({ background: bg }).png().toFile(path.join(outDir, 'apple-touch-icon.png'));
  await input().resize(32, 32).png().toFile(path.join(outDir, 'favicon-32.png'));
  if (isSvg) fs.copyFileSync(iconSrc, path.join(outDir, 'favicon.svg'));
  return isSvg;
}
