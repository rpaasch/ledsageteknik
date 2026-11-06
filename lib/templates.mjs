// HTML-skabeloner. Alle stier er relative til den aktuelle side (prefix "root").

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function layout({ cfg, root, title, description, breadcrumbs, body, pager, isHome, extraBodyClass = '' }) {
  const s = cfg.pages;
  return `<!doctype html>
<html lang="da">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
${description ? `<meta name="description" content="${esc(description)}">\n` : ''}<meta name="theme-color" content="${esc(cfg.themeColor)}">
<meta name="color-scheme" content="light dark">
<link rel="manifest" href="${root}manifest.webmanifest">
<link rel="icon" href="${root}icons/favicon-32.png" sizes="32x32" type="image/png">
${cfg._hasSvgIcon ? `<link rel="icon" href="${root}icons/favicon.svg" type="image/svg+xml">\n` : ''}<link rel="apple-touch-icon" href="${root}icons/apple-touch-icon.png">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="${esc(cfg.shortName)}">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="format-detection" content="telephone=no">
<link rel="stylesheet" href="${root}assets/style.css">
<script src="${root}assets/app.js" defer></script>
</head>
<body data-root="${root}"${cfg._dev ? ' data-dev="1"' : ''}${extraBodyClass ? ` class="${extraBodyClass}"` : ''}>
<a class="skip-link" href="#indhold">Spring til indhold</a>
<header class="site-header">
  <div class="wrap header-inner">
    ${isHome
      ? `<p class="brand"><a href="${root}" aria-current="page">${esc(cfg.appName)}</a></p>`
      : `<p class="brand"><a href="${root}">${esc(cfg.appName)}<span class="visually-hidden">, forside</span></a></p>`}
    <nav class="shortcuts" aria-label="Genveje">
      <ul>
        <li><a href="${root}${s.search.slug}/">${esc(s.search.title)}</a></li>
        <li><a href="${root}${s.install.slug}/">${esc(s.install.title)}</a></li>
      </ul>
    </nav>
  </div>
</header>
${breadcrumbs || ''}
<main id="indhold" tabindex="-1">
  <div class="wrap">
${body}
  </div>
</main>
${pager || ''}
<footer class="site-footer">
  <div class="wrap">
    ${cfg.footer.colophon ? `<p>${cfg._inline(cfg.footer.colophon)}</p>` : ''}
    ${cfg.footer.publisher ? `<p>${cfg._inline(cfg.footer.publisher)}</p>` : ''}
    <p class="version">Version ${esc(cfg.version)}</p>
  </div>
</footer>
<div class="toast" id="app-status" role="status" aria-live="polite"></div>
</body>
</html>
`;
}

export function breadcrumbsHtml(trail, root, rel) {
  // trail: [{title, url}] fra forside til og med den aktuelle side.
  if (trail.length < 2) return '';
  const items = trail.map((t, i) => {
    const last = i === trail.length - 1;
    return last
      ? `<li><a href="./" aria-current="page">${esc(t.title)}</a></li>`
      : `<li><a href="${rel(t.url)}">${esc(t.title)}</a></li>`;
  });
  const parent = trail[trail.length - 2];
  return `<nav class="breadcrumbs" aria-label="Brødkrummer">
  <div class="wrap">
    <a class="back-link" href="${rel(parent.url)}"><span aria-hidden="true">‹ </span>Tilbage<span class="visually-hidden"> til ${esc(parent.title)}</span></a>
    <ol>
      ${items.join('\n      ')}
    </ol>
  </div>
</nav>`;
}

export function pagerHtml(prev, next, rel) {
  if (!prev && !next) return '';
  return `<nav class="pager" aria-label="Forrige og næste side">
  <div class="wrap">
    <ul>
      ${prev ? `<li class="pager-prev"><a href="${rel(prev.url)}" rel="prev"><span class="pager-label">Forrige<span class="visually-hidden"> side</span>:</span> <span class="pager-title">${esc(prev.menuTitle)}</span></a></li>` : ''}
      ${next ? `<li class="pager-next"><a href="${rel(next.url)}" rel="next"><span class="pager-label">Næste<span class="visually-hidden"> side</span>:</span> <span class="pager-title">${esc(next.menuTitle)}</span></a></li>` : ''}
    </ul>
  </div>
</nav>`;
}

