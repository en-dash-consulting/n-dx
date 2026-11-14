/**
 * The two confined spawn sites that hench starts itself — the vendor CLI
 * session and a confined `execRepoShellCmd` — must clear a stale slot holder
 * from the host before the child starts, and hand it the host-resolved slot
 * directory. The vendor session, Codex's included, waits for a host lookup
 * still running (abortably) and falls through with one warning on a failure.
 * Both spawns are stubbed, so the order is observed directly.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

const { events, spawnCli, exec } = vi.hoisted(() => {
  const events: string[] = [];
  return {
    events,
    spawnCli: vi.fn(),
    exec: vi.fn(async () => {
      events.push("spawn");
      return { stdout: "", stderr: "", exitCode: 0, error: null, launched: true };
    }),
  };
});
vi.mock("../../../src/prd/llm-gateway.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../src/prd/llm-gateway.js")>(),
  spawnCli,
}));
vi.mock("../../../src/process/exec.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../src/process/exec.js")>(),
  exec,
}));

import { spawnWithAdapter, type SpawnWithAdapterOptions } from "../../../src/agent/lifecycle/cli-loop.js";
import { claudeCliAdapter } from "../../../src/agent/lifecycle/adapters/claude-cli-adapter.js";
import { codexCliAdapter } from "../../../src/agent/lifecycle/adapters/codex-cli-adapter.js";
import type { VendorAdapter } from "../../../src/agent/lifecycle/vendor-adapter.js";
import { execRepoShellCmd } from "../../../src/guard/sandbox.js";
import { VALIDATION_SLOT_DIR_ENV, VALIDATION_SLOT_ENV } from "../../../src/process/validation-slot.js";
import {
  HostIdentityLookupError,
  peekValidationSlotDir,
  type HostIdentity,
  type HostIdentityCache,
} from "../../../src/process/validation-slot-dir.js";

const seatbelt = { name: "seatbelt" as const, available: true };
const on = { mode: "on" as const, toolNetwork: "none" as const, source: "default" as const };
const IDENTITY: HostIdentity = { kind: "machine", id: "0123456789abcdef0123456789abcdef" };
const known = Object.assign(async () => IDENTITY, { peek: () => IDENTITY });

/** A reclaim that finishes a tick later: a spawn that does not await it starts first. */
const slowReclaim = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  events.push("reclaim");
};

const made: string[] = [];
function tempProject(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "hench-pre-spawn-")));
  made.push(dir);
  return dir;
}

afterEach(() => {
  events.length = 0;
  vi.clearAllMocks();
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Seatbelt profiles are built from real POSIX paths; there is no backend on Windows. */
const posixOnly = describe.skipIf(process.platform === "win32");

posixOnly("confined execRepoShellCmd", () => {
  it("clears a stale holder before the command spawns, and hands it the host-resolved slot directory", async () => {
    const ndxHome = tempProject();
    const hostEnv = { NDX_HOME: ndxHome, PATH: process.env.PATH };
    await execRepoShellCmd("true", { cwd: tempProject(), timeout: 10_000, env: { PATH: process.env.PATH } }, {
      setting: on, backend: seatbelt, env: hostEnv, reclaimSlot: slowReclaim, hostIdentity: known,
    });
    expect(events).toEqual(["reclaim", "spawn"]);
    const env = (exec.mock.calls[0] as unknown[])[2] as { env: NodeJS.ProcessEnv };
    expect(env.env[VALIDATION_SLOT_DIR_ENV]).toBe(peekValidationSlotDir(hostEnv, known));
    expect(env.env[VALIDATION_SLOT_DIR_ENV]).toContain(ndxHome);
    expect(env.env[VALIDATION_SLOT_ENV]).toBeUndefined();
  });

  it("keeps the slot directory a holder handed the command", async () => {
    const holderDir = join(tempProject(), "holder-slot");
    const base = { PATH: process.env.PATH, [VALIDATION_SLOT_ENV]: "token", [VALIDATION_SLOT_DIR_ENV]: holderDir };
    await execRepoShellCmd("true", { cwd: tempProject(), timeout: 10_000, env: base }, {
      setting: on, backend: seatbelt, reclaimSlot: async () => {}, hostIdentity: known,
    });
    const env = (exec.mock.calls[0] as unknown[])[2] as { env: NodeJS.ProcessEnv };
    expect(env.env[VALIDATION_SLOT_DIR_ENV]).toBe(holderDir);
    expect(env.env[VALIDATION_SLOT_ENV]).toBe("token");
  });
});

/**
 * A host identity cache whose lookup is still running when the spawn begins:
 * `peek` sees nothing until a caller awaits the lookup, which then resolves
 * a little later. A spawn that only peeks never gets the identity, whatever
 * the timing.
 */
function slowIdentity(): HostIdentityCache {
  let resolved: HostIdentity | undefined;
  const lookup = async (): Promise<HostIdentity> => {
    await new Promise((r) => setTimeout(r, 10));
    events.push("identity");
    resolved = IDENTITY;
    return IDENTITY;
  };
  return Object.assign(lookup, { peek: () => resolved });
}

function stubChild(): void {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), pid: 123,
  });
  spawnCli.mockImplementation(() => {
    events.push("spawn");
    queueMicrotask(() => child.emit("close", 0));
    return child;
  });
}

