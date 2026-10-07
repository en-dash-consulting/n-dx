/**
 * Server-side feature gates — one case per gated endpoint.
 *
 * The behaviour under test is deliberately narrow: given a project directory
 * and a request path, does the gate refuse, and does the refusal name the flag.
 * Whether the gate is *reached* is `tests/integration/feature-gate-enforcement.test.ts`,
 * which boots the real dispatcher.
 *
 * The last block is the one that matters over time: it fails if a nav entry in
 * the viewer's navigation carries a `featureGate` with no server entry, which is
 * the exact state this work existed to end.
 *
 * @see packages/web/src/server/route-feature-gates.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import {
  ROUTE_FEATURE_GATES,
  enforceRouteFeatureGate,
  findRouteFeatureGate,
} from "../../../src/server/route-feature-gates.js";
import { closeRouteTestServer } from "../../helpers/server-route-test-support.js";

const WEB_PKG = resolve(fileURLToPath(import.meta.url), "../../../..");
const VIEWER_SRC = join(WEB_PKG, "src/viewer");

/**
 * Every `featureGate:` the viewer's navigation declares, wherever it lives.
 *
 * This used to read `components/sidebar.ts` by path, which broke the moment
 * the navigation was rewritten and the sidebar deleted — the declarations moved
 * to `views/stages.ts` and `views/sourcevision-tabs.ts`. Scanning the viewer
 * instead means the next such move does not quietly narrow what this checks,
 * and the non-empty assertion below is what catches it if the scan ever finds
 * nothing at all.
 */
function collectNavFeatureGates(dir: string): Set<string> {
  const gates = new Set<string>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const gate of collectNavFeatureGates(full)) gates.add(gate);
    } else if (/\.tsx?$/.test(entry.name)) {
      const src = readFileSync(full, "utf-8");
      for (const m of src.matchAll(/featureGate:\s*"([^"]+)"/g)) gates.add(m[1]);
    }
  }
  return gates;
}

/**
 * Every gated endpoint, paired with the flag that governs it.
 *
 * Written out rather than derived from `ROUTE_FEATURE_GATES`, so a wrong
 * mapping in the registry is a failure here rather than a tautology.
 */
const GATED: ReadonlyArray<[path: string, feature: string]> = [
  ["/api/rex/capture-ask", "sourcevision.ask"],
  ["/api/rex/apply-refinements", "sourcevision.ask"],
  ["/api/sv/pr-markdown", "sourcevision.prMarkdown"],
  ["/api/sv/pr-markdown/state", "sourcevision.prMarkdown"],
];

/** A server that answers 200 "reached" for anything the gate lets past. */
function startGateServer(ctx: ServerContext): Promise<{ server: Server; port: number }> {
  return new Promise((resolvePort) => {
    const server = createServer((req, res) => {
      if (enforceRouteFeatureGate(req, res, ctx)) return;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ reached: true }));
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolvePort({ server, port: typeof addr === "object" && addr ? addr.port : 0 });
    });
  });
}