export function childMenuHtml(node, children, style, rel, headingText) {
  if (!children.length) return '';
  const id = 'menu-overskrift';
  const items = children.map((c) => `    <li>
      <a href="${rel(c.url)}">${esc(c.menuTitle)}</a>${c.description ? `\n      <p>${esc(c.description)}</p>` : ''}
    </li>`).join('\n');
  return `<section class="child-menu" aria-labelledby="${id}">
  <h2 id="${id}">${esc(headingText)}</h2>
  <nav aria-labelledby="${id}">
  <ul class="menu menu--${style === 'list' ? 'list' : 'tiles'}">
${items}
  </ul>
  </nav>
</section>`;
}

export function searchBody(cfg) {
  return `<h1>${esc(cfg.pages.search.title)}</h1>
<form class="search-form" role="search" action="./" method="get" id="search-form" hidden>
  <label for="q">Søg i titler og tekst</label>
  <div class="search-row">
    <input id="q" name="q" type="search" autocomplete="off" autocapitalize="off" enterkeyhint="search" aria-describedby="search-hint">
    <button type="submit">Søg</button>
  </div>
  <p id="search-hint" class="hint">Resultaterne vises, mens du skriver. Søgningen virker også uden internet.</p>
</form>
<p class="search-status" id="search-status" role="status" aria-live="polite" aria-atomic="true"></p>
<div id="search-results-wrap" hidden>
  <h2 id="search-results-heading">Resultater</h2>
  <ol class="search-results" id="search-results" aria-labelledby="search-results-heading"></ol>
</div>
<noscript><p>Søgningen kræver JavaScript. Du kan finde alle sider via menuen på <a href="../">forsiden</a>.</p></noscript>`;
}

export function installBody(cfg) {
  const name = esc(cfg.appName);
  return `<h1>${esc(cfg.pages.install.title)}</h1>
<p>Du kan lægge ${name} på hjemmeskærmen, så den åbner som en app i sit eget vindue. Når appen har været åbnet én gang med internet, virker alt indhold også uden net – fx ude på en rute.</p>

<div class="install-box" id="install-box">
  <p id="install-status" role="status" aria-live="polite"></p>
  <button type="button" class="button" id="install-button" hidden>Installér ${name}</button>
</div>

<section id="share" class="share" aria-labelledby="share-heading" hidden>
  <h2 id="share-heading">Del appen med en borger</h2>
  <p>Lad borgeren scanne QR-koden med kameraet på sin telefon. Den åbner appens adresse, og derefter følges vejledningen nedenfor.</p>
  <div class="qr" id="qr"></div>
  <p>Adresse: <span class="app-url" id="app-url"></span></p>
  <button type="button" class="button button--secondary" id="copy-url">Kopiér adressen</button>
</section>

<h2 id="iphone">iPhone og iPad</h2>
<ol class="steps">
  <li>Tryk på <strong>Del</strong>. Kan du ikke se den, så tryk først på <strong>Flere</strong> (tre prikker).</li>
  <li>Vælg <strong>Føj til hjemmeskærm</strong>.</li>
  <li>Tryk på <strong>Tilføj</strong>.</li>
</ol>
<p class="hint">Virker i Safari. Del-knappen sidder nederst på iPhone og øverst på iPad. Ligger Føj til hjemmeskærm ikke i listen, så rul ned, eller vælg Vis flere.</p>

<h2 id="android">Android (Chrome)</h2>
<ol class="steps">
  <li>Åbn denne side i <strong>Chrome</strong>.</li>
  <li>Brug knappen <strong>Installér ${name}</strong> ovenfor, hvis den vises. Ellers: åbn menuen <strong>Flere valgmuligheder</strong> (tre prikker øverst til højre).</li>
  <li>Vælg <strong>Installér app</strong> eller <strong>Føj til startskærm</strong>.</li>
  <li>Bekræft med <strong>Installér</strong>. Appen findes nu blandt dine apps og på startskærmen.</li>
</ol>

<h2 id="computer">Computer (Chrome eller Edge)</h2>
<ol class="steps">
  <li>Brug knappen <strong>Installér ${name}</strong> ovenfor, hvis den vises.</li>
  <li>Ellers: vælg installationsikonet i adresselinjen eller menuen <strong>Installér ${name}</strong> / <strong>Apps → Installér dette websted som en app</strong>.</li>
  <li>På Mac med Safari: vælg <strong>Arkiv → Føj til Dock</strong>.</li>
</ol>

<h2 id="offline">Brug uden internet</h2>
<p>Første gang appen åbnes med internet, gemmes alle sider, billeder og søgningen på enheden. Kommer der en ny version, vises beskeden »Ny version klar« med en knap til at genindlæse.</p>`;
}
