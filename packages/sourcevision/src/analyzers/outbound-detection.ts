/**
 * Outbound dependency detection — the consumer side of the wire.
 *
 * `server-route-detection.ts` and `go-route-detection.ts` find the routes this
 * repository *serves*. This finds the ones it *calls*, plus the interface
 * contracts it declares in files. Together they are what makes it possible to
 * say that repository A talks to repository B.
 *
 * Deterministic by construction: no LLM, no network, and no resolution beyond
 * what the source text states. Written to `outbound.json` by every
 * `sv analyze`, canonically ordered so an unchanged tree re-analyses to a
 * byte-identical file.
 *
 * ## What is here today
 *
 * Declared contracts, and the wiring. Call-site detection is deliberately
 * empty: this is the first of four slices, and landing the shape, the file and
 * the pipeline position first means each later slice — JS/TS HTTP and gRPC,
 * JS/TS queue/database/cache, Go — adds detections to a file consumers already
 * read, rather than introducing the file and its readers at the same time.
 *
 * ## Why contracts are not found through the inventory alone
 *
 * `.proto`, `.yaml` and `.json` are not programming languages, so the default
 * `codeOnly` inventory omits them (`PROGRAMMING_LANGUAGES` in
 * `inventory.ts`). A project that disables `codeOnly`, or lists `.proto` under
 * `extraExtensions`, does have them — so both sources are consulted and the
 * results merged. Widening the inventory instead would change the input to
 * zone detection for every project, which is a far larger change than finding
 * contract files warrants.
 *
 * @module sourcevision/analyzers/outbound-detection
 */

import { readdirSync } from "node:fs";
import { basename, extname, join, relative, sep } from "node:path";
import type {
  DeclaredContract,
  Inventory,
  OutboundData,
  OutboundDependency,
} from "../schema/index.js";
import { sortOutbound } from "../util/sort.js";

/**
 * An OpenAPI or Swagger document, by filename convention.
 *
 * Matches `openapi.yaml`, `swagger.json`, `openapi.v1.yml`, `swagger-api.json`
 * and the like. Convention only — the file is not parsed, because a contract
 * that is listed but unread is still a fact a consumer can act on, and parsing
 * every YAML file in a repository to confirm it is not worth the walk.
 */
const OPENAPI_FILENAME = /^(?:openapi|swagger)[\w.-]*\.(?:ya?ml|json)$/i;

/** Directories a contract file is never meaningfully found under. */
const CONTRACT_SKIP = new Set([
  "node_modules", ".git", "dist", "build", "vendor", "coverage", "target",
]);

/** Depth and count bounds, so a pathological tree cannot stall an analysis. */
const MAX_WALK_DEPTH = 8;
const MAX_CONTRACTS = 400;

/** Classify one path as a declared contract, or `null` if it is not one. */
export function contractKindFor(path: string): DeclaredContract["kind"] | null {
  if (extname(path).toLowerCase() === ".proto") return "proto";
  if (OPENAPI_FILENAME.test(basename(path))) return "openapi";
  return null;
}

/**
 * Find declared contract files under `targetDir`, merged with any the
 * inventory already carries.
 *
 * Bounded: at most `MAX_CONTRACTS` results and `MAX_WALK_DEPTH` levels. A
 * repository with more contract files than that has a cataloguing problem this
 * analyzer is not the place to solve.
 */
export function findDeclaredContracts(
  targetDir: string,
  inventoryPaths: readonly string[],
): DeclaredContract[] {
  const byPath = new Map<string, DeclaredContract>();

  const record = (path: string): void => {
    if (byPath.size >= MAX_CONTRACTS || byPath.has(path)) return;
    const kind = contractKindFor(path);
    if (kind) byPath.set(path, { file: path, kind });
  };

  for (const path of inventoryPaths) record(path);

  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_WALK_DEPTH || byPath.size >= MAX_CONTRACTS) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      // An unreadable directory is not an analysis failure — a permission
      // boundary mid-tree should cost its own subtree, not the whole file.
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (CONTRACT_SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
        walk(full, depth + 1);
        continue;
      }
      record(relative(targetDir, full).split(sep).join("/"));
    }
  };
  walk(targetDir, 0);

  return [...byPath.values()];
}

/**
 * Detect everything this repository reaches out to.
 *
 * Takes the inventory rather than walking for source files itself, so the set
 * of files considered is the same set every other analyzer sees — ignore
 * rules, skip directories and incremental caching included.
 *
 * Async because the call-site slices read file contents; nothing here awaits
 * yet, and the signature is settled now so adding them is not also a change to
 * every caller.
 */
export async function detectOutbound(
  targetDir: string,
  inventory: Inventory,
): Promise<OutboundData> {
  const dependencies: OutboundDependency[] = [];
  const contracts = findDeclaredContracts(
    targetDir,
    inventory.files.map((f) => f.path),
  );

  return sortOutbound({ dependencies, contracts });
}
