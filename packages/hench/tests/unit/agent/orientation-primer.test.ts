/**
 * Orientation seeds itself with the sourcevision primer.
 *
 * Sourcevision already distils a repo summary — layout, build and test
 * commands, conventions — into `.sourcevision/PRIMER.md`. Orientation was
 * rediscovering all of it from scratch, once per repo state, in a session every
 * fork then inherits. Handing it the primer turns that exploration into a
 * shorter confirmation.
 *
 * The primer must be dropped when it is *provably* stale (its stamp disagrees
 * with the current analysis), and kept when staleness is merely unknowable —
 * withholding context on a hunch costs a run something for nothing.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readFreshPrimer,
  buildOrientationPrompt,
} from "../../../src/agent/lifecycle/orientation.js";
import { sourcevisionFingerprint } from "../../../src/agent/lifecycle/session-cache.js";

const MANIFEST = { analyzedAt: "2026-09-01T12:00:00.000Z", gitSha: "abc1234" };
const BODY = "src/ holds code, tests/ holds tests. Build with pnpm build.";

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "hench-orient-primer-"));
  await mkdir(join(projectDir, ".sourcevision"), { recursive: true });
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

async function writeManifest() {
  await writeFile(join(projectDir, ".sourcevision", "manifest.json"), JSON.stringify(MANIFEST));
}

async function writePrimer(stamp?: string) {
  const header = stamp === undefined ? "" : `<!-- sourcevision-primer fingerprint: ${stamp} -->\n\n`;
  await writeFile(join(projectDir, ".sourcevision", "PRIMER.md"), `${header}${BODY}\n`);
}

describe("readFreshPrimer", () => {
  it("returns the body when the stamp matches the current analysis", async () => {
    await writeManifest();
    const fingerprint = await sourcevisionFingerprint(projectDir);
    await writePrimer(fingerprint);

    expect(await readFreshPrimer(projectDir, fingerprint)).toBe(BODY);
  });

  it("drops a primer stamped against an older analysis", async () => {
    await writeManifest();
    const fingerprint = await sourcevisionFingerprint(projectDir);
    await writePrimer("0000000000000000");

    expect(await readFreshPrimer(projectDir, fingerprint)).toBeUndefined();
  });

  it("keeps the primer when the manifest is unreadable — staleness is unknowable", async () => {
    await writePrimer("0000000000000000");

    // No manifest, so the caller's fingerprint is the "absent" sentinel.
    const fingerprint = await sourcevisionFingerprint(projectDir);
    expect(fingerprint).toBe("sv-absent");
    expect(await readFreshPrimer(projectDir, fingerprint)).toBe(BODY);
  });

  it("keeps an unstamped primer — there is nothing to compare", async () => {
    await writeManifest();
    await writePrimer(undefined);

    expect(await readFreshPrimer(projectDir, await sourcevisionFingerprint(projectDir))).toBe(BODY);
  });

  it("returns undefined for an absent primer", async () => {
    await writeManifest();

    expect(await readFreshPrimer(projectDir, await sourcevisionFingerprint(projectDir)))
      .toBeUndefined();
  });

  it("returns undefined for a primer with no body", async () => {
    await writeManifest();
    const fingerprint = await sourcevisionFingerprint(projectDir);
    await writeFile(
      join(projectDir, ".sourcevision", "PRIMER.md"),
      `<!-- sourcevision-primer fingerprint: ${fingerprint} -->\n\n   \n`,
    );

    expect(await readFreshPrimer(projectDir, fingerprint)).toBeUndefined();
  });
});

describe("buildOrientationPrompt", () => {
  it("includes the primer and frames it as unverified when one is given", () => {
    const prompt = buildOrientationPrompt(BODY);

    expect(prompt).toContain(BODY);
    expect(prompt).toContain("not as verified fact");
    // The four orientation questions still stand — the primer supplements them.
    expect(prompt).toContain("Build and test commands");
  });

  it("is byte-identical to the pre-primer prompt when none is given", () => {
    const prompt = buildOrientationPrompt();

    expect(prompt.startsWith("Orient yourself in this repository.")).toBe(true);
    expect(prompt).not.toContain("prior analysis");
  });

  it("stays task-free so every fork shares the prefix", () => {
    // Two calls for the same repo state must produce identical bytes, or forks
    // stop sharing a cached prefix.
    expect(buildOrientationPrompt(BODY)).toBe(buildOrientationPrompt(BODY));
  });
});
