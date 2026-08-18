import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  initGitFixtureRepo,
  initGitFixtureRepoSync,
  cleanupProjectDir,
} from "../../helpers/index.js";

const run = promisify(execFile);

/**
 * Fixture repos must not inherit the machine's line-ending behaviour.
 *
 * `core.autocrlf=true` is the Git-for-Windows installer default and lives in
 * SYSTEM config, so it applies to developers who have never configured git and
 * survives an empty global config. Under it, a fixture writes LF, git checks the
 * file back out as CRLF, and byte-exact content assertions fail on Windows only —
 * looking like a defect in the code under test rather than a fixture setting.
 *
 * The round-trip case is the one that matters: asserting the config value alone
 * would not catch a future git that ignored it.
 */
describe("git fixture repos", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "hench-git-fixture-"));
  });

  afterEach(async () => {
    await cleanupProjectDir(dir);
  });

  async function configValue(key: string): Promise<string> {
    const { stdout } = await run("git", ["config", "--local", key], { cwd: dir });
    return stdout.trim();
  }

  /** Commit LF content, change it, restore it via git, and read the bytes back. */
  async function lfSurvivesCheckout(): Promise<string> {
    const file = join(dir, "src.ts");
    const original = "export const x = 1;\n";

    await writeFile(file, original, "utf-8");
    await run("git", ["add", "."], { cwd: dir });
    await run("git", ["commit", "-m", "initial"], { cwd: dir });

    await writeFile(file, "export const x = 2;\n", "utf-8");
    await run("git", ["checkout", "--", "."], { cwd: dir });

    return readFile(file, "utf-8");
  }

  it("pins line endings so they do not depend on the machine's git config", async () => {
    await initGitFixtureRepo(dir);

    expect(await configValue("core.autocrlf")).toBe("false");
    expect(await configValue("core.eol")).toBe("lf");
  });

  it("restores LF content byte-for-byte through a git checkout", async () => {
    await initGitFixtureRepo(dir);

    expect(await lfSurvivesCheckout()).toBe("export const x = 1;\n");
  });

  it("gives the repo an identity so commits succeed", async () => {
    await initGitFixtureRepo(dir);

    expect(await configValue("user.email")).toBe("test@test.com");
    expect(await configValue("user.name")).toBe("Test");
  });

  it("configures identically in the synchronous form", async () => {
    initGitFixtureRepoSync(dir);

    expect(await configValue("core.autocrlf")).toBe("false");
    expect(await configValue("core.eol")).toBe("lf");
    expect(await lfSurvivesCheckout()).toBe("export const x = 1;\n");
  });
});
