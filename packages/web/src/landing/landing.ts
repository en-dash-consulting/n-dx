/**
 * Landing page interactions — theme toggle, copy-to-clipboard,
 * scroll animations, and animated terminal demo.
 * Vanilla JS (no framework dependency).
 *
 * Each concern is isolated in its own init function, called from
 * the `initLanding()` entry point at the bottom.
 */

// ── Types ──

interface TerminalLine {
  type: "command" | "output";
  text: string;
  cls?: string; // extra CSS class for output coloring
  delay?: number; // delay before showing this line (ms)
  phase?: "sourcevision" | "rex" | "hench"; // pipeline phase for synced highlight
}

// ── Theme toggle ──

function initThemeToggle(): void {
  const themeBtn = document.getElementById("theme-toggle");
  if (!themeBtn) return;

  themeBtn.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("sv-theme", next);
    themeBtn.setAttribute(
      "aria-label",
      next === "dark" ? "Switch to light mode" : "Switch to dark mode",
    );
  });
}

// ── Copy install commands ──

function initCopyButtons(): void {
  document.querySelectorAll<HTMLButtonElement>(".copy-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const codeEl = btn.parentElement?.querySelector("code");
      if (!codeEl) return;
      const text = codeEl.textContent || "";
      const originalLabel = btn.getAttribute("aria-label") || "Copy command";

      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // Fallback for older browsers
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }

      btn.setAttribute("data-copied", "true");
      btn.setAttribute("aria-label", "Copied!");
      setTimeout(() => {
        btn.removeAttribute("data-copied");
        btn.setAttribute("aria-label", originalLabel);
      }, 2000);
    });
  });
}

// ── Smooth scroll for anchor links ──

function initSmoothScroll(): void {
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener("click", (e) => {
      const href = (anchor as HTMLAnchorElement).getAttribute("href");
      if (!href || href === "#") return;
      const target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        history.pushState(null, "", href);
      }
    });
  });
}

// ── Scroll-triggered fade-in animations ──

function initFadeAnimations(prefersReducedMotion: boolean): void {
  if (prefersReducedMotion) {
    // Reduced motion: make everything visible immediately
    document.querySelectorAll<HTMLElement>(".fade-in").forEach((el) => {
      el.classList.add("visible");
    });
    return;
  }

  const fadeEls = document.querySelectorAll<HTMLElement>(".fade-in");

  // Hero elements appear immediately (above fold) — reveal on load
  const heroFadeEls = document.querySelectorAll<HTMLElement>(".hero .fade-in");
  heroFadeEls.forEach((el, i) => {
    setTimeout(() => el.classList.add("visible"), 100 + i * 150);
  });

  // Everything else uses IntersectionObserver
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          (entry.target as HTMLElement).classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: "0px 0px -40px 0px" },
  );

  fadeEls.forEach((el) => {
    // Skip hero elements — handled above
    if (!el.closest(".hero")) {
      observer.observe(el);
    }
  });
}

// ── Animated Terminal Demo ──

const terminalScript: TerminalLine[] = [
  { type: "command", text: "npx @n-dx/core init .", delay: 400, phase: "sourcevision" },
  { type: "output", text: "  sourcevision initialized", cls: "success", delay: 300, phase: "sourcevision" },
  { type: "output", text: "  rex initialized", cls: "success", delay: 200, phase: "rex" },
  { type: "output", text: "  hench initialized", cls: "success", delay: 200, phase: "hench" },
  { type: "output", text: "", delay: 400 },

  { type: "command", text: "ndx plan --accept .", delay: 600, phase: "sourcevision" },
  { type: "output", text: "  Analyzing codebase...", cls: "muted", delay: 400, phase: "sourcevision" },
  { type: "output", text: "  142 files · 12 zones · 38 components", cls: "info", delay: 500, phase: "sourcevision" },
  { type: "output", text: "  Generated 6 epics, 18 tasks", cls: "success", delay: 300, phase: "rex" },
  { type: "output", text: "  PRD saved to .rex/prd.json", cls: "success", delay: 200, phase: "rex" },
  { type: "output", text: "", delay: 400 },

  { type: "command", text: "ndx work .", delay: 600, phase: "hench" },
  { type: "output", text: "  Picking next task...", cls: "muted", delay: 400, phase: "hench" },
  { type: "output", text: '  \u25B6 "Add user authentication"', cls: "info", delay: 500, phase: "hench" },
  { type: "output", text: "  Writing code \u00B7 Running tests \u00B7 Committing", cls: "muted", delay: 600, phase: "hench" },
  { type: "output", text: "  Task completed \u2713", cls: "success", delay: 500, phase: "hench" },
];

/**
 * Typewriter effect: types out text character by character into a span.
 * Returns a promise that resolves when typing is complete.
 */
function typeText(el: HTMLElement, text: string, speed = 32): Promise<void> {
  return new Promise((resolve) => {
    let i = 0;
    const tick = () => {
      if (i < text.length) {
        el.textContent += text[i];
        i++;
        setTimeout(tick, speed);
      } else {
        resolve();
      }
    };
    tick();
  });
}

