// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NodeCuller } from "../../../src/shared/node-culler.js";
import type { VisibilityCallback } from "../../../src/shared/node-culler.js";

// ─── IntersectionObserver mock ───────────────────────────────────────────────

type ObserverCallback = (entries: IntersectionObserverEntry[]) => void;

interface MockObserverInstance {
  observe: ReturnType<typeof vi.fn>;
  unobserve: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  /** Simulate intersection entries for observed elements. */
  trigger: (entries: Partial<IntersectionObserverEntry>[]) => void;
  callback: ObserverCallback;
  options: IntersectionObserverInit | undefined;
}

let mockObserverInstances: MockObserverInstance[] = [];

function installMockIntersectionObserver() {
  mockObserverInstances = [];

  (globalThis as any).IntersectionObserver = class MockIntersectionObserver {
    readonly mock: MockObserverInstance;

    constructor(callback: ObserverCallback, options?: IntersectionObserverInit) {
      const observe = vi.fn();
      const unobserve = vi.fn();
      const disconnect = vi.fn();

      this.mock = {
        observe,
        unobserve,
        disconnect,
        trigger: (entries) => callback(entries as IntersectionObserverEntry[]),
        callback,
        options,
      };

      // Proxy methods so the real class calls hit the mock fns
      (this as any).observe = observe;
      (this as any).unobserve = unobserve;
      (this as any).disconnect = disconnect;

      mockObserverInstances.push(this.mock);
    }
  };
}

function latestObserver(): MockObserverInstance {
  return mockObserverInstances[mockObserverInstances.length - 1];
}

