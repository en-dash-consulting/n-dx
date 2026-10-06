import { describe, it, expect } from "vitest";
import { WorkspaceBinding, type RexWorkspace } from "../../../src/cli/mcp-workspace.js";

/** Only the fields the binding reads; the stores are never touched here. */
const startup = { projectDir: "/repo", startupDir: "/repo", source: "startup" } as RexWorkspace;

describe("WorkspaceBinding", () => {
  it("serves a fixed workspace without waiting", async () => {
    await expect(WorkspaceBinding.fixed(startup).ready()).resolves.toBe(startup);
  });

  it("holds calls until the client initializes without roots", async () => {
    const binding = WorkspaceBinding.tracking(startup, { log: () => {}, waitMs: 60_000 });
    let served = false;
    const call = binding.ready().then(() => { served = true; });
    await Promise.resolve();
    expect(served).toBe(false);
    binding.settleWithoutRoots();
    await call;
    expect(served).toBe(true);
  });

  it("bounds the wait, logs once, and stops waiting afterwards", async () => {
    const lines: string[] = [];
    const binding = WorkspaceBinding.tracking(startup, { log: (l) => lines.push(l), waitMs: 10 });

    await expect(binding.ready()).resolves.toBe(startup);
    await expect(binding.ready()).resolves.toBe(startup);
    expect(lines).toEqual(["rex mcp: client roots not resolved within 10ms; serving /repo"]);
  });

  it("keeps the startup workspace when roots/list fails", async () => {
    const lines: string[] = [];
    const binding = WorkspaceBinding.tracking(startup, { log: (l) => lines.push(l) });

    await binding.resolve(async () => { throw new Error("no answer"); });
    await expect(binding.ready()).resolves.toBe(startup);
    expect(lines).toEqual(["rex mcp: could not read the client's roots (no answer); serving /repo"]);
  });
});
