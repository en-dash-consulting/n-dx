import { join, resolve } from "node:path";
import { access, writeFile, readFile, unlink } from "node:fs/promises";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { createStore } from "../../store/index.js";
import { REX_DIR } from "./constants.js";
import {
  scanTests,
  scanDocs,
  scanSourceVision,
  reconcile,
  buildProposals,
  deduplicateScanResults,
  reasonFromFiles,
  reasonFromScanResults,
  formatDiff,
} from "../../analyze/index.js";
import type { ScanResult, Proposal } from "../../analyze/index.js";
import type { PRDItem, PRDDocument } from "../../schema/index.js";

const PENDING_FILE = "pending-proposals.json";

async function hasRexDir(dir: string): Promise<boolean> {
  try {
    await access(join(dir, REX_DIR));
    return true;
  } catch {
    return false;
  }
}

function formatProposals(proposals: Proposal[]): string {
  const lines: string[] = [];
  for (const p of proposals) {
    lines.push(`[epic] ${p.epic.title} (from: ${p.epic.source})`);
    for (const f of p.features) {
      lines.push(`  [feature] ${f.title} (from: ${f.source})`);
      for (const t of f.tasks) {
        const pri = t.priority ? ` [${t.priority}]` : "";
        lines.push(`    [task] ${t.title}${pri} (from: ${t.sourceFile})`);
      }
    }
  }
  return lines.join("\n");
}

function promptUser(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function savePending(dir: string, proposals: Proposal[]): Promise<void> {
  const filePath = join(dir, REX_DIR, PENDING_FILE);
  await writeFile(filePath, JSON.stringify(proposals, null, 2));
}

async function loadPending(dir: string): Promise<Proposal[] | null> {
  const filePath = join(dir, REX_DIR, PENDING_FILE);
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as Proposal[];
  } catch {
    return null;
  }
}

async function clearPending(dir: string): Promise<void> {
  try {
    await unlink(join(dir, REX_DIR, PENDING_FILE));
  } catch {
    // Already gone
  }
}

async function acceptProposals(
  dir: string,
  proposals: Proposal[],
): Promise<void> {
  if (!(await hasRexDir(dir))) {
    console.error(
      `No .rex/ found in ${dir}. Run "rex init" first.`,
    );
    process.exit(1);
  }

  const rexDir = join(dir, REX_DIR);
  const store = createStore("file", rexDir);

  let addedCount = 0;

  for (const p of proposals) {
    const epicId = randomUUID();
    const epicItem: PRDItem = {
      id: epicId,
      title: p.epic.title,
      level: "epic",
      status: "pending",
      source: p.epic.source,
    };
    await store.addItem(epicItem);
    addedCount++;

    for (const f of p.features) {
      const featureId = randomUUID();
      const featureItem: PRDItem = {
        id: featureId,
        title: f.title,
        level: "feature",
        status: "pending",
        source: f.source,
        description: f.description,
      };
      await store.addItem(featureItem, epicId);
      addedCount++;

      for (const t of f.tasks) {
        const taskId = randomUUID();
        const taskItem: PRDItem = {
          id: taskId,
          title: t.title,
          level: "task",
          status: "pending",
          source: t.source,
          description: t.description,
          acceptanceCriteria: t.acceptanceCriteria,
          priority: t.priority as PRDItem["priority"],
          tags: t.tags,
        };
        await store.addItem(taskItem, featureId);
        addedCount++;
      }
    }
  }

  await store.appendLog({
    timestamp: new Date().toISOString(),
    event: "analyze_accept",
    detail: `Added ${addedCount} items from analysis`,
  });

  await clearPending(dir);
  console.log(`Added ${addedCount} items to PRD.`);
}

