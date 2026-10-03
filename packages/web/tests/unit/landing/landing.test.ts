// @vitest-environment jsdom
/**
 * Smoke tests for the landing page module.
 *
 * Verifies that the module initializes without throwing and that
 * interactive handlers are wired correctly. Uses jsdom for DOM APIs.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Build a minimal DOM structure that mirrors the landing page's
 * expected elements so `initLanding()` can wire event listeners
 * without early-returning.
 */
function setupLandingDOM(): void {
  document.body.innerHTML = `
    <html data-theme="dark">
      <button id="theme-toggle" aria-label="Switch to light mode"></button>

      <div class="copy-btn" aria-label="Copy command">
        <code>npx @n-dx/core init .</code>
      </div>

      <a href="#features">Features</a>
      <section id="features" class="fade-in">
        <div class="hero">
          <span class="fade-in">Hero text</span>
        </div>
      </section>

      <div class="terminal-demo">
        <div id="terminal-lines"></div>
        <span class="terminal-cursor"></span>
        <button id="terminal-replay"></button>
      </div>

      <div class="pipeline-step" data-product="sourcevision"></div>
      <div class="pipeline-step" data-product="rex"></div>
      <div class="pipeline-step" data-product="hench"></div>
      <div class="pipeline-arrow"></div>

      <section>General section</section>
    </html>
  `;
}

/** Install browser API stubs that jsdom doesn't provide. */
function installBrowserStubs(reducedMotion = false): void {
  // matchMedia
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: reducedMotion }),
  });

  // IntersectionObserver — must behave as a constructor (called with `new`)
  window.IntersectionObserver = vi.fn().mockImplementation(function () {
    return {
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
      takeRecords: vi.fn().mockReturnValue([]),
      root: null,
      rootMargin: "",
      scrollMargin: "",
      thresholds: [],
    } satisfies IntersectionObserver;
  }) as unknown as typeof IntersectionObserver;
}

describe("landing.ts smoke tests", () => {
  beforeEach(() => {
    vi.resetModules();
    setupLandingDOM();
    installBrowserStubs();
  });

  it("initializes without throwing", async () => {
    await import("../../../src/landing/landing.js");
    // If we reach here, no error was thrown during module init
    expect(true).toBe(true);
  });

  it("wires theme toggle — click cycles data-theme attribute", async () => {
    await import("../../../src/landing/landing.js");
    const btn = document.getElementById("theme-toggle")!;

    btn.click();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    btn.click();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("wires theme toggle — updates aria-label on toggle", async () => {
    await import("../../../src/landing/landing.js");
    const btn = document.getElementById("theme-toggle")!;

    btn.click(); // dark → light
    expect(btn.getAttribute("aria-label")).toBe("Switch to dark mode");

    btn.click(); // light → dark
    expect(btn.getAttribute("aria-label")).toBe("Switch to light mode");
  });

  it("wires theme toggle — persists preference to localStorage", async () => {
    await import("../../../src/landing/landing.js");
    const btn = document.getElementById("theme-toggle")!;

    btn.click();
    expect(localStorage.getItem("sv-theme")).toBe("light");
  });

  it("wires copy button — sets data-copied attribute on click", async () => {
    // Stub clipboard API
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });

    await import("../../../src/landing/landing.js");
    const btn = document.querySelector<HTMLButtonElement>(".copy-btn")!;

    await btn.click();
    // Allow microtask for async clipboard
    await new Promise((r) => setTimeout(r, 0));

    expect(btn.getAttribute("data-copied")).toBe("true");
    expect(btn.getAttribute("aria-label")).toBe("Copied!");
  });

  it("sets up IntersectionObserver for fade-in animations", async () => {
    await import("../../../src/landing/landing.js");

    // IntersectionObserver should have been instantiated for fade-in + section tracking + terminal
    expect(window.IntersectionObserver).toHaveBeenCalled();
  });

  it("respects prefers-reduced-motion — makes fade-in elements visible immediately", async () => {
    vi.resetModules();
    setupLandingDOM();
    installBrowserStubs(true);

    await import("../../../src/landing/landing.js");

    const fadeEl = document.querySelector<HTMLElement>(".fade-in")!;
    expect(fadeEl.classList.contains("visible")).toBe(true);
  });

  it("renders terminal demo lines immediately when reduced motion is preferred", async () => {
    vi.resetModules();
    setupLandingDOM();
    installBrowserStubs(true);

    await import("../../../src/landing/landing.js");

    const container = document.getElementById("terminal-lines")!;
    // Terminal script has 15 lines — all should be rendered immediately
    expect(container.children.length).toBeGreaterThan(0);
  });
});

/**
 * Setup-wizard DOM — the subset of the landing page's form that the git
 * question needs. `initSetupWizard` early-returns without the form, the vendor
 * tabs, and the submit button, so all three are present.
 */
