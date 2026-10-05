/**
 * MCP (Model Context Protocol) server for Sourcevision.
 * Exposes codebase analysis data via MCP protocol (stdio or HTTP).
 */

import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { McpServer, type ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RootsListChangedNotificationSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z, type ZodRawShape } from "zod";
import type {
  Manifest,
  Inventory,
  Imports,
  Classifications,
  Zones,
  Components,
} from "./sourcevision-core.js";
import {
  DATA_FILES,
  generateContext,
  deriveNextSteps,
  setArchetypeOverride,
  TOOL_VERSION,
} from "./sourcevision-core.js";
import { findZoneById } from "../analyzers/zone-identity.js";
import { resolveSourcevisionPaths } from "../paths.js";
import { WorkspaceBinding, type BoundWorkspace } from "./mcp-workspace.js";

interface SourcevisionData {
  manifest: Manifest | null;
  inventory: Inventory | null;
  imports: Imports | null;
  classifications: Classifications | null;
  zones: Zones | null;
  components: Components | null;
}

function loadData(targetDir: string): SourcevisionData {
  const svDir = resolveSourcevisionPaths(targetDir).svDir;
  const data: SourcevisionData = {
    manifest: null,
    inventory: null,
    imports: null,
    classifications: null,
    zones: null,
    components: null,
  };

  const modules: Array<{ key: keyof SourcevisionData; file: string }> = [
    { key: "manifest", file: DATA_FILES.manifest },
    { key: "inventory", file: DATA_FILES.inventory },
    { key: "imports", file: DATA_FILES.imports },
    { key: "classifications", file: DATA_FILES.classifications },
    { key: "zones", file: DATA_FILES.zones },
    { key: "components", file: DATA_FILES.components },
  ];

  for (const mod of modules) {
    const filePath = join(svDir, mod.file);
    if (existsSync(filePath)) {
      try {
        (data as unknown as Record<string, unknown>)[mod.key] = JSON.parse(
          readFileSync(filePath, "utf-8")
        );
      } catch {
        // Skip unparseable files
      }
    }
  }

  return data;
}

/**
 * Create a configured Sourcevision MCP server without connecting a transport.
 *
 * Returns the McpServer instance with all tools and resources registered.
 * The caller is responsible for connecting a transport (stdio, HTTP, etc.):
 *
 * ```ts
 * // Stdio (CLI usage)
 * const server = await createSourcevisionMcpServer(dir);
 * await server.connect(new StdioServerTransport());
 *
 * // HTTP (web server usage)
 * const server = await createSourcevisionMcpServer(dir);
 * const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
 * await server.connect(transport);
 * ```
 */
/** Return manifest.json mtime (ms), or 0 on error. */
function manifestMtime(svDir: string): number {
  try {
    return statSync(join(svDir, DATA_FILES.manifest)).mtimeMs;
  } catch {
    return 0;
  }
}

export interface CreateSourcevisionMcpServerOptions {
  /**
   * Follow the client's MCP roots (#499). Only the stdio entry point sets it,
   * and it takes effect only when `targetDir` is the process cwd — the
   * implicit `.` of a tracked `.mcp.json`. An explicit directory, and the
   * web/hub factory, keep the dir they were given.
   */
  resolveWorkspaceFromClientRoots?: boolean;
}

export function createSourcevisionMcpServer(
  targetDir: string,
  options: CreateSourcevisionMcpServerOptions = {},
): McpServer {
  const startup = openWorkspace(targetDir);
  const followRoots = options.resolveWorkspaceFromClientRoots === true && startup.absDir === resolve(process.cwd());
  const binding = followRoots ? WorkspaceBinding.tracking(startup, openWorkspace) : WorkspaceBinding.fixed(startup);
  const context = createMcpContext(binding);
  const server = new McpServer({ name: "sourcevision", version: TOOL_VERSION });

  if (followRoots) {
    const protocol = server.server;
    const resolveFromRoots = () =>
      binding.resolve(async (timeout) => (await protocol.listRoots(undefined, { timeout })).roots);
    // Roots exist only once the client has initialized.
    protocol.oninitialized = () => {
      if (protocol.getClientCapabilities()?.roots) void resolveFromRoots();
      else binding.settleWithoutRoots();
    };
    protocol.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
      await resolveFromRoots();
    });
  }

  registerMcpTools(server, context);
  registerMcpResources(server, context);
  return server;
}

