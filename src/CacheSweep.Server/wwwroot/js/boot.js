"use strict";

/**
 * Startup animation, v3.
 *
 * Real app icons (extracted from the player's own installed programs via
 * /api/inventory/apps) fly in from every direction with racing-game depth,
 * slow down as they near the centre, then dissolve into a stream of light
 * that converges on the CacheSweep mark — our own logo, not a generic ring.
 *
 * Three variants are chosen at random on each launch so the intro never
 * feels repeated:
 *   A "spiral"  — icons orbit in from the outside on a tightening spiral
 *   B "strafe"  — icons sweep in on straight lanes at staggered speeds
 *   C "drift"   — icons waft in on a bobbing sine path (gentle)
 */

const BOOT_VARIANTS = ["spiral", "strafe", "drift"];
const BOOT_ARRIVE = 2.6;   // seconds for the swarm to arrive (slower feel)
const BOOT_MORPH = 3.6;    // icons dissolve into light
const BOOT_REVEAL = 4.1;   // the CacheSweep logo reveals itself
const BOOT_TOTAL = 5.0;

/** Fallback fetch helper in case app.js hasn't defined `api` yet. */
function bootFetch(path) {
  return fetch(path).then((r) => r.ok ? r.json() : null).catch(() => null);
}

function bootAnimation() {
  const overlay = document.getElementById("boot-overlay");
  const canvas = document.getElementById("boot-canvas");
  const brand = overlay?.querySelector(".boot-brand");

  if (!overlay || !canvas) return;

  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  if (reduce) { overlay.remove(); return; }

  const ctx = canvas.getContext("2d");
  if (!ctx) { overlay.remove(); return; }

  const variant = BOOT_VARIANTS[Math.floor(Math.random() * BOOT_VARIANTS.length)];
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = 0, h = 0, cx = 0, cy = 0;

  function resize() {
    w = canvas.clientWidth || window.innerWidth;
    h = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = w / 2; cy = h / 2;
  }
  resize();
  window.addEventListener("resize", resize);

  function accent() {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    return raw || "#40e0c8";
  }

  /* ------------------------------------------------------------------
   * Load the real icons: our own logo + the user's installed-app icons.
   * ------------------------------------------------------------------ */
  const logo = new Image();
  logo.src = "/assets/icon-256.png";

  const realIcons = []; // array of {img, name}

  // Our own three fruit marks act as fallbacks and flavour.
  function fruitIcon(src, name) {
    const img = new Image();
    img.src = src;
    realIcons.push({ img, name });
  }
  fruitIcon("/assets/fruit-orange.png", "CacheSweep Orange");
  fruitIcon("/assets/fruit-grape.png", "CacheSweep Grape");
  fruitIcon("/assets/fruit-sugarcane.png", "CacheSweep Cane");

  // Fetch the user's real installed-app icons and load them as images.
  const apiSafe = (typeof api === "function") ? api : (p) => bootFetch(p);
  apiSafe("/api/inventory/apps")
    .then((data) => {
      const apps = (data?.apps || []).filter((a) => a.iconPng);
      for (const a of apps.slice(0, 24)) {
        const img = new Image();
        img.onload = () => {
          if (!realIcons.some((r) => r.img === img)) realIcons.push({ img, name: a.name });
        };
        img.src = `data:image/png;base64,${a.iconPng}`;
      }
    })
    .catch(() => {});

  /* ------------------------------------------------------------------
   * Particles: each one carries a real icon that travels on the chosen
   * motion path from the outside in.
   * ------------------------------------------------------------------ */
  const COUNT = 28;

  function makeParticles() {
    const list = [];
    for (let i = 0; i < COUNT; i++) {
      const z = Math.random();                    // depth
      const angle = (i / COUNT) * Math.PI * 2 + Math.random() * 0.5;
      const a = angle;                            // start angle
      const dist = Math.max(w, h) * (0.75 + Math.random() * 0.4);
      const bobAmp = 20 + Math.random() * 50;     // drift sine amplitude
      const bobFreq = 1.2 + Math.random() * 1.6;
      const phase = Math.random() * Math.PI * 2;

      // Icon is assigned later once images load; store index preference.
      list.push({
        iconIdx: i % Math.max(1, realIcons.length),
        z,
        a,
        dist,
        // start scale (near big, far small)
        startScale: 0.20 + z * 1.9,
        endScale: 1.0,
        delay: Math.random() * 0.55,
        dur: (BOOT_ARRIVE - 0.1) * (0.6 + (1 - z) * 0.7), // far arrive later
        bobAmp, bobFreq, phase,
        spin: (Math.random() - 0.5) * Math.PI,
        variant,
      });
    }
    return list;
  }

  let particles = makeParticles();
  const trails = particles.map(() => [0, 0]);
  let start = performance.now();
  let fadeStarted = false;
  let raf = 0;

  const beginFade = () => {
    if (fadeStarted) return;
    fadeStarted = true;
    overlay.classList.add("boot-fade");
    brand?.classList.add("boot-brand-hide");
    setTimeout(() => overlay.remove(), 500);
  };

  const easeOut = (t) => 1 - Math.pow(1 - t, 5);

  /** Position of particle i at progress p (0..1) for its variant. */
  function pathPoint(p, i, prog) {
    const radial = easeOut(prog);
    const r = p.dist * (1 - radial);          // distance from centre shrinks

    let ang = p.a;
    if (p.variant === "spiral") {
      ang = p.a + radial * Math.PI * 2.2;     // twist as it closes in
    }

    let x = cx + Math.cos(ang) * r;
    let y = cy + Math.sin(ang) * r;

    if (p.variant === "drift") {
      // sine bob perpendicular to the direction of travel
      const perp = ang + Math.PI / 2;
      const bob = Math.sin(prog * p.bobFreq * Math.PI * 2 + p.phase) * p.bobAmp;
      x += Math.cos(perp) * bob;
      y += Math.sin(perp) * bob;
    }

    // strafe has no extra wobble — straight lanes at staggered speeds.
    return [x, y];
  }

  function frame(now) {
    const elapsed = (now - start) / 1000;
    const accentCol = accent();
    ctx.clearRect(0, 0, w, h);

    /* ---- Phase 1: fly in (0 .. BOOT_ARRIVE), slower + depth. ---- */
    if (elapsed <= BOOT_ARRIVE) {
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const prog = Math.max(0, Math.min(1, (elapsed - p.delay * 0.4) / p.dur));
        const [x, y] = pathPoint(p, i, Math.max(0, Math.min(1, prog)));

        // big = near (z high), small = far; grow/shrink by perspective
        const scale = p.startScale + (p.endScale - p.startScale) * easeOut(prog);
        const s = 22 * scale;

        // ribbon trail
        const tx = trails[i][0] || x, ty = trails[i][1] || y;
        if (prog > 0.03 && prog < 0.98) {
          const grad = ctx.createLinearGradient(tx, ty, x, y);
          grad.addColorStop(0, "rgba(150,175,205,0)");
          grad.addColorStop(1, `rgba(200,215,235,${0.10 + p.z * 0.25})`);
          ctx.strokeStyle = grad;
          ctx.lineWidth = 0.8 + p.z * 1.6;
          ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();
        }

        // draw the real icon (or fallback chip), blurred by depth
        drawRealIcon(p, x, y, s, 1);

        trails[i][0] = x;
        trails[i][1] = y;
      }
    }
    /* ---- Phase 2: dissolve (BOOT_ARRIVE .. BOOT_MORPH). ---- */
    else if (elapsed <= BOOT_MORPH) {
      const m = (elapsed - BOOT_ARRIVE) / (BOOT_MORPH - BOOT_ARRIVE);
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const [x, y] = pathPoint(p, i, 1); // settled positions
        const fade = 1 - m;
        if (fade > 0.02) {
          drawRealIcon(p, x, y, 22, fade);
        }
        // emit a light streak toward the centre as it dissolves
        ctx.strokeStyle = `rgba(255,255,255,${0.5 * m})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(cx + (x - cx) * (1 - m * 0.7), cy + (y - cy) * (1 - m * 0.7));
        ctx.stroke();
      }
    }
    /* ---- Phase 3: reveal the CacheSweep logo. ---- */
    else {
      const m = Math.min(1, (elapsed - BOOT_MORPH) / (BOOT_REVEAL - BOOT_MORPH));
      const size = Math.min(w, h) * (0.30 + 0.16 * m);
      const alpha = Math.min(1, m * 1.4);

      // glow bloom behind the logo
      ctx.globalAlpha = 0.4 * (1 - m);
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 1.2);
      grad.addColorStop(0, accentCol);
      grad.addColorStop(1, "transparent");
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(cx, cy, size * 1.2, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;

      // draw our logo, scaling into place
      ctx.globalAlpha = alpha;
      const lw = size * 2;
      ctx.drawImage(logo, cx - lw / 2, cy - lw / 2, lw, lw);
      ctx.globalAlpha = 1;

      if (!brand?.classList.contains("boot-brand-show")) {
        brand?.classList.add("boot-brand-show");
      }

      if (elapsed > BOOT_REVEAL + 0.45) beginFade();
    }

    /* ---- finish ---- */
    if (elapsed < BOOT_TOTAL) raf = requestAnimationFrame(frame);
    else beginFade();
  }

  /** Draws a real (or fallback) icon at x,y with size s and alpha. */
  function drawRealIcon(p, x, y, s, alpha) {
    const icon = realIcons[p.iconIdx % Math.max(1, realIcons.length)];
    const blur = (1 - p.z) * 3.5;

    ctx.save();
    ctx.globalAlpha = alpha;
    if (blur > 0.2) { ctx.shadowColor = "rgba(0,0,0,0.45)"; ctx.shadowBlur = blur; }
    ctx.translate(x, y);
    ctx.rotate(p.spin * (1 - (p._prog || 0)));

    if (icon && icon.img.complete && icon.img.naturalWidth > 0) {
      // real icon, drawn with a rounded veil so it sits in the UI
      ctx.drawImage(icon.img, -s * 0.6, -s * 0.6, s * 1.2, s * 1.2);
    } else {
      // fallback: a chrome chip
      ctx.fillStyle = "rgba(12,16,22,0.92)";
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-s * 0.6, -s * 0.6, s * 1.2, s * 1.2, s * 0.16);
      else ctx.rect(-s * 0.6, -s * 0.6, s * 1.2, s * 1.2);
      ctx.fill();
      ctx.strokeStyle = "rgba(140,160,185,0.28)";
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }
    ctx.restore();
  }

  raf = requestAnimationFrame(frame);
  setTimeout(beginFade, (BOOT_TOTAL + 0.6) * 1000);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) beginFade();
  });
}

if (document.getElementById("boot-overlay")) {
  bootAnimation();
}