/**
 * A build-file reader that throws costs the Java pack only the cross-module
 * test links its grants allow: every other import still resolves, the pack is
 * not degraded, and the failure comes back as a notice.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { skipUnlessGrammar } from "@n-dx/lang-runtime";

import { javaGrammarPath } from "../../src/java-pack.js";
import { pack } from "../../src/pack.js";

vi.mock("../../src/java-test-artifacts.js", () => ({
  readTestArtifactGrants: vi.fn(async () => {
    throw new Error("app/pom.xml: unexpected end of document");
  }),
}));

const APP_MAIN = "app/src/main/java/com/acme/app/App.java";
const APP_MODEL = "app/src/main/java/com/acme/app/Model.java";
const APP_TEST = "app/src/test/java/com/acme/app/AppTest.java";
const DAO_TEST = "dao/src/test/java/com/acme/dao/DaoTestBase.java";
const files: Record<string, string> = {
  "pom.xml": "<project><modules><module>app</module><module>dao</module></modules></project>",
  "app/pom.xml": "<project><artifactId>app</artifactId>",
  [APP_MAIN]: "package com.acme.app;\nclass App { Model m; }\n",
  [APP_MODEL]: "package com.acme.app;\nclass Model {}\n",
  [APP_TEST]: "package com.acme.app;\nimport com.acme.dao.DaoTestBase;\nclass AppTest { App a; DaoTestBase b; }\n",
  [DAO_TEST]: "package com.acme.dao;\nclass DaoTestBase {}\n",
};

describe("java pack when the build files cannot be read", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("still resolves imports and names the failure in a notice", async (ctx) => {
    skipUnlessGrammar(ctx, javaGrammarPath());
    dir = await mkdtemp(join(tmpdir(), "lang-java-build-failure-"));
    for (const [rel, body] of Object.entries(files)) {
      await mkdir(dirname(join(dir, rel)), { recursive: true });
      await writeFile(join(dir, rel), body);
    }
    const sources = [APP_MAIN, APP_MODEL, APP_TEST, DAO_TEST];
    const result = await pack.analyzeProject({ projectDir: dir, files: sources, kinds: ["imports"] });

    expect(result.degraded).toBeUndefined();
    const imports = (path: string) => result.facts.find((f) => f.path === path)?.imports?.files;
    expect(imports(APP_MAIN)).toEqual([{ to: APP_MODEL, symbols: ["Model"] }]);
    // Only the cross-module test-to-test link the grants would have allowed is lost.
    expect(imports(APP_TEST)).toEqual([{ to: APP_MAIN, symbols: ["App"] }]);
    expect(result.notices).toEqual([
      "Java: the build files could not be read (app/pom.xml: unexpected end of document); no test links to another module's test code.",
    ]);
  });
});
