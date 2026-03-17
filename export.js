#!/usr/bin/env node

/**
 * ndx export — generate a static deployable dashboard.
 *
 * Spawn-exempt orchestration script (like config.js). Dynamically imports
 * rex functions from packages/rex/dist/public.js to pre-render API responses
 * as static JSON files.
 *
 * The output directory is a self-contained static site that can be deployed
 * to GitHub Pages, Netlify, S3, or any static host. All read-only views
 * work; mutation UI is hidden via CSS.
 *
 * @module n-dx/export
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, statSync } from "fs";
import { join, resolve, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dir = dirname(fileURLToPath(import.meta.url));

// ── Flag parsing ─────────────────────────────────────────────────────────────

function parseExportArgs(args) {
  let outDir = "./ndx-export";
  let basePath = null;
  let cname = null;
  let deploy = null;
  let dir = process.cwd();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--out-dir=")) {
      outDir = arg.slice("--out-dir=".length);
    } else if (arg.startsWith("--base-path=")) {
      basePath = arg.slice("--base-path=".length);
    } else if (arg.startsWith("--cname=")) {
      cname = arg.slice("--cname=".length);
    } else if (arg.startsWith("--deploy=")) {
      deploy = arg.slice("--deploy=".length);
    } else if (!arg.startsWith("-")) {
      dir = arg;
    }
  }

  // Auto-detect base path for GitHub Pages.
  // Custom domain (CNAME) → root path. Otherwise infer /{repo}/ from remote.
  if (basePath == null && deploy === "github") {
    // Check for CNAME: explicit flag, existing deploy branch, or .n-dx.json config
    if (!cname) {
      try {
        cname = execSync("git show n-dx-dashboard:CNAME", { cwd: dir, encoding: "utf-8", stdio: "pipe" }).trim();
      } catch { /* no CNAME on deploy branch */ }
    }

    if (cname) {
      // Custom domain — serve at root
      basePath = "/";
    } else {
      try {
        const remote = execSync("git remote get-url origin", { cwd: dir, encoding: "utf-8" }).trim();
        const match = remote.match(/[/:]([^/]+?)(?:\.git)?$/);
        if (match) {
          basePath = `/${match[1]}/`;
          console.log(`[export] auto-detected base path: ${basePath}`);
        }
      } catch { /* fall through to default */ }
    }
  }

  if (basePath == null) basePath = "/";

  // Normalize basePath
  if (!basePath.startsWith("/")) basePath = "/" + basePath;
  if (!basePath.endsWith("/")) basePath += "/";

  return { outDir: resolve(dir, outDir), basePath, cname, deploy, dir: resolve(dir) };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true });
}

function writeJSON(filePath, data) {
  ensureDir(dirname(filePath));
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function copyIfExists(src, dest) {
  if (existsSync(src)) {
    ensureDir(dirname(dest));
    copyFileSync(src, dest);
    return true;
  }
  return false;
}

function readJSON(filePath) {
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

function getGitInfo(dir) {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: dir, stdio: ["pipe", "pipe", "pipe"] }).toString().trim();
    const sha = execSync("git rev-parse --short HEAD", { cwd: dir, stdio: ["pipe", "pipe", "pipe"] }).toString().trim();
    let remoteUrl = null;
    let repoName = null;
    try {
      remoteUrl = execSync("git remote get-url origin", { cwd: dir, stdio: ["pipe", "pipe", "pipe"] }).toString().trim();
      if (remoteUrl) {
        const match = remoteUrl.match(/\/([^/]+?)(?:\.git)?$/);
        if (match) repoName = match[1];
      }
    } catch { /* no remote */ }
    return { branch, sha, remoteUrl, repoName };
  } catch {
    return null;
  }
}

// ── Main export logic ────────────────────────────────────────────────────────

