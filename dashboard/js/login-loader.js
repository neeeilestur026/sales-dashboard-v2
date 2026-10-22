/* login-loader.js — A359 · the dot-matrix pulse shown after Sign In, while the portal signs you in.
   Neil, 22 Oct 2026, pasted the look as a config (CFG below, verbatim). Linked only by index.html, after auth.js.

   A black screen of round red dots. Rings of light travel out from the middle; on each ring's crest the dots grow,
   warm from red to orange to a white-hot core, and glow. "Signing in" sits in the calm middle.
   LoginLoader.start() on submit, LoginLoader.stop() when sign-in fails — on success it stays up until the next page.
   Reduced motion or "Motion off": one still frame, nothing moves.

   How each key is read here:
     pattern 'pulse'   rings travelling out from the centre
     speed             rings per second
     wave              ring spacing, as a % of the distance from the centre to a corner
     sharp             how thin the crest is: brightness = ((1 + cos) / 2) ^ sharp
     dot, gap          dot diameter and the space between two dots, CSS px
     round             1 = circles, 0 = squares
     minOp             a resting dot's opacity
     grow              how much a dot grows on the crest (0.5 = half as big again)
     color → peak      a dot's colour from rest to `hot`; above `hot` it heats on to hotColor
     glow, glowAmt     the glow's blur (px) and strength; glowFrom = the brightness where the glow starts
     bg, vignette      the backdrop, and how much the corners fade (0–1)
     clear             the calm middle, as a share of half the shorter side, where the label sits
     progress, loop    off: no progress bar; the pulse keeps going until sign-in answers */
