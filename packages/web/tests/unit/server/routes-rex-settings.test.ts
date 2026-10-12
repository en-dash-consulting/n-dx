/**
 * `rex.applyOn` and `rex.placement.autoAccept` read and written through the
 * dashboard, into the same `.n-dx.json` the CLI reads.
 *
 * The point of the write assertions is the file, not the response: a setting
 * the page reports as saved but that rex cannot find is the failure these
 * guard. The accepted values come from rex (APPLY_ON, PLACEMENT_AUTO_ACCEPT)
 * rather than being spelled here, so a value rex stops accepting fails this
 * suite instead of being quietly written to a config it will fall back from.
 *
 * @see src/server/routes-rex-settings.ts
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import { APPLY_ON, DEFAULT_APPLY_ON, DEFAULT_PLACEMENT_SETTINGS, PLACEMENT_AUTO_ACCEPT } from "../../../src/server/rex-gateway.js";
import type { ServerContext } from "../../../src/server/types.js";
import { handleRexSettingsRoute } from "../../../src/server/routes-rex-settings.js";
import { closeRouteTestServer } from "../../helpers/server-route-test-support.js";

function startTestServer(ctx: ServerContext): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      if (await handleRexSettingsRoute(req, res, ctx)) return;
      res.writeHead(404);
      res.end("Not found");
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

describe("rex settings API", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  /** A value that is not the default, so a write is visible. */
  const otherApplyOn = APPLY_ON.find((v) => v !== DEFAULT_APPLY_ON)!;
  const otherAutoAccept = PLACEMENT_AUTO_ACCEPT.find((v) => v !== DEFAULT_PLACEMENT_SETTINGS.autoAccept)!;

  const url = () => `http://127.0.0.1:${port}/api/rex/settings`;
  const configPath = () => join(tmpDir, ".n-dx.json");
  const readConfig = async () => JSON.parse(await readFile(configPath(), "utf-8"));

  function put(body: unknown) {
    return fetch(url(), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-settings-api-"));
    const svDir = join(tmpDir, ".sourcevision");
    const rexDir = join(tmpDir, ".rex");
    await mkdir(svDir, { recursive: true });
    await mkdir(rexDir, { recursive: true });

    ctx = { projectDir: tmpDir, svDir, rexDir, dev: false };
    ({ server, port } = await startTestServer(ctx));
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("GET", () => {
    it("answers rex's defaults when nothing is configured", async () => {
      const res = await fetch(url());
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.applyOn).toBe(DEFAULT_APPLY_ON);
      expect(data.placementAutoAccept).toBe(DEFAULT_PLACEMENT_SETTINGS.autoAccept);
      expect(data.applyOnSet).toBe(false);
      expect(data.placementAutoAcceptSet).toBe(false);
      expect(data.warnings).toEqual([]);
    });

    it("offers exactly the values rex accepts", async () => {
      const data = await (await fetch(url())).json();
      expect(data.choices.applyOn).toEqual([...APPLY_ON]);
      expect(data.choices.placementAutoAccept).toEqual([...PLACEMENT_AUTO_ACCEPT]);
      expect(data.defaults).toEqual({
        applyOn: DEFAULT_APPLY_ON,
        placementAutoAccept: DEFAULT_PLACEMENT_SETTINGS.autoAccept,
      });
    });

    it("reads both stored values", async () => {
      await writeFile(
        configPath(),
        JSON.stringify({ rex: { applyOn: otherApplyOn, placement: { autoAccept: otherAutoAccept } } }),
        "utf-8",
      );

      const data = await (await fetch(url())).json();
      expect(data.applyOn).toBe(otherApplyOn);
      expect(data.placementAutoAccept).toBe(otherAutoAccept);
      expect(data.applyOnSet).toBe(true);
      expect(data.placementAutoAcceptSet).toBe(true);
    });

    // A hand-edited config runs on the fallback and says nothing. The page that
    // edits the setting is where the reader can act on that.
    it("passes rex's warning through for a stored value it falls back from", async () => {
      await writeFile(
        configPath(),
        JSON.stringify({ rex: { applyOn: "later", placement: { autoAccept: "always" } } }),
        "utf-8",
      );

      const data = await (await fetch(url())).json();
      expect(data.applyOn).toBe(DEFAULT_APPLY_ON);
      expect(data.placementAutoAccept).toBe(DEFAULT_PLACEMENT_SETTINGS.autoAccept);
      expect(data.warnings.join("\n")).toContain("rex.applyOn");
      expect(data.warnings.join("\n")).toContain("rex.placement.autoAccept");
    });

    // `rex.placement.models` is not on this page; naming it in a warning here
    // points the reader at a field they cannot reach.
    it("says nothing about settings this page does not edit", async () => {
      await writeFile(
        configPath(),
        JSON.stringify({ rex: { placement: { models: "telepathy" } } }),
        "utf-8",
      );

      const data = await (await fetch(url())).json();
      expect(data.warnings).toEqual([]);
    });
  });

  describe("PUT", () => {
    it("saves both settings to .n-dx.json", async () => {
      const res = await put({ applyOn: otherApplyOn, placementAutoAccept: otherAutoAccept });
      expect(res.status).toBe(200);

      const config = await readConfig();
      expect(config.rex.applyOn).toBe(otherApplyOn);
      expect(config.rex.placement.autoAccept).toBe(otherAutoAccept);

      // And the route reads back what it wrote.
      const data = await (await fetch(url())).json();
      expect(data.applyOn).toBe(otherApplyOn);
      expect(data.placementAutoAccept).toBe(otherAutoAccept);
    });

    it("leaves every other key in the config alone", async () => {
      await writeFile(
        configPath(),
        JSON.stringify({ web: { port: 4000 }, rex: { placement: { models: "both" } } }),
        "utf-8",
      );

      await put({ applyOn: otherApplyOn });

      const config = await readConfig();
      expect(config.web.port).toBe(4000);
      expect(config.rex.placement.models).toBe("both");
      expect(config.rex.applyOn).toBe(otherApplyOn);
    });

    it("writes only the keys the body carries", async () => {
      await put({ applyOn: otherApplyOn });
      expect((await readConfig()).rex.placement).toBeUndefined();

      await put({ placementAutoAccept: otherAutoAccept });
      const config = await readConfig();
      expect(config.rex.applyOn).toBe(otherApplyOn);
      expect(config.rex.placement.autoAccept).toBe(otherAutoAccept);
    });

    it("removes an override on null, leaving no empty sections behind", async () => {
      await put({ applyOn: otherApplyOn, placementAutoAccept: otherAutoAccept });
      const res = await put({ applyOn: null, placementAutoAccept: null });
      expect(res.status).toBe(200);

      const config = await readConfig();
      expect(config.rex).toBeUndefined();

      const data = await (await fetch(url())).json();
      expect(data.applyOn).toBe(DEFAULT_APPLY_ON);
      expect(data.applyOnSet).toBe(false);
    });

    // A value rex would reject is one the CLI silently falls back from, so the
    // save would appear to work and change nothing. Refuse it at the door.
    it("refuses a value rex does not accept, writing nothing", async () => {
      const res = await put({ applyOn: "later" });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain(APPLY_ON.join(", "));

      const res2 = await put({ placementAutoAccept: "always" });
      expect(res2.status).toBe(400);
      expect((await res2.json()).error).toContain(PLACEMENT_AUTO_ACCEPT.join(", "));

      const config = await readConfig().catch(() => null);
      expect(config?.rex).toBeUndefined();
    });

    it("refuses a body that is not an object", async () => {
      const res = await put(["applyOn"]);
      expect(res.status).toBe(400);
    });
  });
});
