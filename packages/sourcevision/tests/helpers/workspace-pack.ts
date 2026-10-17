/**
 * The workspace's language packs, as sourcevision's tests reach them: through
 * the pack loader, never by a static import, so no parser runtime or grammar
 * is needed for the suite to pass.
 *
 * A pack whose grammar is not built answers with a degraded result; a test
 * that needs the pack to run calls {@link skipUnlessPackRuns}, which skips it
 * then. The pack suites are where SV_REQUIRE_GRAMMARS=1 turns a missing
 * grammar into a failure; here it does the same, for an operator who builds
 * the grammars and runs this suite with it set.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LanguagePackEntry } from "@n-dx/lang-kit";
import { KNOWN_PACKS, loadPack } from "../../src/language/pack-loader.js";

/** The part of a test context the gate uses; vitest's `TestContext` has it. */
export interface SkippableTest {
  skip(note?: string): void;
}

/** The workspace pack for language `id`, found by module resolution. Throws when it does not load. */
export async function workspacePack(id: string): Promise<LanguagePackEntry> {
  const known = KNOWN_PACKS.find((p) => p.id === id);
  if (!known) throw new Error(`no known pack for ${id}`);
  const packDir = mkdtempSync(join(tmpdir(), "sv-test-no-packs-"));
  try {
    const load = await loadPack(known, { packDir });
    if (load.status !== "loaded") throw new Error(`${known.packageName}: ${load.notice.reason}`);
    return load.entry;
  } finally {
    rmSync(packDir, { recursive: true, force: true });
  }
}

/** Skip the running test unless the workspace pack for `id` can run (its grammar is built). */
export async function skipUnlessPackRuns(ctx: SkippableTest, id: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const entry = await workspacePack(id);
  const empty = mkdtempSync(join(tmpdir(), "sv-test-pack-probe-"));
  try {
    // No files and no kinds: only the grammar and queries are checked, not a project's build files.
    const { degraded } = await entry.analyzeProject({ projectDir: empty, files: [], kinds: [] });
    if (degraded === undefined) return;
    const message = `${entry.packageName} cannot run: ${degraded.reason}${degraded.remedy ? ` — ${degraded.remedy}` : ""}`;
    if (env["SV_REQUIRE_GRAMMARS"] === "1") throw new Error(`${message} (SV_REQUIRE_GRAMMARS=1 forbids skipping)`);
    ctx.skip(message);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
}
