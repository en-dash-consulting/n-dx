import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "hench-scratch-test-"));
    script = join(dir, "cli.mjs");
    capture = join(dir, "capture.json");
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  function config(options: VendorSpawnOptions = {}): SpawnConfig {
    const wrap = (value: SpawnConfig): SpawnConfig => ({
      ...value, args: [script, ...value.args],
      withScratchDir: value.withScratchDir ? path => wrap(value.withScratchDir!(path)) : undefined,
    });
    return wrap(codexCliAdapter.buildSpawnConfig(createMinimalEnvelope(), DEFAULT_EXECUTION_POLICY, options));
  }

  async function run(options: VendorSpawnOptions = {}, outcome = "success") {
    const abort = new AbortController();
    await writeFile(script, `
      import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
      const scratch = os.tmpdir();
      const temporary = fs.mkdtempSync(path.join(scratch, 'normal-api-'));
      fs.writeFileSync(path.join(temporary, 'file'), 'ok');
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
    if (process.platform !== "win32") expect(observed.mode).toBe(0o700);
    expect(observed.args).toContain(`sandbox_workspace_write={network_access=false,writable_roots=[${JSON.stringify(observed.scratch)}],exclude_tmpdir_env_var=true,exclude_slash_tmp=true}`);
    expect(observed.args).toContain(`shell_environment_policy.set.TMPDIR=${JSON.stringify(observed.scratch)}`);
    expect(existsSync(observed.scratch)).toBe(false);
    return { result, scratch: observed.scratch };
  }

  it("gives fresh execution, resumed review and forked work distinct bounded scratch", async () => {
    const fresh = await run();
    const review = await run({ resumeSessionId: "child" });
    const fork = await run({ resumeSessionId: "parent", forkSession: true, codexForkSupported: true });
    expect(new Set([fresh.scratch, review.scratch, fork.scratch]).size).toBe(3);
    for (const call of [fresh, review, fork]) expect(call.result.error).toBeUndefined();
  });

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
