import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import ts from "typescript";
import { CLIError, requireSvDir } from "../errors.js";
import { SV_DIR } from "./constants.js";
import { info } from "../output.js";
import { resolveWorkedEpicTitlesForRange, type ResolvedBranchScopedRexWork } from "./prd-epic-resolver.js";

const OUTPUT_FILENAME = "pr-markdown.md";
const SIGNIFICANT_HIGHLIGHTS_LIMIT = 6;
const IMPORTANT_CHANGE_NARRATIVE_LIMIT = 3;

interface GitChangedFile {
  status: string;
  path: string;
  additions: number;
  deletions: number;
}

interface WorkingTreeState {
  unstagedModifiedFiles: string[];
  untrackedFiles: string[];
}

interface DiffHunk {
  addedLines: Set<number>;
  removed: string[];
  added: string[];
}

interface GitDiffDetails {
  path: string;
  hasMaterialChanges: boolean;
  addedLines: Set<number>;
}

type HighlightKind = "function" | "route" | "component";

interface SignificantHighlight {
  kind: HighlightKind;
  title: string;
  rationale: string;
  score: number;
}

interface SourceFunction {
  name: string;
  startLine: number;
  endLine: number;
  exported: boolean;
}

type GitResult =
  | { ok: true; output: string }
  | { ok: false; reason: "missing-git" | "not-a-repo" | "failed"; stderr: string; status?: number };

const NON_INTERACTIVE_GIT_ENV = {
  GIT_TERMINAL_PROMPT: "0",
  GCM_INTERACTIVE: "never",
  GH_PROMPT_DISABLED: "1",
};

function runGit(projectDir: string, args: string[]): GitResult {
  try {
    const output = execFileSync("git", args, {
      cwd: projectDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...NON_INTERACTIVE_GIT_ENV },
    }).trim();
    return { ok: true, output };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string | Buffer; status?: number };
    if (err.code === "ENOENT") return { ok: false, reason: "missing-git", stderr: "", status: err.status };

    const stderrRaw = typeof err.stderr === "string" ? err.stderr : err.stderr?.toString("utf-8") ?? "";
    const stderr = stderrRaw.toLowerCase();
    if (stderr.includes("not a git repository")) return { ok: false, reason: "not-a-repo", stderr, status: err.status };
    if (err.status === 128 && stderr.includes("outside repository")) return { ok: false, reason: "not-a-repo", stderr, status: err.status };
    return { ok: false, reason: "failed", stderr, status: err.status };
  }
}

function gitOutput(projectDir: string, args: string[]): string | null {
  const result = runGit(projectDir, args);
  return result.ok ? result.output : null;
}

function hasCommitRef(projectDir: string, ref: string): boolean {
  return gitOutput(projectDir, ["rev-parse", "--verify", `${ref}^{commit}`]) !== null;
}

function resolveComparisonRange(projectDir: string): string | null {
  if (hasCommitRef(projectDir, "main")) return "main...HEAD";
  if (hasCommitRef(projectDir, "origin/main")) return "origin/main...HEAD";
  return null;
}

function runRepositoryStatePreflight(projectDir: string): void {
  const repoCheck = runGit(projectDir, ["rev-parse", "--is-inside-work-tree"]);
  if (!repoCheck.ok) {
    if (repoCheck.reason === "missing-git") {
      throw new CLIError(
        "Git is not available on PATH.",
        "Install git and run 'sourcevision pr-markdown' again.",
      );
    }
    throw new CLIError(
      "NOT_A_REPO: This directory is not a git repository.",
      "Run this command in a git repository with a .sourcevision/ directory.",
    );
  }
  if (repoCheck.output !== "true") {
    throw new CLIError(
      "NOT_A_REPO: This directory is not a git repository.",
      "Run this command in a git repository with a .sourcevision/ directory.",
    );
  }

  const headRef = runGit(projectDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!headRef.ok) {
    if (headRef.reason === "missing-git") {
      throw new CLIError(
        "Git is not available on PATH.",
        "Install git and run 'sourcevision pr-markdown' again.",
      );
    }
    if (headRef.reason === "not-a-repo") {
      throw new CLIError(
        "NOT_A_REPO: This directory is not a git repository.",
        "Run this command in a git repository with a .sourcevision/ directory.",
      );
    }
    throw new CLIError("Git commands failed unexpectedly.", "Verify repository access and try again.");
  }

  if (headRef.output === "HEAD") {
    const sha = gitOutput(projectDir, ["rev-parse", "HEAD"]) ?? "unknown";
    throw new CLIError(
      `DETACHED_HEAD: HEAD is detached at commit ${sha}.`,
      "Check out a branch and run 'sourcevision pr-markdown' again.",
    );
  }
}

