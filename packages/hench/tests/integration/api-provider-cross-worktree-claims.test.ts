/**
 * Cross-worktree task selection through the API-provider loop.
 *
 * CLI-provider coverage cannot protect this seam: agentLoop prepares its own
 * brief before provider resolution, so it must pass the project directory to
 * shared preparation for both claim filtering and the atomic claim itself.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initGitFixtureRepoSync } from "../helpers/index.js";
import { openClaimsStore } from "../../src/prd/rex-gateway.js";
import { defaultRegistry } from "../../src/prd/llm-gateway.js";
import type { LLMProvider } from "../../src/prd/llm-gateway.js";
import { claimTask, releaseAllTaskClaims, resetTaskClaimLedger } from "../../src/prd/task-claims.js";
import { initConfig } from "../../src/store/config.js";

describe("API-provider cross-worktree task claims", () => {
  let sandbox: string | undefined;
  let repo: string | undefined;
  let linked: string | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (repo) await releaseAllTaskClaims(repo);
    if (linked) await releaseAllTaskClaims(linked);
    resetTaskClaimLedger();
    vi.useRealTimers();
    if (sandbox) await rm(sandbox, { recursive: true, force: true });
    sandbox = undefined;
    repo = undefined;
    linked = undefined;
  });

  it("does not begin the same automatically selected task in two linked worktrees", async () => {
    sandbox = await mkdtemp(join(tmpdir(), "hench-api-claims-"));
    repo = join(sandbox, "repo");
    linked = join(sandbox, "linked");
    await mkdir(repo);

    const henchDir = join(repo, ".hench");
    const rexDir = join(repo, ".rex");
    await initConfig(henchDir);
    await mkdir(rexDir, { recursive: true });
    await writeFile(
      join(rexDir, "config.json"),
      JSON.stringify({ schema: "rex/v1", project: "test", adapter: "file" }),
      "utf-8",
    );
    await writeFile(
      join(rexDir, "prd.json"),
      JSON.stringify({
        schema: "rex/v1",
        title: "Test",
        items: [
          { id: "task-1", title: "First task", status: "pending", level: "task", priority: "high" },
          { id: "task-2", title: "Second task", status: "pending", level: "task", priority: "high" },
        ],
      }),
      "utf-8",
    );
    await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");
    await writeFile(
      join(repo, ".n-dx.json"),
      JSON.stringify({ llm: { vendor: "local", local: { host: "localhost", port: 1234 } } }),
      "utf-8",
    );

    initGitFixtureRepoSync(repo);
    execFileSync("git", ["add", "-A"], { cwd: repo, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "baseline"], { cwd: repo, stdio: "ignore" });
    execFileSync("git", ["worktree", "add", "--quiet", "--detach", linked], {
      cwd: repo,
      stdio: "ignore",
    });

    const linkedHenchDir = join(linked, ".hench");
    await initConfig(linkedHenchDir);

    const provider = {
      info: { vendor: "local", mode: "api", model: "qwen-test", capabilities: ["function-calling"] },
      complete: vi.fn(),
    } as unknown as LLMProvider;
    vi.spyOn(defaultRegistry, "getActiveProvider").mockReturnValue(provider);
    vi.stubGlobal("fetch", vi.fn(async () => {
      const response = {
        choices: [{ message: { role: "assistant", content: "Already complete." }, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      };
      return {
        ok: true,
        status: 200,
        json: async () => response,
        text: async () => JSON.stringify(response),
      } as unknown as Response;
    }));

    const { agentLoop } = await import("../../src/agent/lifecycle/loop.js");
    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../src/store/config.js");

    const runIn = async (projectDir: string, projectHenchDir: string) => {
      const config = await loadConfig(projectHenchDir);
      config.skipFullTestGate = true;
      return agentLoop({
        config,
        store: createStore("file", join(projectDir, ".rex")),
        projectDir,
        henchDir: projectHenchDir,
        model: "qwen-test",
        yes: true,
        autonomous: true,
      });
    };

    const first = await runIn(repo, henchDir);

    // Re-take the first run's claim with a tiny deterministic TTL. Advancing
    // beyond that original lease proves the heartbeat, rather than a generous
    // production timeout, is what keeps the second worktree off task-1.
    await releaseAllTaskClaims(repo);
    const realNow = Date.now();
    const ttlMs = 900;
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(realNow);
    await claimTask(repo, "task-1", { ttlMs });
    const originalExpiry = Date.parse((await openClaimsStore(repo).readClaims())[0]!.expiresAt);

    await vi.advanceTimersByTimeAsync(ttlMs / 3 + 1);
    let renewed = (await openClaimsStore(linked).readClaims())[0];
    for (let attempt = 0; attempt < 20 && Date.parse(renewed?.expiresAt ?? "") <= originalExpiry; attempt += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      renewed = (await openClaimsStore(linked).readClaims())[0];
    }
    expect(Date.parse(renewed!.expiresAt)).toBeGreaterThan(originalExpiry);
    await vi.advanceTimersByTimeAsync(ttlMs - ttlMs / 3);

    const second = await runIn(linked, linkedHenchDir);

    expect(first.run.taskId).toBe("task-1");
    expect(second.run.taskId).toBe("task-2");
  });
});
