// Læser content/-mappen og bygger et træ af sektioner og sider.
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

const PREFIX_RE = /^(\d+)-(.+)$/;

export function parseName(name) {
  const base = name.replace(/\.md$/i, '');
  const m = base.match(PREFIX_RE);
  if (m) return { order: Number(m[1]), prefix: m[1], slug: slugify(m[2]) };
  return { order: Infinity, prefix: null, slug: slugify(base) };
}

export function slugify(s) {
  return s
    .toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function titleFromSlug(slug) {
  const t = slug.replace(/-/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function firstH1(md) {
  // Første ATX-overskrift på niveau 1 uden for kodeblokke.
  let inFence = false;
  for (const line of md.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const m = line.match(/^#\s+(.+?)\s*#*\s*$/);
    if (m) return m[1].trim();
  }
  return null;
}

function readMd(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const parsed = matter(raw);
  return { data: parsed.data || {}, body: parsed.content };
}

function makeNode({ kind, srcFile, dir, name, parent, warn }) {
  const { order, prefix, slug } = parseName(name);
  let data = {};
  let body = '';
  if (srcFile) ({ data, body } = readMd(srcFile));
  const h1 = srcFile ? firstH1(body) : null;
  const title = String(data.title || h1 || titleFromSlug(slug)).trim();
  if (srcFile && !data.title && !h1) {
    warn(`${rel(srcFile)}: ingen titel i front matter og ingen "# overskrift" – bruger filnavnet ("${title}").`);
  }
  return {
    kind, // 'root' | 'section' | 'page'
    name,
    order,
    prefix,
    slug,
    srcFile,
    dir,
    data,
    body,
    title,
    menuTitle: String(data.menu_title || title).trim(),
    description: data.description ? String(data.description).trim() : '',
    hidden: data.hidden === true,
    parent,
    children: [],
    url: '', // rodrelativ, fx "grundteknikker/stokteknik/"
  };
}

let ROOT_DIR = process.cwd();
export function rel(p) {
  return path.relative(ROOT_DIR, p) || '.';
}

export function readContent(contentDir, warn, reservedSlugs = []) {
  ROOT_DIR = path.dirname(contentDir);
  if (!fs.existsSync(contentDir)) throw new Error(`Mappen ${contentDir} findes ikke.`);
  const rootIndex = path.join(contentDir, 'index.md');
  if (!fs.existsSync(rootIndex)) warn('content/index.md mangler – forsiden får en standardtitel.');
  const root = makeNode({
    kind: 'root',
    srcFile: fs.existsSync(rootIndex) ? rootIndex : null,
    dir: contentDir,
    name: '',
    parent: null,
    warn,
  });
  root.url = '';
  walk(root, contentDir, warn, 1, reservedSlugs);
  return root;
}

function walk(node, dir, warn, depth, reservedSlugs) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.') && !e.name.startsWith('_'));
  const prefixes = new Map();
  const slugs = new Map();

  for (const e of entries) {
    const full = path.join(dir, e.name);
    let child = null;
    if (e.isDirectory()) {
      // Mapper uden .md-filer (fx "billeder") er ikke sektioner.
      if (!containsMarkdown(full)) continue;
      const idx = path.join(full, 'index.md');
      child = makeNode({
        kind: 'section',
        srcFile: fs.existsSync(idx) ? idx : null,
        dir: full,
        name: e.name,
        parent: node,
        warn,
      });
      if (!child.srcFile) {
        warn(`${rel(full)}/: ingen index.md – sektionen får titlen "${child.title}" ud fra mappenavnet.`);
      }
    } else if (e.isFile() && /\.md$/i.test(e.name) && e.name.toLowerCase() !== 'index.md') {
      child = makeNode({ kind: 'page', srcFile: full, dir, name: e.name, parent: node, warn });
    }
    if (!child) continue;

    if (child.prefix !== null) {
      const key = Number(child.prefix);
      if (prefixes.has(key)) {
        warn(`${rel(dir)}/: talpræfikset "${child.prefix}" bruges af både "${prefixes.get(key)}" og "${e.name}".`);
      } else prefixes.set(key, e.name);
    } else {
      warn(`${rel(full)}: intet talpræfiks (fx "10-") – placeres sidst i menuen.`);
    }
    if (!child.slug) {
      warn(`${rel(full)}: navnet giver en tom URL – omdøb filen.`);
      continue;
    }
    if (slugs.has(child.slug)) {
      warn(`${rel(full)}: giver samme URL ("${child.slug}") som "${slugs.get(child.slug)}" – kun den første bruges.`);
      continue;
    }
    if (node.kind === 'root' && reservedSlugs.includes(child.slug)) {
      warn(`${rel(full)}: URL'en "${child.slug}/" er reserveret af appen – omdøb filen/mappen.`);
      continue;
    }
    slugs.set(child.slug, e.name);
    child.url = node.url + child.slug + '/';
    node.children.push(child);
  }

  node.children.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'da'));
  for (const c of node.children) {
    if (c.kind === 'section') walk(c, c.dir, warn, depth + 1, reservedSlugs);
  }
}

function containsMarkdown(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    if (e.isFile() && /\.md$/i.test(e.name)) return true;
    if (e.isDirectory() && containsMarkdown(path.join(dir, e.name))) return true;
  }
  return false;
}

// Alle noder i læserækkefølge (dybde-først).
export function flatten(root) {
  const out = [];
  (function rec(n) {
    out.push(n);
    n.children.forEach(rec);
  })(root);
  return out;
}
