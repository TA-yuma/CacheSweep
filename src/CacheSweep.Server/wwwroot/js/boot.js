"use strict";

/**
 * CacheSweep boot animation (final spec).
 *
 * Real brand icons (browsers, chat, office, gaming) are laid out around the
 * frame and fly toward the centre. They dissolve DURING the flight — the closer
 * they get, the more they break into glowing line fragments and particles — so
 * that each icon is almost fully dissolved BEFORE reaching the centre. At the
 * centre only their outline lines, debris particles and an ember-orange light
 * stream remain. Those lines/particles swirl and intertwine briefly, then
 * reassemble into the CacheSweep line logo. The logo lines hold steady (they
 * never re-dissolve), the name + tagline appear crisply, and the surrounding
 * particles fade out to close cleanly.
 *
 * Timeline (2.3s total):
 *   0.00 – 1.30  fly-in + progressive dissolve
 *   1.15 – 1.75  centre swirl / interweave of line fragments
 *   1.65 – 2.05  reassembly into the CacheSweep logo lines
 *   2.00 – 2.30  title text fades in, particles die down, settle
 */

const BOOT_ICONS = [
  "chrome", "github", "steam", "wechat", "discord", "nvidia", "epicgames",
  "x", "youtube", "firefox", "gitlab", "amd", "intel", "docker", "spotify",
  "netflix", "tiktok", "twitch", "whatsapp", "telegram", "playstation",
  "stackoverflow", "apple", "linux", "alibaba",
];

const BOOT_COLORS = [
  "#ff5c20", "#40e0c8", "#ffd166", "#ef476f", "#5f86ff", "#06d6a0",
  "#ff9770", "#9d4edd", "#4cc9f0", "#f72585", "#7ae582", "#f8f32b",
  "#00b4d8", "#e63946", "#2a9d8f", "#e9c46a",
];

// Phase boundaries (seconds). Total ≈ 2.3s.
// NOTE: T_SWIRL < T_FLY on purpose — the interweave starts to glow in while the
// last icons are still dissolving, so the transition never goes dark.
const T_FLY    = 1.55;  // icons travel in and dissolve en route
const T_SWIRL  = 1.35;  // line fragments begin swirling (overlaps fly-in tail)
const T_ASSEMBLE = 2.10; // reassemble into logo lines
const T_TEXT   = 2.02;  // title text begins appearing
const T_END    = 2.35;  // particles die out
const T_TOTAL  = 2.55;  // overlay lift

