/**
 * `sourcevision readiness` — the scorecard surface.
 *
 * The load-bearing claim is that this command and the `get_readiness` MCP tool
 * answer the same question the same way, and that neither depends on
 * `readiness.json` being present or current. Both read `sdlc-profile.json` and
 * score it; the persisted file exists for readers that only want the headline.
 *
 * @see src/cli/commands/readiness.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  cmdReadiness,
  computeReadinessForProject,
  READINESS_CAVEAT,
} from "../../../src/cli/commands/readiness.js";
import { READINESS_DIMENSIONS } from "../../../src/analyzers/readiness-score.js";
import { DATA_FILES } from "../../../src/schema/data-files.js";
import { CLIError } from "../../../src/cli/errors.js";
import type { SdlcProfile } from "../../../src/schema/v1.js";

/** A profile that found nothing — every section present and empty. */
function emptyProfile(): SdlcProfile {
  return {
    schemaVersion: "1.0.0",
    commands: [],
    tests: { frameworks: [], suites: [] },
    ci: [],
    cd: [],
    rollback: [],
    migrations: [],
    featureFlags: [],
    qualityGates: [],
    observability: [],
    containers: [],
    iac: [],
    parseFailures: [],
  };
}

/** A profile with enough detected to score above zero on testing. */
function profileWithTests(): SdlcProfile {
  return {
    ...emptyProfile(),
    commands: [
      {
        evidence: [{ kind: "manifest-script", path: "package.json", confidence: "certain", excerpt: '"test": "vitest run"' }],
        kind: "test",
        command: "vitest run",
      },
    ],
    tests: {
      frameworks: [
        {
          evidence: [{ kind: "dependency", path: "package.json", confidence: "certain", excerpt: "vitest" }],
          name: "vitest",
          language: "TypeScript",
        },
      ],
      suites: [
        {
          evidence: [{ kind: "file-present", path: "tests/unit/a.test.ts", confidence: "certain" }],
          kind: "unit",
          root: "tests/unit",
          fileCount: 1,
        },
      ],
    },
  };
}

