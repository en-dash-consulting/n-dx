/**
 * E2E: `rex add`, `rex product` and `rex change` dispatch on the tree layout.
 * On a v2 tree, add creates a change and names its placement; on a v1 tree
 * add is untouched and the product-layer verbs refuse.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { FIXTURE_CHANGE, FIXTURE_TASK, completeFixtureTask, copyV2Fixture } from "../helpers/v2-fixture.js";

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
    const place = run(["change", "place", "CH-1"], tmp);
    expect(place).toContain("CH-1 Add Apple Pay");
    expect(place).toMatch(/A1\.1 Pay by card \(amends, (strong|possible|weak)\)/);
    const placeJson = JSON.parse(run(["change", "place", "CH-1", "--format=json", tmp], tmp));
    expect(placeJson.tied).toBe(false);
    expect(placeJson.shortlist[0]).toMatchObject({ target: "a0000000-0000-4000-8000-000000000002", strength: expect.stringMatching(/^(strong|possible|weak)$/) });
    expect(run(["change", "apply", "CH-1", tmp], tmp, true)).toMatch(/Cannot apply change CH-1: task \S+ is not completed/);
    run(["update", FIXTURE_TASK, "--status=completed", tmp], tmp);
    expect(run(["change", "apply", "CH-1", tmp], tmp)).toContain("Applied CH-1 Add Apple Pay.");
    // Applied while in progress: completing it closes it without applying again.
    const closed = run(["update", FIXTURE_CHANGE, "--status=completed", "--format=json", tmp], tmp);
    expect(closed).toMatch(/"changeCompleted": true/);
    expect(closed).toMatch(/"applied": false/);
    expect(closed).toMatch(/"reason": "already applied at /);
  });

  it("rex product edit takes repeatable --capability-criterion", async () => {
    await completeFixtureTask(join(tmp, ".rex"));
    run(["change", "apply", "CH-1"], tmp);
    const out = run(["product", "edit", "A1.1", "--capability-criterion", "c9: A refund reaches the card", "--capability-criterion=c1: Charged once"], tmp);
    expect(out).toMatch(/it now reads revised/);
    expect(run(["product", "show", "A1.1"], tmp)).toMatch(/c1: Charged once[\s\S]*c9: A refund reaches the card/);
  });

  it("rex remove takes a change id and deletes the change with its task", () => {
    const out = run(["remove", FIXTURE_CHANGE, "--yes", tmp], tmp);
    expect(out).toMatch(/Removed change: Add Apple Pay \(2 items\)/);
    expect(existsSync(join(tmp, ".rex", "changes", "add-apple-pay"))).toBe(false);
    expect(run(["remove", FIXTURE_CHANGE, "--yes", tmp], tmp, true)).toMatch(/not found/);
  });

  it("rex remove refuses a product node and a level", () => {
    expect(run(["remove", "A1.1", "--yes", tmp], tmp, true)).toMatch(/product layer/);
    expect(run(["remove", "task", FIXTURE_TASK, tmp], tmp, true)).toMatch(/type, not a level/);
  });

  it("rex remove fails naming the holder while the PRD lock is held", async () => {
    await writeFile(join(tmp, ".rex", "prd.lock"), JSON.stringify({ pid: process.pid, token: "t", timestamp: new Date().toISOString() }));
    expect(run(["remove", FIXTURE_CHANGE, "--yes", tmp], tmp, true)).toContain(`Held by PID ${process.pid}`);
    expect(existsSync(join(tmp, ".rex", "changes", "add-apple-pay"))).toBe(true);
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
