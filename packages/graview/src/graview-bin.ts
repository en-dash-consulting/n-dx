/**
 * Where the `graview` binary is. In order: `graview.bin` in the project
 * config (shared, then machine-local), `NDX_GRAVIEW_BIN`, a `graview` on PATH,
 * then `npx -y graview@<pinned>`. A path ending in `.js`/`.mjs`/`.cjs` is a
 * CLI entry run under the current Node, so a sibling framework checkout
 * (`../graview/packages/graview/dist/cli.js`) works without a global install.
 *
 * No `@graview/*` package is ever imported or installed by this package; the
 * binary is a peer tool the way the claude and codex CLIs are to hench.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import type { Layout } from "./llm-gateway.js";
import { GRAVIEW_VERSION } from "./document.js";

export type GraviewBinSource = "config" | "env" | "path" | "npx";

export interface GraviewCommand {
  cmd: string;
  /** Arguments that come before the graview subcommand (`-y graview@x` for npx, the script for a .js entry). */
  prefix: string[];
  source: GraviewBinSource;
  /** What was configured or found, for the operator. */
  detail: string;
}

export interface GraviewConfig {
  /** The graview binary or its `cli.js`. */
  bin?: string;
  /** Project every source file as a node by default. */
  includeFiles?: boolean;
  /**
   * A product face for this project: the checkout (or built site) of a Graview
   * app built from the emitted document. Unset, `@n-dx/graview-face` is found
   * beside this package or in node_modules. `ndx graview serve` runs the face
   * on the fresh projection instead of the bare `graview serve`.
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

/** The `graview` section of the project config, machine-local values over shared ones. */
export function readGraviewConfig(layout: Layout): GraviewConfig {
  const out: GraviewConfig = {};
  for (const file of [layout.configFile, layout.localConfigFile]) {
    const section = readConfigFile(file).graview;
    if (section === null || typeof section !== "object") continue;
    const { bin, includeFiles, app } = section as Record<string, unknown>;
    if (typeof bin === "string" && bin.trim().length > 0) out.bin = bin.trim();
    if (typeof includeFiles === "boolean") out.includeFiles = includeFiles;
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

  const npx = platform === "win32" ? "npx.cmd" : "npx";
  return { cmd: npx, prefix: ["-y", `graview@${GRAVIEW_VERSION}`], source: "npx", detail: `npx -y graview@${GRAVIEW_VERSION}` };
}
