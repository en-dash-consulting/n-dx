#!/usr/bin/env node

/**
 * Obfuscated code policy gate.
 *
 * This intentionally does not fail on ordinary minification. It looks for
 * loader and transform patterns that make code behavior hard to inspect:
 * eval-packed payloads, generated _0x identifier clusters, string-array
 * dispatchers, encoded dynamic execution, and JSFuck-style encodings.
 */

import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CODE_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".tsx",
  ".html",
  ".css",
]);

const SOURCE_SKIP_DIRS = new Set([
  ".changeset",
  ".git",
  ".hench",
  ".next",
  ".rex",
  ".sourcevision",
  ".turbo",
  ".vite",
  "coverage",
  "dist",
  "node_modules",
]);

const DEPENDENCY_SKIP_DIRS = new Set([
  ".cache",
  ".github",
  ".git",
  "__tests__",
  "bench",
  "benchmark",
  "benchmarks",
  "coverage",
  "demo",
  "demos",
  "doc",
  "docs",
  "example",
  "examples",
  "fixture",
  "fixtures",
  "node_modules",
  "test",
  "tests",
]);

const DEFAULT_MAX_FINDINGS = 40;
const MIN_SCORE_TO_FAIL = 70;
const MAX_ANALYZED_BYTES = 5 * 1024 * 1024;

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    source: true,
    dependencies: true,
    json: false,
    maxFindings: DEFAULT_MAX_FINDINGS,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--source-only") {
      options.source = true;
      options.dependencies = false;
    } else if (arg === "--dependencies-only") {
      options.source = false;
      options.dependencies = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--root") {
      options.root = argv[++i] ?? options.root;
    } else if (arg.startsWith("--root=")) {
      options.root = arg.slice("--root=".length);
    } else if (arg === "--max-findings") {
      options.maxFindings = Number(argv[++i] ?? options.maxFindings);
    } else if (arg.startsWith("--max-findings=")) {
      options.maxFindings = Number(arg.slice("--max-findings=".length));
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(options.maxFindings) || options.maxFindings < 1) {
    options.maxFindings = DEFAULT_MAX_FINDINGS;
  }

  options.root = resolve(options.root);
  return options;
}

function usage() {
  return [
    "Usage: node scripts/check-obfuscated-code.mjs [options]",
    "",
    "Options:",
    "  --source-only          Scan repository source only",
    "  --dependencies-only    Scan installed node_modules packages only",
    "  --root <dir>           Project root to scan",
    "  --json                 Print JSON report",
    "  --max-findings <n>     Limit printed findings (default: 40)",
  ].join("\n");
}

function isCodeFile(filePath) {
  for (const ext of CODE_EXTENSIONS) {
    if (filePath.endsWith(ext)) return true;
  }
  return false;
}

function countMatches(text, pattern) {
  let count = 0;
  pattern.lastIndex = 0;
  while (pattern.exec(text)) count++;
  return count;
}

function uniqueMatches(text, pattern) {
  const values = new Set();
  pattern.lastIndex = 0;
  let match;
  while ((match = pattern.exec(text))) {
    values.add(match[0]);
  }
  return values.size;
}

function firstLineFor(text, pattern) {
  pattern.lastIndex = 0;
  const match = pattern.exec(text);
  if (!match) return undefined;
  let line = 1;
  for (let i = 0; i < match.index; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

function maxLineLength(text) {
  let max = 0;
  let current = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      if (current > max) max = current;
      current = 0;
    } else {
      current++;
    }
  }
  return Math.max(max, current);
}

