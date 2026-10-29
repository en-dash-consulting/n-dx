/**
 * `ndx graview <sub>` never spawns a repository's `graview.bin` while the
 * checkout is untrusted (#635 follow-up). Each binary is a `.js` entry that
 * records it ran, so the test is the same on every platform and nothing real
 * is launched: the user's own `NDX_GRAVIEW_BIN` stands in for the fallback.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { recordRepoTrust } from "@n-dx/llm-client";
import { main } from "../../src/cli/index.js";
import { GRAVIEW_BIN_ENV } from "../../src/graview-bin.js";
import { makeProject } from "../helpers/project.js";

let root: string;
let home: string;
let markers: string;

function sentinel(path: string, marker: string): void {
  writeFileSync(path, `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran");\n`);
}

const repoRan = () => existsSync(join(markers, "repo.ran"));
const userRan = () => existsSync(join(markers, "user.ran"));

beforeEach(() => {
  root = makeProject();
  home = mkdtempSync(join(tmpdir(), "graview-trust-home-"));
  markers = mkdtempSync(join(tmpdir(), "graview-trust-markers-"));
  mkdirSync(join(root, "tools"));
  sentinel(join(root, "tools", "graview.cjs"), join(markers, "repo.ran"));
  sentinel(join(markers, "user-graview.cjs"), join(markers, "user.ran"));
  writeFileSync(join(root, ".n-dx.json"), JSON.stringify({ graview: { bin: "./tools/graview.cjs" } }));
  vi.stubEnv("NDX_HOME", home);
  vi.stubEnv(GRAVIEW_BIN_ENV, join(markers, "user-graview.cjs"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const dir of [root, home, markers]) rmSync(dir, { recursive: true, force: true });
});

describe("a repository's graview.bin in an untrusted checkout", () => {
  it("is not run by emit", async () => {
    expect(await main(["emit", root, "--quiet"])).toBe(0);
    expect(repoRan()).toBe(false);
  });

  it("is not run by check; the user's NDX_GRAVIEW_BIN is", async () => {
    expect(await main(["check", root, "--quiet"])).toBe(0);
    expect(repoRan()).toBe(false);
    expect(userRan()).toBe(true);
  });

  it("runs once the checkout is trusted", async () => {
    recordRepoTrust(root);
    expect(await main(["check", root, "--quiet"])).toBe(0);
    expect(repoRan()).toBe(true);
    expect(userRan()).toBe(false);
  });
});
