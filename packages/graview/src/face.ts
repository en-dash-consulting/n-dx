/**
 * The product face, `@n-dx/graview-face`, as an n-dx extension: its
 * `package.json` declares an `ndx.extension` block with a sidecar
 * (`bin/serve.js`), so finding it, the user's approval of it and the
 * environment it runs with are core's, the same ones the hub uses for
 * `/x/<name>/` (docs/architecture/extensions.md). Nothing here reads a
 * manifest or looks through `node_modules`: it asks the n-dx CLI that
 * spawned this one (`NDX_CLI_PATH`, which `packages/core/cli.js` exports to
 * every child) and runs what it answers.
 *
 * - `ndx extensions sidecar graview-face --json` — the launch plan `serve`
 *   runs in the foreground: bin, Node, working directory and the contract
 *   environment, or a refusal naming its fix.
 * - `ndx extensions info graview-face --json` — where the face is installed,
 *   for the commands that only borrow its pinned `graview` binary. Asking
 *   runs nothing and writes nothing.
 *
 * @module graview/face
 */
import { existsSync } from "node:fs";
import { execStdout } from "./llm-gateway.js";

/** The `name` in the face's `ndx.extension` block. */
export const FACE_EXTENSION = "graview-face";

/** How long a question to the n-dx CLI may take; discovery is cached, so this is a hang guard. */
const ASK_TIMEOUT_MS = 30_000;

/** What `ndx extensions sidecar <name> --json` prints on success. */
export interface FacePlan {
  name: string;
  /** The face's package directory. */
  dir: string;
  execPath: string;
  bin: string;
  cwd: string;
  env: Record<string, string | undefined>;
}

/**
 * - `run` — the face is installed, approved and enabled.
 * - `none` — no face to run (not installed, disabled, or no n-dx CLI to ask);
 *   `serve` draws the bare store, as it always has without a face.
 * - `refused` — a face is installed but cannot run yet (unapproved,
 *   incompatible, a missing bin, a config section its schema rejects);
 *   `error` is core's message, naming the fix.
 */
export type FaceResolution =
  | { kind: "run"; plan: FacePlan }
  | { kind: "none"; detail: string }
  | { kind: "refused"; error: string };

/** An installed face, as `ndx extensions info` describes it. */
export interface InstalledFace {
  dir: string;
  /** Core's extension state: `enabled`, `unapproved`, `disabled`, … */
  state: string;
  reason: string;
}

/** Runs the n-dx CLI with `args` from `cwd` and resolves to its stdout. */
export type AskNdx = (args: string[], cwd: string) => Promise<string>;

export interface FaceOptions {
  /** Defaults to `process.env`, whose `NDX_CLI_PATH` names the n-dx CLI. */
  env?: NodeJS.ProcessEnv;
  /** Defaults to running `NDX_CLI_PATH` under this Node. */
  ask?: AskNdx;
}

const NO_NDX = "no n-dx CLI to ask (run it as ndx graview)";

function asker(options: FaceOptions): AskNdx | undefined {
  if (options.ask) return options.ask;
  const env = options.env ?? process.env;
  const cli = env["NDX_CLI_PATH"];
  if (!cli || !existsSync(cli)) return undefined;
  return (args, cwd) => execStdout(process.execPath, [cli, ...args], { cwd, env, timeout: ASK_TIMEOUT_MS });
}

function parseObject(stdout: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Read the answer of `ndx extensions sidecar graview-face --json`. */
export function readFacePlan(stdout: string): FaceResolution {
  const body = parseObject(stdout.trim());
  if (!body) return { kind: "refused", error: `Error: n-dx gave no launch plan for the ${FACE_EXTENSION} extension — fix: ndx extensions doctor` };
  if (typeof body["bin"] === "string" && typeof body["execPath"] === "string") return { kind: "run", plan: body as unknown as FacePlan };
  const error = typeof body["error"] === "string" ? body["error"] : `Error: n-dx refused the ${FACE_EXTENSION} extension — fix: ndx extensions doctor`;
  // Not installed, or switched off by the user: draw the bare store, as without a face.
  if (body["reason"] === "none") return { kind: "none", detail: `none (install @n-dx/graview-face, then ndx extensions enable ${FACE_EXTENSION})` };
  if (body["state"] === "disabled") return { kind: "none", detail: `disabled (ndx extensions enable ${FACE_EXTENSION})` };
  return { kind: "refused", error };
}

/** The launch plan for the face, from the project at `root`. */
export async function planProductFace(root: string, options: FaceOptions = {}): Promise<FaceResolution> {
  const ask = asker(options);
  if (!ask) return { kind: "none", detail: NO_NDX };
  return readFacePlan(await ask(["extensions", "sidecar", FACE_EXTENSION, "--json"], root));
}

/** Where the face is installed and its state, or undefined when n-dx knows of none. */
export async function findInstalledFace(root: string, options: FaceOptions = {}): Promise<InstalledFace | undefined> {
  const ask = asker(options);
  if (!ask) return undefined;
  const body = parseObject((await ask(["extensions", "info", FACE_EXTENSION, "--json"], root)).trim());
  if (!body || typeof body["dir"] !== "string" || typeof body["state"] !== "string") return undefined;
  return { dir: body["dir"], state: body["state"], reason: typeof body["reason"] === "string" ? body["reason"] : "" };
}

/**
 * The environment the face runs with under `ndx graview serve`: the plan's
 * (the user's own plus the extension contract) with the projection and the
 * rex endpoint on top. `PORT` is the hub's way of handing a sidecar its port;
 * here `--port` is passed through instead, so an ambient `PORT` is left out.
 */
export function faceEnvironment(plan: FacePlan, projection: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...plan.env, ...projection };
  delete env["PORT"];
  return env;
}
