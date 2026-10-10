import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveLayout } from "../../src/llm-gateway.js";
import { rexMcpEndpoint, hubPort, DEFAULT_HUB_PORT } from "../../src/hub.js";

let home: string;
let root: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ndx-home-"));
  root = mkdtempSync(join(tmpdir(), "ndx-project-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

describe("rexMcpEndpoint", () => {
  it("is undefined when the hub has never registered the project", () => {
    expect(rexMcpEndpoint(resolveLayout(root), { home })).toBeUndefined();
    writeFileSync(join(home, "hub.json"), JSON.stringify({ version: 1, projects: { other: { id: "other", repoRoot: "/elsewhere" } } }));
    expect(rexMcpEndpoint(resolveLayout(root), { home })).toBeUndefined();
  });

  it("names the per-project endpoint, the token file and whether the server was up", () => {
    writeFileSync(join(home, "hub.json"), JSON.stringify({ version: 1, projects: { "my app": { id: "my app", repoRoot: root, worktrees: [root], pid: 123 } } }));
    writeFileSync(join(home, "auth.token"), "secret\n");
    const endpoint = rexMcpEndpoint(resolveLayout(root), { home });
    expect(endpoint).toEqual({ url: `http://localhost:${DEFAULT_HUB_PORT}/p/my%20app/mcp/rex`, projectId: "my app", tokenFile: join(home, "auth.token"), registered: true });
  });

  it("marks a worktree of the registered repository, so a writer resolves its workspace key first", () => {
    const worktree = join(root, ".claude", "worktrees", "wt");
    mkdirSync(worktree, { recursive: true });
    writeFileSync(join(home, "hub.json"), JSON.stringify({ version: 1, projects: [{ id: "p", repoRoot: "/main", worktrees: ["/main", worktree], pid: null }] }));
    const endpoint = rexMcpEndpoint(resolveLayout(worktree), { home });
    expect(endpoint?.url).toBe(`http://localhost:${DEFAULT_HUB_PORT}/p/p/mcp/rex`);
    expect(endpoint?.worktree).toBe(realpathSync(worktree));
    expect(endpoint?.workspacesUrl).toBe(`http://localhost:${DEFAULT_HUB_PORT}/p/p/api/workspaces`);
    expect(endpoint?.registered).toBe(false);
    expect(endpoint?.tokenFile).toBeUndefined();
  });

  it("does not mark the repository root itself as a worktree", () => {
    writeFileSync(join(home, "hub.json"), JSON.stringify({ version: 1, projects: [{ id: "p", repoRoot: root, worktrees: [root], pid: 1 }] }));
    const endpoint = rexMcpEndpoint(resolveLayout(root), { home });
    expect(endpoint?.worktree).toBeUndefined();
    expect(endpoint?.workspacesUrl).toBeUndefined();
  });

  it("reads the hub's port from config.json, then hub.pid, then the default", () => {
    expect(hubPort(home)).toBe(DEFAULT_HUB_PORT);
    writeFileSync(join(home, "hub.pid"), JSON.stringify({ pid: 4321, port: 4242 }));
    expect(hubPort(home)).toBe(4242);
    writeFileSync(join(home, "config.json"), JSON.stringify({ hub: { port: 5151 } }));
    expect(hubPort(home)).toBe(5151);
    writeFileSync(join(home, "config.json"), JSON.stringify({ hub: { port: "not a port" } }));
    expect(hubPort(home)).toBe(4242);
    writeFileSync(join(home, "hub.json"), JSON.stringify({ version: 1, projects: [{ id: "p", repoRoot: root, worktrees: [root], pid: 1 }] }));
    expect(rexMcpEndpoint(resolveLayout(root), { home })?.url).toBe("http://localhost:4242/p/p/mcp/rex");
  });
});
