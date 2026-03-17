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
  window.IntersectionObserver = vi.fn().mockImplementation(function (
    this: IntersectionObserver,
  ) {
    this.observe = vi.fn();
    this.unobserve = vi.fn();
    this.disconnect = vi.fn();
    this.takeRecords = vi.fn().mockReturnValue([]);
    this.root = null;
    this.rootMargin = "";
    this.thresholds = [];
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
