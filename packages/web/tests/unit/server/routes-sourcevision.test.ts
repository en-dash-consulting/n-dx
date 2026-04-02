import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm, appendFile, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import type { Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleSourcevisionRoute } from "../../../src/server/routes-sourcevision.js";
import { startRouteTestServer } from "../../helpers/server-route-test-support.js";

/** Start a test server that only runs sourcevision routes. */
function startTestServer(ctx: ServerContext): Promise<{ server: Server; port: number }> {
  return startRouteTestServer((req, res) => handleSourcevisionRoute(req, res, ctx));
}

describe("Sourcevision API routes", () => {
  let tmpDir: string;
  let svDir: string;
  let rexDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  const manifestData = {
    schema: "sourcevision/v1",
    project: "test-project",
    timestamp: "2026-01-01T00:00:00.000Z",
    version: "0.1.0",
    git: { branch: "main", sha: "abc123" },
    summary: { totalFiles: 10, analyzedFiles: 10, languages: { TypeScript: 8, JavaScript: 2 } },
  };

  const inventoryData = {
    schema: "sourcevision/v1",
    files: [
      { path: "src/index.ts", extension: ".ts", sizeBytes: 1024, lines: 50 },
      { path: "src/utils.ts", extension: ".ts", sizeBytes: 512, lines: 25 },
    ],
    summary: { totalFiles: 2, totalLines: 75, totalSizeBytes: 1536 },
  };

  const zonesData = {
    schema: "sourcevision/v1",
    zones: [
      { id: "zone-1", name: "Core", files: ["src/index.ts"] },
      { id: "zone-2", name: "Utils", files: ["src/utils.ts"] },
    ],
  };

  const componentsData = {
    schema: "sourcevision/v1",
    components: [
      { name: "App", file: "src/App.tsx", props: [] },
    ],
  };

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-api-"));
    svDir = join(tmpDir, ".sourcevision");
    rexDir = join(tmpDir, ".rex");
    await mkdir(svDir, { recursive: true });
    await mkdir(rexDir, { recursive: true });

    // Write fixture data
    await writeFile(join(svDir, "manifest.json"), JSON.stringify(manifestData));
    await writeFile(join(svDir, "inventory.json"), JSON.stringify(inventoryData));
    await writeFile(join(svDir, "zones.json"), JSON.stringify(zonesData));
    await writeFile(join(svDir, "components.json"), JSON.stringify(componentsData));
    await writeFile(join(svDir, "CONTEXT.md"), "# Test Context\n\nThis is a test.");

    ctx = { projectDir: tmpDir, svDir, rexDir, dev: false };
    const started = await startTestServer(ctx);
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    server.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("GET /api/sv/manifest returns manifest data", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/manifest`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.project).toBe("test-project");
    expect(data.schema).toBe("sourcevision/v1");
  });

  it("GET /api/sv/inventory returns inventory data", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/inventory`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.files).toHaveLength(2);
    expect(data.summary.totalFiles).toBe(2);
  });

  it("GET /api/sv/zones returns zones data", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/zones`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.zones).toHaveLength(2);
    expect(data.zones[0].name).toBe("Core");
  });

  it("GET /api/sv/components returns components data", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/components`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.components).toHaveLength(1);
    expect(data.components[0].name).toBe("App");
  });

  it("GET /api/sv/context returns CONTEXT.md", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/context`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/markdown");
    const text = await res.text();
    expect(text).toContain("# Test Context");
  });

  it("GET /api/sv/pr-markdown returns markdown when present", async () => {
    await writeFile(join(svDir, "pr-markdown.md"), "## PR Summary\n\n- Added tab");
    const res = await fetch(`http://localhost:${port}/api/sv/pr-markdown`);
    expect(res.status).toBe(200);
    const data = await res.json() as {
      markdown?: string | null;
      mode?: "normal" | "fallback";
      confidence?: number;
      coverage?: number;
    };
    expect(data.markdown).toBe("## PR Summary\n\n- Added tab");
    expect(data.mode).toBe("normal");
    expect("confidence" in data).toBe(false);
    expect("coverage" in data).toBe(false);
  });

  it("GET /api/sv/pr-markdown returns cached fallback metadata when artifact payload is fallback", async () => {
    await writeFile(join(svDir, "pr-markdown.md"), "## Fallback Summary\n\n- Generated in artifact fallback mode");
    await writeFile(
      join(svDir, "pr-markdown.artifact.json"),
      JSON.stringify({
        markdown: "## Fallback Summary\n\n- Generated in artifact fallback mode",
        mode: "fallback",
        confidence: 85,
        coverage: 57,
      }),
    );

    const res = await fetch(`http://localhost:${port}/api/sv/pr-markdown`);
    expect(res.status).toBe(200);
    const data = await res.json() as {
      markdown?: string | null;
      mode?: "normal" | "fallback";
      confidence?: number;
      coverage?: number;
    };
    expect(data.markdown).toContain("Generated in artifact fallback mode");
    expect(data.mode).toBe("fallback");
    expect(data.coverage).toBe(57);
    expect(data.confidence).toBe(85);
  });

  it("GET /api/sv/pr-markdown reports unsupported when git executable is missing", async () => {
    const originalPath = process.env.PATH;
    process.env.PATH = "";
    try {
      const res = await fetch(`http://localhost:${port}/api/sv/pr-markdown`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.availability).toBe("unsupported");
      expect(data.message).toContain("Git is not available");
      expect(data.markdown).toBeNull();
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it("GET /api/sv/pr-markdown reports no-repo state outside git repository", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/pr-markdown`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.availability).toBe("no-repo");
    expect(data.message).toContain("not a git repository");
    expect(data.markdown).toBeNull();
  });

  it("GET /api/sv/pr-markdown does not regenerate markdown when git diff changes", async () => {
    execSync("git init -b main", { cwd: tmpDir, stdio: "ignore" });
    execSync("git config user.email test@test.com", { cwd: tmpDir, stdio: "ignore" });
    execSync("git config user.name Test", { cwd: tmpDir, stdio: "ignore" });

    await writeFile(join(tmpDir, "alpha.txt"), "one\n");
    await writeFile(join(tmpDir, "beta.txt"), "start\n");
    execSync("git add alpha.txt beta.txt", { cwd: tmpDir, stdio: "ignore" });
    execSync("git commit -m 'base'", { cwd: tmpDir, stdio: "ignore" });

    execSync("git checkout -b feature/pr-md", { cwd: tmpDir, stdio: "ignore" });
    await appendFile(join(tmpDir, "alpha.txt"), "two\nthree\n");
    await writeFile(join(tmpDir, "zeta.txt"), "new\n");
    execSync("git add alpha.txt zeta.txt", { cwd: tmpDir, stdio: "ignore" });
    execSync("git commit -m 'feature change'", { cwd: tmpDir, stdio: "ignore" });
    await writeFile(join(svDir, "pr-markdown.md"), "## Snapshot v1\n\n- `alpha.txt`");

    const firstRes = await fetch(`http://localhost:${port}/api/sv/pr-markdown`);
    expect(firstRes.status).toBe(200);
    const first = await firstRes.json();
    expect(first.markdown).toContain("Snapshot v1");

    await writeFile(join(tmpDir, "late.txt"), "later\n");
    execSync("git add late.txt", { cwd: tmpDir, stdio: "ignore" });
    execSync("git commit -m 'later change'", { cwd: tmpDir, stdio: "ignore" });
    await appendFile(join(tmpDir, "alpha.txt"), "dirty\n");
    await writeFile(join(tmpDir, "scratch.tmp"), "temp\n");

    const secondRes = await fetch(`http://localhost:${port}/api/sv/pr-markdown`);
    const second = await secondRes.json();
    expect(second.markdown).toBe(first.markdown);
  });

  it("GET /api/sv/pr-markdown/state returns a signature payload", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/pr-markdown/state`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("signature");
    expect(typeof data.signature).toBe("string");
    expect(data.cacheStatus).toBe("missing");
    expect(typeof data.staleAfterMs).toBe("number");
  });

  it("GET /api/sv/pr-markdown/state marks cache stale when artifact is older than threshold", async () => {
    execSync("git init -b main", { cwd: tmpDir, stdio: "ignore" });
    execSync("git config user.email test@test.com", { cwd: tmpDir, stdio: "ignore" });
    execSync("git config user.name Test", { cwd: tmpDir, stdio: "ignore" });
    await writeFile(join(tmpDir, "tracked.txt"), "one\n");
    execSync("git add tracked.txt", { cwd: tmpDir, stdio: "ignore" });
    execSync("git commit -m 'init'", { cwd: tmpDir, stdio: "ignore" });

    const markdownPath = join(svDir, "pr-markdown.md");
    await writeFile(markdownPath, "## stale snapshot");
    const staleDate = new Date(Date.now() - (31 * 60 * 1000));
    await utimes(markdownPath, staleDate, staleDate);

    const res = await fetch(`http://localhost:${port}/api/sv/pr-markdown/state`);
    const data = await res.json();
    expect(data.cacheStatus).toBe("stale");
    expect(typeof data.generatedAt).toBe("string");
  });

  it("GET /api/sv/pr-markdown returns warning with partial metadata when base branch is unresolved", async () => {
    execSync("git init -b trunk", { cwd: tmpDir, stdio: "ignore" });
    execSync("git config user.email test@test.com", { cwd: tmpDir, stdio: "ignore" });
    execSync("git config user.name Test", { cwd: tmpDir, stdio: "ignore" });
    await writeFile(join(tmpDir, "only.txt"), "content\n");
    execSync("git add only.txt", { cwd: tmpDir, stdio: "ignore" });
    execSync("git commit -m 'init'", { cwd: tmpDir, stdio: "ignore" });

    const res = await fetch(`http://localhost:${port}/api/sv/pr-markdown`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.availability).toBe("ready");
    expect(data.warning).toContain("Could not resolve base branch");
    expect(data.baseRange).toBeNull();
    expect(data.gitStatusSignature).toBeNull();
  });

  it("GET /api/sv/pr-markdown keeps cached markdown when base branch cannot be resolved", async () => {
    execSync("git init -b trunk", { cwd: tmpDir, stdio: "ignore" });
    execSync("git config user.email test@test.com", { cwd: tmpDir, stdio: "ignore" });
    execSync("git config user.name Test", { cwd: tmpDir, stdio: "ignore" });
    await writeFile(join(tmpDir, "only.txt"), "content\n");
    execSync("git add only.txt", { cwd: tmpDir, stdio: "ignore" });
    execSync("git commit -m 'init'", { cwd: tmpDir, stdio: "ignore" });
    await writeFile(join(svDir, "pr-markdown.md"), "## Existing Summary\n\n- fallback");

    const res = await fetch(`http://localhost:${port}/api/sv/pr-markdown`);
    expect(res.status).toBe(200);
    const data = await res.json();
    const markdown = String(data.markdown ?? "");
    expect(markdown).toContain("## Existing Summary");
  });

  it("POST /api/sv/pr-markdown/refresh returns 404 (removed)", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/pr-markdown/refresh`, { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("PR markdown state signature changes when markdown file changes", async () => {
    execSync("git init", { cwd: tmpDir, stdio: "ignore" });
    execSync("git config user.email test@test.com", { cwd: tmpDir, stdio: "ignore" });
    execSync("git config user.name Test", { cwd: tmpDir, stdio: "ignore" });
    await writeFile(join(tmpDir, "tracked.txt"), "one\n");
    execSync("git add tracked.txt", { cwd: tmpDir, stdio: "ignore" });
    execSync("git commit -m 'init'", { cwd: tmpDir, stdio: "ignore" });

    const beforeRes = await fetch(`http://localhost:${port}/api/sv/pr-markdown/state`);
    const before = await beforeRes.json();

    await writeFile(join(svDir, "pr-markdown.md"), "## refreshed");

    const afterRes = await fetch(`http://localhost:${port}/api/sv/pr-markdown/state`);
    const after = await afterRes.json();

    expect(before.signature).not.toBe(after.signature);
  });

  it("GET /api/sv/pr-markdown returns null when missing", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/pr-markdown`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.markdown).toBeNull();
  });

  it("GET /api/sv/summary returns aggregate stats", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/summary`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.hasManifest).toBe(true);
    expect(data.hasInventory).toBe(true);
    expect(data.hasZones).toBe(true);
    expect(data.hasComponents).toBe(true);
    expect(data.project).toBe("test-project");
    expect(data.fileCount).toBe(2);
    expect(data.zoneCount).toBe(2);
    expect(data.componentCount).toBe(1);
  });

  it("returns 404 for missing data files", async () => {
    // Use a fresh dir with no data
    const emptyDir = await mkdtemp(join(tmpdir(), "sv-api-empty-"));
    const emptySvDir = join(emptyDir, ".sourcevision");
    await mkdir(emptySvDir, { recursive: true });
    const emptyCtx: ServerContext = { projectDir: emptyDir, svDir: emptySvDir, rexDir, dev: false };

    const emptyStarted = await startTestServer(emptyCtx);
    try {
      const res = await fetch(`http://localhost:${emptyStarted.port}/api/sv/manifest`);
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toContain("No manifest data");
    } finally {
      emptyStarted.server.close();
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  it("does not handle non-sv API paths", async () => {
    const res = await fetch(`http://localhost:${port}/api/other`);
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toBe("Not found");
  });

  it("does not handle POST requests", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/manifest`, { method: "POST" });
    expect(res.status).toBe(404);
  });
});
