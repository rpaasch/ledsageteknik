/* Progressiv forbedring: alt indhold virker uden dette script. */
(function () {
  'use strict';
  var body = document.body;
  var root = body.getAttribute('data-root') || './';
  var rootUrl = new URL(root, location.href).href;
  var statusEl = document.getElementById('app-status');
  var clearTimer = null;

  // Meddelelse i den fælles live-region (annonceres af skærmlæsere).
  function announce(nodes, keep) {
    if (!statusEl) return;
    clearTimeout(clearTimer);
    statusEl.textContent = '';
    // Lille pause, så skærmlæsere opfatter ændringen, også ved samme tekst.
    setTimeout(function () {
      (Array.isArray(nodes) ? nodes : [nodes]).forEach(function (n) {
        statusEl.appendChild(typeof n === 'string' ? document.createTextNode(n) : n);
      });
      statusEl.classList.add('is-visible');
      if (!keep) clearTimer = setTimeout(function () { statusEl.textContent = ''; statusEl.classList.remove('is-visible'); }, 8000);
    }, 100);
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }
  if (isStandalone()) document.documentElement.classList.add('standalone');

  // ---------- Service worker ----------
  if (body.hasAttribute('data-dev')) {
    // Under udvikling: ingen offline-cache, men automatisk genindlæsning.
    if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then(function (rs) { rs.forEach(function (r) { r.unregister(); }); });
    if (window.EventSource) {
      var es = new EventSource('/__livereload');
      es.onmessage = function () { location.reload(); };
    }
  } else if ('serviceWorker' in navigator && window.isSecureContext) {
    var reloading = false;
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register(root + 'sw.js').then(function (reg) {
      if (reg.waiting && hadController) offerUpdate(reg.waiting);
      reg.addEventListener('updatefound', function () {
        var nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', function () {
          if (nw.state === 'installed') {
            if (navigator.serviceWorker.controller) offerUpdate(nw);
          } else if (nw.state === 'activated' && !hadController) {
            announce('Appen er gemt på enheden og kan nu bruges uden internet.');
          }
        });
      });
      // Tjek for ny version, når appen kommer i forgrunden igen.
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') reg.update().catch(function () {});
      });
    }).catch(function () {});
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (reloading) location.reload();
    });

    var offerUpdate = function (worker) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'button';
      btn.textContent = 'Genindlæs';
      btn.addEventListener('click', function () {
        reloading = true;
        worker.postMessage({ type: 'SKIP_WAITING' });
      });
      announce(['Ny version klar – ', btn], true);
    };
  }

  // ---------- Installation ----------
  var deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    setupInstallButton();
  });
  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    var b = document.getElementById('install-button');
    if (b) b.hidden = true;
    setInstallStatus('Appen er installeret. Du finder den på hjemmeskærmen eller blandt dine apps.');
  });

  function setInstallStatus(t) {
    var s = document.getElementById('install-status');
    if (s) s.textContent = t;
  }
  function setupInstallButton() {
    var b = document.getElementById('install-button');
    if (!b || !deferredPrompt) return;
    b.hidden = false;
    setInstallStatus('Din browser kan installere appen direkte. Brug knappen herunder.');
    if (b.dataset.bound) return;
    b.dataset.bound = '1';
    b.addEventListener('click', function () {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function (choice) {
        if (choice.outcome !== 'accepted') setInstallStatus('Installationen blev afbrudt. Du kan prøve igen med knappen.');
        deferredPrompt = null;
        if (choice.outcome === 'accepted') b.hidden = true;
      });
    });
  }

  function initInstallPage() {
    if (!document.getElementById('install-box')) return;
    var ua = navigator.userAgent;
    var ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isStandalone()) {
      setInstallStatus('Appen er allerede installeret – du bruger den nu.');
    } else if (ios) {
      var s = document.getElementById('install-status');
      if (s) {
        s.textContent = 'Det ser ud til, at du bruger iPhone eller iPad. ';
        var a = document.createElement('a');
        a.href = '#iphone';
        a.textContent = 'Gå til vejledningen for iPhone og iPad';
        s.appendChild(a);
      }
    } else if (!deferredPrompt) {
      setInstallStatus('Følg vejledningen for din enhed herunder.');
    }
    setupInstallButton();

    // QR-kode og adresse til deling.
    var share = document.getElementById('share');
    if (share && window.__qrcode) {
      try {
        var qr = window.__qrcode(0, 'M');
        qr.addData(rootUrl);
        qr.make();
        var holder = document.getElementById('qr');
        holder.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true });
        var svg = holder.querySelector('svg');
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', 'QR-kode til appens adresse');
        svg.removeAttribute('width');
        svg.removeAttribute('height');
        document.getElementById('app-url').textContent = rootUrl;
        var copy = document.getElementById('copy-url');
        if (navigator.clipboard) {
          copy.addEventListener('click', function () {
            navigator.clipboard.writeText(rootUrl).then(function () { announce('Adressen er kopieret.'); },
              function () { announce('Adressen kunne ikke kopieres.'); });
          });
        } else copy.hidden = true;
        share.hidden = false;
      } catch (e) { /* ingen QR-kode – vejledningen virker stadig */ }
    }
  }

  // ---------- Søgning ----------
  function initSearch() {
    var form = document.getElementById('search-form');
    if (!form) return;
    form.hidden = false;
    var input = document.getElementById('q');
    var status = document.getElementById('search-status');
    var list = document.getElementById('search-results');
    var wrap = document.getElementById('search-results-wrap');
    var index = null;
    var loading = null;
    var timer = null;

    function load() {
      if (!loading) {
        loading = fetch(root + 'search-index.json').then(function (r) { return r.json(); })
          .then(function (d) { index = d; return d; })
          .catch(function () { status.textContent = 'Søgningen kunne ikke indlæses. Brug menuen på forsiden.'; });
      }
      return loading;
    }
    function norm(s) { return (s || '').toLocaleLowerCase('da'); }
    function snippet(text, term) {
      var i = norm(text).indexOf(term);
      if (i < 0) return text.slice(0, 140) + (text.length > 140 ? ' …' : '');
      var start = Math.max(0, i - 60);
      return (start > 0 ? '… ' : '') + text.slice(start, start + 160) + (start + 160 < text.length ? ' …' : '');
    }
    function run(announceEmpty) {
      var q = input.value.trim();
      if (!q) {
        list.innerHTML = '';
        wrap.hidden = true;
        status.textContent = announceEmpty ? 'Skriv et eller flere ord for at søge.' : '';
        return;
      }
      load().then(function () {
        if (!index) return;
        var terms = norm(q).split(/\s+/).filter(Boolean);
        var results = [];
        index.forEach(function (p) {
          var t = norm(p.t);
          var x = norm(p.x);
          var score = 0;
          for (var i = 0; i < terms.length; i++) {
            var inT = t.indexOf(terms[i]) !== -1;
            var inX = x.indexOf(terms[i]) !== -1;
            if (!inT && !inX) return;
            score += (inT ? 10 : 0) + (inX ? 1 : 0);
          }
          results.push({ p: p, score: score });
        });
        results.sort(function (a, b) { return b.score - a.score; });
        list.innerHTML = '';
        results.forEach(function (r) {
          var li = document.createElement('li');
          var a = document.createElement('a');
          a.href = root + r.p.u;
          a.textContent = r.p.t;
          li.appendChild(a);
          if (r.p.s) {
            var sec = document.createElement('span');
            sec.className = 'result-section';
            sec.textContent = ' (' + r.p.s + ')';
            li.appendChild(sec);
          }
          var p = document.createElement('p');
          p.textContent = snippet(r.p.x, terms[0]);
          li.appendChild(p);
          list.appendChild(li);
        });
        wrap.hidden = results.length === 0;
        var n = results.length;
        status.textContent = (n === 0 ? 'Ingen resultater' : n === 1 ? '1 resultat' : n + ' resultater') + ' for »' + q + '«.';
      });
    }

    input.addEventListener('focus', load, { once: true });
    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { run(false); }, 400);
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      clearTimeout(timer);
      try { history.replaceState(null, '', '?q=' + encodeURIComponent(input.value.trim())); } catch (err) { /* ok */ }
      run(true);
    });
    var initial = new URLSearchParams(location.search).get('q');
    if (initial) { input.value = initial; run(false); }
  }

  initInstallPage();
  initSearch();
})();
