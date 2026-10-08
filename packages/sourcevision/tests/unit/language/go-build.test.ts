import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { readGoBuildModels, readGoWorkFiles } from "../../../src/language/go-build.js";

const FIXTURES = fileURLToPath(new URL("../../fixtures/go-build", import.meta.url));
const ver = (value: string) => ({ resolved: true, value });

const cleanups: string[] = [];
afterEach(async () => {
  for (const d of cleanups.splice(0)) await rm(d, { recursive: true, force: true });
});

describe("go.mod build model", () => {
  it("reads the module, directives and direct and indirect requires, sorted", async () => {
    const [m] = await readGoBuildModels(join(FIXTURES, "modfile"));
    expect(m).toMatchObject({ module: "github.com/example/app/v2", dir: "", buildSystem: "go", group: ver("github.com/example/app"), notices: [] });
    expect(m.goMod).toMatchObject({ go: "1.22.0", toolchain: "go1.22.5" });
    expect(m.dependencies.map((d) => `${d.group}|${d.artifact}|${d.scope}`)).toEqual([
      "github.com/go-chi/chi|v5|direct",
      "github.com/lib|pq|direct",
      "github.com/quoted|dep|direct",
      "github.com/single|dep|direct",
      "golang.org/x|sys|indirect",
      "gopkg.in|yaml.v3|indirect",
    ]);
    expect(m.dependencies.find((d) => d.artifact === "pq")?.version).toEqual(ver("v1.10.9"));
  });

  it("reads both replace forms and exclude", async () => {
    const [m] = await readGoBuildModels(join(FIXTURES, "modfile"));
    expect(m.goMod.replaces).toEqual([
      { old: { path: "github.com/lib/pq" }, new: { path: "../pq" }, local: true },
      { old: { path: "github.com/go-chi/chi/v5", version: "v5.0.10" }, new: { path: "github.com/fork/chi/v5", version: "v5.0.11" }, local: false },
      { old: { path: "golang.org/x/sys" }, new: { path: "./third_party/sys" }, local: true },
    ]);
    expect(m.goMod.excludes).toEqual([
      { path: "github.com/bad/dep", version: "v1.2.3" },
      { path: "github.com/worse/dep", version: "v0.0.1" },
    ]);
  });

  it("turns malformed lines into notices and keeps reading", async () => {
    const [m] = await readGoBuildModels(join(FIXTURES, "broken"));
    expect(m.dependencies.map((d) => d.artifact)).toEqual(["dep"]);
    expect(m.notices).toEqual([
      "go.mod:4: require block is not closed",
      "go.mod:3: require expects a module path and a version",
      "go.mod:6: require expects a module path and a version",
      "go.mod has no module directive",
    ]);
  });

  it("skips vendor, and reports an unreadable or missing go.mod as a notice", async () => {
    const dir = await mkdtemp(join(tmpdir(), "go-build-"));
    cleanups.push(dir);
    await mkdir(join(dir, "svc", "go.mod"), { recursive: true }); // a directory named go.mod
    await mkdir(join(dir, "vendor", "x"), { recursive: true });
    await writeFile(join(dir, "vendor", "x", "go.mod"), "module vendored\n");
    expect(await readGoBuildModels(dir)).toEqual([]);
    const [unreadable, missing] = await readGoBuildModels(dir, ["svc", "missing"]);
    expect(unreadable.notices[0]).toMatch(/^svc\/go\.mod is unreadable/);
    expect(missing.notices).toEqual(["missing/go.mod not found"]);
  });

  it("reads every module of a workspace", async () => {
    const models = await readGoBuildModels(join(FIXTURES, "workspace"));
    expect(models.map((m) => [m.dir, m.module])).toEqual([["api", "example.com/ws/api"], ["lib", "example.com/ws/lib"]]);
  });
});

describe("go.work", () => {
  it("reads go, toolchain, use and replace", async () => {
    const [w] = await readGoWorkFiles(join(FIXTURES, "workspace"));
    expect(w).toEqual({
      file: "go.work",
      go: "1.22",
      toolchain: "go1.22.5",
      use: ["./api", "./lib", "./tools"],
      replaces: [
        { old: { path: "github.com/lib/pq" }, new: { path: "./lib/pq" }, local: true },
        { old: { path: "golang.org/x/sys", version: "v0.20.0" }, new: { path: "golang.org/x/sys", version: "v0.21.0" }, local: false },
      ],
      notices: [],
    });
  });
});
