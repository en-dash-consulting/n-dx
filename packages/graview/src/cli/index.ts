#!/usr/bin/env node
/**
 * `ndx graview <sub> [dir] [flags]`, spawned by core.
 *
 *   emit      write document.json and snapshot.json under the layout's graview dir
 *   check     emit, then `graview check` on the declaration
 *   describe  emit, then `graview describe` over the snapshot (`--place <slug>`, `--as <role>`)
 *   serve     emit, then the product face (the `graview-face` extension, `@n-dx/graview-face`,
 *             run from the launch plan n-dx gives for its sidecar) on the fresh projection; with
 *             `--no-face` or no face, refresh graview's store and run `graview serve` (the
 *             store's HTTP and WebSocket wire, which draws nothing)
 *   mcp       emit, refresh the store, then `graview mcp --read-only` over stdio
 *   info      the graview dir, the binary, and the hub's rex MCP endpoint for a face's two-way sync
 *
 * Every subcommand re-emits first, so what graview shows is never older than
 * the tree on disk. Flags this CLI does not know are passed to graview.
 */
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { relativeToRoot, repoCommandEnv, spawnCli } from "../llm-gateway.js";
import { emitProjection, type EmitResult } from "../emit.js";
import { prepareCommandCwd, readGraviewConfig, resolveGraviewCommand, type GraviewCommand } from "../graview-bin.js";
import { loadDocument } from "../document.js";
import { rexMcpEndpoint } from "../hub.js";
import { fileURLToPath } from "node:url";
import { resolveLayout } from "../llm-gateway.js";
import { FACE_EXTENSION, faceEnvironment, findInstalledFace, planProductFace, type FacePlan, type InstalledFace } from "../face.js";

const SUBCOMMANDS = ["emit", "check", "describe", "serve", "mcp", "info"] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

const USAGE = `ndx graview <command> [dir] [flags]

  emit [dir] [--no-files]         write document.json and snapshot.json under the graview dir
  check [dir] [--json]            graview check on the emitted declaration
  describe [dir] [--place <slug>] graview describe over the emitted snapshot
  serve [dir] [--port <n>]        the product face (the graview-face extension, @n-dx/graview-face) on the
                                  fresh projection; --no-face, or no face enabled: graview serve, the bare store
                                  over HTTP + WebSocket that a Graview face connects to
  mcp [dir] [--list]              graview mcp --read-only over stdio on the same store
  info [dir] [--json]             where the projection lands, which graview binary, and the hub's rex
                                  endpoint a face writes back through

  --no-files leave source files out: zones and components carry the shape of the code without them
  --no-face  serve: the bare graview store even when a product face is installed
  --quiet    print nothing but errors

The graview binary comes from graview.bin in the project config, $NDX_GRAVIEW_BIN,
PATH, the installed product face's own graview, or npx -y graview@<pinned>, in that order.
`;

interface ParsedArgs {
  sub: Subcommand | "help";
  dir: string;
  /** Unset unless a flag says: `graview.includeFiles` in the config decides, and files are on by default. */
  files?: boolean;
  /** `serve`: run the product face when one is found (default) or the bare store. */
  face: boolean;
  quiet: boolean;
  passthrough: string[];
}

function parse(argv: string[]): ParsedArgs {
  const [first, ...rest] = argv;
  if (first === undefined || first === "help" || first === "--help" || first === "-h") {
    return { sub: "help", dir: process.cwd(), face: true, quiet: false, passthrough: [] };
  }
  if (!(SUBCOMMANDS as readonly string[]).includes(first)) {
    throw new Error(`Unknown command "${first}". ${USAGE}`);
  }
  let dir: string | undefined;
  let files: boolean | undefined;
  let face = true;
  let quiet = false;
  const passthrough: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "--files") files = true;
    else if (arg === "--no-files") files = false;
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
  return { sub: first as Subcommand, dir: resolve(dir ?? process.cwd()), ...(files === undefined ? {} : { files }), face, quiet, passthrough };
}

