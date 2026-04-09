import { vi } from "vitest";

export function simulateVisibilityChange(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    writable: true,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

export function setDocumentVisibility(state: string): void {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    writable: true,
    configurable: true,
  });
}

export function createRafController(now: () => number = () => performance.now()) {
  let callbacks: Array<(time: number) => void> = [];
  let rafIdCounter = 0;

  return {
    requestAnimationFrame(cb: (time: number) => void): number {
      callbacks.push(cb);
      return ++rafIdCounter;
    },
    cancelAnimationFrame(_id: number): void {
      // Tests currently exercise one pending frame at a time.
    },
    flush(): void {
      const pending = callbacks;
      callbacks = [];
      for (const cb of pending) {
        cb(now());
      }
    },
    getPendingCount(): number {
      return callbacks.length;
    },
    reset(): void {
      callbacks = [];
      rafIdCounter = 0;
    },
  };
}

export function installTestRaf(
  controller = createRafController(),
): typeof controller {
  controller.reset();
  vi.stubGlobal("requestAnimationFrame", controller.requestAnimationFrame);
  vi.stubGlobal("cancelAnimationFrame", controller.cancelAnimationFrame);
  return controller;
}
