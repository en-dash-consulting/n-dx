import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, statSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnWithAdapter } from "../../src/agent/lifecycle/cli-loop.js";
import { codexCliAdapter } from "../../src/agent/lifecycle/adapters/codex-cli-adapter.js";
import type { SpawnConfig, VendorSpawnOptions } from "../../src/agent/lifecycle/vendor-adapter.js";
import { DEFAULT_EXECUTION_POLICY } from "../../src/prd/llm-gateway.js";
import { createMinimalEnvelope } from "../helpers/index.js";

// Real child-process lifecycle and temp APIs; the child is a protocol fixture,
// not proof of installed Codex sandbox enforcement.
describe("Codex spawn-owned scratch", () => {
  let dir: string;
  let script: string;
  let capture: string;
  let lastScratch: string | undefined;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "hench-scratch-test-"));
    script = join(dir, "cli.mjs");
    capture = join(dir, "capture.json");
    lastScratch = undefined;
  });
  afterEach(async () => {
    const outside = join(dir, "permission-canary");
    if (existsSync(outside)) await chmod(outside, 0o700);
    await rm(dir, { recursive: true, force: true });
  });

  function config(options: VendorSpawnOptions = {}): SpawnConfig {
    const wrap = (value: SpawnConfig): SpawnConfig => ({
      ...value, args: [script, ...value.args],
      withScratchDir: value.withScratchDir ? path => {
        lastScratch = path;
        return wrap(value.withScratchDir!(path));
      } : undefined,
    });
    return wrap(codexCliAdapter.buildSpawnConfig(createMinimalEnvelope(), DEFAULT_EXECUTION_POLICY, options));
  }

  async function run(options: VendorSpawnOptions = {}, outcome = "success", readOnly = false, includeOnly?: string[]) {
    const abort = new AbortController();
    const outside = join(dir, "permission-canary");
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "keep"), "untouched");
    if (readOnly) await chmod(outside, 0o555);
    await writeFile(script, `
      import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
      if (process.argv.includes('app-server')) {
        const set = {};
        for (const arg of process.argv) {
          const match = /^shell_environment_policy\\.set\\.(TMPDIR|TMP|TEMP)=(.*)$/.exec(arg);
          if (match) set[match[1]] = JSON.parse(match[2]);
        }
        const lines = (await import('node:readline')).createInterface({input:process.stdin});
        for await (const line of lines) {
          const message = JSON.parse(line);
          if (message.id) console.log(JSON.stringify({id:message.id, result: message.method === 'initialize' ? {} :
            {config:{shell_environment_policy:{set, include_only:${JSON.stringify(includeOnly ?? [])}}}}}));
        }
        process.exit(0);
      }
      const scratch = os.tmpdir();
      const temporary = fs.mkdtempSync(path.join(scratch, 'normal-api-'));
      fs.writeFileSync(path.join(temporary, 'file'), 'ok');
      if (${readOnly}) {
        fs.symlinkSync(${JSON.stringify(outside)}, path.join(temporary, 'outside'));
        fs.chmodSync(temporary, 0o555);
        fs.chmodSync(scratch, 0o555);
      }
      fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify({ scratch, args: process.argv.slice(2),
        tmp: process.env.TMP, temp: process.env.TEMP, mode: fs.statSync(scratch).mode & 0o777 }));
      console.log(JSON.stringify({type:'thread.started',thread_id:'child'}));
      console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'ready'}}));
      if (${JSON.stringify(outcome)} === 'abort') setInterval(() => {}, 1000);
      else process.exit(${outcome === "error" ? 1 : 0});
    `);
    const result = await spawnWithAdapter({
      adapter: { ...codexCliAdapter, parseEvent(line, turn) {
        const event = codexCliAdapter.parseEvent(line, turn);
        if (outcome === "abort" && line.includes('"ready"')) abort.abort("fixture cancellation");
        return event;
      } },
      cliBinary: process.execPath, cliEnv: { ...process.env, CODEX_HOME: dir }, cwd: dir,
      spawnConfig: config(options), tokenMetadata: { vendor: "codex", model: "fixture" },
      abortSignal: abort.signal, forkParentId: options.forkSession ? "parent" : undefined,
    });
    const observed = JSON.parse(await readFile(capture, "utf8"));
    expect(observed.scratch).not.toBe(tmpdir());
    expect(observed.tmp).toBe(observed.scratch);
    expect(observed.temp).toBe(observed.scratch);
    if (process.platform !== "win32") expect(observed.mode).toBe(readOnly ? 0o555 : 0o700);
    expect(observed.args).toContain(`sandbox_workspace_write={network_access=false,writable_roots=[${JSON.stringify(observed.scratch)}],exclude_tmpdir_env_var=true,exclude_slash_tmp=true}`);
    expect(observed.args).toContain(`shell_environment_policy.set.TMPDIR=${JSON.stringify(observed.scratch)}`);
    expect(existsSync(observed.scratch)).toBe(false);
    if (readOnly) {
      expect(statSync(outside).mode & 0o777).toBe(0o555);
      expect(await readFile(join(outside, "keep"), "utf8")).toBe("untouched");
      await chmod(outside, 0o700);
    }
    return { result, scratch: observed.scratch };
  }

  it("gives fresh execution, resumed review and forked work distinct bounded scratch", async () => {
    const fresh = await run();
    const review = await run({ resumeSessionId: "child" });
    const fork = await run({ resumeSessionId: "parent", forkSession: true, codexForkSupported: true });
    expect(new Set([fresh.scratch, review.scratch, fork.scratch]).size).toBe(3);
    for (const call of [fresh, review, fork]) expect(call.result.error).toBeUndefined();
  });

  it.each([{}, { resumeSessionId: "child" }, { resumeSessionId: "parent", forkSession: true, codexForkSupported: true }])(
    "refuses PATH-only native filters before fresh/resume/fork execution: %j", async options => {
      await expect(run(options, "success", false, ["PATH"])).rejects.toThrow(/include_only.*TMPDIR/);
      expect(existsSync(capture)).toBe(false);
      expect(lastScratch).toBeDefined();
      expect(existsSync(lastScratch!)).toBe(false);
    },
  );

  it.skipIf(process.platform === "win32").each(["success", "error", "abort"])(
    "preserves %s when a child leaves populated 0555 scratch and external symlinks", async outcome => {
      const { result } = await run({}, outcome, true);
      if (outcome === "success") expect(result.error).toBeUndefined();
      if (outcome === "error") expect(result.error).toContain("code 1");
      if (outcome === "abort") expect(result.aborted?.reason).toContain("fixture cancellation");
    },
  );

  it("cleans a failed child and an aborted child after exit", async () => {
    expect((await run({}, "error")).result.error).toBeDefined();
    expect((await run({}, "abort")).result.aborted).toBeDefined();
  });

  it("cleans preparation errors and starts no scratch for an already aborted call", async () => {
    let owned: string | undefined;
    const spawnConfig = { ...config(), withScratchDir(path: string): SpawnConfig {
      owned = path;
      throw new Error("fixture preparation failed");
    } };
    const opts = { adapter: codexCliAdapter, cliBinary: process.execPath, cliEnv: {}, cwd: dir,
      spawnConfig, tokenMetadata: { vendor: "codex", model: "fixture" } };
    await expect(spawnWithAdapter(opts)).rejects.toThrow("fixture preparation failed");
    expect(owned).toBeDefined();
    expect(existsSync(owned!)).toBe(false);
    owned = undefined;
    const abort = new AbortController(); abort.abort();
    expect((await spawnWithAdapter({ ...opts, abortSignal: abort.signal })).aborted).toBeDefined();
    expect(owned).toBeUndefined();
  });

  it("cleans a failed spawn and cancellation during preparation", async () => {
    let owned: string | undefined;
    const base = config();
    const abort = new AbortController();
    let cancel = false;
    const spawnConfig = { ...base, withScratchDir(path: string) {
      owned = path;
      if (cancel) abort.abort("cancel during preparation");
      return base.withScratchDir!(path);
    } };
    const opts = { adapter: codexCliAdapter, cliBinary: join(dir, "missing-cli"), cliEnv: { CODEX_HOME: dir }, cwd: dir,
      spawnConfig, tokenMetadata: { vendor: "codex", model: "fixture" }, abortSignal: abort.signal };
    await expect(spawnWithAdapter(opts)).rejects.toThrow();
    expect(owned).toBeDefined();
    expect(existsSync(owned!)).toBe(false);
    cancel = true;
    expect((await spawnWithAdapter(opts)).aborted).toBeDefined();
    expect(existsSync(owned!)).toBe(false);
  });
});
