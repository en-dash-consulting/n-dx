#!/usr/bin/env node
/**
 * `ndx graview <sub> [dir] [flags]`, spawned by core.
 *
 *   emit      write document.json and snapshot.json under the layout's graview dir
 *   check     emit, then `graview check` on the declaration
 *   describe  emit, then `graview describe` over the snapshot (`--place <slug>`, `--as <role>`)
 *   serve     emit, then the product face (`@n-dx/graview-face`, found beside this package or
 *             installed, or `graview.app` in the config) on the fresh projection; with `--no-face`
 *             or no face, refresh graview's store and run `graview serve` (the store's HTTP and
 *             WebSocket wire, which draws nothing)
 *   mcp       emit, refresh the store, then `graview mcp --read-only` over stdio
 *   info      the graview dir, the binary, and the hub's rex MCP endpoint for a face's two-way sync
 *
 * Every subcommand re-emits first, so what graview shows is never older than
 * the tree on disk. Flags this CLI does not know are passed to graview.
 */
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { relativeToRoot, spawnCli } from "../llm-gateway.js";
import { emitProjection, type EmitResult } from "../emit.js";
import { readGraviewConfig, resolveGraviewCommand, type GraviewCommand } from "../graview-bin.js";
import { rexMcpEndpoint } from "../hub.js";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { resolveLayout } from "../llm-gateway.js";

const SUBCOMMANDS = ["emit", "check", "describe", "serve", "mcp", "info"] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

const USAGE = `ndx graview <command> [dir] [flags]

  emit [dir] [--files]            write document.json and snapshot.json under the graview dir
  check [dir] [--json]            graview check on the emitted declaration
  describe [dir] [--place <slug>] graview describe over the emitted snapshot
  serve [dir] [--port <n>]        the product face (@n-dx/graview-face, or graview.app in the config) on the
                                  fresh projection; --no-face, or no face found: graview serve, the bare store
                                  over HTTP + WebSocket that a Graview face connects to
  mcp [dir] [--list]              graview mcp --read-only over stdio on the same store
  info [dir] [--json]             where the projection lands, which graview binary, and the hub's rex
                                  endpoint a face writes back through

  --files    project every source file as a node (default: zones and components only)
  --no-face  serve: the bare graview store even when a product face is installed
  --quiet    print nothing but errors

The graview binary comes from graview.bin in the project config, $NDX_GRAVIEW_BIN,
PATH, the installed product face's own graview, or npx -y graview@<pinned>, in that order.
`;

interface ParsedArgs {
  sub: Subcommand | "help";
  dir: string;
  files: boolean;
  /** `serve`: run the product face when one is found (default) or the bare store. */
  face: boolean;
  quiet: boolean;
  passthrough: string[];
}

function parse(argv: string[]): ParsedArgs {
  const [first, ...rest] = argv;
  if (first === undefined || first === "help" || first === "--help" || first === "-h") {
    return { sub: "help", dir: process.cwd(), files: false, face: true, quiet: false, passthrough: [] };
  }
  if (!(SUBCOMMANDS as readonly string[]).includes(first)) {
    throw new Error(`Unknown command "${first}". ${USAGE}`);
  }
  let dir: string | undefined;
  let files = false;
  let face = true;
  let quiet = false;
  const passthrough: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "--files") files = true;
    else if (arg === "--no-face") face = false;
    else if (arg === "--quiet" || arg === "-q") quiet = true;
    else if (arg.startsWith("-")) {
      passthrough.push(arg);
      // A flag's value: the next token when it is not a flag and the flag takes one.
      const takesValue = ["--place", "--as", "--port", "--host", "--roles", "--header", "--data", "--sqlite"].includes(arg);
      if (takesValue && i + 1 < rest.length) passthrough.push(rest[++i]!);
    } else if (dir === undefined) dir = arg;
    else passthrough.push(arg);
  }
  return { sub: first as Subcommand, dir: resolve(dir ?? process.cwd()), files, face, quiet, passthrough };
}

