import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { MAX_BUILD_FILE_BYTES } from "../../src/build-file.js";
import { MAX_PROPERTY_EXPANSION, readMavenBuildModels } from "../../src/java-maven-build.js";

// Semantics and goldens are in sourcevision's tests/unit/language/java-maven-build.test.ts.
describe("readMavenBuildModels", () => {
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

  describe("property interpolation", () => {
    /** The version of a single-module pom with these `<properties>` and `<version>`. */
    async function versionOf(props: Record<string, string>, version: string) {
      const body = Object.entries(props)
        .map(([k, v]) => `<${k}>${v}</${k}>`)
        .join("");
      await file("pom.xml", `<project><groupId>g</groupId><artifactId>a</artifactId><version>${version}</version><properties>${body}</properties></project>`);
      const [model] = await readMavenBuildModels(dir, [{ name: "a", dir: "", sourceRoots: [] }]);
      return model?.version;
    }

    /** `a0=${a1}${a1}`, …, `a(n-1)=${an}${an}`, `an=x`: `${a0}` expands to 2^n characters. */
    function doublingChain(n: number): Record<string, string> {
      const props: Record<string, string> = { [`a${n}`]: "x" };
      for (let i = 0; i < n; i++) props[`a${i}`] = `\${a${i + 1}}\${a${i + 1}}`;
      return props;
    }

    // Without memoisation this is 2^30 calls and never returns; a regression hangs here.
    it("stops a doubling chain at N=30 at the expansion cap", async () => {
      expect(await versionOf(doublingChain(30), "${a0}")).toEqual({
        resolved: false,
        reason: "property expansion too large",
      });
    });

    it("expands a doubling chain that stays within the cap", async () => {
      const n = Math.log2(MAX_PROPERTY_EXPANSION);
      expect(await versionOf(doublingChain(n), "${a0}")).toEqual({ resolved: true, value: "x".repeat(MAX_PROPERTY_EXPANSION) });
    });

    it("caps a single long property and the text around a placeholder", async () => {
      const long = "y".repeat(MAX_PROPERTY_EXPANSION);
      expect(await versionOf({ p: long }, "${p}")).toEqual({ resolved: true, value: long });
      expect(await versionOf({ p: long }, "-${p}")).toEqual({ resolved: false, reason: "property expansion too large" });
      expect(await versionOf({ p: long + "y" }, "${p}")).toEqual({ resolved: false, reason: "property expansion too large" });
    });

    it("reuses a property expanded more than once", async () => {
      expect(await versionOf({ v: "1.${m}", m: "2" }, "${v}-${v}.${project.artifactId}")).toEqual({ resolved: true, value: "1.2-1.2.a" });
    });

    it("still reports cycles and undefined properties", async () => {
      expect(await versionOf({ a: "${b}", b: "${a}" }, "${a}")).toEqual({ resolved: false, reason: "property a refers to itself" });
      expect(await versionOf({ a: "${b}", b: "${b}" }, "${a}-${b}")).toEqual({ resolved: false, reason: "property b refers to itself" });
      expect(await versionOf({ a: "${b}" }, "${a}")).toEqual({ resolved: false, reason: "property b is not defined in the repository" });
    });
  });
});
