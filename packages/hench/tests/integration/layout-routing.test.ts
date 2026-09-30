/**
 * Hench's own file access — sourcevision reads, the recovery pathspec
 * scratch files, and the slug-migration report text — follows the project's
 * folder layout, not a fixed `.hench`/`.sourcevision` directory.
 *
 * The paths module (and the shared layout resolver it wraps) made the layout
 * resolvable; this asserts the call sites this task routed through it
 * actually resolve under both layouts. Each of these used to compose
 * `join(projectDir, ".sourcevision", …)` or `".hench/recovery"` itself, so on
 * a `.ndx` project they would have looked in a directory sourcevision/hench
 * never wrote to and silently degraded (no primer, no fingerprint, a
 * recovery hint pointing at a path that does not exist).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveHenchPaths } from "../../src/store/paths.js";
import { sourcevisionFingerprint } from "../../src/agent/lifecycle/session-cache.js";
import { readFreshPrimer, PRIMER_FILE } from "../../src/agent/lifecycle/primer.js";
import { prepareRecoveryPathspecs } from "../../src/agent/lifecycle/uncommitted-work-gate.js";
import { formatMigrationReport } from "../../src/cli/slug-migration-offer.js";

/** Where each layout keeps hench's and sourcevision's state, relative to the project root. */
const LAYOUTS = [
  { name: "legacy", container: null, henchDir: ".hench", sourcevisionDir: ".sourcevision" },
  {
    name: "ndx",
    container: ".ndx",
    henchDir: join(".ndx", "hench"),
    sourcevisionDir: join(".ndx", "sourcevision"),
  },
] as const;

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "hench-layout-routing-"));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

/** Put the project on `layout` before any read runs. */
async function applyLayout(container: string | null): Promise<void> {
  if (container) await mkdir(join(projectDir, container), { recursive: true });
}

describe.each(LAYOUTS)(
  "hench file access on the $name layout",
  ({ container, henchDir, sourcevisionDir }) => {
    it("reads the analysis fingerprint from the layout's sourcevision directory", async () => {
      await applyLayout(container);
      await mkdir(join(projectDir, sourcevisionDir), { recursive: true });
      await writeFile(
        join(projectDir, sourcevisionDir, "manifest.json"),
        JSON.stringify({ analysisFingerprint: "fp-under-test" }),
        "utf-8",
      );

      await expect(sourcevisionFingerprint(projectDir)).resolves.toBe("fp-under-test");
    });

    it("falls back to the sentinel when no manifest exists yet", async () => {
      await applyLayout(container);

      await expect(sourcevisionFingerprint(projectDir)).resolves.toBe("unknown");
    });

    it("reads a fresh primer from the layout's sourcevision directory", async () => {
      await applyLayout(container);
      await mkdir(join(projectDir, sourcevisionDir), { recursive: true });
      await writeFile(
        join(projectDir, sourcevisionDir, PRIMER_FILE),
        "<!-- sourcevision-primer fingerprint: abc123 -->\nLayout, build and test commands.\n",
        "utf-8",
      );

      await expect(readFreshPrimer(projectDir, "abc123")).resolves.toBe(
        "Layout, build and test commands.",
      );
    });

    it("writes recovery pathspecs under the layout's hench directory", async () => {
      await applyLayout(container);

      // A path containing a space forces the pathspec-file path rather than
      // the shell-inert inline form, so the write actually happens.
      const files = await prepareRecoveryPathspecs(projectDir, ["a path/with spaces.md"]);

      expect(files).toBeDefined();
      const recoveryDir = resolveHenchPaths(projectDir).recoveryDir;
      expect(recoveryDir).toBe(join(projectDir, henchDir, "recovery"));
      await expect(
        import("node:fs/promises").then((fs) => fs.access(join(recoveryDir, "pathspec.txt"))),
      ).resolves.toBeUndefined();
      // The reference embedded in the pathspec name reflects the layout too.
      expect(files?.all).toBe(`${henchDir.split("\\").join("/")}/recovery/pathspec.txt`);
    });

    it("reports the PRD tree path under the layout's rex directory", async () => {
      await applyLayout(container);
      const rexRelDir = container === null ? ".rex" : join(".ndx", "rex");

      const report = formatMigrationReport(
        {
          entriesRenamed: 2,
          entriesUnchanged: 1,
          itemsVerified: 3,
          lossless: true,
          slugRuleRecorded: true,
        },
        projectDir,
      );

      const expectedTreePath = join(rexRelDir, "prd_tree");
      expect(report).toContain(`git -C ${projectDir} status ${expectedTreePath}`);
      expect(report).toContain(`git -C ${projectDir} diff -- ${expectedTreePath}`);
    });
  },
);
