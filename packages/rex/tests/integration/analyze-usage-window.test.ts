import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCodexCliClient } from "@n-dx/llm-client";
import { writeFakeCli } from "../../../llm-client/tests/helpers/fake-cli.js";
import { ensureRexDir } from "../../src/store/file-adapter.js";
import { cmdAnalyze } from "../../src/cli/commands/analyze.js";
import { readTokenUsageLog } from "../../src/core/token-store.js";
import { extractRexTokenUsage, extractRexTokenEvents, estimateCostFromTotals, groupByTimePeriod } from "../../src/core/token-usage.js";

const { client } = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("@n-dx/llm-client", async original => ({
  ...await original<typeof import("@n-dx/llm-client")>(),
  createLLMClient: () => client(),
}));
// Keep discovery small; the command, provider process, bridge and log are real.
vi.mock("../../src/analyze/scanners.js", () => ({
  scanTests: async () => [],
  scanDocs: async () => [{ name: "Login", source: "doc", sourceFile: "README.md", kind: "feature" }],
  scanSourceVision: async () => ({ results: [], staleCount: 0 }),
  scanPackageJson: async () => [],
  scanGoMod: async () => [],
}));

let dir: string;
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("analyze completion diagnostics stay with command totals across a time boundary", () => {
  it.each(["unavailable", "partial"])("keeps %s usage incomplete in the command's day and --since window", async status => {
    dir = await mkdtemp(join(tmpdir(), "analyze-usage-window-"));
    const rexDir = join(dir, ".rex");
    await ensureRexDir(rexDir);
    await writeFile(join(rexDir, "config.json"), JSON.stringify({ schema: "rex/v1", project: "fixture", adapter: "file" }));
    await writeFile(join(dir, ".n-dx.json"), JSON.stringify({ llm: { vendor: "codex" } }));
    const answer = JSON.stringify([{ epic: { title: "Authentication" }, features: [{ title: "Login", tasks: [{ title: "Implement login form", priority: "high" }] }] }]);
    const stream = status === "unavailable" ? "" : JSON.stringify({ type: "turn.completed",
      usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 5 } }) + "\n{";
    const cli = writeFakeCli(dir, { name: "codex", codexConfigRead: {}, script: `
      import fs from 'node:fs';
      for await (const chunk of process.stdin) { /* drain */ }
      const args = process.argv.slice(2);
      fs.writeFileSync(args[args.indexOf('-o') + 1], ${JSON.stringify(answer)});
      process.stdout.write(${JSON.stringify(stream)});
    ` });
    client.mockReturnValue(createCodexCliClient({ codexConfig: { cli_path: cli }, maxRetries: 0 }));
    // Date only: the fake provider still runs with real process/timer I/O.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-18T23:59:59Z"));
    vi.spyOn(console, "log").mockImplementation((...args) => {
      // Proposal review can take arbitrarily long between completion and the
      // command-owned log. Cross midnight after the initial LLM pass.
      if (args.join(" ").includes("Scanned:")) vi.setSystemTime(new Date("2026-11-19T00:00:01Z"));
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await cmdAnalyze(dir, { model: "gpt-5.4" });
    const logs = await readTokenUsageLog(rexDir);
    const diagnostic = logs.find(entry => entry.event === "llm_usage_diagnostic")!;
    const command = logs.find(entry => entry.event === "analyze_token_usage")!;
    expect(diagnostic.timestamp).toBe("2026-11-18T23:59:59.000Z");
    expect(command.timestamp).toBe("2026-11-19T00:00:01.000Z");
    const filtered = extractRexTokenUsage(logs, { since: "2026-11-19" });
    expect(filtered.calls).toBe(1);
    expect(filtered.diagnosticStatus).toBe(status);
    expect(estimateCostFromTotals(filtered, filtered.byModel).measurementComplete).toBe(false);
    const day = groupByTimePeriod(extractRexTokenEvents(logs), "day").find(bucket => bucket.period === "2026-11-19")!;
    expect(day.usage.totalCalls).toBe(1);
    expect(day.estimatedCost.measurementComplete).toBe(false);
  });
});
