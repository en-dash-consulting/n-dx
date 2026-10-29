import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { readGradleBuildModels } from "../../src/java-gradle-build.js";

let root: string | undefined;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

it("matches type-safe project accessors to settings module names, including kebab-case and nested paths", async () => {
  root = await mkdtemp(join(tmpdir(), "gradle-projects-"));
  await mkdir(join(root, "app"));
  await writeFile(join(root, "app/build.gradle.kts"), "dependencies {\n testImplementation(testFixtures(projects.dao))\n implementation(projects.daoCore)\n implementation(projects.tools.testSupport)\n}\n");
  const modules = [":app", ":dao", ":dao-core", ":tools:test-support"].map((name) => ({ name, dir: name.slice(1).replaceAll(":", "/"), sourceRoots: [] }));
  const models = await readGradleBuildModels(root, modules);
  expect(models[0]!.projects).toEqual([
    { path: ":dao", scope: "testImplementation", testFixtures: true },
    { path: ":dao-core", scope: "implementation" },
    { path: ":tools:test-support", scope: "implementation" },
  ]);
  expect(models[0]!.notices).toEqual([]);
});

it("refuses ambiguous camel-cased project names instead of granting a test dependency", async () => {
  root = await mkdtemp(join(tmpdir(), "gradle-projects-"));
  await mkdir(join(root, "app"));
  await writeFile(join(root, "app/build.gradle.kts"), "dependencies { testImplementation(testFixtures(projects.daoCore)) }\n");
  const modules = [":app", ":dao-core", ":dao_core"].map((name) => ({ name, dir: name.slice(1), sourceRoots: [] }));
  const models = await readGradleBuildModels(root, modules);
  expect(models[0]!.projects).toBeUndefined();
  expect(models[0]!.notices.join("\n")).toContain("ambiguous");
});
