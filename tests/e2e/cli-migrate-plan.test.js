/**
 * `ndx migrate --plan` through the real CLI: it spawns `rex migrate-plan`,
 * rewriting a space-separated `--out <path>` to `--out=<path>` (else `<path>`
 * is read as the project dir), and forwards rex's exit code and reason. A
 * model pass that stops is recorded in the plan, which apply then refuses.
 *
 * @see packages/core/cli.js handleMigrate
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";

import { createTmpDir, removeTmpDir, run, runResult, setupHenchDir, setupRexDir, setupSourcevisionDir } from "./e2e-helpers.js";

/** Every file under `dir` with its bytes, so "leaves it unchanged" is a comparison. */
function snapshot(dir) {
  const out = {};
  const visit = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) visit(p);
      else out[p.slice(dir.length)] = readFileSync(p, "utf-8");
    }
  };
  visit(dir);
  return out;
}

describe("ndx migrate --plan", () => {
  let dir;
  let outDir;

  beforeEach(async () => {
    dir = await createTmpDir("ndx-e2e-migrate-plan-");
    outDir = await createTmpDir("ndx-e2e-migrate-plan-out-");
    await setupRexDir(dir);
    await setupHenchDir(dir);
    await setupSourcevisionDir(dir);
    run(["rex", "migrate-to-folder-tree", dir]);
  });

  afterEach(async () => {
    await removeTmpDir(dir);
    await removeTmpDir(outDir);
  });

  it("writes the plan at a space-separated --out, not under the project, and leaves prd_tree/ byte-identical", () => {
    const plan = join(outDir, "elsewhere", "plan.json");
    const tree = join(dir, ".rex", "prd_tree");
    const before = snapshot(tree);

    run(["migrate", "--plan", "--rules-only", "--out", plan, dir], { cwd: dir });

    expect(existsSync(plan)).toBe(true);
    expect(existsSync(join(dir, "migration-plan.json"))).toBe(false);
    expect(snapshot(tree)).toEqual(before);
  });

  it("surfaces rex's refusal of an --out inside the rex directory as a non-zero exit naming why", () => {
    const inside = join(dir, ".rex", "plan.json");
    const result = runResult(["migrate", "--plan", "--rules-only", "--out", inside, dir]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Refusing to write a migration plan inside .rex/");
    expect(existsSync(inside)).toBe(false);
  });

  // The stub is a POSIX shell script; Windows would resolve a real `claude` past it.
  it.skipIf(process.platform === "win32")("records a stopped model pass in the plan it keeps for a re-run, and apply refuses that plan", () => {
    // A `claude` that always fails, ahead of any real one on PATH.
    const bin = join(outDir, "bin");
    mkdirSync(bin);
    const stub = join(bin, "claude");
    writeFileSync(stub, "#!/bin/sh\necho 'stub claude: unavailable' >&2\nexit 1\n");
    chmodSync(stub, 0o755);
    const plan = join(outDir, "plan.json");

    // Without these keys the client takes the CLI path (the stub) and Jev stays off,
    // so nothing reaches a paid API.
    const env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` };
    for (const key of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "TYPESAFE_API_KEY"]) delete env[key];
    run(["migrate", "--plan", "--out", plan, dir], { env });

    const { header } = JSON.parse(readFileSync(plan, "utf-8"));
    const stopped = header.passes.filter((p) => p.incomplete);
    expect(stopped.length).toBeGreaterThan(0);
    expect(stopped.map((p) => p.incomplete.error).join("\n")).toContain("stub claude: unavailable");

    const before = snapshot(join(dir, ".rex"));
    const result = runResult(["migrate", "--apply", "--plan", plan, dir], { env });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("The plan is incomplete");
    expect(snapshot(join(dir, ".rex"))).toEqual(before);
  });
});
