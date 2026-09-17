/**
 * Gemini agentic tool-use loop integration test.
 *
 * Validates that `agentLoop()` with `llm.vendor=google` drives a real
 * multi-turn tool-use loop (not the legacy single-turn completion):
 *
 *   1. Turn 1 — model returns a `functionCall` (write_file) → dispatched
 *      through the shared tool dispatcher (file actually written, guarded).
 *   2. Turn 2 — model returns text with no functionCall → run completes.
 *
 * The Gemini provider is mocked via `defaultRegistry.getActiveProvider` so no
 * real Gemini API calls are made. Asserts tool dispatch, conversation
 * accrual, per-turn token attribution (vendor=google), and run status.
 *
 * @see packages/hench/src/agent/lifecycle/loop.ts — runGeminiToolLoop
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { commitGitFixtureBaseline } from "../helpers/index.js";
import { initConfig } from "../../src/store/config.js";
import { defaultRegistry } from "../../src/prd/llm-gateway.js";
import type {
  GeminiToolProvider,
  GeminiContent,
  GeminiGenerateResult,
} from "../../src/prd/llm-gateway.js";

describe("Gemini agentic tool-use loop", () => {
  let projectDir: string;
  let henchDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-test-gemini-loop-"));
    henchDir = join(projectDir, ".hench");
    await initConfig(henchDir);

    const rexDir = join(projectDir, ".rex");
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
          { id: "task-1", title: "Write the output file", status: "pending", level: "task", priority: "high" },
        ],
      }),
      "utf-8",
    );
    await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");

    // Select Google as the active vendor.
    await writeFile(
      join(projectDir, ".n-dx.json"),
      JSON.stringify({ llm: { vendor: "google", google: { api_key: "AIza-test-key" } } }),
      "utf-8",
    );

    // Completion validation discovers changes via git; without a repo (and a
    // baseline commit) every completion claim is rejected as unverifiable.
    commitGitFixtureBaseline(projectDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true });
  });

  /** Build a mock GeminiToolProvider whose tool turns are scripted in order. */
  function mockGeminiProvider(turns: GeminiGenerateResult[]): GeminiToolProvider {
    let call = 0;
    const generateContentWithTools = vi.fn(
      async (_args: { contents: GeminiContent[] }): Promise<GeminiGenerateResult> => {
        const turn = turns[Math.min(call, turns.length - 1)];
        call += 1;
        return turn;
      },
    );
    return {
      info: { vendor: "google", mode: "api", model: "gemini-2.5-pro", capabilities: ["streaming", "function-calling"] },
      complete: vi.fn(),
      generateContentWithTools,
    } as unknown as GeminiToolProvider;
  }

  it("dispatches a tool call then completes on a text turn", async () => {
    const { agentLoop } = await import("../../src/agent/lifecycle/loop.js");
    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../src/store/config.js");

    const provider = mockGeminiProvider([
      // Turn 1: request a write_file tool call
      {
        parts: [{ functionCall: { name: "write_file", args: { path: "gemini-output.ts", content: "export const source = 'gemini';\n" } } }],
        functionCalls: [{ name: "write_file", args: { path: "gemini-output.ts", content: "export const source = 'gemini';\n" } }],
        text: "",
        finishReason: "STOP",
        usage: { input: 100, output: 20 },
      },
      // Turn 2: stage the output as the API prompt requires.
      {
        parts: [{ functionCall: { name: "git", args: { subcommand: "add", args: "gemini-output.ts" } } }],
        functionCalls: [{ name: "git", args: { subcommand: "add", args: "gemini-output.ts" } }],
        text: "",
        finishReason: "STOP",
        usage: { input: 40, output: 10 },
      },
      // Turn 3: leave the commit handoff for the non-interactive finalizer.
      {
        parts: [{ functionCall: { name: "write_file", args: { path: ".hench-commit-msg.txt", content: "feat: write Gemini output\n" } } }],
        functionCalls: [{ name: "write_file", args: { path: ".hench-commit-msg.txt", content: "feat: write Gemini output\n" } }],
        text: "",
        finishReason: "STOP",
        usage: { input: 20, output: 5 },
      },
      // Turn 4: no tool calls → completion
      {
        parts: [{ text: "Done — the file is written." }],
        functionCalls: [],
        text: "Done — the file is written.",
        finishReason: "STOP",
        usage: { input: 10, output: 3 },
      },
    ]);

    const spy = vi.spyOn(defaultRegistry, "getActiveProvider").mockReturnValue(provider);

    const config = await loadConfig(henchDir);
    config.skipFullTestGate = true;
    const store = createStore("file", join(projectDir, ".rex"));

    const result = await agentLoop({
      config,
      store,
      projectDir,
      henchDir,
      model: "gemini-2.5-pro",
      yes: true,
      autonomous: true,
    });

    expect(spy).toHaveBeenCalled();

    // The loop ran its write, staging, and commit-handoff turns before completion.
    expect(result.run.turns).toBe(4);
    expect(result.run.status).toBe("completed");
    expect(result.run.summary).toContain("Done");

    // The write_file tool was actually dispatched (file written under projectDir).
    expect(existsSync(join(projectDir, "gemini-output.ts"))).toBe(true);
    const written = await readFile(join(projectDir, "gemini-output.ts"), "utf-8");
    expect(written).toContain("gemini");

    // Tool call recorded in the run.
    expect(result.run.toolCalls.length).toBeGreaterThanOrEqual(1);
    expect(result.run.toolCalls[0].tool).toBe("write_file");

    // Per-turn token usage attributed to google.
    expect(result.run.turnTokenUsage).toBeDefined();
    expect(result.run.turnTokenUsage!.length).toBe(4);
    for (const t of result.run.turnTokenUsage!) {
      expect(t.vendor).toBe("google");
    }
    // Accumulated totals (100+40+20+10 input, 20+10+5+3 output).
    expect(result.run.tokenUsage.input).toBe(170);
    expect(result.run.tokenUsage.output).toBe(38);

    // This completed through the real git-derived path, not a mocked verdict.
    expect(execFileSync("git", ["show", "--format=", "--name-only", "HEAD"], {
      cwd: projectDir,
      encoding: "utf-8",
    })).toContain("gemini-output.ts");

    // The loop passed function declarations to the provider.
    const firstCallArgs = (provider.generateContentWithTools as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(firstCallArgs.tools[0].functionDeclarations.length).toBeGreaterThan(0);
    expect(firstCallArgs.tools[0].functionDeclarations.some((d: { name: string }) => d.name === "write_file")).toBe(true);
  });

  it("rejects a completion claim that changed nothing — same standard as the CLI loop", async () => {
    const { agentLoop } = await import("../../src/agent/lifecycle/loop.js");
    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../src/store/config.js");

    // The model immediately declares itself done without touching a file.
    // API loops used to record this as "completed" and mark the task done in
    // the PRD; the CLI loop has always rejected it via validateCompletion.
    const provider = mockGeminiProvider([
      {
        parts: [{ text: "Nothing to do." }],
        functionCalls: [],
        text: "Nothing to do.",
        finishReason: "STOP",
        usage: { input: 12, output: 4 },
      },
    ]);
    vi.spyOn(defaultRegistry, "getActiveProvider").mockReturnValue(provider);

    const config = await loadConfig(henchDir);
    config.skipFullTestGate = true;
    const store = createStore("file", join(projectDir, ".rex"));

    const result = await agentLoop({
      config, store, projectDir, henchDir,
      model: "gemini-2.5-pro", yes: true, autonomous: true,
    });

    // Initial claim + 2 execution re-prompts = 3 turns before the loop gives up.
    expect(result.run.turns).toBe(3);
    expect(result.run.toolCalls.length).toBe(0);
    expect(result.run.status).toBe("failed");
    expect(result.run.error).toContain("No changes detected");

    // The task went back to pending — not completed — so the next cycle retries it.
    const doc = await store.loadDocument();
    const task = doc!.items.find((i: { id: string }) => i.id === "task-1");
    expect(task!.status).toBe("pending");
  });

  it("rejects a completion whose only output is hench's own commit-message handoff", async () => {
    // `.hench-commit-msg.txt` is hench's scratch file, written at the repo
    // root so neither the `.rex/` nor the `.hench/` bookkeeping prefix covers
    // it. Writing it is not doing the task, and a run that wrote nothing else
    // must not satisfy the git-derived completion gate on it.
    const { agentLoop } = await import("../../src/agent/lifecycle/loop.js");
    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../src/store/config.js");

    const provider = mockGeminiProvider([
      {
        parts: [{ functionCall: { name: "write_file", args: { path: ".hench-commit-msg.txt", content: "feat: nothing at all\n" } } }],
        functionCalls: [{ name: "write_file", args: { path: ".hench-commit-msg.txt", content: "feat: nothing at all\n" } }],
        text: "",
        finishReason: "STOP",
        usage: { input: 20, output: 5 },
      },
      {
        parts: [{ text: "Done." }],
        functionCalls: [],
        text: "Done.",
        finishReason: "STOP",
        usage: { input: 10, output: 3 },
      },
    ]);
    vi.spyOn(defaultRegistry, "getActiveProvider").mockReturnValue(provider);

    const config = await loadConfig(henchDir);
    config.skipFullTestGate = true;
    const store = createStore("file", join(projectDir, ".rex"));

    const result = await agentLoop({
      config, store, projectDir, henchDir,
      model: "gemini-2.5-pro", yes: true, autonomous: true,
    });

    // The handoff file really was written — the rejection is the gate's
    // judgement about it, not the write failing. It is no longer at the repo
    // root by the time the run ends: a run that does not commit has its
    // proposed message moved beside the run record, so the next run's watcher
    // cannot commit under it (see stale-commit-msg-quarantine.test.ts).
    expect(existsSync(join(projectDir, ".hench-commit-msg.txt"))).toBe(false);
    expect(readFileSync(join(henchDir, "runs", `${result.run.id}.commit-msg.txt`), "utf-8"))
      .toBe("feat: nothing at all\n");
    expect(result.run.status).toBe("failed");
    expect(result.run.error).toContain("No changes detected");

    const doc = await store.loadDocument();
    const task = doc!.items.find((i: { id: string }) => i.id === "task-1");
    expect(task!.status).toBe("pending");
  });
});
