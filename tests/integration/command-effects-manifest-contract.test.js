/**
 * Contract: `GET /api/commands/manifest` serves core's effects declarations
 * unchanged, and every command it lists has one.
 *
 * The declarations live in core (`packages/core/command-effects.js`) so the
 * terminal preflight banner and the dashboard read one object. Web cannot
 * import core — core depends on web — so the server reads them by spawning
 * `ndx help --effects --format=json`. This test runs that real path end to
 * end: the compiled route, the real CLI, compared against the module itself.
 *
 * A manifest row added in web without a declaration in core fails here, which
 * is the point: the dashboard must not list a command whose reads, writes and
 * spend nobody has stated.
 *
 * Imports are from `dist/` for the same reason the other cross-package tests
 * are — the compiled boundary is where the two packages actually meet.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  handleCommandsRoute,
  invalidateCommandEffectsCache,
} from "../../packages/web/dist/server/routes-commands.js";
import { COMMAND_EFFECTS, LAYOUT_TOKENS } from "../../packages/core/command-effects.js";
import { resolveLayout, relativeToRoot } from "../../packages/core/layout.js";

const CORE_CLI = join(import.meta.dirname, "../../packages/core/cli.js");

describe("command manifest ↔ core effects", () => {
  let server;
  let port;
  let projectDir;
  let savedCliPath;

  beforeAll(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "effects-manifest-"));
    savedCliPath = process.env.NDX_CLI_PATH;
    process.env.NDX_CLI_PATH = CORE_CLI;
    invalidateCommandEffectsCache();
    const ctx = {
      projectDir,
      svDir: join(projectDir, ".sourcevision"),
      rexDir: join(projectDir, ".rex"),
      dev: false,
    };
    server = createServer(async (req, res) => {
      const handled = await handleCommandsRoute(req, res, ctx);
      if (!handled) {
        res.statusCode = 404;
        res.end();
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = server.address().port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (savedCliPath === undefined) delete process.env.NDX_CLI_PATH;
    else process.env.NDX_CLI_PATH = savedCliPath;
    invalidateCommandEffectsCache();
    await rm(projectDir, { recursive: true, force: true });
  });

  async function manifestCommands() {
    const res = await fetch(`http://127.0.0.1:${port}/api/commands/manifest`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.effectsError).toBeUndefined();
    return body.groups.flatMap((g) => g.commands);
  }

  it("gives every manifest command an effects declaration", async () => {
    const commands = await manifestCommands();
    expect(commands.length).toBeGreaterThan(0);
    const missing = commands.filter((c) => c.effects === null).map((c) => c.name);
    expect(missing, "manifest commands with no declaration in packages/core/command-effects.js").toEqual([]);
  });

  it("serves each declaration exactly as core defines it", async () => {
    for (const command of await manifestCommands()) {
      expect(command.effects, command.name).toEqual(COMMAND_EFFECTS[command.name]);
    }
  });

  for (const mode of ["legacy", "ndx"]) {
    it(`serves the ${mode}-layout path for every layout token core declares`, async () => {
      // The declarations name layout-owned paths as tokens; the manifest's
      // `layoutPaths` is how a reader expands them. Web keeps a twin of
      // core's token map, so this pins the two to the same answer.
      if (mode === "ndx") await mkdir(join(projectDir, ".ndx"), { recursive: true });
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/commands/manifest`);
        const { layoutPaths } = await res.json();
        const layout = resolveLayout(projectDir);
        expect(layout.mode).toBe(mode);
        const expected = Object.fromEntries(
          Object.entries(LAYOUT_TOKENS).map(([token, field]) => [token, relativeToRoot(layout, layout[field])]),
        );
        expect(layoutPaths).toEqual(expected);
      } finally {
        await rm(join(projectDir, ".ndx"), { recursive: true, force: true });
      }
    });
  }

  it("uses no token the layout cannot expand", () => {
    const used = new Set(JSON.stringify(COMMAND_EFFECTS).match(/\{(\w+)\}/g)?.map((t) => t.slice(1, -1)));
    expect([...used].filter((t) => !(t in LAYOUT_TOKENS))).toEqual([]);
  });
});
