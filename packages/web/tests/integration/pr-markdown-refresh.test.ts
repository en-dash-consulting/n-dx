// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, appendFile, chmod, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import type { ServerContext } from "../../src/server/types.js";
import { handleSourcevisionRoute } from "../../src/server/routes-sourcevision.js";
import { PRMarkdownView } from "../../src/viewer/views/pr-markdown.js";

const DEGRADED_FAILURE_FIXTURES = [
  {
    code: "missing_git",
    message: "Error: Git is not available on PATH.",
    title: "Git is unavailable",
    hint: "Install Git and ensure `git` is available on PATH, then retry refresh.",
  },
  {
    code: "not_repo",
    message: "Error: This directory is not a git repository.",
    title: "Repository not detected",
    hint: "Run refresh from a cloned Git repository (a directory containing `.git`).",
  },
  {
    code: "unresolved_main_or_origin_main",
    message: "Error: Could not resolve a base branch (`main` or `origin/main`).",
    title: "Base branch could not be resolved",
    hint: "Check that `main` or `origin/main` exists (`git rev-parse --verify main` and `git rev-parse --verify origin/main`), then fetch or create one before retrying.",
  },
  {
    code: "auth_fetch_denied",
    message: "FETCH_DENIED: Remote 'origin' rejected authentication/authorization for 'main'.",
    title: "Remote authentication failed",
    hint: "Run `sourcevision git-credential-helper` to set up git credentials, then retry refresh.",
  },
  {
    code: "network_dns_error",
    message: "NETWORK_DNS_ERROR: Could not reach remote 'origin' while checking 'main'.",
    title: "Remote host is unreachable",
    hint: "Remote host could not be reached. Verify DNS/network/VPN/proxy connectivity to your git remote and retry refresh.",
  },
  {
    code: "fetch_failed",
    message: "Error: Failed to fetch origin/main from remote.",
    title: "Fetching base branch failed",
    hint: "Run `git fetch origin main` manually and verify remote connectivity.",
  },
  {
    code: "rev_parse_failed",
    message: "Error: git rev-parse failed while resolving origin/main.",
    title: "Failed to resolve base revision",
    hint: "Verify the base ref resolves (`git rev-parse --verify main` or `git rev-parse --verify origin/main`) and retry refresh.",
  },
  {
    code: "diff_failed",
    message: "Error: Failed to compute git diff for 'main...HEAD'.",
    title: "Diff computation failed",
    hint: "Run `git diff main...HEAD --name-status` (or `origin/main...HEAD`) to reproduce and fix the diff error, then retry refresh.",
  },
] as const;

function expectedStructuredDiagnosticCode(code: string): string {
  if (code === "not_repo") return "NOT_A_REPO";
  if (code === "unresolved_main_or_origin_main") return "MISSING_BASE_REF";
  if (code === "auth_fetch_denied") return "FETCH_DENIED";
  if (code === "network_dns_error") return "NETWORK_DNS_ERROR";
  return code;
}

function isClassifiedPreflightCode(code: string): boolean {
  return code === "NOT_A_REPO"
    || code === "MISSING_BASE_REF"
    || code === "FETCH_DENIED"
    || code === "NETWORK_DNS_ERROR"
    || code === "DETACHED_HEAD"
    || code === "SHALLOW_CLONE";
}

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

