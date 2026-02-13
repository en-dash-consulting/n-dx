/**
 * Landing page interactions — theme toggle, copy-to-clipboard,
 * scroll animations, and animated terminal demo.
 * Vanilla JS (no framework dependency).
 */

// ── Theme toggle ──
const themeBtn = document.getElementById("theme-toggle");
if (themeBtn) {
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
// Supports multiple copy buttons — each copies the sibling <code> text.
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

// ── Smooth scroll for anchor links (polyfill for Safari) ──
document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener("click", (e) => {
    const href = (anchor as HTMLAnchorElement).getAttribute("href");
    if (!href || href === "#") return;
    const target = document.querySelector(href);
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      // Update URL without scroll jump
      history.pushState(null, "", href);
    }
  });
});

// ── Scroll-triggered fade-in animations ──
const prefersReducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

if (!prefersReducedMotion) {
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
} else {
  // Reduced motion: make everything visible immediately
  document.querySelectorAll<HTMLElement>(".fade-in").forEach((el) => {
    el.classList.add("visible");
  });
}

// ── Animated Terminal Demo ──
interface TerminalLine {
  type: "command" | "output";
  text: string;
  cls?: string; // extra CSS class for output coloring
  delay?: number; // delay before showing this line (ms)
}

const terminalScript: TerminalLine[] = [
  { type: "command", text: "npx n-dx init .", delay: 400 },
  { type: "output", text: "  sourcevision initialized", cls: "success", delay: 300 },
  { type: "output", text: "  rex initialized", cls: "success", delay: 200 },
  { type: "output", text: "  hench initialized", cls: "success", delay: 200 },
  { type: "output", text: "", delay: 400 },

  { type: "command", text: "ndx plan --accept .", delay: 600 },
  { type: "output", text: "  Analyzing codebase...", cls: "muted", delay: 400 },
  { type: "output", text: "  142 files \u00b7 12 zones \u00b7 38 components", cls: "info", delay: 500 },
  { type: "output", text: "  Generated 6 epics, 18 tasks", cls: "success", delay: 300 },
  { type: "output", text: "  PRD saved to .rex/prd.json", cls: "success", delay: 200 },
  { type: "output", text: "", delay: 400 },

  { type: "command", text: "ndx work .", delay: 600 },
  { type: "output", text: "  Picking next task...", cls: "muted", delay: 400 },
  { type: "output", text: '  \u25b6 "Add user authentication"', cls: "info", delay: 500 },
  { type: "output", text: "  Writing code \u00b7 Running tests \u00b7 Committing", cls: "muted", delay: 600 },
  { type: "output", text: "  Task completed \u2713", cls: "success", delay: 500 },
];

function createTerminalLine(line: TerminalLine): HTMLElement {
  const el = document.createElement("div");
  el.className = "terminal-line";

  if (line.type === "command") {
    const prompt = document.createElement("span");
    prompt.className = "terminal-prompt";
    prompt.textContent = "$";
    el.appendChild(prompt);

    const cmd = document.createElement("span");
    cmd.className = "terminal-command";
    cmd.textContent = line.text;
    el.appendChild(cmd);
  } else {
    const output = document.createElement("span");
    output.className = `terminal-output${line.cls ? " " + line.cls : ""}`;
    output.textContent = line.text;
    el.appendChild(output);
  }

  return el;
}

function runTerminalDemo(): void {
  const container = document.getElementById("terminal-lines");
  const cursor = document.querySelector<HTMLElement>(".terminal-cursor");
  if (!container) return;

  // Clear previous content
  container.innerHTML = "";
  if (cursor) cursor.classList.add("visible");

  let totalDelay = 0;

  terminalScript.forEach((line, _index) => {
    totalDelay += line.delay || 300;
    const lineDelay = totalDelay;

    setTimeout(() => {
      const el = createTerminalLine(line);
      container.appendChild(el);
      // Scroll to bottom of terminal
      const body = container.parentElement;
      if (body) body.scrollTop = body.scrollHeight;
    }, lineDelay);
  });

  // Hide cursor after last line
  totalDelay += 800;
  setTimeout(() => {
    if (cursor) cursor.classList.remove("visible");
  }, totalDelay);
}

// Start terminal when it scrolls into view
const terminalDemo = document.querySelector<HTMLElement>(".terminal-demo");
if (terminalDemo && !prefersReducedMotion) {
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
} else if (terminalDemo && prefersReducedMotion) {
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
}
