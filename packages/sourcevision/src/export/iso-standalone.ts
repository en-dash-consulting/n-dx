/**
 * Standalone CLI for the isometric map.
 *
 * This module is the entry point bundled into
 * `.claude/skills/iso-map/scripts/iso-map.mjs` by
 * `scripts/build-iso-skill.mjs`. It must depend on nothing but `node:` builtins
 * and the other `iso-*` modules, so the bundle stays dependency-free and can be
 * published as a skill that runs in any repository.
 *
 * The package's own `sourcevision iso` command shares every one of these
 * modules — the only thing that differs is argument parsing and error
 * reporting, which the CLI does through `CLIError`.
 */

import { writeFileSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { buildIsoModel } from "./iso-model.js";
import { renderIsoMap } from "./iso-map.js";
import { loadIsoInput } from "./iso-sources.js";
import type { IsoSourceMode } from "./iso-sources.js";

export interface StandaloneOptions {
  dir: string;
  out: string | null;
  maxNodes: number;
  externals: boolean;
  source: IsoSourceMode;
  title: string | null;
  linkBase: string | null;
  analyzedAt: string | null;
  json: boolean;
  help: boolean;
}

export const HELP = `iso-map — standalone isometric map of a codebase

  node iso-map.mjs [dir] [options]

  --out=<path>       Output file (default: <dir>/iso-map.html)
  --max-nodes=<n>    Cap drawn zones, largest first (default 40)
  --no-externals     Omit the shared third-party dependency column
  --source=<mode>    auto | sourcevision | scan (default auto)
  --title=<text>     Override the page title
  --link-base=<url>  Base URL for source links (default: the git remote)
  --analyzed-at=<t>  Timestamp to stamp (default: the HEAD commit time)
  --json             Print the model as JSON to stdout as well
  --help

Uses .sourcevision/ output when present; otherwise scans the project directly.
`;

class UsageError extends Error {}

export function parseStandaloneArgs(argv: string[]): StandaloneOptions {
  const opts: StandaloneOptions = {
    dir: ".", out: null, maxNodes: 40, externals: true, source: "auto",
    title: null, linkBase: null, analyzedAt: null, json: false, help: false,
  };
  let sawDir = false;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--no-externals") opts.externals = false;
    else if (arg === "--json") opts.json = true;
    else if (arg.startsWith("--out=")) opts.out = arg.slice(6);
    else if (arg.startsWith("--title=")) opts.title = arg.slice(8);
    else if (arg.startsWith("--link-base=")) opts.linkBase = arg.slice(12);
    else if (arg.startsWith("--analyzed-at=")) opts.analyzedAt = arg.slice(14);
    else if (arg.startsWith("--source=")) {
      const mode = arg.slice(9);
      if (mode !== "auto" && mode !== "sourcevision" && mode !== "scan") {
        throw new UsageError(`Invalid --source: ${mode} (expected auto, sourcevision or scan)`);
      }
      opts.source = mode;
    } else if (arg.startsWith("--max-nodes=")) {
      const raw = arg.slice(12);
      const value = Number.parseInt(raw, 10);
      if (!Number.isFinite(value) || value < 1) {
        throw new UsageError(`Invalid --max-nodes: ${raw}`);
      }
      opts.maxNodes = value;
    } else if (arg.startsWith("-")) {
      throw new UsageError(`Unknown option: ${arg}`);
    } else if (!sawDir) {
      opts.dir = arg;
      sawDir = true;
    }
  }
  return opts;
}

/** Run the standalone CLI. Returns a process exit code. */
export function runStandalone(
  argv: string[],
  io: { out: (s: string) => void; err: (s: string) => void },
): number {
  let opts: StandaloneOptions;
  try {
    opts = parseStandaloneArgs(argv);
  } catch (err) {
    io.err(`iso-map: ${(err as Error).message}\n`);
    return 1;
  }

  if (opts.help) {
    io.out(HELP);
    return 0;
  }

  const root = resolve(opts.dir);
  if (!existsSync(root)) {
    io.err(`iso-map: Directory not found: ${root}\n`);
    return 1;
  }

  const input = loadIsoInput(root, opts.source, {
    analyzedAt: opts.analyzedAt ?? undefined,
    linkBase: opts.linkBase ?? undefined,
  });

  if (!input) {
    io.err(
      `iso-map: No usable .sourcevision/ output in ${root}. ` +
        `Run 'sourcevision analyze', or use --source=scan.\n`,
    );
    return 1;
  }
  if (input.zones.length === 0) {
    io.err(
      opts.source === "scan" || input.meta.origin === "scan"
        ? `iso-map: No source files found under ${root}. Is this the right directory?\n`
        : `iso-map: No zones could be derived — nothing to draw.\n`,
    );
    return 1;
  }

  const out = resolve(opts.out ?? join(root, "iso-map.html"));
  if (!existsSync(dirname(out))) {
    io.err(`iso-map: Output directory does not exist: ${dirname(out)}\n`);
    return 1;
  }

  const model = buildIsoModel(input, {
    maxNodes: opts.maxNodes,
    includeExternals: opts.externals,
  });
  writeFileSync(out, renderIsoMap(model, { title: opts.title ?? undefined }), "utf-8");

  if (opts.json) io.out(`${JSON.stringify(model, null, 2)}\n`);
  io.err(
    `iso-map: wrote ${out} — ${model.meta.shownZones} zones, ` +
      `${model.edges.length} edges (${model.meta.origin})\n`,
  );
  return 0;
}
