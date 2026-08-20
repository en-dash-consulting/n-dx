import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectServerRoutes } from "../../../src/analyzers/server-route-detection.js";
import type { FileEntry, Inventory } from "../../../src/schema/index.js";

function fileEntry(path: string, overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    path,
    size: 0,
    language: "typescript",
    lineCount: 0,
    hash: "",
    role: "source",
    category: "",
    ...overrides,
  };
}

function inventory(files: FileEntry[]): Inventory {
  return {
    files,
    summary: {
      totalFiles: files.length,
      totalLines: 0,
      byLanguage: {},
      byRole: {},
      byCategory: {},
    },
  };
}

describe("detectServerRoutes", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sv-server-routes-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("infers a prefix for routes that share no deeper common path without hanging", async () => {
    // Regression test: inferPrefix used to infinite-loop on exactly this
    // shape — two ordinary routes ("/users/:id", "/orders") that share
    // only the root "/". Once the shrinking prefix ended in "/",
    // lastIndexOf("/") kept re-finding that same trailing slash and
    // slicing at that position reproduced an unchanged string, so the
    // while loop never terminated. Confirmed live via a CPU sample showing
    // 100% of time in String.prototype.lastIndexOf.
    mkdirSync(join(tmpDir, "backend/src/api"), { recursive: true });
    writeFileSync(
      join(tmpDir, "backend/src/api/routes.ts"),
      [
        'import express from "express";',
        "const router = express.Router();",
        'router.get("/users/:id", (req, res) => { res.send("ok"); });',
        'router.post("/orders", (req, res) => { res.send("ok"); });',
        "export default router;",
      ].join("\n"),
    );

    const files = [fileEntry("backend/src/api/routes.ts")];
    const groups = await detectServerRoutes(tmpDir, inventory(files));

    expect(groups).toHaveLength(1);
    expect(groups[0].prefix).toBe("/");
    expect(groups[0].routes.map((r) => r.path).sort()).toEqual(["/orders", "/users/:id"]);
  });

  it("does not scan a client-side api/ directory for server routes", async () => {
    // extractRoutesFromFrameworkCalls can't distinguish app.get() (an
    // Express route registration) from apiClient.get() (an HTTP client
    // call) — both are call expressions on a "get"-named property. A file
    // under frontend/.../api/ is almost always the latter, so it should
    // never be scanned as a server route candidate in the first place.
    mkdirSync(join(tmpDir, "frontend/src/api"), { recursive: true });
    writeFileSync(
      join(tmpDir, "frontend/src/api/endpoints.ts"),
      [
        'import axios from "axios";',
        'const client = axios.create({ baseURL: "https://api.example.com" });',
        'export function getUser(id) { return client.get(`/users/${id}`); }',
        'export function getPosts() { return client.get("/posts"); }',
      ].join("\n"),
    );

    const files = [fileEntry("frontend/src/api/endpoints.ts")];
    const groups = await detectServerRoutes(tmpDir, inventory(files));

    expect(groups).toHaveLength(0);
  });

  it("still detects a bare api/ directory outside client-side paths", async () => {
    mkdirSync(join(tmpDir, "src/api"), { recursive: true });
    writeFileSync(
      join(tmpDir, "src/api/handler.ts"),
      [
        'import express from "express";',
        "const router = express.Router();",
        'router.get("/health", (req, res) => { res.send("ok"); });',
        "export default router;",
      ].join("\n"),
    );

    const files = [fileEntry("src/api/handler.ts")];
    const groups = await detectServerRoutes(tmpDir, inventory(files));

    expect(groups).toHaveLength(1);
    expect(groups[0].routes.map((r) => r.path)).toEqual(["/health"]);
  });

  it("falls back to / for a misextracted route path far longer than any real URL", async () => {
    // Defense-in-depth guard: inferPrefix bails out rather than running its
    // O(length) shrink loop against a huge string if the framework-call
    // pattern-matcher ever misextracts a large, unrelated string literal as
    // a route path.
    mkdirSync(join(tmpDir, "src/api"), { recursive: true });
    const hugePath = "/" + "a/".repeat(1000);
    writeFileSync(
      join(tmpDir, "src/api/weird.ts"),
      [
        "const client = { get: (p) => p };",
        `client.get(${JSON.stringify(hugePath)});`,
        'client.get("/normal");',
      ].join("\n"),
    );

    const files = [fileEntry("src/api/weird.ts")];
    const groups = await detectServerRoutes(tmpDir, inventory(files));

    expect(groups).toHaveLength(1);
    expect(groups[0].prefix).toBe("/");
  });
});
