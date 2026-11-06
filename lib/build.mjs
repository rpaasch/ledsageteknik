// Bygger content/ til en statisk, installérbar webapp i dist/.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import MarkdownIt from 'markdown-it';
import { readContent, flatten, rel as relSrc } from './content.mjs';
import { processImage, buildIcons } from './images.mjs';
import { esc, layout, breadcrumbsHtml, pagerHtml, childMenuHtml, searchBody, installBody } from './templates.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DECORATIVE = /^(dekorativ|dekorativt)$/i;

export function loadConfig() {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
  const d = {
    appName: 'Min app', shortName: '', description: '', version: '1.0.0', basePath: '/om-teknik/',
    themeColor: '#0b4f8a', backgroundColor: '#ffffff', menu: 'tiles', icon: 'assets/icon.svg',
    footer: {}, pages: {}, images: {},
  };
  const c = { ...d, ...cfg };
  c.shortName = c.shortName || c.appName;
  c.basePath = normalizeBase(c.basePath);
  c.pages = {
    search: { slug: 'soeg', title: 'Søg', ...(cfg.pages?.search || {}) },
    install: { slug: 'installer', title: 'Installér appen', ...(cfg.pages?.install || {}) },
  };
  c.images = { widths: [640, 1280], quality: 78, ...(cfg.images || {}) };
  c.footer = { colophon: '', publisher: '', ...(cfg.footer || {}) };
  return c;
}

export function normalizeBase(p) {
  let b = String(p || '/').trim();
  if (!b.startsWith('/')) b = '/' + b;
  if (!b.endsWith('/')) b += '/';
  return b.replace(/\/{2,}/g, '/');
}

// ---------- Kontrast (WCAG) ----------
function lum(hex) {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// ---------- Hjælpere ----------
function depth(url) {
  return url.split('/').filter(Boolean).length;
}
function relFrom(fromUrl) {
  const up = '../'.repeat(depth(fromUrl));
  return (to) => (up + to) || './';
}
function stripTags(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}
function isExternal(href) {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('/') || href.startsWith('#');
}
function walkFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(f, out);
    else out.push(f);
  }
  return out;
}
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const t = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, t);
    else fs.copyFileSync(s, t);
  }
}

