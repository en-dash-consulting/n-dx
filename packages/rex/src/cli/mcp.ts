import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { resolveStore, resolveRemoteStore, SyncEngine } from "../store/index.js";
import { SCHEMA_VERSION, LEVEL_HIERARCHY } from "../schema/index.js";
import { computeStats, findItem, deleteItem, cleanBlockedByRefs } from "../core/tree.js";
import { findNextTask, collectCompletedIds, explainSelection } from "../core/next-task.js";
import { validateTransition } from "../core/transitions.js";
import { computeTimestampUpdates } from "../core/timestamps.js";
import { findAutoCompletions } from "../core/parent-completion.js";
import { validateDAG } from "../core/dag.js";
import { cascadeParentReset } from "../core/cascade-reset.js";
import { validateMove, moveItem } from "../core/move.js";
import { validateMerge, previewMerge, mergeItems } from "../core/merge.js";
import { verify } from "../core/verify.js";
import { TOOL_VERSION } from "./commands/constants.js";
import type { PRDItem, ItemLevel, ItemStatus, Priority } from "../schema/index.js";
import type { PRDStore } from "../store/index.js";

const REX_DIR = ".rex";

/**
 * Create a configured Rex MCP server without connecting a transport.
 *
 * Returns the McpServer instance with all tools and resources registered.
 * The caller is responsible for connecting a transport (stdio, HTTP, etc.):
 *
 * ```ts
 * // Stdio (CLI usage)
 * const server = await createRexMcpServer(dir);
 * await server.connect(new StdioServerTransport());
 *
 * // HTTP (web server usage)
 * const server = await createRexMcpServer(dir);
 * const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
 * await server.connect(transport);
 * ```
 */
