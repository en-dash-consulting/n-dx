/** `rex health` on a v2 tree: the tree rules run, and the capability-criteria threshold comes from config. */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cmdHealth } from "../../../../src/cli/commands/health.js";
import { withPrdModelTransaction } from "../../../../src/store/prd-model-transaction.js";
import { indexTree } from "../../../../src/schema/v2-rules.js";
import { copyV2Fixture, editText } from "../../../helpers/v2-fixture.js";

const CAPABILITY = "a0000000-0000-4000-8000-000000000002";

let tmp: string;
let rexDir: string;
let out: string[];

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "rex-health-v2-"));
  rexDir = await copyV2Fixture(join(tmp, ".rex"), "lf");
  await writeFile(join(rexDir, "config.json"), JSON.stringify({ schema: "rex/v1", project: "t", adapter: "file" }));
  out = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
});
afterEach(async () => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
  await rm(tmp, { recursive: true, force: true });
});

async function setCapabilityCriteria(n: number) {
  await withPrdModelTransaction(rexDir, (model) => {
    const tree = structuredClone(model.tree);
    const capability = indexTree(tree).resolve(CAPABILITY) as unknown as { criteria: unknown[] };
    capability.criteria = Array.from({ length: n }, (_, i) => ({ id: `k${i}`, text: `Capability criterion ${i}` }));
    return { tree, result: undefined };
  });
}

async function run(): Promise<string> {
  out.length = 0;
  await cmdHealth(tmp, {});
  return out.join("\n");
}

describe("rex health on a v2 tree", () => {
  it("warns naming a capability over the default 15 capability criteria", async () => {
    await setCapabilityCriteria(16);
    const text = await run();
    expect(text).toContain("Pay by card");
    expect(text).toContain("criteria-growth");
  });

  it("gives no criteria-growth warning at the threshold", async () => {
    await setCapabilityCriteria(15);
    expect(await run()).not.toContain("criteria-growth");
  });

  it("reads rex.structureHealth.maxCriteriaPerCapability from .n-dx.json", async () => {
    await setCapabilityCriteria(5);
    expect(await run()).not.toContain("criteria-growth");
    await writeFile(join(tmp, ".n-dx.json"), JSON.stringify({ rex: { structureHealth: { maxCriteriaPerCapability: 4 } } }));
    expect(await run()).toContain("criteria-growth");
  });
});

describe("rex health exit code on a v2 tree", () => {
  const capabilityFile = () => join(rexDir, "product", "checkout", "pay-by-card.md");

  async function runExit(): Promise<string | number | undefined> {
    process.exitCode = undefined;
    await cmdHealth(tmp, { format: "json" });
    return process.exitCode;
  }

  it("exits 0 on a clean tree", async () => {
    expect(await runExit()).toBeUndefined();
  });

  it("exits 0 when the tree rules report only warnings", async () => {
    await setCapabilityCriteria(16);
    expect(await runExit()).toBeUndefined();
    expect(JSON.parse(out.join("\n")).treeRules).toContainEqual(expect.objectContaining({ rule: "criteria-growth", severity: "warning" }));
  });

  it("exits 1 when a tree rule reports an error", async () => {
    await editText(capabilityFile(), (t) => t.replace('criteria: [', 'dependsOn: ["a0000000-0000-4000-8000-000000000099"]\ncriteria: ['));
    expect(await runExit()).toBe(1);
    expect(JSON.parse(out.join("\n")).treeRules).toContainEqual(expect.objectContaining({ severity: "error" }));
  });

  it("exits 1 when the reader skipped a folder with no index.md", async () => {
    await mkdir(join(rexDir, "product", "orphan-area"));
    expect(await runExit()).toBe(1);
    expect(JSON.parse(out.join("\n")).warnings).toEqual([expect.objectContaining({ skipped: true })]);
  });

  it("exits 1 when the reader skipped a node with invalid intent", async () => {
    await editText(capabilityFile(), (t) => t.replace('type: "capability"', 'type: "bogus"'));
    expect(await runExit()).toBe(1);
  });

  it("exits 1 when the reader skipped a node with unreadable frontmatter", async () => {
    await writeFile(capabilityFile(), "no frontmatter here\n");
    expect(await runExit()).toBe(1);
  });

  it("exits 0 when the only reader warning is benign: a slug that differs from the stored name", async () => {
    await editText(capabilityFile(), (t) => t.replace('slug: "pay-by-card"', 'slug: "pay-with-card"'));
    expect(await runExit()).toBeUndefined();
    const { warnings } = JSON.parse(out.join("\n"));
    expect(warnings).toEqual([expect.objectContaining({ message: expect.stringContaining("differs from the stored name") })]);
    expect(warnings[0]).not.toHaveProperty("skipped");
  });
});