// ---------- Selve buildet ----------
export async function build({ outDir = path.join(ROOT, 'dist'), dev = false, quiet = false } = {}) {
  const warnings = [];
  const warn = (m) => warnings.push(m);
  const cfg = loadConfig();
  cfg._dev = dev;

  // Tjek temafarve mod hvid tekst (header) og hvid baggrund (links).
  if (contrast(cfg.themeColor, '#ffffff') < 4.5) {
    warn(`site.config.json: themeColor ${cfg.themeColor} har kun kontrast ${contrast(cfg.themeColor, '#ffffff').toFixed(2)}:1 mod hvid – mindst 4.5:1 kræves. Vælg en mørkere farve.`);
  }
  if (!['list', 'tiles'].includes(cfg.menu)) warn(`site.config.json: "menu" skal være "list" eller "tiles" (er "${cfg.menu}").`);

  const contentDir = path.join(ROOT, 'content');
  const reserved = [cfg.pages.search.slug, cfg.pages.install.slug, 'assets', 'media', 'icons'];
  const root = readContent(contentDir, warn, reserved);
  const all = flatten(root);

  // Skjulte noder og deres efterkommere vises ikke i menuer/forrige-næste/søgning.
  const isHidden = (n) => { for (let x = n; x; x = x.parent) if (x.hidden) return true; return false; };
  const visible = all.filter((n) => !isHidden(n));
  const byFile = new Map(all.filter((n) => n.srcFile).map((n) => [path.resolve(n.srcFile), n]));

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const mediaDir = path.join(outDir, 'media');
  const iconSrc = path.join(ROOT, cfg.icon);
  if (!fs.existsSync(iconSrc)) throw new Error(`Ikonfilen ${cfg.icon} findes ikke (se "icon" i site.config.json).`);
  cfg._hasSvgIcon = await buildIcons(iconSrc, path.join(outDir, 'icons'), cfg.themeColor);
  const cacheDir = path.join(ROOT, '.cache', 'images');

  const md = new MarkdownIt({ html: true, linkify: false, typographer: false });
  cfg._inline = (s) => md.renderInline(String(s));

  // Pass 1: parse og saml billeder/filer.
  const imageJobs = new Map(); // absolut sti -> promise(meta)
  const fileCopies = new Map(); // absolut sti -> output-navn
  for (const n of all) {
    n.tokens = md.parse(n.body || '', {});
    eachInline(n.tokens, (t) => {
      if (t.type === 'image') {
        const src = t.attrGet('src') || '';
        if (isExternal(src)) return;
        const abs = path.resolve(path.dirname(n.srcFile), decodeURI(src.split(/[?#]/)[0]));
        if (!fs.existsSync(abs)) return;
        if (!imageJobs.has(abs)) {
          imageJobs.set(abs, processImage(abs, { outDir: mediaDir, cacheDir, widths: cfg.images.widths, quality: cfg.images.quality }));
        }
      }
    });
  }
  const imageMeta = new Map();
  for (const [abs, p] of imageJobs) {
    try { imageMeta.set(abs, await p); } catch (e) { warn(`${relSrc(abs)}: billedet kunne ikke behandles (${e.message}).`); }
  }

  // Pass 2: render.
  const searchIndex = [];
  const pageUrls = [];
  const titles = new Map();

  for (const n of all) {
    const rel = relFrom(n.url);
    const ctx = { n, rel, firstImage: true };
    transformTokens(n, ctx);
    const content = md.renderer.render(n.tokens, md.options, {});

    // Titel: "Sidetitel – Sektion – Appnavn"
    const section = n.parent;
    const parts = [n.kind === 'root' ? null : n.title, section && section.kind !== 'root' ? section.title : null, cfg.appName].filter(Boolean);
    const docTitle = parts.join(' – ');
    if (titles.has(docTitle)) warn(`${relSrc(n.srcFile || n.dir)}: sidetitlen "${docTitle}" bruges også af ${titles.get(docTitle)} – titler bør være unikke.`);
    titles.set(docTitle, relSrc(n.srcFile || n.dir));

    const trail = [];
    for (let x = n; x; x = x.parent) trail.unshift({ title: x.kind === 'root' ? 'Forside' : x.menuTitle, url: x.url });

    const children = n.children.filter((c) => !isHidden(c));
    const style = n.data.menu === 'list' || n.data.menu === 'tiles' ? n.data.menu : cfg.menu;
    const menu = childMenuHtml(n, children, style, rel, n.kind === 'root' ? 'Indhold' : `Sider i ${n.title}`);

    let prev = null;
    let next = null;
    const i = visible.indexOf(n);
    if (i !== -1) { prev = visible[i - 1] || null; next = visible[i + 1] || null; }

    const body = `<h1>${esc(n.title)}</h1>\n${content}\n${menu}`;
    const html = layout({
      cfg, root: rel(''), title: docTitle, description: n.description || (n.kind === 'root' ? cfg.description : ''),
      breadcrumbs: breadcrumbsHtml(trail, rel(''), rel), body, pager: pagerHtml(prev, next, rel), isHome: n.kind === 'root',
    });
    writePage(outDir, n.url, html);
    pageUrls.push(n.url);
    if (!isHidden(n)) {
      searchIndex.push({
        t: n.title,
        s: n.kind === 'page' && n.parent.kind !== 'root' ? n.parent.title : '',
        u: n.url,
        x: stripTags(content),
      });
    }
  }

  // Særsider: søgning og installation.
  for (const [key, bodyFn] of [['search', searchBody], ['install', installBody]]) {
    const p = cfg.pages[key];
    const url = p.slug + '/';
    const rel = relFrom(url);
    const html = layout({
      cfg, root: rel(''), title: `${p.title} – ${cfg.appName}`, description: '',
      breadcrumbs: breadcrumbsHtml([{ title: 'Forside', url: '' }, { title: p.title, url }], rel(''), rel),
      body: bodyFn(cfg), pager: '', isHome: false, extraBodyClass: `page-${key}`,
    });
    writePage(outDir, url, html);
    pageUrls.push(url);
  }

  // Kopier vedhæftede filer (fx PDF) som der linkes til.
  for (const [abs, name] of fileCopies) {
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.copyFileSync(abs, path.join(mediaDir, name));
  }

  // Aktiver: CSS (med temafarver), JS.
  const assetsOut = path.join(outDir, 'assets');
  fs.mkdirSync(assetsOut, { recursive: true });
  const css = `:root{--theme:${cfg.themeColor};}\n` + fs.readFileSync(path.join(ROOT, 'assets', 'style.css'), 'utf8');
  fs.writeFileSync(path.join(assetsOut, 'style.css'), css);
  const qr = fs.readFileSync(path.join(ROOT, 'node_modules', 'qrcode-generator', 'qrcode.js'), 'utf8');
  const js = fs.readFileSync(path.join(ROOT, 'assets', 'app.js'), 'utf8');
  fs.writeFileSync(path.join(assetsOut, 'app.js'), `/* qrcode-generator (MIT, Kazuhiko Arase) */\n;(function(){var module, exports;${qr}\nwindow.__qrcode = qrcode;})();\n\n${js}`);

  // Ikoner og manifest.
  const manifest = {
    name: cfg.appName,
    short_name: cfg.shortName,
    description: cfg.description,
    lang: 'da',
    dir: 'ltr',
    id: './',
    start_url: './',
    scope: './',
    display: 'standalone',
    background_color: cfg.backgroundColor,
    theme_color: cfg.themeColor,
    icons: [
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  fs.writeFileSync(path.join(outDir, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(outDir, 'search-index.json'), JSON.stringify(searchIndex));

  // .htaccess til statisk upload.
  fs.copyFileSync(path.join(ROOT, 'assets', 'htaccess'), path.join(outDir, '.htaccess'));

  // Service worker: precache-liste + version ud fra indholdet.
  const files = walkFiles(outDir).filter((f) => !path.basename(f).startsWith('.'));
  const hash = crypto.createHash('sha256');
  for (const f of files.sort()) hash.update(path.relative(outDir, f)).update(fs.readFileSync(f));
  const version = `${cfg.version}-${hash.digest('hex').slice(0, 12)}`;
  const precache = [
    ...pageUrls.map((u) => u || './'),
    'manifest.webmanifest', 'search-index.json', 'assets/style.css', 'assets/app.js',
    ...walkFiles(path.join(outDir, 'icons')).map((f) => 'icons/' + path.basename(f)),
    // Kun mindste WebP-udgave af hvert billede gemmes offline (sw.js falder tilbage til den).
    ...[...imageMeta.values()].map((m) => 'media/' + m.variants[0].webp),
    ...[...fileCopies.values()].map((f) => 'media/' + f),
  ];
  const sw = fs.readFileSync(path.join(ROOT, 'assets', 'sw.js'), 'utf8')
    .replace('__VERSION__', version)
    .replace('__PRECACHE__', JSON.stringify(precache, null, 2));
  fs.writeFileSync(path.join(outDir, 'sw.js'), sw);
  fs.writeFileSync(path.join(outDir, 'build.json'), JSON.stringify({ appName: cfg.appName, version: cfg.version, build: version, basePath: cfg.basePath, builtAt: new Date().toISOString() }, null, 2));

  if (!quiet) report(warnings, outDir, pageUrls.length, imageMeta.size);
  return { warnings, outDir, cfg, version };

  // ---------- indre funktioner med adgang til konteksten ----------
  function transformTokens(n, ctx) {
    const toks = n.tokens;
    let removedH1 = false;
    let lastLevel = 1;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.type === 'heading_open') {
        let level = Number(t.tag.slice(1));
        if (level === 1) {
          if (!removedH1) {
            // Første "# overskrift" bliver sidens <h1> (renderes af skabelonen).
            removedH1 = true;
            toks[i].hidden = toks[i + 1].hidden = toks[i + 2].hidden = true;
            toks[i + 1].children = [];
            toks[i + 1].content = '';
            i += 2;
            continue;
          }
          warn(`${relSrc(n.srcFile)}: mere end én "# overskrift" – de ekstra er gjort til niveau 2. Brug "##".`);
          level = 2;
          t.tag = 'h2';
          toks[i + 2].tag = 'h2';
        }
        if (level > lastLevel + 1) {
          warn(`${relSrc(n.srcFile)}: overskriften "${toks[i + 1].content}" springer fra niveau ${lastLevel} til ${level}.`);
        }
        lastLevel = level;
      }
      // Afsnit der kun indeholder ét billede: intet <p> om billedet (så <figure> er gyldig).
      if (t.type === 'paragraph_open' && toks[i + 1]?.type === 'inline') {
        const kids = toks[i + 1].children.filter((c) => !(c.type === 'text' && !c.content.trim()) && c.type !== 'softbreak');
        if (kids.length === 1 && kids[0].type === 'image') {
          t.hidden = true;
          toks[i + 2].hidden = true;
          kids[0].meta = { ...(kids[0].meta || {}), block: true };
        }
      }
      if (t.type === 'inline') rewriteInline(t, n, ctx);
    }
  }

  function rewriteInline(inline, n, ctx) {
    for (const c of inline.children || []) {
      if (c.type === 'link_open') {
        const href = c.attrGet('href') || '';
        if (!href || isExternal(href)) continue;
        const [p, hashPart] = href.split('#');
        const abs = path.resolve(path.dirname(n.srcFile), decodeURI(p.split('?')[0]));
        if (/\.md$/i.test(p)) {
          const target = byFile.get(abs);
          if (!target) {
            warn(`${relSrc(n.srcFile)}: dødt link til "${href}".`);
            c.attrSet('href', ctx.rel(''));
            continue;
          }
          c.attrSet('href', ctx.rel(target.url) + (hashPart ? '#' + hashPart : ''));
        } else if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
          const buf = fs.readFileSync(abs);
          const h = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8);
          const name = path.basename(abs).replace(/(\.[^.]+)$/, `-${h}$1`).toLowerCase();
          fileCopies.set(abs, name);
          c.attrSet('href', ctx.rel('media/' + name));
        } else {
          warn(`${relSrc(n.srcFile)}: dødt link til "${href}".`);
        }
      } else if (c.type === 'image') {
        renderImageToken(c, n, ctx);
      }
    }
  }

  function renderImageToken(t, n, ctx) {
    const src = t.attrGet('src') || '';
    const alt = (t.children || []).map((x) => x.content).join('').trim();
    const caption = t.attrGet('title');
    const decorative = DECORATIVE.test(alt);
    if (!alt) warn(`${relSrc(n.srcFile)}: billedet "${src}" mangler alt-tekst. Skriv en beskrivelse, eller skriv "dekorativ", hvis billedet er pynt.`);
    let html;
    if (isExternal(src)) {
      html = `<img src="${esc(src)}" alt="${decorative ? '' : esc(alt)}" loading="lazy" decoding="async">`;
    } else {
      const abs = path.resolve(path.dirname(n.srcFile), decodeURI(src.split(/[?#]/)[0]));
      const meta = imageMeta.get(abs);
      if (!meta) {
        if (!fs.existsSync(abs)) warn(`${relSrc(n.srcFile)}: billedfilen "${src}" findes ikke.`);
        html = `<span class="missing-image">[Billede mangler${alt && !decorative ? `: ${esc(alt)}` : ''}]</span>`;
      } else {
        const v = meta.variants;
        const big = v[v.length - 1];
        const sizes = '(min-width: 48rem) 46rem, 100vw';
        const lazy = ctx.firstImage ? '' : ' loading="lazy"';
        ctx.firstImage = false;
        html = `<picture><source type="image/webp" srcset="${v.map((x) => `${ctx.rel('media/' + x.webp)} ${x.w}w`).join(', ')}" sizes="${sizes}">`
          + `<img src="${ctx.rel('media/' + big.jpg)}" srcset="${v.map((x) => `${ctx.rel('media/' + x.jpg)} ${x.w}w`).join(', ')}" sizes="${sizes}" width="${big.w}" height="${big.h}" alt="${decorative ? '' : esc(alt)}"${lazy} decoding="async"></picture>`;
      }
    }
    if (t.meta?.block) {
      html = caption
        ? `<figure>${html}<figcaption>${md.renderInline(caption)}</figcaption></figure>`
        : `<div class="image">${html}</div>`;
    } else if (caption) {
      // Billedtekst kræver at billedet står alene i sit afsnit.
      warn(`${relSrc(n.srcFile)}: billedteksten til "${src}" vises kun, når billedet står alene i et afsnit.`);
    }
    t.type = 'html_inline';
    t.content = html;
    t.children = null;
  }
}

function eachInline(tokens, fn) {
  for (const t of tokens) if (t.type === 'inline') for (const c of t.children || []) fn(c);
}

function writePage(outDir, url, html) {
  const dir = path.join(outDir, url);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
}

function report(warnings, outDir, pages, images) {
  console.log(`\nByggede ${pages} sider og ${images} billeder til ${path.relative(ROOT, outDir)}/`);
  if (warnings.length) {
    console.log(`\n⚠  ${warnings.length} ${warnings.length === 1 ? 'advarsel' : 'advarsler'}:`);
    for (const w of warnings) console.log('  - ' + w);
  } else {
    console.log('Ingen advarsler.');
  }
}

export { ROOT, copyDir };