export async function createRexMcpServer(dir: string): Promise<McpServer> {
  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);

  const server = new McpServer({
    name: "rex",
    version: TOOL_VERSION,
  });

  // --- Tools ---

  server.tool("get_prd_status", "Get PRD title, overall stats, and per-epic stats", {}, async () => {
    try {
      const doc = await store.loadDocument();
      const overall = computeStats(doc.items);
      const epics = doc.items.map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        stats: item.children ? computeStats(item.children) : null,
      }));
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ title: doc.title, overall, epics }, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error loading PRD: ${(err as Error).message}. Run "rex init" first.`,
          },
        ],
        isError: true,
      };
    }
  });

  server.tool("get_next_task", "Get the next actionable task based on priority and dependencies, with explanation of why it was selected", {}, async () => {
    try {
      const doc = await store.loadDocument();
      const completedIds = collectCompletedIds(doc.items);
      const result = findNextTask(doc.items, completedIds);
      if (!result) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ next: null, message: "No actionable tasks remaining" }),
            },
          ],
        };
      }
      const explanation = explainSelection(doc.items, result, completedIds);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                item: result.item,
                parentChain: result.parents.map((p) => ({
                  id: p.id,
                  title: p.title,
                  level: p.level,
                })),
                explanation,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${(err as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  });

  server.tool(
    "update_task_status",
    "Update the status of a PRD item",
    {
      id: z.string().describe("Item ID"),
      status: z.enum(["pending", "in_progress", "completed", "deferred", "blocked", "deleted"]).describe("New status"),
      force: z.boolean().optional().describe("Force the transition even if it violates transition rules (e.g. completed → pending)"),
    },
    async ({ id, status, force }) => {
      try {
        const existing = await store.getItem(id);
        if (!existing) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Item "${id}" not found. Use get_prd_status to see available items.`,
              },
            ],
            isError: true,
          };
        }

        // Validate transition unless force is set
        if (!force) {
          const transition = validateTransition(existing.status, status as ItemStatus);
          if (!transition.allowed) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `${transition.message} Pass force: true to override.`,
                },
              ],
              isError: true,
            };
          }
        }

        // Handle deletion: remove item and children from tree
        if (status === "deleted") {
          const doc = await store.loadDocument();
          const deletedIds = deleteItem(doc.items, id);
          cleanBlockedByRefs(doc.items, new Set(deletedIds));
          await store.saveDocument(doc);

          await store.appendLog({
            timestamp: new Date().toISOString(),
            event: "item_deleted",
            itemId: id,
            detail: `Deleted ${existing.level}: ${existing.title} (${deletedIds.length} item(s) removed)`,
          });

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  id,
                  title: existing.title,
                  deleted: true,
                  removedCount: deletedIds.length,
                  removedIds: deletedIds,
                }),
              },
            ],
          };
        }

        const tsUpdates = computeTimestampUpdates(existing.status, status as ItemStatus, existing);
        await store.updateItem(id, { status: status as ItemStatus, ...tsUpdates });
        await store.appendLog({
          timestamp: new Date().toISOString(),
          event: "status_changed",
          itemId: id,
          detail: `${existing.status} → ${status}${force ? " (forced)" : ""}`,
        });

        // Auto-complete parent items when a child is completed or deferred
        const autoCompleted: Array<{ id: string; title: string; level: string }> = [];
        if (status === "completed" || status === "deferred") {
          const doc = await store.loadDocument();
          const { completedItems } = findAutoCompletions(doc.items, id);

          for (const item of completedItems) {
            const parentItem = await store.getItem(item.id);
            if (!parentItem) continue;

            const parentTsUpdates = computeTimestampUpdates(
              parentItem.status,
              "completed",
              parentItem,
            );
            await store.updateItem(item.id, {
              status: "completed" as ItemStatus,
              ...parentTsUpdates,
            });
            await store.appendLog({
              timestamp: new Date().toISOString(),
              event: "auto_completed",
              itemId: item.id,
              detail: `Auto-completed ${item.level}: ${item.title} (all children done)`,
            });
            autoCompleted.push(item);
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                id,
                title: existing.title,
                previousStatus: existing.status,
                newStatus: status,
                ...(autoCompleted.length > 0 ? { autoCompleted } : {}),
              }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "add_item",
    "Add a new item to the PRD",
    {
      title: z.string().describe("Item title"),
      level: z.enum(["epic", "feature", "task", "subtask"]).describe("Item level"),
      parentId: z.string().optional().describe("Parent item ID"),
      description: z.string().optional().describe("Item description"),
      priority: z.enum(["critical", "high", "medium", "low"]).optional().describe("Priority"),
      acceptanceCriteria: z.array(z.string()).optional().describe("Acceptance criteria"),
      tags: z.array(z.string()).optional().describe("Tags"),
      source: z.string().optional().describe("Source of this item"),
      blockedBy: z.array(z.string()).optional().describe("IDs of blocking items"),
    },
    async (args) => {
      try {
        const id = randomUUID();
        const item: PRDItem = {
          id,
          title: args.title,
          level: args.level as ItemLevel,
          status: "pending",
        };
        if (args.description) item.description = args.description;
        if (args.priority) item.priority = args.priority as Priority;
        if (args.acceptanceCriteria) item.acceptanceCriteria = args.acceptanceCriteria;
        if (args.tags) item.tags = args.tags;
        if (args.source) item.source = args.source;
        if (args.blockedBy) item.blockedBy = args.blockedBy;

        // Validate dependencies before persisting
        if (item.blockedBy && item.blockedBy.length > 0) {
          const doc = await store.loadDocument();
          const simItems = [...doc.items, item];
          const dagResult = validateDAG(simItems);
          if (!dagResult.valid) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Invalid dependencies: ${dagResult.errors.join("; ")}. Check IDs with get_prd_status.`,
                },
              ],
              isError: true,
            };
          }
        }

        await store.addItem(item, args.parentId);

        // Reset completed ancestors when adding under a completed parent
        const { resetItems } = await cascadeParentReset(store, args.parentId);

        await store.appendLog({
          timestamp: new Date().toISOString(),
          event: "item_added",
          itemId: id,
          detail: `Added ${args.level}: ${args.title}`,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ id, level: args.level, title: args.title, resetItems }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "move_item",
    "Move an item to a different parent in the PRD tree (reparent)",
    {
      id: z.string().describe("Item ID to move"),
      parentId: z.string().optional().describe("New parent ID (omit to move to root)"),
    },
    async ({ id, parentId }) => {
      try {
        const doc = await store.loadDocument();

        const validation = validateMove(doc.items, id, parentId);
        if (!validation.valid) {
          return {
            content: [
              {
                type: "text" as const,
                text: `${validation.error}${validation.suggestion ? ` ${validation.suggestion}` : ""}`,
              },
            ],
            isError: true,
          };
        }

        const result = moveItem(doc.items, id, parentId);
        await store.saveDocument(doc);

        const fromLabel = result.previousParentId ?? "root";
        const toLabel = result.newParentId ?? "root";
        await store.appendLog({
          timestamp: new Date().toISOString(),
          event: "item_moved",
          itemId: id,
          detail: `Moved ${result.item.level} "${result.item.title}" from ${fromLabel} to ${toLabel}`,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                id,
                title: result.item.title,
                level: result.item.level,
                previousParentId: result.previousParentId,
                newParentId: result.newParentId,
              }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "merge_items",
    "Consolidate multiple sibling items into one, combining descriptions, acceptance criteria, and tags",
    {
      sourceIds: z.array(z.string()).describe("IDs of items to merge (must be siblings at the same level)"),
      targetId: z.string().describe("ID of the item that survives (must be in sourceIds)"),
      preview: z.boolean().optional().describe("If true, return a preview without executing the merge"),
      title: z.string().optional().describe("New title for the merged item (default: keep target's title)"),
      description: z.string().optional().describe("New description (default: combine all descriptions)"),
    },
    async ({ sourceIds, targetId, preview, title, description }) => {
      try {
        const doc = await store.loadDocument();

        const validation = validateMerge(doc.items, sourceIds, targetId);
        if (!validation.valid) {
          return {
            content: [
              {
                type: "text" as const,
                text: `${validation.error}`,
              },
            ],
            isError: true,
          };
        }

        const options = {
          ...(title ? { title } : {}),
          ...(description !== undefined ? { description } : {}),
        };

        // Preview mode — return what would happen without modifying
        if (preview) {
          const previewResult = previewMerge(doc.items, sourceIds, targetId, options);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(previewResult, null, 2),
              },
            ],
          };
        }

        // Execute the merge
        const result = mergeItems(doc.items, sourceIds, targetId, options);
        await store.saveDocument(doc);

        // Log the merge
        const absorbedTitles = result.absorbedIds
          .map((id) => `"${id}"`)
          .join(", ");
        await store.appendLog({
          timestamp: new Date().toISOString(),
          event: "items_merged",
          itemId: targetId,
          detail: `Merged ${sourceIds.length} items into "${targetId}". Absorbed: ${absorbedTitles}. ${result.reparentedChildIds.length} children reparented, ${result.rewrittenDependencyCount} dependency references rewritten.`,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "get_item",
    "Get full details of a PRD item including parent chain",
    {
      id: z.string().describe("Item ID"),
    },
    async ({ id }) => {
      try {
        const doc = await store.loadDocument();
        const entry = findItem(doc.items, id);
        if (!entry) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Item "${id}" not found. Use get_prd_status to see available items.`,
              },
            ],
            isError: true,
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  item: entry.item,
                  parentChain: entry.parents.map((p) => ({
                    id: p.id,
                    title: p.title,
                    level: p.level,
                  })),
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "append_log",
    "Append a structured log entry to the execution log",
    {
      event: z.string().describe("Event name"),
      itemId: z.string().optional().describe("Related item ID"),
      detail: z.string().optional().describe("Event details"),
    },
    async (args) => {
      try {
        await store.appendLog({
          timestamp: new Date().toISOString(),
          event: args.event,
          itemId: args.itemId,
          detail: args.detail,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ logged: true, event: args.event }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "sync_with_remote",
    "Sync local PRD with a remote adapter (e.g. Notion)",
    {
      direction: z.enum(["push", "pull", "sync"]).optional().describe("Sync direction (default: sync)"),
      adapter: z.string().optional().describe("Adapter name (default: notion)"),
    },
    async ({ direction, adapter }) => {
      try {
        const syncDirection = direction ?? "sync";
        const adapterName = adapter ?? "notion";

        let remote;
        try {
          remote = await resolveRemoteStore(rexDir, adapterName);
        } catch {
          return {
            content: [
              {
                type: "text" as const,
                text: `Adapter "${adapterName}" is not configured. Run 'rex adapter add ${adapterName}' to configure it.`,
              },
            ],
            isError: true,
          };
        }

        const engine = new SyncEngine(store, remote);

        let report;
        switch (syncDirection) {
          case "push":
            report = await engine.push();
            break;
          case "pull":
            report = await engine.pull();
            break;
          default:
            report = await engine.sync();
            break;
        }

        await store.appendLog({
          timestamp: report.timestamp,
          event: "sync_completed",
          detail: `${syncDirection} sync with ${adapterName}: ${report.pushed.length} pushed, ${report.pulled.length} pulled, ${report.conflicts.length} conflicts`,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(report, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "get_recommendations",
    "Get SourceVision-based recommendations for PRD items (requires SourceVision)",
    {},
    async () => {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              available: false,
              message: "SourceVision integration not yet configured. Use 'rex recommend' CLI command.",
            }),
          },
        ],
      };
    },
  );

  server.tool(
    "verify_criteria",
    "Map acceptance criteria to test files and optionally run tests to verify them",
    {
      taskId: z.string().optional().describe("Task ID to verify (omit for all tasks)"),
      runTests: z.boolean().optional().describe("Whether to execute tests (default: true)"),
    },
    async ({ taskId, runTests }) => {
      try {
        const doc = await store.loadDocument();
        const config = await store.loadConfig();
        const result = await verify({
          projectDir: dir,
          items: doc.items,
          taskId,
          testCommand: config.test,
          runTests: runTests ?? true,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "get_capabilities",
    "Get Rex server capabilities and configuration",
    {},
    async () => {
      try {
        const config = await store.loadConfig();
        const caps = store.capabilities();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  schemaVersion: SCHEMA_VERSION,
                  toolVersion: TOOL_VERSION,
                  adapter: caps.adapter,
                  supportsTransactions: caps.supportsTransactions,
                  supportsWatch: caps.supportsWatch,
                  sourcevision: config.sourcevision ?? "disabled",
                  future: config.future ?? {},
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // --- Resources ---

  server.resource("prd", "rex://prd", async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(await store.loadDocument(), null, 2),
      },
    ],
  }));

  server.resource("workflow", "rex://workflow", async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "text/markdown",
        text: await store.loadWorkflow(),
      },
    ],
  }));

  server.resource("log", "rex://log", async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(await store.readLog(50), null, 2),
      },
    ],
  }));

  return server;
}

/**
 * Start the Rex MCP server over stdio (for `rex mcp <dir>` CLI command).
 *
 * This is the original entry point preserved for backward compatibility.
 * For HTTP or other transports, use {@link createRexMcpServer} instead.
 */
export async function startMcpServer(dir: string): Promise<void> {
  const server = await createRexMcpServer(dir);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
