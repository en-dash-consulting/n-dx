/**
 * The two confined spawn sites that hench starts itself — the vendor CLI
 * session and a confined `execRepoShellCmd` — must clear a stale slot holder
 * from the host before the child starts, and hand it the host-resolved slot
 * directory. Both spawns are stubbed, so the order is observed directly.
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

import { spawnWithAdapter } from "../../../src/agent/lifecycle/cli-loop.js";
import { claudeCliAdapter } from "../../../src/agent/lifecycle/adapters/claude-cli-adapter.js";
import { execRepoShellCmd } from "../../../src/guard/sandbox.js";
import { VALIDATION_SLOT_DIR_ENV, VALIDATION_SLOT_ENV } from "../../../src/process/validation-slot.js";
import { peekValidationSlotDir, type HostIdentity } from "../../../src/process/validation-slot-dir.js";

const seatbelt = { name: "seatbelt" as const, available: true };
const on = { mode: "on" as const, toolNetwork: "none" as const, source: "default" as const };
const IDENTITY: HostIdentity = { kind: "machine", id: "0123456789abcdef0123456789abcdef" };
const known = { peek: () => IDENTITY };

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

posixOnly("vendor CLI spawn", () => {
  it("clears a stale holder before the CLI spawns, and hands the session the host-resolved slot directory", async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), pid: 123,
    });
    spawnCli.mockImplementation(() => {
      events.push("spawn");
      queueMicrotask(() => child.emit("close", 0));
      return child;
    });
    const project = tempProject();
    await spawnWithAdapter({
      adapter: claudeCliAdapter,
      spawnConfig: { binary: "claude", args: [], env: {}, stdinContent: null, cwd: project },
      cliBinary: process.execPath, cwd: project, tokenMetadata: { vendor: "claude", model: "sonnet" },
      cliEnv: { PATH: process.env.PATH },
      vendorSandbox: { setting: on, backend: seatbelt, reclaimSlot: slowReclaim, hostIdentity: known },
    });
    expect(events).toEqual(["reclaim", "spawn"]);
    const env: NodeJS.ProcessEnv = spawnCli.mock.calls[0][2].env;
    expect(env[VALIDATION_SLOT_DIR_ENV]).toBe(peekValidationSlotDir(process.env, known));
    expect(env[VALIDATION_SLOT_ENV]).toBeUndefined();
  });
});
