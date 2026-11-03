/**
 * Security headers on every response, `/data/*` confinement, and the hub
 * proxy's Origin restatement.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { request } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ServerContext } from "../../../src/server/types.js";
import { createDataWatcher, handleDataRoute } from "../../../src/server/routes-data.js";
import { handleRequestSecurity } from "../../../src/server/request-security.js";
import { guardHubRequest } from "../../../src/hub/request-guard.js";
import { forwardedOrigin } from "../../../src/hub/proxy.js";
import { PAGE_CSP, STRICT_CSP, loopbackOrigin } from "../../../src/shared/index.js";
import { startRouteTestServer, type RouteTestServer } from "../../helpers/server-route-test-support.js";

function get(port: number, path: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method: "GET", path, headers }, (res) => {
      let body = "";
      res.setEncoding("utf-8");
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("baseline security headers", () => {
  let srv: RouteTestServer;
  afterEach(async () => srv?.close());

  it("the project server's gate sets them on pages and on refusals", async () => {
    srv = await startRouteTestServer((req, res) => {
      if (handleRequestSecurity(req, res)) return true;
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<p>ok</p>");
      return true;
    });
    for (const host of [`127.0.0.1:${srv.port}`, "evil.example"]) {
      const res = await get(srv.port, "/", { Host: host });
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["x-frame-options"]).toBe("DENY");
      expect(res.headers["content-security-policy"]).toBe(PAGE_CSP);
    }
  });

  it("the hub's gate sets the same headers", async () => {
    srv = await startRouteTestServer((req, res) => {
      if (guardHubRequest(req, res, srv.port)) return true;
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<p>hub</p>");
      return true;
    });
    const res = await get(srv.port, "/");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["content-security-policy"]).toBe(PAGE_CSP);
  });
});

describe("/data/* confinement", () => {
  let dir: string;
  let outside: string;
  let ctx: ServerContext;
  let srv: RouteTestServer;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "data-confine-"));
    outside = await mkdtemp(join(tmpdir(), "data-outside-"));
    const svDir = join(dir, ".sourcevision");
    await mkdir(svDir, { recursive: true });
    await mkdir(join(dir, ".rex"), { recursive: true });
    await writeFile(join(svDir, "manifest.json"), JSON.stringify({ schema: "sourcevision/v1" }));
    await writeFile(join(svDir, "CONTEXT.md"), "# Context\n");
    await writeFile(join(svDir, "evil.html"), "<script>alert(1)</script>");
    await writeFile(join(svDir, "evil.svg"), "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
    await writeFile(join(outside, "secret.json"), JSON.stringify({ secret: true }));
    await symlink(join(outside, "secret.json"), join(svDir, "zones.json"));
    ctx = { projectDir: dir, svDir, rexDir: join(dir, ".rex"), dev: false };
    const watcher = createDataWatcher(ctx);
    srv = await startRouteTestServer((req, res) => handleDataRoute(req, res, ctx, watcher));
  });

  afterEach(async () => {
    await srv.close();
    await rm(dir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it("serves a known data file as JSON with nosniff and the strict policy", async () => {
    const res = await get(srv.port, "/data/manifest.json");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^application\/json/);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toBe(STRICT_CSP);
  });

  it("serves Markdown as plain text", async () => {
    const res = await get(srv.port, "/data/CONTEXT.md");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/plain/);
  });

  it("does not serve files outside the known set, whatever their extension", async () => {
    for (const name of ["evil.html", "evil.svg"]) {
      const res = await get(srv.port, `/data/${name}`);
      expect(res.status, name).toBe(404);
      expect(res.body).not.toContain("<script>");
    }
  });

  it("refuses a known name that is a symlink out of .sourcevision", async () => {
    const res = await get(srv.port, "/data/zones.json");
    expect(res.status).toBe(403);
    expect(res.body).not.toContain("secret");
  });
});

describe("hub proxy Origin forwarding", () => {
  it("restates the hub's own origin as the child's", () => {
    expect(forwardedOrigin("http://localhost:3117", 3117, 41000)).toBe(loopbackOrigin(41000));
  });

  it("forwards an untrusted origin unchanged", () => {
    expect(forwardedOrigin("https://evil.example", 3117, 41000)).toBe("https://evil.example");
    expect(forwardedOrigin("http://localhost:9999", 3117, 41000)).toBe("http://localhost:9999");
  });

  it("leaves an absent origin absent", () => {
    expect(forwardedOrigin(undefined, 3117, 41000)).toBeUndefined();
  });
});
