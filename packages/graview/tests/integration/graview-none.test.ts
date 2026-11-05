/**
 * With no graview binary anywhere and npx not allowed, nothing is downloaded:
 * `emit` still writes the projection, every command that needs graview stops
 * with exit 1 and a sentence on how to install it, and `info` names the
 * source as `none`. The opt-in brings npx back; a local `false` vetoes a
 * shared `true`. PATH points at an empty directory and there is no n-dx CLI
 * to ask for a face, so nothing real is found or run.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolveLayout } from "../../src/llm-gateway.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { main } from "../../src/cli/index.js";
import { GRAVIEW_BIN_ENV, GRAVIEW_NPX_ENV } from "../../src/graview-bin.js";
import { GRAVIEW_VERSION } from "../../src/document.js";
import { makeProject } from "../helpers/project.js";

let root: string;
let home: string;
let emptyPath: string;
let out: string[];
let err: string[];

beforeEach(() => {
  root = makeProject();
  home = mkdtempSync(join(tmpdir(), "graview-none-home-"));
  emptyPath = mkdtempSync(join(tmpdir(), "graview-none-path-"));
  vi.stubEnv("NDX_HOME", home);
  vi.stubEnv("PATH", emptyPath);
  vi.stubEnv(GRAVIEW_BIN_ENV, "");
  vi.stubEnv(GRAVIEW_NPX_ENV, "");
  vi.stubEnv("NDX_CLI_PATH", "");
  out = [];
  err = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => void out.push(String(line)));
  vi.spyOn(console, "error").mockImplementation((line: unknown) => void err.push(String(line)));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const dir of [root, home, emptyPath]) rmSync(dir, { recursive: true, force: true });
});

const source = async (): Promise<string> => {
  out.length = 0;
  expect(await main(["info", root, "--json"])).toBe(0);
  return (JSON.parse(out.join("\n")) as { graview: { source: string } }).graview.source;
};

describe("no graview binary and no opt-in", () => {
  it("emit still writes the projection", async () => {
    expect(await main(["emit", root, "--quiet"])).toBe(0);
  });

  it.each(["check", "describe", "mcp"])("%s stops with exit 1 and says how to install graview, before it writes anything", async (sub) => {
    expect(await main([sub, root, "--quiet"])).toBe(1);
    expect(existsSync(join(resolveLayout(root).graviewDir, "snapshot.json")), "nothing was emitted").toBe(false);
    const said = err.join("\n");
    expect(said).toContain(`ndx graview ${sub}: no graview binary found`);
    expect(said).toContain(`npm i -g graview@${GRAVIEW_VERSION}`);
    expect(said).toContain("ndx config graview.allowNpx true .");
  });

  it("serve --no-face stops too: the bare store needs graview", async () => {
    expect(await main(["serve", root, "--no-face", "--quiet"])).toBe(1);
    expect(err.join("\n")).toContain("ndx graview serve: no graview binary found");
  });

  it("info names the source as none", async () => {
    expect(await source()).toBe("none");
  });
});

describe("the npx opt-in", () => {
  it("NDX_GRAVIEW_NPX=1 brings npx back", async () => {
    vi.stubEnv(GRAVIEW_NPX_ENV, "1");
    expect(await source()).toBe("npx");
  });

  it("graview.allowNpx in the user's local config brings npx back; in the shared config it is not read", async () => {
    writeFileSync(join(root, ".n-dx.json"), JSON.stringify({ graview: { allowNpx: true } }));
    expect(await source()).toBe("none");
    writeFileSync(join(root, ".n-dx.local.json"), JSON.stringify({ graview: { allowNpx: true } }));
    expect(await source()).toBe("npx");
    writeFileSync(join(root, ".n-dx.local.json"), JSON.stringify({ graview: { allowNpx: false } }));
    expect(await source()).toBe("none");
  });
});