describe("rex health title-release-token on a v2 tree", () => {
  const CHANGE_TITLE = "Add Apple Pay";

  async function retitleChange(title: string, plannedRelease?: string) {
    await withPrdModelTransaction(rexDir, (model) => {
      const tree = structuredClone(model.tree);
      const change = tree.changes.find((n) => n.title === CHANGE_TITLE) as unknown as { title: string; plannedRelease?: string };
      change.title = title;
      if (plannedRelease) change.plannedRelease = plannedRelease;
      return { tree, result: undefined };
    });
  }

  it("flags a change titled with its own plannedRelease", async () => {
    await retitleChange("0.9.0 release audit", "0.9.0");
    const text = await run();
    expect(text).toContain("title-release-token");
    expect(text).toContain("0.9.0");
  });

  it("prints the finding as a warning and does not fail the command", async () => {
    await retitleChange("0.9.0 release audit", "0.9.0");
    process.exitCode = undefined;
    await expect(cmdHealth(tmp, {})).resolves.toBeUndefined();
    expect(process.exitCode).toBeUndefined();
    out.length = 0;
    await cmdHealth(tmp, { format: "json" });
    const { treeRules } = JSON.parse(out.join("\n"));
    expect(treeRules).toContainEqual(expect.objectContaining({ rule: "title-release-token", severity: "warning" }));
    expect(treeRules.filter((f: { severity: string }) => f.severity === "error")).toEqual([]);
  });

  it("flags a title naming the package.json version", async () => {
    await writeFile(join(tmp, "package.json"), JSON.stringify({ name: "p", version: "2.4.1" }));
    await retitleChange("Ship 2.4.1 hardening");
    expect(await run()).toContain("title-release-token");
  });

  it("does not flag a dependency version that is not a project release", async () => {
    await retitleChange("Upgrade zod to 3.25.76", "0.9.0");
    expect(await run()).not.toContain("title-release-token");
  });
});

describe("rex health reader warnings on a v2 tree", () => {
  it("reports a node with invalid intent frontmatter by path", async () => {
    const file = join(rexDir, "product", "checkout", "pay-by-card.md");
    await writeFile(file, (await readFile(file, "utf-8")).replace('type: "capability"', 'type: "bogus"'));
    const text = await run();
    expect(text).toContain("Reader warnings:");
    expect(text).toContain("pay-by-card.md");
    expect(text).toContain("Invalid node intent, skipped");
  });

  it("reports a folder without index.md as skipped", async () => {
    await mkdir(join(rexDir, "product", "orphan-area"));
    await writeFile(join(rexDir, "product", "orphan-area", "note.md"), "x");
    const text = await run();
    expect(text).toContain("Reader warnings:");
    expect(text).toContain("orphan-area");
    expect(text).toContain("no index.md");
  });

  it("prints no warnings heading for a clean tree", async () => {
    expect(await run()).not.toContain("Reader warnings");
  });

  it("includes warnings in the JSON payload beside treeRules", async () => {
    await mkdir(join(rexDir, "product", "orphan-area"));
    out.length = 0;
    await cmdHealth(tmp, { format: "json" });
    const payload = JSON.parse(out.join("\n"));
    expect(payload).toHaveProperty("treeRules");
    expect(payload.warnings).toEqual([expect.objectContaining({ path: expect.stringContaining("orphan-area") })]);
  });
});

describe("rex health landing check on a v2 tree", () => {
  const sh = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], {
      cwd,
      encoding: "utf-8",
    });

  async function completeChange(projectDir: string) {
    const state = join(projectDir, ".rex", "changes", "add-apple-pay", "state.yaml");
    await writeFile(state, (await readFile(state, "utf-8")).replace('"in_progress"', '"completed"'));
  }

  it("prints a completed change squash-merged without its trailer, with the reachable-from-main reason", async () => {
    sh(tmp, "init", "-q", "-b", "main");
    sh(tmp, "add", ".");
    sh(tmp, "commit", "-q", "-m", "Add Apple Pay (#12)");
    await completeChange(tmp);
    const text = await run();
    expect(text).toContain("Not landed on main");
    expect(text).toContain("Add Apple Pay");
    expect(text).toContain("reachable from main");
  });

  it("reports the landing check unavailable on a shallow clone, without failing the command", async () => {
    const origin = join(tmp, "origin");
    sh(tmp, "init", "-q", "-b", "main", origin);
    for (const name of ["one", "two"]) {
      await writeFile(join(origin, name), name);
      sh(origin, "add", ".");
      sh(origin, "commit", "-q", "-m", name);
    }
    const clone = join(tmp, "clone");
    // --depth is ignored for a plain local path; a file URL makes git honour it.
    sh(tmp, "clone", "-q", "--depth", "1", pathToFileURL(origin).href, clone);
    await cp(rexDir, join(clone, ".rex"), { recursive: true });
    await completeChange(clone);
    out.length = 0;
    await cmdHealth(clone, {});
    const text = out.join("\n");
    expect(text).toContain("Landing check unavailable");
    expect(text).toContain("shallow clone");
    expect(text).toContain("Tree rules");
  });
});