function describeEmit(result: EmitResult): string {
  const { counts } = result;
  const kinds = loadDocument().kinds;
  const plural = (kind: string): string => kinds[kind]?.plural?.toLowerCase() ?? `${kind}s`;
  const parts = Object.entries(counts)
    .filter(([kind]) => kind !== "edges")
    .map(([kind, n]) => `${n} ${n === 1 ? kind : plural(kind)}`);
  const rel = (p: string) => relativeToRoot(result.layout, p);
  const layer = result.productLayer === "proposed" ? "; product layer proposed by rex's migration plan" : "";
  return `Wrote ${rel(result.documentPath)} and ${rel(result.snapshotPath)}: ${parts.join(", ")}; ${counts.edges} edges (PRD layout ${result.prdLayout}${layer}).`;
}

/**
 * Run a child to completion with our stdio. `spawnCli` because on Windows
 * the binary may be an `npx.cmd`/`graview.cmd` shim, which Node refuses to
 * spawn without a shell; it routes those through cmd.exe and is a plain
 * spawn everywhere else.
 *
 * `env` is required: graview and its npx fallback (a binary fetched from the
 * registry) are peer tools, like the vendor CLIs, so each gets the project's
 * sanitized environment ({@link repoCommandEnv}: the user's local denies
 * always apply, a repository's allows only once trusted), never the
 * credentials in the operator's shell. The product face is an approved
 * extension and runs with the environment core's launch plan gives it. PATH, HOME and npm's own
 * config pass the default filter; npm auth tokens do not, and the pinned
 * graview comes from the public registry.
 */
