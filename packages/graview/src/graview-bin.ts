/**
 * Where the `graview` binary is. In order: `graview.bin` in the project
 * config (machine-local over shared; the repository's only once the checkout
 * is trusted), `NDX_GRAVIEW_BIN`, a `graview` on PATH,
 * the product face's own `graview` (it pins the same release this package
 * checks against), then `npx -y graview@<pinned>`. npx resolves a local
 * install and the project `.npmrc` from its working directory, so the
 * fallback runs in a directory n-dx owns under the ndx home, never the
 * checkout: a graview the repository installs is not run. A path ending in
 * `.js`/`.mjs`/`.cjs` is a CLI entry run under the current Node, so a sibling
 * framework checkout (`../graview/packages/graview/dist/cli.js`) works without
 * a global install.
 *
 * No `@graview/*` package is ever imported or installed by this package; the
 * binary is a peer tool the way the claude and codex CLIs are to hench.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { resolveNdxHome, trustedLocalConfig, trustedProjectConfig, type Layout } from "./llm-gateway.js";
import { GRAVIEW_VERSION } from "./document.js";

export type GraviewBinSource = "config" | "env" | "path" | "face" | "npx";

export interface GraviewCommand {
  cmd: string;
  /** Arguments that come before the graview subcommand (`-y graview@x` for npx, the script for a .js entry). */
  prefix: string[];
  source: GraviewBinSource;
  /** What was configured or found, for the operator. */
  detail: string;
  /**
   * Where it must run, when the project root will not do. Set for npx: a
   * directory under the ndx home holding its own `package.json`, so npm's
   * project prefix stops there. graview's arguments are absolute paths.
   */
  cwd?: string;
}

export interface GraviewConfig {
  /** The graview binary or its `cli.js`. */
  bin?: string;
  /** Project every source file as a node (default true; `false` is `--no-files`). */
  includeFiles?: boolean;
  /**
   * The branch the commits and landings are read from (`main`,
   * `upstream/main`). Unset, rex's own default: the first of `origin/HEAD`,
   * `origin/main`, `main` that resolves.
   */
  mainRef?: string;
  /**
   * On a v1 tree, draw the product layer rex's migration plan proposes
   * (areas, capabilities, constraints, each marked `proposed`). Default true;
   * `false` projects the tree as changes only.
   */
  proposeProductLayer?: boolean;
  /**
   * Retired: once the checkout of a product face. The face is the
   * `graview-face` extension now (`face.ts`), found and approved by n-dx;
   * a checkout goes under `extensions.paths`. Read only so the CLI can say so.
   */
  app?: string;
}

export const GRAVIEW_BIN_ENV = "NDX_GRAVIEW_BIN";

function readConfigFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * The `graview` section of the project config, machine-local values over
 * shared ones. `bin` is a binary n-dx spawns, so both files pass the trust
 * gate: the shared config's `bin`, and a git-tracked local config's, apply
 * only once the user trusts the checkout; the user's own untracked local
 * config always applies. `app` is retired and read only to warn about it.
 */
export function readGraviewConfig(layout: Layout): GraviewConfig {
  const out: GraviewConfig = {};
  const configs = [
    trustedProjectConfig(layout.root, readConfigFile(layout.configFile)),
    trustedLocalConfig(layout.root, readConfigFile(layout.localConfigFile)),
  ];
  for (const config of configs) {
    const section = config?.graview;
    if (section === null || typeof section !== "object") continue;
    const { bin, includeFiles, app, mainRef, proposeProductLayer } = section as Record<string, unknown>;
    if (typeof bin === "string" && bin.trim().length > 0) out.bin = bin.trim();
    if (typeof includeFiles === "boolean") out.includeFiles = includeFiles;
    if (typeof mainRef === "string" && mainRef.trim().length > 0) out.mainRef = mainRef.trim();
    if (typeof proposeProductLayer === "boolean") out.proposeProductLayer = proposeProductLayer;
    if (typeof app === "string" && app.trim().length > 0) out.app = isAbsolute(app.trim()) ? app.trim() : resolve(layout.root, app.trim());
  }
  return out;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function commandFor(bin: string, root: string, source: GraviewBinSource): GraviewCommand {
  const path = isAbsolute(bin) ? bin : resolve(root, bin);
  if (/\.(?:m|c)?js$/i.test(bin)) return { cmd: process.execPath, prefix: [path], source, detail: path };
  // A bare name is left to PATH lookup by the OS; a path is used as given.
  return { cmd: bin.includes("/") || bin.includes("\\") ? path : bin, prefix: [], source, detail: bin };
}

function findOnPath(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | undefined {
  const names = platform === "win32" ? ["graview.cmd", "graview.exe", "graview"] : ["graview"];
  for (const dir of (env.PATH ?? env.Path ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = join(dir, name);
      if (isFile(candidate)) return candidate;
    }
  }
  return undefined;
}

export interface ResolveGraviewOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /**
   * The product face's checkout or install, when one is known: its own
   * `node_modules/.bin/graview` is taken before npx. The face pins the release
   * this package checks against, and npx run from inside a pnpm workspace
   * that holds that same release skips its install and then finds no bin.
   */
  face?: string;
}

function faceBin(face: string | undefined, platform: NodeJS.Platform): string | undefined {
  if (!face) return undefined;
  const names = platform === "win32" ? ["graview.cmd", "graview"] : ["graview"];
  for (const name of names) {
    const candidate = join(face, "node_modules", ".bin", name);
    if (isFile(candidate)) return candidate;
  }
  return undefined;
}

export function resolveGraviewCommand(layout: Layout, options: ResolveGraviewOptions = {}): GraviewCommand {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;

  const configured = readGraviewConfig(layout).bin;
  if (configured) return commandFor(configured, layout.root, "config");

  const fromEnv = env[GRAVIEW_BIN_ENV]?.trim();
  if (fromEnv) return commandFor(fromEnv, layout.root, "env");

  const onPath = findOnPath(env, platform);
  if (onPath) return { cmd: onPath, prefix: [], source: "path", detail: onPath };

  const fromFace = faceBin(options.face, platform);
  if (fromFace) return { cmd: fromFace, prefix: [], source: "face", detail: fromFace };

  const npx = platform === "win32" ? "npx.cmd" : "npx";
  return {
    cmd: npx,
    prefix: ["-y", `graview@${GRAVIEW_VERSION}`],
    source: "npx",
    detail: `npx -y graview@${GRAVIEW_VERSION}`,
    cwd: join(resolveNdxHome({ env }), "graview", "npx"),
  };
}

/**
 * Create the command's own working directory, when it has one: an empty
 * private package, so npm takes it as the project and looks no further up for
 * a `node_modules` or an `.npmrc`.
 */
export function prepareCommandCwd(command: GraviewCommand): void {
  if (!command.cwd) return;
  mkdirSync(command.cwd, { recursive: true });
  const manifest = join(command.cwd, "package.json");
  if (!existsSync(manifest)) writeFileSync(manifest, `${JSON.stringify({ name: "ndx-graview-npx", private: true })}\n`);
}