export async function runExport(args) {
  const { outDir, basePath, cname, deploy, dir } = parseExportArgs(args);
  const svDir = join(dir, ".sourcevision");
  const rexDir = join(dir, ".rex");
  const henchDir = join(dir, ".hench");

  // ── Validate prerequisites ─────────────────────────────────────────────
  const missing = [];
  if (!existsSync(svDir)) missing.push(".sourcevision");
  if (!existsSync(join(rexDir, "prd.json"))) missing.push(".rex/prd.json");
  if (missing.length > 0) {
    console.error(`Error: Missing ${missing.join(", ")} in ${dir}`);
    console.error("Hint: Run 'ndx init' and 'ndx plan' first.");
    return 1;
  }

  console.log(`[export] generating static dashboard → ${outDir}`);
  console.log(`[export] base path: ${basePath}`);

  // ── Dynamic import of rex functions ────────────────────────────────────
  const rexPublic = await import(join(__dir, "packages/rex/dist/public.js"));
  const {
    computeStats,
    computeEpicStats,
    computePriorityDistribution,
    computeRequirementsSummary,
    findNextTask,
    collectCompletedIds,
    computeHealthScore,
  } = rexPublic;

  // Clean output directory
  ensureDir(outDir);

  // ── Step 1: Copy sourcevision data files ───────────────────────────────
  console.log("[export] copying sourcevision data...");
  const svDataFiles = ["manifest.json", "inventory.json", "imports.json", "zones.json", "components.json", "callgraph.json"];
  const copiedFiles = [];
  for (const file of svDataFiles) {
    if (copyIfExists(join(svDir, file), join(outDir, "data", file))) {
      copiedFiles.push(file);
    }
  }

  // Write data/index.json (file listing for mode detection)
  writeJSON(join(outDir, "data", "index.json"), { files: copiedFiles });

  // ── Step 2: Pre-render PRD data ────────────────────────────────────────
  console.log("[export] pre-rendering PRD data...");
  const prdPath = join(rexDir, "prd.json");
  const prdDoc = readJSON(prdPath);
  const items = prdDoc.items || [];

  // Raw PRD copy
  writeJSON(join(outDir, "data", "prd.json"), prdDoc);
  writeJSON(join(outDir, "api", "rex", "prd.json"), prdDoc);

  // Stats
  const stats = computeStats(items);
  writeJSON(join(outDir, "api", "rex", "stats.json"), {
    title: prdDoc.title,
    stats,
    percentComplete: stats.total > 0
      ? Math.round((stats.completed / stats.total) * 100)
      : 0,
  });

  // Dashboard aggregate
  const completedIds = collectCompletedIds(items);
  const nextTask = findNextTask(items, completedIds);
  const epics = computeEpicStats(items);
  const priorities = computePriorityDistribution(items);
  const requirements = computeRequirementsSummary(items);
  writeJSON(join(outDir, "api", "rex", "dashboard.json"), {
    title: prdDoc.title,
    stats,
    percentComplete: stats.total > 0
      ? Math.round((stats.completed / stats.total) * 100)
      : 0,
    epics,
    nextTask,
    priorities,
    requirements,
  });

  // Next task
  writeJSON(join(outDir, "api", "rex", "next.json"),
    nextTask
      ? { task: nextTask }
      : { task: null, message: "All tasks completed or blocked" },
  );

  // Health score
  const health = computeHealthScore(items);
  writeJSON(join(outDir, "api", "rex", "health.json"), health);

  // Execution log
  const logPath = join(rexDir, "execution-log.jsonl");
  let logEntries = [];
  if (existsSync(logPath)) {
    try {
      const raw = readFileSync(logPath, "utf-8");
      logEntries = raw.trim().split("\n").filter(Boolean)
        .map((line) => { try { return JSON.parse(line); } catch { return null; } })
        .filter(Boolean);
    } catch { /* ignore */ }
  }
  writeJSON(join(outDir, "api", "rex", "log.json"), { entries: logEntries });

  // ── Step 3: Pre-render hench data ──────────────────────────────────────
  console.log("[export] pre-rendering hench data...");
  const runsDir = join(henchDir, "runs");
  let runs = [];
  let totalInput = 0;
  let totalOutput = 0;

  if (existsSync(runsDir)) {
    const runFiles = readdirSync(runsDir).filter((f) => f.endsWith(".json"));
    for (const file of runFiles) {
      try {
        const run = readJSON(join(runsDir, file));
        if (!run.id || !run.startedAt) continue;

        // Aggregate token usage
        const usage = run.tokenUsage || {};
        totalInput += usage.input || 0;
        totalOutput += usage.output || 0;

        // Individual run (full detail for transcript viewing)
        writeJSON(join(outDir, "api", "hench", "runs", `${run.id}.json`), run);

        // Summary (strip heavy fields)
        runs.push({
          id: run.id,
          taskId: run.taskId,
          taskTitle: run.taskTitle,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          lastActivityAt: run.lastActivityAt,
          status: run.status,
          turns: run.turns || 0,
          summary: run.summary,
          error: run.error,
          model: run.model,
          tokenUsage: {
            input: usage.input || 0,
            output: usage.output || 0,
            cacheCreationInput: usage.cacheCreationInput,
            cacheReadInput: usage.cacheReadInput,
          },
          structuredSummary: run.structuredSummary,
        });
      } catch { /* skip malformed run files */ }
    }
    runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  writeJSON(join(outDir, "api", "hench", "runs.json"), { runs, total: runs.length });

  // Task usage aggregate
  const taskUsageMap = {};
  for (const run of runs) {
    const tid = run.taskId;
    if (!tid) continue;
    if (!taskUsageMap[tid]) {
      taskUsageMap[tid] = { taskId: tid, taskTitle: run.taskTitle, input: 0, output: 0, runs: 0 };
    }
    taskUsageMap[tid].input += run.tokenUsage?.input || 0;
    taskUsageMap[tid].output += run.tokenUsage?.output || 0;
    taskUsageMap[tid].runs += 1;
  }
  writeJSON(join(outDir, "api", "hench", "task-usage.json"), {
    tasks: Object.values(taskUsageMap),
    total: { input: totalInput, output: totalOutput },
  });

  // Token utilization snapshot
  writeJSON(join(outDir, "api", "token", "utilization.json"), {
    budget: null,
    usage: { input: totalInput, output: totalOutput, total: totalInput + totalOutput },
  });

  // ── Step 4: Pre-render meta endpoints ──────────────────────────────────
  console.log("[export] pre-rendering meta endpoints...");

  writeJSON(join(outDir, "api", "config.json"), { scope: "all", initialized: true });

  writeJSON(join(outDir, "api", "features.json"), {
    features: {
      "sourcevision.callGraph": { enabled: true },
      "sourcevision.enrichment": { enabled: true },
      "sourcevision.componentCatalog": { enabled: true },
      "rex.autoComplete": { enabled: true },
      "rex.showTokenBudget": { enabled: true },
      "rex.budgetEnforcement": { enabled: false },
      "rex.notionSync": { enabled: false },
      "rex.integrations": { enabled: false },
      "hench.autoRetry": { enabled: true },
      "hench.guardRails": { enabled: true },
      "hench.adaptiveWorkflow": { enabled: true },
    },
  });

  const gitInfo = getGitInfo(dir);
  writeJSON(join(outDir, "api", "project.json"), {
    name: prdDoc.title || basename(dir),
    description: null,
    version: null,
    git: gitInfo,
    nameSource: "prd",
  });

  // ── Step 5: Copy viewer assets ─────────────────────────────────────────
  console.log("[export] copying viewer assets...");
  const viewerDir = join(__dir, "packages/web/dist/viewer");

  if (!existsSync(join(viewerDir, "index.html"))) {
    console.error("Error: Viewer not built. Run 'pnpm build' first.");
    return 1;
  }

  // Read and transform index.html
  let html = readFileSync(join(viewerDir, "index.html"), "utf-8");

  // Inject <base> tag for subpath deployments
  html = html.replace(
    "<head>",
    `<head>\n  <base href="${basePath}">`,
  );

  // Inject deployed mode config before the closing </head> tag
  const deployedScript = `<script>window.__NDX_DEPLOYED__=${JSON.stringify({ basePath, exportedAt: new Date().toISOString() })};</script>`;
  html = html.replace("</head>", `  ${deployedScript}\n</head>`);

  writeFileSync(join(outDir, "index.html"), html);

  // SPA fallback: 404.html = copy of index.html (GitHub Pages serves this for unknown paths)
  writeFileSync(join(outDir, "404.html"), html);

  // Copy PNG assets
  const pngAssets = ["n-dx.png", "SourceVision.png", "SourceVision-F.png", "Rex-F.png", "Hench-F.png"];
  for (const png of pngAssets) {
    copyIfExists(join(viewerDir, png), join(outDir, png));
  }

  // Copy styles.css if it exists as a separate file
  copyIfExists(join(viewerDir, "styles.css"), join(outDir, "styles.css"));

  // Copy JS bundles from viewer dist
  copyViewerAssets(viewerDir, outDir);

  // ── Step 6: Write markers ──────────────────────────────────────────────
  writeFileSync(join(outDir, ".nojekyll"), "");
  writeJSON(join(outDir, "deployed.json"), {
    exportedAt: new Date().toISOString(),
    basePath,
  });

  console.log(`[export] done — ${outDir}`);

  // ── Optional: deploy to GitHub Pages ────────────────────────────────────
  if (deploy === "github") {
    return deployToGitHubPages(outDir, dir, cname);
  }

  return 0;
}

/**
 * Copy only the viewer assets needed for the deployed dashboard.
 *
 * The viewer dist/ contains both the bundled index.html (with inline JS)
 * and raw TypeScript compilation output (.js, .d.ts, .js.map). Only the
 * bundled HTML + CSS + images are needed for deployment. The raw TS output
 * must NOT be copied — it bloats the export and exposes source internals.
 */
function copyViewerAssets(srcDir, destDir) {
  // The viewer is fully bundled into index.html (inline script).
  // Only copy explicitly needed asset types from the top-level viewer dir.
  const entries = readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    // Skip files already handled
    if (entry.name === "index.html") continue;
    if (entry.name === "styles.css") continue;
    if (entry.name.endsWith(".png")) continue;
    // Skip TypeScript artifacts — these are raw tsc output, not bundle assets
    if (entry.name.endsWith(".js")) continue;
    if (entry.name.endsWith(".js.map")) continue;
    if (entry.name.endsWith(".d.ts")) continue;
    // Copy any other assets (fonts, SVGs, etc.)
    copyFileSync(join(srcDir, entry.name), join(destDir, entry.name));
  }
}