function run(cmd: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; stdoutToStderr?: boolean }): Promise<number> {
  return new Promise((resolve) => {
    // Under `mcp`, stdout is the JSON-RPC stream: a helper child's chatter goes to stderr instead.
    const stdio = options.stdoutToStderr ? [0, 2, 2] : "inherit";
    const child = spawnCli(cmd, args, { cwd: options.cwd, env: options.env, stdio });
    child.on("error", (error) => {
      console.error(`Error: could not run ${cmd}: ${error.message}`);
      resolve(1);
    });
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

/** graview's flags whose value is a path. */
const PATH_FLAGS = ["--data", "--sqlite"];

/**
 * A relative path given to a path flag, made absolute against the project
 * root, which is where it resolved when graview always ran there. The npx
 * fallback runs elsewhere.
 */
export function absolutePathFlags(args: string[], root: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const eq = arg.indexOf("=");
    if (eq > 0 && PATH_FLAGS.includes(arg.slice(0, eq))) out.push(`${arg.slice(0, eq + 1)}${resolve(root, arg.slice(eq + 1))}`);
    else if (PATH_FLAGS.includes(arg) && i + 1 < args.length) out.push(arg, resolve(root, args[++i]!));
    else out.push(arg);
  }
  return out;
}

/** Runs in the project root unless the command names its own directory (the npx fallback). */
async function runGraview(command: GraviewCommand, args: string[], root: string, options: { stdoutToStderr?: boolean } = {}): Promise<number> {
  prepareCommandCwd(command);
  return run(command.cmd, [...command.prefix, ...absolutePathFlags(args, root)], { cwd: command.cwd ?? root, env: repoCommandEnv(root), ...options });
}

/**
 * The product face over the projection, from the launch plan n-dx gives for
 * the `graview-face` extension's sidecar (`../face.ts`): its own server, told
 * where the fresh document and snapshot are through `NDX_GRAVIEW_DIR`, in the
 * foreground. A `--port` goes to it.
 */
async function serveProductFace(plan: FacePlan, emitted: EmitResult, passthrough: string[], say: (line: string) => void): Promise<number> {
  const rex = rexMcpEndpoint(emitted.layout);
  say(`product face: ${plan.dir}${rex ? `; writes back through ${rex.url}${rex.worktree ? " (as this worktree's workspace)" : ""}` : "; sync off (run ndx start . to register with the hub)"}`);
  const env = faceEnvironment(plan, {
    NDX_GRAVIEW_DIR: emitted.graviewDir,
    NDX_PROJECT_ROOT: emitted.layout.root,
    // This CLI's own entry, so the face's dev door can re-emit without `ndx` on its PATH.
    NDX_GRAVIEW_CLI: fileURLToPath(import.meta.url),
    ...(rex ? { NDX_REX_MCP_URL: rex.url, ...(rex.tokenFile ? { NDX_TOKEN_FILE: rex.tokenFile } : {}) } : {}),
    // A worktree writes its own workspace, never the main checkout's: the face resolves the key from this listing.
    ...(rex?.worktree && rex.workspacesUrl ? { NDX_WORKTREE: rex.worktree, NDX_WORKSPACES_URL: rex.workspacesUrl } : {}),
  });
  return run(plan.execPath, [plan.bin, ...passthrough], { cwd: plan.cwd, env });
}

/** `graview.app` named a face checkout before the face became an extension; say where that moved. */
function warnRetiredApp(app: string | undefined): void {
  if (app === undefined) return;
  console.error(`warning: graview.app (${app}) is no longer read: the product face is the ${FACE_EXTENSION} extension. To run a checkout, list it under extensions.paths in <ndx home>/config.json, then run ndx extensions enable ${FACE_EXTENSION}.`);
}

/** How `info` names the face. */
function describeFace(face: InstalledFace | undefined): string {
  if (!face) return `none (install @n-dx/graview-face, then ndx extensions enable ${FACE_EXTENSION})`;
  if (face.state === "enabled") return face.dir;
  return `${face.dir} (${face.state}${face.reason ? `: ${face.reason}` : ""}; ndx extensions enable ${FACE_EXTENSION})`;
}

/** The face's directory, for its pinned `graview` binary: only an enabled face's, since that runs its code. */
function enabledFaceDir(face: InstalledFace | undefined): string | undefined {
  return face?.state === "enabled" ? face.dir : undefined;
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

  warnRetiredApp(config.app);

  if (parsed.sub === "info") {
    const face = await findInstalledFace(layout.root);
    const command = resolveGraviewCommand(layout, { face: enabledFaceDir(face) });
    const rex = rexMcpEndpoint(layout);
    const info = {
      projectRoot: layout.root,
      graviewDir: layout.graviewDir,
      graview: { source: command.source, detail: command.detail },
      app: face ? { dir: face.dir, state: face.state, reason: face.reason } : null,
      rex: rex ? { url: rex.url, projectId: rex.projectId, tokenFile: rex.tokenFile ?? null, registered: rex.registered, worktree: rex.worktree ?? null } : null,
    };
    if (parsed.passthrough.includes("--json")) console.log(JSON.stringify(info, null, 2));
    else {
      console.log(`projection: ${relativeToRoot(layout, layout.graviewDir)}/`);
      console.log(`graview:    ${command.detail} (${command.source})`);
      console.log(`face:       ${describeFace(face)}`);
      console.log(rex ? `rex:        ${rex.url}${rex.worktree ? " (as this worktree's workspace)" : ""}${rex.registered ? "" : " (hub not serving it; run ndx start .)"}` : "rex:        not registered with the hub (run ndx start .)");
    }
    return 0;
  }

  const emitted = await emitProjection(parsed.dir, {
    files: parsed.files ?? config.includeFiles ?? true,
    ref: config.mainRef,
    proposeProductLayer: config.proposeProductLayer,
    warn: (message) => console.error(`warning: ${message}`),
  });
  say(describeEmit(emitted));
  if (parsed.sub === "emit") return 0;

  const root = emitted.layout.root;
  if (parsed.sub === "serve" && parsed.face) {
    const face = await planProductFace(root);
    if (face.kind === "run") return serveProductFace(face.plan, emitted, parsed.passthrough, say);
    if (face.kind === "refused") {
      console.error(face.error);
      console.error("Hint: pass --no-face for the bare graview store.");
      return 2;
    }
    say(`product face: ${face.detail}`);
  }

  const command = resolveGraviewCommand(layout, { face: enabledFaceDir(await findInstalledFace(root)) });
  say(`graview: ${command.detail} (${command.source})`);

  switch (parsed.sub) {
    case "check":
      return runGraview(command, ["check", emitted.documentPath, ...parsed.passthrough], root);
    case "describe":
      return runGraview(command, ["describe", emitted.documentPath, "--seed", emitted.snapshotPath, ...parsed.passthrough], root);
    case "serve": {
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