export async function cmdAnalyze(
  dir: string,
  flags: Record<string, string>,
  multiFlags: Record<string, string[]> = {},
): Promise<void> {
  const lite = flags.lite === "true";
  const accept = flags.accept === "true";
  const noLlm = flags["no-llm"] === "true";
  // Support multiple --file flags; fall back to single flags.file for compat
  const filePaths: string[] = multiFlags.file ?? (flags.file ? [flags.file] : []);

  // --accept with no other flags: replay cached proposals
  if (accept && filePaths.length === 0 && !flags.format) {
    const cached = await loadPending(dir);
    if (cached && cached.length > 0) {
      console.log(`Accepting ${cached.length} cached proposals...`);
      await acceptProposals(dir, cached);
      return;
    }
    // No cache — fall through to generate fresh proposals
  }

  // Load existing PRD items for deduplication
  let existing: PRDItem[] = [];
  if (await hasRexDir(dir)) {
    try {
      const rexDir = join(dir, REX_DIR);
      const store = createStore("file", rexDir);
      const doc = await store.loadDocument();
      existing = doc.items;
    } catch {
      // No valid PRD yet, treat as empty
    }
  }

  let proposals: Proposal[];

  if (filePaths.length > 0) {
    // --file mode: import from document(s) via structured parsing or LLM
    const resolved = filePaths.map((fp) => resolve(dir, fp));

    if (flags.format !== "json") {
      const label = resolved.length === 1 ? "file" : "files";
      console.log(`Importing from ${label}: ${resolved.join(", ")}`);
    }

    try {
      proposals = await reasonFromFiles(resolved, existing);
    } catch (err) {
      console.error(`Failed to analyze file: ${(err as Error).message}`);
      process.exit(1);
    }

    if (flags.format === "json") {
      console.log(JSON.stringify({ proposals }, null, 2));
      return;
    }

    const fileLabel = resolved.length === 1 ? "file" : `${resolved.length} files`;
    console.log(`Extracted ${proposals.length} epics from ${fileLabel}.`);
  } else {
    // Scanner mode: run all three scanners
    const opts = { lite };
    const [testResults, docResults, svResults] = await Promise.all([
      scanTests(dir, opts),
      scanDocs(dir, opts),
      scanSourceVision(dir),
    ]);

    const rawResults: ScanResult[] = [...testResults, ...docResults, ...svResults];

    // Merge near-duplicate scan results before reconciliation
    const allResults = deduplicateScanResults(rawResults);

    const testFiles = new Set(testResults.map((r) => r.sourceFile)).size;
    const docFiles = new Set(docResults.map((r) => r.sourceFile)).size;
    const svZones = svResults.filter((r) => r.kind === "feature" && r.source === "sourcevision").length;

    const { results: newResults, stats } = reconcile(allResults, existing);

    if (!noLlm) {
      try {
        proposals = await reasonFromScanResults(newResults, existing, { dir });
        if (flags.format !== "json") {
          console.log("Proposals refined by LLM.");
        }
      } catch {
        proposals = buildProposals(newResults);
      }
    } else {
      proposals = buildProposals(newResults);
    }

    if (flags.format === "json") {
      console.log(
        JSON.stringify(
          { scanned: { testFiles, docFiles, svZones }, stats, proposals },
          null,
          2,
        ),
      );
      return;
    }

    console.log(
      `Scanned: ${testFiles} test files, ${docFiles} docs, ${svZones} sourcevision zones`,
    );
    console.log(
      `Found: ${stats.total} proposals (${stats.newCount} new, ${stats.alreadyTracked} already tracked)`,
    );
    console.log("");
  }

  if (proposals.length === 0) {
    console.log("No new proposals found.");
    return;
  }

  // Show diff view when existing PRD items are present, otherwise plain list
  if (existing.length > 0) {
    console.log(formatDiff(proposals, existing));
  } else {
    console.log(formatProposals(proposals));
  }
  console.log("");

  // Cache proposals so they can be accepted later without re-running
  if (await hasRexDir(dir)) {
    await savePending(dir, proposals);
  }

  if (accept) {
    // Non-interactive: accept immediately
    await acceptProposals(dir, proposals);
  } else if (process.stdin.isTTY) {
    // Interactive: prompt the user
    const answer = await promptUser("Accept these proposals into the PRD? (y/n) ");
    if (answer === "y" || answer === "yes") {
      await acceptProposals(dir, proposals);
    } else {
      console.log("Proposals saved. Run `rex analyze --accept` to accept later.");
    }
  } else {
    // Non-interactive without --accept: just show
    console.log("Proposals saved. Run `rex analyze --accept` to accept later.");
  }
}
