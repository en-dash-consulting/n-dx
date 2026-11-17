/**
 * `sv analyze --fast` is static-only: with a TypeSafe key available, it sends
 * no Jev request and makes no model call in any phase, and it leaves no
 * `claude_commands.log` behind (the `rex` reads behind pr-markdown.md are not
 * vendor-CLI calls). Invented fixture; `fetch` is stubbed, so nothing leaves
 * the machine even if the gate regresses.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { cmdAnalyze } from "../../src/cli/commands/analyze.js";
import { getJudgmentRoute, isStaticOnly, setStaticOnly } from "../../src/analyzers/claude-client.js";
import { snapshotRunLedger } from "../../src/analyzers/run-ledger.js";

let dir: string | undefined;
afterEach(() => {
  setStaticOnly(false);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "sv-fast-static-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

/** Two clusters of importing files, so zones, crossings and findings exist to judge. */
const FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "fast-static-probe", version: "1.0.0" }),
  "src/billing/invoice.ts": 'import { tax } from "./tax.js";\nimport { user } from "../accounts/user.js";\nexport const invoice = () => tax() + user();\n',
  "src/billing/tax.ts": 'import { rate } from "./rate.js";\nexport const tax = () => rate();\n',
  "src/billing/rate.ts": "export const rate = () => 0.2;\n",
  "src/accounts/user.ts": 'import { session } from "./session.js";\nexport const user = () => session();\n',
  "src/accounts/session.ts": 'import { invoice } from "../billing/invoice.js";\nexport const session = () => (invoice ? 1 : 0);\n',
  "src/index.ts": 'import { invoice } from "./billing/invoice.js";\nimport { user } from "./accounts/user.js";\nexport default [invoice, user];\n',
};

describe("sv analyze --fast", () => {
  it("makes no Jev request or model call with a judgment route available, and writes no CLI log", async () => {
    dir = project(FILES);
    const logPath = join(dir, "claude_commands.log");
    vi.stubEnv("TYPESAFE_API_KEY", "tsk_test");
    vi.stubEnv("NDX_CLI_LOG", "1");
    vi.stubEnv("NDX_CLI_LOG_PATH", logPath);
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchSpy);

    // The key is live: without --fast, judgment routes resolve.
    expect(getJudgmentRoute("finding.judge")).toBe("typesafe");

    await cmdAnalyze(dir, ["--fast"]);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(snapshotRunLedger().llm.byTaskClass).toEqual({});
    expect(existsSync(logPath)).toBe(false);
    expect(isStaticOnly()).toBe(true);
    expect(existsSync(join(dir, ".sourcevision", "pr-markdown.md"))).toBe(true);
  }, 60_000);
});
