/**
 * A graview flag that takes a value keeps it: the value is passed on with the
 * flag, never read as the project directory. Graview 0.1.59 gave `serve`
 * `--allow-origin <origin>`, and `mcp` takes `--remote-url <url>`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { main } from "../../src/cli/index.js";
import { makeProject } from "../helpers/project.js";

let root: string;
let home: string;
let out: string[];

beforeEach(() => {
  root = makeProject();
  home = mkdtempSync(join(tmpdir(), "graview-args-home-"));
  vi.stubEnv("NDX_HOME", home);
  vi.stubEnv("NDX_CLI_PATH", "");
  out = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => void out.push(String(line)));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const dir of [root, home]) rmSync(dir, { recursive: true, force: true });
});

describe("a graview flag's value", () => {
  it.each(["--allow-origin", "--remote-url", "--previous", "--views", "--face"])("%s keeps its value, and the directory after it is the project", async (flag) => {
    expect(await main(["info", flag, "http://127.0.0.1:9999", root, "--json"])).toBe(0);
    expect((JSON.parse(out.join("\n")) as { projectRoot: string }).projectRoot).toBe(root);
  });
});
