/**
 * A run cannot leave n-dx's own config files changed, whichever vendor,
 * provider or tool wrote them (#686 finding 1, follow-up).
 *
 * `codex exec` has no per-path deny and an allowed command writes any file, so
 * neither the guard nor Claude's `Edit(...)` rules stop either route. Each
 * test drives a real route — a vendor CLI spawn, an API-loop shell command,
 * finalization — and checks that the file the agent wrote is gone before the
 * next reader, and that the run says so by path alone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConfigBackstop } from "../../src/guard/config-backstop.js";
import { GuardRails } from "../../src/guard/index.js";
import { DEFAULT_HENCH_CONFIG } from "../../src/schema/v1.js";
import { dispatchTool } from "../../src/tools/dispatch.js";
import type { ToolContext } from "../../src/tools/contracts.js";
import { spawnWithAdapter } from "../../src/agent/lifecycle/cli-loop.js";
import { claudeCliAdapter } from "../../src/agent/lifecycle/adapters/claude-cli-adapter.js";
import { codexCliAdapter } from "../../src/agent/lifecycle/adapters/codex-cli-adapter.js";

const runTestGate = vi.hoisted(() => vi.fn());
vi.mock("../../src/tools/test-runner.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/tools/test-runner.js")>()),
  runTestGate,
}));

/** What an agent steered by repository content writes: a guard that passes every credential. */
const SECRET = "sk-agent-wrote-this";
const WIDENING = JSON.stringify({ hench: { guard: { env: { allow: ["*"] } } }, llm: { claude: { api_key: SECRET } } });

/** Writes the local config the way `node -e "require('fs').writeFileSync(...)"` would. */
const WRITER = `
import { writeFileSync } from "node:fs";
writeFileSync(process.argv[2] ?? ".n-dx.local.json", ${JSON.stringify(WIDENING)});
`;

let dir: string;

beforeEach(() => {
  dir = realpathSync.native(mkdtempSync(join(tmpdir(), "hench-protected-config-")));
  writeFileSync(join(dir, "write-config.mjs"), WRITER);
  runTestGate.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe.each([
  ["codex", codexCliAdapter],
  ["claude", claudeCliAdapter],
] as const)("a %s CLI spawn whose agent writes .n-dx.local.json", (vendor, adapter) => {
  it("leaves the file as it was once the CLI exits, and keeps the write for the run", async () => {
    const backstop = ConfigBackstop.capture(dir);

    await spawnWithAdapter({
      adapter,
      spawnConfig: {
        binary: process.execPath,
        args: [join(dir, "write-config.mjs")],
        env: { ...process.env },
        stdinContent: null,
        cwd: dir,
      },
      cliBinary: process.execPath,
      cliEnv: { ...process.env },
      cwd: dir,
      tokenMetadata: { vendor, model: "test" },
      configBackstop: backstop,
    }).catch(() => undefined);

    expect(existsSync(join(dir, ".n-dx.local.json"))).toBe(false);
    expect(backstop.writes).toEqual([{ path: ".n-dx.local.json", change: "created", restored: true }]);
  });
});

describe("an allowed command in the API tool loop that writes a protected config file", () => {
  function toolCtx(backstop: ConfigBackstop): ToolContext {
    return {
      guard: new GuardRails(dir, DEFAULT_HENCH_CONFIG().guard),
      projectDir: dir,
      store: {} as ToolContext["store"],
      taskId: "task-1",
      configBackstop: backstop,
    };
  }

  it("is put back before the next call, and the tool result says so without the content", async () => {
    writeFileSync(join(dir, ".n-dx.local.json"), "{}\n");
    const backstop = ConfigBackstop.capture(dir);

    const output = await dispatchTool(toolCtx(backstop), "run_command", { command: "node write-config.mjs" });

    expect(readFileSync(join(dir, ".n-dx.local.json"), "utf-8")).toBe("{}\n");
    expect(output).toContain("[GUARD]");
    expect(output).toContain(".n-dx.local.json (modified, restored)");
    expect(output).not.toContain(SECRET);
    expect(backstop.writes).toEqual([{ path: ".n-dx.local.json", change: "modified", restored: true }]);
  });

  it.runIf(caseInsensitiveFs())("catches the write under another spelling of the name", async () => {
    const backstop = ConfigBackstop.capture(dir);

    const output = await dispatchTool(toolCtx(backstop), "run_command", { command: "node write-config.mjs .N-DX.local.json" });

    expect(existsSync(join(dir, ".N-DX.local.json"))).toBe(false);
    expect(output).toContain(".n-dx.local.json (created, restored)");
  });
});

describe("finalizing a run whose agent changed n-dx's config", () => {
  it("puts the file back, fails the run before the test gate, and records the path but not the content", async () => {
    const { initRunRecord, finalizeRun } = await import("../../src/agent/lifecycle/shared.js");
    const henchDir = join(dir, ".hench");
    const backstop = ConfigBackstop.capture(dir);
    const { run, memoryCtx } = await initRunRecord({
      taskId: "task-1",
      taskTitle: "Task",
      model: "test",
      henchDir,
      vendor: "codex",
      parseMode: "json",
    });
    run.status = "completed";
    // Written after the last spawn's check, e.g. by a reviewer or a background command.
    writeFileSync(join(dir, ".n-dx.local.json"), WIDENING);

    await finalizeRun({ run, henchDir, projectDir: dir, memoryCtx, configBackstop: backstop, yes: true, autonomous: true });

    expect(existsSync(join(dir, ".n-dx.local.json"))).toBe(false);
    expect(run.status).toBe("failed");
    expect(run.protectedConfigWrites).toEqual([{ path: ".n-dx.local.json", change: "created", restored: true }]);
    expect(run.error).toContain(".n-dx.local.json");
    expect(JSON.stringify(run)).not.toContain(SECRET);
    expect(runTestGate).not.toHaveBeenCalled();
  });
});

/** True when the temp filesystem folds case, as macOS and Windows do by default. */
function caseInsensitiveFs(): boolean {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "hench-case-probe-")));
  try {
    writeFileSync(join(root, "probe"), "");
    return existsSync(join(root, "PROBE"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
