/**
 * The `npx -y graview@<pinned>` fallback never runs a graview the repository
 * ships (#686 follow-up). npx resolves a local install from its working
 * directory first, so run from the project root it would execute the
 * checkout's `node_modules/.bin/graview`. The stub `npx` here does what npx
 * does with a local install, and records where it ran, so nothing is fetched.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { tmpdir } from "node:os";
import { main } from "../../src/cli/index.js";
import { GRAVIEW_VERSION } from "../../src/document.js";
import { makeProject } from "../helpers/project.js";

let root: string;
let home: string;
let stubs: string;

const plantedMarker = () => join(root, "planted.ran");
const npxCwdFile = () => join(stubs, "npx.cwd");
const npxArgsFile = () => join(stubs, "npx.args");

function executable(path: string, body: string): void {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

beforeEach(() => {
  root = makeProject();
  home = mkdtempSync(join(tmpdir(), "graview-npx-home-"));
  stubs = mkdtempSync(join(tmpdir(), "graview-npx-stubs-"));

  // A repository that installs graview at the pinned release, with a bin that leaves a marker.
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "planted", dependencies: { graview: GRAVIEW_VERSION } }));
  mkdirSync(join(root, "node_modules", "graview"), { recursive: true });
  writeFileSync(join(root, "node_modules", "graview", "package.json"), JSON.stringify({ name: "graview", version: GRAVIEW_VERSION, bin: { graview: "cli.sh" } }));
  mkdirSync(join(root, "node_modules", ".bin"));
  executable(join(root, "node_modules", ".bin", "graview"), `#!/bin/sh\necho ran > ${JSON.stringify(plantedMarker())}\n`);
  // No product face: the user's own local config points it nowhere.
  writeFileSync(join(root, ".n-dx.local.json"), JSON.stringify({ graview: { app: join(root, "no-face") } }));

  // npx: run the local install when the cwd has one, as npx does; otherwise succeed quietly.
  executable(
    join(stubs, "npx"),
    `#!/bin/sh\npwd > ${JSON.stringify(npxCwdFile())}\nprintf '%s\\n' "$@" > ${JSON.stringify(npxArgsFile())}\nif [ -x node_modules/.bin/graview ]; then exec node_modules/.bin/graview; fi\nexit 0\n`,
  );

  vi.stubEnv("NDX_HOME", home);
  vi.stubEnv("NDX_GRAVIEW_BIN", "");
  vi.stubEnv("PATH", `${stubs}:/usr/bin:/bin`);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const dir of [root, home, stubs]) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("the npx fallback", () => {
  it("does not run a graview the repository installs, and runs outside the project", async () => {
    expect(await main(["check", root, "--quiet"])).toBe(0);
    expect(existsSync(npxCwdFile())).toBe(true);
    expect(existsSync(plantedMarker())).toBe(false);
    const cwd = readFileSync(npxCwdFile(), "utf-8").trim();
    expect(`${cwd}${sep}`.startsWith(`${realpathSync(root)}${sep}`)).toBe(false);
    expect(`${cwd}${sep}`.startsWith(`${realpathSync(home)}${sep}`)).toBe(true);
  });

  it("still resolves a relative path flag against the project, not its own directory", async () => {
    expect(await main(["check", root, "--quiet", "--sqlite", "store.db", "--data=data"])).toBe(0);
    const args = readFileSync(npxArgsFile(), "utf-8").trim().split("\n");
    expect(args).toContain(join(root, "store.db"));
    expect(args).toContain(`--data=${join(root, "data")}`);
  });
});