/** One served directory and its data cache. */
interface Workspace extends BoundWorkspace {
  freshData: () => SourcevisionData;
  invalidateCache: () => void;
}

function openWorkspace(targetDir: string): Workspace {
  const absDir = resolve(targetDir);
  const svDir = resolveSourcevisionPaths(absDir).svDir;
  let cachedData = loadData(absDir);
  let cachedMtime = manifestMtime(svDir);

  return {
    absDir,
    freshData: () => {
      const mtime = manifestMtime(svDir);
      if (mtime !== cachedMtime) {
        cachedData = loadData(absDir);
        cachedMtime = mtime;
      }
      return cachedData;
    },
    invalidateCache: () => {
      cachedMtime = 0;
    },
  };
}

/**
 * What handlers see. They read the workspace current at call time, after
 * {@link McpContext.serve} has waited (bounded) for any roots resolution.
 */
interface McpContext {
  readonly absDir: string;
  /** Set while the client's root cannot be served: writes must be refused. */
  readonly refused: string | undefined;
  freshData: () => SourcevisionData;
  invalidateCache: () => void;
  /** Run a handler once the workspace has settled. */
  serve: <R>(handler: () => R | Promise<R>) => Promise<R>;
}

function createMcpContext(binding: WorkspaceBinding<Workspace>): McpContext {
  return {
    get absDir() { return binding.current.absDir; },
    get refused() { return binding.current.refused; },
    freshData: () => binding.current.freshData(),
    invalidateCache: () => binding.current.invalidateCache(),
    serve: async (handler) => {
      await binding.ready();
      return handler();
    },
  };
}

/**
 * Register a tool whose handler runs after the workspace has settled. While
 * the client's root is refused, results carry the reason as an extra text
 * block, since the data answered is the startup dir's.
 */
function registerTool<S extends ZodRawShape>(
  server: McpServer,
  context: McpContext,
  name: string,
  description: string,
  schema: S,
  handler: ToolCallback<S>,
): void {
  const run = handler as (...args: unknown[]) => CallToolResult | Promise<CallToolResult>;
  server.tool(name, description, schema, (async (...args: unknown[]) => {
    const result = await context.serve(() => run(...args));
    const refused = context.refused;
    return refused && !result.isError
      ? { ...result, content: [...result.content, { type: "text" as const, text: `Warning: ${refused}` }] }
      : result;
  }) as ToolCallback<S>);
}

// ── Tool registration groups ─────────────────────────────────────────
// Each function registers a cohesive group of related MCP tools.

function registerOverviewTools(server: McpServer, context: McpContext): void {
  registerTool(server, context, "get_overview","Get project summary statistics. Good starting point when the user asks about the project or its architecture.", {}, () => {
    const data = context.freshData();
    if (!data.manifest || !data.inventory) {
      return { content: [{ type: "text", text: "No analysis data available. Run 'sourcevision analyze' first." }] };
    }

    const summary = {
      project: data.manifest.targetPath.split("/").pop(),
      git: [data.manifest.gitBranch, data.manifest.gitSha?.slice(0, 7)].filter(Boolean).join(" @ ") || null,
      files: data.inventory.summary.totalFiles,
      lines: data.inventory.summary.totalLines,
      languages: data.inventory.summary.byLanguage,
      importEdges: data.imports?.summary.totalEdges ?? 0,
      externalPackages: data.imports?.summary.totalExternal ?? 0,
      circulars: data.imports?.summary.circularCount ?? 0,
      zones: data.zones?.zones.length ?? 0,
      classifications: data.classifications ? data.classifications.summary : null,
      components: data.components?.summary.totalComponents ?? 0,
      routeModules: data.components?.summary.totalRouteModules ?? 0,
      serverRoutes: data.components?.summary.totalServerRoutes ?? 0,
    };

    return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
  });

  registerTool(
    server,
    context,
    "get_next_steps",
    "Get prioritized list of what to work on next based on analysis findings. Use when planning work or looking for improvement opportunities.",
    {
      priority: z.string().optional().describe("Filter by priority: high, medium, low"),
      limit: z.number().optional().describe("Max results (default 10)"),
    },
    ({ priority, limit }) => {
      const data = context.freshData();
      if (!data.zones) {
        return { content: [{ type: "text", text: "No zones data available." }] };
      }

      let steps = deriveNextSteps(data.zones);

      if (priority) {
        steps = steps.filter((s) => s.priority === priority);
      }

      const maxResults = limit ?? 10;
      steps = steps.slice(0, maxResults);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ steps, total: steps.length }, null, 2),
        }],
      };
    }
  );
}

