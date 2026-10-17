import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { MAX_BUILD_FILE_BYTES } from "../../src/build-file.js";
import { readMavenBuildModels } from "../../src/java-maven-build.js";

// Semantics and goldens are in sourcevision's tests/unit/language/java-maven-build.test.ts.
describe("readMavenBuildModels size cap", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "lang-kit-maven-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function file(rel: string, body: string): Promise<void> {
    await mkdir(dirname(join(dir, rel)), { recursive: true });
    await writeFile(join(dir, rel), body);
  }

  it("reports a pom over the build file size cap as a notice and keeps the module", async () => {
    const big = `<project><artifactId>big</artifactId></project>${" ".repeat(MAX_BUILD_FILE_BYTES)}`;
    await file("big/pom.xml", big);
    await file("pom.xml", "<project><groupId>g</groupId><artifactId>root</artifactId><version>1</version></project>");
    const [root, model] = await readMavenBuildModels(dir, [
      { name: "root", dir: "", sourceRoots: [] },
      { name: "big", dir: "big", sourceRoots: [] },
    ]);
    expect(root).toMatchObject({ module: "root", notices: [] });
    expect(model).toEqual({
      module: "big",
      dir: "big",
      buildSystem: "maven",
      dependencies: [],
      notices: [`big/pom.xml is ${big.length} bytes, over the ${MAX_BUILD_FILE_BYTES}-byte build file limit; skipped`],
    });
  });

  it("reads a pom exactly at the cap", async () => {
    const head = "<project><artifactId>edge</artifactId></project>";
    await file("pom.xml", head + " ".repeat(MAX_BUILD_FILE_BYTES - head.length));
    const [model] = await readMavenBuildModels(dir, [{ name: "edge", dir: "", sourceRoots: [] }]);
    expect(model?.notices).toEqual([]);
  });
});
