/**
 * The plan has to say when its code evidence was taken.
 *
 * A stale `.sourcevision/` reads exactly like a fresh one: every file parses,
 * every zone lists files, and the drafted capability specs come out looking
 * equally authoritative. The operator reviewing a plan is the control here —
 * "Review the drafted capability specs area by area" is its own PRD item — and
 * a reviewer cannot weigh evidence whose age is not stated. This repository's
 * own analysis is routinely weeks old, so the stale case is the common one.
 */

import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { readCodeEvidenceProvenance } from "../../../../src/migrations/v1-to-v2/code-files.js";

let dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs = [];
});

async function projectWithManifest(manifest: unknown | null): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "rex-evidence-prov-"));
  dirs.push(dir);
  await mkdir(join(dir, ".sourcevision"), { recursive: true });
  if (manifest !== null) {
    await writeFile(join(dir, ".sourcevision", "manifest.json"), JSON.stringify(manifest), "utf-8");
  }
  return dir;
}

describe("readCodeEvidenceProvenance", () => {
  it("reports the date and commit the analysis recorded", async () => {
    const dir = await projectWithManifest({
      analyzedAt: "2026-09-28T21:20:03.858Z",
      gitSha: "793b025725b7d138927861b783403d03ace103c7",
    });
    expect(await readCodeEvidenceProvenance(dir)).toEqual({
      analyzedAt: "2026-09-28T21:20:03.858Z",
      gitSha: "793b025725b7d138927861b783403d03ace103c7",
    });
  });

  it("falls back to the sha nested under repo, which older manifests used", async () => {
    const dir = await projectWithManifest({ analyzedAt: "2026-01-01T00:00:00.000Z", repo: { gitSha: "abc1234" } });
    expect(await readCodeEvidenceProvenance(dir)).toEqual({
      analyzedAt: "2026-01-01T00:00:00.000Z",
      gitSha: "abc1234",
    });
  });

  it("answers undefined when there is no manifest, the same case as no evidence", async () => {
    const dir = await projectWithManifest(null);
    expect(await readCodeEvidenceProvenance(dir)).toBeUndefined();
  });

  it("answers undefined for a manifest that records neither field", async () => {
    // Rather than reporting an empty provenance the caller would print as blanks.
    const dir = await projectWithManifest({ schemaVersion: 1 });
    expect(await readCodeEvidenceProvenance(dir)).toBeUndefined();
  });

  it("survives a corrupt manifest rather than failing the plan", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rex-evidence-prov-"));
    dirs.push(dir);
    await mkdir(join(dir, ".sourcevision"), { recursive: true });
    await writeFile(join(dir, ".sourcevision", "manifest.json"), "{ not json", "utf-8");
    expect(await readCodeEvidenceProvenance(dir)).toBeUndefined();
  });
});