/**
 * Shape the `sourcevision://zones` resource for a tool result.
 *
 * The resource used to return the whole of zones.json pretty-printed —
 * measured at roughly 80K tokens on a large project, in a single result. Two
 * things drove that: the indentation, which is billed like any other
 * character, and every zone's complete file list, which is per-zone detail
 * rather than the cross-zone picture this resource exists to give.
 *
 * So the resource now carries the map — zone identity, metrics, size, entry
 * points, crossings — and names `get_zone` for the detail it drops. A consumer
 * that wants one zone's files can ask for that zone instead of paying for
 * every zone's files to find it.
 */
export function summarizeZonesResource(zones: Zones | null | undefined): {
  zones: Array<{
    id: string;
    name: string;
    description: string;
    fileCount: number;
    cohesion: number;
    coupling: number;
    entryPoints: string[];
  }>;
  crossings: Zones["crossings"];
  unzonedCount: number;
  insights?: string[];
  note: string;
} {
  const source = zones ?? { zones: [], crossings: [], unzoned: [] };
  return {
    zones: (source.zones ?? []).map((zone) => ({
      id: zone.id,
      name: zone.name,
      description: zone.description,
      fileCount: zone.files?.length ?? 0,
      cohesion: zone.cohesion,
      coupling: zone.coupling,
      // Entry points are kept: they are how a reader gets into a zone, and
      // there are a handful per zone rather than hundreds.
      entryPoints: zone.entryPoints ?? [],
    })),
    crossings: source.crossings ?? [],
    unzonedCount: source.unzoned?.length ?? 0,
    insights: source.insights,
    note:
      "Zone file lists and per-zone findings are omitted here to keep this " +
      "result small. Call the get_zone tool with a zone id for a zone's files, " +
      "insights, and findings.",
  };
}

function registerZoneTools(server: McpServer, context: McpContext): void {
  registerTool(
    server,
    context,
    "get_zone",
    "Get details for a specific zone. Use to understand architectural context before making changes to files in a zone.",
    { id: z.string().describe("Zone ID") },
    ({ id }) => {
      const data = context.freshData();
      if (!data.zones) {
        return { content: [{ type: "text", text: "No zones data available." }] };
      }

      // A zone renamed from a numbered id still answers to the old one.
      const zone = findZoneById(data.zones.zones, id);
      if (!zone) {
        const available = data.zones.zones.map((z) => z.id).join(", ");
        return { content: [{ type: "text", text: `Zone "${id}" not found. Available: ${available}` }] };
      }

      const findings = (data.zones.findings ?? []).filter((f) => f.scope === zone.id);
      const crossings = data.zones.crossings.filter(
        (c) => c.fromZone === zone.id || c.toZone === zone.id
      );

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ ...zone, findings, crossings }, null, 2),
        }],
      };
    }
  );

  registerTool(
    server,
    context,
    "get_findings",
    "Get analysis findings (anti-patterns, suggestions, observations). Check before modifying code in an area to see known issues.",
    {
      type: z.string().optional().describe("Filter by type: observation, pattern, relationship, anti-pattern, suggestion"),
      severity: z.string().optional().describe("Filter by severity: info, warning, critical"),
    },
    ({ type, severity }) => {
      const data = context.freshData();
      let findings = data.zones?.findings ?? [];

      if (type) {
        findings = findings.filter((f) => f.type === type);
      }
      if (severity) {
        findings = findings.filter((f) => f.severity === severity);
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ findings, total: findings.length }, null, 2),
        }],
      };
    }
  );
}

