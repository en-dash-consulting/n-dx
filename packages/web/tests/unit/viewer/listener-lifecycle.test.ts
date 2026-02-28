// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ListenerLifecycleManager,
} from "../../../src/viewer/components/prd-tree/listener-lifecycle.js";

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ListenerLifecycleManager", () => {
  describe("addListener()", () => {
    it("adds an event listener to the target", () => {
      const manager = new ListenerLifecycleManager();
      const el = document.createElement("div");
      const handler = vi.fn();

      manager.addListener("node-1", el, "click", handler);
      el.dispatchEvent(new Event("click"));

      expect(handler).toHaveBeenCalledOnce();
      manager.dispose();
    });

    it("tracks the listener in the scope", () => {
      const manager = new ListenerLifecycleManager();
      const el = document.createElement("div");

      manager.addListener("node-1", el, "click", vi.fn());

      expect(manager.hasScope("node-1")).toBe(true);
      expect(manager.getState().totalListeners).toBe(1);
      expect(manager.getState().activeScopeCount).toBe(1);
      manager.dispose();
    });

    it("supports multiple listeners per scope", () => {
      const manager = new ListenerLifecycleManager();
      const el = document.createElement("div");

      manager.addListener("node-1", el, "click", vi.fn());
      manager.addListener("node-1", el, "keydown", vi.fn());

      expect(manager.getState().totalListeners).toBe(2);
      expect(manager.getState().activeScopeCount).toBe(1);
      manager.dispose();
    });

    it("supports multiple scopes", () => {
      const manager = new ListenerLifecycleManager();
      const el1 = document.createElement("div");
      const el2 = document.createElement("div");

      manager.addListener("node-1", el1, "click", vi.fn());
      manager.addListener("node-2", el2, "click", vi.fn());

      expect(manager.getState().totalListeners).toBe(2);
      expect(manager.getState().activeScopeCount).toBe(2);
      manager.dispose();
    });

    it("returns a cleanup function that removes the listener", () => {
      const manager = new ListenerLifecycleManager();
      const el = document.createElement("div");
      const handler = vi.fn();

      const cleanup = manager.addListener("node-1", el, "click", handler);
      cleanup();
      el.dispatchEvent(new Event("click"));

      expect(handler).not.toHaveBeenCalled();
      expect(manager.hasScope("node-1")).toBe(false);
      expect(manager.getState().totalListeners).toBe(0);
    });

    it("cleanup is idempotent — safe to call multiple times", () => {
      const manager = new ListenerLifecycleManager();
      const el = document.createElement("div");
      const handler = vi.fn();

      const cleanup = manager.addListener("node-1", el, "click", handler);
      cleanup();
      cleanup(); // second call — should not throw

      expect(manager.getState().totalListeners).toBe(0);
      manager.dispose();
    });

    it("cleanup only removes the specific listener, not the whole scope", () => {
      const manager = new ListenerLifecycleManager();
      const el = document.createElement("div");
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      const cleanup1 = manager.addListener("node-1", el, "click", handler1);
      manager.addListener("node-1", el, "keydown", handler2);

      cleanup1();

      expect(manager.getState().totalListeners).toBe(1);
      expect(manager.hasScope("node-1")).toBe(true);

      // handler1 should not fire, handler2 should
      el.dispatchEvent(new Event("click"));
      el.dispatchEvent(new Event("keydown"));
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledOnce();

      manager.dispose();
    });

    it("is a no-op after dispose", () => {
      const manager = new ListenerLifecycleManager();
      manager.dispose();

      const el = document.createElement("div");
      const handler = vi.fn();
      const cleanup = manager.addListener("node-1", el, "click", handler);

      expect(typeof cleanup).toBe("function");
      cleanup(); // should not throw
      el.dispatchEvent(new Event("click"));
      expect(handler).not.toHaveBeenCalled();
      expect(manager.getState().totalListeners).toBe(0);
    });

    it("passes options to addEventListener", () => {
      const manager = new ListenerLifecycleManager();
      const el = document.createElement("div");
      const addSpy = vi.spyOn(el, "addEventListener");
      const handler = vi.fn();

      manager.addListener("node-1", el, "click", handler, { capture: true, passive: true });

      expect(addSpy).toHaveBeenCalledWith("click", handler, { capture: true, passive: true });
      manager.dispose();
    });
  });

  describe("cleanupScope()", () => {
    it("removes all listeners for a scope", () => {
      const manager = new ListenerLifecycleManager();
      const el = document.createElement("div");
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      manager.addListener("node-1", el, "click", handler1);
      manager.addListener("node-1", el, "keydown", handler2);

      manager.cleanupScope("node-1");

      el.dispatchEvent(new Event("click"));
      el.dispatchEvent(new Event("keydown"));

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
      expect(manager.hasScope("node-1")).toBe(false);
      expect(manager.getState().totalListeners).toBe(0);
    });

    it("does not affect other scopes", () => {
      const manager = new ListenerLifecycleManager();
      const el1 = document.createElement("div");
      const el2 = document.createElement("div");
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      manager.addListener("node-1", el1, "click", handler1);
      manager.addListener("node-2", el2, "click", handler2);

      manager.cleanupScope("node-1");

      el2.dispatchEvent(new Event("click"));

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledOnce();
      expect(manager.getState().activeScopeCount).toBe(1);

      manager.dispose();
    });

    it("is a no-op for unknown scopes", () => {
      const manager = new ListenerLifecycleManager();
      manager.cleanupScope("nonexistent"); // should not throw
      expect(manager.getState().totalListeners).toBe(0);
    });

    it("is safe to call on an already cleaned-up scope", () => {
      const manager = new ListenerLifecycleManager();
      const el = document.createElement("div");

      manager.addListener("node-1", el, "click", vi.fn());
      manager.cleanupScope("node-1");
      manager.cleanupScope("node-1"); // second call — should not throw

      expect(manager.getState().totalListeners).toBe(0);
    });
  });

  describe("hasScope()", () => {
    it("returns false for empty/unknown scopes", () => {
      const manager = new ListenerLifecycleManager();
      expect(manager.hasScope("nonexistent")).toBe(false);
    });

    it("returns true when scope has listeners", () => {
      const manager = new ListenerLifecycleManager();
      const el = document.createElement("div");

      manager.addListener("node-1", el, "click", vi.fn());
      expect(manager.hasScope("node-1")).toBe(true);

      manager.dispose();
    });

    it("returns false after scope cleanup", () => {
      const manager = new ListenerLifecycleManager();
      const el = document.createElement("div");

      manager.addListener("node-1", el, "click", vi.fn());
      manager.cleanupScope("node-1");

      expect(manager.hasScope("node-1")).toBe(false);
    });
  });

  describe("dispose()", () => {
    it("removes all listeners across all scopes", () => {
      const manager = new ListenerLifecycleManager();
      const el1 = document.createElement("div");
      const el2 = document.createElement("div");
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      manager.addListener("node-1", el1, "click", handler1);
      manager.addListener("node-2", el2, "click", handler2);

      manager.dispose();

      el1.dispatchEvent(new Event("click"));
      el2.dispatchEvent(new Event("click"));

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });

    it("sets disposed flag", () => {
      const manager = new ListenerLifecycleManager();
      expect(manager.disposed).toBe(false);

      manager.dispose();
      expect(manager.disposed).toBe(true);
    });

    it("clears all tracked state", () => {
      const manager = new ListenerLifecycleManager();
      const el = document.createElement("div");

      manager.addListener("node-1", el, "click", vi.fn());
      manager.addListener("node-2", el, "keydown", vi.fn());

      manager.dispose();

      expect(manager.getState().totalListeners).toBe(0);
      expect(manager.getState().activeScopeCount).toBe(0);
    });

    it("is safe to call multiple times", () => {
      const manager = new ListenerLifecycleManager();
      manager.dispose();
      manager.dispose(); // should not throw
      expect(manager.disposed).toBe(true);
    });

    it("individual cleanups are safe after dispose", () => {
      const manager = new ListenerLifecycleManager();
      const el = document.createElement("div");
      const cleanup = manager.addListener("node-1", el, "click", vi.fn());

      manager.dispose();
      cleanup(); // should not throw
    });
  });

  describe("getState()", () => {
    it("reports zero state initially", () => {
      const manager = new ListenerLifecycleManager();
      expect(manager.getState()).toEqual({
        totalListeners: 0,
        activeScopeCount: 0,
        disposed: false,
      });
    });

    it("reflects current listener count", () => {
      const manager = new ListenerLifecycleManager();
      const el = document.createElement("div");

      manager.addListener("node-1", el, "click", vi.fn());
      manager.addListener("node-1", el, "keydown", vi.fn());
      manager.addListener("node-2", el, "click", vi.fn());

      expect(manager.getState()).toEqual({
        totalListeners: 3,
        activeScopeCount: 2,
        disposed: false,
      });

      manager.dispose();
    });

    it("updates after cleanup operations", () => {
      const manager = new ListenerLifecycleManager();
      const el = document.createElement("div");

      manager.addListener("node-1", el, "click", vi.fn());
      manager.addListener("node-2", el, "click", vi.fn());
      manager.addListener("node-3", el, "click", vi.fn());

      manager.cleanupScope("node-2");

      expect(manager.getState()).toEqual({
        totalListeners: 2,
        activeScopeCount: 2,
        disposed: false,
      });

      manager.dispose();
    });

    it("reports disposed state", () => {
      const manager = new ListenerLifecycleManager();
      manager.dispose();

      expect(manager.getState().disposed).toBe(true);
    });
  });

  describe("listener count proportionality", () => {
    it("listener count grows linearly with nodes", () => {
      const manager = new ListenerLifecycleManager();

      // Simulate 100 nodes each with 2 listeners
      for (let i = 0; i < 100; i++) {
        const el = document.createElement("div");
        manager.addListener(`node-${i}`, el, "click", vi.fn());
        manager.addListener(`node-${i}`, el, "keydown", vi.fn());
      }

      expect(manager.getState().totalListeners).toBe(200);
      expect(manager.getState().activeScopeCount).toBe(100);

      manager.dispose();
    });

    it("listener count decreases proportionally when scopes are cleaned up", () => {
      const manager = new ListenerLifecycleManager();

      // Create 50 nodes
      for (let i = 0; i < 50; i++) {
        const el = document.createElement("div");
        manager.addListener(`node-${i}`, el, "click", vi.fn());
      }

      expect(manager.getState().totalListeners).toBe(50);

      // Clean up half (simulate culling 25 nodes)
      for (let i = 0; i < 25; i++) {
        manager.cleanupScope(`node-${i}`);
      }

      expect(manager.getState().totalListeners).toBe(25);
      expect(manager.getState().activeScopeCount).toBe(25);

      manager.dispose();
    });

    it("remains stable during simulated scroll (cull/uncull cycles)", () => {
      const manager = new ListenerLifecycleManager();
      const elements = new Map<string, HTMLElement>();

      // Create initial visible set (20 nodes)
      for (let i = 0; i < 20; i++) {
        const el = document.createElement("div");
        elements.set(`node-${i}`, el);
        manager.addListener(`node-${i}`, el, "click", vi.fn());
      }

      expect(manager.getState().totalListeners).toBe(20);

      // Simulate scrolling: cull top 10, add 10 new at bottom
      for (let i = 0; i < 10; i++) {
        manager.cleanupScope(`node-${i}`);
      }
      for (let i = 20; i < 30; i++) {
        const el = document.createElement("div");
        elements.set(`node-${i}`, el);
        manager.addListener(`node-${i}`, el, "click", vi.fn());
      }

      // Should still be 20 (10 removed, 10 added)
      expect(manager.getState().totalListeners).toBe(20);

      // Simulate scrolling back: cull bottom 10, re-add top 10
      for (let i = 20; i < 30; i++) {
        manager.cleanupScope(`node-${i}`);
      }
      for (let i = 0; i < 10; i++) {
        const el = elements.get(`node-${i}`)!;
        manager.addListener(`node-${i}`, el, "click", vi.fn());
      }

      // Should still be 20
      expect(manager.getState().totalListeners).toBe(20);

      manager.dispose();
    });
  });
});
