import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexCliUsage } from "../../src/codex-cli-usage.js";
import { createCodexCliClient } from "../../src/codex-cli-provider.js";
import { writeFakeCli } from "../helpers/fake-cli.js";

const completed = (input = 100, cached = 80, output = 5) => JSON.stringify({
  type: "turn.completed", usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output },
});

describe("Codex exec accounting", () => {
  it("reads fragmented JSONL, keeps only the latest cumulative snapshot and ignores replays", () => {
    const parser = new CodexCliUsage();
    const stream = `${completed()}\n${completed(150, 100, 9)}\n${completed(150, 100, 9)}\n${completed()}`;
    for (let i = 0; i < stream.length; i += 7) parser.push(stream.slice(i, i + 7));
    expect(parser.finish()).toEqual({ tokenUsage: { input: 50, cacheReadInput: 100, output: 9 }, usageStatus: "measured" });
  });
  it("distinguishes absent, malformed and measured zero", () => {
    expect(new CodexCliUsage().finish()).toEqual({ usageStatus: "unavailable" });
    const zero = new CodexCliUsage();
    zero.push(completed(0, 0, 0));
    expect(zero.finish()).toEqual({ tokenUsage: { input: 0, cacheReadInput: 0, output: 0 }, usageStatus: "measured" });
    for (const bad of ["{", completed(-1), completed(1, 2), completed(1.5, 0), '{"type":"turn.completed","usage":{}}']) {
      const parser = new CodexCliUsage();
      parser.push(bad);
      expect(parser.finish()).toEqual({ usageStatus: "malformed" });
    }
  });
  it("keeps measured spend when later records are malformed", () => {
    const parser = new CodexCliUsage();
    parser.push(`${completed()}\n{`);
    expect(parser.finish()).toEqual({ tokenUsage: { input: 20, cacheReadInput: 80, output: 5 }, usageStatus: "partial" });
  });
  it.each([false, true])("retains spend across fake-binary retries (terminal failure: %s)", async (fail) => {
    const dir = await mkdtemp(join(tmpdir(), "codex-usage-test-"));
    try {
      const cli = await writeFakeCli(dir, { name: "codex", script: `
        import fs from 'node:fs';
        const args = process.argv.slice(2);
        if (!args.includes('--json')) process.exit(99);
        const marker = ${JSON.stringify(join(dir, "attempt"))};
        const retry = fs.existsSync(marker);
        fs.writeFileSync(marker, '1');
        process.stdin.resume();
        process.stdin.on('end', () => {
          process.stdout.write(${JSON.stringify(completed() + "\n" + completed() + "\n")});
          if (!retry || ${fail}) { process.stderr.write('stream disconnected'); process.exitCode = 1; }
          else fs.writeFileSync(args[args.indexOf('-o') + 1], '  exact final text\\n');
        });
      ` });
      const client = createCodexCliClient({ codexConfig: { cli_path: cli }, maxRetries: 1, baseDelayMs: 0 });
      const result = client.complete({ prompt: "fixture", model: "fixture" });
      const expected = { tokenUsage: { input: 40, cacheReadInput: 160, output: 10 }, usageStatus: "measured" };
      if (fail) await expect(result).rejects.toMatchObject(expected);
      else await expect(result).resolves.toEqual({ text: "  exact final text\n", ...expected });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it.each([
    { type: "error", message: "stream disconnected" },
    { type: "turn.failed", error: { message: "429 too many requests" } },
  ])("retries a structured stdout failure: $type", async (event) => {
    const dir = await mkdtemp(join(tmpdir(), "codex-json-error-"));
    try {
      const cli = writeFakeCli(dir, { name: "codex", script: `
        import fs from 'node:fs';
        for await (const chunk of process.stdin) { /* drain prompt */ }
        const marker = ${JSON.stringify(join(dir, "attempt"))};
        if (!fs.existsSync(marker)) {
          fs.writeFileSync(marker, '1');
          process.stderr.write('Warning: optional integration unavailable');
          process.stdout.write(${JSON.stringify(JSON.stringify(event))});
          process.exitCode = 1;
        } else {
          const args = process.argv.slice(2);
          fs.writeFileSync(args[args.indexOf('-o') + 1], 'recovered');
          process.stdout.write(${JSON.stringify(completed())});
        }
      ` });
      const client = createCodexCliClient({ codexConfig: { cli_path: cli }, maxRetries: 1, baseDelayMs: 0 });
      await expect(client.complete({ prompt: "fixture", model: "fixture" })).resolves.toMatchObject({
        text: "recovered", tokenUsage: { input: 20, output: 5, cacheReadInput: 80 }, usageStatus: "partial",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

});
