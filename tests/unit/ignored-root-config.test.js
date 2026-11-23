/**
 * A `.ndx/` project reads `.ndx/config.json`; a root `.n-dx.json` left beside
 * it is ignored. That used to be silent (a `cli.timeouts.analyze: 0` written
 * there never applied, and long analyses were killed at the default limit), so
 * the orchestrator now names the ignored file.
 *
 * @see packages/core/config.js (ignoredRootConfigWarning)
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ignoredRootConfigWarning, loadProjectConfig } from "../../packages/core/config.js";

const CLI_PATH = resolve(import.meta.dirname, "../../packages/core/cli.js");

describe("ignoredRootConfigWarning", () => {
  let dir;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ndx-ignored-config-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("is silent on the legacy layout, where .n-dx.json is the config", async () => {
    await writeFile(join(dir, ".n-dx.json"), JSON.stringify({ cli: { timeouts: { analyze: 0 } } }));
    expect(ignoredRootConfigWarning(dir)).toBeNull();
  });

  it("is silent on the .ndx/ layout with no root config files", async () => {
    await mkdir(join(dir, ".ndx"));
    await writeFile(join(dir, ".ndx", "config.json"), "{}");
    expect(ignoredRootConfigWarning(dir)).toBeNull();
  });

  it("names an ignored .n-dx.json, its sections and where they belong, without values", async () => {
    await mkdir(join(dir, ".ndx"));
    await writeFile(join(dir, ".n-dx.json"), JSON.stringify({ cli: { timeouts: { analyze: 0 } }, llm: { key: "sk-secret" } }));

    // The setting really is not applied: that is what the warning is for.
    expect(await loadProjectConfig(dir)).toEqual({});

    const warning = ignoredRootConfigWarning(dir);
    expect(warning).toContain(".n-dx.json is ignored (sections: cli, llm)");
    expect(warning).toContain(".ndx/config.json");
    expect(warning).not.toContain("sk-secret");
  });

  it("names an ignored .n-dx.local.json against .ndx/config.local.json, even when unparseable", async () => {
    await mkdir(join(dir, ".ndx"));
    await writeFile(join(dir, ".n-dx.local.json"), "{ not json");
    const warning = ignoredRootConfigWarning(dir);
    expect(warning).toContain(".n-dx.local.json is ignored.");
    expect(warning).toContain(".ndx/config.local.json");
  });

  it("is printed once by the orchestrator", async () => {
    await mkdir(join(dir, ".ndx"));
    await writeFile(join(dir, ".n-dx.json"), JSON.stringify({ cli: { timeouts: { analyze: 0 } } }));
    const env = { ...process.env };
    delete env.NDX_IGNORED_CONFIG_NOTICE;
    const out = spawnSync("node", [CLI_PATH, "config", "cli.timeouts.analyze", dir], {
      encoding: "utf-8",
      timeout: 60_000,
      env,
    });
    expect(out.stderr.split(".n-dx.json is ignored").length - 1).toBe(1);
  });
});