function parseNum(value: string): number {
  if (value === "-") return 0;
  const num = Number.parseInt(value, 10);
  return Number.isFinite(num) ? num : 0;
}

function parseNameStatusLine(line: string): { status: string; path: string } | null {
  const parts = line.split("\t");
  if (parts.length < 2) return null;

  const code = parts[0] ?? "";
  const status = code.charAt(0);
  if (!status) return null;

  if (status === "R" || status === "C") {
    const renamedPath = parts[2];
    if (!renamedPath) return null;
    return { status, path: renamedPath };
  }

  const path = parts[1];
  if (!path) return null;
  return { status, path };
}

function parseWorkingTreePath(rawPath: string): string {
  const renameIdx = rawPath.indexOf(" -> ");
  if (renameIdx >= 0) return rawPath.slice(renameIdx + 4);
  return rawPath;
}

function getWorkingTreeState(projectDir: string): WorkingTreeState | null {
  const status = gitOutput(projectDir, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status == null) return null;

  const unstagedModified = new Set<string>();
  const untracked = new Set<string>();

  if (status.length > 0) {
    for (const line of status.split("\n")) {
      if (!line || line.length < 3) continue;
      const indexStatus = line[0] ?? " ";
      const workTreeStatus = line[1] ?? " ";
      const rawPath = line.slice(3).trim();
      if (!rawPath) continue;
      const path = parseWorkingTreePath(rawPath);

      if (indexStatus === "?" && workTreeStatus === "?") {
        untracked.add(path);
        continue;
      }

      if (workTreeStatus !== " " && workTreeStatus !== "?") {
        unstagedModified.add(path);
      }
    }
  }

  return {
    unstagedModifiedFiles: [...unstagedModified].sort((a, b) => a.localeCompare(b)),
    untrackedFiles: [...untracked].sort((a, b) => a.localeCompare(b)),
  };
}

