/**
 * Which other modules' test code a module's tests compile against, read from
 * the build files with lang-kit's Maven and Gradle readers:
 *
 * - Maven: a dependency of type `test-jar` or classifier `tests` on a module
 *   of the build, matched by `groupId:artifactId`, shows that module's `test` set;
 * - Gradle: `testFixtures(project(':x'))` shows `:x`'s `testFixtures` set, and
 *   `project(path: ':x', configuration: 'testArtifacts')` (any configuration
 *   naming `test`) shows its `test` set.
 *
 * Main code never sees test code whatever the build says; the resolver
 * applies these only to a test file.
 *
 * @module lang-java/java-test-artifacts
 */

import { stat } from "node:fs/promises";
import { join } from "node:path";
import {
  discoverJavaModules,
  readGradleBuildModels,
  readMavenBuildModels,
  type ModuleBuildModel,
} from "@n-dx/lang-kit";

/** Consumer module directory → provider module directory → the provider's source sets its tests see. */
export type TestArtifactGrants = ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>;

/** The files `discoverJavaModules` takes as a Maven or Gradle build; without one it would walk the whole project. */
const BUILD_FILES = ["pom.xml", "settings.gradle", "settings.gradle.kts", "build.gradle", "build.gradle.kts"];

export async function readTestArtifactGrants(projectDir: string): Promise<TestArtifactGrants> {
  const found = await Promise.all(BUILD_FILES.map((name) => isFile(join(projectDir, name))));
  if (!found.includes(true)) return new Map();
  const layout = await discoverJavaModules(projectDir);
  if (layout.buildSystem === "maven") return mavenGrants(await readMavenBuildModels(projectDir, layout.modules));
  if (layout.buildSystem === "gradle") return gradleGrants(await readGradleBuildModels(projectDir, layout.modules));
  return new Map();
}

function mavenGrants(models: readonly ModuleBuildModel[]): TestArtifactGrants {
  const byCoordinates = new Map<string, string>();
  for (const m of models) {
    if (m.group?.resolved) byCoordinates.set(`${m.group.value}:${m.module}`, m.dir);
  }
  const grants = new Grants();
  for (const m of models) {
    for (const d of m.dependencies) {
      if (d.type !== "test-jar" && d.classifier !== "tests") continue;
      const provider = byCoordinates.get(`${d.group}:${d.artifact}`);
      if (provider !== undefined) grants.add(m.dir, provider, "test");
    }
  }
  return grants.map;
}

function gradleGrants(models: readonly ModuleBuildModel[]): TestArtifactGrants {
  const byPath = new Map(models.map((m) => [m.module, m.dir]));
  const grants = new Grants();
  for (const m of models) {
    for (const p of m.projects ?? []) {
      const provider = byPath.get(p.path);
      if (provider === undefined) continue;
      if (p.testFixtures) grants.add(m.dir, provider, "testFixtures");
      else if (p.configuration !== undefined && /test/i.test(p.configuration)) grants.add(m.dir, provider, "test");
    }
  }
  return grants.map;
}

class Grants {
  readonly map = new Map<string, Map<string, Set<string>>>();

  add(consumer: string, provider: string, set: string): void {
    if (consumer === provider) return; // a module's tests already see its own test code
    let providers = this.map.get(consumer);
    if (!providers) this.map.set(consumer, (providers = new Map()));
    let sets = providers.get(provider);
    if (!sets) providers.set(provider, (sets = new Set()));
    sets.add(set);
  }
}

async function isFile(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null))?.isFile() ?? false;
}
