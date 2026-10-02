import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { Writable } from "node:stream";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initConfig } from "../../../src/store/config.js";
import { RM_RETRY } from "../../helpers/index.js";

const { mockResolveActor, mockResolveHost, streamFailed, markStreamFailed } = vi.hoisted(() => {
  let resolveFailed!: () => void;
  /** Resolves once the run log stream has emitted its 'error' event. */
  const streamFailed = new Promise<void>((resolve) => {
    resolveFailed = resolve;
  });
  return {
    mockResolveActor: vi.fn(async () => "Test Actor <test@example.com>"),
    mockResolveHost: vi.fn(() => "test-host"),
    streamFailed,
    markStreamFailed: () => resolveFailed(),
  };
});

vi.mock("../../../src/process/actor-identity.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/process/actor-identity.js")>();
  return { ...actual, resolveActor: mockResolveActor, resolveHost: mockResolveHost };
});

/**
 * A run log's stream is opened with `open(path).createWriteStream()`. Wrap that
 * for `.run-logs/*.log` only, so every write fails with ENOSPC — the disk
 * filling up mid-run. The file itself is still created, as it would be.
 */
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: (async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      if (!String(args[0]).includes(".run-logs") || !String(args[0]).endsWith(".log")) return handle;
      handle.createWriteStream = (() => {
        const broken = new Writable({
          write(_chunk, _encoding, callback) {
            callback(Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" }));
          },
        });
        broken.once("error", markStreamFailed);
        return broken;
      }) as unknown as typeof handle.createWriteStream;
      return handle;
    }) as typeof actual.open,
  };
});

describe("run log end-of-run fallback", () => {
  let projectDir: string;
  let henchDir: string;
  let consoleLog: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-test-log-fallback-"));
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
        items: [{ id: "task-1", title: "Test task", status: "pending", level: "task", priority: "high" }],
      }),
      "utf-8",
    );
    await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");

    const { resetCapturedLines } = await import("../../../src/types/output.js");
    resetCapturedLines();
    consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    consoleLog.mockRestore();
    await rm(projectDir, { recursive: true, force: true, ...RM_RETRY });
  });

  it("rewrites the whole log at run end when the stream broke mid-run", async () => {
    const { initRunRecord, finalizeRun } = await import("../../../src/agent/lifecycle/shared.js");
    const { stream } = await import("../../../src/types/output.js");

    const { run, memoryCtx } = await initRunRecord({
      taskId: "task-1",
      taskTitle: "Test task",
      model: "sonnet",
      henchDir,
      projectDir,
      vendor: "claude",
    });
    expect(run.logPath).toBeDefined();

    stream("Agent", "first line");
    stream("Agent", "second line");
    // Wait for the stream's failed write to surface as an 'error' event.
    await streamFailed;

    // The live file is empty: nothing could be written to it.
    expect(await readFile(run.logPath!, "utf-8")).toBe("");

    await finalizeRun({ run, henchDir, projectDir, memoryCtx });

    const finished = await readFile(run.logPath!, "utf-8");
    expect(finished).toContain("first line");
    expect(finished).toContain("second line");
  });
});
