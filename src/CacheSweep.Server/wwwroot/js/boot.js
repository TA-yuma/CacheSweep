"use strict";

/**
 * Startup animation: pixel/line particles fly in from every direction and
 * assemble into the CacheSweep mark — a hexagon frame, a sweep ring and a fruit
 * core — before the overlay fades and reveals the app.
 *
 * The mark is drawn as a set of target points. Particles loop forward to their
 * target with a snappy ease, leaving a short trail, then the assembled outline
 * glows once and the overlay lifts. Everything is one accent hue (plus faint
 * white for depth), never a rainbow.
 */

const BOOT_KEYS = {
  // Skip the animation entirely when hidden by default.
  run: true,
};

function bootAnimation() {
  const overlay = document.getElementById("boot-overlay");
  const canvas = document.getElementById("boot-canvas");
  const brand = overlay?.querySelector(".boot-brand");

  if (!overlay || !canvas) return;

  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  if (reduce) {
    overlay.remove();
    return;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    overlay.remove();
    return;
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = 0;
  let h = 0;
  let cx = 0;
  let cy = 0;

  function resize() {
    w = canvas.clientWidth || window.innerWidth;
    h = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = w / 2;
    cy = h / 2;
  }
  resize();
  window.addEventListener("resize", resize);

  // Accent hue from the active theme; falls back to a neutral teal.
  function accent() {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue("--accent")
      .trim();
    return raw || "#40e0c8";
  }

  // The mark's geometry, scaled to the smaller viewport dimension.
  function buildTargets() {
    const R = Math.min(w, h) * 0.24;
    const r = R * 0.62;
    const coreR = R * 0.2;
    const pts = [];

    // Hexagon frame.
    const hexSides = 6;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2 - Math.PI / 2;
      // Sample along each side to distribute points evenly around the polygon.
      const seg = (i / 48) * hexSides;
      const segIndex = Math.floor(seg);
      const tseg = seg - segIndex;
      const a0 = ((segIndex / hexSides) * Math.PI * 2) - Math.PI / 2;
      const a1 = (((segIndex + 1) / hexSides) * Math.PI * 2) - Math.PI / 2;
      const x0 = cx + Math.cos(a0) * R;
      const y0 = cy + Math.sin(a0) * R;
      const x1 = cx + Math.cos(a1) * R;
      const y1 = cy + Math.sin(a1) * R;
      pts.push([x0 + (x1 - x0) * tseg, y0 + (y1 - y0) * tseg]);
    }

    // Sweep ring (circle).
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2 - Math.PI / 2;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }

    // Fruit core cluster.
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const rad = coreR * (0.25 + 0.75 * Math.abs(Math.sin(i * 1.7)));
      pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
    }

    return pts;
  }

  const targets = buildTargets();

  // Each particle: an origin out in the distance and a target point.
  const particles = targets.map((t) => {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.max(w, h) * (0.55 + Math.random() * 0.5);
    return {
      from: [cx + Math.cos(angle) * dist, cy + Math.sin(angle) * dist],
      to: t,
      // Staggered so the mark assembles left-to-right, top-to-bottom.
      delay: Math.random() * 0.5,
      dur: 0.7 + Math.random() * 0.5,
    };
  });

  // Trail lines fade from an earlier position to the current one.
  const trails = particles.map(() => [0, 0]);
  let start = performance.now();
  let assembled = false;
  let glowUntil = 0;
  let fadeStarted = false;
  let raf = 0;

  const beginFade = () => {
    if (fadeStarted) return;
    fadeStarted = true;
    overlay.classList.add("boot-fade");
    brand?.classList.add("boot-brand-hide");
    setTimeout(() => overlay.remove(), 460);
  };

  function ease(t) {
    // Decelerate strongly, giving the "snap into place" feel.
    return 1 - Math.pow(1 - t, 4);
  }

  function frame(now) {
    const elapsed = (now - start) / 1000;
    const accentCol = accent();
    ctx.clearRect(0, 0, w, h);

    let done = 0;

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const prog = Math.max(0, Math.min(1, (elapsed - p.delay) / p.dur));
      const e = ease(prog);
      const x = p.from[0] + (p.to[0] - p.from[0]) * e;
      const y = p.from[1] + (p.to[1] - p.from[1]) * e;

      // Trail: a short line toward the previous frame position.
      const tx = trails[i][0] || x;
      const ty = trails[i][1] || y;
      if (prog > 0 && prog < 1) {
        ctx.strokeStyle = "rgba(190, 205, 225, 0.16)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(x, y);
        ctx.stroke();
      }

      // The particle itself: a small square ("pixel").
      ctx.fillStyle = prog >= 1 ? accentCol : "rgba(220, 230, 245, 0.9)";
      ctx.fillRect(x - 1.6, y - 1.6, 3.2, 3.2);

      trails[i][0] = x;
      trails[i][1] = y;

      if (prog >= 1) done++;
    }

    if (done === particles.length && !assembled) {
      assembled = true;
      glowUntil = elapsed + 0.55;
      brand?.classList.add("boot-brand-show");
    }

    // Assembled glow: draw the mark's outline once, brighter, then release.
    if (assembled) {
      const pulse = Math.max(0, (glowUntil - elapsed) / 0.55);
      ctx.globalAlpha = 0.25 + 0.75 * pulse;
      ctx.strokeStyle = accentCol;
      ctx.lineWidth = 1.2;

      // Hexagon.
      ctx.beginPath();
      for (let i = 0; i <= 48; i++) {
        const p0 = targets[i % 48];
        if (i === 0) ctx.moveTo(p0[0], p0[1]);
        else ctx.lineTo(p0[0], p0[1]);
      }
      ctx.stroke();

      // Ring.
      ctx.beginPath();
      const R = Math.min(w, h) * 0.24 * 0.62;
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.stroke();

      ctx.globalAlpha = 1;

      if (elapsed > glowUntil + 0.15) {
        beginFade();
      }
    }

    // Safety: never run longer than the animation budget.
    if (elapsed < 3.2) {
      raf = requestAnimationFrame(frame);
    } else {
      beginFade();
    }
  }

  raf = requestAnimationFrame(frame);

  // Hard fallback: if requestAnimationFrame is throttled or paused (headless
  // browsers, background tabs, some remote-desktop sessions), force the overlay
  // away after a fixed budget so the app is never blocked behind the animation.
  setTimeout(beginFade, 3400);

  // If the tab is hidden mid-animation, just finish it.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) beginFade();
  });
}

if (document.getElementById("boot-overlay")) {
  bootAnimation();
}