function registerFileTools(server: McpServer, context: McpContext): void {
  registerTool(
    server,
    context,
    "get_file_info",
    "Get inventory entry, zone, and imports for a file. Use before modifying a file to understand its role and dependencies.",
    { path: z.string().describe("File path (relative to project root)") },
    ({ path }) => {
      const data = context.freshData();
      const file = data.inventory?.files.find((f) => f.path === path);
      if (!file) {
        return { content: [{ type: "text", text: `File "${path}" not found in inventory.` }] };
      }

      const zone = data.zones?.zones.find((z) => z.files.includes(path));
      const classification = data.classifications?.files.find((c) => c.path === path);
      const importsFrom = data.imports?.edges.filter((e) => e.from === path) ?? [];
      const importedBy = data.imports?.edges.filter((e) => e.to === path) ?? [];
      const component = data.components?.components.find((c) => c.file === path);
      const routeModule = data.components?.routeModules.find((m) => m.file === path);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            file,
            archetype: classification?.archetype ?? null,
            zone: zone ? { id: zone.id, name: zone.name } : null,
            importsFrom,
            importedBy,
            component: component ?? null,
            routeModule: routeModule ?? null,
          }, null, 2),
        }],
      };
    }
  );

  registerTool(
    server,
    context,
    "search_files",
    "Search the file inventory by path, role, or language. Use to find files related to a feature or module.",
    {
      query: z.string().describe("Search string to match against file paths"),
      role: z.string().optional().describe("Filter by role: source, test, config, docs, etc."),
      language: z.string().optional().describe("Filter by language"),
    },
    ({ query, role, language }) => {
      const data = context.freshData();
      if (!data.inventory) {
        return { content: [{ type: "text", text: "No inventory data available." }] };
      }

      let files = data.inventory.files;
      if (query) {
        const q = query.toLowerCase();
        files = files.filter((f) => f.path.toLowerCase().includes(q));
      }
      if (role) {
        files = files.filter((f) => f.role === role);
      }
      if (language) {
        const lang = language.toLowerCase();
        files = files.filter((f) => f.language.toLowerCase() === lang);
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            files: files.slice(0, 50),
            total: files.length,
          }, null, 2),
        }],
      };
    }
  );

  registerTool(
    server,
    context,
    "get_imports",
    "Get import graph edges, optionally filtered to a specific file. Use to trace dependencies and understand coupling between modules.",
    { file: z.string().optional().describe("Filter to imports from/to this file") },
    ({ file }) => {
      const data = context.freshData();
      if (!data.imports) {
        return { content: [{ type: "text", text: "No imports data available." }] };
      }

      let edges = data.imports.edges;
      if (file) {
        edges = edges.filter((e) => e.from === file || e.to === file);
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            edges: edges.slice(0, 100),
            total: edges.length,
            circulars: data.imports.summary.circulars,
          }, null, 2),
        }],
      };
    }
  );
}

function registerClassificationTools(server: McpServer, context: McpContext): void {
  registerTool(
    server,
    context,
    "get_classifications",
    "Get file archetype classifications (e.g., utility, entrypoint, route-handler). Use to understand file roles across the codebase.",
    {
      archetype: z.string().optional().describe("Filter by archetype ID (e.g., utility, entrypoint, route-handler)"),
      path: z.string().optional().describe("Filter by file path substring"),
    },
    ({ archetype, path }) => {
      const data = context.freshData();
      if (!data.classifications) {
        return { content: [{ type: "text", text: "No classifications data available. Run 'sourcevision analyze' first." }] };
      }

      let files = data.classifications.files;
      if (archetype) {
        files = files.filter((f) => f.archetype === archetype);
      }
      if (path) {
        const q = path.toLowerCase();
        files = files.filter((f) => f.path.toLowerCase().includes(q));
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            archetypes: data.classifications.archetypes.map((a) => ({ id: a.id, name: a.name })),
            files: files.slice(0, 50),
            total: files.length,
            summary: data.classifications.summary,
          }, null, 2),
        }],
      };
    }
  );

  registerTool(
    server,
    context,
    "set_file_archetype",
    "Override the archetype classification for a file (persists to .n-dx.json). Use when the automatic classification is wrong.",
    {
      path: z.string().describe("File path (relative to project root)"),
      archetype: z.string().describe("Archetype ID to assign (e.g., utility, route-handler, entrypoint)"),
    },
    ({ path, archetype }) => {
      if (context.refused) {
        return { content: [{ type: "text", text: `Error: ${context.refused}` }], isError: true };
      }
      const data = context.freshData();
      const file = data.inventory?.files.find((f) => f.path === path);
      if (!file) {
        return { content: [{ type: "text", text: `File "${path}" not found in inventory.` }] };
      }

      const validArchetypes = data.classifications?.archetypes.map((a) => a.id) ?? [];
      if (validArchetypes.length > 0 && !validArchetypes.includes(archetype)) {
        return {
          content: [{
            type: "text",
            text: `Unknown archetype "${archetype}". Valid archetypes: ${validArchetypes.join(", ")}`,
          }],
        };
      }

      setArchetypeOverride(context.absDir, path, archetype);
      context.invalidateCache();

      return {
        content: [{
          type: "text",
          text: `Set archetype override: "${path}" → "${archetype}". Run 'sourcevision analyze' to apply.`,
        }],
      };
    }
  );
}

