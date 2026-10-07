import { z } from "zod";
import {
  aggregateItemTokenUsage,
  readRunTokensFromHench,
  type ItemTokenTotals,
} from "../../core/item-token-rollup.js";
import {
  aggregateItemDurations,
  type ItemDurationTotals,
} from "../../core/item-duration-rollup.js";
import type { PRDStore } from "../../store/index.js";
import { textResult, type McpResult } from "./result.js";
import { defineTool } from "./tool.js";

/**
 * Roll up hench run token totals and work durations across every PRD item.
 *
 * Returns a combined `{ tokens, duration }` record for every item in the
 * tree, where `tokens` is the token-rollup triple (self/descendants/total
 * plus runCount) and `duration` is `{ totalMs, runningMs, isRunning }`.
 * Runs whose `itemId` is no longer in the PRD (archived, pruned, deleted)
 * are reported as `orphans`.
 *
 * Duration fields update on each call based on the wall clock; completed
 * subtrees return stable `totalMs` values.
 *
 * If `id` is provided, the response is narrowed to that single item.
 */
export async function handleGetTokenUsage(
  store: PRDStore,
  projectDir: string,
  args: { id?: string } = {},
): Promise<McpResult> {
  try {
    const doc = await store.loadDocument();
    const runs = await readRunTokensFromHench(projectDir);
    const { totals, orphans } = aggregateItemTokenUsage(doc.items, runs);
    const { durations } = aggregateItemDurations(doc.items);

    const emptyDuration: ItemDurationTotals = {
      totalMs: 0,
      runningMs: 0,
      isRunning: false,
    };

    if (args.id) {
      const t = totals.get(args.id);
      if (!t) {
        return textResult(
          `Item "${args.id}" not found. Use get_prd_status to see available items.`,
          true,
        );
      }
      const d = durations.get(args.id) ?? emptyDuration;
      return textResult(
        JSON.stringify(
          { id: args.id, tokens: t, duration: d },
          null,
          2,
        ),
      );
    }

    const items: Array<{
      id: string;
      tokens: ItemTokenTotals;
      duration: ItemDurationTotals;
    }> = [];
    for (const [id, t] of totals) {
      items.push({ id, tokens: t, duration: durations.get(id) ?? emptyDuration });
    }

    const orphanTotal = orphans.reduce(
      (acc, o) => ({
        input: acc.input + o.tokens.input,
        output: acc.output + o.tokens.output,
        cacheCreation: acc.cacheCreation + o.tokens.cacheCreation,
        cacheRead: acc.cacheRead + o.tokens.cacheRead,
        total: acc.total + o.tokens.total,
      }),
      { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 0 },
    );

    return textResult(
      JSON.stringify(
        {
          items,
          orphans: {
            count: orphans.length,
            totals: orphanTotal,
            runs: orphans,
          },
        },
        null,
        2,
      ),
    );
  } catch (err) {
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

export const getTokenUsageTool = defineTool({
  name: "get_token_usage",
  description: "Roll up hench run token usage and work duration across every PRD item. Returns `{ tokens, duration }` per item, where tokens is self+descendants+total counts and duration is { totalMs, runningMs, isRunning }. Completed subtrees report stable totalMs; running subtrees update on each call. Orphan runs (whose itemId is no longer in the PRD) are reported separately. Pass `id` to narrow to a single item.",
  schema: {
    id: z.string().optional().describe("Optional: only return rollup for this item"),
  },
  access: "read",
  run: (ws, args) => handleGetTokenUsage(ws.store, ws.projectDir, args),
});
