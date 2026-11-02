/**
 * `GET /api/changesets` lists pending `.changeset/*.md` files with each
 * package and bump type, from a directory read.
 *
 * @see packages/web/src/server/routes-changesets.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerContext } from "../../../src/server/types.js";
import { handleChangesetsRoute, parseChangeset } from "../../../src/server/routes-changesets.js";
import { startRouteTestServer, type RouteTestServer } from "../../helpers/server-route-test-support.js";

describe("parseChangeset", () => {
  it("reads quoted and unquoted package lines and the summary", () => {
    expect(parseChangeset("a.md", '---\n"@n-dx/web": patch\n\'@n-dx/rex\': major\n@n-dx/core: minor\n---\n\nShip 1.0.0.\n')).toEqual({
      file: "a.md",
      packages: [
        { name: "@n-dx/web", bump: "patch" },
        { name: "@n-dx/rex", bump: "major" },
        { name: "@n-dx/core", bump: "minor" },
      ],
      summary: "Ship 1.0.0.",
    });
  });

  it("reports a file without frontmatter or with an unknown bump instead of skipping it", () => {
    expect(parseChangeset("b.md", "just text")).toMatchObject({ packages: [], error: "No frontmatter block." });
    expect(parseChangeset("c.md", '---\n"@n-dx/web": huge\n---\nx')).toMatchObject({ error: expect.stringContaining("huge") });
  });
});

describe("GET /api/changesets", () => {
  let dir: string;
  let started: RouteTestServer;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "changesets-route-"));
    const ctx: ServerContext = { projectDir: dir, svDir: join(dir, ".sourcevision"), rexDir: join(dir, ".rex"), dev: false };
    started = await startRouteTestServer((req, res) => handleChangesetsRoute(req, res, ctx));
  });

  afterEach(async () => {
    await started.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("answers an empty list when the project has no .changeset directory", async () => {
    const res = await fetch(`${started.baseUrl}/api/changesets`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ changesets: [] });
  });

  it("lists every pending changeset sorted by file, without the README or config", async () => {
    mkdirSync(join(dir, ".changeset"));
    writeFileSync(join(dir, ".changeset", "README.md"), "# Changesets\n");
    writeFileSync(join(dir, ".changeset", "config.json"), "{}");
    writeFileSync(join(dir, ".changeset", "zebra.md"), '---\n"@n-dx/web": patch\n---\nFix.\n');
    writeFileSync(join(dir, ".changeset", "alpha.md"), '---\n"@n-dx/core": major\n---\nBreak.\n');

    const body = (await (await fetch(`${started.baseUrl}/api/changesets`)).json()) as { changesets: Array<{ file: string; packages: unknown[] }> };
    expect(body.changesets.map((c) => c.file)).toEqual(["alpha.md", "zebra.md"]);
    expect(body.changesets[0].packages).toEqual([{ name: "@n-dx/core", bump: "major" }]);
  });
});
