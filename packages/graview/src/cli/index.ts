#!/usr/bin/env node
/**
 * `ndx graview <sub> [dir] [flags]`, spawned by core.
 *
 *   emit      write document.json and snapshot.json under the layout's graview dir
 *   check     emit, then `graview check` on the declaration
 *   describe  emit, then `graview describe` over the snapshot (`--place <slug>`, `--as <role>`)
 *   serve     emit, refresh graview's store from the snapshot, then `graview serve` (the store's
 *             HTTP and WebSocket wire; a Graview face such as the n-dx-graview product connects to it)
 *   mcp       emit, refresh the store, then `graview mcp --read-only` over stdio
 *   info      the graview dir, the binary, and the hub's rex MCP endpoint for a face's two-way sync
 *
 * Every subcommand re-emits first, so what graview shows is never older than
 * the tree on disk. Flags this CLI does not know are passed to graview.
 */
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { relativeToRoot, spawnTool } from "../llm-gateway.js";
import { emitProjection, type EmitResult } from "../emit.js";
import { readGraviewConfig, resolveGraviewCommand, type GraviewCommand } from "../graview-bin.js";
import { rexMcpEndpoint } from "../hub.js";
import { fileURLToPath } from "node:url";
import { resolveLayout } from "../llm-gateway.js";

const SUBCOMMANDS = ["emit", "check", "describe", "serve", "mcp", "info"] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

const USAGE = `ndx graview <command> [dir] [flags]

  emit [dir] [--files]            write document.json and snapshot.json under the graview dir
  check [dir] [--json]            graview check on the emitted declaration
  describe [dir] [--place <slug>] graview describe over the emitted snapshot
  serve [dir] [--port <n>]        graview serve: the store over HTTP + WebSocket, refreshed from the snapshot;
                                  with graview.app in the config, that product's dev server on the fresh projection
  mcp [dir] [--list]              graview mcp --read-only over stdio on the same store
  info [dir] [--json]             where the projection lands, which graview binary, and the hub's rex
                                  endpoint a face writes back through

  --files    project every source file as a node (default: zones and components only)
  --quiet    print nothing but errors

The graview binary comes from graview.bin in the project config, $NDX_GRAVIEW_BIN,
PATH, or npx -y graview@<pinned>, in that order.
`;

interface ParsedArgs {
  sub: Subcommand | "help";
  dir: string;
  files: boolean;
  quiet: boolean;
  passthrough: string[];
}

function parse(argv: string[]): ParsedArgs {
  const [first, ...rest] = argv;
  if (first === undefined || first === "help" || first === "--help" || first === "-h") {
    return { sub: "help", dir: process.cwd(), files: false, quiet: false, passthrough: [] };
  }
  if (!(SUBCOMMANDS as readonly string[]).includes(first)) {
    throw new Error(`Unknown command "${first}". ${USAGE}`);
  }
  let dir: string | undefined;
  let files = false;
  let quiet = false;
  const passthrough: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "--files") files = true;
    else if (arg === "--quiet" || arg === "-q") quiet = true;
    else if (arg.startsWith("-")) {
      passthrough.push(arg);
      // A flag's value: the next token when it is not a flag and the flag takes one.
      const takesValue = ["--place", "--as", "--port", "--host", "--roles", "--header", "--data", "--sqlite"].includes(arg);
      if (takesValue && i + 1 < rest.length) passthrough.push(rest[++i]!);
    } else if (dir === undefined) dir = arg;
    else passthrough.push(arg);
  }
  return { sub: first as Subcommand, dir: resolve(dir ?? process.cwd()), files, quiet, passthrough };
}

function describeEmit(result: EmitResult): string {
  const { counts } = result;
  const parts = Object.entries(counts)
    .filter(([kind]) => kind !== "edges")
    .map(([kind, n]) => `${n} ${kind}${n === 1 ? "" : "s"}`);
  const rel = (p: string) => relativeToRoot(result.layout, p);
  return `Wrote ${rel(result.documentPath)} and ${rel(result.snapshotPath)}: ${parts.join(", ")}; ${counts.edges} edges (PRD layout ${result.prdLayout}).`;
}

async function runGraview(command: GraviewCommand, args: string[], cwd: string): Promise<number> {
  const result = await spawnTool(command.cmd, [...command.prefix, ...args], { cwd, stdio: "inherit" });
  return result.exitCode ?? 1;
}

/**
 * A product face over the projection (`graview.app` in the config): its dev
 * server, told where the fresh document and snapshot are through
 * `NDX_GRAVIEW_DIR`, which its sync step reads. A `--port` goes to it. The
 * app owns its own package manager and scripts; this only has to be in its
 * directory and name the data.
 */
