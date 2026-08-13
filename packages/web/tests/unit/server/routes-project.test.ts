import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import {
  handleProjectRoute,
  extractProjectMetadata,
  extractRepoName,
  clearProjectMetadataCache,
} from "../../../src/server/routes-project.js";

/** Start a test server that only runs project routes. */
function startTestServer(ctx: ServerContext): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (await handleProjectRoute(req, res, ctx)) return;
      res.writeHead(404);
      res.end("Not found");
    });
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

describe("extractRepoName", () => {
  it("extracts repo name from HTTPS URL with .git suffix", () => {
    expect(extractRepoName("https://github.com/user/my-repo.git")).toBe("my-repo");
  });

  it("extracts repo name from HTTPS URL without .git suffix", () => {
    expect(extractRepoName("https://github.com/user/my-repo")).toBe("my-repo");
  });

  it("extracts repo name from SSH URL", () => {
    expect(extractRepoName("git@github.com:user/my-repo.git")).toBe("my-repo");
  });

  it("extracts repo name from SSH URL without .git suffix", () => {
    expect(extractRepoName("git@github.com:user/my-repo")).toBe("my-repo");
  });

  it("handles trailing slashes", () => {
    expect(extractRepoName("https://github.com/user/my-repo/")).toBe("my-repo");
  });

  it("returns null for empty string", () => {
    expect(extractRepoName("")).toBeNull();
  });
});

describe("extractProjectMetadata", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "project-meta-"));
    clearProjectMetadataCache();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("reads name and description from package.json", async () => {
    await writeFile(
      join(tmpDir, "package.json"),
      JSON.stringify({ name: "my-project", description: "A cool project", version: "1.2.3" }),
    );

    const meta = await extractProjectMetadata(tmpDir);
    expect(meta.name).toBe("my-project");
    expect(meta.description).toBe("A cool project");
    expect(meta.version).toBe("1.2.3");
    expect(meta.nameSource).toBe("package.json");
  });

  it("falls back to directory name when no package.json", async () => {
    const meta = await extractProjectMetadata(tmpDir);
    // tmpDir ends with a unique suffix, but should be a valid basename
    expect(meta.name).toBeTruthy();
    expect(meta.nameSource).toBe("directory");
    expect(meta.description).toBeNull();
    expect(meta.version).toBeNull();
  });

  it("falls back to directory name when package.json has no name", async () => {
    await writeFile(
      join(tmpDir, "package.json"),
      JSON.stringify({ description: "no name field" }),
    );

    const meta = await extractProjectMetadata(tmpDir);
    expect(meta.nameSource).toBe("directory");
    expect(meta.description).toBe("no name field");
  });

  it("falls back to directory name when package.json name is empty string", async () => {
    await writeFile(
      join(tmpDir, "package.json"),
      JSON.stringify({ name: "" }),
    );

    const meta = await extractProjectMetadata(tmpDir);
    expect(meta.nameSource).toBe("directory");
  });

  it("handles invalid JSON in package.json", async () => {
    await writeFile(join(tmpDir, "package.json"), "not valid json {{{");

    const meta = await extractProjectMetadata(tmpDir);
    expect(meta.nameSource).toBe("directory");
    expect(meta.description).toBeNull();
  });

  it("returns null git info when not a git repo", async () => {
    const meta = await extractProjectMetadata(tmpDir);
    expect(meta.git).toBeNull();
  });

  it("extracts git info from initialized repo", async () => {
    // Initialize a git repo
    execSync("git init", { cwd: tmpDir, stdio: "ignore" });
    execSync("git config user.email test@test.com", { cwd: tmpDir, stdio: "ignore" });
    execSync("git config user.name Test", { cwd: tmpDir, stdio: "ignore" });
    await writeFile(join(tmpDir, "README.md"), "# Test");
    execSync("git add . && git commit -m 'init'", { cwd: tmpDir, stdio: "ignore" });

    const meta = await extractProjectMetadata(tmpDir);
    expect(meta.git).not.toBeNull();
    expect(meta.git!.branch).toBeTruthy();
    expect(meta.git!.sha).toBeTruthy();
    // No remote configured
    expect(meta.git!.remoteUrl).toBeNull();
    expect(meta.git!.repoName).toBeNull();
  });

  it("extracts git remote info when remote is configured", async () => {
    execSync("git init", { cwd: tmpDir, stdio: "ignore" });
    execSync("git config user.email test@test.com", { cwd: tmpDir, stdio: "ignore" });
    execSync("git config user.name Test", { cwd: tmpDir, stdio: "ignore" });
    await writeFile(join(tmpDir, "README.md"), "# Test");
    execSync("git add . && git commit -m 'init'", { cwd: tmpDir, stdio: "ignore" });
    execSync("git remote add origin https://github.com/user/test-repo.git", {
      cwd: tmpDir,
      stdio: "ignore",
    });

    const meta = await extractProjectMetadata(tmpDir);
    expect(meta.git).not.toBeNull();
    expect(meta.git!.remoteUrl).toBe("https://github.com/user/test-repo.git");
    expect(meta.git!.repoName).toBe("test-repo");
  });

  it("handles non-existent project directory gracefully", async () => {
    const meta = await extractProjectMetadata("/tmp/does-not-exist-project-meta-test-12345");
    expect(meta.nameSource).toBe("directory");
    expect(meta.name).toBe("does-not-exist-project-meta-test-12345");
    expect(meta.git).toBeNull();
  });
});