describe("sourcevision readiness", () => {
  let tmpDir: string;
  let svDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-readiness-"));
    svDir = join(tmpDir, ".sourcevision");
    await mkdir(svDir, { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function writeProfile(profile: SdlcProfile): Promise<void> {
    await writeFile(join(svDir, DATA_FILES.sdlcProfile), JSON.stringify(profile), "utf-8");
  }

  describe("without an analysis", () => {
    it("names the command that would produce the profile", () => {
      expect(() => computeReadinessForProject(tmpDir)).toThrow(CLIError);
      expect(() => computeReadinessForProject(tmpDir)).toThrow(/No SDLC profile found/);
    });

    it("points at analyze rather than failing bare", () => {
      try {
        computeReadinessForProject(tmpDir);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as CLIError).suggestion).toContain("sourcevision analyze");
      }
    });

    it("reports an unreadable profile as unreadable, not as absent", async () => {
      await writeFile(join(svDir, DATA_FILES.sdlcProfile), "{ not json", "utf-8");
      expect(() => computeReadinessForProject(tmpDir)).toThrow(/Could not read/);
    });

    /**
     * The profile is a file, so it can be hand-edited or left behind by an
     * analyzer that wrote a different shape. The scorer indexes every section
     * without guarding; without validation a missing one surfaces as a raw
     * TypeError instead of the "re-run analyze" this command owes the user.
     */
    it("rejects well-formed JSON that is not a profile, pointing at analyze", async () => {
      await writeFile(join(svDir, DATA_FILES.sdlcProfile), JSON.stringify({ schemaVersion: "1.0.0" }), "utf-8");

      try {
        computeReadinessForProject(tmpDir);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(CLIError);
        expect((err as CLIError).message).toMatch(/does not match the schema/);
        expect((err as CLIError).suggestion).toContain("sourcevision analyze");
      }
    });

    it("rejects a profile missing one section rather than crashing on it", async () => {
      const { rollback: _dropped, ...withoutRollback } = emptyProfile();
      await writeFile(join(svDir, DATA_FILES.sdlcProfile), JSON.stringify(withoutRollback), "utf-8");

      expect(() => computeReadinessForProject(tmpDir)).toThrow(CLIError);
      expect(() => computeReadinessForProject(tmpDir)).toThrow(/rollback/);
    });
  });

  describe("scoring", () => {
    it("scores every dimension named by the weights constant", async () => {
      await writeProfile(profileWithTests());
      const score = computeReadinessForProject(tmpDir);

      expect(Object.keys(score.dimensions).sort()).toEqual([...READINESS_DIMENSIONS].sort());
      expect(score.overall).toBeGreaterThanOrEqual(0);
      expect(score.overall).toBeLessThanOrEqual(100);
    });

    it("credits detected testing evidence over an empty profile", async () => {
      await writeProfile(emptyProfile());
      const bare = computeReadinessForProject(tmpDir);

      await writeProfile(profileWithTests());
      const withTests = computeReadinessForProject(tmpDir);

      expect(bare.dimensions.testing.score).toBe(0);
      expect(withTests.dimensions.testing.score).toBeGreaterThan(0);
      expect(withTests.overall).toBeGreaterThan(bare.overall);
    });

    /**
     * The on-disk profile has `projectDir` stripped, so a scorer that simply
     * passed it through would read no execution config and score agentSafety
     * zero on every repository. The command collects the input from the
     * directory it was asked about instead.
     */
    it("collects agent safety from the directory asked about, not from the stripped profile", async () => {
      await writeProfile(emptyProfile());
      const score = computeReadinessForProject(tmpDir);

      // A bare temp directory has no .hench/config.json or .mcp.json to widen
      // anything, so repo-trust finds nothing: the gap is "no evidence", not
      // "no project root".
      expect(score.dimensions.agentSafety.gaps.length).toBeGreaterThan(0);
      expect(score.dimensions.agentSafety.gaps[0].wouldRaiseScore).not.toBe("");
    });

    it("gives every gap something that would raise the score", async () => {
      await writeProfile(emptyProfile());
      const score = computeReadinessForProject(tmpDir);

      for (const name of READINESS_DIMENSIONS) {
        for (const gap of score.dimensions[name].gaps) {
          expect(gap.wouldRaiseScore, `${name} gap: ${gap.summary}`).not.toBe("");
        }
      }
    });

    /**
     * `readiness.json` is a cache of the score for readers that want only the
     * headline. Recomputing here is what lets a weight change show up without
     * a re-analysis, so a stale file must not be served.
     */
    it("ignores a stale readiness.json", async () => {
      await writeProfile(emptyProfile());
      await writeFile(
        join(svDir, DATA_FILES.readiness),
        JSON.stringify({ overall: 99, dimensions: {}, suggestions: [] }),
        "utf-8",
      );

      expect(computeReadinessForProject(tmpDir).overall).not.toBe(99);
    });
  });

  describe("output", () => {
    it("--json prints the score verbatim, and nothing else", async () => {
      await writeProfile(profileWithTests());
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      cmdReadiness(tmpDir, { json: true });

      expect(log).toHaveBeenCalledTimes(1);
      const printed = JSON.parse(log.mock.calls[0][0] as string);
      expect(printed).toEqual(computeReadinessForProject(tmpDir));
    });

    it("labels the scorecard heuristic wherever it is published", async () => {
      await writeProfile(profileWithTests());
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      cmdReadiness(tmpDir, {});

      const output = log.mock.calls.map((c) => String(c[0])).join("\n");
      expect(output).toContain(READINESS_CAVEAT);
      expect(output).toContain("SDLC readiness");
    });

    it("lists every file the analyzer could not parse", async () => {
      await writeProfile({
        ...emptyProfile(),
        parseFailures: [
          { path: ".github/workflows/ci.yml", kind: "github-actions", reason: "YAML anchors are not supported" },
        ],
      });
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      cmdReadiness(tmpDir, {});

      const output = log.mock.calls.map((c) => String(c[0])).join("\n");
      expect(output).toContain("Could not parse");
      expect(output).toContain(".github/workflows/ci.yml");
      expect(output).toContain("YAML anchors are not supported");
    });

    it("prints no parse block when every file was read", async () => {
      await writeProfile(profileWithTests());
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      cmdReadiness(tmpDir, {});

      const output = log.mock.calls.map((c) => String(c[0])).join("\n");
      expect(output).not.toContain("Could not parse");
    });

    it("prints a line for every dimension", async () => {
      await writeProfile(profileWithTests());
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      cmdReadiness(tmpDir, {});

      const output = log.mock.calls.map((c) => String(c[0])).join("\n");
      // Labels come from DIMENSION_LABELS; assert on the count rather than the
      // wording so a relabelling is not a test edit.
      expect(READINESS_DIMENSIONS.length).toBe(9);
      const dimensionLines = output
        .split("\n")
        .filter((line) => /^ {2}\S.*\d+ {2}[█·]/.test(line));
      expect(dimensionLines).toHaveLength(READINESS_DIMENSIONS.length);
    });
  });
});