function bootAnimation() {
  const overlay = document.getElementById("boot-overlay");
  const canvas = document.getElementById("boot-canvas");
  const brand = overlay?.querySelector(".boot-brand");
  if (!overlay || !canvas) return;

  if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
    brand?.classList.add("boot-brand-show");
    overlay.remove();
    return;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) { overlay.remove(); return; }

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

  // Load real brand icons.
  const icons = BOOT_ICONS.map((name) => {
    const img = new Image();
    img.src = `/assets/appicons/${name}.svg`;
    return img;
  });

  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOut = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

  /* ------------------------------------------------------------------
   * Final logo geometry — pure lines (hexagon frame + sweep arc + core).
   * This is what the fragments reassemble into; it must hold steady.
   * ------------------------------------------------------------------ */
  function logoLines() {
    const R = Math.min(w, h) * 0.30;
    const hex = [];
    for (let i = 0; i <= 60; i++) {
      const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
      hex.push([cx + Math.cos(a) * R, cy + Math.sin(a) * R]);
    }
    const arc = [];
    for (let i = 0; i <= 60; i++) {
      const a = (i / 60) * Math.PI * 2 * 0.85 - Math.PI / 2;
      arc.push([cx + Math.cos(a) * R * 0.62, cy + Math.sin(a) * R * 0.62]);
    }
    const core = [];
    for (let i = 0; i <= 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const rad = R * 0.26 * (0.45 + 0.55 * Math.abs(Math.sin(i * 2.1)));
      core.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
    }
    return { R, hex, arc, core };
  }
  const logo = logoLines();

  /* Flatten every logo line into a list of segments, so particles can map onto
     specific segments — the reassembly draws segment by segment. */
  function collectSegments(pts) {
    const segs = [];
    for (let i = 0; i < pts.length - 1; i++) segs.push([pts[i], pts[i + 1]]);
    return segs;
  }
  const logoSegments = [
    ...collectSegments(logo.hex),
    ...collectSegments(logo.arc),
    ...collectSegments(logo.core),
  ];

  /* ------------------------------------------------------------------
   * Particles: icons laid out around the frame, each with a dissolve profile
   * tied to its distance from the centre.
   * ------------------------------------------------------------------ */
  const COUNT = BOOT_ICONS.length;
  const particles = [];
  for (let i = 0; i < COUNT; i++) {
    // Distributed around the full 360°; the start is just off-screen so the
    // icons genuinely fly in from every direction.
    const dir = (i / COUNT) * Math.PI * 2 - Math.PI / 2 + (Math.random() - 0.5) * 0.25;
    // dist reaches past the screen corner so icons start outside the frame.
    const corner = Math.hypot(w, h) * 0.55;
    const dist = corner + Math.random() * Math.max(w, h) * 0.12;
    particles.push({
      iconIdx: i,
      color: BOOT_COLORS[i % BOOT_COLORS.length],
      from: [cx + Math.cos(dir) * dist, cy + Math.sin(dir) * dist],
      dir,
      // varied flight speed: some dash in, some drift in slowly
      speed: 0.7 + Math.random() * 0.6,
      delay: Math.random() * 0.15,
    });
  }

  // Debris: small glowing fragments spawned from dissolving icons.
  let debris = [];

  // Trail positions for ribbons.
  const trails = particles.map(() => [0, 0]);

  let start = performance.now();
  let fadeStarted = false;
  let raf = 0;
  let titleShown = false;

  function beginFade() {
    if (fadeStarted) return;
    fadeStarted = true;
    overlay.classList.add("boot-fade");
    brand?.classList.add("boot-brand-hide");
    setTimeout(() => overlay.remove(), 450);
  }

  function strokeSegmented(pts, color, width, alpha, upto) {
    const n = Math.max(1, Math.floor(upto * pts.length));
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.globalAlpha = alpha;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let k = 0; k < n; k++) {
      if (k === 0) ctx.moveTo(pts[k][0], pts[k][1]);
      else ctx.lineTo(pts[k][0], pts[k][1]);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** Draws one real icon with a dissolve shatter effect. dissolve 0=solid, 1=gone. */
  function drawDissolvingIcon(p, x, y, s, dissolve, rotate) {
    const img = icons[p.iconIdx];
    const alpha = 1 - dissolve;
    if (alpha <= 0.01) return;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotate);

    // shatter: as dissolve rises, the chip is clipped into ragged slices
    const slices = 1 + Math.floor(dissolve * 3);
    for (let sl = 0; sl < slices; sl++) {
      const frac = 1 / slices;
      const y0 = -s / 2 + sl * s * frac;
      const y1 = y0 + s * frac;
      ctx.globalAlpha = alpha * (0.6 + 0.4 * (1 - sl / slices));
      // slight horizontal offset per slice to suggest breakage
      const off = (sl / (slices - 1 || 1) - 0.5) * dissolve * s * 0.4;
      ctx.save();
      ctx.translate(off, 0);
      if (sl === 0) {
        // top slice keeps the glossy highlight
        ctx.fillStyle = p.color;
        ctx.fillRect(-s / 2, y0, s, y1 - y0);
        ctx.fillStyle = "rgba(255,255,255,0.25)";
        ctx.fillRect(-s / 2, y0, s, (y1 - y0) * 0.5);
      } else {
        ctx.fillStyle = p.color;
        ctx.fillRect(-s / 2, y0, s, y1 - y0);
      }
      ctx.restore();
    }

    // the white brand glyph, fading faster than the chip
    if (img.complete && img.naturalWidth > 0 && alpha > 0.3) {
      ctx.globalAlpha = Math.max(0, alpha - 0.3);
      ctx.drawImage(img, -s * 0.36, -s * 0.36, s * 0.72, s * 0.72);
    }
    ctx.restore();
  }

  function frame(now) {
    const t = (now - start) / 1000;
    ctx.clearRect(0, 0, w, h);

    /* ============ Phase A: fly-in + dissolve en route (0 .. T_FLY) ============ */
    if (t <= T_FLY) {
      const phase = t / T_FLY; // 0..1
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        // Per-particle progress: staggered delay + individual speed so icons don't
        // move as one rigid block — some dash, some drift.
        const prog = clamp01((t - p.delay) / (T_FLY * 0.92 / p.speed));
        const e = easeOutCubic(prog);

        // position: ease toward centre with a mild deceleration near the end
        const x = p.from[0] + (cx - p.from[0]) * e;
        const y = p.from[1] + (cy - p.from[1]) * e;

        // Dissolve rises with closeness to the centre: a slow start, then a fast
        // breakdown so the icon is nearly gone BEFORE it reaches the centre.
        const distToCentre = Math.hypot(x - cx, y - cy) / Math.max(Math.hypot(p.from[0] - cx, p.from[1] - cy), 1);
        const closeness = 1 - distToCentre;      // 0 far .. 1 at centre
        // start dissolving earlier (closeness 0.25) and take a wider band so the
        // icons visibly crumble over the last stretch of flight.
        const dissolve = clamp01((closeness - 0.25) / 0.75);

        const s = 30 + 8 * Math.abs(Math.sin(i * 1.3)); // size variety

        // colour ribbon trail (soft, fading)
        const tx = trails[i][0] || x, ty = trails[i][1] || y;
        if (e > 0.02 && e < 0.95 && dissolve < 0.85) {
          const grad = ctx.createLinearGradient(tx, ty, x, y);
          grad.addColorStop(0, p.color + "00");
          grad.addColorStop(1, p.color + "99");
          ctx.strokeStyle = grad;
          ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();
        }

        drawDissolvingIcon(p, x, y, s, dissolve, (1 - e) * 0.6);

        // spawn debris particles as it dissolves
        if (dissolve > 0.25 && Math.random() < 0.5) {
          debris.push({
            x, y,
            vx: (Math.random() - 0.5) * 60,
            vy: (Math.random() - 0.5) * 60,
            life: 0.5 + Math.random() * 0.4,
            age: 0,
            color: p.color,
            size: 1 + Math.random() * 2,
          });
        }

        trails[i][0] = x; trails[i][1] = y;
      }
    }

    /* ============ Phase B: swirl & interweave (T_SWIRL .. T_ASSEMBLE) ============ */
    // Line fragments (from dissolved icons) orbit and spiral toward the logo.
    const m = clamp01((t - T_FLY) / (T_ASSEMBLE - T_FLY));
    const inSwirl = t > T_SWIRL;

    // ember-orange light stream at the core (grows through the flight, peaks
    // during the interweave, then lets the logo lines take over).
    if (inSwirl) {
      const coreGlow = Math.sin(m * Math.PI); // 0 → peak → 0 across the phase
      ctx.globalAlpha = coreGlow * 0.55;
      const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, logo.R * 0.85);
      gr.addColorStop(0, "rgba(255,92,32,0.6)");
      gr.addColorStop(1, "rgba(255,92,32,0)");
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(cx, cy, logo.R * 0.85, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Swirling line fragments: longer arcs that spin and contract toward the
    // centre, giving the "rotate & interweave" beat before assembly.
    if (inSwirl) {
      const fragCount = 46;
      for (let i = 0; i < fragCount; i++) {
        const a = (i / fragCount) * Math.PI * 2 + t * 2.4;
        const rad = logo.R * (1.05 - m * 0.7);
        const fx = cx + Math.cos(a) * rad;
        const fy = cy + Math.sin(a) * rad;
        const arcR = 8 + 14 * (1 - m);
        ctx.strokeStyle = BOOT_COLORS[i % BOOT_COLORS.length];
        // brighter, reaching peak mid-swirl then yielding to the line assembly
        ctx.globalAlpha = 0.25 + 0.55 * Math.sin(m * Math.PI);
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(fx, fy, arcR, a, a + 1.9);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // The logo lines reassemble progressively during this phase.
    if (t > T_SWIRL) {
      const asm = clamp01((t - T_SWIRL) / (T_ASSEMBLE - T_SWIRL));
      strokeSegmented(logo.hex, "#ff5c20", 1.8, asm, asm);
      strokeSegmented(logo.arc, "#40e0c8", 1.6, asm, asm);
      strokeSegmented(logo.core, "#ffd166", 1.5, asm, asm);
    }

    /* ============ Phase C: logo steady + specular + text (T_ASSEMBLE .. T_END) ============ */
    if (t >= T_ASSEMBLE) {
      // full line logo, held steady
      strokeSegmented(logo.hex, "#ff5c20", 1.8, 0.95, 1);
      strokeSegmented(logo.arc, "#40e0c8", 1.6, 0.9, 1);
      strokeSegmented(logo.core, "#ffd166", 1.5, 0.9, 1);

      // specular highlight sweeping the hexagon
      const sweep = ((t - T_ASSEMBLE) * 1.6) % 1;
      const idx = Math.floor(sweep * logo.hex.length);
      const hx = logo.hex[idx % logo.hex.length][0];
      const hy = logo.hex[idx % logo.hex.length][1];
      const glow = ctx.createRadialGradient(hx, hy, 0, hx, hy, 14);
      glow.addColorStop(0, "rgba(255,255,255,0.9)");
      glow.addColorStop(0.5, "rgba(255,255,255,0.35)");
      glow.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(hx, hy, 14, 0, Math.PI * 2); ctx.fill();

      // title appears once, steady
      if (t >= T_TEXT && !titleShown) {
        titleShown = true;
        brand?.classList.add("boot-brand-show");
      }
    }

    /* ============ Debris update & render (always) ============ */
    for (let i = debris.length - 1; i >= 0; i--) {
      const d = debris[i];
      d.age += 1 / 60;
      if (d.age >= d.life) { debris.splice(i, 1); continue; }
      d.x += d.vx / 60; d.y += d.vy / 60;
      d.vx *= 0.96; d.vy *= 0.96;
      const a = Math.max(0, 1 - d.age / d.life);
      ctx.fillStyle = d.color;
      ctx.globalAlpha = a * 0.8;
      ctx.fillRect(d.x, d.y, d.size, d.size);
      ctx.globalAlpha = 1;
    }

    /* ============ Finish ============ */
    if (t >= T_TOTAL) beginFade();
    else raf = requestAnimationFrame(frame);
  }

  raf = requestAnimationFrame(frame);
  setTimeout(() => { if (!fadeStarted) beginFade(); }, (T_TOTAL + 0.5) * 1000);
  document.addEventListener("visibilitychange", () => { if (document.hidden) beginFade(); });
}

if (document.getElementById("boot-overlay")) {
  bootAnimation();
}