/**
 * The BETA experimental flag bridge: project setting -> child environment.
 *
 * `experimental.posixFreezeTreeKill` is read from `.n-dx.json` by the
 * orchestration tier and forwarded to sub-CLIs as `NDX_POSIX_FREEZE_KILL`, because
 * the foundation code that acts on it (llm-client's `exec`) must not read project
 * config itself and runs in a different process.
 *
 * Tested as a pure function rather than by spawning: the earlier shape kept the
 * decision inline in cli.js, where it could not be asserted without launching a
 * child and inspecting its environment.
 */
import { describe, it, expect } from "vitest";
import { experimentalEnv } from "../../packages/core/config.js";

describe("experimentalEnv", () => {
  it("adds nothing when no experimental flags are set", () => {
    expect(experimentalEnv({})).toEqual({});
    expect(experimentalEnv({ experimental: {} })).toEqual({});
    expect(experimentalEnv(undefined)).toEqual({});
    expect(experimentalEnv({ web: { port: 3117 } })).toEqual({});
  });

  it("forwards the freeze-tree-kill flag only when explicitly true", () => {
    expect(experimentalEnv({ experimental: { posixFreezeTreeKill: true } })).toEqual({
      NDX_POSIX_FREEZE_KILL: "1",
    });
    expect(experimentalEnv({ experimental: { posixFreezeTreeKill: false } })).toEqual({});
  });

  it("does not accept a truthy string as enabled", () => {
    // An experimental, default-off switch should need a deliberate boolean. A
    // stray "false" string would otherwise turn the feature ON, which is the
    // worst possible reading of a config typo.
    expect(experimentalEnv({ experimental: { posixFreezeTreeKill: "true" } })).toEqual({});
    expect(experimentalEnv({ experimental: { posixFreezeTreeKill: "false" } })).toEqual({});
    expect(experimentalEnv({ experimental: { posixFreezeTreeKill: 1 } })).toEqual({});
  });

  it("is documented in `ndx config --help` with its beta status", async () => {
    // The flag exists so operators can opt in knowingly. If it is not discoverable
    // and not marked untested, the marker is doing no work.
    const { readFile } = await import("node:fs/promises");
    const help = await readFile(
      new URL("../../packages/core/config.js", import.meta.url),
      "utf-8",
    );
    expect(help).toContain("experimental.posixFreezeTreeKill");
    expect(help).toContain("BETA");
    expect(help).toContain("NOT RIGOROUSLY TESTED");
  });
});