describe("Project API routes", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    clearProjectMetadataCache();
    tmpDir = await mkdtemp(join(tmpdir(), "project-api-"));
    const svDir = join(tmpDir, ".sourcevision");
    const rexDir = join(tmpDir, ".rex");
    await mkdir(svDir, { recursive: true });
    await mkdir(rexDir, { recursive: true });

    ctx = { projectDir: tmpDir, svDir, rexDir, dev: false };
    ({ server, port } = await startTestServer(ctx));
  });

  afterEach(async () => {
    server.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("GET /api/project returns project metadata", async () => {
    await writeFile(
      join(tmpDir, "package.json"),
      JSON.stringify({ name: "test-proj", description: "A test", version: "0.1.0" }),
    );

    const res = await fetch(`http://localhost:${port}/api/project`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const data = await res.json();
    expect(data.name).toBe("test-proj");
    expect(data.description).toBe("A test");
    expect(data.version).toBe("0.1.0");
    expect(data.nameSource).toBe("package.json");
  });

  it("GET /api/project falls back to directory name", async () => {
    const res = await fetch(`http://localhost:${port}/api/project`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.nameSource).toBe("directory");
    expect(data.name).toBeTruthy();
    expect(data.description).toBeNull();
  });

  it("returns 404 for non-project routes", async () => {
    const res = await fetch(`http://localhost:${port}/api/other`);
    expect(res.status).toBe(404);
  });

  it("returns 404 for POST to /api/project", async () => {
    const res = await fetch(`http://localhost:${port}/api/project`, { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("caches metadata across requests", async () => {
    await writeFile(
      join(tmpDir, "package.json"),
      JSON.stringify({ name: "cached-project" }),
    );

    const res1 = await fetch(`http://localhost:${port}/api/project`);
    const data1 = await res1.json();
    expect(data1.name).toBe("cached-project");

    // Modify package.json — should still return cached value within TTL
    await writeFile(
      join(tmpDir, "package.json"),
      JSON.stringify({ name: "updated-project" }),
    );

    const res2 = await fetch(`http://localhost:${port}/api/project`);
    const data2 = await res2.json();
    // Should still be cached (30s TTL)
    expect(data2.name).toBe("cached-project");
  });
});

describe("Project API — resolved CLI name", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    clearProjectMetadataCache();
    tmpDir = await mkdtemp(join(tmpdir(), "project-cliname-"));
    ctx = {
      projectDir: tmpDir,
      svDir: join(tmpDir, ".sourcevision"),
      rexDir: join(tmpDir, ".rex"),
      dev: false,
    };
    ({ server, port } = await startTestServer(ctx));
  });

  afterEach(async () => {
    server.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns cliName 'n-dx' when cli.name is absent from config", async () => {
    const res = await fetch(`http://localhost:${port}/api/project`);
    const body = await res.json();
    expect(body.cliName).toBe("n-dx");
  });

  it("returns the configured cli.name when present", async () => {
    await writeFile(join(tmpDir, ".n-dx.json"), JSON.stringify({ cli: { name: "myapp" } }));
    const res = await fetch(`http://localhost:${port}/api/project`);
    const body = await res.json();
    expect(body.cliName).toBe("myapp");
  });

  it("includes cliName in the extractProjectMetadata result", async () => {
    await writeFile(join(tmpDir, ".n-dx.json"), JSON.stringify({ cli: { name: "customcli" } }));
    const metadata = await extractProjectMetadata(tmpDir);
    expect(metadata.cliName).toBe("customcli");
  });
});