describe("route feature gates", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  /** Write `.n-dx.json` with the given feature keys set. */
  async function setFeatures(values: Record<string, boolean>): Promise<void> {
    const features: Record<string, Record<string, boolean>> = {};
    for (const [key, value] of Object.entries(values)) {
      const [pkg, name] = key.split(".");
      features[pkg] ??= {};
      features[pkg][name] = value;
    }
    await writeFile(join(tmpDir, ".n-dx.json"), JSON.stringify({ features }, null, 2), "utf-8");
  }

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "route-feature-gates-"));
    ctx = {
      projectDir: tmpDir,
      svDir: join(tmpDir, ".sourcevision"),
      rexDir: join(tmpDir, ".rex"),
      dev: false,
    };
    const started = await startGateServer(ctx);
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── Per route: refused while the flag is off ────────────────────────────

  it.each(GATED)("refuses %s with 403 naming %s when the flag is off", async (path, feature) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.feature).toBe(feature);
    expect(body.kind).toBe("feature_disabled");
    // The prose has to name the flag too — a raw 403 is usually read in a
    // terminal, where the `feature` field is not what anyone sees first.
    expect(body.error).toContain(feature);
    expect(body.suggestion).toContain(feature);
  });

  // ── Per route: passed through once the flag is on ───────────────────────

  it.each(GATED)("lets %s through once %s is enabled", async (path, feature) => {
    await setFeatures({ [feature]: true });

    const res = await fetch(`http://127.0.0.1:${port}${path}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reached: true });
  });

  // ── The gate's own edges ────────────────────────────────────────────────

  it("leaves an ungated path alone", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/status`);
    expect(res.status).toBe(200);
  });

  it("gates listed paths exactly, so a subpath or near-miss is ungated", async () => {
    // Every gate is an exact list: an unlisted subpath falls through to the
    // router's own 404 rather than answering 403 for a feature it is not part of.
    expect(findRouteFeatureGate("/api/sv/pr-markdown")).not.toBeNull();
    expect(findRouteFeatureGate("/api/sv/pr-markdown/unlisted")).toBeNull();
    expect(findRouteFeatureGate("/api/sv/pr-markdown-extra")).toBeNull();
  });

  it("gates on the path alone, ignoring the query string", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/sv/pr-markdown?_=1`);
    expect(res.status).toBe(403);
    expect((await res.json()).feature).toBe("sourcevision.prMarkdown");
  });

  it("refuses when .n-dx.json is unreadable rather than opening the gate", async () => {
    await writeFile(join(tmpDir, ".n-dx.json"), "{ not json", "utf-8");

    const res = await fetch(`http://127.0.0.1:${port}/api/sv/pr-markdown`);
    expect(res.status).toBe(403);
  });

  it("steps over the ask endpoint, which enforces its own gate", async () => {
    // routes-sourcevision-ask.ts answers with the Ask-shaped `kind: "disabled"`
    // body the panel renders; a generic refusal on top would replace it.
    const res = await fetch(`http://127.0.0.1:${port}/api/sourcevision/ask`);
    expect(res.status).toBe(200);

    const gate = findRouteFeatureGate("/api/sourcevision/ask");
    expect(gate?.feature).toBe("sourcevision.ask");
    expect(gate?.selfEnforced).toBe(true);
  });

  // ── Completeness: no toggle may be nav-only ─────────────────────────────

  it("covers every feature gate the navigation hides an entry with", () => {
    const navGates = collectNavFeatureGates(VIEWER_SRC);
    // Guards the scan itself: if the declarations move again and this finds
    // none, the filter below would be vacuously empty and the test would pass
    // while checking nothing.
    expect(navGates.size).toBeGreaterThan(0);

    const served = new Set(ROUTE_FEATURE_GATES.map((g) => g.feature));
    const navOnly = [...navGates].filter((key) => !served.has(key));

    expect(
      navOnly,
      "These toggles hide a nav entry but no endpoint refuses when they are off, "
        + "so the feature stays reachable by anything that can reach the port. "
        + "Add an entry to ROUTE_FEATURE_GATES naming the endpoints each governs.",
    ).toEqual([]);
  });

  it("names only keys that exist in the feature registry", async () => {
    // A gate over a key the registry does not define would fail closed forever:
    // `isFeatureEnabled` returns false for an unknown key by design.
    const registrySrc = await readFile(join(WEB_PKG, "src/server/routes-features.ts"), "utf-8");
    const known = new Set([...registrySrc.matchAll(/^\s*key:\s*"([^"]+)"/gm)].map((m) => m[1]));

    for (const gate of ROUTE_FEATURE_GATES) {
      expect(known, `ROUTE_FEATURE_GATES names "${gate.feature}", which FEATURE_REGISTRY does not define`)
        .toContain(gate.feature);
    }
  });
});
