/**
 * E2E: `rex add`, `rex product` and `rex change` dispatch on the tree layout.
 * On a v2 tree, add creates a change and names its placement; on a v1 tree
 * add is untouched and the product-layer verbs refuse.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { copyV2Fixture } from "../helpers/v2-fixture.js";

const cliPath = join(fileURLToPath(import.meta.url), "..", "..", "..", "dist", "cli", "index.js");

function run(args: string[], cwd: string, expectFail = false): string {
  const proc = spawnSync("node", [cliPath, ...args], { cwd, encoding: "utf-8", timeout: 20000, stdio: ["ignore", "pipe", "pipe"] });
  const output = (proc.stdout ?? "") + (proc.stderr ?? "");
  if (proc.status !== 0 && !expectFail) throw new Error(`rex ${args.join(" ")} exited ${proc.status}:\n${output}`);
  if (proc.status === 0 && expectFail) throw new Error(`rex ${args.join(" ")} should have failed:\n${output}`);
  return output;
}

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "rex-cli-v2-verbs-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("on a v2 tree", () => {
  beforeEach(async () => {
    await copyV2Fixture(join(tmp, ".rex"), "lf");
  });

  it("rex add --title creates a change and names its placement", () => {
    const out = run(["add", "--title=Support refunds when paying by card", "--criterion=A refund reaches the card", tmp], tmp);
    expect(out).toContain("Created change: Support refunds when paying by card");
    expect(out).toMatch(/Placement: Inbox \(needs placement\)/);
    expect(out).toMatch(/--target=A1\.1 --relation=amends/);
  });

  it("rex add change --title and a positional description both create changes", () => {
    expect(run(["add", "change", "--title=Tidy the card form"], tmp)).toContain("Created change: Tidy the card form");
    expect(run(["add", "Dark mode for the checkout", tmp], tmp)).toContain("Created change: Dark mode for the checkout");
  });

  it("rex add refuses a level", () => {
    expect(run(["add", "epic", "--title=x", tmp], tmp, true)).toMatch(/type, not a level/);
  });

  it("rex product show and rex change place take an id and an optional dir", () => {
    expect(run(["product", "show", tmp], tmp)).toMatch(/A1\.1 Pay by card \(capability\)/);
    expect(run(["product", "show", "A1.1", tmp], tmp)).toContain("Capability criteria:");
    expect(run(["change", "place", "CH-1"], tmp)).toContain("CH-1 Add Apple Pay");
    expect(run(["change", "apply", "CH-1", tmp], tmp)).toContain("Applied CH-1 Add Apple Pay.");
  });

  it("rex product edit takes repeatable --capability-criterion", () => {
    run(["change", "apply", "CH-1"], tmp);
    const out = run(["product", "edit", "A1.1", "--capability-criterion", "c9: A refund reaches the card", "--capability-criterion=c1: Charged once"], tmp);
    expect(out).toMatch(/it now reads revised/);
    expect(run(["product", "show", "A1.1"], tmp)).toMatch(/c1: Charged once[\s\S]*c9: A refund reaches the card/);
  });

  it("help names each verb", () => {
    expect(run(["product", "--help"], tmp)).toContain("rex product edit");
    expect(run(["change", "--help"], tmp)).toContain("rex change apply");
  });
});

describe("on a v1 tree", () => {
  beforeEach(() => {
    run(["init", tmp], tmp);
  });

  it("rex add --title adds a level-based item as before", () => {
    const out = run(["add", "--title=Auth", tmp], tmp);
    expect(out).toContain("Created epic: Auth");
    expect(out).not.toContain("Placement");
  });

  it("rex product and rex change refuse, naming the v1 layout", () => {
    expect(run(["product", "show"], tmp, true)).toMatch(/v1 layout/);
    expect(run(["change", "place", "x"], tmp, true)).toMatch(/v1 layout/);
  });
});
