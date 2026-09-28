import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWebPaths } from "../../../src/server/paths.js";
import { PORT_FILE } from "../../../src/server/start.js";

let legacyRoot: string;
let ndxRoot: string;

beforeAll(() => {
  legacyRoot = mkdtempSync(join(tmpdir(), "web-paths-legacy-"));
  ndxRoot = mkdtempSync(join(tmpdir(), "web-paths-ndx-"));
  mkdirSync(join(ndxRoot, ".ndx"), { recursive: true });
});

afterAll(() => {
  for (const dir of [legacyRoot, ndxRoot]) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveWebPaths", () => {
  it("resolves under .ndx/ when the container is present", () => {
    const paths = resolveWebPaths(ndxRoot);
    const container = join(ndxRoot, ".ndx");

    expect(paths.pidFile).toBe(join(container, "web.pid"));
    expect(paths.portFile).toBe(join(container, "web.port"));
    expect(paths.usageFile).toBe(join(container, "web-usage.jsonl"));
  });

  it("falls back to the loose .n-dx-web files when the container is absent", () => {
    const paths = resolveWebPaths(legacyRoot);

    expect(paths.pidFile).toBe(join(legacyRoot, ".n-dx-web.pid"));
    expect(paths.portFile).toBe(join(legacyRoot, ".n-dx-web.port"));
    expect(paths.usageFile).toBe(join(legacyRoot, ".n-dx-web-usage.jsonl"));
  });

  it("honours an explicit mode, for init and migrate-layout", () => {
    expect(resolveWebPaths(legacyRoot, { mode: "ndx" }).portFile).toBe(
      join(legacyRoot, ".ndx", "web.port"),
    );
  });

  it("agrees with the port-file name the server already publishes", () => {
    // `ndx start stop` finds a running server by this filename, so the
    // resolver and the constant that predates it must not drift while call
    // sites are still being routed through the module.
    expect(resolveWebPaths(legacyRoot).portFile).toBe(join(legacyRoot, PORT_FILE));
  });
});
