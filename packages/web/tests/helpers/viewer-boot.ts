import { vi } from "vitest";

/**
 * Shared harness for integration tests that boot the *whole* viewer by importing
 * `src/viewer/main.ts` (which mounts itself into `#app`).
 *
 * These tests must unmount what they mount. Clearing `document.body` detaches the
 * DOM but leaves the Preact tree live with an effect flush still queued: Preact
 * defers flushes through `requestAnimationFrame` with a `setTimeout(…, 35)`
 * fallback, and vitest's jsdom has no rAF, so the fallback always runs. A flush
 * that lands after vitest tears the environment down executes effect bodies with
 * no `window` on `globalThis`, raising an uncaught `ReferenceError` that fails the
 * run even though every test passed.
 */

type PreactRender = typeof import("preact").render;

let mounted: { render: PreactRender; root: HTMLElement } | null = null;

export function createStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

export function ensureBrowserStubs(): void {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: createStorageStub(),
  });
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: globalThis.localStorage,
  });

  if (typeof window.matchMedia !== "function") {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }

  if (typeof HTMLElement.prototype.scrollTo !== "function") {
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: () => {},
    });
  }
}

export function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function wait(ms: number = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitFor(predicate: () => boolean, timeoutMs: number = 8_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    if (vi.isFakeTimers()) {
      await vi.advanceTimersByTimeAsync(20);
    } else {
      await wait(20);
    }
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

export function findNavItem(label: string): HTMLElement | null {
  const navItems = Array.from(document.querySelectorAll(".nav-item"));
  return (navItems.find((item) => item.textContent?.includes(label)) ?? null) as HTMLElement | null;
}

/**
 * Mount the viewer at `url` with `fetchImpl` stubbed in, and wait for the sidebar
 * to render.
 *
 * Any previously booted viewer is torn down first, so repeated boots inside a
 * single test do not orphan a mounted tree.
 */
export async function bootViewer(url: string, fetchImpl: typeof fetch): Promise<void> {
  await teardownViewer();

  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState({}, "", url);
  vi.stubGlobal("fetch", fetchImpl);

  vi.resetModules();
  await import("../../src/viewer/main.js");

  // Take Preact from the registry main.ts just populated. A static top-level
  // import would resolve to a different instance after vi.resetModules() and would
  // not own the tree that was just mounted, so it could not unmount it.
  const { render } = await import("preact");
  const root = document.getElementById("app");
  if (root) mounted = { render, root };

  await waitFor(() => document.querySelector(".sidebar") !== null);
}

/**
 * Unmount the booted viewer and let any queued effect flush run while jsdom is
 * still alive. Safe to call when nothing is mounted.
 */
export async function teardownViewer(): Promise<void> {
  if (!mounted) return;

  const { render, root } = mounted;
  mounted = null;

  // Runs every hook cleanup — removeEventListener, clearInterval, unsubscribes.
  render(null, root);
  root.remove();

  // Drain the flush queued by that final render (35ms fallback, so 50ms clears it).
  if (vi.isFakeTimers()) {
    await vi.advanceTimersByTimeAsync(50);
  } else {
    await wait(50);
  }
}