/**
 * Deploy output directory to the n-dx-dashboard branch (GitHub Pages).
 */
function deployToGitHubPages(outDir, projectDir, cname) {
  const branch = "n-dx-dashboard";
  console.log(`[export] deploying to ${branch}...`);
  try {
    // Check if branch exists
    try {
      execSync(`git rev-parse --verify ${branch}`, { cwd: projectDir, stdio: "pipe" });
    } catch {
      console.log(`[export] creating ${branch} orphan branch...`);
    }

    // Use a temporary worktree approach
    const tmpWorktree = join(projectDir, ".ndx-deploy-tmp");
    try {
      // Clean up any stale worktree
      try { execSync(`git worktree remove "${tmpWorktree}" --force`, { cwd: projectDir, stdio: "pipe" }); } catch { /* ok */ }

      // Create or checkout branch
      try {
        execSync(`git worktree add "${tmpWorktree}" ${branch}`, { cwd: projectDir, stdio: "pipe" });
      } catch {
        // Branch doesn't exist — create orphan
        execSync(`git worktree add --detach "${tmpWorktree}"`, { cwd: projectDir, stdio: "pipe" });
        execSync(`git checkout --orphan ${branch}`, { cwd: tmpWorktree, stdio: "pipe" });
        execSync("git rm -rf . 2>/dev/null || true", { cwd: tmpWorktree, stdio: "pipe" });
      }

      // Preserve CNAME from existing deploy branch, or use --cname flag
      let resolvedCname = cname;
      if (!resolvedCname) {
        try {
          resolvedCname = readFileSync(join(tmpWorktree, "CNAME"), "utf-8").trim();
        } catch { /* no CNAME */ }
      }

      // Clean worktree and copy export output
      const existingFiles = readdirSync(tmpWorktree).filter((f) => f !== ".git");
      for (const f of existingFiles) {
        execSync(`rm -rf "${join(tmpWorktree, f)}"`, { stdio: "pipe" });
      }

      copyDirRecursive(outDir, tmpWorktree);

      // Write CNAME for custom domain
      if (resolvedCname) {
        writeFileSync(join(tmpWorktree, "CNAME"), resolvedCname + "\n");
        console.log(`[export] CNAME: ${resolvedCname}`);
      }

      // Commit and push
      execSync("git add -A", { cwd: tmpWorktree, stdio: "pipe" });

      const hasChanges = execSync("git status --porcelain", { cwd: tmpWorktree }).toString().trim();
      if (!hasChanges) {
        console.log(`[export] ${branch} is already up to date`);
      } else {
        const timestamp = new Date().toISOString();
        execSync(`git commit -m "Deploy dashboard (${timestamp})"`, { cwd: tmpWorktree, stdio: "pipe" });
        execSync(`git push --force origin ${branch}`, { cwd: tmpWorktree, stdio: "inherit" });
        console.log(`[export] pushed to ${branch}`);
      }
    } finally {
      try { execSync(`git worktree remove "${tmpWorktree}" --force`, { cwd: projectDir, stdio: "pipe" }); } catch { /* ok */ }
    }

    return 0;
  } catch (err) {
    console.error(`[export] deployment failed: ${err.message}`);
    return 1;
  }
}

function copyDirRecursive(src, dest) {
  ensureDir(dest);
  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}