function spawnOptions(
  adapter: VendorAdapter,
  vendor: string,
  extra: Partial<SpawnWithAdapterOptions>,
): SpawnWithAdapterOptions {
  const project = tempProject();
  return {
    adapter,
    spawnConfig: { binary: vendor, args: [], env: {}, stdinContent: null, cwd: project },
    cliBinary: process.execPath, cwd: project, tokenMetadata: { vendor, model: "m" },
    cliEnv: { PATH: process.env.PATH },
    ...extra,
  };
}

const spawnedEnv = (): NodeJS.ProcessEnv => spawnCli.mock.calls[0][2].env;
const hostSlotDir = (): string | undefined => peekValidationSlotDir(process.env, known);

posixOnly("vendor CLI spawn", () => {
  it("clears a stale holder before the CLI spawns, and hands the session the host-resolved slot directory", async () => {
    stubChild();
    await spawnWithAdapter(spawnOptions(claudeCliAdapter, "claude", {
      vendorSandbox: { setting: on, backend: seatbelt, reclaimSlot: slowReclaim, hostIdentity: known },
    }));
    expect(events).toEqual(["reclaim", "spawn"]);
    expect(spawnedEnv()[VALIDATION_SLOT_DIR_ENV]).toBe(hostSlotDir());
    expect(spawnedEnv()[VALIDATION_SLOT_ENV]).toBeUndefined();
  });

  it("waits for a host lookup still running when the spawn begins, then hands the session the directory", async () => {
    stubChild();
    const identity = slowIdentity();
    await spawnWithAdapter(spawnOptions(claudeCliAdapter, "claude", {
      vendorSandbox: { setting: on, backend: seatbelt, reclaimSlot: slowReclaim, hostIdentity: identity },
    }));
    expect(events).toEqual(["identity", "reclaim", "spawn"]);
    expect(spawnedEnv()[VALIDATION_SLOT_DIR_ENV]).toBe(hostSlotDir());
  });

  it("does not spawn when the run is aborted during that wait", async () => {
    stubChild();
    const never = Object.assign(() => new Promise<HostIdentity>(() => {}), { peek: () => undefined });
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error("stopped by the operator")), 20);
    const result = await spawnWithAdapter(spawnOptions(claudeCliAdapter, "claude", {
      abortSignal: controller.signal,
      vendorSandbox: { setting: on, backend: seatbelt, reclaimSlot: async () => {}, hostIdentity: never },
    }));
    expect(spawnCli).not.toHaveBeenCalled();
    expect(result.aborted?.reason).toContain("stopped by the operator");
  });

  it("spawns without the directory, warning once, when the lookup fails transiently", async () => {
    stubChild();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const failing = Object.assign(
      () => Promise.reject(new HostIdentityLookupError("running ioreg", "timed out")),
      { peek: () => undefined },
    );
    try {
      await spawnWithAdapter(spawnOptions(claudeCliAdapter, "claude", {
        vendorSandbox: { setting: on, backend: seatbelt, reclaimSlot: async () => {}, hostIdentity: failing },
      }));
      expect(spawnCli).toHaveBeenCalledOnce();
      expect(spawnedEnv()[VALIDATION_SLOT_DIR_ENV]).toBeUndefined();
      const warnings = log.mock.calls.map((c) => String(c[0])).filter((l) => l.includes(VALIDATION_SLOT_DIR_ENV));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("its test runs resolve the slot themselves");
    } finally {
      log.mockRestore();
    }
  });
});

describe("Codex CLI spawn", () => {
  it("waits for the host lookup and hands the Codex session the slot directory", async () => {
    stubChild();
    const identity = slowIdentity();
    await spawnWithAdapter(spawnOptions(codexCliAdapter, "codex", { vendorSandbox: { setting: on, hostIdentity: identity } }));
    expect(events).toEqual(["identity", "spawn"]);
    expect(spawnedEnv()[VALIDATION_SLOT_DIR_ENV]).toBe(hostSlotDir());
    expect(spawnedEnv()[VALIDATION_SLOT_ENV]).toBeUndefined();
  });

  it("neither waits nor adds the directory when the operator turned confinement off", async () => {
    stubChild();
    const lookup = vi.fn(async () => IDENTITY);
    const cache = Object.assign(lookup, { peek: () => undefined });
    await spawnWithAdapter(spawnOptions(codexCliAdapter, "codex", {
      vendorSandbox: { setting: { ...on, mode: "off" as const }, hostIdentity: cache },
    }));
    expect(lookup).not.toHaveBeenCalled();
    expect(spawnedEnv()[VALIDATION_SLOT_DIR_ENV]).toBeUndefined();
  });
});
