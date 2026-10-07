import { z } from "zod";
import { detectReorganizations } from "../../core/reorganize.js";
import { applyProposals } from "../../core/reorganize-executor.js";
import { resolveRexPaths } from "../../store/index.js";
import { parseIntList } from "../parse-utils.js";
import type { PRDStore } from "../../store/index.js";
import { textResult, type McpResult } from "./result.js";
import { defineTool } from "./tool.js";

export async function handleReorganize(
  store: PRDStore,
  dir: string,
  args: { accept?: string; includeCompleted?: boolean; mode?: string },
): Promise<McpResult> {
  try {
    const doc = await store.loadDocument();
    if (doc.items.length === 0) {
      return textResult(JSON.stringify({ structural: { proposals: [], stats: {} }, llm: [] }, null, 2));
    }

    const plan = detectReorganizations(doc.items, {
      includeCompleted: args.includeCompleted ?? false,
    });

    // LLM proposals (unless mode=fast). The analyze and reason modules pull in
    // the LLM client, so they stay behind a dynamic import: `mode: "fast"` and
    // every other tool must not pay for loading them.
    let llmProposals: Array<{ id: string; action: string; reason: string }> = [];
    if (args.mode !== "fast") {
      try {
        const { reasonForReshape } = await import("../../analyze/reshape-reason.js");
        const { setLLMConfig, setClaudeConfig, setProjectDir } = await import("../../analyze/reason.js");
        const { loadLLMConfig, loadClaudeConfig } = await import("../../store/project-config.js");

        const rexDir = resolveRexPaths(dir).rexDir;
        const llmConfig = await loadLLMConfig(rexDir);
        setLLMConfig(llmConfig);
        const claudeConfig = await loadClaudeConfig(rexDir);
        setClaudeConfig(claudeConfig);
        setProjectDir(dir);

        const { proposals } = await reasonForReshape(doc.items, { dir });
        llmProposals = proposals.map((p) => ({
          id: p.id,
          action: p.action.action,
          reason: p.action.reason,
        }));
      } catch {
        // LLM unavailable — continue with structural only
      }
    }

    if (!args.accept) {
      // Detection only
      return textResult(JSON.stringify({
        structural: {
          proposals: plan.proposals.map((p) => ({
            id: p.id,
            type: p.type,
            description: p.description,
            risk: p.risk,
            confidence: p.confidence,
            items: p.items,
          })),
          stats: plan.stats,
        },
        llm: llmProposals,
      }, null, 2));
    }

    // Apply proposals
    let toApply = plan.proposals;
    if (args.accept === "low-risk") {
      toApply = plan.proposals.filter((p) => p.risk === "low");
    } else if (args.accept !== "all") {
      // Parse comma-separated IDs
      const ids = new Set(parseIntList(args.accept));
      toApply = plan.proposals.filter((p) => ids.has(p.id));
    }

    let applied = 0;
    let failed = 0;

    if (toApply.length > 0) {
      // Proposals were computed on a snapshot (the LLM call above may take
      // minutes); re-apply them against a freshly loaded document under the
      // lock so a concurrent writer's item is not clobbered by the save.
      const result = await store.withTransaction(async (freshDoc) =>
        applyProposals(freshDoc.items, toApply),
      );
      applied = result.applied;
      failed = result.failed;
    }

    if (applied > 0) {
      await store.appendLog({
        timestamp: new Date().toISOString(),
        event: "reorganize_applied",
        detail: `Applied ${applied} reorganization proposals via MCP`,
      });
    }

    return textResult(JSON.stringify({ applied, failed, llm: llmProposals }, null, 2));
  } catch (err) {
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

export const reorganizeTool = defineTool({
  name: "reorganize",
  description: "Detect structural issues in the PRD and propose reorganizations (merge, move, delete, prune, collapse, split). Runs both programmatic detectors and LLM analysis by default.",
  schema: {
    accept: z.string().optional().describe("Apply proposals: 'low-risk' (default when set), 'all', or comma-separated IDs like '1,3'"),
    includeCompleted: z.boolean().optional().describe("Include completed items in similarity analysis (default: false)"),
    mode: z.enum(["fast", "full"]).optional().describe("Analysis mode: 'fast' (programmatic only) or 'full' (programmatic + LLM, default)"),
  },
  // Detection alone writes nothing; only `accept` applies proposals.
  access: (args) => (args.accept ? "write" : "read"),
  run: (ws, args) => handleReorganize(ws.store, ws.projectDir, args),
});
