// @vitest-environment jsdom
/**
 * Canary for tests/setup/preact-frame-leak-guard.ts.
 *
 * Renders a component with a state-setting `useEffect` outside `act()`, which
 * makes preact/hooks arm its real requestAnimationFrame/setTimeout(RAF_TIMEOUT)
 * after-paint fallback, and asserts the guard's bookkeeping sees exactly one
 * pending pair immediately after the render commits.
 *
 * This pins RAF_TIMEOUT to preact's actual behavior: if a preact upgrade
 * changes the internal delay the guard uses, this test fails loudly instead
 * of the guard silently never catching anything again.
 *
 * The test then waits out the real timer so the pair resolves (as it always
 * does, harmlessly, when nothing tears the environment down mid-flight)
 * before this file's own afterAll runs — otherwise this canary would trip
 * the very guard it is testing.
 */
import { describe, it, expect } from "vitest";
import { h, render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { RAF_TIMEOUT, getPendingFrameFallbackTimerCount } from "../../setup/preact-frame-leak-guard.js";

function Flicker() {
  const [, setTick] = useState(0);
  useEffect(() => {
    setTick((n) => n + 1);
  }, []);
  return h("div", null, "flicker");
}

describe("preact frame-fallback leak guard", () => {
  it("detects an unwrapped render arming the real fallback timer, and clears once it fires", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const before = getPendingFrameFallbackTimerCount();

    // Deliberately outside act(): this is the exact shape of leak the guard
    // exists to catch.
    render(h(Flicker, null), root);

    expect(getPendingFrameFallbackTimerCount()).toBe(before + 1);

    // Let the real fallback pair resolve on its own before this file's
    // afterAll runs, so this canary doesn't fail the guard it is testing.
    await new Promise((resolve) => setTimeout(resolve, RAF_TIMEOUT + 50));

    expect(getPendingFrameFallbackTimerCount()).toBe(before);

    root.remove();
  });
});