(function () {
  const CFG = { pattern: 'pulse', speed: 0.6, wave: 40, sharp: 10, dot: 11.5, gap: 14, round: 1, minOp: 0.14, grow: 0.5,
    color: '#c42a35', peak: '#ff5a3d', glow: 22, glowAmt: 1, glowFrom: 0.25, hot: 0.6, hotColor: '#fff0e6',
    bg: 'black', vignette: 0.6, clear: 0.28, progress: false, loop: false };
  const LEVELS = 64;          // brightness steps; each step's colour and size is worked out once
  const CALM_MIN = 64;        // px — on a phone the calm middle still fits the label
  const GLOW_RES = 0.5;       // the glow is blurred anyway, so it is drawn at half resolution

  const rgb = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  /* The ring's brightness (0–1) at d px from the centre, t seconds in; R = centre to corner. */
  function crest(d, t, R, c) {
    const phase = d / (R * c.wave / 100) - t * c.speed;
    return Math.pow((1 + Math.cos(2 * Math.PI * phase)) / 2, c.sharp);
  }

  /* What does not move: the corners fade (vignette) and the middle stays calm. half = half the shorter side. */
  function mask(d, R, half, c) {
    const calm = Math.max(CALM_MIN, c.clear * half);
    return (1 - c.vignette * smooth(0.35, 1, d / R)) * smooth(calm * 0.55, calm, d);
  }

  /* One dot at brightness i (0–1): colour, opacity, diameter, and how strongly it glows. */
  function shade(i, c) {
    const col = i <= c.hot ? mix(rgb(c.color), rgb(c.peak), i / c.hot) : mix(rgb(c.peak), rgb(c.hotColor), (i - c.hot) / (1 - c.hot));
    return { rgb: col, fill: 'rgb(' + col.join(',') + ')', alpha: c.minOp + (1 - c.minOp) * i, size: c.dot * (1 + c.grow * i),
      glow: i <= c.glowFrom ? 0 : c.glowAmt * (i - c.glowFrom) / (1 - c.glowFrom) };
  }
  const LUT = Array.from({ length: LEVELS + 1 }, (_, k) => shade(k / LEVELS, CFG));
  const GLOW_FILL = 'rgb(' + rgb(CFG.peak).join(',') + ')';
  const STILL_T = 0.6 / CFG.speed;      // the still frame: the first ring well clear of the label

  let el = null, dots = null, glow = null, cx = null, gx = null, label = null, grid = [], raf = 0, t0 = 0, W = 0, H = 0, R = 1;

  function still() {
    let reduced = false;
    try { reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}
    return reduced || document.documentElement.getAttribute('data-motion') === 'off';
  }

  function layout() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    dots.width = Math.round(W * dpr); dots.height = Math.round(H * dpr); cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    glow.width = Math.round(W * GLOW_RES); glow.height = Math.round(H * GLOW_RES); gx.setTransform(GLOW_RES, 0, 0, GLOW_RES, 0, 0);
    const pitch = CFG.dot + CFG.gap, ox = W / 2, oy = H / 2, half = Math.min(ox, oy);
    const nx = Math.ceil(ox / pitch) + 1, ny = Math.ceil(oy / pitch) + 1;
    R = Math.hypot(ox, oy);
    grid = [];
    for (let j = -ny; j <= ny; j++) for (let i = -nx; i <= nx; i++) {
      const d = Math.hypot(i * pitch, j * pitch), m = mask(d, R, half, CFG);
      if (m > 0.01) grid.push({ x: ox + i * pitch, y: oy + j * pitch, d, m });
    }
  }

  function dotPath(g, x, y, s) {
    const r = s / 2;
    g.beginPath();
    if (CFG.round >= 1) g.arc(x, y, r, 0, 2 * Math.PI);
    else if (CFG.round > 0 && g.roundRect) g.roundRect(x - r, y - r, s, s, r * CFG.round);
    else g.rect(x - r, y - r, s, s);
  }

  function frame(t) {
    cx.globalAlpha = 1; cx.fillStyle = CFG.bg; cx.fillRect(0, 0, W, H);
    gx.globalAlpha = 1; gx.clearRect(0, 0, W, H); gx.fillStyle = GLOW_FILL;
    for (let n = 0; n < grid.length; n++) {
      const p = grid[n], s = LUT[Math.round(crest(p.d, t, R, CFG) * LEVELS)];
      cx.globalAlpha = s.alpha * p.m; cx.fillStyle = s.fill; dotPath(cx, p.x, p.y, s.size); cx.fill();
      if (s.glow) { gx.globalAlpha = s.glow * p.m; dotPath(gx, p.x, p.y, s.size * 1.4); gx.fill(); }
    }
  }

  function tick(now) { frame((now - t0) / 1000); raf = requestAnimationFrame(tick); }
  function onResize() { layout(); if (!raf) frame(STILL_T); }

  function start() {
    el = el || document.getElementById('loginLoader');
    if (!el) return;
    dots = el.querySelector('.ll-dots'); glow = el.querySelector('.ll-glow'); label = el.querySelector('.ll-label');
    cx = dots && dots.getContext ? dots.getContext('2d') : null;
    gx = glow && glow.getContext ? glow.getContext('2d') : null;
    el.style.setProperty('--ll-blur', CFG.glow / 2 + 'px');
    el.hidden = false;
    if (label) label.textContent = 'Signing in';
    if (cx && gx) {
      layout();
      cancelAnimationFrame(raf); raf = 0;
      if (still()) frame(STILL_T);
      else { t0 = performance.now(); raf = requestAnimationFrame(tick); }
      window.addEventListener('resize', onResize);
    }
    requestAnimationFrame(() => { if (!el.hidden) el.classList.add('on'); });
  }

  function stop() {
    if (!el) return;
    cancelAnimationFrame(raf); raf = 0;
    window.removeEventListener('resize', onResize);
    el.classList.remove('on');
    el.hidden = true;
    if (label) label.textContent = '';
  }

  // Back to the sign-in page from the next one (back/forward cache): no loader left over.
  window.addEventListener('pageshow', (e) => { if (e.persisted) stop(); });

  window.LoginLoader = { CFG, crest, mask, shade, start, stop };
})();
