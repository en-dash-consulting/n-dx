import { afterAll } from "vitest";

/**
 * preact/hooks' `afterNextFrame` after-paint fallback (minified as `A()` in
 * the published `preact/hooks` dist; unminified source at
 * node_modules/preact/hooks/src/index.js names the constant `RAF_TIMEOUT`)
 * arms a real `requestAnimationFrame` plus a `setTimeout(fn, RAF_TIMEOUT)`
 * fallback pair whenever a commit queues effects and `options.requestAnimationFrame`
 * has not been overridden. `preact/test-utils`' `act()` overrides that option
 * to flush synchronously instead, so a render/update/unmount committed inside
 * act() never arms this pair at all.
 *
 * A render committed *outside* act() does arm it. If the pair is still
 * outstanding when the test file's environment is torn down, whichever half
 * fires later runs against globals that no longer exist (`ReferenceError:
 * cancelAnimationFrame is not defined`), non-deterministically failing a
 * *later*, unrelated test file in the same worker.
 *
 * This module tracks every `setTimeout` scheduled with exactly this delay and
 * fails the file in `afterAll` if any are still pending — i.e. never fired,
 * never cleared — by the time the file finishes. A pair that fires before
 * `afterAll` is harmless (preact's own callback removes it), so this checks
 * "still pending", not "ever scheduled".
 *
 * Fix a failure by committing the offending render/update/unmount inside
 * `act()` from "preact/test-utils" — see
 * packages/web/tests/helpers/preact-test-support.ts for the shared helper.
 *
 * Only jsdom files can leak this way (there is no document to render into
 * under the "node" environment), so this guard is a no-op there.
 */
export const RAF_TIMEOUT = 35;

const isJsdomEnvironment = typeof window !== "undefined" && typeof document !== "undefined";

const pendingFrameFallbackTimers = new Set<ReturnType<typeof setTimeout>>();

/** Test-only introspection for the canary test — not used by production code. */
export function getPendingFrameFallbackTimerCount(): number {
  return pendingFrameFallbackTimers.size;
}

if (isJsdomEnvironment) {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;

  const patchedSetTimeout = (
    handler: (...args: unknown[]) => void,
    timeout?: number,
    ...args: unknown[]
  ): ReturnType<typeof setTimeout> => {
    let id!: ReturnType<typeof setTimeout>;
    const wrapped = (...callbackArgs: unknown[]): void => {
      // A fired timer is no longer pending, whether or not it ever gets
      // cleared afterwards (preact's own callback does clear it, but that
      // race isn't ours to depend on).
      pendingFrameFallbackTimers.delete(id);
      handler(...callbackArgs);
    };
    id = realSetTimeout(wrapped, timeout, ...args);
    if (timeout === RAF_TIMEOUT) {
      pendingFrameFallbackTimers.add(id);
    }
    return id;
  };
  globalThis.setTimeout = patchedSetTimeout as unknown as typeof globalThis.setTimeout;

  const patchedClearTimeout = (id?: Parameters<typeof clearTimeout>[0]): void => {
    if (id !== undefined) {
      pendingFrameFallbackTimers.delete(id as ReturnType<typeof setTimeout>);
    }
    realClearTimeout(id as never);
  };
  globalThis.clearTimeout = patchedClearTimeout as unknown as typeof globalThis.clearTimeout;

  afterAll(({}, suite) => {
    const count = pendingFrameFallbackTimers.size;
    if (count === 0) return;
    const file = "filepath" in suite ? suite.filepath : suite.name;
    throw new Error(
      `${file}: ${count} preact frame-fallback timer(s) (setTimeout(fn, ${RAF_TIMEOUT})) ` +
        `still pending at afterAll. A render, update, or unmount in this file committed ` +
        `outside act(), so preact's real requestAnimationFrame/setTimeout(${RAF_TIMEOUT}) ` +
        `after-paint fallback armed instead of flushing synchronously. If it fires after ` +
        `this file's jsdom environment is torn down it throws "ReferenceError: ` +
        `cancelAnimationFrame is not defined" in a later, unrelated file. Fix: wrap the ` +
        `offending render/update/unmount in act() from "preact/test-utils" (see ` +
        `packages/web/tests/helpers/preact-test-support.ts).`,
    );
  });
}
