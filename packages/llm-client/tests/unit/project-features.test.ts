/**
 * Project feature toggles, read from the shared config.
 *
 * The read lives in this package precisely so the dashboard and the hench run
 * loop cannot disagree about whether a toggle is on. These tests pin the
 * behaviour both sides depend on — above all that anything malformed falls
 * back rather than switching a feature on.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  isProjectFeatureEnabled,
  isFailForwardEnabled,
  FAIL_FORWARD_FEATURE,
  FAIL_FORWARD_DEFAULT,
} from "../../src/project-features.js";

describe("project feature toggles", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "project-features-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const writeConfig = (config: unknown) =>
    writeFileSync(join(dir, ".n-dx.json"), JSON.stringify(config), "utf-8");

  it("reads a stored true", () => {
    writeConfig({ features: { git: { failForward: true } } });
    expect(isFailForwardEnabled(dir)).toBe(true);
  });

  it("reads a stored false", () => {
    writeConfig({ features: { git: { failForward: false } } });
    expect(isFailForwardEnabled(dir)).toBe(false);
  });

  it("falls back when the key is absent", () => {
    writeConfig({ features: {} });
    expect(isFailForwardEnabled(dir)).toBe(FAIL_FORWARD_DEFAULT);
  });

  it("falls back when there is no config at all", () => {
    expect(isFailForwardEnabled(dir)).toBe(FAIL_FORWARD_DEFAULT);
  });

  it("falls back when the config is not valid JSON", () => {
    writeFileSync(join(dir, ".n-dx.json"), "{ not json", "utf-8");
    expect(isFailForwardEnabled(dir)).toBe(FAIL_FORWARD_DEFAULT);
  });

  it("falls back when features is not an object", () => {
    writeConfig({ features: "yes" });
    expect(isFailForwardEnabled(dir)).toBe(FAIL_FORWARD_DEFAULT);
  });

  it("does not treat a truthy non-boolean as on", () => {
    // A hand-edited config is the likely source. Only a real boolean counts,
    // or a typo would silently start committing on someone's behalf.
    for (const stored of ["true", 1, {}, []]) {
      writeConfig({ features: { git: { failForward: stored } } });
      expect(isFailForwardEnabled(dir), String(stored)).toBe(FAIL_FORWARD_DEFAULT);
    }
  });

  it("defaults fail-forward to off", () => {
    expect(FAIL_FORWARD_DEFAULT).toBe(false);
  });

  it("names the key the dashboard registry uses", () => {
    expect(FAIL_FORWARD_FEATURE).toBe("git.failForward");
  });

  it("re-reads on every call, so a mid-run change is obeyed", () => {
    writeConfig({ features: { git: { failForward: true } } });
    expect(isFailForwardEnabled(dir)).toBe(true);
    writeConfig({ features: { git: { failForward: false } } });
    expect(isFailForwardEnabled(dir)).toBe(false);
  });

  it("walks an arbitrary dotted key", () => {
    writeConfig({ features: { a: { b: { c: true } } } });
    expect(isProjectFeatureEnabled(dir, "a.b.c", false)).toBe(true);
    expect(isProjectFeatureEnabled(dir, "a.b.missing", false)).toBe(false);
    expect(isProjectFeatureEnabled(dir, "a.b.missing", true)).toBe(true);
  });

  it("reads the v2 layout's config file", () => {
    mkdirSync(join(dir, ".ndx"), { recursive: true });
    writeFileSync(
      join(dir, ".ndx", "config.json"),
      JSON.stringify({ features: { git: { failForward: true } } }),
      "utf-8",
    );
    expect(isFailForwardEnabled(dir)).toBe(true);
  });
});
