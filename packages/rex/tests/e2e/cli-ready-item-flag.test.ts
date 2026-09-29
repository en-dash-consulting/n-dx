/**
 * Regression test for #442 finding 11: `item` was missing from `VALUE_KEYS`
 * in the CLI's argument parser, so `--item <id>` (space-separated form) was
 * treated as a bare boolean flag — `<id>` fell through as a stray positional
 * argument instead of being consumed as `--item`'s value, and `rex ready`
 * went looking for an item literally named `"true"`.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cliPath = join(
  fileURLToPath(import.meta.url),
  "..",
  "..",
  "..",
  "dist",
  "cli",
  "index.js",
);

function run(args: string[]): string {
  return execFileSync("node", [cliPath, ...args], {
    encoding: "utf-8",
    timeout: 10000,
  });
}

/** Extract the ID from `ID: <uuid>` in command output. */
function extractId(output: string): string {
  const match = output.match(/ID: (.+)/);
  if (!match?.[1]) throw new Error(`No ID found in output: ${output}`);
  return match[1].trim();
}

describe("rex ready --item <id>", () => {
  let dir: string;
  let itemId: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "rex-e2e-ready-item-"));
    run(["init", dir]);
    itemId = extractId(run(["add", "epic", "--title=Test Epic", dir]));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("parses a space-separated --item value instead of misreading it as a bare flag", () => {
    const output = run(["ready", "--item", itemId, dir]);
    expect(output).toContain(itemId);
  });

  it("still accepts the --item=<id> form", () => {
    const output = run(["ready", `--item=${itemId}`, dir]);
    expect(output).toContain(itemId);
  });
});
