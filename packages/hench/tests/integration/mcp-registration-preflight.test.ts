/**
 * The run pre-flight warns when the MCP servers the session will use target a
 * different worktree.
 *
 * Claude runs pass their own `--mcp-config … --strict-mcp-config`, which
 * replaces the inherited registrations outright — warning there would describe
 * a hazard the run has already closed. Codex has no equivalent flag, so for
 * those runs the inherited registration is still live and still has to be
 * reported.
 *
 * @see packages/hench/src/cli/commands/run.ts — warnOnShadowingMcpRegistration
 * @see packages/hench/src/process/claude-mcp-registration.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { warnOnShadowingMcpRegistration } from "../../src/cli/commands/run.js";
import { LLM_VENDOR } from "../../src/prd/llm-gateway.js";

/** This checkout's real launcher — a Claude run with one can override. */
const REAL_CORE_CLI = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
  "packages/core/cli.js",
);

const LAUNCHER_KEYS = ["NDX_CLI_PATH", "N_DX_CLI_PATH"] as const;
let savedLauncher: Record<string, string | undefined>;

let sandbox: string;
let projectDir: string;
let otherCheckout: string;
let savedConfigDir: string | undefined;
let logged: string[];
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  sandbox = await realpath(await mkdtemp(join(tmpdir(), "hench-mcp-preflight-")));
  projectDir = join(sandbox, "repo-feature");
  otherCheckout = join(sandbox, "repo-main");
  await mkdir(projectDir, { recursive: true });
  await mkdir(otherCheckout, { recursive: true });

  // A local-scope entry filed under this directory's own key, pinning another
  // checkout. Filed under its own key so the test needs no git repository —
  // the sibling-worktree probe finds nothing in a bare tmpdir.
  await writeFile(
    join(sandbox, ".claude.json"),
    JSON.stringify({
      projects: {
        [projectDir]: {
          mcpServers: {
            rex: {
              command: "node",
              args: [join(otherCheckout, "packages/rex/dist/cli/index.js"), "mcp", otherCheckout],
            },
          },
        },
      },
    }),
  );

  savedConfigDir = process.env["CLAUDE_CONFIG_DIR"];
  process.env["CLAUDE_CONFIG_DIR"] = sandbox;

  // The ambient launcher decides whether a Claude run can override, so each
  // test sets it explicitly rather than inheriting whatever started vitest.
  savedLauncher = Object.fromEntries(LAUNCHER_KEYS.map((k) => [k, process.env[k]]));
  for (const key of LAUNCHER_KEYS) delete process.env[key];

  logged = [];
  logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  });
});

afterEach(async () => {
  logSpy.mockRestore();
  if (savedConfigDir === undefined) delete process.env["CLAUDE_CONFIG_DIR"];
  else process.env["CLAUDE_CONFIG_DIR"] = savedConfigDir;
  for (const key of LAUNCHER_KEYS) {
    if (savedLauncher[key] === undefined) delete process.env[key];
    else process.env[key] = savedLauncher[key]!;
  }
  await rm(sandbox, { recursive: true, force: true });
});

describe("warnOnShadowingMcpRegistration", () => {
  it("warns a Codex run, which cannot override the registration", async () => {
    await warnOnShadowingMcpRegistration(projectDir, LLM_VENDOR.CODEX);

    const text = logged.join("\n");
    expect(text).toContain(otherCheckout);
    expect(text).toContain("claude mcp remove --scope local rex");
  });

  it("stays silent for a Claude run that will replace the registration outright", async () => {
    // A usable launcher is what makes the run able to pass its own
    // --mcp-config, so it is what makes the warning redundant.
    process.env["NDX_CLI_PATH"] = REAL_CORE_CLI;
    await warnOnShadowingMcpRegistration(projectDir, LLM_VENDOR.CLAUDE);
    expect(logged).toEqual([]);
  });

  it("still warns a Claude run that has no launcher to build a config from", async () => {
    // A standalone `hench run` inherits the registration like Codex does.
    delete process.env["NDX_CLI_PATH"];
    delete process.env["N_DX_CLI_PATH"];

    await warnOnShadowingMcpRegistration(projectDir, LLM_VENDOR.CLAUDE);

    expect(logged.join("\n")).toContain(otherCheckout);
  });

  it("stays silent when the registration already names this project", async () => {
    await writeFile(
      join(sandbox, ".claude.json"),
      JSON.stringify({
        projects: {
          [projectDir]: {
            mcpServers: { rex: { command: "node", args: ["/x/cli.js", "mcp", projectDir] } },
          },
        },
      }),
    );

    await warnOnShadowingMcpRegistration(projectDir, LLM_VENDOR.CODEX);
    expect(logged).toEqual([]);
  });

  it("does not fail the run when the config is unreadable", async () => {
    await writeFile(join(sandbox, ".claude.json"), "{ not json");

    await expect(
      warnOnShadowingMcpRegistration(projectDir, LLM_VENDOR.CODEX),
    ).resolves.toBeUndefined();
    expect(logged).toEqual([]);
  });
});