function makeEntry(
  target: Element,
  isIntersecting: boolean,
  height: number = 40,
): Partial<IntersectionObserverEntry> {
  return {
    target,
    isIntersecting,
    boundingClientRect: { height, width: 200, x: 0, y: 0, top: 0, left: 0, bottom: height, right: 200 } as DOMRectReadOnly,
    intersectionRatio: isIntersecting ? 1 : 0,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("NodeCuller", () => {
  beforeEach(() => {
    installMockIntersectionObserver();
  });

  afterEach(() => {
    mockObserverInstances = [];
    delete (globalThis as any).IntersectionObserver;
  });

  describe("constructor", () => {
    it("creates an IntersectionObserver with default buffer", () => {
      new NodeCuller();
      expect(mockObserverInstances).toHaveLength(1);
      expect(latestObserver().options?.rootMargin).toBe("200px 0px 200px 0px");
    });

    it("creates an IntersectionObserver with custom buffer", () => {
      new NodeCuller({ bufferPx: 500 });
      expect(latestObserver().options?.rootMargin).toBe("500px 0px 500px 0px");
    });

    it("passes root option to observer", () => {
      const root = document.createElement("div");
      new NodeCuller({ root });
      expect(latestObserver().options?.root).toBe(root);
    });

    it("defaults root to null (viewport)", () => {
      new NodeCuller();
      expect(latestObserver().options?.root).toBeNull();
    });
  });

  describe("observe()", () => {
    it("registers an element with the observer", () => {
      const culler = new NodeCuller();
      const el = document.createElement("div");
      const cb = vi.fn();

      culler.observe(el, cb);

      expect(latestObserver().observe).toHaveBeenCalledWith(el);
    });

    it("returns a cleanup function that unobserves", () => {
      const culler = new NodeCuller();
      const el = document.createElement("div");
      const cb = vi.fn();

      const cleanup = culler.observe(el, cb);
      cleanup();

      expect(latestObserver().unobserve).toHaveBeenCalledWith(el);
    });

    it("fires callback when element becomes visible", () => {
      const culler = new NodeCuller();
      const el = document.createElement("div");
      const cb = vi.fn();

      culler.observe(el, cb);
      latestObserver().trigger([makeEntry(el, true)]);

      expect(cb).toHaveBeenCalledWith(true);
    });

    it("fires callback when element becomes hidden", () => {
      const culler = new NodeCuller();
      const el = document.createElement("div");
      const cb = vi.fn();

      culler.observe(el, cb);
      latestObserver().trigger([makeEntry(el, false, 42)]);

      expect(cb).toHaveBeenCalledWith(false);
    });

    it("does not fire callback for unregistered elements", () => {
      const culler = new NodeCuller();
      const el = document.createElement("div");
      const unregistered = document.createElement("span");
      const cb = vi.fn();

      culler.observe(el, cb);
      latestObserver().trigger([makeEntry(unregistered, true)]);

      expect(cb).not.toHaveBeenCalled();
    });

    it("stops firing callback after cleanup", () => {
      const culler = new NodeCuller();
      const el = document.createElement("div");
      const cb = vi.fn();

      const cleanup = culler.observe(el, cb);
      cleanup();
      latestObserver().trigger([makeEntry(el, true)]);

      expect(cb).not.toHaveBeenCalled();
    });

    it("is a no-op after dispose", () => {
      const culler = new NodeCuller();
      culler.dispose();

      const el = document.createElement("div");
      const cb = vi.fn();
      const cleanup = culler.observe(el, cb);

      // Should return a no-op cleanup
      expect(typeof cleanup).toBe("function");
      cleanup(); // Should not throw
      expect(latestObserver().observe).not.toHaveBeenCalled();
    });
  });

  describe("getLastHeight()", () => {
    it("returns 0 when no height has been recorded", () => {
      const culler = new NodeCuller();
      const el = document.createElement("div");
      expect(culler.getLastHeight(el)).toBe(0);
    });

    it("records height when element transitions to off-screen", () => {
      const culler = new NodeCuller();
      const el = document.createElement("div");
      culler.observe(el, vi.fn());

      latestObserver().trigger([makeEntry(el, false, 56)]);

      expect(culler.getLastHeight(el)).toBe(56);
    });

    it("does not overwrite height with zero", () => {
      const culler = new NodeCuller();
      const el = document.createElement("div");
      culler.observe(el, vi.fn());

      // First off-screen with valid height
      latestObserver().trigger([makeEntry(el, false, 56)]);
      // Second off-screen with zero height (collapsed?)
      latestObserver().trigger([makeEntry(el, false, 0)]);

      expect(culler.getLastHeight(el)).toBe(56);
    });

    it("does not record height when element becomes visible", () => {
      const culler = new NodeCuller();
      const el = document.createElement("div");
      culler.observe(el, vi.fn());

      latestObserver().trigger([makeEntry(el, true, 99)]);

      // Height is only recorded on off-screen transitions
      expect(culler.getLastHeight(el)).toBe(0);
    });

    it("clears height when cleanup is called", () => {
      const culler = new NodeCuller();
      const el = document.createElement("div");
      const cleanup = culler.observe(el, vi.fn());

      latestObserver().trigger([makeEntry(el, false, 42)]);
      expect(culler.getLastHeight(el)).toBe(42);

      cleanup();
      expect(culler.getLastHeight(el)).toBe(0);
    });
  });

  describe("dispose()", () => {
    it("disconnects the observer", () => {
      const culler = new NodeCuller();
      culler.dispose();
      expect(latestObserver().disconnect).toHaveBeenCalled();
    });

    it("clears all tracked state", () => {
      const culler = new NodeCuller();
      const el = document.createElement("div");
      culler.observe(el, vi.fn());

      culler.dispose();

      expect(culler.getState().trackedCount).toBe(0);
    });

    it("sets disposed flag", () => {
      const culler = new NodeCuller();
      expect(culler.disposed).toBe(false);

      culler.dispose();
      expect(culler.disposed).toBe(true);
    });

    it("is safe to call multiple times", () => {
      const culler = new NodeCuller();
      culler.dispose();
      culler.dispose(); // Should not throw
      expect(latestObserver().disconnect).toHaveBeenCalledTimes(1);
    });

    it("cleanup functions are safe after dispose", () => {
      const culler = new NodeCuller();
      const el = document.createElement("div");
      const cleanup = culler.observe(el, vi.fn());

      culler.dispose();
      cleanup(); // Should not throw
    });
  });

  describe("getState()", () => {
    it("reports zero tracked count initially", () => {
      const culler = new NodeCuller();
      expect(culler.getState()).toEqual({
        trackedCount: 0,
        disposed: false,
      });
    });

    it("tracks observed elements", () => {
      const culler = new NodeCuller();
      culler.observe(document.createElement("div"), vi.fn());
      culler.observe(document.createElement("div"), vi.fn());

      expect(culler.getState().trackedCount).toBe(2);
    });

    it("decrements count on cleanup", () => {
      const culler = new NodeCuller();
      const cleanup = culler.observe(document.createElement("div"), vi.fn());
      culler.observe(document.createElement("div"), vi.fn());

      cleanup();

      expect(culler.getState().trackedCount).toBe(1);
    });
  });

  describe("multiple elements", () => {
    it("handles multiple elements with independent callbacks", () => {
      const culler = new NodeCuller();
      const el1 = document.createElement("div");
      const el2 = document.createElement("div");
      const cb1 = vi.fn();
      const cb2 = vi.fn();

      culler.observe(el1, cb1);
      culler.observe(el2, cb2);

      // Only el1 becomes visible
      latestObserver().trigger([makeEntry(el1, true)]);

      expect(cb1).toHaveBeenCalledWith(true);
      expect(cb2).not.toHaveBeenCalled();
    });

    it("handles batch intersection entries", () => {
      const culler = new NodeCuller();
      const el1 = document.createElement("div");
      const el2 = document.createElement("div");
      const cb1 = vi.fn();
      const cb2 = vi.fn();

      culler.observe(el1, cb1);
      culler.observe(el2, cb2);

      // Both fire in same batch
      latestObserver().trigger([
        makeEntry(el1, true),
        makeEntry(el2, false, 30),
      ]);

      expect(cb1).toHaveBeenCalledWith(true);
      expect(cb2).toHaveBeenCalledWith(false);
    });
  });
});