function describeEmit(result: EmitResult): string {
  const { counts } = result;
  const parts = Object.entries(counts)
    .filter(([kind]) => kind !== "edges")
    .map(([kind, n]) => `${n} ${kind}${n === 1 ? "" : "s"}`);
  const rel = (p: string) => relativeToRoot(result.layout, p);
  return `Wrote ${rel(result.documentPath)} and ${rel(result.snapshotPath)}: ${parts.join(", ")}; ${counts.edges} edges (PRD layout ${result.prdLayout}).`;
}

/**
 * Run a child to completion with our stdio. `spawnCli` because on Windows
 * the binary may be an `npx.cmd`/`graview.cmd` shim, which Node refuses to
 * spawn without a shell; it routes those through cmd.exe and is a plain
 * spawn everywhere else.
 */
function run(cmd: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv; stdoutToStderr?: boolean }): Promise<number> {
  return new Promise((resolve) => {
    // Under `mcp`, stdout is the JSON-RPC stream: a helper child's chatter goes to stderr instead.
    const stdio = options.stdoutToStderr ? [0, 2, 2] : "inherit";
    const child = spawnCli(cmd, args, { cwd: options.cwd, ...(options.env ? { env: options.env } : {}), stdio });
    child.on("error", (error) => {
      console.error(`Error: could not run ${cmd}: ${error.message}`);
      resolve(1);
    });
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

async function runGraview(command: GraviewCommand, args: string[], cwd: string, options: { stdoutToStderr?: boolean } = {}): Promise<number> {
  return run(command.cmd, [...command.prefix, ...args], { cwd, ...options });
}

/**
 * Where the product face is, when nothing names one: `@n-dx/graview-face`
 * beside this package in the monorepo, or installed in node_modules. It is
 * never a dependency of this package — installing n-dx never pulls Graview —
 * so it is looked for, not imported.
 */
export function findProductFace(): string | undefined {
  const sibling = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "graview-face");
  if (existsSync(resolve(sibling, "bin", "serve.js"))) return sibling;
  try {
    return dirname(createRequire(import.meta.url).resolve("@n-dx/graview-face/package.json"));
  } catch {
    return undefined;
  }
}

/**
 * A product face over the projection (`graview.app` in the config, or
 * `@n-dx/graview-face` where it is found): its own server, told where the
 * fresh document and snapshot are through `NDX_GRAVIEW_DIR`. A `--port` goes
 * to it. A face with a `bin/serve.js` is run under this Node, which works
 * installed as well as in the monorepo; any other app gets its `dev` script.
 */
async function serveProductApp(appDir: string, emitted: EmitResult, passthrough: string[], say: (line: string) => void): Promise<number> {
  if (!existsSync(appDir)) {
    console.error(`Error: graview.app names ${appDir}, which does not exist.`);
    return 1;
  }
  const ownBin = resolve(appDir, "bin", "serve.js");
  const pm = existsSync(resolve(appDir, "pnpm-lock.yaml")) ? "pnpm" : "npm";
  const cmd = existsSync(ownBin) ? process.execPath : process.platform === "win32" ? `${pm}.cmd` : pm;
  const args = existsSync(ownBin) ? [ownBin, ...passthrough] : pm === "pnpm" ? ["dev", ...(passthrough.length ? ["--", ...passthrough] : [])] : ["run", "dev", ...(passthrough.length ? ["--", ...passthrough] : [])];
  const rex = rexMcpEndpoint(emitted.layout);
  say(`product face: ${appDir}${rex ? `; writes back through ${rex.url}${rex.worktree ? " (as this worktree's workspace)" : ""}` : "; sync off (run ndx start . to register with the hub)"}`);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NDX_GRAVIEW_DIR: emitted.graviewDir,
    NDX_PROJECT_ROOT: emitted.layout.root,
    // This CLI's own entry, so the face's dev door can re-emit without `ndx` on its PATH.
    NDX_GRAVIEW_CLI: fileURLToPath(import.meta.url),
    ...(rex ? { NDX_REX_MCP_URL: rex.url, ...(rex.tokenFile ? { NDX_TOKEN_FILE: rex.tokenFile } : {}) } : {}),
    // A worktree writes its own workspace, never the main checkout's: the face resolves the key from this listing.
    ...(rex?.worktree && rex.workspacesUrl ? { NDX_WORKTREE: rex.worktree, NDX_WORKSPACES_URL: rex.workspacesUrl } : {}),
  };
  return run(cmd, args, { cwd: appDir, env });
}

/** `graview sync-seed --apply --prune` when a store exists, so it mirrors the fresh snapshot. */
async function refreshStore(command: GraviewCommand, emitted: EmitResult, options: { stdoutToStderr?: boolean } = {}): Promise<number> {
  mkdirSync(emitted.dataDir, { recursive: true });
  if (readdirSync(emitted.dataDir).length === 0) return 0; // first install: serve/mcp read --seed themselves
  return runGraview(command, ["sync-seed", emitted.documentPath, "--seed", emitted.snapshotPath, "--data", emitted.dataDir, "--apply", "--prune"], emitted.layout.root, options);
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
  // Progress goes to stderr under `mcp`: stdout is the JSON-RPC stream graview inherits.
  const say = (line: string) => {
    if (parsed.quiet) return;
    if (parsed.sub === "mcp") console.error(line);
    else console.log(line);
  };

  if (parsed.sub === "info") {
    const command = resolveGraviewCommand(layout, { face: config.app ?? findProductFace() });
    const rex = rexMcpEndpoint(layout);
    const info = {
      projectRoot: layout.root,
      graviewDir: layout.graviewDir,
      graview: { source: command.source, detail: command.detail },
      app: config.app ?? findProductFace() ?? null,
      rex: rex ? { url: rex.url, projectId: rex.projectId, tokenFile: rex.tokenFile ?? null, registered: rex.registered, worktree: rex.worktree ?? null } : null,
    };
    if (parsed.passthrough.includes("--json")) console.log(JSON.stringify(info, null, 2));
    else {
      console.log(`projection: ${relativeToRoot(layout, layout.graviewDir)}/`);
      console.log(`graview:    ${command.detail} (${command.source})`);
      console.log(`face:       ${config.app ?? findProductFace() ?? "none (install @n-dx/graview-face, or set graview.app)"}`);
      console.log(rex ? `rex:        ${rex.url}${rex.worktree ? " (as this worktree's workspace)" : ""}${rex.registered ? "" : " (hub not serving it; run ndx start .)"}` : "rex:        not registered with the hub (run ndx start .)");
    }
    return 0;
  }

  const emitted = await emitProjection(parsed.dir, {
    files: parsed.files || config.includeFiles === true,
    warn: (message) => console.error(`warning: ${message}`),
  });
  say(describeEmit(emitted));
  if (parsed.sub === "emit") return 0;

  const command = resolveGraviewCommand(layout, { face: config.app ?? findProductFace() });
  say(`graview: ${command.detail} (${command.source})`);
  const root = emitted.layout.root;

  switch (parsed.sub) {
    case "check":
      return runGraview(command, ["check", emitted.documentPath, ...parsed.passthrough], root);
    case "describe":
      return runGraview(command, ["describe", emitted.documentPath, "--seed", emitted.snapshotPath, ...parsed.passthrough], root);
    case "serve": {
      const face = parsed.face ? (config.app ?? findProductFace()) : undefined;
      if (face) return serveProductApp(face, emitted, parsed.passthrough, say);
      const refreshed = await refreshStore(command, emitted);
      if (refreshed !== 0) return refreshed;
      return runGraview(command, ["serve", emitted.documentPath, "--data", emitted.dataDir, "--seed", emitted.snapshotPath, ...parsed.passthrough], root);
    }
    case "mcp": {
      const refreshed = await refreshStore(command, emitted, { stdoutToStderr: true });
      if (refreshed !== 0) return refreshed;
      return runGraview(command, ["mcp", emitted.documentPath, "--data", emitted.dataDir, "--seed", emitted.snapshotPath, "--read-only", ...parsed.passthrough], root);
    }
  }
}

// This file is the `ndx-graview` bin and what core spawns: it always runs
// main(). (A guard comparing argv[1] to import.meta.url fails through the
// bin symlinks npm and pnpm install, and the module is never imported.)
main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    // A SchemaSkewError or a bad tree is a message, not a stack; NDX_DEBUG keeps the stack.
    const message = error instanceof Error ? (process.env.NDX_DEBUG ? error.stack ?? error.message : error.message) : String(error);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  },
);
