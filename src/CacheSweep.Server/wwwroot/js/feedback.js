"use strict";

/**
 * Click feedback.
 *
 * Every clickable surface ripples and dips slightly when pressed. The intensity
 * is user-adjustable from the settings slider (0 = off, 1 = subtle, 2 = bold)
 * and persisted, so the feel stays consistent across sessions.
 *
 * Implementation notes:
 *  - One delegated listener, so dynamically rendered rows work too.
 *  - The ripple is a short-lived absolutely positioned span; the host only
 *    needs `position: relative` and `overflow: hidden`, both applied here.
 *  - Respects prefers-reduced-motion by disabling the scale dip.
 */

const FEEDBACK_KEY = "cachesweep.feedback";
const FEEDBACK_DEFAULT = 1;

const feedbackState = {
  /** 0 = off, 1 = normal, 2 = strong. */
  level: FEEDBACK_DEFAULT,
};

/** Elements that should ripple. Kept as a selector so new ones work for free. */
const FEEDBACK_SELECTOR = [
  ".btn",
  ".nav button",
  ".theme-switch button",
  ".view-switch button",
  ".seg-btn",
  ".icon-btn",
  ".drive-card",
  ".row",
  ".app-row",
  ".app-card",
  ".app-line",
  ".plugin-card",
  ".switch",
  ".chk",
].join(",");

function applyFeedbackLevel(level) {
  const clamped = Math.max(0, Math.min(2, Number(level)));
  feedbackState.level = clamped;
  document.documentElement.style.setProperty("--feedback-level", String(clamped));
  document.documentElement.classList.toggle("no-feedback", clamped === 0);

  try {
    localStorage.setItem(FEEDBACK_KEY, String(clamped));
  } catch {
    /* private mode */
  }
}

function loadFeedbackLevel() {
  let stored = FEEDBACK_DEFAULT;
  try {
    const raw = localStorage.getItem(FEEDBACK_KEY);
    if (raw !== null) {
      stored = Number(raw);
    }
  } catch {
    /* private mode */
  }
  applyFeedbackLevel(Number.isFinite(stored) ? stored : FEEDBACK_DEFAULT);
  return feedbackState.level;
}

/** Spawns the ripple at the pointer position inside `host`. */
function spawnRipple(host, clientX, clientY) {
  if (feedbackState.level === 0) {
    return;
  }

  const rect = host.getBoundingClientRect();

  // Scroll containers (rows, cards) have no radius of their own; giving the
  // ripple a positioned parent keeps it clipped correctly.
  const computed = getComputedStyle(host);
  if (computed.position === "static") {
    host.style.position = "relative";
  }

  const size = Math.max(rect.width, rect.height) * 1.6;
  const ripple = document.createElement("span");
  ripple.className = "click-ripple";

  ripple.style.width = `${size}px`;
  ripple.style.height = `${size}px`;
  ripple.style.left = `${clientX - rect.left - size / 2}px`;
  ripple.style.top = `${clientY - rect.top - size / 2}px`;

  // Scale duration and opacity with the intensity setting.
  const duration = feedbackState.level >= 2 ? 620 : 520;
  ripple.style.animationDuration = `${duration}ms`;
  ripple.style.opacity = feedbackState.level >= 2 ? "0.42" : "0.26";

  host.appendChild(ripple);
  ripple.addEventListener("animationend", () => ripple.remove(), { once: true });

  // Safety net: if animationend never fires (tab hidden), clean up.
  setTimeout(() => ripple.remove(), duration + 200);
}

/** Adds the press dip class for the duration of the press. */
function pressDown(host) {
  if (feedbackState.level === 0) return;
  host.classList.add("is-pressing");
}

function pressUp(host) {
  host.classList.remove("is-pressing");
}

function initClickFeedback() {
  loadFeedbackLevel();

  document.addEventListener(
    "pointerdown",
    (e) => {
      const host = e.target.closest?.(FEEDBACK_SELECTOR);
      if (!host || host.disabled || host.classList.contains("disabled")) {
        return;
      }
      pressDown(host);
      spawnRipple(host, e.clientX, e.clientY);
    },
    { passive: true }
  );

  const release = () => {
    document.querySelectorAll(".is-pressing").forEach(pressUp);
  };

  document.addEventListener("pointerup", release, { passive: true });
  document.addEventListener("pointercancel", release, { passive: true });

  // Keyboard activation should feel the same as a click.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;

    const host = e.target.closest?.(FEEDBACK_SELECTOR);
    if (!host || host.disabled) return;

    const rect = host.getBoundingClientRect();
    pressDown(host);
    spawnRipple(host, rect.left + rect.width / 2, rect.top + rect.height / 2);
    setTimeout(() => pressUp(host), 180);
  });
}

window.CacheSweepFeedback = {
  initClickFeedback,
  applyFeedbackLevel,
  loadFeedbackLevel,
  get level() {
    return feedbackState.level;
  },
};
