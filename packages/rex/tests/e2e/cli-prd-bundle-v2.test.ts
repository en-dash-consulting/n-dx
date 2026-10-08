/**
 * E2E: `rex export` / `rex import-bundle` dispatch on the tree layout and the
 * bundle envelope. A v2 tree exports envelope v2 and round-trips; a v1 bundle
 * imports into a v2 tree; the refusals leave the tree untouched.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildBundle } from "../../src/core/prd-bundle.js";
import type { PRDItem } from "../../src/schema/index.js";
import { copyV2Fixture, editText } from "../helpers/v2-fixture.js";

const cliPath = join(fileURLToPath(import.meta.url), "..", "..", "..", "dist", "cli", "index.js");

const EPIC = "11111111-1111-4111-8111-111111111111";
const TASK = "33333333-3333-4333-8333-333333333333";

function run(args: string[], expectFail = false): string {
  const proc = spawnSync("node", [cliPath, ...args], { encoding: "utf-8", timeout: 20000, stdio: ["ignore", "pipe", "pipe"] });
  const output = (proc.stdout ?? "") + (proc.stderr ?? "");
  if (proc.status !== 0 && !expectFail) throw new Error(`rex ${args.join(" ")} exited ${proc.status}:\n${output}`);
  if (proc.status === 0 && expectFail) throw new Error(`rex ${args.join(" ")} should have failed:\n${output}`);
  return output;
}

async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (d: string): Promise<void> => {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "prd.lock" || entry.name.endsWith(".jsonl")) continue;
      const p = join(d, entry.name);
      if (entry.isDirectory()) await walk(p);
      else out[relative(dir, p).split("\\").join("/")] = await readFile(p, "utf-8");
    }
  };
  await walk(dir);
  return out;
}

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "rex-cli-bundle-v2-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

/** A project whose rex dir is a copy of the v2 fixture. */
async function v2Project(name: string): Promise<{ dir: string; rexDir: string }> {
  const dir = join(tmp, name);
  const rexDir = await copyV2Fixture(join(dir, ".rex"), "lf");
  return { dir, rexDir };
}

/** A project with an empty v2 tree. */
async function emptyV2Project(name: string): Promise<{ dir: string; rexDir: string }> {
  const dir = join(tmp, name);
  const rexDir = join(dir, ".rex");
  await mkdir(join(rexDir, "product"), { recursive: true });
  await writeFile(join(rexDir, "product", "index.md"), '---\ntitle: "Empty"\nschema: "rex/v2"\n---\n');
  return { dir, rexDir };
}

async function writeV1Bundle(path: string): Promise<void> {
  const items = [
    {
      id: EPIC,
      level: "epic",
      title: "Gift cards",
      status: "pending",
      children: [{ id: TASK, level: "task", title: "Validate the code", status: "completed" }],
    },
  ] as PRDItem[];
  await writeFile(path, JSON.stringify(buildBundle({ schema: "rex/v1", title: "Gift shop", items })));
}

describe("rex export / import-bundle on a v2 tree", () => {
  it("exports envelope v2 and round-trips it into an empty v2 tree", async () => {
    const src = await v2Project("src");
    const dest = await emptyV2Project("dest");
    const out = join(tmp, "bundle.json");

    run(["export", `--out=${out}`, src.dir]);
    const bundle = JSON.parse(await readFile(out, "utf-8"));
    expect(bundle).toMatchObject({ bundleVersion: 2, schema: "rex/v2", title: "Fixture shop" });
    expect(bundle.product).toHaveLength(1);
    expect(bundle.changes).toHaveLength(1);

    expect(run(["import-bundle", `--in=${out}`, dest.dir])).toMatch(/Imported 4 new items/);
    expect(await snapshot(dest.rexDir)).toEqual(await snapshot(src.rexDir));
  });

  it("keeps a state.yaml key this build does not declare in state.yaml through the round trip", async () => {
    const src = await v2Project("src");
    const dest = await emptyV2Project("dest");
    const out = join(tmp, "bundle.json");
    // After the declared keys, where the canonical writer puts an unknown one.
    await editText(join(src.rexDir, "changes", "add-apple-pay", "state.yaml"), (text) =>
      text.replace(/( {4}prs: .*\n)/, '$1    futureField: "x"\n'),
    );

    run(["export", `--out=${out}`, src.dir]);
    run(["import-bundle", `--in=${out}`, dest.dir]);
    expect(await readFile(join(dest.rexDir, "changes", "add-apple-pay", "state.yaml"), "utf-8")).toContain('futureField: "x"');
    expect(await readFile(join(dest.rexDir, "changes", "add-apple-pay", "index.md"), "utf-8")).not.toContain("futureField");
    expect(await snapshot(dest.rexDir)).toEqual(await snapshot(src.rexDir));
  });

  it("imports a v1 bundle into the change layer", async () => {
    const dest = await v2Project("dest");
    const bundle = join(tmp, "v1.json");
    await writeV1Bundle(bundle);

    expect(run(["import-bundle", `--in=${bundle}`, dest.dir])).toMatch(/Imported 2 new items/);
    expect(await readFile(join(dest.rexDir, "changes", "gift-cards", "index.md"), "utf-8")).toContain('type: "change"');
    expect(await readFile(join(dest.rexDir, "changes", "gift-cards", "state.yaml"), "utf-8")).toContain('status: "completed"');
    expect(existsSync(join(dest.rexDir, "product", "checkout", "pay-by-card.md"))).toBe(true);
    expect(existsSync(join(dest.rexDir, "prd_tree"))).toBe(false);
  });

  it("refuses --replace without --no-snapshot, then replaces with it", async () => {
    const dest = await v2Project("dest");
    const bundle = join(tmp, "v1.json");
    await writeV1Bundle(bundle);
    const before = await snapshot(dest.rexDir);

    expect(run(["import-bundle", `--in=${bundle}`, "--replace", "--yes", dest.dir], true)).toMatch(/--no-snapshot/);
    expect(await snapshot(dest.rexDir)).toEqual(before);

    run(["import-bundle", `--in=${bundle}`, "--replace", "--yes", "--no-snapshot", dest.dir]);
    expect(existsSync(join(dest.rexDir, "changes", "add-apple-pay"))).toBe(false);
    expect(existsSync(join(dest.rexDir, "changes", "gift-cards", "index.md"))).toBe(true);
  });

  it("refuses --item and an output path inside the rex dir", async () => {
    const src = await v2Project("src");
    expect(run(["export", "--item=checkout", `--out=${join(tmp, "x.json")}`, src.dir], true)).toMatch(/not supported on a v2 tree/);
    expect(run(["export", `--out=${join(src.rexDir, "bundle.json")}`, src.dir], true)).toMatch(/Refusing to write a bundle inside \.rex\//);
    expect(existsSync(join(src.rexDir, "bundle.json"))).toBe(false);
  });
});

describe("rex import-bundle on a v1 tree", () => {
  it("refuses a v2 bundle before writing anything", async () => {
    const src = await v2Project("src");
    const out = join(tmp, "bundle.json");
    run(["export", `--out=${out}`, src.dir]);

    const dest = join(tmp, "v1");
    await mkdir(join(dest, ".rex"), { recursive: true });
    expect(run(["import-bundle", `--in=${out}`, dest], true)).toMatch(/v2 bundle.*v1 tree/);
    expect(existsSync(join(dest, ".rex", "prd_tree"))).toBe(false);
    expect(existsSync(join(dest, ".rex", "product"))).toBe(false);
  });
});
