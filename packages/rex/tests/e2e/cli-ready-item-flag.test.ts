/**
 * Regression test for #442 finding 11: `rex ready --item <id>` (space-separated)
 * went looking for an item literally named `"true"`, because `item` is not a
 * VALUE_KEY and the parser turns a bare `--item` into "true".
 *
 * `item` stays out of VALUE_KEYS on purpose: adding it made `rex log <event>
 * --item <dir>` log the directory as the item id and split `rex export` from
 * `ndx prd export`. So `rex ready` refuses the space form by name, the same
 * way `rex log` and `rex export` do, and `--item=<id>` is the supported form.
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

  it("refuses a space-separated --item and names the --item=<id> form", () => {
    let stderr = "";
    try {
      run(["ready", "--item", itemId, dir]);
      expect.fail("rex ready --item <id> should exit non-zero");
    } catch (err) {
      stderr = String((err as { stderr?: string }).stderr ?? "");
    }
    expect(stderr).toMatch(/--item needs a value/);
    expect(stderr).toContain("--item=<id>");
  });

  it("still accepts the --item=<id> form", () => {
    const output = run(["ready", `--item=${itemId}`, dir]);
    expect(output).toContain(itemId);
  });
});