describe("PR markdown refresh integration", () => {
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

  function createRouteFetch(
    ctx: ServerContext,
    options: {
      useRouteRefresh?: boolean;
      refreshResponse?: Record<string, unknown>;
    } = {},
  ): typeof fetch {
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

      if (path === "/api/sv/pr-markdown/refresh" && method === "POST" && options.refreshResponse) {
        return new Response(JSON.stringify(options.refreshResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (path === "/api/sv/pr-markdown/refresh" && method === "POST" && !options.useRouteRefresh) {
        const refreshedMarkdown = [
          "## Scope of Work",
          "",
          "- Base comparison: `main...HEAD`",
          "",
          "## Modified But Unstaged Files",
          "",
          "- `feature.txt`",
          "",
          "## Untracked Files",
          "",
          "- `scratch.tmp`",
          "",
        ].join("\n");
        return new Response(JSON.stringify({
          ok: true,
          signature: "manual-refresh",
          availability: "ready",
          cacheStatus: "fresh",
          generatedAt: new Date().toISOString(),
          staleAfterMs: 30 * 60 * 1000,
          markdown: refreshedMarkdown,
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

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

  async function bindServerFetch(
    projectDir: string,
    options: {
      useRouteRefresh?: boolean;
      refreshResponse?: Record<string, unknown>;
    } = {},
  ): Promise<void> {
    const ctx: ServerContext = { projectDir, svDir, rexDir, dev: false };
    globalThis.fetch = createRouteFetch(ctx, options);
  }

  async function installFailingRefreshScript(message: string): Promise<void> {
    const binDir = join(tmpDir, "node_modules", ".bin");
    const binPath = join(binDir, "sourcevision");
    await mkdir(binDir, { recursive: true });
    await writeFile(
      binPath,
      `#!/bin/sh
cat >&2 <<'EOF'
${message}
EOF
exit 1
`,
      "utf-8",
    );
    await chmod(binPath, 0o755);
  }

  it("keeps markdown unchanged until a manual refresh action is invoked", async () => {
    initRepo(tmpDir, "main");
    await writeFile(join(tmpDir, "stable.txt"), "stable\n");
    await writeFile(join(tmpDir, "feature.txt"), "first\n");
    execSync("git add stable.txt feature.txt", { cwd: tmpDir, stdio: "ignore" });
    execSync("git commit -m 'base'", { cwd: tmpDir, stdio: "ignore" });
    execSync("git checkout -b feature/live", { cwd: tmpDir, stdio: "ignore" });
    await appendFile(join(tmpDir, "feature.txt"), "second\n");
    execSync("git add feature.txt", { cwd: tmpDir, stdio: "ignore" });
    execSync("git commit -m 'feature change'", { cwd: tmpDir, stdio: "ignore" });
    await writeFile(join(svDir, "pr-markdown.md"), "## Snapshot v1\n\n- `feature.txt`");

    await bindServerFetch(tmpDir);
    await renderAndWait(root);

    await waitFor(() => root.textContent?.includes("Snapshot v1") ?? false);

    await writeFile(join(tmpDir, "added-later.txt"), "new\n");
    execSync("git add added-later.txt", { cwd: tmpDir, stdio: "ignore" });
    execSync("git commit -m 'second feature change'", { cwd: tmpDir, stdio: "ignore" });
    await appendFile(join(tmpDir, "feature.txt"), "dirty\n");
    await writeFile(join(tmpDir, "scratch.tmp"), "temp\n");

    const beforeManualRefresh = await fetch("/api/sv/pr-markdown");
    const beforeManualRefreshJson = await beforeManualRefresh.json() as { markdown?: string | null };
    const beforeManualRefreshMarkdown = String(beforeManualRefreshJson.markdown ?? "");
    expect(beforeManualRefreshMarkdown).toContain("Snapshot v1");
    expect(beforeManualRefreshMarkdown).not.toContain("scratch.tmp");

    await new Promise<void>((resolve) => setTimeout(resolve, 1200));
    expect(root.textContent).toContain("Snapshot v1");
    expect(root.textContent).not.toContain("Scope of Work");

    await act(async () => {
      (root.querySelector(".pr-markdown-refresh-btn") as HTMLButtonElement).click();
    });
    await waitFor(() => root.textContent?.includes("Scope of Work") ?? false, 20_000);
    expect(root.textContent).not.toContain("Snapshot v1");
    expect(root.textContent).toContain("scratch.tmp");
  }, 30_000);

  it("shows fallback UI in a non-git workspace", async () => {
    await bindServerFetch(tmpDir);
    await renderAndWait(root);
    await waitFor(() => root.textContent?.includes("No git repository detected") ?? false);
    expect(root.textContent).toContain("Open a repository");
  }, 10_000);

  it.each(DEGRADED_FAILURE_FIXTURES)(
    "returns non-500 degraded refresh response with cached markdown retention for $code",
    async ({ message, code }) => {
      initRepo(tmpDir, "main");
      await writeFile(join(tmpDir, "tracked.txt"), "tracked\n");
      execSync("git add tracked.txt", { cwd: tmpDir, stdio: "ignore" });
      execSync("git commit -m 'base'", { cwd: tmpDir, stdio: "ignore" });

      const cachedMarkdown = `## Cached Summary\n\n- ${code}`;
      await writeFile(join(svDir, "pr-markdown.md"), cachedMarkdown);

      await bindServerFetch(tmpDir, { useRouteRefresh: true });
      const beforeRes = await fetch("/api/sv/pr-markdown");
      const beforeJson = await beforeRes.json() as {
        generatedAt?: string | null;
        cacheStatus?: string;
      };

      await installFailingRefreshScript(message);

      const res = await fetch("/api/sv/pr-markdown/refresh", { method: "POST" });
      expect(res.status).toBe(200);

      const json = await res.json() as {
        ok?: boolean;
        status?: string;
        markdown?: string | null;
        generatedAt?: string | null;
        cacheStatus?: string;
        diagnostics?: Array<{
          code?: string;
          summary?: string;
          remediationCommands?: string[];
          message?: string;
          hints?: string[];
          guidance?: { category?: string; commands?: string[] };
        }>;
      };
      expect(json.ok).toBe(false);
      expect(json.status).toBe("degraded");
      expect(json.markdown).toBe(cachedMarkdown);
      expect(json.generatedAt).toBe(beforeJson.generatedAt ?? null);
      expect(json.cacheStatus).toBe(beforeJson.cacheStatus);
      expect(Array.isArray(json.diagnostics)).toBe(true);
      const structuredCode = expectedStructuredDiagnosticCode(code);
      expect(json.diagnostics?.[0]?.code).toBe(structuredCode);
      if (isClassifiedPreflightCode(structuredCode)) {
        expect(json.diagnostics?.[0]?.message).toBeUndefined();
      } else {
        expect(json.diagnostics?.[0]?.message).toContain(message.replace("Error: ", ""));
      }
      expect(json.diagnostics?.[0]?.hints?.length ?? 0).toBeGreaterThan(0);
      if (["not_repo", "unresolved_main_or_origin_main", "auth_fetch_denied", "network_dns_error"].includes(code)) {
        expect(json.diagnostics?.[0]?.summary?.length ?? 0).toBeGreaterThan(0);
        expect(json.diagnostics?.[0]?.remediationCommands?.length ?? 0).toBeGreaterThan(0);
      }
      const guidanceCategory = json.diagnostics?.[0]?.guidance?.category;
      if (code === "auth_fetch_denied" || code === "network_dns_error" || code === "fetch_failed") {
        expect(guidanceCategory).toBe("fetch_retry");
        expect(json.diagnostics?.[0]?.guidance?.commands).toContain("git fetch origin main");
      } else if (code === "rev_parse_failed" || code === "diff_failed" || code === "unresolved_main_or_origin_main") {
        expect(guidanceCategory).toBe("local_history_remediation");
      } else {
        expect(guidanceCategory).toBe("environment_fix");
      }
    },
  );

  it("filters Hench fallback evidence to runs linked to active-branch Rex task IDs", async () => {
    initRepo(tmpDir, "main");
    await writeFile(join(tmpDir, "tracked.txt"), "tracked\n");
    execSync("git add tracked.txt", { cwd: tmpDir, stdio: "ignore" });
    execSync("git commit -m 'base'", { cwd: tmpDir, stdio: "ignore" });
    execSync("git checkout -b feature/branch-a", { cwd: tmpDir, stdio: "ignore" });

    await writeFile(
      join(rexDir, "execution-log.jsonl"),
      [
        JSON.stringify({ timestamp: "2026-02-23T11:00:00.000Z", event: "status_updated", itemId: "task-keep", branch: "feature/branch-a" }),
        JSON.stringify({ timestamp: "2026-02-23T11:01:00.000Z", event: "status_updated", itemId: "task-drop", branch: "feature/branch-b" }),
      ].join("\n") + "\n",
      "utf-8",
    );

    const runsDir = join(tmpDir, ".hench", "runs");
    await mkdir(runsDir, { recursive: true });
    await writeFile(join(runsDir, "run-keep.json"), JSON.stringify({
      id: "run-keep",
      taskId: "task-keep",
      status: "completed",
      startedAt: "2026-02-23T12:00:00.000Z",
      finishedAt: "2026-02-23T12:05:00.000Z",
    }));
    await writeFile(join(runsDir, "run-drop.json"), JSON.stringify({
      id: "run-drop",
      taskId: "task-drop",
      status: "failed",
      startedAt: "2026-02-23T12:10:00.000Z",
      finishedAt: "2026-02-23T12:12:00.000Z",
    }));

    await bindServerFetch(tmpDir, { useRouteRefresh: true });
    await installFailingRefreshScript("Error: Failed to compute git diff for 'main...HEAD'.");

    const res = await fetch("/api/sv/pr-markdown/refresh", { method: "POST" });
    expect(res.status).toBe(200);
    const json = await res.json() as { status?: string; markdown?: string | null };
    const markdown = String(json.markdown ?? "");

    expect(json.status).toBe("degraded");
    expect(markdown).toContain("## Hench Execution Context");
    expect(markdown).toContain("Run `run-keep` (task `task-keep`), outcome: completed, started 2026-02-23T12:00:00.000Z; finished 2026-02-23T12:05:00.000Z.");
    expect(markdown).not.toContain("run-drop");
  });

  it("fails fast with actionable auth guidance in CI-like non-interactive refresh", async () => {
    initRepo(tmpDir, "main");
    await writeFile(join(tmpDir, "tracked.txt"), "tracked\n");
    execSync("git add tracked.txt", { cwd: tmpDir, stdio: "ignore" });
    execSync("git commit -m 'base'", { cwd: tmpDir, stdio: "ignore" });
    await writeFile(join(svDir, "pr-markdown.md"), "## Cached Summary\n\n- keep");

    await bindServerFetch(tmpDir, { useRouteRefresh: true });

    const binDir = join(tmpDir, "node_modules", ".bin");
    const binPath = join(binDir, "sourcevision");
    await mkdir(binDir, { recursive: true });
    await writeFile(
      binPath,
      `#!/bin/sh
if [ "$GIT_TERMINAL_PROMPT" != "0" ]; then
  sleep 2
fi
cat >&2 <<'EOF'
fatal: could not read Username for 'https://example.invalid': terminal prompts disabled
EOF
exit 1
`,
      "utf-8",
    );
    await chmod(binPath, 0o755);

    const startedAt = Date.now();
    const res = await fetch("/api/sv/pr-markdown/refresh", { method: "POST" });
    const elapsedMs = Date.now() - startedAt;

    expect(res.status).toBe(200);
    expect(elapsedMs).toBeLessThan(1500);
    const json = await res.json() as {
      status?: string;
      diagnostics?: Array<{
        code?: string;
        summary?: string;
        remediationCommands?: string[];
        hints?: string[];
        guidance?: { category?: string; commands?: string[] };
      }>;
    };
    expect(json.status).toBe("degraded");
    expect(json.diagnostics?.[0]?.code).toBe("FETCH_DENIED");
    expect(json.diagnostics?.[0]?.summary?.length ?? 0).toBeGreaterThan(0);
    expect(json.diagnostics?.[0]?.remediationCommands?.length ?? 0).toBeGreaterThan(0);
    expect((json.diagnostics?.[0]?.hints ?? []).join("\n")).toContain("sourcevision git-credential-helper");
    expect(json.diagnostics?.[0]?.guidance?.category).toBe("fetch_retry");
    expect(json.diagnostics?.[0]?.guidance?.commands).toContain("git fetch origin main");
  });

  it("returns classified detached-head preflight diagnostics without raw stderr text", async () => {
    initRepo(tmpDir, "main");
    await writeFile(join(tmpDir, "tracked.txt"), "tracked\n");
    execSync("git add tracked.txt", { cwd: tmpDir, stdio: "ignore" });
    execSync("git commit -m 'base'", { cwd: tmpDir, stdio: "ignore" });
    await writeFile(join(svDir, "pr-markdown.md"), "## Cached Summary\n\n- keep");

    await bindServerFetch(tmpDir, { useRouteRefresh: true });
    await installFailingRefreshScript("DETACHED_HEAD: HEAD is detached at commit 1234567.");

    const res = await fetch("/api/sv/pr-markdown/refresh", { method: "POST" });
    expect(res.status).toBe(200);
    const json = await res.json() as {
      status?: string;
      diagnostics?: Array<{
        code?: string;
        summary?: string;
        remediationCommands?: string[];
        message?: string;
      }>;
      failure?: {
        code?: string;
        stage?: string;
      };
    };
    expect(json.status).toBe("degraded");
    expect(json.diagnostics?.[0]?.code).toBe("DETACHED_HEAD");
    expect(json.diagnostics?.[0]?.summary?.length ?? 0).toBeGreaterThan(0);
    expect(json.diagnostics?.[0]?.remediationCommands).toContain("git switch -c <branch-name>");
    expect(json.diagnostics?.[0]?.message).toBeUndefined();
    expect(json.failure?.code).toBe("DETACHED_HEAD");
    expect(json.failure?.stage).toBe("preflight");
  });

  it("returns mixed-stage failure payload when semantic diff inspection fails after name-status succeeds", async () => {
    initRepo(tmpDir, "main");
    await writeFile(join(tmpDir, "tracked.txt"), "tracked\n");
    execSync("git add tracked.txt", { cwd: tmpDir, stdio: "ignore" });
    execSync("git commit -m 'base'", { cwd: tmpDir, stdio: "ignore" });
    await writeFile(join(svDir, "pr-markdown.md"), "## Cached Summary\n\n- keep");

    await bindServerFetch(tmpDir, { useRouteRefresh: true });

    const binDir = join(tmpDir, "node_modules", ".bin");
    const binPath = join(binDir, "sourcevision");
    await mkdir(binDir, { recursive: true });
    await writeFile(
      binPath,
      `#!/bin/sh
cat > ".sourcevision/pr-markdown.md" <<'EOF'
## PARTIAL
EOF
cat >&2 <<'EOF'
Error: Failed to inspect semantic diff details for 'main...HEAD'.
EOF
exit 1
`,
      "utf-8",
    );
    await chmod(binPath, 0o755);

    const res = await fetch("/api/sv/pr-markdown/refresh", { method: "POST" });
    expect(res.status).toBe(200);

    const json = await res.json() as {
      status?: string;
      diagnostics?: Array<{ code?: string; guidance?: { category?: string; commands?: string[] } }>;
      failure?: {
        type?: string;
        code?: string;
        stage?: string;
        stageStatuses?: {
          nameStatusDiff?: string;
          semanticDiff?: string;
        };
        guidanceCategory?: string;
        commandSuggestions?: string[];
        command?: {
          gitSubcommand?: string;
          subcommand?: string;
          stageId?: string;
          exitCode?: number | null;
          stderr?: string;
          stderrExcerpt?: string;
          reproduce?: string[];
        };
      };
    };
    expect(json.status).toBe("degraded");
    expect(json.diagnostics?.[0]?.code).toBe("diff_failed");
    expect(json.failure?.type).toBe("pr_markdown_refresh_failure");
    expect(json.failure?.code).toBe("diff_failed");
    expect(json.failure?.stage).toBe("mixed");
    expect(json.failure?.stageStatuses?.nameStatusDiff).toBe("succeeded");
    expect(json.failure?.stageStatuses?.semanticDiff).toBe("failed");
    expect(json.failure?.guidanceCategory).toBe("local_history_remediation");
    expect(json.failure?.commandSuggestions).toContain("git diff main...HEAD --name-status");
    expect(json.failure?.command?.gitSubcommand).toBe("diff");
    expect(json.failure?.command?.subcommand).toBe("git --no-pager diff --no-ext-diff --no-textconv --numstat main...HEAD");
    expect(json.failure?.command?.stageId).toBe("semantic_diff_numstat");
    expect(json.failure?.command?.exitCode).toBe(1);
    expect(json.failure?.command?.stderrExcerpt).toContain("Failed to inspect semantic diff details");
    expect(Array.isArray(json.failure?.command?.reproduce)).toBe(true);
    expect(json.failure?.command?.reproduce).toContain("git diff main...HEAD --name-status");
  });

  it("does not run credential helper during refresh unless explicitly opted in", async () => {
    initRepo(tmpDir, "main");
    await writeFile(join(tmpDir, "tracked.txt"), "tracked\n");
    execSync("git add tracked.txt", { cwd: tmpDir, stdio: "ignore" });
    execSync("git commit -m 'base'", { cwd: tmpDir, stdio: "ignore" });
    await writeFile(join(svDir, "pr-markdown.md"), "## Cached Summary\n\n- keep");

    const callsPath = join(tmpDir, "sourcevision-calls.log");
    const binDir = join(tmpDir, "node_modules", ".bin");
    const binPath = join(binDir, "sourcevision");
    await mkdir(binDir, { recursive: true });
    await writeFile(
      binPath,
      `#!/bin/sh
echo "$@" >> "${callsPath}"
if [ "$1" = "git-credential-helper" ]; then
  exit 0
fi
if [ "$1" = "pr-markdown" ]; then
  cat > ".sourcevision/pr-markdown.md" <<'EOF'
## Fresh Summary
EOF
  exit 0
fi
exit 1
`,
      "utf-8",
    );
    await chmod(binPath, 0o755);
    await bindServerFetch(tmpDir, { useRouteRefresh: true });

    const defaultRefresh = await fetch("/api/sv/pr-markdown/refresh", { method: "POST" });
    expect(defaultRefresh.status).toBe(200);
    const defaultCalls = await readFile(callsPath, "utf-8");
    expect(defaultCalls).toContain("pr-markdown");
    expect(defaultCalls).not.toContain("git-credential-helper");

    await writeFile(callsPath, "", "utf-8");

    const optedInRefresh = await fetch("/api/sv/pr-markdown/refresh?credentialHelper=1", { method: "POST" });
    expect(optedInRefresh.status).toBe(200);
    const optedInCalls = await readFile(callsPath, "utf-8");
    expect(optedInCalls).toContain("git-credential-helper");
    expect(optedInCalls).toContain("pr-markdown");
  });

  it.each(DEGRADED_FAILURE_FIXTURES)(
    "renders degraded diagnostic-specific message and remediation hints in UI for $code",
    async ({ code, title, hint }) => {
      initRepo(tmpDir, "main");
      await writeFile(join(tmpDir, "tracked.txt"), "tracked\n");
      execSync("git add tracked.txt", { cwd: tmpDir, stdio: "ignore" });
      execSync("git commit -m 'base'", { cwd: tmpDir, stdio: "ignore" });

      const cachedMarkdown = "## Cached Summary\n\n- Keep this content";
      await writeFile(join(svDir, "pr-markdown.md"), cachedMarkdown);

      await bindServerFetch(tmpDir, {
        refreshResponse: {
          ok: false,
          status: "degraded",
          signature: `degraded-${code}`,
          availability: "ready",
          warning: "Could not resolve base branch (`main` or `origin/main`). Manual PR markdown refresh may be limited.",
          message: "Repository metadata is available, but manual PR markdown refresh needs a resolvable base branch.",
          baseRange: null,
          cacheStatus: "fresh",
          generatedAt: new Date().toISOString(),
          markdown: cachedMarkdown,
          diagnostics: [{ code, message: `Failure for ${code}`, hints: [hint] }],
        },
      });

      await renderAndWait(root);
      await waitFor(() => root.textContent?.includes("Cached Summary") ?? false);

      await act(async () => {
        (root.querySelector(".pr-markdown-refresh-btn") as HTMLButtonElement).click();
      });

      await waitFor(() => root.textContent?.includes("Refresh diagnostics") ?? false);
      expect(root.textContent).toContain(title);
      expect(root.textContent).toContain(`Failure for ${code}`);
      expect(root.textContent).toContain(hint);
      expect(root.textContent).toContain("Cached Summary");
    },
  );

  it.each([
    {
      name: "auth",
      scriptMessage: "fatal: could not read Username for 'https://example.invalid': terminal prompts disabled",
      expectedTitle: "Remote authentication failed",
      expectedCommand: "sourcevision git-credential-helper",
      hiddenRawText: "terminal prompts disabled",
    },
    {
      name: "network",
      scriptMessage: "fatal: Could not resolve host: github.com",
      expectedTitle: "Remote host is unreachable",
      expectedCommand: "git fetch origin main",
      hiddenRawText: "Could not resolve host",
    },
    {
      name: "detached",
      scriptMessage: "DETACHED_HEAD: HEAD is detached at commit 1234567.",
      expectedTitle: "Detached HEAD detected",
      expectedCommand: "git switch -c <branch-name>",
      hiddenRawText: "DETACHED_HEAD: HEAD is detached",
    },
  ])("renders targeted remediation commands without raw stderr for $name preflight failures", async ({ scriptMessage, expectedTitle, expectedCommand, hiddenRawText }) => {
    initRepo(tmpDir, "main");
    await writeFile(join(tmpDir, "tracked.txt"), "tracked\n");
    execSync("git add tracked.txt", { cwd: tmpDir, stdio: "ignore" });
    execSync("git commit -m 'base'", { cwd: tmpDir, stdio: "ignore" });
    await writeFile(join(svDir, "pr-markdown.md"), "## Cached Summary\n\n- Keep this content");

    await bindServerFetch(tmpDir, { useRouteRefresh: true });
    await installFailingRefreshScript(scriptMessage);
    await renderAndWait(root);
    await waitFor(() => root.textContent?.includes("Cached Summary") ?? false);

    await act(async () => {
      (root.querySelector(".pr-markdown-refresh-btn") as HTMLButtonElement).click();
    });

    await waitFor(() => root.textContent?.includes("Refresh diagnostics") ?? false);
    expect(root.textContent).toContain(expectedCommand);
    expect(root.textContent).toContain(expectedTitle);
    expect(root.textContent).not.toContain("Failure details");
    expect(root.textContent).not.toContain(hiddenRawText);
  });

  it("renders semantic-diff degraded banner and failure details while keeping cached markdown copyable", async () => {
    initRepo(tmpDir, "main");
    await writeFile(join(tmpDir, "tracked.txt"), "tracked\n");
    execSync("git add tracked.txt", { cwd: tmpDir, stdio: "ignore" });
    execSync("git commit -m 'base'", { cwd: tmpDir, stdio: "ignore" });

    const cachedMarkdown = "## Cached Summary\n\n- Keep this content";
    await writeFile(join(svDir, "pr-markdown.md"), cachedMarkdown);

    await bindServerFetch(tmpDir, {
      refreshResponse: {
        ok: false,
        status: "degraded",
        signature: "degraded-diff",
        availability: "ready",
        cacheStatus: "fresh",
        generatedAt: new Date().toISOString(),
        markdown: cachedMarkdown,
        diagnostics: [{
          code: "diff_failed",
          message: "Failed to inspect semantic diff details for `main...HEAD`.",
          hints: ["Run `git diff main...HEAD --name-status` and verify local history."],
        }],
        failure: {
          type: "pr_markdown_refresh_failure",
          code: "diff_failed",
          stage: "semantic-diff",
          guidanceCategory: "local_history_remediation",
          commandSuggestions: ["git diff main...HEAD --name-status"],
          command: {
            gitSubcommand: "diff",
            stderrExcerpt: "Failed to inspect semantic diff details for 'main...HEAD'.",
            reproduce: ["git diff main...HEAD --name-status"],
          },
        },
      },
    });

    await renderAndWait(root);
    await waitFor(() => root.textContent?.includes("Cached Summary") ?? false);

    await act(async () => {
      (root.querySelector(".pr-markdown-refresh-btn") as HTMLButtonElement).click();
    });

    await waitFor(() => root.textContent?.includes("Semantic diff refresh failed") ?? false);
    expect(root.textContent).toContain("Refresh diagnostics");
    expect(root.textContent).toContain("Failure details");
    expect(root.textContent).toContain("Failing git subcommand: git diff");
    expect(root.textContent).toContain("Failed to inspect semantic diff details");
    expect(root.textContent).toContain("Cached Summary");

    await act(async () => {
      (root.querySelector('button[aria-controls="pr-markdown-panel-raw"]') as HTMLButtonElement).click();
    });
    await waitFor(() => root.textContent?.includes("Copy Markdown") ?? false);
    expect(root.querySelector(".pr-markdown-copy-btn")).toBeTruthy();
  });
});
