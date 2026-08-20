import { describe, it, expect } from "vitest";
import {
  InterruptForwarder,
  forwardsInterrupts,
  type InterruptHost,
} from "../../src/interrupt-forwarding.js";
import { treeKillSpawnOptions } from "../../src/process-tree.js";

/**
 * Ctrl-C has to reach a detached child.
 *
 * `exec` spawns with `detached: true` on POSIX so a timeout can kill the whole
 * group. That same option takes the child OUT of the terminal's foreground
 * group, so the terminal's Ctrl-C stops reaching it — the child kept running
 * with nothing but the parent's death to end it. This forwards the interrupt
 * across that gap.
 *
 * The host is injected throughout: the assertions are about what gets signalled
 * and when the listener exists, and a test that used the real `process` for the
 * sole-listener case would kill the test runner.
 */

interface Sent {
  pid: number;
  signal: NodeJS.Signals;
}

/** A stand-in for `process`, recording what would have been signalled. */
function fakeHost(opts: { pid?: number; failFor?: number[] } = {}) {
  // An array, not a Set: EventEmitter keeps duplicates of the same function, and
  // a Set would silently de-duplicate the very case worth testing.
  let listeners: Array<() => void> = [];
  const sent: Sent[] = [];

  const host: InterruptHost = {
    pid: opts.pid ?? 4242,
    on(_signal, listener) {
      listeners.push(listener);
    },
    removeListener(_signal, listener) {
      const at = listeners.indexOf(listener);
      if (at !== -1) listeners.splice(at, 1);
    },
    listeners(_signal) {
      return [...listeners];
    },
    kill(pid, signal) {
      if (opts.failFor?.includes(pid)) throw new Error("ESRCH");
      sent.push({ pid, signal });
    },
  };

  return {
    host,
    sent,
    count: (): number => listeners.length,
    /** Deliver the signal the way the runtime would. */
    raise: (): void => {
      for (const listener of [...listeners]) listener();
    },
    /** An unrelated SIGINT handler, i.e. a caller that owns its own shutdown. */
    addForeignListener: (): void => host.on("SIGINT", () => {}),
    /**
     * What hench's prompt shim does: snapshot every listener, drop them for the
     * duration of a readline prompt, then add them all back.
     */
    cycleThroughPromptShim: (): void => {
      const saved = [...listeners];
      listeners = [];
      for (const listener of saved) host.on("SIGINT", listener);
    },
  };
}

describe("forwardsInterrupts", () => {
  it("is true exactly when the child was detached into its own group", () => {
    expect(forwardsInterrupts({ detached: true })).toBe(true);
    expect(forwardsInterrupts({})).toBe(false);
    expect(forwardsInterrupts({ detached: false })).toBe(false);
  });

  // The decision must track the spawn options actually used, not a second
  // platform check — that is how the two drift apart.
  it("follows treeKillSpawnOptions per platform", () => {
    expect(forwardsInterrupts(treeKillSpawnOptions("linux"))).toBe(true);
    expect(forwardsInterrupts(treeKillSpawnOptions("darwin"))).toBe(true);
    // Windows never detaches for tree-kill (taskkill walks by pid), so there is
    // no group gap to bridge and nothing to forward.
    expect(forwardsInterrupts(treeKillSpawnOptions("win32"))).toBe(false);
  });
});