function registerComponentTools(server: McpServer, context: McpContext): void {
  registerTool(server, context, "get_route_tree","Get the route structure (pages, API routes, layouts). Use when working on routing or navigation.", {}, () => {
    const data = context.freshData();
    if (!data.components) {
      return { content: [{ type: "text", text: "No components data available." }] };
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          routeTree: data.components.routeTree,
          routeModules: data.components.routeModules,
          serverRoutes: data.components.serverRoutes,
          conventions: data.components.summary.routeConventions,
        }, null, 2),
      }],
    };
  });
}

function registerMcpTools(server: McpServer, context: McpContext): void {
  registerOverviewTools(server, context);
  registerZoneTools(server, context);
  registerFileTools(server, context);
  registerClassificationTools(server, context);
  registerComponentTools(server, context);
}

function registerMcpResources(server: McpServer, context: McpContext): void {
  server.resource(
    "summary",
    "sourcevision://summary",
    { description: "Condensed codebase context (CONTEXT.md)" },
    async () => {
      const data = await context.serve(() => context.freshData());
      if (!data.manifest || !data.inventory || !data.imports || !data.zones) {
        return {
          contents: [{
            uri: "sourcevision://summary",
            mimeType: "text/markdown",
            text: "No analysis data available.",
          }],
        };
      }

      const contextText = generateContext(
        data.manifest,
        data.inventory,
        data.imports,
        data.zones,
        data.components,
        data.classifications,
      );

      return {
        contents: [{
          uri: "sourcevision://summary",
          mimeType: "text/markdown",
          text: contextText,
        }],
      };
    }
  );

  server.resource(
    "zones",
    "sourcevision://zones",
    { description: "Zone analysis data" },
    async () => {
      const data = await context.serve(() => context.freshData());
      return {
        contents: [{
          uri: "sourcevision://zones",
          mimeType: "application/json",
          text: JSON.stringify(summarizeZonesResource(data.zones)),
        }],
      };
    }
  );

  server.resource(
    "routes",
    "sourcevision://routes",
    { description: "Route tree data" },
    async () => {
      const data = await context.serve(() => context.freshData());
      return {
        contents: [{
          uri: "sourcevision://routes",
          mimeType: "application/json",
          text: JSON.stringify(
            data.components
              ? { routeTree: data.components.routeTree, routeModules: data.components.routeModules, serverRoutes: data.components.serverRoutes }
              : { routeTree: [], routeModules: [], serverRoutes: [] },
            null,
            2
          ),
        }],
      };
    }
  );
}

/**
 * Start the Sourcevision MCP server over stdio (for `sv mcp <dir>` CLI command).
 *
 * Follows the client's MCP roots when `targetDir` is the cwd, so a session in a
 * linked worktree is served that worktree even when its client spawned the
 * server in the main checkout (#499). The startup dir must still hold
 * `.sourcevision/`: the main checkout normally does, and a startup dir without
 * it exits rather than waiting to see whether a root has one.
 * For HTTP or other transports, use {@link createSourcevisionMcpServer} instead.
 */
export async function startMcpServer(targetDir: string): Promise<void> {
  const absDir = resolve(targetDir);
  const svDir = resolveSourcevisionPaths(absDir).svDir;

  if (!existsSync(svDir)) {
    console.error(`No .sourcevision/ directory found in: ${absDir}`);
    console.error("Run 'sourcevision analyze' first.");
    process.exit(1);
  }

  const server = createSourcevisionMcpServer(absDir, { resolveWorkspaceFromClientRoots: true });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