function getChangedFilesForRange(projectDir: string, range: string): GitChangedFile[] | null {
  const nameStatus = gitOutput(projectDir, ["--no-pager", "diff", "--no-ext-diff", "--no-textconv", "--name-status", range]);
  const numStat = gitOutput(projectDir, ["--no-pager", "diff", "--no-ext-diff", "--no-textconv", "--numstat", range]);
  if (nameStatus == null || numStat == null) return null;

  const statsByPath = new Map<string, { additions: number; deletions: number }>();
  if (numStat.length > 0) {
    for (const line of numStat.split("\n")) {
      if (!line) continue;
      const parts = line.split("\t");
      if (parts.length < 3) continue;
      const path = parts[parts.length - 1];
      if (!path) continue;
      statsByPath.set(path, {
        additions: parseNum(parts[0] ?? "0"),
        deletions: parseNum(parts[1] ?? "0"),
      });
    }
  }

  const files: GitChangedFile[] = [];
  if (nameStatus.length > 0) {
    for (const line of nameStatus.split("\n")) {
      if (!line) continue;
      const parsed = parseNameStatusLine(line);
      if (!parsed) continue;
      const stat = statsByPath.get(parsed.path) ?? { additions: 0, deletions: 0 };
      files.push({
        status: parsed.status,
        path: parsed.path,
        additions: stat.additions,
        deletions: stat.deletions,
      });
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

const JS_TS_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
function isCodeFile(path: string): boolean {
  return JS_TS_EXTENSIONS.has(extname(path).toLowerCase());
}

function normalizeForSignal(line: string): string {
  return line.replace(/\s+/g, "").replace(/[;,]+/g, "");
}

function toCountMap(items: readonly string[], mapper: (value: string) => string): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    const key = mapper(item);
    if (!key) continue;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

function mapsEqual(left: Map<string, number>, right: Map<string, number>): boolean {
  if (left.size !== right.size) return false;
  for (const [key, value] of left.entries()) {
    if (right.get(key) !== value) return false;
  }
  return true;
}

function hasMaterialHunkChange(hunk: DiffHunk): boolean {
  if (hunk.removed.length === 0 && hunk.added.length === 0) return false;
  const normalizedRemoved = toCountMap(hunk.removed, normalizeForSignal);
  const normalizedAdded = toCountMap(hunk.added, normalizeForSignal);
  if (mapsEqual(normalizedRemoved, normalizedAdded)) return false;
  return true;
}

function parseDiffPath(headerLine: string): string | null {
  const match = /^diff --git a\/(.+) b\/(.+)$/.exec(headerLine);
  if (!match) return null;
  const next = match[2];
  if (!next) return null;
  return next;
}

function getDiffDetailsForRange(projectDir: string, range: string): Map<string, GitDiffDetails> | null {
  const patch = gitOutput(projectDir, ["--no-pager", "diff", "--no-ext-diff", "--no-textconv", "--unified=0", "--no-color", range]);
  if (patch == null) return null;
  if (!patch) return new Map();

  const byPath = new Map<string, { addedLines: Set<number>; hasMaterialChanges: boolean }>();
  let currentPath: string | null = null;
  let activeHunk: DiffHunk | null = null;
  let newLine = 0;

  function flushActiveHunk(): void {
    if (!currentPath || !activeHunk) return;
    const existing = byPath.get(currentPath) ?? { addedLines: new Set<number>(), hasMaterialChanges: false };
    for (const lineNum of activeHunk.addedLines) existing.addedLines.add(lineNum);
    if (hasMaterialHunkChange(activeHunk)) existing.hasMaterialChanges = true;
    byPath.set(currentPath, existing);
    activeHunk = null;
  }

  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      flushActiveHunk();
      currentPath = parseDiffPath(line);
      continue;
    }
    if (!currentPath) continue;
    if (line.startsWith("@@ ")) {
      flushActiveHunk();
      const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (!match) continue;
      newLine = Number.parseInt(match[1] ?? "0", 10);
      activeHunk = { addedLines: new Set<number>(), removed: [], added: [] };
      continue;
    }
    if (!activeHunk) continue;
    if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    if (line.startsWith("+")) {
      activeHunk.added.push(line.slice(1));
      activeHunk.addedLines.add(newLine);
      newLine += 1;
      continue;
    }
    if (line.startsWith("-")) {
      activeHunk.removed.push(line.slice(1));
      continue;
    }
    if (line.startsWith(" ")) {
      newLine += 1;
    }
  }

  flushActiveHunk();
  return new Map(
    [...byPath.entries()].map(([path, detail]) => [
      path,
      {
        path,
        hasMaterialChanges: detail.hasMaterialChanges,
        addedLines: detail.addedLines,
      },
    ]),
  );
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const modifiers = ts.getModifiers(node);
  return modifiers?.some((m) => m.kind === kind) ?? false;
}

function getLineNumber(sourceFile: ts.SourceFile, pos: number): number {
  return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

function extractSourceFunctions(sourceText: string, filePath: string): SourceFunction[] {
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
  const functions: SourceFunction[] = [];

  function addFunction(name: string, node: ts.Node, exported: boolean): void {
    functions.push({
      name,
      startLine: getLineNumber(sourceFile, node.getStart(sourceFile)),
      endLine: getLineNumber(sourceFile, node.getEnd()),
      exported,
    });
  }

  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && node.name?.text) {
      addFunction(node.name.text, node, hasModifier(node, ts.SyntaxKind.ExportKeyword));
    } else if (ts.isVariableStatement(node) && hasModifier(node, ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of node.declarationList.declarations) {
        const name = ts.isIdentifier(declaration.name) ? declaration.name.text : null;
        if (!name || !declaration.initializer) continue;
        if (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)) {
          addFunction(name, declaration.initializer, true);
        }
      }
    } else if (ts.isExportAssignment(node) && ts.isFunctionExpression(node.expression)) {
      addFunction("default", node.expression, true);
    }
    node.forEachChild(visit);
  }

  sourceFile.forEachChild(visit);
  return functions;
}