function setupWizardDOM(): void {
  document.body.innerHTML = `
    <form id="setup-wizard">
      <label><input type="checkbox" name="assistant" value="claude" checked></label>
      <div id="wizard-vendor-tabs">
        <button type="button" class="wizard-vendor-tab" data-vendor="claude" aria-pressed="true"></button>
      </div>
      <p id="wizard-vendor-hint"></p>
      <fieldset id="wizard-git-fieldset" hidden>
        <label><input type="checkbox" id="wizard-git" checked></label>
        <p id="wizard-git-hint">default hint</p>
      </fieldset>
      <button type="submit" id="wizard-submit">
        <span class="wizard-submit-label">Initialize project</span>
        <span class="wizard-submit-spinner" hidden></span>
      </button>
      <p id="wizard-progress" hidden></p>
      <p id="wizard-error" hidden></p>
      <p id="wizard-success" hidden></p>
    </form>
  `;
}

/** Stub `fetch` for the preflight call, plus a capture of any POSTed init. */
function stubPreflight(preflight: { isRepo: boolean; gitAvailable: boolean } | "error") {
  const initBodies: Record<string, unknown>[] = [];
  const fetchMock = vi.fn(async (url: string, opts?: { method?: string; body?: string }) => {
    // Served at "/" standalone and "/p/<id>/" behind the hub — match on the
    // route, not the prefix, so one stub covers both.
    if (url.endsWith("/api/commands/init/preflight")) {
      if (preflight === "error") throw new Error("offline");
      return { ok: true, json: async () => preflight } as Response;
    }
    if (url.endsWith("/api/commands/init") && opts?.method === "POST") {
      initBodies.push(JSON.parse(opts.body ?? "{}") as Record<string, unknown>);
      return { ok: true, status: 202, json: async () => ({ ok: true }) } as Response;
    }
    return { ok: true, status: 200, json: async () => ({ running: true }) } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return { initBodies };
}

/** Let the wizard's preflight promise settle. */
function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

describe("landing.ts setup wizard — git question", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
    setupWizardDOM();
    installBrowserStubs();
  });

  it("reveals the git question for a folder that is not a repository", async () => {
    stubPreflight({ isRepo: false, gitAvailable: true });
    await import("../../../src/landing/landing.js");
    await flush();

    const fieldset = document.getElementById("wizard-git-fieldset") as HTMLFieldSetElement;
    expect(fieldset.hidden).toBe(false);
    expect((document.getElementById("wizard-git") as HTMLInputElement).checked).toBe(true);
  });

  it("keeps the git question hidden when the folder is already a repository", async () => {
    stubPreflight({ isRepo: true, gitAvailable: true });
    await import("../../../src/landing/landing.js");
    await flush();

    expect((document.getElementById("wizard-git-fieldset") as HTMLFieldSetElement).hidden).toBe(true);
  });

  it("disables the question and explains why when git is not installed", async () => {
    stubPreflight({ isRepo: false, gitAvailable: false });
    await import("../../../src/landing/landing.js");
    await flush();

    const checkbox = document.getElementById("wizard-git") as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
    expect(checkbox.checked).toBe(false);
    expect(document.getElementById("wizard-git-hint")!.textContent).toContain("PATH");
  });

  it("sends the git answer with the init request", async () => {
    const { initBodies } = stubPreflight({ isRepo: false, gitAvailable: true });
    await import("../../../src/landing/landing.js");
    await flush();

    (document.getElementById("wizard-git") as HTMLInputElement).checked = false;
    (document.getElementById("setup-wizard") as HTMLFormElement).dispatchEvent(
      new Event("submit", { cancelable: true }),
    );
    await flush();

    expect(initBodies).toHaveLength(1);
    expect(initBodies[0].git).toBe(false);
    expect(initBodies[0].provider).toBe("claude");
  });

  // Plain `ndx start` registers with the per-user hub, which serves each
  // project at /p/<id>/. A root-relative call from there reaches the hub, not
  // this project — and with two projects registered the hub answers 409.
  it("addresses the project through its hub prefix", async () => {
    const { initBodies } = stubPreflight({ isRepo: false, gitAvailable: true });
    window.history.replaceState({}, "", "/p/demo-project/");
    await import("../../../src/landing/landing.js");
    await flush();

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls).toContain("/p/demo-project/api/commands/init/preflight");

    (document.getElementById("setup-wizard") as HTMLFormElement).dispatchEvent(
      new Event("submit", { cancelable: true }),
    );
    await flush();

    expect(initBodies).toHaveLength(1);
    const posted = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(posted).toContain("/p/demo-project/api/commands/init");
  });

  it("omits the git answer entirely when the preflight could not be read", async () => {
    const { initBodies } = stubPreflight("error");
    await import("../../../src/landing/landing.js");
    await flush();

    (document.getElementById("setup-wizard") as HTMLFormElement).dispatchEvent(
      new Event("submit", { cancelable: true }),
    );
    await flush();

    expect(initBodies).toHaveLength(1);
    expect("git" in initBodies[0]).toBe(false);
  });
});
