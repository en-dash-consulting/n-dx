/**
 * `localConfigStatus` fails closed, and keeps "the classifier could not run"
 * apart from "git could not answer", so `ndx ci` and Claude discovery point at
 * the fix that applies: `safe.directory` changes nothing when hench itself is
 * missing, timed out or printed more than core reads.
 *
 * Stand-in classifiers are small node scripts passed as `cli`.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { localConfigStatus } from "../../packages/core/local-config-status.js";

let dir;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ndx-local-config-status-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/** A stand-in `hench` entry point whose body is `source`. */
function standIn(source) {
  const file = join(dir, "hench-stand-in.mjs");
  writeFileSync(file, source);
  return file;
}

describe("localConfigStatus", () => {
  it("reports git's failure as unanswered, not as a classifier error", () => {
    const cli = standIn(`process.stdout.write(JSON.stringify({ config: { localConfigTracked: true, localConfigUnanswered: "dubious ownership" } }));`);
    const status = localConfigStatus(dir, { cli });
    expect(status).toMatchObject({ tracked: true, unanswered: true, classifierError: null });
  });

  it("reports a classifier that cannot run as a classifier error, failing closed", () => {
    const status = localConfigStatus(dir, { cli: join(dir, "missing", "index.js") });
    expect(status.tracked).toBe(true);
    expect(status.unanswered).toBe(false);
    expect(status.classifierError).toEqual(expect.any(String));
  });

  it("reports unreadable output as a classifier error", () => {
    const status = localConfigStatus(dir, { cli: standIn(`process.stdout.write("not json");`) });
    expect(status).toMatchObject({ tracked: true, unanswered: false });
    expect(status.classifierError).toContain("JSON");
  });

  it("reads a classification larger than Node's 1 MB default buffer", () => {
    const cli = standIn(
      `process.stdout.write(JSON.stringify({ padding: "x".repeat(2 * 1024 * 1024), config: { localConfigTracked: false } }));`,
    );
    expect(localConfigStatus(dir, { cli })).toMatchObject({ tracked: false, unanswered: false, classifierError: null });
  });
});