function shannonEntropy(value) {
  if (!value) return 0;
  const counts = new Map();
  for (const char of value) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function countHighEntropyBase64Literals(text) {
  const pattern = /["'`]([A-Za-z0-9+/]{240,}={0,2})["'`]/g;
  let count = 0;
  let match;
  while ((match = pattern.exec(text))) {
    if (shannonEntropy(match[1]) >= 4.5) {
      count++;
    }
  }
  return count;
}

function hasNearbyEncodedDynamicExecution(text) {
  const pattern = /["'`]([A-Za-z0-9+/]{240,}={0,2})["'`]/g;
  let match;
  while ((match = pattern.exec(text))) {
    if (shannonEntropy(match[1]) < 4.5) continue;
    const start = Math.max(0, match.index - 800);
    const end = Math.min(text.length, match.index + match[0].length + 800);
    const window = text.slice(start, end);
    const decodesPayload = /\b(?:atob|btoa)\s*\(|\bBuffer\s*\.\s*from\s*\(|\bString\s*\.\s*fromCharCode\s*\(/.test(window);
    const executesPayload = /(?:^|[^\w$.])eval\s*\(|\bnew\s+Function\s*\(|(?:^|[^\w$.])Function\s*\(\s*["'`]/.test(window);
    if (decodesPayload && executesPayload) return true;
  }
  return false;
}

function countLongNumberArrays(text) {
  const pattern = /\[(?:\s*(?:0x[0-9a-fA-F]+|\d{1,3})\s*,){80,}\s*(?:0x[0-9a-fA-F]+|\d{1,3})\s*\]/g;
  return countMatches(text, pattern);
}

function hasNearbyNumericDynamicExecution(text) {
  const pattern = /\[(?:\s*(?:0x[0-9a-fA-F]+|\d{1,3})\s*,){80,}\s*(?:0x[0-9a-fA-F]+|\d{1,3})\s*\]/g;
  let match;
  while ((match = pattern.exec(text))) {
    const start = Math.max(0, match.index - 800);
    const end = Math.min(text.length, match.index + match[0].length + 800);
    const window = text.slice(start, end);
    const decodesPayload = /\bString\s*\.\s*fromCharCode\s*\(|\bTextDecoder\s*\(|\bUint8Array\s*\(/.test(window);
    const executesPayload = /(?:^|[^\w$.])eval\s*\(|\bnew\s+Function\s*\(/.test(window);
    if (decodesPayload && executesPayload) return true;
  }
  return false;
}

function addFinding(findings, score, code, detail, line) {
  findings.push({ score, code, detail, line });
}

export function analyzeText(text, filePath = "") {
  const sample = text.length > MAX_ANALYZED_BYTES
    ? text.slice(0, MAX_ANALYZED_BYTES)
    : text;
  const findings = [];

  const packedEvalPattern =
    /\beval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*(?:r|d)\s*\)/g;
  if (packedEvalPattern.test(sample)) {
    addFinding(
      findings,
      100,
      "eval-packed-payload",
      "eval-packed JavaScript payload detected",
      firstLineFor(sample, packedEvalPattern),
    );
  }

  const hexIdentifierTotal = countMatches(sample, /\b_0x[0-9a-fA-F]{3,}\b/g);
  const hexIdentifierUnique = uniqueMatches(sample, /\b_0x[0-9a-fA-F]{3,}\b/g);
  const directEval = /(?:^|[^\w$.])eval\s*\(/.test(sample);
  const dynamicFunction = /\bnew\s+Function\s*\(|(?:^|[^\w$.])Function\s*\(\s*["'`]/.test(sample);
  const dynamicEval = directEval || dynamicFunction || /\bset(?:Timeout|Interval)\s*\(\s*["'`]/.test(sample);
  const decodeCall = /\b(?:atob|btoa)\s*\(|\bBuffer\s*\.\s*from\s*\(|\bString\s*\.\s*fromCharCode\s*\(/.test(sample);
  const stringArrayDispatcher =
    /\b(?:const|let|var)\s+_0x[0-9a-fA-F]{3,}\s*=\s*\[\s*["'`]/.test(sample) ||
    /\bfunction\s+_0x[0-9a-fA-F]{3,}\s*\(\)\s*{\s*(?:const|let|var)\s+_0x[0-9a-fA-F]{3,}\s*=\s*\[\s*["'`]/.test(sample);
  const rotatedArray = /\bwhile\s*\(\s*!!\[\]\s*\)/.test(sample) || /\bshift\s*\(\s*\)\s*\)\s*;?\s*}/.test(sample);
  const parseIntDispatcher = /\bparseInt\s*\(\s*_0x[0-9a-fA-F]{3,}\s*\(/.test(sample);
  const splitDispatcher = /["'`][A-Za-z0-9_$| -]{40,}\|[A-Za-z0-9_$| -]{20,}["'`]\s*\.\s*split\s*\(\s*["'`]\|["'`]\s*\)/.test(sample);

  if (hexIdentifierUnique >= 8 && hexIdentifierTotal >= 30) {
    addFinding(
      findings,
      45,
      "generated-hex-identifiers",
      `${hexIdentifierTotal} generated _0x-style identifiers (${hexIdentifierUnique} unique)`,
      firstLineFor(sample, /\b_0x[0-9a-fA-F]{3,}\b/g),
    );
  }

  if (stringArrayDispatcher && hexIdentifierTotal >= 10) {
    addFinding(
      findings,
      45,
      "string-array-dispatcher",
      "generated string-array dispatcher detected",
      firstLineFor(sample, /\b(?:const|let|var|function)\s+_0x[0-9a-fA-F]{3,}/g),
    );
  }

  if (rotatedArray && hexIdentifierTotal >= 10) {
    addFinding(
      findings,
      35,
      "rotated-string-array",
      "rotating string-array decode loop detected",
      firstLineFor(sample, /\bwhile\s*\(\s*!!\[\]\s*\)/g),
    );
  }

  if (parseIntDispatcher && hexIdentifierTotal >= 10) {
    addFinding(
      findings,
      35,
      "parseint-dispatcher",
      "parseInt-based obfuscator dispatcher detected",
      firstLineFor(sample, /\bparseInt\s*\(\s*_0x[0-9a-fA-F]{3,}\s*\(/g),
    );
  }

  if (splitDispatcher && dynamicEval) {
    addFinding(
      findings,
      35,
      "split-token-dispatcher",
      "pipe-split token dispatcher combined with dynamic execution",
      firstLineFor(sample, /\.\s*split\s*\(\s*["'`]\|["'`]\s*\)/g),
    );
  }

  const base64LiteralCount = countHighEntropyBase64Literals(sample);
  if (base64LiteralCount > 0 && hasNearbyEncodedDynamicExecution(sample)) {
    addFinding(
      findings,
      90,
      "encoded-dynamic-execution",
      "high-entropy encoded payload is decoded and executed dynamically",
      firstLineFor(sample, /\b(?:eval|Function|new\s+Function)\s*\(/g),
    );
  }

  const hexEscapeCount = countMatches(sample, /\\x[0-9a-fA-F]{2}/g);
  const unicodeEscapeCount = countMatches(sample, /\\u[0-9a-fA-F]{4}/g);
  const escapeRatio = (hexEscapeCount + unicodeEscapeCount) / Math.max(sample.length, 1);
  if (
    (hexEscapeCount >= 120 || unicodeEscapeCount >= 120) &&
    escapeRatio > 0.01 &&
    (directEval || (hexIdentifierTotal >= 10 && (rotatedArray || parseIntDispatcher || dynamicFunction)))
  ) {
    addFinding(
      findings,
      75,
      "escape-encoded-loader",
      `${hexEscapeCount + unicodeEscapeCount} hex/unicode escapes in a dynamic loader shape`,
      firstLineFor(sample, /\\(?:x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4})/g),
    );
  }

  const jsfuckTokenCount = countMatches(sample, /(?:!\[\]|\+\[\]|\+\!\+|\[\]\[)/g);
  if (jsfuckTokenCount >= 80) {
    addFinding(
      findings,
      80,
      "jsfuck-style-encoding",
      `${jsfuckTokenCount} JSFuck-style tokens detected`,
      firstLineFor(sample, /(?:!\[\]|\+\[\]|\+\!\+|\[\]\[)/g),
    );
  }

  const longNumberArrays = countLongNumberArrays(sample);
  if (longNumberArrays > 0 && hasNearbyNumericDynamicExecution(sample)) {
    addFinding(
      findings,
      80,
      "numeric-payload-loader",
      "large numeric payload array decoded and executed dynamically",
      firstLineFor(sample, /\[(?:\s*(?:0x[0-9a-fA-F]+|\d{1,3})\s*,){80,}/g),
    );
  }

  const singleLineLength = maxLineLength(sample);
  if (singleLineLength >= 20000 && directEval && (decodeCall || hexIdentifierTotal >= 10 || hexEscapeCount >= 80)) {
    addFinding(
      findings,
      50,
      "suspicious-single-line-loader",
      `very long single-line loader (${singleLineLength} characters) with dynamic execution`,
      firstLineFor(sample, /\b(?:eval|Function|new\s+Function)\s*\(/g),
    );
  }

  const score = findings.reduce((sum, finding) => sum + finding.score, 0);
  return {
    filePath,
    score,
    failed: score >= MIN_SCORE_TO_FAIL,
    findings,
  };
}

function shouldReadAsText(filePath) {
  const buffer = readFileSync(filePath);
  if (buffer.includes(0)) return undefined;
  return buffer.toString("utf8");
}

function walkFiles(root, skipDirs, files = []) {
  if (!existsSync(root)) return files;

  for (const entry of readdirSync(root)) {
    if (skipDirs.has(entry)) continue;
    const fullPath = join(root, entry);
    const stat = lstatSync(fullPath);

    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      walkFiles(fullPath, skipDirs, files);
    } else if (stat.isFile() && isCodeFile(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

function scanFiles(root, files, scope, packageInfo) {
  const findings = [];
  let scannedFiles = 0;

  for (const file of files) {
    let text;
    try {
      const size = statSync(file).size;
      if (size === 0) continue;
      text = shouldReadAsText(file);
    } catch {
      continue;
    }

    if (text === undefined) continue;
    scannedFiles++;

    const rel = relative(root, file).replace(/\\/g, "/");
    const result = analyzeText(text, rel);
    if (!result.failed) continue;

    findings.push({
      scope,
      file: rel,
      score: result.score,
      packageName: packageInfo?.name,
      packageVersion: packageInfo?.version,
      reasons: result.findings,
    });
  }

  return { scannedFiles, findings };
}

function readPackageInfo(packageRoot) {
  try {
    const parsed = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    return {
      name: typeof parsed.name === "string" ? parsed.name : basename(packageRoot),
      version: typeof parsed.version === "string" ? parsed.version : "unknown",
    };
  } catch {
    return { name: basename(packageRoot), version: "unknown" };
  }
}

function addPackageRoot(packageRoots, seen, packageRoot) {
  const packageJson = join(packageRoot, "package.json");
  if (!existsSync(packageJson)) return;
  const realPath = realpathSync(packageRoot);
  if (seen.has(realPath)) return;
  seen.add(realPath);
  packageRoots.push(realPath);
}

function collectNodeModulePackages(nodeModulesDir, packageRoots, seen) {
  if (!existsSync(nodeModulesDir)) return;

  for (const entry of readdirSync(nodeModulesDir)) {
    if (entry === ".bin" || entry === ".pnpm" || entry.startsWith(".")) continue;
    const entryPath = join(nodeModulesDir, entry);
    let stat;
    try {
      stat = lstatSync(entryPath);
    } catch {
      continue;
    }

    if (entry.startsWith("@")) {
      if (!stat.isDirectory() && !stat.isSymbolicLink()) continue;
      for (const scopedEntry of readdirSync(entryPath)) {
        addPackageRoot(packageRoots, seen, join(entryPath, scopedEntry));
      }
      continue;
    }

    addPackageRoot(packageRoots, seen, entryPath);
  }
}

function collectPnpmPackages(root) {
  const packageRoots = [];
  const seen = new Set();
  const pnpmDir = join(root, "node_modules", ".pnpm");

  if (existsSync(pnpmDir)) {
    for (const storeEntry of readdirSync(pnpmDir)) {
      if (storeEntry === "node_modules" || storeEntry.startsWith(".")) continue;
      const nestedNodeModules = join(pnpmDir, storeEntry, "node_modules");
      collectNodeModulePackages(nestedNodeModules, packageRoots, seen);
    }
  }

  collectNodeModulePackages(join(root, "node_modules"), packageRoots, seen);
  packageRoots.sort();
  return packageRoots;
}

function scanSource(root) {
  const sourceFiles = walkFiles(root, SOURCE_SKIP_DIRS);
  return scanFiles(root, sourceFiles, "source");
}

function scanDependencies(root) {
  const dependencyRoot = join(root, "node_modules");
  if (!existsSync(dependencyRoot)) {
    return {
      scannedFiles: 0,
      scannedPackages: 0,
      skipped: true,
      findings: [],
    };
  }

  const packageRoots = collectPnpmPackages(root);
  const findings = [];
  let scannedFiles = 0;

  for (const packageRoot of packageRoots) {
    const packageInfo = readPackageInfo(packageRoot);
    const packageFiles = walkFiles(packageRoot, DEPENDENCY_SKIP_DIRS);
    const result = scanFiles(root, packageFiles, "dependency", packageInfo);
    scannedFiles += result.scannedFiles;
    findings.push(...result.findings);
  }

  return {
    scannedFiles,
    scannedPackages: packageRoots.length,
    skipped: false,
    findings,
  };
}

export function scanRoot(root, options = {}) {
  const normalizedRoot = resolve(root);
  const result = {
    root: normalizedRoot,
    ok: true,
    source: {
      scannedFiles: 0,
      findings: [],
    },
    dependencies: {
      scannedFiles: 0,
      scannedPackages: 0,
      skipped: false,
      findings: [],
    },
  };

  if (options.source !== false) {
    result.source = scanSource(normalizedRoot);
  }

  if (options.dependencies !== false) {
    result.dependencies = scanDependencies(normalizedRoot);
  }

  result.ok =
    result.source.findings.length === 0 &&
    result.dependencies.findings.length === 0;

  return result;
}

function formatReason(reason) {
  const line = reason.line ? `:${reason.line}` : "";
  return `    - ${reason.code}${line} (${reason.score}): ${reason.detail}`;
}

function formatFinding(finding) {
  const packageLabel = finding.packageName
    ? ` ${finding.packageName}@${finding.packageVersion}`
    : "";
  return [
    `  ${finding.file}${packageLabel} [score ${finding.score}]`,
    ...finding.reasons.map(formatReason),
  ].join("\n");
}

function printTextReport(report, maxFindings) {
  const sourceFindings = report.source.findings;
  const dependencyFindings = report.dependencies.findings;
  const allFindings = [...sourceFindings, ...dependencyFindings];

  if (report.ok) {
    console.log("Obfuscated code policy passed.");
    console.log(`  Source files scanned: ${report.source.scannedFiles}`);
    if (report.dependencies.skipped) {
      console.log("  Dependency scan skipped: node_modules is not installed.");
    } else {
      console.log(`  Dependency packages scanned: ${report.dependencies.scannedPackages}`);
      console.log(`  Dependency files scanned: ${report.dependencies.scannedFiles}`);
    }
    return;
  }

  console.error("Obfuscated code policy failed.");
  console.error(`  Source findings: ${sourceFindings.length}`);
  console.error(`  Dependency findings: ${dependencyFindings.length}`);

  for (const finding of allFindings.slice(0, maxFindings)) {
    console.error(formatFinding(finding));
  }

  if (allFindings.length > maxFindings) {
    console.error(`  ... ${allFindings.length - maxFindings} more finding(s) omitted`);
  }
}

const isMain = process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      process.exit(0);
    }

    const report = scanRoot(options.root, options);
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printTextReport(report, options.maxFindings);
    }
    process.exit(report.ok ? 0 : 1);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