function createTerminalLine(line: TerminalLine, typed = false): HTMLElement {
  const el = document.createElement("div");
  el.className = "terminal-line";

  if (line.type === "command") {
    const prompt = document.createElement("span");
    prompt.className = "terminal-prompt";
    prompt.textContent = "$";
    el.appendChild(prompt);

    const cmd = document.createElement("span");
    cmd.className = "terminal-command";
    // If typed, leave text empty — typeText will fill it in
    if (!typed) cmd.textContent = line.text;
    el.appendChild(cmd);
  } else {
    const output = document.createElement("span");
    output.className = `terminal-output${line.cls ? " " + line.cls : ""}`;
    output.textContent = line.text;
    el.appendChild(output);
  }

  return el;
}

/** Highlight the matching pipeline step in the hero section */
function setPipelinePhase(phase: string | undefined): void {
  const steps = document.querySelectorAll<HTMLElement>(".pipeline-step");
  steps.forEach((step) => {
    if (phase && step.dataset.product === phase) {
      step.classList.add("active");
    } else {
      step.classList.remove("active");
    }
  });

  // Also pulse the connecting arrows when a phase is active
  const arrows = document.querySelectorAll<HTMLElement>(".pipeline-arrow");
  arrows.forEach((arrow) => {
    if (phase) {
      arrow.classList.add("flowing");
    } else {
      arrow.classList.remove("flowing");
    }
  });
}

/** Clear all pipeline highlights */
function clearPipelinePhase(): void {
  document.querySelectorAll<HTMLElement>(".pipeline-step").forEach((s) => s.classList.remove("active"));
  document.querySelectorAll<HTMLElement>(".pipeline-arrow").forEach((a) => a.classList.remove("flowing"));
}

/** Schedule helper: returns a promise that resolves after `ms` milliseconds */
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Track whether a demo run has been cancelled */
let demoAbort = false;

async function runTerminalDemo(): Promise<void> {
  const container = document.getElementById("terminal-lines");
  const cursor = document.querySelector<HTMLElement>(".terminal-cursor");
  if (!container) return;

  // Cancel any in-flight run
  demoAbort = true;
  await wait(50);
  demoAbort = false;

  // Clear previous content
  container.innerHTML = "";
  if (cursor) cursor.classList.add("visible");

  for (const line of terminalScript) {
    if (demoAbort) break;

    await wait(line.delay || 300);
    if (demoAbort) break;

    // Sync pipeline highlight with current phase
    if (line.phase) setPipelinePhase(line.phase);

    const el = createTerminalLine(line, line.type === "command");
    container.appendChild(el);

    // Scroll to bottom
    const body = container.parentElement;
    if (body) body.scrollTop = body.scrollHeight;

    // Typewriter for commands
    if (line.type === "command") {
      const cmdSpan = el.querySelector<HTMLElement>(".terminal-command");
      if (cmdSpan) {
        await typeText(cmdSpan, line.text, 28);
      }
    }
  }

  // Finish: hide cursor and clear pipeline
  await wait(800);
  if (cursor) cursor.classList.remove("visible");
  clearPipelinePhase();
}

function initTerminalDemo(prefersReducedMotion: boolean): void {
  const terminalDemo = document.querySelector<HTMLElement>(".terminal-demo");
  if (!terminalDemo) return;

  if (prefersReducedMotion) {
    // Show all lines immediately for reduced motion
    const container = document.getElementById("terminal-lines");
    if (container) {
      terminalScript.forEach((line) => {
        const el = createTerminalLine(line);
        el.style.opacity = "1";
        el.style.transform = "none";
        el.style.animation = "none";
        container.appendChild(el);
      });
    }
    return;
  }

  let hasPlayed = false;
  const terminalObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && !hasPlayed) {
          hasPlayed = true;
          // Small delay after fade-in animation completes
          setTimeout(runTerminalDemo, 600);
        }
      });
    },
    { threshold: 0.3 },
  );
  terminalObserver.observe(terminalDemo);

  // Replay button
  const replayBtn = document.getElementById("terminal-replay");
  if (replayBtn) {
    replayBtn.addEventListener("click", () => {
      runTerminalDemo();
    });
  }
}

// ── Scroll-synced section entrance tracking ──

function initSectionTracking(prefersReducedMotion: boolean): void {
  if (prefersReducedMotion) return;

  const sections = document.querySelectorAll<HTMLElement>("section");
  const sectionObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in-view");
        }
      });
    },
    { threshold: 0.1 },
  );
  sections.forEach((s) => sectionObserver.observe(s));
}

// ── Entry point ──

function initLanding(): void {
  const prefersReducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  initThemeToggle();
  initCopyButtons();
  initSmoothScroll();
  initFadeAnimations(prefersReducedMotion);
  initTerminalDemo(prefersReducedMotion);
  initSectionTracking(prefersReducedMotion);
}

initLanding();
