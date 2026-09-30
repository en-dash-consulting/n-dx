/**
 * SourceVision reads the project config from the layout it is actually on.
 *
 * The config file moved with everything else: `.n-dx.json` at the root on the
 * legacy layout, `.ndx/config.json` on the new one. Every reader below used to
 * name the legacy path itself — one of them by deriving it as
 * `resolve(svDir, "..")` joined to `.n-dx.json`, which on a `.ndx` project
 * resolves to `.ndx/.n-dx.json`, a file nothing ever writes.
 *
 * The failure mode is what makes this worth pinning: a missing config is a
 * legitimate state, so every one of these readers falls back to its default
 * without an error. Risk justifications, zone types, language and inventory
 * overrides, archetype overrides, workspace members and declared seams were all
 * simply ignored on a new-layout project, and the analysis still succeeded —
 * with different results and nothing to say why.
 *
 * Both layouts are asserted for each reader. A test on the new layout alone
 * would pass against a build that had swapped one hard-coded literal for
 * another, which is the same bug pointing the other way.
 *
 * @see packages/llm-client/src/layout.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveLayout } from "@n-dx/llm-client";
import { loadRiskJustifications, loadZoneTypes } from "../../src/cli/commands/analyze.js";
import { loadInventoryConfig, detectLanguage } from "../../src/language/detect.js";
import { setArchetypeOverride } from "../../src/util/archetype-overrides.js";
import { loadWorkspaceConfig, saveWorkspaceConfig } from "../../src/analyzers/workspace-aggregate.js";
import { readDeclaredConfig, projectConfigFor } from "../../src/export/iso-declared.js";

/** Where each layout keeps the project config, relative to the project root. */
const LAYOUTS = [
  { name: "legacy", container: null, configFile: ".n-dx.json" },
  { name: "ndx", container: ".ndx", configFile: join(".ndx", "config.json") },
] as const;

/** One config exercising every key the readers below look at. */
const CONFIG = {
  language: "go",
  sourcevision: {
    codeOnly: false,
    extraExtensions: [".mdx"],
    riskJustifications: [{ zoneId: "web-server", reason: "composition root" }],
    zones: { types: { "web-server": "entrypoint" } },
    isoMap: {
      injectionSeams: [{ from: "start.ts", to: "register-scheduler.ts" }],
      infrastructure: [{ id: "queue", name: "Job queue" }],
    },
  },
};

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "sv-project-config-"));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe.each(LAYOUTS)("sourcevision project config on the $name layout", ({ container, configFile }) => {
  /** The path this layout's config belongs at, created with CONFIG in it. */
  let configPath: string;

  beforeEach(() => {
    if (container) mkdirSync(join(projectDir, container), { recursive: true });
    configPath = join(projectDir, configFile);
    writeFileSync(configPath, JSON.stringify(CONFIG, null, 2), "utf-8");
  });

  it("is the file the resolver names", () => {
    expect(resolveLayout(projectDir).configFile).toBe(configPath);
  });

  it("reads risk justifications", () => {
    expect(loadRiskJustifications(resolveLayout(projectDir).configFile)).toEqual(
      CONFIG.sourcevision.riskJustifications,
    );
  });

  it("reads zone types", () => {
    expect(loadZoneTypes(resolveLayout(projectDir).configFile)).toEqual(
      CONFIG.sourcevision.zones.types,
    );
  });

  it("reads inventory overrides", async () => {
    await expect(loadInventoryConfig(projectDir)).resolves.toEqual({
      codeOnly: false,
      extraExtensions: [".mdx"],
    });
  });

  it("reads the language override", async () => {
    const config = await detectLanguage(projectDir);
    expect(config.id).toBe("go");
  });

  it("reads declared seams and infrastructure", () => {
    const declared = readDeclaredConfig(projectDir);
    expect(declared.seams).toHaveLength(1);
    expect(declared.infrastructure).toHaveLength(1);
  });

  it("agrees with the standalone iso bundle about where the config lives", () => {
    expect(projectConfigFor(projectDir)).toBe(resolveLayout(projectDir).configFile);
  });

  it("writes archetype overrides back into the same file", () => {
    setArchetypeOverride(projectDir, "src/app.ts", "entrypoint");

    const written = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(written.sourcevision.archetypes.overrides["src/app.ts"]).toBe("entrypoint");
    // The override must not land in a second config the readers never open.
    const other =
      container === null ? join(projectDir, ".ndx", "config.json") : join(projectDir, ".n-dx.json");
    expect(existsSync(other)).toBe(false);
  });

  it("round-trips workspace configuration", () => {
    saveWorkspaceConfig(projectDir, { members: [{ path: "packages/a", prefix: "a" }] } as never);

    const loaded = loadWorkspaceConfig(projectDir);
    expect(loaded?.members).toEqual([{ path: "packages/a", prefix: "a" }]);
    // Saving must not drop the keys that were already there.
    const written = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(written.language).toBe("go");
  });
});

describe("a .ndx project ignores a stray legacy config", () => {
  // The bug this file exists for, stated directly: with `.ndx/` in force the
  // readers must not fall back to the root `.n-dx.json`. A repository that has
  // migrated can still have the old file lying around untracked, and reading it
  // would resurrect settings the operator believes they moved.
  beforeEach(() => {
    mkdirSync(join(projectDir, ".ndx"), { recursive: true });
    writeFileSync(join(projectDir, ".n-dx.json"), JSON.stringify(CONFIG, null, 2), "utf-8");
  });

  it("reports no risk justifications", () => {
    expect(loadRiskJustifications(resolveLayout(projectDir).configFile)).toBeUndefined();
  });

  it("reports no zone types", () => {
    expect(loadZoneTypes(resolveLayout(projectDir).configFile)).toBeUndefined();
  });

  it("reports no inventory overrides", async () => {
    await expect(loadInventoryConfig(projectDir)).resolves.toEqual({});
  });

  it("reports no declared architecture", () => {
    expect(readDeclaredConfig(projectDir)).toEqual({ seams: [], infrastructure: [] });
  });

  it("reports no workspace members", () => {
    expect(loadWorkspaceConfig(projectDir)).toBeNull();
  });
});