function intersectsAddedLines(fn: SourceFunction, addedLines: Set<number>): boolean {
  for (const lineNo of addedLines) {
    if (lineNo >= fn.startLine && lineNo <= fn.endLine) return true;
  }
  return false;
}

function isLikelyRouteFile(path: string): boolean {
  if (path.includes("/routes/")) return true;
  const file = basename(path).toLowerCase();
  return file === "routes.ts" || file === "routes.tsx" || file.startsWith("route.");
}

function isLikelyComponentFile(path: string): boolean {
  if (path.includes("/components/")) return true;
  const file = basename(path);
  const ext = extname(file).toLowerCase();
  if (ext !== ".tsx" && ext !== ".jsx") return false;
  const stem = file.slice(0, file.length - ext.length);
  return stem.length > 0 && /^[A-Z]/.test(stem);
}

function pushHighlightIfNew(
  highlights: SignificantHighlight[],
  dedupeKey: Set<string>,
  key: string,
  value: SignificantHighlight,
): void {
  if (dedupeKey.has(key)) return;
  dedupeKey.add(key);
  highlights.push(value);
}

function extractSignificantHighlights(projectDir: string, files: readonly GitChangedFile[], diffDetails: Map<string, GitDiffDetails>): SignificantHighlight[] {
  const highlights: SignificantHighlight[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    if (!isCodeFile(file.path)) continue;
    const details = diffDetails.get(file.path);
    if (!details) continue;
    if (file.status === "R" && file.additions === 0 && file.deletions === 0) continue;
    if (!details.hasMaterialChanges && file.status !== "A") continue;

    const absPath = join(projectDir, file.path);
    if (!existsSync(absPath)) continue;
    const sourceText = readFileSync(absPath, "utf-8");
    const sourceFunctions = extractSourceFunctions(sourceText, file.path);
    const exportedTouched = sourceFunctions.filter((fn) => fn.exported && intersectsAddedLines(fn, details.addedLines));

    for (const fn of exportedTouched) {
      const added = details.addedLines.has(fn.startLine);
      const action = added ? "Added" : "Modified";
      pushHighlightIfNew(highlights, seen, `fn:${file.path}:${fn.name}`, {
        kind: "function",
        title: `${action} exported function \`${fn.name}\` in \`${file.path}\``,
        rationale: added
          ? "New exported API surface that callers can now depend on."
          : "Behavior changed in an exported API, so downstream callers may be affected.",
        score: added ? 6 : 5,
      });
    }

    if (isLikelyRouteFile(file.path)) {
      pushHighlightIfNew(highlights, seen, `route:${file.path}`, {
        kind: "route",
        title: `${file.status === "A" ? "Added" : "Updated"} route module \`${file.path}\``,
        rationale: "User-visible navigation or request handling likely changed in this route.",
        score: file.status === "A" ? 7 : 6,
      });
    }

    if (isLikelyComponentFile(file.path)) {
      pushHighlightIfNew(highlights, seen, `component:${file.path}`, {
        kind: "component",
        title: `${file.status === "A" ? "Added" : "Updated"} UI component \`${file.path}\``,
        rationale: "User-facing interface behavior or presentation likely changed.",
        score: file.status === "A" ? 6 : 5,
      });
    }
  }

  return highlights
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return a.title.localeCompare(b.title);
    })
    .slice(0, SIGNIFICANT_HIGHLIGHTS_LIMIT);
}

