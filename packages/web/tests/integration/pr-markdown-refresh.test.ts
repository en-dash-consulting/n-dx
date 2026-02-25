// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import type { ServerContext } from "../../src/server/types.js";
import { handleSourcevisionRoute } from "../../src/server/routes-sourcevision.js";
import { PRMarkdownView } from "../../src/viewer/views/pr-markdown.js";

function initRepo(dir: string, mainBranch: string = "main"): void {
  execSync(`git init -b ${mainBranch}`, { cwd: dir, stdio: "ignore" });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "ignore" });
  execSync("git config user.name Test", { cwd: dir, stdio: "ignore" });
}

async function renderAndWait(root: HTMLDivElement): Promise<void> {
  await act(async () => {
    render(h(PRMarkdownView, null), root);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

async function waitFor(predicate: () => boolean, timeoutMs: number = 8000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await act(async () => {
      await Promise.resolve();
    });
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

describe("PR markdown integration", () => {
  let tmpDir: string;
  let svDir: string;
  let rexDir: string;
  let root: HTMLDivElement;
  let originalFetch: typeof fetch;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-pr-refresh-"));
    svDir = join(tmpDir, ".sourcevision");
    rexDir = join(tmpDir, ".rex");
    await mkdir(svDir, { recursive: true });
    await mkdir(rexDir, { recursive: true });

    root = document.createElement("div");
    document.body.appendChild(root);
    originalFetch = globalThis.fetch;
  });

  afterEach(async () => {
    render(null, root);
    root.remove();
    globalThis.fetch = originalFetch;
    await rm(tmpDir, { recursive: true, force: true });
  });

  function createRouteFetch(ctx: ServerContext): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      const urlText = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : String(input);
      const path = urlText.startsWith("/")
        ? urlText
        : (() => {
            try {
              return new URL(urlText).pathname;
            } catch {
              return urlText;
            }
          })();

      const req = { method, url: path } as IncomingMessage;
      let status = 200;
      const headers = new Headers();
      let body = "";
      const res = {
        setHeader(name: string, value: string) {
          headers.set(name, value);
        },
        writeHead(nextStatus: number, nextHeaders?: Record<string, string>) {
          status = nextStatus;
          if (nextHeaders) {
            for (const [name, value] of Object.entries(nextHeaders)) headers.set(name, value);
          }
          return this;
        },
        end(chunk?: string | Buffer) {
          body = chunk == null ? "" : chunk.toString();
          return this;
        },
      } as unknown as ServerResponse;

      const handled = handleSourcevisionRoute(req, res, ctx);
      if (!handled) return new Response("Not found", { status: 404 });
      return new Response(body, { status, headers });
    }) as typeof fetch;
  }

  async function bindServerFetch(projectDir: string): Promise<void> {
    const ctx: ServerContext = { projectDir, svDir, rexDir, dev: false };
    globalThis.fetch = createRouteFetch(ctx);
  }

  it("displays cached PR markdown from prior analyze run", async () => {
    initRepo(tmpDir, "main");
    await writeFile(join(tmpDir, "feature.txt"), "feature\n");
    execSync("git add feature.txt", { cwd: tmpDir, stdio: "ignore" });
    execSync("git commit -m 'base'", { cwd: tmpDir, stdio: "ignore" });
    await writeFile(join(svDir, "pr-markdown.md"), "## Snapshot v1\n\n- `feature.txt`");

    await bindServerFetch(tmpDir);
    await renderAndWait(root);

    await waitFor(() => root.textContent?.includes("Snapshot v1") ?? false);
    expect(root.textContent).toContain("feature.txt");
  }, 10_000);

  it("shows fallback UI in a non-git workspace", async () => {
    await bindServerFetch(tmpDir);
    await renderAndWait(root);
    await waitFor(() => root.textContent?.includes("No git repository detected") ?? false);
    expect(root.textContent).toContain("Open a repository");
  }, 10_000);

  it("does not render a refresh button", async () => {
    initRepo(tmpDir, "main");
    await writeFile(join(tmpDir, "tracked.txt"), "tracked\n");
    execSync("git add tracked.txt", { cwd: tmpDir, stdio: "ignore" });
    execSync("git commit -m 'base'", { cwd: tmpDir, stdio: "ignore" });
    await writeFile(join(svDir, "pr-markdown.md"), "## Cached Summary\n\n- Content");

    await bindServerFetch(tmpDir);
    await renderAndWait(root);
    await waitFor(() => root.textContent?.includes("Cached Summary") ?? false);

    expect(root.querySelector(".pr-markdown-refresh-btn")).toBeNull();
  }, 10_000);

  it("shows analyze guidance when no cached markdown exists", async () => {
    initRepo(tmpDir, "main");
    await writeFile(join(tmpDir, "tracked.txt"), "tracked\n");
    execSync("git add tracked.txt", { cwd: tmpDir, stdio: "ignore" });
    execSync("git commit -m 'base'", { cwd: tmpDir, stdio: "ignore" });

    await bindServerFetch(tmpDir);
    await renderAndWait(root);
    await waitFor(() => root.textContent?.includes("No PR markdown available") ?? false);

    expect(root.textContent).toContain("sourcevision analyze");
  }, 10_000);

  it("rejects POST to removed refresh endpoint", async () => {
    initRepo(tmpDir, "main");
    await writeFile(join(tmpDir, "tracked.txt"), "tracked\n");
    execSync("git add tracked.txt", { cwd: tmpDir, stdio: "ignore" });
    execSync("git commit -m 'base'", { cwd: tmpDir, stdio: "ignore" });

    await bindServerFetch(tmpDir);

    const res = await fetch("/api/sv/pr-markdown/refresh", { method: "POST" });
    expect(res.status).toBe(404);
  }, 10_000);
});
