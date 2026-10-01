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
    try {
      localStorage.setItem("sv-theme", next);
    } catch {
      // Storage can be unavailable in hardened browser contexts.
    }
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

// ── Setup wizard (bootstraps this project without a terminal) ──

/**
 * Where this page is mounted. Standalone (`ndx start --here`) it is served at
 * `/`; behind the per-user hub — which is what plain `ndx start` registers
 * with — it is served at `/p/<id>/`, and a worktree other than the anchor sits
 * under `/w/<key>/`. A root-relative `fetch("/api/…")` from there reaches the
 * hub rather than this project: with one project registered the hub aliases it
 * back, but with two it answers 409 and the wizard would initialize nothing.
 *
 * Deliberately a local copy of `detectViewerBasePath` (src/shared/base-path.ts)
 * rather than an import: the landing page is a self-contained zone with no
 * imports into the dashboard viewer (see build.js), so the prefix shapes are
 * duplicated here on purpose. Keep the two in step.
 */
function apiUrl(path: string): string {
  const pathname = typeof location === "undefined" ? "" : location.pathname;
  const project = /^\/p\/[^/?#]+/.exec(pathname)?.[0] ?? "";
  const workspace = /^\/w\/[^/?#]+/.exec(pathname.slice(project.length))?.[0] ?? "";
  return `${project}${workspace}${path}`;
}

interface InitStatusResponse {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  output: string;
  error: string | null;
  /** Whether this run was asked to create a git repository. */
  gitRequested?: boolean;
  /** Whether the folder is a repository now — null until a git run finishes. */
  gitInitialized?: boolean | null;
}

/** GET /api/commands/init/preflight — what this folder looks like pre-init. */
interface InitPreflightResponse {
  /** Already inside a git working tree. */
  isRepo: boolean;
  /** `git` answers on this machine's PATH. */
  gitAvailable: boolean;
}

const WIZARD_VENDOR_HINTS: Record<string, string> = {
  claude: "Uses the <code>claude</code> CLI — install and sign in on this machine first.",
  codex: "Uses the <code>codex</code> CLI — install and sign in on this machine first.",
  google: "Needs a Gemini API key. Paste one below, or skip and set it later in Settings.",
  local: "Connects to a local OpenAI-compatible server (LM Studio, Ollama). No account needed.",
};

function initSetupWizard(): void {
  const form = document.getElementById("setup-wizard") as HTMLFormElement | null;
  const vendorTabs = document.getElementById("wizard-vendor-tabs");
  const submitBtn = document.getElementById("wizard-submit") as HTMLButtonElement | null;
  if (!form || !vendorTabs || !submitBtn) return;

  const vendorHint = document.getElementById("wizard-vendor-hint");
  const submitLabel = submitBtn.querySelector<HTMLElement>(".wizard-submit-label");
  const submitSpinner = submitBtn.querySelector<HTMLElement>(".wizard-submit-spinner");
  const progressEl = document.getElementById("wizard-progress");
  const errorEl = document.getElementById("wizard-error");
  const successEl = document.getElementById("wizard-success");
  const googleFields = form.querySelector<HTMLElement>('.wizard-vendor-fields[data-for="google"]');
  const localFields = form.querySelector<HTMLElement>('.wizard-vendor-fields[data-for="local"]');
  const googleKeyInput = document.getElementById("wizard-google-key") as HTMLInputElement | null;
  const localHostInput = document.getElementById("wizard-local-host") as HTMLInputElement | null;
  const localPortInput = document.getElementById("wizard-local-port") as HTMLInputElement | null;
  const gitFieldset = document.getElementById("wizard-git-fieldset") as HTMLFieldSetElement | null;
  const gitCheckbox = document.getElementById("wizard-git") as HTMLInputElement | null;
  const gitHint = document.getElementById("wizard-git-hint");

  let selectedVendor = "claude";
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Ask the server what this folder is before offering to set it up. The git
   * question only appears for a folder that is not already in a repository —
   * for everything else there is nothing to decide, so nothing is shown.
   *
   * A failed preflight leaves the fieldset hidden: the wizard then sends no
   * git answer at all and `ndx init` keeps its own default, which is exactly
   * the behaviour this page had before the question existed.
   */
  async function loadPreflight(): Promise<void> {
    try {
      const res = await fetch(apiUrl("/api/commands/init/preflight"));
      if (!res.ok) return;
      const data = (await res.json()) as InitPreflightResponse;
      if (data.isRepo || !gitFieldset) return;
      gitFieldset.hidden = false;
      if (!data.gitAvailable && gitCheckbox && gitHint) {
        // Nothing to offer: `git init` would fail and init would carry a
        // warning instead of a repository.
        gitCheckbox.checked = false;
        gitCheckbox.disabled = true;
        gitHint.textContent =
          "git was not found on this machine's PATH. Install git, then run `git init` here "
          + "and re-run setup to enable n-dx's auto-commit features.";
      }
    } catch {
      // Offline or an older server — leave the question out rather than
      // guessing at an answer the operator never gave.
    }
  }

  function selectVendor(vendor: string): void {
    selectedVendor = vendor;
    vendorTabs!.querySelectorAll<HTMLButtonElement>(".wizard-vendor-tab").forEach((tab) => {
      tab.setAttribute("aria-pressed", String(tab.dataset.vendor === vendor));
    });
    if (vendorHint) vendorHint.innerHTML = WIZARD_VENDOR_HINTS[vendor] ?? "";
    if (googleFields) googleFields.hidden = vendor !== "google";
    if (localFields) localFields.hidden = vendor !== "local";
  }

  vendorTabs.addEventListener("click", (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLButtonElement>(".wizard-vendor-tab");
    if (tab?.dataset.vendor) selectVendor(tab.dataset.vendor);
  });

  function setBusy(busy: boolean): void {
    submitBtn!.disabled = busy;
    if (submitLabel) submitLabel.textContent = busy ? "Initializing…" : "Initialize project";
    if (submitSpinner) submitSpinner.hidden = !busy;
  }

  function showError(message: string): void {
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.hidden = false;
    }
    if (progressEl) progressEl.hidden = true;
  }

  function stopPolling(): void {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function pollStatus(): Promise<void> {
    try {
      const res = await fetch(apiUrl("/api/commands/init/status"));
      if (!res.ok) return;
      const data = (await res.json()) as InitStatusResponse;
      if (data.running || !data.finishedAt) return;

      stopPolling();
      if (data.error) {
        setBusy(false);
        showError(data.error);
        return;
      }
      if (progressEl) progressEl.hidden = true;
      if (successEl) {
        if (data.gitRequested && data.gitInitialized === false) {
          // Init itself succeeded — only the repository is missing, so this is
          // a note on the success line rather than an error.
          successEl.append(" (git repository could not be created — is git installed?)");
        } else if (data.gitInitialized) {
          successEl.append(" Git repository created.");
        }
        successEl.hidden = false;
      }
      // The server now sees .rex/.sourcevision/.hench on disk, so the next
      // request to "/" serves the real dashboard instead of this page.
      setTimeout(() => {
        // Same prefix as the API calls — "/" would land on the hub's chooser
        // (or another project) instead of the dashboard just initialized.
        location.href = apiUrl("/");
      }, 900);
    } catch {
      // Transient network hiccup — keep polling, the interval will retry.
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (errorEl) errorEl.hidden = true;
    if (successEl) successEl.hidden = true;

    const assistants = Array.from(
      form.querySelectorAll<HTMLInputElement>('input[name="assistant"]:checked'),
    ).map((el) => el.value);
    if (assistants.length === 0) {
      showError("Choose at least one assistant.");
      return;
    }

    const body: Record<string, unknown> = { assistants, provider: selectedVendor };
    // Only sent when the question was actually asked — a hidden fieldset means
    // the folder is already a repository (or the preflight never answered).
    if (gitFieldset && !gitFieldset.hidden && gitCheckbox && !gitCheckbox.disabled) {
      body.git = gitCheckbox.checked;
    }
    if (selectedVendor === "google") {
      const key = googleKeyInput?.value.trim();
      if (key) body.googleApiKey = key;
    }
    if (selectedVendor === "local") {
      const host = localHostInput?.value.trim();
      if (host) body.localHost = host;
      const portRaw = localPortInput?.value.trim();
      if (portRaw) {
        const port = parseInt(portRaw, 10);
        if (!Number.isNaN(port)) body.localPort = port;
      }
    }

    setBusy(true);
    if (progressEl) progressEl.hidden = false;

    void (async () => {
      try {
        const res = await fetch(apiUrl("/api/commands/init"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok && res.status !== 409) {
          const data = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as { error?: string };
          setBusy(false);
          showError(data.error || "Failed to start initialization.");
          return;
        }
        // 202 (started) or 409 (already running, e.g. a previous click that
        // didn't get a response back) both mean: start watching status.
        stopPolling();
        pollTimer = setInterval(() => void pollStatus(), 1500);
      } catch (err) {
        setBusy(false);
        showError(err instanceof Error ? err.message : "Failed to start initialization.");
      }
    })();
  });

  selectVendor(selectedVendor);
  void loadPreflight();
}

// ── "Prefer the terminal?" toggle for the raw CLI fallback ──

function initCliFallbackToggle(): void {
  const toggle = document.getElementById("wizard-toggle-cli");
  const fallback = document.getElementById("cli-fallback");
  if (!toggle || !fallback) return;

  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!expanded));
    fallback.hidden = expanded;
    toggle.textContent = expanded ? "Prefer the terminal?" : "Hide terminal commands";
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
  initSetupWizard();
  initCliFallbackToggle();
  initSmoothScroll();
  initFadeAnimations(prefersReducedMotion);
  initTerminalDemo(prefersReducedMotion);
  initSectionTracking(prefersReducedMotion);
}

initLanding();

export {};