interface WorkstreamSummary {
  workstream: string;
  files: number;
  additions: number;
  deletions: number;
  addedFiles: number;
  renamedFiles: number;
  deletedFiles: number;
  modifiedFiles: number;
}

function getWorkstream(path: string): string {
  const parts = path.split("/");
  if (parts.length <= 1) return "(root)";

  const [head, second] = parts;
  if (head === "packages" && second) return `packages/${second}`;
  if (head === "apps" && second) return `apps/${second}`;
  if (head === "services" && second) return `services/${second}`;
  if (head === "docs" || head === "tests") return head;
  return head;
}

function computeWorkstreamSummaries(files: readonly GitChangedFile[]): WorkstreamSummary[] {
  const byWorkstream = new Map<string, WorkstreamSummary>();

  for (const file of files) {
    const workstream = getWorkstream(file.path);
    const existing = byWorkstream.get(workstream) ?? {
      workstream,
      files: 0,
      additions: 0,
      deletions: 0,
      addedFiles: 0,
      renamedFiles: 0,
      deletedFiles: 0,
      modifiedFiles: 0,
    };

    existing.files += 1;
    existing.additions += file.additions;
    existing.deletions += file.deletions;

    if (file.status === "A") existing.addedFiles += 1;
    else if (file.status === "R") existing.renamedFiles += 1;
    else if (file.status === "D") existing.deletedFiles += 1;
    else existing.modifiedFiles += 1;

    byWorkstream.set(workstream, existing);
  }

  return [...byWorkstream.values()].sort((a, b) => {
    const churnA = a.additions + a.deletions;
    const churnB = b.additions + b.deletions;
    if (churnA !== churnB) return churnB - churnA;
    if (a.files !== b.files) return b.files - a.files;
    return a.workstream.localeCompare(b.workstream);
  });
}

function formatWorkstreamMix(summary: WorkstreamSummary): string {
  const parts: string[] = [];
  if (summary.addedFiles > 0) parts.push(`${summary.addedFiles} added`);
  if (summary.modifiedFiles > 0) parts.push(`${summary.modifiedFiles} modified`);
  if (summary.renamedFiles > 0) parts.push(`${summary.renamedFiles} renamed`);
  if (summary.deletedFiles > 0) parts.push(`${summary.deletedFiles} deleted`);
  return parts.length === 0 ? "no status details" : parts.join(", ");
}

function renderWorkstreamNarrative(workstreams: readonly WorkstreamSummary[]): string[] {
  const strongest = [...workstreams]
    .sort((a, b) => {
      const signalA = a.files + a.addedFiles + a.renamedFiles;
      const signalB = b.files + b.addedFiles + b.renamedFiles;
      if (signalA !== signalB) return signalB - signalA;
      return a.workstream.localeCompare(b.workstream);
    })
    .slice(0, IMPORTANT_CHANGE_NARRATIVE_LIMIT);

  if (strongest.length === 0) return [];
  return strongest.map((summary) => `Workstream \`${summary.workstream}\` had concentrated activity (${formatWorkstreamMix(summary)}).`);
}

function renderRexBranchWorkNarrative(lines: string[], rexWork: ResolvedBranchScopedRexWork): void {
  lines.push("## Worked PRD Epics");
  lines.push("");
  if (rexWork.status === "empty") {
    lines.push(`- No completed branch-scoped Rex items found (${rexWork.signal}).`);
    return;
  }

  const groupedByEpic = new Map<string, typeof rexWork.completedItems>();
  for (const item of rexWork.completedItems) {
    const group = groupedByEpic.get(item.epicTitle) ?? [];
    group.push(item);
    groupedByEpic.set(item.epicTitle, group);
  }

  for (const epicTitle of rexWork.epicTitles) {
    const items = groupedByEpic.get(epicTitle) ?? [];
    lines.push(`### ${epicTitle}`);
    if (items.length === 0) {
      lines.push("- No completed or executed branch-scoped tasks.");
      lines.push("");
      continue;
    }
    for (const item of items) {
      const scope = item.featureTitle ? `feature: ${item.featureTitle}` : "feature: (none)";
      const state = item.executionState === "completed"
        ? "completed"
        : `executed (current status: ${item.status})`;
      lines.push(`- \`${item.title}\` [${scope}] [${state}]`);
    }
    lines.push("");
  }
}

