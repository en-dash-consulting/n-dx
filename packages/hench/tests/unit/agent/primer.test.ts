/**
 * Tests for the primer read that seeds orientation.
 *
 * The load-bearing property is the rejection, not the read: an orientation
 * transcript is inherited by every task fork, so a primer stamped against an
 * older analysis would hand the whole loop a confident description of a repo
 * that has since moved. Every unverifiable state — absent, unreadable, empty,
 * unstamped, stamped differently — must therefore come back the same way, and
 * none of them may throw.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readFreshPrimer,
  readPrimerFingerprint,
  stripPrimerMarker,
} from "../../../src/agent/lifecycle/primer.js";
import { sourcevisionFingerprint } from "../../../src/agent/lifecycle/session-cache.js";

const BODY = "src/ holds production code. Build with `pnpm build`, test with `pnpm test`.";

function stamp(fingerprint: string, body = BODY): string {
  return `<!-- sourcevision-primer fingerprint: ${fingerprint} -->\n\n${body}\n`;
}

describe("readPrimerFingerprint", () => {
  it("reads the fingerprint out of the marker line", () => {
    expect(readPrimerFingerprint(stamp("a1b2c3d4e5f60718"))).toBe("a1b2c3d4e5f60718");
  });

  it("returns undefined for an unstamped primer", () => {
    expect(readPrimerFingerprint(BODY)).toBeUndefined();
  });

  it("only reads the first line, so prose cannot forge a stamp", () => {
    expect(readPrimerFingerprint(`${BODY}\n<!-- sourcevision-primer fingerprint: fake -->`))
      .toBeUndefined();
  });
});

describe("stripPrimerMarker", () => {
  it("removes the marker and leaves the prose", () => {
    expect(stripPrimerMarker(stamp("abc123"))).toBe(BODY);
  });

  it("leaves an unstamped primer untouched apart from trimming", () => {
    expect(stripPrimerMarker(`\n${BODY}\n`)).toBe(BODY);
  });
});

describe("readFreshPrimer", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-primer-"));
    await mkdir(join(projectDir, ".sourcevision"), { recursive: true });
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  const writePrimer = (content: string) =>
    writeFile(join(projectDir, ".sourcevision", "PRIMER.md"), content, "utf-8");

  async function writeManifest(analyzedAt: string, gitSha: string): Promise<string> {
    await writeFile(
      join(projectDir, ".sourcevision", "manifest.json"),
      JSON.stringify({ analyzedAt, gitSha }),
      "utf-8",
    );
    return sourcevisionFingerprint(projectDir);
  }

  it("returns the body when the stamp matches the current analysis", async () => {
    const fp = await writeManifest("2026-08-17T13:41:10.697Z", "abc123");
    await writePrimer(stamp(fp));

    expect(await readFreshPrimer(projectDir, fp)).toBe(BODY);
  });

  it("returns undefined when the stamp is from an earlier analysis", async () => {
    const fp = await writeManifest("2026-08-17T13:41:10.697Z", "abc123");
    await writePrimer(stamp("0000000000000000"));

    expect(await readFreshPrimer(projectDir, fp)).toBeUndefined();
  });

  it("returns undefined when the primer is unstamped", async () => {
    const fp = await writeManifest("2026-08-17T13:41:10.697Z", "abc123");
    await writePrimer(BODY);

    expect(await readFreshPrimer(projectDir, fp)).toBeUndefined();
  });

  it("returns undefined when no primer was written, without throwing", async () => {
    const fp = await writeManifest("2026-08-17T13:41:10.697Z", "abc123");

    await expect(readFreshPrimer(projectDir, fp)).resolves.toBeUndefined();
  });

  it("returns undefined for a primer that is nothing but its marker", async () => {
    const fp = await writeManifest("2026-08-17T13:41:10.697Z", "abc123");
    await writePrimer(stamp(fp, "   "));

    expect(await readFreshPrimer(projectDir, fp)).toBeUndefined();
  });

  it("matches on the sentinel when there is no manifest to fingerprint", async () => {
    const fp = await sourcevisionFingerprint(projectDir);
    await writePrimer(stamp(fp));

    expect(await readFreshPrimer(projectDir, fp)).toBe(BODY);
  });
});
