import { join } from "node:path";
import { access } from "node:fs/promises";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { resolveStore } from "../../store/index.js";
import { REX_DIR } from "./constants.js";
import { CLIError } from "../errors.js";
import { info, result } from "../output.js";
import {
  reasonFromDescription,
  DEFAULT_MODEL,
} from "../../analyze/index.js";
import type { Proposal } from "../../analyze/index.js";
import type { PRDItem } from "../../schema/index.js";

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
    lines.push(`  [epic] ${p.epic.title}`);
    for (const f of p.features) {
      lines.push(`    [feature] ${f.title}`);
      if (f.description) {
        lines.push(`      ${f.description}`);
      }
      for (const t of f.tasks) {
        const pri = t.priority ? ` [${t.priority}]` : "";
        lines.push(`      [task] ${t.title}${pri}`);
        if (t.acceptanceCriteria?.length) {
          for (const ac of t.acceptanceCriteria) {
            lines.push(`        - ${ac}`);
          }
        }
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

async function acceptProposals(
  dir: string,
  proposals: Proposal[],
  parentId?: string,
): Promise<number> {
  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);

  let addedCount = 0;

  for (const p of proposals) {
    // If scoped to a parent, skip creating the epic and attach features directly
    const epicId = parentId ?? randomUUID();

    if (!parentId) {
      const epicItem: PRDItem = {
        id: epicId,
        title: p.epic.title,
        level: "epic",
        status: "pending",
        source: "smart-add",
      };
      await store.addItem(epicItem);
      addedCount++;
    }

    for (const f of p.features) {
      const featureId = randomUUID();
      const featureItem: PRDItem = {
        id: featureId,
        title: f.title,
        level: "feature",
        status: "pending",
        source: "smart-add",
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
          source: "smart-add",
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
    event: "smart_add_accept",
    detail: `Added ${addedCount} items from smart add`,
  });

  return addedCount;
}

export async function cmdSmartAdd(
  dir: string,
  description: string,
  flags: Record<string, string>,
): Promise<void> {
  if (!(await hasRexDir(dir))) {
    throw new CLIError(
      `Rex directory not found in ${dir}`,
      "Run 'n-dx init' to set up the project, or 'rex init' if using rex standalone.",
    );
  }

  const accept = flags.accept === "true";
  const parentId = flags.parent;

  // Resolve model: --model flag → config.model → DEFAULT_MODEL
  let model: string | undefined = flags.model;
  if (!model) {
    try {
      const rexDir = join(dir, REX_DIR);
      const store = await resolveStore(rexDir);
      const config = await store.loadConfig();
      if (config.model) {
        model = config.model;
      }
    } catch {
      // Config unreadable — fall through to default
    }
  }

  // Load existing PRD for context
  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);
  const doc = await store.loadDocument();
  const existing = doc.items;

  // Validate parent if provided
  if (parentId) {
    const { findItem } = await import("../../core/tree.js");
    const parentEntry = findItem(existing, parentId);
    if (!parentEntry) {
      throw new CLIError(
        `Parent "${parentId}" not found.`,
        "Check the ID with 'rex status' and try again.",
      );
    }
  }

  if (flags.format !== "json") {
    info("Analyzing description with LLM...");
  }

  let proposals: Proposal[];
  try {
    proposals = await reasonFromDescription(description, existing, {
      model,
      dir,
      parentId,
    });
  } catch (err) {
    throw new CLIError(
      `LLM analysis failed: ${(err as Error).message}`,
      "Check your API key and network connection, then try again.",
    );
  }

  if (proposals.length === 0) {
    if (flags.format === "json") {
      result(JSON.stringify({ proposals: [], added: 0 }, null, 2));
    } else {
      result("LLM returned no proposals for the given description.");
    }
    return;
  }

  if (flags.format === "json" && !accept) {
    result(JSON.stringify({ proposals }, null, 2));
    return;
  }

  if (flags.format !== "json") {
    info("\nProposed structure:");
    info(formatProposals(proposals));
    info("");
  }

  if (accept) {
    const added = await acceptProposals(dir, proposals, parentId);
    if (flags.format === "json") {
      result(JSON.stringify({ proposals, added }, null, 2));
    } else {
      result(`Added ${added} items to PRD.`);
    }
  } else if (process.stdin.isTTY) {
    const answer = await promptUser("Accept these items into the PRD? (y/n) ");
    if (answer === "y" || answer === "yes") {
      const added = await acceptProposals(dir, proposals, parentId);
      result(`Added ${added} items to PRD.`);
    } else {
      info("Proposals discarded.");
    }
  } else {
    // Non-interactive without --accept: just show
    info("Run with --accept to add these items to the PRD.");
  }
}