async function serveProductApp(appDir: string, emitted: EmitResult, passthrough: string[], say: (line: string) => void): Promise<number> {
  if (!existsSync(appDir)) {
    console.error(`Error: graview.app names ${appDir}, which does not exist.`);
    return 1;
  }
  const pm = existsSync(resolve(appDir, "pnpm-lock.yaml")) ? "pnpm" : "npm";
  const cmd = process.platform === "win32" ? `${pm}.cmd` : pm;
  const args = pm === "pnpm" ? ["dev", ...(passthrough.length ? ["--", ...passthrough] : [])] : ["run", "dev", ...(passthrough.length ? ["--", ...passthrough] : [])];
  const rex = rexMcpEndpoint(emitted.layout);
  say(`product face: ${appDir} (${pm} dev)${rex ? `; writes back through ${rex.url}` : "; sync off (run ndx start . to register with the hub)"}`);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NDX_GRAVIEW_DIR: emitted.graviewDir,
    NDX_PROJECT_ROOT: emitted.layout.root,
    // This CLI's own entry, so the face's dev door can re-emit without `ndx` on its PATH.
    NDX_GRAVIEW_CLI: fileURLToPath(import.meta.url),
    ...(rex ? { NDX_REX_MCP_URL: rex.url, ...(rex.tokenFile ? { NDX_TOKEN_FILE: rex.tokenFile } : {}) } : {}),
  };
  const result = await spawnTool(cmd, args, { cwd: appDir, stdio: "inherit", env });
  return result.exitCode ?? 1;
}

/** `graview sync-seed --apply --prune` when a store exists, so it mirrors the fresh snapshot. */
async function refreshStore(command: GraviewCommand, emitted: EmitResult): Promise<number> {
  mkdirSync(emitted.dataDir, { recursive: true });
  if (readdirSync(emitted.dataDir).length === 0) return 0; // first install: serve/mcp read --seed themselves
  return runGraview(command, ["sync-seed", emitted.documentPath, "--seed", emitted.snapshotPath, "--data", emitted.dataDir, "--apply", "--prune"], emitted.layout.root);
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parse(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  if (parsed.sub === "help") {
    console.log(USAGE);
    return 0;
  }
  if (!existsSync(parsed.dir)) {
    console.error(`Error: ${parsed.dir} does not exist.`);
    return 2;
  }

  const layout = resolveLayout(parsed.dir);
  if (!existsSync(layout.rexDir)) {
    console.error(`Error: no PRD at ${relativeToRoot(layout, layout.rexDir)}. Run 'ndx init' first.`);
    return 1;
  }
  const config = readGraviewConfig(layout);
  const say = (line: string) => {
    if (!parsed.quiet) console.log(line);
  };

  if (parsed.sub === "info") {
    const command = resolveGraviewCommand(layout);
    const rex = rexMcpEndpoint(layout);
    const info = {
      projectRoot: layout.root,
      graviewDir: layout.graviewDir,
      graview: { source: command.source, detail: command.detail },
      app: config.app ?? null,
      rex: rex ? { url: rex.url, projectId: rex.projectId, tokenFile: rex.tokenFile ?? null, registered: rex.registered } : null,
    };
    if (parsed.passthrough.includes("--json")) console.log(JSON.stringify(info, null, 2));
    else {
      console.log(`projection: ${relativeToRoot(layout, layout.graviewDir)}/`);
      console.log(`graview:    ${command.detail} (${command.source})`);
      console.log(`face:       ${config.app ?? "none (set graview.app)"}`);
      console.log(rex ? `rex:        ${rex.url}${rex.registered ? "" : " (hub not serving it; run ndx start .)"}` : "rex:        not registered with the hub (run ndx start .)");
    }
    return 0;
  }

  const emitted = await emitProjection(parsed.dir, {
    files: parsed.files || config.includeFiles === true,
    warn: (message) => console.error(`warning: ${message}`),
  });
  say(describeEmit(emitted));
  if (parsed.sub === "emit") return 0;

  const command = resolveGraviewCommand(layout);
  say(`graview: ${command.detail} (${command.source})`);
  const root = emitted.layout.root;

  switch (parsed.sub) {
    case "check":
      return runGraview(command, ["check", emitted.documentPath, ...parsed.passthrough], root);
    case "describe":
      return runGraview(command, ["describe", emitted.documentPath, "--seed", emitted.snapshotPath, ...parsed.passthrough], root);
    case "serve": {
      if (config.app) return serveProductApp(config.app, emitted, parsed.passthrough, say);
      const refreshed = await refreshStore(command, emitted);
      if (refreshed !== 0) return refreshed;
      return runGraview(command, ["serve", emitted.documentPath, "--data", emitted.dataDir, "--seed", emitted.snapshotPath, ...parsed.passthrough], root);
    }
    case "mcp": {
      const refreshed = await refreshStore(command, emitted);
      if (refreshed !== 0) return refreshed;
      return runGraview(command, ["mcp", emitted.documentPath, "--data", emitted.dataDir, "--seed", emitted.snapshotPath, "--read-only", ...parsed.passthrough], root);
    }
  }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly || process.env.NDX_GRAVIEW_CLI_MAIN === "1") {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error instanceof Error ? error.stack ?? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
