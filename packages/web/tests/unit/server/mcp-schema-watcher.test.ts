import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

class FakeWatcher extends EventEmitter {
  close = vi.fn();
}

const created: FakeWatcher[] = [];

vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  existsSync: () => true,
  watch: () => {
    const w = new FakeWatcher();
    created.push(w);
    return w;
  },
}));

// Resolve the packages without needing their dist/ to be built.
vi.mock("node:module", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:module")>()),
  createRequire: () => ({ resolve: (pkg: string) => `/fake/${pkg}/dist/public.js` }),
}));

const { startMcpSchemaWatcher } = await import("../../../src/server/mcp-schema-watcher.js");

describe("startMcpSchemaWatcher", () => {
  afterEach(() => {
    created.length = 0;
    vi.restoreAllMocks();
  });

  it("gives every watcher an 'error' listener", () => {
    const watchers = startMcpSchemaWatcher();
    expect(watchers.length).toBeGreaterThan(0);
    for (const w of watchers) expect(w.listenerCount("error")).toBeGreaterThan(0);
  });

  it("closes a watcher that errors, drops it from the list and does not throw", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const watchers = startMcpSchemaWatcher();
    const before = watchers.length;
    const failing = created[0];

    expect(() => failing.emit("error", new Error("EPERM"))).not.toThrow();

    expect(failing.close).toHaveBeenCalledTimes(1);
    expect(watchers).toHaveLength(before - 1);
    expect(watchers as unknown[]).not.toContain(failing);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("EPERM"));
    // The other watcher is untouched.
    for (const other of created.slice(1)) expect(other.close).not.toHaveBeenCalled();
  });
});