function renderPRMarkdown(
  range: string,
  files: readonly GitChangedFile[],
  highlights: readonly SignificantHighlight[],
  rexWork: ResolvedBranchScopedRexWork,
  workingTree: WorkingTreeState | null,
): string {
  const workstreams = computeWorkstreamSummaries(files);
  const reviewerNarrative =
    highlights.length > 0
      ? highlights.map((highlight) => `${highlight.title}. ${highlight.rationale}`)
      : renderWorkstreamNarrative(workstreams);

  const lines: string[] = [];
  lines.push("## PR Overview");
  lines.push("");
  lines.push(`- Base comparison: \`${range}\``);
  lines.push(`- Diff footprint: ${files.length} file(s) changed across ${workstreams.length} workstream(s).`);
  lines.push("");
  renderRexBranchWorkNarrative(lines, rexWork);
  lines.push("");
  lines.push("## Important Changes");
  lines.push("");
  if (reviewerNarrative.length === 0) {
    lines.push("- No important functional or feature-level changes identified.");
  } else {
    for (const narrative of reviewerNarrative) {
      lines.push(`- ${narrative}`);
    }
  }

  lines.push("");
  lines.push("## Modified But Unstaged Files");
  lines.push("");

  const unstagedModified = workingTree?.unstagedModifiedFiles ?? [];
  if (unstagedModified.length === 0) {
    lines.push("- None.");
  } else {
    for (const path of unstagedModified) {
      lines.push(`- \`${path}\``);
    }
  }

  lines.push("");
  lines.push("## Untracked Files");
  lines.push("");

  const untracked = workingTree?.untrackedFiles ?? [];
  if (untracked.length === 0) {
    lines.push("- None.");
  } else {
    for (const path of untracked) {
      lines.push(`- \`${path}\``);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function cmdPrMarkdown(targetDir: string): void {
  const absDir = resolve(targetDir);
  requireSvDir(absDir);
  runRepositoryStatePreflight(absDir);

  const comparisonRange = resolveComparisonRange(absDir);
  if (!comparisonRange) {
    throw new CLIError(
      "Could not resolve a base branch (`main` or `origin/main`).",
      "Create/fetch one of those refs, then run 'sourcevision pr-markdown' again.",
    );
  }

  const changedFiles = getChangedFilesForRange(absDir, comparisonRange);
  if (!changedFiles) {
    throw new CLIError(
      `Failed to compute git diff for '${comparisonRange}'.`,
      "Ensure git history is accessible and try again.",
    );
  }

  const diffDetails = getDiffDetailsForRange(absDir, comparisonRange);
  if (!diffDetails) {
    throw new CLIError(
      `Failed to inspect semantic diff details for '${comparisonRange}'.`,
      "Ensure git history is accessible and try again.",
    );
  }

  const highlights = extractSignificantHighlights(absDir, changedFiles, diffDetails);
  const resolvedRexWork = resolveWorkedEpicTitlesForRange(absDir, comparisonRange);
  const workingTree = getWorkingTreeState(absDir);
  const markdown = renderPRMarkdown(comparisonRange, changedFiles, highlights, resolvedRexWork, workingTree);
  const outputPath = join(absDir, SV_DIR, OUTPUT_FILENAME);
  writeFileSync(outputPath, markdown, "utf-8");
  info(`PR markdown regenerated → ${outputPath}`);
}
