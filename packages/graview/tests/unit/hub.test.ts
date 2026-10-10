import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveLayout } from "../../src/llm-gateway.js";
import { rexMcpEndpoint, DEFAULT_HUB_PORT } from "../../src/hub.js";

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

  it("matches a worktree of the registered repository and reads the hub's port file", () => {
    const worktree = join(root, ".claude", "worktrees", "wt");
    mkdirSync(worktree, { recursive: true });
    writeFileSync(join(home, "hub.json"), JSON.stringify({ version: 1, projects: [{ id: "p", repoRoot: "/main", worktrees: ["/main", worktree], pid: null }] }));
    writeFileSync(join(home, "hub.port"), "4242\n");
    const endpoint = rexMcpEndpoint(resolveLayout(worktree), { home });
    expect(endpoint?.url).toBe("http://localhost:4242/p/p/mcp/rex");
    expect(endpoint?.registered).toBe(false);
    expect(endpoint?.tokenFile).toBeUndefined();
  });
});