describe("InterruptForwarder", () => {
  it("signals the child's whole group, not just the child", () => {
    const h = fakeHost();
    new InterruptForwarder({ host: h.host }).register(1234);

    h.raise();

    // Negative pid is the group. Signalling 1234 alone would leave the
    // grandchildren that made detached necessary in the first place.
    expect(h.sent).toContainEqual({ pid: -1234, signal: "SIGINT" });
  });

  it("holds one listener no matter how many children are registered", () => {
    const h = fakeHost();
    const forwarder = new InterruptForwarder({ host: h.host });

    const releases = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((pid) => forwarder.register(pid));

    // Node warns past 10 listeners on one signal, and an agent easily runs more
    // than 10 commands. One shared listener keeps that from ever being reached.
    expect(h.count()).toBe(1);

    for (const release of releases) release();
    expect(h.count()).toBe(0);
  });

  // The cases below add a foreign listener so the forwarding assertions stay
  // clear of the stand-down-and-re-raise policy, which has its own cases.
  it("forwards to every live child at once", () => {
    const h = fakeHost();
    const forwarder = new InterruptForwarder({ host: h.host });
    h.addForeignListener();
    forwarder.register(100);
    forwarder.register(200);

    h.raise();

    expect(h.sent).toEqual([
      { pid: -100, signal: "SIGINT" },
      { pid: -200, signal: "SIGINT" },
    ]);
  });

  it("keeps going when a group has already exited", () => {
    // A group that died between registration and Ctrl-C throws ESRCH. That is a
    // normal race, not a reason to leave the surviving children running.
    const h = fakeHost({ failFor: [-100] });
    const forwarder = new InterruptForwarder({ host: h.host });
    h.addForeignListener();
    forwarder.register(100);
    forwarder.register(200);

    expect(() => h.raise()).not.toThrow();
    expect(h.sent).toEqual([{ pid: -200, signal: "SIGINT" }]);
  });

  it("stops forwarding to a child once it is released", () => {
    const h = fakeHost();
    const forwarder = new InterruptForwarder({ host: h.host });
    h.addForeignListener();
    const release = forwarder.register(100);
    forwarder.register(200);

    release();
    h.raise();

    expect(h.sent).toEqual([{ pid: -200, signal: "SIGINT" }]);
  });

  it("removes its listener once the last child is released", () => {
    const h = fakeHost();
    const forwarder = new InterruptForwarder({ host: h.host });
    const first = forwarder.register(100);
    const second = forwarder.register(200);

    expect(h.count()).toBe(1);
    first();
    expect(h.count()).toBe(1);
    second();

    // Leaving it installed would keep suppressing the runtime's default SIGINT
    // action for the rest of the process's life, long after any child is gone.
    expect(h.count()).toBe(0);
  });

  it("tolerates a release being called twice", () => {
    const h = fakeHost();
    const forwarder = new InterruptForwarder({ host: h.host });
    h.addForeignListener();
    const release = forwarder.register(100);
    forwarder.register(200);

    release();
    release();

    // The second call must not drop an unrelated child's registration by
    // emptying the set — exec calls release from more than one settle path.
    h.raise();
    expect(h.sent).toEqual([{ pid: -200, signal: "SIGINT" }]);
  });

  it("re-raises on itself when it is the only SIGINT listener", () => {
    const h = fakeHost({ pid: 999 });
    const forwarder = new InterruptForwarder({ host: h.host });
    forwarder.register(100);

    h.raise();

    // Attaching any listener suppresses the runtime's default "die on SIGINT".
    // With no other listener, that suppression is ours alone and would leave a
    // CLI ignoring Ctrl-C — a worse bug than the one being fixed. So: stand
    // down, then re-raise so the default action runs.
    expect(h.count()).toBe(0);
    expect(h.sent).toEqual([
      { pid: -100, signal: "SIGINT" },
      { pid: 999, signal: "SIGINT" },
    ]);
  });

  it("leaves the parent's fate alone when another listener exists", () => {
    const h = fakeHost({ pid: 999 });
    const forwarder = new InterruptForwarder({ host: h.host });
    forwarder.register(100);
    h.addForeignListener();

    h.raise();

    // hench's run-loop and core's cli.js both install SIGINT handlers for
    // graceful cancellation. Re-raising would pre-empt them.
    expect(h.sent).toEqual([{ pid: -100, signal: "SIGINT" }]);
    expect(h.count()).toBe(2);
  });

  // hench opens readline prompts between tool calls, and its shim snapshots and
  // re-adds every SIGINT listener around one. A forwarder that trusted an
  // internal "installed" flag, or that counted listeners instead of identifying
  // them, would come out of that with a duplicate — and would then read its own
  // second copy as another owner and stop re-raising. Ctrl-C would go quiet
  // again, which is the whole bug.
  describe("through hench's prompt shim", () => {
    it("does not accumulate a duplicate of itself", () => {
      const h = fakeHost();
      const forwarder = new InterruptForwarder({ host: h.host });
      const release = forwarder.register(100);

      h.cycleThroughPromptShim();
      forwarder.register(200);

      expect(h.count()).toBe(1);

      h.raise();
      // Once each, not twice.
      expect(h.sent.filter((s) => s.pid === -100)).toHaveLength(1);
      expect(h.sent.filter((s) => s.pid === -200)).toHaveLength(1);

      release();
    });

    it("still re-raises when its own copy is the only listener", () => {
      const h = fakeHost({ pid: 999 });
      const forwarder = new InterruptForwarder({ host: h.host });
      forwarder.register(100);
      h.cycleThroughPromptShim();

      h.raise();

      expect(h.sent).toContainEqual({ pid: 999, signal: "SIGINT" });
      expect(h.count()).toBe(0);
    });

    it("leaves nothing behind when a child settles mid-prompt", () => {
      const h = fakeHost();
      const forwarder = new InterruptForwarder({ host: h.host });
      const release = forwarder.register(100);

      // Child settles while the prompt holds the listeners, so the release runs
      // against a host that has none — then the shim puts ours back.
      release();
      h.cycleThroughPromptShim();
      forwarder.register(200)();

      expect(h.count()).toBe(0);
    });
  });

  it("re-installs for a later child after standing down", () => {
    const h = fakeHost();
    const forwarder = new InterruptForwarder({ host: h.host });
    const release = forwarder.register(100);
    release();
    expect(h.count()).toBe(0);

    forwarder.register(200);
    expect(h.count()).toBe(1);

    h.raise();
    expect(h.sent).toContainEqual({ pid: -200, signal: "SIGINT" });
  });
});
