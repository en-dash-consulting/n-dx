/**
 * MCP (Model Context Protocol) server for Sourcevision.
 * Exposes codebase analysis data via MCP protocol (stdio or HTTP).
 */

import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type {
  Manifest,
  Inventory,
  Imports,
  Classifications,
  Zones,
  Components,
} from "../schema/index.js";
import { DATA_FILES } from "../schema/data-files.js";
import { generateContext } from "../analyzers/context.js";
import { deriveNextSteps } from "../analyzers/next-steps.js";
import { SV_DIR, TOOL_VERSION } from "../constants.js";

interface SourcevisionData {
  manifest: Manifest | null;
  inventory: Inventory | null;
  imports: Imports | null;
  classifications: Classifications | null;
  zones: Zones | null;
  components: Components | null;
}

function loadData(targetDir: string): SourcevisionData {
  const svDir = join(targetDir, SV_DIR);
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

export function createSourcevisionMcpServer(targetDir: string): McpServer {
  const context = createMcpContext(targetDir);
  const server = new McpServer({ name: "sourcevision", version: TOOL_VERSION });
  registerMcpTools(server, context);
  registerMcpResources(server, context);
  return server;
}

interface McpContext {
  absDir: string;
  freshData: () => SourcevisionData;
  invalidateCache: () => void;
}

function createMcpContext(targetDir: string): McpContext {
  const absDir = resolve(targetDir);
  const svDir = join(absDir, SV_DIR);
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

function setArchetypeOverride(absDir: string, path: string, archetype: string): void {
  const configPath = join(absDir, ".n-dx.json");
  let config: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
      // Start fresh if corrupted
    }
  }

  if (!config.sourcevision) config.sourcevision = {};
  const sv = config.sourcevision as Record<string, unknown>;
  if (!sv.archetypes) sv.archetypes = {};
  const archetypes = sv.archetypes as Record<string, unknown>;
  if (!archetypes.overrides) archetypes.overrides = {};
  const overrides = archetypes.overrides as Record<string, string>;
  overrides[path] = archetype;

  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

function registerMcpTools(server: McpServer, context: McpContext): void {
  server.tool("get_overview", "Get project summary statistics", {}, () => {
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

  server.tool(
    "get_zone",
    "Get details for a specific zone",
    { id: z.string().describe("Zone ID") },
    ({ id }) => {
      const data = context.freshData();
      if (!data.zones) {
        return { content: [{ type: "text", text: "No zones data available." }] };
      }

      const zone = data.zones.zones.find((z) => z.id === id);
      if (!zone) {
        const available = data.zones.zones.map((z) => z.id).join(", ");
        return { content: [{ type: "text", text: `Zone "${id}" not found. Available: ${available}` }] };
      }

      const findings = (data.zones.findings ?? []).filter((f) => f.scope === id);
      const crossings = data.zones.crossings.filter(
        (c) => c.fromZone === id || c.toZone === id
      );

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ ...zone, findings, crossings }, null, 2),
        }],
      };
    }
  );

  server.tool(
    "get_file_info",
    "Get inventory entry, zone, and imports for a file",
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

  server.tool(
    "get_imports",
    "Get import graph edges, optionally filtered to a specific file",
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

  server.tool("get_route_tree", "Get the route structure", {}, () => {
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

  server.tool(
    "search_files",
    "Search the file inventory",
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

  server.tool(
    "get_findings",
    "Get analysis findings, optionally filtered",
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

  server.tool(
    "get_classifications",
    "Get file archetype classifications",
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

  server.tool(
    "set_file_archetype",
    "Override the archetype classification for a file (persists to .n-dx.json)",
    {
      path: z.string().describe("File path (relative to project root)"),
      archetype: z.string().describe("Archetype ID to assign (e.g., utility, route-handler, entrypoint)"),
    },
    ({ path, archetype }) => {
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

  server.tool(
    "get_next_steps",
    "Get prioritized list of what to work on next",
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

function registerMcpResources(server: McpServer, context: McpContext): void {
  server.resource(
    "summary",
    "sourcevision://summary",
    { description: "Condensed codebase context (CONTEXT.md)" },
    () => {
      const data = context.freshData();
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
    () => {
      const data = context.freshData();
      return {
        contents: [{
          uri: "sourcevision://zones",
          mimeType: "application/json",
          text: JSON.stringify(data.zones ?? { zones: [], crossings: [], unzoned: [] }, null, 2),
        }],
      };
    }
  );

  server.resource(
    "routes",
    "sourcevision://routes",
    { description: "Route tree data" },
    () => {
      const data = context.freshData();
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
 * This is the original entry point preserved for backward compatibility.
 * For HTTP or other transports, use {@link createSourcevisionMcpServer} instead.
 */
export async function startMcpServer(targetDir: string): Promise<void> {
  const absDir = resolve(targetDir);
  const svDir = join(absDir, SV_DIR);

  if (!existsSync(svDir)) {
    console.error(`No .sourcevision/ directory found in: ${absDir}`);
    console.error("Run 'sourcevision analyze' first.");
    process.exit(1);
  }

  const server = createSourcevisionMcpServer(absDir);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
